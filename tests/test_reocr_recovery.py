"""Reconciliation-reaper: taastab OCR-staging'usse orvuks jäänud üksik-lehe tulemused."""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server.reocr_ops as reocr_ops
import server.reocr_recovery as rec


class _FakeSftp:
    """Mockib OCR-serveri staging'ut. tree: {abs_dir: [names]}, files: {abs_path: bytes}.
    Käitub realistlikult: remove/rmdir muteerivad olekut, et listdir peegeldaks kustutusi."""
    def __init__(self, tree, files):
        self.tree = tree
        self.files = files
        self.removed = []
        self.rmdired = []
    def listdir(self, path):
        if path in self.tree:
            return list(self.tree[path])
        raise FileNotFoundError(path)
    def stat(self, path):
        if path in self.files or path in self.tree:
            return None
        raise FileNotFoundError(path)
    def getfo(self, path, buf):
        buf.write(self.files[path])
    def remove(self, path):
        self.removed.append(path)
        self.files.pop(path, None)
        parent, base = os.path.split(path)
        if parent in self.tree and base in self.tree[parent]:
            self.tree[parent].remove(base)
    def rmdir(self, path):
        self.rmdired.append(path)
        self.tree.pop(path, None)
        parent, base = os.path.split(path)
        if parent in self.tree and base in self.tree[parent]:
            self.tree[parent].remove(base)
    def close(self):
        pass


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setattr(reocr_ops, "OCR_SERVER_PATH", "/OCR")
    monkeypatch.setattr(rec, "OCR_SERVER_PATH", "/OCR")
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(reocr_ops, "REOCR_LOG_FILE", str(tmp_path / "reocr_log.json"))
    import server.reocr_state as st
    monkeypatch.setattr(st, "REOCR_ACTIVE_FILE", str(tmp_path / "reocr_active.json"))
    monkeypatch.setattr(st, "BATCH_MAPS_DIR", str(tmp_path / "reocr_batch_maps"))
    (tmp_path / "w1").mkdir()
    with reocr_ops._reocr_jobs_lock:
        reocr_ops._reocr_jobs.clear()
    rec._recovering.clear()
    rec._warned_skips.clear()
    yield
    with reocr_ops._reocr_jobs_lock:
        reocr_ops._reocr_jobs.clear()


def _staging_with_result(text=b"Taastatud tekst"):
    tree = {
        "/OCR/AUTO-OCR/print": ["orb"],
        "/OCR/AUTO-OCR/hand": [],
        "/OCR/AUTO-OCR/print/orb": ["w1"],
    }
    files = {"/OCR/AUTO-OCR/print/orb/w1/w1_pg_001.txt": text}
    return tree, files


def test_recovers_orphan_from_log(monkeypatch):
    reocr_ops._append_to_log(
        {"work_id": "wid", "slug": "w1", "page_filename": "w1-lk-007.jpg",
         "page_number": 7, "username": "u", "status": "error",
         "error": "Aegumine", "started_at": 1.0, "finished_at": 2.0}, "orb")
    tree, files = _staging_with_result()
    monkeypatch.setattr(rec.reocr_ops, "_sftp_open", lambda cid: _FakeSftp(tree, files))
    monkeypatch.setattr(rec.reocr_ops, "close_ssh", lambda cid: None)

    result = rec.scan_and_recover()

    assert result["recovered"] == ["orb"]
    ocr_file = Path(reocr_ops.BASE_DIR) / "w1" / "w1-lk-007.ocr"
    assert ocr_file.read_text(encoding="utf-8") == "Taastatud tekst"
    entries = reocr_ops.get_reocr_log(0, 100)["entries"]
    assert any(e.get("recovered") and e["job_id"] == "orb" for e in entries)


def test_skips_active_job(monkeypatch):
    reocr_ops._reocr_jobs["orb"] = {"status": "processing", "slug": "w1",
                                    "page_filename": "w1-lk-007.jpg"}
    tree, files = _staging_with_result()
    sftp = _FakeSftp(tree, files)
    monkeypatch.setattr(rec.reocr_ops, "_sftp_open", lambda cid: sftp)
    monkeypatch.setattr(rec.reocr_ops, "close_ssh", lambda cid: None)

    result = rec.scan_and_recover()

    assert result["recovered"] == []
    assert sftp.removed == []


