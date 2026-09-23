"""`/git-restore` leping (#375 punkt 2).

Taaste salvestab ja commitib SERVERIS — klient ei pea midagi uuesti
salvestama. Seepärast peab vastus kandma kõike, mida klient vajab oma
salvestatud võrdlusseisu joondamiseks (tekst, kirjed, kommentaarid), ja
ütlema välja, kui git-commit ebaõnnestus.
"""
import json
import os

import pytest
from git import Repo

ORPHAN = {"id": 1, "comment": "toimetaja märkus", "author": "u",
          "created_at": "2026-09-01T00:00:00"}


@pytest.fixture
def repo(backend_env, tmp_path, monkeypatch):
    """v1: ainult tekst (JSON-it veel ei ole). v2: ankruga tekst + kirje."""
    import server.git_ops as git_ops
    import server.routers.editing as editing

    data_dir = tmp_path / "data"
    folder = data_dir / "1690-w1"
    folder.mkdir(parents=True)
    r = Repo.init(str(data_dir))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")
    (folder / "_metadata.json").write_text(
        json.dumps({"id": "work1", "collections": []}), encoding="utf-8")
    txt, jp = folder / "pg1.txt", folder / "pg1.json"
    rel = lambda p: os.path.relpath(str(p), str(data_dir))

    txt.write_text("vana tekst", encoding="utf-8")
    r.index.add([rel(txt)])
    r.index.commit("v1")
    v1 = r.head.commit.hexsha

    txt.write_text("uus <ann1>tekst</ann1>", encoding="utf-8")
    jp.write_text(json.dumps({"comments": [], "text_annotations": [ORPHAN]}), encoding="utf-8")
    r.index.add([rel(txt), rel(jp)])
    r.index.commit("v2")

    monkeypatch.setattr(git_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    monkeypatch.setattr(editing, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(editing, "sync_work_to_meilisearch_async", lambda *a, **k: None)
    return {"repo": r, "v1": v1, "txt": txt, "jp": jp}


def _restore(client, token, commit_hash):
    return client.post(
        "/git-restore",
        json={"original_path": "1690-w1", "file_name": "pg1.txt", "commit_hash": commit_hash},
        headers={"Authorization": f"Bearer {token}"},
    )


def test_lepituse_kommentaar_jouab_vastusesse(client, login, repo):
    """v1-l ei olnud JSON-it → praegune kirje jääb, aga tema ankur kaob
    taastatud tekstist → kirje muutub LEHE KOMMENTAARIKS. Klient peab selle
    saama, muidu kirjutab järgmine Ctrl+S ta vana kliendiseisuga üle."""
    r = _restore(client, login("editor", "editorpass"), repo["v1"])

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["restored_content"] == "vana tekst"
    assert body["restored_text_annotations"] == []
    [kommentaar] = body["restored_comments"]
    assert "toimetaja märkus" in kommentaar["text"]
    # Vastus peegeldab ketast, mitte eraldi arvutust.
    kettal = json.loads(repo["jp"].read_text(encoding="utf-8"))
    assert kettal["comments"] == body["restored_comments"]
    assert body["git_committed"] is True


def test_taaste_on_uks_commit(client, login, repo):
    enne = len(list(repo["repo"].iter_commits()))
    _restore(client, login("editor", "editorpass"), repo["v1"])
    assert len(list(repo["repo"].iter_commits())) == enne + 1


def test_git_torge_ei_anna_tingimusteta_edu(client, login, repo, monkeypatch):
    """Failid on kirjutatud, commit mitte — sama leping mis `/save`-il."""
    import server.routers.editing as editing
    monkeypatch.setattr(editing, "save_with_git",
                        lambda *a, **k: {"success": False, "error": "index.lock"})

    body = _restore(client, login("editor", "editorpass"), repo["v1"]).json()

    assert body["git_committed"] is False
    assert body["warning"]
    assert body["git_error"] == "index.lock"


def test_puuduv_commit_hash_on_400(client, login, repo):
    r = client.post(
        "/git-restore",
        json={"original_path": "1690-w1", "file_name": "pg1.txt"},
        headers={"Authorization": f"Bearer {login('editor', 'editorpass')}"},
    )
    assert r.status_code == 400
