"""Lehe ühine ajalugu: `.txt` + `.json` (#375 punkt 1).

Toimetajakiht (tekst-annotatsioonid, lehe märkmed, märksõnad) elab lehe
JSON-is. Ainult `.txt` ajalugu küsiv vaade jättis välja commitid, kus muutus
ainult see kiht — kasutaja ei leidnud taastamiseks annotatsiooniseisu.
"""
import json
import os

import pytest
from git import Repo

from server.page_history import summarize_page_change


def _j(**kw):
    return json.dumps(kw)


def test_annotatsiooni_markuse_muutus_on_loetav():
    enne = _j(text_annotations=[{"id": 1, "comment": "vana"}, {"id": 2, "comment": "kaob"}])
    parast = _j(text_annotations=[{"id": 1, "comment": "uus"}, {"id": 3, "comment": "lisatud"}])

    m = summarize_page_change(enne, parast)["text_annotations"]

    assert m["modified"] == [{"id": 1, "before": "vana", "after": "uus"}]
    assert m["added"] == [{"id": 3, "text": "lisatud"}]
    assert m["removed"] == [{"id": 2, "text": "kaob"}]


def test_markmed_marksonad_ja_staatus():
    enne = _j(comments=[{"id": "a", "text": "üks"}], page_tags=["vana", {"id": "Q1", "label": "Tartu"}],
              status="Toores")
    parast = _j(comments=[{"id": "a", "text": "üks", "replies": [{"text": "vastus"}]},
                          {"id": "b", "text": "kaks"}],
                page_tags=[{"id": "Q1", "label": "Tartu"}, {"id": "Q2", "label": "Riia"}],
                status="Töös")

    s = summarize_page_change(enne, parast)

    assert s["comments"]["added"] == [{"id": "b", "text": "kaks"}]
    # Vastuse lisamine on märkme muutus, mitte uus märge.
    assert [c["id"] for c in s["comments"]["modified"]] == ["a"]
    assert s["page_tags"] == {"added": ["Riia"], "removed": ["vana"]}
    assert s["status"] == {"before": "Toores", "after": "Töös"}


def test_tehnilised_valjad_ei_ole_muutus():
    enne = _j(updated_at="2026-01-01", text_annotations=[])
    parast = _j(updated_at="2026-09-01", text_annotations=[])
    assert summarize_page_change(enne, parast) == {}


def test_tundmatu_valja_muutus_nimetatakse():
    assert summarize_page_change(_j(foo=1), _j(foo=2)) == {"other_fields": ["foo"]}


def test_vana_meta_content_wrapper_ja_puuduv_enne():
    """Kirjed elavad kas lamedas JSON-is või vanas `meta_content` wrapperis."""
    parast = json.dumps({"meta_content": {"text_annotations": [{"id": 5, "comment": "x"}]}})
    s = summarize_page_change(None, parast)
    assert s["text_annotations"]["added"] == [{"id": 5, "text": "x"}]


def test_loetamatu_json_ei_kukuta():
    assert summarize_page_change("{katki", _j(status="Töös")) == {"status": {"before": None, "after": "Töös"}}


# --- Ühine ajalugu päris git-repos -----------------------------------------

@pytest.fixture
def repo(tmp_path):
    r = Repo.init(str(tmp_path))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")
    folder = tmp_path / "w"
    folder.mkdir()
    txt, jp = folder / "p1.txt", folder / "p1.json"

    def commit(msg, text=None, meta=None):
        failid = []
        if text is not None:
            txt.write_text(text, encoding="utf-8"); failid.append("w/p1.txt")
        if meta is not None:
            jp.write_text(json.dumps(meta), encoding="utf-8"); failid.append("w/p1.json")
        r.index.add(failid)
        return r.index.commit(msg).hexsha

    h1 = commit("originaal", "tekst", {"text_annotations": []})
    h2 = commit("ainult märkus", meta={"text_annotations": [{"id": 1, "comment": "m"}]})
    h3 = commit("ainult tekst", text="parandatud tekst")
    h4 = commit("mõlemad", "lõplik <ann1>tekst</ann1>",
                {"text_annotations": [{"id": 1, "comment": "m2"}]})
    # Teise lehe muudatus ei tohi selle lehe ajalukku jõuda.
    (folder / "p2.txt").write_text("muu", encoding="utf-8")
    r.index.add(["w/p2.txt"]); r.index.commit("teine leht")
    return {"dir": str(tmp_path), "h": [h1, h2, h3, h4]}


def test_uhine_ajalugu_naitab_json_only_committi_ilma_duplikaadita(repo):
    from server.page_history import build_page_history

    res = build_page_history(repo["dir"], "w/p1.txt", "w/p1.json", max_count=50)
    ajalugu = res["history"]

    assert [e["full_hash"] for e in ajalugu] == list(reversed(repo["h"]))
    assert res["has_more"] is False
    h1, h2, h3, h4 = repo["h"]
    by = {e["full_hash"]: e for e in ajalugu}
    assert by[h2]["changes"]["text"] is False
    assert by[h2]["changes"]["text_annotations"]["added"] == [{"id": 1, "text": "m"}]
    assert by[h3]["changes"] == {"text": True}
    assert by[h4]["changes"]["text"] is True
    assert by[h4]["changes"]["text_annotations"]["modified"] == [{"id": 1, "before": "m", "after": "m2"}]
    assert by[h1]["is_original"] is True
    assert by[h1]["changes"]["text"] is True


def test_mahupiir_on_nahtav(repo):
    from server.page_history import build_page_history

    res = build_page_history(repo["dir"], "w/p1.txt", "w/p1.json", max_count=2)

    assert len(res["history"]) == 2
    assert res["has_more"] is True
    # Originaal ei ole aknas → ükski kirje ei tohi end originaaliks nimetada.
    assert not any(e["is_original"] for e in res["history"])


def test_tapitahtedega_kaust(tmp_path):
    """Päris kaustanimed kannavad täpitähti (`1696-6-Rörling_…`). Git paneb
    need vaikimisi jutumärkidesse (`core.quotePath`) ja „mis muutus" läheks
    vaikselt valeks."""
    from server.page_history import build_page_history

    r = Repo.init(str(tmp_path))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")
    kaust = tmp_path / "1696-Rörling_Då"
    kaust.mkdir()
    (kaust / "p.txt").write_text("t", encoding="utf-8")
    (kaust / "p.json").write_text(json.dumps({"status": "Toores"}), encoding="utf-8")
    r.index.add(["1696-Rörling_Då/p.txt", "1696-Rörling_Då/p.json"]); r.index.commit("1")
    (kaust / "p.json").write_text(json.dumps({"status": "Töös"}), encoding="utf-8")
    r.index.add(["1696-Rörling_Då/p.json"]); r.index.commit("2")

    [uus, _] = build_page_history(str(tmp_path), "1696-Rörling_Då/p.txt",
                                  "1696-Rörling_Då/p.json")["history"]
    assert uus["changes"] == {"text": False, "status": {"before": "Toores", "after": "Töös"}}
