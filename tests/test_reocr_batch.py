"""Batch re-OCR backend testid — puhas loogika, ilma päris OCR-serverita."""
import os
import pytest
import threading
import time as _time


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


class _FakeSftp:
    def __init__(self, store):
        self.store = store  # {remote_abs: bytes}
        self.made_dirs = []
    def stat(self, path):
        if path in self.made_dirs:
            return True
        raise FileNotFoundError(path)
    def mkdir(self, path):
        self.made_dirs.append(path)
    def put(self, local, remote):
        with open(local, "rb") as f:
            self.store[remote] = f.read()
    def close(self):
        pass


def _wait_status(job, target, timeout=2.0):
    end = _time.time() + timeout
    while _time.time() < end:
        if job["status"] == target:
            return True
        _time.sleep(0.02)
    return False


def test_start_reocr_batch_loob_registri_ja_laeb_pildid(tmp_path, monkeypatch):
    from server import reocr_ops
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    work_dir = tmp_path / "1700-teos"
    work_dir.mkdir()
    (work_dir / "a.jpg").write_bytes(b"IMG-A")
    (work_dir / "b.jpg").write_bytes(b"IMG-B")

    store = {}
    monkeypatch.setattr(reocr_ops, "_sftp_open", lambda jid: _FakeSftp(store))
    monkeypatch.setattr(reocr_ops, "OCR_SERVER_PATH", "/srv")

    job_id = reocr_ops.start_reocr_batch(
        "w1", "1700-teos", str(work_dir),
        [("a.jpg", 1), ("b.jpg", 2)], material_type="print", username="admin")

    job = reocr_ops._reocr_batch_jobs[job_id]
    assert _wait_status(job, "processing")
    assert job["kind"] == "batch" and job["material_type"] == "print"
    assert len(job["pages"]) == 2
    # Pildid laeti remote staging'usse, originaalid alles
    assert (work_dir / "a.jpg").exists()
    assert store["/srv/AUTO-OCR/print/%s/1700-teos/1700-teos_pg_001.jpg" % job_id] == b"IMG-A"
    # Aktiivse batchi otsing
    assert reocr_ops.get_active_batch_for_work("w1") == job_id
    assert reocr_ops.get_active_batch_for_work("w2") is None
