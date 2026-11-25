"""Taastatav asendus (ADR 0089 p 3, täiendus 2026-11-25).

Mudel: vanad lehefailid liiguvad prügikasti (rename) ja taastamine toob need sealt
tagasi — kettal olev seis, mitte git. Ühist indeksit puudutatakse alles lõplikus
commit'is; taastamine viib teose kausta indeksi HEAD-ile. Katkestuse järel otsustab
kordus commit'i treileri `Upload: <id>` järgi; käivitusaegne taaste jookseb enne päringuid.
"""
import json
from pathlib import Path

import pytest
from git import Repo

from server import replace_marker, upload_ops
from server.upload import replace_recovery
from test_replace_work_content import _KirjutavSftp, _setup_replace_files

SLUG = "teos"
OLD = [f"teos_pg_00{n}.{e}" for n in (1, 2) for e in ("jpg", "json", "txt")]


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
        "old_files": list(OLD),
        "new_files": [f"teos_pg_00{n}.{ext}" for n in new_pages for ext in ("jpg", "txt", "json")],
    }


def _vii_prugikasti(work, trash, names=OLD):
    for n in names:
        (work / n).rename(trash / n)


def test_rollback_eemaldab_uued_stagetud_failid(tmp_path):
    """Asendus jõudis lõpliku commit'i `git add`-ini: uued stage'itud → indeks HEAD-ile, vanad tagasi."""
    repo, work, trash = _repo_kahe_lehega(tmp_path)
    progress = _progress(repo, trash, [1, 2, 3])
    _vii_prugikasti(work, trash)
    for n in (1, 2, 3):
        (work / f"teos_pg_00{n}.txt").write_text(f"uus {n}", encoding="utf-8")
        (work / f"teos_pg_00{n}.json").write_text('{"new": 1}', encoding="utf-8")
        (work / f"teos_pg_00{n}.jpg").write_bytes(b"uus jpg")
    repo.git.add("-A", "--", SLUG)

    replace_recovery.restore_replace(str(work), progress, repo)

    assert (work / "teos_pg_001.txt").read_text(encoding="utf-8") == "vana 1"
    assert not (work / "teos_pg_003.txt").exists()
    assert not (work / "teos_pg_003.jpg").exists()
    assert (work / "teos_pg_002.jpg").read_bytes() == b"vana jpg 2"
    assert repo.git.diff("--cached", "--name-only", "--", SLUG).strip() == ""
    assert not repo.is_dirty(index=True, working_tree=True, untracked_files=False, path=SLUG)


def test_katkestus_enne_liigutamist(tmp_path):
    repo, work, trash = _repo_kahe_lehega(tmp_path)
    replace_recovery.restore_replace(str(work), _progress(repo, trash, [1, 2]), repo)
    assert (work / "teos_pg_001.jpg").read_bytes() == b"vana jpg 1"
    assert (work / "teos_pg_002.txt").read_text(encoding="utf-8") == "vana 2"


def test_katkestus_liigutamise_keskel(tmp_path):
    repo, work, trash = _repo_kahe_lehega(tmp_path)
    _vii_prugikasti(work, trash, ["teos_pg_001.jpg", "teos_pg_001.txt"])   # osa liikus
    replace_recovery.restore_replace(str(work), _progress(repo, trash, [1, 2]), repo)
    assert (work / "teos_pg_001.jpg").read_bytes() == b"vana jpg 1"
    assert (work / "teos_pg_001.txt").read_text(encoding="utf-8") == "vana 1"
    assert (work / "teos_pg_002.jpg").read_bytes() == b"vana jpg 2"
    assert not (trash / "teos_pg_001.jpg").exists()


def test_taastamine_pikema_uue_lehestikuga(tmp_path):
    repo, work, trash = _repo_kahe_lehega(tmp_path)
    _vii_prugikasti(work, trash)
    for n in (1, 2, 3):
        (work / f"teos_pg_00{n}.jpg").write_bytes(b"uus jpg")
        (work / f"teos_pg_00{n}.txt").write_text("uus", encoding="utf-8")
    replace_recovery.restore_replace(str(work), _progress(repo, trash, [1, 2, 3]), repo)
    assert sorted(p.name for p in work.glob("*.jpg")) == ["teos_pg_001.jpg", "teos_pg_002.jpg"]
    assert not (work / "teos_pg_003.txt").exists()
    assert (work / "teos_pg_002.txt").read_text(encoding="utf-8") == "vana 2"


