"""Keel kandub vormilt kontoni: taotlus → token → users.json.

Ahel on neljakihiline ja iga kiht on eraldi fail; kui üks lüli keele maha
jätab, ei ole seda hiljem kuskilt võtta — inimene ei ole veel sisse loginud.
"""
import json


def _patch_registration_collections(backend_env, monkeypatch, collections_config):
    """Vt tests/test_registration_flow.py — `registration.py` impordib
    `get_cached_collections` OTSE, seega patchitakse see nimi, mitte fail."""
    monkeypatch.setattr(backend_env["registration"], "get_cached_collections", lambda: collections_config)


def _register_and_approve(client, login, backend_env, monkeypatch, register_body, approve_body=None):
    _patch_registration_collections(backend_env, monkeypatch, {"sample": {"name": {"et": "Näidis", "en": "Sample"}}})
    client.post("/register", json=register_body)
    admin_token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {admin_token}"}
    listing = client.post("/admin/registrations", headers=headers)
    reg = listing.json()["registrations"][0]
    body = {"registration_id": reg["id"], "role": "editor", "edit_collections": []}
    body.update(approve_body or {})
    approve = client.post("/admin/registrations/approve", json=body, headers=headers)
    assert approve.status_code == 200, approve.text
    return reg, approve.json()


def test_language_travels_from_form_to_account(client, login, backend_env, monkeypatch):
    """en registreerimisvormil → en users.json kirjel."""
    reg, approve = _register_and_approve(client, login, backend_env, monkeypatch, {
        "name": "New User", "email": "new@example.test",
        "motivation": "I would like to help", "gdpr_consent": True,
        "language": "en",
    })
    assert reg["language"] == "en"

    # NB: endpoint on `/invite/set-password` (auth.py:170) — `/reset/set-password`
    # on parooli TAASTAMISE tee, mitte kutse oma.
    set_pw = client.post("/invite/set-password", json={
        "token": approve["invite_token"], "password": "TugevParool123",
    })
    assert set_pw.status_code == 200, set_pw.text

    users = json.loads(backend_env["users_file"].read_text(encoding="utf-8"))
    assert users[approve["username"]]["language"] == "en"


def test_unknown_language_falls_back_to_estonian(client, login, backend_env, monkeypatch):
    """Toetamata keel ei tohi kirjet katki teha ega tundmatut koodi salvestada."""
    reg, _ = _register_and_approve(client, login, backend_env, monkeypatch, {
        "name": "Hans", "email": "hans@example.test",
        "motivation": "Ich möchte helfen", "gdpr_consent": True,
        "language": "de",
    })
    assert reg["language"] == "et"


def test_missing_language_defaults_to_estonian(client, login, backend_env, monkeypatch):
    """Vana klient ei saada keelt üldse — kirje peab jääma kehtivaks."""
    reg, _ = _register_and_approve(client, login, backend_env, monkeypatch, {
        "name": "Mari", "email": "mari@example.test",
        "motivation": "soovin aidata", "gdpr_consent": True,
    })
    assert reg["language"] == "et"


def test_legacy_token_without_language_creates_estonian_user(backend_env, monkeypatch):
    """Enne seda muudatust loodud tokenil `language` võtit ei ole."""
    registration = backend_env["registration"]
    monkeypatch.setattr(registration, "get_cached_collections", lambda: {})
    token_data = registration.create_invite_token("vana@example.test", "Vana Kasutaja", "admin")
    tokens = json.loads(backend_env["invite_tokens_file"].read_text(encoding="utf-8"))
    for token in tokens["tokens"]:
        token.pop("language", None)
    backend_env["invite_tokens_file"].write_text(json.dumps(tokens), encoding="utf-8")

    user, error = registration.create_user_from_invite(token_data["token"], "TugevParool123")
    assert error is None, error
    users = json.loads(backend_env["users_file"].read_text(encoding="utf-8"))
    assert users[token_data["username"]]["language"] == "et"
