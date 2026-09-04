"""Kutsevoo testid: kinnitamisel valitud roll ja kirjutamisulatus jõuavad kontoni
ühe operatsiooniga (ADR 0031 mõte — kasutajaseisund on kontseptuaalselt atomaarne).

Erineb `test_registration_username.py`-st: seal on puhtad üksuse-testid
kasutajanime tuletamise kohta (laadijad monkeypatch'itud); siin läbitakse
päris HTTP-endpointe (`client`, `login`, `backend_env`) registreerimisest
kuni kasutaja tekkeni.
"""
import json


def _patch_registration_collections(backend_env, monkeypatch, collections_config):
    """`registration.py` impordib `get_cached_collections` OTSE (`from .cache import
    get_cached_collections`) — leid 4 sanitiseerimine (`create_invite_token`)
    tarbib seda nime, mitte tegelikku `data/config/collections.json` faili
    (mida testikeskkonnas ei ole, vt CLAUDE.md "Andmed elavad serveril").
    Sama muster mis `test_admin_role_endpoints._patch_editable_collections`
    auth.py jaoks."""
    monkeypatch.setattr(backend_env["registration"], "get_cached_collections", lambda: collections_config)


def test_approve_with_contributor_role_and_scope(client, login, backend_env, monkeypatch):
    """Roll ja ulatus tekivad ühe operatsiooniga — vahepealset seisundit ei ole."""
    _patch_registration_collections(backend_env, monkeypatch, {
        "sample": {"name": {"et": "Näidis", "en": "Sample"}},
    })
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
    lubab AINULT (contributor, editor) — kõik muu OLEMAS-AGA-TUNDMATU väärtus
    langeb RANGEMALE, mitte laiemale rollile: contributor'ile (leid 5, ADR 0031).
    See erineb PUUDUVA `role`-välja juhtumist (test_approve_defaults_to_editor_without_role),
    kus tagasiühilduvuse pärast on vaikeväärtus endiselt editor."""
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
    # Serveripoolne valideerimine langetab tundmatu/lubamatu rolli fail-closed
    # contributor'ile — mitte tagasi editor'ile (see oleks laiem, mitte kitsam).
    assert approve.json()["role"] == "contributor"
    token = approve.json()["invite_token"]

    created = client.post("/invite/set-password",
                          json={"token": token, "password": "pikkparool123"})
    users_response = client.post("/admin/users",
                                 headers={"Authorization": f"Bearer {admin_token}"})
    new_user = [u for u in users_response.json()["users"]
                if u["username"] == created.json()["username"]][0]
    assert new_user["role"] == "contributor"
    assert new_user["role"] != "admin"


def test_approve_typo_role_falls_back_to_contributor(client, login, backend_env):
    """Leid 5: trükiviga rollinimes ("contributer") ei tohi anda LAIEMAT rolli
    kui vaikeväärtus. Enne parandust langes iga tundmatu väärtus editor'ile,
    mis oli laiem kui contributor — see on parim vastupidine sisend selle
    vea demonstreerimiseks (ilma admin-turvapiiri sassi ajamata, vt eelmine test)."""
    client.post("/register", json={
        "name": "Neljas", "email": "neljas@example.test",
        "motivation": "test", "gdpr_consent": True,
    })
    admin_token = login("admin", "adminpass")
    listing = client.post("/admin/registrations",
                          headers={"Authorization": f"Bearer {admin_token}"})
    reg_id = listing.json()["registrations"][0]["id"]

    approve = client.post("/admin/registrations/approve", json={
        "registration_id": reg_id, "role": "contributer",
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert approve.status_code == 200, approve.text
    assert approve.json()["role"] == "contributor"


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


def test_create_user_from_invite_rejects_invalid_stored_role(client, backend_env):
    """Leid 6: `create_user_from_invite` ei tohi tokenist tulevat rolli
    pimesi usaldada, isegi kui token peaks normaaljuhul olema juba
    `create_invite_token`'i poolt piiratud. Käsitsi kirjutatud/defektne
    tokenifail "role": "admin" ei tohi anda admin-kontot."""
    registration = backend_env["registration"]

    tampered_token = {
        "token": "tampered-token-456",
        "email": "tampered@example.test",
        "username": "tampered",
        "name": "Tampered User",
        "created_at": "2026-01-01T00:00:00",
        "expires_at": "2099-01-01T00:00:00",
        "created_by": "admin",
        "used": False,
        "role": "admin",  # ei tohiks kunagi jõuda users.json'i sellisena
        "edit_collections": [],
    }
    backend_env["invite_tokens_file"].write_text(
        json.dumps({"tokens": [tampered_token]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    result, error = registration.create_user_from_invite("tampered-token-456", "pikkparool123")
    assert error is None, error
    assert result["role"] == "contributor"

    users = json.loads(backend_env["users_file"].read_text(encoding="utf-8"))
    assert users["tampered"]["role"] == "contributor"
    assert users["tampered"]["role"] != "admin"


# =========================================================
# create_invite_token: edit_collections sanitiseerimine (leid 4)
# =========================================================

def test_create_invite_token_edit_collections_rejects_non_list_string(backend_env, monkeypatch):
    """Leid 4a: string-sisend ei tohi itereeruda tähtedeks — sanitiseerub tühjaks."""
    _patch_registration_collections(backend_env, monkeypatch, {
        "sample": {"name": {"et": "Näidis", "en": "Sample"}},
    })
    registration = backend_env["registration"]
    token_data = registration.create_invite_token(
        "list-bug@example.test", "List Bug", "admin",
        role="contributor", edit_collections="abc",
    )
    assert token_data["edit_collections"] == []


def test_create_invite_token_edit_collections_rejects_non_list_int(backend_env, monkeypatch):
    """Leid 4a: int-sisend ei tohi anda TypeError'it (500) — sanitiseerub tühjaks."""
    _patch_registration_collections(backend_env, monkeypatch, {
        "sample": {"name": {"et": "Näidis", "en": "Sample"}},
    })
    registration = backend_env["registration"]
    token_data = registration.create_invite_token(
        "int-bug@example.test", "Int Bug", "admin",
        role="contributor", edit_collections=5,
    )
    assert token_data["edit_collections"] == []


def test_create_invite_token_edit_collections_filters_unknown_ids(backend_env, monkeypatch):
    """Leid 4b: trükiviga kollektsiooni-id'is ei tohi jõuda salvestusse."""
    _patch_registration_collections(backend_env, monkeypatch, {
        "sample": {"name": {"et": "Näidis", "en": "Sample"}},
    })
    registration = backend_env["registration"]
    token_data = registration.create_invite_token(
        "unknown-id@example.test", "Unknown Id", "admin",
        role="contributor", edit_collections=["sample", "olematu"],
    )
    assert token_data["edit_collections"] == ["sample"]


def test_create_invite_token_edit_collections_filters_virtual_group(backend_env, monkeypatch):
    """Leid 4c: virtual_group ei tohi jõuda kirjutamisulatusse — teosele ei
    saagi seda kunagi määrata (server on tõe allikas, mitte UI)."""
    _patch_registration_collections(backend_env, monkeypatch, {
        "grupp": {"name": {"et": "Grupp", "en": "Group"}, "type": "virtual_group"},
        "sample": {"name": {"et": "Näidis", "en": "Sample"}},
    })
    registration = backend_env["registration"]
    token_data = registration.create_invite_token(
        "virtual-group@example.test", "Virtual Group", "admin",
        role="contributor", edit_collections=["grupp", "sample"],
    )
    assert token_data["edit_collections"] == ["sample"]
