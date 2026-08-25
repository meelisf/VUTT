"""Meili päringukehade koostamine. Puhas moodul: ei HTTP-d, ei väljundivormingut.

Väljanimed on legacy 'y'-ortograafias (ADR 0006) — mitte ümber nimetada.

NB: see moodul EI TOHI importida `server`-it — pipx paigaldab paketi
isoleeritud venv-i, kus repo `server/` puudub. Duplikaadid (normalize_query,
FACET_VALUE_CAP) on seetõttu tahtlikud; `test_meili_contract.py` valvab, et
need ei lahkneks indekseerija poolest.
"""

CROP_LENGTH = 40  # sõnades — Meili cropLength on sõnapõhine, ~200 tähemärki

# Indeksi faceting.maxValuesPerFacet (server/meili_settings.py). Lepingu-test
# kontrollib, et need kaks ei lahkneks.
FACET_VALUE_CAP = 5000

# Väljad, mida otsingutulemuses küsime
SEARCH_RETRIEVE_FIELDS = [
    "work_id",
    "title",
    "autor",
    "respondens",
    "aasta",
    "year_display",
    "lehekylje_number",
    "teose_lehekylgede_arv",
    "status",
    "collections",
    "languages",
    "location",
    "genre",
    "creators",
]

# Väljad, mida lehekülje lugemisel küsime
PAGE_RETRIEVE_FIELDS = [
    "work_id",
    "lehekylje_number",
    "lehekylje_tekst",
    "marginaalia_tekst",
    "status",
    "teose_lehekylgede_arv",
]

# Teose ülevaade (get_work): metaandmed + lehekülgede loend, AGA ILMA tekstita.
# Tekst oleks siin puhas koormus — ülevaade näitab ainult numbrit ja seisundit.
WORK_OVERVIEW_RETRIEVE_FIELDS = [
    "work_id",
    "title",
    "autor",
    "respondens",
    "aasta",
    "year_display",
    "location",
    "publisher",
    "genre",
    "languages",
    "collections",
    "notes",
    # praeses, gratulandid ja eessõna autor elavad AINULT siin — tuletatud
    # väljad `autor`/`respondens` neid ei kata.
    "creators",
    "lehekylje_number",
    "status",
    "teose_lehekylgede_arv",
]

# Väljad, mida kasutame FILTRIS (peavad olema filterableAttributes hulgas)
FILTER_FIELDS = [
    "work_id",
    "collections_hierarchy",
    "year",
    "languages",
    "genre_ids",
    "lehekylje_number",
]

# Väljad, mille järgi SORTEERIME (peavad olema sortableAttributes hulgas)
SORT_FIELDS = ["lehekylje_number"]

# Väljad, mida OTSIME (peavad olema searchableAttributes hulgas)
# Väljad, millest otsitakse. Teose metaandmed (title, authors_text) on
# dubleeritud IGALE lehe-dokumendile, nii et ilma selle piiranguta andis üks
# pealkirjavaste kõik teose leheküljed „vasteks": „Buchdrucker" 469 vastet,
# millest 380 ei sisaldanud sõna üldse, ja top-10 tuli ühest teosest.
# Sama jaotus nagu töölaual (searchService.ts, scope='original').
PAGE_SEARCH_FIELDS = ["lehekylje_tekst", "marginaalia_tekst"]
WORK_SEARCH_FIELDS = PAGE_SEARCH_FIELDS + ["title", "authors_text"]
# Lepingutesti jaoks: kõik, mida kuskil otsime, peab olema searchable.
SEARCH_FIELDS = WORK_SEARCH_FIELDS

# Kasutajale nähtav filtrinimi → Meili atribuut
FACET_FIELDS = {
    "collections": "collections_hierarchy",
    "languages": "languages",
    "genres": "genre_ids",
    "types": "type_ids",
}

MAX_LIMIT = 50

# Mitu lehekülge ühest teosest mahub teoseülesesse otsingutulemusse ja mitu
# korda üle tõmmatakse, et kapp saaks midagi kärpida. Ilma kapita täitis üks
# teos kogu akna: „typographus", limit=10 → sama teose leheküljed 1–10, ehkki
# vasteid oli 258. Agent sai vaikselt vale pildi korpusest.
PAGES_PER_WORK = 3
# Ületõmbetegur ja lagi. Kapp saab kärpida ainult seda, mis aknasse mahub.
# Mõõdetud 2026-08-25 pärast PAGE_SEARCH_FIELDS-i parandust: aken 30 annab
# 8–10 eri teost (~85 ms), aken 60 ega 200 ei lisa ühtki teost, aga latents
# kasvab 200 juures 250–360 ms-ni. Enne välja-parandust oleks sama tulemuse
# jaoks vaja olnud akent 200 — juur oli otsinguulatuses, mitte aknas.
OVERFETCH = 3
MAX_FETCH = 60


def apply_spread_window(body: dict, *, offset: int, limit: int) -> dict:
    """Vahetab kuvatava akna ületõmbeakna vastu (teoseülene otsing).

    Kärpimine peab käima ENNE offsetit, seega tõmbame alati esimesest
    vastest alates ja lõikame ise.
    """
    body["hitsPerPage"] = min(max((offset + limit) * OVERFETCH, offset + limit),
                              MAX_FETCH)
    body["page"] = 1
    return body


