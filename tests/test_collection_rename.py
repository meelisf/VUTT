"""Kogu nime toimetamine PUT /admin/collections/{id} kaudu.

Nimi oli varem ainult loomisel kirjutatav — kirjaviga (nt topelt kleebitud
nimi) jäi püsima. Identiteet on id, mitte nimi: Meili nimesid ei hoia, seega
nimevahetus reindeksit ei vaja.
"""
import json

import pytest


@pytest.fixture
def kogud(backend_env):
    fail = backend_env["collections_file"]
    fail.write_text(json.dumps({
        "kataloog": {"name": {"et": "Kataloog Kataloog", "en": "Catalogue"}, "color": "cyan"},
    }, ensure_ascii=False), encoding="utf-8")
    return fail


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_salvestab_nime(client, login, kogud):
    token = login("superadmin", "superpass")
    r = client.put("/admin/collections/kataloog",
                   json={"name": {"et": "  Kataloog ", "en": "Catalogue X"}}, headers=_auth(token))
    assert r.json()["status"] == "success", r.text
    assert json.loads(kogud.read_text())["kataloog"]["name"] == {"et": "Kataloog", "en": "Catalogue X"}


def test_tuhi_ingliskeelne_votab_eestikeelse(client, login, kogud):
    # Sama reegel mis loomisel (`name_en or name_et`).
    token = login("superadmin", "superpass")
    r = client.put("/admin/collections/kataloog",
                   json={"name": {"et": "Kataloog", "en": ""}}, headers=_auth(token))
    assert r.json()["status"] == "success", r.text
    assert json.loads(kogud.read_text())["kataloog"]["name"] == {"et": "Kataloog", "en": "Kataloog"}


def test_puuduv_vali_ei_puutu(client, login, kogud):
    token = login("superadmin", "superpass")
    r = client.put("/admin/collections/kataloog", json={"color": "rose"}, headers=_auth(token))
    assert r.json()["status"] == "success", r.text
    assert json.loads(kogud.read_text())["kataloog"]["name"]["et"] == "Kataloog Kataloog"


@pytest.mark.parametrize("vale", [{"et": "  ", "en": "X"}, {"en": "X"}, "Kataloog", None])
def test_vale_nimi_lukatakse_tagasi_enne_salvestust(client, login, kogud, vale):
    token = login("superadmin", "superpass")
    r = client.put("/admin/collections/kataloog",
                   json={"name": vale, "color": "rose"}, headers=_auth(token))
    assert r.json()["status"] == "error"
    kogu = json.loads(kogud.read_text())["kataloog"]
    assert kogu["name"]["et"] == "Kataloog Kataloog" and kogu["color"] == "cyan"
