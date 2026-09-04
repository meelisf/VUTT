"""Kutsevoo testid: kinnitamisel valitud roll ja kirjutamisulatus jõuavad kontoni
ühe operatsiooniga (ADR 0031 mõte — kasutajaseisund on kontseptuaalselt atomaarne).

Erineb `test_registration_username.py`-st: seal on puhtad üksuse-testid
kasutajanime tuletamise kohta (laadijad monkeypatch'itud); siin läbitakse
päris HTTP-endpointe (`client`, `login`, `backend_env`) registreerimisest
kuni kasutaja tekkeni.
"""
import json


def test_approve_with_contributor_role_and_scope(client, login, backend_env):
    """Roll ja ulatus tekivad ühe operatsiooniga — vahepealset seisundit ei ole."""
    client.post("/register", json={
        "name": "Uus Kasutaja", "email": "uus@example.test",
        "motivation": "soovin aidata", "gdpr_consent": True,
    })
    admin_token = login("admin", "adminpass")
    listing = client.post("/admin/registrations",
                          headers={"Authorization": f"Bearer {admin_token}"})
    reg_id = listing.json()["registrations"][0]["id"]

    approve = client.post("/admin/registrations/approve", json={
        "registration_id": reg_id, "role": "contributor", "edit_collections": ["sample"],
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert approve.status_code == 200, approve.text
    assert approve.json()["role"] == "contributor"
    assert approve.json()["edit_collections"] == ["sample"]
    token = approve.json()["invite_token"]

    created = client.post("/invite/set-password",
                          json={"token": token, "password": "pikkparool123"})
    assert created.status_code == 200, created.text

    users_response = client.post("/admin/users",
                                 headers={"Authorization": f"Bearer {admin_token}"})
    new_user = [u for u in users_response.json()["users"]
                if u["username"] == created.json()["username"]][0]
    assert new_user["role"] == "contributor"
    assert new_user["edit_collections"] == ["sample"]


def test_approve_defaults_to_editor_without_role(client, login, backend_env):
    """Tagasiühilduvus: rollita kinnitamine annab senise vaikeväärtuse."""
    client.post("/register", json={
        "name": "Teine", "email": "teine@example.test",
        "motivation": "test", "gdpr_consent": True,
    })
    admin_token = login("admin", "adminpass")
    listing = client.post("/admin/registrations",
                          headers={"Authorization": f"Bearer {admin_token}"})
    reg_id = listing.json()["registrations"][0]["id"]
    approve = client.post("/admin/registrations/approve", json={"registration_id": reg_id},
                          headers={"Authorization": f"Bearer {admin_token}"})
    assert approve.json()["role"] == "editor"
    assert approve.json()["edit_collections"] == []
    token = approve.json()["invite_token"]
    created = client.post("/invite/set-password",
                          json={"token": token, "password": "pikkparool123"})
    users_response = client.post("/admin/users",
                                 headers={"Authorization": f"Bearer {admin_token}"})
    new_user = [u for u in users_response.json()["users"]
                if u["username"] == created.json()["username"]][0]
    assert new_user["role"] == "editor"
    assert new_user["edit_collections"] == []


def test_approve_rejects_admin_role_via_invite(client, login, backend_env):
    """Turvapiir: kutselingi kaudu ei tohi kunagi tekkida admin- ega
    superadmin-kontot, isegi kui päringu koostab admin ise. `create_invite_token`
    lubab AINULT (contributor, editor) — kõik muu langeb tagasi editor'ile."""
    client.post("/register", json={
        "name": "Kolmas", "email": "kolmas@example.test",
        "motivation": "test", "gdpr_consent": True,
    })
    admin_token = login("admin", "adminpass")
    listing = client.post("/admin/registrations",
                          headers={"Authorization": f"Bearer {admin_token}"})
    reg_id = listing.json()["registrations"][0]["id"]

    approve = client.post("/admin/registrations/approve", json={
        "registration_id": reg_id, "role": "admin",
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert approve.status_code == 200, approve.text
    # Serveripoolne valideerimine langetab admin-rolli tagasi editor'ile.
    assert approve.json()["role"] == "editor"
    token = approve.json()["invite_token"]

    created = client.post("/invite/set-password",
                          json={"token": token, "password": "pikkparool123"})
    users_response = client.post("/admin/users",
                                 headers={"Authorization": f"Bearer {admin_token}"})
    new_user = [u for u in users_response.json()["users"]
                if u["username"] == created.json()["username"]][0]
    assert new_user["role"] == "editor"
    assert new_user["role"] != "admin"


def test_create_user_from_invite_handles_legacy_token_without_role_fields(client, backend_env):
    """Tagasiühilduvus: enne seda muudatust loodud invite-tokenitel pole
    `role`/`edit_collections` võtmeid üldse (mitte ainult None). `create_user_from_invite`
    ei tohi selle peale KeyError'iga kukkuda — vaikeväärtused rakenduvad."""
    registration = backend_env["registration"]

    legacy_token = {
        "token": "legacy-token-123",
        "email": "vana@example.test",
        "username": "vanakasutaja",
        "name": "Vana Kasutaja",
        "created_at": "2026-01-01T00:00:00",
        "expires_at": "2099-01-01T00:00:00",
        "created_by": "admin",
        "used": False,
        # NB: "role" ja "edit_collections" võtmed puuduvad tahtlikult.
    }
    backend_env["invite_tokens_file"].write_text(
        json.dumps({"tokens": [legacy_token]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    result, error = registration.create_user_from_invite("legacy-token-123", "pikkparool123")
    assert error is None, error
    assert result["role"] == "editor"

    users = json.loads(backend_env["users_file"].read_text(encoding="utf-8"))
    assert users["vanakasutaja"]["role"] == "editor"
    assert users["vanakasutaja"]["edit_collections"] == []
