import hmac
import hashlib
import os
import time
import pytest


def test_safe_image_path_allows_jpg(tmp_path):
    from server.image_server import _is_safe_image_path
    f = tmp_path / "work" / "page_001.jpg"
    f.parent.mkdir()
    f.touch()
    assert _is_safe_image_path(str(f), str(tmp_path)) is True


def test_safe_image_path_allows_jpeg(tmp_path):
    from server.image_server import _is_safe_image_path
    f = tmp_path / "work" / "scan.jpeg"
    f.parent.mkdir()
    f.touch()
    assert _is_safe_image_path(str(f), str(tmp_path)) is True


def test_safe_image_path_allows_png(tmp_path):
    from server.image_server import _is_safe_image_path
    f = tmp_path / "work" / "page.png"
    f.parent.mkdir()
    f.touch()
    assert _is_safe_image_path(str(f), str(tmp_path)) is True


def test_safe_image_path_blocks_metadata_json(tmp_path):
    from server.image_server import _is_safe_image_path
    f = tmp_path / "work" / "_metadata.json"
    f.parent.mkdir()
    f.touch()
    assert _is_safe_image_path(str(f), str(tmp_path)) is False


def test_safe_image_path_blocks_txt(tmp_path):
    from server.image_server import _is_safe_image_path
    f = tmp_path / "work" / "page_001.txt"
    f.parent.mkdir()
    f.touch()
    assert _is_safe_image_path(str(f), str(tmp_path)) is False


def test_safe_image_path_blocks_page_json(tmp_path):
    from server.image_server import _is_safe_image_path
    f = tmp_path / "work" / "page_001.json"
    f.parent.mkdir()
    f.touch()
    assert _is_safe_image_path(str(f), str(tmp_path)) is False


def test_safe_image_path_blocks_path_outside_base(tmp_path):
    from server.image_server import _is_safe_image_path
    outside = str(tmp_path.parent / "other" / "secret.jpg")
    assert _is_safe_image_path(outside, str(tmp_path)) is False


def test_safe_image_path_blocks_symlink_outside_base(tmp_path):
    from server.image_server import _is_safe_image_path
    outside = tmp_path.parent / "secret.jpg"
    outside.touch()
    link = tmp_path / "work"
    link.mkdir()
    link_file = link / "page.jpg"
    link_file.symlink_to(outside)
    assert _is_safe_image_path(str(link_file), str(tmp_path)) is False


def test_generate_og_image_is_language_neutral_dashboard_crop(tmp_path):
    from PIL import Image
    from server.image_server import generate_og_image

    source_path = tmp_path / "page.jpg"
    output_path = tmp_path / "og.jpg"
    Image.new("RGB", (600, 900), "white").save(source_path)

    assert generate_og_image(str(source_path), str(output_path)) is True

    with Image.open(output_path) as result:
        assert result.size == (1200, 630)
        assert result.format == "JPEG"
        # Keele-neutraalne pilt ei lisa allserva tumedat gradienti ega märgendeid.
        assert sum(result.convert("RGB").getpixel((20, 610))) > 700


def test_get_or_create_og_image_uses_first_page_and_cache(tmp_path):
    from PIL import Image
    from server.image_server import get_or_create_og_image

    work = tmp_path / "work"
    work.mkdir()
    Image.new("RGB", (400, 600), "white").save(work / "page_001.jpg")
    (work / "page_001.json").write_text('{"sequence": 1}', encoding="utf-8")
    (work / "_metadata.json").write_text('{"tags": []}', encoding="utf-8")

    first = get_or_create_og_image(str(work))
    second = get_or_create_og_image(str(work))
    assert first == second
    assert os.path.basename(first) == "_og_v2_page_001.jpg"
    assert os.path.exists(first)


# ---------------------------------------------------------------------------
# Dashboardi kaanepilt (#178)
# ---------------------------------------------------------------------------

def _make_work(tmp_path, pages=3, size=(400, 600)):
    from PIL import Image
    work = tmp_path / "work"
    work.mkdir()
    for i in range(1, pages + 1):
        Image.new("RGB", size, "white").save(work / f"page_00{i}.jpg")
        (work / f"page_00{i}.json").write_text('{"sequence": %d}' % i, encoding="utf-8")
    return work


def test_cover_on_eraldi_versioonitud_fail(tmp_path):
    """Kaanepilt on oma nimeruumis + versioonis, et vanad 560 px coverid uueneksid."""
    from server.image_server import get_or_create_thumbnail, COVER_VERSION

    work = _make_work(tmp_path)
    first = get_or_create_thumbnail(str(work))
    second = get_or_create_thumbnail(str(work))

    assert first == second  # cache
    assert os.path.basename(first) == f"_cover_v{COVER_VERSION}_page_001.jpg"
    assert os.path.exists(first)


def test_cover_on_360px_korgusega(tmp_path):
    """CSS kuvab 160 px; 360 px katab Retina. Varem 560 px."""
    from PIL import Image
    from server.image_server import get_or_create_thumbnail, COVER_HEIGHT

    work = _make_work(tmp_path)
    with Image.open(get_or_create_thumbnail(str(work))) as img:
        assert img.height == COVER_HEIGHT == 360
        assert img.width == 240  # 400x600 → proportsionaalne


