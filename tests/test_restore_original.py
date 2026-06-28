"""Testid lehe originaali taastamisele (._originals → praegune fail)."""
import sys
import json
import pytest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture
def ro_work(tmp_path, monkeypatch):
    """Testtöö ühe 200x100 lehega."""
    from PIL import Image as PILImage
    import server.admin_page_ops as aps

    wid = "rowork1"
    folder = tmp_path / "1700-ro-work"
    folder.mkdir()
    fname = "1700-ro-work-rowork1-pg001.jpg"
    PILImage.new("RGB", (200, 100), color=(180, 90, 40)).save(str(folder / fname), "JPEG", quality=95)
    (folder / (fname[:-4] + ".txt")).write_text("Tekst.", encoding="utf-8")
    (folder / (fname[:-4] + ".json")).write_text(json.dumps({"sequence": 100}), encoding="utf-8")

    monkeypatch.setattr(aps, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(aps, "find_directory_by_id", lambda w: str(folder) if w == wid else None)
    return {"folder": folder, "work_id": wid, "filename": fname}


def test_restore_no_original_returns_reason(ro_work):
    from server.admin_page_ops import restore_original_page_image
    r = restore_original_page_image(ro_work["work_id"], ro_work["filename"], username="admin")
    assert r == {"success": True, "restored": False, "reason": "no_original"}


def test_restore_brings_back_pristine(ro_work):
    from PIL import Image as PILImage
    from server.admin_page_ops import transform_page_image, restore_original_page_image
    transform_page_image(ro_work["work_id"], ro_work["filename"], angle=90.0, username="admin")
    with PILImage.open(str(ro_work["folder"] / ro_work["filename"])) as im:
        assert (im.width, im.height) == (100, 200)
    r = restore_original_page_image(ro_work["work_id"], ro_work["filename"], username="admin")
    assert r["restored"] is True
    with PILImage.open(str(ro_work["folder"] / ro_work["filename"])) as im:
        assert (im.width, im.height) == (200, 100)


def test_restore_keeps_original_for_repeat(ro_work):
    from server.admin_page_ops import transform_page_image, restore_original_page_image
    transform_page_image(ro_work["work_id"], ro_work["filename"], angle=90.0, username="admin")
    restore_original_page_image(ro_work["work_id"], ro_work["filename"], username="admin")
    orig = ro_work["folder"].parent / "._originals" / ro_work["work_id"] / ro_work["filename"]
    assert orig.exists()
    transform_page_image(ro_work["work_id"], ro_work["filename"], angle=90.0, username="admin")
    r = restore_original_page_image(ro_work["work_id"], ro_work["filename"], username="admin")
    assert r["restored"] is True


def test_restore_unknown_work(ro_work):
    from server.admin_page_ops import restore_original_page_image
    assert restore_original_page_image("nope", ro_work["filename"]) == {"found": False}


def test_restore_path_traversal_rejected(ro_work):
    from server.admin_page_ops import restore_original_page_image
    with pytest.raises(ValueError):
        restore_original_page_image(ro_work["work_id"], "../secret.jpg")
