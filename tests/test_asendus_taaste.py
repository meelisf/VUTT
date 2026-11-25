"""Taastatav asendus (ADR 0089 p 3): taasteinfo, commit'i treiler, taastamine, käivitusaegne tuvastus.

- Praegune rollback (`git checkout old_head -- slug`) jättis alles uued, juba stage'itud
  failid.
- JPG-d on gitist väljas ning vana ja uus leht kasutavad sama failinime: taastamine
  tohib JPG kustutada ainult siis, kui tema vana vaste on prügikastis.
- Katkestuse järel otsustab kordus commit'i treileri `Upload: <id>` järgi.
"""
import json
from pathlib import Path

import pytest
from git import Repo

from server import replace_marker, upload_ops
from server.upload import replace_recovery
from test_replace_work_content import _KirjutavSftp, _setup_replace_files

SLUG = "teos"


def _repo_kahe_lehega(tmp_path):
    data = tmp_path / "data"
    work = data / SLUG
    work.mkdir(parents=True)
    repo = Repo.init(str(data))
    with repo.config_writer() as c:
        c.set_value("user", "name", "t").set_value("user", "email", "t@t.test")
    (work / "_metadata.json").write_text('{"id": "w1"}', encoding="utf-8")
    for n in (1, 2):
        (work / f"teos_pg_00{n}.txt").write_text(f"vana {n}", encoding="utf-8")
        (work / f"teos_pg_00{n}.json").write_text("{}", encoding="utf-8")
        (work / f"teos_pg_00{n}.jpg").write_bytes(f"vana jpg {n}".encode())
    repo.index.add([f"{SLUG}/{p.name}" for p in work.iterdir() if p.suffix in (".txt", ".json")])
    repo.index.commit("Algseis")
    trash = tmp_path / "trash"
    trash.mkdir()
    return repo, work, trash


def _progress(repo, trash, new_pages):
    return {
        "phase": "replacing",
        "old_head": repo.head.commit.hexsha,
        "trash_dir": str(trash),
        "old_jpgs": ["teos_pg_001.jpg", "teos_pg_002.jpg"],
        "new_files": [f"teos_pg_00{n}.{ext}" for n in new_pages for ext in ("jpg", "txt", "json")],
    }


def test_rollback_eemaldab_uued_stagetud_failid(tmp_path):
    repo, work, trash = _repo_kahe_lehega(tmp_path)
    progress = _progress(repo, trash, [1, 2, 3])
    # Asendus jõudis kuni `git add`-ini: vanad git rm, uued kirjutatud ja stage'itud.
    for n in (1, 2):
        (work / f"teos_pg_00{n}.jpg").rename(trash / f"teos_pg_00{n}.jpg")
    repo.index.remove([f"{SLUG}/teos_pg_00{n}.{e}" for n in (1, 2) for e in ("txt", "json")], working_tree=True)
    for n in (1, 2, 3):
        (work / f"teos_pg_00{n}.txt").write_text(f"uus {n}", encoding="utf-8")
        (work / f"teos_pg_00{n}.json").write_text('{"new": 1}', encoding="utf-8")
        (work / f"teos_pg_00{n}.jpg").write_bytes(b"uus jpg")
    repo.git.add(SLUG)

    replace_recovery.restore_replace(str(work), progress, repo)

    assert (work / "teos_pg_001.txt").read_text(encoding="utf-8") == "vana 1"
    assert not (work / "teos_pg_003.txt").exists()
    assert not (work / "teos_pg_003.json").exists()
    assert not (work / "teos_pg_003.jpg").exists()
    assert (work / "teos_pg_002.jpg").read_bytes() == b"vana jpg 2"
    # JPG-d on tootmises gitist väljas (`data/.gitignore`); jälgitavad failid on puhtad.
    assert not repo.is_dirty(index=True, working_tree=True, untracked_files=False, path=SLUG)
    assert not [f for f in repo.untracked_files if not f.endswith(".jpg")]


def test_jpg_katkestus_enne_liigutamist(tmp_path):
    repo, work, trash = _repo_kahe_lehega(tmp_path)
    replace_recovery.restore_replace(str(work), _progress(repo, trash, [1, 2]), repo)
    assert (work / "teos_pg_001.jpg").read_bytes() == b"vana jpg 1"
    assert (work / "teos_pg_002.jpg").read_bytes() == b"vana jpg 2"


