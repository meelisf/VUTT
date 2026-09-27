# tests/test_osad_seosed_464.py
"""Seoste ehitaja osa ulatuses (#464 PR 3, ADR 0056 laiendus)."""
import json
from unittest import mock

import pytest

from server.prosopography import ops
from server.prosopography import work_relations_ops as wro

F, A, B, E, M, Q = ("vutt:Pfocus", "vutt:Paaaaa", "vutt:Pbbbbb", "vutt:Peditor", "vutt:Pmenti", "vutt:Pqqqqq")


@pytest.fixture
def net(tmp_path, monkeypatch, prosopo_env):
    """w1 = kirjakogu: kiri k1 (F → A), kiri k2 (B → Q), istung s1 (F, B osalejad).
    E on teose toimetaja (teose tasand). M mainitud k1 lehel ja väljaspool osi."""
    ptw = {
        F: [{"work_id": "w1", "role": "auctor", "part_id": "k1"},
            {"work_id": "w1", "role": "participant", "part_id": "s1"}],
        A: [{"work_id": "w1", "role": "addressee", "part_id": "k1"}],
        B: [{"work_id": "w1", "role": "auctor", "part_id": "k2"},
            {"work_id": "w1", "role": "participant", "part_id": "s1"}],
        Q: [{"work_id": "w1", "role": "addressee", "part_id": "k2"}],
        E: [{"work_id": "w1", "role": "editor"}],
        M: [{"work_id": "w1", "role": "mentioned", "pages": [2, 9], "part_ids": ["k1"]}],
    }
    facts = {"w1": {
        "title": "Epistolae", "year": 1690, "creators": [], "genres": [],
        "location": {"id": "Q13972", "label": "Tartu"},
        "parts": {
            "k1": {"kind": "letter", "title": "Kiri Fischerile", "year": 1684,
                   "place": {"id": "Q1794", "label": "Frankfurt"}, "first_page": 2, "pages": [2, 3]},
            "k2": {"kind": "letter", "title": "", "year": None, "place": None, "first_page": 4, "pages": [4]},
            "s1": {"kind": "session", "title": "Istung", "year": 1686,
                   "place": {"id": "Q13972", "label": "Tartu"}, "first_page": 6, "pages": [6, 7]},
        },
    }}
    idx = {"entries": [{"id": x, "label": x[6:]} for x in (F, A, B, E, M, Q)]}
    for name, data in (("ptw.json", ptw), ("wci.json", facts), ("wc.json", {"w1": ["agc"]}), ("idx.json", idx)):
        (tmp_path / name).write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(ops, "PERSON_TO_WORKS_FILE", str(tmp_path / "ptw.json"))
    monkeypatch.setattr(ops, "WORK_COLLECTIONS_INDEX_FILE", str(tmp_path / "wc.json"))
    monkeypatch.setattr(ops, "PROSOPOGRAPHY_INDEX_FILE", str(tmp_path / "idx.json"))
    monkeypatch.setattr(wro, "WORKS_CREATORS_INDEX_FILE", str(tmp_path / "wci.json"))
    for n in ("focus", "aaaaa", "bbbbb", "editor", "menti", "qqqqq"):
        prosopo_env.write(n)
    cols = {"agc": {"visibility": "public"}}
    with mock.patch("server.cache.get_cached_collections", return_value=cols), \
         mock.patch("server.access_ops.get_cached_collections", return_value=cols):
        yield prosopo_env


def _build(pid):
    from server.prosopography.network import build_person_network
    return build_person_network(pid)


def _edges(res, a, b):
    return [e for e in res["edges"] if {e["from"], e["to"]} == {a, b}]


def test_kirjakogu_eri_osad_ei_paaritu(net):
    """Kirjakogu kirjutajad ei muutu üksteise kaastekstiks."""
    res = _build(F)
    assert _edges(res, F, Q) == []            # Q on ainult kirjas k2
    assert _edges(res, F, E) == []            # teose toimetaja ≠ osa roll


def test_saatja_adressaat_dedicated_osa_andmetega(net):
    (e,) = _edges(_build(F), F, A)
    assert (e["kind"], e["from"], e["to"], e["directed"]) == ("dedicated", F, A, True)
    assert e["evidence"]["part_id"] == "k1" and e["evidence"]["work_id"] == "w1"
    assert e["year"] == 1684
    assert e["place"] == {"id": "Q1794", "label": "Frankfurt", "kind": "sent_from"}


def test_istungi_osalejad_academic(net):
    (e,) = _edges(_build(F), F, B)            # k2-s ei kohtu, s1-s on mõlemad osalejad
    assert (e["kind"], e["directed"]) == ("academic", False)
    assert e["evidence"]["part_id"] == "s1"
    assert e["place"] == {"id": "Q13972", "label": "Tartu", "kind": "event"} and e["year"] == 1686


def test_mainimine_paarub_osa_isikutega_ja_lehed_osa_piires(net):
    res = _build(M)
    (e,) = _edges(res, M, F)
    assert e["kind"] == "mention" and e["evidence"]["part_id"] == "k1"
    assert e["evidence"]["pages"] == [2]      # lk 9 ei kuulu osasse k1
    # lk 9 on väljaspool osi → paarub teose tasandi rollidega (toimetaja E)
    (w,) = _edges(res, M, E)
    assert "part_id" not in w["evidence"] and w["evidence"]["pages"] == [9]
    assert _edges(res, M, B) == [] and _edges(res, M, Q) == []


def test_part_only_mainimine_ei_paaritu_teose_tasandil(net, tmp_path):
    ptw = json.loads((tmp_path / "ptw.json").read_text())
    ptw[M] = [{"work_id": "w1", "role": "mentioned", "pages": [2], "part_ids": ["k1"], "part_only": True}]
    (tmp_path / "ptw.json").write_text(json.dumps(ptw), encoding="utf-8")
    assert _edges(_build(M), M, E) == []


def test_vastus_kannab_osi(net):
    parts = {p["part_id"]: p for p in _build(F)["parts"]}
    assert set(parts) == {"k1", "s1"}
    assert parts["k1"] == {"work_id": "w1", "part_id": "k1", "kind": "letter",
                           "title": "Kiri Fischerile", "year": 1684, "first_page": 2}


def test_osa_aastata_votab_teose_aasta_ja_koht_trukikoht(net):
    (e,) = _edges(_build(B), B, Q)
    assert e["year"] == 1690 and e["place"] == {"id": "Q13972", "label": "Tartu", "kind": "print"}


def test_summeetria(net):
    a = _edges(_build(F), F, A)[0]
    b = _edges(_build(A), F, A)[0]
    assert (a["kind"], a["from"], a["to"], a["evidence"]) == (b["kind"], b["from"], b["to"], b["evidence"])


def test_kasikirja_teos_margitud(net, tmp_path):
    facts = json.loads((tmp_path / "wci.json").read_text())
    facts["w1"]["manuscript"] = True
    (tmp_path / "wci.json").write_text(json.dumps(facts), encoding="utf-8")
    (w,) = _build(F)["works"]
    assert w["manuscript"] is True
