"""
Testid reocr_ops.poll_reocr_job jaoks (üksiku lehe re-OCR staatuse pollimine).

poll_reocr_job on varem katmata (test_reocr_batch.py katab ainult batch-voolu).
Siin kaetud:
- tundmatu job_id → not_found;
- varajane tagastamine (uploading/done/error) ilma SFTP-ta;
- processing + TXT veel pole valmis → processing, text None;
- processing + TXT valmis → done, tekst allalaaditud, .ocr kirjutatud, cleanup käidud.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.reocr_ops as reocr_ops


class _FakeSFTP:
    """Minimaalne SFTP-mock poll_reocr_job jaoks."""

    def __init__(self, *, txt_ready: bool, txt_content: bytes = b"OCR tekst"):
        self.txt_ready = txt_ready
        self.txt_content = txt_content
        self.removed = []
        self.rmdired = []
        self.closed = False

    def stat(self, path):
        if not self.txt_ready:
            raise FileNotFoundError(path)
        # olemas — ei viska erandit
        return None

    def getfo(self, path, buf):
        buf.write(self.txt_content)

    def remove(self, path):
        self.removed.append(path)

    def rmdir(self, path):
        self.rmdired.append(path)

    def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def _clean_jobs():
    """Tühjenda _reocr_jobs iga testi eel/järel."""
    with reocr_ops._reocr_jobs_lock:
        reocr_ops._reocr_jobs.clear()
    yield
    with reocr_ops._reocr_jobs_lock:
        reocr_ops._reocr_jobs.clear()


def _make_job(status="processing", **overrides):
    job = {
        "status": status,
        "text": None,
        "error": None,
        "slug": "1690-w1",
        "page_filename": "1690-w1-abc-001.txt",
        "remote_staging": "AUTO-OCR/print/j1/staging",
        "remote_work": "AUTO-OCR/print/j1/work",
        "remote_img": "AUTO-OCR/print/j1/img.jpg",
        "remote_txt": "AUTO-OCR/print/j1/out.txt",
    }
    job.update(overrides)
    return job


def test_poll_not_found():
    assert reocr_ops.poll_reocr_job("olematu") == {"status": "not_found"}


@pytest.mark.parametrize("status", ["uploading", "done", "error"])
def test_poll_early_return_without_sftp(monkeypatch, status):
    """uploading/done/error staatuses SFTP-d ei avata."""
    called = {"sftp": False}

    def _boom(*a, **kw):
        called["sftp"] = True
        raise AssertionError("SFTP ei tohiks avada")

    monkeypatch.setattr(reocr_ops, "_sftp_open", _boom)
    reocr_ops._reocr_jobs["j1"] = _make_job(status=status, text="x", error=None)

    res = reocr_ops.poll_reocr_job("j1")
    assert res["status"] == status
    assert called["sftp"] is False


def test_poll_processing_txt_not_ready(monkeypatch):
    """TXT veel pole OCR serveris valmis → processing, text None."""
    sftp = _FakeSFTP(txt_ready=False)
    # Esimene _sftp_open otsib TXT-d; teine (cleanup) ei tohigi käivuda
    monkeypatch.setattr(reocr_ops, "_sftp_open", lambda jid: sftp)
    reocr_ops._reocr_jobs["j1"] = _make_job(status="processing")

    res = reocr_ops.poll_reocr_job("j1")
    assert res == {"status": "processing", "text": None, "error": None}
    assert sftp.closed is True
    # Job staatus ei muutunud
    assert reocr_ops._reocr_jobs["j1"]["status"] == "processing"


def test_poll_processing_txt_ready_done(monkeypatch):
    """TXT on valmis → done, tekst dekodeeritud, .ocr kirjutatud, SSH suletud."""
    sftp = _FakeSFTP(txt_ready=True, txt_content="Töötlenud OCR tekst".encode("utf-8"))
    monkeypatch.setattr(reocr_ops, "_sftp_open", lambda jid: sftp)

    closed = {"ssh": False}
    monkeypatch.setattr(reocr_ops, "close_ssh", lambda jid: closed.__setitem__("ssh", True))

    written = {}
    monkeypatch.setattr(reocr_ops, "_write_ocr_file",
                        lambda slug, page_fn, text, job_id: written.setdefault("call", (slug, page_fn, text)))
    monkeypatch.setattr(reocr_ops, "_append_to_log", lambda job, jid: None)

    reocr_ops._reocr_jobs["j1"] = _make_job(status="processing")

    res = reocr_ops.poll_reocr_job("j1")

    assert res["status"] == "done"
    assert res["text"] == "Töötlenud OCR tekst"
    assert written["call"][0] == "1690-w1"
    assert written["call"][2] == "Töötlenud OCR tekst"
    assert closed["ssh"] is True
    # Job siseolek uuendatud
    assert reocr_ops._reocr_jobs["j1"]["status"] == "done"
    assert reocr_ops._reocr_jobs["j1"]["text"] == "Töötlenud OCR tekst"
    # Cleanup: TXT + IMG eemaldatud, work + staging kaustad eemaldatud
    assert any("out.txt" in p for p in sftp.removed)
    assert any("img.jpg" in p for p in sftp.removed)
    assert len(sftp.rmdired) == 2  # work + staging


def test_poll_processing_ready_ei_kirjuta_timeout_errorit_yle(monkeypatch):
    """Kui teine thread jõudis töö erroriks märkida, ei tohi poll hiljem done'iks üle kirjutada."""
    first = _FakeSFTP(txt_ready=True, txt_content=b"hilinenud tekst")
    cleanup = _FakeSFTP(txt_ready=True)

    def _open(jid):
        if not hasattr(_open, "called"):
            _open.called = True
            return first
        return cleanup

    def _race_remove(_path):
        with reocr_ops._reocr_jobs_lock:
            reocr_ops._reocr_jobs["j1"]["status"] = "error"
            reocr_ops._reocr_jobs["j1"]["error"] = "timeout"

    cleanup.remove = _race_remove
    monkeypatch.setattr(reocr_ops, "_sftp_open", _open)
    monkeypatch.setattr(reocr_ops, "close_ssh", lambda jid: None)
    monkeypatch.setattr(reocr_ops, "_write_ocr_file",
                        lambda *a, **kw: pytest.fail("erroriks märgitud tööd ei tohi .ocr-iks kirjutada"))
    monkeypatch.setattr(reocr_ops, "_append_to_log",
                        lambda *a, **kw: pytest.fail("erroriks märgitud tööd ei tohi done-logida"))

    reocr_ops._reocr_jobs["j1"] = _make_job(status="processing")

    res = reocr_ops.poll_reocr_job("j1")
    assert res == {"status": "error", "text": None, "error": "timeout"}
    assert reocr_ops._reocr_jobs["j1"]["status"] == "error"


def test_poll_processing_no_page_filename_skips_ocr_write(monkeypatch):
    """Kui page_filename puudub, .ocr faili ei kirjutata (aga done siiski)."""
    sftp = _FakeSFTP(txt_ready=True)
    monkeypatch.setattr(reocr_ops, "_sftp_open", lambda jid: sftp)
    monkeypatch.setattr(reocr_ops, "close_ssh", lambda jid: None)
    monkeypatch.setattr(reocr_ops, "_write_ocr_file",
                        lambda *a, **kw: pytest.fail(".ocr ei tohiks kirjutada"))
    monkeypatch.setattr(reocr_ops, "_append_to_log", lambda job, jid: None)

    reocr_ops._reocr_jobs["j1"] = _make_job(status="processing", page_filename="")

    res = reocr_ops.poll_reocr_job("j1")
    assert res["status"] == "done"
