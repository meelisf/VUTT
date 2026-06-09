"""
Testid sessioonide invalideerimisele rolli/ligipääsu muutmisel (Leid I).

Kaetud käitumine:
- update_user_role kustutab kasutaja aktiivsed sessioonid (uus roll jõustub kohe)
- delete_user kustutab kasutaja sessioonid (kasutab sama abifunktsiooni)
- delete_user_sessions puudutab ainult sihtkasutajat, mitte teisi
"""
import pytest


@pytest.fixture
def auth(monkeypatch):
    import server.auth as auth_mod
    # Puhas sessioonitabel iga testi jaoks
    monkeypatch.setattr(auth_mod, "sessions", {})
    users = {
        "bob": {"name": "Bob", "role": "editor", "allowed_collections": []},
        "alice": {"name": "Alice", "role": "admin", "allowed_collections": []},
    }
    monkeypatch.setattr(auth_mod, "_users_cache", users)
    monkeypatch.setattr(auth_mod, "save_users", lambda u: users.update(u))
    return auth_mod


def _add_session(auth_mod, token, username):
    auth_mod.sessions[token] = {
        "user": {"username": username, "role": "editor", "allowed_collections": []},
        "created_at": "2026-06-09T00:00:00",
    }


def test_delete_user_sessions_targets_only_username(auth):
    _add_session(auth, "t1", "bob")
    _add_session(auth, "t2", "bob")
    _add_session(auth, "t3", "alice")
    n = auth.delete_user_sessions("bob")
    assert n == 2
    assert "t1" not in auth.sessions and "t2" not in auth.sessions
    assert "t3" in auth.sessions


def test_update_user_role_invalidates_sessions(auth):
    _add_session(auth, "tb", "bob")
    admin = {"username": "alice", "role": "admin"}
    ok, _ = auth.update_user_role("bob", "admin", admin)
    assert ok is True
    # Bob peab uuesti sisse logima — sessioon kustutatud
    assert "tb" not in auth.sessions
    # Roll on uuendatud
    assert auth._users_cache["bob"]["role"] == "admin"


def test_delete_user_removes_sessions(auth):
    _add_session(auth, "tb", "bob")
    admin = {"username": "alice", "role": "admin"}
    ok, _ = auth.delete_user("bob", admin)
    assert ok is True
    assert "tb" not in auth.sessions
    assert "bob" not in auth._users_cache


def test_update_user_role_no_sessions_is_safe(auth):
    """Rolli muutmine ilma aktiivse sessioonita ei tohi viga anda."""
    admin = {"username": "alice", "role": "admin"}
    ok, _ = auth.update_user_role("bob", "contributor", admin)
    assert ok is True
