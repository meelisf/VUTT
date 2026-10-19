"""#641: tekstiettepanekute otspunktid — kood on agendi ainus õigus, ülejäänu superadmin."""
import json

import pytest

from server import page_text_proposal_jobs as jobs
from server import page_text_proposals as ptp


@pytest.fixture
def work(tmp_path, monkeypatch):
    monkeypatch.setattr(ptp, "DB_PATH", str(tmp_path / "ptp.sqlite3"))
    d = tmp_path / "slug-w1"
    d.mkdir()
    for i in (1, 2):
        (d / f"t-00{i}.jpg").write_bytes(b"x")
        (d / f"t-00{i}.txt").write_text(f"leht {i} vana\n", encoding="utf-8")
    (d / "_metadata.json").write_text(json.dumps({"id": "w1"}), encoding="utf-8")
    jobs._reset_for_tests()
    return str(d)


@pytest.fixture
def client(work, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from server.routers import page_text_proposals as r
    from server import deps
    monkeypatch.setattr(r, "find_directory_by_id", lambda wid: work if wid == "w1" else None)
    app = FastAPI()
    app.include_router(r.router)
    state = {"user": {"username": "su", "role": "superadmin"}}

    async def fake_get_user(request, min_role="contributor"):
        from fastapi import HTTPException
        from server.auth import is_at_least
        if not is_at_least(state["user"]["role"], min_role):
            raise HTTPException(status_code=403, detail="Puudub õigus")
        return state["user"]
    monkeypatch.setattr(deps, "get_user", fake_get_user)
    c = TestClient(app)
    c.state = state
    return c


def _code(client, work_id="w1"):
    r = client.post("/text-proposals/handoff", json={"work_id": work_id} if work_id else {})
    assert r.status_code == 200, r.text
    return r.json()["code"]


def test_voog(client, work):
    code = _code(client)
    src = client.post("/works/text-proposals/source", json={"code": code, "work_id": "w1", "page": 1})
    assert src.status_code == 200 and src.json()["text"] == "leht 1 vana\n"
    s = client.post("/works/text-proposals/submit", json={
        "code": code, "work_id": "w1", "note": "pakk",
        "pages": [{"stem": "t-001", "text_hash": src.json()["text_hash"],
                   "edits": [{"old": "vana", "new": "uus"}]}]})
    assert s.status_code == 200, s.text
    pid = s.json()["proposal_id"]
    (pack,) = client.get("/text-proposals").json()
    assert pack["proposal_id"] == pid
    assert client.get("/works/w1/text-proposals").json()[0]["proposal_id"] == pid
    rv = client.get(f"/works/w1/text-proposals/{pid}/pages/t-001").json()
    assert rv["proposed_now"] == "leht 1 uus\n" and rv["page"]["text_content"] == "leht 1 vana\n"
    assert client.post(f"/works/w1/text-proposals/{pid}/pages/t-001/reject").json() == {"rejected": 1}
    assert client.get("/text-proposals").json() == []


def test_source_ilma_koodita_ei_lekita(client):
    r = client.post("/works/text-proposals/source", json={"code": "vale", "work_id": "w1", "page": 1})
    assert r.status_code == 400 and "vana" not in r.text


def test_kood_koigile_teostele(client):
    code = _code(client, None)
    assert client.post("/works/text-proposals/source",
                       json={"code": code, "work_id": "w1", "page": 2}).status_code == 200


def test_stale_page_409(client, work):
    code = _code(client)
    r = client.post("/works/text-proposals/submit", json={
        "code": code, "work_id": "w1", "note": "",
        "pages": [{"stem": "t-001", "text_hash": "vale", "edits": [{"old": "vana", "new": "uus"}]}]})
    assert r.status_code == 409 and r.json()["detail"] == "stale_page:t-001"


def test_superadmin_otspunktid_admin_403(client):
    client.state["user"] = {"username": "ad", "role": "admin"}
    for method, path in [("post", "/text-proposals/handoff"), ("get", "/text-proposals"),
                         ("get", "/works/w1/text-proposals"),
                         ("get", "/works/w1/text-proposals/x/pages/t-001"),
                         ("post", "/works/w1/text-proposals/x/pages/t-001/reject"),
                         ("post", "/works/w1/text-proposals/x/reject"),
                         ("post", "/works/w1/text-proposals/x/accept"),
                         ("get", "/works/w1/text-proposals/job")]:
        assert getattr(client, method)(path).status_code == 403, path


def test_submit_413(client, monkeypatch):
    monkeypatch.setattr(ptp, "MAX_BODY_BYTES", 100)
    r = client.post("/works/text-proposals/submit", content=b"{" + b" " * 200 + b"}")
    assert r.status_code == 413


def test_submit_tundmatu_voti_400(client):
    code = _code(client)
    r = client.post("/works/text-proposals/submit",
                    json={"code": code, "work_id": "w1", "note": "", "pages": [], "lisa": 1})
    assert r.status_code == 400


def test_accept_kaivitab_too(client, work, monkeypatch):
    code = _code(client)
    src = client.post("/works/text-proposals/source", json={"code": code, "work_id": "w1", "page": 1}).json()
    pid = client.post("/works/text-proposals/submit", json={
        "code": code, "work_id": "w1", "pages": [{"stem": "t-001", "text_hash": src["text_hash"],
                                                  "edits": [{"old": "vana", "new": "uus"}]}]}).json()["proposal_id"]
    vastused = iter([True, False])
    monkeypatch.setattr(jobs, "start", lambda p, wid, wdir, user: p == pid and next(vastused))
    assert client.post(f"/works/w1/text-proposals/{pid}/accept").status_code == 202
    assert client.post(f"/works/w1/text-proposals/{pid}/accept").status_code == 409
    assert client.post("/works/w1/text-proposals/puudub/accept").status_code == 404


def test_markup_tags(client):
    tags = client.get("/markup/tags").json()
    nimed = {t["name"] for t in tags}
    assert {"i", "m", "catch", "fw", "pb"} <= nimed
    assert next(t for t in tags if t["name"] == "pb")["paired"] is False


def test_revoke_kutsutakse_rollimuutusel(monkeypatch):
    from server import auth
    kutsutud = []
    monkeypatch.setattr(ptp, "revoke_handoffs", lambda u: kutsutud.append(u))
    auth._revoke_agent_handoffs("kasutaja")
    assert kutsutud == ["kasutaja"]
