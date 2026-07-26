"""Bulk-metaandmete atomaarsus: üks commit, garanteeritud Meili sünk, loendurid (#175)."""
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _work(tmp_path, slug, meta):
    work_dir = tmp_path / slug
    work_dir.mkdir()
    path = work_dir / "_metadata.json"
    path.write_text(json.dumps(meta), encoding="utf-8")
    return str(path)


@pytest.fixture
def meta_file(tmp_path):
    return _work(tmp_path, "teos-a", {
        "id": "w1",
        "title": "Test",
        "collections": ["col-a"],
        "tags": [{"id": "Q1", "label": "foo"}],
        "genre": [],
    })


@pytest.fixture
def spies(monkeypatch):
    """Kõik järeltegevused spioonideks; save_with_git tagastab õnnestumise."""
    from server import metadata_ops

    seen = {"git": [], "collections": [], "ptw": [], "meili": []}
    monkeypatch.setattr(
        metadata_ops, "save_with_git",
        lambda path, content, user, message=None, additional_files=None: (
            seen["git"].append({
                "path": path, "content": content, "message": message,
                "additional_files": additional_files or [],
            }) or {"success": True, "commit_hash": "abc123", "is_noop": False}
        ),
    )
    monkeypatch.setattr(
        metadata_ops, "update_work_collections",
        lambda work_id, colls: seen["collections"].append((work_id, colls)),
    )
    monkeypatch.setattr(
        metadata_ops, "update_person_to_works",
        lambda *args: seen["ptw"].append(args[0]),
    )
    monkeypatch.setattr(
        metadata_ops, "sync_work_to_meilisearch",
        lambda slug: seen["meili"].append(slug),
    )
    return seen


# =========================================================
# Senine käitumine, mis peab säilima
# =========================================================

def test_transform_result_is_written(meta_file, spies):
    from server.metadata_ops import bulk_update_works

    def add_collection(meta):
        return {"collections": meta.get("collections", []) + ["col-b"]}

    bulk_update_works([(meta_file, add_collection)], "testuser", "bulk test")

    saved = json.loads(spies["git"][0]["content"])
    assert saved["collections"] == ["col-a", "col-b"]


def test_transform_sees_current_state(meta_file, spies):
    """transform näeb _metadata.json praegust seisu — ei kasuta vananenud väärtust."""
    from server.metadata_ops import bulk_update_works

    seen_collections = []

    def inspect_and_remove(meta):
        seen_collections.extend(meta.get("collections", []))
        return {"collections": []}

    bulk_update_works([(meta_file, inspect_and_remove)], "testuser", "bulk test")

    assert "col-a" in seen_collections


def test_disallowed_keys_are_dropped(meta_file, spies):
    """transform ei saa lisada väljakesi, mida ALLOWED_METADATA_FIELDS ei luba."""
    from server.metadata_ops import bulk_update_works

    bulk_update_works(
        [(meta_file, lambda m: {"collections": ["ok"], "__evil__": "injected"})],
        "testuser", "bulk test",
    )

    saved = json.loads(spies["git"][0]["content"])
    assert "__evil__" not in saved
    assert saved["collections"] == ["ok"]


def test_missing_file_makes_no_commit(tmp_path, spies):
    from server.metadata_ops import bulk_update_works

    missing = str(tmp_path / "puudub" / "_metadata.json")
    result = bulk_update_works([(missing, lambda m: {"collections": []})], "user", "msg")

    assert spies["git"] == []
    assert result == {"updated": 0, "skipped": 0, "failed": 1}


# =========================================================
# Uus: üks commit, sünk, loendurid (#175)
# =========================================================

def test_three_works_produce_one_commit(tmp_path, spies):
    from server.metadata_ops import bulk_update_works

    items = [
        (_work(tmp_path, f"teos-{i}", {"id": f"w{i}", "title": f"T{i}", "collections": []}),
         lambda m: {"collections": ["uus"]})
        for i in range(3)
    ]

    result = bulk_update_works(items, "testuser", "Bulk collection: 3 teost")

    assert len(spies["git"]) == 1
    commit = spies["git"][0]
    assert commit["message"] == "Bulk collection: 3 teost"
    # Esimene fail läheb põhiargumendina, ülejäänud additional_files kaudu — üks commit
    assert len(commit["additional_files"]) == 2
    assert result["updated"] == 3


def test_every_changed_work_reaches_meilisearch(tmp_path, spies):
    """#175 tuum: bulk-muudatus EI TOHI jätta Meilisearchi vanaks."""
    from server.metadata_ops import bulk_update_works

    items = [
        (_work(tmp_path, f"teos-{i}", {"id": f"w{i}", "title": f"T{i}", "collections": []}),
         lambda m: {"collections": ["uus"]})
        for i in range(3)
    ]

    bulk_update_works(items, "testuser", "bulk")

    assert sorted(spies["meili"]) == ["teos-0", "teos-1", "teos-2"]


