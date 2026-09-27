# tests/test_osad_indeksid_464.py
"""Teose osad indeksites (#464 PR 3): teose faktide `parts`, person_to_works
`part_id`, mainimiste `part_ids` ja osa salvestuse järelindeksid."""
import json

import pytest

from server import work_parts as wp
from server.prosopography import work_relations_ops as wro

A, B, C, M = "vutt:Paaaaa", "vutt:Pbbbbb", "vutt:Pccccc", "vutt:Pmmmmm"


def _write_page(d, stem, person_ids=(), sequence=None):
    (d / f"{stem}.jpg").write_bytes(b"x")
    content = {"page_tags": [{"id": pid, "label": pid} for pid in person_ids]}
    if sequence is not None:
        content["sequence"] = sequence
    (d / f"{stem}.json").write_text(json.dumps({"meta_content": content}), encoding="utf-8")


LETTER_A = {"id": "pa", "kind": "letter", "title": "Kiri A", "pages": ["t-002", "t-003"],
            "creators": [{"id": A, "name": "A", "role": "auctor"}, {"id": B, "name": "B", "role": "addressee"}],
            "dating": {"start": "1684-03-02"}, "place": {"id": "Q1794", "label": "Frankfurt"},
            "needs_review": False, "attached_to": None}
POEM_C = {"id": "pc", "kind": "poem", "pages": ["t-004"],
          "creators": [{"id": C, "name": "C", "role": "auctor"}, {"name": "Nimetu", "role": "auctor"}],
          "needs_review": False, "attached_to": None}


@pytest.fixture
def workdir(tmp_path):
    d = tmp_path / "slug-w1"
    d.mkdir()
    _write_page(d, "t-001")
    _write_page(d, "t-002", [M])
    _write_page(d, "t-003")
    _write_page(d, "t-004", [M])
    _write_page(d, "t-005", [M])
    meta = {"id": "w1", "title": "Kirjakogu", "year": 1690, "parts": [LETTER_A, POEM_C]}
    (d / "_metadata.json").write_text(json.dumps(meta), encoding="utf-8")
    return d


# ── Teose faktid ─────────────────────────────────────────────────────────────

def test_teose_faktid_kannavad_osi(workdir):
    meta = json.loads((workdir / "_metadata.json").read_text())
    e = wro._work_facts_entry(meta, str(workdir))
    assert e["parts"]["pa"] == {"kind": "letter", "title": "Kiri A", "year": 1684,
                                "place": {"id": "Q1794", "label": "Frankfurt"},
                                "first_page": 2, "pages": [2, 3]}
    assert e["parts"]["pc"] == {"kind": "poem", "title": "", "year": None, "place": None,
                                "first_page": 4, "pages": [4]}


def test_osadeta_teose_kirjel_pole_parts_votit(workdir):
    e = wro._work_facts_entry({"id": "w1", "title": "T"}, str(workdir))
    assert "parts" not in e


def test_ilma_kaustata_first_page_puudub(workdir):
    meta = json.loads((workdir / "_metadata.json").read_text())
    e = wro._work_facts_entry(meta)
    assert e["parts"]["pa"]["first_page"] is None and e["parts"]["pa"]["pages"] == []


