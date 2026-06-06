import os
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
