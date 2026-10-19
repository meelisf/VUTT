"""#641: lehe ettepaneku kinnitus `/save` kaudu (`proposal`-viide, ainult superadmin)."""
import json
import subprocess

import pytest

from server import page_text_proposals as ptp
from server.routers import editing
from tests.test_save_liitmine import BASE, leht  # noqa: F401 — fixture


@pytest.fixture
def ettepanek(leht, tmp_path, monkeypatch):
    monkeypatch.setattr(ptp, "DB_PATH", str(tmp_path / "ptp.sqlite3"))
    folder = leht["txt"].parent
    (folder / "pg1.jpg").write_bytes(b"x")
    code = ptp.issue_handoff("work1", "agent")["code"]
    src = ptp.read_source(code, "work1", str(folder), 1)
    res = ptp.submit(code, "work1", str(folder),
                     [{"stem": "pg1", "text_hash": src["text_hash"],
                       "edits": [{"old": "vana", "new": "uus"}]}], "pakk")
    return res["proposal_id"]


def _save(client, login, *, text, proposal, user=("superadmin", "superpass")):
    token = login(*user)
    body = {
        "original_path": "1690-w1", "file_name": "pg1.txt", "text_content": text,
        "meta_content": {"status": "Toores", "work_id": "work1", "page_tags": [],
                         "text_annotations": [], "comments": BASE["comments"]},
        "base": BASE, "proposal": proposal,
    }
    return client.post("/save", json=body, headers={"Authorization": f"Bearer {token}"})



def _row_state(pid):
    import sqlite3
    db = sqlite3.connect(ptp.DB_PATH)
    return db.execute("SELECT state FROM proposal_page WHERE proposal_id=?", (pid,)).fetchone()[0]


def _log(leht):
    root = leht["txt"].parent.parent
    return subprocess.run(["git", "-C", str(root), "log", "-1", "--format=%s"],
                          capture_output=True, text=True).stdout


def test_save_viitega_kinnitab(client, login, leht, ettepanek):
    r = _save(client, login, text="uus tekst", proposal={"id": ettepanek, "stem": "pg1"})
    assert r.status_code == 200, r.text
    assert r.json()["proposal_state"] == "accepted"
    assert _row_state(ettepanek) == "accepted"
    assert f"MCP-ettepanek {ettepanek}" in _log(leht)


def test_save_viitega_muutusteta_rejected(client, login, leht, ettepanek):
    r = _save(client, login, text="vana tekst", proposal={"id": ettepanek, "stem": "pg1"})
    assert r.status_code == 200, r.text
    assert r.json()["proposal_state"] == "rejected" and _row_state(ettepanek) == "rejected"


def test_save_409_jatab_ootele(client, login, leht, ettepanek):
    leht["txt"].write_text("teise inimese tekst", encoding="utf-8")
    r = _save(client, login, text="uus tekst", proposal={"id": ettepanek, "stem": "pg1"})
    assert r.status_code == 409
    assert _row_state(ettepanek) == "pending"


def test_save_viide_mitte_superadmin_403(client, login, leht, ettepanek):
    r = _save(client, login, text="uus tekst", proposal={"id": ettepanek, "stem": "pg1"},
              user=("editor", "editorpass"))
    assert r.status_code == 403
    assert leht["txt"].read_text(encoding="utf-8") == "vana tekst"


@pytest.mark.parametrize("proposal", [{"stem": "pg1"}, "pg1"])
def test_save_vigane_viide_400(client, login, leht, ettepanek, proposal):
    r = _save(client, login, text="uus tekst", proposal=proposal)
    assert r.status_code == 400
    assert leht["txt"].read_text(encoding="utf-8") == "vana tekst"


def test_save_viide_vale_stem_400(client, login, leht, ettepanek):
    r = _save(client, login, text="uus tekst", proposal={"id": ettepanek, "stem": "pg2"})
    assert r.status_code == 400


def test_lukujarjekord(client, login, leht, ettepanek, monkeypatch):
    jarjekord = []
    orig_p, orig_s = ptp.proposal_lock, editing._save_page_locked
    from contextlib import contextmanager

    @contextmanager
    def p_lock(pid):
        jarjekord.append("proposal")
        with orig_p(pid):
            yield

    def s_locked(*a, **k):
        jarjekord.append("page")
        return orig_s(*a, **k)
    monkeypatch.setattr(ptp, "proposal_lock", p_lock)
    monkeypatch.setattr(editing, "_save_page_locked", s_locked)
    _save(client, login, text="uus tekst", proposal={"id": ettepanek, "stem": "pg1"})
    assert jarjekord[:2] == ["proposal", "page"]


@pytest.mark.parametrize("vahepeal", ["uuesti_esitatud", "tundmatu"])
def test_otsustatud_ettepanek_ei_blokeeri_salvestust(client, login, leht, ettepanek, vahepeal):
    """Lõppülevaatus: agent esitas lehe uuesti (superseded) või ettepanek aegus —
    toimetaja salvestus peab ikka õnnestuma, ettepaneku olekut puutumata."""
    pid = ettepanek
    if vahepeal == "uuesti_esitatud":
        folder = leht["txt"].parent
        code = ptp.issue_handoff("work1", "agent")["code"]
        src = ptp.read_source(code, "work1", str(folder), 1)
        ptp.submit(code, "work1", str(folder), [{"stem": "pg1", "text_hash": src["text_hash"],
                                                 "edits": [{"old": "vana", "new": "teine"}]}], "")
        assert _row_state(pid) == "superseded"
    else:
        pid = "puudub"
    r = _save(client, login, text="minu tekst", proposal={"id": pid, "stem": "pg1"})
    assert r.status_code == 200, r.text
    assert r.json()["proposal_state"] == "already_decided"
    assert leht["txt"].read_text(encoding="utf-8") == "minu tekst"
    if vahepeal == "uuesti_esitatud":
        assert _row_state(pid) == "superseded"
