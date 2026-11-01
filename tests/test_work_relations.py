"""Teoste seosed (#701, ADR 0075): vastastikune kirjutus, range bulk-režiim,
tühja `relations` normaliseerimine, lahendamine ja kustutuse koristus."""
import json
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server import metadata_ops  # noqa: E402
from server.metadata_ops import bulk_update_works  # noqa: E402


def _work(tmp_path, slug, meta):
    work_dir = tmp_path / slug
    work_dir.mkdir()
    path = work_dir / "_metadata.json"
    path.write_text(json.dumps(meta), encoding="utf-8")
    return str(path)


@pytest.fixture
def spies(monkeypatch):
    """Järeltegevused spioonideks; save_with_git tagastab õnnestumise."""
    seen = {"git": [], "collections": [], "ptw": [], "meili": [], "facts": []}

    def fake_save(path, content, user, message=None, additional_files=None, **kwargs):
        seen["git"].append({
            "path": path, "content": content, "message": message,
            "additional_files": additional_files or [], "kwargs": kwargs,
        })
        # Kirjutab päriselt, nagu save_with_git — järgmine lugemine näeb uut seisu.
        for p, c in [(path, content), *(additional_files or [])]:
            Path(p).write_text(c, encoding="utf-8")
        return {"success": True, "commit_hash": "abc123", "is_noop": False}

    monkeypatch.setattr(metadata_ops, "save_with_git", fake_save)
    monkeypatch.setattr(metadata_ops, "update_work_collections",
                        lambda work_id, colls: seen["collections"].append((work_id, colls)))
    monkeypatch.setattr(metadata_ops, "update_person_to_works",
                        lambda *args, **kwargs: seen["ptw"].append(args[0]))
    monkeypatch.setattr(metadata_ops, "update_work_facts",
                        lambda meta, work_dir: seen["facts"].append(meta.get("id")))
    monkeypatch.setattr(metadata_ops, "sync_work_to_meilisearch",
                        lambda slug: seen["meili"].append(slug))
    monkeypatch.setattr(metadata_ops, "uncommitted_paths", lambda paths: [])
    return seen


# --- Task 1: tühi relations ---------------------------------------------------

def test_tuhi_relations_ei_joua_kettale(tmp_path, spies):
    path = _work(tmp_path, "teos-a", {"id": "w1", "title": "A"})
    res = bulk_update_works([(path, lambda m: {"relations": []})], "u", "msg")
    assert res["updated"] == 0 and res["skipped"] == 1
    assert spies["git"] == []
    assert "relations" not in json.loads(Path(path).read_text())


def test_viimase_seose_eemaldus_eemaldab_votme(tmp_path, spies):
    path = _work(tmp_path, "teos-a", {"id": "w1", "title": "A",
                                      "relations": [{"id": "w2", "rel_type": "isVersionOf"}]})
    bulk_update_works([(path, lambda m: {"relations": []})], "u", "msg")
    assert "relations" not in json.loads(spies["git"][0]["content"])


# --- Task 3: range režiim ---------------------------------------------------------

from server.metadata_ops import BulkUpdateError  # noqa: E402


def _add(other):
    def transform(meta):
        rels = list(meta.get("relations") or [])
        rels.append({"id": other, "rel_type": "isVersionOf"})
        return {"relations": rels}
    return transform


def _boom(meta):
    raise ValueError("katki")


def test_range_puuduv_fail_ei_kirjuta_midagi(tmp_path, spies):
    a = _work(tmp_path, "a", {"id": "w1", "title": "A"})
    puudub = str(tmp_path / "b" / "_metadata.json")
    with pytest.raises(BulkUpdateError) as e:
        bulk_update_works([(a, _add("w2")), (puudub, _add("w1"))], "u", "m", all_or_nothing=True)
    assert e.value.failed_paths == [puudub]
    assert spies["git"] == [] and spies["meili"] == [] and spies["collections"] == []
    assert "relations" not in json.loads(Path(a).read_text())


def test_range_teise_transformi_viga_ei_kirjuta_esimest(tmp_path, spies):
    a = _work(tmp_path, "a", {"id": "w1", "title": "A"})
    b = _work(tmp_path, "b", {"id": "w2", "title": "B"})
    with pytest.raises(BulkUpdateError):
        bulk_update_works([(a, _add("w2")), (b, _boom)], "u", "m", all_or_nothing=True)
    assert spies["git"] == [] and spies["meili"] == []


