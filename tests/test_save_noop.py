"""Muutusteta salvestus ei tohi teha commiti, tuletatud indekseid ega Meili sünki (#173)."""
import asyncio
import json

import pytest
from fastapi import BackgroundTasks
from starlette.requests import Request

from server.routers import editing


def _json_request(body: bytes) -> Request:
    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    scope = {
        "type": "http",
        "method": "POST",
        "headers": [(b"content-type", b"application/json")],
        "path": "/",
        "query_string": b"",
    }
    return Request(scope, receive)


# =========================================================
# Puhtad võrdlusfunktsioonid
# =========================================================

def test_metadata_unchanged_ignores_key_order():
    from server.save_diff import metadata_unchanged

    old = {"title": "T", "year": 1632, "tags": [{"label": "a", "id": "Q1"}]}
    new = {"year": 1632, "tags": [{"id": "Q1", "label": "a"}], "title": "T"}

    assert metadata_unchanged(old, new) is True


def test_metadata_unchanged_false_when_value_differs():
    from server.save_diff import metadata_unchanged

    assert metadata_unchanged({"title": "T"}, {"title": "T2"}) is False


def test_metadata_unchanged_false_when_list_order_differs():
    """Loendi järjekord on sisuline (nt creators) — see EI ole no-op."""
    from server.save_diff import metadata_unchanged

    old = {"collections": ["a", "b"]}
    new = {"collections": ["b", "a"]}

    assert metadata_unchanged(old, new) is False


def test_page_content_unchanged_ignores_updated_at(tmp_path):
    """Frontend lisab igale salvestusele uue updated_at — see üksi ei ole muudatus."""
    from server.save_diff import page_content_unchanged

    txt = tmp_path / "page.txt"
    txt.write_text("tekst", encoding="utf-8")
    js = tmp_path / "page.json"
    js.write_text(json.dumps({"status": "Valmis", "updated_at": "2026-01-01T00:00:00"}), encoding="utf-8")

    assert page_content_unchanged(
        str(txt), "tekst", str(js), {"status": "Valmis", "updated_at": "2026-07-26T12:00:00"}
    ) is True


def test_page_content_unchanged_false_when_text_differs(tmp_path):
    from server.save_diff import page_content_unchanged

    txt = tmp_path / "page.txt"
    txt.write_text("tekst", encoding="utf-8")
    js = tmp_path / "page.json"
    js.write_text(json.dumps({"status": "Valmis"}), encoding="utf-8")

    assert page_content_unchanged(str(txt), "muudetud tekst", str(js), {"status": "Valmis"}) is False


def test_page_content_unchanged_false_when_meta_differs(tmp_path):
    from server.save_diff import page_content_unchanged

    txt = tmp_path / "page.txt"
    txt.write_text("tekst", encoding="utf-8")
    js = tmp_path / "page.json"
    js.write_text(json.dumps({"status": "Toores", "updated_at": "2026-01-01T00:00:00"}), encoding="utf-8")

    assert page_content_unchanged(
        str(txt), "tekst", str(js), {"status": "Valmis", "updated_at": "2026-07-26T12:00:00"}
    ) is False


def test_page_content_unchanged_false_when_file_missing(tmp_path):
    """Uus lehekülg peab alati kettale ja commiti jõudma."""
    from server.save_diff import page_content_unchanged

    txt = tmp_path / "page.txt"
    js = tmp_path / "page.json"

    assert page_content_unchanged(str(txt), "tekst", str(js), {"status": "Toores"}) is False


def test_page_content_unchanged_without_meta(tmp_path):
    """Kui klient meta_content'i ei saada, otsustab ainult tekst."""
    from server.save_diff import page_content_unchanged

    txt = tmp_path / "page.txt"
    txt.write_text("tekst", encoding="utf-8")

    assert page_content_unchanged(str(txt), "tekst", None, None) is True
    assert page_content_unchanged(str(txt), "muu", None, None) is False


# =========================================================
# save_work_metadata
# =========================================================

@pytest.fixture
def meta_work(tmp_path, monkeypatch):
    """Teose kaust koos _metadata.json-iga ja kõigi järeltegevuste spioonidega."""
    from server import metadata_ops

    work_dir = tmp_path / "teos"
    work_dir.mkdir()
    meta_path = work_dir / "_metadata.json"
    meta_path.write_text(
        json.dumps({"id": "w1", "title": "Teos", "year": 1632, "collections": ["c1"]}),
        encoding="utf-8",
    )

    calls = {"git": 0, "collections": 0, "ptw": 0, "meili": 0}
    monkeypatch.setattr(metadata_ops, "save_with_git", lambda *a, **k: calls.__setitem__("git", calls["git"] + 1))
    monkeypatch.setattr(
        metadata_ops, "update_work_collections",
        lambda *a, **k: calls.__setitem__("collections", calls["collections"] + 1),
    )
    monkeypatch.setattr(
        metadata_ops, "update_person_to_works",
        lambda *a, **k: calls.__setitem__("ptw", calls["ptw"] + 1),
    )
    monkeypatch.setattr(
        metadata_ops, "sync_work_to_meilisearch",
        lambda *a, **k: calls.__setitem__("meili", calls["meili"] + 1),
    )
    return str(meta_path), calls


