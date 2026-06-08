"""Testid topeltlehe lõikamise loogikale."""
import sys
import json
import pytest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.admin_page_ops import split_text_at_pb


def test_split_at_pb_present():
    left, right = split_text_at_pb("Vasak tekst.\n<pb/>\nParem tekst.")
    assert left == "Vasak tekst."
    assert right == "Parem tekst."


def test_split_at_pb_absent():
    left, right = split_text_at_pb("Ainult tekst.")
    assert left == "Ainult tekst."
    assert right == "Ainult tekst."


def test_split_at_pb_empty():
    left, right = split_text_at_pb("")
    assert left == ""
    assert right == ""


def test_split_at_pb_multiple_uses_first():
    left, right = split_text_at_pb("A<pb/>B<pb/>C")
    assert left == "A"
    assert right == "B<pb/>C"


def test_split_at_pb_trims_whitespace():
    left, right = split_text_at_pb("  Vasak  \n<pb/>\n  Parem  ")
    assert left == "Vasak"
    assert right == "Parem"


@pytest.fixture
def work_dir(tmp_path, monkeypatch):
    """Loob testtöö kataloogi ühe topeltlehega."""
    from PIL import Image as PILImage
    import server.admin_page_ops as aps

    wid = "testwork1"
    folder = tmp_path / "1690-test-work"
    folder.mkdir()

    # Minimaalne 200x100 JPEG testpildiks (200 laius → split 100px=50%)
    img = PILImage.new("RGB", (200, 100), color=(200, 100, 50))
    img_path = folder / "1690-test-work-testwork1-pg001.jpg"
    img.save(str(img_path), "JPEG", quality=95)

    # .txt <pb/> sisuga
    txt_path = folder / "1690-test-work-testwork1-pg001.txt"
    txt_path.write_text("Vasak.\n<pb/>\nParem.", encoding="utf-8")

    # .json sequence=100
    json_path = folder / "1690-test-work-testwork1-pg001.json"
    json_path.write_text(
        json.dumps({"sequence": 100, "status": "Toores"}), encoding="utf-8"
    )

    # _metadata.json
    meta_path = folder / "_metadata.json"
    meta_path.write_text(
        json.dumps({"id": wid, "title": "Test", "collections": []}), encoding="utf-8"
    )

    monkeypatch.setattr(aps, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(
        aps, "find_directory_by_id", lambda wid_: str(folder) if wid_ == wid else None
    )
    monkeypatch.setattr(aps, "save_with_git", lambda *a, **kw: {"success": True})
    monkeypatch.setattr(aps, "delete_page_from_git", lambda *a, **kw: True)
    monkeypatch.setattr(aps, "sync_work_to_meilisearch", lambda *a: None)

    return {"folder": folder, "work_id": wid, "img_path": img_path}


def test_split_page_creates_two_files(work_dir):
    from server.admin_page_ops import split_page

    result = split_page(work_dir["work_id"], 1, 0.5, "testadmin")

    assert result["success"] is True
    assert result["new_page_count"] == 2


def test_split_page_left_right_dimensions(work_dir):
    from PIL import Image as PILImage
    from server.admin_page_ops import split_page, get_sorted_images

    split_page(work_dir["work_id"], 1, 0.5, "testadmin")
    folder = work_dir["folder"]

    images = get_sorted_images(str(folder))
    assert len(images) == 2

    with PILImage.open(str(folder / images[0])) as left:
        assert left.width == 100  # 50% of 200
        assert left.height == 100

    with PILImage.open(str(folder / images[1])) as right:
        assert right.width == 100
        assert right.height == 100


def test_split_page_text_split_at_pb(work_dir):
    from server.admin_page_ops import split_page, get_sorted_images

    split_page(work_dir["work_id"], 1, 0.5, "testadmin")
    folder = work_dir["folder"]
    images = get_sorted_images(str(folder))

    left_base = images[0].rsplit(".", 1)[0]
    right_base = images[1].rsplit(".", 1)[0]

    left_txt = (folder / (left_base + ".txt")).read_text(encoding="utf-8")
    right_txt = (folder / (right_base + ".txt")).read_text(encoding="utf-8")

    assert left_txt == "Vasak."
    assert right_txt == "Parem."


def test_split_page_sequence_order(work_dir):
    from server.admin_page_ops import split_page, get_sorted_images, get_page_sequence

    split_page(work_dir["work_id"], 1, 0.5, "testadmin")
    folder = work_dir["folder"]
    images = get_sorted_images(str(folder))

    left_seq = get_page_sequence(str(folder / (images[0].rsplit(".", 1)[0] + ".json")))
    right_seq = get_page_sequence(str(folder / (images[1].rsplit(".", 1)[0] + ".json")))

    assert left_seq == 100
    assert right_seq == 150  # originaali seq + 50


def test_split_page_original_removed(work_dir):
    from server.admin_page_ops import split_page

    orig_img = work_dir["img_path"]
    assert orig_img.exists()

    split_page(work_dir["work_id"], 1, 0.5, "testadmin")

    assert not orig_img.exists()


def test_split_page_invalid_split_x(work_dir):
    from server.admin_page_ops import split_page

    with pytest.raises(ValueError):
        split_page(work_dir["work_id"], 1, 0.02, "testadmin")

    with pytest.raises(ValueError):
        split_page(work_dir["work_id"], 1, 0.98, "testadmin")


# ─── Endpoint testid ──────────────────────────────────────────────


def test_split_endpoint_401_no_auth(backend_env):
    r = backend_env["client"].post("/admin/work/w1/page/1/split", json={"split_x": 0.5})
    assert r.status_code == 401


def test_split_endpoint_403_editor(backend_env, login):
    token = login("editor", "editorpass")
    r = backend_env["client"].post(
        "/admin/work/w1/page/1/split",
        json={"split_x": 0.5},
        headers={"Authorization": f"Bearer {token}"},
    )
    # Süsteem tagastab 401 ka ebapiisavate õiguste korral (require_token → get_user → 401)
    assert r.status_code in (401, 403)


def test_split_endpoint_404_unknown_work(backend_env, login, monkeypatch):
    import server.main as main
    monkeypatch.setattr(main, "split_page", lambda *a, **kw: {"found": False})

    token = login("admin", "adminpass")
    r = backend_env["client"].post(
        "/admin/work/unknown/page/1/split",
        json={"split_x": 0.5},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404


def test_split_endpoint_400_invalid_split_x(backend_env, login, monkeypatch):
    import server.main as main

    def _raise(*a, **kw):
        raise ValueError("split_x peab olema vahemikus [0.05, 0.95]")

    monkeypatch.setattr(main, "split_page", _raise)

    token = login("admin", "adminpass")
    r = backend_env["client"].post(
        "/admin/work/w1/page/1/split",
        json={"split_x": 0.02},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400


def test_split_endpoint_200_success(backend_env, login, monkeypatch):
    import server.main as main
    monkeypatch.setattr(
        main, "split_page", lambda *a, **kw: {"success": True, "new_page_count": 2}
    )

    token = login("admin", "adminpass")
    r = backend_env["client"].post(
        "/admin/work/testwork1/page/1/split",
        json={"split_x": 0.47},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "success"
    assert data["new_page_count"] == 2