def test_range_kasutab_tagasipooramist_ja_commiti_viga_viskab(tmp_path, spies, monkeypatch):
    a = _work(tmp_path, "a", {"id": "w1", "title": "A"})
    b = _work(tmp_path, "b", {"id": "w2", "title": "B"})
    kutsed = []

    def kukkuv(*args, **kwargs):
        kutsed.append(kwargs)
        return {"success": False, "error": "x", "rolled_back": True}

    monkeypatch.setattr(metadata_ops, "save_with_git", kukkuv)
    with pytest.raises(BulkUpdateError):
        bulk_update_works([(a, _add("w2")), (b, _add("w1"))], "u", "m", all_or_nothing=True)
    assert kutsed[0]["rollback_on_error"] is True
    assert spies["meili"] == [] and spies["collections"] == [] and spies["facts"] == []


def test_range_edukas_kirjutab_molemad_uhe_commitiga(tmp_path, spies):
    a = _work(tmp_path, "a", {"id": "w1", "title": "A"})
    b = _work(tmp_path, "b", {"id": "w2", "title": "B"})
    res = bulk_update_works([(a, _add("w2")), (b, _add("w1"))], "u", "m", all_or_nothing=True)
    assert res["updated"] == 2 and len(spies["git"]) == 1
    assert sorted(spies["meili"]) == ["a", "b"]


def test_skip_sync_paths_kirjutab_aga_ei_sunki(tmp_path, spies):
    a = _work(tmp_path, "a", {"id": "w1", "title": "A"})
    b = _work(tmp_path, "b", {"id": "w2", "title": "B"})
    bulk_update_works([(a, _add("w2")), (b, _add("w1"))], "u", "m", skip_sync_paths=[a])
    git = spies["git"][0]
    assert {git["path"], *[p for p, _ in git["additional_files"]]} == {a, b}
    assert spies["meili"] == ["b"]
    assert spies["collections"] == [("w2", [])] and spies["facts"] == ["w2"]


def test_vaikimisi_osaline_rike_kaitub_nagu_enne(tmp_path, spies):
    a = _work(tmp_path, "a", {"id": "w1", "title": "A"})
    b = _work(tmp_path, "b", {"id": "w2", "title": "B"})
    res = bulk_update_works([(a, _add("w2")), (b, _boom)], "u", "m")
    assert res["updated"] == 1 and res["failed"] == 1
    assert "rollback_on_error" not in spies["git"][0]["kwargs"]


# --- Task 4: seoste tuumik ----------------------------------------------------------

from server import work_relations  # noqa: E402
from server import work_sets_access  # noqa: E402
from server.work_relations import (  # noqa: E402
    RelationError, apply_relation_changes, cleanup_for_deletion, resolve_relations,
)


@pytest.fixture
def works(tmp_path, monkeypatch):
    """Kolm teost; w3 on vaatajale piiratud."""
    dirs = {}
    for wid, title in (("w1", "Series lectionum"), ("w2", "Series lectionum"), ("w3", "Piiratud")):
        path = _work(tmp_path, f"teos-{wid}", {
            "id": wid, "title": title, "title_en": f"{title} EN", "year": 1702,
            "exemplars": [{"id": "x1", "holder": "LAB", "shelfmark": f"R {wid}"}],
        })
        dirs[wid] = str(Path(path).parent)

    def find(work_id):
        return dirs.get(work_id)

    monkeypatch.setattr(work_relations, "find_directory_by_id", find)
    monkeypatch.setattr(work_sets_access, "find_directory_by_id", find)
    monkeypatch.setattr(work_relations, "can_read_work", lambda meta, user: meta.get("id") != "w3")
    return dirs


def _rels(works, wid):
    return json.loads(Path(works[wid], "_metadata.json").read_text()).get("relations")


V = "isVersionOf"


def test_lisamine_kirjutab_molemad_uhe_commitiga(works, spies):
    assert apply_relation_changes("w1", [{"id": "w2", "rel_type": V}], [], "u") is True
    assert len(spies["git"]) == 1
    assert spies["git"][0]["message"] == "Seos: lisa variant w1 ↔ w2"
    assert spies["git"][0]["kwargs"] == {"rollback_on_error": True}
    assert _rels(works, "w1") == [{"id": "w2", "rel_type": V}]
    assert _rels(works, "w2") == [{"id": "w1", "rel_type": V}]


