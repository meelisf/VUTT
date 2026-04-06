"""
Testid: work_relations_ops.py käitumisreeglid.
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography.work_relations_ops import (
    build_works_creators_index,
    update_works_creators_index,
    get_work_relations,
)

A_ID = "vutt:Paaaaa"
B_ID = "vutt:Pbbbbb"
C_ID = "vutt:Pccccc"


def _write_meta(data_dir: Path, slug: str, work_id: str, creators: list, title: str = "Test", year: int = 1680):
    work_dir = data_dir / slug
    work_dir.mkdir(parents=True, exist_ok=True)
    (work_dir / "_metadata.json").write_text(
        json.dumps({"id": work_id, "title": title, "year": year, "creators": creators}),
        encoding="utf-8",
    )


def _write_ptw(state_dir: Path, data: dict):
    (state_dir / "person_to_works.json").write_text(
        json.dumps(data), encoding="utf-8"
    )


def _read_index(state_dir: Path) -> dict:
    p = state_dir / "works_creators_index.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def _patch(tmp_path, data_dir=None, state_dir=None):
    data_dir = data_dir or tmp_path / "data"
    state_dir = state_dir or tmp_path / "state"
    state_dir.mkdir(parents=True, exist_ok=True)
    cfg = "server.prosopography.work_relations_ops"
    return (
        patch(f"{cfg}.BASE_DIR", str(data_dir)),
        patch(f"{cfg}.WORKS_CREATORS_INDEX_FILE", str(state_dir / "works_creators_index.json")),
        patch(f"{cfg}.PERSON_TO_WORKS_FILE", str(state_dir / "person_to_works.json")),
        patch(f"{cfg}.PROSOPOGRAPHY_INDEX_FILE", str(state_dir / "prosopography_index.json")),
    )


# ── build_works_creators_index ────────────────────────────────────────────────

def test_build_index_basic(tmp_path):
    """Ehitab indeksi _metadata.json põhjal — kaks isikut ühes teoses."""
    data_dir = tmp_path / "data"
    state_dir = tmp_path / "state"
    _write_meta(data_dir, "teos1", "w1", [
        {"id": A_ID, "role": "praeses"},
        {"id": B_ID, "role": "respondens"},
    ], title="Disputatio", year=1687)
    patches = _patch(tmp_path, data_dir, state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        build_works_creators_index()
    idx = _read_index(state_dir)
    assert "w1" in idx
    assert idx["w1"]["title"] == "Disputatio"
    assert idx["w1"]["year"] == 1687
    creators = {e["person_id"]: e["roles"] for e in idx["w1"]["creators"]}
    assert creators[A_ID] == ["praeses"]
    assert creators[B_ID] == ["respondens"]


def test_build_index_multi_role_same_person(tmp_path):
    """Sama isik mitmes rollis samas teoses — rollid koondatakse massiivi."""
    data_dir = tmp_path / "data"
    state_dir = tmp_path / "state"
    _write_meta(data_dir, "teos1", "w1", [
        {"id": A_ID, "role": "praeses"},
        {"id": A_ID, "role": "autor"},
    ])
    patches = _patch(tmp_path, data_dir, state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        build_works_creators_index()
    idx = _read_index(state_dir)
    creators = {e["person_id"]: e["roles"] for e in idx["w1"]["creators"]}
    assert set(creators[A_ID]) == {"praeses", "autor"}


def test_build_index_ignores_non_vutt(tmp_path):
    """Wikidata/VIAF isikud (ilma vutt:P prefixita) ignoreeritakse."""
    data_dir = tmp_path / "data"
    state_dir = tmp_path / "state"
    _write_meta(data_dir, "teos1", "w1", [
        {"id": "Q12345", "role": "autor"},
        {"id": A_ID, "role": "praeses"},
    ])
    patches = _patch(tmp_path, data_dir, state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        build_works_creators_index()
    idx = _read_index(state_dir)
    creator_ids = [e["person_id"] for e in idx["w1"]["creators"]]
    assert "Q12345" not in creator_ids
    assert A_ID in creator_ids


# ── update_works_creators_index ───────────────────────────────────────────────

def test_update_index_adds_new_work(tmp_path):
    """Uue teose lisamisel uuendatakse indeksit."""
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    patches = _patch(tmp_path, state_dir=state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        update_works_creators_index("w2", [{"id": A_ID, "role": "autor"}], title="Uus teos", year=1690)
    idx = _read_index(state_dir)
    assert "w2" in idx
    assert idx["w2"]["creators"][0]["person_id"] == A_ID


def test_update_index_removes_empty_work(tmp_path):
    """Kui creators on tühi, eemaldatakse teos indeksist."""
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    (state_dir / "works_creators_index.json").write_text(
        json.dumps({"w1": {"title": "X", "year": 1680, "creators": [{"person_id": A_ID, "roles": ["praeses"]}]}}),
        encoding="utf-8",
    )
    patches = _patch(tmp_path, state_dir=state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        update_works_creators_index("w1", [], title="X", year=1680)
    idx = _read_index(state_dir)
    assert "w1" not in idx


# ── get_work_relations ────────────────────────────────────────────────────────

def _setup_relation_data(state_dir: Path):
    """Ühine andmete seadistus: A jagab w1 B-ga (praeses/respondens), w2 C-ga."""
    (state_dir / "works_creators_index.json").write_text(json.dumps({
        "w1": {"title": "Disputatio", "year": 1687, "creators": [
            {"person_id": A_ID, "roles": ["praeses"]},
            {"person_id": B_ID, "roles": ["respondens"]},
        ]},
        "w2": {"title": "Oratio", "year": 1690, "creators": [
            {"person_id": A_ID, "roles": ["autor"]},
            {"person_id": C_ID, "roles": ["pühendaja"]},
        ]},
    }), encoding="utf-8")
    (state_dir / "person_to_works.json").write_text(json.dumps({
        A_ID: [{"work_id": "w1", "role": "praeses"}, {"work_id": "w2", "role": "autor"}],
        B_ID: [{"work_id": "w1", "role": "respondens"}],
        C_ID: [{"work_id": "w2", "role": "pühendaja"}],
    }), encoding="utf-8")
    (state_dir / "prosopography_index.json").write_text(json.dumps({
        "entries": [
            {"id": A_ID, "label": "Andreas Berg"},
            {"id": B_ID, "label": "Johann Müller"},
            {"id": C_ID, "label": "Maria Schmidt"},
        ]
    }), encoding="utf-8")


def test_get_work_relations_basic(tmp_path):
    """A jagab teoseid B ja C-ga — mõlemad tagastatakse."""
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    _setup_relation_data(state_dir)
    patches = _patch(tmp_path, state_dir=state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        results = get_work_relations(A_ID)
    person_ids = {r["person_id"] for r in results}
    assert B_ID in person_ids
    assert C_ID in person_ids
    assert A_ID not in person_ids  # ennast ei tagastata


def test_get_work_relations_includes_person_name(tmp_path):
    """Tulemus sisaldab person_name prosopo indeksist."""
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    _setup_relation_data(state_dir)
    patches = _patch(tmp_path, state_dir=state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        results = get_work_relations(A_ID)
    b_result = next(r for r in results if r["person_id"] == B_ID)
    assert b_result["person_name"] == "Johann Müller"


def test_get_work_relations_roles_are_arrays(tmp_path):
    """a_roles ja b_roles on massiivid."""
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    _setup_relation_data(state_dir)
    patches = _patch(tmp_path, state_dir=state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        results = get_work_relations(A_ID)
    b_result = next(r for r in results if r["person_id"] == B_ID)
    shared = b_result["shared_works"][0]
    assert isinstance(shared["a_roles"], list)
    assert isinstance(shared["b_roles"], list)
    assert "praeses" in shared["a_roles"]
    assert "respondens" in shared["b_roles"]


def test_get_work_relations_sorted_by_count(tmp_path):
    """Sorteeritakse shared_works_count järgi kahanevalt."""
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    # B jagab 2 teost A-ga, C ainult 1
    (state_dir / "works_creators_index.json").write_text(json.dumps({
        "w1": {"title": "T1", "year": 1680, "creators": [
            {"person_id": A_ID, "roles": ["praeses"]},
            {"person_id": B_ID, "roles": ["respondens"]},
        ]},
        "w2": {"title": "T2", "year": 1681, "creators": [
            {"person_id": A_ID, "roles": ["autor"]},
            {"person_id": B_ID, "roles": ["pühendaja"]},
        ]},
        "w3": {"title": "T3", "year": 1682, "creators": [
            {"person_id": A_ID, "roles": ["praeses"]},
            {"person_id": C_ID, "roles": ["respondens"]},
        ]},
    }), encoding="utf-8")
    (state_dir / "person_to_works.json").write_text(json.dumps({
        A_ID: [{"work_id": "w1", "role": "praeses"}, {"work_id": "w2", "role": "autor"}, {"work_id": "w3", "role": "praeses"}],
        B_ID: [{"work_id": "w1", "role": "respondens"}, {"work_id": "w2", "role": "pühendaja"}],
        C_ID: [{"work_id": "w3", "role": "respondens"}],
    }), encoding="utf-8")
    (state_dir / "prosopography_index.json").write_text(json.dumps({"entries": [
        {"id": A_ID, "label": "A"}, {"id": B_ID, "label": "B"}, {"id": C_ID, "label": "C"},
    ]}), encoding="utf-8")
    patches = _patch(tmp_path, state_dir=state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        results = get_work_relations(A_ID)
    assert results[0]["person_id"] == B_ID
    assert results[0]["shared_works_count"] == 2
    assert results[1]["person_id"] == C_ID
    assert results[1]["shared_works_count"] == 1


def test_get_work_relations_pagination(tmp_path):
    """limit ja offset töötavad korrektselt."""
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    _setup_relation_data(state_dir)
    patches = _patch(tmp_path, state_dir=state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        first = get_work_relations(A_ID, limit=1, offset=0)
        second = get_work_relations(A_ID, limit=1, offset=1)
    assert len(first) == 1
    assert len(second) == 1
    assert first[0]["person_id"] != second[0]["person_id"]
