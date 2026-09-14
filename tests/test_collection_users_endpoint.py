"""GET /admin/collections/{id}/users laiendus (#318, ADR 0043 p2).

Vastus kannab SALVESTATUD määranguid, mitte kehtivat õigust: `visibility`
ütleb, kas lugemismäärang üldse mõjub. Nii ei kao salvestatud andmed lugeja
rolli- või nähtavusfiltri taha.
"""
import json

import pytest


@pytest.fixture
def kogud(backend_env):
    fail = backend_env["collections_file"]
    fail.write_text(json.dumps({
        "kinnine": {"name": {"et": "Kinnine"}, "visibility": "restricted"},
        "avalik": {"name": {"et": "Avalik"}, "visibility": "public"},
        "ruhm": {"name": {"et": "Rühm"}, "type": "virtual_group"},
    }, ensure_ascii=False), encoding="utf-8")
    return fail


def _sea_oigused(backend_env, **kasutajad):
    auth = backend_env["auth"]
    users = auth.reload_users_cache()
    for uname, (lugemine, ulatus) in kasutajad.items():
        users[uname]["allowed_collections"] = lugemine
        users[uname]["edit_collections"] = ulatus
    auth.save_users(users)


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_tagastab_molemad_teljed(client, login, backend_env, kogud):
    _sea_oigused(backend_env, contrib=(["kinnine"], ["kinnine"]), editor=([], ["kinnine"]))
    token = login("admin", "adminpass")

    r = client.get("/admin/collections/kinnine/users", headers=_auth(token))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["allowed_users"] == ["contrib"]
    # editor'i salvestatud ulatus tuleb KAASA, mitte ei kao rollifiltri taha
    assert sorted(d["edit_users"]) == ["contrib", "editor"]
    assert d["visibility"] == "restricted"
    assert d["is_virtual"] is False
    assert d["collection"]["name"]["et"] == "Kinnine"


def test_avalik_kogu_naitab_salvestatud_maaranguid_ja_alust(client, login, backend_env, kogud):
    # Jäänuk ajast, mil kogu oli piiratud: see EI mõju, aga peab olema nähtav.
    _sea_oigused(backend_env, contrib=(["avalik"], []))
    token = login("admin", "adminpass")

    d = client.get("/admin/collections/avalik/users", headers=_auth(token)).json()
    assert d["allowed_users"] == ["contrib"]
    assert d["visibility"] == "public"


def test_virtuaalne_ruhm_on_margitud(client, login, backend_env, kogud):
    token = login("admin", "adminpass")
    d = client.get("/admin/collections/ruhm/users", headers=_auth(token)).json()
    assert d["is_virtual"] is True
    # Nähtavuse võti puudub konfist → vaikimisi avalik
    assert d["visibility"] == "public"


def test_tundmatu_kogu(client, login, kogud):
    token = login("admin", "adminpass")
    d = client.get("/admin/collections/puudub/users", headers=_auth(token)).json()
    assert d["status"] == "error"


def test_editor_ei_paase_ligi(client, login, kogud):
    token = login("editor", "editorpass")
    r = client.get("/admin/collections/kinnine/users", headers=_auth(token))
    # require_role("admin") ebaõnnestumisel tõstab deps.get_user HTTPException(401)
    assert r.status_code == 401
