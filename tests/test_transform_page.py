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
