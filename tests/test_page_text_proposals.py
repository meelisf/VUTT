"""Agendi lehe teksti ettepanekud (#641, ADR 0058 täiendus): kood → toortekst →
asendused → ootel ettepanek. Esitus EI muuda lehte."""
import hashlib
import os
import json
import sqlite3
import unicodedata

import pytest

from server import page_text_proposals as ptp
from server.page_text import normalize_page_text


@pytest.fixture
def work(tmp_path, monkeypatch):
    monkeypatch.setattr(ptp, "DB_PATH", str(tmp_path / "ptp.sqlite3"))
    d = tmp_path / "slug-w1"
    d.mkdir()
    for i in range(1, 5):
        (d / f"t-00{i}.jpg").write_bytes(b"x")
        (d / f"t-00{i}.txt").write_text(f"leht {i} vana\nteine rida\n", encoding="utf-8")
    (d / "_metadata.json").write_text(json.dumps({"id": "w1", "title": "T"}), encoding="utf-8")
    return str(d)


def _txt(work, n):
    with open(f"{work}/t-00{n}.txt", encoding="utf-8") as f:
        return f.read()


def _write(work, n, text):
    with open(f"{work}/t-00{n}.txt", "w", encoding="utf-8") as f:
        f.write(text)


def _code(work_id="w1"):
    return ptp.issue_handoff(work_id, "ed")["code"]


def _page(work, code, n, edits, note=None):
    src = ptp.read_source(code, "w1", work, n)
    p = {"stem": src["stem"], "text_hash": src["text_hash"], "edits": edits}
    if note:
        p["note"] = note
    return p


def _rows(proposal_id=None):
    db = sqlite3.connect(ptp.DB_PATH)
    db.row_factory = sqlite3.Row
    q = "SELECT * FROM proposal_page" + (" WHERE proposal_id=?" if proposal_id else "")
    return [dict(r) for r in db.execute(q, (proposal_id,) if proposal_id else ())]


def _uses(code):
    db = sqlite3.connect(ptp.DB_PATH)
    return db.execute("SELECT uses FROM handoff WHERE code_hash=?",
                      (hashlib.sha256(code.encode()).hexdigest(),)).fetchone()[0]


def test_source_nouab_koodi(work):
    with pytest.raises(ptp.ProposalError, match="invalid_or_expired_handoff"):
        ptp.read_source("vale", "w1", work, 1)
    code = _code()
    src = ptp.read_source(code, "w1", work, 2)
    assert src["stem"] == "t-002" and src["text"] == _txt(work, 2)
    assert src["text_hash"] == hashlib.sha256(_txt(work, 2).encode("utf-8")).hexdigest()
    assert _uses(code) == 0


def test_source_vale_teos_ja_leht(work):
    code = _code()
    muu = os.path.join(os.path.dirname(work), "slug-muu")
    os.makedirs(muu)
    with open(os.path.join(muu, "_metadata.json"), "w") as f:
        json.dump({"id": "muu"}, f)
    with pytest.raises(ptp.ProposalError, match="invalid_or_expired_handoff"):
        ptp.read_source(code, "muu", muu, 1)
    with pytest.raises(ptp.ProposalError, match="unknown_page"):
        ptp.read_source(code, "w1", work, 9)


def test_kood_koigile_teostele(work):
    code = _code(None)
    assert ptp.read_source(code, "w1", work, 1)["stem"] == "t-001"


def test_submit_ei_muuda_lehte(work):
    code = _code()
    enne = _txt(work, 1)
    res = ptp.submit(code, "w1", work, [_page(work, code, 1, [{"old": "vana", "new": "uus"}])], "pakk")
    assert res["pages"] == 1 and _txt(work, 1) == enne
    (row,) = _rows(res["proposal_id"])
    assert row["state"] == "pending" and row["page_no"] == 1


