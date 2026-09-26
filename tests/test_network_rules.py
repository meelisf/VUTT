# tests/test_network_rules.py
"""Seose liik rollipaarist (#461, ADR 0056). Kontrollnäited on päris andmetest."""
import logging

import pytest

from server.prosopography import network_rules as nr
from server.prosopography.network_rules import classify_pair


@pytest.mark.parametrize("a, b, expected", [
    # 1. academic
    (["praeses"], ["respondens"], ("academic", "ab")),
    (["respondens"], ["praeses"], ("academic", "ba")),
    (["aui"], ["auctor"], ("academic", "ab")),
    (["aui", "gratulator"], ["auctor"], ("academic", "ab")),   # järjekord: academic enne cotext
    # 2. dedicated
    (["auctor"], ["subject"], ("dedicated", "ab")),
    (["subject"], ["praeses"], ("dedicated", "ba")),
    (["gratulator"], ["respondens"], ("dedicated", "ab")),
    (["gratulator"], ["auctor"], ("dedicated", "ab")),
    (["creator"], ["subject"], ("dedicated", "ab")),           # puuduv roll = creator = looja
    # 3. cotext
    (["gratulator"], ["gratulator"], ("cotext", None)),
    (["aui"], ["gratulator"], ("cotext", None)),
    (["dedicator"], ["dedicator"], ("cotext", None)),
    (["dedicator"], ["subject"], ("cotext", None)),            # pühendus on nõrk (otsus 5)
    # 4. mention
    (["praeses"], ["mentioned"], ("mention", None)),
    (["mentioned"], ["mentioned"], ("mention", None)),
    (["subject"], ["subject"], ("mention", None)),
    # 5. printer
    (["auctor"], ["publisher"], ("printer", None)),
    (["subject"], ["publisher"], ("printer", None)),
])
def test_reeglitabel(a, b, expected):
    assert classify_pair(a, b) == expected


def test_kontrollnaited():
    # Dalinus auctor, Luden aui — „Oratio de pietate"
    assert classify_pair(["aui"], ["auctor"])[0] == "academic"
    # Dalinus gratulator, Luden aui — „De libertate politica oratio"
    assert classify_pair(["aui"], ["gratulator"])[0] == "cotext"
    # Schwäger auctor → Fischer subject (jy30do)
    assert classify_pair(["auctor"], ["subject"]) == ("dedicated", "ab")
    # Dau dedicator, kaaspühendaja dedicator
    assert classify_pair(["dedicator"], ["dedicator"])[0] == "cotext"
    # Dau praeses, Fischer mentioned (3ix06q lk 2)
    assert classify_pair(["praeses"], ["mentioned"])[0] == "mention"


def test_vastassuunaline_vaste_on_suunata():
    assert classify_pair(["auctor", "subject"], ["auctor", "subject"]) == ("dedicated", None)
    assert classify_pair(["praeses", "respondens"], ["praeses", "respondens"]) == ("academic", None)


FLIP = {"ab": "ba", "ba": "ab", None: None}
ROLES = ["praeses", "respondens", "auctor", "gratulator", "dedicator", "aui", "creator",
         "subject", "mentioned", "publisher", "tundmatu"]


@pytest.mark.parametrize("a", ROLES)
@pytest.mark.parametrize("b", ROLES)
def test_summeetria(a, b):
    """Fookuse vahetus ei muuda liiki ega tegelikku suunda."""
    k1, d1 = classify_pair([a], [b])
    k2, d2 = classify_pair([b], [a])
    assert k1 == k2 and d2 == FLIP[d1]


def test_tundmatu_roll_on_cotext_ja_logitakse_uks_kord(caplog):
    nr._logged_unknown.clear()
    with caplog.at_level(logging.WARNING):
        assert classify_pair(["xyz"], ["xyz"]) == ("cotext", None)
        assert classify_pair(["xyz"], ["auctor"]) == ("cotext", None)
    assert sum("xyz" in r.message for r in caplog.records) == 1
