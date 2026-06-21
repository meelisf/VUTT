"""Batch re-OCR backend testid — puhas loogika, ilma päris OCR-serverita."""
import os
import pytest


def test_write_ocr_file_kirjutab_stem_ocr(tmp_path, monkeypatch):
    from server import reocr_ops
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    work_dir = tmp_path / "1700-teos"
    work_dir.mkdir()

    path = reocr_ops._write_ocr_file("1700-teos", "1700-teos-pg005.jpg", "Tekst siin.")

    assert path == str(work_dir / "1700-teos-pg005.ocr")
    assert (work_dir / "1700-teos-pg005.ocr").read_text(encoding="utf-8") == "Tekst siin."


def test_build_batch_pages_autoriteetne_mapping():
    from server.reocr_ops import _build_batch_pages
    pages = [("a-pg010.jpg", 10), ("b-pg002.png", 2), ("c-pg100.jpg", 100)]
    out = _build_batch_pages("teos", pages)

    assert [e["remote_img_name"] for e in out] == [
        "teos_pg_001.jpg", "teos_pg_002.png", "teos_pg_003.jpg"]
    assert [e["remote_txt_name"] for e in out] == [
        "teos_pg_001.txt", "teos_pg_002.txt", "teos_pg_003.txt"]
    # Kriitiline: iga kirje seob remote-nime ALGSE page_filename-iga
    assert out[1]["page_filename"] == "b-pg002.png"
    assert out[1]["stem"] == "b-pg002"
    assert out[0]["page_number"] == 10
    assert all(e["status"] == "uploading" and e["error"] is None for e in out)
