"""Git-indeksi soojenduse testid (#318 järelparandus).

Esimene `data/`-repo commit pärast serveri taaskäivitust maksis tootmises
14,7 s: `git add`/`git commit` peavad värskendama 60 000+ kirjega indeksit ja
pärast buuti on dentry-cache külm. Klient katkestas 10 s pealt ja teatas
ebaõnnestumisest, kuigi kogu loodi ära.

Soojendus stat'ib töökataloogi taustal ENNE esimest kirjutust.
"""
import subprocess
from unittest.mock import patch

from server import git_ops


def test_soojendus_kasutab_git_optional_locks_null(tmp_path):
    """Soojendus EI TOHI võtta index.lock'i.

    `save_with_git` kordab index.lock'i konflikti ainult 3× (0,15 s sammuga);
    kui soojendus hoiaks lukku sekundeid, kukuks samal ajal saabuv päris
    salvestus. `GIT_OPTIONAL_LOCKS=0` laseb gitil töökataloogi läbi käia
    (see ongi soojendus), aga keelab indeksi kirjutamise.
    """
    with patch.object(git_ops, "BASE_DIR", str(tmp_path)), \
         patch.object(git_ops.subprocess, "run") as run:
        run.return_value = subprocess.CompletedProcess([], 0, b"", b"")
        git_ops.warm_git_index()

    assert run.call_count == 1
    cmd = run.call_args[0][0]
    assert cmd[0] == "git" and "status" in cmd
    assert run.call_args[1]["env"]["GIT_OPTIONAL_LOCKS"] == "0"
    assert run.call_args[1]["cwd"] == str(tmp_path)


def test_soojenduse_torge_ei_visku(tmp_path):
    """Soojendus on jõudlusabi, mitte kirjutustee — tõrge ei tohi midagi peatada."""
    with patch.object(git_ops, "BASE_DIR", str(tmp_path)), \
         patch.object(git_ops.subprocess, "run", side_effect=OSError("git puudub")):
        git_ops.warm_git_index()  # ei tohi visata
