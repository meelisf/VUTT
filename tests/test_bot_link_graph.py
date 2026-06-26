# tests/test_bot_link_graph.py
# Bot-linkgraafi laiendus: kodulehe-indeks + bot-lehtede ristviited (#18 SEO)
import json
import pytest


# ---------------------------------------------------------------------------
# build_home_meta_html — bot-koduleht, grupeeritud kollektsioonide kaupa
# ---------------------------------------------------------------------------

COLLECTIONS = {
    "academia-gustaviana": {"name": {"et": "Academia Gustaviana", "en": "Academia Gustaviana"}, "parent": None},
    "academia-carolina": {"name": {"et": "Academia Gustavo-Carolina", "en": "Academia Gustavo-Carolina"}, "parent": None},
}


def _home(cache, public, load_meta, work_collections, collections=COLLECTIONS):
    from server.metadata_handler import build_home_meta_html
    return build_home_meta_html(cache, public, load_meta, work_collections, collections)


def test_home_lists_public_work_link():
    cache = {"w1": ("/data/w1", 0.0)}
    metas = {"w1": {"id": "w1", "title": "Disputatio de pace", "year": 1654, "collections": ["academia-gustaviana"]}}
    html = _home(cache, lambda m: True, lambda wid: metas.get(wid), {"w1": ["academia-gustaviana"]})
    assert '<a href="https://vutt.utlib.ut.ee/work/w1">' in html
    assert "Disputatio de pace" in html
    assert "1654" in html


def test_home_groups_under_collection_heading():
    cache = {"w1": ("/data/w1", 0.0), "w2": ("/data/w2", 0.0)}
    metas = {
        "w1": {"id": "w1", "title": "Teos A", "collections": ["academia-gustaviana"]},
        "w2": {"id": "w2", "title": "Teos B", "collections": ["academia-carolina"]},
    }
    wc = {"w1": ["academia-gustaviana"], "w2": ["academia-carolina"]}
    html = _home(cache, lambda m: True, lambda wid: metas.get(wid), wc)
    assert "Academia Gustaviana" in html
    assert "Academia Gustavo-Carolina" in html
    # mõlemad <h2> pealkirjadena
    assert html.count("<h2>") >= 2


def test_home_uncategorized_goes_to_muu():
    cache = {"w3": ("/data/w3", 0.0)}
    metas = {"w3": {"id": "w3", "title": "Ilma kollektsioonita", "collections": []}}
    html = _home(cache, lambda m: True, lambda wid: metas.get(wid), {})
    assert "Muu" in html
    assert "Ilma kollektsioonita" in html


def test_home_excludes_non_public_work():
    cache = {"wpriv": ("/data/wpriv", 0.0)}
    metas = {"wpriv": {"id": "wpriv", "title": "Piiratud teos", "collections": ["restricted"]}}
    html = _home(cache, lambda m: False, lambda wid: metas.get(wid), {"wpriv": ["restricted"]})
    assert "Piiratud teos" not in html
    assert "/work/wpriv" not in html


def test_home_excludes_work_with_none_meta():
    cache = {"wx": ("/data/wx", 0.0)}
    html = _home(cache, lambda m: True, lambda wid: None, {})
    assert "/work/wx" not in html


def test_home_links_to_persons_hub():
    html = _home({}, lambda m: True, lambda wid: None, {})
    assert '<a href="https://vutt.utlib.ut.ee/persons">' in html


def test_home_escapes_title():
    cache = {"wxss": ("/data/wxss", 0.0)}
    metas = {"wxss": {"id": "wxss", "title": 'Teos <script>alert(1)</script>', "collections": []}}
    html = _home(cache, lambda m: True, lambda wid: metas.get(wid), {})
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_home_valid_html():
    html = _home({}, lambda m: True, lambda wid: None, {})
    assert html.startswith("<!DOCTYPE html>")
    assert "<h1>" in html


# ---------------------------------------------------------------------------
# build_persons_meta_html — isikute-hub lingib kõik isikud
# ---------------------------------------------------------------------------

def test_persons_hub_lists_person_links():
    from server.metadata_handler import build_persons_meta_html
    entries = [
        {"id": "vutt:P1", "label": "Johannes Acander"},
        {"id": "vutt:P2", "label": "Adam Lode"},
    ]
    html = build_persons_meta_html(entries)
    assert '<a href="https://vutt.utlib.ut.ee/persons/vutt:P1">' in html
    assert "Johannes Acander" in html
    assert "Adam Lode" in html


