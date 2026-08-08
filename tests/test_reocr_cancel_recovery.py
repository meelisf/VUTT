"""Pooleli jäänud katkestamine ei tohi restardi järel tööks tagasi muutuda (#217)."""
import pytest

from server import reocr_ops


@pytest.fixture(autouse=True)
def puhas(monkeypatch, tmp_path):
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(reocr_ops, "REOCR_BACKUPS_DIR", str(tmp_path / "backups"))
    monkeypatch.setattr(
        reocr_ops.reocr_state, "BACKUP_TARGETS_DIR", str(tmp_path / "targets")
    )
    monkeypatch.setattr(reocr_ops, "_persist_active_jobs", lambda: None)
    monkeypatch.setattr(reocr_ops, "_append_to_log", lambda job, jid: None)
    monkeypatch.setattr(reocr_ops.reocr_state, "remove_batch_mapping", lambda jid: None)
    monkeypatch.setattr(reocr_ops, "_cleanup_remote_job", lambda jid, job: True)


def test_cancelling_too_lopetatakse():
    jobs = {"b1": {"status": "cancelling", "slug": "s", "produced_pages": []}}
    lopetatud = reocr_ops._finish_interrupted_cancellations(jobs)
    assert lopetatud == 1
    assert "b1" not in jobs


def test_aktiivseid_toid_ei_puututa():
    jobs = {"b1": {"status": "processing", "slug": "s"}}
    assert reocr_ops._finish_interrupted_cancellations(jobs) == 0
    assert "b1" in jobs


def test_koristuse_torge_ei_jata_tood_aktiivseks(monkeypatch):
    """Isegi kui kaugkoristus ebaõnnestub, ei tohi töö jääda teost lukustama."""
    monkeypatch.setattr(reocr_ops, "_cleanup_remote_job", lambda jid, job: False)
    jobs = {"b1": {"status": "cancelling", "slug": "s", "produced_pages": []}}
    assert reocr_ops._finish_interrupted_cancellations(jobs) == 1
    assert "b1" not in jobs


def test_toodetud_lehed_kustutatakse_ka_taastel(tmp_path):
    slug = "1650-test-abc123"
    work = tmp_path / slug
    work.mkdir()
    (work / "001.ocr").write_text("selle töö tulemus", encoding="utf-8")
    (work / "017.ocr").write_text("VARASEM", encoding="utf-8")
    jobs = {"b1": {"status": "cancelling", "slug": slug, "produced_pages": ["001"]}}

    reocr_ops._finish_interrupted_cancellations(jobs)

    assert not (work / "001.ocr").exists()
    assert (work / "017.ocr").read_text(encoding="utf-8") == "VARASEM"
