"""Köitevahe-riba: x kvantimine ja vahemälu LRU."""
import os
import time

import pytest

from server.upload import prepress


# --- quantize_x ---

def test_kvantimine_annab_pikslikoordinaadi():
    assert prepress.quantize_x(0.5, 4960) == 2480


def test_labilaskvad_x_vaartused_kvantuvad_samaks():
    """0.5001 ja 0.5002 peavad andma SAMA cache-võtme — muidu tekib
    lohistamisel sadu peaaegu identseid faile."""
    assert prepress.quantize_x(0.50001, 4960) == prepress.quantize_x(0.50002, 4960)


def test_kvantimine_ei_luba_serva():
    assert prepress.quantize_x(0.0, 1000) == 1
    assert prepress.quantize_x(1.0, 1000) == 999


def test_erineva_laiusega_lehed_annavad_erineva_pikslikoordinaadi():
    assert prepress.quantize_x(0.5, 2280) == 1140
    assert prepress.quantize_x(0.5, 2344) == 1172


# --- cache ---

@pytest.fixture
def upload(tmp_path, monkeypatch):
    uid = "u1"
    base = tmp_path / uid
    (base / "strips").mkdir(parents=True)
    monkeypatch.setattr(prepress.upload_state, "upload_dir", lambda i: str(base))
    return uid


def test_strip_cache_path_sisaldab_lehte_ja_kvantitud_x_i(upload):
    path = prepress.strip_cache_path(upload, 7, 2480)
    assert os.path.basename(path) == "0007_2480.jpg"


def test_prune_hoiab_ainult_viimased_keep_faili(upload):
    d = prepress.strips_dir(upload)
    for i in range(10):
        p = os.path.join(d, "0003_{}.jpg".format(1000 + i))
        with open(p, "wb") as f:
            f.write(b"x")
        os.utime(p, (time.time() + i, time.time() + i))
    prepress.prune_strip_cache(upload, 3, keep=4)
    remaining = sorted(os.listdir(d))
    assert len(remaining) == 4
    assert remaining[-1] == "0003_1009.jpg"   # uusim alles


def test_prune_ei_puutu_teiste_lehtede_ribasid(upload):
    d = prepress.strips_dir(upload)
    for name in ["0003_1000.jpg", "0003_1001.jpg", "0009_1000.jpg"]:
        with open(os.path.join(d, name), "wb") as f:
            f.write(b"x")
    prepress.prune_strip_cache(upload, 3, keep=1)
    assert "0009_1000.jpg" in os.listdir(d)


def test_get_gutter_strip_kasutab_vahemalu_teisel_kutsel(upload, monkeypatch):
    renders = []

    class FakeSource:
        def full_width(self, n):
            return 4960

        def render_region(self, n, x_px, w_px, dst):
            renders.append((n, x_px, w_px))
            with open(dst, "wb") as f:
                f.write(b"jpg")

    monkeypatch.setattr(prepress, "source_path", lambda uid: "/fake/source.pdf")
    monkeypatch.setattr(
        prepress.page_source, "open_page_source", lambda p: FakeSource()
    )

    first = prepress.get_gutter_strip(upload, 2, 0.5)
    second = prepress.get_gutter_strip(upload, 2, 0.5)
    assert first == second
    assert len(renders) == 1                       # teine kutse tuli vahemälust
    assert renders[0] == (2, 2480 - 248, 2 * 248)  # ±5% laiusest
