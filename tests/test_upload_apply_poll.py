"""Apply ajal on poll LUGEJA, mitte kirjutaja.

Kolm invarianti (spec 2026-08-31 / ADR 0028):
  I1 — kuni staatus on `applying`, ei muuda poll upload'i põhistaatust.
  I2 — `applying` ajal ei laadi poll ühtki kaug-JPG-d alla.
  expected_pages — `applying`-ust alates on see VÄLJUND-lehtede arv.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.upload import state as upload_state, thumbs as upload_thumbs


class _SFTP:
    def __init__(self, tree):
        self.tree = tree
        self.gets = []

    def listdir(self, path):
        if path not in self.tree:
            raise FileNotFoundError(path)
        return list(self.tree[path])

    def stat(self, path):
        raise FileNotFoundError(path)

    def get(self, remote, local):
        self.gets.append(remote)

    def getfo(self, path, buf):
        buf.write(b"x")

    def close(self):
        pass


@pytest.fixture
def upload(tmp_path, monkeypatch):
    def _make(**yle):
        (tmp_path / "uploads" / "u1" / "thumbs").mkdir(parents=True, exist_ok=True)
        monkeypatch.setattr(
            upload_thumbs.upload_state, "UPLOADS_DIR", str(tmp_path / "uploads")
        )
        s = {
            "id": "u1", "status": "applying", "expected_pages": 2,
            "meta": {"slug": "1651-teos"},
            "remote_staging_path": "AUTO-OCR/hand/u1",
            "remote_work_path": "AUTO-OCR/hand/u1/1651-teos",
            "files": [],
        }
        s.update(yle)
        upload_state.write_state("u1", s)
        return "u1"
    return _make


WORK = "/srv/AUTO-OCR/hand/u1/1651-teos"
KOIK_VALMIS = {WORK: [
    "1651-teos_pg_001.jpg", "1651-teos_pg_001.txt",
    "1651-teos_pg_002.jpg", "1651-teos_pg_002.txt",
]}


def test_i1_applying_ajal_poll_ei_muuda_staatust(upload):
    """Sisendvoog ei ole veel suletud — `done`/`reviewing` kuulub apply-lõimele.

    Ilma selleta kirjutaks ESIMENE poll, mis mõnda JPG-d näeb, staatuse
    `reviewing`-uks keset apply't (`elif all_page_nums`).
    """
    uid = upload(status="applying", expected_pages=2)
    sftp = _SFTP(KOIK_VALMIS)

    res = upload_thumbs.poll_and_sync_thumbs(
        uid, ocr_server_path="/srv", sftp_open_func=lambda i: sftp)

    assert res["status"] == "applying"
    assert upload_state.read_state(uid)["status"] == "applying"


def test_i1_poll_annab_ikkagi_edenemise(upload):
    """Staatust ei muudeta, aga `ready`/`files` peavad kohale jõudma."""
    uid = upload(status="applying", expected_pages=2)
    sftp = _SFTP(KOIK_VALMIS)

    res = upload_thumbs.poll_and_sync_thumbs(
        uid, ocr_server_path="/srv", sftp_open_func=lambda i: sftp)

    assert res["ready"] == 2
    assert len(res["files"]) == 2


def test_i2_applying_ajal_ei_laadita_ainsatki_jpg_d(upload):
    """VUTT ei tõmba tagasi pilte, mille ta ise just saatis.

    Pisipilti lokaalselt EI OLE (fixture jätab thumbs/ tühjaks) — täpselt see
    aken, mis tekib publish_atomic ja write_thumbnail vahel.
    """
    uid = upload(status="applying", expected_pages=2)
    sftp = _SFTP(KOIK_VALMIS)

    upload_thumbs.poll_and_sync_thumbs(
        uid, ocr_server_path="/srv", sftp_open_func=lambda i: sftp)

    assert sftp.gets == [], "applying ajal ei tohi ühtki JPG-d alla laadida"


def test_processing_ajal_laaditakse_ja_staatus_liigub(upload, monkeypatch):
    """`processing`-ust alates on poll jälle täisõiguslik."""
    uid = upload(status="processing", expected_pages=2)
    sftp = _SFTP(KOIK_VALMIS)
    loodud = []
    monkeypatch.setattr(upload_thumbs, "_create_thumbnail",
                        lambda s, r, tmp, dst: loodud.append(r))

    res = upload_thumbs.poll_and_sync_thumbs(
        uid, ocr_server_path="/srv", sftp_open_func=lambda i: sftp)

    assert len(loodud) == 2
    assert res["status"] == "done"


def test_try_begin_applying_seab_valjundlehtede_arvu(tmp_path, monkeypatch):
    """`expected_pages` saab apply alguses ÜHE tähenduse — väljundi arv.

    Ilma selleta peaks `_planned_pages` staatuse järgi arvama, kumb tähendus
    kehtib, ja `applying` eemaldamine PREPRESS_IDLE_STATUSES-ist loeks
    poolitused kaks korda (mõõdetud tootmises: 62 → 89).
    """
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(tmp_path / "uploads"))
    (tmp_path / "uploads" / "u2").mkdir(parents=True)
    upload_state.write_state("u2", {
        "id": "u2", "status": "awaiting_split", "expected_pages": 3,
        "meta": {"slug": "x"},
        "prepress": {"pages": [
            {"n": 1, "mode": "default", "split_x": None, "excluded": False},
            {"n": 2, "mode": "default", "split_x": None, "excluded": False},
            {"n": 3, "mode": "nosplit", "split_x": None, "excluded": False},
        ], "default_split_x": 0.5},
    })

    assert upload_state.try_begin_applying("u2") is True

    s = upload_state.read_state("u2")
    assert s["status"] == "applying"
    assert s["expected_pages"] == 5, "2 poolitatavat → 4, + 1 nosplit = 5"


def test_planned_pages_applying_ajal_ei_topeltloe(upload):
    """`expected_pages` on nüüd juba väljundi arv — plaani ei tohi uuesti rakendada."""
    uid = upload(status="applying", expected_pages=5, prepress={"pages": [
        {"n": 1, "mode": "default", "split_x": None, "excluded": False},
        {"n": 2, "mode": "default", "split_x": None, "excluded": False},
        {"n": 3, "mode": "nosplit", "split_x": None, "excluded": False},
    ], "default_split_x": 0.5})
    sftp = _SFTP({WORK: []})

    res = upload_thumbs.poll_and_sync_thumbs(
        uid, ocr_server_path="/srv", sftp_open_func=lambda i: sftp)

    assert res["planned_pages"] == 5