@pytest.mark.parametrize("active_status", ["uploading", "processing"])
def test_skips_active_uploading_or_processing(monkeypatch, active_status):
    reocr_ops._reocr_jobs["orb"] = {"status": active_status, "slug": "w1",
                                    "page_filename": "w1-lk-007.jpg"}
    tree, files = _staging_with_result()
    monkeypatch.setattr(rec.reocr_ops, "_sftp_open", lambda cid: _FakeSftp(tree, files))
    monkeypatch.setattr(rec.reocr_ops, "close_ssh", lambda cid: None)
    assert rec.scan_and_recover()["recovered"] == []


def test_skips_unmapped_orphan(monkeypatch):
    tree, files = _staging_with_result()
    monkeypatch.setattr(rec.reocr_ops, "_sftp_open", lambda cid: _FakeSftp(tree, files))
    monkeypatch.setattr(rec.reocr_ops, "close_ssh", lambda cid: None)
    result = rec.scan_and_recover()
    assert result["recovered"] == []
    assert result["skipped"] == ["orb"]


def test_idempotent_when_claimed(monkeypatch):
    reocr_ops._append_to_log(
        {"work_id": "wid", "slug": "w1", "page_filename": "w1-lk-007.jpg",
         "status": "error", "started_at": 1.0, "finished_at": 2.0}, "orb")
    rec._recovering.add("orb")
    tree, files = _staging_with_result()
    sftp = _FakeSftp(tree, files)
    monkeypatch.setattr(rec.reocr_ops, "_sftp_open", lambda cid: sftp)
    monkeypatch.setattr(rec.reocr_ops, "close_ssh", lambda cid: None)
    result = rec.scan_and_recover()
    assert result["recovered"] == []
    assert sftp.removed == []


def test_startup_loads_active_before_recovery(monkeypatch, tmp_path):
    """load_active_jobs täidab _reocr_jobs ENNE scan_and_recover-it → aktiivset ei orvustata."""
    import server.reocr_state as st
    import server.reocr_ops as r
    monkeypatch.setattr(r, "UPLOAD_ENABLED", True)
    monkeypatch.setattr(st, "REOCR_ACTIVE_FILE", str(tmp_path / "reocr_active.json"))
    st.persist_active_jobs({"orb": {"status": "processing", "slug": "w1",
                                    "page_filename": "w1-lk-007.jpg"}})
    seen_active = {}

    def _fake_scan():
        seen_active["orb_in_jobs"] = "orb" in r._reocr_jobs
        return {"recovered": [], "skipped": []}

    monkeypatch.setattr(rec, "scan_and_recover", _fake_scan)
    monkeypatch.setattr(rec, "start_reaper_loop", lambda: None)
    with r._reocr_jobs_lock:
        r._reocr_jobs.clear()

    r.start_reocr_background()

    assert seen_active["orb_in_jobs"] is True
    with r._reocr_jobs_lock:
        r._reocr_jobs.clear()


def test_startup_revives_dead_uploading_jobs(monkeypatch, tmp_path):
    """Restardil laetud 'uploading' töö (surnud upload-thread) teisendatakse 'processing'-uks,
    et absoluutne sanity-lagi seda kataks (muidu igavene zombie)."""
    import server.reocr_state as st
    import server.reocr_ops as r
    monkeypatch.setattr(r, "UPLOAD_ENABLED", True)
    monkeypatch.setattr(st, "REOCR_ACTIVE_FILE", str(tmp_path / "reocr_active.json"))
    st.persist_active_jobs({
        "zombie": {"status": "uploading", "slug": "w1", "page_filename": "w1-lk-1.jpg"},
        "alive": {"status": "processing", "slug": "w2", "page_filename": "w2-lk-2.jpg"},
    })
    monkeypatch.setattr(rec, "scan_and_recover", lambda: {"recovered": [], "skipped": []})
    monkeypatch.setattr(rec, "start_reaper_loop", lambda: None)
    with r._reocr_jobs_lock:
        r._reocr_jobs.clear()

    r.start_reocr_background()

    with r._reocr_jobs_lock:
        assert r._reocr_jobs["zombie"]["status"] == "processing"   # teisendatud
        assert r._reocr_jobs["alive"]["status"] == "processing"    # muutumatu
        r._reocr_jobs.clear()


