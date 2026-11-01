# tests/test_agent_proposals.py
"""Ühtne agendikood ja ettepanekute loend `/review`-l (ADR 0058 täiendus 2026-10-20).

Üks kood registreeritakse kolmes hoidlas (tekst, osad, isik); loend koondab kõik
ootel ettepanekud ja annab iga rea jaoks serveri koostatud sihtlingi."""
import json
import os
import sqlite3
import pytest

from server import agent_handoff
from server import agent_proposals as ap
from server import page_text_proposals as ptp
from server import work_part_proposals as wpp
from server import exemplar_proposals as epp
from server.prosopography import enrichment_proposals as ep


LETTER = {"kind": "letter", "title": "Kiri", "pages": [2], "creators": []}
POEM = {"kind": "poem", "title": "Carmen", "pages": [4], "creators": []}
ITEM = {"kind": "occupation", "match_status": "matched", "raw_occupation": "Prof. theol.",
        "occupation_key": "theology-professor", "institution_key": "academia-gustaviana",
        "evidence": [{"source_kind": "vutt_page", "work_id": "w1", "page": 1, "quote": "Prof."}]}


@pytest.fixture
def work(tmp_path, monkeypatch):
    for mod, name in ((ptp, "ptp"), (wpp, "wpp"), (ep, "ep"), (epp, "epp")):
        monkeypatch.setattr(mod, "DB_PATH", str(tmp_path / f"{name}.sqlite3"))
    d = tmp_path / "slug-w1"
    d.mkdir()
    for i in range(1, 6):
        (d / f"t-00{i}.jpg").write_bytes(b"x")
        (d / f"t-00{i}.txt").write_text(f"leht {i} vana\n", encoding="utf-8")
    (d / "_metadata.json").write_text(json.dumps({"id": "w1", "title": "Epistolae"}), encoding="utf-8")
    work_dir = str(d)
    people = {"vutt:Pabc": {"id": "vutt:Pabc", "updated_at": "t", "name": {"label": "Johann Fischer"}}}
    monkeypatch.setattr(ap, "find_directory_by_id", lambda wid: work_dir if wid == "w1" else None)
    monkeypatch.setattr(ap, "load_work_metadata_by_id",
                        lambda wid: json.load(open(f"{work_dir}/_metadata.json")) if wid == "w1" else None)
    monkeypatch.setattr(ap, "get_person", lambda pid: people.get(pid))
    # Isiku esitus kontrollib kaarti ja korpuse viiteid oma moodulis.
    from server.prosopography import person_crud
    import server.utils
    monkeypatch.setattr(person_crud, "get_person", lambda pid: people.get(pid))
    monkeypatch.setattr(server.utils, "find_directory_by_id", lambda wid: work_dir if wid == "w1" else None)
    return work_dir


