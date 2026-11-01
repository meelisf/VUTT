# tests/test_work_exemplars.py
"""Teose eksemplarid (ADR 0076, #710): skeem, tekstitunnistaja, lehtede päritolu,
konvoluudi võti, tuletatud `archive_refs`, kirjutustee ja migratsioon."""
import json
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server import work_exemplars as we

STEMS = ["t-001", "t-002", "t-003", "t-004"]
COMMITS: list = []


def _x(**kw):
    base = {"id": "a", "holder": "TÜR"}
    base.update(kw)
    return base


# ── Skeem ────────────────────────────────────────────────────────────────────

def test_vaartuseta_vojmeid_ei_salvestata():
    out = we.normalize_exemplar(_x(shelfmark=" R 1 ", url="", text_witness=False, pages=[],
                                   convolute={}, needs_review=False, notes=None, extra="x"))
    assert out == {"id": "a", "holder": "TÜR", "shelfmark": "R 1"}


def test_voti_jarjekord_on_stabiilne():
    out = we.normalize_exemplar({"needs_review": True, "holder": "TÜR", "id": "a", "notes": "n",
                                 "source": {"kind": "ester", "ref": "b1"}})
    assert list(out) == ["id", "holder", "notes", "source", "needs_review"]


@pytest.mark.parametrize("bad", [
    {"holder": "TÜR"},                                     # id puudub
    _x(holder=" "),
    _x(convolute={"position": 1}),                         # kohaviit puudub
    _x(convolute={"reference": "R", "position": 13, "total": 13}),
    _x(convolute={"reference": "R", "total": 0}),
    _x(convolute={"reference": "R", "position": True}),
    _x(source={"kind": "wikipedia"}),
    _x(pages="t-001"),
])
def test_vigane_kirje_400(bad):
    with pytest.raises(we.ExemplarError) as e:
        we.normalize_exemplar(bad)
    assert e.value.status == 400


def test_validate_reeglid():
    with pytest.raises(we.ExemplarError):                  # kaks tunnistajat
        we.validate_exemplars([_x(text_witness=True), _x(id="b", text_witness=True)], [])
    with pytest.raises(we.ExemplarError):                  # tunnistajal erandlehed
        we.validate_exemplars([_x(text_witness=True, pages=["t-001"])], [])
    with pytest.raises(we.ExemplarError):                  # leht kahes kohas
        we.validate_exemplars([_x(pages=["t-001"]), _x(id="b", pages=["t-001"])], [])
    with pytest.raises(we.ExemplarError):                  # leht ka teadmata loendis
        we.validate_exemplars([_x(pages=["t-001"])], ["t-001"])
    with pytest.raises(we.ExemplarError):                  # leht puudub teosest
        we.validate_exemplars([_x(pages=["t-999"])], [], STEMS)
    with pytest.raises(we.ExemplarError):
        we.validate_exemplars([_x(), _x()], [])
    out, unknown = we.validate_exemplars([_x(pages=["t-003", "t-001"])], ["t-004", "t-002"], STEMS)
    assert out[0]["pages"] == ["t-001", "t-003"] and unknown == ["t-002", "t-004"]


def test_erandlehed_lubatud_ilma_tunnistajata():
    out, _ = we.validate_exemplars([_x(pages=["t-002"])], [], STEMS)
    assert out[0]["pages"] == ["t-002"]


# ── Tuletused ────────────────────────────────────────────────────────────────

def test_derive_archive_refs_ja_vana_vali_ei_ole_varuvariant():
    meta = {"exemplars": [_x(shelfmark="R 1", url="https://u"), _x(id="b", holder="UUB")],
            "archive_refs": [{"archive_id": "VANA", "reference": "x"}]}
    assert we.derive_archive_refs(meta) == [
        {"archive_id": "TÜR", "reference": "R 1", "url": "https://u"},
        {"archive_id": "UUB", "reference": ""},
    ]
    assert we.derive_archive_refs({"archive_refs": [{"archive_id": "VANA"}]}) == []


