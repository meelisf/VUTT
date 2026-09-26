# tests/test_work_parts.py
"""Teose osad (#464): valideerimine, toimingud, lehetoimingute sünk."""
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
