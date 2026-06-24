"""
Pariteeditest: seed/reseed-tee (scripts/1-1_consolidate_data.py) JA live-tee
(server/meilisearch_ops.sync_work_to_meilisearch) peavad andma SAMA teose kohta
IDENTSED Meilisearch dokumendid (issue #23).

Taust: varem oli _metadata.json → Meili dokumendi kaardistusloogika dubleeritud
kahes failis (split_marginalia, clean_text_for_search, get_creator_aliases,
dokumendi-dict jms). Risk oli vaikne triiv: üks tee parandatakse, teine ununeb →
`server_seed_data.sh` reseed regresseerub märkamatult. Nüüd ehitavad MÕLEMAD teed
dokumendi sama server.meili_doc._build_page_document-iga, ja see test tõestab, et
nad annavad bait-haaval sama tulemuse → divergeerumine on konstruktsiooni järgi
võimatu.

Meetod: ehita üks fiksiivne teos kettale, jooksuta mõlemad teed sama kausta peal
ja võrdle dokumente väli-väljalt.
"""
import importlib.util
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.meilisearch_ops as ops


# Lae seed-skript mooduliks (failinimes on sidekriipsud → tavaimport ei tööta).
# NB: 'server' on juba reaalse paketina sys.modules-is (ops impordist), seega seed
# skripti fake-package blokk jätab vahele ja kasutab reaalset server-paketti.
_SEED_PATH = Path(__file__).resolve().parents[1] / "scripts" / "1-1_consolidate_data.py"
_spec = importlib.util.spec_from_file_location("seed_consolidate", _SEED_PATH)
seed = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(seed)


# =========================================================
# Fiksiivsed registrid (samad mis live snapshot-testis)
# =========================================================

COLLECTIONS = {
    "col-public": {"name": {"et": "Avalik kogu"}, "visibility": "public", "parent": None},
    "child-col": {"name": {"et": "Alamkogu"}, "visibility": "restricted", "parent": "col-public"},
    "col-restricted": {"name": {"et": "Piiratud kogu"}, "visibility": "restricted", "parent": None},
}

PEOPLE = {
    "Q123": {
        "primary_name": "Lorenz Luden",
        "aliases": ["Laurentius Ludenius", "Ludenius"],
        "ids": {"wikidata": "Q123"},
    },
    "Q456": {
        "primary_name": "Johannes Respondent",
        "aliases": ["Johannes R."],
        "ids": {"wikidata": "Q456"},
    },
    "Q777": {  # trükkal aliasega → publisher_search pariteet
        "primary_name": "Academische Buchdruckerei",
        "aliases": ["Brendeken, Johann"],
        "ids": {"wikidata": "Q777"},
    },
}

LABELS = {
    "Q500": {"et": "Marginaal", "en": "Margin"},
    "Q111": {"et": "Disputatsioon", "en": "Disputation"},
}

ARCHIVES = {"RA": {"name": "Rahvusarhiiv", "url": "https://ais.ra.ee"}}

WORK_ID = "abc123xyz"
SLUG = "1690-test-teos"


def _write_metadata(work_dir: Path, **overrides):
    meta = {
        "id": WORK_ID,
        "slug": SLUG,
        "title": "Disputatio de Test",
        "year": 1690,
        "year_display": "ca. 1690",
        "creators": [
            {"name": "Laurentius Ludenius", "id": "Q123", "role": "auctor"},
            {"name": "Johannes Respondent", "id": "Q456", "role": "respondens"},
        ],
        "tags": [
            {"label": "Test", "id": "Q999", "labels": {"et": "Test", "en": "Test-en"}},
        ],
        "genre": {"label": "Disputatsioon", "id": "Q111", "labels": {"et": "Disputatsioon", "en": "Disputation"}},
        "type": {"label": "Dissertatsioon", "id": "Q87167", "labels": {"et": "Dissertatsioon", "en": "Dissertation"}},
        "location": {"label": "Tartu", "id": "Q3258", "labels": {"et": "Tartu", "en": "Tartu"}},
        "publisher": {"label": "Academische Buchdruckerei", "id": "Q777", "labels": {"et": "Akadeemiline trükikoda"}},
        "languages": ["la"],
        "collections": ["col-public", "child-col"],
        "archive_refs": [{"archive_id": "RA", "reference": "f. 1"}],
        "ester_id": "b12345",
        "external_url": "https://example.org/work",
        "series": {"title": "Testseeria"},
        "shareable": True,
    }
    meta.update(overrides)
    (work_dir / "_metadata.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")


