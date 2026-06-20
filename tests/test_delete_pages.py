"""Testid delete_pages op-loogikale (git-helper ja meili mock'itud)."""
import io
import json
import os
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image
import server.admin_page_ops as aps
from server.admin_page_ops import delete_pages, get_sorted_images


@pytest.fixture
def work(tmp_path, monkeypatch):
    wid = "w1"
    folder = tmp_path / "1690-test-w1"
    folder.mkdir()
    bases = []
    for i, seq in enumerate([100, 200, 300], start=1):
        base = f"pg{i:03d}"
        bases.append(base)
        Image.new("RGB", (8, 8), (i, i, i)).save(str(folder / (base + ".jpg")), "JPEG")
        (folder / (base + ".txt")).write_text("", encoding="utf-8")
        (folder / (base + ".json")).write_text(json.dumps({"sequence": seq}), encoding="utf-8")
    (folder / "_metadata.json").write_text(json.dumps({"id": wid}), encoding="utf-8")

    monkeypatch.setattr(aps, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(aps, "find_directory_by_id",
                        lambda w: str(folder) if w == wid else None)
    monkeypatch.setattr(aps, "sync_work_to_meilisearch", lambda *a: None)
    return {"folder": folder, "work_id": wid, "tmp": tmp_path, "bases": bases}


def test_delete_two_pages_success(work, monkeypatch):
    calls = {"sync": 0}
    monkeypatch.setattr(aps, "sync_work_to_meilisearch", lambda *a: calls.__setitem__("sync", calls["sync"] + 1))
    # Mock git-helper: kustuta tegelikud txt/json failid, et new_page_count toimiks
    def fake_git(folder_name, base_names, msg, username):
        removed = []
        for b in base_names:
            for ext in (".txt", ".json"):
                p = work["folder"] / (b + ext)
                if p.exists():
                    p.unlink()
                    removed.append(os.path.join(folder_name, b + ext))
        return removed
    monkeypatch.setattr(aps, "delete_pages_from_git", fake_git)

    res = delete_pages(work["work_id"], ["pg001", "pg002"], "admin")
    assert res["status"] == "success"
    assert res["new_page_count"] == 1
    assert calls["sync"] == 1  # ÜKS reindeks
    # Pildid prügikastis, mitte kaustas
    assert not (work["folder"] / "pg001.jpg").exists()
    trash = work["tmp"] / "._trash" / "w1" / "pages"
    assert (trash / "pg001.jpg").exists()


def _page_files(folder):
    # Lehefailid ilma op-i loodud .vutt-lock lukufailita
    return {n for n in os.listdir(folder) if n != ".vutt-lock"}


def test_none_match_returns_not_found(work, monkeypatch):
    monkeypatch.setattr(aps, "delete_pages_from_git", lambda *a, **k: pytest.fail("ei tohi kutsuda"))
    before = _page_files(work["folder"])
    res = delete_pages(work["work_id"], ["zzz", "yyy"], "admin")
    assert res["status"] == "not_found"
    assert set(res["missing"]) == {"zzz", "yyy"}
    assert _page_files(work["folder"]) == before  # midagi ei muutunud


def test_partial_match_returns_conflict_deletes_nothing(work, monkeypatch):
    monkeypatch.setattr(aps, "delete_pages_from_git", lambda *a, **k: pytest.fail("ei tohi kutsuda"))
    before = _page_files(work["folder"])
    res = delete_pages(work["work_id"], ["pg001", "zzz"], "admin")
    assert res["status"] == "conflict"
    assert res["missing"] == ["zzz"]
    assert _page_files(work["folder"]) == before  # kõik-või-mitte-midagi


def test_git_failure_restores_jpgs(work, monkeypatch):
    def boom(*a, **kw):
        raise RuntimeError("git fail")
    monkeypatch.setattr(aps, "delete_pages_from_git", boom)
    with pytest.raises(RuntimeError):
        delete_pages(work["work_id"], ["pg001"], "admin")
    # Pilt taastatud kausta, prügikast tühi
    assert (work["folder"] / "pg001.jpg").exists()
    trash = work["tmp"] / "._trash" / "w1" / "pages"
    assert not (trash / "pg001.jpg").exists()
