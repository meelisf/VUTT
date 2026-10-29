"""Agendikoodi hoidla (ADR 0058 täiendus 2026-10-29, #675): üks tabel, rida liigi kohta."""
import os
import time

import pytest

from server import agent_handoff as ah


class Viga(ValueError):
    pass


def test_ulatus_liik_ja_siht():
    code = ah.issue("ed", "fp", {"parts": ("w1", 5), "person": (None, 9)})["code"]
    assert ah.check(code, "parts", "w1", Viga)["max_uses"] == 5
    assert ah.check(code, "person", "vutt:Pmis", Viga)["session_fingerprint"] == "fp"
    with pytest.raises(Viga, match="invalid_or_expired_handoff"):
        ah.check(code, "parts", "w2", Viga)          # teine teos
    with pytest.raises(Viga, match="invalid_or_expired_handoff"):
        ah.check(code, "text", "w1", Viga)           # liiki ei antud


def test_aegunud_ja_vigane_kood(monkeypatch):
    code = ah.issue("ed", "", {"text": (None, 1)})["code"]
    now = time.time()
    monkeypatch.setattr(ah.time, "time", lambda: now + ah.CODE_TTL + 1)
    with pytest.raises(Viga, match="invalid_or_expired_handoff"):
        ah.check(code, "text", "w1", Viga)
    for bad in (None, "", "x" * 101):
        with pytest.raises(Viga, match="invalid_or_expired_handoff"):
            ah.check(bad, "text", "w1", Viga)


def test_tundmatu_liik_keelatakse():
    with pytest.raises(ValueError, match="invalid_scope"):
        ah.issue("ed", "", {"muu": (None, 1)})


def test_fail_on_varundusele_loetav():
    # Backend kirjutab root'ina, varundus loeb teise kasutajana (#131).
    old = os.umask(0o022)
    try:
        ah.issue("ed", "", {"text": (None, 1)})
    finally:
        os.umask(old)
    mode = os.stat(ah.DB_PATH).st_mode
    assert mode & 0o044 == 0o044 and mode & 0o022 == 0


def test_tuhistus_ilma_andmebaasita_ei_loo_faili():
    assert ah.revoke_user("x") == 0
    assert not os.path.exists(ah.DB_PATH)


def test_kontroll_ilma_andmebaasita_ei_loo_faili():
    with pytest.raises(Viga):
        ah.check("kood", "text", "w1", Viga)
    assert not os.path.exists(ah.DB_PATH)