def test_persons_hub_excludes_tombstone_and_merged():
    from server.metadata_handler import build_persons_meta_html
    entries = [
        {"id": "vutt:P1", "label": "Nähtav"},
        {"id": "vutt:P2", "label": "Kustutatud", "record_status": "tombstone"},
        {"id": "vutt:P3", "label": "Liidetud", "merged_into": "vutt:P1"},
    ]
    html = build_persons_meta_html(entries)
    assert "Nähtav" in html
    assert "vutt:P2" not in html
    assert "vutt:P3" not in html


def test_persons_hub_none_keeps_self_link_only():
    from server.metadata_handler import build_persons_meta_html
    html = build_persons_meta_html(None)
    assert "https://vutt.utlib.ut.ee/persons" in html
    # ei tohi kukkuda
    assert "<h1>" in html


def test_persons_hub_escapes_label():
    from server.metadata_handler import build_persons_meta_html
    html = build_persons_meta_html([{"id": "vutt:PX", "label": "<b>x</b>"}])
    assert "<b>x</b>" not in html
    assert "&lt;b&gt;" in html


# ---------------------------------------------------------------------------
# build_meta_html — teose ristviited: loojate isikukaardid + tagasi-lingid
# ---------------------------------------------------------------------------

@pytest.fixture()
def patch_find(monkeypatch, tmp_path):
    import server.metadata_handler as mh
    registry = {}
    monkeypatch.setattr(mh, "find_directory_by_id", lambda wid: registry.get(wid))
    return registry, tmp_path


def _write_meta(tmp_path, meta):
    d = tmp_path / "data" / meta["id"]
    d.mkdir(parents=True, exist_ok=True)
    (d / "_metadata.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return str(d)


WORK_META = {"id": "work001", "title": "Disputatio", "year": 1654, "creators": [], "collections": []}


def test_work_links_to_creator_person_cards(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, WORK_META)
    html = build_meta_html("work001", creator_persons=[{"id": "vutt:P1", "label": "Gezelius"}])
    assert '<a href="https://vutt.utlib.ut.ee/persons/vutt:P1">' in html
    assert "Gezelius" in html


def test_work_has_back_links_to_home_and_persons(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, WORK_META)
    html = build_meta_html("work001", creator_persons=None)
    assert '<a href="https://vutt.utlib.ut.ee/">' in html
    assert '<a href="https://vutt.utlib.ut.ee/persons">' in html


def test_work_creator_person_label_escaped(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, WORK_META)
    html = build_meta_html("work001", creator_persons=[{"id": "vutt:PX", "label": "<i>x</i>"}])
    assert "<i>x</i>" not in html


# ---------------------------------------------------------------------------
# build_person_meta_html — isiku teoste lingid + tagasi-lingid
# ---------------------------------------------------------------------------

@pytest.fixture()
def patch_person(monkeypatch):
    import server.metadata_handler as mh
    person = {
        "id": "vutt:P1",
        "record_status": "published",
        "name": {"label": "Gezelius", "aliases": []},
        "works": [{"work_id": "work001", "role": "praeses"}],
    }

    def fake_get(pid):
        return person if pid == "vutt:P1" else None

    monkeypatch.setattr("server.prosopography.ops.get_person_with_works", fake_get)
    return person


def test_person_links_to_works(patch_person):
    from server.metadata_handler import build_person_meta_html
    html = build_person_meta_html("vutt:P1", work_links=[{"work_id": "work001", "title": "Disputatio"}])
    assert '<a href="https://vutt.utlib.ut.ee/work/work001">' in html
    assert "Disputatio" in html


def test_person_has_back_links(patch_person):
    from server.metadata_handler import build_person_meta_html
    html = build_person_meta_html("vutt:P1", work_links=[])
    assert '<a href="https://vutt.utlib.ut.ee/persons">' in html
    assert '<a href="https://vutt.utlib.ut.ee/">' in html


def test_person_work_title_escaped(patch_person):
    from server.metadata_handler import build_person_meta_html
    html = build_person_meta_html("vutt:P1", work_links=[{"work_id": "wx", "title": "<x>"}])
    assert "<x>" not in html
