"""Seosetüüpide soovitused vahemälust (N19-03): avalik otspunkt ei parsi igal päringul kõiki kaarte."""
import json

from server.prosopography import relations, state


def _write(directory, pid, rel_type):
    path = directory / f"{pid}.json"
    path.write_text(json.dumps({"id": pid, "relations": [{"type": rel_type, "target_id": "x"}]}))
    return path


def test_vahemalu_ja_invalideerimine(tmp_path, monkeypatch):
    monkeypatch.setattr(state, "PROSOPOGRAPHY_DIR", str(tmp_path))
    monkeypatch.setattr(relations, "_type_suggestions_cache", {"sig": None, "value": []})
    _write(tmp_path, "p1", "abikaasa")

    parsed = []
    orig = relations._collect_relation_types
    monkeypatch.setattr(relations, "_collect_relation_types", lambda: parsed.append(1) or orig())

    assert [t["label"] for t in relations.get_relation_type_suggestions()] == ["abikaasa"]
    relations.get_relation_type_suggestions()
    assert len(parsed) == 1

    p2 = _write(tmp_path, "p2", "vend")
    assert [t["label"] for t in relations.get_relation_type_suggestions()] == ["abikaasa", "vend"]
    assert len(parsed) == 2
