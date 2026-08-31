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
    return {"pages": [
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


def test_planned_pages_EI_topeltloe_poolitusi_parast_apply_d(upload):
    """Pärast apply'd ON `expected_pages` juba väljundi arv — plaani ei tohi uuesti rakendada.

    Tootmises 2026-08-24: 62-leheline töö sai planned_pages=89 ja viisard
    renderdas 27 fantoomkohatäidet, mis ei täitunud kunagi.
    """
    uid = upload(status="reviewing", expected_pages=62, prepress=_plaan(44, {1, 2, 3}))

    res = upload_thumbs.poll_and_sync_thumbs(uid, ocr_server_path="/srv",
                                             sftp_open_func=lambda i: _SFTP({}))

    assert res["planned_pages"] == 62


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


# =========================================================
# „OCR seisab" ei tohi ilmuda valmis tööl (#250 järelleid)
# =========================================================

def test_valmis_too_ei_ole_seisnud(tmp_path, monkeypatch):
    """48 valmis + 12 lõplikult ebaõnnestunud = 60 lahendatud ehk VALMIS.

    `list_upload_states` luges ainult `has_ocr` lehti, seega vigadega töö jäi
    igaveseks „OCR seisab" märgi alla — kõrvuti teatega „Valmis". Sama viga, mis
    poll'is juba parandatud (ready + failed), aga teises kohas.
    """
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(tmp_path))
    (tmp_path / "u9").mkdir()
    failid = ([{"page": n, "has_ocr": True, "deleted": False} for n in range(1, 49)]
              + [{"page": n, "has_ocr": False, "deleted": False,
                  "ocr_error": "mudel: KordusLoop: periood 2 sõna, 16 kordust"}
                 for n in range(49, 61)])
    (tmp_path / "u9" / "state.json").write_text(json.dumps({
        "id": "u9", "status": "done", "expected_pages": 60,
        "created_at": "2026-08-24T10:00:00",
        "last_progress_at": 1.0,          # ammu
        "files": failid,
    }), encoding="utf-8")

    seis = upload_state.list_upload_states()[0]

    assert seis["stalled"] is False, "lõplikult ebaõnnestunud leht ON lahendatud"


def test_pooleliolev_too_on_endiselt_seisnud(tmp_path, monkeypatch):
    """Regressioon: päris seisak peab endiselt nähtav olema."""
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(tmp_path))
    (tmp_path / "u8").mkdir()
    (tmp_path / "u8" / "state.json").write_text(json.dumps({
        "id": "u8", "status": "processing", "expected_pages": 60,
        "created_at": "2026-08-24T10:00:00",
        "last_progress_at": 1.0,
        "files": [{"page": n, "has_ocr": True, "deleted": False} for n in range(1, 10)],
    }), encoding="utf-8")

    assert upload_state.list_upload_states()[0]["stalled"] is True


# =========================================================
# has_thumb — PILDI märk, eraldi OCR-i märgist
# =========================================================
#
# `has_ocr` ütleb, kas lehel on TEKST. Viisard vajab eraldi vastust
# küsimusele „kas pisipilt on VUTT-i kettal" — muidu peab ta pildi
# gate'ima `has_ocr` taha ja kasutaja ei näe minuteid juba alla
# laaditud pilte (mõõdetud 2026-08-31: kõik 35 pisipilti kettal
# 12:51:40, viimane nähtav alles ~12:55).
#
# `has_ocr`-i EI TOHI selleks ära kasutada ka vastupidi: pildita
# `<img src>` annab 404 ja jääb PÜSIVALT katki — poll uuendab olekut,
# aga `src` string ei muutu, seega brauser ei proovi uuesti.


def test_has_thumb_on_tosi_ka_ilma_txt_ita(upload, monkeypatch):
    """Pisipilt on kettal → viisard tohib selle kohe näidata, OCR-i ootamata."""
    uid = upload()
    work = "/srv/AUTO-OCR/hand/u1/1651-teos"
    sftp = _SFTP({work: ["1651-teos_pg_001.jpg", "1651-teos_pg_001.txt",
                         "1651-teos_pg_002.jpg"]})          # lk 2: OCR alles käib
    monkeypatch.setattr(upload_thumbs, "_create_thumbnail",
                        lambda s, r, tmp, lopp: None)

    res = upload_thumbs.poll_and_sync_thumbs(uid, ocr_server_path="/srv",
                                             sftp_open_func=lambda i: sftp)

    lehed = {f["page"]: f for f in res["files"]}
    assert lehed[2]["has_thumb"] is True, "pilt on olemas, kuigi OCR alles käib"
    assert lehed[2]["has_ocr"] is False, "has_thumb ei tohi has_ocr-i tähendust muuta"


def test_has_thumb_on_vale_kui_allalaadimine_kukkus(upload, monkeypatch):
    """Ebaõnnestunud allalaadimine ei tohi lubada `<img>`-i, mis 404-b püsivalt."""
    uid = upload()
    work = "/srv/AUTO-OCR/hand/u1/1651-teos"
    sftp = _SFTP({work: ["1651-teos_pg_001.jpg", "1651-teos_pg_001.txt"]})

    def _kukub(s, r, tmp, lopp):
        raise OSError("SFTP katkes")

    monkeypatch.setattr(upload_thumbs, "_create_thumbnail", _kukub)

    res = upload_thumbs.poll_and_sync_thumbs(uid, ocr_server_path="/srv",
                                             sftp_open_func=lambda i: sftp)

    lehed = {f["page"]: f for f in res["files"]}
    assert lehed[1]["has_thumb"] is False, "pilti ei ole — viisard peab näitama ootemärki"
    assert lehed[1]["has_ocr"] is True, "OCR on ikka valmis"
