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
