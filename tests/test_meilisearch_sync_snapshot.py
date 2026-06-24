"""
Snapshot-testid sync_work_to_meilisearch jaoks (server/meilisearch_ops.py:315).

Eesmärk (issue #16): lukustada _metadata.json → Meilisearch dokumendi kaardistamise
käitumine ENNE suuremat refaktooringut. Kui refaktoreerimisel (plaanitud abifunktsioonid
_build_page_document / _clean_search_text / _load_work_index_context / _upsert_documents)
midagi muutub, peavad need testid seda kohe tabama.

Meetod: send_to_meilisearch ja _delete_extra_pages on mockitud, nii et dokumendid püütakse
kinni ilma päris Meilisearchita. Config-laadijaid (load_collections/load_people_aliases/
load_labels_store) samuti monkeypatch'itakse, et kaardistamine olele deterministlik.

Iga test fikseerib ühe semantilise raja (ühine _synced fixture):
  - marginaalia eraldus: lehekylje_tekst vs text_content vs marginaalia_tekst
  - LinkedEntity ID-d: type_ids / genre_ids / tags_ids / location_id / publisher_id
  - autor/respondens rollide prioriteet (auctor > praeses > esimene)
  - authors_text aliased (Laurentius Ludenius → Lorenz Luden tagasiotsing)
  - kollektsioonid: collections_hierarchy (vanemad) + is_public (OR-loogika)
  - aastavahemik (parse_year_range "ca. 1690" → 1680-1700)
  - teose_staatus koondamine (Toores + Valmis → Töös)
  - archive_refs_text denormaliseerimine
  - last_modified mtime-põhine (deterministliku utime abil lukustatud)
"""
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.meilisearch_ops as ops


# =========================================================
# Kontrollitud fiksiivsed registrid (asendavad serveri config-failid)
# =========================================================

COLLECTIONS = {
    "col-public": {"name": {"et": "Avalik kogu"}, "visibility": "public", "parent": None},
    "child-col": {"name": {"et": "Alamkogu"}, "visibility": "restricted", "parent": "col-public"},
    "col-restricted": {"name": {"et": "Piiratud kogu"}, "visibility": "restricted", "parent": None},
}

# isikuregister: Q123 (auctor) ja Q456 (respondens)
PEOPLE = {
    "Q123": {
        "primary_name": "Lorenz Luden",      # kanooniline nimi
        "aliases": ["Laurentius Ludenius", "Ludenius"],
        "ids": {"wikidata": "Q123"},
    },
    "Q456": {
        "primary_name": "Johannes Respondent",
        "aliases": ["Johannes R."],
        "ids": {"wikidata": "Q456"},
    },
}

# Kanooniline Q→label register (labels.json). Q500 on lehe märksõna.
LABELS = {
    "Q500": {"et": "Marginaal", "en": "Margin"},   # ülekirjutab _metadata labeli
    "Q111": {"et": "Disputatsioon", "en": "Disputation"},
}

ARCHIVES = {"RA": {"name": "Rahvusarhiiv", "url": "https://ais.ra.ee"}}

WORK_ID = "abc123xyz"
SLUG = "1690-test-teos"


def _write_metadata(work_dir: Path):
    (work_dir / "_metadata.json").write_text(json.dumps({
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
    }, ensure_ascii=False), encoding="utf-8")


def _write_page(work_dir: Path, base: str, *, txt: str, sequence: int, status: str,
                page_tags=None, comments=None, text_annotations=None):
    (work_dir / f"{base}.jpg").write_bytes(b"\xff\xd8jpeg")
    (work_dir / f"{base}.txt").write_text(txt, encoding="utf-8")
    (work_dir / f"{base}.json").write_text(json.dumps({
        "sequence": sequence,
        "status": status,
        "page_tags": page_tags or [],
        "comments": comments or [],
        "text_annotations": text_annotations or [],
        "history": [],
    }, ensure_ascii=False), encoding="utf-8")


