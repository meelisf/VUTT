"""Pildikausta leht kopeeritakse baithaaval, kui teisendust ei ole.

`ImageDirPageSource.render_full` teeb `convert("RGB").save(quality=95)` — see on
JPEG ümberkodeerimine. Tänane otsetee (`_transfer_images_thread`) saadab
originaalbaidid; ühendamine ei tohi kvaliteeti kaotada.

Vertikaalset mõõdet EI kontrollita: `page_cuts` annab ainult (x0, x1) ja
`_write_cut` lõikab alati täiskõrguse — vertikaalset lõikamist andmemudelis ei
eksisteeri.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.upload import page_source, prepress_apply, state as upload_state


def _pildikaust(tmp_path, exif_orientation=None, nimi="source"):
    kaust = tmp_path / nimi
    kaust.mkdir()
    from PIL import Image
    for i in (1, 2):
        im = Image.new("RGB", (800, 1000), (100, 100 + i * 20, 140))
        if exif_orientation is None:
            im.save(kaust / "lk{}.jpg".format(i), "JPEG", quality=88)
        else:
            exif = im.getexif()
            exif[274] = exif_orientation          # 274 = Orientation
            im.save(kaust / "lk{}.jpg".format(i), "JPEG", quality=88,
                    exif=exif.tobytes())
    return kaust


def _plaan(mode="nosplit"):
    return {"default_split_x": 0.5, "pages": [
        {"n": 1, "mode": mode, "split_x": None, "excluded": False},
        {"n": 2, "mode": mode, "split_x": None, "excluded": False},
    ]}


def test_source_file_annab_pildikausta_tee(tmp_path):
    src = page_source.open_page_source(str(_pildikaust(tmp_path)))
    assert src.source_file(1).endswith("lk1.jpg")


def test_source_file_on_none_pdf_i_korral(tmp_path):
    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    src = page_source.open_page_source(str(pdf))
    assert src.source_file(1) is None


def test_identity_loige_lubab_baitkoopia(tmp_path):
    src = page_source.open_page_source(str(_pildikaust(tmp_path)))
    assert prepress_apply.can_copy_source_bytes(src, _plaan(), 1, 800) is True


def test_poolitus_ei_luba_baitkoopiat(tmp_path):
    src = page_source.open_page_source(str(_pildikaust(tmp_path)))
    assert prepress_apply.can_copy_source_bytes(src, _plaan("default"), 1, 800) is False


def test_valjajaetud_leht_ei_luba_baitkoopiat(tmp_path):
    """Väljajäetud lehele annab page_cuts tühja listi — avaldada ei ole midagi."""
    src = page_source.open_page_source(str(_pildikaust(tmp_path)))
    plaan = _plaan()
    plaan["pages"][0]["excluded"] = True
    assert prepress_apply.can_copy_source_bytes(src, plaan, 1, 800) is False


def test_exif_poore_ei_luba_baitkoopiat(tmp_path):
    """PIL viskab EXIF-i ära; baithaaval koopia säilitab selle. Kaks teed
    annaksid erineva nähtava orientatsiooni."""
    src = page_source.open_page_source(str(_pildikaust(tmp_path, exif_orientation=6)))
    assert prepress_apply.can_copy_source_bytes(src, _plaan(), 1, 800) is False


def test_exif_orientation_1_lubab_baitkoopia(tmp_path):
    src = page_source.open_page_source(str(_pildikaust(tmp_path, exif_orientation=1)))
    assert prepress_apply.can_copy_source_bytes(src, _plaan(), 1, 800) is True


def test_pdf_ei_luba_kunagi_baitkoopiat(tmp_path):
    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    src = page_source.open_page_source(str(pdf))
    assert prepress_apply.can_copy_source_bytes(src, _plaan(), 1, 800) is False


def test_kiirtee_avaldab_originaalbaidid(tmp_path, monkeypatch):
    """Avaldatud fail peab olema BAIT-IDENTNE lähtefailiga."""
    uploads = tmp_path / "uploads"
    (uploads / "u1" / "thumbs").mkdir(parents=True)
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(uploads))
    upload_state.write_state("u1", {"id": "u1", "status": "applying",
                                    "meta": {"slug": "x"}, "prepress": _plaan()})

    kaust = _pildikaust(tmp_path)
    monkeypatch.setattr(prepress_apply.prepress, "source_path", lambda uid: str(kaust))

    avaldatud = []

    class _S:
        def close(self):
            pass

    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda uid: _S())
    monkeypatch.setattr(prepress_apply.ocr_client, "ensure_remote_dirs",
                        lambda s, d: None)
    monkeypatch.setattr(prepress_apply, "publish_atomic",
                        lambda s, local, remote: avaldatud.append(local))

    sent = prepress_apply._transfer_pages(
        "u1", "x", ("/srv/st", "/srv/st/w"), "/srv/st/w", _plaan())

    assert sent == 2
    assert Path(avaldatud[0]).read_bytes() == (kaust / "lk1.jpg").read_bytes()
    assert sorted(p.name for p in (uploads / "u1" / "thumbs").glob("*.jpg")) == [
        "001.jpg", "002.jpg"], "kiirtee peab samuti pisipildi kirjutama"