@pytest.mark.parametrize("a,b", [
    ("R Est.B-954 (konvoluut)", "R Est.B-954"),
    ("R Est.B-954", "r est. b-954"),
    ("R Est.B-954 I (konvoluut)", "R Est.B-954 (I)(konvoluut)"),
    ("R Est.B-954 (I)", "R Est.B-954 I"),
    ("R Bergm.357", "R Bergm. 357"),
    ("I-3390b konvoluut", "I-3390b"),
    ("Est.A-1322 (konvoluut)", "Est.A-1322"),
])
def test_convolute_key_sama_ruhm(a, b):
    assert we.convolute_key("TÜR", a) == we.convolute_key("TÜR", b)


@pytest.mark.parametrize("a,b", [
    ("R Est.B-954", "R Est.B-954 (I)"),                  # teine köide
    ("R Est.B-954 (I)", "R Est.B-954 (II)"),
    ("R Est.B-954", "R Est.B-955"),
])
def test_convolute_key_eri_ruhm(a, b):
    assert we.convolute_key("TÜR", a) != we.convolute_key("TÜR", b)


def test_convolute_key_hoidja_on_votmes():
    assert we.convolute_key("TÜR", "R 1") != we.convolute_key("UUB", "R 1")


def test_page_origins():
    meta = {"exemplars": [_x(text_witness=True), _x(id="b", pages=["t-002"])],
            "exemplar_unknown_pages": ["t-003"]}
    assert we.page_origins(meta, STEMS) == {"t-001": "a", "t-002": "b", "t-003": None, "t-004": "a"}
    assert we.page_origins({"exemplars": [_x()]}, ["t-001"]) == {"t-001": None}


def test_kasikirja_ainus_viide_on_eksemplar_liputa():
    one = [{"archive_id": "RA", "reference": "EAA.1.2.3"}]
    assert "needs_review" not in we.exemplars_from_archive_refs(one, "migration", manuscript=True)[0]
    two = one + [{"archive_id": "TÜR", "reference": "F 2"}]
    assert all(x["needs_review"] for x in we.exemplars_from_archive_refs(two, "migration", manuscript=True))
    assert we.exemplars_from_archive_refs(one, "upload")[0]["needs_review"] is True


def test_archive_refs_teisendus_automaatne_kirje_on_lipuga():
    out = we.exemplars_from_archive_refs(
        [{"archive_id": "TÜR", "reference": "R 1", "url": ""}, {"archive_id": "", "reference": "x"}],
        "upload")
    assert len(out) == 1
    x = out[0]
    assert x["holder"] == "TÜR" and x["shelfmark"] == "R 1" and x["needs_review"] is True
    assert "text_witness" not in x and "url" not in x
    assert x["source"]["kind"] == "upload" and x["source"]["ref"] == "TÜR: R 1"


# ── Puhtad lehereeglid ───────────────────────────────────────────────────────

def test_tunnistaja_vahetus():
    ex = [_x(text_witness=True), _x(id="b", pages=["t-002"])]
    out = we.make_witness(ex, "b")
    assert out[0] == {"id": "a", "holder": "TÜR"}            # eelmine kaotab märke
    assert out[1]["text_witness"] is True and "pages" not in out[1]


def test_remap_poolitus_kustutus_ja_tuhi():
    ex = [_x(pages=["t-002"]), _x(id="b", pages=["t-004"])]
    out, unknown, changed = we.remap_exemplars(ex, ["t-003"], ["t-001", "t-002a", "t-002b", "t-003"],
                                               {"t-002": ["t-002a", "t-002b"]})
    assert changed
    assert out[0]["pages"] == ["t-002a", "t-002b"]          # pooled pärivad päritolu
    assert "pages" not in out[1] and out[1]["needs_review"] is True
    assert unknown == ["t-003"]
    _, _, changed = we.remap_exemplars(out, unknown, ["t-001", "t-002a", "t-002b", "t-003"])
    assert not changed


