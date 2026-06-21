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
