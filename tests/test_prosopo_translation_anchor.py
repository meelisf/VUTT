"""Ankur on KINNITUSE kirje, mitte salvestamise kõrvalmõju (spekk, otsus 5).

Kui ankur uueneks iga EN-välja muudatusega, kustutaks kirjavea parandus
hoiatuse ka siis, kui ET-s muutus vahepeal sünniaasta.
"""
import json
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography import person_crud  # noqa: E402
from server.prosopo_biography_fields import (  # noqa: E402
    BIOGRAPHY_EN, BIOGRAPHY_ET, SRC_EN, SRC_ET, text_hash,
)

ET_TEKST = "Eestikeelne elulugu."
EN_TEKST = "English biography."


@pytest.fixture
def kaart(tmp_path, monkeypatch):
    salvestatud = {}
    seis = {
        "id": "vutt:Pabc", "updated_at": "2026-09-10T10:00:00+00:00",
        "name": {"label": "Test"},
        BIOGRAPHY_ET: ET_TEKST, BIOGRAPHY_EN: EN_TEKST,
        SRC_ET: None, SRC_EN: None,
    }
    monkeypatch.setattr(person_crud, "get_person", lambda pid: dict(seis))
    monkeypatch.setattr(person_crud, "_id_to_path", lambda pid: str(tmp_path / "abc.json"))
    monkeypatch.setattr(person_crud.state, "save_with_git",
                        lambda path, content, username, message=None, **kw:
                        salvestatud.update(person=json.loads(content)))
    monkeypatch.setattr(person_crud, "_indices", lambda: type(
        "I", (), {"_update_index_entry": staticmethod(lambda p: None),
                  "_update_aliases_entry": staticmethod(lambda p: None)})())
    salvestatud["seis"] = seis
    return salvestatud


def _payload(**extra):
    return {"updated_at": "2026-09-10T10:00:00+00:00", **extra}


def test_kinnitus_kirjutab_ankru_teise_keele_rasiga(kaart):
    person_crud.update_person(
        "vutt:Pabc", _payload(_confirm_translation=[BIOGRAPHY_EN]), "kasutaja")
    ankur = kaart["person"][SRC_EN]
    assert ankur["hash"] == text_hash(ET_TEKST)      # EN-ankur kannab ET räsi
    assert ankur["at"].startswith("20")
    assert kaart["person"][SRC_ET] is None           # teine ankur puutumata


def test_salvestamine_ilma_kinnituseta_ei_muuda_ankrut(kaart):
    person_crud.update_person(
        "vutt:Pabc", _payload(**{BIOGRAPHY_EN: "Corrected typo in English."}), "kasutaja")
    assert kaart["person"][SRC_EN] is None


def test_ankur_ei_muutu_ka_siis_kui_lahtetekst_muutus(kaart):
    kaart["seis"][SRC_EN] = {"hash": text_hash(ET_TEKST), "at": "2026-09-01T00:00:00+00:00"}
    person_crud.update_person(
        "vutt:Pabc", _payload(**{BIOGRAPHY_ET: "Muudetud eestikeelne tekst."}), "kasutaja")
    # Ankur jääb VANA räsiga → hoiatus tekib. Just see ongi mõte.
    assert kaart["person"][SRC_EN]["hash"] == text_hash(ET_TEKST)


def test_kinnitus_kasutab_SAMAS_paringus_saadetud_uut_lahteteksti(kaart):
    uus_et = "Toimetaja kirjutas eestikeelse teksti ümber."
    person_crud.update_person(
        "vutt:Pabc",
        _payload(**{BIOGRAPHY_ET: uus_et, BIOGRAPHY_EN: "New English.",
                    "_confirm_translation": [BIOGRAPHY_EN]}),
        "kasutaja")
    assert kaart["person"][SRC_EN]["hash"] == text_hash(uus_et)


def test_tuhja_lahteteksti_vastu_ei_saa_kinnitada(kaart):
    kaart["seis"][BIOGRAPHY_ET] = None
    with pytest.raises(ValueError) as exc:
        person_crud.update_person(
            "vutt:Pabc", _payload(_confirm_translation=[BIOGRAPHY_EN]), "kasutaja")
    assert str(exc.value) == "confirm_without_source"


def test_sihtvalja_tuhjendamine_nullib_tema_ankru(kaart):
    kaart["seis"][SRC_EN] = {"hash": text_hash(ET_TEKST), "at": "2026-09-01T00:00:00+00:00"}
    person_crud.update_person("vutt:Pabc", _payload(**{BIOGRAPHY_EN: None}), "kasutaja")
    assert kaart["person"][SRC_EN] is None


def test_confirm_voti_ei_joua_kaardile(kaart):
    person_crud.update_person(
        "vutt:Pabc", _payload(_confirm_translation=[BIOGRAPHY_EN]), "kasutaja")
    assert "_confirm_translation" not in kaart["person"]
