"""Prosopograafia kõrvalkirjutuste git- ja tehniliste väljade regressioonitestid."""
import json
from pathlib import Path
from unittest.mock import MagicMock


def _person(person_id="vutt:Pabc123"):
    return {
        "id": person_id,
        "name": {"label": "Test Isik"},
        "identifiers": [{"scheme": "wikidata", "id": "Q1", "checked_at": None}],
        "image_url": None,
        "updated_at": "2026-01-01T00:00:00+00:00",
    }


def _configure_crud(monkeypatch, tmp_path, person):
    from server.prosopography import person_crud

    prosopo_dir = tmp_path / "prosopography"
    images_dir = tmp_path / "state-images"
    prosopo_dir.mkdir()
    path = prosopo_dir / "abc123.json"
    path.write_text(json.dumps(person), encoding="utf-8")

    monkeypatch.setattr(person_crud.state, "PROSOPOGRAPHY_DIR", str(prosopo_dir))
    monkeypatch.setattr(person_crud.state, "PROSOPOGRAPHY_IMAGES_DIR", str(images_dir))
    monkeypatch.setattr(person_crud, "sync_from_facade", lambda: None)
    monkeypatch.setattr(person_crud, "get_person", lambda _pid: json.loads(path.read_text()))
    monkeypatch.setattr(person_crud, "_indices", lambda: type("I", (), {
        "_update_index_entry": staticmethod(lambda _p: None),
        "_update_aliases_entry": staticmethod(lambda _p: None),
    })())
    return person_crud, path


def _saving_mock(path):
    def save(filepath, content, *_args, **_kwargs):
        Path(filepath).write_text(content, encoding="utf-8")
        return {"success": True, "commit_hash": "test"}
    return MagicMock(side_effect=save)


def test_image_metadata_changes_use_git(monkeypatch, tmp_path):
    crud, path = _configure_crud(monkeypatch, tmp_path, _person())
    save = _saving_mock(path)
    monkeypatch.setattr(crud.state, "save_with_git", save)

    result = crud.upload_person_image("vutt:Pabc123", b"jpeg", "image/jpeg", "editor")
    assert result["image_url"]
    assert save.call_count == 1
    assert "pildi lisamine" in save.call_args.kwargs["message"]

    result = crud.delete_person_image("vutt:Pabc123", "editor")
    assert result["image_url"] is None
    assert save.call_count == 2
    assert "pildi kustutamine" in save.call_args.kwargs["message"]


def test_enrichment_scheme_is_not_persisted(monkeypatch, tmp_path):
    crud, path = _configure_crud(monkeypatch, tmp_path, _person())
    save = _saving_mock(path)
    monkeypatch.setattr(crud.state, "save_with_git", save)

    result = crud.apply_enrichment(
        "vutt:Pabc123",
        {"biography": "Uus elulugu", "_enrichment_scheme": "wikidata"},
        "editor",
    )

    saved = json.loads(path.read_text())
    assert result["identifiers"][0]["checked_at"] is not None
    assert saved["biography"] == "Uus elulugu"
    assert "_enrichment_scheme" not in saved
