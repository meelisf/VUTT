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


# ── Agendi pakutud isikud ────────────────────────────────────────────────────

PERSON = {"ref": "np1", "name": "Johann Fischer", "aliases": ["Johannes Piscator"],
          "birth_year": 1636, "death_year": 1705,
          "identifiers": [{"scheme": "gnd", "id": "118691716"}], "note": "Liivimaa superintendent",
          "evidence": [{"page": 2, "quote": "Fischer"}]}
LETTER_REF = {**LETTER, "creators": [{"person_ref": "np1", "role": "addressee"}, {"id": "vutt:Paaaaa", "name": "Spener", "role": "auctor"}]}


def _submit_p(work, parts, persons, code=None):
    code = code or wpp.issue_handoff("w1", work, "ed")["code"]
    return wpp.submit(code, "w1", work, wpp.pages_version(work), parts, persons)


@pytest.fixture
def created(monkeypatch):
    calls = []
    from server.prosopography import person_crud

    def fake_create(**kw):
        calls.append(kw)
        return {"id": "vutt:Pnew", "name": {"label": kw["name"]}}
    monkeypatch.setattr(person_crud, "create_person_checked", fake_create)
    monkeypatch.setattr(person_crud, "get_person", lambda pid: {"id": pid, "name": {"label": "Olemas"}} if pid == "vutt:Pold" else None)
    return calls


def test_isik_viitega_nimena_kuni_lahendamiseni(work):
    _submit_p(work, [LETTER_REF], [PERSON])
    (p,) = wpp.list_pending("w1", work, "ed")
    assert p["persons"][0]["name"] == "Johann Fischer" and p["persons"][0]["status"] == "pending"
    c = p["items"][0]["part"]["creators"][0]
    assert c == {"name": "Johann Fischer", "role": "addressee"}


def test_loo_isik_seob_osa_isikuga(work, created):
    _submit_p(work, [LETTER_REF], [PERSON])
    (p,) = wpp.list_pending("w1", work, "ed")
    res = wpp.resolve_person(p["proposal_id"], "w1", work, "ed", "np1", "create")
    assert res["person_id"] == "vutt:Pnew"
    kw = created[0]
    assert kw["created_via"] == "agent" and kw["name"] == "Johann Fischer"
    assert kw["identifiers"] == [{"scheme": "gnd", "id": "118691716"}] and kw["aliases"] == ["Johannes Piscator"]
    assert kw["context"] == {"work_id": "w1", "role": "addressee"}
    (p,) = wpp.list_pending("w1", work, "ed")
    assert p["persons"][0]["status"] == "created"
    assert p["items"][0]["part"]["creators"][0]["id"] == "vutt:Pnew"
    wpp.decide(p["proposal_id"], "w1", work, "ed", 0, "accept")
    assert _meta(work)["parts"][0]["creators"][0]["id"] == "vutt:Pnew"


def test_seo_olemasolevaga_ja_jata_nimeks(work, created):
    _submit_p(work, [LETTER_REF], [PERSON, {"ref": "np2", "name": "Anonymus"}])
    (p,) = wpp.list_pending("w1", work, "ed")
    with pytest.raises(wpp.ProposalError, match="person_not_found"):
        wpp.resolve_person(p["proposal_id"], "w1", work, "ed", "np1", "link", "vutt:Pmissing")
    wpp.resolve_person(p["proposal_id"], "w1", work, "ed", "np1", "link", "vutt:Pold")
    wpp.resolve_person(p["proposal_id"], "w1", work, "ed", "np2", "name")
    (p,) = wpp.list_pending("w1", work, "ed")
    assert [x["status"] for x in p["persons"]] == ["linked", "name"]
    assert p["items"][0]["part"]["creators"][0]["id"] == "vutt:Pold"
    assert created == []


def test_olemasolev_valine_id_annab_isiku(work, monkeypatch):
    from server.prosopography import person_crud

    def conflict(**kw):
        raise person_crud.IdentifierConflict("conflict", ["vutt:Pold"])
    monkeypatch.setattr(person_crud, "create_person_checked", conflict)
    _submit_p(work, [LETTER_REF], [PERSON])
    (p,) = wpp.list_pending("w1", work, "ed")
    with pytest.raises(wpp.ProposalError, match="person_exists:vutt:Pold"):
        wpp.resolve_person(p["proposal_id"], "w1", work, "ed", "np1", "create")


@pytest.mark.parametrize("persons, parts", [
    ([{**PERSON, "ref": "np1"}, {**PERSON, "ref": "np1"}], [LETTER]),        # kordus
    ([{**PERSON, "identifiers": [{"scheme": "orcid", "id": "1"}]}], [LETTER]),
    ([{**PERSON, "name": ""}], [LETTER]),
    ([{**PERSON, "extra": 1}], [LETTER]),
    ([PERSON], [{**LETTER, "creators": [{"person_ref": "np9", "role": "auctor"}]}]),  # tundmatu viide
])
def test_vigased_isikud(work, persons, parts):
    with pytest.raises(wpp.ProposalError):
        _submit_p(work, parts, persons)


