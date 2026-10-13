"""Lehe kaupa eelistused kasutaja seadetes (#587): tulemuste vaade ja külgriba.

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


def test_kulgriba_olek_lehe_kaupa(client, login, backend_env):
    token = login("admin", "adminpass")
    assert _post(client, token, {"filter_sidebar": {"works": True}}).status_code == 200
    assert _post(client, token, {"filter_sidebar": {"persons": False}}).status_code == 200
    assert _get(client, token)["filter_sidebar"] == {"works": True, "persons": False}


def test_kulgriba_vigane_kuju(client, login, backend_env):
    token = login("admin", "adminpass")
    for halb in (True, {"works": 1}, {"works": "true"}, {"teosed": True}):
        res = _post(client, token, {"filter_sidebar": halb})
        assert res.status_code == 400, halb
