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


class _FakePollSftp:
    """Tagastab ainult valitud remote_txt-d (simuleerib OCR-i edenemist)."""
    def __init__(self, ready_txts):
        self.ready = dict(ready_txts)  # {txt_abs: text}
        self.removed = []
    def stat(self, path):
        if path in self.ready:
            return True
        raise FileNotFoundError(path)
    def getfo(self, path, buf):
        buf.write(self.ready[path].encode("utf-8"))
    def remove(self, path):
        self.removed.append(path)
    def rmdir(self, path):
        pass
    def close(self):
        pass


def test_poll_batch_mapping_on_autoriteetne_mitte_jarjekorra_pohine(tmp_path, monkeypatch):
    from server import reocr_ops
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(reocr_ops, "OCR_SERVER_PATH", "/srv")
    monkeypatch.setattr(reocr_ops, "close_ssh", lambda jid: None)
    work_dir = tmp_path / "teos"
    work_dir.mkdir()

    # Job: leht "esimene.jpg"→pg_001, "teine.jpg"→pg_002
    job_id = "JOB1"
    pages = reocr_ops._build_batch_pages("teos", [("esimene.jpg", 1), ("teine.jpg", 2)])
    for e in pages:
        e["status"] = "processing"
    reocr_ops._reocr_batch_jobs[job_id] = {
        "kind": "batch", "work_id": "w", "slug": "teos", "status": "processing",
        "started_at": 0, "finished_at": None, "last_progress_at": 0,
        "remote_work": "AUTO-OCR/print/JOB1/teos", "pages": pages,
    }

    # Ainult pg_002 valmis (teine.jpg sisu) — pg_001 veel pole
    monkeypatch.setattr(reocr_ops, "_sftp_open", lambda jid: _FakePollSftp(
        {"/srv/AUTO-OCR/print/JOB1/teos/teos_pg_002.txt": "TEISE LEHE TEKST"}))

    reocr_ops._poll_batch_job(job_id)

    # KRIITILINE: tulemus läks teine.jpg-le (kirje järgi), mitte esimese lehe .ocr-i
    assert (work_dir / "teine.ocr").read_text(encoding="utf-8") == "TEISE LEHE TEKST"
    assert not (work_dir / "esimene.ocr").exists()
    assert pages[1]["status"] == "ready" and pages[0]["status"] == "processing"
    assert reocr_ops._reocr_batch_jobs[job_id]["last_progress_at"] > 0
    del reocr_ops._reocr_batch_jobs[job_id]


def test_batch_inactive_ja_finalize():
    from server.reocr_ops import _batch_inactive, _finalize_batch_if_complete
    job = {"started_at": 0, "last_progress_at": 100, "status": "processing",
           "pages": [{"status": "ready"}, {"status": "error"}], "finished_at": None}
    assert _batch_inactive(job, now=100 + 1801, timeout=1800) is True
    assert _batch_inactive(job, now=100 + 10, timeout=1800) is False
    _finalize_batch_if_complete(job)
    assert job["status"] == "done" and job["finished_at"] is not None


def test_build_reocr_status_agregeerib(tmp_path, monkeypatch):
    from server import reocr_ops
    work_dir = tmp_path / "teos"
    work_dir.mkdir()
    (work_dir / "x.ocr").write_text("valmis", encoding="utf-8")  # ocr_ready stem
    (work_dir / "x.jpg").write_bytes(b"i")

    reocr_ops._reocr_batch_jobs["JB"] = {
        "kind": "batch", "work_id": "w", "slug": "teos", "status": "processing",
        "started_at": 0, "finished_at": None, "last_progress_at": 0,
        "remote_work": "r", "pages": [
            {"page_filename": "a.jpg", "status": "processing", "error": None},
            {"page_filename": "b.jpg", "status": "ready", "error": None},
            {"page_filename": "c.jpg", "status": "error", "error": "läks viltu"},
        ],
    }
    try:
        st = reocr_ops.build_reocr_status("w", str(work_dir))
        assert st["active"] == {"a.jpg": "processing"}
        assert st["errors"] == {"c.jpg": "läks viltu"}
        assert "x" in st["ocr_ready"]
        assert st["progress"] == {"total": 3, "ready": 1, "errors": 1, "active": True}
        # Teine teos → tühi/None progress
        st2 = reocr_ops.build_reocr_status("muu", str(work_dir))
        assert st2["active"] == {} and st2["progress"] is None
    finally:
        del reocr_ops._reocr_batch_jobs["JB"]


# =========================================================
# Endpointide testid (POST /reocr-batch, GET /reocr-status)
# Kasutatakse conftest.py fixture'id: backend_env, client, login
# =========================================================

def test_reocr_batch_validatsioon(backend_env, client, login, monkeypatch, tmp_path):
    """404 tundmatu teose korral, 400 tühja listi ja puuduva faili korral."""
    from server import reocr_ops
    from server.routers import reocr as reocr_router
    work = tmp_path / "1700-teos"
    work.mkdir()
    (work / "a.jpg").write_bytes(b"IMG")
    monkeypatch.setattr(reocr_router, "find_directory_by_id", lambda w: str(work) if w == "w1" else None)
    # Tühjendame globaalse batch-registri, et varasemad testid ei segaks
    reocr_ops._reocr_batch_jobs.clear()

    token = login("admin", "adminpass")
    h = {"Authorization": f"Bearer {token}"}

    # Tundmatu teos → 404
    r = client.post("/admin/work/zzz/reocr-batch", json={"page_filenames": ["a.jpg"]}, headers=h)
    assert r.status_code == 404, r.text

    # Tühi faililoend → 400
    r = client.post("/admin/work/w1/reocr-batch", json={"page_filenames": []}, headers=h)
    assert r.status_code == 400, r.text

    # Tundmatu fail → 400
    r = client.post("/admin/work/w1/reocr-batch", json={"page_filenames": ["puudub.jpg"]}, headers=h)
    assert r.status_code == 400, r.text