def test_assign_origin():
    ex = [_x(text_witness=True), _x(id="b", pages=["t-002"])]
    out, unknown = we.assign_origin(ex, [], ["t-003"], "b")
    assert out[1]["pages"] == ["t-002", "t-003"]
    out, unknown = we.assign_origin(out, unknown, ["t-002", "t-003"], "unknown")
    assert "pages" not in out[1] and out[1]["needs_review"] is True and unknown == ["t-002", "t-003"]
    out, unknown = we.assign_origin(out, unknown, ["t-002"], "a")   # tunnistaja: lihtsalt välja
    assert unknown == ["t-003"] and "pages" not in out[0]
    assert we.assign_origin(ex, [], ["t-001"], "same") == (ex, [])
    with pytest.raises(we.ExemplarError):
        we.assign_origin(ex, [], ["t-001"], "zz")


def test_reset_origins():
    out = we.reset_origins([_x(text_witness=True), _x(id="b", pages=["t-002"]), _x(id="c")])
    assert out[0] == {"id": "a", "holder": "TÜR", "needs_review": True}
    assert out[1] == {"id": "b", "holder": "TÜR", "needs_review": True}
    assert out[2] == {"id": "c", "holder": "TÜR"}


def test_check_origin():
    assert we.check_origin({}, None) is None                 # eksemplarideta: küsimust pole
    meta = {"exemplars": [_x()]}
    with pytest.raises(we.ExemplarError):
        we.check_origin(meta, None)                          # vaikimisi valikut pole
    with pytest.raises(we.ExemplarError):
        we.check_origin(meta, "zz")
    assert we.check_origin(meta, "same") == "same"
    assert we.check_origin(meta, "a") == "a"


# ── Kirjutustee ──────────────────────────────────────────────────────────────

@pytest.fixture
def work(tmp_path, monkeypatch):
    from server import metadata_ops, config
    d = tmp_path / "slug-w1"
    d.mkdir()
    for s in STEMS:
        (d / f"{s}.jpg").write_bytes(b"x")
    (d / "_metadata.json").write_text(json.dumps({"id": "w1", "title": "T"}), encoding="utf-8")
    archives = tmp_path / "archives.json"
    archives.write_text(json.dumps({"TÜR": {"name": "TÜR"}, "UUB": {"name": "UUB"}}), encoding="utf-8")
    monkeypatch.setattr(config, "ARCHIVES_FILE", str(archives))
    COMMITS.clear()

    def fake_save(path, content, *a, additional_files=None, message="", **k):
        from server.utils import atomic_write_text
        atomic_write_text(path, content)
        for p2, c2 in additional_files or []:
            atomic_write_text(p2, c2)
        COMMITS.append(message)
        return {"success": True}
    monkeypatch.setattr(metadata_ops, "save_with_git", fake_save)
    monkeypatch.setattr(metadata_ops, "uncommitted_paths", lambda paths: [])
    monkeypatch.setattr(metadata_ops, "sync_work_to_meilisearch", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "sync_work_to_meilisearch_async", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "update_person_to_works", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "update_work_collections", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "update_work_facts", lambda *a, **k: None)
    monkeypatch.setattr(we, "page_stems", lambda wd: sorted(
        os.path.splitext(n)[0] for n in os.listdir(wd) if n.endswith(".jpg")))
    return str(d)


def _meta(work):
    with open(f"{work}/_metadata.json", encoding="utf-8") as f:
        return json.load(f)


def test_loo_muuda_kustuta(work):
    x = we.create_exemplar(work, {"holder": "TÜR", "shelfmark": "R 1", "id": "hack",
                                  "needs_review": True, "pages": ["t-001"]}, "ed")
    assert x["id"] != "hack" and "pages" not in x
    assert x["source"]["kind"] == "manual"
    assert x["needs_review"] is True                         # selgesõnaline soov
    x = we.update_exemplar(work, x["id"], {"needs_review": False, "condition": "defektne"}, "ed")
    assert "needs_review" not in x and x["condition"] == "defektne" and x["shelfmark"] == "R 1"
    we.delete_exemplar(work, x["id"], "ed")
    assert "exemplars" not in _meta(work)                    # tühi = võtme puudumine