def test_taaste_hoiab_commitimata_teksti(tmp_path):
    """(3. voor, 3) Kettal salvestatud, aga commitimata tekst jääb rollback'is alles."""
    repo, work, trash = _repo_kahe_lehega(tmp_path)
    (work / "teos_pg_001.txt").write_text("salvestatud, commit ebaõnnestus", encoding="utf-8")
    _vii_prugikasti(work, trash)
    replace_recovery.restore_replace(str(work), _progress(repo, trash, [1, 2]), repo)
    assert (work / "teos_pg_001.txt").read_text(encoding="utf-8") == "salvestatud, commit ebaõnnestus"


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
                             "old_files": [], "new_files": []}
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
                             "old_files": ["vana-teos_pg_001.jpg"], "new_files": ["vana-teos_pg_001.jpg"]}
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
    with pytest.raises(Exception):
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
    s["replace_progress"] = {"phase": "replaced", "old_head": "x", "trash_dir": "", "old_files": [], "new_files": []}
    s["replace_work_id"] = work_id
    (Path(upload_ops.UPLOADS_DIR) / upload_id / "state.json").write_text(json.dumps(s), encoding="utf-8")
    replace_marker.write_marker(slug, upload_id)
    kutsed = []
    monkeypatch.setattr(upload_ops, "_after_replace_commit", lambda *a, **k: kutsed.append(a) or None)
    assert replace_recovery.recover(upload_id, slug) == "replaced"
    assert kutsed and replace_marker.read_marker(slug) is None


# ── Ülevaatus PR #881 ─────────────────────────────────────────────────────────

def test_commit_torge_taastab_ja_kukub(tmp_path, monkeypatch):
    """(1) Commit'i erind ei ole edu: vana seis tagasi, 500, märk ja taasteinfo ära."""
    from fastapi import HTTPException
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    _katkine_git_kasklus(monkeypatch, repo, "commit")
    with pytest.raises(HTTPException) as exc:
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    assert exc.value.status_code == 500
    assert (work_dir / "vana-teos_pg_001.txt").read_text(encoding="utf-8") == "vana tekst"
    assert (work_dir / "vana-teos_pg_001.jpg").read_bytes() == b"vana jpg"
    assert replace_marker.read_marker(slug) is None
    assert _state(upload_id).get("status") != "imported"


def test_ebaonnestunud_taaste_jatab_margi_ja_taasteinfo(tmp_path, monkeypatch):
    """(2) Taastamise tõrge ei tohi kirjutuskaitset ega taasteinfot eemaldada."""
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)

    class Katkine(_KirjutavSftp):
        def get(self, remote, local):
            if local.endswith(".txt"):
                raise FileNotFoundError(remote)
            super().get(remote, local)

    monkeypatch.setattr(upload_ops, "_sftp_open", lambda _u: Katkine(["uus-teos_pg_001.jpg", "uus-teos_pg_001.txt"]))
    _katkine_git_kasklus(monkeypatch, repo, "reset")
    with pytest.raises(Exception):
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    assert replace_marker.read_marker(slug) is not None
    assert (replace_marker.read_marker(slug) or {}).get("progress", {}).get("phase") == "replacing"


def test_recover_ebaonnestunud_taastega_jatab_margi(tmp_path, monkeypatch):
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    progress = {"phase": "replacing", "old_head": repo.head.commit.hexsha, "trash_dir": str(tmp_path / "t"),
                "old_files": [], "new_files": []}
    replace_marker.write_marker(slug, upload_id, progress)
    monkeypatch.setattr(replace_recovery, "restore_replace",
                        lambda *a, **k: (_ for _ in ()).throw(replace_recovery.RestoreError("katki")))
    assert replace_recovery.recover(upload_id, slug) == "restore_failed"
    assert replace_marker.read_marker(slug) is not None


