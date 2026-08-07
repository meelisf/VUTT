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


# --- ink_profile: pidevus eraldab murdejoone tekstist ---

def test_pidev_tume_joon_annab_korge_pidevuse(tmp_path):
    """Köitemurre: pidev tume joon läbi terve lehe. Mõõdetud päris skännil
    (EAA-tüüpi kirikuraamat): ink 0.45 täpselt murdel, mõlemal pool 0.09."""
    path = _page(tmp_path, "fold.jpg", lambda d: d.rectangle([196, 0, 204, 600], fill=0))
    ink, cont = prepress.ink_profile(path, 0.5)
    assert ink > 0.85
    assert cont > 0.9          # katkematu ülalt alla


def test_tekstiread_annavad_madala_pidevuse(tmp_path):
    """Kiri jookseb joonest üle: tumedad read vahelduvad reavahedega."""
    def draw(d):
        for y in range(60, 560, 40):     # 12 "tekstirida", kõrgus 12 px
            d.rectangle([196, y, 204, y + 12], fill=0)
    path = _page(tmp_path, "text.jpg", draw)
    ink, cont = prepress.ink_profile(path, 0.5)
    assert ink > 0.25          # tinti on
    assert cont < 0.15         # aga katkendlikult — see EI ole murre


def test_puhas_veerg_annab_nulli_molemas(tmp_path):
    """Murdejoonega skänn ei ole ainus tüüp — hele köitevahe peab jääma ok-ks."""
    ink, cont = prepress.ink_profile(_page(tmp_path, "clean2.jpg"), 0.5)
    assert ink < 0.05
    assert cont < 0.05


def test_katkendlik_murre_ei_kvalifitseeru_pidevaks(tmp_path):
    """Poolel lehel murre, teisel pool mitte — servajuht läve ümber."""
    path = _page(tmp_path, "half.jpg", lambda d: d.rectangle([196, 0, 204, 260], fill=0))
    _ink, cont = prepress.ink_profile(path, 0.5)
    assert 0.3 < cont < 0.6    # ligikaudu pool lehest


def test_ink_score_jaab_yhilduvaks_kestaks(tmp_path):
    """Vana ink_score peab andma sama arvu mis ink_profile esimene väärtus."""
    path = _page(tmp_path, "compat.jpg", lambda d: d.rectangle([196, 0, 204, 600], fill=0))
    assert prepress.ink_score(path, 0.5) == prepress.ink_profile(path, 0.5)[0]
