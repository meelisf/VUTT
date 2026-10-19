"""Agendi lehe teksti ettepanekud (#641, ADR 0058 täiendus): kood → toortekst →
asendused → ootel ettepanek. Esitus EI muuda lehte."""
import hashlib
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
    with pytest.raises(ptp.ProposalError, match="invalid_or_expired_handoff"):
        ptp.read_source(code, "muu", work, 1)
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
