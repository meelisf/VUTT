"""Aluse vahetuse algus (PR 2, ADR 0089 p 6): asendusrežiimis üleslaadimine eksemplari piltidest."""
import io
import json
import os
from pathlib import Path

import pytest
from PIL import Image

from server import exemplar_images, promote, replace_marker, upload_ops
from server.upload import page_source, state as upload_state
from test_promote_eelvaade import _jpeg, teos  # noqa: F401  (fikstuur)


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    d = tmp_path / "uploads"
    d.mkdir(exist_ok=True)   # `client` (backend_env) võib selle juba luua
    monkeypatch.setattr(upload_ops, "UPLOADS_DIR", str(d))
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(d))
    return d


def _png() -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (6, 6), (1, 2, 3)).save(b, "PNG")
    return b.getvalue()


def _start(teos, **kw):
    pv = promote.preview(teos["work_dir"], "nnnnnn")
    args = dict(unknown_target="tttttt", confirmed_edited=pv["edited"], username="adm")
    args.update(kw)
    return promote.start(teos["work_dir"], "w1", "nnnnnn", **args)


def _state(uploads, uid):
    return json.loads((uploads / uid / "state.json").read_text(encoding="utf-8"))


def test_algus_kopeerib_pildid_jarjekorras(teos, uploads):
    exemplar_images.add_uploads(teos["work_dir"], "nnnnnn",
                                [(_jpeg(9, 9), {"kind": "photo"}), (_png(), {"kind": "photo"})], "t")
    uid = _start(teos)
    src = uploads / uid / "source"
    assert sorted(p.name for p in src.iterdir()) == ["pg_001.jpg", "pg_002.jpg", "pg_003.jpg"]
    st = _state(uploads, uid)
    assert st["status"] == "awaiting_split" and st["expected_pages"] == 3
    assert st["replace_work_id"] == "w1" and st["prepress"]
    ids = [i["id"] for i in exemplar_images.read_manifest(teos["work_dir"], "nnnnnn")["images"]]
    assert [s["image_id"] for s in st["promote"]["source_images"]] == ids
    assert [s["page"] for s in st["promote"]["source_images"]] == [1, 2, 3]
    assert st["promote"]["exemplar_id"] == "nnnnnn"


def test_eksemplari_failid_jaavad_alles(teos, uploads):
    exemplar_images.add_uploads(teos["work_dir"], "nnnnnn", [(_png(), {"kind": "photo"})], "t")
    enne = sorted(os.listdir(exemplar_images.exemplar_dir(teos["work_dir"], "nnnnnn")))
    _start(teos)
    assert sorted(os.listdir(exemplar_images.exemplar_dir(teos["work_dir"], "nnnnnn"))) == enne


def test_png_teisendatakse_jpegiks(teos, uploads):
    exemplar_images.add_uploads(teos["work_dir"], "nnnnnn", [(_png(), {"kind": "photo"})], "t")
    uid = _start(teos)
    for p in (uploads / uid / "source").iterdir():
        with Image.open(p) as im:
            assert im.format == "JPEG", p


def test_algus_teos_muutumata(teos, uploads):
    meta_enne = open(teos["meta_path"], encoding="utf-8").read()
    lehed_enne = sorted(os.listdir(teos["work_dir"]))
    _start(teos)
    assert open(teos["meta_path"], encoding="utf-8").read() == meta_enne
    assert sorted(os.listdir(teos["work_dir"])) == lehed_enne


def test_toimetatud_muutus_409(teos, uploads):
    with pytest.raises(promote.PromoteError) as e:
        _start(teos, confirmed_edited={"1640-test-w1-001": "vale"})
    assert e.value.status == 409 and e.value.code == "edited_pages_changed"
    assert not [p for p in uploads.iterdir() if not p.name.startswith(".")]


def test_teadmata_lehed_nouavad_sihti(teos, uploads):
    with pytest.raises(promote.PromoteError) as e:
        _start(teos, unknown_target=None)
    assert e.value.status == 400 and e.value.code == "unknown_target_required"