def test_revive_dead_uploads_counts_only_uploading():
    import server.reocr_ops as r
    jobs = {"a": {"status": "uploading"}, "b": {"status": "processing"}, "c": {"status": "uploading"}}
    assert r._revive_dead_uploads(jobs) == 2
    assert jobs["a"]["status"] == "processing"
    assert jobs["b"]["status"] == "processing"


def test_resolve_job_meta_includes_page_number(monkeypatch, tmp_path):
    reocr_ops._append_to_log(
        {"work_id": "wid", "slug": "w1", "page_filename": "w1-lk-7.jpg",
         "page_number": 7, "status": "error", "started_at": 1.0, "finished_at": 2.0}, "j1")
    meta = rec._resolve_job_meta("j1")
    assert meta["page_filename"] == "w1-lk-7.jpg"
    assert meta["page_number"] == 7


def test_batch_orphan_recovered_via_mapping(monkeypatch, tmp_path):
    import server.reocr_state as st
    monkeypatch.setattr(st, "BATCH_MAPS_DIR", str(tmp_path / "maps"))
    st.persist_batch_mapping("borb", "wid", "w1", {
        "w1_pg_001.txt": {"page_filename": "w1-lk-1.jpg", "page_number": 1},
        "w1_pg_002.txt": {"page_filename": "w1-lk-2.jpg", "page_number": 2},
    })
    tree = {"/OCR/AUTO-OCR/print": ["borb"], "/OCR/AUTO-OCR/hand": [],
            "/OCR/AUTO-OCR/print/borb": ["w1"],
            "/OCR/AUTO-OCR/print/borb/w1": ["w1_pg_001.txt", "w1_pg_002.txt"]}
    files = {"/OCR/AUTO-OCR/print/borb/w1/w1_pg_001.txt": b"tekst1",
             "/OCR/AUTO-OCR/print/borb/w1/w1_pg_002.txt": b"tekst2"}
    monkeypatch.setattr(rec.reocr_ops, "_sftp_open", lambda cid: _FakeSftp(tree, files))
    monkeypatch.setattr(rec.reocr_ops, "close_ssh", lambda cid: None)
    with reocr_ops._reocr_jobs_lock:
        reocr_ops._reocr_jobs.clear()
    rec._recovering.clear()

    result = rec.scan_and_recover()

    assert "borb" in result["recovered"]
    assert (tmp_path / "w1" / "w1-lk-1.ocr").read_text(encoding="utf-8") == "tekst1"
    assert (tmp_path / "w1" / "w1-lk-2.ocr").read_text(encoding="utf-8") == "tekst2"
    # Logi recovery-kirjed page_number-iga
    entries = reocr_ops.get_reocr_log(0, 100)["entries"]
    recs = [e for e in entries if e.get("recovered")]
    assert {e["page_number"] for e in recs} == {1, 2}
    # Mapping kustutatud pärast taastet
    assert st.load_batch_mapping("borb") is None


def test_reaper_skips_live_batch_job(monkeypatch, tmp_path):
    import server.reocr_state as st
    monkeypatch.setattr(st, "BATCH_MAPS_DIR", str(tmp_path / "maps"))
    st.persist_batch_mapping("borb", "wid", "w1", {
        "w1_pg_001.txt": {"page_filename": "w1-lk-1.jpg", "page_number": 1}})
    tree = {"/OCR/AUTO-OCR/print": ["borb"], "/OCR/AUTO-OCR/hand": [],
            "/OCR/AUTO-OCR/print/borb": ["w1"],
            "/OCR/AUTO-OCR/print/borb/w1": ["w1_pg_001.txt"]}
    sftp = _FakeSftp(tree, {"/OCR/AUTO-OCR/print/borb/w1/w1_pg_001.txt": b"x"})
    monkeypatch.setattr(rec.reocr_ops, "_sftp_open", lambda cid: sftp)
    monkeypatch.setattr(rec.reocr_ops, "close_ssh", lambda cid: None)
    with reocr_ops._reocr_batch_jobs_lock:
        reocr_ops._reocr_batch_jobs.clear()
        reocr_ops._reocr_batch_jobs["borb"] = {"status": "processing", "kind": "batch"}
    rec._recovering.clear()

    result = rec.scan_and_recover()

    assert result["recovered"] == []
    assert sftp.removed == []
    with reocr_ops._reocr_batch_jobs_lock:
        reocr_ops._reocr_batch_jobs.clear()