def _write_page(work_dir: Path, base: str, *, txt: str, sequence, status: str,
                page_tags=None, comments=None, text_annotations=None, text_content=None):
    (work_dir / f"{base}.jpg").write_bytes(b"\xff\xd8jpeg")
    (work_dir / f"{base}.txt").write_text(txt, encoding="utf-8")
    page_json = {
        "status": status,
        "page_tags": page_tags or [],
        "comments": comments or [],
        "text_annotations": text_annotations or [],
        "history": [],
    }
    if sequence is not None:
        page_json["sequence"] = sequence
    if text_content is not None:
        page_json["text_content"] = text_content
    (work_dir / f"{base}.json").write_text(json.dumps(page_json, ensure_ascii=False), encoding="utf-8")


def _build_fixture(tmp_path, **meta_overrides):
    work_dir = tmp_path / SLUG
    work_dir.mkdir()
    _write_metadata(work_dir, **meta_overrides)
    _write_page(
        work_dir, f"{SLUG}-{WORK_ID}-001",
        txt="welcher işt der Teuffel\n<m>Vide Picrium in hyeroglyphicis</m>\nvnd Satanas.",
        sequence=100, status="Toores",
        page_tags=[{"label": "Margin", "id": "Q500", "labels": {"et": "Margin", "en": "Margin-en"}}],
        comments=[{"text": "kommentaar"}],
        text_annotations=[{"comment": "ann1"}],
    )
    _write_page(
        work_dir, f"{SLUG}-{WORK_ID}-002",
        txt="foo<m>ääremärkus</m>bar coa-\ncervare",
        sequence=200, status="Valmis",
    )
    for base in (f"{SLUG}-{WORK_ID}-001", f"{SLUG}-{WORK_ID}-002"):
        os.utime(work_dir / f"{base}.txt", (1_000_000, 1_000_000))
    return work_dir