def test_submit_rakendab_toortekstile_ja_normaliseerib(work):
    nfd = unicodedata.normalize("NFD", "Café vana\n")
    _write(work, 1, nfd)
    code = _code()
    res = ptp.submit(code, "w1", work, [_page(work, code, 1, [{"old": "vana", "new": "uus"}])], "")
    (row,) = _rows(res["proposal_id"])
    assert row["base_text"] == nfd
    assert row["proposed_text"] == normalize_page_text(nfd.replace("vana", "uus"))


def test_submit_rasi_ei_klapi(work):
    code = _code()
    p = _page(work, code, 1, [{"old": "vana", "new": "uus"}])
    _write(work, 1, "keegi muutis\n")
    with pytest.raises(ptp.ProposalError, match="stale_page:t-001"):
        ptp.submit(code, "w1", work, [p], "")
    assert _rows() == []


@pytest.mark.parametrize("old, code_", [("puudub", "old_not_found:t-001:0"),
                                        ("rida", None)])
def test_old_puudub_ja_mitmekordne(work, old, code_):
    _write(work, 1, "rida üks\nrida kaks\n")
    code = _code()
    with pytest.raises(ptp.ProposalError, match=code_ or "old_ambiguous:t-001:0"):
        ptp.submit(code, "w1", work, [_page(work, code, 1, [{"old": old, "new": "x"}])], "")
    assert _rows() == [] and _uses(code) == 0


@pytest.mark.parametrize("old, new", [("</ann1> kaks", "kaks</ann1>"),
                                      ("üks", "üks<ann1>"),
                                      ("<ann1>üks", "üks")])
def test_anchor_touched(work, old, new):
    _write(work, 1, "<ann1>üks</ann1> kaks\n")
    code = _code()
    with pytest.raises(ptp.ProposalError, match="anchor_touched:t-001:0"):
        ptp.submit(code, "w1", work, [_page(work, code, 1, [{"old": old, "new": new}])], "")


@pytest.mark.parametrize("text, old, new, err", [
    ("<i>x</i> y\n", "<i>x</i>", "</i>x<i>", "invalid_markup:t-001:"),
    ("x y\n", "x", "<table>x</table>", "invalid_markup:t-001:unknown:table"),
])
def test_invalid_markup(work, text, old, new, err):
    _write(work, 1, text)
    code = _code()
    with pytest.raises(ptp.ProposalError, match=err):
        ptp.submit(code, "w1", work, [_page(work, code, 1, [{"old": old, "new": new}])], "")


def test_submit_vana_vigane_leht_lubatud(work):
    _write(work, 1, "a < b </i> vana\n")
    code = _code()
    res = ptp.submit(code, "w1", work, [_page(work, code, 1, [{"old": "vana", "new": "uus"}])], "")
    assert res["pages"] == 1


def test_muutuseta_leht_valja_tuhi_pakk(work):
    code = _code()
    with pytest.raises(ptp.ProposalError, match="no_changes"):
        ptp.submit(code, "w1", work, [_page(work, code, 1, [{"old": "vana", "new": "vana"}])], "")
    res = ptp.submit(code, "w1", work, [
        _page(work, code, 1, [{"old": "vana", "new": "vana"}]),
        _page(work, code, 2, [{"old": "vana", "new": "uus"}])], "")
    assert [r["stem"] for r in _rows(res["proposal_id"])] == ["t-002"]


def test_supersede_ainult_ootel(work):
    code = _code()
    a = ptp.submit(code, "w1", work, [_page(work, code, 1, [{"old": "vana", "new": "A"}]),
                                      _page(work, code, 2, [{"old": "vana", "new": "A"}])], "")
    db = sqlite3.connect(ptp.DB_PATH)
    with db:
        db.execute("UPDATE proposal_page SET state='accepted' WHERE stem='t-001'")
    b = ptp.submit(code, "w1", work, [_page(work, code, 1, [{"old": "vana", "new": "B"}]),
                                      _page(work, code, 2, [{"old": "vana", "new": "B"}])], "")
    assert b["superseded"] == [[a["proposal_id"], "t-002"]]
    olek = {r["stem"]: r["state"] for r in _rows(a["proposal_id"])}
    assert olek == {"t-001": "accepted", "t-002": "superseded"}


