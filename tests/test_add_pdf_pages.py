"""PDF-ist lehtede lisamine teose halduses: renderdus + sisestus + endpoint (ADR 0074)."""
import io
import json
import os
import sys
import time
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.admin_page_ops as aps
from server import add_pdf_pages as app
from server.admin_page_ops import AnchorMissing, get_sorted_images

VARVID = [(250, 0, 0), (0, 250, 0), (0, 0, 250)]


def _pdf_bytes(colors=VARVID):
    lehed = [Image.new("RGB", (60, 80), c) for c in colors]
    buf = io.BytesIO()
    lehed[0].save(buf, "PDF", save_all=True, append_images=lehed[1:], resolution=10.0)
    return buf.getvalue()


@pytest.fixture
def work(tmp_path, monkeypatch):
    wid = "w1"
    folder = tmp_path / "1690-test-w1"
    folder.mkdir()
    for i, seq in enumerate([100, 200], start=1):
        base = f"1690-test-w1-w1-pg{i:03d}"
        Image.new("RGB", (8, 8), (i, i, i)).save(str(folder / (base + ".jpg")), "JPEG")
        (folder / (base + ".txt")).write_text("", encoding="utf-8")
        (folder / (base + ".json")).write_text(json.dumps({"sequence": seq}), encoding="utf-8")
    (folder / "_metadata.json").write_text(json.dumps({"id": wid}), encoding="utf-8")

    commits = []
    monkeypatch.setattr(aps, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(aps, "find_directory_by_id", lambda w: str(folder) if w == wid else None)
    monkeypatch.setattr(aps, "save_with_git", lambda *a, **kw: commits.append(a) or {"success": True})
    monkeypatch.setattr(aps, "sync_work_to_meilisearch", lambda *a: None)
    monkeypatch.setattr(aps, "refresh_work_mentions", lambda *a, **kw: None)
    return {"folder": folder, "work_id": wid, "commits": commits}


def _prep(work, data=None):
    return app.prepare_pdf(str(work["folder"]), io.BytesIO(data or _pdf_bytes()))


def _tmp_dirs(folder):
    return [n for n in os.listdir(folder) if n.startswith(app.TMP_PREFIX)]


def _keskmine(path):
    with Image.open(path) as im:
        w, h = im.size
        return im.convert("RGB").getpixel((w // 2, h // 2))


# --- Renderdus + sisestus ---

def test_run_add_pdf_sisestab_koik_lehed_jarjekorras(work):
    tmp_dir, n = _prep(work)
    assert n == 3
    res = app.run_add_pdf(work["work_id"], tmp_dir, n, "end", "admin", lambda d, t: None)
    imgs = get_sorted_images(str(work["folder"]))
    assert len(imgs) == 5
    uued = [it["filename"] for it in res["inserted"]]
    assert imgs[2:] == uued
    for fn, (r, g, b) in zip(uued, VARVID):
        rr, gg, bb = _keskmine(str(work["folder"] / fn))
        assert abs(rr - r) < 40 and abs(gg - g) < 40 and abs(bb - b) < 40
    assert not os.path.exists(tmp_dir)
    assert len(work["commits"]) == 1


def test_render_kaib_semafori_all(work, monkeypatch):
    sisenemised = []

    class Loendur:
        def __enter__(self):
            sisenemised.append(1)

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(app, "RENDER_SEMAPHORE", Loendur())
    tmp_dir, n = _prep(work)
    app.run_add_pdf(work["work_id"], tmp_dir, n, "end", "admin", lambda d, t: None)
    assert len(sisenemised) == 3


def test_renderdusviga_ei_sisesta_midagi(work, monkeypatch):
    real = app.PdfPageSource.render_full

    def katki(self, n, dst):
        if n == 2:
            raise RuntimeError("pdftoppm kukkus")
        return real(self, n, dst)

    monkeypatch.setattr(app.PdfPageSource, "render_full", katki)
    tmp_dir, n = _prep(work)
    with pytest.raises(RuntimeError):
        app.run_add_pdf(work["work_id"], tmp_dir, n, "end", "admin", lambda d, t: None)
    assert len(get_sorted_images(str(work["folder"]))) == 2
    assert not os.path.exists(tmp_dir)
    assert work["commits"] == []


def test_kadunud_ankur_tmp_koristatud(work):
    tmp_dir, n = _prep(work)
    with pytest.raises(AnchorMissing):
        app.run_add_pdf(work["work_id"], tmp_dir, n, "puudub.jpg", "admin", lambda d, t: None)
    assert not os.path.exists(tmp_dir)
    assert len(get_sorted_images(str(work["folder"]))) == 2


def test_progress_iga_lehe_jarel(work):
    nahtud = []
    tmp_dir, n = _prep(work)
    app.run_add_pdf(work["work_id"], tmp_dir, n, "end", "admin", lambda d, t: nahtud.append((d, t)))
    assert nahtud == [(1, 3), (2, 3), (3, 3)]


# --- prepare_pdf ---

def test_prepare_vigane_pdf(work):
    with pytest.raises(ValueError):
        _prep(work, b"%PDF-1.4 ramps")
    assert _tmp_dirs(work["folder"]) == []


def test_prepare_mitte_pdf(work):
    buf = io.BytesIO()
    Image.new("RGB", (8, 8)).save(buf, "JPEG")
    with pytest.raises(ValueError):
        _prep(work, buf.getvalue())
    assert _tmp_dirs(work["folder"]) == []


def test_prepare_liiga_suur(work, monkeypatch):
    monkeypatch.setattr(app, "PDF_MAX_BYTES", 100)
    with pytest.raises(ValueError):
        _prep(work)
    assert _tmp_dirs(work["folder"]) == []


def test_prepare_liiga_palju_lehti(work, monkeypatch):
    monkeypatch.setattr(app, "PDF_MAX_PAGES", 2)
    with pytest.raises(ValueError):
        _prep(work)
    assert _tmp_dirs(work["folder"]) == []


def test_vanad_tmp_kaustad_koristatakse(work):
    vana = work["folder"] / (app.TMP_PREFIX + "old")
    uus = work["folder"] / (app.TMP_PREFIX + "new")
    vana.mkdir()
    uus.mkdir()
    kaks_paeva = time.time() - 2 * 86400
    os.utime(vana, (kaks_paeva, kaks_paeva))
    tmp_dir, _ = _prep(work)
    assert not vana.exists()
    assert uus.exists()
    assert os.path.exists(tmp_dir)


def test_anchor_exists(work):
    d = str(work["folder"])
    assert app.anchor_exists(d, "start") and app.anchor_exists(d, "end")
    assert app.anchor_exists(d, "1690-test-w1-w1-pg002.jpg")
    assert not app.anchor_exists(d, "puudub.jpg")


# --- Endpoint ---

@pytest.fixture
def ep(backend_env, login, work, monkeypatch):
    from server.routers import pages as pages_router
    from server import page_ops_jobs
    page_ops_jobs._reset_for_tests()
    monkeypatch.setattr(pages_router, "find_directory_by_id",
                        lambda w: str(work["folder"]) if w == "w1" else None)
    h = {"Authorization": f"Bearer {login('admin', 'adminpass')}"}

    def post(data, after="end", headers=h, work_id="w1"):
        return backend_env["client"].post(
            f"/admin/work/{work_id}/add-pdf",
            files={"file": ("lisa.pdf", data, "application/pdf")},
            data={"after": after}, headers=headers)

    yield {"post": post, "jobs": page_ops_jobs, "work": work, "login": login}
    page_ops_jobs._reset_for_tests()


def test_add_pdf_kaivitab_too(ep, monkeypatch):
    started = []
    monkeypatch.setattr(ep["jobs"], "start_job",
                        lambda *a, **kw: started.append(a) or True)
    r = ep["post"](_pdf_bytes())
    assert r.status_code == 200 and r.json() == {"status": "started", "total": 3}
    assert started[0][:3] == ("w1", "add_pdf", 3)


def test_add_pdf_lopuni(ep):
    r = ep["post"](_pdf_bytes(), after="1690-test-w1-w1-pg001.jpg")
    assert r.status_code == 200
    t0 = time.time()
    while ep["jobs"].get_status("w1").get("state") == "running" and time.time() - t0 < 30:
        time.sleep(0.05)
    st = ep["jobs"].get_status("w1")
    assert st["state"] == "done" and st["kind"] == "add_pdf"
    imgs = get_sorted_images(str(ep["work"]["folder"]))
    assert imgs[0] == "1690-test-w1-w1-pg001.jpg"
    assert imgs[1:4] == [it["filename"] for it in st["result"]["inserted"]]


def test_add_pdf_vigane_pdf_400(ep):
    assert ep["post"](b"%PDF-1.4 ramps").status_code == 400
    assert _tmp_dirs(ep["work"]["folder"]) == []


def test_add_pdf_mitte_pdf_400(ep):
    buf = io.BytesIO()
    Image.new("RGB", (8, 8)).save(buf, "JPEG")
    assert ep["post"](buf.getvalue()).status_code == 400


def test_add_pdf_kadunud_ankur_409(ep):
    r = ep["post"](_pdf_bytes(), after="puudub.jpg")
    assert r.status_code == 409
    assert _tmp_dirs(ep["work"]["folder"]) == []


def test_add_pdf_busy_409_koristab(ep, monkeypatch):
    monkeypatch.setattr(ep["jobs"], "start_job", lambda *a, **kw: False)
    assert ep["post"](_pdf_bytes()).status_code == 409
    assert _tmp_dirs(ep["work"]["folder"]) == []


def test_add_pdf_teost_pole_404(ep):
    assert ep["post"](_pdf_bytes(), work_id="pole").status_code == 404


def test_add_pdf_nouab_admini(ep):
    h = {"Authorization": f"Bearer {ep['login']('editor', 'editorpass')}"}
    assert ep["post"](_pdf_bytes(), headers=h).status_code == 401
