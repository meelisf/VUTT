"""Ajaloo-pisipildid: cache versioonitakse lähtefaili järgi (#325).

Failinimi EI OLE muutumatuse garantii: `replace-image` säilitab nime ja kutsub
`clear_original_backup`-i, seega järgmine kärbe loob sama tee alla TEISE pildi.
Ilma versioonita jääks kettale vale pisipilt ja liides näitaks vana.
"""
import os
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import history_thumbs


def _pilt(tee: Path, suurus=(1200, 1600), varv=(10, 20, 30)):
    tee.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", suurus, varv).save(tee, "JPEG", quality=90)


def test_pisipilt_tekib_ja_on_vahendatud(tmp_path, monkeypatch):
    monkeypatch.setattr(history_thumbs, "BASE_DIR", str(tmp_path))
    _pilt(tmp_path / "._trash" / "w1" / "pages" / "leht.jpg")

    tee = history_thumbs.ajaloo_pisipilt("w1", "trash", "leht.jpg")

    assert tee and os.path.isfile(tee)
    with Image.open(tee) as im:
        assert max(im.size) <= history_thumbs.THUMB_MAX_PX


def test_lahtefaili_muutus_annab_uue_pisipildi(tmp_path, monkeypatch):
    """Sama failinimi, uus sisu → uus cache-fail, vana koristatakse."""
    monkeypatch.setattr(history_thumbs, "BASE_DIR", str(tmp_path))
    allikas = tmp_path / "._originals" / "w1" / "leht.jpg"
    _pilt(allikas, varv=(10, 20, 30))
    esimene = history_thumbs.ajaloo_pisipilt("w1", "original", "leht.jpg")

    # Asenda pilt (nagu replace-image + uus kärbe teeb) ja muuda mtime
    _pilt(allikas, varv=(200, 100, 50))
    os.utime(allikas, ns=(os.stat(allikas).st_mtime_ns + 10**9,) * 2)
    teine = history_thumbs.ajaloo_pisipilt("w1", "original", "leht.jpg")

    assert teine != esimene, "cache ei uuenenud lähtefaili muutudes"
    assert not os.path.exists(esimene), "vana pisipilt jäi kettale vedelema"


def test_teekonna_pogenemine_ja_tundmatu_liik(tmp_path, monkeypatch):
    monkeypatch.setattr(history_thumbs, "BASE_DIR", str(tmp_path))
    with pytest.raises(ValueError):
        history_thumbs.ajaloo_pisipilt("w1", "trash", "../../etc/passwd")
    with pytest.raises(ValueError):
        history_thumbs.ajaloo_pisipilt("w1", "muu", "leht.jpg")
    with pytest.raises(ValueError):
        history_thumbs.ajaloo_pisipilt("../w1", "trash", "leht.jpg")


def test_symbollink_lubatud_kaustast_valja_keelatakse(tmp_path, monkeypatch):
    """`_is_safe_image_path` lahendab realpath'i — nimi üksi ei tõesta asukohta."""
    monkeypatch.setattr(history_thumbs, "BASE_DIR", str(tmp_path))
    valine = tmp_path / "valine.jpg"
    _pilt(valine)
    trash = tmp_path / "._trash" / "w1" / "pages"
    trash.mkdir(parents=True)
    (trash / "link.jpg").symlink_to(valine)

    with pytest.raises(ValueError):
        history_thumbs.ajaloo_pisipilt("w1", "trash", "link.jpg")


def test_praeguse_lehe_pisipilt(tmp_path, monkeypatch):
    """Liik `current` = teose enda kaust; tema mtime MUUTUB originaali taastamisel.

    Cache ei tohi maanduda teose kausta SISSE: pildiserver serveerib
    `_metadata.json`-ita kataloogi piiramatuna, seega `{teos}/.thumbs` oleks
    anonüümselt serveeritav ka piiratud kollektsiooni teosele (vt #325 review).
    """
    monkeypatch.setattr(history_thumbs, "BASE_DIR", str(tmp_path))
    töö = tmp_path / "1700-w1"
    _pilt(töö / "leht.jpg")
    monkeypatch.setattr(history_thumbs, "find_directory_by_id", lambda wid: str(töö))

    tee = history_thumbs.ajaloo_pisipilt("w1", "current", "leht.jpg")
    assert tee and os.path.isfile(tee)
    assert not tee.startswith(str(töö)), "pisipildi cache ei tohi olla teose kausta sees"
    assert tee.startswith(str(tmp_path / "._thumbcache" / "w1"))


def test_puuduv_fail_annab_none(tmp_path, monkeypatch):
    monkeypatch.setattr(history_thumbs, "BASE_DIR", str(tmp_path))
    assert history_thumbs.ajaloo_pisipilt("w1", "trash", "ei-ole.jpg") is None
