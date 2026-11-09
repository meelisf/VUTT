# tests/test_exemplar_import.py
"""ADA import eksemplari piltideks (ADR 0079 p 5): leheplaan, taastatav
avaldamisprotokoll, taastaja. Allalaadimine ja renderdus on võltsitud."""
import io
import json
import os
import shutil
import subprocess
import threading

import pytest
from PIL import Image

from server import exemplar_images as ei
from server import exemplar_import as imp
from server import metadata_ops
from server import work_exemplars as we
from server.git_ops import uncommitted_paths

HANDLE = "10062/14332"
U1 = "11111111-1111-1111-1111-111111111111"
U2 = "22222222-2222-2222-2222-222222222222"


# ── Puhas leheplaan ──────────────────────────────────────────────────────────

def _ids():
    n = iter(range(100))
    return lambda: f"p{next(n):05d}"


def test_leheplaan_mitu_bitstreami_vahemik():
    plan = imp.build_page_plan([("u1", 4), ("u2", 6)], 3, 7, _ids())
    assert [p["pdf_page"] for p in plan] == [3, 4, 5, 6, 7]
    assert [(p["bitstream"], p["bitstream_page"]) for p in plan] == \
        [("u1", 3), ("u1", 4), ("u2", 1), ("u2", 2), ("u2", 3)]
    assert len({p["image_id"] for p in plan}) == 5


def test_leheplaan_vahemik_valjas_viga():
    with pytest.raises(ei.ExemplarImagesError):
        imp.build_page_plan([("u1", 4), ("u2", 6)], 3, 11, _ids())
    with pytest.raises(ei.ExemplarImagesError):
        imp.build_page_plan([("u1", 4)], 4, 3, _ids())


def test_leheplaan_ilma_vahemikuta_koik():
    plan = imp.build_page_plan([("u1", 2), ("u2", 1)], None, None, _ids())
    assert [(p["pdf_page"], p["bitstream"], p["bitstream_page"]) for p in plan] == \
        [(1, "u1", 1), (2, "u1", 2), (3, "u2", 1)]


# ── Protokoll ────────────────────────────────────────────────────────────────

def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (20, 30), (200, 200, 200)).save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture
def env(exemplar_work, monkeypatch):
    calls = {"render": [], "on_render": None}
    monkeypatch.setattr(imp, "_lookup", lambda h: {"handle": HANDLE, "failid": [
        {"name": "a.pdf", "bitstream_uuid": U1, "size_bytes": 10},
        {"name": "b.pdf", "bitstream_uuid": U2, "size_bytes": 10}]})

    def fetch(src, dst):
        with open(dst, "wb") as f:
            f.write(b"%PDF-fake " + src["bitstream_uuid"].encode())
    monkeypatch.setattr(imp, "_fetch_source", fetch)
    monkeypatch.setattr(imp, "_page_count", lambda path: 4 if open(path, "rb").read().endswith(U1.encode()) else 6)

    def render(pdf, page, dst):
        calls["render"].append((os.path.basename(pdf), page))
        if calls["on_render"]:
            calls["on_render"]()
        with open(dst, "wb") as f:
            f.write(_jpeg())
    monkeypatch.setattr(imp, "_render_page", render)
    # Taustatöö sünkroonselt: test näeb tulemust kohe.
    monkeypatch.setattr(imp, "_spawn", lambda fn, *a: fn(*a))
    exemplar_work["calls"] = calls
    return exemplar_work


def _start(env, **kw):
    return imp.start_import(env["work_dir"], env["eid"], HANDLE, kw.get("frm", 3), kw.get("to", 7), "meelisf")


def _meta_ex(env):
    with open(env["meta_path"], encoding="utf-8") as f:
        return json.load(f)["exemplars"][0]


def _staging(env, import_id):
    return os.path.join(ei.exemplar_dir(env["work_dir"], env["eid"]), "_imports", import_id)


def _clean(env, import_id, n=5):
    m = ei.read_manifest(env["work_dir"], env["eid"])
    assert len(m["images"]) == n
    assert list(m["imports"]) == [import_id]
    assert uncommitted_paths([ei.manifest_path(env["work_dir"], env["eid"]), env["meta_path"]]) == []
    assert not os.path.exists(_staging(env, import_id))
    return m


