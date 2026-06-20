"""Integratsioonitestid add_pages bulk-loogikale (git/meili mock'itud)."""
import io
import os
import json
import sys
import pytest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image
import server.admin_page_ops as aps
from server.admin_page_ops import add_pages, get_sorted_images


def _jpg(color=(1, 2, 3)):
    img = Image.new("RGB", (8, 8), color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


@pytest.fixture
def work(tmp_path, monkeypatch):
    wid = "w1"
    folder = tmp_path / "1690-test-w1"
    folder.mkdir()
    # Kaks olemasolevat lehte seq 100, 200
    for i, seq in enumerate([100, 200], start=1):
        base = f"1690-test-w1-w1-pg{i:03d}"
        Image.new("RGB", (8, 8), (i, i, i)).save(str(folder / (base + ".jpg")), "JPEG")
        (folder / (base + ".txt")).write_text("", encoding="utf-8")
        (folder / (base + ".json")).write_text(
            json.dumps({"sequence": seq, "status": "Valmis", "extra": "hoia alles"}),
            encoding="utf-8")
    (folder / "_metadata.json").write_text(json.dumps({"id": wid}), encoding="utf-8")

    monkeypatch.setattr(aps, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(aps, "find_directory_by_id",
                        lambda w: str(folder) if w == wid else None)
    monkeypatch.setattr(aps, "save_with_git", lambda *a, **kw: {"success": True})
    monkeypatch.setattr(aps, "sync_work_to_meilisearch", lambda *a: None)
    return {"folder": folder, "work_id": wid}


def test_add_two_pages_in_middle_sorted(work):
    files = [("b_scan_2.jpg", _jpg()), ("a_scan_1.jpg", _jpg())]
    res = add_pages(work["work_id"], files, after_page_num=1, username="admin")
    assert res["new_page_count"] == 4
    # Sorditud nimejärgi: a_scan_1 enne b_scan_2 → väiksem sequence esimesele
    seqs = [it["sequence"] for it in res["inserted"]]
    assert seqs[0] < seqs[1]
    imgs = get_sorted_images(str(work["folder"]))
    assert len(imgs) == 4


def test_unsupported_file_rejects_whole_batch(work):
    files = [("ok.jpg", _jpg()), ("bad.pdf", b"%PDF-1.4")]
    before = set(os.listdir(work["folder"]))
    with pytest.raises(ValueError):
        add_pages(work["work_id"], files, after_page_num=-1, username="admin")
    after = set(os.listdir(work["folder"]))
    assert before == after          # midagi ei kirjutatud


def test_after_page_num_out_of_range_rejected(work):
    with pytest.raises(ValueError):
        add_pages(work["work_id"], [("a.jpg", _jpg())], after_page_num=99, username="admin")


def test_too_many_files_rejected(work):
    files = [(f"f{i}.jpg", _jpg()) for i in range(21)]
    with pytest.raises(ValueError):
        add_pages(work["work_id"], files, after_page_num=-1, username="admin")


def test_existing_json_fields_preserved_on_renumber(work):
    # Sunni renumber: sisesta MAX_FILES_PER_REQUEST faili positsiooni 1 järele.
    # Olemasolevad seqs on [100, 200], gap=100; 20 faili ei mahu sisse (20 ei ole > 100
    # tegelikult mahub), seega vahetame strateegiat: täidame esmalt pesa 19-ga (seq 100..200
    # gap täidetud), siis lisame 2. lehte ületades piiri → renumber.
    # Lihtsam: kasutame 20 faili mille puhul gap=1 (seq 100 ja 101).
    # Loo fixture-sarnane seis otse: kirjuta teise lehe json seq=101 peale
    folder = work["folder"]
    pg2 = folder / "1690-test-w1-w1-pg002.json"
    d = json.load(open(str(pg2)))
    d["sequence"] = 101
    pg2.write_text(json.dumps(d), encoding="utf-8")

    # Nüüd seq=[100,101], gap=1 — isegi 1 fail päästab renumber'i
    files = [("f001.jpg", _jpg())]
    add_pages(work["work_id"], files, after_page_num=1, username="admin")
    # Olemasolev leht peab säilitama "extra" välja
    import glob
    for jp in glob.glob(str(folder / "*.json")):
        if jp.endswith("_metadata.json"):
            continue
        d = json.load(open(jp))
        # Vähemalt esialgsed kaks lehte (status Valmis) säilitasid extra
        if d.get("status") == "Valmis":
            assert d.get("extra") == "hoia alles"


def test_work_not_found_returns_found_false(work):
    res = add_pages("missing", [("a.jpg", _jpg())], after_page_num=-1, username="admin")
    assert res.get("found") is False


def test_meili_failure_returns_warning_not_raise(work, monkeypatch):
    def boom(*a):
        raise RuntimeError("meili down")
    monkeypatch.setattr(aps, "sync_work_to_meilisearch", boom)
    res = add_pages(work["work_id"], [("a.jpg", _jpg())], after_page_num=-1, username="admin")
    assert res["meili_warning"] is not None
    assert res["new_page_count"] == 3       # leht ikka lisatud
