# tests/test_exemplar_images_lifecycle.py
"""Eksemplari ja teose kustutus/taastamine eksemplari piltidega (ADR 0079 tagajärjed)."""
import io
import os

import pytest
from PIL import Image

from server import exemplar_images as ei
from server import work_exemplars as we


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (30, 20), (1, 2, 3)).save(buf, "PNG")
    return buf.getvalue()


def _tracked(env) -> list[str]:
    return env["repo"].git.ls_files().splitlines()


def _commits(env) -> int:
    return len(list(env["repo"].iter_commits()))


@pytest.fixture
def env(exemplar_work):
    m = ei.add_uploads(exemplar_work["work_dir"], exemplar_work["eid"], [(_png(), {"kind": "photo"})], "u")
    exemplar_work["image"] = m["images"][0]
    return exemplar_work


def test_eksemplari_kustutus_eemaldab_manifesti_gitist(env):
    rel = f"1640-test-w1/_exemplars/{env['eid']}/images.json"
    assert rel in _tracked(env)
    we.delete_exemplar(env["work_dir"], env["eid"], "u")
    assert rel not in _tracked(env)
    assert not os.path.exists(ei.manifest_path(env["work_dir"], env["eid"]))
    trash = env["data"] / "._trash" / "w1" / "_exemplars" / env["eid"]
    img = env["image"]
    assert (trash / f"{img['id']}.jpg").exists() and (trash / img["original"]).exists()
    assert not env["repo"].is_dirty(untracked_files=False)


def test_eksemplari_kustutus_ilma_piltideta_ei_tee_lisacommiti(exemplar_work):
    before = _commits(exemplar_work)
    we.delete_exemplar(exemplar_work["work_dir"], exemplar_work["eid"], "u")
    assert _commits(exemplar_work) == before + 1


def test_teose_kustutus_ja_taastamine_sailitab_eksemplaripildid(env, monkeypatch):
    from fastapi import BackgroundTasks
    from server import trash_ops, utils
    from server.routers import admin

    img = env["image"]
    d = ei.exemplar_dir(env["work_dir"], env["eid"])
    # Kustutatud pilt prügikastis ei tohi taastamisel orvuna tagasi tulla.
    orphan_trash = env["data"] / "._trash" / "w1" / "_exemplars" / env["eid"]
    orphan_trash.mkdir(parents=True)
    (orphan_trash / "zzzzzz.jpg").write_bytes(b"x")

    monkeypatch.setattr(admin, "BASE_DIR", str(env["data"]))
    monkeypatch.setattr(admin, "find_directory_by_id", lambda wid: env["work_dir"] if wid == "w1" else None)
    for name in ("delete_work_from_meilisearch", "build_work_id_cache"):
        monkeypatch.setattr(admin, name, lambda *a, **k: None)
    monkeypatch.setattr("server.work_relations.cleanup_for_deletion", lambda *a, **k: None)
    monkeypatch.setattr("server.prosopography.indices.update_work_collections", lambda *a, **k: None)
    monkeypatch.setattr("server.prosopography.work_relations_ops.remove_work_facts", lambda *a, **k: None)
    admin.admin_work_delete("w1", BackgroundTasks(), user={"username": "u", "role": "admin"})
    assert not os.path.exists(env["work_dir"])

    monkeypatch.setattr(trash_ops, "BASE_DIR", str(env["data"]))
    monkeypatch.setattr(trash_ops, "TRASH_DIR", str(env["data"] / "._trash"))
    monkeypatch.setattr(trash_ops, "sync_work_to_meilisearch", lambda *a, **k: None)
    monkeypatch.setattr(trash_ops, "refresh_work_mentions", lambda *a, **k: None)
    monkeypatch.setattr(utils, "WORK_ID_CACHE", {})
    res = trash_ops.restore_deleted_work("w1", "u")
    assert res["ok"], res
    assert os.path.exists(os.path.join(d, f"{img['id']}.jpg"))
    assert os.path.exists(os.path.join(d, img["original"]))
    assert not os.path.exists(os.path.join(d, "zzzzzz.jpg"))
    assert ei.read_manifest(env["work_dir"], env["eid"])["images"][0]["id"] == img["id"]
