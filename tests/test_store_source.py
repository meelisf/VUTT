"""Lähtefail jääb VUTT-i poolele, kuni admin on sammu 3 läbinud."""
import os

import pytest
from PIL import Image

from server.upload import store_source
from server.upload import state as upload_state


@pytest.fixture
def upload(tmp_path, monkeypatch):
    uid = "u1"
    base = tmp_path / uid
    base.mkdir(parents=True)
    monkeypatch.setattr(upload_state, "upload_dir", lambda i: str(base))
    monkeypatch.setattr(store_source.upload_state, "upload_dir", lambda i: str(base))
    upload_state.write_state(uid, {
        "id": uid, "status": "pending", "files": [],
        "meta": {"slug": "kirik-abc"},
        "remote_staging_path": "AUTO-OCR/print/u1",
        "remote_work_path": "AUTO-OCR/print/u1/kirik-abc",
    })
    return uid, base


def test_pdf_salvestatakse_lokaalselt_ja_ei_saadeta_kohe(upload, monkeypatch):
    uid, base = upload
    src = base / "incoming.pdf"
    src.write_bytes(b"%PDF-1.4\n")
    monkeypatch.setattr(store_source.file_detection, "detect_file_type", lambda p: "pdf")
    monkeypatch.setattr(store_source.file_detection, "count_pdf_pages", lambda p: 12)
    sent = []
    monkeypatch.setattr(store_source, "transfer_stored_source", lambda i: sent.append(i))

    pages = store_source.store_pdf(uid, str(src))

    assert pages == 12
    assert (base / "source.pdf").is_file()
    assert sent == []                                  # MIDAGI ei saadetud
    state = upload_state.read_state(uid)
    assert state["status"] == "awaiting_split"
    assert state["expected_pages"] == 12
    assert len(state["prepress"]["pages"]) == 12
    assert state["prepress"]["enabled"] is False       # opt-in


def test_pdf_salvestamine_kustutab_ajutise_faili(upload, monkeypatch):
    uid, base = upload
    src = base / "incoming.pdf"
    src.write_bytes(b"%PDF-1.4\n")
    monkeypatch.setattr(store_source.file_detection, "detect_file_type", lambda p: "pdf")
    monkeypatch.setattr(store_source.file_detection, "count_pdf_pages", lambda p: 3)
    store_source.store_pdf(uid, str(src))
    assert not src.exists()


def test_toetamata_formaat_toustab_valueerrori(upload, monkeypatch):
    uid, base = upload
    src = base / "x.bin"
    src.write_bytes(b"\x00\x01")
    monkeypatch.setattr(store_source.file_detection, "detect_file_type", lambda p: "unknown")
    with pytest.raises(ValueError, match="Toetamata"):
        store_source.store_pdf(uid, str(src))


def test_pildilehed_kogunevad_source_kausta(upload, monkeypatch):
    uid, base = upload
    monkeypatch.setattr(
        store_source.file_detection, "validate_upload_image", lambda p: (100, 200)
    )
    monkeypatch.setattr(store_source.file_detection, "detect_file_type", lambda p: "jpeg")
    for n in (1, 2, 3):
        tmp = base / "in_{}.jpg".format(n)
        Image.new("RGB", (100, 200), "white").save(tmp, "JPEG")
        store_source.store_image_page(uid, str(tmp), n, 3)

    files = sorted(os.listdir(str(base / "source")))
    assert files == ["pg_001.jpg", "pg_002.jpg", "pg_003.jpg"]
    state = upload_state.read_state(uid)
    assert state["status"] == "awaiting_split"          # viimane leht → valmis
    assert len(state["prepress"]["pages"]) == 3


def test_pildilehed_jaavad_kogumisolekusse_kuni_viimaseni(upload, monkeypatch):
    uid, base = upload
    monkeypatch.setattr(
        store_source.file_detection, "validate_upload_image", lambda p: (100, 200)
    )
    monkeypatch.setattr(store_source.file_detection, "detect_file_type", lambda p: "jpeg")
    tmp = base / "in_1.jpg"
    Image.new("RGB", (100, 200), "white").save(tmp, "JPEG")
    store_source.store_image_page(uid, str(tmp), 1, 3)
    assert upload_state.read_state(uid)["status"] == "collecting_images"


def test_png_konverteeritakse_jpeg_iks(upload, monkeypatch):
    uid, base = upload
    monkeypatch.setattr(
        store_source.file_detection, "validate_upload_image", lambda p: (100, 200)
    )
    monkeypatch.setattr(store_source.file_detection, "detect_file_type", lambda p: "png")
    tmp = base / "in.png"
    Image.new("RGB", (100, 200), "white").save(tmp, "PNG")
    store_source.store_image_page(uid, str(tmp), 1, 1)
    with Image.open(str(base / "source" / "pg_001.jpg")) as im:
        assert im.format == "JPEG"
