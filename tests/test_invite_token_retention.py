"""Kasutatud ja aegunud kutsed kustuvad 30 päeva pärast (#399).

Kutsekirje kannab kutsutu nime, e-posti ja kasutajanime. Kasutatud kutse
info elab edasi kasutajakontos; kasutamata ja aegunud kutse puhul on kirje
ainus jälg. Sama muster mis #300 (`test_registration_retention.py`).
"""
import json
from datetime import datetime, timedelta

import pytest

from server import registration


@pytest.fixture
def fail(tmp_path, monkeypatch):
    tee = tmp_path / "invite_tokens.json"
    monkeypatch.setattr(registration, "INVITE_TOKENS_FILE", str(tee))
    return tee


def _aeg(paevi):
    """Ajatempel `paevi` päeva tagasi (negatiivne = tulevikus)."""
    return (datetime.now() - timedelta(days=paevi)).isoformat()


def _kutse(nimi, expires_at, used=False, used_at=None):
    kirje = {"token": nimi, "email": f"{nimi}@example.test", "username": nimi,
             "name": nimi, "created_at": "2026-01-01T00:00:00",
             "expires_at": expires_at, "used": used}
    if used_at is not None:
        kirje["used_at"] = used_at
    return kirje


def _kettal(fail):
    return [t["token"] for t in json.loads(fail.read_text())["tokens"]]


def test_vanad_kasutatud_ja_aegunud_kutsed_kustuvad_failist(fail):
    fail.write_text(json.dumps({"tokens": [
        _kutse("kasutatud-vana", _aeg(40), used=True, used_at=_aeg(41)),
        _kutse("kasutatud-uus", _aeg(20), used=True, used_at=_aeg(21)),
        _kutse("aegunud-vana", _aeg(31)),
        _kutse("aegunud-uus", _aeg(29)),
        _kutse("kehtiv", _aeg(-1)),
    ]}))

    nahtav = [t["token"] for t in registration.load_invite_tokens()["tokens"]]

    assert nahtav == ["kasutatud-uus", "aegunud-uus", "kehtiv"]
    # Puhastus peab jõudma kettale: kustutamise mõte on, et andmeid
    # serveris enam ei ole.
    assert _kettal(fail) == ["kasutatud-uus", "aegunud-uus", "kehtiv"]


def test_kasutatud_kutse_aeg_tuleb_kasutamisest_mitte_aegumisest(fail):
    """Kutse kasutati 31 päeva tagasi, aga aegumine oli 29 päeva tagasi
    (kunstlik, kuid näitab, et kasutatud kirjel loeb `used_at`)."""
    fail.write_text(json.dumps({"tokens": [
        _kutse("k", _aeg(29), used=True, used_at=_aeg(31)),
    ]}))

    assert registration.load_invite_tokens()["tokens"] == []


def test_used_at_puudumisel_loeb_aegumine(fail):
    """Vana kirje ilma `used_at`-ita: kasutamine juhtus enne aegumist,
    seega `expires_at` on konservatiivne (hilisem) ankur."""
    fail.write_text(json.dumps({"tokens": [
        _kutse("vana", _aeg(31), used=True),
        _kutse("uus", _aeg(29), used=True),
    ]}))

    assert [t["token"] for t in registration.load_invite_tokens()["tokens"]] == ["uus"]


def test_parssimata_kirjed_jaavad_alles(fail):
    fail.write_text(json.dumps({"tokens": [
        _kutse("katki", "eile"),
        _kutse("katki-kasutatud", _aeg(40), used=True, used_at="eile"),
        {"token": "ilma-ajata", "used": False},
    ]}))

    assert [t["token"] for t in registration.load_invite_tokens()["tokens"]] == [
        "katki", "katki-kasutatud", "ilma-ajata"]


def test_puhastuseta_laadimine_ei_kirjuta(fail, monkeypatch):
    fail.write_text(json.dumps({"tokens": [_kutse("kehtiv", _aeg(-1))]}))
    monkeypatch.setattr(registration, "atomic_write_json",
                        lambda *a, **k: pytest.fail("lugemine ei tohi kirjutada"))

    registration.load_invite_tokens()


def test_tarbimise_rollback_tootab_parast_puhastust(fail):
    """`_validate_and_consume_token` / `_unconsume_token` loevad faili otse.
    Vahepeal jooksnud puhastus ei tohi värskelt tarbitud kutset ära viia."""
    fail.write_text(json.dumps({"tokens": [
        _kutse("vana", _aeg(40)),
        _kutse("kehtiv", _aeg(-1)),
    ]}))

    token_data, viga = registration._validate_and_consume_token("kehtiv")
    assert viga is None and token_data["used"] is True

    registration.load_invite_tokens()  # puhastus jookseb vahepeal
    registration._unconsume_token("kehtiv")

    kirjed = json.loads(fail.read_text())["tokens"]
    assert [t["token"] for t in kirjed] == ["kehtiv"]
    assert kirjed[0]["used"] is False and "used_at" not in kirjed[0]
