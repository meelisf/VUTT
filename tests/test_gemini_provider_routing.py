"""Pakkuja-marsruutimine: Gemini-töö ei puutu SFTP-d ja kirjutab .ocr atomaarselt."""
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture
def ops(tmp_path, monkeypatch):
    """reocr_ops ajutise BASE_DIR-iga; SFTP on lõks — selle kutsumine on VIGA."""
    import server.reocr_ops as reocr_ops
    (tmp_path / "w1").mkdir()
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(reocr_ops, "REOCR_BACKUPS_DIR", str(tmp_path / "backups"))
    # Varukoopiate sihtkoha register elab state/-is — isoleeri, muidu reostab tootmisolekut.
    monkeypatch.setattr(reocr_ops.reocr_state, "BACKUP_TARGETS_DIR",
                        str(tmp_path / "targets"))
    monkeypatch.setattr(reocr_ops, "_persist_active_jobs", lambda: None)
    monkeypatch.setattr(reocr_ops, "_append_to_log", lambda *a, **kw: None)

    # Lõks loeb kutsed ÜLES, mitte ainult ei viska: poll_reocr_job mähib SFTP-osa
    # laia `except Exception`-i sisse, seega viskamine üksi ei kukutaks testi.
    sftp_kutsed = []

    def sftp_lõks(*a, **kw):
        sftp_kutsed.append(a)
        raise AssertionError("Gemini-tee EI TOHI SFTP-d avada")

    monkeypatch.setattr(reocr_ops, "_sftp_open", sftp_lõks)
    monkeypatch.setattr(reocr_ops, "_test_sftp_kutsed", sftp_kutsed, raising=False)
    reocr_ops._reocr_jobs.clear()
    reocr_ops._reocr_batch_jobs.clear()
    return reocr_ops


def _oota(tingimus, timeout=5.0):
    tähtaeg = time.time() + timeout
    while time.time() < tähtaeg:
        if tingimus():
            return True
        time.sleep(0.02)
    return False


def test_gemini_uksiktoo_kirjutab_ocr_ja_ei_ava_sftpd(ops, tmp_path, monkeypatch):
    import server.ocr_providers.gemini as gem
    monkeypatch.setattr(gem, "transcribe",
                        lambda *a, **kw: ("Mus. 1309\nAlexander I.", {"total_tokens": 5}))
    (tmp_path / "w1" / "pg1.jpg").write_bytes(b"\xff\xd8\xff")

    job_id = ops.start_reocr_job("wid", "w1", str(tmp_path / "w1" / "pg1.jpg"),
                                 page_filename="pg1.jpg", username="sa",
                                 material_type="hand", provider="gemini")

    assert _oota(lambda: ops._reocr_jobs[job_id]["status"] == "done")
    assert (tmp_path / "w1" / "pg1.ocr").read_text(encoding="utf-8") == (
        "Mus. 1309\nAlexander I.")
    assert ops._reocr_jobs[job_id]["produced_pages"] == ["pg1"]
    assert ops._reocr_jobs[job_id]["provider"] == "gemini"


def test_gemini_kasutab_kasikirja_juhist_kaepideme_jargi(ops, tmp_path, monkeypatch):
    """material_type='hand' PEAB andma käsikirja juhise, mitte trükise oma."""
    import server.ocr_prompts as prompts
    import server.ocr_providers.gemini as gem
    nähtud = {}

    def salvestav_transcribe(img, instruction, **kw):
        nähtud["i"] = instruction
        return ("t", {})

    monkeypatch.setattr(gem, "transcribe", salvestav_transcribe)
    (tmp_path / "w1" / "pg1.jpg").write_bytes(b"\xff\xd8\xff")

    job_id = ops.start_reocr_job("wid", "w1", str(tmp_path / "w1" / "pg1.jpg"),
                                 page_filename="pg1.jpg", material_type="hand",
                                 provider="gemini")

    assert _oota(lambda: ops._reocr_jobs[job_id]["status"] in ("done", "error"))
    assert nähtud["i"] == prompts.GEMINI_HAND_INSTRUCTION


