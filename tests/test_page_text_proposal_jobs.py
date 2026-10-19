"""#641: paki kinnitus — ÜKS commit, lehelukud kogu töö vältel, ketta taaste vea korral."""
import json
import os
import subprocess
import threading
import time

import pytest
from git import Repo

from server import git_ops
from server import page_text_proposal_jobs as jobs
from server import page_text_proposals as ptp

ROOT_CFG = ["-c", "user.name=t", "-c", "user.email=t@t"]


@pytest.fixture
def work(tmp_path, monkeypatch):
    monkeypatch.setattr(ptp, "DB_PATH", str(tmp_path / "ptp.sqlite3"))
    root = tmp_path / "data"
    d = root / "slug-w1"
    d.mkdir(parents=True)
    for i in range(1, 5):
        (d / f"t-00{i}.jpg").write_bytes(b"x")
        (d / f"t-00{i}.txt").write_text(f"leht {i} vana\nteine rida\n", encoding="utf-8")
        (d / f"t-00{i}.json").write_text(json.dumps({"status": "Töös", "comments": []}), encoding="utf-8")
    (d / "_metadata.json").write_text(json.dumps({"id": "w1"}), encoding="utf-8")
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    subprocess.run(["git", "-C", str(root), *ROOT_CFG, "add", "."], check=True)
    subprocess.run(["git", "-C", str(root), *ROOT_CFG, "commit", "-qm", "v1"], check=True)
    repo = Repo(str(root))
    monkeypatch.setattr(git_ops, "BASE_DIR", str(root))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: repo)
    sync = []
    monkeypatch.setattr(ptp, "_sync_meili", lambda work_dir: sync.append(work_dir))
    jobs._reset_for_tests()
    return {"dir": str(d), "root": str(root), "sync": sync}


def _txt(w, n):
    with open(f"{w['dir']}/t-00{n}.txt", "rb") as f:
        return f.read().decode()


def _write(w, n, text):
    with open(f"{w['dir']}/t-00{n}.txt", "w", encoding="utf-8") as f:
        f.write(text)


def _commits(w):
    return int(subprocess.run(["git", "-C", w["root"], "rev-list", "--count", "HEAD"],
                              capture_output=True, text=True).stdout)


def _esita(w, pages=(1, 2, 3)):
    code = ptp.issue_handoff("w1", "agent")["code"]
    body = []
    for n in pages:
        src = ptp.read_source(code, "w1", w["dir"], n)
        body.append({"stem": src["stem"], "text_hash": src["text_hash"],
                     "edits": [{"old": "vana", "new": "uus"}]})
    return ptp.submit(code, "w1", w["dir"], body, "pakk")["proposal_id"]


def _states(pid):
    import sqlite3
    db = sqlite3.connect(ptp.DB_PATH)
    return dict(db.execute("SELECT stem, state FROM proposal_page WHERE proposal_id=?", (pid,)).fetchall())


def test_pakk_uks_commit_uks_sunk(work):
    pid = _esita(work)
    jsonid = [open(f"{work['dir']}/t-00{n}.json", "rb").read() for n in (1, 2, 3)]
    res = ptp.apply_pack(pid, work["dir"], "super")
    assert sorted(res["accepted"]) == ["t-001", "t-002", "t-003"]
    assert _commits(work) == 2 and len(work["sync"]) == 1
    assert all(_txt(work, n) == f"leht {n} uus\nteine rida\n" for n in (1, 2, 3))
    assert [open(f"{work['dir']}/t-00{n}.json", "rb").read() for n in (1, 2, 3)] == jsonid
    assert set(_states(pid).values()) == {"accepted"}
    msg = subprocess.run(["git", "-C", work["root"], "log", "-1", "--format=%s"],
                         capture_output=True, text=True).stdout
    assert f"MCP-ettepanek {pid}" in msg


def test_pakk_konflikt_stale_ketas_puutumata(work):
    pid = _esita(work)
    _write(work, 2, "leht 2 muu\nteine rida\n")
    res = ptp.apply_pack(pid, work["dir"], "super")
    assert res["stale"] == ["t-002"] and _txt(work, 2) == "leht 2 muu\nteine rida\n"
    assert _states(pid)["t-002"] == "stale"