def test_piiratud_teos_lubatud(work):
    with open(f"{work}/_metadata.json", "w", encoding="utf-8") as f:
        json.dump({"id": "w1", "title": "T", "restricted": True, "collections": ["salajane"]}, f)
    code = _code()
    res = ptp.submit(code, "w1", work, [_page(work, code, 1, [{"old": "vana", "new": "uus"}])], "")
    assert res["pages"] == 1


def test_kasutuskord_kulub_ainult_esitusel(work):
    code = _code()
    ptp.read_source(code, "w1", work, 1)
    ptp.submit(code, "w1", work, [_page(work, code, 1, [{"old": "vana", "new": "uus"}])], "")
    assert _uses(code) == 1


def test_laed(work, monkeypatch):
    code = _code()
    monkeypatch.setattr(ptp, "MAX_PAGES", 1)
    p = _page(work, code, 1, [{"old": "vana", "new": "uus"}])
    with pytest.raises(ptp.ProposalError, match="too_many_pages"):
        ptp.submit(code, "w1", work, [p, p], "")
    monkeypatch.setattr(ptp, "MAX_EDITS", 1)
    with pytest.raises(ptp.ProposalError, match="too_many_edits:t-001"):
        ptp.submit(code, "w1", work, [{**p, "edits": p["edits"] * 2}], "")


# ── Ümberbaseerimine, loetelu, otsused, taaste (Task 4) ──────────────────────

import subprocess

from server import git_ops
from server.page_locks import page_lock_acquire_nowait


