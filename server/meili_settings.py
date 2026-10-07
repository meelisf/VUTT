"""Meilisearch indeksi atribuudinimekirjad — ÜKS tõene allikas.

Varem olid need kahes kohas: seed-skriptis (täisnimekiri) ja
meilisearch_ops._ensure_filterable_attributes()-is (väiksem 'needed' hulk).
Kaks nimekirja said vaikselt lahku minna.

Väljanimede ORTOGRAAFIA on legacy ('y'-kuju: lehekylje_tekst) — vt ADR 0006.
Ümbernimetamine nõuab täisreindeksit, mitte möödaminnes muutmist.
"""

SEARCHABLE_ATTRIBUTES = [
    "title",
    "title_en",        # ADR 0064 — ka dashboardi attributesToSearchOn-is
    "title_original",
    "authors_text",
    "year",
    "location_search",
    "publisher_search",
    "genre_search",
    "tags_search",
    "notes",
    "series_title",
    "lehekylje_tekst",
    "marginaalia_tekst",
    "page_tags",
    "page_tags_et",
    "page_tags_en",
    "comments.text",
    "archive_refs_text",
    "text_annotations_text",
]

FILTERABLE_ATTRIBUTES = [
    "work_id",
    "year",
    "date_start",
    "date_end",
    "year_start",
    "year_end",
    "title",
    "location_id",
    "location",
    "publisher_id",
    "publisher",
    "genre_ids",
    "tags_ids",
    "type_ids",
    "creator_ids",
    "creators",
    "type",
    "type_et",
    "type_en",
    "genre",
    "genre_et",
    "genre_en",
    "collection",
    "collections",
    "collections_hierarchy",
    "authors_text",
    "author_names",
    "respondens_names",
    "languages",
    "lehekylje_number",
    "originaal_kataloog",
    "page_tags",
    "page_tags_et",
    "page_tags_en",
    "page_tags_ids",
    "page_tags_suggest_et",
    "page_tags_suggest_en",
    "has_annotations",
    "status",
    "teose_staatus",
    "tags",
    "tags_et",
    "tags_en",
    "is_public",
    "shareable",
    "external_url",
]

SORTABLE_ATTRIBUTES = [
    "date_sort",
    "year",
    "lehekylje_number",
    "last_modified",
    "title",
]

# Indeks seab faceting.maxValuesPerFacet selle väärtuse peale (Meili vaikimisi
# on 100). Facet-põhine väärtusloend võib selle lae juures olla poolik.
MAX_VALUES_PER_FACET = 5000

# Alamhulk, mida runtime kontrollib ja vajadusel juurde lapib
# (varem literaalne hulk meilisearch_ops.py-s).
RUNTIME_REQUIRED_FILTERABLE = {
    "is_public",
    "shareable",
    "collections_hierarchy",
    "collections",
    "date_start",
    "date_end",
    "year_start",
    "year_end",
    "external_url",
}


# --- Kirjade indeks (#526, ADR 0065) ---
# Üks dokument kirja-osa kohta. Väljanimed on ingliskeelsed: ADR 0006 legacy-nimed
# kehtivad teosed-indeksis, uus indeks neid ei korda.
LETTERS_INDEX_NAME = "kirjad"

LETTERS_SEARCHABLE_ATTRIBUTES = [
    "names_text",
    "title",
    "incipit",
    "abstract",
    "place_from",
    "place_to",
    "letter_text",
    "archive_refs_text",
    "work_title",
]

LETTERS_FILTERABLE_ATTRIBUTES = [
    "id",                      # aegunud kirjade kustutus filtriga
    "work_id",
    "is_public",
    "collections_hierarchy",
    "authors",
    "addressees",
    "author_ids",
    "addressee_ids",
    "date_start",
    "date_end",
    "place_from",
    "place_to",
    "place_from_id",
    "place_to_id",
    "languages",
]

LETTERS_SORTABLE_ATTRIBUTES = [
    "date_sort",
]

# Väljad, mis võivad dokumendist puududa — lünk andmetes, mitte viga.
LETTERS_OPTIONAL_FIELDS = {
    "author_ids",
    "addressee_ids",
    "place_from_id",
    "place_to_id",
    "dating",
    "date_start",
    "date_end",
    "date_sort",
    "languages",
}