def test_pakk_jatab_otsustatud_vahele(work):
    pid = _esita(work)
    ptp.reject_page(pid, "t-001", "super")
    res = ptp.apply_pack(pid, work["dir"], "super")
    assert res["skipped"] == ["t-001"] and _txt(work, 1) == "leht 1 vana\nteine rida\n"


def test_pakk_git_viga_taastab_ketta(work, monkeypatch):
    pid = _esita(work)
    orig = git_ops.save_with_git

    def katki(path, content, *a, additional_files=None, **k):
        from server.utils import atomic_write_text
        atomic_write_text(path, content)
        for p, c in additional_files or []:
            atomic_write_text(p, c)
        return {"success": False, "error": "lukk"}
    monkeypatch.setattr(git_ops, "save_with_git", katki)
    with pytest.raises(RuntimeError, match="git_failed"):
        ptp.apply_pack(pid, work["dir"], "super")
    assert all(_txt(work, n) == f"leht {n} vana\nteine rida\n" for n in (1, 2, 3))
    assert set(_states(pid).values()) == {"pending"} and work["sync"] == []
    monkeypatch.setattr(git_ops, "save_with_git", orig)


def test_pakk_commitimata_poolik_taastatakse_headist(work):
    pid = _esita(work, pages=(1,))
    _write(work, 1, "leht 1 uus\nteine rida\n")          # suri enne commit'i
    res = ptp.apply_pack(pid, work["dir"], "super")
    assert res["accepted"] == ["t-001"] and _commits(work) == 2
    assert _txt(work, 1) == "leht 1 uus\nteine rida\n"


def test_taaste_sailitab_lopu_reavahetuse(work):
    assert git_ops.head_bytes("slug-w1/t-001.txt").endswith(b"\n")


def test_pakk_kustutatud_leht(work):
    pid = _esita(work)
    os.remove(f"{work['dir']}/t-003.txt")
    res = ptp.apply_pack(pid, work["dir"], "super")
    assert res["stale"] == ["t-003"]


def test_samaaegne_save_ootab(work, monkeypatch):
    from server.routers import editing
    pid = _esita(work, pages=(1,))
    sees, lase = threading.Event(), threading.Event()
    orig = git_ops.save_with_git

    def aeglane(*a, **k):
        sees.set()
        lase.wait(5)
        return orig(*a, **k)
    monkeypatch.setattr(git_ops, "save_with_git", aeglane)
    t = threading.Thread(target=ptp.apply_pack, args=(pid, work["dir"], "super"))
    t.start()
    assert sees.wait(5)
    monkeypatch.setattr(git_ops, "save_with_git", orig)
    monkeypatch.setattr(editing, "save_with_git", orig)
    valmis = threading.Event()

    def inimene():
        editing._save_page_locked(f"{work['dir']}/t-001.txt", "inimese tekst\n", None, "ed")
        valmis.set()
    threading.Thread(target=inimene).start()
    time.sleep(0.2)
    assert not valmis.is_set()          # ootab lehe luku taga
    lase.set()
    t.join(5)
    assert valmis.wait(5)
    assert _txt(work, 1) == "inimese tekst\n" and _commits(work) == 3


def test_start_409_kui_kaib(work, monkeypatch):
    pid = _esita(work, pages=(1,))
    lase = threading.Event()
    monkeypatch.setattr(ptp, "apply_pack", lambda *a, **k: lase.wait(5) and {})
    assert jobs.start(pid, "w1", work["dir"], "super") is True
    assert jobs.start(pid, "w1", work["dir"], "super") is False
    assert jobs.get_status("w1")["state"] == "running"
    lase.set()


def test_commitimata_inimese_tekst_ei_kao(work):
    """Commit'imata sisu, mis EI OLE meie pooleli töö (nt /save commit kukkus), jääb alles."""
    pid = _esita(work, pages=(1,))
    _write(work, 1, "leht 1 vana\nteine rida\ninimese lisatud\n")
    res = ptp.apply_pack(pid, work["dir"], "super")
    assert res["accepted"] == ["t-001"]
    assert _txt(work, 1) == "leht 1 uus\nteine rida\ninimese lisatud\n"
