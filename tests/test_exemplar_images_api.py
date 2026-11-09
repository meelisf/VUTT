# tests/test_exemplar_images_api.py
"""Eksemplari piltide otspunktid (ADR 0079): õigused, multipart, lähtefail."""
import io
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from server import exemplar_images as ei


def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (5, 6, 7)).save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture
def client(exemplar_work, monkeypatch):
    from server import deps
    from server.routers import exemplar_images as r
    env = exemplar_work

    def meta():
        with open(env["meta_path"], encoding="utf-8") as f:
            return json.load(f)

    monkeypatch.setattr(r, "find_directory_by_id", lambda wid: env["work_dir"] if wid == "w1" else None)
    monkeypatch.setattr(r, "load_work_metadata_by_id", lambda wid: meta() if wid == "w1" else None)
    state = {"user": {"username": "ad", "role": "admin"}, "read": True, "write": True}

    async def fake_get_user(request, min_role="contributor"):
        return state["user"]
    monkeypatch.setattr(deps, "get_user", fake_get_user)
    app = FastAPI()
    app.include_router(r.router)
    app.dependency_overrides[deps.optional_user] = lambda: state["user"]
    monkeypatch.setattr(r, "can_read_work", lambda m, u: state["read"])
    monkeypatch.setattr(r, "can_write_work", lambda m, u: state["write"])
    c = TestClient(app, follow_redirects=False)
    c.state = state
    c.env = env
    return c


BASE = "/works/w1/exemplars/a1b2c3/images"


def _upload(client, n=1):
    files = [("files", (f"p{i}.jpg", _jpeg(), "image/jpeg")) for i in range(n)]
    return client.post(BASE, files=files, data={"source": json.dumps({"kind": "photo", "ref": "foto"})})


def test_upload_multipart_lisab_pildid(client):
    r = _upload(client, 2)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["revision"] == 1 and len(body["images"]) == 2 and body["git_committed"] is True
    got = client.get(BASE).json()
    assert got["revision"] == 1 and len(got["images"]) == 2


def test_lugemisoiguseta_403(client):
    client.state["read"] = False
    assert client.get(BASE).status_code == 403


def test_tundmatu_eksemplar_404(client):
    assert client.get("/works/w1/exemplars/zzzzzz/images").status_code == 404
    assert client.get("/works/w9/exemplars/a1b2c3/images").status_code == 404


def test_original_lugemisoiguseta_403(client):
    img = _upload(client).json()["images"][0]
    assert client.get(f"{BASE}/{img['id']}/original").status_code == 200
    client.state["read"] = False
    assert client.get(f"{BASE}/{img['id']}/original").status_code == 403


def test_original_ada_suunab_handlele(client):
    env = client.env
    m = {"revision": 1, "imports": {}, "images": [
        {"id": "imp001", "source": {"kind": "ada", "ref": "10062/14332", "import_id": "q1q1q1"}}]}
    with ei.exemplar_locks(env["work_dir"]):
        ei.write_manifest_locked(env["work_dir"], env["eid"], m, "a", "test")
    r = client.get(f"{BASE}/imp001/original")
    assert r.status_code == 302
    assert r.headers["location"] == "https://hdl.handle.net/10062/14332"


def test_kirjutus_ilma_kirjutusoiguseta_403(client):
    client.state["write"] = False
    assert _upload(client).status_code == 403
    assert client.patch(BASE, json={"revision": 0, "images": []}).status_code == 403
    assert client.delete(f"{BASE}/abcdef?revision=0").status_code == 403


def test_patch_ja_delete_409_kannab_praegust(client):
    img = _upload(client).json()["images"][0]
    r = client.patch(BASE, json={"revision": 0, "images": [img]})
    assert r.status_code == 409 and r.json()["detail"]["current"]["revision"] == 1
    r = client.delete(f"{BASE}/{img['id']}?revision=1")
    assert r.status_code == 200 and r.json()["images"] == []


def test_vigane_fail_400(client):
    r = client.post(BASE, files=[("files", ("x.pdf", b"%PDF-1.4", "application/pdf"))],
                    data={"source": json.dumps({"kind": "photo"})})
    assert r.status_code == 400


def test_ada_import_otspunktid(client, monkeypatch):
    from server import exemplar_import as eimp
    seen = {}

    def fake_start(path, eid, handle, frm, to, username, set_url=True):
        seen.update(handle=handle, frm=frm, to=to, set_url=set_url)
        return "q1q1q1"
    monkeypatch.setattr(eimp, "start_import", fake_start)
    monkeypatch.setattr(eimp, "import_status", lambda path, eid, iid: {"state": "rendering", "pages_done": 2})
    r = client.post(f"{BASE}/import-ada", json={"handle": "10062/14332", "from": 3, "to": 7})
    assert r.status_code == 200 and r.json() == {"import_id": "q1q1q1"}
    assert seen == {"handle": "10062/14332", "frm": 3, "to": 7, "set_url": True}
    assert client.get(f"{BASE}/import-ada/q1q1q1").json()["state"] == "rendering"
    client.state["write"] = False
    assert client.post(f"{BASE}/import-ada", json={"handle": "x"}).status_code == 403
