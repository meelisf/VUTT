"""Kustutatud kollektsiooni ID koristus kasutajatelt (#318, ADR 0043).

Lugemisõigus ja kirjutamisulatus on eri teljed, aga kustutatud kogu ID ei ole
kumbki kehtiv õigus. Vana koristus puudutas ainult `allowed_collections`-i ja
jättis `edit_collections`-i inertse jäänuki alles.
"""
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server import auth
from server.routers import collections as col_router


@pytest.fixture
def env(monkeypatch):
    users = {
        "admin": {"role": "admin", "name": "Admin"},
        "ed": {"role": "editor", "allowed_collections": ["kaduv", "jaab"],
               "edit_collections": ["kaduv"]},
        "muu": {"role": "contributor", "allowed_collections": ["jaab"],
                "edit_collections": ["jaab"]},
    }
    salvestusi = {"n": 0}
    monkeypatch.setattr(auth, "load_users", lambda: users)
    monkeypatch.setattr(auth, "save_users",
                        lambda u: salvestusi.__setitem__("n", salvestusi["n"] + 1))
    monkeypatch.setattr(col_router, "save_users", auth.save_users)
    return {"users": users, "salvestusi": salvestusi}


def test_koristab_molemad_valjad(env):
    muutunud = col_router._cleanup_collection_from_users("kaduv")

    assert muutunud == ["ed"]
    assert env["users"]["ed"]["allowed_collections"] == ["jaab"]
    assert env["users"]["ed"]["edit_collections"] == []
    # Teised kasutajad jäävad puutumata
    assert env["users"]["muu"]["allowed_collections"] == ["jaab"]
    assert env["users"]["muu"]["edit_collections"] == ["jaab"]


def test_muutusteta_koristus_ei_salvesta(env):
    muutunud = col_router._cleanup_collection_from_users("puudub")

    assert muutunud == []
    assert env["salvestusi"]["n"] == 0
