"""Olekuta tõlkeklient. Vastuse kuju on `ocr_providers/gemini.py` oma —
ELAVA API vastu mõõdetud 2026-09-01, mitte välja mõeldud.
"""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server import text_translate  # noqa: E402
from server.text_translate import MAX_INPUT_CHARS, TranslateError, translate  # noqa: E402


def _vastus(tekst, status=200):
    """Gemini 200-vastuse kuju: ülemisel tasemel `steps`, mitte `output`."""
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = {
        "steps": [
            {"type": "thought", "signature": "EI TOHI VÄLJUNDISSE JÕUDA"},
            {"type": "model_output", "content": [{"type": "text", "text": tekst}]},
        ],
        "usage": {"total_input_tokens": 120, "total_output_tokens": 200,
                  "total_tokens": 320},
    }
    return resp


def test_tolge_tagastab_teksti_ja_normaliseeritud_usage():
    with patch.object(text_translate.requests, "post", return_value=_vastus("English biography.")), \
         patch.object(text_translate, "_api_key", return_value="VOTI"):
        tekst, usage = translate("Eestikeelne elulugu.", "et", "en")
    assert tekst == "English biography."
    assert usage["input_tokens"] == 120
    assert usage["output_tokens"] == 200


def test_mottekaigu_signature_ei_joua_valjundisse():
    with patch.object(text_translate.requests, "post", return_value=_vastus("Life.")), \
         patch.object(text_translate, "_api_key", return_value="VOTI"):
        tekst, _ = translate("Elu.", "et", "en")
    assert "SIGNATURE" not in tekst.upper()


def test_tuhi_mudelivastus_on_viga_mitte_tuhi_tolge():
    # OCR-is on tühi väljund KEHTIV tulemus (ADR 0025); tõlkes EI OLE.
    with patch.object(text_translate.requests, "post", return_value=_vastus("   ")), \
         patch.object(text_translate, "_api_key", return_value="VOTI"):
        with pytest.raises(TranslateError):
            translate("Elu.", "et", "en")


def test_tuhi_sisend_ei_tee_mudelikutset():
    with patch.object(text_translate.requests, "post") as post:
        with pytest.raises(TranslateError):
            translate("   \n ", "et", "en")
    post.assert_not_called()


def test_pikkuspiiri_ületav_sisend_ei_tee_mudelikutset():
    with patch.object(text_translate.requests, "post") as post:
        with pytest.raises(TranslateError) as exc:
            translate("x" * (MAX_INPUT_CHARS + 1), "et", "en")
    post.assert_not_called()
    assert "50000" in str(exc.value) or str(MAX_INPUT_CHARS) in str(exc.value)


def test_samad_keeled_on_viga():
    with pytest.raises(TranslateError):
        translate("Elu.", "et", "et")


def test_tundmatu_keel_on_viga():
    with pytest.raises(TranslateError):
        translate("Elu.", "et", "de")


def test_sisufiltri_keeldumine_kannab_masinloetavat_prefiksit():
    resp = MagicMock()
    resp.status_code = 400
    resp.json.return_value = {"error": {"code": 400, "status": "content_blocked",
                                        "message": "safe coding"}}
    with patch.object(text_translate.requests, "post", return_value=resp), \
         patch.object(text_translate, "_api_key", return_value="VOTI"):
        with pytest.raises(TranslateError) as exc:
            translate("Elu.", "et", "en")
    assert str(exc.value).startswith("content_blocked")


def test_veasõnum_ei_sisalda_votit_ega_vastuse_keha():
    resp = MagicMock()
    resp.status_code = 500
    resp.json.return_value = {"error": {"code": 500, "status": "INTERNAL",
                                        "message": "boom"}}
    with patch.object(text_translate.requests, "post", return_value=resp), \
         patch.object(text_translate, "_api_key", return_value="SALAJANE-VOTI"), \
         patch.object(text_translate, "GEMINI_MAX_RETRIES", 0):
        with pytest.raises(TranslateError) as exc:
            translate("Elu.", "et", "en")
    assert "SALAJANE-VOTI" not in str(exc.value)
