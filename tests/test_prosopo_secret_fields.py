"""Isikukaardilt EI TOHI avalikku vastusesse jõuda sessioonitokenit (#237).

Taust: `GET /api/files/prosopography/{id}` on autentimata avalik endpoint ja
tagastas salvestatud JSON-i tervikuna. 47 kaardil 2367-st oli väljal
`auth_token` kellegi sessioonitoken, mis oli kunagi PUT-keha kaudu kaardi
külge salvestunud. Kirjutusteel oli osaline kaitse (`update_person` popib
sissetulevast kehast), aga see EI eemaldanud juba salvestatud välja —
`person.update(data)` jättis vana väärtuse alles.

Parandus on lugemisteel: `get_person` on ainus madalatasandiline kaardilugeja,
seega filter seal katab kõik tarbijad (avalik GET, seosed, merge, enrich).
"""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

SECRET_FIELDS = ("auth_token", "token")


def _write_card(tmp_path, monkeypatch, extra: dict):
    from server.prosopography import person_crud

    prosopo_dir = tmp_path / "prosopography"
    prosopo_dir.mkdir()
    card = {
        "id": "vutt:Pabc123",
        "name": {"label": "Test Isik"},
        "updated_at": "2026-01-01T00:00:00+00:00",
    }
    card.update(extra)
    (prosopo_dir / "abc123.json").write_text(
        json.dumps(card, ensure_ascii=False), encoding="utf-8"
    )
    monkeypatch.setattr(person_crud.state, "PROSOPOGRAPHY_DIR", str(prosopo_dir))
    monkeypatch.setattr(person_crud, "sync_from_facade", lambda: None)
    return person_crud, prosopo_dir


@pytest.mark.parametrize("field", SECRET_FIELDS)
def test_get_person_ei_tagasta_salajast_valja(tmp_path, monkeypatch, field):
    """Failis olev auth_token/token ei tohi lugemisel vastusesse jõuda."""
    crud, _ = _write_card(tmp_path, monkeypatch,
                          {field: "11111111-2222-3333-4444-555555555555"})

    person = crud.get_person("vutt:Pabc123")

    assert person is not None
    assert field not in person


def test_get_person_ei_muuda_faili(tmp_path, monkeypatch):
    """Lugemine on side-effect-vaba: filter ei kirjuta faili ümber."""
    crud, prosopo_dir = _write_card(tmp_path, monkeypatch,
                                    {"auth_token": "11111111-2222-3333"})
    before = (prosopo_dir / "abc123.json").read_text(encoding="utf-8")

    crud.get_person("vutt:Pabc123")

    assert (prosopo_dir / "abc123.json").read_text(encoding="utf-8") == before


def test_get_person_sailitab_ulejaanud_valjad(tmp_path, monkeypatch):
    """Filter eemaldab AINULT salajased väljad."""
    crud, _ = _write_card(tmp_path, monkeypatch, {
        "auth_token": "11111111-2222-3333",
        "biography": "Elulugu",
        "identifiers": [{"scheme": "wikidata", "id": "Q1"}],
    })

    person = crud.get_person("vutt:Pabc123")

    assert person["biography"] == "Elulugu"
    assert person["identifiers"] == [{"scheme": "wikidata", "id": "Q1"}]
    assert person["name"]["label"] == "Test Isik"


def test_get_person_with_works_ei_tagasta_salajast_valja(tmp_path, monkeypatch):
    """Avaliku GET-i tegelik tee (`relations.get_person_with_works`) on kaetud."""
    crud, _ = _write_card(tmp_path, monkeypatch,
                          {"auth_token": "11111111-2222-3333"})
    from server.prosopography import relations

    monkeypatch.setattr(relations, "sync_from_facade", lambda: None)
    monkeypatch.setattr(relations, "_load_person_to_works", lambda: {})

    person = relations.get_person_with_works("vutt:Pabc123")

    assert person is not None
    assert "auth_token" not in person
    assert person["works"] == []


