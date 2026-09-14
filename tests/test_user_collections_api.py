"""Vanad kollektsiooniõiguste endpointid on EEMALDATUD (#318, etapp 4a).

Kaks kirjutusteed sama välja peale on ADR 0043 p2 keeld: vana täisasendus
võis avalikuks muutunud kogu ID sanitiseerimisel vaikselt maha võtta. Alates
etapist 2 kirjutab klient ainult deltaga ja etapist 3b ei kutsu vanu teid enam
keegi. See test hoiab ära nende vaikse tagasitoomise.
"""


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_vana_update_collections_on_kadunud(client, login):
    token = login("admin", "adminpass")
    r = client.post("/admin/users/update-collections",
                    json={"username": "editor", "allowed_collections": []},
                    headers=_auth(token))
    assert r.status_code == 404, r.text


def test_vana_update_edit_collections_on_kadunud(client, login):
    token = login("admin", "adminpass")
    r = client.post("/admin/users/update-edit-collections",
                    json={"username": "editor", "edit_collections": []},
                    headers=_auth(token))
    assert r.status_code == 404, r.text


def test_delta_tee_toimib_edasi(client, login, monkeypatch):
    # Eemaldus ei tohi võtta ära ainsat allesjäänud kirjutusteed.
    from server import auth
    monkeypatch.setattr(auth, "get_cached_collections", lambda: {
        "r1": {"name": {"et": "R1"}, "visibility": "restricted"},
    })
    token = login("admin", "adminpass")
    r = client.post("/admin/users/collection-rights",
                    json={"changes": [{"username": "editor", "collection_id": "r1",
                                       "field": "allowed", "action": "add"}]},
                    headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["users"]["editor"]["allowed_collections"] == ["r1"]