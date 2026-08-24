"""Batch re-OCR lehe VIGA peab jõudma püsivasse logisse (#227 järelleid).

`_finalize_batch_if_complete` märkis töö ainult `done`-iks ega kutsunud kordagi
`_append_to_log`-i, seega batch-lehtedest ei jäänud `reocr_log.json`-i midagi.
Manage näitas põhjust kuni TTL-ini, Review mitte kunagi — vastuolus ADR 0018-ga
(„püsiv ajalugu elab Review-vaates").

ÕNNESTUMISI EI LOGITA: logi lagi on 500 kirjet ja 100-leheline batch pühiks
terve ajaloo. Vead on väike maht ja kogu väärtus.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.reocr_ops as reocr_ops


class _ErrSFTP:
    """.txt puudub, .err on olemas (OCR-server märkis lehe vigaseks)."""

    def __init__(self, err=b"mudel: KordusLoop: periood 1 sona, 21 kordust"):
        self.err = err
        self.removed = []

    def stat(self, path):
        if path.endswith(".err"):
            return None
        raise FileNotFoundError(path)

    def getfo(self, path, buf):
        buf.write(self.err)

    def remove(self, path):
        self.removed.append(path)

    def rmdir(self, path):
        pass

    def close(self):
        pass


@pytest.fixture(autouse=True)
def _puhas():
    with reocr_ops._reocr_batch_jobs_lock:
        reocr_ops._reocr_batch_jobs.clear()
    yield
    with reocr_ops._reocr_batch_jobs_lock:
        reocr_ops._reocr_batch_jobs.clear()


def _batch_job(**yle):
    job = {
        "status": "processing",
        "slug": "1651-teos",
        "work_id": "aqpuo8",
        "username": "admin",
        "remote_work": "AUTO-OCR/hand/b1/1651-teos",
        "remote_staging": "AUTO-OCR/hand/b1",
        "started_at": 100.0,
        "last_progress_at": 100.0,
        "pages": [
            {"page_filename": "1651-teos-aqpuo8-006.jpg", "page_number": 6,
             "remote_img_name": "1651-teos_pg_001.jpg",
             "remote_txt_name": "1651-teos_pg_001.txt",
             "status": "processing", "error": None},
        ],
    }
    job.update(yle)
    return job


def test_err_leht_laheb_logisse(monkeypatch):
    """Loopi põhjus peab jääma alles ka pärast töö mälust kadumist."""
    logitud = []
    monkeypatch.setattr(reocr_ops, "_sftp_open", lambda jid: _ErrSFTP())
    monkeypatch.setattr(reocr_ops, "close_ssh", lambda jid: None)
    monkeypatch.setattr(reocr_ops, "_append_to_log", lambda job, jid: logitud.append((jid, job)))
    monkeypatch.setattr(reocr_ops.reocr_state, "remove_batch_mapping", lambda jid: None)
    reocr_ops._reocr_batch_jobs["b1"] = _batch_job()

    reocr_ops._poll_batch_job("b1")

    assert len(logitud) == 1, "vigane leht peab logisse jõudma"
    jid, kirje = logitud[0]
    assert jid == "b1"
    assert kirje["status"] == "error"
    assert "KordusLoop" in kirje["error"]
    assert kirje["page_filename"] == "1651-teos-aqpuo8-006.jpg"
    assert kirje["page_number"] == 6
    assert kirje["work_id"] == "aqpuo8"
    assert kirje["slug"] == "1651-teos"


def test_onnestunud_leht_EI_lahe_logisse(monkeypatch):
    """Logi lagi on 500 kirjet — 100-leheline batch pühiks terve ajaloo."""
    class _OkSFTP(_ErrSFTP):
        def stat(self, path):
            if path.endswith(".txt"):
                return None
            raise FileNotFoundError(path)

        def getfo(self, path, buf):
            buf.write("Päris OCR tekst".encode("utf-8"))

    logitud = []
    monkeypatch.setattr(reocr_ops, "_sftp_open", lambda jid: _OkSFTP())
    monkeypatch.setattr(reocr_ops, "close_ssh", lambda jid: None)
    monkeypatch.setattr(reocr_ops, "_append_to_log", lambda job, jid: logitud.append(job))
    monkeypatch.setattr(reocr_ops, "_write_ocr_file", lambda *a, **kw: None)
    monkeypatch.setattr(reocr_ops.reocr_state, "remove_batch_mapping", lambda jid: None)
    reocr_ops._reocr_batch_jobs["b1"] = _batch_job()

    reocr_ops._poll_batch_job("b1")

    assert logitud == [], "õnnestumisi ei logita"


def test_aegumine_laheb_logisse(monkeypatch):
    """Absoluutse aja täitumisel jäävad lehed veaks — ka see põhjus peab säilima."""
    logitud = []
    monkeypatch.setattr(reocr_ops, "_poll_batch_job", lambda jid: None)
    monkeypatch.setattr(reocr_ops, "_append_to_log", lambda job, jid: logitud.append(job))
    monkeypatch.setattr(reocr_ops, "_persist_active_jobs", lambda: None)
    monkeypatch.setattr(reocr_ops, "_abs_timeout_reached", lambda job, now: True)
    reocr_ops._reocr_batch_jobs["b1"] = _batch_job()

    reocr_ops._batch_poll_iteration(99999.0)

    assert len(logitud) == 1
    assert logitud[0]["status"] == "error"
    assert "Aegumine" in logitud[0]["error"]
