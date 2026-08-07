"""Lehepikslite allikas: käsurea koostamine (PDF) ja PIL-tee (pildikaust)."""
import pytest
from PIL import Image

from server.upload import page_source as ps


# --- PDF: käsurida, mitte päris renderdus ---

def _capture_cmds(monkeypatch):
    """Asendab nice_run'i koguja funktsiooniga; tagastab kogutud käsud.

    Ka _finish vaigistatakse: päris renderdust ei toimu, pdftoppm'i väljundfaili
    ei teki ja _finish tõstaks RuntimeError'i. Siin testime ainult käsurida.
    """
    calls = []
    monkeypatch.setattr(ps, "nice_run", lambda cmd, timeout=0: calls.append(cmd))
    monkeypatch.setattr(ps.PdfPageSource, "_finish", lambda self, base, n, dst: None)
    return calls


def test_render_preview_kasutab_100_dpi_ja_uhte_lehte(monkeypatch, tmp_path):
    calls = _capture_cmds(monkeypatch)
    src = ps.PdfPageSource(str(tmp_path / "x.pdf"))
    src.render_preview(7, str(tmp_path / "out.jpg"))
    cmd = calls[0]
    assert "pdftoppm" in cmd[0]
    assert "-r" in cmd and cmd[cmd.index("-r") + 1] == "100"
    assert cmd[cmd.index("-f") + 1] == "7"
    assert cmd[cmd.index("-l") + 1] == "7"
    assert "-jpeg" in cmd


def test_render_full_kasutab_300_dpi_ja_quality_95(monkeypatch, tmp_path):
    """Peab kattuma OCR-serveri PDF_DPI=300 / quality=95 väärtustega."""
    calls = _capture_cmds(monkeypatch)
    src = ps.PdfPageSource(str(tmp_path / "x.pdf"))
    src.render_full(3, str(tmp_path / "out.jpg"))
    cmd = calls[0]
    assert cmd[cmd.index("-r") + 1] == "300"
    assert "quality=95" in cmd[cmd.index("-jpegopt") + 1]


def test_render_region_annab_x_y_w_h(monkeypatch, tmp_path):
    calls = _capture_cmds(monkeypatch)
    src = ps.PdfPageSource(str(tmp_path / "x.pdf"))
    src.render_region(2, x_px=1000, w_px=240, dst=str(tmp_path / "s.jpg"))
    cmd = calls[0]
    assert cmd[cmd.index("-x") + 1] == "1000"
    assert cmd[cmd.index("-W") + 1] == "240"
    assert cmd[cmd.index("-y") + 1] == "0"
    assert cmd[cmd.index("-H") + 1] == "0"   # 0 = kuni lehe lõpuni


def test_page_count_ei_kustuta_lahtefaili(monkeypatch, tmp_path):
    """file_detection.count_pdf_pages teeb vigase PDF-i korral safe_unlink'i.
    Salvestatud lähtefail peab alles jääma — kasutame kõrvalmõjuta lugejat."""
    pdf = tmp_path / "x.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    monkeypatch.setattr(ps, "_pdfinfo_page_count", lambda path: 42)
    assert ps.PdfPageSource(str(pdf)).page_count() == 42
    assert pdf.exists()


def test_full_width_teisendab_punktid_300_dpi_pikslitesse(monkeypatch, tmp_path):
    monkeypatch.setattr(
        ps, "_pdfinfo_page_size_pts", lambda path, n: (299.52, 538.74)
    )
    src = ps.PdfPageSource(str(tmp_path / "x.pdf"))
    assert src.full_width(1) == round(299.52 * 300 / 72)


# --- Pildikaust: päris PIL ---

@pytest.fixture
def image_dir(tmp_path):
    d = tmp_path / "source"
    d.mkdir()
    for n, (w, h) in enumerate([(400, 300), (500, 300)], start=1):
        Image.new("RGB", (w, h), "white").save(d / f"pg_{n:03d}.jpg", "JPEG")
    return str(d)


def test_pildikaust_loeb_lehed_jarjekorras(image_dir):
    src = ps.ImageDirPageSource(image_dir)
    assert src.page_count() == 2
    assert src.full_width(1) == 400
    assert src.full_width(2) == 500


def test_pildikaust_render_preview_vahendab(image_dir, tmp_path):
    dst = str(tmp_path / "p.jpg")
    ps.ImageDirPageSource(image_dir).render_preview(1, dst)
    with Image.open(dst) as im:
        assert max(im.size) <= ps.PREVIEW_MAX_EDGE


def test_pildikaust_render_region_loikab_natiivselt(image_dir, tmp_path):
    dst = str(tmp_path / "s.jpg")
    ps.ImageDirPageSource(image_dir).render_region(1, x_px=100, w_px=60, dst=dst)
    with Image.open(dst) as im:
        assert im.size == (60, 300)


def test_open_page_source_valib_teostuse(image_dir, tmp_path):
    pdf = tmp_path / "x.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    assert isinstance(ps.open_page_source(str(pdf)), ps.PdfPageSource)
    assert isinstance(ps.open_page_source(image_dir), ps.ImageDirPageSource)


def test_puuduv_leht_toustab_indexerror(image_dir):
    with pytest.raises(IndexError):
        ps.ImageDirPageSource(image_dir).full_width(99)
