# Bot-linkgraafi laiendus: kodulehe-indeks + bot-lehtede ristviited

**Kuupäev:** 2026-06-27
**Eesmärk:** Anda Google'ile (ja teistele bottidele) crawl'itav sisemine linkgraaf, et avalikud teosed ja isikud oleksid avastatavad mitte ainult sitemapist, vaid ka linke järgides. Praegu `location /` serveerib botile tühja SPA-shelli ja olemasolevad `/work`/`/persons` bot-lehed sisaldavad ainult self-linki.

## Taust (serverist mõõdetud 2026-06-27)

- ~1260 avalikku teost, 2061 isikut indeksis, 645 isikut lingitud teostega.
- `person_to_works.json`: `person_id -> [{work_id, role}]` — pööratav work→isik.
- Elav nginx: `location = /sitemap.xml` proxyb backendi; `/work/` + `/persons` bot-rewrite olemas; **`location /` botile rewrite puudub**.

## Graafi kuju

Kaks hub-lehte + leht-tasandi ristviited, iga sõlm ≤2 hüpet:

```
/ (home hub) ── grupeeritud kollektsioonide kaupa → kõik ~1260 teost
            └─→ /persons
/persons (hub) ─→ kõik 2061 isikut
/work/{id} ─→ loojate isikukaardid (work→isik) + tagasi /, /persons
/persons/{id} ─→ tema avalikud teosed + tagasi /persons, /
```

Reachability garanteerib home hub (iga teos 1 hüpe `/`-st) ja persons hub (iga isik 1 hüpe). Leht-ristviited loovad kahepoolse graafi teos↔isik ja jaotavad PageRanki.

## Komponendid (`server/metadata_handler.py`)

Kõik builderid puhtad/süstitud andmetega (järgib olemasolevat `build_sitemap_xml` mustrit). Route'id (`server/routers/public.py`) koguvad andmed.

1. **`build_home_meta_html(work_id_cache, is_work_public_fn, load_meta_fn, work_collections, collections)`** — UUS.
   Iteerib teosed (nagu sitemap), filtreerib avalikud, grupeerib `<h2>`-de alla kollektsiooni et-label järgi (`work_collections` = work_id→[collection_id], `collections` = config). Ilma kollektsioonita teosed "Muu" alla. Iga teos `<a href=/work/{id}>{title} {year}</a>`. Lõpus `<a href=/persons>`.

2. **`build_persons_meta_html(person_entries=None)`** — MUUDA. Lisab `<ul>` linke kõigile mitte-tombstone/merged isikutele (`entries` = [{id,label}]). `None` → praegune käitumine (ainult self-link).

3. **`build_meta_html(work_id, creator_persons=None)`** — MUUDA. `creator_persons` = eel-resolvitud [{id,label}] (route filtreerib). Lisab kehasse loojate `<a href=/persons/{id}>` lingid + tagasi-lingid `/` ja `/persons`. Tagasi-lingid alati, ka kui `creator_persons` tühi.

4. **`build_person_meta_html(person_id, work_links=None)`** — MUUDA. `work_links` = eel-resolvitud [{work_id,title}] (route filtreerib ainult avalikud). Lisab tema teoste lingid + tagasi-lingid `/persons`, `/`.

## Andmete kogumine

- **`get_persons_for_work(work_id) -> [{id,label}]`** (`server/prosopography/ops.py`, UUS): cache'itud `person_to_works` pööramine work→isik; label isikuindeksist. TTL nagu muud cache'id.
- Route'id kasutavad olemasolevaid: `WORK_ID_CACHE`, `is_work_public`, `_load_work_metadata`, `WORK_COLLECTIONS_INDEX_FILE`, `get_cached_collections`, `_load_index`, `get_person_with_works`.

## Route'id (`server/routers/public.py`)

- **UUS** `GET /meta/home` → kogub work-andmed + collections, kutsub `build_home_meta_html`. Cache'itud (TTL nagu sitemap).
- `GET /meta/persons` → edastab `_load_index()["entries"]`.
- `GET /meta/work/{id}` → arvutab `creator_persons = get_persons_for_work(id)` (avalik-filtreeritud), edastab.
- `GET /meta/person/{id}` → arvutab avalikud `work_links` (title `_load_work_metadata`-st, `is_work_public` filter), edastab.

## Marsruutimine (nginx)

`location = /` lisada bot-rewrite → `/api/files/meta/home`; muidu `try_files /index.html`. Uuenda repo `nginx.host.conf` + `nginx.conf`; rakenda elavas `/etc/nginx/sites-available/vutt` (ssh).

## Cloaking

Bot-HTML on info-ekvivalentne kasutaja sisuga (samad teosed/isikud, samad pealkirjad) — Google'i juhiste järgi lubatud, nagu olemasolevad `/work` bot-lehed.

## Testid

`tests/test_bot_link_graph.py` — puhaste builderite unit-testid fixtuuridega: grupeerimine kollektsioonide kaupa, "Muu" fallback, avalik-filter, self-link fallback (`None`), tagasi-lingid alati, tombstone/merged välistus. `get_persons_for_work` ajutise andmekaustaga.

## Scope-välised (YAGNI)

- Sama-autori teosed teose-lehel (kättesaadav isikukaardi kaudu).
- Eraldi `/collection` bot-lehed (home grupeerib niikuinii).
- Pagineerimine (mahud väikesed).
