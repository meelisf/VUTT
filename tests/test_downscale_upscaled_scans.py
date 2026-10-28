"""#666: venitatud skannide vähendamise tõend (IIIF-lõuendite nihe)."""
import importlib.util
import os

_PATH = os.path.join(os.path.dirname(__file__), "..", "scripts", "downscale_upscaled_scans.py")
_spec = importlib.util.spec_from_file_location("downscale_upscaled_scans", _PATH)
dus = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dus)


def _venitatud(cw, ch):
    return round(cw * 300 / 72), round(ch * 300 / 72)


def test_leiab_eest_eemaldatud_lehe_nihke():
    """Fail 002 ↔ lõuend 1 (esimene tühi leht kustutatud) → nihe −1."""
    canvases = [(1700 + i, 2080 - i) for i in range(20)]
    pages = [(n, _venitatud(*canvases[n - 2])) for n in range(2, 20)]
    off, n_ok, med = dus.choose_offset(pages, canvases)
    assert off == -1
    assert n_ok == len(pages)
    assert abs(med - 1) < 0.01


def test_juba_vahendatud_leht_ei_klapi():
    """Kordusjooks: 300/72 võrra väiksem leht ei tõenda 72 ppi allikat."""
    canvases = [(1700, 2080)] * 10
    pages = [(n, (1700, 2080)) for n in range(1, 10)]
    off, n_ok, med = dus.choose_offset(pages, canvases)
    assert n_ok == 0
    assert med < 0.5


def test_bsb_id():
    assert dus.bsb_id("https://www.digitale-sammlungen.de/view/bsb10365835?page=%2C1") == "bsb10365835"
    assert dus.bsb_id("https://example.org/x") is None
