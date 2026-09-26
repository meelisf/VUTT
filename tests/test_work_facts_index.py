# tests/test_work_facts_index.py
"""Teose faktide read-model (#461): üks kirje-ehitaja, kirje igale teosele."""
import json
from pathlib import Path
from unittest.mock import patch

from server.prosopography import work_relations_ops as wro

A = "vutt:Paaaaa"


def _meta(**kw):
    base = {"id": "w1", "title": "Disputatio", "year": 1658, "creators": [],
            "location": {"id": "Q435295", "label": "Altdorf bei Nürnberg", "source": "wikidata"},
            "genre": [{"id": "Q1123131", "label": "disputatsioon"}]}
    base.update(kw)
    return base


def _patches(tmp_path):
    return (patch.object(wro, "BASE_DIR", str(tmp_path / "data")),
            patch.object(wro, "WORKS_CREATORS_INDEX_FILE", str(tmp_path / "wci.json")))


def _read(tmp_path):
    return json.loads((tmp_path / "wci.json").read_text(encoding="utf-8"))


def test_kirje_kannab_kohta_ja_zanreid():
    e = wro._work_facts_entry(_meta(creators=[{"id": A, "role": "praeses"}]))
    assert e == {"title": "Disputatio", "year": 1658,
                 "creators": [{"person_id": A, "roles": ["praeses"]}],
                 "location": {"id": "Q435295", "label": "Altdorf bei Nürnberg"},
                 "genres": ["disputatsioon"]}


def test_tuhi_voi_stringkoht():
    assert wro._work_facts_entry(_meta(location=""))["location"] is None
    assert wro._work_facts_entry(_meta(location=None))["location"] is None
    assert wro._work_facts_entry(_meta(location="Riga"))["location"] == {"id": None, "label": "Riga"}


def test_zanr_objekt_voi_puudub():
    assert wro._work_facts_entry(_meta(genre={"label": "kõne"}))["genres"] == ["kõne"]
    assert wro._work_facts_entry(_meta(genre=None))["genres"] == []


def test_loojateta_teos_saab_kirje(tmp_path):
    p1, p2 = _patches(tmp_path)
    with p1, p2:
        wro.update_work_facts(_meta(creators=[]))
    assert _read(tmp_path)["w1"]["creators"] == []


def test_update_asendab_ja_remove_eemaldab(tmp_path):
    p1, p2 = _patches(tmp_path)
    with p1, p2:
        wro.update_work_facts(_meta())
        wro.update_work_facts(_meta(title="Uus"))
        assert _read(tmp_path)["w1"]["title"] == "Uus"
        wro.remove_work_facts("w1")
        assert "w1" not in _read(tmp_path)


def test_rebuild_ja_update_annavad_sama_kirje(tmp_path):
    """ADR 0007: sama kirje-ehitaja mõlemas teel."""
    d = tmp_path / "data" / "slug-w1"
    d.mkdir(parents=True)
    meta = _meta(creators=[{"id": A, "role": "auctor"}])
    (d / "_metadata.json").write_text(json.dumps(meta), encoding="utf-8")
    p1, p2 = _patches(tmp_path)
    with p1, p2:
        wro.build_works_creators_index()
        rebuilt = _read(tmp_path)["w1"]
        (tmp_path / "wci.json").unlink()
        wro.update_work_facts(meta)
        assert _read(tmp_path)["w1"] == rebuilt


# ── Uuendusteed (integratsioon) ───────────────────────────────────────────────

def _work_dir(tmp_path, meta):
    d = tmp_path / "data" / f"slug-{meta['id']}"
    d.mkdir(parents=True, exist_ok=True)
    (d / "_metadata.json").write_text(json.dumps(meta), encoding="utf-8")
    return d / "_metadata.json"