@pytest.fixture
def repo(work, monkeypatch):
    root = os.path.dirname(work)
    subprocess.run(["git", "init", "-q", root], check=True)
    subprocess.run(["git", "-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "add", "."], check=True)
    subprocess.run(["git", "-C", root, "-c", "user.name=t", "-c", "user.email=t@t",
                    "commit", "-qm", "v1"], check=True)
    monkeypatch.setattr(git_ops, "BASE_DIR", root)
    return root


def _commit(root):
    subprocess.run(["git", "-C", root, "-c", "user.name=t", "-c", "user.email=t@t",
                    "commit", "-qam", "v2"], check=True)


def _esita(work, n=1, old="vana", new="uus"):
    code = _code()
    return ptp.submit(code, "w1", work, [_page(work, code, n, [{"old": old, "new": new}])], "pakk")["proposal_id"]


def _state(pid, stem="t-001"):
    return {r["stem"]: r["state"] for r in _rows(pid)}[stem]


def test_rebase_puhas():
    assert ptp.rebase("a\nvana\n", "a\nuus\n", "a\nvana\n", []) == "a\nuus\n"


def test_rebase_mujalt_muudetud():
    assert ptp.rebase("a\nvana\nc\nd\n", "a\nuus\nc\nd\n", "a\nvana\nc\nD\n", []) == "a\nuus\nc\nD\n"


def test_rebase_uksik_sulgev_tag_on_kokkuporge():
    base = "<i>a\nx\ny</i>\nz\nw"
    assert ptp.rebase(base, "a\nx\ny\nz\nw", "<i>a\nx\ny\nz\nw</i>", []) is None


def test_rebase_konflikt():
    assert ptp.rebase("a\nvana\n", "a\nuus\n", "a\nmuu\n", []) is None


def test_review_page_uks_hetktommis(work, repo, monkeypatch):
    pid = _esita(work)
    nahtud = []
    orig = ptp.rebase

    def kontroll(*a, **k):
        nahtud.append(page_lock_acquire_nowait(f"{work}/t-001.txt"))
        return orig(*a, **k)
    monkeypatch.setattr(ptp, "rebase", kontroll)
    r = ptp.review_page(pid, "t-001", work)
    assert nahtud == [False]               # liideti lehe luku all
    assert r["state"] == "pending" and r["page"]["text_content"] == _txt(work, 1)
    assert r["proposed_now"] == _txt(work, 1).replace("vana", "uus")


def test_review_page_stale_kui_konflikt(work, repo):
    pid = _esita(work)
    _write(work, 1, "leht 1 muu\nteine rida\n")
    r = ptp.review_page(pid, "t-001", work)
    assert r["state"] == "stale" and r["proposed_now"] is None and _state(pid) == "stale"


def test_taaste_commititud(work, repo):
    pid = _esita(work)
    uus = _txt(work, 1).replace("vana", "uus")
    _write(work, 1, uus)
    _commit(repo)
    r = ptp.review_page(pid, "t-001", work)
    assert r["state"] == "accepted" and _txt(work, 1) == uus


def test_taaste_commitimata_ei_kirjuta(work, repo):
    pid = _esita(work)
    uus = _txt(work, 1).replace("vana", "uus")
    _write(work, 1, uus)
    r = ptp.review_page(pid, "t-001", work)
    assert r["state"] == "pending" and _txt(work, 1) == uus


def test_taaste_git_viga(work, repo, monkeypatch):
    pid = _esita(work)
    _write(work, 1, _txt(work, 1).replace("vana", "uus"))
    _commit(repo)
    monkeypatch.setattr(git_ops, "committed_state", lambda paths: None)
    assert ptp.review_page(pid, "t-001", work)["state"] == "pending"


def test_kustutatud_leht_stale(work, repo):
    pid = _esita(work)
    os.remove(f"{work}/t-001.txt")
    r = ptp.review_page(pid, "t-001", work)
    assert r["state"] == "stale" and r["page"] is None


def test_list_pending_stale_hoiab_paki_loendis(work, repo):
    pid = _esita(work)
    assert [p["proposal_id"] for p in ptp.list_pending("w1")] == [pid]
    _write(work, 1, "leht 1 muu\nteine rida\n")
    ptp.review_page(pid, "t-001", work)
    (p,) = ptp.list_pending()
    assert p["counts"]["stale"] == 1 and p["pages"][0]["page_no"] == 1
    ptp.reject_page(pid, "t-001", "ed")
    assert ptp.list_pending() == []


def test_reject_cas(work):
    pid = _esita(work)
    assert ptp.reject_pack(pid, "ed") == 1
    assert ptp.reject_pack(pid, "ed") == 0
    assert _state(pid) == "rejected"


def test_mark_accepted_ainult_ootel(work):
    pid = _esita(work)
    assert ptp.mark_accepted(pid, ["t-001"], "ed") == 1
    assert ptp.mark_accepted(pid, ["t-001"], "ed") == 0


def test_committed_state_ja_head_bytes(work, repo):
    p = f"{work}/t-001.txt"
    assert git_ops.committed_state([p]) == {p: True}
    _write(work, 1, "muudetud\n")
    assert git_ops.committed_state([p]) == {p: False}
    assert git_ops.head_bytes("slug-w1/t-001.txt") == b"leht 1 vana\nteine rida\n"
    assert git_ops.head_bytes("slug-w1/puudub.txt") is None



def test_slug_kanoniseeritakse_nanoidiks(work):
    """Lõppülevaatus: kõigi teoste koodiga ja slugiga esitatud ettepanek jäi Workspace'ile nähtamatuks."""
    code = _code(None)
    src = ptp.read_source(code, "slug-w1", work, 1)
    assert src["work_id"] == "w1"
    res = ptp.submit(code, "slug-w1", work, [{"stem": "t-001", "text_hash": src["text_hash"],
                                              "edits": [{"old": "vana", "new": "uus"}]}], "")
    assert res["work_id"] == "w1"
    assert [p["proposal_id"] for p in ptp.list_pending("w1")] == [res["proposal_id"]]


# ── Ühtne agendikood /review-l (2026-10-20) ──────────────────────────────────

def test_revoke_code(work):
    ptp.issue_handoff(None, "su", code="k")
    ptp.check_code("k", "w1")
    ptp.revoke_code("k")
    with pytest.raises(ptp.ProposalError):
        ptp.check_code("k", "w1")


def test_tuhistus_ilma_andmebaasita_ei_loo_faili(work):
    ptp.revoke_code("mis-iganes")
    assert not os.path.exists(ptp.DB_PATH)
