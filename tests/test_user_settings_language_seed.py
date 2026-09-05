"""Esimesel sisselogimisel tuleb keel kontolt, ilma faili kirjutamata.

Migratsiooni ei tehta: `user_settings` fail tekib alles siis, kui kasutaja
midagi päriselt salvestab.
"""
import json
import os


def test_language_seeded_from_account(client, login, backend_env, monkeypatch):
    """Kasutaja pole Seadetes käinud → keel tuleb users.json-ist."""
    users = json.loads(backend_env["users_file"].read_text(encoding="utf-8"))
    users["admin"]["language"] = "en"
    backend_env["users_file"].write_text(json.dumps(users), encoding="utf-8")
    backend_env["auth"].reload_users_cache()

    token = login("admin", "adminpass")
    res = client.get("/user-settings", headers={"Authorization": f"Bearer {token}"})

    assert res.status_code == 200
    assert res.json()["settings"]["language"] == "en"


def test_seeding_does_not_write_settings_file(client, login, backend_env, monkeypatch):
    """Lugemine ei tohi kirjutada — seeme on tuletatud väärtus, mitte salvestus."""
    users = json.loads(backend_env["users_file"].read_text(encoding="utf-8"))
    users["admin"]["language"] = "en"
    backend_env["users_file"].write_text(json.dumps(users), encoding="utf-8")
    backend_env["auth"].reload_users_cache()

    token = login("admin", "adminpass")
    client.get("/user-settings", headers={"Authorization": f"Bearer {token}"})

    settings_path = os.path.join(str(backend_env["user_settings_dir"]), "admin.json")
    assert not os.path.exists(settings_path)


def test_saved_setting_wins_over_account(client, login, backend_env, monkeypatch):
    """Seadetes tehtud valik võidab registreerimisel valitut."""
    users = json.loads(backend_env["users_file"].read_text(encoding="utf-8"))
    users["admin"]["language"] = "en"
    backend_env["users_file"].write_text(json.dumps(users), encoding="utf-8")
    backend_env["auth"].reload_users_cache()

    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}
    client.post("/user-settings", json={"language": "et"}, headers=headers)

    res = client.get("/user-settings", headers=headers)
    assert res.json()["settings"]["language"] == "et"