def test_siht_ainult_teadmata_lehtedele(teos, uploads):
    meta = json.load(open(teos["meta_path"], encoding="utf-8"))
    meta["exemplar_unknown_pages"] = []
    json.dump(meta, open(teos["meta_path"], "w", encoding="utf-8"))
    assert _start(teos, unknown_target=None)


def test_teine_pooleli_asendus_409(teos, uploads):
    _start(teos)
    with pytest.raises(promote.PromoteError) as e:
        _start(teos)
    assert e.value.status == 409 and e.value.code == "replace_in_progress"


def test_marki_korral_409(teos, uploads):
    replace_marker.write_marker(os.path.basename(teos["work_dir"]), "muu", {"phase": "replacing"})
    with pytest.raises(promote.PromoteError) as e:
        _start(teos)
    assert e.value.code == "replace_in_progress"


def test_salvestamatu_vana_leht_400(teos, uploads):
    Image.new("RGB", (12001, 4)).save(f"{teos['work_dir']}/1640-test-w1-003.jpg", "JPEG")
    with pytest.raises(promote.PromoteError) as e:
        _start(teos)
    assert e.value.status == 400 and e.value.code == "old_page_unstorable"


def test_vea_korral_uleslaadimine_koristatakse(teos, uploads, monkeypatch):
    monkeypatch.setattr(upload_ops, "write_source_image",
                        lambda *a, **k: (_ for _ in ()).throw(ValueError("katki")))
    with pytest.raises(Exception):
        _start(teos)
    assert not [p for p in uploads.iterdir() if p.name != ".staging"]
    assert not list((uploads / ".staging").iterdir()) if (uploads / ".staging").exists() else True


def test_kaivitus_koristab_staging_kausta_ja_uus_algus_onnestub(teos, uploads):
    pooleli = uploads / ".staging" / "abc123"
    (pooleli / "source").mkdir(parents=True)
    (pooleli / "state.json").write_text("{}", encoding="utf-8")
    promote.cleanup_staging()
    assert not pooleli.exists()
    assert _start(teos)


def test_staging_ei_ole_loendis(teos, uploads):
    (uploads / ".staging" / "abc123").mkdir(parents=True)
    uid = _start(teos)
    assert [s["id"] for s in upload_ops.list_uploads()] == [uid]


def test_status_kannab_promote_i(teos, uploads):
    from server.upload import thumbs
    uid = _start(teos)
    st = _state(uploads, uid)
    p = thumbs._payload(st, uid, st["status"], st["expected_pages"])
    assert p["promote"]["exemplar_id"] == "nnnnnn" and p["promote"]["holder"] == "TÜR"


def test_promote_tool_files_ja_chunk_409(client, login, teos, uploads):
    uid = _start(teos)
    token = login("admin", "adminpass")
    h = {"Authorization": f"Bearer {token}", "X-Page-Number": "1", "X-Total-Pages": "1"}
    assert client.post(f"/admin/upload/{uid}/files", content=b"x", headers=h).status_code == 409
    assert client.post(f"/admin/upload/{uid}/chunk", content=b"x", headers=h).status_code == 409
    assert client.post(f"/admin/upload/{uid}/ada-fetch", headers=h).status_code == 409


def test_ule_999_pildi_numbriline_jarjestus(tmp_path):
    d = tmp_path / "src"
    d.mkdir()
    for n in (1, 101, 999, 1000, 1001):
        Image.new("RGB", (2, 2)).save(str(d / f"pg_{n:03d}.jpg"), "JPEG")
    src = page_source.ImageDirPageSource(str(d))
    assert [os.path.basename(src.source_file(i)) for i in range(1, 6)] == [
        "pg_001.jpg", "pg_101.jpg", "pg_999.jpg", "pg_1000.jpg", "pg_1001.jpg"]