MS = {"id": "Q87167", "label": "käsikiri"}


def test_kasikirjal_uks_eksemplar(work):
    """Ärakiri on eraldi teos variandiseosega, mitte teine eksemplar (ADR 0076 täiendus)."""
    meta = _meta(work)
    (open(f"{work}/_metadata.json", "w", encoding="utf-8")
     .write(json.dumps({**meta, "type": MS})))
    x = we.create_exemplar(work, {"holder": "TÜR", "shelfmark": "F 1"}, "ed")
    with pytest.raises(we.ExemplarError) as e:
        we.create_exemplar(work, {"holder": "UUB"}, "ed")
    assert e.value.status == 400 and "variandiseos" in str(e.value)
    assert len(_meta(work)["exemplars"]) == 1


def test_kasikirja_varasem_vastuolu_ei_lukusta(work):
    """Hiljem käsikirjaks muudetud teos: kahe eksemplari muutmine ja kustutus toimivad."""
    a = we.create_exemplar(work, {"holder": "TÜR"}, "ed")
    b = we.create_exemplar(work, {"holder": "UUB"}, "ed")
    meta = _meta(work)
    (open(f"{work}/_metadata.json", "w", encoding="utf-8")
     .write(json.dumps({**meta, "type": MS})))
    we.update_exemplar(work, a["id"], {"notes": "n"}, "ed")
    we.delete_exemplar(work, b["id"], "ed")
    assert [x["id"] for x in _meta(work)["exemplars"]] == [a["id"]]


def test_tundmatu_hoidja_ja_eksemplar(work):
    with pytest.raises(we.ExemplarError):
        we.create_exemplar(work, {"holder": "XX"}, "ed")
    with pytest.raises(we.ExemplarError) as e:
        we.update_exemplar(work, "zz", {"notes": "n"}, "ed")
    assert e.value.status == 404


def test_tunnistaja_vahetus_kirjutusel(work):
    a = we.create_exemplar(work, {"holder": "TÜR", "text_witness": True}, "ed")
    b = we.create_exemplar(work, {"holder": "UUB"}, "ed")
    we.set_page_origin(work, ["t-002"], b["id"], "ed")
    we.update_exemplar(work, b["id"], {"text_witness": True}, "ed")
    ex = {x["id"]: x for x in _meta(work)["exemplars"]}
    assert "text_witness" not in ex[a["id"]]
    assert ex[b["id"]]["text_witness"] is True and "pages" not in ex[b["id"]]


def test_muutusteta_salvestus_ei_commiti(work):
    x = we.create_exemplar(work, {"holder": "TÜR", "shelfmark": "R 1"}, "ed")
    n = len(COMMITS)
    before = _meta(work)
    we.update_exemplar(work, x["id"], {"shelfmark": "R 1"}, "ed")
    assert _meta(work) == before and len(COMMITS) == n


def test_jarjestus(work):
    a = we.create_exemplar(work, {"holder": "TÜR"}, "ed")
    b = we.create_exemplar(work, {"holder": "UUB"}, "ed")
    assert [x["id"] for x in we.reorder_exemplars(work, [b["id"], a["id"]], "ed")] == [b["id"], a["id"]]
    with pytest.raises(we.ExemplarError):
        we.reorder_exemplars(work, [a["id"]], "ed")


def test_sync_poolitus_ja_kustutus(work):
    a = we.create_exemplar(work, {"holder": "TÜR"}, "ed")
    we.set_page_origin(work, ["t-002"], a["id"], "ed")
    we.set_page_origin(work, ["t-004"], "unknown", "ed")
    os.rename(f"{work}/t-002.jpg", f"{work}/t-002a.jpg")
    open(f"{work}/t-002b.jpg", "wb").write(b"x")
    os.remove(f"{work}/t-004.jpg")
    we.sync_work_exemplars(work, "w1", renamed={"t-002": ["t-002a", "t-002b"]})
    meta = _meta(work)
    assert meta["exemplars"][0]["pages"] == ["t-002a", "t-002b"]
    assert "exemplar_unknown_pages" not in meta


