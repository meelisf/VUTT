# tests/test_work_part_proposals.py
"""Agendi osade ettepanekud (#492 samm 2): kood → ootel ettepanek → toimetaja otsus osa kaupa.
MCP ei kirjuta `_metadata.json`-i; vastuvõtt käib create_part kaudu (ADR 0057)."""
import json

import pytest

from server import work_parts as wp
from server import work_part_proposals as wpp


@pytest.fixture
def work(tmp_path, monkeypatch):
    from server import metadata_ops
    monkeypatch.setattr(wpp, "DB_PATH", str(tmp_path / "wpp.sqlite3"))
    d = tmp_path / "slug-w1"
    d.mkdir()
    for i in range(1, 7):
        (d / f"t-00{i}.jpg").write_bytes(b"x")
    (d / "_metadata.json").write_text(json.dumps({"id": "w1", "title": "Epistolae"}), encoding="utf-8")

    def fake_save(path, content, *a, additional_files=None, **k):
        from server.utils import atomic_write_text
        atomic_write_text(path, content)
        return {"success": True}
    monkeypatch.setattr(metadata_ops, "save_with_git", fake_save)
    for name in ("sync_work_to_meilisearch", "update_person_to_works", "update_work_collections", "update_work_facts"):
        monkeypatch.setattr(metadata_ops, name, lambda *a, **k: None)
    from server.prosopography import relations
    monkeypatch.setattr(relations, "update_page_person_mentions", lambda *a, **k: None)
    return str(d)


def _meta(work):
    return json.load(open(f"{work}/_metadata.json"))


LETTER = {"kind": "letter", "title": "Kiri Fischerile", "pages": [2, 3],
          "creators": [{"id": "vutt:Paaaaa", "name": "Spener", "role": "auctor"},
                       {"name": "Fischer", "role": "addressee"}],
          "dating": {"start": "1684-03-02"}, "place": {"id": "Q1794", "label": "Frankfurt"},
          "evidence": [{"page": 2, "quote": "Hochwürdiger Herr"}]}


def _submit(work, parts, version=None, code=None):
    code = code or wpp.issue_handoff("w1", work, "ed")["code"]
    return wpp.submit(code, "w1", work, version or wpp.pages_version(work), parts)


def test_esitus_ei_muuda_teost_ja_numbrid_teisendatakse_tuvedeks(work):
    before = _meta(work)
    res = _submit(work, [LETTER])
    assert res["status"] == "pending"
    assert _meta(work) == before
    (p,) = wpp.list_pending("w1", work, "ed")
    item = p["items"][0]
    assert item["part"]["pages"] == ["t-002", "t-003"]
    assert item["page_numbers"] == [2, 3] and item["status"] == "pending"


@pytest.mark.parametrize("bad, code", [
    ({**LETTER, "kind": "romaan"}, "invalid_part"),
    ({**LETTER, "pages": [9]}, "page_out_of_range"),
    ({**LETTER, "pages": []}, "invalid_part"),
    ({**LETTER, "creators": [{"name": "X", "role": "mentioned"}]}, "invalid_part"),
    ({**LETTER, "needs_review": True}, "invalid_part"),
    ({**LETTER, "id": "zzz"}, "invalid_part"),
])
def test_vigane_osa_lukatakse_tagasi_ja_kood_ei_kulu(work, bad, code):
    h = wpp.issue_handoff("w1", work, "ed")
    with pytest.raises(wpp.ProposalError, match=code):
        _submit(work, [bad], code=h["code"])
    assert _submit(work, [LETTER], code=h["code"])["status"] == "pending"


def test_lehtede_versioon_peab_klappima(work):
    with pytest.raises(wpp.ProposalError, match="stale_pages"):
        _submit(work, [LETTER], version="vana")


def test_kood_kehtib_ainult_oma_teosele_ja_kasutuste_lagi(work, monkeypatch):
    h = wpp.issue_handoff("w1", work, "ed")
    with pytest.raises(wpp.ProposalError, match="invalid_or_expired_handoff"):
        wpp.submit(h["code"], "w2", work, wpp.pages_version(work), [LETTER])
    monkeypatch.setattr(wpp, "MAX_USES", 1)
    h2 = wpp.issue_handoff("w1", work, "ed")
    _submit(work, [LETTER], code=h2["code"])
    with pytest.raises(wpp.ProposalError, match="handoff_used_up"):
        _submit(work, [LETTER], code=h2["code"])


