"""Testid /work/{work_id}/viewer-token endpointile."""
import json
import pytest


RESTRICTED_META = {
    "work_id": "abc123",
    "title": "Piiratud teos",
    "collections": ["col-restricted"],
    "shareable": False,
}
SHAREABLE_META = {
    "work_id": "def456",
    "title": "Jagatav teos",
    "collections": ["col-restricted"],
    "shareable": True,
}
PUBLIC_META = {
    "work_id": "ghi789",
    "title": "Avalik teos",
    "collections": ["col-public"],
    "shareable": False,
}

COLLECTIONS = {
    "col-restricted": {"name": {"et": "Piiratud"}, "visibility": "restricted"},
    "col-public": {"name": {"et": "Avalik"}, "visibility": "public"},
}


@pytest.fixture
def env(backend_env, monkeypatch):
    import server.config as cfg
    import server.access_ops as access_ops

    cfg.MEILI_SEARCH_KEY = "test-key-32-chars-long-padding-x"
    cfg.MEILI_SEARCH_KEY_UID = "test-uid-1234"

    monkeypatch.setattr(access_ops, "get_cached_collections", lambda: COLLECTIONS)

    return backend_env


def set_work(monkeypatch, meta):
    from server.routers import public as public_router
    monkeypatch.setattr(public_router, "_load_work_metadata", lambda work_id: meta if meta.get("work_id") == work_id else None)


def test_viewer_token_404_unknown_work(env, monkeypatch):
    from server.routers import public as public_router
    monkeypatch.setattr(public_router, "_load_work_metadata", lambda work_id: None)

    r = env["client"].get("/work/unknown/viewer-token")
    assert r.status_code == 404


def test_viewer_token_403_restricted_anonymous(env, monkeypatch):
    set_work(monkeypatch, RESTRICTED_META)
    r = env["client"].get("/work/abc123/viewer-token")
    assert r.status_code == 403


def test_viewer_token_200_shareable_anonymous(env, monkeypatch):
    import jwt
    set_work(monkeypatch, SHAREABLE_META)

    r = env["client"].get("/work/def456/viewer-token")
    assert r.status_code == 200
    token = r.json()["token"]
    payload = jwt.decode(token, "test-key-32-chars-long-padding-x", algorithms=["HS256"])
    assert payload["searchRules"] == {"teosed": {"filter": 'work_id = "def456"'}}


def test_viewer_token_200_public_work_anonymous(env, monkeypatch):
    set_work(monkeypatch, PUBLIC_META)
    r = env["client"].get("/work/ghi789/viewer-token")
    assert r.status_code == 200


def test_viewer_token_403_editor_without_collection(env, monkeypatch):
    set_work(monkeypatch, RESTRICTED_META)

    login_r = env["client"].post("/login", json={"username": "editor", "password": "editorpass"})
    token = login_r.json()["token"]

    r = env["client"].get(
        "/work/abc123/viewer-token",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403  # editor ei ole allowed_collections-is


def test_viewer_token_200_admin(env, monkeypatch):
    set_work(monkeypatch, RESTRICTED_META)

    login_r = env["client"].post("/login", json={"username": "admin", "password": "adminpass"})
    token = login_r.json()["token"]

    r = env["client"].get(
        "/work/abc123/viewer-token",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200


def test_viewer_token_includes_image_credentials(env, monkeypatch):
    """Viewer token peab sisaldama pildi HMAC andmeid."""
    import hmac as hmac_mod
    import hashlib
    import server.config as cfg
    cfg.IMAGE_TOKEN_SECRET = "test-image-secret"

    set_work(monkeypatch, SHAREABLE_META)
    r = env["client"].get("/work/def456/viewer-token")
    assert r.status_code == 200
    data = r.json()
    assert "image_exp" in data
    assert "image_sig" in data
    exp = str(data["image_exp"])
    expected = hmac_mod.new(b"test-image-secret", f"image:def456:{exp}".encode(), hashlib.sha256).hexdigest()
    assert data["image_sig"] == expected
