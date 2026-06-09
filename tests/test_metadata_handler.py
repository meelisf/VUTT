# tests/test_metadata_handler.py
import os
import json
import pytest
from pathlib import Path


def _write_meta(tmp_path, meta: dict) -> str:
    """Kirjutab _metadata.json faili tmp kausta, tagastab work_id."""
    work_id = meta["id"]
    work_dir = tmp_path / "data" / "test-slug"
    work_dir.mkdir(parents=True, exist_ok=True)
    (work_dir / "_metadata.json").write_text(
        json.dumps(meta, ensure_ascii=False), encoding="utf-8"
    )
    return str(work_dir)


@pytest.fixture()
def patch_find(monkeypatch, tmp_path):
    """Monkeypatchi find_directory_by_id et tagastaks tmp_path kausta."""
    import server.metadata_handler as mh
    _registry = {}

    def fake_find(work_id):
        return _registry.get(work_id)

    monkeypatch.setattr(mh, "find_directory_by_id", fake_find)
    return _registry, tmp_path


FULL_META = {
    "id": "work001",
    "title": "Disputatio de pace",
    "year": 1654,
    "year_display": "1654",
    "creators": [
        {"name": "Johannes Gezelius", "role": "praeses"},
        {"name": "Petrus Schomerus", "role": "respondens"},
    ],
    "location": {"label": "Tartu", "id": "Q3258"},
    "publisher": {"label": "Johannes Vogel", "id": "Q999"},
    "languages": ["la", "de"],
    "external_url": "https://digar.nlib.ee/show/nlib-digar:123",
    "collections": [],
    "archive_refs": None,
}

MANUSCRIPT_META = {
    "id": "work002",
    "title": "Kiri consistoriumile",
    "year": 1680,
    "year_display": "1680",
    "creators": [{"name": "Adam Lode", "role": "auctor"}],
    "location": None,
    "publisher": None,
    "languages": ["de"],
    "external_url": None,
    "collections": [],
    "archive_refs": [
        {"archive_id": "EAA", "reference": "1.2.3, l. 45"},
    ],
}


def test_canonical_url_present(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)
    html = build_meta_html("work001")
    assert 'rel="canonical"' in html
    assert 'href="https://vutt.utlib.ut.ee/work/work001"' in html


def test_og_title_present(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)
    html = build_meta_html("work001")
    assert 'property="og:title"' in html
    assert "Disputatio de pace" in html


def test_meta_refresh_still_present(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)
    html = build_meta_html("work001")
    assert 'http-equiv="refresh"' in html


def test_dublin_core_title(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)
    html = build_meta_html("work001")
    assert 'name="DC.title"' in html
    assert "Disputatio de pace" in html


def test_dublin_core_creators(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)
    html = build_meta_html("work001")
    assert 'name="DC.creator"' in html
    assert "Johannes Gezelius" in html
    assert "Petrus Schomerus" in html


def test_dublin_core_date(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)
    html = build_meta_html("work001")
    assert 'name="DC.date"' in html
    assert "1654" in html


def test_dublin_core_publisher(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)
    html = build_meta_html("work001")
    assert 'name="DC.publisher"' in html
    assert "Johannes Vogel" in html


def test_dublin_core_language(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)
    html = build_meta_html("work001")
    assert 'name="DC.language"' in html
    assert "la" in html


def test_coins_span_present(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)
    html = build_meta_html("work001")
    assert 'class="Z3988"' in html
    assert "ctx_ver=Z39.88-2004" in html


def test_coins_contains_title(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)
    html = build_meta_html("work001")
    assert "rft.btitle" in html
    assert "Disputatio+de+pace" in html or "Disputatio%20de%20pace" in html


def test_coins_contains_author(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)
    html = build_meta_html("work001")
    assert "rft.au" in html
    assert "Johannes" in html


def test_coins_contains_respondens(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)
    html = build_meta_html("work001")
    assert "rft.contributor" in html
    assert "Schomerus" in html


def test_coins_contains_external_url(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)
    html = build_meta_html("work001")
    assert "rft_id" in html
    assert "digar" in html


def test_body_has_h1_title(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)
    html = build_meta_html("work001")
    assert "<h1>" in html
    assert "Disputatio de pace" in html


def test_body_has_creators(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)
    html = build_meta_html("work001")
    assert "Johannes Gezelius" in html
    assert "Petrus Schomerus" in html


def test_body_has_publisher_for_print(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)
    html = build_meta_html("work001")
    assert "Johannes Vogel" in html
    assert "Tartu" in html


def test_body_has_archive_ref_for_manuscript(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work002"] = _write_meta(tmp_path, MANUSCRIPT_META)
    html = build_meta_html("work002")
    assert "EAA" in html
    assert "1.2.3" in html


def test_body_has_permalink(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)
    html = build_meta_html("work001")
    assert "https://vutt.utlib.ut.ee/work/work001" in html


def test_html_escaping(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    meta = {**FULL_META, "id": "work003", "title": 'Teos <script>alert("xss")</script>'}
    registry["work003"] = _write_meta(tmp_path, meta)
    html = build_meta_html("work003")
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_unknown_work_returns_fallback(patch_find):
    from server.metadata_handler import build_meta_html
    html = build_meta_html("nonexistent")
    assert "VUTT" in html
    assert "<html>" in html


def test_work_id_escaped_in_urls(patch_find):
    from server.metadata_handler import build_meta_html
    # work_id tundmatu — fallback haru
    html_out = build_meta_html('work<script>')
    assert '<script>' not in html_out
    assert 'work&lt;script&gt;' in html_out or 'work%3Cscript%3E' in html_out
