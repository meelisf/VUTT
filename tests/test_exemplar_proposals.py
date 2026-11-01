# tests/test_exemplar_proposals.py
"""Agendi eksemplari-ettepanekud (#703, ADR 0076 §7, ADR 0058): kood → ootel
ettepanek → superadmin kinnitab või lükkab read tagasi. Esitus teost ei muuda;
kinnitus käib `work_exemplars.apply_proposal_ops` kaudu (üks commit)."""
import json
import sqlite3
import time

import pytest

from server import agent_handoff
from server import exemplar_proposals as epp
from server import work_exemplars as we
from server import work_part_proposals as wpp

COMMITS: list = []

A = {"id": "a", "holder": "TÜR", "shelfmark": "R Est.B-954",
     "source": {"kind": "migration", "ref": "TÜR: R Est.B-954"}, "needs_review": True}
UPD = {"op": "update", "exemplar_id": "a",
       "fields": {"convolute": {"reference": "R Est.B-954", "position": 0, "total": 2}},
       "base": {"convolute": None},
       "source": {"kind": "ester", "ref": "b2648642", "quote": "konvoluut, koos 1 trükisega"}}
NEW = {"op": "create", "fields": {"holder": "TÜR", "shelfmark": "R Est.B-954 (I)", "condition": "defektne"},
       "source": {"kind": "ester", "ref": "b2648642", "quote": "R Est.B-954 (I): defektne"}}


@pytest.fixture
def work(tmp_path, monkeypatch):
    import importlib
    from server import metadata_ops
    # Kood loeb registrit `from .config import ARCHIVES_FILE` kaudu (sys.modules); mõni test
    # impordib server.config'i uuesti, nii et paketi atribuut võib olla teine moodul.
    config = importlib.import_module("server.config")
    monkeypatch.setattr(epp, "DB_PATH", str(tmp_path / "epp.sqlite3"))
    monkeypatch.setattr(wpp, "DB_PATH", str(tmp_path / "wpp.sqlite3"))
    monkeypatch.setattr(agent_handoff, "DB_PATH", str(tmp_path / "handoff.sqlite3"))
    d = tmp_path / "slug-w1"
    d.mkdir()
    for s in ("t-001", "t-002"):
        (d / f"{s}.jpg").write_bytes(b"x")
    (d / "_metadata.json").write_text(json.dumps({"id": "w1", "title": "Das Bild", "exemplars": [A]}),
                                      encoding="utf-8")
    archives = tmp_path / "archives.json"
    archives.write_text(json.dumps({"TÜR": {"name": "Tartu Ülikooli Raamatukogu"}}), encoding="utf-8")
    monkeypatch.setattr(config, "ARCHIVES_FILE", str(archives))
    COMMITS.clear()

    def fake_save(path, content, *a, additional_files=None, message="", **k):
        from server.utils import atomic_write_text
        atomic_write_text(path, content)
        COMMITS.append(message)
        return {"success": True}
    monkeypatch.setattr(metadata_ops, "save_with_git", fake_save)
    monkeypatch.setattr(metadata_ops, "uncommitted_paths", lambda paths: [])
    for name in ("sync_work_to_meilisearch", "sync_work_to_meilisearch_async", "update_person_to_works",
                 "update_work_collections", "update_work_facts"):
        monkeypatch.setattr(metadata_ops, name, lambda *a, **k: None)
    import os
    monkeypatch.setattr(we, "page_stems", lambda wd: sorted(
        os.path.splitext(n)[0] for n in os.listdir(wd) if n.endswith(".jpg")))
    return str(d)


def _meta(work):
    with open(f"{work}/_metadata.json", encoding="utf-8") as f:
        return json.load(f)


def _write_meta(work, meta):
    with open(f"{work}/_metadata.json", "w", encoding="utf-8") as f:
        json.dump(meta, f)


def _submit(work, rows, code=None, username="ed", note=None):
    code = code or epp.issue_handoff(username, work_id="w1")["code"]
    return epp.submit(code, "w1", work, rows, note)


