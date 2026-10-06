"""Upload-viisard kannab pealkirja tõlke, originaali ja tekkeviisi teosesse (ADR 0064).

Kolm kohta, millest iga üks võib välja vaikselt kaotada: loomine
(`create_upload`), sammu 3 PATCH (`update_upload_meta` allow-list) ja import
(`_metadata.json`).
"""
import json
import tempfile

import pytest

import server.upload_ops as upload_ops
import server.upload.state as upload_state


@pytest.fixture
def staging(monkeypatch):
    tmp = tempfile.mkdtemp()
    monkeypatch.setattr(upload_ops, 'UPLOADS_DIR', tmp)
    monkeypatch.setattr(upload_state, 'UPLOADS_DIR', tmp)
    return tmp


def test_loomine_kannab_valjad(staging):
    state = upload_ops.create_upload({
        'title': 'Kiri', 'year': '', 'slug': 'kiri',
        'title_en': 'Letter', 'title_devised': True,
    }, 'mf')
    meta = state['meta']
    assert meta['title_en'] == 'Letter'
    assert meta['title_devised'] is True


def test_patch_lubab_valjad(staging):
    uid = upload_ops.create_upload({'title': 'T', 'year': '1650', 'slug': 't'}, 'mf')['id']
    upload_ops.update_upload_meta(uid, {
        'title_en': 'Minutes', 'title_original': 'Protocollum', 'title_devised': True,
    })
    meta = upload_ops.get_upload(uid)['meta']
    assert (meta['title_en'], meta['title_original'], meta['title_devised']) == ('Minutes', 'Protocollum', True)


class _Sftp:
    def listdir(self, _path):
        return ["t_pg_001.jpg", "t_pg_001.txt"]

    def get(self, remote, local):
        with open(local, "w", encoding="utf-8") as f:
            f.write("tekst")

    def close(self):
        pass


def _impordi(tmp_path, monkeypatch, meta_lisa):
    import server.git_ops as git_ops
    import server.meilisearch_ops as meili_ops
    import server.prosopography.indices as prosopo_indices
    import server.prosopography.person_crud as person_crud

    uploads = tmp_path / "uploads"
    (uploads / "imp1" / "thumbs").mkdir(parents=True)
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setattr(upload_ops, "UPLOADS_DIR", str(uploads))
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(uploads))
    monkeypatch.setattr(upload_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(git_ops, "commit_new_work_to_git", lambda *a, **kw: True)
    monkeypatch.setattr(meili_ops, "sync_work_to_meilisearch", lambda slug: True)
    monkeypatch.setattr(person_crud, "ensure_prosopo_stubs", lambda metadata, username=None, work_id=None: {})
    monkeypatch.setattr(prosopo_indices, "update_person_to_works", lambda *a, **kw: None)
    monkeypatch.setattr(prosopo_indices, "update_work_collections", lambda *a, **kw: None)
    monkeypatch.setattr(upload_ops, "_ssh_rm_rf", lambda *a, **kw: None)
    monkeypatch.setattr(upload_ops, "close_ssh", lambda *a, **kw: None)
    monkeypatch.setattr(upload_ops, "_sftp_open", lambda uid: _Sftp())

    (uploads / "imp1" / "state.json").write_text(json.dumps({
        "id": "imp1", "status": "reviewing",
        "meta": {"title": "Kiri", "year": "1800", "slug": "t", "work_id": "wid123", **meta_lisa},
        "remote_staging_path": "AUTO-OCR/print/imp1",
        "remote_work_path": "AUTO-OCR/print/imp1/t",
        "files": [{"page": 1, "has_ocr": True, "deleted": False}],
    }), encoding="utf-8")
    upload_ops.import_as_work("imp1", username="admin")
    return json.loads((data_dir / "t" / "_metadata.json").read_text(encoding="utf-8"))


def test_import_kirjutab_valjad_teosesse(tmp_path, monkeypatch):
    meta = _impordi(tmp_path, monkeypatch, {
        "title_en": "Letter", "title_original": "Brief", "title_devised": True,
    })
    assert (meta["title_en"], meta["title_original"], meta["title_devised"]) == ("Letter", "Brief", True)


def test_import_ei_kirjuta_tuhje_ega_false(tmp_path, monkeypatch):
    meta = _impordi(tmp_path, monkeypatch, {"title_en": "", "title_original": None, "title_devised": False})
    assert not {"title_en", "title_original", "title_devised"} & meta.keys()
