"""Lemmikkogud kasutaja seadetes.

Tokenid on sama kujuga nagu URL-is (ADR 0038): püsikogu = paljas id,
töökollektsioon = `s:<id>`. Kustutatud kogu token võib loendisse jääda —
valija jätab ta lihtsalt välja, server seda ei korista.
"""


def _post(client, token, body):
    return client.post("/user-settings", json=body,
                       headers={"Authorization": f"Bearer {token}"})


def test_lemmikud_salvestuvad_ja_loetakse_tagasi(client, login, backend_env):
    token = login("admin", "adminpass")
    res = _post(client, token, {"favorite_collections": ["sample", "s:ws_abc"]})
    assert res.status_code == 200

    res = client.get("/user-settings", headers={"Authorization": f"Bearer {token}"})
    assert res.json()["settings"]["favorite_collections"] == ["sample", "s:ws_abc"]


def test_duplikaadid_eemaldatakse_jarjekorda_sailitades(client, login, backend_env):
    token = login("admin", "adminpass")
    res = _post(client, token, {"favorite_collections": ["b", "a", "b"]})
    assert res.json()["settings"]["favorite_collections"] == ["b", "a"]


def test_vigane_kuju_lukatakse_tagasi(client, login, backend_env):
    token = login("admin", "adminpass")
    for halb in ("sample", [1, 2], [""], ["x" * 201], [f"k{i}" for i in range(201)]):
        res = _post(client, token, {"favorite_collections": halb})
        assert res.status_code == 400, halb
