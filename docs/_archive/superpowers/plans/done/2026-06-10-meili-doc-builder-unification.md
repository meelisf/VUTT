# Pool 2 — Meilisearch dokumendiehitaja ühendamine (struktuurne dedup)

**Staatus:** ettevalmistavad märkused (mitte teostatud). Eelduseks Pool 1 (käitumise reconcile) — TEHTUD 2026-06-10.
**Seotud:** MEMORY `project_meili_two_index_paths`. Commitid Pool 1: `86e0739`, `d380656`.

## Eesmärk

Eemaldada Meilisearch-dokumendi ehitamise **duplikatsioon** kahe indekseerimistee vahel, et need ei saaks enam käitumuslikult lahku triivida (Pool 1 parandas triivi tagajärjed; Pool 2 eemaldab triivi *võimaluse*).

## Miks (kontekst)

Dokumente ehitatakse kahel teel:
- **Live `/save`** — `server/meilisearch_ops.py` → `sync_work_to_meilisearch(dir_name)`. Üks teos, loeb failisüsteemist, kasutab cache'i (people/labels/collections).
- **Bulk seed** — `scripts/1-1_consolidate_data.py` → `scripts/2-1_upload_to_meili.py` (käivitab `server_seed_data.sh`). Kõik teosed, loeb sõltuvused kettalt, kirjutab JSONL-i.

Mõlemad ehitavad **sama ~120-realise `doc = {...}` dokumendi inline**, eraldi koodina. 2026-06 audit leidis ~10 lahknenud välja (sh `clean_text_for_search` ei eemaldanud XML-tägisid → tägi-külgsed sõnad otsimatud; page_tags register; location/publisher objekt vs string; alias-inversioon). Pool 1 ühtlustas need käsitsi — aga duplikaat püsib ja võib uuesti triivida.

## Mis on JUBA jagatud (`server/utils`)

Mõlemad failid impordivad: `capitalize_first, get_label, get_id, get_all_labels, get_primary_labels, get_labels_by_lang, get_all_ids, sanitize_id, calculate_work_status, normalize_genre, atomic_write_json, generate_default_metadata, pick_best_label`. → **`server/utils` on õige koht ka jagatud dokumendiehitajale.** Import standalone-skriptist juba töötab (fake-package muster, vt MEMORY `feedback_script_server_import`; consolidate: `from server.utils import (...)`).

## Mis on duplikaadis (Pool 2 sihtmärgid)

Defineeritud MÕLEMAS failis (nüüd identsed v.a. deps-laadimine):
- `clean_text_for_search` ✅ identne (Pool 1 järel)
- `get_creator_aliases`, `_invert_name` ✅ identne (Pool 1 järel)
- `get_entity_aliases` — consolidate'is; ops teeb sama inline (publisher_aliases/tag_aliases)
- `build_text_annotations_text`, `build_archive_refs_text` — consolidate'is; ops vastav inline/eraldi
- `get_collection_hierarchy`
- `load_collections`, `load_people_aliases`, `load_archives` — **erinevad**: consolidate kettalt, live cache'ist (`server/cache.py`)
- `calculate_work_status` — consolidate oma def; ops impordib `server.utils`-ist (consolidate võiks samuti importida)
- `normalize_creator` — ainult ops-is (consolidate `author_names` ei normaliseeri; auditis ei erinenud testitud teostel, aga teoreetiline lahknevus)

**Tuum:** `doc = {...}` dokumendi-dict ise on inline mõlemas (ops `~484–600+`, consolidate `~462–571`).

## Reconcile-otsused (Pool 1 — ÄRA re-litigeeri)

Kanooniline = **ops-versioon**. Põhjendused:
- `clean_text_for_search`: XML-aware, regex `</?[a-z]+\d*>` (katab ka `<ann1>`).
- `page_tags(_et/_en)`: capitalize_first (EI lowercase) — ühtlane teose `tags`-iga; frontend `buildPageTagFilter` kasutab fasseti väärtust otse.
- `location`/`publisher`: **string-label** flat väljal (filter `publisher = "..."` + display); täisobjektid `*_object` väljadel; frontend `normalizeWork` loeb `*_object`.
- alias-inversioon: lisa "Eesnimi Perenimi" variant (otsingu katvus).

## Pakutud disain

Üks puhas funktsioon jagatud moodulis, nt `server/meili_doc.py` (või `server/utils` alammoodul):