def _rows(work, username="ed"):
    return [r for p in epp.list_for_work("w1", work, username) for r in p["rows"]]


def test_esitus_ei_muuda_teost(work):
    raw = open(f"{work}/_metadata.json", "rb").read()
    res = _submit(work, [UPD, NEW], note="ESTER b2648642")
    assert res["status"] == "pending" and res["rows"] == 2
    assert open(f"{work}/_metadata.json", "rb").read() == raw and COMMITS == []
    (p,) = epp.list_for_work("w1", work, "ed")
    assert p["note"] == "ESTER b2648642"
    assert [r["review_state"] for r in p["rows"]] == ["pending", "pending"]
    upd, new = p["rows"]
    assert upd["current"]["id"] == "a" and upd["exemplar_id"] == "a"
    assert new["current"] is None and new["source"]["ref"] == "b2648642"


@pytest.mark.parametrize("bad, code", [
    ({**NEW, "fields": {**NEW["fields"], "text_witness": True}}, "invalid_field"),
    ({**NEW, "fields": {**NEW["fields"], "pages": ["t-001"]}}, "invalid_field"),
    ({**NEW, "fields": {**NEW["fields"], "needs_review": False}}, "invalid_field"),
    ({**NEW, "source": {**NEW["source"], "kind": "web"}}, "invalid_source"),
    ({**NEW, "source": {**NEW["source"], "ref": "12345"}}, "invalid_source"),
    ({**NEW, "source": {**NEW["source"], "quote": "x" * 501}}, "invalid_source"),
    ({**NEW, "source": {**NEW["source"], "quote": "  "}}, "invalid_source"),
    ({**NEW, "fields": {"shelfmark": "X"}}, "invalid_field"),                 # create ilma hoidjata
    ({**UPD, "base": {}}, "invalid_base"),                                      # base peab katma fields võtmed
    ({**UPD, "exemplar_id": "puudub"}, "unknown_exemplar"),
    ({**UPD, "base": {"convolute": {"reference": "muu"}}}, "stale_base"),      # agent nägi vana seisu
    ({**NEW, "fields": {**NEW["fields"], "convolute": {"reference": "R", "position": 5, "total": 2}}},
     "fields.convolute"),
    ({**NEW, "extra": 1}, "invalid_row"),
])
def test_vigane_rida_lukatakse_tagasi_ja_kood_ei_kulu(work, bad, code):
    h = epp.issue_handoff("ed", work_id="w1")
    with pytest.raises(epp.ProposalError, match=code) as e:
        _submit(work, [UPD, bad] if bad is not UPD else [bad], code=h["code"])
    assert "rows[1]" in str(e.value) or "rows[0]" in str(e.value)
    assert agent_handoff.check(h["code"], "exemplars", "w1")["uses"] == 0


def test_ridade_lagi(work):
    with pytest.raises(epp.ProposalError, match="invalid_rows"):
        _submit(work, [])
    many = [{**NEW, "fields": {"holder": "TÜR", "shelfmark": f"X {i}"}} for i in range(31)]
    with pytest.raises(epp.ProposalError, match="invalid_rows"):
        _submit(work, many)


def test_markus_on_piiratud(work):
    with pytest.raises(epp.ProposalError, match="invalid_note"):
        _submit(work, [NEW], note="x" * 1001)


def test_kood_ilma_exemplars_liigita_ei_kehti(work):
    code = wpp.issue_handoff("ed", work_id="w1")["code"]
    with pytest.raises(epp.ProposalError, match="invalid_or_expired_handoff"):
        _submit(work, [NEW], code=code)


def test_partii_kinnitus_uks_commit(work):
    res = _submit(work, [UPD, NEW])
    pid = res["proposal_id"]
    out = epp.decide("w1", work, "ed", [(pid, 0), (pid, 1)], "accept")
    assert len(COMMITS) == 1 and "agendi ettepanek" in COMMITS[0] and "b2648642" in COMMITS[0]
    ex = _meta(work)["exemplars"]
    assert out["accepted"] == ["a", ex[1]["id"]]
    # Muudatus ei kirjuta kasutaja sisestatud allikat üle; ESTER on commit-sõnumis
    assert ex[0]["source"]["kind"] == "migration" and ex[0]["convolute"]["total"] == 2
    assert ex[1]["source"]["kind"] == "ester"
    assert ex[1]["needs_review"] is True and ex[1]["shelfmark"] == "R Est.B-954 (I)"
    rows = _rows(work)
    assert [r["review_state"] for r in rows] == ["accepted", "accepted"]
    assert rows[1]["created_exemplar_id"] == ex[1]["id"]


