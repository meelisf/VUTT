"""cancel_reocr_job: „tööd ei olnud" semantika (#217)."""
import os

import pytest

from server import reocr_ops


@pytest.fixture
def keskkond(tmp_path, monkeypatch):
    slug = "1650-test-abc123"
    work = tmp_path / slug
    work.mkdir()
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(reocr_ops, "REOCR_BACKUPS_DIR", str(tmp_path / "backups"))
    monkeypatch.setattr(
        reocr_ops.reocr_state, "BACKUP_TARGETS_DIR", str(tmp_path / "targets")
    )
    monkeypatch.setattr(reocr_ops, "_reocr_jobs", {})
    monkeypatch.setattr(reocr_ops, "_reocr_batch_jobs", {})
    monkeypatch.setattr(reocr_ops, "_cancel_events", {})
    monkeypatch.setattr(reocr_ops, "_upload_threads", {})
    monkeypatch.setattr(reocr_ops, "_persist_active_jobs", lambda: None)
    logitud = []
    monkeypatch.setattr(reocr_ops, "_append_to_log",
                        lambda job, jid: logitud.append(dict(job)))
    monkeypatch.setattr(reocr_ops.reocr_state, "remove_batch_mapping", lambda jid: None)
    monkeypatch.setattr(reocr_ops, "_cleanup_remote_job", lambda jid, job: True)
    return slug, work, logitud


def test_kustutab_ainult_toodetud_lehed(keskkond):
    """REGRESSIOON: plaanitud lehtede järgi kustutamine hävitaks varasema
    ootel tulemuse lehel, mida katkestatud töö ei puutunud."""
    slug, work, _ = keskkond
    (work / "001.ocr").write_text("selle töö tulemus", encoding="utf-8")
    (work / "017.ocr").write_text("VARASEM ootel tulemus", encoding="utf-8")
    reocr_ops._reocr_batch_jobs["b1"] = {
        "status": "processing", "slug": slug,
        "produced_pages": ["001"],           # 017 EI OLE siin
        "pages": [{"page_filename": "001.jpg"}, {"page_filename": "017.jpg"}],
    }

    result = reocr_ops.cancel_reocr_job("b1")

    assert result["deleted_ocr"] == 1
    assert not (work / "001.ocr").exists()
    assert (work / "017.ocr").read_text(encoding="utf-8") == "VARASEM ootel tulemus"


def test_taastab_ylekirjutatud_tulemuse(keskkond):
    slug, work, _ = keskkond
    (work / "017.ocr").write_text("VANA", encoding="utf-8")
    reocr_ops._write_ocr_file(slug, "017.jpg", "UUS", "b1")
    reocr_ops._reocr_batch_jobs["b1"] = {
        "status": "processing", "slug": slug, "produced_pages": ["017"], "pages": [],
    }

    result = reocr_ops.cancel_reocr_job("b1")

    assert result["restored_ocr"] == 1
    assert (work / "017.ocr").read_text(encoding="utf-8") == "VANA"


def test_eemaldab_too_registrist(keskkond):
    slug, _work, _ = keskkond
    reocr_ops._reocr_batch_jobs["b1"] = {
        "status": "processing", "slug": slug, "produced_pages": [], "pages": [],
    }
    reocr_ops.cancel_reocr_job("b1")
    assert "b1" not in reocr_ops._reocr_batch_jobs


def test_logikirje_saab_cancelled_ja_remote_cleanup(keskkond):
    slug, _work, logitud = keskkond
    reocr_ops._reocr_jobs["j1"] = {
        "status": "processing", "slug": slug, "produced_pages": [],
    }
    reocr_ops.cancel_reocr_job("j1")
    assert logitud[-1]["status"] == "cancelled"
    assert logitud[-1]["remote_cleanup"] == "ok"


def test_sftp_torge_ei_takista_lokaalset_katkestamist(keskkond, monkeypatch):
    """Intsidendi kuju: VUTT rippus, LOSS oli edasi läinud."""
    slug, _work, logitud = keskkond
    monkeypatch.setattr(reocr_ops, "_cleanup_remote_job", lambda jid, job: False)
    reocr_ops._reocr_batch_jobs["b1"] = {
        "status": "processing", "slug": slug, "produced_pages": [], "pages": [],
    }

    result = reocr_ops.cancel_reocr_job("b1")

    assert result["status"] == "cancelled"
    assert result["remote_cleanup"] == "failed"
    assert "b1" not in reocr_ops._reocr_batch_jobs
    assert logitud[-1]["remote_cleanup"] == "failed"


def test_kirjutaja_ei_peatu_jatab_too_cancelling_olekusse(keskkond, monkeypatch):
    """Koristust EI TOHI alustada, kui üleslaadimislõim on veel elus."""
    slug, _work, _ = keskkond
    monkeypatch.setattr(reocr_ops, "_quiesce_upload", lambda jid, timeout=30.0: False)
    koristatud = []
    monkeypatch.setattr(reocr_ops, "_cleanup_remote_job",
                        lambda jid, job: koristatud.append(jid) or True)
    reocr_ops._reocr_batch_jobs["b1"] = {
        "status": "processing", "slug": slug, "produced_pages": [], "pages": [],
    }

    with pytest.raises(RuntimeError):
        reocr_ops.cancel_reocr_job("b1")

    assert koristatud == [], "koristus ei tohi käivituda"
    assert reocr_ops._reocr_batch_jobs["b1"]["status"] == "cancelling"


def test_valmis_too_ei_ole_katkestatav(keskkond):
    slug, _work, _ = keskkond
    reocr_ops._reocr_jobs["j1"] = {"status": "done", "slug": slug}
    with pytest.raises(ValueError):
        reocr_ops.cancel_reocr_job("j1")


def test_tundmatu_too_annab_keyerror(keskkond):
    with pytest.raises(KeyError):
        reocr_ops.cancel_reocr_job("puudub")


# --- varukoopiate elutsükkel ---

def test_normaalne_lopp_kustutab_varukoopiad(keskkond):
    """Varukoopia ei tohi jääda igavesti state/-i vedelema."""
    slug, work, _ = keskkond
    (work / "017.ocr").write_text("VANA", encoding="utf-8")
    reocr_ops._write_ocr_file(slug, "017.jpg", "UUS", "b9")
    assert os.path.isdir(reocr_ops._backup_dir("b9"))

    reocr_ops._drop_backups("b9")

    assert not os.path.isdir(reocr_ops._backup_dir("b9"))
    assert (work / "017.ocr").read_text(encoding="utf-8") == "UUS"