def test_import_avaldab_pildid_ja_seab_url(env):
    import_id = _start(env)
    m = _clean(env, import_id)
    assert _meta_ex(env)["url"] == "https://hdl.handle.net/10062/14332"
    src = m["images"][0]["source"]
    assert src["ref"] == HANDLE and src["bitstream"] == U1 and src["page"] == 3
    assert src["import_id"] == import_id and src["kind"] == "ada" and src["added_by"] == "meelisf"
    assert m["imports"][import_id]["count"] == 5 and m["imports"][import_id]["ref"] == HANDLE
    assert [s["source"]["page"] for s in m["images"]] == [3, 4, 1, 2, 3]
    for img in m["images"]:
        assert os.path.exists(os.path.join(ei.exemplar_dir(env["work_dir"], env["eid"]), img["id"] + ".jpg"))
    assert imp.import_status(env["work_dir"], env["eid"], import_id)["state"] == "published"


def test_olemasolevat_url_ei_kirjutata_ule(env):
    we.update_exemplar(env["work_dir"], env["eid"], {"url": "https://muu"}, "u")
    import_id = _start(env)
    _clean(env, import_id)
    assert _meta_ex(env)["url"] == "https://muu"


def _interrupt_at(monkeypatch, name):
    hit = {"n": 0}
    orig = imp._checkpoint

    def cp(step):
        if step == name and hit["n"] == 0:
            hit["n"] += 1
            raise RuntimeError(f"katkestus: {step}")
        orig(step)
    monkeypatch.setattr(imp, "_checkpoint", cp)
    return hit


@pytest.mark.parametrize("step", ["files_moved", "manifest_written", "manifest_committed", "url_done"])
def test_katkestus_ja_kordus(env, monkeypatch, step):
    hit = _interrupt_at(monkeypatch, step)
    import_id = _start(env)
    assert hit["n"] == 1
    assert imp.import_status(env["work_dir"], env["eid"], import_id)["state"] in ("publishing",)
    imp.publish(env["work_dir"], env["eid"], import_id)
    _clean(env, import_id)
    assert _meta_ex(env)["url"] == "https://hdl.handle.net/10062/14332"


def test_manifesti_commiti_torge_jatab_publishing(env, monkeypatch):
    from server import git_ops
    real = git_ops.save_with_git
    monkeypatch.setattr(git_ops, "save_with_git", lambda *a, **k: {"success": False, "error": "x"})
    import_id = _start(env)
    st = imp.import_status(env["work_dir"], env["eid"], import_id)
    assert st["state"] == "publishing" and st["error"]
    monkeypatch.setattr(git_ops, "save_with_git", real)
    imp.publish(env["work_dir"], env["eid"], import_id)
    _clean(env, import_id)


def test_url_commiti_torge_url_done_marki_ei_tule(env, monkeypatch):
    real = metadata_ops.save_with_git

    def write_then_fail(path, content, *a, **k):
        # Päris tõrke kuju: fail kettal, commit ebaõnnestus (#418).
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return {"success": False, "error": "x"}
    monkeypatch.setattr(metadata_ops, "save_with_git", write_then_fail)
    import_id = _start(env)
    with open(os.path.join(_staging(env, import_id), "job.json"), encoding="utf-8") as f:
        job = json.load(f)
    assert job["state"] == "publishing" and not job.get("url_done")
    assert uncommitted_paths([env["meta_path"]])          # URL kettal, commit'imata
    monkeypatch.setattr(metadata_ops, "save_with_git", real)
    imp.publish(env["work_dir"], env["eid"], import_id)
    _clean(env, import_id)
    assert _meta_ex(env)["url"] == "https://hdl.handle.net/10062/14332"


def test_impordipilt_kustutatud_enne_kordust(env, monkeypatch):
    _interrupt_at(monkeypatch, "manifest_committed")
    import_id = _start(env)
    m = ei.read_manifest(env["work_dir"], env["eid"])
    ei.delete_image(env["work_dir"], env["eid"], m["images"][0]["id"], m["revision"], "u")
    imp.publish(env["work_dir"], env["eid"], import_id)
    _clean(env, import_id, n=4)
    assert _meta_ex(env)["url"] == "https://hdl.handle.net/10062/14332"


def test_taastaja_ei_impordi_kustutatud_pilte_uuesti(env, monkeypatch):
    _interrupt_at(monkeypatch, "url_done")
    import_id = _start(env)
    m = ei.read_manifest(env["work_dir"], env["eid"])
    for img in m["images"]:
        cur = ei.read_manifest(env["work_dir"], env["eid"])
        ei.delete_image(env["work_dir"], env["eid"], img["id"], cur["revision"], "u")
    imp.recover_imports(background=False)
    _clean(env, import_id, n=0)


