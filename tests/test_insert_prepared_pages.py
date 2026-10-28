"""Sisestuskiht kettal olevatele JPEG-idele + failinime-ankur (PDF-ist lehtede lisamine)."""
import json
import os
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.admin_page_ops as aps
from server.admin_page_ops import AnchorMissing, get_sorted_images, insert_prepared_pages


@pytest.fixture
def work(tmp_path, monkeypatch):
    wid = "w1"
    folder = tmp_path / "1690-test-w1"
    folder.mkdir()
    for i, seq in enumerate([100, 200], start=1):
        base = f"1690-test-w1-w1-pg{i:03d}"
        Image.new("RGB", (8, 8), (i, i, i)).save(str(folder / (base + ".jpg")), "JPEG")
        (folder / (base + ".txt")).write_text("", encoding="utf-8")
        (folder / (base + ".json")).write_text(json.dumps({"sequence": seq}), encoding="utf-8")
    (folder / "_metadata.json").write_text(json.dumps({"id": wid}), encoding="utf-8")

    commits = []
    monkeypatch.setattr(aps, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(aps, "find_directory_by_id", lambda w: str(folder) if w == wid else None)
    monkeypatch.setattr(aps, "save_with_git", lambda *a, **kw: commits.append(a) or {"success": True})
    monkeypatch.setattr(aps, "sync_work_to_meilisearch", lambda *a: None)
    monkeypatch.setattr(aps, "refresh_work_mentions", lambda *a, **kw: None)
    return {"folder": folder, "work_id": wid, "commits": commits}


def _prepared(work, names_colors):
    """Kirjutab valmis JPEG-id teose kausta ajutisse alamkausta (sama FS)."""
    tmp = work["folder"] / ".tmp-pdf-test"
    tmp.mkdir()
    paths = []
    for name, color in names_colors:
        p = tmp / name
        Image.new("RGB", (8, 8), color).save(str(p), "JPEG", quality=95)
        paths.append(str(p))
    return paths


def _color(path):
    with Image.open(path) as im:
        return im.convert("RGB").getpixel((4, 4))


def test_ankur_failinimi_sisestab_selle_jarele(work):
    paths = _prepared(work, [("a.jpg", (250, 0, 0)), ("b.jpg", (0, 250, 0))])
    res = insert_prepared_pages(work["work_id"], paths, "1690-test-w1-w1-pg001.jpg", "admin")
    imgs = get_sorted_images(str(work["folder"]))
    assert imgs[0] == "1690-test-w1-w1-pg001.jpg"
    assert imgs[3] == "1690-test-w1-w1-pg002.jpg"
    assert [imgs[1], imgs[2]] == [it["filename"] for it in res["inserted"]]
    assert not any(os.path.exists(p) for p in paths)   # liigutati, mitte kopeeriti


def test_ankur_start_ja_end(work):
    p1 = _prepared(work, [("a.jpg", (250, 0, 0))])
    r1 = insert_prepared_pages(work["work_id"], p1, "start", "admin")
    os.rmdir(work["folder"] / ".tmp-pdf-test")
    p2 = _prepared(work, [("b.jpg", (0, 250, 0))])
    r2 = insert_prepared_pages(work["work_id"], p2, "end", "admin")
    imgs = get_sorted_images(str(work["folder"]))
    assert imgs[0] == r1["inserted"][0]["filename"]
    assert imgs[-1] == r2["inserted"][0]["filename"]


def test_kadunud_ankur_viskab_ja_ei_kirjuta(work):
    paths = _prepared(work, [("a.jpg", (250, 0, 0))])
    before = set(os.listdir(work["folder"])) | {".vutt-lock"}   # work_lock-i fail
    with pytest.raises(AnchorMissing) as ei:
        insert_prepared_pages(work["work_id"], paths, "puudub.jpg", "admin")
    assert ei.value.code == "anchor_missing"
    assert set(os.listdir(work["folder"])) | {".vutt-lock"} == before
    assert work["commits"] == []


def test_jarjekord_on_sisendi_jarjekord(work):
    paths = _prepared(work, [("z.jpg", (250, 0, 0)), ("a.jpg", (0, 0, 250))])
    res = insert_prepared_pages(work["work_id"], paths, "end", "admin")
    first, second = res["inserted"]
    assert first["sequence"] < second["sequence"]
    r, g, b = _color(str(work["folder"] / first["filename"]))
    assert r > 200 and b < 50


def test_uks_commit(work):
    paths = _prepared(work, [("a.jpg", (1, 1, 1)), ("b.jpg", (2, 2, 2)), ("c.jpg", (3, 3, 3))])
    insert_prepared_pages(work["work_id"], paths, "end", "admin")
    assert len(work["commits"]) == 1
