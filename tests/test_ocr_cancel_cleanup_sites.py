"""Katkestamise kolm kaugkoristuse kohta ei tohi kataloogi kustutada (#225).

`rm -rf`/`rmdir` lennusoleva batchi alt kukutab OCR-teenuse. Kõik kutsekohad
peavad kasutama cleanup_run_files'i ja jätma kataloogi ocr_reaper'i hooleks.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import ocr_reaper, reocr_ops, reocr_recovery, upload_ops
from server.upload import state as upload_state


class FakeSftp:
    def __init__(self, tree=None):
        self.tree = dict(tree or {})
        self.removed = []
        self.rmdirs = []
        self.closed = False

    def listdir(self, path):
        if path not in self.tree:
            raise FileNotFoundError(path)
        return list(self.tree[path])

    def remove(self, path):
        self.removed.append(path)

    def rmdir(self, path):
        self.rmdirs.append(path)

    def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def reaps_fail(tmp_path, monkeypatch):
    """Reaper-nimekiri läheb tmp_path'i, mitte päris state/-i."""
    monkeypatch.setattr(ocr_reaper, "OCR_RUN_REAPS_FILE", str(tmp_path / "reaps.json"))


# =========================================================
# re-OCR katkestamine
# =========================================================

def test_reocr_koristus_kustutab_failid_ja_ajastab_kataloogid(monkeypatch):
    base = reocr_ops.OCR_SERVER_PATH
    sftp = FakeSftp({f"{base}/AUTO-OCR/print/job1/teos": ["a.jpg", "a.txt"]})
    monkeypatch.setattr(reocr_ops, "_sftp_open", lambda jid: sftp)
    monkeypatch.setattr(reocr_ops, "close_ssh", lambda jid: None)

    ok = reocr_ops._cleanup_remote_job("job1", {
        "remote_work": "AUTO-OCR/print/job1/teos",
        "remote_staging": "AUTO-OCR/print/job1",
    })

    assert ok is True
    assert sorted(sftp.removed) == [
        f"{base}/AUTO-OCR/print/job1/teos/a.jpg",
        f"{base}/AUTO-OCR/print/job1/teos/a.txt",
    ]
    assert sftp.rmdirs == [], "kataloogi ei tohi katkestamise hetkel eemaldada (#225)"
    assert ocr_reaper.is_scheduled(f"{base}/AUTO-OCR/print/job1/teos")
    assert ocr_reaper.is_scheduled(f"{base}/AUTO-OCR/print/job1")


def test_reocr_koristus_puuduva_kaustaga_on_ok(monkeypatch):
    monkeypatch.setattr(reocr_ops, "_sftp_open", lambda jid: FakeSftp())
    monkeypatch.setattr(reocr_ops, "close_ssh", lambda jid: None)
    assert reocr_ops._cleanup_remote_job("job2", {"remote_work": "AUTO-OCR/print/job2/teos"}) is True


# =========================================================
# upload'i katkestamine
# =========================================================

def test_cancel_upload_ei_tee_rm_rf_i(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    (uploads / "up1" / "thumbs").mkdir(parents=True)
    monkeypatch.setattr(upload_ops, "UPLOADS_DIR", str(uploads))
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(uploads))
    (uploads / "up1" / "state.json").write_text(json.dumps({
        "id": "up1",
        "status": "processing",
        "meta": {"slug": "test-teos-up1"},
        "remote_staging_path": "AUTO-OCR/print/up1",
        "remote_work_path": "AUTO-OCR/print/up1/test-teos-up1",
    }), encoding="utf-8")

    base = upload_ops.OCR_SERVER_PATH
    sftp = FakeSftp({
        f"{base}/AUTO-OCR/print/up1": ["source.pdf"],
        f"{base}/AUTO-OCR/print/up1/test-teos-up1": ["p1.jpg", "p1.txt"],
    })
    rm_rf_calls = []
    monkeypatch.setattr(upload_ops, "_sftp_open", lambda uid: sftp)
    monkeypatch.setattr(upload_ops, "_ssh_rm_rf", lambda *a, **kw: rm_rf_calls.append(a))
    monkeypatch.setattr(upload_ops, "close_ssh", lambda uid: None)

    assert upload_ops.cancel_upload("up1") is True

    assert rm_rf_calls == [], "rm -rf kukutab OCR-teenuse, kui batch on GPU-s (#225)"
    assert f"{base}/AUTO-OCR/print/up1/test-teos-up1/p1.jpg" in sftp.removed
    assert f"{base}/AUTO-OCR/print/up1/source.pdf" in sftp.removed
    assert sftp.rmdirs == []
    assert ocr_reaper.is_scheduled(f"{base}/AUTO-OCR/print/up1")
    assert ocr_reaper.is_scheduled(f"{base}/AUTO-OCR/print/up1/test-teos-up1")
    assert not (uploads / "up1").exists(), "lokaalne staging kustutatakse endiselt"


# =========================================================
# taastereaper ei tohi katkestatud töö jäänukit „taastada"
# =========================================================

def test_taastereaper_jatab_ajastatud_kataloogi_vahele(monkeypatch):
    """Katkestamise järel maandunud .txt kuulub lennus olnud batchile, mitte orvule."""
    kutsutud = []
    monkeypatch.setattr(reocr_recovery, "_is_actively_tracked", lambda jid: False)
    monkeypatch.setattr(reocr_recovery.reocr_state, "load_batch_mapping",
                        lambda jid: kutsutud.append(jid))

    base = "/srv/AUTO-OCR/print"
    ocr_reaper.schedule_reap(f"{base}/job1")
    reocr_recovery._recover_one(FakeSftp(), base, "job1", [], [])
    assert kutsutud == [], "ajastatud kataloogi ei tohi taastada"

    reocr_recovery._recover_one(FakeSftp(), base, "job2", [], [])
    assert kutsutud == ["job2"], "muud kataloogid käivad tavateed"