def cap_pages_per_work(hits: list[dict], cap: int) -> list[dict]:
    """Kärbib iga teose osakaalu, säilitades Meili relevantsusjärjekorra.

    `cap <= 0` → ei kärbi (teosesisene otsing, kus kapp oleks vale: seal ongi
    küsimus „kus SELLES teoses").
    """
    if cap <= 0:
        return list(hits)
    loetud: dict[str, int] = {}
    valitud = []
    for hit in hits:
        wid = hit.get("work_id", "")
        if loetud.get(wid, 0) >= cap:
            continue
        loetud[wid] = loetud.get(wid, 0) + 1
        valitud.append(hit)
    return valitud


def normalize_query(text: str) -> str:
    """ß → ss. PEAB kattuma server.meili_doc.normalize_eszett-iga (#228).

    Meili voldib täpitähed ise, ß-i mitte. Kui ainult indeks normaliseeritakse,
    ei leia „Schluß" enam midagi.
    """
    if not text:
        return ""
    return text.replace("ß", "ss").replace("ẞ", "SS")


def _quote(value) -> str:
    """Meili filtri stringiliteraal — jutumärgid sisus escape'itakse."""
    return '"' + str(value).replace('"', '\\"') + '"'


def build_search_body(
    query: str,
    *,
    distinct_works: bool = False,
    collection: str | None = None,
    year_from: int | None = None,
    year_to: int | None = None,
    language: str | None = None,
    genre_id: str | None = None,
    work_id: str | None = None,
    relax_matching: bool = False,
    search_fields: list[str] | None = None,
    limit: int = 10,
    offset: int = 0,
) -> dict:
    """Koostab otsingupäringu keha.

    `distinct_works=True` → teosetasandi tulemus. Meili valib sama work_id
    lehekülgedest kõrgeima rankinguga tabamuse; kasutame seda esindava
    lehekülje ja katke näitamiseks.
    """
    clauses: list[str] = []
    if work_id:
        clauses.append(f"work_id = {_quote(work_id)}")
    if collection:
        clauses.append(f"collections_hierarchy = {_quote(collection)}")
    if year_from is not None:
        clauses.append(f"year >= {int(year_from)}")
    if year_to is not None:
        clauses.append(f"year <= {int(year_to)}")
    if language:
        clauses.append(f"languages = {_quote(language)}")
    if genre_id:
        clauses.append(f"genre_ids = {_quote(genre_id)}")

    per_page = max(1, min(int(limit), MAX_LIMIT))
    body: dict = {
        "q": normalize_query(query),
        # Vaikimisi "all": Meili "last" hakkaks päringust sõnu eemaldama, kui
        # täisvasteid napib — faktikontrollis tähendaks see vaikset valepositiivi.
        "matchingStrategy": "last" if relax_matching else "all",
        "attributesToRetrieve": SEARCH_RETRIEVE_FIELDS,
        "attributesToCrop": ["lehekylje_tekst", "marginaalia_tekst"],
        "cropLength": CROP_LENGTH,
        "attributesToHighlight": [],
        "hitsPerPage": per_page,
        "page": (int(offset) // per_page) + 1,
    }
    if search_fields:
        body["attributesToSearchOn"] = list(search_fields)
    if distinct_works:
        body["distinct"] = "work_id"
    if clauses:
        body["filter"] = " AND ".join(clauses)
    return body


def build_work_pages_body(
    work_id: str,
    from_page: int | None = None,
    to_page: int | None = None,
    limit: int = 1000,
) -> dict:
    """Ühe teose leheküljed kanoonilises järjestuses.

    Invariant: alati `lehekylje_number:asc` — get_work ja get_pages tuginevad
    sellele järjestusele.
    """
    clauses = [f"work_id = {_quote(work_id)}"]
    if from_page is not None:
        clauses.append(f"lehekylje_number >= {int(from_page)}")
    if to_page is not None:
        clauses.append(f"lehekylje_number <= {int(to_page)}")
    return {
        "q": "",
        "filter": " AND ".join(clauses),
        "sort": ["lehekylje_number:asc"],
        "attributesToRetrieve": PAGE_RETRIEVE_FIELDS,
        "limit": int(limit),
    }


def build_work_overview_body(work_id: str, limit: int = 1000) -> dict:
    """Teose ülevaade: metaandmed + lehekülgede loend, ilma tekstita.

    Eraldi `build_work_pages_body`-st, sest see küsib teisi välju: metaandmed
    tulevad esimesest hitist ja lehekülje teksti siin ei taheta.
    """
    return {
        "q": "",
        "filter": f"work_id = {_quote(work_id)}",
        "sort": ["lehekylje_number:asc"],
        "attributesToRetrieve": WORK_OVERVIEW_RETRIEVE_FIELDS,
        "limit": int(limit),
    }


def build_facets_body(field: str) -> dict:
    """Facet-jaotus ühe välja kohta. `limit: 0` — hitte ei taha."""
    return {"q": "", "limit": 0, "facets": [field]}
