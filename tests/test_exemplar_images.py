# tests/test_exemplar_images.py
"""Eksemplari piltide manifest (ADR 0079 p 1, 4): lukk, revisjon, serveri väljad."""
import io
import json
import os

import pytest
from PIL import Image

from server import exemplar_images as ei
from server.git_ops import uncommitted_paths


def _jpeg(color=(10, 20, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), color).save(buf, "JPEG")
    return buf.getvalue()


def _commits(env) -> int:
    return len(list(env["repo"].iter_commits()))


@pytest.fixture
def env(exemplar_work):
    return exemplar_work


def _add(env, n=2, source=None):
    files = [(_jpeg((i, i, i)), source or {"kind": "photo", "ref": "M. F. foto"}) for i in range(n)]
    return ei.add_uploads(env["work_dir"], env["eid"], files, "meelisf")


def test_tuhi_manifest():
    assert ei.read_manifest("/olematu", "a1b2c3") == {"revision": 0, "images": [], "imports": {}}


def test_lisamine_tostab_revisjoni_ja_commitib(env):
    m = _add(env)
    assert m["revision"] == 1 and len(m["images"]) == 2
    img = m["images"][0]
    assert img["source"]["kind"] == "photo" and img["source"]["added_by"] == "meelisf"
    assert "original" not in img
    assert os.path.exists(os.path.join(ei.exemplar_dir(env["work_dir"], env["eid"]), img["id"] + ".jpg"))
    assert uncommitted_paths([ei.manifest_path(env["work_dir"], env["eid"])]) == []
    assert ei.read_manifest(env["work_dir"], env["eid"]) == {k: v for k, v in m.items() if k != "git_committed"}


def test_lisamine_vigase_allikaga_400(env):
    with pytest.raises(ei.ExemplarImagesError) as e:
        _add(env, source={"kind": "ada"})
    assert e.value.status == 400


def test_lisamine_vigase_failiga_ei_jata_poolikut(env):
    files = [(_jpeg(), {"kind": "photo"}), (b"%PDF", {"kind": "photo"})]
    with pytest.raises(Exception):
        ei.add_uploads(env["work_dir"], env["eid"], files, "meelisf")
    d = ei.exemplar_dir(env["work_dir"], env["eid"])
    assert not os.path.exists(d) or not [f for f in os.listdir(d) if f.endswith(".jpg")]
    assert ei.read_manifest(env["work_dir"], env["eid"])["revision"] == 0


def test_patch_vananenud_revisjon_409(env):
    _add(env)
    a = ei.read_manifest(env["work_dir"], env["eid"])
    b = ei.read_manifest(env["work_dir"], env["eid"])
    ei.patch_images(env["work_dir"], env["eid"], a["revision"], list(reversed(a["images"])), "u1")
    with pytest.raises(ei.ExemplarImagesError) as e:
        ei.delete_image(env["work_dir"], env["eid"], b["images"][0]["id"], b["revision"], "u2")
    assert e.value.status == 409
    assert e.value.current["revision"] == 2
    with pytest.raises(ei.ExemplarImagesError) as e:
        ei.patch_images(env["work_dir"], env["eid"], b["revision"], b["images"], "u2")
    assert e.value.status == 409


def test_patch_peab_sisaldama_samu_idsid(env):
    m = _add(env)
    for images in (m["images"][:1], m["images"] + [{"id": "zzzzzz", "source": {"kind": "photo"}}],
                   [m["images"][0], m["images"][0]]):
        with pytest.raises(ei.ExemplarImagesError) as e:
            ei.patch_images(env["work_dir"], env["eid"], m["revision"], images, "u")
        assert e.value.status == 409


def test_patch_muudab_silti_ja_lehte(env):
    m = _add(env)
    imgs = [dict(i) for i in m["images"]]
    imgs[0] = {**imgs[0], "label": "a2 r", "page": "1640-test-w1-001",
               "source": {**imgs[0]["source"], "license": "CC BY"}}
    out = ei.patch_images(env["work_dir"], env["eid"], m["revision"], imgs, "u")
    assert out["revision"] == 2
    assert out["images"][0]["label"] == "a2 r" and out["images"][0]["source"]["license"] == "CC BY"
    # Tühi väärtus = võtme puudumine
    imgs = [dict(i) for i in out["images"]]
    imgs[0] = {**imgs[0], "label": ""}
    out = ei.patch_images(env["work_dir"], env["eid"], out["revision"], imgs, "u")
    assert "label" not in out["images"][0]


def test_patch_ei_muuda_serverivalju(env):
    m = _add(env, n=1)
    img = m["images"][0]
    fake = {**img, "original": "x.orig.tif",
            "source": {**img["source"], "import_id": "voltsi", "added_by": "x", "at": "1999-01-01"}}
    out = ei.patch_images(env["work_dir"], env["eid"], m["revision"], [fake], "u")
    src = out["images"][0]["source"]
    assert "import_id" not in src and src["added_by"] == "meelisf" and src["at"] == img["source"]["at"]
    assert "original" not in out["images"][0]