def _live_docs(tmp_path, monkeypatch):
    """Jooksutab live-tee (sync_work_to_meilisearch) ja tagastab kinnipüütud dokumendid."""
    monkeypatch.setattr(ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(ops, "ARCHIVES_FILE", str(tmp_path / "_archives.json"))
    (tmp_path / "_archives.json").write_text(json.dumps(ARCHIVES), encoding="utf-8")
    monkeypatch.setattr(ops, "load_collections", lambda: COLLECTIONS)
    monkeypatch.setattr(ops, "load_people_aliases", lambda: PEOPLE)
    monkeypatch.setattr(ops, "load_labels_store", lambda: LABELS)

    captured = {"docs": None}
    monkeypatch.setattr(ops, "send_to_meilisearch", lambda documents, wait=True: captured.__setitem__("docs", documents) or True)
    monkeypatch.setattr(ops, "_delete_extra_pages", lambda work_id, new_count: None)

    assert ops.sync_work_to_meilisearch(SLUG) is True
    return captured["docs"]


def _seed_docs(work_dir):
    """Jooksutab seed-tee (build_work_documents) sama kausta peal."""
    teose_id, pages = seed.build_work_documents(
        str(work_dir), SLUG, COLLECTIONS, PEOPLE, ARCHIVES, LABELS
    )
    return pages


# =========================================================
# Testid
# =========================================================

def test_seed_ja_live_annavad_identsed_dokumendid(tmp_path, monkeypatch):
    """Põhitest: täielikult populeeritud teose puhul on seed- ja live-dokumendid identsed.

    teose_staatus jäetakse võrdlusest välja: live lisab selle dokumentidesse
    upsert-sammus (_upsert_work_documents), seed väljundi kirjutamise tsüklis —
    mõlemad arvutavad selle samast utils.calculate_work_status-ist.
    """
    work_dir = _build_fixture(tmp_path)
    live = _live_docs(tmp_path, monkeypatch)
    seed_docs = _seed_docs(work_dir)

    assert len(live) == len(seed_docs) == 2

    for live_doc, seed_doc in zip(live, seed_docs):
        live_clean = {k: v for k, v in live_doc.items() if k != "teose_staatus"}
        assert seed_doc == live_clean, (
            f"Seed ja live lahknevad lehel {live_doc.get('id')}; "
            f"erinevad võtmed: {set(live_clean) ^ set(seed_doc)}"
        )


def test_seed_ja_live_seeria_vali_molemas(tmp_path, monkeypatch):
    """series/series_title peab nüüd ilmuma MÕLEMAS teed (varem ainult seed-is)."""
    work_dir = _build_fixture(tmp_path)
    live = _live_docs(tmp_path, monkeypatch)
    seed_docs = _seed_docs(work_dir)
    for d in (live[0], seed_docs[0]):
        assert d["series"] == {"title": "Testseeria"}
        assert d["series_title"] == "Testseeria"


def test_seed_ja_live_ilma_seeriata(tmp_path, monkeypatch):
    """Ilma seeriata: kumbki tee EI lisa series/series_title/relations välja."""
    work_dir = _build_fixture(tmp_path, series=None)
    live = _live_docs(tmp_path, monkeypatch)
    seed_docs = _seed_docs(work_dir)
    for live_doc, seed_doc in zip(live, seed_docs):
        live_clean = {k: v for k, v in live_doc.items() if k != "teose_staatus"}
        assert seed_doc == live_clean
        assert "series" not in seed_doc
        assert "relations" not in seed_doc


def test_seed_ja_live_sequence_fallback_ja_text_content_fallback(tmp_path, monkeypatch):
    """Seed peab järgima live'i lehesortimist ja text_content fallback'i.

    Regressioon: seed kasutas varem sequence-puudumisel kunstlikku alpha_pos*100
    väärtust (live kasutab inf → lõppu) ja JSON text_content kirjutas .txt üle
    (live kasutab seda ainult siis, kui .txt puudub/tühi).
    """
    work_dir = tmp_path / SLUG
    work_dir.mkdir()
    _write_metadata(work_dir)
    _write_page(
        work_dir, f"{SLUG}-{WORK_ID}-a-unseq",
        txt="TXT unsequenced", sequence=None, status="Toores",
    )
    _write_page(
        work_dir, f"{SLUG}-{WORK_ID}-b-seq",
        txt="TXT sequenced", sequence=300, status="Toores", text_content="JSON sequenced",
    )
    for base in (f"{SLUG}-{WORK_ID}-a-unseq", f"{SLUG}-{WORK_ID}-b-seq"):
        os.utime(work_dir / f"{base}.txt", (1_000_000, 1_000_000))

    live = _live_docs(tmp_path, monkeypatch)
    seed_docs = _seed_docs(work_dir)

    assert [d["lehekylje_pilt"] for d in seed_docs] == [d["lehekylje_pilt"] for d in live]
    assert seed_docs[0]["text_content"] == "TXT sequenced"
    for live_doc, seed_doc in zip(live, seed_docs):
        live_clean = {k: v for k, v in live_doc.items() if k != "teose_staatus"}
        assert seed_doc == live_clean


def test_seed_ja_live_minimaalne_metadata(tmp_path, monkeypatch):
    """Minimaalne teos (ainult id/slug/title, ei type/languages/year) — defaultide pariteet.

    Kaitseb type ('impressum' vs None) ja languages (['lat'] vs []) defaultide
    lahknemise eest, mis varem seed-tees erines live-teest."""
    work_dir = tmp_path / SLUG
    work_dir.mkdir()
    (work_dir / "_metadata.json").write_text(
        json.dumps({"id": WORK_ID, "slug": SLUG, "title": "Minimaalne"}, ensure_ascii=False),
        encoding="utf-8",
    )
    _write_page(work_dir, f"{SLUG}-{WORK_ID}-001", txt="lihtne tekst", sequence=100, status="Toores")
    os.utime(work_dir / f"{SLUG}-{WORK_ID}-001.txt", (1_000_000, 1_000_000))

    live = _live_docs(tmp_path, monkeypatch)
    seed_docs = _seed_docs(work_dir)
    assert len(live) == len(seed_docs) == 1
    live_clean = {k: v for k, v in live[0].items() if k != "teose_staatus"}
    assert seed_docs[0] == live_clean
