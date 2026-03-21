import json


def test_login_and_verify_token_roundtrip(client, login):
    token = login("admin", "adminpass")

    response = client.post("/verify-token", json={"token": token})

    assert response.status_code == 200
    assert response.json() == {
        "status": "success",
        "user": {
            "username": "admin",
            "name": "Admin User",
            "role": "admin",
        },
        "valid": True,
    }


def test_user_chars_roundtrip_with_bearer_token(client, login, backend_env):
    token = login("editor", "editorpass")
    headers = {"Authorization": f"Bearer {token}"}

    save_response = client.post("/user-chars", headers=headers, json={"characters": ["þ", "æ"]})
    fetch_response = client.get("/user-chars", headers=headers)

    assert save_response.status_code == 200
    assert save_response.json() == {"status": "success"}
    assert fetch_response.status_code == 200
    assert fetch_response.json() == {
        "status": "success",
        "characters": ["þ", "æ"],
        "is_custom": True,
    }

    saved_file = backend_env["user_chars_dir"] / "editor.json"
    assert json.loads(saved_file.read_text(encoding="utf-8")) == {"characters": ["þ", "æ"]}


def test_invite_set_password_consumes_token_once(client, backend_env):
    # Kolmas argument on created_by (kutsuva admini nimi), mitte uue kasutaja roll.
    # Kõik invite-kasutajad saavad alati "editor" rolli (hardcoded create_user_from_invite).
    invite = backend_env["registration"].create_invite_token(
        "new.user@example.test",
        "New User",
        "admin",
    )

    first_response = client.post(
        "/invite/set-password",
        json={"token": invite["token"], "password": "secret123"},
    )
    second_response = client.post(
        "/invite/set-password",
        json={"token": invite["token"], "password": "another-secret"},
    )

    assert first_response.status_code == 200
    assert first_response.json() == {
        "status": "success",
        "username": "newuser",
    }
    assert second_response.status_code == 400
    assert second_response.json()["detail"] == "Token on juba kasutatud"

    users = json.loads(backend_env["users_file"].read_text(encoding="utf-8"))
    assert "newuser" in users
    assert users["newuser"]["role"] == "editor"
    assert users["newuser"]["email"] == "new.user@example.test"


def test_admin_collection_update_writes_json(client, login, backend_env):
    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.put(
        "/admin/collections/sample",
        headers=headers,
        json={
            "description": {"et": "Luhikirjeldus", "en": "Short description"},
            "description_long": {"et": "Pikem kirjeldus", "en": "Longer description"},
            "color": "#123456",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"status": "success"}

    collections = json.loads(backend_env["collections_file"].read_text(encoding="utf-8"))
    assert collections["sample"]["description"] == {
        "et": "Luhikirjeldus",
        "en": "Short description",
    }
    assert collections["sample"]["description_long"] == {
        "et": "Pikem kirjeldus",
        "en": "Longer description",
    }
    assert collections["sample"]["color"] == "#123456"


def test_admin_upload_status_returns_staged_state(client, login, make_upload):
    _, state = make_upload(
        "upl123",
        status="pending",
        expected_pages=3,
        files=[
            {
                "page": 1,
                "filename": "001.jpg",
                "has_ocr": False,
                "deleted": False,
            }
        ],
    )
    token = login("admin", "adminpass")

    response = client.get(
        f"/admin/upload/{state['id']}/status",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "pending",
        "expected_pages": 3,
        "files": state["files"],
        "ready": 0,
        "total": 0,
        "progress": {},
        "error": None,
    }


def test_admin_upload_thumb_serves_file_with_legacy_query_token(client, login, make_upload):
    upload_dir, state = make_upload("upl456")
    thumb_path = upload_dir / "thumbs" / "001.jpg"
    thumb_bytes = b"fake-jpeg-bytes"
    thumb_path.write_bytes(thumb_bytes)
    token = login("admin", "adminpass")

    response = client.get(f"/admin/upload/{state['id']}/thumb/1?token={token}")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content == thumb_bytes
