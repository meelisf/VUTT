"""Ootel git-indeksi sünk (ADR 0089, PR #881 järelparandus).

HEAD-i uuendus (`update-ref`) on asenduse avaldamise piir. Kui ühise indeksi teose kausta
sünk pärast seda ebaõnnestub, võiks järgmine `repo.index.commit` vana indeksiseisu kaasa
võtta ja asenduse git'is tagasi pöörata. Ootel sünk elab failis; iga git-kirjutus proovib
seda luku võtmisel ja keeldub, kui see ei õnnestu.
"""
import pytest
from git import Repo

import server.git_ops as git_ops


@pytest.fixture
def repo(tmp_path, monkeypatch):
    data = tmp_path / "data"
    (data / "teos").mkdir(parents=True)
    r = Repo.init(str(data))
    with r.config_writer() as c:
        c.set_value("user", "name", "t").set_value("user", "email", "t@t.test")
    (data / "teos" / "a.txt").write_text("vana", encoding="utf-8")
    r.index.add(["teos/a.txt"])
    r.index.commit("v1")
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    monkeypatch.setattr(git_ops, "_PENDING_FILE", str(tmp_path / "git_index_sync_pending.json"))
    return r


def _katkine_reset(monkeypatch, repo, kordi=10**9):
    real = repo.git
    loendur = {"n": 0}

    class G:
        def __getattr__(self, name):
            if name == "reset" and loendur["n"] < kordi:
                def boom(*a, **k):
                    loendur["n"] += 1
                    raise RuntimeError("index.lock")
                return boom
            return getattr(real, name)

    monkeypatch.setattr(repo, "git", G(), raising=False)


def test_ootel_sunk_blokeerib_git_kirjutuse_kuni_onnestub(repo, monkeypatch):
    git_ops.mark_index_sync_pending("teos")
    _katkine_reset(monkeypatch, repo)
    with pytest.raises(git_ops.GitIndexSyncError):
        with git_ops.git_write_lock:
            pass
    assert git_ops.pending_index_syncs() == ["teos"]
    pend = git_ops._PENDING_FILE
    monkeypatch.undo()
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: repo)
    monkeypatch.setattr(git_ops, "_PENDING_FILE", pend)
    assert git_ops.pending_index_syncs() == ["teos"]
    with git_ops.git_write_lock:
        pass
    assert git_ops.pending_index_syncs() == []


def test_sunk_viib_teose_indeksi_head_ile(repo):
    # Simuleeri vananenud indeksit: HEAD-is uus sisu, indeksis vana.
    data = repo.working_tree_dir
    import os
    with open(os.path.join(data, "teos", "a.txt"), "w", encoding="utf-8") as f:
        f.write("uus")
    repo.index.add(["teos/a.txt"])
    repo.index.commit("v2")
    old_blob = repo.git.rev_parse("HEAD~1:teos/a.txt")
    repo.git.update_index("--cacheinfo", f"100644,{old_blob},teos/a.txt")
    assert repo.git.diff("--cached", "--name-only").strip() == "teos/a.txt"
    git_ops.mark_index_sync_pending("teos")
    with git_ops.git_write_lock:
        pass
    assert repo.git.diff("--cached", "--name-only").strip() == ""


def test_reentrantne_lukk_ei_kaivita_sunki_uuesti(repo, monkeypatch):
    with git_ops.git_write_lock:
        git_ops.mark_index_sync_pending("teos")
        with git_ops.git_write_lock:      # sisemine võtmine: sünki ei proovita
            pass
        assert git_ops.pending_index_syncs() == ["teos"]