def test_eksemplar_kustutatud_renderdamise_ajal_aborted(env):
    env["calls"]["on_render"] = lambda: (
        env["calls"].__setitem__("on_render", None),
        we.delete_exemplar(env["work_dir"], env["eid"], "u"))
    import_id = _start(env)
    trash_job = env["data"] / "._trash" / "w1" / "_exemplars" / env["eid"] / "_imports" / import_id / "job.json"
    assert json.loads(trash_job.read_text(encoding="utf-8"))["state"] == "aborted"
    assert not os.path.exists(ei.manifest_path(env["work_dir"], env["eid"]))
    with open(env["meta_path"], encoding="utf-8") as f:
        assert json.load(f).get("exemplars") in (None, [])
    assert not os.path.exists(ei.exemplar_dir(env["work_dir"], env["eid"]))


def test_teos_kustutatud_renderdamise_ajal(env):
    env["calls"]["on_render"] = lambda: shutil.rmtree(env["work_dir"])
    _start(env)                                   # ei viska
    imp.recover_imports(background=False)         # ei viska
    assert not os.path.exists(env["work_dir"])


def test_teine_import_samale_eksemplarile_409(env, monkeypatch):
    monkeypatch.setattr(imp, "_spawn", lambda fn, *a: None)   # esimene jääb pooleli
    _start(env)
    with pytest.raises(ei.ExemplarImagesError) as e:
        _start(env)
    assert e.value.status == 409


def test_vea_import_ei_blokeeri_uut(env, monkeypatch):
    def broken(src, dst):
        raise RuntimeError("võrk")
    monkeypatch.setattr(imp, "_fetch_source", broken)
    first = _start(env)
    assert imp.import_status(env["work_dir"], env["eid"], first)["state"] == "error"
    monkeypatch.setattr(imp, "_fetch_source", lambda src, dst: open(dst, "wb").write(
        b"%PDF-fake " + src["bitstream_uuid"].encode()))
    second = _start(env)
    _clean(env, second)


def test_vigane_vahemik_on_impordi_viga(env):
    import_id = _start(env, frm=3, to=11)
    st = imp.import_status(env["work_dir"], env["eid"], import_id)
    assert st["state"] == "error" and st["error"]


def test_tuhja_urliga_import_ei_jaa_ummikusse(env, monkeypatch):
    monkeypatch.setattr(imp, "_spawn", lambda fn, *a: None)
    import_id = _start(env)
    imp._run(env["work_dir"], env["eid"], import_id, publish_after=False)
    t = threading.Thread(target=imp.publish, args=(env["work_dir"], env["eid"], import_id), daemon=True)
    t.start()
    t.join(timeout=5)
    assert not t.is_alive()
    _clean(env, import_id)


def test_imports_ei_satu_replace_work_content_commiti(env, monkeypatch):
    monkeypatch.setattr(imp, "_spawn", lambda fn, *a: None)
    import_id = _start(env)
    staging = _staging(env, import_id)
    with open(os.path.join(staging, "koos.pdf"), "wb") as f:
        f.write(b"%PDF")
    subprocess.run(["git", "add", "1640-test-w1"], cwd=env["data"], check=True)
    cached = subprocess.run(["git", "diff", "--cached", "--name-only"], cwd=env["data"],
                            capture_output=True, text=True, check=True).stdout
    assert "_imports" not in cached


@pytest.mark.skipif(not shutil.which("pdftoppm") or not shutil.which("pdfinfo"), reason="poppler puudub")
def test_paris_renderdaja_ja_lehearv(tmp_path):
    """Võltsimata `_page_count` + `_render_page` kahelehelisel PDF-il."""
    pdf = tmp_path / "a.pdf"
    pages = [Image.new("RGB", (200, 300), c) for c in ((255, 0, 0), (0, 0, 255))]
    pages[0].save(pdf, "PDF", save_all=True, append_images=pages[1:], resolution=72)
    assert imp._page_count(str(pdf)) == 2
    dst = tmp_path / "x1y2z3.jpg"
    imp._render_page(str(pdf), 2, str(dst))
    with Image.open(dst) as im:
        r, g, b = im.convert("RGB").getpixel((im.width // 2, im.height // 2))
        assert b > 200 and r < 50
    assert not list(tmp_path.glob("x1y2z3-*.jpg"))
