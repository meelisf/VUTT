"""Ühendamisel ankur EI kandu kaasa (spekk, otsus 7).

Kui allikast kopeeritakse EN-elulugu, aga sihtmärgil on juba TEISTSUGUNE
ET-elulugu, väidaks kaasa kandunud ankur vastavust, mida keegi ei ole kunagi
kinnitanud.
"""
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography.merge_ops import _merge_biography_fields  # noqa: E402
from server.prosopo_biography_fields import (  # noqa: E402
    AA_RAW, BIOGRAPHY_EN, BIOGRAPHY_ET, SRC_EN, SRC_ET,
)

ANKUR = {"hash": "abc123abc123", "at": "2026-09-01T00:00:00+00:00"}


def test_allikas_taidab_ainult_tuhja_sihtvalja():
    source = {BIOGRAPHY_ET: "Allika ET", BIOGRAPHY_EN: "Source EN", AA_RAW: "154. AA"}
    target = {BIOGRAPHY_ET: "Sihtmärgi ET"}
    muutus = _merge_biography_fields(source, target)
    assert muutus is True
    assert target[BIOGRAPHY_ET] == "Sihtmärgi ET"     # ei kirjuta üle
    assert target[BIOGRAPHY_EN] == "Source EN"
    assert target[AA_RAW] == "154. AA"


def test_ankur_nullitakse_kui_ainult_uks_vali_tuli_allikast():
    source = {BIOGRAPHY_EN: "Source EN", SRC_EN: ANKUR}
    target = {BIOGRAPHY_ET: "Sihtmärgi ET", SRC_ET: ANKUR}
    _merge_biography_fields(source, target)
    assert target[SRC_EN] is None
    assert target[SRC_ET] is None


def test_ankur_kandub_kui_MOLEMAD_valjad_tulid_samalt_kaardilt_tuhjale():
    source = {BIOGRAPHY_ET: "Allika ET", BIOGRAPHY_EN: "Source EN", SRC_EN: ANKUR}
    target = {}
    _merge_biography_fields(source, target)
    assert target[SRC_EN] == ANKUR
    assert target[SRC_ET] is None       # allikal seda ei olnud


def test_ankur_ei_kandu_kui_sihtmargil_oli_uks_valjadest():
    source = {BIOGRAPHY_ET: "Allika ET", BIOGRAPHY_EN: "Source EN", SRC_EN: ANKUR}
    target = {BIOGRAPHY_ET: "Sihtmärgi ET"}
    _merge_biography_fields(source, target)
    assert target[SRC_EN] is None


def test_tuhjade_kaartide_liitmine_ei_marki_muutust():
    target = {}
    assert _merge_biography_fields({}, target) is False
