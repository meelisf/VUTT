"""Vana vorm ei tohi `biography` välja tagasi tekitada (spekk, „Pärandvälja reegel").

`update_person` teeb `person.update(data)` — ilma reeglita kirjutaks vana avatud
vorm välja uuesti ka pärast passi B ja skeem lahkneks vaikselt.
"""
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography import person_crud  # noqa: E402
from server.prosopo_biography_fields import BIOGRAPHY_ET, SRC_EN, SRC_ET  # noqa: E402


def _build_kaart(monkeypatch, tmp_path, person):
    """Ehitab ühe salvestatud kaardi; `save_with_git` ja indeksid on mockitud.

    Jagatud `kaart`-fikstuuri ja erijuhtude testide (nt puuduva `biography`-ga
    kaart) vahel, et mock'imismuster ei duplikeeruks.
    """
    salvestatud = {}
    monkeypatch.setattr(person_crud, "get_person", lambda pid: dict(person))
    monkeypatch.setattr(person_crud, "_id_to_path", lambda pid: str(tmp_path / "abc.json"))

    def _save(path, content, username, message=None, **kw):
        import json
        salvestatud["person"] = json.loads(content)

    monkeypatch.setattr(person_crud.state, "save_with_git", _save)
    monkeypatch.setattr(person_crud, "_indices", lambda: type(
        "I", (), {"_update_index_entry": staticmethod(lambda p: None),
                  "_update_aliases_entry": staticmethod(lambda p: None)})())
    return salvestatud


@pytest.fixture
def kaart(tmp_path, monkeypatch):
    """Üks salvestatud kaart; `save_with_git` ja indeksid on mockitud."""
    person = {
        "id": "vutt:Pabc", "updated_at": "2026-09-10T10:00:00+00:00",
        "name": {"label": "Test"}, BIOGRAPHY_ET: "Eesti tekst.",
        "biography": "Eesti tekst.",
    }
    return _build_kaart(monkeypatch, tmp_path, person)


# NB: `update_person` kutsub lisaks `sync_from_facade()`, `person_lock()` ja
# `fill_person_labels_from_registry()`. Kui mõni neist puudutab failisüsteemi ja
# test kukub selle taha, patchi ka need — vaata `tests/test_prosopography_ops.py`
# olemasolevaid fikstuure ja korda sealset mustrit, ära leiuta uut.


def _payload(**extra):
    return {"updated_at": "2026-09-10T10:00:00+00:00", **extra}


def test_identne_parandvali_visatakse_vaikselt_maha(kaart):
    person_crud.update_person("vutt:Pabc", _payload(biography="Eesti tekst."), "kasutaja")
    # Salvestatud kaart kannab endiselt vana väärtust (`person`-ist), aga
    # kliendi saadetu ei ole seda üle kirjutanud ega uut võtit tekitanud.
    assert kaart["person"]["biography"] == "Eesti tekst."


def test_erinev_parandvali_annab_vea(kaart):
    with pytest.raises(ValueError) as exc:
        person_crud.update_person(
            "vutt:Pabc", _payload(biography="Keegi muutis vanas vormis."), "kasutaja")
    assert str(exc.value) == "legacy_biography_changed"
    assert "person" not in kaart          # midagi ei salvestatud


def test_kliendi_saadetud_ankur_visatakse_ara(kaart):
    person_crud.update_person(
        "vutt:Pabc",
        _payload(**{SRC_EN: {"hash": "deadbeefcafe", "at": "2020-01-01T00:00:00+00:00"}}),
        "kasutaja")
    assert kaart["person"].get(SRC_EN) is None


def test_parandvalja_puudumine_ei_sega(kaart):
    person_crud.update_person("vutt:Pabc", _payload(**{BIOGRAPHY_ET: "Uus tekst."}), "kasutaja")
    assert kaart["person"][BIOGRAPHY_ET] == "Uus tekst."


def test_rikastus_ei_saa_parandvalja_tagasi_tekitada(kaart):
    person_crud.apply_enrichment(
        "vutt:Pabc", {"biography": "Rikastus üritab", "_enrichment_scheme": "album_academicum"},
        "kasutaja")
    assert kaart["person"].get("biography") == "Eesti tekst."   # muutumatu, mitte üle kirjutatud


def test_rikastus_ei_saa_ankrut_voltsida(kaart):
    """Klient ei tohi `/enrich` kaudu ise „originaaltekst ei ole muutunud" kinnitust kirjutada.

    `apply_enrichment` teeb `_deep_set`-i suvaliste `{field_path: value}` paaride
    peal — ankur on SERVERI TULETIS ka siin, mitte ainult `update_person`-is.
    """
    person_crud.apply_enrichment(
        "vutt:Pabc",
        {SRC_ET: {"hash": "deadbeefcafe", "at": "2026-09-10T00:00:00+00:00"},
         "_enrichment_scheme": "album_academicum"},
        "kasutaja")
    assert kaart["person"].get(SRC_ET) is None


def test_tyhi_string_puuduva_salvestatud_vaartuse_vastu_ei_anna_vea(tmp_path, monkeypatch):
    """Vana vorm tühja tekstiväljaga vs juba migreeritud kaart (`biography` puudub).

    `(saadetud or None) != (salvestatud or None)` normaliseerib mõlemad
    „tühjaks" — see peab jääma vaikseks mahatõmbamiseks, mitte 409-ks.
    """
    person = {
        "id": "vutt:Pabc", "updated_at": "2026-09-10T10:00:00+00:00",
        "name": {"label": "Test"}, BIOGRAPHY_ET: "Eesti tekst.",
        # `biography` PUUDUB täielikult — kaart on juba migreeritud.
    }
    salvestatud = _build_kaart(monkeypatch, tmp_path, person)

    person_crud.update_person("vutt:Pabc", _payload(biography=""), "kasutaja")

    assert "biography" not in salvestatud["person"]
