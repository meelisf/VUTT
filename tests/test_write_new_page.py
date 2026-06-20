"""Testid write_new_page helperile."""
import os
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.admin_page_ops import write_new_page


def test_write_new_page_creates_three_files(tmp_path):
    work = tmp_path / "1690-test-w1"
    work.mkdir()
    res = write_new_page(str(work), str(work), "1690-test-w1", "w1", b"JPEGDATA", ".jpg", 150)

    assert os.path.exists(res["img_path"])
    assert os.path.exists(res["txt_path"])
    assert os.path.exists(res["json_path"])
    with open(res["img_path"], "rb") as f:
        assert f.read() == b"JPEGDATA"
    with open(res["txt_path"], "r") as f:
        assert f.read() == ""
    with open(res["json_path"]) as f:
        d = json.load(f)
    assert d["sequence"] == 150
    assert d["status"] == "Toores"
    assert res["page_meta"]["sequence"] == 150


def test_write_new_page_filename_pattern(tmp_path):
    work = tmp_path / "1690-test-w1"
    work.mkdir()
    res = write_new_page(str(work), str(work), "1690-test-w1", "w1", b"X", ".jpg", 100)
    assert res["filename"].startswith("1690-test-w1-w1-")
    assert res["filename"].endswith(".jpg")


def test_write_new_page_staging_separate_from_workdir(tmp_path):
    work = tmp_path / "1690-test-w1"
    work.mkdir()
    staging = work / ".tmp-bulk-abc"
    staging.mkdir()
    res = write_new_page(str(work), str(staging), "1690-test-w1", "w1", b"X", ".jpg", 100)
    # Failid lähevad staging-kausta
    assert os.path.dirname(res["img_path"]) == str(staging)
    # Kollisioonikontroll käib work_dir suhtes (siin pole kollisiooni)
    assert os.path.exists(res["img_path"])
