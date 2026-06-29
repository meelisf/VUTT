"""Parooli-reset endpointide integratsioonitestid (TestClient).

Kasutab conftest backend_env fikstuuri (admin, editor kasutajad).
"""


def test_admin_reset_password_loob_lingi(client, login):
    token = login("admin", "adminpass")
    resp = client.post("/admin/users/reset-password", json={"username": "editor"},
                       headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert "reset_url" in data and "reset=1" in data["reset_url"]
    assert data["username"] == "editor"


def test_admin_reset_password_olematu_kasutaja_404(client, login):
    token = login("admin", "adminpass")
    resp = client.post("/admin/users/reset-password", json={"username": "puudub"},
                       headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 404


def test_admin_reset_password_teist_admini_keelab_403(client, login, backend_env):
    # Lisa teine admin
    auth = backend_env["auth"]
    users = auth.load_users()
    users["admin2"] = {"password_hash": auth.hash_password("admin2pass"),
                       "name": "Admin Two", "role": "admin", "created_at": "2026-01-01T00:00:00"}
    auth.save_users(users)
    token = login("admin", "adminpass")
    resp = client.post("/admin/users/reset-password", json={"username": "admin2"},
                       headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_admin_reset_password_iseennast_lubab(client, login):
    token = login("admin", "adminpass")
    resp = client.post("/admin/users/reset-password", json={"username": "admin"},
                       headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


def test_reset_password_nouab_admini(client, login):
    token = login("editor", "editorpass")
    resp = client.post("/admin/users/reset-password", json={"username": "editor"},
                       headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401  # require_role("admin") → get_user 401


def test_reset_validate_ja_set_password_full_flow(client, login):
    admin = login("admin", "adminpass")
    gen = client.post("/admin/users/reset-password", json={"username": "editor"},
                      headers={"Authorization": f"Bearer {admin}"}).json()
    # reset_url = /set-password?token=<uuid>&reset=1 — eralda token
    reset_token = gen["reset_url"].split("token=")[1].split("&")[0]

    # Valideeri (avalik POST body)
    v = client.post("/reset/validate", json={"token": reset_token})
    assert v.status_code == 200
    vd = v.json()
    assert vd["valid"] is True and vd["username"] == "editor"

    # Sea uus parool
    sp = client.post("/reset/set-password", json={"token": reset_token, "password": "uusparool1234"})
    assert sp.status_code == 200
    assert sp.json()["status"] == "success"

    # Uue parooliga login töötab
    ok = client.post("/login", json={"username": "editor", "password": "uusparool1234"})
    assert ok.status_code == 200 and ok.json()["status"] == "success"


def test_reset_validate_vigane_token(client):
    v = client.post("/reset/validate", json={"token": "ei-eksisteeri"})
    assert v.status_code == 200
    assert v.json()["valid"] is False


def test_reset_set_password_nork_parool_400(client, login):
    admin = login("admin", "adminpass")
    gen = client.post("/admin/users/reset-password", json={"username": "editor"},
                      headers={"Authorization": f"Bearer {admin}"}).json()
    reset_token = gen["reset_url"].split("token=")[1].split("&")[0]
    sp = client.post("/reset/set-password", json={"token": reset_token, "password": "lyhike"})
    assert sp.status_code == 400
