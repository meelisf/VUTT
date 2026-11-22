"""Agendi ligipääs adminile (#869, ADR 0058 täiendus).

Superadmin annab või võtab adminilt lipu `agent_access`. Lipp jõuab kutsujani
sessiooni kaudu (ADR 0046), seega kirjutus katkestab sessiooni; äravõtmine
tühistab ka agendikoodid. Lipp kehtib ainult adminil.
"""
import pytest


@pytest.fixture
def auth(monkeypatch):
    import server.auth as auth_mod
    monkeypatch.setattr(auth_mod, "sessions", {})
    users = {
        "su": {"name": "Su", "role": "superadmin"},
        "adm": {"name": "Adm", "role": "admin"},
        "ad2": {"name": "Ad2", "role": "admin"},
        "ed": {"name": "Ed", "role": "editor"},
    }
    monkeypatch.setattr(auth_mod, "_users_cache", users)
    monkeypatch.setattr(auth_mod, "save_users", lambda u: users.update(u))
    revoked = []
    from server import agent_handoff
    monkeypatch.setattr(agent_handoff, "revoke_user", lambda u: revoked.append(u) or 0)
    auth_mod._test_users, auth_mod._test_revoked = users, revoked
    return auth_mod


SU = {"username": "su", "role": "superadmin"}


def _session(auth_mod, token, username):
    auth_mod.sessions[token] = {"user": {"username": username, "role": "admin"},
                                "created_at": "2026-11-22T00:00:00"}


@pytest.mark.parametrize("user, expected", [
    (None, False),
    ({"role": "superadmin"}, True),
    ({"role": "admin"}, False),
    ({"role": "admin", "agent_access": True}, True),
    ({"role": "admin", "agent_access": "true"}, False),    # ainult tõeväärtus
    ({"role": "editor", "agent_access": True}, False),     # lipp ei kehti alla admini
    ({"role": "contributor", "agent_access": True}, False),
])
def test_has_agent_access(user, expected):
    from server.auth import has_agent_access
    assert has_agent_access(user) is expected


def test_andmine_katkestab_sessiooni(auth):
    _session(auth, "t1", "adm")
    _session(auth, "t2", "ad2")
    ok, _ = auth.set_agent_access("adm", True, SU)
    assert ok and auth._test_users["adm"]["agent_access"] is True
    assert "t1" not in auth.sessions and "t2" in auth.sessions
    assert auth._test_revoked == []          # andmine koode ei tühista


def test_aravotmine_tuhistab_koodid(auth):
    auth._test_users["adm"]["agent_access"] = True
    _session(auth, "t1", "adm")
    ok, _ = auth.set_agent_access("adm", False, SU)
    assert ok and "agent_access" not in auth._test_users["adm"]
    assert "t1" not in auth.sessions and auth._test_revoked == ["adm"]


def test_muutuseta_kirjutus_ei_katkesta(auth):
    _session(auth, "t1", "adm")
    ok, _ = auth.set_agent_access("adm", False, SU)
    assert ok and "t1" in auth.sessions and auth._test_revoked == []


@pytest.mark.parametrize("target, actor, enabled", [
    ("adm", {"username": "ad2", "role": "admin", "agent_access": True}, True),  # admin ei anna
    ("ed", SU, True),          # ainult adminile
    ("su", SU, True),          # superadminil on niikuinii
    ("puudub", SU, True),
    ("adm", SU, "jah"),        # ainult tõeväärtus
])
def test_keelatud(auth, target, actor, enabled):
    ok, _ = auth.set_agent_access(target, enabled, actor)
    assert not ok
    assert all("agent_access" not in u for u in auth._test_users.values())


def test_rollimuutus_puhib_lipu(auth):
    auth._test_users["adm"]["agent_access"] = True
    ok, _ = auth.update_user_role("adm", "editor", SU)
    assert ok and "agent_access" not in auth._test_users["adm"]
    # tagasiedutamine ei taasta unustatud õigust
    ok, _ = auth.update_user_role("adm", "admin", SU)
    assert ok and "agent_access" not in auth._test_users["adm"]


def test_lipp_jouab_sessiooni_ja_kasutajate_loendisse(auth, monkeypatch):
    auth._test_users["adm"]["agent_access"] = True
    monkeypatch.setattr(auth, "_verify_and_upgrade", lambda *a: True)
    assert auth.verify_user("adm", "x")["agent_access"] is True
    assert auth.verify_user("ad2", "x")["agent_access"] is False
    loend = {u["username"]: u["agent_access"] for u in auth.get_all_users()}
    assert loend["adm"] is True and loend["ad2"] is False


def test_endpoint_ainult_superadminile(monkeypatch):
    from fastapi import FastAPI, HTTPException
    from fastapi.testclient import TestClient
    from server import deps
    from server.routers import admin as r
    state = {"user": {"username": "ad2", "role": "admin"}}

    async def fake_get_user(request, min_role="contributor"):
        from server.auth import is_at_least
        if not is_at_least(state["user"]["role"], min_role):
            raise HTTPException(status_code=401, detail="Vajab õigusi")
        return state["user"]
    monkeypatch.setattr(deps, "get_user", fake_get_user)
    calls = []
    monkeypatch.setattr(r, "set_agent_access", lambda *a: calls.append(a) or (True, "ok"))
    app = FastAPI()
    app.include_router(r.router)
    c = TestClient(app)
    body = {"username": "adm", "enabled": True}
    assert c.post("/admin/users/agent-access", json=body).status_code == 401
    assert calls == []
    state["user"] = SU
    assert c.post("/admin/users/agent-access", json=body).status_code == 200
    assert calls == [("adm", True, SU)]