def test_cover_ei_kustuta_lehekulje_thumbe(tmp_path):
    """REGRESSIOON: kaane genereerimine glob'is _thumb_*.jpg ja kustutas KÕIK
    leheküljegridi thumbid → iga dashboardi vaatamine sundis Workspace'i neid
    uuesti genereerima."""
    from server.image_server import get_or_create_thumbnail, get_or_create_page_thumbnail

    work = _make_work(tmp_path)
    for i in (1, 2, 3):
        get_or_create_page_thumbnail(str(work), f"_thumb_page_00{i}.jpg")

    get_or_create_thumbnail(str(work))

    thumbs = sorted(os.listdir(work / "_thumbs"))
    assert "_thumb_page_001.jpg" in thumbs
    assert "_thumb_page_002.jpg" in thumbs
    assert "_thumb_page_003.jpg" in thumbs


def test_cover_koristab_ainult_vananenud_coverid(tmp_path):
    """Esilehe muutumisel/versiooni tõstmisel kaob vana cover, lehe-thumbid jäävad."""
    from server.image_server import get_or_create_thumbnail

    work = _make_work(tmp_path)
    thumbs_dir = work / "_thumbs"
    thumbs_dir.mkdir(exist_ok=True)
    (thumbs_dir / "_cover_v0_vana.jpg").write_bytes(b"vana")
    (thumbs_dir / "_thumb_page_002.jpg").write_bytes(b"lehe-thumb")

    current = get_or_create_thumbnail(str(work))

    listing = sorted(os.listdir(thumbs_dir))
    assert "_cover_v0_vana.jpg" not in listing      # vananenud cover koristatud
    assert "_thumb_page_002.jpg" in listing          # lehe-thumb puutumata
    assert os.path.basename(current) in listing


def test_invalidate_cover_kustutab_muudetud_lehe_kaane(tmp_path):
    """Pildi asendamisel/pööramisel invalideeriti kaas varem "tasuta", sest kaas OLI
    esilehe thumb. Eraldi nimeruumiga peab seda tegema selgesõnaliselt — muidu jääb
    dashboardile vana pilt."""
    from server.image_server import get_or_create_thumbnail, invalidate_cover

    work = _make_work(tmp_path)
    cover = get_or_create_thumbnail(str(work))
    assert os.path.exists(cover)

    invalidate_cover(str(work), "page_001.jpg")

    assert not os.path.exists(cover)
    assert os.path.exists(get_or_create_thumbnail(str(work)))  # regenereerub


def test_invalidate_cover_ei_puutu_teise_lehe_muutmisel(tmp_path):
    from server.image_server import get_or_create_thumbnail, invalidate_cover

    work = _make_work(tmp_path)
    cover = get_or_create_thumbnail(str(work))

    invalidate_cover(str(work), "page_002.jpg")

    assert os.path.exists(cover)


def test_cover_on_vaiksem_kui_vana_560px_variant(tmp_path):
    """Mõõdetav eesmärk: ~60% väiksem payload dashboardi kaardi kohta."""
    from server.image_server import generate_thumbnail, get_or_create_thumbnail

    work = _make_work(tmp_path, size=(1200, 1800))
    vana = work / "vana_560.jpg"
    generate_thumbnail(str(work / "page_001.jpg"), str(vana), height=560, quality=85)

    uus = get_or_create_thumbnail(str(work))
    assert os.path.getsize(uus) < os.path.getsize(vana)


# ---------------------------------------------------------------------------
# HMAC tokeni valideerimine
# ---------------------------------------------------------------------------

SECRET = "test-image-secret"


def _make_sig(work_id: str, exp: int) -> str:
    return hmac.new(SECRET.encode(), f"image:{work_id}:{exp}".encode(), hashlib.sha256).hexdigest()


@pytest.fixture(autouse=True)
def patch_image_secret(monkeypatch):
    import server.image_server as img
    monkeypatch.setattr(img, "IMAGE_TOKEN_SECRET", SECRET)


def test_validate_image_token_valid():
    from server.image_server import _validate_image_token
    exp = int(time.time()) + 3600
    sig = _make_sig("work123", exp)
    assert _validate_image_token("work123", str(exp), sig) is True


def test_validate_image_token_expired():
    from server.image_server import _validate_image_token
    exp = int(time.time()) - 1
    sig = _make_sig("work123", exp)
    assert _validate_image_token("work123", str(exp), sig) is False


def test_validate_image_token_wrong_sig():
    from server.image_server import _validate_image_token
    exp = int(time.time()) + 3600
    assert _validate_image_token("work123", str(exp), "bad-sig") is False


def test_validate_image_token_wrong_work():
    from server.image_server import _validate_image_token
    exp = int(time.time()) + 3600
    sig = _make_sig("other-work", exp)
    assert _validate_image_token("work123", str(exp), sig) is False


def test_validate_image_token_missing_params():
    from server.image_server import _validate_image_token
    assert _validate_image_token("work123", "", "") is False
    assert _validate_image_token("work123", "not-a-number", "sig") is False


def test_check_image_access_restricted_work_valid_token():
    from server.image_server import _check_image_access
    exp = int(time.time()) + 3600
    sig = _make_sig("syktl7", exp)
    meta = {"id": "syktl7", "collections": ["col-restricted"], "shareable": False}
    assert _check_image_access("syktl7", meta, f"exp={exp}&sig={sig}") is True


def test_check_image_access_allows_shareable_without_token():
    from server.image_server import _check_image_access
    meta = {"id": "syktl7", "collections": ["col-restricted"], "shareable": True}
    assert _check_image_access("syktl7", meta, "") is True