def test_save_work_metadata_skips_everything_when_unchanged(meta_work):
    from server.metadata_ops import save_work_metadata

    meta_path, calls = meta_work
    meta, changed = save_work_metadata(
        meta_path, {"title": "Teos", "year": 1632}, "tester", "Meta: teos",
        sync_meili=True, call_ptw=True,
    )

    assert changed is False
    assert meta["title"] == "Teos"
    assert calls == {"git": 0, "collections": 0, "ptw": 0, "meili": 0}


def test_save_work_metadata_runs_followups_when_changed(meta_work):
    from server.metadata_ops import save_work_metadata

    meta_path, calls = meta_work
    meta, changed = save_work_metadata(
        meta_path, {"title": "Uus pealkiri"}, "tester", "Meta: teos",
        sync_meili=True, call_ptw=True,
    )

    assert changed is True
    assert meta["title"] == "Uus pealkiri"
    assert calls == {"git": 1, "collections": 1, "ptw": 1, "meili": 1}


def test_save_work_metadata_ignores_disallowed_field_as_change(meta_work):
    """Lubamatu väli filtreeritakse välja → sisuliselt muutusteta salvestus."""
    from server.metadata_ops import save_work_metadata

    meta_path, calls = meta_work
    _meta, changed = save_work_metadata(meta_path, {"kurjus": "x"}, "tester", "Meta: teos")

    assert changed is False
    assert calls["git"] == 0


def test_save_work_metadata_v1_field_removal_is_change(tmp_path, monkeypatch):
    """Vana v1 välja eemaldamine on päris muudatus ja peab commitima."""
    from server import metadata_ops

    work_dir = tmp_path / "teos"
    work_dir.mkdir()
    meta_path = work_dir / "_metadata.json"
    meta_path.write_text(json.dumps({"id": "w1", "title": "T", "pealkiri": "vana"}), encoding="utf-8")

    calls = {"git": 0}
    monkeypatch.setattr(metadata_ops, "save_with_git", lambda *a, **k: calls.__setitem__("git", 1))
    monkeypatch.setattr(metadata_ops, "update_work_collections", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "update_person_to_works", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "sync_work_to_meilisearch", lambda *a, **k: None)

    _meta, changed = metadata_ops.save_work_metadata(str(meta_path), {"title": "T"}, "tester", "Meta")

    assert changed is True
    assert calls["git"] == 1


def test_save_work_metadata_new_file_is_change(tmp_path, monkeypatch):
    from server import metadata_ops

    work_dir = tmp_path / "teos"
    work_dir.mkdir()
    meta_path = work_dir / "_metadata.json"

    calls = {"git": 0}
    monkeypatch.setattr(metadata_ops, "save_with_git", lambda *a, **k: calls.__setitem__("git", 1))
    monkeypatch.setattr(metadata_ops, "update_work_collections", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "update_person_to_works", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "sync_work_to_meilisearch", lambda *a, **k: None)

    _meta, changed = metadata_ops.save_work_metadata(str(meta_path), {"title": "T"}, "tester", "Meta")

    assert changed is True
    assert calls["git"] == 1


# =========================================================
# Endpointid
# =========================================================

def test_update_work_metadata_returns_changed_false(monkeypatch):
    """Muutusteta metaandmete salvestus ei käivita rikastamist ega cache-invalidatsiooni."""
    background = {"tasks": 0}
    monkeypatch.setattr(editing, "find_directory_by_id", lambda _wid: "/tmp/work")
    monkeypatch.setattr(editing, "save_work_metadata", lambda *a, **k: ({"id": "w1"}, False))
    monkeypatch.setattr(editing, "process_person_fields_metadata", lambda *_a: None)
    monkeypatch.setattr(editing, "enrich_entity_labels_async", lambda *_a: None)
    monkeypatch.setattr(editing, "_invalidate_all_caches", lambda: background.__setitem__("caches", True))

    tasks = BackgroundTasks()
    result = asyncio.run(editing.update_work_metadata(
        _json_request(b'{"work_id":"w1","metadata":{"title":"T"}}'),
        tasks,
        user={"username": "admin", "role": "admin"},
    ))

    assert result == {"status": "success", "changed": False}
    assert tasks.tasks == []
    assert "caches" not in background


