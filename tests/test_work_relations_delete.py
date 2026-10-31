"""Seosed teose kustutamisel ja taastamisel (#701, ADR 0075)."""
import json
import shutil
import sys
import threading
from pathlib import Path

import pytest
from fastapi import BackgroundTasks, HTTPException
from git import Actor, Repo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import metadata_ops, work_relations, work_sets_access  # noqa: E402
from server.routers import admin  # noqa: E402
import server.git_ops as git_ops  # noqa: E402
import server.trash_ops as trash_ops  # noqa: E402

V = "isVersionOf"
ADMIN = {"username": "adm", "role": "admin"}


@pytest.fixture
def env(tmp_path, monkeypatch):
    dirs = {}
    for wid in ("w1", "w2", "w3"):
        d = tmp_path / f"teos-{wid}"
        d.mkdir()
        (d / "_metadata.json").write_text(json.dumps({"id": wid, "title": f"T {wid}"}), encoding="utf-8")
        (d / "p1.jpg").write_bytes(b"\xff\xd8")
        dirs[wid] = str(d)

    def find(wid):
        d = dirs.get(wid)
        return d if d and Path(d).exists() else None

    def fake_save(path, content, *a, additional_files=None, **k):
        from server.utils import atomic_write_text
        for p, c in [(path, content), *(additional_files or [])]:
            atomic_write_text(p, c)
        return {"success": True}

    for mod in (admin, work_relations, work_sets_access):
        monkeypatch.setattr(mod, "find_directory_by_id", find)
    monkeypatch.setattr(admin, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(metadata_ops, "save_with_git", fake_save)
    for name in ("sync_work_to_meilisearch", "sync_work_to_meilisearch_async",
                 "update_person_to_works", "update_work_collections", "update_work_facts"):
        monkeypatch.setattr(metadata_ops, name, lambda *a, **k: None)
    deleted_git = []
    monkeypatch.setattr(admin, "delete_work_from_git", lambda *a, **k: deleted_git.append(a))
    monkeypatch.setattr(admin, "delete_work_from_meilisearch", lambda wid: None)
    monkeypatch.setattr(admin, "build_work_id_cache", lambda: None)
    import server.prosopography.indices as indices
    import server.prosopography.work_relations_ops as wro
    monkeypatch.setattr(indices, "update_work_collections", lambda *a, **k: None)
    monkeypatch.setattr(wro, "remove_work_facts", lambda *a, **k: None)
    return {"dirs": dirs, "deleted_git": deleted_git}


def _rels(env, wid):
    return json.loads(Path(env["dirs"][wid], "_metadata.json").read_text()).get("relations")


def _link(a, b):
    work_relations.apply_relation_changes(a, [{"id": b, "rel_type": V}], [], "u")


def _delete(wid):
    return admin.admin_work_delete(wid, BackgroundTasks(), ADMIN)


def test_kustutus_eemaldab_vastaspoolte_seosed(env):
    _link("w1", "w2")
    _link("w2", "w3")
    assert _delete("w2") == {"status": "success"}
    assert not Path(env["dirs"]["w2"]).exists()
    assert _rels(env, "w1") is None and _rels(env, "w3") is None


def test_koristuse_viga_katkestab_kustutuse(env, monkeypatch):
    _link("w1", "w2")
    monkeypatch.setattr(metadata_ops, "save_with_git",
                        lambda *a, **k: {"success": False, "error": "x", "rolled_back": True})
    with pytest.raises(HTTPException) as e:
        _delete("w2")
    assert e.value.status_code == 500
    assert Path(env["dirs"]["w2"], "p1.jpg").exists()
    assert _rels(env, "w2") == [{"id": "w1", "rel_type": V}]
    assert env["deleted_git"] == []


def test_rmtree_viga_jatab_seosteta_teose(env, monkeypatch):
    _link("w1", "w2")

    def kukkuv(path, *a, **k):
        raise OSError("ketas")

    monkeypatch.setattr(admin.shutil, "rmtree", kukkuv)
    with pytest.raises(OSError):
        _delete("w2")
    assert Path(env["dirs"]["w2"], "_metadata.json").exists()
    assert _rels(env, "w2") is None and _rels(env, "w1") is None


def test_rippuv_siht_ei_blokeeri_kustutust(env):
    p = Path(env["dirs"]["w1"], "_metadata.json")
    meta = json.loads(p.read_text())
    meta["relations"] = [{"id": "kadunud", "rel_type": V}]
    p.write_text(json.dumps(meta))
    assert _delete("w1") == {"status": "success"}


@pytest.mark.parametrize("kord", range(10))
def test_samaaegne_lisamine_ja_kustutus(env, kord):
    errors = []

    def put():
        try:
            _link("w1", "w2")
        except work_relations.RelationError:
            pass  # w2 kadus enne kirjutust — lubatud tulemus
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    def delete():
        try:
            _delete("w2")
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    threads = [threading.Thread(target=put), threading.Thread(target=delete)]
    if kord % 2:
        threads.reverse()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert not Path(env["dirs"]["w2"]).exists()
    assert not any(r.get("id") == "w2" for r in (_rels(env, "w1") or []))


@pytest.fixture
def trash_repo(tmp_path, monkeypatch):
    repo = Repo.init(str(tmp_path))
    with repo.config_writer() as cw:
        cw.set_value("user", "name", "test").set_value("user", "email", "t@t")
    synced = []
    monkeypatch.setattr(trash_ops, "sync_work_to_meilisearch",
                        lambda slug: synced.append(json.loads((tmp_path / slug / "_metadata.json").read_text())))
    monkeypatch.setattr(trash_ops, "get_or_init_repo", lambda: repo)
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: repo)
    monkeypatch.setattr(git_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(trash_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(trash_ops, "TRASH_DIR", str(tmp_path / "._trash"))
    return repo, tmp_path, synced


def test_taastamine_eemaldab_seosed_ka_kui_eelmine_commit_neid_kannab(trash_repo):
    """Kaitse: kustutus ilma koristuseta (vana või käsitsi) → `<commit>^` kannab seost."""
    repo, base, synced = trash_repo
    folder = "1690-w2"
    (base / folder).mkdir()
    meta = {"id": "w2", "relations": [{"id": "w1", "rel_type": V}]}
    (base / folder / "_metadata.json").write_text(json.dumps(meta), encoding="utf-8")
    repo.index.add([f"{folder}/_metadata.json"])
    repo.index.commit("init")
    (base / "._trash" / "w2").mkdir(parents=True)
    repo.git.rm(f"{folder}/_metadata.json")
    actor = Actor("k", "k@vutt.local")
    repo.index.commit("Kustuta teos: T [w2]", author=actor, committer=actor)
    shutil.rmtree(base / folder, ignore_errors=True)

    res = trash_ops.restore_deleted_work("w2", username="taastaja")

    assert res["ok"] is True
    assert "relations" not in json.loads((base / folder / "_metadata.json").read_text())
    assert "relations" not in json.loads(repo.git.show(f"HEAD:{folder}/_metadata.json"))
    assert synced and "relations" not in synced[-1]
