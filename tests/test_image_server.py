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
