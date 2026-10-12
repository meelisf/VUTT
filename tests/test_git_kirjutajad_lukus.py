"""Kõik /data git-indeksi kirjutajad hoiavad `_git_write_lock`-i (2026-10-12).

Upload'i import (`commit_new_work_to_git`) kirjutas indeksit lukuta; samal
sekundil kukkus teose halduse poolitus `index.lock: File exists` peale ja
pakk katkes 34. poolitusel. Test kontrollib iga kirjutaja kohta, et lukk
on repo-objekti küsimise hetkel võetud — teine lõim ei saa seda kätte.
"""
import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class _Peatus(Exception):
    pass


@pytest.mark.parametrize("kutse", [
    lambda g: g.commit_new_work_to_git("x"),
    lambda g: g.delete_work_from_git("x", "t", "w"),
    lambda g: g.delete_page_from_git("x", "b", "m"),
    lambda g: g.delete_pages_from_git("x", ["b"], "m"),
    lambda g: g.delete_file_from_git("/nonexistent/x.txt", "m"),
], ids=["commit_new_work", "delete_work", "delete_page", "delete_pages", "delete_file"])
def test_kirjutaja_hoiab_git_lukku(kutse, monkeypatch):
    import server.git_ops as g
    nahtud = []

    def _repo():
        tulemus = []
        t = threading.Thread(target=lambda: tulemus.append(g._git_write_lock.acquire(blocking=False)))
        t.start(); t.join()
        if tulemus[0]:
            g._git_write_lock.release()
        nahtud.append(not tulemus[0])
        raise _Peatus()

    monkeypatch.setattr(g, "get_or_init_repo", _repo)
    try:
        kutse(g)
    except _Peatus:
        pass
    assert nahtud == [True], "get_or_init_repo kutsuti lukuta"
