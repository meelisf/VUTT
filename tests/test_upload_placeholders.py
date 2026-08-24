"""Viisard peab näitama töö KUJU kohe, mitte alles esimeste valmis lehtede järel.

Kaks muutust:
1. `planned_pages` — mitu lehte OCR-i LÄHEB (poolitusplaani järgi), et
   ruudustik saaks kohe õige arvu kohatäiteid renderdada. Poolitamise ajal on
   `expected_pages` veel LÄHTE-PDF-i lehtede arv (33), mitte väljundi oma (60).
2. Pisipilt tõmmatakse iga kaugserveris oleva JPG-ga, mitte alles siis, kui
   lehe `.txt` on olemas — muidu ei näe kasutaja minuteid mitte midagi.
"""
import json
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

    def getfo(self, path, buf):
        self.gets.append(path)
        buf.write(b"x")

    def close(self):
        pass


@pytest.fixture
def upload(tmp_path, monkeypatch):
    def _make(**yle):
        (tmp_path / "uploads" / "u1" / "thumbs").mkdir(parents=True, exist_ok=True)
        monkeypatch.setattr(upload_thumbs.upload_state, "UPLOADS_DIR", str(tmp_path / "uploads"))
        s = {
            "id": "u1", "status": "processing", "expected_pages": 3,
            "meta": {"slug": "1651-teos"},
            "remote_staging_path": "AUTO-OCR/hand/u1",
            "remote_work_path": "AUTO-OCR/hand/u1/1651-teos",
            "files": [],
        }
        s.update(yle)
        upload_state.write_state("u1", s)
        return "u1"
    return _make


def _plaan(lehti, poolitatavad):
    return {"enabled": True, "pages": [
        {"n": n, "mode": "split" if n in poolitatavad else "nosplit",
         "split_x": 0.5 if n in poolitatavad else None, "excluded": False}
        for n in range(1, lehti + 1)
    ]}


def test_planned_pages_poolitamise_ajal_on_valjundi_arv(upload):
    """Poolitamise ajal on expected_pages LÄHTE-lehtede arv — kohatäiteid on vaja väljundi järgi."""
    uid = upload(status="applying", expected_pages=33, prepress=_plaan(33, {2, 3, 4}))

    res = upload_thumbs.poll_and_sync_thumbs(uid, ocr_server_path="/srv",
                                             sftp_open_func=lambda i: _SFTP({}))

    assert res["planned_pages"] == 36, "33 lehte, 3 poolitust → 36 väljundlehte"


def test_planned_pages_ilma_plaanita_on_expected_pages(upload):
    uid = upload(status="applying", expected_pages=12, prepress=None)

    res = upload_thumbs.poll_and_sync_thumbs(uid, ocr_server_path="/srv",
                                             sftp_open_func=lambda i: _SFTP({}))

    assert res["planned_pages"] == 12


def test_pisipilt_tommatakse_ka_ilma_txt_ita(upload):
    """Pilt ilmub avaldamise tempos; OCR-i valmimine liigub üle nende eraldi."""
    uid = upload()
    work = "/srv/AUTO-OCR/hand/u1/1651-teos"
    sftp = _SFTP({work: ["1651-teos_pg_001.jpg", "1651-teos_pg_001.txt",
                         "1651-teos_pg_002.jpg"]})          # lk 2: OCR alles käib
    loodud = []
    upload_thumbs._create_thumbnail = lambda s, r, tmp, lopp: loodud.append(r)

    res = upload_thumbs.poll_and_sync_thumbs(uid, ocr_server_path="/srv",
                                             sftp_open_func=lambda i: sftp)

    assert any("_pg_002.jpg" in r for r in loodud), "OCR-ita lehe pisipilt peab samuti tulema"
    lehed = {f["page"]: f for f in res["files"]}
    assert lehed[1]["has_ocr"] is True
    assert lehed[2]["has_ocr"] is False, "has_ocr jääb OCR-i märgiks, mitte pildi märgiks"
    assert res["ready"] == 1