def test_label_ei_salvestu(works, spies):
    apply_relation_changes("w1", [{"id": "w2", "rel_type": V, "label": "x"}], [], "u")
    assert _rels(works, "w1") == [{"id": "w2", "rel_type": V}]


def test_eemaldamine_eemaldab_molemalt_ja_votme(works, spies):
    apply_relation_changes("w1", [{"id": "w2", "rel_type": V}], [], "u")
    assert apply_relation_changes("w2", [], [{"id": "w1", "rel_type": V}], "u") is True
    assert spies["git"][1]["message"] == "Seos: eemalda variant w2 ↔ w1"
    assert _rels(works, "w1") is None and _rels(works, "w2") is None


def test_olemasoleva_lisamine_ja_puuduva_eemaldus_on_noop(works, spies):
    assert apply_relation_changes("w1", [], [{"id": "w2", "rel_type": V}], "u") is False
    apply_relation_changes("w1", [{"id": "w2", "rel_type": V}], [], "u")
    assert apply_relation_changes("w2", [{"id": "w1", "rel_type": V}], [], "u") is False
    assert len(spies["git"]) == 1


@pytest.mark.parametrize("add", [[{"id": "w1", "rel_type": V}],
                                 [{"id": "w2", "rel_type": "isPartOf"}],
                                 [{"id": "puudub", "rel_type": V}]])
def test_vigane_lisamine_400(works, spies, add):
    with pytest.raises(RelationError) as e:
        apply_relation_changes("w1", add, [], "u")
    assert e.value.status == 400 and spies["git"] == []


def test_salvestuse_viga_on_500(works, spies, monkeypatch):
    monkeypatch.setattr(metadata_ops, "save_with_git",
                        lambda *a, **k: {"success": False, "error": "x", "rolled_back": True})
    with pytest.raises(RelationError) as e:
        apply_relation_changes("w1", [{"id": "w2", "rel_type": V}], [], "u")
    assert e.value.status == 500 and str(e.value) == "Seost ei salvestatud"


def test_resolve_piiratud_siht_annab_pealkirja_readable_false(works, spies):
    apply_relation_changes("w1", [{"id": "w2", "rel_type": V}, {"id": "w3", "rel_type": V}], [], "u")
    meta = json.loads(Path(works["w1"], "_metadata.json").read_text())
    by_id = {r["id"]: r for r in resolve_relations(meta, None)}
    assert by_id["w2"]["readable"] is True and by_id["w2"]["title_en"] == "Series lectionum EN"
    assert by_id["w2"]["archive_ref"] == "LAB R w2" and by_id["w2"]["year"] == 1702
    assert by_id["w3"]["readable"] is False and by_id["w3"]["title"] == "Piiratud"


def test_resolve_puuduv_siht_on_missing_ja_muud_liigid_valja(works):
    meta = {"id": "w1", "relations": [{"id": "kadunud", "rel_type": V},
                                      {"id": "w2", "rel_type": "isPartOf"}]}
    assert resolve_relations(meta, None) == [{"id": "kadunud", "rel_type": V, "missing": True}]


def test_cleanup_eemaldab_molemalt_jatab_rippuva_vahele_ei_sunki_kustutatavat(works, spies):
    apply_relation_changes("w1", [{"id": "w2", "rel_type": V}], [], "u")
    # rippuv seos: w1 viitab teosele, mida enam ei ole
    p1 = Path(works["w1"], "_metadata.json")
    meta = json.loads(p1.read_text())
    meta["relations"].append({"id": "kadunud", "rel_type": V})
    p1.write_text(json.dumps(meta))
    spies["meili"].clear()
    cleaned = cleanup_for_deletion("w1", str(p1), "u")
    assert cleaned == ["w2"]
    assert spies["git"][-1]["message"] == "Kustutamine: eemalda seosed w1 ↔ w2"
    assert _rels(works, "w1") is None and _rels(works, "w2") is None
    assert spies["meili"] == ["teos-w2"]


def test_cleanup_ilma_seosteta_ei_kirjuta(works, spies):
    assert cleanup_for_deletion("w3", str(Path(works["w3"], "_metadata.json")), "u") == []
    assert spies["git"] == []