def test_secret_fields_loend_on_kirjutus_ja_lugemisteel_sama():
    """SECRET_FIELDS on üks allikas — pop-loend update_person'is tuleb sealt."""
    from server.prosopography import person_crud

    assert person_crud.SECRET_FIELDS == SECRET_FIELDS


# ---- puhastusskripti testid ----

def _load_strip_script():
    spec = importlib.util.spec_from_file_location(
        "strip_person_auth_tokens_script",
        PROJECT_ROOT / "scripts" / "strip_person_auth_tokens.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run_script(tmp_path, monkeypatch, cards: dict, argv: list):
    """Kirjutab kaardid ajutisse kausta ja jooksutab skripti main()-i."""
    mod = _load_strip_script()
    prosopo_dir = tmp_path / "prosopography"
    prosopo_dir.mkdir()
    for name, card in cards.items():
        (prosopo_dir / name).write_text(
            json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    monkeypatch.setattr(mod, "_prosopo_dir", lambda: str(prosopo_dir))
    monkeypatch.setattr(sys, "argv", ["strip_person_auth_tokens.py"] + argv)
    assert mod.main() == 0
    return prosopo_dir


def test_skript_dry_run_ei_kirjuta(tmp_path, monkeypatch):
    """Vaikimisi on dry-run: fail jääb puutumata."""
    cards = {"a.json": {"id": "vutt:Pa", "auth_token": "tok-1"}}
    prosopo_dir = _run_script(tmp_path, monkeypatch, cards, ["--dry-run"])

    data = json.loads((prosopo_dir / "a.json").read_text(encoding="utf-8"))
    assert data["auth_token"] == "tok-1"


def test_skript_apply_eemaldab_salajased_valjad(tmp_path, monkeypatch):
    cards = {
        "a.json": {"id": "vutt:Pa", "auth_token": "tok-1", "biography": "Elu"},
        "b.json": {"id": "vutt:Pb", "token": "tok-2"},
        "c.json": {"id": "vutt:Pc", "biography": "Puhas"},
    }
    prosopo_dir = _run_script(tmp_path, monkeypatch, cards, ["--apply"])

    a = json.loads((prosopo_dir / "a.json").read_text(encoding="utf-8"))
    b = json.loads((prosopo_dir / "b.json").read_text(encoding="utf-8"))
    c = json.loads((prosopo_dir / "c.json").read_text(encoding="utf-8"))
    assert "auth_token" not in a and a["biography"] == "Elu"
    assert "token" not in b and b["id"] == "vutt:Pb"
    assert c == {"id": "vutt:Pc", "biography": "Puhas"}


def test_skript_ei_kirjuta_puutumata_faile_umber(tmp_path, monkeypatch):
    """Ilma salajase väljata fail peab jääma baidi-identseks (ei tekita git-müra)."""
    cards = {"c.json": {"id": "vutt:Pc", "biography": "Puhas"}}
    prosopo_dir = tmp_path / "prosopography"
    mod = _load_strip_script()
    prosopo_dir.mkdir()
    path = prosopo_dir / "c.json"
    # Tahtlikult teistsugune vorming kui skripti dump — kui skript selle üle
    # kirjutaks, muutuks sisu.
    path.write_text(json.dumps(cards["c.json"]), encoding="utf-8")
    before = path.read_text(encoding="utf-8")

    monkeypatch.setattr(mod, "_prosopo_dir", lambda: str(prosopo_dir))
    monkeypatch.setattr(sys, "argv", ["strip_person_auth_tokens.py", "--apply"])
    assert mod.main() == 0

    assert path.read_text(encoding="utf-8") == before


def test_skript_ei_trukki_tokeni_vaartust(tmp_path, monkeypatch, capsys):
    """Väljundis tohib olla pikkus, mitte väärtus."""
    secret = "11111111-2222-3333-4444-555555555555"
    cards = {"a.json": {"id": "vutt:Pa", "auth_token": secret}}
    _run_script(tmp_path, monkeypatch, cards, ["--apply"])

    out = capsys.readouterr().out
    assert secret not in out
    assert "36 märki" in out