def test_meili_sync_is_coalesced_per_work(tmp_path, spies):
    """Sama teos kaks korda nimekirjas → üks sünk, mitte kaks."""
    from server.metadata_ops import bulk_update_works

    path = _work(tmp_path, "teos-a", {"id": "w1", "title": "T", "collections": []})
    items = [
        (path, lambda m: {"collections": ["a"]}),
        (path, lambda m: {"collections": ["a", "b"]}),
    ]

    bulk_update_works(items, "testuser", "bulk")

    assert spies["meili"] == ["teos-a"]


def test_unchanged_work_is_skipped(tmp_path, spies):
    """Juba õige väärtusega teos ei tekita commiti, indeksi- ega Meili tööd."""
    from server.metadata_ops import bulk_update_works

    path = _work(tmp_path, "teos-a", {"id": "w1", "title": "T", "collections": ["olemas"]})

    result = bulk_update_works([(path, lambda m: {"collections": ["olemas"]})], "u", "bulk")

    assert result == {"updated": 0, "skipped": 1, "failed": 0}
    assert spies["git"] == []
    assert spies["meili"] == []
    assert spies["collections"] == []


def test_mixed_batch_counts_updated_skipped_failed(tmp_path, spies):
    from server.metadata_ops import bulk_update_works

    changed = _work(tmp_path, "teos-muutub", {"id": "w1", "title": "T", "collections": []})
    same = _work(tmp_path, "teos-sama", {"id": "w2", "title": "T", "collections": ["x"]})
    missing = str(tmp_path / "puudub" / "_metadata.json")

    result = bulk_update_works(
        [
            (changed, lambda m: {"collections": ["x"]}),
            (same, lambda m: {"collections": ["x"]}),
            (missing, lambda m: {"collections": ["x"]}),
        ],
        "u", "bulk",
    )

    assert result == {"updated": 1, "skipped": 1, "failed": 1}
    assert spies["meili"] == ["teos-muutub"]


def test_failing_transform_does_not_stop_batch(tmp_path, spies):
    """Ühe teose viga ei tohi ülejäänud partiid katkestada."""
    from server.metadata_ops import bulk_update_works

    boom = _work(tmp_path, "teos-vigane", {"id": "w1", "title": "T", "collections": []})
    ok = _work(tmp_path, "teos-korras", {"id": "w2", "title": "T", "collections": []})

    def explode(_meta):
        raise ValueError("katki")

    result = bulk_update_works(
        [(boom, explode), (ok, lambda m: {"collections": ["x"]})], "u", "bulk",
    )

    assert result == {"updated": 1, "skipped": 0, "failed": 1}
    assert spies["meili"] == ["teos-korras"]


def test_derived_indices_updated_for_changed_works_only(tmp_path, spies):
    from server.metadata_ops import bulk_update_works

    changed = _work(tmp_path, "teos-muutub", {"id": "w1", "title": "T", "collections": []})
    same = _work(tmp_path, "teos-sama", {"id": "w2", "title": "T", "collections": ["x"]})

    bulk_update_works(
        [(changed, lambda m: {"collections": ["x"]}), (same, lambda m: {"collections": ["x"]})],
        "u", "bulk", call_ptw=True,
    )

    assert spies["collections"] == [("w1", ["x"])]
    assert spies["ptw"] == ["w1"]


def test_ptw_skipped_when_not_requested(meta_file, spies):
    from server.metadata_ops import bulk_update_works

    bulk_update_works([(meta_file, lambda m: {"collections": ["uus"]})], "u", "bulk")

    assert spies["ptw"] == []
    assert spies["collections"] == [("w1", ["uus"])]


def test_background_tasks_receive_meili_sync(tmp_path, spies):
    """background_tasks olemasolul läheb sünk tausta, mitte sünkroonselt."""
    from fastapi import BackgroundTasks

    from server import metadata_ops

    path = _work(tmp_path, "teos-a", {"id": "w1", "title": "T", "collections": []})
    tasks = BackgroundTasks()

    metadata_ops.bulk_update_works(
        [(path, lambda m: {"collections": ["x"]})], "u", "bulk", background_tasks=tasks,
    )

    assert spies["meili"] == []
    assert [t.func for t in tasks.tasks] == [metadata_ops.sync_work_to_meilisearch_async]
    assert tasks.tasks[0].args == ("teos-a",)


# =========================================================
# Endpointide juhtmestik
# =========================================================

def _json_request(body: bytes):
    from starlette.requests import Request

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    return Request({
        "type": "http", "method": "POST", "path": "/", "query_string": b"",
        "headers": [(b"content-type", b"application/json")],
    }, receive)