```python
def build_page_document(work_metadata, page_meta, page_text, page_num, total_pages,
                        image_rel_path, last_modified, deps) -> dict:
    """Ehitab ÜHE lehekülje Meilisearch-dokumendi. Ainus tõeallikas mõlemale teele."""
    # deps: PageDocDeps(labels_store, people_data, collections, archives)
    ...
```

- **`deps` (dependency bundle)** — lahendab cache-vs-ketas lahknevuse: kumbki kutsuja koostab `deps` oma moodi:
  - live (`meilisearch_ops`): cache'ist (`server/cache.py`)
  - bulk (`consolidate`): kettalt (load_* funktsioonid)
  - Funktsioon ise on puhas (ei tee I/O-d).
- Kolib jagatusse ka: `clean_text_for_search`, `get_creator_aliases`/`_invert_name`/`get_entity_aliases`, `build_text_annotations_text`/`build_archive_refs_text`, `get_collection_hierarchy`, `normalize_creator`.
- Kutsujad jäävad õhukeseks: failisüsteemi-loop + deps-koostamine + `build_page_document(...)` kutse.

## Migratsiooni sammud (soovituslik järjekord)

1. **Karakteriseerimistest ENNE refaktoorimist** (lukusta praegune ops-flavor käitumine):
   - Vt töötav diff-harness all. Snapshot N teose (sh rikkad: creators+aliased+page_tags+marginaalia) page-1 dokumendid ops-teelt → salvesta golden JSON.
2. Loo `server/meili_doc.py`, kopeeri ops-i dokumendi-dict + abid sinna, kutse-interface `build_page_document`.
3. Suuna `meilisearch_ops.sync_work_to_meilisearch` kasutama seda (deps cache'ist). Jooksuta golden-diff → peab olema identne.
4. Suuna `consolidate` kasutama seda (deps kettalt). Eemalda consolidate'i duplikaat-defid + inline dokument.
5. **Täis-reseed** + Pool 1 verifitseerimissuite (vt all).

## Karakteriseerimistest / verifitseerimine (töötav harness)

Konteineris (`docker exec -i vutt-backend python3 -`):
- Võrdle uue consolidate JSONL-i (`output/meilisearch_data_per_page.jsonl`) vs live-flavor indeks samade teoste kohta.
- Ignoreeri: `last_modified`, legacy `aasta/autor/respondens`, `archive_refs_text/text_annotations_text` (tühi vs puudub). List-väljad (`authors_text` jne) võrdle HULGANA (järjekord ükskõik).
- Funktsionaalne suite (Pool 1-st): 0 jääk-tägi `lehekylje_tekst`-is; `denarios`/`Bactrock`/`RELATIO` leitavad; `page_tags` capitalize; `publisher`/`location` string; ca-aasta filter (`sg1gvs` ∈ 1740–1760).
- Meili päring: `MEILI_URL`/`MEILI_KEY`/`INDEX_NAME` `server.config`-ist; `id` EI ole filtreeritav → kasuta `work_id`.

## Riskid

- Dokument juhib KOGU otsinguindeksit — vale muudatus lõhub otsingu/filtri/fassetid korraga. Sellepärast golden-diff enne ja reseed-verify pärast on kohustuslik.
- Reseed on destruktiivne (kustutab+taasloob indeksi), ~2–3 min. Kood on Dockerisse **baked** (scripts/+server/ EI ole volume-mount) → vajab `git pull` + `./scripts/server_update.sh --no-cache` enne reseedi.
- `server_seed_data.sh` kasutab `docker exec -it` (TTY) — skriptist/pipest jooksutades käivita 3 sammu otse ilma `-it`: consolidate → `2-1_upload_to_meili.py` → `rebuild_indices()`.

## Teadaolevad jäägid (Pool 1-st, mitte blokeerivad)

- Bookmark'itud lowercase page-tag filtri URL (`?pageTags=embleem`) ei matchi enam (indeks "Embleem"). Fassetist genereeritud lingid õiged.
- `<ann1>` jne nüüd stripitud; kui tuleb muid eri-tägiformaate, kontrolli regexit `</?[a-z]+\d*>`.

## Hinnang

Mitmetunnine, indeksi-kriitiline refaktor — omaette fokusseeritud sessioon (brainstorm → plaan → TDD/golden-diff → review → reseed). Mitte kiirustada sulguva akna vastu. Väärtus: ainult "ei triivi enam" (käitumine on Pool 1-ga juba õige), seega mitte-kiireloomuline.
