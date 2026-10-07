"""Kirjaindeksi dokumendid (#526, ADR 0065): build_letter_documents.

Kirjadokument tuletatakse sama teose LEHEDOKUMENTIDEST — ligipääsuväljad ja
tekst ei tohi tulla kuskilt mujalt, muidu lähevad kaks indeksit lahku.
"""
from server.meili_doc import build_letter_documents
from server.meili_settings import (
    LETTERS_FILTERABLE_ATTRIBUTES,
    LETTERS_OPTIONAL_FIELDS,
    LETTERS_SEARCHABLE_ATTRIBUTES,
    LETTERS_SORTABLE_ATTRIBUTES,
)


def _page(num, text="", marg="", is_public=True, hierarchy=("avalik",)):
    return {
        "id": f"w1-{num}",
        "work_id": "w1",
        "lehekylje_number": num,
        "lehekylje_pilt": f"slug-w1/a-{num:03d}.jpg",
        "lehekylje_tekst": text,
        "marginaalia_tekst": marg,
        "is_public": is_public,
        "collections_hierarchy": list(hierarchy),
        "title": "Briefe an Fischer",
        "archive_refs_text": "HAB Cod. Guelf. 151",
    }


PAGES = [_page(n, text=f"tekst{n}") for n in range(1, 6)]


def _letter(**kw):
    part = {"id": "p1", "kind": "letter", "pages": ["a-002"]}
    part.update(kw)
    return part


def _build(parts, pages=PAGES, people=None, meta_extra=None):
    meta = {"id": "w1", "parts": parts}
    meta.update(meta_extra or {})
    return build_letter_documents(meta, pages, people or {})


def test_ainult_kirjad():
    docs = _build([_letter(), {"id": "p2", "kind": "poem", "pages": ["a-003"]}])
    assert [d["part_id"] for d in docs] == ["p1"]
    assert docs[0]["id"] == "w1__p1"
    assert docs[0]["work_id"] == "w1"


def test_katkendlik_kiri_teose_jarjekorras():
    docs = _build([_letter(pages=["a-004", "a-002"])])
    d = docs[0]
    assert d["letter_text"] == "tekst2\ntekst4"
    assert d["first_page"] == 2
    assert d["page_count"] == 2


def test_marginaalia_laheb_kirja_teksti():
    pages = [_page(2, text="põhi", marg="äär")]
    assert _build([_letter()], pages=pages)[0]["letter_text"] == "põhi\näär"


def test_leht_kahes_kirjas_laheb_mõlemasse():
    docs = _build([_letter(id="p1", pages=["a-002", "a-003"]),
                   _letter(id="p2", pages=["a-003", "a-004"])])
    assert "tekst3" in docs[0]["letter_text"]
    assert "tekst3" in docs[1]["letter_text"]


def test_puuduv_tuvi_jaetakse_vahele():
    docs = _build([_letter(pages=["a-002", "kadunud-009"])])
    assert docs[0]["page_count"] == 1
    assert _build([_letter(pages=["kadunud-009"])]) == []


def test_ligipaas_tuleb_lehedokumendist():
    pages = [_page(2, is_public=False, hierarchy=("piiratud", "piiratud-alam"))]
    # Meta kogud EI mõjuta: autoriteet on lehedokument.
    d = _build([_letter()], pages=pages, meta_extra={"collections": ["avalik"]})[0]
    assert d["is_public"] is False
    assert d["collections_hierarchy"] == ["piiratud", "piiratud-alam"]


def test_dateering_vahemik():
    d = _build([_letter(dating={"start": "1684", "end": "1686"})])[0]
    assert d["date_start"] == 16840101
    assert d["date_end"] == 16861231
    assert d["date_sort"] == 16840101
    assert d["dating"]["end"] == "1686"


def test_dateeringuta_kirjal_pole_kuupaeva_valju_teose_aasta_ei_asenda():
    d = _build([_letter()], meta_extra={"year": 1700, "year_start": 1700, "year_end": 1700})[0]
    for key in ("dating", "date_start", "date_end", "date_sort"):
        assert key not in d


def test_isikud_ja_aliased():
    creators = [
        {"id": "vutt:P1", "name": "Spener", "role": "auctor"},
        {"name": "Anonüümne saaja", "role": "addressee"},
    ]
    people = {"vutt:P1": {"aliases": ["Spenerus, Philippus"]}}
    d = _build([_letter(creators=creators)], people=people)[0]
    assert d["authors"] == ["Spener"]
    assert d["author_ids"] == ["vutt:P1"]
    assert d["addressees"] == ["Anonüümne saaja"]
    assert "addressee_ids" not in d
    assert "Spenerus, Philippus" in d["names_text"]
    assert "Philippus Spenerus" in d["names_text"]


def test_koht_ilma_idta_on_silt():
    d = _build([_letter(place={"id": None, "label": "Frankfurt"},
                        place_to={"id": "Q1", "label": "Sulzbach"})])[0]
    assert d["place_from"] == "Frankfurt"
    assert "place_from_id" not in d
    assert d["place_to"] == "Sulzbach"
    assert d["place_to_id"] == "Q1"


def test_kokkuvote_mõlemast_keelest():
    d = _build([_letter(abstract_et="Eesti", abstract_en="English")])[0]
    assert d["abstract"] == "Eesti English"


def test_tuhjad_lehedokumendid():
    assert build_letter_documents({"parts": [_letter()]}, [], {}) == []


def test_seadete_leping():
    minimal = _build([_letter()])[0]
    full = _build([_letter(
        creators=[{"id": "vutt:P1", "name": "A", "role": "auctor"},
                  {"id": "vutt:P2", "name": "B", "role": "addressee"}],
        place={"id": "Q1", "label": "X"}, place_to={"id": "Q2", "label": "Y"},
        dating={"start": "1684"}, languages=["lat"],
    )])[0]
    # Otsitavad väljad on ALATI olemas (attributesToSearchOn nõuab).
    for field in LETTERS_SEARCHABLE_ATTRIBUTES:
        assert field in minimal, field
    # Filter/sort: kas alati olemas või teadlikult valikuline; tundmatut välja ei ole.
    for field in set(LETTERS_FILTERABLE_ATTRIBUTES) | set(LETTERS_SORTABLE_ATTRIBUTES):
        assert field in full, field
        assert field in minimal or field in LETTERS_OPTIONAL_FIELDS, field
