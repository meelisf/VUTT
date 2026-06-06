import json
import pytest
import jwt

COLLECTIONS = {
    "col-restricted": {"name": {"et": "Piiratud"}, "visibility": "restricted"},
    "col-public": {"name": {"et": "Avalik"}, "visibility": "public"},
}


class SyncExecutor:
    def submit(self, fn, *args, **kwargs):
        fn(*args, **kwargs)


@pytest.fixture(autouse=True)
def patch_meili_config(monkeypatch):
    import server.meilisearch_ops as ops
    monkeypatch.setattr(ops, "MEILI_URL", "http://localhost:7700")
    monkeypatch.setattr(ops, "MEILI_KEY", "test-master-key")


def test_update_collection_visibility_updates_all_pages(tmp_path, monkeypatch):
    """Visibility uuendus peab saatma kõik teose lehekülgede dokumendid, mitte ainult esimese."""
    import server.meilisearch_ops as ops

    work_id = "test123"
    work_dir = tmp_path / "test-slug"
    work_dir.mkdir()
    (work_dir / "_metadata.json").write_text(json.dumps({
        "work_id": work_id,
        "collections": ["col-restricted"],
    }))
    for i in range(1, 4):
        (work_dir / f"page_{i:03d}.jpg").touch()

    monkeypatch.setattr(ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(ops, "load_collections", lambda: COLLECTIONS)
    monkeypatch.setattr(ops, "_meilisearch_executor", SyncExecutor())

    sent_docs = []

    class FakeResponse:
        def read(self): return json.dumps({"taskUid": 1}).encode()
        def __enter__(self): return self
        def __exit__(self, *a): pass

    def fake_urlopen(req, timeout=None):
        sent_docs.extend(json.loads(req.data))
        return FakeResponse()

    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    ops.update_collection_is_public_async("col-restricted", False)

    sent_ids = {doc["id"] for doc in sent_docs}
    assert f"{work_id}-1" in sent_ids, "Esimene lehekülg peab olema uuendatud"
    assert f"{work_id}-2" in sent_ids, "Teine lehekülg peab olema uuendatud"
    assert f"{work_id}-3" in sent_ids, "Kolmas lehekülg peab olema uuendatud"
    assert all(doc["is_public"] is False for doc in sent_docs)


def test_update_collection_visibility_correct_is_public_value(tmp_path, monkeypatch):
    """Kui teos on ka avalikus kollektsioonis, peab is_public olema True."""
    import server.meilisearch_ops as ops

    work_id = "test456"
    work_dir = tmp_path / "test-slug2"
    work_dir.mkdir()
    (work_dir / "_metadata.json").write_text(json.dumps({
        "work_id": work_id,
        "collections": ["col-restricted", "col-public"],
    }))
    (work_dir / "page_001.jpg").touch()

    monkeypatch.setattr(ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(ops, "load_collections", lambda: COLLECTIONS)
    monkeypatch.setattr(ops, "_meilisearch_executor", SyncExecutor())

    sent_docs = []

    class FakeResponse:
        def read(self): return json.dumps({"taskUid": 1}).encode()
        def __enter__(self): return self
        def __exit__(self, *a): pass

    def fake_urlopen(req, timeout=None):
        sent_docs.extend(json.loads(req.data))
        return FakeResponse()

    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    ops.update_collection_is_public_async("col-restricted", False)

    assert len(sent_docs) == 1
    assert sent_docs[0]["is_public"] is True


def test_generate_work_scoped_meili_token():
    """Scoped token peab sisaldama ainult selle work_id filtrit."""
    from server.meilisearch_ops import generate_work_scoped_meili_token
    import server.config as cfg
    cfg.MEILI_SEARCH_KEY = "test-key-32-chars-long-padding-x"
    cfg.MEILI_SEARCH_KEY_UID = "test-uid-1234"

    token = generate_work_scoped_meili_token("abc123")
    payload = jwt.decode(token, "test-key-32-chars-long-padding-x", algorithms=["HS256"])
    assert payload["searchRules"] == {"teosed": {"filter": 'work_id = "abc123"'}}
    assert payload["apiKeyUid"] == "test-uid-1234"
    assert payload["exp"] > 0


def test_generate_work_scoped_meili_token_different_works():
    """Iga teos saab erineva filtriga tokeni."""
    from server.meilisearch_ops import generate_work_scoped_meili_token
    import server.config as cfg
    cfg.MEILI_SEARCH_KEY = "test-key-32-chars-long-padding-x"
    cfg.MEILI_SEARCH_KEY_UID = "test-uid-1234"

    token1 = generate_work_scoped_meili_token("work1")
    token2 = generate_work_scoped_meili_token("work2")
    p1 = jwt.decode(token1, "test-key-32-chars-long-padding-x", algorithms=["HS256"])
    p2 = jwt.decode(token2, "test-key-32-chars-long-padding-x", algorithms=["HS256"])
    assert 'work_id = "work1"' in p1["searchRules"]["teosed"]["filter"]
    assert 'work_id = "work2"' in p2["searchRules"]["teosed"]["filter"]
    assert p1["searchRules"] != p2["searchRules"]