def _import_image(env):
    """Impordipilt otse manifesti (import ise on Task 7)."""
    d = ei.exemplar_dir(env["work_dir"], env["eid"])
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "imp001.jpg"), "wb") as f:
        f.write(_jpeg())
    m = {"revision": 1, "imports": {"q1q1q1": {"kind": "ada", "ref": "10062/14332", "count": 1}},
         "images": [{"id": "imp001", "source": {"kind": "ada", "ref": "10062/14332", "bitstream": "u1",
                                                "page": 3, "import_id": "q1q1q1", "added_by": "a",
                                                "at": "2026-11-09"}}]}
    with ei.exemplar_locks(env["work_dir"]):
        ei.write_manifest_locked(env["work_dir"], env["eid"], m, "a", "test")
    return m


def test_impordipildi_allikas_muutumatu_peale_litsentsi(env):
    m = _import_image(env)
    img = m["images"][0]
    changed = {**img, "source": {**img["source"], "ref": "muu", "page": 9, "kind": "photo", "license": "PD"}}
    out = ei.patch_images(env["work_dir"], env["eid"], 1, [changed], "u")
    src = out["images"][0]["source"]
    assert src["ref"] == "10062/14332" and src["page"] == 3 and src["kind"] == "ada"
    assert src["license"] == "PD" and src["import_id"] == "q1q1q1"


def test_kustutus_viib_failid_prugikasti_ja_imports_jaab(env):
    _import_image(env)
    out = ei.delete_image(env["work_dir"], env["eid"], "imp001", 1, "u")
    assert out["images"] == [] and "q1q1q1" in out["imports"] and out["revision"] == 2
    d = ei.exemplar_dir(env["work_dir"], env["eid"])
    assert not os.path.exists(os.path.join(d, "imp001.jpg"))
    trash = env["data"] / "._trash" / "w1" / "_exemplars" / env["eid"] / "imp001.jpg"
    assert trash.exists()
    assert uncommitted_paths([ei.manifest_path(env["work_dir"], env["eid"])]) == []


def test_kustutus_tundmatu_pilt_404(env):
    with pytest.raises(ei.ExemplarImagesError) as e:
        ei.delete_image(env["work_dir"], env["eid"], "zzzzzz", 0, "u")
    assert e.value.status == 404


def test_puuduv_eksemplar_404(env):
    with pytest.raises(ei.ExemplarImagesError) as e:
        ei.add_uploads(env["work_dir"], "zzzzzz", [(_jpeg(), {"kind": "photo"})], "u")
    assert e.value.status == 404
    with pytest.raises(ei.ExemplarImagesError) as e:
        ei.patch_images(env["work_dir"], "../x", 0, [], "u")
    assert e.value.status == 404


def test_muutusteta_patch_ei_commiti(env):
    m = _add(env)
    before = _commits(env)
    out = ei.patch_images(env["work_dir"], env["eid"], m["revision"], m["images"], "u")
    assert out["revision"] == m["revision"]
    assert _commits(env) == before


def test_original_path(env):
    m = _add(env, n=1)
    path, url = ei.original_path(env["work_dir"], env["eid"], m["images"][0]["id"])
    assert path.endswith(m["images"][0]["id"] + ".jpg") and url is None
    _import_image(env)
    assert ei.original_path(env["work_dir"], env["eid"], "imp001") == (None, "https://hdl.handle.net/10062/14332")


def test_uleslaadimine_ei_toota_pilti_metadata_lock_all(env, monkeypatch):
    """Pildi dekodeerimine ei tohi hoida globaalset metadata_lock-i (kõik teosed ootaks)."""
    import threading
    from server.utils import metadata_lock
    held = []
    real = ei.store_image

    def spy(content, dest_dir, image_id):
        res = {}

        def probe():
            res["free"] = metadata_lock.acquire(blocking=False)
            if res["free"]:
                metadata_lock.release()
        t = threading.Thread(target=probe)
        t.start()
        t.join()
        held.append(not res["free"])
        return real(content, dest_dir, image_id)
    monkeypatch.setattr(ei, "store_image", spy)
    _add(env, n=2)
    assert held == [False, False]


def test_eksemplar_kadus_tootluse_ajal_failid_ara_ja_404(env, monkeypatch):
    from server import work_exemplars as we
    real = ei.store_image
    state = {"n": 0}

    def store_then_delete(content, dest_dir, image_id):
        out = real(content, dest_dir, image_id)
        if state["n"] == 0:
            state["n"] += 1
            we.delete_exemplar(env["work_dir"], env["eid"], "u")
        return out
    monkeypatch.setattr(ei, "store_image", store_then_delete)
    with pytest.raises(ei.ExemplarImagesError) as e:
        _add(env, n=1)
    assert e.value.status == 404
    d = ei.exemplar_dir(env["work_dir"], env["eid"])
    assert not os.path.exists(d) or not [f for f in os.listdir(d) if f.endswith(".jpg")]
    assert not os.path.exists(ei.manifest_path(env["work_dir"], env["eid"]))
