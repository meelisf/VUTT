"""Lehekirjutuse failinime leping (R24-01, #422).

Teose kirjutamisõigusega kasutaja tohib kirjutada ainult olemasoleva lehe
`.txt`/`.json` paari — mitte `_metadata.json`-i (teose avalikkus on admini
otsus) ega muid reserveeritud faile.
"""
import json

import pytest


@pytest.fixture
def env(backend_env, monkeypatch, tmp_path):
    import server.access_ops as access_ops
    import server.routers.editing as editing
    import server.routers.notifications as notifications
    import server.utils as utils

    data_dir = tmp_path / "data"
    work_dir = data_dir / "oma-teos"
    work_dir.mkdir(parents=True)
    meta = {"id": "w-oma", "slug": "oma-teos", "collections": ["oma"]}
    (work_dir / "_metadata.json").write_text(json.dumps(meta), encoding="utf-8")
    (work_dir / "page1.txt").write_text("tekst", encoding="utf-8")
    (work_dir / "page1.json").write_text("{}", encoding="utf-8")
    # Tühja OCR-iga leht: pilt on, .txt veel ei ole.
    (work_dir / "page2.jpg").write_bytes(b"\xff\xd8\xff")

    monkeypatch.setattr(access_ops, "get_cached_collections",
                        lambda: {"oma": {"visibility": "public"}})
    monkeypatch.setattr(editing, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(notifications, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(utils, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(editing, "sync_work_to_meilisearch_async", lambda *a, **k: None)
    # Kirjutaja asendatakse: test mõõdab, kas kirjutus üldse JÕUAB kirjutajani.
    kirjutused = []

    def fake_save(path, text, *a, **k):
        kirjutused.append(path)
        return {"success": True, "commit_hash": "x"}
    monkeypatch.setattr(editing, "save_with_git", fake_save)
    yield {"work_dir": work_dir, "kirjutused": kirjutused, "meta": meta}


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize("file_name", [
    "_metadata.json", "_metadata.txt", "page1.json", "page1.jpg", ".hidden.txt",
    "_thumbs.txt", ".txt", "page1.TXT",
])
def test_save_lukkab_reserveeritud_ja_mittelehe_failid_tagasi(client, login, env, file_name):
    r = client.post("/save", json={
        "original_path": "oma-teos", "file_name": file_name,
        "text_content": json.dumps({"collections": [], "shareable": True}),
        "meta_content": {"collections": [], "shareable": True},
    }, headers=_auth(login("contrib", "contribpass")))
    assert r.status_code == 400, r.text
    assert env["kirjutused"] == []
    kettal = json.loads((env["work_dir"] / "_metadata.json").read_text(encoding="utf-8"))
    assert kettal == env["meta"]


def test_save_ei_loo_uut_lehte(client, login, env):
    r = client.post("/save", json={
        "original_path": "oma-teos", "file_name": "pole_olemas.txt", "text_content": "x",
    }, headers=_auth(login("contrib", "contribpass")))
    assert r.status_code == 404
    assert env["kirjutused"] == []


def test_save_tavaline_leht_tootab(client, login, env):
    r = client.post("/save", json={
        "original_path": "oma-teos", "file_name": "page1.txt", "text_content": "uus",
    }, headers=_auth(login("contrib", "contribpass")))
    assert r.status_code == 200, r.text
    assert env["kirjutused"] == [str(env["work_dir"] / "page1.txt")]


def test_save_tuhja_ocr_lehele_tootab(client, login, env):
    """Pildiga leht, millel .txt veel puudub, on olemasolev leht."""
    r = client.post("/save", json={
        "original_path": "oma-teos", "file_name": "page2.txt", "text_content": "esimene",
    }, headers=_auth(login("contrib", "contribpass")))
    assert r.status_code == 200, r.text
    assert env["kirjutused"] == [str(env["work_dir"] / "page2.txt")]


def test_git_restore_lukkab_metaandmefaili_tagasi(client, login, env):
    r = client.post("/git-restore", json={
        "original_path": "oma-teos", "file_name": "_metadata.json", "commit_hash": "deadbeef",
    }, headers=_auth(login("editor", "editorpass")))
    assert r.status_code == 400
    assert env["kirjutused"] == []


@pytest.mark.parametrize("path", ["/page-comments/restore", "/page-comments/history"])
def test_kommentaariteed_lukkavad_metaandmefaili_tagasi(client, login, env, path):
    r = client.post(path, json={
        "original_path": "oma-teos", "file_name": "_metadata.txt",
        "mode": "version", "comment_id": "c1", "commit_hash": "deadbeef",
    }, headers=_auth(login("editor", "editorpass")))
    assert r.status_code == 400


def test_vastamine_lukkab_metaandmefaili_tagasi(client, login, env):
    r = client.post("/page-comments/reply", json={
        "original_path": "oma-teos", "file_name": "_metadata.txt",
        "comment_id": "c1", "text": "vastus", "work_id": "w-oma", "page_number": 1,
    }, headers=_auth(login("contrib", "contribpass")))
    assert r.status_code == 400
