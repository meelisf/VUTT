# tests/test_reciprocal_ops.py
"""
Testid: sync_reciprocals vastab spec käitumisreeglitele.
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography.reciprocal_ops import sync_reciprocals

A_ID = "vutt:Paaaaa"
B_ID = "vutt:Pbbbbb"
C_ID = "vutt:Pccccc"
A_LABEL = "Andreas Berg"


def _write_person(prosopo_dir: Path, person_id: str, relations: list, label: str = "Test Isik") -> Path:
    nanoid = person_id.removeprefix("vutt:P")
    path = prosopo_dir / f"{nanoid}.json"
    data = {
        "id": person_id,
        "name": {"label": label},
        "relations": relations,
        "updated_at": "2026-01-01T00:00:00+00:00",
        "updated_by": "setup",
    }
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


def _read_person(prosopo_dir: Path, person_id: str) -> dict:
    nanoid = person_id.removeprefix("vutt:P")
    return json.loads((prosopo_dir / f"{nanoid}.json").read_text(encoding="utf-8"))


def _run(prosopo_dir: Path, old_relations: list, new_relations: list) -> list[str]:
    def fake_save(path, content, *_args, **_kwargs):
        Path(path).write_text(content, encoding="utf-8")
        return {"success": True, "commit_hash": "test"}

    with patch("server.prosopography.reciprocal_ops.PROSOPOGRAPHY_DIR", str(prosopo_dir)), \
         patch("server.prosopography.reciprocal_ops.save_with_git", side_effect=fake_save):
        return sync_reciprocals(A_ID, old_relations, new_relations, A_LABEL, "testuser")


# ── Reegel 1+2: ainult target_id-ga seosed, hulga-põhine diff ──────────────

def test_linked_relation_adds_reciprocal(tmp_path):
    """Uue target_id lisamisel lisatakse B-le vastasseos; updated_by uuendatakse."""
    _write_person(tmp_path, B_ID, [])
    synced = _run(tmp_path, old_relations=[], new_relations=[{"name": "B", "type": "õpetaja", "target_id": B_ID}])
    b = _read_person(tmp_path, B_ID)
    assert len(b["relations"]) == 1
    assert b["relations"][0]["target_id"] == A_ID
    assert b["relations"][0]["reciprocal_auto"] is True
    assert b["relations"][0]["type"] == ""
    assert b["relations"][0]["name"] == A_LABEL
    assert B_ID in synced
    assert b["updated_by"] == "testuser"
    assert b["updated_at"] != "2026-01-01T00:00:00+00:00"  # timestamp uuendati


def test_unlinked_relation_ignored(tmp_path):
    """Ilma target_id-ta seos ei käivita sync'i."""
    _write_person(tmp_path, B_ID, [])
    synced = _run(tmp_path, old_relations=[], new_relations=[{"name": "Keegi", "type": "", "target_id": None}])
    b = _read_person(tmp_path, B_ID)
    assert b["relations"] == []
    assert synced == []


# ── Reegel 3: idempotentsus ────────────────────────────────────────────────

def test_existing_relation_not_duplicated(tmp_path):
    """Kui B-l on juba seos A-ga, ei lisata duplikaati."""
    _write_person(tmp_path, B_ID, [{"name": A_LABEL, "type": "", "target_id": A_ID, "reciprocal_auto": True}])
    _run(tmp_path, old_relations=[], new_relations=[{"name": "B", "type": "kolleeg", "target_id": B_ID}])
    b = _read_person(tmp_path, B_ID)
    assert len(b["relations"]) == 1  # ei lisatu duplikaati


def test_manual_relation_to_a_blocks_auto_add(tmp_path):
    """Kui B-l on käsitsi seos A-ga (target_id olemas), ei lisata auto-seost."""
    _write_person(tmp_path, B_ID, [{"name": A_LABEL, "type": "sõber", "target_id": A_ID}])
    _run(tmp_path, old_relations=[], new_relations=[{"name": "B", "type": "kolleeg", "target_id": B_ID}])
    b = _read_person(tmp_path, B_ID)
    assert len(b["relations"]) == 1
    assert b["relations"][0]["type"] == "sõber"  # käsitsi seos puutumata