def test_rebuild_ja_uuendus_annavad_sama_kirje(workdir, tmp_path, monkeypatch):
    """ADR 0007: rebuild ja update_work_facts kasutavad sama ehitajat ja kausta."""
    monkeypatch.setattr(wro, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(wro, "WORKS_CREATORS_INDEX_FILE", str(tmp_path / "wci.json"))
    wro.build_works_creators_index()
    rebuilt = json.loads((tmp_path / "wci.json").read_text())["w1"]
    meta = json.loads((workdir / "_metadata.json").read_text())
    wro.update_work_facts(meta, str(workdir))
    assert json.loads((tmp_path / "wci.json").read_text())["w1"] == rebuilt
    assert rebuilt["parts"]["pa"]["first_page"] == 2


# ── person_to_works ──────────────────────────────────────────────────────────

def _ptw(prosopo_env):
    from server.prosopography import ops
    with open(ops.PERSON_TO_WORKS_FILE, encoding="utf-8") as f:
        return json.load(f)


def test_osa_isikud_part_id_ga(prosopo_env):
    from server.prosopography.indices import update_person_to_works
    update_person_to_works("w1", [], [], None, "T", 1690, parts=[LETTER_A, POEM_C])
    data = _ptw(prosopo_env)
    assert data[A] == [{"work_id": "w1", "role": "auctor", "part_id": "pa"}]
    assert data[B] == [{"work_id": "w1", "role": "addressee", "part_id": "pa"}]
    assert data[C] == [{"work_id": "w1", "role": "auctor", "part_id": "pc"}]
    # Uus salvestus ilma osata eemaldab osa kirje
    update_person_to_works("w1", [], [], None, "T", 1690, parts=[POEM_C])
    data = _ptw(prosopo_env)
    assert data[A] == [] and data[C] == [{"work_id": "w1", "role": "auctor", "part_id": "pc"}]


def test_mainimine_saab_part_ids_ja_part_only(prosopo_env, workdir):
    from server.prosopography.relations import update_page_person_mentions
    update_page_person_mentions("w1", str(workdir))
    (entry,) = [e for e in _ptw(prosopo_env)[M] if e["role"] == "mentioned"]
    # lk 2 (kiri A), lk 4 (luuletus C), lk 5 (väljaspool osi)
    assert entry["pages"] == [2, 4, 5]
    assert entry["part_ids"] == ["pa", "pc"]
    assert "part_only" not in entry


def test_mainimine_ainult_osades_saab_part_only(prosopo_env, workdir):
    from server.prosopography.relations import update_page_person_mentions
    (workdir / "t-005.json").write_text(json.dumps({"meta_content": {}}), encoding="utf-8")
    update_page_person_mentions("w1", str(workdir))
    (entry,) = _ptw(prosopo_env)[M]
    assert entry["part_ids"] == ["pa", "pc"] and entry["part_only"] is True


def test_kaks_kirjutajat_ei_puhi_teineteist(prosopo_env, workdir):
    from server.prosopography.indices import update_person_to_works
    from server.prosopography.relations import update_page_person_mentions
    update_person_to_works("w1", [], [], None, "T", 1690, parts=[LETTER_A])
    update_page_person_mentions("w1", str(workdir))
    update_person_to_works("w1", [], [], None, "T", 1690, parts=[LETTER_A])
    data = _ptw(prosopo_env)
    assert data[A] == [{"work_id": "w1", "role": "auctor", "part_id": "pa"}]
    assert [e["role"] for e in data[M]] == ["mentioned"]


def test_rebuild_annab_sama_mis_uuendus(prosopo_env, workdir, tmp_path, monkeypatch):
    from server.prosopography import ops
    from server.prosopography.indices import rebuild_indices, update_person_to_works
    from server.prosopography.relations import update_page_person_mentions
    monkeypatch.setattr(ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(wro, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(wro, "WORKS_CREATORS_INDEX_FILE", str(tmp_path / "wci.json"))
    rebuild_indices()
    rebuilt = _ptw(prosopo_env)
    with open(ops.PERSON_TO_WORKS_FILE, "w", encoding="utf-8") as f:
        json.dump({}, f)
    update_person_to_works("w1", [], [], None, "T", 1690, parts=[LETTER_A, POEM_C])
    update_page_person_mentions("w1", str(workdir))
    updated = {k: v for k, v in _ptw(prosopo_env).items() if v}
    assert updated == rebuilt


# ── Osa salvestus ja lehetoimingud ───────────────────────────────────────────

@pytest.fixture
def work(workdir, monkeypatch):
    from server import metadata_ops
    meta = json.loads((workdir / "_metadata.json").read_text())
    meta.pop("parts")
    (workdir / "_metadata.json").write_text(json.dumps(meta), encoding="utf-8")

    def fake_save(path, content, *a, additional_files=None, **k):
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return {"success": True}
    monkeypatch.setattr(metadata_ops, "save_with_git", fake_save)
    monkeypatch.setattr(metadata_ops, "sync_work_to_meilisearch", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "update_work_collections", lambda *a, **k: None)
    calls = {"ptw": [], "facts": [], "mentions": []}
    monkeypatch.setattr(metadata_ops, "update_person_to_works",
                        lambda *a, **k: calls["ptw"].append((a, k)))
    monkeypatch.setattr(metadata_ops, "update_work_facts",
                        lambda meta, work_dir=None: calls["facts"].append((meta, work_dir)))
    monkeypatch.setattr(wro, "update_work_facts",
                        lambda meta, work_dir=None: calls["facts"].append((meta, work_dir)))
    from server.prosopography import relations
    monkeypatch.setattr(relations, "update_page_person_mentions",
                        lambda wid, wdir: calls["mentions"].append((wid, wdir)))
    return str(workdir), calls


def test_osa_salvestus_uuendab_isikud_mainimised_ja_faktid(work):
    wdir, calls = work
    wp.create_part(wdir, {"kind": "letter", "pages": ["t-002"],
                          "creators": [{"id": A, "name": "A", "role": "auctor"}]}, "ed")
    (args, kwargs) = calls["ptw"][-1]
    assert kwargs["parts"][0]["creators"][0]["id"] == A
    assert calls["mentions"] == [("w1", wdir)]
    assert calls["facts"][-1][1] == wdir


def test_umberjarjestus_uuendab_faktid_ka_osade_muutuseta(work):
    """Tüved ei muutu, aga numbrid muutuvad → first_page peab uuenema."""
    wdir, calls = work
    wp.create_part(wdir, {"kind": "letter", "pages": ["t-002"]}, "ed")
    calls["facts"].clear()
    wp.sync_work_parts(wdir, "w1")
    assert calls["facts"] and calls["facts"][-1][1] == wdir


# ── Isikuleht ────────────────────────────────────────────────────────────────

def test_isiku_teosed_kannavad_osa_andmeid(prosopo_env, tmp_path, monkeypatch):
    from server.prosopography import ops
    from server.prosopography.relations import get_person_with_works
    prosopo_env.write("aaaaa")
    with open(ops.PERSON_TO_WORKS_FILE, "w", encoding="utf-8") as f:
        json.dump({A: [{"work_id": "w1", "role": "auctor", "part_id": "pa"},
                       {"work_id": "w1", "role": "auctor", "part_id": "kadunud"},
                       {"work_id": "w2", "role": "praeses"}]}, f)
    monkeypatch.setattr(wro, "WORKS_CREATORS_INDEX_FILE", str(tmp_path / "wci.json"))
    (tmp_path / "wci.json").write_text(json.dumps({"w1": {"parts": {"pa": {
        "kind": "letter", "title": "Kiri A", "year": 1684, "place": None, "first_page": 2, "pages": [2, 3]}}}}))
    works = get_person_with_works(A)["works"]
    assert works[0]["part"] == {"kind": "letter", "title": "Kiri A", "year": 1684, "first_page": 2, "pages": [2, 3]}
    assert "part" not in works[1]           # faktides puudub → kirje jääb, osa andmeteta
    assert "part" not in works[2]
