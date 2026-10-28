"""ADR 0073: kogu lehte katva skannipildiga PDF-lehte ei venitata üle allika ppi.

Otsus on puhas funktsioon (`scan_render_dpi`) `pdfimages -list` ja lehe suuruse
peal; päris PDF-iga testid kontrollivad, et poppler annab otsusele sama sisendi.
"""
import shutil

import pytest
from PIL import Image

from server.upload import page_source as ps

PAIS = (
    "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio\n"
    "--------------------------------------------------------------------------------------------\n"
)


def _rida(tyyp, w, h, xppi, yppi, page=1, num=0):
    return "{:>4} {:>5}  {:<6} {:>5} {:>6}  rgb     3   8  jpeg   no       221  0 {:>5} {:>5}  600K 5.1%\n".format(
        page, num, tyyp, w, h, xppi, yppi)


# --- parsimine ---

def test_parsib_pdfimages_listi_ja_jatab_maskid_valja():
    tekst = PAIS + _rida("image", 1753, 2298, 72, 72) + _rida("smask", 1753, 2298, 72, 72, num=1)
    assert ps.parse_pdfimages_list(tekst) == [(1753, 2298, 72.0, 72.0)]


def test_parsib_lehe_suuruse():
    tekst = "Page    5 size: 1753.2 x 2298 pts\nPage    5 rot:  0\n"
    assert ps.parse_page_size(tekst, 5) == (1753.2, 2298.0)


# --- otsus ---

def test_72_ppi_skann_renderdatakse_allika_ppi_ga():
    """BSB: 1753 × 2298 px märgitud 72 ppi-ks → leht väidab 24 × 32 tolli."""
    dpi, pohjus = ps.scan_render_dpi([(1753, 2298, 72.0, 72.0)], (1753, 2298))
    assert dpi == 72
    assert pohjus == "skann"


def test_600_ppi_skann_jaab_300_peale():
    dpi, _ = ps.scan_render_dpi([(4960, 7016, 600.0, 600.0)], (595, 842))
    assert dpi == 300


def test_telgede_erinev_ppi_valib_vaiksema():
    """Kumbagi telge ei suurendata — väiksema ppi-ga telg määrab."""
    dpi, _ = ps.scan_render_dpi([(1753, 4596, 72.0, 144.0)], (1753, 2298))
    assert dpi == 72


def test_pildita_leht_on_digitaalne_300():
    assert ps.scan_render_dpi([], (595, 842)) == (300, "pilti ei ole")


def test_osaline_pilt_digitaalsel_lehel_jaab_300_peale():
    """Tekst + 72 ppi foto: piiramine halvendaks teksti ja OCR-i."""
    foto = (200, 150, 72.0, 72.0)  # 2,8 × 2,1 tolli A4 lehel
    assert ps.scan_render_dpi([foto], (595, 842)) == (300, "pilt katab osa lehest")


def test_mitu_pilti_jaab_300_peale():
    """72 ppi põhiskann + 600 ppi lisapilt: kumbki ei esinda lehte üksi."""
    pildid = [(1753, 2298, 72.0, 72.0), (600, 600, 600.0, 600.0)]
    assert ps.scan_render_dpi(pildid, (1753, 2298)) == (300, "mitu pilti")


def test_puuduv_ppi_on_ebakindel():
    assert ps.scan_render_dpi([(1753, 2298, 0.0, 0.0)], (1753, 2298)) == (300, "ppi puudub")


def test_pilt_ulatub_veidi_lehest_ule_on_ikka_skann():
    """Kärbitud skann (pilt suurem kui leht) — katab lehe, on skann."""
    dpi, pohjus = ps.scan_render_dpi([(1800, 2350, 72.0, 72.0)], (1753, 2298))
    assert (dpi, pohjus) == (72, "skann")


# --- render_full käsurida ---

def test_render_full_kasutab_valitud_ppi_d(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(ps, "nice_run", lambda cmd, timeout=0: calls.append(cmd))
    monkeypatch.setattr(ps.PdfPageSource, "_finish", lambda self, base, n, dst: None)
    monkeypatch.setattr(ps.PdfPageSource, "_scan_dpi", lambda self, n: (72, "skann"))
    info = ps.PdfPageSource(str(tmp_path / "x.pdf")).render_full(3, str(tmp_path / "o.jpg"))
    cmd = calls[0]
    assert cmd[cmd.index("-r") + 1] == "72"
    assert info == {"dpi": 72, "reason": "skann"}


def test_tuvastuse_viga_ei_kukuta_renderdust(monkeypatch, tmp_path):
    """pdfimages/pdfinfo tõrge → 300 ppi nagu enne, mitte apply viga."""
    calls = []
    monkeypatch.setattr(ps, "nice_run", lambda cmd, timeout=0: calls.append(cmd))
    monkeypatch.setattr(ps.PdfPageSource, "_finish", lambda self, base, n, dst: None)

    def katki(*a, **k):
        raise OSError("pdfimages puudub")
    monkeypatch.setattr(ps, "_run_text", katki)
    info = ps.PdfPageSource(str(tmp_path / "x.pdf")).render_full(1, str(tmp_path / "o.jpg"))
    assert calls[0][calls[0].index("-r") + 1] == "300"
    assert info["dpi"] == 300


# --- päris PDF (poppler) ---

poppler = pytest.mark.skipif(not shutil.which("pdfimages"), reason="poppler-utils puudub")


@poppler
def test_parane_72_ppi_pdf_renderdub_allika_suuruses(tmp_path):
    """PIL salvestab pildi 72 ppi PDF-iks täislehena — nagu BSB."""
    pdf = tmp_path / "bsb.pdf"
    Image.new("RGB", (400, 520), "white").save(pdf, "PDF", resolution=72)
    src = ps.PdfPageSource(str(pdf))
    dst = tmp_path / "o.jpg"
    info = src.render_full(1, str(dst))
    assert info == {"dpi": 72, "reason": "skann"}
    with Image.open(dst) as im:
        assert im.size == (400, 520)  # mitte 1667 × 2167


@poppler
def test_parane_300_ppi_pdf_ei_muutu(tmp_path):
    pdf = tmp_path / "s.pdf"
    Image.new("RGB", (600, 900), "white").save(pdf, "PDF", resolution=300)
    dst = tmp_path / "o.jpg"
    info = ps.PdfPageSource(str(pdf)).render_full(1, str(dst))
    assert info["dpi"] == 300
    with Image.open(dst) as im:
        assert im.size == (600, 900)