@pytest.fixture
def synced(tmp_path, monkeypatch):
    """Ehitab fiksiivse teose, jooksutab sync_work_to_meilisearch, tagastab kinnipüütud dokumendid."""
    work_dir = tmp_path / SLUG
    work_dir.mkdir()
    _write_metadata(work_dir)

    # Leht 1: marginaalia plokk + lehe märksõna + annotatsioon
    _write_page(
        work_dir, f"{SLUG}-{WORK_ID}-001",
        txt="welcher i\u015ft der Teuffel\n<m>Vide Picrium in hyeroglyphicis</m>\nvnd Satanas.",
        sequence=100, status="Toores",
        page_tags=[{"label": "Margin", "id": "Q500", "labels": {"et": "Margin", "en": "Margin-en"}}],
        comments=[{"text": "kommentaar"}],
        text_annotations=[{"comment": "ann1"}],
    )
    # Leht 2: inline <m> (kritiitne: ei tohi liita ümbritsevaid sõnu) + Valmis
    _write_page(
        work_dir, f"{SLUG}-{WORK_ID}-002",
        txt="foo<m>ääremärkus</m>bar coa-\ncervare",
        sequence=200, status="Valmis",
    )

    # Deterministlikud mtimed, et last_modified oleks lukustatav.
    for base in (f"{SLUG}-{WORK_ID}-001", f"{SLUG}-{WORK_ID}-002"):
        os.utime(work_dir / f"{base}.txt", (1_000_000, 1_000_000))

    # --- monkeypatch kõik välised sõltuvused ---
    monkeypatch.setattr(ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(ops, "ARCHIVES_FILE", str(tmp_path / "_archives.json"))
    (tmp_path / "_archives.json").write_text(json.dumps(ARCHIVES), encoding="utf-8")

    monkeypatch.setattr(ops, "load_collections", lambda: COLLECTIONS)
    monkeypatch.setattr(ops, "load_people_aliases", lambda: PEOPLE)
    monkeypatch.setattr(ops, "load_labels_store", lambda: LABELS)

    # Püüa dokumendid kinni, ärge puuduta päris Meilisearchi
    captured = {"docs": None, "deleted": None}

    def fake_send(documents, wait=True):
        captured["docs"] = documents
        return True

    def fake_delete_extra(work_id, new_count):
        captured["deleted"] = (work_id, new_count)

    monkeypatch.setattr(ops, "send_to_meilisearch", fake_send)
    monkeypatch.setattr(ops, "_delete_extra_pages", fake_delete_extra)

    result = ops.sync_work_to_meilisearch(SLUG)
    assert result is True
    assert captured["docs"] is not None

    return captured


# =========================================================
# Struktuur: dokumendi arv ja ID-d
# =========================================================

def test_loob_igalt_lehelt_dokumendi(synced):
    docs = synced["docs"]
    assert len(docs) == 2
    assert [d["id"] for d in docs] == [f"{WORK_ID}-1", f"{WORK_ID}-2"]
    # kustutatakse üleliigne (work_id, uus_arv)
    assert synced["deleted"] == (WORK_ID, 2)


def test_fikseeritud_väljad_igal_dokumendil(synced):
    docs = synced["docs"]
    for d in docs:
        assert d["work_id"] == WORK_ID
        assert d["title"] == "Disputatio de Test"
        assert d["originaal_kataloog"] == SLUG
        assert d["lehekylje_pilt"].startswith(f"{SLUG}/{SLUG}-{WORK_ID}-")
        # NB: koodibaas kasutab vana õigekirja 'lehekylgede' (y, mitte 'l')
        assert d["teose_lehekylgede_arv"] == 2


# =========================================================
# Marginaalia eraldus: lehekylje_tekst / text_content / marginaalia_tekst
# =========================================================

def test_marginaalia_eraldub_ja_pohitekst_puhastub(synced):
    """OTSING: põhitekst ilma <m>-tägita, poolitused liidetud; marginaalia eraldi väljal.
    REDAKTOR: text_content on raw koos kõigi märkidega."""
    page1 = synced["docs"][0]
    # Raw tekst alles (marginaalia tägiga)
    assert "<m>Vide Picrium in hyeroglyphicis</m>" in page1["text_content"]
    # Otsingutekst: marginaalia eemaldatud, <m>-koht asendatud tühikuga, ws kollapsitud
    assert "<m>" not in page1["lehekylje_tekst"]
    assert page1["lehekylje_tekst"] == "welcher i\u015ft der Teuffel vnd Satanas."
    # Marginaalia eraldi väljal, puhastatud
    assert page1["marginaalia_tekst"] == "Vide Picrium in hyeroglyphicis"


def test_marginaalia_tyhi_kui_puudub(synced):
    """Ilma plokk-marginaaliata lehel on marginaalia_tekst tühi (väli peab siiski olemas olema)."""
    page2 = synced["docs"][1]
    assert page2["marginaalia_tekst"] == "ääremärkus"   # inline <m> sisu läheb marginaaliasse


def test_inline_m_ei_liimi_sõnu(synced):
    """Kritiitne refaktooringukaits: inline <m>foo<m>x</m>bar</m> ei tohi liita 'foobar'-iks.
    Samuti peab sidekriips+reavahetus poolituse liitma ('coa-\ncervare' → 'coacervare')."""
    page2 = synced["docs"][1]
    text = page2["lehekylje_tekst"]
    assert "foobar" not in text, f"inline <m> liimis sõnad: {text!r}"
    assert "foo" in text and "bar" in text
    assert "coacervare" in text, f"poolitust ei liidetud: {text!r}"   # coa-\ncervare → coacervare


# =========================================================
# LinkedEntity ID-d: type_ids / genre_ids / tags_ids / *_id
# =========================================================

def test_linked_entity_id_väljad(synced):
    d = synced["docs"][0]
    assert d["type_ids"] == ["Q87167"]
    assert d["genre_ids"] == ["Q111"]
    assert d["tags_ids"] == ["Q999"]
    assert d["location_id"] == "Q3258"
    assert d["publisher_id"] == "Q777"
    assert d["creator_ids"] == ["Q123", "Q456"]
    # Lehe märksõna ID-d
    assert d["page_tags_ids"] == ["Q500"]


def test_label_väljad_peegeldavad_labels_store_ylekirjutust(synced):
    """get_labels_by_lang kasutab kanoonilist labels_store-i (Q500 → 'Marginaal')."""
    d = synced["docs"][0]
    assert d["page_tags_et"] == ["Marginaal"]   # labels_store ülekirjutas _metadata 'Margin'
    assert d["page_tags_en"] == ["Margin"]      # labels_store en
    assert d["genre_et"] == ["Disputatsioon"]
    assert d["genre_en"] == ["Disputation"]


# =========================================================
# Autor / respondens rollide prioriteet
# =========================================================

def test_autor_ja_respondens_rollid(synced):
    """autor = auctor (kõrgeim prioriteet); respondens eraldi väljal."""
    d = synced["docs"][0]
    assert d["autor"] == "Laurentius Ludenius"     # auctor nimi
    assert d["respondens"] == "Johannes Respondent"
    # respondens ei tohi ilmuda author_namesse
    assert d["author_names"] == ["Lorenz Luden", "Laurentius Ludenius"]  # kanooniline + kirjapandud
    assert d["respondens_names"] == ["Johannes Respondent"]


def test_authors_text_sisaldab_aliaseid(synced):
    """authors_text peab sisaldama nimevariante, et 'Lorenz' leiaks 'Laurentius Ludenius'-t."""
    d = synced["docs"][0]
    # Kõik creatorite nimed + aliased (sh vastupidised, kui komaga)
    assert "Laurentius Ludenius" in d["authors_text"]
    assert "Johannes Respondent" in d["authors_text"]
    assert "Ludenius" in d["authors_text"]          # alias Q123-st
    # kanooniline nimi ei lähe authors_text'i (see on author_names all)


# =========================================================
# Kollektsioonid: hierarhia (vanemad) + is_public (OR)
# =========================================================

def test_collections_hierarchy_ja_is_public(synced):
    """hierarhia sisaldab vanemaid; is_public True kui vähemalt üks kollektsioon on avalik."""
    d = synced["docs"][0]
    assert d["collections"] == ["col-public", "child-col"]
    # child-col vanem col-public peab hierarhias olema
    assert set(d["collections_hierarchy"]) == {"col-public", "child-col"}
    # col-public on avalik → is_public True (vaatamata child-col restricted)
    assert d["is_public"] is True


# =========================================================
# Aastavahemik (parse_year_range)
# =========================================================

def test_year_range_ca_approximatsioon(synced):
    """"ca. 1690" → year_start 1680, year_end 1700 (±10); year jääb 1690 (sortimiseks)."""
    d = synced["docs"][0]
    assert d["aasta"] == 1690
    assert d["year"] == 1690
    assert d["year_display"] == "ca. 1690"
    assert d["year_start"] == 1680
    assert d["year_end"] == 1700


# =========================================================
# teose_staatus koondamine
# =========================================================

def test_teose_staatus_koondub_toos(synced):
    """Leht1 Toores + Leht2 Valmis → teose_staatus 'Töös' (segatud)."""
    docs = synced["docs"]
    assert docs[0]["status"] == "Toores"
    assert docs[1]["status"] == "Valmis"
    # koondstaatus kantakse kõigile lehtedele
    assert {d["teose_staatus"] for d in docs} == {"Töös"}


# =========================================================
# archive_refs_text denormaliseerimine
# =========================================================

def test_archive_refs_text_denormaliseeritud(synced):
    """archive_refs_text = kood + arhiivi täisnimi + viide (otsingu jaoks)."""
    d = synced["docs"][0]
    assert d["archive_refs"] == [{"archive_id": "RA", "reference": "f. 1"}]
    assert d["archive_refs_text"] == "RA Rahvusarhiiv f. 1"


# =========================================================
# Lehe annotatsioonid ja has_annotations
# =========================================================

def test_page_annotations_ja_has_annotations(synced):
    page1, page2 = synced["docs"]
    # page1: lehe märksõna + kommentaar + annotatsioon
    assert page1["has_annotations"] is True
    assert page1["text_annotations_text"] == "ann1"
    # NB: 'page_tags' (ilma _eta) kasutab objekti enda peamist labelit ('Margin'),
    # mitte labels_store-i. Viimast kasutavad alles page_tags_et / page_tags_en / suggest.
    assert page1["page_tags"] == ["Margin"]
    # suggest-väljad "label|||id" kujul (kasutavad labels_store-i → 'Marginaal')
    assert page1["page_tags_suggest_et"] == ["Marginaal|||Q500"]
    # page2: midagi pole → has_annotations False
    assert page2["has_annotations"] is False
    assert page2["comments"] == []


# =========================================================
# last_modified (deterministliku utime abil lukustatud)
# =========================================================

def test_last_modified_on_mtime_põhine(synced):
    """last_modified peab kajastama txt faili mtime (fikseeritud 1_000_000s → 1_000_000_000 ms)."""
    for d in synced["docs"]:
        assert d["last_modified"] == 1_000_000_000
