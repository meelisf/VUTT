"""Isikute liitmine teostes (#615): juurväljad bulk_update_works kaudu, osad work_parts kaudu."""
import json
from unittest.mock import MagicMock, patch

from server.prosopography import merge_ops


def _kaart(pid, label, **extra):
    return {"id": pid, "name": {"label": label}, "record_status": "draft",
            "updated_at": "2024-01-01T00:00:00+00:00", "relations": [], "identifiers": [],
            **extra}


def _teos(tmp_path):
    d = tmp_path / "data" / "slug-w1"
    d.mkdir(parents=True)
    for i in (1, 2):
        (d / f"t-00{i}.jpg").write_bytes(b"x")
    (d / "_metadata.json").write_text(json.dumps({
        "id": "w1", "title": "Epistolae",
        "creators": [{"id": "vutt:Psrc", "label": "Allikas", "name": "Allikas", "role": "auctor"}],
        "tags": [{"id": "vutt:Psrc", "label": "Allikas"}],
        "parts": [{"id": "p1", "kind": "letter", "title": "Kiri", "pages": ["t-001"],
                   "creators": [{"id": "vutt:Psrc", "name": "Allikas", "role": "auctor"},
                                {"name": "Keegi", "role": "addressee"}]}],
    }), encoding="utf-8")
    return d


def test_liitmine_seob_teose_ja_osade_loojad_sihtkaardiga(tmp_path, monkeypatch):
    from server import metadata_ops
    from server.prosopography import relations
    work = _teos(tmp_path)
    kaardid = {"vutt:Psrc": _kaart("vutt:Psrc", "Allikas"), "vutt:Ptgt": _kaart("vutt:Ptgt", "Sihtmärk")}

    def fake_save(path, content, *a, additional_files=None, **k):
        from server.utils import atomic_write_text
        atomic_write_text(path, content)
        for p, c in additional_files or []:
            atomic_write_text(p, c)
        return {"success": True}
    commits = []
    monkeypatch.setattr(metadata_ops, "save_with_git",
                        lambda *a, **k: (commits.append(k.get("message")), fake_save(*a, **k))[1])
    for name in ("update_person_to_works", "update_work_collections", "update_work_facts"):
        monkeypatch.setattr(metadata_ops, name, lambda *a, **k: None)
    meili = []
    monkeypatch.setattr(metadata_ops, "sync_work_to_meilisearch", lambda *a, **k: meili.append(a))
    monkeypatch.setattr(metadata_ops, "sync_work_to_meilisearch_async", lambda *a, **k: meili.append(a))
    monkeypatch.setattr(relations, "update_page_person_mentions", lambda *a, **k: None)

    with patch("server.config.BASE_DIR", str(tmp_path / "data")), \
         patch("server.prosopography.ops.PROSOPOGRAPHY_DIR", str(tmp_path)), \
         patch("server.prosopography.ops.save_with_git", MagicMock(return_value={"success": True})), \
         patch("server.prosopography.ops._update_index_entry"), \
         patch("server.prosopography.ops._update_aliases_entry"), \
         patch("server.prosopography.ops._remove_aliases_entry"), \
         patch("server.prosopography.ops.atomic_write_json"), \
         patch("server.prosopography.ops._glob.glob", return_value=[]), \
         patch("server.prosopography.ops._load_index", return_value={"entries": []}), \
         patch.object(merge_ops, "rebuild_indices"), \
         patch("server.prosopography.ops.get_person", side_effect=lambda pid: kaardid.get(pid)), \
         patch.object(merge_ops, "get_person", side_effect=lambda pid: kaardid.get(pid)):
        merge_ops.merge_person("vutt:Psrc", "vutt:Ptgt", "admin")

    meta = json.loads((work / "_metadata.json").read_text())
    assert meta["creators"][0] == {"id": "vutt:Ptgt", "label": "Sihtmärk", "name": "Sihtmärk", "role": "auctor"}
    assert meta["tags"][0]["id"] == "vutt:Ptgt"
    looja = meta["parts"][0]["creators"]
    assert looja[0] == {"id": "vutt:Ptgt", "name": "Sihtmärk", "role": "auctor"}
    assert looja[1] == {"name": "Keegi", "role": "addressee"}
    assert any("liitmine teostes" in (m or "") for m in commits)
    assert any("liitmine osades" in (m or "") for m in commits)
    assert meili, "muutunud teos peab Meili sünki saama"
