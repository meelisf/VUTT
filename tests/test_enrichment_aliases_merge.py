"""Nimevariandid on hulk, mitte skalaar (#240).

`fetch_and_diff` kohtles `name.aliases` samamoodi nagu sünnikuupäeva: kui
kohalik väärtus ei olnud tühi ja erines, läks see KONFLIKTI. Konfliktid on
rikastuse vaates ainult loetavad — Apply-nuppu ei renderdata, kui
`auto_filled` on tühi — nii et kaardil, millel juba oli mõni nimevariant,
ei saanud allika variante üldse salvestada.

Nimevariantide puhul on õige tehe ühend: rohkem variante on otsingule alati
parem ja ükski neist ei tühista teist.
"""
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography import enrichment  # noqa: E402


def _diff(monkeypatch, remote: dict, person: dict) -> dict:
    monkeypatch.setattr(enrichment, "_fetch_gnd", lambda _id: remote)
    return enrichment.fetch_and_diff("gnd", "123", person)


def _isik(aliases=None, **extra) -> dict:
    return {"name": {"label": "Jacobus Skytte", "aliases": aliases or []}, **extra}


def test_uued_variandid_liidetakse_olemasolevatele(monkeypatch):
    d = _diff(monkeypatch,
              {"name.aliases": ["Jakob Skytte", "Jacobus Skytteus"]},
              _isik(["Jacob Skytte"]))

    assert d["auto_filled"]["name.aliases"] == [
        "Jacob Skytte", "Jakob Skytte", "Jacobus Skytteus",
    ]
    assert [c["field"] for c in d["conflicts"]] == []


def test_olemasolevad_variandid_jaavad_ette_ja_alles(monkeypatch):
    """Ühend ei tohi kohalikku järjestust ega sisu ära visata."""
    d = _diff(monkeypatch, {"name.aliases": ["Uus"]}, _isik(["A", "B"]))
    assert d["auto_filled"]["name.aliases"][:2] == ["A", "B"]


def test_kui_allikas_ei_lisa_midagi_siis_ei_pakuta_muudatust(monkeypatch):
    d = _diff(monkeypatch, {"name.aliases": ["Jacob Skytte"]}, _isik(["Jacob Skytte"]))
    assert "name.aliases" not in d["auto_filled"]
    assert [c["field"] for c in d["conflicts"]] == []


def test_tyhja_aliaste_loend_kaitub_nagu_enne(monkeypatch):
    d = _diff(monkeypatch, {"name.aliases": ["Jacob Skytte"]}, _isik([]))
    assert d["auto_filled"]["name.aliases"] == ["Jacob Skytte"]


def test_kordust_ei_teki_unicode_normaliseerimise_parast(monkeypatch):
    """GND annab NFD, kaardil on NFC — sama nimi, mitte uus variant."""
    nfc = "Nöller"           # ö ühe koodpunktina
    nfd = "Nöller"          # o + kombineeruv umlaut
    d = _diff(monkeypatch, {"name.aliases": [nfd]}, _isik([nfc]))
    assert "name.aliases" not in d["auto_filled"]
    assert [c["field"] for c in d["conflicts"]] == []


def test_kordust_ei_teki_ymbritsevate_tyhikute_parast(monkeypatch):
    d = _diff(monkeypatch, {"name.aliases": ["  Jacob Skytte "]}, _isik(["Jacob Skytte"]))
    assert "name.aliases" not in d["auto_filled"]
    assert [c["field"] for c in d["conflicts"]] == []


def test_kuupaev_jaab_endiselt_konfliktiks(monkeypatch):
    """Ühendamine kehtib ainult hulga-väljadele — skalaar on ikka konflikt."""
    d = _diff(monkeypatch,
              {"birth.date": "1616"},
              _isik([], birth={"date": "1616-06-29"}))
    assert [c["field"] for c in d["conflicts"]] == ["birth.date"]
    assert "birth.date" not in d["auto_filled"]
