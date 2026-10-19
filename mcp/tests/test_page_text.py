"""#641: lehe teksti ettepaneku MCP tööriistad — toortekst koodiga, asendused räsi vastu."""
import json

import pytest

from vutt_mcp import page_text
from vutt_mcp.errors import VuttError


class FakeClient:
    def __init__(self, responses=None, error=None):
        self.calls = []
        self.responses = responses or {}
        self.error = error

    def _resp(self, method, path, body=None):
        self.calls.append((method, path, body))
        if self.error:
            raise self.error
        return self.responses[path]

    def api_get(self, path, params=None):
        return self._resp("get", path)

    def api_post(self, path, json_body):
        return self._resp("post", path, json_body)

    def api_post_once(self, path, json_body):
        return self._resp("post_once", path, json_body)


SOURCE = {"work_id": "w1abcd", "page": 3, "stem": "t-003", "text_hash": "h",
          "status": "Toores", "text": "rida <i>üks</i>\n<m>ääre</m>\n"}
TAGS = [{"name": "i", "paired": True, "tei": "hi"}, {"name": "pb", "paired": False, "tei": "pb"}]


@pytest.fixture(autouse=True)
def _tags_cache():
    page_text._TAGS_CACHE.clear()


def test_source_tagastab_toore_teksti():
    c = FakeClient({"/works/text-proposals/source": SOURCE, "/markup/tags": TAGS})
    out = json.loads(page_text.page_source(c, "kood", "w1abcd", 3))
    assert out["text"] == SOURCE["text"] and out["stem"] == "t-003" and out["text_hash"] == "h"
    assert {t["name"] for t in out["tags"]} == {"i", "pb"}
    assert c.calls[0] == ("post", "/works/text-proposals/source",
                          {"code": "kood", "work_id": "w1abcd", "page": 3})


def test_tagide_loend_vahemallu():
    c = FakeClient({"/works/text-proposals/source": SOURCE, "/markup/tags": TAGS})
    page_text.page_source(c, "kood", "w1abcd", 3)
    page_text.page_source(c, "kood", "w1abcd", 3)
    assert [p for _, p, _ in c.calls].count("/markup/tags") == 1


def test_submit_kasutab_post_once():
    c = FakeClient({"/works/text-proposals/submit": {"proposal_id": "p1", "pages": 1, "superseded": []}})
    pages = [{"stem": "t-003", "text_hash": "h", "edits": [{"old": "üks", "new": "yks"}]}]
    msg = page_text.submit(c, "kood", "w1abcd", pages, "pildi järgi")
    assert c.calls[0][0] == "post_once" and "p1" in msg
    assert c.calls[0][2] == {"code": "kood", "work_id": "w1abcd", "pages": pages, "note": "pildi järgi"}


@pytest.mark.parametrize("pages", [
    [],
    [{"text_hash": "h", "edits": [{"old": "a", "new": "b"}]}],
    [{"stem": "t-1", "edits": [{"old": "a", "new": "b"}]}],
    [{"stem": "t-1", "text_hash": "h", "edits": []}],
    [{"stem": "t-1", "text_hash": "h", "edits": [{"old": "a"}]}],
    [{"stem": f"t-{i}", "text_hash": "h", "edits": [{"old": "a", "new": "b"}]} for i in range(201)],
])
def test_kliendipoolne_valideerimine(pages):
    c = FakeClient()
    with pytest.raises(VuttError):
        page_text.submit(c, "kood", "w1abcd", pages, "")
    assert c.calls == []


def test_serveri_viga_jouab_agendini():
    c = FakeClient(error=VuttError("VUTT vastas veaga (HTTP 400): old_not_found:t-003:0"))
    with pytest.raises(VuttError) as e:
        page_text.submit(c, "kood", "w1abcd",
                         [{"stem": "t-003", "text_hash": "h", "edits": [{"old": "x", "new": "y"}]}], "")
    assert "old_not_found:t-003:0" in str(e.value) and "get_page_source" in str(e.value)
