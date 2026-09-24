"""Testid delete_pages_from_git batch-kustutusele (päris ajutine git-repo)."""
import os
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.git_ops as git_ops
from git import Repo


@pytest.fixture
def repo(tmp_path, monkeypatch):
    r = Repo.init(str(tmp_path))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")
    folder = tmp_path / "1690-w1"
    folder.mkdir()
    rel = []
    for i in (1, 2, 3):
        for ext in (".txt", ".json"):
            p = folder / f"pg{i}{ext}"
            p.write_text("x", encoding="utf-8")
            rel.append(os.path.relpath(str(p), str(tmp_path)))
    r.index.add(rel)
    r.index.commit("init")
    monkeypatch.setattr(git_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    return {"repo": r, "folder": folder, "tmp": tmp_path}


def test_delete_multiple_pages_one_commit(repo):
    before = len(list(repo["repo"].iter_commits()))
    removed = git_ops.delete_pages_from_git("1690-w1", ["pg1", "pg2"], "kustuta", "admin")
    after = len(list(repo["repo"].iter_commits()))
    assert after == before + 1  # ÜKS commit
    assert not (repo["folder"] / "pg1.txt").exists()
    assert not (repo["folder"] / "pg2.json").exists()
    assert (repo["folder"] / "pg3.txt").exists()
    assert set(removed) == {
        os.path.join("1690-w1", n) for n in ("pg1.txt", "pg1.json", "pg2.txt", "pg2.json")
    }


def test_commit_failure_rolls_back_staging(repo, monkeypatch):
    # Pane commit viskama → staging peab jääma puhtaks (skoobitud reset)
    def boom(*a, **kw):
        raise RuntimeError("commit fail")
    # IndexFile.commit on read-only instantsil (slots) → patchi klassi tasandil
    monkeypatch.setattr(type(repo["repo"].index), "commit", boom)
    with pytest.raises(RuntimeError):
        git_ops.delete_pages_from_git("1690-w1", ["pg1"], "kustuta", "admin")
    # Staging puhas: HEAD-i ja indeksi vahel pole "deleted" kirjeid pg* failidele
    staged = [d.a_path for d in repo["repo"].index.diff("HEAD")]
    assert all("pg1" not in s for s in staged)


# --- commit_add_and_remove: poolituse ÜKS native commit (#431) ---

def test_lisab_ja_eemaldab_yhe_commitiga(repo):
    import subprocess
    r, folder = repo["repo"], repo["folder"]
    before = len(list(r.iter_commits()))
    new_txt = folder / "pg9.txt"
    git_ops.commit_add_and_remove(
        [(str(new_txt), "uus")],
        [str(folder / "pg1.txt"), str(folder / "pg1.json")],
        "Lõika leht 1 (1690-w1): test", "admin",
    )
    assert len(list(r.iter_commits())) == before + 1
    head = r.head.commit
    assert head.message.strip().startswith("Lõika leht"), "prügikasti liigitus loeb prefiksit"
    assert head.author.name == "admin"
    tracked = subprocess.run(["git", "ls-files"], cwd=repo["tmp"], capture_output=True, text=True).stdout
    assert "1690-w1/pg9.txt" in tracked and "1690-w1/pg1.txt" not in tracked
    assert not (folder / "pg1.txt").exists() and new_txt.read_text(encoding="utf-8") == "uus"
    # Kustutav commit on leitav — prügikast otsib just seda.
    log = subprocess.run(["git", "log", "--diff-filter=D", "--format=%s", "--", "1690-w1/pg1.txt"],
                         cwd=repo["tmp"], capture_output=True, text=True).stdout
    assert log.startswith("Lõika leht")


def test_ei_puutu_teisi_staged_faile(repo):
    """--only: teise kasutaja pooleli stage'itud fail ei tohi sellesse commiti minna."""
    import subprocess
    folder = repo["folder"]
    (folder / "pg3.txt").write_text("teise kasutaja muudatus", encoding="utf-8")
    subprocess.run(["git", "add", "1690-w1/pg3.txt"], cwd=repo["tmp"], check=True)
    git_ops.commit_add_and_remove([], [str(folder / "pg2.txt")], "Lõika leht 2", "admin")
    files = repo["repo"].head.commit.stats.files
    assert "1690-w1/pg3.txt" not in files and "1690-w1/pg2.txt" in files


def test_vea_korral_rollback(repo, monkeypatch):
    import subprocess
    folder = repo["folder"]
    real = subprocess.run

    def fake(cmd, *a, **kw):
        if cmd[:2] == ["git", "commit"]:
            raise subprocess.CalledProcessError(1, cmd, stderr="boom")
        return real(cmd, *a, **kw)

    monkeypatch.setattr(git_ops.subprocess, "run", fake)
    with pytest.raises(subprocess.CalledProcessError):
        git_ops.commit_add_and_remove([], [str(folder / "pg1.txt")], "Lõika leht 1", "admin")
    assert (folder / "pg1.txt").exists(), "eemaldatud fail taastatakse HEAD-ist"
    staged = real(["git", "diff", "--cached", "--name-only"], cwd=repo["tmp"], capture_output=True, text=True).stdout
    assert "pg1" not in staged
