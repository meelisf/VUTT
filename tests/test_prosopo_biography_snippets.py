"""Nimekirja katked on keele kaupa ERALDI (spekk, otsus 6).

Miks mitte üks katke, mille sisse varuvariant juba arvestatud: siis võiks
„ingliskeelses" katkes olla eestikeelne tekst või AA-kirje ja kaart ei saaks
välja nime järgi ühtki ausat keelemärget valida.
"""
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography.person_crud import _make_snippets  # noqa: E402
from server.prosopo_biography_fields import AA_RAW, BIOGRAPHY_EN, BIOGRAPHY_ET  # noqa: E402


def test_iga_allikas_annab_oma_katke():
    katked = _make_snippets({
        BIOGRAPHY_ET: "Eestikeelne elulugu.",
        BIOGRAPHY_EN: "English biography.",
        "notes": "Sisemised märkmed.",
        AA_RAW: "154. Lünaeus, Emundus.",
    })
    assert katked["biography_snippet_et"] == "Eestikeelne elulugu."
    assert katked["biography_snippet_en"] == "English biography."
    assert katked["notes_snippet"] == "Sisemised märkmed."
    assert katked["aa_snippet"] == "154. Lünaeus, Emundus."


def test_puuduv_allikas_annab_tuhja_stringi_mitte_None():
    katked = _make_snippets({BIOGRAPHY_ET: "Ainult eesti keeles."})
    assert katked["biography_snippet_en"] == ""
    assert katked["aa_snippet"] == ""
    assert katked["notes_snippet"] == ""


def test_katked_on_puhas_tekst_ja_120_margi_pikkused():
    katked = _make_snippets({BIOGRAPHY_ET: "**Carl Lund** " + "x" * 200})
    assert not katked["biography_snippet_et"].startswith("**")
    assert len(katked["biography_snippet_et"]) == 120


def test_ei_varuvarianteeru_indeksis():
    # ET tühi, EN täidetud → ET katke JÄÄB tühjaks. Varuvariandi valib vaade.
    katked = _make_snippets({BIOGRAPHY_EN: "English only."})
    assert katked["biography_snippet_et"] == ""
    assert katked["biography_snippet_en"] == "English only."
