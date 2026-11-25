"""Eksemplari piltide serveripoolsed abid aluse vahetuseks (PR 2, ADR 0089 p 6).

`former_pages`: endise transkriptsiooni aluse lehed eksemplari piltidena. Allikas on serveri
oma (klient ei saa seda saata ega muuta); lisamine ja eemaldamine on korduskindlad ja
kontrollivad commit'i tulemust (kohustuslik järelsamm → tõrge ei tohi olla vaikne).
"""
import io
import json
import os

import pytest
from PIL import Image

from server import exemplar_images as ei


def _jpeg_file(path, w=8, h=8):
    Image.new("RGB", (w, h), (5, 5, 5)).save(str(path), "JPEG")
    return str(path)


def _src(stem, page=1):
    return {"kind": "former_pages", "ref": "abc123", "page": page, "stem": stem, "upload_id": "u1"}


def _manifest(w):
    return ei.read_manifest(w["work_dir"], w["eid"])


def test_stem_ja_upload_id_puhastuse_jarel_alles(exemplar_work, tmp_path):
    w = exemplar_work
    ei.add_internal(w["work_dir"], w["eid"], [(_jpeg_file(tmp_path / "a.jpg"), _src("s1"))], "t")
    src = _manifest(w)["images"][0]["source"]
    assert src["stem"] == "s1" and src["upload_id"] == "u1" and src["kind"] == "former_pages"
    assert src["added_by"] == "t"


def test_add_internal_ei_dubleeri(exemplar_work, tmp_path):
    w = exemplar_work
    f = [(_jpeg_file(tmp_path / "a.jpg"), _src("s1")), (_jpeg_file(tmp_path / "b.jpg"), _src("s2", 2))]
    ei.add_internal(w["work_dir"], w["eid"], f, "t")
    ei.add_internal(w["work_dir"], w["eid"], f, "t")
    assert [i["source"]["stem"] for i in _manifest(w)["images"]] == ["s1", "s2"]


def test_former_pages_allikat_klient_ei_muuda(exemplar_work, tmp_path):
    w = exemplar_work
    m = ei.add_internal(w["work_dir"], w["eid"], [(_jpeg_file(tmp_path / "a.jpg"), _src("s1"))], "t")
    img = dict(m["images"][0])
    img["source"] = {"kind": "photo", "ref": "muu", "license": "CC0"}
    ei.patch_images(w["work_dir"], w["eid"], m["revision"], [img], "t")
    src = _manifest(w)["images"][0]["source"]
    assert src["kind"] == "former_pages" and src["stem"] == "s1" and src["license"] == "CC0"


def test_klient_ei_saa_former_pages_saata(exemplar_work):
    w = exemplar_work
    b = io.BytesIO()
    Image.new("RGB", (4, 4)).save(b, "JPEG")
    with pytest.raises(ei.ExemplarImagesError):
        ei.add_uploads(w["work_dir"], w["eid"], [(b.getvalue(), _src("s1"))], "t")


def test_remove_images_internal_ainult_valitud(exemplar_work, tmp_path):
    w = exemplar_work
    m = ei.add_internal(w["work_dir"], w["eid"], [(_jpeg_file(tmp_path / "a.jpg"), _src("s1")),
                                                  (_jpeg_file(tmp_path / "b.jpg"), _src("s2", 2))], "t")
    keep, drop = m["images"][0]["id"], m["images"][1]["id"]
    m2 = _manifest(w)
    m2["imports"] = {"imp1": {"kind": "ada", "ref": "x"}}
    ei.write_manifest_locked(w["work_dir"], w["eid"], m2, "t", "imports")
    assert ei.remove_images_internal(w["work_dir"], w["eid"], {drop}, "t") == 1
    after = _manifest(w)
    assert [i["id"] for i in after["images"]] == [keep]
    assert "imp1" in after["imports"]
    d = ei.exemplar_dir(w["work_dir"], w["eid"])
    assert not os.path.exists(os.path.join(d, f"{drop}.jpg"))
    assert os.path.exists(os.path.join(d, f"{keep}.jpg"))


def test_commit_torge_viskab(exemplar_work, tmp_path, monkeypatch):
    w = exemplar_work
    monkeypatch.setattr(ei, "write_manifest_locked", lambda *a, **k: False)
    with pytest.raises(ei.ExemplarImagesError):
        ei.add_internal(w["work_dir"], w["eid"], [(_jpeg_file(tmp_path / "a.jpg"), _src("s1"))], "t")


def test_kordus_commitib_kettal_oleva_manifesti(exemplar_work, tmp_path):
    """Manifest jõudis kettale, commit mitte → kordus commitib, ei dubleeri."""
    w = exemplar_work
    ei.add_internal(w["work_dir"], w["eid"], [(_jpeg_file(tmp_path / "a.jpg"), _src("s1"))], "t")
    path = ei.manifest_path(w["work_dir"], w["eid"])
    m = json.load(open(path))
    m["images"][0]["label"] = "kettal, commitimata"
    json.dump(m, open(path, "w"))
    ei.add_internal(w["work_dir"], w["eid"], [(_jpeg_file(tmp_path / "a.jpg"), _src("s1"))], "t")
    rel = os.path.relpath(path, str(w["data"]))
    assert w["repo"].git.status("--porcelain", "--", rel).strip() == ""
    assert len(_manifest(w)["images"]) == 1


def test_kordus_viib_orvud_failid_prugikasti(exemplar_work, tmp_path):
    """Katkestus pärast manifesti commit'i: ID manifestis enam pole, failid kaustas alles."""
    w = exemplar_work
    m = ei.add_internal(w["work_dir"], w["eid"], [(_jpeg_file(tmp_path / "a.jpg"), _src("s1"))], "t")
    iid = m["images"][0]["id"]
    m2 = {**m, "revision": m["revision"] + 1, "images": []}
    ei.write_manifest_locked(w["work_dir"], w["eid"], m2, "t", "eemaldus")
    d = ei.exemplar_dir(w["work_dir"], w["eid"])
    assert os.path.exists(os.path.join(d, f"{iid}.jpg"))
    ei.remove_images_internal(w["work_dir"], w["eid"], {iid}, "t")
    assert not os.path.exists(os.path.join(d, f"{iid}.jpg"))


def test_prugikasti_viimise_torge_viskab(exemplar_work, tmp_path, monkeypatch):
    w = exemplar_work
    m = ei.add_internal(w["work_dir"], w["eid"], [(_jpeg_file(tmp_path / "a.jpg"), _src("s1"))], "t")
    iid = m["images"][0]["id"]
    real = ei.shutil.move
    monkeypatch.setattr(ei.shutil, "move", lambda *a, **k: (_ for _ in ()).throw(OSError("ketas")))
    with pytest.raises(ei.ExemplarImagesError):
        ei.remove_images_internal(w["work_dir"], w["eid"], {iid}, "t")
    monkeypatch.setattr(ei.shutil, "move", real)
    ei.remove_images_internal(w["work_dir"], w["eid"], {iid}, "t")
    assert not os.path.exists(os.path.join(ei.exemplar_dir(w["work_dir"], w["eid"]), f"{iid}.jpg"))