def test_gemini_viga_laheb_error_staatusesse(ops, tmp_path, monkeypatch):
    import server.ocr_providers.gemini as gem

    def kukub(*a, **kw):
        raise gem.GeminiError("HTTP 429: RESOURCE_EXHAUSTED")

    monkeypatch.setattr(gem, "transcribe", kukub)
    (tmp_path / "w1" / "pg1.jpg").write_bytes(b"\xff\xd8\xff")

    job_id = ops.start_reocr_job("wid", "w1", str(tmp_path / "w1" / "pg1.jpg"),
                                 page_filename="pg1.jpg", provider="gemini")

    assert _oota(lambda: ops._reocr_jobs[job_id]["status"] == "error")
    assert "RESOURCE_EXHAUSTED" in ops._reocr_jobs[job_id]["error"]
    assert not (tmp_path / "w1" / "pg1.ocr").exists()


def test_poll_ei_ava_sftpd_gemini_tool(ops, tmp_path, monkeypatch):
    """poll_reocr_job peab Gemini-tööl kohe tagastama, mitte kaugfaili küsima."""
    ops._reocr_jobs["j1"] = {"provider": "gemini", "status": "processing",
                             "text": None, "error": None, "slug": "w1"}
    tulemus = ops.poll_reocr_job("j1")          # _sftp_open on lõks
    assert tulemus["status"] == "processing"
    assert ops._test_sftp_kutsed == []


def test_batch_poll_ei_ava_sftpd_gemini_tool(ops):
    """_poll_batch_job on Gemini-tööl no-op: ei SFTP-d ega olekumuutust."""
    lehed = [{"page_filename": "pg1.jpg", "stem": "pg1",
              "status": "processing", "error": None}]
    ops._reocr_batch_jobs["b1"] = {"kind": "batch", "provider": "gemini",
                                   "status": "processing", "work_id": "wid",
                                   "slug": "w1", "pages": lehed, "started_at": 0}

    ops._poll_batch_job("b1")                   # ei tohi visata

    töö = ops._reocr_batch_jobs["b1"]
    assert töö["status"] == "processing"
    assert töö["pages"] == [{"page_filename": "pg1.jpg", "stem": "pg1",
                             "status": "processing", "error": None}]


def test_build_reocr_status_naitab_aktiivse_pakkuja(ops, tmp_path):
    ops._reocr_batch_jobs["b1"] = {
        "kind": "batch", "provider": "gemini", "status": "processing",
        "work_id": "wid", "slug": "w1", "started_at": 1,
        "pages": [{"page_filename": "pg1.jpg", "stem": "pg1",
                   "status": "processing", "error": None}],
    }
    seis = ops.build_reocr_status("wid", str(tmp_path / "w1"))
    assert seis["active_provider"] == "gemini"


def test_katkestamine_kirjutamise_ajal_ei_jata_vahepealset_seisu(ops, tmp_path, monkeypatch):
    """Leht on kas produced_pages-is või .ocr on puutumata. Kolmandat ei ole."""
    import server.ocr_providers.gemini as gem
    väljas = threading.Event()

    def aeglane(*a, **kw):
        väljas.set()
        time.sleep(0.3)
        return ("uus tekst", {})

    monkeypatch.setattr(gem, "transcribe", aeglane)
    (tmp_path / "w1" / "pg1.jpg").write_bytes(b"\xff\xd8\xff")
    (tmp_path / "w1" / "pg1.ocr").write_text("VANA TULEMUS", encoding="utf-8")

    job_id = ops.start_reocr_job("wid", "w1", str(tmp_path / "w1" / "pg1.jpg"),
                                 page_filename="pg1.jpg", provider="gemini")
    assert väljas.wait(2)
    ops._cancel_event(job_id).set()
    with ops._reocr_jobs_lock:
        ops._reocr_jobs[job_id]["status"] = "cancelling"

    assert _oota(lambda: not ops._upload_threads[job_id].is_alive())
    töö = ops._reocr_jobs[job_id]
    kirjas = "pg1" in töö.get("produced_pages", [])
    sisu = (tmp_path / "w1" / "pg1.ocr").read_text(encoding="utf-8")
    # Kas töö omab lehte (siis on uus sisu ja ADR 0018 koristus taastab varukoopia),
    # või ta ei puutunud seda üldse (siis on vana sisu alles).
    assert kirjas or sisu == "VANA TULEMUS"
