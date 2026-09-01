"""
Testid server/routers/notifications.py endpointidele (Faas 1 refaktoreering).

Domeen oli enne refaktoreeringut täiesti testita (0 testi). Need testid katavad
HTTP tasandi autoriseerimist ja sisendi valideerimist läbi FastAPI TestClient-i.

Kaetud endpoint'id:
- GET /notifications — enda teatised, ?unread=true filter, autoriseerimine
- GET /notification-recipients — editor+ õigus, kasutajate nimekiri
- POST /notifications/send — single/multiple/admins/all režiimid, valideerimine,
  admin-õiguse kontroll "all" režiimil, saatja koopia
- POST /notifications/{id}/read — märgi loetuks, idempotentsus

NB: /page-comments/reply on siin katmata — see on cross-domain endpoint (git +
meilisearch) ja vajaks lehe failide setup-i. Selle tuumloogika (notificationi
loomine kommentaari autorile) on kaetud test_notifications_ops.py kaudu
(create_notification + find_username_by_display_name).
"""
import pytest


# ---------------------------------------------------------------------------
# GET /notifications
# ---------------------------------------------------------------------------

def test_get_notifications_returns_empty_for_new_user(client, login):
    """Sisselogitud kasutaja, kel teatisi pole → tühi list."""
    token = login("editor", "editorpass")
    resp = client.get("/notifications", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert data["notifications"] == []


def test_get_notifications_requires_auth(client):
    """Ilma tokenita → 401."""
    resp = client.get("/notifications")
    assert resp.status_code == 401


def test_get_notifications_returns_user_notifications(client, login, backend_env):
    """Saadetud teatised on nähtavad saajale."""
    from server.notifications_ops import create_notification
    create_notification("editor", "system", "Tere editor", "Sisu")
    create_notification("editor", "review_request", "Teine", "Sisu2")

    token = login("editor", "editorpass")
    resp = client.get("/notifications", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    notifs = resp.json()["notifications"]
    assert len(notifs) == 2
    # Uuem ees
    assert notifs[0]["title"] == "Teine"


def test_get_notifications_unread_filter(client, login, backend_env):
    """?unread=true filtreerib loetud teatised välja."""
    from server.notifications_ops import create_notification
    create_notification("editor", "system", "Lugemata", "Sisu")
    create_notification("editor", "system", "Loetud", "Sisu")
    # Märgi teine loetuks otse ops kaudu
    from server.notifications_ops import load_notifications, save_notifications
    notifs = load_notifications("editor")
    notifs[0]["read_at"] = "2026-01-01T00:00:00"
    save_notifications("editor", notifs)

    token = login("editor", "editorpass")
    resp = client.get("/notifications?unread=true", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    notifs = resp.json()["notifications"]
    assert len(notifs) == 1
    assert notifs[0]["title"] == "Lugemata"


def test_get_notifications_isolated_per_user(client, login, backend_env):
    """Kasutaja näeb ainult enda teatisi, mitte teiste omi."""
    from server.notifications_ops import create_notification
    create_notification("admin", "system", "Admini teatis", "Sisu")
    create_notification("editor", "system", "Editori teatis", "Sisu")

    token = login("editor", "editorpass")
    resp = client.get("/notifications", headers={"Authorization": f"Bearer {token}"})
    notifs = resp.json()["notifications"]
    assert len(notifs) == 1
    assert notifs[0]["title"] == "Editori teatis"


# ---------------------------------------------------------------------------
# GET /notification-recipients
# ---------------------------------------------------------------------------

def test_notification_recipients_requires_editor(client, login):
    """editor ja admin saavad ligi; contributor (puudub siin setupis) ei saaks."""
    token = login("editor", "editorpass")
    resp = client.get("/notification-recipients", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    users = resp.json()["users"]
    usernames = [u["username"] for u in users]
    assert "admin" in usernames
    assert "editor" in usernames


def test_notification_recipients_requires_auth(client):
    resp = client.get("/notification-recipients")
    assert resp.status_code == 401


def test_notification_recipients_structure(client, login):
    """Iga kasutaja kirje sisaldab username, name, role välju."""
    token = login("editor", "editorpass")
    resp = client.get("/notification-recipients", headers={"Authorization": f"Bearer {token}"})
    users = resp.json()["users"]
    for u in users:
        assert "username" in u
        assert "name" in u
        assert "role" in u


# ---------------------------------------------------------------------------
# POST /notifications/send
# ---------------------------------------------------------------------------

def test_send_notification_single(client, login):
    """single režiim: üks saaja → 1 loodud teatis + saatja koopia."""
    token = login("editor", "editorpass")
    resp = client.post("/notifications/send", json={
        "recipient_mode": "single",
        "recipient_username": "admin",
        "title": "Tere admin",
        "body": "Sõnumi sisu",
        "link": "/work/test/1",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["created"] == 1


def test_send_notification_requires_title(client, login):
    """Pealkiri kohustuslik → 400 kui puudub."""
    token = login("editor", "editorpass")
    resp = client.post("/notifications/send", json={
        "recipient_username": "admin",
        "body": "Sisu",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 400
    assert "Pealkiri" in resp.json()["detail"]


def test_send_notification_rejects_external_link(client, login):
    """Link peab algama '/' (rakenduse-sisene) — XSS/redirect kaitse."""
    token = login("editor", "editorpass")
    resp = client.post("/notifications/send", json={
        "recipient_username": "admin",
        "title": "X",
        "link": "https://evil.com",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 400
    assert "rakenduse-sisene" in resp.json()["detail"]


def test_send_notification_rejects_too_long_title(client, login):
    token = login("editor", "editorpass")
    resp = client.post("/notifications/send", json={
        "recipient_username": "admin",
        "title": "x" * 161,
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 400


def test_send_notification_unknown_recipient(client, login):
    """single režiim tundmatu saajaga → 400."""
    token = login("editor", "editorpass")
    resp = client.post("/notifications/send", json={
        "recipient_username": "olematu-kasutaja",
        "title": "X",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 400


def test_send_notification_multiple(client, login):
    """multiple režiim: mitu saajat → loodud arv = saajate arv."""
    token = login("editor", "editorpass")
    resp = client.post("/notifications/send", json={
        "recipient_mode": "multiple",
        "recipient_usernames": ["admin", "editor"],
        "title": "Kõigile testijatele",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["created"] == 2


def test_send_notification_multiple_filters_invalid(client, login):
    """multiple režiim: tundmatud kasutajanimed filtreeritakse välja."""
    token = login("editor", "editorpass")
    resp = client.post("/notifications/send", json={
        "recipient_mode": "multiple",
        "recipient_usernames": ["admin", "olematu1", "olematu2"],
        "title": "X",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["created"] == 1  # ainult admin


def test_send_notification_multiple_empty_rejected(client, login):
    """multiple režiim tühja nimekirjaga → 400 (ükski kehtiv saaja)."""
    token = login("editor", "editorpass")
    resp = client.post("/notifications/send", json={
        "recipient_mode": "multiple",
        "recipient_usernames": ["olematu1", "olematu2"],
        "title": "X",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 400


def test_send_notification_admins_mode(client, login):
    """admins režiim: admin+ rolliga kasutajad saavad (admin + superadmin = 2)."""
    token = login("editor", "editorpass")
    resp = client.post("/notifications/send", json={
        "recipient_mode": "admins",
        "title": "Adminidele",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["created"] == 2  # admin + superadmin


def test_send_notification_all_mode_requires_admin(client, login):
    """all režiim nõuab admin-i; editor saab 403."""
    token = login("editor", "editorpass")
    resp = client.post("/notifications/send", json={
        "recipient_mode": "all",
        "title": "Kõigile",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403
    assert "administraatorile" in resp.json()["detail"]


def test_send_notification_all_mode_admin_ok(client, login):
    """all režiim admin-iga → kõik kasutajad saavad (admin + editor + superadmin = 3)."""
    token = login("admin", "adminpass")
    resp = client.post("/notifications/send", json={
        "recipient_mode": "all",
        "title": "Kõigile",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["created"] == 3


def test_send_notification_sender_gets_copy(client, login, backend_env):
    """Saatja saab alati 'sent_notification' koopia oma saadetud sõnumi kohta."""
    from server.notifications_ops import load_notifications
    token = login("editor", "editorpass")
    client.post("/notifications/send", json={
        "recipient_username": "admin",
        "title": "Kopeeritav",
    }, headers={"Authorization": f"Bearer {token}"})

    editor_notifs = load_notifications("editor")
    sent_copies = [n for n in editor_notifs if n["type"] == "sent_notification"]
    assert len(sent_copies) == 1
    assert sent_copies[0]["metadata"]["recipient_mode"] == "single"


def test_send_notification_requires_editor(client, login):
    # login fixture tagastab tokeni; siin pole contributor kontot, aga testime
    # et 401 ilma autendita
    resp = client.post("/notifications/send", json={"title": "X", "recipient_username": "admin"})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /notifications/{notification_id}/read
# ---------------------------------------------------------------------------

def test_mark_notification_read(client, login, backend_env):
    from server.notifications_ops import create_notification, load_notifications
    notif = create_notification("editor", "system", "Lugemata", "Sisu")

    token = login("editor", "editorpass")
    resp = client.post(f"/notifications/{notif['id']}/read",
                       headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200

    loaded = load_notifications("editor")
    assert loaded[0]["read_at"] is not None


def test_mark_notification_read_is_idempotent(client, login, backend_env):
    """Juba loetud teatise märkimine ei muuda read_at ajatemplit (idempotentne)."""
    from server.notifications_ops import create_notification, load_notifications
    notif = create_notification("editor", "system", "X", "Sisu")

    token = login("editor", "editorpass")
    client.post(f"/notifications/{notif['id']}/read", headers={"Authorization": f"Bearer {token}"})
    first_read_at = load_notifications("editor")[0]["read_at"]

    client.post(f"/notifications/{notif['id']}/read", headers={"Authorization": f"Bearer {token}"})
    second_read_at = load_notifications("editor")[0]["read_at"]
    assert first_read_at == second_read_at  # ei muutunud


def test_mark_notification_read_unknown_id_is_noop(client, login, backend_env):
    """Tundmatu ID-ga teatise märkimine on no-op (ei viska 404), aga ei muuda midagi."""
    from server.notifications_ops import create_notification, load_notifications
    create_notification("editor", "system", "Reaalne", "Sisu")

    token = login("editor", "editorpass")
    resp = client.post("/notifications/tundmatu-id/read",
                       headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    # Reaalne teatis jäi lugemata
    assert load_notifications("editor")[0]["read_at"] is None


def test_mark_notification_read_requires_auth(client):
    resp = client.post("/notifications/misiganes/read")
    assert resp.status_code == 401
