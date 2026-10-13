"""Tulemuste vaade (kaardid ↔ loend) kasutaja seadetes (#587).

Iga leht (`works`, `persons`) salvestab oma vaate eraldi; server liidab, et
ühe lehe kirjutus ei pühiks teise lehe valikut.
"""


def _post(client, token, body):
    return client.post("/user-settings", json=body,
                       headers={"Authorization": f"Bearer {token}"})


def _get(client, token):
    return client.get("/user-settings", headers={"Authorization": f"Bearer {token}"}).json()["settings"]


def test_lehtede_vaated_liidetakse(client, login, backend_env):
    token = login("admin", "adminpass")
    assert _post(client, token, {"results_view": {"works": "list"}}).status_code == 200
    assert _post(client, token, {"results_view": {"persons": "cards"}}).status_code == 200
    assert _get(client, token)["results_view"] == {"works": "list", "persons": "cards"}

    _post(client, token, {"results_view": {"works": "cards"}})
    assert _get(client, token)["results_view"] == {"works": "cards", "persons": "cards"}


def test_vigane_kuju_lukatakse_tagasi(client, login, backend_env):
    token = login("admin", "adminpass")
    for halb in ("list", ["works"], {"works": "map"}, {"teosed": "list"}, {"works": 1}):
        res = _post(client, token, {"results_view": halb})
        assert res.status_code == 400, halb