def test_update_work_metadata_returns_changed_true(monkeypatch):
    monkeypatch.setattr(editing, "find_directory_by_id", lambda _wid: "/tmp/work")
    monkeypatch.setattr(editing, "save_work_metadata", lambda *a, **k: ({"id": "w1"}, True))
    monkeypatch.setattr(editing, "process_person_fields_metadata", lambda *_a: None)
    monkeypatch.setattr(editing, "enrich_entity_labels_async", lambda *_a: None)
    monkeypatch.setattr(editing, "_invalidate_all_caches", lambda: None)

    tasks = BackgroundTasks()
    result = asyncio.run(editing.update_work_metadata(
        _json_request(b'{"work_id":"w1","metadata":{"title":"T"}}'),
        tasks,
        user={"username": "admin", "role": "admin"},
    ))

    assert result == {"status": "success", "changed": True}
    assert len(tasks.tasks) == 2


def _page_env(tmp_path, monkeypatch, *, text="tekst", meta=None):
    monkeypatch.setattr(editing, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(editing, "_require_catalog_access", lambda *a, **k: {"id": "w1"})
    work_dir = tmp_path / "teos"
    work_dir.mkdir()
    (work_dir / "page.txt").write_text(text, encoding="utf-8")
    (work_dir / "page.json").write_text(
        json.dumps(meta if meta is not None else {"status": "Valmis", "updated_at": "2026-01-01T00:00:00"}),
        encoding="utf-8",
    )
    calls = {"git": 0}
    monkeypatch.setattr(editing, "save_with_git", lambda *a, **k: calls.__setitem__("git", calls["git"] + 1) or {"commit_hash": "abc1234def"})
    return calls


def test_save_page_unchanged_skips_git_and_background(tmp_path, monkeypatch):
    calls = _page_env(tmp_path, monkeypatch)

    payload = json.dumps({
        "original_path": "teos",
        "file_name": "page.txt",
        "text_content": "tekst",
        "meta_content": {"status": "Valmis", "updated_at": "2026-07-26T12:00:00"},
        "work_id": "w1",
    }).encode()

    tasks = BackgroundTasks()
    result = asyncio.run(editing.save(
        _json_request(payload), tasks, user={"username": "editor", "role": "editor"},
    ))

    assert result["status"] == "success"
    assert result["changed"] is False
    assert calls["git"] == 0
    assert tasks.tasks == []
    # updated_at ei tohi kettale jõuda
    on_disk = json.loads((tmp_path / "teos" / "page.json").read_text(encoding="utf-8"))
    assert on_disk["updated_at"] == "2026-01-01T00:00:00"


def test_metadata_save_twice_creates_one_commit(tmp_path, monkeypatch):
    """Otsast-otsani päris Git repoga: teine identne salvestus ei lisa commiti."""
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
    monkeypatch.setattr(metadata_ops, "update_work_collections", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "update_person_to_works", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "sync_work_to_meilisearch", lambda *a, **k: None)

    work_dir = tmp_path / "teos"
    work_dir.mkdir()
    meta_path = work_dir / "_metadata.json"
    meta_path.write_text(json.dumps({"id": "w1", "title": "Vana"}), encoding="utf-8")

    _m, first = metadata_ops.save_work_metadata(
        str(meta_path), {"title": "Uus"}, "editor", "Meta: teos", sync_meili=False,
    )
    after_first = repo.head.commit.hexsha

    _m, second = metadata_ops.save_work_metadata(
        str(meta_path), {"title": "Uus"}, "editor", "Meta: teos", sync_meili=False,
    )

    assert (first, second) == (True, False)
    assert repo.head.commit.hexsha == after_first
    assert json.loads(meta_path.read_text(encoding="utf-8"))["title"] == "Uus"


def test_save_page_changed_text_commits(tmp_path, monkeypatch):
    calls = _page_env(tmp_path, monkeypatch)

    payload = json.dumps({
        "original_path": "teos",
        "file_name": "page.txt",
        "text_content": "uus tekst",
        "meta_content": {"status": "Valmis", "updated_at": "2026-07-26T12:00:00"},
        "work_id": "w1",
    }).encode()

    tasks = BackgroundTasks()
    result = asyncio.run(editing.save(
        _json_request(payload), tasks, user={"username": "editor", "role": "editor"},
    ))

    assert result["changed"] is True
    assert calls["git"] == 1
    assert len(tasks.tasks) >= 1