def test_tagasilukkamine_ei_muuda_teost(work):
    pid = _submit(work, [UPD, NEW])["proposal_id"]
    before = _meta(work)
    assert epp.decide("w1", work, "ed", [(pid, 1)], "reject") == {"accepted": [], "rejected": 1}
    assert _meta(work) == before and COMMITS == []
    assert [r["review_state"] for r in _rows(work)] == ["pending", "rejected"]


def test_topelt_create_on_duplicate(work):
    """Migratsioonist juba olemas — agent oleks pidanud esitama update'i."""
    dup = {**NEW, "fields": {"holder": "TÜR", "shelfmark": "R Est. B-954"}}
    pid = _submit(work, [dup])["proposal_id"]
    assert _rows(work)[0]["review_state"] == "duplicate"
    before = _meta(work)
    with pytest.raises(epp.ProposalError, match="not_decidable"):
        epp.decide("w1", work, "ed", [(pid, 0)], "accept")
    assert _meta(work) == before


def test_korduv_esitus_blokeerub_parast_esimest_kinnitust(work):
    """Võrguvea järel kordus: kaks ettepanekut, teine on pärast esimese kinnitust duplicate."""
    p1 = _submit(work, [NEW])["proposal_id"]
    _submit(work, [NEW])
    assert len(epp.list_for_work("w1", work, "ed")) == 2
    epp.decide("w1", work, "ed", [(p1, 0)], "accept")
    states = {p["proposal_id"]: p["rows"][0]["review_state"] for p in epp.list_for_work("w1", work, "ed")}
    assert states[p1] == "accepted"
    assert [s for k, s in states.items() if k != p1] == ["duplicate"]


def test_hoidja_lisamine_vabastab_rea(work):
    import importlib
    config = importlib.import_module("server.config")
    pid = _submit(work, [{**NEW, "fields": {"holder": "RR", "shelfmark": "EAA.1"}}])["proposal_id"]
    assert _rows(work)[0]["review_state"] == "blocked_holder"
    with pytest.raises(epp.ProposalError, match="not_decidable"):
        epp.decide("w1", work, "ed", [(pid, 0)], "accept")
    reg = json.load(open(config.ARCHIVES_FILE))
    reg["RR"] = {"name": "Rahvusarhiiv"}
    json.dump(reg, open(config.ARCHIVES_FILE, "w"))
    assert _rows(work)[0]["review_state"] == "pending"
    epp.decide("w1", work, "ed", [(pid, 0)], "accept")
    assert _meta(work)["exemplars"][1]["holder"] == "RR"


def test_teine_partii_vana_alusega_on_stale(work):
    p1 = _submit(work, [UPD])["proposal_id"]
    p2 = _submit(work, [UPD])["proposal_id"]
    epp.decide("w1", work, "ed", [(p1, 0)], "accept")
    states = {p["proposal_id"]: p["rows"][0]["review_state"] for p in epp.list_for_work("w1", work, "ed")}
    assert states == {p1: "accepted", p2: "stale"}
    before = _meta(work)
    with pytest.raises(epp.ProposalError, match="not_decidable"):
        epp.decide("w1", work, "ed", [(p2, 0)], "accept")
    assert _meta(work) == before


def test_toimetaja_parandus_parast_esitust_teeb_rea_stale(work):
    _submit(work, [{**UPD, "fields": {"condition": "terve"}, "base": {"condition": None}}])
    meta = _meta(work)
    meta["exemplars"][0]["condition"] = "defektne"
    _write_meta(work, meta)
    (row,) = _rows(work)
    assert row["review_state"] == "stale" and row["current"]["condition"] == "defektne"