def test_reocr_batch_aktiivne_409(backend_env, client, login, monkeypatch, tmp_path):
    """409 kui sellel teosel käib juba aktiivne batch."""
    from server.routers import reocr as reocr_router
    work = tmp_path / "1700-teos"
    work.mkdir()
    (work / "a.jpg").write_bytes(b"IMG")
    monkeypatch.setattr(reocr_router, "find_directory_by_id", lambda w: str(work) if w == "w1" else None)
    # router kasutab otseimporti, seega patch router-moodulil
    monkeypatch.setattr(reocr_router, "get_active_batch_for_work", lambda wid: "jid-123")

    token = login("admin", "adminpass")
    h = {"Authorization": f"Bearer {token}"}
    r = client.post("/admin/work/w1/reocr-batch", json={"page_filenames": ["a.jpg"]}, headers=h)
    assert r.status_code == 409, r.text


def test_reocr_batch_auth_nouab_admini(backend_env, client):
    """Autentimata päring → 401."""
    r = client.post("/admin/work/w1/reocr-batch", json={"page_filenames": ["a.jpg"]})
    assert r.status_code == 401


def test_reocr_status_kuju(backend_env, client, login, monkeypatch, tmp_path):
    """GET reocr-status tagastab oodatud väljad: active, ocr_ready, errors, progress."""
    from server.routers import reocr as reocr_router
    work = tmp_path / "1700-teos"
    work.mkdir()
    monkeypatch.setattr(reocr_router, "find_directory_by_id", lambda w: str(work) if w == "w1" else None)

    token = login("admin", "adminpass")
    r = client.get("/admin/work/w1/reocr-status", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) >= {"active", "ocr_ready", "errors", "progress"}, body


def test_reocr_status_tundmatu_teos_404(backend_env, client, login, monkeypatch):
    """GET reocr-status tundmatu teose korral → 404."""
    from server.routers import reocr as reocr_router
    monkeypatch.setattr(reocr_router, "find_directory_by_id", lambda w: None)

    token = login("admin", "adminpass")
    r = client.get("/admin/work/zzz/reocr-status", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 404, r.text


def test_reocr_status_auth_nouab_admini(backend_env, client):
    """Autentimata GET reocr-status → 401."""
    r = client.get("/admin/work/w1/reocr-status")
    assert r.status_code == 401


def test_reocr_batch_lykkab_traversal_tagasi(backend_env, client, login, monkeypatch, tmp_path):
    """Path traversal failinimed tagasi lükatud."""
    from server import reocr_ops
    from server.routers import reocr as reocr_router
    work = tmp_path / "1700-teos"
    work.mkdir()
    (work / "a.jpg").write_bytes(b"IMG")
    monkeypatch.setattr(reocr_router, "find_directory_by_id", lambda w: str(work) if w == "w1" else None)
    reocr_ops._reocr_batch_jobs.clear()

    token = login("admin", "adminpass")
    h = {"Authorization": f"Bearer {token}"}
    r = client.post("/admin/work/w1/reocr-batch",
                    json={"page_filenames": ["../../state/users.json"]},
                    headers=h)
    assert r.status_code == 400


def test_poll_batch_write_vea_korral_remote_txt_ei_kustutata(tmp_path, monkeypatch):
    """Write-vea korral jääb remote .txt alles (andmekadu vältimiseks)."""
    from server import reocr_ops

    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(reocr_ops, "OCR_SERVER_PATH", "/srv")
    monkeypatch.setattr(reocr_ops, "close_ssh", lambda jid: None)
    work_dir = tmp_path / "teos"
    work_dir.mkdir()

    # Üks leht, mis on OCR-serveris valmis
    job_id = "JOBWRITE1"
    pages = reocr_ops._build_batch_pages("teos", [("a.jpg", 1)])
    for e in pages:
        e["status"] = "processing"
    reocr_ops._reocr_batch_jobs[job_id] = {
        "kind": "batch", "work_id": "w", "slug": "teos", "status": "processing",
        "started_at": 0, "finished_at": None, "last_progress_at": 0,
        "remote_staging": "AUTO-OCR/print/JOBWRITE1",
        "remote_work": "AUTO-OCR/print/JOBWRITE1/teos", "pages": pages,
    }

    txt_abs = "/srv/AUTO-OCR/print/JOBWRITE1/teos/teos_pg_001.txt"
    fake_sftp = _FakePollSftp({txt_abs: "OCR TEKST"})
    monkeypatch.setattr(reocr_ops, "_sftp_open", lambda jid: fake_sftp)

    # _write_ocr_file viskab erindi (nt ketas täis)
    def _failing_write(*a, **kw):
        raise OSError("disk full")
    monkeypatch.setattr(reocr_ops, "_write_ocr_file", _failing_write)

    reocr_ops._poll_batch_job(job_id)

    # Leht peab olema error-staatuses
    assert pages[0]["status"] == "error", f"oodati 'error', sain '{pages[0]['status']}'"
    # Remote .txt EI tohi olla kustutatud — see on ainuke koopia OCR tulemusest
    assert txt_abs not in fake_sftp.removed, (
        f"remote .txt kustutati write-vea korral — andmekadu! removed={fake_sftp.removed}")

    del reocr_ops._reocr_batch_jobs[job_id]
