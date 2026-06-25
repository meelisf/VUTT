"""Testid POST /admin/work/{id}/delete-pages valideerimisele ja staatuse-mappingule."""
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


# --- Puhas valideerimisfunktsioon (ilma autentimiseta) ---
def test_validate_base_names_rejects_traversal():
    from server.admin_page_ops import _validate_base_names
    with pytest.raises(ValueError):
        _validate_base_names(["../../etc/passwd"])
    with pytest.raises(ValueError):
        _validate_base_names(["a/b"])


def test_validate_base_names_dedupes():
    from server.admin_page_ops import _validate_base_names
    assert _validate_base_names(["pg1", "pg1", "pg2"]) == ["pg1", "pg2"]


def test_validate_base_names_empty_raises():
    from server.admin_page_ops import _validate_base_names
    with pytest.raises(ValueError):
        _validate_base_names([])


# --- Endpoint staatuse-mapping (autenditud, delete_pages mock'itud) ---
def test_endpoint_success_200(backend_env, client, login, monkeypatch):
    from server.routers import pages as pages_router
    monkeypatch.setattr(pages_router, "delete_pages",
                        lambda wid, bn, username: {"status": "success", "deleted": bn, "new_page_count": 0})
    token = login("admin", "adminpass")
    r = client.post("/admin/work/w1/delete-pages", json={"base_names": ["pg1"]},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["deleted"] == ["pg1"]


def test_endpoint_conflict_409(backend_env, client, login, monkeypatch):
    from server.routers import pages as pages_router
    monkeypatch.setattr(pages_router, "delete_pages", lambda *a, **k: {"status": "conflict", "missing": ["x"]})
    token = login("admin", "adminpass")
    r = client.post("/admin/work/w1/delete-pages", json={"base_names": ["pg1"]},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 409


def test_endpoint_not_found_404(backend_env, client, login, monkeypatch):
    from server.routers import pages as pages_router
    monkeypatch.setattr(pages_router, "delete_pages", lambda *a, **k: {"status": "not_found", "missing": ["x"]})
    token = login("admin", "adminpass")
    r = client.post("/admin/work/w1/delete-pages", json={"base_names": ["pg1"]},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 404


def test_endpoint_bad_input_400(backend_env, client, login):
    token = login("admin", "adminpass")
    r = client.post("/admin/work/w1/delete-pages", json={"base_names": ["../x"]},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 400


def test_endpoint_requires_auth_401(backend_env, client):
    r = client.post("/admin/work/w1/delete-pages", json={"base_names": ["pg1"]})
    assert r.status_code == 401
