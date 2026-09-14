"""GET /admin/users/activity (#318, spekk §1).

Endpoint on `/admin/` all ja admini taga: nginx proksib `/api/files/` alt KÕIK
backend-teed avalikult, seega sisemist infot lekitav tee vajab mõlemat.
"""
import server.routers.admin as admin_router


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_tagastab_ainult_olemasolevad_kasutajad(client, login, monkeypatch):
    monkeypatch.setattr(admin_router, "get_user_activity",
                        lambda usernames: {"admin": "2026-09-14T10:00:00+03:00"})
    token = login("admin", "adminpass")

    r = client.get("/admin/users/activity", headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["activity"] == {"admin": "2026-09-14T10:00:00+03:00"}


def test_kasutajanimed_tulevad_users_json_ist(client, login, monkeypatch):
    nahtud = {}

    def _kaart(usernames):
        nahtud["usernames"] = sorted(usernames)
        return {}

    monkeypatch.setattr(admin_router, "get_user_activity", _kaart)
    token = login("admin", "adminpass")
    client.get("/admin/users/activity", headers=_auth(token))
    # Kaarti küsitakse KÕIGI kontode kohta, mitte git-i autorite nimekirja alusel.
    assert "contrib" in nahtud["usernames"] and "superadmin" in nahtud["usernames"]


def test_editor_ei_paase(client, login, monkeypatch):
    monkeypatch.setattr(admin_router, "get_user_activity", lambda usernames: {})
    token = login("editor", "editorpass")
    # deps.get_user tõstab rollipuudusel 401 (mitte 403) — same leping kui
    # test_collection_rights_delta.py-s. Plaan pakkus 403, kood ütleb teisiti.
    assert client.get("/admin/users/activity", headers=_auth(token)).status_code == 401


def test_ilma_tokenita_ei_paase(client):
    assert client.get("/admin/users/activity").status_code in (401, 403)
