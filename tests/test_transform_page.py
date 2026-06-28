"""Testid lehe pildi teisendusele (pööra/kärbi)."""
import sys
import json
import pytest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture
def tf_work(tmp_path, monkeypatch):
    """Testtöö ühe 200x100 JPEG lehega."""
    from PIL import Image as PILImage
    import server.admin_page_ops as aps

    wid = "tfwork1"
    folder = tmp_path / "1700-tf-work"
    folder.mkdir()
    fname = "1700-tf-work-tfwork1-pg001.jpg"
    PILImage.new("RGB", (200, 100), color=(180, 90, 40)).save(str(folder / fname), "JPEG", quality=95)
    (folder / (fname[:-4] + ".txt")).write_text("Tekst.", encoding="utf-8")
    (folder / (fname[:-4] + ".json")).write_text(json.dumps({"sequence": 100, "status": "Toores"}), encoding="utf-8")

    monkeypatch.setattr(aps, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(aps, "find_directory_by_id", lambda w: str(folder) if w == wid else None)
    return {"folder": folder, "work_id": wid, "filename": fname}


def test_compute_crop_box_clamps_and_validates():
    from server.admin_page_ops import _compute_crop_box
    # Normaalne kärbe
    assert _compute_crop_box({"x": 0.0, "y": 0.0, "w": 0.5, "h": 1.0}, 200, 100) == (0, 0, 100, 100)
    # None → None
    assert _compute_crop_box(None, 200, 100) is None
    # Liiga väike pärast klampimist → ValueError
    with pytest.raises(ValueError):
        _compute_crop_box({"x": 0.0, "y": 0.0, "w": 0.001, "h": 1.0}, 200, 100)


def test_transform_rotate_90_changes_dimensions(tf_work):
    from PIL import Image as PILImage
    from server.admin_page_ops import transform_page_image
    r = transform_page_image(tf_work["work_id"], tf_work["filename"], angle=90.0, username="admin")
    assert r["success"] is True and r["changed"] is True
    with PILImage.open(str(tf_work["folder"] / tf_work["filename"])) as im:
        # 200x100 → 90° → 100x200 (expand=True)
        assert (im.width, im.height) == (100, 200)


def test_transform_backup_is_old_image_before_overwrite(tf_work):
    from PIL import Image as PILImage
    from server.admin_page_ops import transform_page_image
    transform_page_image(tf_work["work_id"], tf_work["filename"], angle=90.0, username="admin")
    trash = tf_work["folder"].parent / "._trash" / tf_work["work_id"] / "replaced_images"
    backups = list(trash.glob("*"))
    assert len(backups) == 1
    with PILImage.open(str(backups[0])) as im:
        assert (im.width, im.height) == (200, 100)  # VANA pilt, mitte uus


def test_transform_writes_pristine_original_once(tf_work):
    from server.admin_page_ops import transform_page_image
    transform_page_image(tf_work["work_id"], tf_work["filename"], angle=90.0, username="admin")
    orig = tf_work["folder"].parent / "._originals" / tf_work["work_id"] / tf_work["filename"]
    assert orig.exists()
    mtime1 = orig.stat().st_mtime_ns
    transform_page_image(tf_work["work_id"], tf_work["filename"], angle=90.0, username="admin")
    assert orig.stat().st_mtime_ns == mtime1  # EI kirjutatud teist korda üle


def test_transform_noop_returns_unchanged(tf_work):
    from server.admin_page_ops import transform_page_image
    r = transform_page_image(tf_work["work_id"], tf_work["filename"], angle=0.0, crop=None, username="admin")
    assert r == {"success": True, "changed": False, "reason": "no_transform"}


def test_transform_unknown_work_returns_found_false(tf_work):
    from server.admin_page_ops import transform_page_image
    assert transform_page_image("nope", tf_work["filename"], angle=90.0) == {"found": False}


def test_transform_path_traversal_rejected(tf_work):
    from server.admin_page_ops import transform_page_image
    with pytest.raises(ValueError):
        transform_page_image(tf_work["work_id"], "../secret.jpg", angle=90.0)


def test_clear_original_backup_removes_pristine(tf_work):
    """Pärast transform'i tekib ._originals; clear_original_backup eemaldab selle."""
    from server.admin_page_ops import transform_page_image, clear_original_backup
    transform_page_image(tf_work["work_id"], tf_work["filename"], angle=90.0, username="admin")
    orig = tf_work["folder"].parent / "._originals" / tf_work["work_id"] / tf_work["filename"]
    assert orig.exists()
    clear_original_backup(tf_work["work_id"], tf_work["filename"])
    assert not orig.exists()


def test_clear_original_backup_ignores_traversal(tf_work):
    from server.admin_page_ops import clear_original_backup
    # Ei tohi visata ega midagi kustutada
    clear_original_backup(tf_work["work_id"], "../../etc/passwd")


def test_transform_endpoint_401_no_auth(backend_env):
    r = backend_env["client"].post("/admin/work/w1/page-image/a.jpg/transform", json={"angle": 90})
    assert r.status_code == 401


def test_transform_endpoint_400_bad_crop(backend_env, login, monkeypatch):
    from server.routers import pages as pages_router

    def _raise(*a, **kw):
        raise ValueError("kärbe liiga väike")
    monkeypatch.setattr(pages_router, "transform_page_image", _raise)

    token = login("admin", "adminpass")
    r = backend_env["client"].post(
        "/admin/work/w1/page-image/a.jpg/transform",
        json={"angle": 0, "crop": {"x": 0, "y": 0, "w": 0.001, "h": 1}},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400


def test_transform_endpoint_404_unknown(backend_env, login, monkeypatch):
    from server.routers import pages as pages_router
    monkeypatch.setattr(pages_router, "transform_page_image", lambda *a, **kw: {"found": False})
    token = login("admin", "adminpass")
    r = backend_env["client"].post(
        "/admin/work/x/page-image/a.jpg/transform",
        json={"angle": 90},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404


def test_transform_endpoint_200(backend_env, login, monkeypatch):
    from server.routers import pages as pages_router
    monkeypatch.setattr(
        pages_router, "transform_page_image",
        lambda *a, **kw: {"success": True, "changed": True, "filename": "a.jpg", "size": [100, 200], "thumbnail_warning": False},
    )
    token = login("admin", "adminpass")
    r = backend_env["client"].post(
        "/admin/work/w1/page-image/a.jpg/transform",
        json={"angle": 90, "crop": None},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["changed"] is True


def test_validate_quad_accepts_valid_square():
    from server.admin_page_ops import _validate_quad
    pts = _validate_quad([{"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.1},
                          {"x": 0.9, "y": 0.9}, {"x": 0.1, "y": 0.9}])
    assert pts == [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)]


def test_validate_quad_wrong_count():
    from server.admin_page_ops import _validate_quad
    with pytest.raises(ValueError):
        _validate_quad([{"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.1}, {"x": 0.9, "y": 0.9}])


def test_validate_quad_out_of_range():
    from server.admin_page_ops import _validate_quad
    with pytest.raises(ValueError):
        _validate_quad([{"x": -0.1, "y": 0.1}, {"x": 0.9, "y": 0.1},
                        {"x": 0.9, "y": 0.9}, {"x": 0.1, "y": 0.9}])


def test_validate_quad_too_short_edge():
    from server.admin_page_ops import _validate_quad
    with pytest.raises(ValueError):
        _validate_quad([{"x": 0.5, "y": 0.5}, {"x": 0.505, "y": 0.5},
                        {"x": 0.9, "y": 0.9}, {"x": 0.1, "y": 0.9}])


def test_validate_quad_bowtie_rejected():
    from server.admin_page_ops import _validate_quad
    with pytest.raises(ValueError):
        _validate_quad([{"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.1},
                        {"x": 0.1, "y": 0.9}, {"x": 0.9, "y": 0.9}])


def test_validate_quad_nan_rejected():
    from server.admin_page_ops import _validate_quad
    with pytest.raises(ValueError):
        _validate_quad([{"x": float("nan"), "y": 0.1}, {"x": 0.9, "y": 0.1},
                        {"x": 0.9, "y": 0.9}, {"x": 0.1, "y": 0.9}])


def test_dist_euclidean():
    from server.admin_page_ops import dist
    assert dist((0.0, 0.0), (3.0, 4.0)) == 5.0


@pytest.fixture
def quad_work(tmp_path, monkeypatch):
    """Testtöö 100x100 pildiga, mille 4 nurka on erivärvi (mirror/järjekorra test)."""
    from PIL import Image as PILImage
    import server.admin_page_ops as aps

    wid = "quadwork1"
    folder = tmp_path / "1700-quad-work"
    folder.mkdir()
    fname = "1700-quad-work-quadwork1-pg001.jpg"
    img = PILImage.new("RGB", (100, 100), color=(0, 0, 0))
    px = img.load()
    for y in range(12):
        for x in range(12):
            px[x, y] = (255, 0, 0)
            px[99 - x, y] = (0, 255, 0)
            px[99 - x, 99 - y] = (0, 0, 255)
            px[x, 99 - y] = (255, 255, 0)
    img.save(str(folder / fname), "JPEG", quality=100)
    (folder / (fname[:-4] + ".txt")).write_text("T.", encoding="utf-8")
    (folder / (fname[:-4] + ".json")).write_text(json.dumps({"sequence": 100}), encoding="utf-8")

    monkeypatch.setattr(aps, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(aps, "find_directory_by_id", lambda w: str(folder) if w == wid else None)
    return {"folder": folder, "work_id": wid, "filename": fname}


def _corner_colors(im):
    """Tagastab (TL, TR, BR, BL) värvid pildi nurkadest (väikese sissenihkega)."""
    w, h = im.width, im.height
    return (im.getpixel((2, 2)), im.getpixel((w - 3, 2)),
            im.getpixel((w - 3, h - 3)), im.getpixel((2, h - 3)))


def _dominant(c):
    """Lihtsustab RGB domineerivaks sildiks (kompressiooni tolerantsiga)."""
    r, g, b = c[0], c[1], c[2]
    if r > 150 and g > 150:
        return "yellow"
    if r > 150:
        return "red"
    if g > 150:
        return "green"
    if b > 150:
        return "blue"
    return "black"


def test_transform_quad_preserves_corner_orientation(quad_work):
    """Täis-pildi quad (identiteet) → nurgavärvid jäävad õigesse kohta (mirror/järjekord)."""
    from PIL import Image as PILImage
    from server.admin_page_ops import transform_page_image
    full_quad = [{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0},
                 {"x": 1.0, "y": 1.0}, {"x": 0.0, "y": 1.0}]
    r = transform_page_image(quad_work["work_id"], quad_work["filename"], quad=full_quad, username="admin")
    assert r["success"] and r["changed"]
    with PILImage.open(str(quad_work["folder"] / quad_work["filename"])) as im:
        tl, tr, br, bl = (_dominant(c) for c in _corner_colors(im))
        assert (tl, tr, br, bl) == ("red", "green", "blue", "yellow")


def test_transform_quad_output_dimensions(quad_work):
    """Quad keskmistest servapikkustest → väljundi mõõt."""
    from PIL import Image as PILImage
    from server.admin_page_ops import transform_page_image
    quad = [{"x": 0.0, "y": 0.0}, {"x": 0.5, "y": 0.0},
            {"x": 0.5, "y": 1.0}, {"x": 0.0, "y": 1.0}]
    transform_page_image(quad_work["work_id"], quad_work["filename"], quad=quad, username="admin")
    with PILImage.open(str(quad_work["folder"] / quad_work["filename"])) as im:
        assert abs(im.width - 50) <= 1
        assert abs(im.height - 100) <= 1


def test_transform_quad_and_crop_mutually_exclusive(quad_work):
    from server.admin_page_ops import transform_page_image
    quad = [{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0},
            {"x": 1.0, "y": 1.0}, {"x": 0.0, "y": 1.0}]
    with pytest.raises(ValueError):
        transform_page_image(quad_work["work_id"], quad_work["filename"],
                             crop={"x": 0, "y": 0, "w": 0.5, "h": 1.0}, quad=quad)


def test_transform_quad_noop_when_all_none(quad_work):
    from server.admin_page_ops import transform_page_image
    r = transform_page_image(quad_work["work_id"], quad_work["filename"],
                             angle=0.0, crop=None, quad=None)
    assert r == {"success": True, "changed": False, "reason": "no_transform"}
