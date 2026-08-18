"""Biograafia-snippet peab olema PUHAS TEKST (#240).

`biography_snippet` läheb isikute nimekirja kaardile lihttekstina, aga
`_strip_markup` eemaldas ainult XML-tägid. Biograafia on Markdown (ADR 0008),
nii et `**Carl Lund**` jõudis kaardile toorelt — vt /persons?q=lund.

Kaks asja, mida EI tohi ära rikkuda:
  - `*1617` on selles korpuses sünnisümbol, mitte rõhutuse algus;
  - `1759.` rea alguses on aastaarv, mitte nummerdatud loendi marker
    (sama lõks mis `escapeAccidentalOrderedLists` frontendis).
"""
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography.person_crud import _strip_markup  # noqa: E402


@pytest.mark.parametrize("sisend,oodatud", [
    ("**Carl Lund**, Tartu allikates", "Carl Lund, Tartu allikates"),
    ("__paks__ tekst", "paks tekst"),
    ("*rõhutatud* sõna", "rõhutatud sõna"),
    ("_rõhutatud_ sõna", "rõhutatud sõna"),
    ("~~kustutatud~~ tekst", "kustutatud tekst"),
    ("`kood` reas", "kood reas"),
])
def test_markdowni_sumbolid_eemaldatakse(sisend, oodatud):
    assert _strip_markup(sisend) == oodatud


def test_link_jatab_ainult_teksti():
    assert _strip_markup("vt [Album Academicum](https://aa.ee/1) lk 5") == \
        "vt Album Academicum lk 5"


@pytest.mark.parametrize("sisend,oodatud", [
    ("# Pealkiri", "Pealkiri"),
    ("### Alampealkiri", "Alampealkiri"),
    ("> tsitaat", "tsitaat"),
    ("- loendirida", "loendirida"),
])
def test_rea_alguse_markerid_eemaldatakse(sisend, oodatud):
    assert _strip_markup(sisend) == oodatud


def test_sunnisumbol_jaab_alles():
    """`*1617` ei ole rõhutus — tärn on sünnimärk."""
    assert _strip_markup("Bergius, Ericus, Smål., *1617, † 1689.") == \
        "Bergius, Ericus, Smål., *1617, † 1689."


def test_kaks_sunnisumbolit_ei_moodusta_paari():
    tekst = "Isa *1590, poeg *1617."
    assert _strip_markup(tekst) == tekst


def test_aastaarv_rea_alguses_ei_ole_loendimarker():
    assert _strip_markup("1759. aastal saabus ta Tartusse") == \
        "1759. aastal saabus ta Tartusse"


def test_nurksulg_ilma_lingita_jaab_alles():
    assert _strip_markup("[NR]17. Bergius, Ericus") == "[NR]17. Bergius, Ericus"


def test_reavahetused_muutuvad_tuhikuks():
    assert _strip_markup("Esimene rida\nteine rida") == "Esimene rida teine rida"


def test_xml_tagid_eemaldatakse_endiselt():
    assert _strip_markup("<i>kaldkiri</i> tekst") == "kaldkiri tekst"


def test_tyhi_sisend():
    assert _strip_markup("") == ""
    assert _strip_markup(None) == ""
