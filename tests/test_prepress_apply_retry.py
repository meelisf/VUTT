"""Katkenud apply kordus alustab puhtalt lehelt.

`APPLY_START_STATUSES` sisaldab `error`-it, seega retry ON lubatud. Lehenimed on
deterministlikud (`remote_page_name(slug, out_index)`), aga juba tekkinud `.txt`
failid jääksid alles ja LOSS ei OCR-iks uuesti — muutunud pildile jääks vana
tekst. Seega puhastatakse enne kordust kaugtöökausta FAILID, mitte kataloog
(ADR 0024 / #225: kadunud kataloog lennusoleva batchi alt kukutab kogu teenuse).
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.upload import prepress_apply, state as upload_state


PLAAN = {"default_split_x": 0.5, "pages": [
    {"n": 1, "mode": "nosplit", "split_x": None, "excluded": False},
]}


@pytest.fixture
def retry_env(tmp_path, monkeypatch):
    def _make(upload_id, **yle):
        uploads = tmp_path / "uploads"
        (uploads / upload_id / "thumbs").mkdir(parents=True, exist_ok=True)
        monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(uploads))
        s = {
            "id": upload_id, "status": "applying", "expected_pages": 1,
            "meta": {"slug": "x"},
            "remote_staging_path": "AUTO-OCR/hand/{}".format(upload_id),
            "remote_work_path": "AUTO-OCR/hand/{}/x".format(upload_id),
            "prepress": PLAAN,
        }
        s.update(yle)
        upload_state.write_state(upload_id, s)

        puhastatud = []

        class _S:
            def close(self):
                pass

        monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda uid: _S())
        monkeypatch.setattr(prepress_apply.ocr_client, "cleanup_run_files",
                            lambda sftp, d: puhastatud.append(d) or True)
        monkeypatch.setattr(prepress_apply, "_transfer_pages", lambda *a, **kw: 1)
        return puhastatud
    return _make


def test_retry_puhastab_kaugfailid_enne_avaldamist(retry_env):
    puhastatud = retry_env("u1", apply_attempts=2)      # ← teine katse

    prepress_apply.apply_and_transfer("u1")

    assert puhastatud, "korduskatse peab kaugfailid enne puhastama"
    assert puhastatud[0].endswith("AUTO-OCR/hand/u1/x")


def test_esimene_katse_ei_puhasta(retry_env):
    """Puhas kaust — puhastamine oleks tarbetu SFTP-ring."""
    puhastatud = retry_env("u2", apply_attempts=1)

    prepress_apply.apply_and_transfer("u2")

    assert puhastatud == []


def test_try_begin_applying_loendab_katseid(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(tmp_path / "uploads"))
    (tmp_path / "uploads" / "u3").mkdir(parents=True)
    upload_state.write_state("u3", {
        "id": "u3", "status": "awaiting_split", "expected_pages": 1,
        "meta": {"slug": "x"}, "prepress": PLAAN,
    })

    assert upload_state.try_begin_applying("u3") is True
    assert upload_state.read_state("u3")["apply_attempts"] == 1

    # Kukkunud katse → error → uus katse
    upload_state.set_upload_state("u3", status="error")
    assert upload_state.try_begin_applying("u3") is True
    assert upload_state.read_state("u3")["apply_attempts"] == 2