def test_aegunud_ettepanek_jatab_otsustatud_read(work, monkeypatch):
    pid = _submit(work, [UPD, NEW])["proposal_id"]
    _submit(work, [{**NEW, "fields": {"holder": "TÜR", "shelfmark": "X 9"}}])   # täiesti otsustamata
    epp.decide("w1", work, "ed", [(pid, 0)], "accept")
    later = time.time() + epp.PROPOSAL_TTL + 60
    monkeypatch.setattr(epp.time, "time", lambda: later)
    (p,) = epp.list_for_work("w1", work, "ed")
    assert p["proposal_id"] == pid
    assert [r["review_state"] for r in p["rows"]] == ["accepted", "expired"]
    with pytest.raises(epp.ProposalError, match="not_decidable"):
        epp.decide("w1", work, "ed", [(pid, 1)], "accept")
    assert epp.list_pending_summary("ed") == []


def test_kokkuvote_ja_mittekinnitatavad(work, monkeypatch):
    from server import utils
    monkeypatch.setattr(utils, "find_directory_by_id", lambda wid: work if wid == "w1" else None)
    _submit(work, [UPD, {**NEW, "fields": {"holder": "TÜR", "shelfmark": "r est.b-954"}}])
    (s,) = epp.list_pending_summary("ed")
    # UPD on kinnitatav, teine rida on topelt (migratsioonist juba olemas)
    assert s["work_id"] == "w1" and s["pending"] == 2 and s["stale"] == 1
    meta = _meta(work)
    meta["exemplars"][0]["convolute"] = {"reference": "R Est.B-954"}
    _write_meta(work, meta)
    assert epp.list_pending_summary("ed")[0]["stale"] == 2      # toimetaja muutis → ka UPD aegunud


def test_teine_kasutaja_ei_nae_ega_otsusta(work):
    pid = _submit(work, [NEW])["proposal_id"]
    assert epp.list_for_work("w1", work, "muu") == []
    assert epp.list_pending_summary("muu") == []
    with pytest.raises(epp.ProposalError, match="proposal_not_found"):
        epp.decide("w1", work, "muu", [(pid, 0)], "accept")


@pytest.mark.parametrize("picks, action", [
    ([], "accept"), ([("p", 0), ("p", 0)], "accept"), ([("p", True)], "accept"), ([("p", 0)], "muuda"),
])
def test_vigane_otsus(work, picks, action):
    with pytest.raises(epp.ProposalError):
        epp.decide("w1", work, "ed", picks, action)


def test_hoidla_ei_kasuta_wal(work):
    _submit(work, [NEW])
    for path in (epp.DB_PATH, agent_handoff.DB_PATH):
        mode = sqlite3.connect(path).execute("PRAGMA journal_mode").fetchone()[0]
        assert mode.lower() != "wal"


# ── HTTP (Task 3) ────────────────────────────────────────────────────────────