def test_sisu_asendus_nullib_paritolu(work):
    a = we.create_exemplar(work, {"holder": "TÜR", "text_witness": True}, "ed")
    b = we.create_exemplar(work, {"holder": "UUB"}, "ed")
    we.set_page_origin(work, ["t-002"], b["id"], "ed")
    we.set_page_origin(work, ["t-003"], "unknown", "ed")
    we.reset_page_origins(work, "ed")
    meta = _meta(work)
    assert all("text_witness" not in x and "pages" not in x and x["needs_review"] for x in meta["exemplars"])
    assert "exemplar_unknown_pages" not in meta


def test_refresh_work_mentions_kutsub_eksemplaride_sunki(monkeypatch, tmp_path):
    from server import work_parts
    from server.prosopography import relations
    calls = []
    monkeypatch.setattr(work_parts, "sync_work_parts", lambda *a, **k: None)
    monkeypatch.setattr(we, "sync_work_exemplars", lambda wd, wid, renamed=None: calls.append(renamed))
    monkeypatch.setattr(relations, "update_page_person_mentions", lambda *a: None)
    relations.refresh_work_mentions(str(tmp_path), "w1", renamed={"x": ["y"]})
    assert calls == [{"x": ["y"]}]


def test_uldine_salvestus_lukkab_tagasi():
    import asyncio
    from fastapi import HTTPException
    from server.routers import editing

    for field in ("exemplars", "archive_refs", "exemplar_unknown_pages"):
        class FakeRequest:
            headers = {}

            async def json(self, field=field):
                return {"work_id": "w1", "metadata": {field: []}}
        with pytest.raises(HTTPException) as e:
            asyncio.run(editing.update_work_metadata(FakeRequest(), None, user={"username": "a", "role": "admin"}))
        assert e.value.status_code == 400


def test_archive_refs_ei_ole_kirjutatav_vali():
    from server.metadata_ops import ALLOWED_METADATA_FIELDS
    assert "archive_refs" not in ALLOWED_METADATA_FIELDS
    assert {"exemplars", "exemplar_unknown_pages"} <= ALLOWED_METADATA_FIELDS


# ── Otspunktid ───────────────────────────────────────────────────────────────

@pytest.fixture
def client(work, monkeypatch):
    from server.routers import work_exemplars as r
    from server import deps
    monkeypatch.setattr(r, "find_directory_by_id", lambda wid: work if wid == "w1" else None)
    monkeypatch.setattr(r, "load_work_metadata_by_id", lambda wid: _meta(work) if wid == "w1" else None)
    app = FastAPI()
    app.include_router(r.router)
    state = {"user": {"username": "ad", "role": "admin"}, "write": True}

    async def fake_get_user(request, min_role="contributor"):
        return state["user"]
    monkeypatch.setattr(deps, "get_user", fake_get_user)
    app.dependency_overrides[deps.optional_user] = lambda: state["user"]
    monkeypatch.setattr(r, "can_write_work", lambda meta, user: state["write"])
    monkeypatch.setattr(r, "can_read_work", lambda meta, user: True)
    c = TestClient(app)
    c.state = state
    return c


def test_endpointide_voog(client):
    r = client.post("/works/w1/exemplars", json={"holder": "TÜR", "shelfmark": "R 1"})
    assert r.status_code == 201
    ex_id = r.json()["id"]
    assert client.put(f"/works/w1/exemplars/{ex_id}", json={"binding": "pärgament"}).json()["binding"] == "pärgament"
    r = client.post("/works/w1/exemplars/page-origin", json={"stems": ["t-003"], "origin": ex_id})
    assert r.json()["exemplars"][0]["pages"] == ["t-003"]
    body = client.get("/works/w1/exemplars").json()
    assert body["page_numbers"] == {"t-003": 3} and body["page_count"] == 4 and body["convolutes"] == []
    assert client.post("/works/w1/exemplars/order", json={"ids": [ex_id]}).status_code == 200
    assert client.delete(f"/works/w1/exemplars/{ex_id}").status_code == 204


