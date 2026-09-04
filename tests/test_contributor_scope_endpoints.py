"""Contributor'i kirjutamisulatus endpointide tasemel (#297, ADR 0031)."""
import json

import pytest


@pytest.fixture
def scoped_work_env(backend_env, monkeypatch, tmp_path):
    import server.access_ops as access_ops
    import server.routers.editing as editing
    import server.routers.notifications as notifications
    import server.utils as utils

    data_dir = tmp_path / "data"
    work_dir = data_dir / "oma-teos"
    work_dir.mkdir(parents=True)
    (work_dir / "_metadata.json").write_text(json.dumps({
        "id": "w-oma", "slug": "oma-teos", "title": "Oma teos", "collections": ["oma"],
    }), encoding="utf-8")
    (work_dir / "page1.txt").write_text("tekst", encoding="utf-8")
    (work_dir / "page1.json").write_text(json.dumps({
        "comments": [{"id": "c1", "author": "editor", "text": "küsimus", "replies": []}]
    }), encoding="utf-8")

    monkeypatch.setattr(access_ops, "get_cached_collections", lambda: {
        "oma": {"visibility": "public"},
        "muu": {"visibility": "public"},
    })
    monkeypatch.setattr(editing, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(notifications, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(utils, "BASE_DIR", str(data_dir))
    utils.WORK_ID_CACHE.clear()
    utils.WORK_ID_CACHE["w-oma"] = str(work_dir)
    yield {"data_dir": data_dir}
    utils.WORK_ID_CACHE.clear()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _save_body(text):
    # NB: /save loeb tegelikult 'text_content' (server/routers/editing.py) —
    # 'content' polnud kunagi õige väljanimi ja jättis salvestatava teksti tühjaks.
    return {
        "original_path": "oma-teos",
        "file_name": "page1.txt",
        "text_content": text,
        "meta_content": {},
    }


def test_contributor_saves_own_collection(client, login, scoped_work_env):
    """Tõestab PÄRIS kirjutust, mitte ainult 200: changed=True JA kettal olev
    sisu vastab saadetule (no-op salvestus tagastaks samuti 200, aga changed=False
    ega kirjutaks kettale midagi uut)."""
    token = login("contrib", "contribpass")
    text = "uus tekst sisu"
    response = client.post("/save", json=_save_body(text), headers=_auth(token))
    assert response.status_code == 200, response.text
    assert response.json().get("changed") is True, response.text
    saved = (scoped_work_env["data_dir"] / "oma-teos" / "page1.txt").read_text(encoding="utf-8")
    assert saved == text


def test_contributor_cannot_save_other_collection(client, login, scoped_work_env):
    """Aed peab lööma ENNE kirjutust: 403 JA leht jääb muutumatuks."""
    token = login("contrib_muu", "contribpass")
    response = client.post("/save", json=_save_body("teine tekst"), headers=_auth(token))
    assert response.status_code == 403
    saved = (scoped_work_env["data_dir"] / "oma-teos" / "page1.txt").read_text(encoding="utf-8")
    assert saved == "tekst"


def test_contributor_reads_metadata_of_public_work(client, login, scoped_work_env):
    """Lugemisteed peavad olema contributor'ile avatud, muidu ei avane Workspace."""
    token = login("contrib_muu", "contribpass")
    response = client.post("/get-work-metadata",
                           json={"original_path": "oma-teos"}, headers=_auth(token))
    assert response.status_code == 200, response.text


def test_reply_requires_catalog_access(client, login, scoped_work_env):
    """Elav auk enne parandust: /page-comments/reply ei kontrollinud midagi."""
    token = login("contrib_muu", "contribpass")
    response = client.post("/page-comments/reply", json={
        "original_path": "oma-teos", "file_name": "page1.txt",
        "comment_id": "c1", "text": "vastus", "work_id": "w-oma", "page_number": 1,
    }, headers=_auth(token))
    assert response.status_code == 403


def test_reply_allowed_in_own_collection(client, login, scoped_work_env):
    token = login("contrib", "contribpass")
    response = client.post("/page-comments/reply", json={
        "original_path": "oma-teos", "file_name": "page1.txt",
        "comment_id": "c1", "text": "vastus", "work_id": "w-oma", "page_number": 1,
    }, headers=_auth(token))
    assert response.status_code == 200, response.text


def test_contributor_cannot_toggle_shareable(client, login, scoped_work_env):
    """Jagamine muudab juurdepääsu, mitte sisu — see jääb editor+ pärusmaaks.
    Valvurtest: /work/{id}/shareable ei tohi kunagi contributor'ini alla libiseda."""
    token = login("contrib", "contribpass")
    response = client.post("/work/w-oma/shareable", json={"shareable": True},
                           headers=_auth(token))
    assert response.status_code == 401


def test_contributor_cannot_edit_person_card(client, login, scoped_work_env):
    """Prosopograafia on contributor'ile lugemisõigusega (kaardid on globaalsed)."""
    token = login("contrib", "contribpass")
    response = client.put("/prosopography/vutt:Ptest123",
                          json={"name": "Muudetud"}, headers=_auth(token))
    assert response.status_code in (401, 403)