def test_taasteinfo_elab_margis_ka_ilma_state_ita(tmp_path, monkeypatch):
    """(3) Taasteinfo koopia märgis: üleslaadimise kausta kadumine ei hävita taastet."""
    import shutil
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    trash = tmp_path / "t"
    trash.mkdir()
    for n in ("vana-teos_pg_001.jpg", "vana-teos_pg_001.txt", "vana-teos_pg_001.json"):
        (work_dir / n).rename(trash / n)
    progress = {"phase": "replacing", "old_head": repo.head.commit.hexsha, "trash_dir": str(trash),
                "old_files": ["vana-teos_pg_001.jpg", "vana-teos_pg_001.json", "vana-teos_pg_001.txt"],
                "new_files": []}
    replace_marker.write_marker(slug, upload_id, progress)
    shutil.rmtree(Path(upload_ops.UPLOADS_DIR) / upload_id)
    assert replace_recovery.recover(upload_id, slug) == "restored"
    assert (work_dir / "vana-teos_pg_001.txt").read_text(encoding="utf-8") == "vana tekst"
    assert (work_dir / "vana-teos_pg_001.jpg").read_bytes() == b"vana jpg"
    assert replace_marker.read_marker(slug) is None


def test_tuhistamine_asenduse_ajal_409(client, login, tmp_path, monkeypatch):
    upload_id, work_id, slug, *_ = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    replace_marker.write_marker(slug, upload_id, {"phase": "replacing"})
    token = login("admin", "adminpass")
    r = client.delete(f"/admin/upload/{upload_id}", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 409
    assert (Path(upload_ops.UPLOADS_DIR) / upload_id / "state.json").exists()


def test_asendus_ei_jata_kustutusi_uhisesse_indeksisse(tmp_path, monkeypatch):
    """(4) Allalaadimise ajal ei tohi indeksis olla asenduse kustutusi — teise teose
    `repo.index.commit` commitiks need kaasa."""
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    staged = []

    class Vaatlev(_KirjutavSftp):
        def get(self, remote, local):
            staged.append(repo.git.diff("--cached", "--name-only"))
            super().get(remote, local)

    monkeypatch.setattr(upload_ops, "_sftp_open", lambda _u: Vaatlev(["uus-teos_pg_001.jpg", "uus-teos_pg_001.txt"]))
    upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    assert staged and all(s.strip() == "" for s in staged), staged


def test_taastepunkt_on_lehelukkude_jarel(tmp_path, monkeypatch):
    """(5) Salvestus, mis hoidis lehelukku asenduse alguses, jääb pärast rollback'i alles."""
    import threading
    import time
    from server.page_locks import page_lock
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    txt = work_dir / "vana-teos_pg_001.txt"
    hoiab, valmis = threading.Event(), threading.Event()

    def salvestaja():
        with page_lock(str(txt)):
            hoiab.set()
            time.sleep(0.3)
            txt.write_text("salvestatud vahepeal", encoding="utf-8")
            repo.index.add([f"{slug}/vana-teos_pg_001.txt"])
            repo.index.commit("Salvestus")
        valmis.set()

    class Katkine(_KirjutavSftp):
        def get(self, remote, local):
            raise FileNotFoundError(remote)

    monkeypatch.setattr(upload_ops, "_sftp_open", lambda _u: Katkine(["uus-teos_pg_001.jpg", "uus-teos_pg_001.txt"]))
    t = threading.Thread(target=salvestaja)
    t.start()
    hoiab.wait(5)
    with pytest.raises(Exception):
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    t.join(5)
    assert txt.read_text(encoding="utf-8") == "salvestatud vahepeal"


def test_taaste_ei_puutu_vahepeal_salvestatud_metaandmeid(tmp_path, monkeypatch):
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    meta = work_dir / "_metadata.json"

    class Katkine(_KirjutavSftp):
        def get(self, remote, local):
            meta.write_text(json.dumps({"id": work_id, "title": "Uus pealkiri"}), encoding="utf-8")
            repo.index.add([f"{slug}/_metadata.json"])
            repo.index.commit("Metaandmed")
            raise FileNotFoundError(remote)

    monkeypatch.setattr(upload_ops, "_sftp_open", lambda _u: Katkine(["uus-teos_pg_001.jpg", "uus-teos_pg_001.txt"]))
    with pytest.raises(Exception):
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    assert json.loads(meta.read_text(encoding="utf-8"))["title"] == "Uus pealkiri"
    assert (work_dir / "vana-teos_pg_001.txt").read_text(encoding="utf-8") == "vana tekst"


# ── Ülevaatus PR #881, 2. voor ────────────────────────────────────────────────

def _katkine_git_kasklus(monkeypatch, repo, kasklus):
    real_git = repo.git

    class KatkineGit:
        def __getattr__(self, name):
            if name == kasklus:
                return lambda *a, **k: (_ for _ in ()).throw(RuntimeError(f"{kasklus} katki"))
            return getattr(real_git, name)

    monkeypatch.setattr(repo, "git", KatkineGit(), raising=False)


def test_commit_torge_puhastab_indeksi_luku_all(tmp_path, monkeypatch):
    """(2) Commit'i tõrke järel ei tohi asenduse muudatusi ühisesse indeksisse jääda."""
    from fastapi import HTTPException
    upload_id, work_id, slug, work_dir, data_dir, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    real_git = repo.git
    _katkine_git_kasklus(monkeypatch, repo, "commit")
    with pytest.raises(HTTPException):
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    assert real_git.diff("--cached", "--name-only", "--", slug).strip() == ""
    assert (work_dir / "vana-teos_pg_001.txt").read_text(encoding="utf-8") == "vana tekst"


def test_commit_ei_vota_teise_teose_indeksit_kaasa(tmp_path, monkeypatch):
    """(2) Asenduse commit sisaldab ainult asendatava teose faile."""
    upload_id, work_id, slug, work_dir, data_dir, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    teine = data_dir / "teine-teos"
    teine.mkdir()
    (teine / "x.txt").write_text("teise teose pooleli muudatus", encoding="utf-8")
    repo.index.add(["teine-teos/x.txt"])
    upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    commit = next(c for c in repo.iter_commits() if f"Upload: {upload_id}" in c.message)
    assert all(f.startswith(f"{slug}/") for f in commit.stats.files), list(commit.stats.files)
    assert "teine-teos/x.txt" in repo.git.diff("--cached", "--name-only")


def test_korduskatse_taastab_enne_poolelioleva_asenduse(tmp_path, monkeypatch):
    """(1) Sama üleslaadimise korduskatse ei tohi poolelioleva asenduse taasteinfot üle kirjutada."""
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    trash = tmp_path / "t"
    trash.mkdir()
    # Esimene katse suri pärast vanade failide eemaldamist.
    for n in ("vana-teos_pg_001.jpg", "vana-teos_pg_001.txt", "vana-teos_pg_001.json"):
        (work_dir / n).rename(trash / n)
    replace_marker.write_marker(slug, upload_id, {
        "phase": "replacing", "old_head": repo.head.commit.hexsha, "trash_dir": str(trash),
        "old_files": ["vana-teos_pg_001.jpg", "vana-teos_pg_001.json", "vana-teos_pg_001.txt"],
        "new_files": []})

    class Katkine(_KirjutavSftp):
        def get(self, remote, local):
            raise FileNotFoundError(remote)

    monkeypatch.setattr(upload_ops, "_sftp_open", lambda _u: Katkine(["uus-teos_pg_001.jpg", "uus-teos_pg_001.txt"]))
    with pytest.raises(Exception):
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    assert (work_dir / "vana-teos_pg_001.txt").read_text(encoding="utf-8") == "vana tekst"
    assert (work_dir / "vana-teos_pg_001.jpg").read_bytes() == b"vana jpg"
    assert replace_marker.read_marker(slug) is None


def test_ajaloo_lugemisviga_ei_kaivita_rollbacki(tmp_path, monkeypatch):
    """(3) Kui commit'i olemasolu jääb ebaselgeks, jäävad märk ja taasteinfo; faile ei puudutata."""
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    replace_marker.write_marker(slug, upload_id, {
        "phase": "replacing", "old_head": repo.head.commit.hexsha, "trash_dir": str(tmp_path / "t"),
        "old_files": [], "new_files": []})
    (work_dir / "vana-teos_pg_001.txt").write_text("uus, juba commititud", encoding="utf-8")
    monkeypatch.setattr(type(repo), "iter_commits", lambda *a, **k: (_ for _ in ()).throw(OSError("pack katki")))
    assert replace_recovery.recover(upload_id, slug) == "commit_unknown"
    assert replace_marker.read_marker(slug) is not None
    assert (work_dir / "vana-teos_pg_001.txt").read_text(encoding="utf-8") == "uus, juba commititud"


def test_taaste_rakendab_uleslaadimise_metaandmed(tmp_path, monkeypatch):
    """(4) Pärast lehestiku commit'i katkenud asendus: taaste rakendab ka metaandmed."""
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    old_head = repo.head.commit.hexsha
    (work_dir / "vana-teos_pg_001.txt").write_text("uus OCR", encoding="utf-8")
    repo.git.add(slug)
    repo.index.commit(f"Asenda sisu: {slug} ({work_id})\n\nUpload: {upload_id}")
    s = _state(upload_id)
    s["replace_work_id"] = work_id
    (Path(upload_ops.UPLOADS_DIR) / upload_id / "state.json").write_text(json.dumps(s), encoding="utf-8")
    replace_marker.write_marker(slug, upload_id, {
        "phase": "replacing", "old_head": old_head, "trash_dir": "", "old_files": [], "new_files": []})
    assert replace_recovery.recover(upload_id, slug) == "replaced"
    assert json.loads((work_dir / "_metadata.json").read_text(encoding="utf-8"))["title"] == "Uus"


# ── Ülevaatus PR #881, 3. voor ────────────────────────────────────────────────

def test_katkestus_parast_git_addi_puhastab_indeksi(tmp_path, monkeypatch):
    """(1) Protsess suri pärast lõpliku commit'i `git add`-i: taaste viib indeksi HEAD-ile."""
    upload_id, work_id, slug, work_dir, data_dir, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    trash = tmp_path / "t"
    trash.mkdir()
    old = ["vana-teos_pg_001.jpg", "vana-teos_pg_001.json", "vana-teos_pg_001.txt"]
    for n in old:
        (work_dir / n).rename(trash / n)
    (work_dir / "uus_pg_001.txt").write_text("uus", encoding="utf-8")
    repo.git.add("-A", "--", slug)
    replace_marker.write_marker(slug, upload_id, {
        "phase": "replacing", "old_head": repo.head.commit.hexsha, "trash_dir": str(trash),
        "old_files": old, "new_files": ["uus_pg_001.txt"]})
    assert replace_recovery.recover(upload_id, slug) == "restored"
    assert repo.git.diff("--cached", "--name-only", "--", slug).strip() == ""
    assert (work_dir / "vana-teos_pg_001.txt").read_text(encoding="utf-8") == "vana tekst"
    assert not (work_dir / "uus_pg_001.txt").exists()


def test_kaivitusaegne_taaste_on_enne_paringuid():
    """(1) recover_all jookseb lifespan'is sünkroonselt (enne yield'i), mitte taustalõimes."""
    import inspect
    from server import main
    src = inspect.getsource(main.lifespan)
    assert "await run_in_threadpool(replace_recovery.recover_all)" in src
    assert src.index("recover_all") < src.index("yield")
    assert "target=replace_recovery.recover_all" not in src


def test_luku_all_ebaonnestunud_eeltaaste_annab_409_ja_hoiab_taasteinfo(tmp_path, monkeypatch):
    """(2) Märgi kontroll ja uus katse on sama teoseluku all: taaste tõrkel uus katse ei alga."""
    from fastapi import HTTPException
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    progress = {"phase": "replacing", "old_head": "vana-head-123", "trash_dir": str(tmp_path / "t"),
                "old_files": [], "new_files": []}
    replace_marker.write_marker(slug, upload_id, progress)
    monkeypatch.setattr(replace_recovery, "find_replace_commit", lambda *a: None)
    monkeypatch.setattr(replace_recovery, "restore_replace",
                        lambda *a, **k: (_ for _ in ()).throw(replace_recovery.RestoreError("katki")))
    with pytest.raises(HTTPException) as exc:
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    assert exc.value.status_code == 409
    assert replace_marker.read_marker(slug)["progress"]["old_head"] == "vana-head-123"


def test_asenduse_rollback_hoiab_commitimata_teksti(tmp_path, monkeypatch):
    """(3) /save jättis teksti kettale (commit ebaõnnestus); asenduse rollback ei kaota seda."""
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    (work_dir / "vana-teos_pg_001.txt").write_text("viimati salvestatud", encoding="utf-8")

    class Katkine(_KirjutavSftp):
        def get(self, remote, local):
            raise FileNotFoundError(remote)

    monkeypatch.setattr(upload_ops, "_sftp_open", lambda _u: Katkine(["uus-teos_pg_001.jpg", "uus-teos_pg_001.txt"]))
    with pytest.raises(Exception):
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    assert (work_dir / "vana-teos_pg_001.txt").read_text(encoding="utf-8") == "viimati salvestatud"


def test_osade_nullimise_torge_jatab_margi_ja_taaste_kordab(tmp_path, monkeypatch):
    """(4) Kohustuslik järelsamm: tõrge jätab märgi (faas replaced); taaste kordab ja lõpetab."""
    from fastapi import HTTPException
    from server import work_parts
    upload_id, work_id, slug, *_ = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    katki = {"jah": True}

    def reset(*a, **k):
        if katki["jah"]:
            raise work_parts.PartError("metaandmeid ei saanud kirjutada", 500)
        return True

    monkeypatch.setattr(work_parts, "reset_parts_for_replace", reset)
    with pytest.raises(HTTPException):
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    m = replace_marker.read_marker(slug)
    assert m and m["progress"]["phase"] == "replaced"
    assert _state(upload_id).get("status") != "imported"
    katki["jah"] = False
    assert replace_recovery.recover(upload_id, slug) == "replaced"
    assert replace_marker.read_marker(slug) is None
    assert _state(upload_id)["status"] == "imported"


def test_lukku_oottav_korduskatse_ei_kirjuta_taasteinfot_ule(tmp_path, monkeypatch):
    """(2) Kaks sama üleslaadimise päringut: B ootab lukku, A jätab märgi (taaste kukub).
    B ei tohi A taasteinfot üle kirjutada — A liigutas vanad failid prügikasti."""
    import threading
    import time
    from fastapi import HTTPException
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    _katkine_git_kasklus(monkeypatch, repo, "reset")
    a_lukus = threading.Event()

    class Katkine(_KirjutavSftp):
        def get(self, remote, local):
            if threading.current_thread().name == "A":
                a_lukus.set()
                time.sleep(0.4)          # B jõuab lukku ootama
            raise FileNotFoundError(remote)

    monkeypatch.setattr(upload_ops, "_sftp_open", lambda _u: Katkine(["uus-teos_pg_001.jpg", "uus-teos_pg_001.txt"]))
    tulemused = {}

    def jooks(nimi):
        try:
            upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
        except HTTPException as e:
            tulemused[nimi] = e.status_code
        except Exception as e:
            tulemused[nimi] = type(e).__name__

    a = threading.Thread(target=jooks, args=("A",), name="A")
    a.start()
    assert a_lukus.wait(5)
    b = threading.Thread(target=jooks, args=("B",), name="B")
    b.start()
    a.join(10)
    b.join(10)
    m = replace_marker.read_marker(slug)
    assert m, "märk peab jääma (taaste kukkus)"
    assert m["progress"]["old_files"], "A taasteinfo (vanad failid prügikastis) peab alles olema"
    assert tulemused.get("B") == 409, tulemused


# ── Ülevaatus PR #881, 4. voor ────────────────────────────────────────────────

def test_ebaselge_commit_puhastab_ikkagi_indeksi(tmp_path, monkeypatch):
    """(1) Ajaloo lugemisviga: märk jääb, aga teose kausta indeks viiakse HEAD-ile — ükski
    teine commit ei tohi stage'itud asenduse faile kaasa võtta."""
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    (work_dir / "uus_pg_001.txt").write_text("uus", encoding="utf-8")
    repo.git.add("-A", "--", slug)
    replace_marker.write_marker(slug, upload_id, {
        "phase": "replacing", "old_head": repo.head.commit.hexsha, "trash_dir": str(tmp_path / "t"),
        "old_files": [], "new_files": ["uus_pg_001.txt"]})
    monkeypatch.setattr(replace_recovery, "find_replace_commit",
                        lambda *a: (_ for _ in ()).throw(replace_recovery.ReplaceCommitUnknown("katki")))
    assert replace_recovery.recover(upload_id, slug) == "commit_unknown"
    assert replace_marker.read_marker(slug) is not None
    assert repo.git.diff("--cached", "--name-only", "--", slug).strip() == ""


def _teine_upload(tmp_path, upload_id, uus_id):
    import shutil
    src = Path(upload_ops.UPLOADS_DIR) / upload_id
    dst = Path(upload_ops.UPLOADS_DIR) / uus_id
    shutil.copytree(src, dst)
    st = json.loads((dst / "state.json").read_text(encoding="utf-8"))
    st.update({"id": uus_id, "status": "reviewing"})
    st.pop("replace_progress", None)
    (dst / "state.json").write_text(json.dumps(st), encoding="utf-8")


def test_sama_sekundi_asendused_ei_jaga_taastekausta(tmp_path, monkeypatch):
    """(2) Teise asenduse rollback ei tohi tuua tagasi eelmise asenduse varukoopiat."""
    import datetime as _dt
    import shutil
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    # Tootmises on lehed juba `_page_base_name` järgi: eelmise asenduse varukoopia nimed
    # langevad kokku praeguse lehestiku nimedega.
    base = upload_ops._page_base_name(slug, work_id, 1)
    for ext in ("jpg", "txt", "json"):
        (work_dir / f"vana-teos_pg_001.{ext}").rename(work_dir / f"{base}.{ext}")
    repo.git.add("-A", "--", slug)
    repo.index.commit("Standardnimed")

    class Kell(_dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return _dt.datetime(2026, 11, 25, 12, 0, 0, tzinfo=tz)

    monkeypatch.setattr(upload_ops, "datetime", Kell)
    upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    def lehestik():
        return {f.name: f.read_text(encoding="utf-8") for f in sorted(work_dir.glob("*.txt"))}

    kehtiv = lehestik()
    assert kehtiv
    _teine_upload(tmp_path, upload_id, "upl999")
    real_move = shutil.move

    def katkine_move(src, dst, *a, **k):
        if "._trash" in str(dst):
            raise OSError("ketas")
        return real_move(src, dst, *a, **k)

    monkeypatch.setattr(upload_ops.shutil, "move", katkine_move)
    with pytest.raises(Exception):
        upload_ops.replace_work_content("upl999", work_id, {}, "admin", background_tasks=None)
    assert lehestik() == kehtiv


def test_hilinenud_taaste_ei_tee_midagi_kui_mark_on_ara(tmp_path, monkeypatch):
    """(3) Märk eemaldatud (asendus lõpetatud) → hilinenud taaste ei puuduta teost."""
    upload_id, work_id, slug, work_dir, _dd, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    assert replace_marker.read_marker(slug) is None
    kutsed = []
    monkeypatch.setattr(upload_ops, "_after_replace_commit", lambda *a, **k: kutsed.append(a))
    assert replace_recovery.recover(upload_id, slug) == "cleared"
    assert kutsed == []


def test_asendus_arhiveerib_koik_lehepildid(tmp_path, monkeypatch):
    """(4) Vanad .JPG/.jpeg/.png lehepildid liiguvad samuti prügikasti (sama reegel mis leheloendil)."""
    upload_id, work_id, slug, work_dir, data_dir, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    for n in ("vana-teos_pg_002.JPG", "vana-teos_pg_003.jpeg", "vana-teos_pg_004.png"):
        (work_dir / n).write_bytes(b"vana")
    upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    for n in ("vana-teos_pg_002.JPG", "vana-teos_pg_003.jpeg", "vana-teos_pg_004.png"):
        assert not (work_dir / n).exists(), n
        assert list((data_dir / "._trash").rglob(n)), n
