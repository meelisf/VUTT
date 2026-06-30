"""Helper update_user_allowed_collections — õigus, sisendikontroll, sanitiseerimine, no-op."""
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server import auth

# Fikseeritud kollektsioonid: alpha+beta restricted (alpha enne beta), pub avalik
COLLECTIONS = {
    "alpha": {"name": {"et": "Alfa"}, "visibility": "restricted"},
    "beta": {"name": {"et": "Beeta"}, "visibility": "restricted"},
    "pub": {"name": {"et": "Avalik"}, "visibility": "public"},
}


@pytest.fixture
def env(monkeypatch):
    """Isoleeri helper: mälu-users, spy save_users + delete_user_sessions, fikseeritud collections."""
    users = {
        "admin": {"role": "admin", "name": "Admin"},
        "ed": {"role": "editor", "name": "Ed", "allowed_collections": []},
        "ed2": {"role": "editor", "name": "Ed2", "allowed_collections": ["alpha"]},
    }
    calls = {"save": 0, "sessions": []}
    monkeypatch.setattr(auth, "load_users", lambda: users)
    monkeypatch.setattr(auth, "save_users", lambda u: calls.__setitem__("save", calls["save"] + 1))
    monkeypatch.setattr(auth, "delete_user_sessions", lambda u: calls["sessions"].append(u))
    monkeypatch.setattr(auth, "get_cached_collections", lambda: COLLECTIONS)
    return {"users": users, "calls": calls}


ADMIN = {"username": "admin", "role": "admin"}


def test_admin_sets_restricted(env):
    ok, msg, allowed = auth.update_user_allowed_collections("ed", ["beta", "alpha"], ADMIN)
    assert ok is True
    # deterministlik järjekord = konfi restricted-järjekord (alpha enne beta), MITTE sisendi järjekord
    assert allowed == ["alpha", "beta"]
    assert env["users"]["ed"]["allowed_collections"] == ["alpha", "beta"]
    assert env["calls"]["save"] == 1
    assert env["calls"]["sessions"] == ["ed"]


def test_dedupe_and_order(env):
    ok, _msg, allowed = auth.update_user_allowed_collections("ed", ["beta", "alpha", "beta"], ADMIN)
    assert ok is True
    assert allowed == ["alpha", "beta"]


def test_sanitize_drops_unknown_and_public(env):
    ok, _msg, allowed = auth.update_user_allowed_collections("ed", ["alpha", "pub", "ghost"], ADMIN)
    assert ok is True
    assert allowed == ["alpha"]


def test_non_list_input_rejected(env):
    ok, msg, allowed = auth.update_user_allowed_collections("ed", "alpha", ADMIN)
    assert ok is False
    assert allowed == []
    assert env["calls"]["save"] == 0


def test_non_string_ids_ignored(env):
    ok, _msg, allowed = auth.update_user_allowed_collections("ed", ["alpha", 123, None], ADMIN)
    assert ok is True
    assert allowed == ["alpha"]


def test_empty_username_rejected(env):
    ok, msg, allowed = auth.update_user_allowed_collections("  ", ["alpha"], ADMIN)
    assert ok is False
    assert allowed == []


def test_unknown_user(env):
    ok, msg, allowed = auth.update_user_allowed_collections("ghost", ["alpha"], ADMIN)
    assert ok is False
    assert "ei leitud" in msg.lower()
    assert allowed == []


def test_permission_denied_equal_level(env):
    # admin ei tohi muuta teise admini (ega iseenda) kollektsioone
    ok, msg, allowed = auth.update_user_allowed_collections("admin", ["alpha"], ADMIN)
    assert ok is False
    assert allowed == []
    assert env["calls"]["save"] == 0


def test_noop_no_save_no_session(env):
    # ed2 on juba ["alpha"]; sama tulemus → ei salvesta, ei katkesta sessiooni
    ok, _msg, allowed = auth.update_user_allowed_collections("ed2", ["alpha"], ADMIN)
    assert ok is True
    assert allowed == ["alpha"]
    assert env["calls"]["save"] == 0
    assert env["calls"]["sessions"] == []