def test_jpg_katkestus_liigutamise_keskel(tmp_path):
    repo, work, trash = _repo_kahe_lehega(tmp_path)
    (work / "teos_pg_001.jpg").rename(trash / "teos_pg_001.jpg")   # 1 liikus, 2 mitte
    replace_recovery.restore_replace(str(work), _progress(repo, trash, [1, 2]), repo)
    assert (work / "teos_pg_001.jpg").read_bytes() == b"vana jpg 1"
    assert (work / "teos_pg_002.jpg").read_bytes() == b"vana jpg 2"
    assert not (trash / "teos_pg_001.jpg").exists()


def test_taastamine_pikema_uue_lehestikuga(tmp_path):
    repo, work, trash = _repo_kahe_lehega(tmp_path)
    for n in (1, 2):
        (work / f"teos_pg_00{n}.jpg").rename(trash / f"teos_pg_00{n}.jpg")
    for n in (1, 2, 3):
        (work / f"teos_pg_00{n}.jpg").write_bytes(b"uus jpg")
        (work / f"teos_pg_00{n}.txt").write_text("uus", encoding="utf-8")
    replace_recovery.restore_replace(str(work), _progress(repo, trash, [1, 2, 3]), repo)
    assert sorted(p.name for p in work.glob("*.jpg")) == ["teos_pg_001.jpg", "teos_pg_002.jpg"]
    assert (work / "teos_pg_001.jpg").read_bytes() == b"vana jpg 1"
    assert not (work / "teos_pg_003.txt").exists()
    assert (work / "teos_pg_002.txt").read_text(encoding="utf-8") == "vana 2"


def _edukas_asendus_seadistus(tmp_path, monkeypatch):
    import server.git_ops as git_ops
    import server.meilisearch_ops as meili_ops
    from server.prosopography import relations

    upload_id, work_id, slug, work_dir, data_dir = _setup_replace_files(tmp_path, monkeypatch)
    repo = Repo.init(str(data_dir))
    with repo.config_writer() as c:
        c.set_value("user", "name", "t").set_value("user", "email", "t@t.test")
    repo.index.add([f"{slug}/_metadata.json", f"{slug}/vana-teos_pg_001.txt", f"{slug}/vana-teos_pg_001.json"])
    repo.index.commit("Algseis")
    monkeypatch.setattr(upload_ops, "_sftp_open",
                        lambda _u: _KirjutavSftp(["uus-teos_pg_001.jpg", "uus-teos_pg_001.txt"]))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: repo)
    monkeypatch.setattr(upload_ops, "_ssh_rm_rf", lambda *a: None)
    monkeypatch.setattr(upload_ops, "close_ssh", lambda *a: None)
    monkeypatch.setattr(relations, "refresh_work_mentions", lambda *a, **k: None)
    monkeypatch.setattr(meili_ops, "sync_work_to_meilisearch", lambda s: True)
    return upload_id, work_id, slug, work_dir, data_dir, repo


def _state(upload_id):
    return json.loads((Path(upload_ops.UPLOADS_DIR) / upload_id / "state.json").read_text(encoding="utf-8"))


def test_edukas_asendus_treiler_ja_mark_ara(tmp_path, monkeypatch):
    upload_id, work_id, slug, _wd, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    assert f"Upload: {upload_id}" in repo.head.commit.message
    assert replace_marker.read_marker(slug) is None
    assert _state(upload_id)["replace_progress"]["phase"] == "replaced"


def test_ebaonnestunud_asendus_taastab_ja_eemaldab_margi(tmp_path, monkeypatch):
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)

    class Katkine(_KirjutavSftp):
        def get(self, remote, local):
            if local.endswith(".txt"):
                raise FileNotFoundError(remote)
            super().get(remote, local)

    monkeypatch.setattr(upload_ops, "_sftp_open",
                        lambda _u: Katkine(["uus-teos_pg_001.jpg", "uus-teos_pg_001.txt"]))
    with pytest.raises(Exception):
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    assert replace_marker.read_marker(slug) is None
    assert "replace_progress" not in _state(upload_id)
    assert (work_dir / "vana-teos_pg_001.jpg").read_bytes() == b"vana jpg"
    assert (work_dir / "vana-teos_pg_001.txt").read_text(encoding="utf-8") == "vana tekst"


def test_katkestus_parast_commiti_tuvastatakse(tmp_path, monkeypatch):
    """Protsess suri pärast treileriga commit'i: märk alles, `phase == replacing`."""
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    old_head = repo.head.commit.hexsha
    (work_dir / "vana-teos_pg_001.txt").write_text("uus tekst", encoding="utf-8")
    repo.git.add(slug)
    repo.index.commit(f"Asenda sisu: {slug} ({work_id})\n\nUpload: {upload_id}")
    s = _state(upload_id)
    s["replace_progress"] = {"phase": "replacing", "old_head": old_head, "trash_dir": str(tmp_path / "t"),
                             "old_jpgs": [], "new_files": []}
    (Path(upload_ops.UPLOADS_DIR) / upload_id / "state.json").write_text(json.dumps(s), encoding="utf-8")
    replace_marker.write_marker(slug, upload_id)

    assert replace_recovery.recover(upload_id, slug) == "replaced"
    assert replace_marker.read_marker(slug) is None
    st = _state(upload_id)
    assert st["replace_progress"]["phase"] == "replaced"
    assert st["status"] == "imported"
    assert (work_dir / "vana-teos_pg_001.txt").read_text(encoding="utf-8") == "uus tekst"