def test_endpointide_vead(client):
    assert client.post("/works/w1/exemplars", json={"holder": "XX"}).status_code == 400
    assert client.put("/works/w1/exemplars/zz", json={}).status_code == 404
    assert client.get("/works/w9/exemplars").status_code == 404
    client.state["write"] = False
    assert client.post("/works/w1/exemplars", json={"holder": "TÜR"}).status_code == 403


def test_endpointid_on_sync():
    import asyncio
    from server.routers import work_exemplars as r
    for fn in (r.list_exemplars, r.create, r.update, r.delete, r.reorder, r.page_origin):
        assert not asyncio.iscoroutinefunction(fn)


def test_konvoluudi_kaaslased(work, monkeypatch):
    from server.prosopography import work_relations_ops
    from server import access_ops, work_sets_access
    a = we.create_exemplar(work, {"holder": "TÜR", "convolute": {"reference": "R Est.B-954", "position": 0,
                                                                 "total": 13}}, "ed")
    meta = _meta(work)
    other = {"id": "w2", "title": "Personalia", "year": 1697, "exemplars": [
        {"id": "o1", "holder": "TÜR", "convolute": {"reference": "R Est.B-954 (konvoluut)", "position": 1}},
        {"id": "o2", "holder": "TÜR", "convolute": {"reference": "R Est.B-954 (I)", "position": 3}}]}
    index = {we.convolute_key("TÜR", "R Est.B-954"): ["w1", "w2"],
             we.convolute_key("TÜR", "R Est.B-954 (I)"): ["w2"]}
    monkeypatch.setattr(work_relations_ops, "load_convolute_index", lambda: index)
    monkeypatch.setattr(work_sets_access, "load_work_metadata_by_id", lambda wid: other if wid == "w2" else None)
    monkeypatch.setattr(access_ops, "can_read_work", lambda m, u: False)
    blocks = we.resolve_convolutes("w1", meta, None)
    assert len(blocks) == 1 and blocks[0]["total"] == 13
    members = blocks[0]["members"]
    assert [(m["work_id"], m["exemplar_id"]) for m in members] == [("w1", a["id"]), ("w2", "o1")]
    assert members[0]["current"] and members[0]["readable"]
    assert members[1]["readable"] is False and members[1]["title"] == "Personalia"


def test_konvoluudi_indeks_kirjutus_kustutus_ja_taaste(tmp_path, monkeypatch):
    """Eraldi read-model (ADR 0076 p 6): samad kirjutajad mis faktide indeksil."""
    from server.prosopography import work_relations_ops as wro
    monkeypatch.setattr(wro, "CONVOLUTE_INDEX_FILE", str(tmp_path / "config" / "convolute_index.json"))
    monkeypatch.setattr(wro, "WORKS_CREATORS_INDEX_FILE", str(tmp_path / "config" / "works_creators_index.json"))
    monkeypatch.setattr(wro, "BASE_DIR", str(tmp_path))
    (tmp_path / "config").mkdir()
    key = we.convolute_key("TÜR", "R Est.B-954")
    m1 = {"id": "w1", "exemplars": [_x(convolute={"reference": "R Est.B-954 (konvoluut)"})]}
    m2 = {"id": "w2", "exemplars": [_x(convolute={"reference": "R Est.B-954"})]}
    wro.update_work_facts(m1)
    wro.update_work_facts(m2)
    wro.update_work_facts({"id": "w3"})
    assert wro.load_convolute_index() == {key: ["w1", "w2"]}
    assert "convolute_keys" not in json.dumps(wro._load_creators_index())
    wro.update_work_facts({"id": "w1", "exemplars": [_x()]})      # konvoluut eemaldati
    assert wro.load_convolute_index() == {key: ["w2"]}
    wro.remove_work_facts("w2")
    assert wro.load_convolute_index() == {}
    for m in (m1, m2):                                          # taaste kettalt
        (tmp_path / m["id"]).mkdir()
        (tmp_path / m["id"] / "_metadata.json").write_text(json.dumps(m))
    wro.build_works_creators_index()
    assert wro.load_convolute_index() == {key: ["w1", "w2"]}


