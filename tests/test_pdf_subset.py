"""PDF-i alamhulk poppleriga: väljajäetud lehed ei tohi väljundisse jõuda."""
import subprocess

import pytest
from PIL import Image

from server.upload import pdf_subset


def _make_pdf(path, page_count):
    """Pillow oskab mitmelehelist PDF-i — päris fail, mitte mock."""
    pages = [Image.new("RGB", (60, 80), "white") for _ in range(page_count)]
    pages[0].save(str(path), save_all=True, append_images=pages[1:])


def _page_count(path):
    out = subprocess.run(["pdfinfo", str(path)], stdout=subprocess.PIPE, check=True)
    for line in out.stdout.decode().splitlines():
        if line.startswith("Pages:"):
            return int(line.split()[1])
    raise AssertionError("pdfinfo ei andnud lehtede arvu")


def test_alamhulk_sisaldab_ainult_soovitud_lehti(tmp_path):
    src = tmp_path / "src.pdf"
    _make_pdf(src, 5)
    dst = tmp_path / "out.pdf"

    written = pdf_subset.build_subset_pdf(str(src), [1, 3, 5], str(dst))

    assert written == 3
    assert _page_count(dst) == 3


def test_koik_lehed_alles_annab_sama_arvu(tmp_path):
    src = tmp_path / "src.pdf"
    _make_pdf(src, 3)
    dst = tmp_path / "out.pdf"
    assert pdf_subset.build_subset_pdf(str(src), [1, 2, 3], str(dst)) == 3


def test_tuhi_valik_on_viga(tmp_path):
    src = tmp_path / "src.pdf"
    _make_pdf(src, 2)
    with pytest.raises(ValueError):
        pdf_subset.build_subset_pdf(str(src), [], str(tmp_path / "out.pdf"))


def test_vigane_pdf_annab_runtimeerrori(tmp_path):
    """Varutee päästik: kutsuja peab saama PÜÜTAVA erandi, mitte krahhi."""
    src = tmp_path / "katki.pdf"
    src.write_bytes(b"%PDF-1.4\nsee ei ole pdf\n")
    with pytest.raises(RuntimeError):
        pdf_subset.build_subset_pdf(str(src), [1], str(tmp_path / "out.pdf"))


def test_ajutine_kaust_koristatakse(tmp_path):
    src = tmp_path / "src.pdf"
    _make_pdf(src, 4)
    dst = tmp_path / "out.pdf"
    pdf_subset.build_subset_pdf(str(src), [2, 3], str(dst))
    # Ainult lähte- ja sihtfail; pdfseparate'i üksiklehed on kadunud.
    assert sorted(p.name for p in tmp_path.iterdir()) == ["out.pdf", "src.pdf"]
