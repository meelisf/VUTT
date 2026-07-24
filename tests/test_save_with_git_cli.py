"""Native Git CLI salvestustee regressioonitestid."""
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import git

from server import git_ops


def _repo(tmp_path):
    repo = git.Repo.init(str(tmp_path))
    seed = tmp_path / "seed.txt"
    seed.write_text("seed", encoding="utf-8")
    repo.index.add(["seed.txt"])
    actor = git.Actor("seed", "seed@vutt.local")
    repo.index.commit("seed", author=actor, committer=actor)
    return repo


def _save(repo, tmp_path, relative, content, username="editor", **kwargs):
    path = tmp_path / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    with patch.object(git_ops, "BASE_DIR", str(tmp_path)), \
         patch.object(git_ops, "get_or_init_repo", return_value=repo):
        return git_ops.save_with_git(str(path), content, username, **kwargs)


def test_native_cli_creates_commit_with_requested_author(tmp_path):
    repo = _repo(tmp_path)
    result = _save(repo, tmp_path, "work/page.txt", "tekst", message="Muuda lehte")

    assert result["success"] is True
    assert result["is_first_commit"] is True
    assert repo.head.commit.author.name == "editor"
    assert repo.head.commit.message.strip() == "Muuda lehte"
    assert (repo.head.commit.tree / "work" / "page.txt").data_stream.read() == b"tekst"


def test_native_cli_commits_additional_files_together(tmp_path):
    repo = _repo(tmp_path)
    json_path = tmp_path / "work" / "page.json"
    result = _save(
        repo,
        tmp_path,
        "work/page.txt",
        "tekst",
        additional_files=[(str(json_path), '{"status":"Valmis"}')],
    )

    assert result["success"] is True
    changed = set(repo.git.show("--name-only", "--format=", "HEAD").splitlines())
    assert changed == {"work/page.txt", "work/page.json"}


def test_native_cli_skips_noop_commit(tmp_path):
    repo = _repo(tmp_path)
    _save(repo, tmp_path, "work/page.txt", "sama")
    before = repo.head.commit.hexsha

    result = _save(repo, tmp_path, "work/page.txt", "sama")

    assert result["success"] is True
    assert result["is_noop"] is True
    assert repo.head.commit.hexsha == before


def test_path_scoped_commit_preserves_unrelated_staging(tmp_path):
    repo = _repo(tmp_path)
    main = tmp_path / "work" / "page.txt"
    unrelated = tmp_path / "unrelated.txt"
    main.parent.mkdir()
    main.write_text("vana", encoding="utf-8")
    unrelated.write_text("vana", encoding="utf-8")
    repo.index.add(["work/page.txt", "unrelated.txt"])
    repo.index.commit("tracked")

    unrelated.write_text("staged", encoding="utf-8")
    repo.index.add(["unrelated.txt"])
    result = _save(repo, tmp_path, "work/page.txt", "uus")

    assert result["success"] is True
    assert repo.git.diff("--cached", "--name-only").strip() == "unrelated.txt"
    changed = repo.git.show("--name-only", "--format=", "HEAD").splitlines()
    assert changed == ["work/page.txt"]


def test_concurrent_saves_are_serialized_without_lost_commits(tmp_path):
    repo = _repo(tmp_path)
    (tmp_path / "work").mkdir()

    def save_one(n):
        return git_ops.save_with_git(
            str(tmp_path / f"work/page-{n}.txt"), f"tekst {n}", f"user{n}"
        )

    with patch.object(git_ops, "BASE_DIR", str(tmp_path)), \
         patch.object(git_ops, "get_or_init_repo", return_value=repo), \
         ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(save_one, range(4)))

    assert all(r["success"] for r in results)
    assert len(list(repo.iter_commits())) == 5  # seed + neli salvestust
    for n in range(4):
        assert (tmp_path / f"work/page-{n}.txt").read_text(encoding="utf-8") == f"tekst {n}"
