# tests/test_work_parts.py
"""Teose osad (#464): valideerimine, toimingud, lehetoimingute sünk."""
import os

import pytest

from server import work_parts as wp

STEMS = {"t-001", "t-002", "t-003", "t-004"}


def _p(**kw):
    base = {"id": "p1", "kind": "letter", "pages": ["t-001"], "creators": []}
    base.update(kw)
    return base


def test_kehtiv_osa_labib_ja_normaliseeritakse():
    out = wp.validate_parts([_p(title=" Kiri ", pages=["t-002", "t-001"])], STEMS)
    assert out[0]["title"] == "Kiri"
    assert out[0]["needs_review"] is False


@pytest.mark.parametrize("bad", [
    _p(kind="romaan"),
    _p(pages=["t-999"]),
    _p(pages=[]),                                         # tühi ainult needs_review'ga
    _p(creators=[{"id": "vutt:Pa", "name": "A", "role": "mentioned"}]),
    _p(kind="poem", place_to={"id": "Q1", "label": "X"}),  # place_to ainult kirjal
    _p(dating={"start": "1684-13-40"}),
])
def test_vigane_osa_400(bad):
    with pytest.raises(wp.PartError) as e:
        wp.validate_parts([bad], STEMS)
    assert e.value.status == 400


def test_tuhi_osa_lubatud_needs_reviewga():
    assert wp.validate_parts([_p(pages=[], needs_review=True)], STEMS)[0]["pages"] == []


def test_katkendlik_ja_jagatud_leht_lubatud():
    parts = [_p(id="a", pages=["t-001", "t-003"]), _p(id="b", pages=["t-003", "t-004"])]
    assert len(wp.validate_parts(parts, STEMS)) == 2


def test_id_unikaalne_ja_attached_to_reeglid():
    with pytest.raises(wp.PartError):
        wp.validate_parts([_p(id="a"), _p(id="a")], STEMS)
    with pytest.raises(wp.PartError):                     # viide olematule
        wp.validate_parts([_p(id="a", kind="attachment", attached_to="zz")], STEMS)
    with pytest.raises(wp.PartError):                     # lisa lisale
        wp.validate_parts([_p(id="a", kind="attachment", attached_to="b"),
                           _p(id="b", kind="attachment", attached_to=None)], STEMS)
    with pytest.raises(wp.PartError):                     # iseendale
        wp.validate_parts([_p(id="a", kind="attachment", attached_to="a")], STEMS)
    ok = wp.validate_parts([_p(id="a", kind="letter"), _p(id="b", kind="attachment", attached_to="a")], STEMS)
    assert ok[1]["attached_to"] == "a"


def test_new_part_ignoreerib_kliendi_id_ja_needs_review():
    p = wp.new_part({"id": "hack", "needs_review": True, "kind": "letter", "pages": ["t-001"]}, {"p1"})
    assert p["id"] not in ("hack", "p1") and p["needs_review"] is False


# ── Toimingud ────────────────────────────────────────────────────────────────
import json
import threading


@pytest.fixture
def work(tmp_path, monkeypatch):
    from server import metadata_ops
    d = tmp_path / "slug-w1"
    d.mkdir()
    for i in range(1, 5):
        (d / f"t-00{i}.jpg").write_bytes(b"x")
    (d / "_metadata.json").write_text(json.dumps({"id": "w1", "title": "T"}), encoding="utf-8")
    def fake_save(path, content, *a, additional_files=None, **k):
        # bulk_update_works kirjutab faili save_with_git kaudu
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        for p2, c2 in additional_files or []:
            with open(p2, "w", encoding="utf-8") as f:
                f.write(c2)
        return {"success": True}
    monkeypatch.setattr(metadata_ops, "save_with_git", fake_save)
    monkeypatch.setattr(metadata_ops, "sync_work_to_meilisearch", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "update_person_to_works", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "update_work_collections", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "update_work_facts", lambda *a, **k: None)
    return str(d)


def _meta(work):
    return json.load(open(f"{work}/_metadata.json"))


def test_loo_muuda_kustuta(work):
    p = wp.create_part(work, {"kind": "letter", "pages": ["t-002"], "title": "A"}, "ed")
    assert _meta(work)["parts"][0]["id"] == p["id"]
    wp.update_part(work, p["id"], {**p, "title": "B"}, "ed")
    assert _meta(work)["parts"][0]["title"] == "B"
    wp.delete_part(work, p["id"], "ed")
    assert _meta(work)["parts"] == []


def test_tundmatu_osa_404(work):
    with pytest.raises(wp.PartError) as e:
        wp.update_part(work, "nope", {"kind": "letter", "pages": ["t-001"]}, "ed")
    assert e.value.status == 404


