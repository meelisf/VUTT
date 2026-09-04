"""Endpoint-tasandi testid: superadmin-tee resetil ja kollektsioonidel."""


def _seed_superadmin(backend_env):
    auth = backend_env["auth"]
    users = auth.load_users()
    users["root"] = {
        "password_hash": auth.hash_password("rootpass"),
        "name": "Root",
        "role": "superadmin",
        "created_at": "2026-01-01T00:00:00",
    }
    auth.save_users(users)


def test_superadmin_can_reset_admin(client, login, backend_env):
    _seed_superadmin(backend_env)
    token = login("root", "rootpass")
    r = client.post(
        "/admin/users/reset-password",
        json={"username": "admin"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text


def test_admin_can_still_reset_editor(client, login):
    # Regressioon: helper-asendus ei tohi adminilt editori-reset õigust võtta
    token = login("admin", "adminpass")
    r = client.post(
        "/admin/users/reset-password",
        json={"username": "editor"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text


def test_admin_cannot_create_collection(client, login):
    token = login("admin", "adminpass")
    r = client.post(
        "/admin/collections",
        json={"id": "x", "name_et": "X", "name_en": "X"},
        headers={"Authorization": f"Bearer {token}"},
    )
    # require_role("superadmin") ebaõnnestumisel tõstab deps.get_user HTTPException(401)
    assert r.status_code == 401


def test_superadmin_can_create_collection(client, login, backend_env):
    _seed_superadmin(backend_env)
    token = login("root", "rootpass")
    r = client.post(
        "/admin/collections",
        json={"id": "testcoll", "name_et": "Test", "name_en": "Test"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text


def _patch_editable_collections(monkeypatch):
    """Anna cache'ile üks AVALIK kogu 'sample'.

    edit_collections (kirjutamisulatus) kehtib kõigile kollektsioonidele, mitte
    ainult restricted omadele nagu allowed_collections (lugemispiirang) — seepärast
    on siin tahtlikult ainult public-nähtavusega kogu.
    """
    from server import auth
    monkeypatch.setattr(auth, "get_cached_collections", lambda: {
        "sample": {"name": {"et": "Näidis"}, "visibility": "public"},
    })


def test_admin_sets_edit_collections(client, login, backend_env, monkeypatch):
    _patch_editable_collections(monkeypatch)
    token = login("admin", "adminpass")
    response = client.post(
        "/admin/users/update-edit-collections",
        json={"username": "editor", "edit_collections": ["sample"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["edit_collections"] == ["sample"]


def test_edit_collections_sanitizes_unknown_ids(client, login, backend_env, monkeypatch):
    """Tundmatu kollektsiooni-id ei tohi salvestuda."""
    _patch_editable_collections(monkeypatch)
    token = login("admin", "adminpass")
    response = client.post(
        "/admin/users/update-edit-collections",
        json={"username": "editor", "edit_collections": ["sample", "olematu"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.json()["edit_collections"] == ["sample"]


def test_edit_collections_change_invalidates_sessions(client, login, backend_env, monkeypatch):
    """Ulatuse muutus peab lõpetama kasutaja sessiooni — muidu jääks vana ulatus 24h."""
    _patch_editable_collections(monkeypatch)
    editor_token = login("editor", "editorpass")
    admin_token = login("admin", "adminpass")
    client.post(
        "/admin/users/update-edit-collections",
        json={"username": "editor", "edit_collections": ["sample"]},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    verify = client.post("/verify-token", json={"token": editor_token})
    assert verify.json()["valid"] is False