def test_vana_ettepanek_ilma_isikuteta_loetav(work):
    """Enne isikute lisamist talletatud ettepanekud (payload = list) jäävad loetavaks."""
    import sqlite3, time as _t
    _submit(work, [LETTER])
    with sqlite3.connect(wpp.DB_PATH) as db:
        pid, payload = db.execute("SELECT id, payload FROM proposal").fetchone()
        items = json.loads(payload)["items"]
        db.execute("UPDATE proposal SET payload=? WHERE id=?", (json.dumps(items), pid))
    (p,) = wpp.list_pending("w1", work, "ed")
    assert p["persons"] == [] and p["items"][0]["status"] == "pending"


def test_isikute_otspunktid(client, work, created):
    h = client.post("/works/w1/parts/handoff").json()
    r = client.post("/works/parts-proposals/submit", json={
        "code": h["code"], "work_id": "w1", "pages_version": h["pages_version"],
        "parts": [LETTER_REF], "persons": [PERSON]})
    assert r.status_code == 200 and r.json()["persons"] == 1
    (p,) = client.get("/works/w1/parts/proposals").json()
    url = f"/works/w1/parts/proposals/{p['proposal_id']}/persons/np1"
    assert client.post(f"{url}/link", json={"person_id": "vutt:Pmissing"}).status_code == 400
    ok = client.post(f"{url}/create", json={})
    assert ok.status_code == 200 and ok.json()["person_id"] == "vutt:Pnew"
    client.state["user"] = {"username": "ed", "role": "admin"}
    assert client.post(f"{url}/name", json={}).status_code == 403


# ── Parandus olemasolevale osale (ei tee duplikaati) ─────────────────────────

def _existing(work, **kw):
    return wp.create_part(work, {"kind": "letter", "pages": ["t-002", "t-003"], "title": "Vana",
                                 "notes": "Käsitsi märkus", "creators": [{"name": "Spener", "role": "auctor"}], **kw}, "ed")


def test_part_id_uuendab_olemasolevat_mitte_ei_loo_uut(work):
    old = _existing(work)
    _submit(work, [{**LETTER, "part_id": old["id"], "title": ""}])
    (p,) = wpp.list_pending("w1", work, "ed")
    assert p["items"][0]["target_part_id"] == old["id"]
    assert p["items"][0]["merged"]["title"] == "Vana"       # vormile sama liitmine
    wpp.decide(p["proposal_id"], "w1", work, "ed", 0, "accept")
    parts = _meta(work)["parts"]
    assert len(parts) == 1 and parts[0]["id"] == old["id"]
    merged = parts[0]
    assert merged["title"] == "Vana"                       # tühi ettepanek ei kustuta
    assert merged["notes"] == "Käsitsi märkus"
    assert merged["dating"]["start"] == "1684-03-02"      # uus väli lisandub
    names = [(c.get("id"), c["name"], c["role"]) for c in merged["creators"]]
    assert ("vutt:Paaaaa", "Spener", "auctor") in names and ("Spener", "auctor") not in [(n, r) for i, n, r in names if not i]
    assert any(c["role"] == "addressee" for c in merged["creators"])


def test_samade_lehtedega_osa_tuvastatakse_ja_uuendatakse(work):
    old = _existing(work)
    _submit(work, [LETTER])                                  # part_id puudub, lehed samad
    (p,) = wpp.list_pending("w1", work, "ed")
    assert p["items"][0]["target_part_id"] == old["id"]
    wpp.decide(p["proposal_id"], "w1", work, "ed", 0, "accept")
    assert len(_meta(work)["parts"]) == 1


def test_uuena_lisamine_on_valitav(work):
    _existing(work)
    _submit(work, [LETTER])
    (p,) = wpp.list_pending("w1", work, "ed")
    wpp.decide(p["proposal_id"], "w1", work, "ed", 0, "accept", mode="create")
    assert len(_meta(work)["parts"]) == 2


def test_tundmatu_part_id_lukatakse_tagasi(work):
    with pytest.raises(wpp.ProposalError, match="unknown part_id"):
        _submit(work, [{**LETTER, "part_id": "olematu"}])


def test_liitmine_ei_tee_dateeringut_ebatapsemaks_ega_vaheta_kohta_keele_parast():
    old = {"id": "a", "kind": "letter", "pages": ["t-001"], "creators": [], "needs_review": False,
           "dating": {"start": "1672-11-30"}, "place": {"id": None, "label": "Paris"}, "languages": ["lat"]}
    new = {"kind": "letter", "pages": ["t-001"], "creators": [],
           "dating": {"start": "1672"}, "place": {"id": None, "label": "Pariis"}, "languages": ["ger"]}
    auto = wpp.merge_part(old, new)                    # automaatselt tuvastatud duplikaat
    assert auto["dating"]["start"] == "1672-11-30" and auto["place"]["label"] == "Paris"
    assert sorted(auto["languages"]) == ["ger", "lat"]
    explicit = wpp.merge_part(old, new, explicit=True)  # agent ütles part_id → parandus
    assert explicit["dating"]["start"] == "1672-11-30"  # ebatäpsem EI võida ka siis
    assert explicit["place"]["label"] == "Pariis"
    more = wpp.merge_part(old, {**new, "dating": {"start": "1672-12-01"}}, explicit=True)
    assert more["dating"]["start"] == "1672-12-01"       # sama täpsus + selge parandus
    wd = wpp.merge_part(old, {**new, "place": {"id": "Q90", "label": "Pariis"}})
    assert wd["place"]["id"] == "Q90"                     # ID-ga koht täiendab
