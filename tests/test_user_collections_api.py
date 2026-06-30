"""Endpoint-tasandi testid: POST /admin/users/update-collections."""


def _patch_restricted(monkeypatch):
    """Anna cache'ile üks restricted-kogu 'r1' (ja avalik 'pub'), et sanitiseerimist näha."""
    from server import auth
    monkeypatch.setattr(auth, "get_cached_collections", lambda: {
        "r1": {"name": {"et": "R1"}, "visibility": "restricted"},
        "pub": {"name": {"et": "Avalik"}, "visibility": "public"},
    })


def test_admin_updates_collections(client, login, backend_env, monkeypatch):
    _patch_restricted(monkeypatch)
    token = login("admin", "adminpass")
    r = client.post(
        "/admin/users/update-collections",
        json={"username": "editor", "allowed_collections": ["r1", "pub", "ghost"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    # Server sanitiseerib: ainult restricted 'r1' jääb alles, vastus on tõe allikas
    assert r.json()["allowed_collections"] == ["r1"]


def test_editor_cannot_call_endpoint(client, login, backend_env):
    # require_role("admin") ebaõnnestumisel tõstab deps.get_user HTTPException(401)
    token = login("editor", "editorpass")
    r = client.post(
        "/admin/users/update-collections",
        json={"username": "editor", "allowed_collections": []},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 401


def test_admin_cannot_edit_equal_level(client, login, backend_env, monkeypatch):
    _patch_restricted(monkeypatch)
    token = login("admin", "adminpass")
    # admin proovib muuta iseenda (admin-tase) kollektsioone → helper keeldub → 400
    r = client.post(
        "/admin/users/update-collections",
        json={"username": "admin", "allowed_collections": ["r1"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400
