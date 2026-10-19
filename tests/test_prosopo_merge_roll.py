"""Isikute liitmine on toimetaja (editor) toiming, mitte ainult admini (2026-10-19).
NB: liiga madal roll annab siin 401 („Vajab vähemalt …"), mitte 403 (`deps.get_user`)."""


def _merge(client, login, user, password):
    token = login(user, password)
    return client.post("/prosopography/vutt:Pxxxxxx1/merge", json={"target_id": "vutt:Pxxxxxx2"},
                       headers={"Authorization": f"Bearer {token}"})


def test_editor_tohib_liita(client, login):
    r = _merge(client, login, "editor", "editorpass")
    # Isikuid pole olemas → rollikontroll lasi läbi ja edasi tuleb sisuline viga.
    assert r.status_code not in (401, 403), r.text


def test_contributor_ei_tohi_liita(client, login):
    r = _merge(client, login, "contrib", "contribpass")
    assert r.status_code in (401, 403) and "Vajab vähemalt 'editor'" in r.text
