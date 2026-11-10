"""Kogu vaikejärjestus `default_sort` (ADR 0080).

PUT /admin/collections/{id} salvestab välja ainult lubatud väärtusega;
tühi/None eemaldab ta (puuduv väli = rakenduse üldine vaikejärjestus).
"""
import json

import pytest


@pytest.fixture
def kogud(backend_env):
    fail = backend_env["collections_file"]
    fail.write_text(json.dumps({
        "kataloog": {"name": {"et": "Kataloog"}},
        "jarjestusega": {"name": {"et": "Järjestusega"}, "default_sort": "az"},
    }, ensure_ascii=False), encoding="utf-8")
    return fail


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_salvestab_lubatud_vaartuse(client, login, kogud):
    token = login("superadmin", "superpass")
    r = client.put("/admin/collections/kataloog", json={"default_sort": "az"}, headers=_auth(token))
    assert r.json()["status"] == "success", r.text
    assert json.loads(kogud.read_text())["kataloog"]["default_sort"] == "az"


@pytest.mark.parametrize("tuhi", ["", None])
def test_tuhi_eemaldab_valja(client, login, kogud, tuhi):
    token = login("superadmin", "superpass")
    r = client.put("/admin/collections/jarjestusega", json={"default_sort": tuhi}, headers=_auth(token))
    assert r.json()["status"] == "success", r.text
    assert "default_sort" not in json.loads(kogud.read_text())["jarjestusega"]


def test_puuduv_vali_ei_puutu(client, login, kogud):
    # Vana klient ei saada välja üldse → olemasolev väärtus jääb.
    token = login("superadmin", "superpass")
    r = client.put("/admin/collections/jarjestusega", json={"color": "rose"}, headers=_auth(token))
    assert r.json()["status"] == "success", r.text
    assert json.loads(kogud.read_text())["jarjestusega"]["default_sort"] == "az"


@pytest.mark.parametrize("vale", ["relevance", "title:asc", "AZ", 5])
def test_vale_vaartus_lukatakse_tagasi_enne_salvestust(client, login, kogud, vale):
    # `relevance` ei ole kogu vaikimisi: ilma päringuta pole tal tähendust.
    token = login("superadmin", "superpass")
    r = client.put("/admin/collections/kataloog",
                   json={"default_sort": vale, "color": "rose"}, headers=_auth(token))
    assert r.json()["status"] == "error"
    kogu = json.loads(kogud.read_text())["kataloog"]
    assert "default_sort" not in kogu and "color" not in kogu


def test_admin_ei_saa_muuta(client, login, kogud):
    token = login("admin", "adminpass")
    r = client.put("/admin/collections/kataloog", json={"default_sort": "az"}, headers=_auth(token))
    # require_role vastab ebapiisavale rollile 401-ga
    assert r.status_code in (401, 403)
    assert "default_sort" not in json.loads(kogud.read_text())["kataloog"]
