# tests/test_exemplar_images_isolation.py
"""ADR 0079 p 3: eksemplari pildid ei ole teose lehed. Lehtede loend, Meili
dokumendid ja kaanepilt on samad mis ilma eksemplaripiltideta."""
import importlib.util
import json
from pathlib import Path

import pytest
from PIL import Image

from server import image_server, meili_doc, work_parts


@pytest.fixture
def work(tmp_path):
    w = tmp_path / "1640-test-w1"
    w.mkdir()
    for i, seq in ((1, 2), (2, 1)):
        stem = f"1640-test-w1-{i:03d}"
        Image.new("RGB", (8, 8)).save(w / f"{stem}.jpg")
        (w / f"{stem}.txt").write_text(f"leht {i}", encoding="utf-8")
        (w / f"{stem}.json").write_text(json.dumps({"sequence": seq}), encoding="utf-8")
    (w / "_metadata.json").write_text(json.dumps({"id": "w1", "title": "T"}), encoding="utf-8")
    return w


def _add_exemplar_images(w: Path):
    ex = w / "_exemplars" / "a1b2c3"
    (ex / "_thumbs").mkdir(parents=True)
    Image.new("RGB", (8, 8)).save(ex / "x1y2z3.jpg")
    Image.new("RGB", (8, 8)).save(ex / "x1y2z3.orig.png")
    Image.new("RGB", (8, 8)).save(ex / "_thumbs" / "_thumb_x1y2z3.jpg")
    (ex / "images.json").write_text('{"revision": 1, "images": [{"id": "x1y2z3"}]}', encoding="utf-8")


def test_page_stems_ei_naita_eksemplaripilte(work):
    before = work_parts.page_stems(str(work))
    _add_exemplar_images(work)
    assert work_parts.page_stems(str(work)) == before == ["1640-test-w1-002", "1640-test-w1-001"]


def test_meili_dokumendid_samad(work):
    before = meili_doc.enumerate_page_images(str(work))
    _add_exemplar_images(work)
    assert meili_doc.enumerate_page_images(str(work)) == before


def test_get_first_image_ei_naita_alamkausta(work, tmp_path):
    before = image_server.get_first_image(str(work))
    _add_exemplar_images(work)
    assert image_server.get_first_image(str(work)) == before
    only = tmp_path / "ainult-eksemplar"
    only.mkdir()
    _add_exemplar_images(only)
    assert image_server.get_first_image(str(only)) is None


def test_optimize_images_ei_puutu_eksemplaripilte(work):
    _add_exemplar_images(work)
    path = Path(__file__).resolve().parents[1] / "scripts" / "optimize_images.py"
    spec = importlib.util.spec_from_file_location("optimize_images", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert not [p for p in mod.find_png_files(str(work.parent)) if "_exemplars" in p]
    assert not [p for p in mod.find_large_jpgs(str(work.parent), 0) if "_exemplars" in p]
