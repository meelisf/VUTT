"""#418: metaandmete salvestus teatab Git-commiti ebaõnnestumisest.

Fail võib olla kettal ja Meilis uuenenud, aga versiooniajalugu puudu. Vastus
peab seda eristama (nagu /save: `git_committed: false` + `warning`) ja
muutusteta kordussalvestus ei tohi rippuvat commitimata seisu peita.
"""
import asyncio
import json

import git
import pytest
from fastapi import BackgroundTasks

from server import git_ops, metadata_ops
from server.routers import editing


def _meta(tmp_path, slug="teos", meta=None):
    work_dir = tmp_path / slug
    work_dir.mkdir()
    path = work_dir / "_metadata.json"
    path.write_text(json.dumps(meta or {"id": "w1", "title": "Vana"}), encoding="utf-8")
    return path


@pytest.fixture
def no_followups(monkeypatch):
    monkeypatch.setattr(metadata_ops, "update_work_collections", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "update_person_to_works", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "sync_work_to_meilisearch", lambda *a, **k: None)


def _git_fails(monkeypatch):
    def fake(path, content, *a, **k):
        with open(path, "w", encoding="utf-8") as f:   # kettale jõuab, commit mitte
            f.write(content)
        return {"success": False, "error": "index.lock"}
    monkeypatch.setattr(metadata_ops, "save_with_git", fake)


@pytest.fixture
def repo(tmp_path, monkeypatch):
    r = git.Repo.init(str(tmp_path))
    seed = tmp_path / "seed.txt"
    seed.write_text("seed", encoding="utf-8")
    r.index.add(["seed.txt"])
    actor = git.Actor("seed", "seed@vutt.local")
    r.index.commit("seed", author=actor, committer=actor)
    monkeypatch.setattr(git_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    return r


# ---------- üksiksalvestus ----------

def test_ebaonnestunud_commit_joub_tulemusse(tmp_path, monkeypatch, no_followups):
    path = _meta(tmp_path)
    _git_fails(monkeypatch)
    res = metadata_ops.save_work_metadata(str(path), {"title": "Uus"}, "u", "Meta")
    meta, changed = res                      # kahene lahtipakkimine jääb kehtima
    assert changed is True
    assert res.git_committed is False
    assert json.loads(path.read_text(encoding="utf-8"))["title"] == "Uus"


def test_edukas_ja_muutusteta_salvestus_on_commititud(tmp_path, repo, no_followups):
    path = _meta(tmp_path)
    esimene = metadata_ops.save_work_metadata(str(path), {"title": "Uus"}, "u", "Meta")
    teine = metadata_ops.save_work_metadata(str(path), {"title": "Uus"}, "u", "Meta")
    assert (esimene[1], esimene.git_committed) == (True, True)
    assert (teine[1], teine.git_committed) == (False, True)


def test_muutusteta_kordus_commitib_rippuva_seisu(tmp_path, repo, monkeypatch, no_followups):
    path = _meta(tmp_path)
    metadata_ops.save_work_metadata(str(path), {"title": "Vahe"}, "u", "Meta")  # jälgitud
    enne = repo.head.commit.hexsha

    with monkeypatch.context() as m:
        _git_fails(m)
        esimene = metadata_ops.save_work_metadata(str(path), {"title": "Uus"}, "u", "Meta")
    assert esimene.git_committed is False
    assert repo.head.commit.hexsha == enne

    kordus = metadata_ops.save_work_metadata(str(path), {"title": "Uus"}, "u", "Meta")
    assert kordus[1] is False                 # sisu ei muutunud → järeltegevusi ei korrata
    assert kordus.git_committed is True
    assert repo.head.commit.hexsha != enne
    assert json.loads(repo.git.show(f"HEAD:teos/_metadata.json"))["title"] == "Uus"


# ---------- hulgiuuendus ----------

def test_bulk_ebaonnestunud_commit(tmp_path, monkeypatch, no_followups):
    path = _meta(tmp_path)
    _git_fails(monkeypatch)
    res = metadata_ops.bulk_update_works([(str(path), lambda m: {"title": "Uus"})], "u", "bulk")
    assert res["updated"] == 1
    assert res["git_committed"] is False


def test_bulk_edukas_commit(tmp_path, repo, no_followups):
    path = _meta(tmp_path)
    res = metadata_ops.bulk_update_works([(str(path), lambda m: {"title": "Uus"})], "u", "bulk")
    assert res["git_committed"] is True


def test_bulk_muutusteta_kordus_commitib_rippuva_seisu(tmp_path, repo, monkeypatch, no_followups):
    path = _meta(tmp_path)
    metadata_ops.bulk_update_works([(str(path), lambda m: {"title": "Vahe"})], "u", "bulk")
    enne = repo.head.commit.hexsha
    with monkeypatch.context() as m:
        _git_fails(m)
        metadata_ops.bulk_update_works([(str(path), lambda m: {"title": "Uus"})], "u", "bulk")

    res = metadata_ops.bulk_update_works([(str(path), lambda m: {"title": "Uus"})], "u", "bulk")
    assert (res["updated"], res["skipped"], res["git_committed"]) == (0, 1, True)
    assert repo.head.commit.hexsha != enne


# ---------- endpointid ----------

def _request(body: bytes):
    from starlette.requests import Request

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    return Request({"type": "http", "method": "POST",
                    "headers": [(b"content-type", b"application/json")]}, receive)


def test_update_work_metadata_hoiatab(monkeypatch):
    monkeypatch.setattr(editing, "find_directory_by_id", lambda _wid: "/tmp/work")
    monkeypatch.setattr(editing, "save_work_metadata",
                        lambda *a, **k: metadata_ops.MetadataSaveResult({"id": "w1"}, True, git_committed=False))
    monkeypatch.setattr(editing, "process_person_fields_metadata", lambda *_a: None)
    monkeypatch.setattr(editing, "enrich_entity_labels_async", lambda *_a: None)
    monkeypatch.setattr(editing, "_invalidate_all_caches", lambda: None)

    res = asyncio.run(editing.update_work_metadata(
        _request(b'{"work_id":"w1","metadata":{"title":"T"}}'), BackgroundTasks(),
        user={"username": "admin", "role": "admin"},
    ))
    assert res["status"] == "success" and res["changed"] is True
    assert res["git_committed"] is False and res["warning"]


def test_bulk_endpoint_hoiatab(monkeypatch):
    monkeypatch.setattr(editing, "_resolve_bulk_items", lambda ids, tr: ([("p", tr)], 0))
    monkeypatch.setattr(editing, "bulk_update_works", lambda *a, **k: {
        "updated": 1, "skipped": 0, "failed": 0, "git_committed": False})
    monkeypatch.setattr(editing, "_invalidate_all_caches", lambda: None)

    res = asyncio.run(editing._run_bulk(["w1"], lambda m: {}, "u", "Bulk", BackgroundTasks()))
    assert res["git_committed"] is False and res["warning"]