# ── Reegel 4: eemaldamine ainult reciprocal_auto read ─────────────────────

def test_removal_removes_reciprocal_auto_row(tmp_path):
    """Seose eemaldamisel eemaldatakse B-lt reciprocal_auto rida."""
    _write_person(tmp_path, B_ID, [{"name": A_LABEL, "type": "", "target_id": A_ID, "reciprocal_auto": True}])
    synced = _run(tmp_path, old_relations=[{"name": "B", "type": "", "target_id": B_ID}], new_relations=[])
    b = _read_person(tmp_path, B_ID)
    assert b["relations"] == []
    assert B_ID in synced


def test_removal_keeps_manual_row(tmp_path):
    """Seose eemaldamisel jääb B-le käsitsi lisatud seos A-ga puutumata."""
    _write_person(tmp_path, B_ID, [{"name": A_LABEL, "type": "mentor", "target_id": A_ID}])
    _run(tmp_path, old_relations=[{"name": "B", "type": "", "target_id": B_ID}], new_relations=[])
    b = _read_person(tmp_path, B_ID)
    assert len(b["relations"]) == 1
    assert b["relations"][0]["type"] == "mentor"  # käsitsi seos puutumata


# ── Reegel 2: hulga-diff — mitu seost sama B-ga ───────────────────────────

def test_multi_edge_partial_removal_keeps_reciprocal(tmp_path):
    """A-l on B-ga kaks seost. Ühe eemaldamisel jääb B vastasseos alles."""
    _write_person(tmp_path, B_ID, [{"name": A_LABEL, "type": "", "target_id": A_ID, "reciprocal_auto": True}])
    old_rels = [
        {"name": "B", "type": "õpetaja", "target_id": B_ID},
        {"name": "B", "type": "kolleeg", "target_id": B_ID},
    ]
    new_rels = [{"name": "B", "type": "õpetaja", "target_id": B_ID}]  # "kolleeg" eemaldati
    _run(tmp_path, old_relations=old_rels, new_relations=new_rels)
    b = _read_person(tmp_path, B_ID)
    assert len(b["relations"]) == 1  # vastasseos jääb alles


# ── Reegel 4 kombinatsioon: auto + käsitsi rida samal ajal ───────────────

def test_removal_with_both_auto_and_manual_rows(tmp_path):
    """B-l on korraga auto-rida JA käsitsi rida A-ga. A eemaldab seose.
    Auto-rida kustutatakse, käsitsi rida jääb alles."""
    _write_person(tmp_path, B_ID, [
        {"name": A_LABEL, "type": "", "target_id": A_ID, "reciprocal_auto": True},
        {"name": A_LABEL, "type": "sõber", "target_id": A_ID},  # käsitsi, ilma reciprocal_auto
    ])
    _run(tmp_path, old_relations=[{"name": "B", "type": "", "target_id": B_ID}], new_relations=[])
    b = _read_person(tmp_path, B_ID)
    assert len(b["relations"]) == 1
    assert b["relations"][0]["type"] == "sõber"
    assert "reciprocal_auto" not in b["relations"][0]


# ── Servajuhud ─────────────────────────────────────────────────────────────

def test_b_not_found_skipped_gracefully(tmp_path):
    """B faili puudumisel ei krahhita."""
    # B faili ei looda — peaks sujuvalt vahele jätma
    synced = _run(tmp_path, old_relations=[], new_relations=[{"name": "B", "type": "", "target_id": B_ID}])
    assert synced == []


def test_returns_synced_ids(tmp_path):
    """Tagastab edukalt uuendatud B ID-de nimekirja."""
    _write_person(tmp_path, B_ID, [])
    _write_person(tmp_path, C_ID, [])
    synced = _run(
        tmp_path,
        old_relations=[],
        new_relations=[
            {"name": "B", "type": "", "target_id": B_ID},
            {"name": "C", "type": "", "target_id": C_ID},
        ],
    )
    assert set(synced) == {B_ID, C_ID}
