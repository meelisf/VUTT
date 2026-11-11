"""Kasutaja muudab oma e-posti seadetes (#786 kõrvalleid).

E-post on parooli taastamise kanal: varastatud sessiooniga aadressi vahetus
annaks konto üle. Seepärast nõuab muutus praegust parooli ja vale parool
läbib sama lukustuse nagu sisselogimine.
"""
import json

import pytest


def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def token(login):
    return login("contrib", "contribpass")


def kasutajad(backend_env):
    from server.auth import load_users
    return load_users()


def test_konto_naitab_oma_eposti(client, token):
    r = client.get("/account", headers=auth(token))
    assert r.status_code == 200
    assert r.json()["email"] == "contrib@example.test"


def test_konto_nouab_sisselogimist(client):
    assert client.get("/account").status_code == 401
    assert client.post("/account/email", json={}).status_code == 401


def test_oige_parooliga_epost_muutub_ja_normaliseerub(client, token, backend_env):
    r = client.post("/account/email", headers=auth(token),
                    json={"password": "contribpass", "email": "  Uus.Aadress@Example.TEST "})
    assert r.status_code == 200
    assert r.json()["email"] == "uus.aadress@example.test"
    assert kasutajad(backend_env)["contrib"]["email"] == "uus.aadress@example.test"


def test_vale_parool_ei_muuda_ega_logi_valja(client, token, backend_env):
    r = client.post("/account/email", headers=auth(token),
                    json={"password": "vale", "email": "uus@example.test"})
    # 403, MITTE 401: klient tõlgendab tokeniga 401 sessiooni surmaks.
    assert r.status_code == 403
    assert r.json()["detail"] == "wrong_password"
    assert kasutajad(backend_env)["contrib"]["email"] == "contrib@example.test"
    assert client.get("/account", headers=auth(token)).status_code == 200


def test_vigane_aadress_lukatakse_tagasi(client, token):
    for halb in ("", "pole-aadress", "a@b", "a b@c.ee", "x@" + "y" * 260 + ".ee"):
        r = client.post("/account/email", headers=auth(token),
                        json={"password": "contribpass", "email": halb})
        assert r.status_code == 400, halb
        assert r.json()["detail"] == "invalid_email"


def test_teise_kasutaja_aadress_on_keelatud(client, token):
    r = client.post("/account/email", headers=auth(token),
                    json={"password": "contribpass", "email": "SUPER@example.test"})
    assert r.status_code == 409
    assert r.json()["detail"] == "email_taken"


def test_oma_praegune_aadress_on_lubatud(client, token):
    r = client.post("/account/email", headers=auth(token),
                    json={"password": "contribpass", "email": "contrib@example.test"})
    assert r.status_code == 200


def test_vale_parool_lukustab_nagu_sisselogimine(client, token):
    # Paroolitesti ei tohi siit teha piiramatult — muidu oleks see login'i
    # lukustusest mööda viiv parooliarvamise tee.
    vastused = [client.post("/account/email", headers=auth(token),
                            json={"password": f"vale{i}", "email": "u@example.test"}).status_code
                for i in range(12)]
    assert 429 in vastused
    # Lukustus kehtib ka õige parooliga.
    r = client.post("/account/email", headers=auth(token),
                    json={"password": "contribpass", "email": "u@example.test"})
    assert r.status_code == 429


def test_superadmin_saab_aadressi_lisada(client, login, backend_env):
    t = login("superadmin", "superpass")
    r = client.post("/account/email", headers=auth(t),
                    json={"password": "superpass", "email": "super2@example.test"})
    assert r.status_code == 200
    assert kasutajad(backend_env)["superadmin"]["email"] == "super2@example.test"
