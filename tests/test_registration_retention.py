"""Läbivaadatud registreerimistaotlused kustuvad 30 päeva pärast (#300).

Taotlus kannab isikuandmeid ja vaba tekstina motivatsiooni. Kinnitatud
taotluse info elab edasi kasutajakontos; tagasi lükatud taotlusel ei ole
VUTT-iga enam mingit seost. `pending` on tegevusootel, mitte ajalugu.
"""
import json
from datetime import datetime, timedelta

import pytest

from server import registration


@pytest.fixture
def fail(tmp_path, monkeypatch):
    tee = tmp_path / "pending_registrations.json"
    monkeypatch.setattr(registration, "PENDING_REGISTRATIONS_FILE", str(tee))
    return tee


def _kirje(reg_id, status, reviewed_at):
    return {"id": reg_id, "name": reg_id, "email": f"{reg_id}@example.test",
            "status": status, "submitted_at": "2026-01-01T00:00:00",
            "reviewed_by": "admin" if reviewed_at else None,
            "reviewed_at": reviewed_at}


def _paev_tagasi(paevi):
    return (datetime.now() - timedelta(days=paevi)).isoformat()


def test_vana_labivaadatud_kirje_kustub_failist(fail):
    fail.write_text(json.dumps({"registrations": [
        _kirje("vana-ok", "approved", _paev_tagasi(31)),
        _kirje("vana-ei", "rejected", _paev_tagasi(45)),
        _kirje("uus-ei", "rejected", _paev_tagasi(29)),
    ]}))

    nahtav = [r["id"] for r in registration.load_pending_registrations()["registrations"]]

    assert nahtav == ["uus-ei"]
    # Puhastus peab jõudma kettale, mitte ainult vaatesse: kustutamise
    # mõte on, et andmeid serveris enam ei ole.
    kettal = [r["id"] for r in json.loads(fail.read_text())["registrations"]]
    assert kettal == ["uus-ei"]


def test_ootel_ja_parssimata_kirjed_jaavad_alles(fail):
    fail.write_text(json.dumps({"registrations": [
        _kirje("ootel-vana", "pending", None),
        _kirje("katki", "rejected", "eile"),
        _kirje("puudub", "approved", None),
    ]}))

    nahtav = [r["id"] for r in registration.load_pending_registrations()["registrations"]]

    assert nahtav == ["ootel-vana", "katki", "puudub"]


def test_puhastuseta_laadimine_ei_kirjuta(fail, monkeypatch):
    fail.write_text(json.dumps({"registrations": [
        _kirje("uus", "approved", _paev_tagasi(1)),
    ]}))
    monkeypatch.setattr(registration, "atomic_write_json",
                        lambda *a, **k: pytest.fail("lugemine ei tohi kirjutada"))

    registration.load_pending_registrations()
