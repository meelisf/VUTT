"""Eksemplari tööriistad (#703): lugemine ja ootel ettepaneku esitus."""
import json

import pytest

from vutt_mcp import exemplars
from vutt_mcp.errors import VuttConfigError, VuttError, VuttNotFound

ROW = {"op": "create", "fields": {"holder": "TÜR", "shelfmark": "R Est.B-954 (I)"},
       "source": {"kind": "ester", "ref": "b2648642", "quote": "R Est.B-954 (I)"}}


class FakeClient:
    def __init__(self, fail=None):
        self.fail = fail
        self.posts = []

    def api_get(self, path, params=None):
        if path == "/config/archives":
            return {"status": "success", "archives": {"TÜR": {"name": "Tartu Ülikooli Raamatukogu",
                                                              "aliases": ["Tartu ÜR"]},
                                                      "RA": {"name": "Rahvusarhiiv", "url": "https://x"}}}
        assert path == "/works/w1ab/exemplars"
        if self.fail:
            raise self.fail
        return {"exemplars": [{"id": "a1", "holder": "TÜR", "shelfmark": "R Est.B-954", "pages": ["t-001"],
                               "source": {"kind": "migration"}, "needs_review": True,
                               "convolute": {"reference": "R Est.B-954", "position": 0}}],
                "unknown_pages": [], "page_numbers": {}, "page_count": 63,
                "convolutes": [{"key": "tür:r est.b-954", "members": [{"work_id": "w1ab"}]}]}

    def api_post_once(self, path, body):
        self.posts.append((path, body))
        return {"proposal_id": "p1", "rows": len(body["rows"]), "status": "pending"}


def test_eksemplarid_ja_hoidjad():
    out = json.loads(exemplars.work_exemplars(FakeClient(), "w1ab"))
    (x,) = out["exemplars"]
    assert x["id"] == "a1" and x["convolute"]["position"] == 0
    # Serveri väljad, mida agent ei pakkuda tohi, ei ole väljundis (lehed, lipp, allikas)
    assert "pages" not in x and "needs_review" not in x and "source" not in x
    assert out["holders"] == {"TÜR": "Tartu Ülikooli Raamatukogu", "RA": "Rahvusarhiiv"}
    assert out["holder_aliases"] == {"Tartu ÜR": "TÜR"}


@pytest.mark.parametrize("err", [VuttNotFound("x"), VuttConfigError("HTTP 403")])
def test_piiratud_teos_annab_juhise(err):
    with pytest.raises(VuttNotFound, match="piiratud"):
        exemplars.work_exemplars(FakeClient(fail=err), "w1ab")


def test_esitus_saadab_keha_ja_ei_korda():
    c = FakeClient()
    text = exemplars.submit_exemplars(c, "kood", "w1ab", [ROW], note="ESTER b2648642")
    assert c.posts == [("/works/exemplar-proposals/submit",
                        {"code": "kood", "work_id": "w1ab", "rows": [ROW], "note": "ESTER b2648642"})]
    assert "p1" in text and "teost ei muudetud" in text and "Eksemplarid" in text
    c2 = FakeClient()
    exemplars.submit_exemplars(c2, "kood", "w1ab", [ROW])
    assert "note" not in c2.posts[0][1]


@pytest.mark.parametrize("work_id, rows", [("../x", [ROW]), ("w1ab", []), ("w1ab", [ROW] * 31),
                                           ("w1ab", "pole loend")])
def test_ridade_lagi_ja_vigane_sisend(work_id, rows):
    c = FakeClient()
    with pytest.raises(VuttError):
        exemplars.submit_exemplars(c, "kood", work_id, rows)
    assert c.posts == []


class BatchClient(FakeClient):
    def api_get(self, path, params=None):
        if path == "/exemplars/batch":
            self.params = params
            return {"results": {
                "w1ab": {"exemplars": [{"id": "a1", "holder": "TÜR", "pages": ["t-001"]}]},
                "w2cd": {"error": {"status": 403, "detail": "Puudub ligipääs"}},
                "w3ef": {"error": {"status": 404, "detail": "Teost ei leitud"}},
            }}
        return super().api_get(path, params)


def test_koguparing_uks_kutse_ja_vead_eraldi():
    c = BatchClient()
    out = json.loads(exemplars.works_exemplars(c, ["w1ab", "w2cd", "w3ef", "w1ab"]))
    assert c.params == {"work_ids": "w1ab,w2cd,w3ef"}          # dubleeritud id korra
    assert out["works"]["w1ab"]["exemplars"][0]["id"] == "a1"
    assert "pages" not in out["works"]["w1ab"]["exemplars"][0]
    assert "piiratud" in out["errors"]["w2cd"] and out["errors"]["w3ef"] == "ei leitud"
    assert out["holders"]["TÜR"] == "Tartu Ülikooli Raamatukogu"


@pytest.mark.parametrize("ids", [[], "w1ab", ["w1ab"] * 0, [f"w{i:03d}ab" for i in range(51)], ["viga/!"]])
def test_koguparing_vigane_sisend(ids):
    with pytest.raises(VuttError):
        exemplars.works_exemplars(BatchClient(), ids)
