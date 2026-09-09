"""Kutse- ja taastekirja saatmine admini teedel (#298, ADR 0034).

Keskne invariant: **saatmine ei tohi kunagi kaotada juba loodud linki.**
Kui kiri ei lähe välja, peab vastus olema endiselt 200 ja sisaldama linki,
mille admin saab käsitsi edasi anda — koos nähtava veapõhjusega.
"""
import pytest

from server.routers import admin as admin_router


@pytest.fixture
def saadetud(monkeypatch):
    """Püüab kinni kõik saadetud kirjad; päris SMTP-d ei puudutata."""
    box = []

    def _fake_send(to, subject, body):
        box.append({"to": to, "subject": subject, "body": body})
        return True, None

    monkeypatch.setattr(admin_router, "send_mail", _fake_send)
    return box


def _approve(client, login, backend_env, monkeypatch, language=None):
    monkeypatch.setattr(backend_env["registration"], "get_cached_collections", lambda: {})
    body = {"name": "New User", "email": "new@example.test",
            "motivation": "I would like to help", "gdpr_consent": True}
    if language:
        body["language"] = language
    client.post("/register", json=body)

    headers = {"Authorization": f"Bearer {login('admin', 'adminpass')}"}
    reg_id = client.post("/admin/registrations", headers=headers).json()["registrations"][0]["id"]
    res = client.post("/admin/registrations/approve",
                      json={"registration_id": reg_id, "role": "editor", "edit_collections": []},
                      headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def _reset(client, login, username="editor"):
    headers = {"Authorization": f"Bearer {login('admin', 'adminpass')}"}
    res = client.post("/admin/users/reset-password", json={"username": username}, headers=headers)
    return res


# --- Kutse ----------------------------------------------------------------

def test_kutse_saadetakse_taotleja_aadressile(client, login, backend_env, monkeypatch, saadetud):
    data = _approve(client, login, backend_env, monkeypatch)
    assert data["mail_sent"] is True
    assert data["mail_error"] is None
    assert len(saadetud) == 1
    assert saadetud[0]["to"] == "new@example.test"
    assert data["invite_absolute_url"] in saadetud[0]["body"]


def test_kutse_saatmisviga_ei_kaota_linki(client, login, backend_env, monkeypatch):
    monkeypatch.setattr(admin_router, "send_mail",
                        lambda *a, **kw: (False, "Connection refused"))
    data = _approve(client, login, backend_env, monkeypatch)
    assert data["mail_sent"] is False
    assert "Connection refused" in data["mail_error"]
    # Käsitsi-varutee peab olema terve: link JA valmis kirjatekst
    assert data["invite_absolute_url"]
    assert data["mail_subject"] and data["mail_body"]


# --- Parooli taastamine ---------------------------------------------------

def test_taastelink_saadetakse_kasutaja_aadressile(client, login, saadetud):
    data = _reset(client, login).json()
    assert data["mail_sent"] is True
    assert len(saadetud) == 1
    assert saadetud[0]["to"] == "editor@example.test"
    assert data["reset_absolute_url"] in saadetud[0]["body"]
    assert data["reset_url"] in data["reset_absolute_url"]


def test_taastekiri_kasutaja_keeles(client, login, backend_env, saadetud):
    """ADR 0033: keel tuleb `get_user_language`-ist, mitte vaikeväärtusest."""
    (backend_env["state_dir"] / "user_settings").mkdir(exist_ok=True)
    (backend_env["state_dir"] / "user_settings" / "editor.json").write_text(
        '{"language": "en"}', encoding="utf-8")

    data = _reset(client, login).json()
    assert "password reset" in data["mail_subject"].lower()
    assert "Dear" in saadetud[0]["body"]


def test_taastekiri_vaikimisi_eesti_keeles(client, login, saadetud):
    data = _reset(client, login).json()
    assert "parooli taastamine" in data["mail_subject"].lower()


def test_taaste_saatmisviga_ei_kaota_linki(client, login, monkeypatch):
    monkeypatch.setattr(admin_router, "send_mail", lambda *a, **kw: (False, "550 rejected"))
    res = _reset(client, login)
    assert res.status_code == 200
    data = res.json()
    assert data["mail_sent"] is False
    assert "550" in data["mail_error"]
    assert data["reset_url"] and data["mail_body"]


def test_kasutaja_ilma_aadressita_annab_selge_pohjuse(client, login, backend_env, saadetud):
    """E-postita kirje: link on olemas, kanalit ei ole — see EI OLE saatmisviga."""
    import json
    users_file = backend_env["state_dir"] / "users.json"
    users = json.loads(users_file.read_text(encoding="utf-8"))
    users["editor"]["email"] = ""
    users_file.write_text(json.dumps(users), encoding="utf-8")

    data = _reset(client, login).json()
    assert data["mail_sent"] is False
    assert "e-posti" in data["mail_error"]
    assert data["reset_url"]
    assert saadetud == [], "aadressita kasutajale ei tohi saatmist üldse proovida"


def test_malli_renderduse_viga_ei_kaota_linki(client, login, monkeypatch, saadetud):
    def _boom(*a, **kw):
        raise FileNotFoundError("mall puudub")

    monkeypatch.setattr(admin_router, "render_mail", _boom)
    res = _reset(client, login)
    assert res.status_code == 200
    data = res.json()
    assert data["reset_url"]
    assert data["mail_sent"] is False
    assert saadetud == [], "renderdamata kirja ei tohi saata"


# --- Lingi keel (#298 järelparandus) --------------------------------------

def test_kutselink_kannab_saaja_keelt(client, login, backend_env, monkeypatch, saadetud):
    """Saaja avab lingi oma brauseris, mille keel võib olla kolmas — ja sisse
    ta veel loginud ei ole, seega `user_settings` keelt ei ole olemas."""
    data = _approve(client, login, backend_env, monkeypatch, language="en")
    assert "lang=en" in data["invite_url"]
    assert "lang=en" in data["invite_absolute_url"]
    assert "lang=en" in saadetud[0]["body"]


def test_taastelink_kannab_kasutaja_keelt(client, login, backend_env, saadetud):
    (backend_env["state_dir"] / "user_settings").mkdir(exist_ok=True)
    (backend_env["state_dir"] / "user_settings" / "editor.json").write_text(
        '{"language": "en"}', encoding="utf-8")

    data = _reset(client, login).json()
    assert "lang=en" in data["reset_url"]
    assert "lang=en" in saadetud[0]["body"]


def test_taastelink_ilma_e_postita_kannab_ikka_keelt(client, login, backend_env):
    """Aadressita kasutaja: kirja ei tule, aga admini kopeeritav link peab
    ikkagi viima kasutaja keelde."""
    import json
    users_file = backend_env["state_dir"] / "users.json"
    users = json.loads(users_file.read_text(encoding="utf-8"))
    users["editor"]["email"] = ""
    users_file.write_text(json.dumps(users), encoding="utf-8")

    data = _reset(client, login).json()
    assert data["mail_sent"] is False
    assert "lang=et" in data["reset_url"]
