"""AA-toorik on KIRJE, mitte tekst — klassifikaator peab need lahku ajama.

Kriitiline servajuht (spekk, „Klassifikatsioon"): inimese kirjutatud elulugu, mis
TSITEERIB AA-kirjet, ei tohi tervikuna `aa_raw`-ks muutuda — tekst kaoks eluloo
kohalt ja muutuks vormis mittemuudetavaks.
"""
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopo_biography_fields import (  # noqa: E402
    AA_RAW, BIOGRAPHY_ET, ANCHOR_OF, ANCHOR_SOURCE, SRC_ET, SRC_EN,
    BIOGRAPHY_EN, classify, is_aa_record, suspicion_flags, text_hash,
)

AA_NAIDE = (
    "Immatrikuleerimise kuupäev: 20. September 1634\n"
    "154. Lünaeus (Lynaeus, Lineus), Emundus, Smål., * 1604, † 1693. V.: Joh. L.\n"
    "Imm. Uppsala 1. 8. 1639. AG: Dep. 18. 9. 1634; Konv. 1. 11. 1634—36;"
)
AA_NUMBRIGA = (
    "154. Lünaeus (Lynaeus, Lineus), Emundus, Smål., * 1604, † 1693. V.: Joh. L.\n"
    "AG: Dep. 18. 9. 1634."
)
PROOSA_MIS_TSITEERIB_AA = (
    "Emundus Lünaeus oli Smålandist pärit üliõpilane, kes jõudis Tartusse "
    "kolmekümneaastase sõja keskel ja jäi siia mitmeks aastaks õppima.\n\n"
    "Album Academicum kannab tema kohta kirjet:\n\n"
    "> 154. Lünaeus (Lynaeus, Lineus), Emundus, Smål., * 1604, † 1693. "
    "AG: Dep. 18. 9. 1634."
)


@pytest.mark.parametrize("tekst", [AA_NAIDE, AA_NUMBRIGA])
def test_aa_kirje_tuvastatakse(tekst):
    assert is_aa_record(tekst) is True
    assert classify(tekst) == AA_RAW


def test_aa_marker_keset_proosat_ei_ole_aa_kirje():
    assert is_aa_record(PROOSA_MIS_TSITEERIB_AA) is False
    assert classify(PROOSA_MIS_TSITEERIB_AA) == BIOGRAPHY_ET


def test_aastaarvuga_algav_proosa_ei_ole_aa_kirje():
    # „1759. aastal…" on CommonMarki loendimarkeri lõks JA AA-numbri lõks korraga.
    tekst = "1759. aastal sai temast Tartu ülikooli professor ning ta pidas seal loenguid."
    assert is_aa_record(tekst) is False
    assert classify(tekst) == BIOGRAPHY_ET


def test_tuhi_tekst_ei_klassifitseeru():
    assert classify("") is None
    assert classify(None) is None
    assert classify("   \n  ") is None


def test_rasi_on_stabiilne_ja_lubjab_umbritseva_tuhiku():
    assert text_hash("tekst") == text_hash("  tekst \n")
    assert len(text_hash("tekst")) == 12
    assert text_hash("tekst") != text_hash("teksti")


def test_ankru_suunad_on_ristis():
    # Ingliskeelse teksti ankur kannab EESTIKEELSE teksti räsi.
    assert ANCHOR_OF[BIOGRAPHY_EN] == SRC_EN
    assert ANCHOR_SOURCE[SRC_EN] == BIOGRAPHY_ET
    assert ANCHOR_OF[BIOGRAPHY_ET] == SRC_ET
    assert ANCHOR_SOURCE[SRC_ET] == BIOGRAPHY_EN


def test_kahtluse_lipud():
    # AA-ks liigitatud, aga sees on proosalõik → lipp.
    lipud = suspicion_flags(PROOSA_MIS_TSITEERIB_AA, AA_RAW, aa_median=400)
    assert "proosa_aa_kirjes" in lipud
    # Markdown eluloos ei ole kahtlane; markdown AA-kirjes on.
    assert "markdown" in suspicion_flags("**paks** kirje", AA_RAW, aa_median=400)
    assert "markdown" not in suspicion_flags("**paks** lugu", BIOGRAPHY_ET, aa_median=400)
    # Marker olemas, aga mitte alguses → lipp ka siis, kui siht on elulugu.
    assert "marker_ei_ole_alguses" in suspicion_flags(
        PROOSA_MIS_TSITEERIB_AA, BIOGRAPHY_ET, aa_median=400)
    # AA-kirje, mille pikkus on mediaanist kaugel.
    assert "pikkus_kahtlane" in suspicion_flags("x" * 5000, AA_RAW, aa_median=400)