def test_katkestus_enne_committi_taastatakse(tmp_path, monkeypatch):
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    trash = tmp_path / "t"
    trash.mkdir()
    (work_dir / "vana-teos_pg_001.jpg").rename(trash / "vana-teos_pg_001.jpg")
    (work_dir / "vana-teos_pg_001.jpg").write_bytes(b"uus")
    s = _state(upload_id)
    s["replace_progress"] = {"phase": "replacing", "old_head": repo.head.commit.hexsha, "trash_dir": str(trash),
                             "old_jpgs": ["vana-teos_pg_001.jpg"], "new_files": ["vana-teos_pg_001.jpg"]}
    (Path(upload_ops.UPLOADS_DIR) / upload_id / "state.json").write_text(json.dumps(s), encoding="utf-8")
    replace_marker.write_marker(slug, upload_id)

    assert replace_recovery.recover(upload_id, slug) == "restored"
    assert replace_marker.read_marker(slug) is None
    assert "replace_progress" not in _state(upload_id)
    assert (work_dir / "vana-teos_pg_001.jpg").read_bytes() == b"vana jpg"


def test_recover_all_kaivitusel(monkeypatch):
    kutsed = []
    monkeypatch.setattr(replace_marker, "list_markers",
                        lambda: [("a", {"upload_id": "u1"}), ("b", {"upload_id": "u2"})])
    monkeypatch.setattr(replace_recovery, "recover", lambda uid, slug: kutsed.append((uid, slug)) or "restored")
    replace_recovery.recover_all()
    assert kutsed == [("u1", "a"), ("u2", "b")]


def test_ootamatu_erind_ei_jata_teost_lukku(tmp_path, monkeypatch):
    """JPG liigutamise tõrge (väljaspool taasteteid) → vana seis taastatud, märk ära kohe,
    mitte alles serveri järgmisel käivitusel."""
    import shutil
    upload_id, work_id, slug, work_dir, _dd, _repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    orig_move = shutil.move
    kord = {"n": 0}

    def katkine_move(src, dst, *a, **k):
        kord["n"] += 1
        if kord["n"] == 1 and str(src).endswith(".jpg") and "._trash" in str(dst):
            raise OSError("ketas täis")
        return orig_move(src, dst, *a, **k)

    monkeypatch.setattr(upload_ops.shutil, "move", katkine_move)
    with pytest.raises(OSError):
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    assert replace_marker.read_marker(slug) is None
    assert "replace_progress" not in _state(upload_id)
    assert (work_dir / "vana-teos_pg_001.jpg").read_bytes() == b"vana jpg"


def test_jarelsammu_torge_ei_jata_teost_lukku(tmp_path, monkeypatch):
    """Commit tehtud, järelsamm kukub → märk ära, faas `replaced` (teos on uue lehestikuga)."""
    from server.prosopography import relations
    upload_id, work_id, slug, _wd, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    monkeypatch.setattr(relations, "refresh_work_mentions",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("katki")))
    with pytest.raises(RuntimeError):
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    assert replace_marker.read_marker(slug) is None
    assert _state(upload_id)["replace_progress"]["phase"] == "replaced"
    assert f"Upload: {upload_id}" in repo.head.commit.message


def test_recover_replaced_faasis_kordab_jarelsamme(tmp_path, monkeypatch):
    upload_id, work_id, slug, _wd, _dd, _repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    s = _state(upload_id)
    s["replace_progress"] = {"phase": "replaced", "old_head": "x", "trash_dir": "", "old_jpgs": [], "new_files": []}
    s["replace_work_id"] = work_id
    (Path(upload_ops.UPLOADS_DIR) / upload_id / "state.json").write_text(json.dumps(s), encoding="utf-8")
    replace_marker.write_marker(slug, upload_id)
    kutsed = []
    monkeypatch.setattr(upload_ops, "_after_replace_commit", lambda *a: kutsed.append(a) or None)
    assert replace_recovery.recover(upload_id, slug) == "replaced"
    assert kutsed and replace_marker.read_marker(slug) is None