@pytest.fixture
def bulk_endpoint_env(tmp_path, monkeypatch):
    """Kaks päris teost + üks tundmatu work_id; bulk_update_works spiooniks."""
    from server.routers import editing

    dirs = {}
    for work_id, slug in (("w1", "teos-a"), ("w2", "teos-b")):
        path = _work(tmp_path, slug, {"id": work_id, "title": "T", "collections": [], "tags": [], "genre": []})
        dirs[work_id] = str(Path(path).parent)

    monkeypatch.setattr(editing, "find_directory_by_id", lambda wid: dirs.get(wid))
    monkeypatch.setattr(editing, "_invalidate_all_caches", lambda: None)

    seen = {}

    def fake_bulk(items, username, message, **kwargs):
        seen["items"] = list(items)
        seen["message"] = message
        seen["username"] = username
        seen["call_ptw"] = kwargs.get("call_ptw", False)
        seen["background_tasks"] = kwargs.get("background_tasks")
        return {"updated": len(seen["items"]), "skipped": 0, "failed": 0}

    monkeypatch.setattr(editing, "bulk_update_works", fake_bulk)
    return seen


def test_bulk_collection_endpoint_sends_one_batch(bulk_endpoint_env):
    """Kolm work_id-d (üks tundmatu) → üks bulk-kutse, tundmatu läheb failed alla."""
    import asyncio

    from fastapi import BackgroundTasks

    from server.routers import editing

    body = json.dumps({"work_ids": ["w1", "w2", "puudub"], "mode": "add", "collection_id": "c1"}).encode()
    result = asyncio.run(editing.bulk_collection(
        _json_request(body), BackgroundTasks(), user={"username": "admin", "role": "admin"},
    ))

    assert len(bulk_endpoint_env["items"]) == 2
    assert bulk_endpoint_env["message"] == "Bulk collection: 2 teost"
    assert result == {"status": "success", "updated": 2, "skipped": 0, "failed": 1}


def test_bulk_collection_transform_adds_collection(bulk_endpoint_env):
    import asyncio

    from fastapi import BackgroundTasks

    from server.routers import editing

    body = json.dumps({"work_ids": ["w1"], "mode": "add", "collection_id": "c1"}).encode()
    asyncio.run(editing.bulk_collection(
        _json_request(body), BackgroundTasks(), user={"username": "admin", "role": "admin"},
    ))

    _path, transform = bulk_endpoint_env["items"][0]
    assert transform({"collections": ["olemas"]}) == {"collections": ["olemas", "c1"]}


def test_bulk_tags_endpoint_requests_person_index_update(bulk_endpoint_env):
    """Märksõnad võivad olla isikud → person_to_works peab uuenema."""
    import asyncio

    from fastapi import BackgroundTasks

    from server.routers import editing

    body = json.dumps({"work_ids": ["w1"], "tags": [{"id": "Q1", "label": "x"}], "mode": "add"}).encode()
    asyncio.run(editing.bulk_tags(
        _json_request(body), BackgroundTasks(), user={"username": "admin", "role": "admin"},
    ))

    assert bulk_endpoint_env["call_ptw"] is True
    assert bulk_endpoint_env["message"] == "Bulk tags: 1 teost"


def test_bulk_genre_endpoint_passes_background_tasks(bulk_endpoint_env):
    import asyncio

    from fastapi import BackgroundTasks

    from server.routers import editing

    tasks = BackgroundTasks()
    body = json.dumps({"work_ids": ["w1", "w2"], "genre": {"id": "Q2", "label": "g"}, "mode": "add"}).encode()
    result = asyncio.run(editing.bulk_genre(
        _json_request(body), tasks, user={"username": "admin", "role": "admin"},
    ))

    assert bulk_endpoint_env["background_tasks"] is tasks
    assert result["updated"] == 2


def test_bulk_works_end_to_end_single_commit(tmp_path, monkeypatch):
    """Päris Git repoga: kolm teost, üks commit, kõik failid sees."""
    import git

    from server import git_ops, metadata_ops

    repo = git.Repo.init(str(tmp_path))
    seed = tmp_path / "seed.txt"
    seed.write_text("seed", encoding="utf-8")
    repo.index.add(["seed.txt"])
    actor = git.Actor("seed", "seed@vutt.local")
    repo.index.commit("seed", author=actor, committer=actor)

    monkeypatch.setattr(git_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: repo)
    monkeypatch.setattr(metadata_ops, "update_work_collections", lambda *a: None)
    monkeypatch.setattr(metadata_ops, "update_person_to_works", lambda *a: None)
    monkeypatch.setattr(metadata_ops, "sync_work_to_meilisearch", lambda *a: None)

    items = [
        (_work(tmp_path, f"teos-{i}", {"id": f"w{i}", "title": f"T{i}", "collections": []}),
         lambda m: {"collections": ["uus"]})
        for i in range(3)
    ]
    before = len(list(repo.iter_commits()))

    result = metadata_ops.bulk_update_works(items, "editor", "Bulk collection: 3 teost")

    assert result["updated"] == 3
    assert len(list(repo.iter_commits())) == before + 1
    tree = repo.head.commit.tree
    for i in range(3):
        content = json.loads((tree / f"teos-{i}" / "_metadata.json").data_stream.read())
        assert content["collections"] == ["uus"]
