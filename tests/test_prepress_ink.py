"""Tindiskoor: kas joon lõikab kirja. Usaldusväärne AINULT kõrge väärtuse suunas."""
from PIL import Image, ImageDraw

from server.upload import prepress


def _page(tmp_path, name, draw_fn=None):
    """Valge A4-laadne leht; draw_fn saab joonistada musta."""
    im = Image.new("L", (400, 600), 255)
    if draw_fn:
        draw_fn(ImageDraw.Draw(im))
    path = str(tmp_path / name)
    im.convert("RGB").save(path, "JPEG", quality=95)
    return path


# --- percentile_from_hist (puhas) ---

def test_percentile_from_hist_uhtlane():
    hist = [0] * 256
    for v in range(256):
        hist[v] = 1
    assert (percentile := prepress.percentile_from_hist(hist, 0.5))
    assert 120 <= percentile <= 135


def test_percentile_from_hist_tyhi():
    assert prepress.percentile_from_hist([0] * 256, 0.35) == 0


# --- ink_score ---

def test_puhas_veerg_annab_madala_skoori(tmp_path):
    path = _page(tmp_path, "clean.jpg")
    assert prepress.ink_score(path, 0.5) < 0.05


def test_must_tulp_teadaoleval_x_il_annab_korge_skoori(tmp_path):
    """Sünteetiline vaste lehele 003: joon jookseb mööda tumedat murdevarju."""
    path = _page(tmp_path, "bar.jpg", lambda d: d.rectangle([196, 0, 204, 600], fill=0))
    assert prepress.ink_score(path, 0.5) > 0.85


def test_skoor_langeb_tulbast_eemale(tmp_path):
    path = _page(tmp_path, "bar2.jpg", lambda d: d.rectangle([196, 0, 204, 600], fill=0))
    assert prepress.ink_score(path, 0.5) > 0.85
    assert prepress.ink_score(path, 0.30) < 0.05


def test_skoor_ignoreerib_lehe_ylemist_ja_alumist_serva(tmp_path):
    """Ülemine/alumine 6% on lehenumbrid ja servad — need ei tohi skoori tõsta."""
    path = _page(tmp_path, "edges.jpg", lambda d: (
        d.rectangle([196, 0, 204, 20], fill=0),
        d.rectangle([196, 580, 204, 600], fill=0),
    ))
    assert prepress.ink_score(path, 0.5) < 0.10


def test_skoor_on_alati_vahemikus_0_1(tmp_path):
    path = _page(tmp_path, "full.jpg", lambda d: d.rectangle([0, 0, 400, 600], fill=0))
    score = prepress.ink_score(path, 0.5)
    assert 0.0 <= score <= 1.0
