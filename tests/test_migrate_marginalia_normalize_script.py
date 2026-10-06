"""migrate_marginalia_normalize.py: --commit lisab AINULT muudetud failid.

data/ tööpuus võib olla muud pooleliolevat (vt git_ops) — `git add -A`
commitiks selle migratsiooni nime all kaasa.
"""
import os
import subprocess
import sys
from pathlib import Path

SKRIPT = Path(__file__).resolve().parent.parent / "scripts" / "migrate_marginalia_normalize.py"


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout


def _kaivita(data, *args):
    env = dict(os.environ, VUTT_DATA_DIR=str(data))
    return subprocess.run([sys.executable, str(SKRIPT), *args], env=env,
                          capture_output=True, text=True, check=True).stdout


def test_commit_votab_ainult_muudetud_failid(tmp_path):
    data = tmp_path / "data"
    (data / "teos").mkdir(parents=True)
    leht = data / "teos" / "p1.txt"
    leht.write_text("tekst\n<m> <i>Prop. 4.</i></m>\n", encoding="utf-8")
    muu = data / "teos" / "p2.txt"
    muu.write_text("puhas\n", encoding="utf-8")
    _git(data, "init", "-q")
    _git(data, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A")
    _git(data, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "algus")
    muu.write_text("puhas\nkeegi toimetab\n", encoding="utf-8")   # pooleli töö

    valjund = _kaivita(data)                                        # kuivkäivitus
    assert "Muudaks (dry-run): 1 faili, 1 rida" in valjund
    assert leht.read_text(encoding="utf-8").startswith("tekst\n<m> <i>")

    env = dict(os.environ, VUTT_DATA_DIR=str(data), GIT_AUTHOR_NAME="t",
               GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
    subprocess.run([sys.executable, str(SKRIPT), "--apply", "--commit"], env=env,
                   capture_output=True, text=True, check=True)

    assert leht.read_text(encoding="utf-8") == "tekst\n<m><i>Prop. 4.</i></m>\n"
    assert _git(data, "show", "--name-only", "--format=", "HEAD").split() == ["teos/p1.txt"]
    assert _git(data, "status", "--porcelain").strip() == "M teos/p2.txt"