# ── Migratsioon ──────────────────────────────────────────────────────────────

def test_migratsioon_ja_kordus():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "migr", os.path.join(os.path.dirname(__file__), "..", "scripts", "migrate_archive_refs_to_exemplars.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    meta = {"archive_refs": [{"archive_id": "TÜR", "reference": "R 1", "url": "https://u"},
                             {"archive_id": "", "reference": "hoidjata"}]}
    ex, warnings = m.migrate_meta(meta)
    assert len(ex) == 1 and len(warnings) == 1
    assert ex[0]["source"] == {"kind": "migration", "ref": "TÜR: R 1", "at": ex[0]["source"]["at"]}
    assert ex[0]["url"] == "https://u" and ex[0]["needs_review"] is True and "text_witness" not in ex[0]
    again, _ = m.migrate_meta({**meta, "exemplars": ex})
    assert again == ex                                       # kordus duplikaate ei tee
    assert m.migrate_meta({"archive_refs": None}) == ([], [])


def test_stardikontroll_leiab_migreerimata(tmp_path, monkeypatch):
    from server import config, client_errors
    (tmp_path / "a").mkdir()
    (tmp_path / "a" / "_metadata.json").write_text(json.dumps({"id": "a", "archive_refs": None}))
    (tmp_path / "b").mkdir()
    (tmp_path / "b" / "_metadata.json").write_text(json.dumps({"id": "b"}))
    monkeypatch.setattr(config, "BASE_DIR", str(tmp_path))
    recorded = []
    monkeypatch.setattr(client_errors, "record_server_error", lambda *a, **k: recorded.append(a))
    assert we.check_unmigrated() == ["a"]
    assert recorded


def test_pildi_kirjutaja_nouab_paritolu(tmp_path):
    """Eksemplaridega teosel lükkab uue pildi kirjutaja päritoluta päringu tagasi."""
    from fastapi import HTTPException
    from server.routers import pages
    (tmp_path / "_metadata.json").write_text(json.dumps({"id": "w1", "exemplars": [_x()]}))
    with pytest.raises(HTTPException) as e:
        pages._checked_origin(str(tmp_path), None)
    assert e.value.status_code == 400
    assert pages._checked_origin(str(tmp_path), "a") == "a"
    (tmp_path / "_metadata.json").write_text(json.dumps({"id": "w1"}))
    assert pages._checked_origin(str(tmp_path), None) is None


def test_convolute_count_meili_dokumendis(tmp_path):
    """Kaart näitab „Samas köites" nuppu `convolute_count`-i järgi (#702) — üks väärtus
    konvoluudivõtme kohta, väli puudub dokumendist, kui konvoluuti ei ole."""
    from server import meili_doc
    work_dir = tmp_path / "t"
    work_dir.mkdir()
    meta = {"id": "w1", "exemplars": [
        _x(id="a", convolute={"reference": "R Est.B-954 (konvoluut)", "position": 0}),
        _x(id="b", convolute={"reference": "R Est.B-954 (I)"}),
        _x(id="c")]}
    (work_dir / "_metadata.json").write_text(json.dumps(meta), encoding="utf-8")
    _, result = meili_doc.get_work_metadata(str(work_dir), "t", {})
    assert result["convolute_count"] == 2

    meta["exemplars"] = [_x(id="c")]
    (work_dir / "_metadata.json").write_text(json.dumps(meta), encoding="utf-8")
    _, result = meili_doc.get_work_metadata(str(work_dir), "t", {})
    assert result["convolute_count"] == 0
