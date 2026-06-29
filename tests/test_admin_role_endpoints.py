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
