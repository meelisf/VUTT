"""`lehekylje_tekst_ann` — otsingutekst, mille ankrud on ALLES (ADR 0041).

`lehekylje_tekst` on otsinguks puhastatud: sidekriipsud liidetud, markup maas,
`<annN>` kaasa arvatud. Seetõttu ei näinud MCP-kaudu lugev agent mingit märki
sellest, et toimetaja on mõne aastaarvu kahtlaseks märkinud.

Väli on TINGIMUSLIK — kirjutatakse ainult siis, kui lehel on annotatsioone
(korpuses 171 lehte ~20 000-st), et indeksi kaal ei kahekordistuks.
"""
import pytest

from server.meili_doc import clean_text_for_search, build_annotated_search_text


ANN = {"id": 2, "comment": "kahtlane", "author": "Administraator",
       "created_at": "2026-09-13T16:15:01.097Z"}


# ── clean_text_for_search(keep_ann=...) ───────────────────────────────────

def test_vaikimisi_eemaldab_ankru_nagu_enne():
    """Vaikekäitumine EI TOHI muutuda — `lehekylje_tekst` on sama väli."""
    assert clean_text_for_search("A.o <ann2>1662</ann2> hoc") == "A.o 1662 hoc"


def test_keep_ann_jatab_ankru_alles():
    assert clean_text_for_search("A.o <ann2>1662</ann2> hoc", keep_ann=True) == \
        "A.o <ann2>1662</ann2> hoc"


def test_keep_ann_eemaldab_koik_muu_margenduse():
    raw = "<i>Soræ</i> d. 9 <ann2>1662</ann2><pb/> et <b>me</b>"
    puhas = clean_text_for_search(raw, keep_ann=True)
    assert "<i>" not in puhas and "<b>" not in puhas and "<pb/>" not in puhas
    assert "<ann2>" in puhas and "</ann2>" in puhas


def test_keep_ann_liidab_poolituse_ka_ankru_sees():
    """Ankur võib katta sidekriipsuga poolitatud sõna."""
    puhas = clean_text_for_search("<ann1>Sueco¬\nrum</ann1>", keep_ann=True)
    assert puhas == "<ann1>Suecorum</ann1>"


def test_keep_ann_ei_sega_kahekohalist_id():
    puhas = clean_text_for_search("<ann1>a</ann1> <ann14>b</ann14>", keep_ann=True)
    assert puhas == "<ann1>a</ann1> <ann14>b</ann14>"


def test_keep_ann_normaliseerib_eszetti_endiselt():
    assert clean_text_for_search("<ann1>daß</ann1>", keep_ann=True) == "<ann1>dass</ann1>"


# ── build_annotated_search_text ───────────────────────────────────────────

def test_annotatsioonideta_leht_ei_saa_valja():
    """Tingimuslik väli: ilma kirjeteta ei tohi väärtust tekkida."""
    assert build_annotated_search_text("lihtne tekst", []) is None


def test_ankruta_kirje_ei_tekita_valja():
    """Kui kirjed on, aga ükski ankur ei kanna neid, ei ole väljal midagi öelda."""
    assert build_annotated_search_text("tekst ilma ankruta", [ANN]) is None


def test_ankruga_leht_saab_valja():
    tulemus = build_annotated_search_text("A.o <ann2>1662</ann2>", [ANN])
    assert tulemus == "A.o <ann2>1662</ann2>"


def test_kirjeta_ankur_eemaldatakse_valjast():
    """Seletamatut märgendit ei tohi indeksisse panna.

    Tootmises on 23 sellist tägi (2026-09-13). Andmed parandab
    `scripts/reconcile_annotations.py`, aga indeks ei tohi vahepeal
    mudelile märgendit näidata, mille kohta märkust ei ole.
    """
    tulemus = build_annotated_search_text(
        "<ann2>1662</ann2> ja <ann7>miski</ann7>", [ANN]
    )
    assert tulemus == "<ann2>1662</ann2> ja miski"


def test_marginaalia_ei_satu_pohiteksti_valja():
    """Sama jaotus nagu `lehekylje_tekst` — marginaalia elab oma väljal."""
    tulemus = build_annotated_search_text(
        "põhi <ann2>1662</ann2>\n<m>ääremärkus</m>\nedasi", [ANN]
    )
    assert "ääremärkus" not in tulemus
    assert "<ann2>1662</ann2>" in tulemus


def test_vigane_kirjete_vali_ei_kukuta():
    assert build_annotated_search_text("<ann2>x</ann2>", None) is None
    assert build_annotated_search_text("<ann2>x</ann2>", "prügi") is None


# ── dokumendis (kogu kaardistus) ──────────────────────────────────────────
# Läbi päris `sync_work_to_meilisearch` — kaardistus peab jõudma dokumenti
# MÕLEMAL indekseerimisteel (ADR 0006), seega kontrollime live-teed otsast lõpuni.

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.meilisearch_ops as ops

WORK_ID = "annotest1"
SLUG = "1662-annotatsioonitest"


@pytest.fixture
def docs(tmp_path, monkeypatch):
    """Kaks lehte: esimesel ankruga kirje, teisel mitte ühtegi."""
    work_dir = tmp_path / SLUG
    work_dir.mkdir()
    (work_dir / "_metadata.json").write_text(json.dumps({
        "id": WORK_ID, "slug": SLUG, "title": "Test", "year": 1662,
        "creators": [], "tags": [], "languages": ["la"], "collections": [],
    }, ensure_ascii=False), encoding="utf-8")

    def _page(base, txt, annotations):
        (work_dir / f"{base}.jpg").write_bytes(b"\xff\xd8jpeg")
        (work_dir / f"{base}.txt").write_text(txt, encoding="utf-8")
        (work_dir / f"{base}.json").write_text(json.dumps({
            "sequence": 100, "status": "Töös", "page_tags": [], "comments": [],
            "text_annotations": annotations, "history": [],
        }, ensure_ascii=False), encoding="utf-8")

    _page(f"{SLUG}-{WORK_ID}-001", "Soræ d. 9 Martij A.o <ann2>1662</ann2>", [ANN])
    _page(f"{SLUG}-{WORK_ID}-002", "Tekst ilma märkusteta", [])

    monkeypatch.setattr(ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(ops, "ARCHIVES_FILE", str(tmp_path / "_archives.json"))
    (tmp_path / "_archives.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(ops, "load_collections", lambda: {})
    monkeypatch.setattr(ops, "load_people_aliases", lambda: {})
    monkeypatch.setattr(ops, "load_labels_store", lambda: {})

    captured = {}

    def _fake_send(documents, wait=True):
        captured["docs"] = documents
        return True

    monkeypatch.setattr(ops, "send_to_meilisearch", _fake_send)
    monkeypatch.setattr(ops, "_delete_extra_pages", lambda *a: None)

    assert ops.sync_work_to_meilisearch(SLUG) is True
    return captured["docs"]


def test_dokument_kannab_ankruga_teksti(docs):
    lk1 = docs[0]
    assert lk1["lehekylje_tekst"] == "Soræ d. 9 Martij A.o 1662", \
        "otsinguväli peab jääma märgenditest puhtaks"
    assert lk1["lehekylje_tekst_ann"] == "Soræ d. 9 Martij A.o <ann2>1662</ann2>"
    assert lk1["text_annotations"][0]["comment"] == "kahtlane"


def test_dokument_ei_kanna_valja_annotatsioonideta_lehel(docs):
    """Tingimuslik väli — 99 % lehtedest ei tohi teist tekstikoopiat kanda."""
    assert "lehekylje_tekst_ann" not in docs[1]
