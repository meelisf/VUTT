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