def test_viidatud_osa_kustutus_409(work):
    a = wp.create_part(work, {"kind": "session", "pages": ["t-001"]}, "ed")
    wp.create_part(work, {"kind": "attachment", "pages": ["t-002"], "attached_to": a["id"]}, "ed")
    with pytest.raises(wp.PartError) as e:
        wp.delete_part(work, a["id"], "ed")
    assert e.value.status == 409
    assert len(_meta(work)["parts"]) == 2


def test_lehtede_lisamine_eemaldamine_ja_needs_review(work):
    p = wp.create_part(work, {"kind": "letter", "pages": ["t-001"]}, "ed")
    wp.change_part_pages(work, p["id"], add=["t-003", "t-002"], remove=["t-001"], username="ed")
    assert _meta(work)["parts"][0]["pages"] == ["t-002", "t-003"]   # teose järjekorras
    with pytest.raises(wp.PartError):                                 # viimast ei saa eemaldada
        wp.change_part_pages(work, p["id"], add=[], remove=["t-002", "t-003"], username="ed")


def test_samaaegne_loomine_ei_kaota_osa(work):
    errs = []

    def mk(i):
        try:
            wp.create_part(work, {"kind": "poem", "pages": [f"t-00{i}"]}, "ed")
        except Exception as e:                                       # pragma: no cover
            errs.append(e)
    ts = [threading.Thread(target=mk, args=(i,)) for i in (1, 2, 3, 4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert not errs and len(_meta(work)["parts"]) == 4


# ── Lehetoimingute sünk ───────────────────────────────────────────────────────

def test_remap_poolitus_asendab_molema_poolega():
    parts = [_p(id="a", pages=["t-001", "t-002"])]
    out, changed = wp.remap_parts(parts, ["t-001", "L", "R"], {"t-002": ["L", "R"]})
    assert changed and out[0]["pages"] == ["t-001", "L", "R"]


def test_remap_kustutus_eemaldab_ja_tuhi_needs_review():
    parts = [_p(id="a", pages=["t-001"]), _p(id="b", pages=["t-001", "t-002"])]
    out, changed = wp.remap_parts(parts, ["t-002"], None)
    assert changed
    assert out[0] == {**parts[0], "pages": [], "needs_review": True}
    assert out[1]["pages"] == ["t-002"] and not out[1].get("needs_review")


def test_remap_muutuseta():
    parts = [_p(id="a", pages=["t-001"])]
    out, changed = wp.remap_parts(parts, ["t-001", "t-002"], None)
    assert not changed


def test_refresh_work_mentions_kutsub_sync_work_parts(monkeypatch, tmp_path):
    from server.prosopography import relations
    calls = []
    monkeypatch.setattr(wp, "sync_work_parts", lambda d, w=None, renamed=None: calls.append((d, w, renamed)))
    monkeypatch.setattr(relations, "update_page_person_mentions", lambda *a: None)
    relations.refresh_work_mentions(str(tmp_path), "w1", renamed={"a": ["b", "c"]})
    assert calls == [(str(tmp_path), "w1", {"a": ["b", "c"]})]


def test_sync_viga_ei_takista_mainimiste_uuendust(monkeypatch, tmp_path):
    from server.prosopography import relations
    seen = []
    def boom(*a, **k): raise RuntimeError("x")
    monkeypatch.setattr(wp, "sync_work_parts", boom)
    monkeypatch.setattr(relations, "update_page_person_mentions", lambda *a: seen.append(a))
    relations.refresh_work_mentions(str(tmp_path), "w1")
    assert seen


def test_sync_work_parts_kirjutab_ainult_muutusel(work, monkeypatch):
    p = wp.create_part(work, {"kind": "letter", "pages": ["t-001", "t-002"]}, "ed")
    os.remove(f"{work}/t-002.jpg")
    wp.sync_work_parts(work, "w1")
    assert _meta(work)["parts"][0]["pages"] == ["t-001"]


# ── Otspunktid ───────────────────────────────────────────────────────────────
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def client(work, monkeypatch):
    from server.routers import work_parts as r
    from server import deps
    monkeypatch.setattr(r, "find_directory_by_id", lambda wid: work if wid == "w1" else None)
    monkeypatch.setattr(r, "load_work_metadata_by_id",
                        lambda wid: json.load(open(f"{work}/_metadata.json")) if wid == "w1" else None)
    app = FastAPI()
    app.include_router(r.router)
    state = {"user": {"username": "ed", "role": "editor"}, "write": True}

    # require_role loob iga kutsega uue sulguri, mis otsib get_user'it deps moodulist.
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
    r = client.post("/works/w1/parts", json={"kind": "letter", "pages": ["t-001"]})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert client.put(f"/works/w1/parts/{pid}", json={"kind": "letter", "pages": ["t-001"], "title": "X"}).json()["title"] == "X"
    assert client.post(f"/works/w1/parts/{pid}/pages", json={"add": ["t-002"], "remove": []}).json()["pages"] == ["t-001", "t-002"]
    assert client.get("/works/w1/parts").json()["parts"][0]["id"] == pid
    assert client.delete(f"/works/w1/parts/{pid}").status_code == 204


def test_get_annab_osade_lehtede_numbrid(client):
    """Töölaua sisukord vajab lehenumbrit (/work/{id}/{nr}) — sama järjekord mis indekseerijal."""
    client.post("/works/w1/parts", json={"kind": "letter", "pages": ["t-002", "t-004"]})
    body = client.get("/works/w1/parts").json()
    assert body["page_numbers"] == {"t-002": 2, "t-004": 4}


def test_get_ilma_osadeta_tuhi_numbrikaart(client):
    assert client.get("/works/w1/parts").json() == {"parts": [], "page_numbers": {}}


def test_endpointide_vead(client):
    assert client.post("/works/w1/parts", json={"kind": "x", "pages": ["t-001"]}).status_code == 400
    assert client.put("/works/w1/parts/nope", json={"kind": "letter", "pages": ["t-001"]}).status_code == 404
    assert client.post("/works/zz/parts", json={"kind": "letter", "pages": ["t-001"]}).status_code == 404
    client.state["write"] = False
    assert client.post("/works/w1/parts", json={"kind": "letter", "pages": ["t-001"]}).status_code == 403


def test_endpointid_on_sync():
    import asyncio
    from server.routers import work_parts as r
    for fn in (r.list_parts, r.create, r.update, r.delete, r.change_pages):
        assert not asyncio.iscoroutinefunction(fn)


def test_uldine_metaandmete_salvestus_lukkab_parts_tagasi():
    """/update-work-metadata ei tohi osi üle kirjutada (samaaegsed toimetajad) → 400."""
    import asyncio
    from fastapi import HTTPException
    from server.routers import editing
    from server.metadata_ops import ALLOWED_METADATA_FIELDS

    class FakeRequest:
        headers = {}
        async def json(self):
            return {"work_id": "w1", "metadata": {"parts": []}}

    with pytest.raises(HTTPException) as e:
        asyncio.run(editing.update_work_metadata(FakeRequest(), None, user={"username": "a", "role": "admin"}))
    assert e.value.status_code == 400
    assert "parts" in ALLOWED_METADATA_FIELDS


# ── Arvustuse leiud (lukk, vananenud tüved) ───────────────────────────────────

def test_vananenud_osa_ei_blokeeri_teisi_muudatusi(work):
    """Üks vananenud tüvi (sünk ebaõnnestus / käsitsi) ei tohi blokeerida kõiki
    selle teose osade muudatusi: iga kirjutus parandab puuduvad tüved enne muutust."""
    meta = _meta(work)
    meta["parts"] = [{"id": "old", "kind": "letter", "pages": ["t-001", "t-kadunud"], "creators": []},
                     {"id": "gone", "kind": "poem", "pages": ["t-kadunud"], "creators": []}]
    open(f"{work}/_metadata.json", "w").write(json.dumps(meta))
    wp.create_part(work, {"kind": "speech", "pages": ["t-002"]}, "ed")
    parts = {p["id"]: p for p in _meta(work)["parts"]}
    assert parts["old"]["pages"] == ["t-001"]
    assert parts["gone"]["pages"] == [] and parts["gone"]["needs_review"] is True
    assert len(parts) == 3


def test_kirjutus_hoiab_teose_lukku(work, monkeypatch):
    """Tüvede lugemine ja kirjutus käivad work_lock'i all (sama järjekord mis lehetoimingutel:
    work_lock → metadata_lock) — muidu võib samaaegne poolitus tüve vahepeal asendada."""
    import contextlib
    import server.admin_page_ops as aps
    held = []
    real_stems = wp.page_stems

    @contextlib.contextmanager
    def fake_lock(key, work_dir):
        held.append(True)
        try:
            yield
        finally:
            held.pop()
    monkeypatch.setattr(aps, "work_lock", fake_lock)
    seen = []
    monkeypatch.setattr(wp, "page_stems", lambda d: (seen.append(bool(held)), real_stems(d))[1])
    wp.create_part(work, {"kind": "poem", "pages": ["t-001"]}, "ed")
    assert seen and all(seen)
