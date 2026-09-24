"""Töökollektsioon upload-viisardis: valik elab upload'i olekus, liikmesus tekib impordil.

Valik tehakse sammus 1, aga teos sünnib alles impordil — vahepeal võib kasutaja
lehelt lahkuda. Seepärast rakendab liikmesuse SERVER impordi ajal, mitte klient.

Kaks lepingut:
  * Kogu, kuhu enam lisada ei saa (kustutatud, arhiveeritud, lagi täis), EI
    kukuta importi — teos on juba loodud ja git'i commititud. Vahelejäetu tuleb
    vastusesse (`work_sets_skipped`), mitte vaikselt logisse.
  * Valik EI jõua `_metadata.json`-i (ADR 0042: liikmesus elab ainult kogu failis).
"""
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.work_sets_ops as ops
from server import upload_ops
from server.upload import state as upload_state


@pytest.fixture
def work_sets(tmp_path, monkeypatch):
    kaust = tmp_path / "work_sets"
    monkeypatch.setattr(ops, "WORK_SETS_DIR", str(kaust))

    def fake_save(path, data, username, message=None):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        return {"success": True}

    monkeypatch.setattr(ops, "save_config_with_git", fake_save)
    return kaust


def _kogu(nimi, **muu):
    ws = ops.create_work_set({"et": nimi, "en": nimi}, None, "admin")
    if muu:
        ws.update(muu)
        ops._save(ws, "admin", "test")
    return ws["id"]


# --- abifunktsioon ------------------------------------------------------------

def test_lisab_teose_aktiivsetesse_kogudesse(work_sets):
    a, b = _kogu("A"), _kogu("B")

    skipped = ops.add_work_to_sets("wid1", [a, b], "admin")

    assert skipped == []
    assert ops.load_work_set(a)["works"] == ["wid1"]
    assert ops.load_work_set(b)["works"] == ["wid1"]


def test_kogu_mida_ei_saa_lisada_jaetakse_vahele_pohjusega(work_sets, monkeypatch):
    aktiivne = _kogu("Aktiivne")
    arhiiv = _kogu("Arhiiv", status="archived")
    tais = _kogu("Täis", works=["x1", "x2"])
    monkeypatch.setattr(ops, "WORK_SET_MAX_MEMBERS", 2)

    skipped = ops.add_work_to_sets(
        "wid1", [aktiivne, arhiiv, "ws_puudub", tais], "admin")

    assert ops.load_work_set(aktiivne)["works"] == ["wid1"]
    assert ops.load_work_set(arhiiv)["works"] == []
    assert ops.load_work_set(tais)["works"] == ["x1", "x2"]
    assert sorted((s["id"], s["reason"]) for s in skipped) == sorted([
        (arhiiv, "archived"), ("ws_puudub", "not_found"), (tais, "limit"),
    ])


def test_juba_liige_ei_ole_viga(work_sets):
    a = _kogu("A", works=["wid1"])
    assert ops.add_work_to_sets("wid1", [a], "admin") == []
    assert ops.load_work_set(a)["works"] == ["wid1"]


# --- upload'i olek ------------------------------------------------------------

@pytest.fixture
def staging(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_ops, "UPLOADS_DIR", str(tmp_path))
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(tmp_path))
    return tmp_path


def test_create_ja_patch_hoiavad_work_sets_valikut(staging):
    state = upload_ops.create_upload(
        {"title": "T", "year": "1700", "slug": "t", "work_sets": ["ws_a"]})
    assert state["meta"]["work_sets"] == ["ws_a"]

    assert upload_ops.update_upload_meta(state["id"], {"work_sets": ["ws_a", "ws_b"]})
    assert upload_ops.get_upload(state["id"])["meta"]["work_sets"] == ["ws_a", "ws_b"]


# --- import -------------------------------------------------------------------

class _Sftp:
    def listdir(self, _path):
        return ["t_pg_001.jpg", "t_pg_001.txt"]

    def get(self, remote, local):
        Path(local).write_text("OCR", encoding="utf-8")

    def close(self):
        pass


def _seadista_import(tmp_path, monkeypatch, work_sets_valik):
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
        "meta": {"title": "T", "year": "1700", "slug": "t", "work_id": "wid1",
                 "work_sets": work_sets_valik},
        "remote_staging_path": "AUTO-OCR/print/imp1",
        "remote_work_path": "AUTO-OCR/print/imp1/t",
        "files": [{"page": 1, "has_ocr": True, "deleted": False}],
    }), encoding="utf-8")
    return data_dir


def test_import_lisab_teose_valitud_kogudesse(tmp_path, monkeypatch, work_sets):
    a = _kogu("A")
    arhiiv = _kogu("Arhiiv", status="archived")
    data_dir = _seadista_import(tmp_path, monkeypatch, [a, arhiiv])

    res = upload_ops.import_as_work("imp1", username="admin")

    assert ops.load_work_set(a)["works"] == ["wid1"]
    assert res["work_sets_skipped"] == [{"id": arhiiv, "reason": "archived"}]
    meta = json.loads((data_dir / "t" / "_metadata.json").read_text(encoding="utf-8"))
    assert "work_sets" not in meta, "liikmesus ei tohi jõuda _metadata.json-i (ADR 0042)"


def test_import_ilma_valikuta_ei_lisa_valja(tmp_path, monkeypatch, work_sets):
    _seadista_import(tmp_path, monkeypatch, [])
    res = upload_ops.import_as_work("imp1", username="admin")
    assert "work_sets_skipped" not in res