@pytest.fixture
def client(work, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from server import deps
    from server.routers import agent_proposals as r
    app = FastAPI()
    app.include_router(r.router)
    state = {"user": {"username": "ed", "role": "superadmin"}}

    async def fake_get_user(request, min_role="contributor"):
        from fastapi import HTTPException
        from server.auth import is_at_least
        if not is_at_least(state["user"]["role"], min_role):
            raise HTTPException(status_code=403, detail="Puudub õigus")
        request.state.session_fingerprint = "fp-" + state["user"]["username"]
        return state["user"]
    monkeypatch.setattr(deps, "get_user", fake_get_user)
    c = TestClient(app)
    c.state = state
    return c


def _handoff_kinds(code: str) -> list[str]:
    db = sqlite3.connect(agent_handoff.DB_PATH)
    try:
        return sorted(r[0] for r in db.execute("SELECT kind FROM handoff WHERE code_hash=?",
                                               (agent_handoff.digest(code),)))
    finally:
        db.close()


def _text_pack(work, code, *pages):
    payload = []
    for n in pages:
        src = ptp.read_source(code, "w1", work, n)
        payload.append({"stem": src["stem"], "text_hash": src["text_hash"],
                        "edits": [{"old": "vana", "new": "uus"}]})
    return ptp.submit(code, "w1", work, payload, "")["proposal_id"]


def _by_kind(rows, kind):
    return [r for r in rows if r["kind"] == kind]


# ── Kood ─────────────────────────────────────────────────────────────────────

def test_handoff_registreerib_kolmes(client, work):
    r = client.post("/agent-handoff")
    assert r.status_code == 200
    h = r.json()
    assert h["max_uses"] == {"text": ptp.MAX_USES, "parts": wpp.MAX_USES, "persons": ep.ANY_MAX_USES,
                             "exemplars": epp.MAX_USES}
    assert set(h) == {"code", "expires_at", "max_uses"}
    ptp.check_code(h["code"], "w1")                                      # ei viska
    assert wpp.submit(h["code"], "w1", work, wpp.pages_version(work), [LETTER])["status"] == "pending"
    assert ep.submit(h["code"], "vutt:Pabc", "t", [dict(ITEM)])["status"] == "pending"


def test_handoff_on_uks_tehing(client, monkeypatch):
    """Üks hoidla, üks tehing (#675): kui mõne liigi rida ei mahu, ei jää ka teisi."""
    ep.issue_handoff(None, "teine", "fp", code="k")       # isikurida juba olemas → PK kokkupõrge
    monkeypatch.setattr(agent_handoff.secrets, "token_urlsafe", lambda n: "k")
    r = client.post("/agent-handoff")
    assert r.status_code == 503 and r.json()["detail"] == "agent_handoff_failed"
    assert "code" not in r.json()
    assert _handoff_kinds("k") == ["person"]


def test_liikide_laed_on_eraldi(client, work, monkeypatch):
    """Rida liigi kohta: tekstiesitused ei kuluta osade lage."""
    monkeypatch.setattr(ptp, "MAX_USES", 1)
    code = client.post("/agent-handoff").json()["code"]
    _text_pack(work, code, 2)
    with pytest.raises(ptp.ProposalError, match="handoff_used_up"):
        _text_pack(work, code, 3)
    assert wpp.submit(code, "w1", work, wpp.pages_version(work), [LETTER])["status"] == "pending"


def test_ebaonnestunud_esitus_ei_kuluta_koodi(work, monkeypatch):
    """Koodi kulutus ja ettepaneku INSERT on üks mitme faili tehing (ATTACH)."""
    code = wpp.issue_handoff("ed", work_id="w1")["code"]
    monkeypatch.setattr(wpp, "PROPOSAL_TTL", None)    # viskab pärast kulutust, enne INSERT-i
    with pytest.raises(TypeError):
        wpp.submit(code, "w1", work, wpp.pages_version(work), [LETTER])
    db = sqlite3.connect(agent_handoff.DB_PATH)
    try:
        assert db.execute("SELECT uses FROM handoff").fetchone()[0] == 0
    finally:
        db.close()


def test_ainult_superadmin(client):
    client.state["user"] = {"username": "ed", "role": "admin"}
    assert client.post("/agent-handoff").status_code == 403
    assert client.get("/agent-proposals").status_code == 403


def test_handoff_rate_limit(client, monkeypatch):
    from server.routers import agent_proposals as r
    monkeypatch.setattr(r, "check_rate_limit", lambda key, endpoint: (False, 42))
    res = client.post("/agent-handoff")
    assert res.status_code == 429 and res.headers["Retry-After"] == "42"


# ── Loend ────────────────────────────────────────────────────────────────────

def test_loend_kolm_liiki(client, work):
    code = client.post("/agent-handoff").json()["code"]
    pid = _text_pack(work, code, 5, 2)
    ptp.mark_stale(pid, ["t-005"])
    wpp.submit(code, "w1", work, wpp.pages_version(work), [LETTER, POEM])
    ep.submit(code, "vutt:Pabc", "t", [dict(ITEM), {**ITEM, "raw_occupation": "Pastor"}])

    rows = client.get("/agent-proposals").json()
    assert sorted(r["kind"] for r in rows) == ["parts", "person", "text"]
    for row in rows:
        assert set(row) == {"kind", "proposal_id", "target_id", "target_label", "target_url",
                            "pending", "stale", "created_at"}
    (text,) = _by_kind(rows, "text")
    assert text["target_id"] == "w1" and text["target_label"] == "Epistolae"
    assert text["pending"] == 1 and text["stale"] == 1
    assert text["target_url"] == f"/work/w1/2?proposal={pid}"            # t-002 on esimene page_no järgi
    (parts,) = _by_kind(rows, "parts")
    assert parts["target_label"] == "Epistolae" and parts["pending"] == 2 and parts["stale"] == 0
    assert parts["target_url"] == "/work/w1/manage?tab=parts"
    (person,) = _by_kind(rows, "person")
    assert person["target_label"] == "Johann Fischer" and person["pending"] == 2
    assert person["stale"] is None and person["target_url"] == "/persons/vutt:Pabc/edit?agent=1"

    (open(f"{work}/t-006.jpg", "wb")).write(b"x")                        # lehtede järjekord muutus
    (parts,) = _by_kind(client.get("/agent-proposals").json(), "parts")
    assert parts["stale"] == 2


def test_loend_jarjestus_uuemad_ees(client, work):
    code = client.post("/agent-handoff").json()["code"]
    wpp.submit(code, "w1", work, wpp.pages_version(work), [LETTER])
    _text_pack(work, code, 1)
    db = sqlite3.connect(wpp.DB_PATH)
    with db:
        db.execute("UPDATE proposal SET created_at = created_at - 100")
    db.close()
    assert [r["kind"] for r in client.get("/agent-proposals").json()] == ["text", "parts"]


def test_tekst_lk_praegusest_jarjekorrast(client, work):
    code = client.post("/agent-handoff").json()["code"]
    pid = _text_pack(work, code, 3)
    (open(f"{work}/t-000.jpg", "wb")).write(b"x")                         # uus leht ette
    (text,) = _by_kind(client.get("/agent-proposals").json(), "text")
    assert text["target_url"] == f"/work/w1/4?proposal={pid}"


def test_tekst_lk_kadunud_lehtedega(client, work):
    code = client.post("/agent-handoff").json()["code"]
    pid = _text_pack(work, code, 3)
    os.remove(f"{work}/t-003.jpg")
    os.remove(f"{work}/t-003.txt")
    (text,) = _by_kind(client.get("/agent-proposals").json(), "text")
    assert text["target_url"] == f"/work/w1/1?proposal={pid}"


def test_kadunud_teos_ja_isik(client, work, monkeypatch):
    code = client.post("/agent-handoff").json()["code"]
    pid = _text_pack(work, code, 2)
    wpp.submit(code, "w1", work, wpp.pages_version(work), [LETTER])
    ep.submit(code, "vutt:Pabc", "t", [dict(ITEM)])
    monkeypatch.setattr(ap, "find_directory_by_id", lambda wid: None)
    monkeypatch.setattr(ap, "load_work_metadata_by_id", lambda wid: None)
    monkeypatch.setattr(ap, "get_person", lambda pid: None)
    rows = client.get("/agent-proposals").json()
    assert len(rows) == 3
    for row in rows:
        assert row["target_label"] == row["target_id"]
    assert _by_kind(rows, "text")[0]["target_url"] == f"/work/w1/1?proposal={pid}"
    assert _by_kind(rows, "parts")[0]["stale"] == 0


def test_tombstone_isik_saab_id_sildiks(client, work, monkeypatch):
    code = client.post("/agent-handoff").json()["code"]
    ep.submit(code, "vutt:Pabc", "t", [dict(ITEM)])
    monkeypatch.setattr(ap, "get_person", lambda pid: {"record_status": "tombstone",
                                                        "name": {"label": "Vana nimi"}})
    (person,) = client.get("/agent-proposals").json()
    assert person["target_label"] == "vutt:Pabc"


def test_nahtavus_kasutaja_kaupa(client, work):
    client.state["user"] = {"username": "teine", "role": "superadmin"}
    code = client.post("/agent-handoff").json()["code"]
    pid = _text_pack(work, code, 2)
    wpp.submit(code, "w1", work, wpp.pages_version(work), [LETTER])
    ep.submit(code, "vutt:Pabc", "t", [dict(ITEM)])
    client.state["user"] = {"username": "ed", "role": "superadmin"}
    rows = client.get("/agent-proposals").json()
    assert [(r["kind"], r["proposal_id"]) for r in rows] == [("text", pid)]


EX_NEW = {"op": "create", "fields": {"holder": "TÜR", "shelfmark": "R 1"},
          "source": {"kind": "ester", "ref": "b2648642", "quote": "R 1"}}


def test_loend_naitab_eksemplari_ettepanekut(client, work, monkeypatch):
    import importlib
    config = importlib.import_module("server.config")   # sama moodul, mida kood loeb (vt test_exemplar_proposals)
    archives = os.path.join(os.path.dirname(work), "archives.json")
    json.dump({"TÜR": {"name": "TÜR"}}, open(archives, "w"))
    monkeypatch.setattr(config, "ARCHIVES_FILE", archives)
    code = client.post("/agent-handoff").json()["code"]
    res = epp.submit(code, "w1", work, [EX_NEW, {**EX_NEW, "fields": {"holder": "XX"}}])
    (row,) = _by_kind(client.get("/agent-proposals").json(), "exemplars")
    assert row == {"kind": "exemplars", "proposal_id": res["proposal_id"], "target_id": "w1",
                   "target_label": "Epistolae", "target_url": "/work/w1/manage?tab=exemplars",
                   "pending": 2, "stale": 1, "created_at": row["created_at"]}
    client.state["user"] = {"username": "teine", "role": "superadmin"}
    assert _by_kind(client.get("/agent-proposals").json(), "exemplars") == []