@pytest.fixture
def client(work, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from server import deps
    from server.routers import work_exemplars as r
    app = FastAPI()
    app.include_router(r.router)
    state = {"user": {"username": "ed", "role": "superadmin"}, "write": True}

    async def fake_get_user(request, min_role="contributor"):
        from fastapi import HTTPException
        from server.auth import is_at_least
        if not is_at_least(state["user"]["role"], min_role):
            raise HTTPException(status_code=403, detail="Puudub õigus")
        return state["user"]
    monkeypatch.setattr(deps, "get_user", fake_get_user)
    monkeypatch.setattr(r, "find_directory_by_id", lambda wid: work if wid == "w1" else None)
    monkeypatch.setattr(r, "load_work_metadata_by_id", lambda wid: _meta(work) if wid == "w1" else None)
    monkeypatch.setattr(r, "can_write_work", lambda meta, user: state["write"])
    monkeypatch.setattr(r, "check_rate_limit", lambda key, endpoint: (True, 0))
    c = TestClient(app)
    c.state = state
    return c


def test_otspunktide_voog(client, work):
    code = epp.issue_handoff("ed", work_id="w1")["code"]
    r = client.post("/works/exemplar-proposals/submit",
                    json={"code": code, "work_id": "w1", "rows": [UPD, NEW], "note": "ESTER"})
    assert r.status_code == 200 and r.json()["rows"] == 2
    pid = r.json()["proposal_id"]
    (p,) = client.get("/works/w1/exemplar-proposals").json()
    assert [row["review_state"] for row in p["rows"]] == ["pending", "pending"]
    r = client.post("/works/w1/exemplar-proposals/decide",
                    json={"items": [{"proposal_id": pid, "index": 0}], "action": "accept"})
    assert r.status_code == 200 and r.json() == {"accepted": ["a"], "rejected": 0}
    assert _meta(work)["exemplars"][0]["source"]["kind"] == "migration"
    # Sama rida uuesti: enam ei ole ootel → 400 not_decidable (409 ainult aegunud/topelt korral)
    r = client.post("/works/w1/exemplar-proposals/decide",
                    json={"items": [{"proposal_id": pid, "index": 0}], "action": "accept"})
    assert r.status_code == 400 and r.json()["detail"].startswith("not_decidable")

    client.state["user"] = {"username": "ed", "role": "admin"}
    assert client.get("/works/w1/exemplar-proposals").status_code == 403
    client.state["user"] = {"username": "ed", "role": "superadmin"}
    client.state["write"] = False
    assert client.get("/works/w1/exemplar-proposals").status_code == 403


def test_submit_vigane_kuju(client, work):
    code = epp.issue_handoff("ed", work_id="w1")["code"]
    base = {"code": code, "work_id": "w1", "rows": [NEW]}
    assert client.post("/works/exemplar-proposals/submit", json={**base, "x": 1}).status_code == 400
    r = client.post("/works/exemplar-proposals/submit", json={**base, "work_id": "puudub"})
    assert r.status_code == 400 and r.json()["detail"] == "invalid_or_expired_handoff"
    assert client.post("/works/exemplar-proposals/submit", content=b"{").status_code == 400
    r = client.post("/works/exemplar-proposals/submit", json={**base, "rows": [{**NEW, "op": "x"}]})
    assert r.status_code == 400 and r.json()["detail"].startswith("invalid_row")
    r = client.post("/works/exemplar-proposals/submit",
                    json={**base, "rows": [{**UPD, "base": {"convolute": {"reference": "muu"}}}]})
    assert r.status_code == 409 and r.json()["detail"].startswith("stale_base")


def test_submit_suur_keha_413(client, monkeypatch):
    monkeypatch.setattr(epp, "MAX_BODY_BYTES", 100)
    r = client.post("/works/exemplar-proposals/submit", json={"code": "x" * 200, "work_id": "w1", "rows": []})
    assert r.status_code == 413


def test_submit_rate_limit(client, monkeypatch):
    from server.routers import work_exemplars as r
    seen = []
    monkeypatch.setattr(r, "check_rate_limit", lambda key, endpoint: (seen.append(endpoint), (False, 7))[1])
    res = client.post("/works/exemplar-proposals/submit", json={})
    assert res.status_code == 429 and res.headers["Retry-After"] == "7"
    assert seen == ["/works/exemplar-proposals-submit"]


@pytest.mark.parametrize("make_blocked", ["duplicate", "stale", "blocked_holder"])
def test_kinnitamatu_rea_saab_tagasi_lukata(work, make_blocked):
    """Topelt, aegunud alus või puuduv hoidja: kinnitada ei saa, aga tagasi lükata saab —
    muidu jääks rida /review loendisse ja töödeldud märge kaoks."""
    if make_blocked == "duplicate":
        row = {**NEW, "fields": {"holder": "TÜR", "shelfmark": "R Est. B-954"}}
    elif make_blocked == "blocked_holder":
        row = {**NEW, "fields": {"holder": "XYZ", "shelfmark": "1"}}
    else:
        row = UPD
    pid = _submit(work, [row])["proposal_id"]
    if make_blocked == "stale":
        meta = _meta(work)
        meta["exemplars"][0]["convolute"] = {"reference": "muu"}
        _write_meta(work, meta)
    assert _rows(work)[0]["review_state"] == make_blocked
    before = _meta(work)
    assert epp.decide("w1", work, "ed", [(pid, 0)], "reject") == {"accepted": [], "rejected": 1}
    assert _meta(work) == before and COMMITS == []
    assert _rows(work)[0]["review_state"] == "rejected"
    assert epp.list_pending_summary("ed") == []


def test_otsustatud_rida_ei_saa_uuesti_tagasi_lukata(work):
    pid = _submit(work, [NEW])["proposal_id"]
    epp.decide("w1", work, "ed", [(pid, 0)], "reject")
    with pytest.raises(epp.ProposalError, match="not_decidable"):
        epp.decide("w1", work, "ed", [(pid, 0)], "reject")


def test_muudatus_mis_teeb_topelt_on_duplicate(work):
    """Kohaviida muutmine teise olemasoleva eksemplari omaks: ülevaatus näitab, kinnitus ei kirjuta."""
    meta = _meta(work)
    meta["exemplars"].append({"id": "b", "holder": "TÜR", "shelfmark": "R Est.B-955"})
    _write_meta(work, meta)
    row = {"op": "update", "exemplar_id": "b", "fields": {"shelfmark": "R Est.B-954"},
           "base": {"shelfmark": "R Est.B-955"}, "source": NEW["source"]}
    pid = _submit(work, [row])["proposal_id"]
    assert _rows(work)[0]["review_state"] == "duplicate"
    before = _meta(work)
    with pytest.raises(we.ExemplarError, match="duplicate:0"):
        we.apply_proposal_ops(work, [{"op": "update", "exemplar_id": "b", "fields": row["fields"],
                                      "base": row["base"], "source_ref": "b2648642"}], "ed", "m")
    assert _meta(work) == before
    with pytest.raises(epp.ProposalError, match="not_decidable"):
        epp.decide("w1", work, "ed", [(pid, 0)], "accept")


def test_muudatus_oma_kohaviida_ümber_ei_ole_duplicate(work):
    """Sama eksemplari kohaviida kirjapildi parandus ei põrka iseendaga."""
    row = {"op": "update", "exemplar_id": "a", "fields": {"shelfmark": "R Est. B-954"},
           "base": {"shelfmark": "R Est.B-954"}, "source": NEW["source"]}
    pid = _submit(work, [row])["proposal_id"]
    assert _rows(work)[0]["review_state"] == "pending"
    epp.decide("w1", work, "ed", [(pid, 0)], "accept")
    assert _meta(work)["exemplars"][0]["shelfmark"] == "R Est. B-954"


def test_muudatus_registrist_puuduva_hoidjaga_on_blocked(work):
    row = {"op": "update", "exemplar_id": "a", "fields": {"holder": "XYZ"},
           "base": {"holder": "TÜR"}, "source": NEW["source"]}
    _submit(work, [row])
    assert _rows(work)[0]["review_state"] == "blocked_holder"


def test_muudatus_jatab_kasitsi_allika_alles(work):
    """Käsitsi sisestatud kirje: kasutajal oli põhjus, agendi kinnitus allikat ei asenda."""
    meta = _meta(work)
    meta["exemplars"][0]["source"] = {"kind": "manual", "at": "2026-10-01"}
    _write_meta(work, meta)
    pid = _submit(work, [UPD])["proposal_id"]
    epp.decide("w1", work, "ed", [(pid, 0)], "accept")
    assert _meta(work)["exemplars"][0]["source"] == {"kind": "manual", "at": "2026-10-01"}
    assert "b2648642" in COMMITS[-1]


def test_muudatus_allikata_kirjel_saab_ester_allika(work):
    meta = _meta(work)
    meta["exemplars"][0].pop("source")
    _write_meta(work, meta)
    pid = _submit(work, [UPD])["proposal_id"]
    epp.decide("w1", work, "ed", [(pid, 0)], "accept")
    assert _meta(work)["exemplars"][0]["source"]["ref"] == "b2648642"
