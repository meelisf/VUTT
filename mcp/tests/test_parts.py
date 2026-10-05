"""Teose osade tööriistad (#492 samm 2)."""
import json

import pytest

from vutt_mcp import parts
from vutt_mcp.errors import VuttError


class FakeClient:
    def __init__(self, data=None):
        self.data = data or {"parts": [{"id": "k1", "kind": "letter", "title": "Kiri",
                                        "pages": ["t-002", "t-003"], "creators": []}],
                             "page_numbers": {"t-002": 2, "t-003": 3},
                             "page_count": 6, "pages_version": "abc123"}
        self.posted = None

    def api_get(self, path, params=None):
        assert path == "/works/w1ab/parts"
        return self.data

    def api_post_once(self, path, body):
        self.posted = (path, body)
        return {"proposal_id": "p1", "parts": len(body["parts"])}


def test_osad_numbritega_ja_versiooniga():
    out = json.loads(parts.work_parts(FakeClient(), "w1ab"))
    assert out["pages_version"] == "abc123" and out["page_count"] == 6
    assert out["parts"][0]["pages"] == [2, 3]


def test_osa_tekstivaljad_kaasas():
    """Märkused, algus ja keeled on agendile (ja parandusele) vajalik kontekst."""
    c = FakeClient()
    c.data["parts"][0].update(notes="Kiri on dateerimata; aasta kaaskirjast.", incipit="Hochwürdiger Herr",
                              abstract_et="Kiri Fischerile.", abstract_en="Letter to Fischer.",
                              languages=["ger"])
    p = json.loads(parts.work_parts(c, "w1ab"))["parts"][0]
    assert p["notes"] == "Kiri on dateerimata; aasta kaaskirjast."
    assert (p["abstract_et"], p["abstract_en"]) == ("Kiri Fischerile.", "Letter to Fischer.")
    assert p["incipit"] == "Hochwürdiger Herr" and p["languages"] == ["ger"]


def test_esitus_saadab_ainult_ettepaneku():
    c = FakeClient()
    text = parts.submit_parts(c, "kood", "w1ab", "abc123", [{"kind": "letter", "pages": [4]}])
    assert c.posted[0] == "/works/parts-proposals/submit"
    assert c.posted[1]["pages_version"] == "abc123"
    assert "teost ei muudetud" in text


@pytest.mark.parametrize("work_id, items", [("../x", [{}]), ("w1ab", []), ("w1ab", [{}] * 51)])
def test_vigane_sisend(work_id, items):
    with pytest.raises(VuttError):
        parts.submit_parts(FakeClient(), "kood", work_id, "v", items)


def test_isikud_kaasas_kui_antud():
    c = FakeClient()
    parts.submit_parts(c, "kood", "w1ab", "v", [{"kind": "letter", "pages": [1],
        "creators": [{"person_ref": "p1", "role": "addressee"}]}], [{"ref": "p1", "name": "Fischer"}])
    assert c.posted[1]["persons"] == [{"ref": "p1", "name": "Fischer"}]
    c2 = FakeClient()
    parts.submit_parts(c2, "kood", "w1ab", "v", [{"kind": "letter", "pages": [1]}])
    assert "persons" not in c2.posted[1]
