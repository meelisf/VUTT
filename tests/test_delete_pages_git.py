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
