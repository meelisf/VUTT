"""Kutsekirja tekst tuleb serverist, saaja keeles.

Enne seda oli tekst kõvakodeeritud eesti keeles frontendis mailto: URL-i sees
— ingliskeelne kasutaja sai esimese kirja alati eesti keeles.
"""


def _approve(client, login, backend_env, monkeypatch, language=None, approve_language=None):
    monkeypatch.setattr(backend_env["registration"], "get_cached_collections", lambda: {})
    body = {
        "name": "New User", "email": "new@example.test",
        "motivation": "I would like to help", "gdpr_consent": True,
    }
    if language:
        body["language"] = language
    client.post("/register", json=body)

    admin_token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {admin_token}"}
    reg_id = client.post("/admin/registrations", headers=headers).json()["registrations"][0]["id"]
    payload = {"registration_id": reg_id, "role": "editor", "edit_collections": []}
    if approve_language:
        payload["language"] = approve_language
    res = client.post("/admin/registrations/approve", json=payload, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def test_mail_rendered_in_requested_language(client, login, backend_env, monkeypatch):
    data = _approve(client, login, backend_env, monkeypatch, language="en")
    assert data["language"] == "en"
    assert "activation" in data["mail_subject"].lower()
    assert data["username"] in data["mail_body"]
    assert data["invite_url"] in data["mail_body"]
    assert "$" not in data["mail_body"]


def test_mail_defaults_to_estonian(client, login, backend_env, monkeypatch):
    data = _approve(client, login, backend_env, monkeypatch)
    assert data["language"] == "et"
    assert "aktiveerimise" in data["mail_subject"].lower()


def test_admin_can_override_language_at_approval(client, login, backend_env, monkeypatch):
    """Admin teab, et tegemist on väliskülalisega, kes täitis vormi ET lehel."""
    data = _approve(client, login, backend_env, monkeypatch, language="et", approve_language="en")
    assert data["language"] == "en"
    assert "activation" in data["mail_subject"].lower()


def test_mail_body_contains_absolute_url(client, login, backend_env, monkeypatch):
    """Kirjas peab olema klõpsatav täisaadress, mitte /set-password?token=..."""
    data = _approve(client, login, backend_env, monkeypatch)
    assert data["mail_body"].count("http") >= 1
