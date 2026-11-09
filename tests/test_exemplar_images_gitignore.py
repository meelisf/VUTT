# tests/test_exemplar_images_gitignore.py
"""ADR 0079: eksemplari pildifailid ja impordi staging ei satu `data/` gitti.
`replace_work_content` teeb `git add <kaust>` — ilma ignoreerimiseta läheks
poolelioleva impordi `job.json` ja allalaaditud PDF commit'i."""
import subprocess

from server import git_ops


def test_uus_repo_ignoreerib_eksemplari_tooriistafaile(tmp_path, monkeypatch):
    monkeypatch.setattr(git_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(git_ops, "_git_repo", None)
    git_ops.get_or_init_repo()

    sisu = (tmp_path / ".gitignore").read_text(encoding="utf-8").splitlines()
    for rida in git_ops.DATA_GITIGNORE_EXTRA:
        assert rida in sisu

    def ignoreeritud(rel: str) -> bool:
        return subprocess.run(["git", "check-ignore", "-q", rel], cwd=tmp_path).returncode == 0

    assert ignoreeritud("w/_exemplars/a1b2c3/_imports/q1/job.json")
    assert ignoreeritud("w/_exemplars/a1b2c3/x.orig.tif")
    assert ignoreeritud("w/_exemplars/a1b2c3/_thumbs/_thumb_x.jpg")
    assert ignoreeritud("w/_exemplars/a1b2c3/_imports/q1/koos.pdf")
    assert not ignoreeritud("w/_exemplars/a1b2c3/images.json")


def test_stardikontroll_lisab_puuduvad_read_ja_commitib(tmp_path, monkeypatch):
    """Olemasolev repo vana .gitignore'iga (deploy samm ununes): start lisab read ise,
    muidu läheks `replace_work_content`-i `git add <kaust>` kaudu staging ajalukku."""
    from git import Actor, Repo
    repo = Repo.init(tmp_path)
    (tmp_path / ".gitignore").write_text("*.jpg\n*.png\n", encoding="utf-8")
    actor = Actor("t", "t@vutt.local")
    repo.git.add(A=True)
    repo.index.commit("init", author=actor, committer=actor)
    monkeypatch.setattr(git_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(git_ops, "_git_repo", None)

    assert git_ops.ensure_data_gitignore() is True
    sisu = (tmp_path / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert sisu[:2] == ["*.jpg", "*.png"]
    for rida in git_ops.DATA_GITIGNORE_EXTRA:
        assert rida in sisu
    assert git_ops.uncommitted_paths([str(tmp_path / ".gitignore")]) == []
    # Teine kord: midagi ei muutu, uut commit'i ei tule.
    n = len(list(repo.iter_commits()))
    assert git_ops.ensure_data_gitignore() is False
    assert len(list(repo.iter_commits())) == n
