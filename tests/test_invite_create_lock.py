"""Kutse loomine ei kirjuta üle samal ajal tarbitud kutset (#412 p3).

`create_invite_token` luges kutsefaili, lisas kirje ja kirjutas terve faili
tagasi ilma `tokens_lock`-ita. Kui teine lõim tarbis vahepeal kutse,
kirjutati `used: True` vana hetktõmmisega üle ja kutse sai uuesti kasutada.

Lukkude järjekord: `create_invite_token` võtab `tokens_lock` → `users_lock`
(`_next_available_username` → `load_users`). Vastupidist järjekorda ei ole —
`create_user_from_invite` tarbib/taastab kutse väljaspool `users_lock`-i.
"""
import json
import threading
from datetime import datetime, timedelta

import pytest

from server import registration


@pytest.fixture
def fail(tmp_path, monkeypatch):
    tee = tmp_path / "invite_tokens.json"
    monkeypatch.setattr(registration, "INVITE_TOKENS_FILE", str(tee))
    monkeypatch.setattr(registration, "get_cached_collections", lambda: {})
    return tee


def test_samaaegne_tarbimine_ei_kao_kutse_loomisel(fail, monkeypatch):
    fail.write_text(json.dumps({"tokens": [{
        "token": "vana", "email": "vana@example.test", "username": "vana",
        "name": "Vana", "created_at": datetime.now().isoformat(),
        "expires_at": (datetime.now() + timedelta(hours=1)).isoformat(),
        "used": False,
    }]}))

    tulemus = {}

    def tarbi():
        tulemus["viga"] = registration._validate_and_consume_token("vana")[1]

    lõim = threading.Thread(target=tarbi)

    # Tarbimine jookseb keset loomist: faili lugemise ja kirjutamise vahel.
    # Lukuga ootab lõim loomise lõpuni; lukuta jõuaks ta enne kirjutust.
    def nimi_keset_loomist(email, tokens_data=None, preferred_username=None):
        lõim.start()
        lõim.join(0.3)
        return "uus"

    monkeypatch.setattr(registration, "_next_available_username", nimi_keset_loomist)

    registration.create_invite_token("uus@example.test", "Uus", "admin")
    lõim.join(5)
    assert not lõim.is_alive()
    assert tulemus["viga"] is None

    kettal = {t["token"]: t for t in json.loads(fail.read_text())["tokens"]}
    assert kettal["vana"]["used"] is True
    assert any(t["username"] == "uus" for t in kettal.values())
