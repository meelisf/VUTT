"""Review töökollektsiooni ligipääs ja ulatuse edastamine."""
import pytest
from fastapi import HTTPException
from starlette.requests import Request
from server.routers import editing


@pytest.fixture(autouse=True)
def inline_threadpool(monkeypatch):
    async def run(func, *args, **kwargs):
        return func(*args, **kwargs)
    monkeypatch.setattr(editing, "run_in_threadpool", run)


def request(query):
    return Request({"type": "http", "query_string": query.encode()})


@pytest.mark.asyncio
@pytest.mark.parametrize("ws", [None, {"visibility": "members", "access": {}}])
async def test_missing_or_forbidden_set_is_404(monkeypatch, ws):
    monkeypatch.setattr(editing, "load_work_set", lambda _: ws)
    def unexpected(**kwargs):
        pytest.fail("Keelatud kogu ei tohi ajalugu pärida")
    monkeypatch.setattr(editing, "get_recent_commits", unexpected)
    with pytest.raises(HTTPException) as exc:
        await editing.recent_edits(request("set=private"), {"username": "anne", "role": "contributor"})
    assert exc.value.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("ids", [[], ["wA"]])
@pytest.mark.parametrize("role, expected_user", [("admin", "peeter"), ("contributor", "anne")])
async def test_visible_ids_and_user_scope_passed_to_history(monkeypatch, ids, role, expected_user):
    ws = {"visibility": "public"}
    user = {"username": "anne", "role": role}
    monkeypatch.setattr(editing, "load_work_set", lambda _: ws)
    def visible(actual_ws, actual_user):
        assert actual_ws is ws and actual_user is user
        return ids
    monkeypatch.setattr(editing, "search_visible_work_ids", visible)
    captured = {}
    def history(**kwargs):
        captured.update(kwargs)
        return {"commits": [], "has_more": False}
    monkeypatch.setattr(editing, "get_recent_commits", history)
    await editing.recent_edits(request("set=public&user=peeter&offset=50"), user)
    assert captured == dict(username=expected_user, limit=30, skip=50, collection=None, work_ids=ids)