def _env(monkeypatch, tmp_path):
    """Metaandmete salvestus ilma giti ja Meilita; indeksid tmp-is."""
    from server import metadata_ops
    from server.prosopography import ops
    monkeypatch.setattr(wro, "BASE_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(wro, "WORKS_CREATORS_INDEX_FILE", str(tmp_path / "wci.json"))
    monkeypatch.setattr(ops, "PERSON_TO_WORKS_FILE", str(tmp_path / "ptw.json"))
    monkeypatch.setattr(ops, "WORK_COLLECTIONS_INDEX_FILE", str(tmp_path / "wc.json"))
    monkeypatch.setattr(metadata_ops, "sync_work_to_meilisearch", lambda *_a, **_k: None)
    # Git-kirjutus nagu tests/test_metadata_git_tulemus.py-s
    monkeypatch.setattr(metadata_ops, "save_with_git", lambda *_a, **_k: {"success": True})
    return metadata_ops


def test_call_ptw_true_ei_kustuta_uusi_valju(monkeypatch, tmp_path):
    """Vana update_works_creators_index kirjutas kirje üle ilma location/genres-ita."""
    mo = _env(monkeypatch, tmp_path)
    path = _work_dir(tmp_path, _meta(creators=[{"id": A, "role": "auctor"}]))
    mo.save_work_metadata(str(path), {"title": "Uus pealkiri"}, "tester", "test",
                          sync_meili=False, call_ptw=True)
    e = _read(tmp_path)["w1"]
    assert e["title"] == "Uus pealkiri"
    assert e["location"] == {"id": "Q435295", "label": "Altdorf bei Nürnberg"}
    assert e["genres"] == ["disputatsioon"]


def test_loojateta_teos_ei_kao_call_ptw_true_jarel(monkeypatch, tmp_path):
    mo = _env(monkeypatch, tmp_path)
    path = _work_dir(tmp_path, _meta(creators=[], tags=[{"id": A, "entity_type": "person", "label": "X"}]))
    mo.save_work_metadata(str(path), {"year": 1660}, "tester", "test", sync_meili=False, call_ptw=True)
    assert _read(tmp_path)["w1"]["year"] == 1660


def test_call_ptw_false_uuendab_fakte(monkeypatch, tmp_path):
    """Hulgi- ja jagamisteed kasutavad call_ptw=False — faktid peavad ikka uuenema."""
    mo = _env(monkeypatch, tmp_path)
    path = _work_dir(tmp_path, _meta())
    mo.save_work_metadata(str(path), {"location": {"id": "Q13972", "label": "Tartu"}},
                          "tester", "test", sync_meili=False, call_ptw=False)
    assert _read(tmp_path)["w1"]["location"] == {"id": "Q13972", "label": "Tartu"}


# ── Arvustuse I1: ülejäänud uuendusteed ──────────────────────────────────────

def test_hulgitee_uuendab_fakte(monkeypatch, tmp_path):
    """bulk_update_works (call_ptw=False) — nt hulgižanr või -koht."""
    mo = _env(monkeypatch, tmp_path)
    path = _work_dir(tmp_path, _meta())
    mo.bulk_update_works([(str(path), lambda _m: {"title": "Hulgi"})], "tester", "test")
    assert _read(tmp_path)["w1"]["title"] == "Hulgi"


def test_teose_kustutus_eemaldab_faktid(monkeypatch, tmp_path):
    from server.routers import admin
    _env(monkeypatch, tmp_path)
    _work_dir(tmp_path, _meta())
    wro.update_work_facts(_meta())
    monkeypatch.setattr(admin, "BASE_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(admin, "find_directory_by_id", lambda _w: str(tmp_path / "data" / "slug-w1"))
    monkeypatch.setattr(admin, "delete_work_from_git", lambda *a, **k: None)
    monkeypatch.setattr(admin, "delete_work_from_meilisearch", lambda *a, **k: None)
    monkeypatch.setattr(admin, "build_work_id_cache", lambda: None)
    admin.admin_work_delete("w1", user={"username": "admin", "role": "admin"})
    assert "w1" not in _read(tmp_path)


def test_import_kirjutab_faktid(monkeypatch, tmp_path):
    from server.upload import import_work
    _env(monkeypatch, tmp_path)
    import_work._update_indices_after_import("w9", _meta(id="w9", title="Imporditud"))
    assert _read(tmp_path)["w9"]["title"] == "Imporditud"


def test_kogude_hulgimuudatus_muudab_restricted_ilma_rebuildita(monkeypatch, tmp_path, prosopo_env):
    """Kogud tulevad work_collections_index-ist, mida hulgitee uuendab tingimusteta."""
    from unittest import mock
    from server.prosopography.network import build_person_network
    mo = _env(monkeypatch, tmp_path)
    prosopo_env.write("aaaaa")
    prosopo_env.write("bbbbb")
    path = _work_dir(tmp_path, _meta(creators=[{"id": A, "role": "praeses"},
                                               {"id": "vutt:Pbbbbb", "role": "respondens"}]))
    mo.save_work_metadata(str(path), {"title": "T"}, "tester", "test", sync_meili=False, call_ptw=True)
    cols = {"salajane": {"visibility": "restricted"}}
    with mock.patch("server.access_ops.get_cached_collections", return_value=cols):
        assert build_person_network(A)["works"][0]["restricted"] is False
        mo.bulk_update_works([(str(path), lambda _m: {"collections": ["salajane"]})], "tester", "kogu")
        assert build_person_network(A)["works"][0]["restricted"] is True