def test_vastuvott_loob_osa_ja_tagasilukkamine_mitte(work):
    _submit(work, [LETTER, {**LETTER, "title": "Teine", "pages": [4]}])
    (p,) = wpp.list_pending("w1", work, "ed")
    created = wpp.decide(p["proposal_id"], "w1", work, "ed", 0, "accept")
    parts = _meta(work)["parts"]
    assert len(parts) == 1 and parts[0]["id"] == created["id"]
    assert parts[0]["pages"] == ["t-002", "t-003"] and parts[0]["creators"][1]["role"] == "addressee"
    wpp.decide(p["proposal_id"], "w1", work, "ed", 1, "reject")
    assert len(_meta(work)["parts"]) == 1
    assert wpp.list_pending("w1", work, "ed") == []            # kõik otsustatud → kaob


def test_toimetaja_parandus_vastuvotul(work):
    _submit(work, [LETTER])
    (p,) = wpp.list_pending("w1", work, "ed")
    wpp.decide(p["proposal_id"], "w1", work, "ed", 0, "accept",
               override={**p["items"][0]["part"], "title": "Parandatud", "pages": ["t-002"]})
    assert _meta(work)["parts"][0]["title"] == "Parandatud"
    assert _meta(work)["parts"][0]["pages"] == ["t-002"]


def test_lisa_viitab_sama_ettepaneku_kirjale(work):
    attach = {"kind": "attachment", "pages": [5], "attached_to": 0}
    _submit(work, [LETTER, attach])
    (p,) = wpp.list_pending("w1", work, "ed")
    with pytest.raises(wpp.ProposalError, match="attach_target_not_accepted"):
        wpp.decide(p["proposal_id"], "w1", work, "ed", 1, "accept")
    letter = wpp.decide(p["proposal_id"], "w1", work, "ed", 0, "accept")
    lisa = wpp.decide(p["proposal_id"], "w1", work, "ed", 1, "accept")
    assert lisa["attached_to"] == letter["id"]


def test_teine_kasutaja_ei_nae_ega_otsusta(work):
    _submit(work, [LETTER])
    (p,) = wpp.list_pending("w1", work, "ed")
    assert wpp.list_pending("w1", work, "teine") == []
    with pytest.raises(wpp.ProposalError, match="proposal_not_found"):
        wpp.decide(p["proposal_id"], "w1", work, "teine", 0, "accept")


def test_umbernummerdus_parast_esitust_nahtav(work):
    import os
    _submit(work, [LETTER])
    os.remove(f"{work}/t-001.jpg")                                 # lehed nihkuvad
    (p,) = wpp.list_pending("w1", work, "ed")
    assert p["pages_changed"] is True
    assert p["items"][0]["page_numbers"] == [1, 2]                 # tüved jäid, numbrid uued


# ── Otspunktid ───────────────────────────────────────────────────────────────

@pytest.fixture
def client(work, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from server.routers import work_parts as r
    from server import deps
    monkeypatch.setattr(r, "find_directory_by_id", lambda wid: work if wid == "w1" else None)
    monkeypatch.setattr(r, "load_work_metadata_by_id",
                        lambda wid: json.load(open(f"{work}/_metadata.json")) if wid == "w1" else None)
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
    app.dependency_overrides[deps.optional_user] = lambda: state["user"]
    monkeypatch.setattr(r, "can_write_work", lambda meta, user: state["write"])
    monkeypatch.setattr(r, "can_read_work", lambda meta, user: True)
    c = TestClient(app)
    c.state = state
    return c


def test_otspunktide_voog(client, work):
    h = client.post("/works/w1/parts/handoff").json()
    version = client.get("/works/w1/parts").json()["pages_version"]
    assert h["pages_version"] == version
    r = client.post("/works/parts-proposals/submit", json={
        "code": h["code"], "work_id": "w1", "pages_version": version, "parts": [LETTER]})
    assert r.status_code == 200 and r.json()["parts"] == 1
    (p,) = client.get("/works/w1/parts/proposals").json()
    d = client.post(f"/works/w1/parts/proposals/{p['proposal_id']}/items/0/accept", json={})
    assert d.status_code == 200 and d.json()["status"] == "accepted"
    assert _meta(work)["parts"][0]["title"] == "Kiri Fischerile"


def test_otspunktide_piirid(client, work):
    assert client.post("/works/parts-proposals/submit", json={"code": "x"}).status_code == 400
    h = client.post("/works/w1/parts/handoff").json()
    stale = client.post("/works/parts-proposals/submit", json={
        "code": h["code"], "work_id": "w1", "pages_version": "vana", "parts": [LETTER]})
    assert stale.status_code == 409 and stale.json()["detail"] == "stale_pages"
    client.state["write"] = False
    assert client.post("/works/w1/parts/handoff").status_code == 403
    assert client.get("/works/w1/parts/proposals").status_code == 403


def test_ettepanekud_ainult_superadminile(client):
    client.state["user"] = {"username": "ed", "role": "admin"}
    assert client.post("/works/w1/parts/handoff").status_code == 403
    assert client.get("/works/w1/parts/proposals").status_code == 403
