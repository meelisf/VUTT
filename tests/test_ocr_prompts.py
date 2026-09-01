"""OCR-juhiste valik ja mudeli väljundi puhastus (Gemini-tee)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_instruction_for_valib_tuubi_jargi():
    from server.ocr_prompts import (
        GEMINI_HAND_INSTRUCTION,
        GEMINI_PRINT_INSTRUCTION,
        instruction_for,
    )
    assert instruction_for("print") == GEMINI_PRINT_INSTRUCTION
    assert instruction_for("hand") == GEMINI_HAND_INSTRUCTION


def test_instruction_for_tundmatu_tuup_viskab():
    """Vaikne fallback trükise juhisele oli LOSSi viga — siin kukume valjult."""
    from server.ocr_prompts import instruction_for
    with pytest.raises(ValueError):
        instruction_for("pilt")


def test_juhised_ei_ole_tuhjad_ega_samad():
    from server.ocr_prompts import GEMINI_HAND_INSTRUCTION, GEMINI_PRINT_INSTRUCTION
    assert len(GEMINI_PRINT_INSTRUCTION) > 200
    assert len(GEMINI_HAND_INSTRUCTION) > 200
    assert GEMINI_PRINT_INSTRUCTION != GEMINI_HAND_INSTRUCTION


def test_trukise_juhis_sisaldab_vutt_margendust():
    """Pariteedi ankur: kui see kaob, ei tule Gemini väljund enam VUTT-i kujul."""
    from server.ocr_prompts import GEMINI_PRINT_INSTRUCTION
    for marker in ("<i>", "<m>", "<pb/>", "⸗"):
        assert marker in GEMINI_PRINT_INSTRUCTION


def test_strip_eemaldab_markdown_koodiploki():
    from server.ocr_prompts import strip_model_output
    assert strip_model_output("```xml\nMus. 1309\n```") == "Mus. 1309"
    assert strip_model_output("```\ntekst\n```") == "tekst"


def test_strip_eemaldab_think_ploki():
    from server.ocr_prompts import strip_model_output
    assert strip_model_output("<think>arutlen</think>\nMus. 1309") == "Mus. 1309"
    assert strip_model_output("<think></think>tekst") == "tekst"


def test_strip_sailitab_tuhja_lehe_margendi():
    """[tühi lehekülg] on kokkulepitud märgend — LOSS ei eemalda seda ja meie ka mitte."""
    from server.ocr_prompts import strip_model_output
    assert strip_model_output("[tühi lehekülg]") == "[tühi lehekülg]"


def test_strip_sailitab_reastruktuuri():
    """Sedelkataloogi kirje read PEAVAD alles jääma — ainult otsas olev ws lõigatakse."""
    from server.ocr_prompts import strip_model_output
    assert strip_model_output("\nMus. 1309\nAlexander I.\n1806.\n") == (
        "Mus. 1309\nAlexander I.\n1806."
    )


def test_strip_sailitab_vutt_margenduse():
    from server.ocr_prompts import strip_model_output
    assert strip_model_output("<m>Chrysost.</m>\ntekst") == "<m>Chrysost.</m>\ntekst"
