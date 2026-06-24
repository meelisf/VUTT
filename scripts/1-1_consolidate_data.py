#!/usr/bin/env python3
"""
VUTT Meilisearch indekseerimise skript v2.

Loeb _metadata.json failid (v2 formaat) ja genereerib JSONL faili Meilisearchi jaoks.
Iga lehekülg on eraldi dokument.

Uus formaat sisaldab:
  - id, slug, title, year, location, publisher
  - genre, collection, collections_hierarchy
  - creators, authors_text (denormaliseeritud)
  - tags, languages

Kasutamine:
  python3 scripts/1-1_consolidate_data.py
"""

import os
import sys
import json
import re
import types
import unicodedata
from tqdm import tqdm

# --- SEADISTUS ---
DATA_ROOT_DIR = os.getenv('VUTT_DATA_DIR', 'data')
OUTPUT_FILE = 'output/meilisearch_data_per_page.jsonl'
CONFIG_DIR = os.path.join(DATA_ROOT_DIR, 'config')
COLLECTIONS_FILE = os.path.join(CONFIG_DIR, 'collections.json')
PEOPLE_FILE = os.path.join(CONFIG_DIR, 'person_aliases.json')
ARCHIVES_FILE = os.path.join(CONFIG_DIR, 'archives.json')
LABELS_FILE = os.path.join(CONFIG_DIR, 'labels.json')
# --- LÕPP ---

# Impordime LinkedEntity utiliidid server/utils.py-st.
# Kasutame fake-package mustrit, et vältida server/__init__.py kõrvalefekte
# (FastAPI, gitpython, kasutajate cache jms).
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if 'server' not in sys.modules:
    _server_pkg = types.ModuleType('server')
    _server_pkg.__path__ = [os.path.join(_project_root, 'server')]
    _server_pkg.__package__ = 'server'
    sys.modules.setdefault('server', _server_pkg)
sys.path.insert(0, _project_root)
from server.utils import (
    parse_year_range, normalize_genre, calculate_work_status,
)
# Jagatud kaardistusloogika (issue #23): puhtad _metadata.json → Meili dokumendi
# funktsioonid elavad server/meili_doc.py-s, et seed/reseed-tee (see skript) ja
# live-tee (server/meilisearch_ops.py) EI SAAKS vaikselt lahku minna. Varem olid
# split_marginalia, clean_text_for_search, get_creator_aliases, _build_page_document jms
# siin dubleeritud — nüüd ainult imporditud (dokumendi ehitus käib _build_page_document'i
# kaudu, mis kutsub puhastus-/aliase-funktsioone ise).
from server.meili_doc import (
    get_collection_hierarchy, _compute_work_aliases, compute_autor_respondens,
    _build_page_document,
)


def sanitize_id(text):
    """Puhastab teksti, et see sobiks Meilisearchi dokumendi ID-ks."""
    normalized = unicodedata.normalize('NFD', text)
    ascii_text = ''.join(c for c in normalized if unicodedata.category(c) != 'Mn')
    sanitized = re.sub(r'[^a-zA-Z0-9_-]', '_', ascii_text)
    sanitized = re.sub(r'_+', '_', sanitized)
    sanitized = sanitized.strip('_-')
    return sanitized


def load_collections():
    """Laeb kollektsioonide hierarhia."""
    if os.path.exists(COLLECTIONS_FILE):
        with open(COLLECTIONS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def load_people_aliases():
    """Laeb inimeste aliased JSON failist."""
    if os.path.exists(PEOPLE_FILE):
        try:
            with open(PEOPLE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {}


def load_archives():
    """Laeb arhiivide registri JSON failist."""
    if os.path.exists(ARCHIVES_FILE):
        try:
            with open(ARCHIVES_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {}


def get_work_metadata(doc_path, dir_name, collections):
    """
    Loeb teose metaandmed _metadata.json failist.

    TOETAB NII V1 KUI V2 FORMAATI - vt CLAUDE.md "_metadata.json Formaadid"
    - v1 = eestikeelsed väljad (pealkiri, aasta, teose_tags, koht, trükkal, autor, respondens)
    - v2 = ingliskeelsed väljad (title, year, tags, location, publisher, creators[])

    Tagastab: (teose_id, metadata_dict)
    """
    metadata_json_path = os.path.join(doc_path, '_metadata.json')

    # Vaikeväärtused (v2 formaat)
    result = {
        'id': None,
        'slug': sanitize_id(dir_name),
        'type': None,            # live-tee: metadata.get('type') (vaikimisi None, mitte 'impressum')
        'genre': None,
        'collections': [],
        'collections_hierarchy': [],
        'title': 'Pealkiri puudub',
        'year': None,
        'year_display': None,
        'location': None,
        'publisher': None,
        'creators': [],
        'authors_text': [],
        'tags': [],
        'languages': [],         # live-tee: metadata.get('languages', [])
        'ester_id': None,
        'external_url': None,
        'archive_refs': [],
    }

    teose_id = sanitize_id(dir_name)

    if os.path.exists(metadata_json_path):
        try:
            with open(metadata_json_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)

                # Identifikaatorid
                result['id'] = meta.get('id')
                result['slug'] = meta.get('slug') or meta.get('teose_id', teose_id)
                teose_id = result['slug']  # Kasuta slug'i teose ID-na

                result['type'] = meta.get('type')   # live-tee pariteet (vaikimisi None)
                result['genre'] = meta.get('genre')
                result['collections'] = meta.get('collections', [])

                # Hierarhia laiendamine
                if result['collections']:
                    result['collections_hierarchy'] = get_collection_hierarchy(
                        collections, result['collections']
                    )

                # V1/V2 fallback: v2 esmalt, siis v1
                result['title'] = meta.get('title') or meta.get('pealkiri', result['title'])
                result['year'] = meta.get('year') or meta.get('aasta')
                result['year_display'] = meta.get('year_display') or None
                _yr = parse_year_range(result['year'], result['year_display'])
                # Kui year puudub aga year_display annab vahemiku (nt "ca. 1750", "19. saj"),
                # kasuta sortimisväärtusena keskpaika (sama loogika nagu meilisearch_ops.py)
                if not result['year'] and _yr:
                    result['year'] = (_yr[0] + _yr[1]) // 2
                result['year_start'] = _yr[0] if _yr else 0
                result['year_end'] = _yr[1] if _yr else 0
                result['location'] = meta.get('location') or meta.get('koht')
                result['publisher'] = meta.get('publisher') or meta.get('trükkal')

                # V1/V2 fallback: tags
                result['tags'] = meta.get('tags') or meta.get('teose_tags', [])

                # Creators: v2=creators massiiv, v1=autor/respondens otseväljad
                creators = meta.get('creators', [])

                # Kui v1 formaat (autor/respondens väljad), konverteeri creators massiiviks
                if not creators:
                    v1_autor = meta.get('autor')
                    v1_respondens = meta.get('respondens')
                    if v1_autor:
                        creators.append({'name': v1_autor, 'role': 'praeses'})
                    if v1_respondens:
                        creators.append({'name': v1_respondens, 'role': 'respondens'})

                result['creators'] = creators

                # Denormaliseeritud nimed otsinguks
                result['authors_text'] = [c['name'] for c in creators if c.get('name')]

                result['languages'] = meta.get('languages', [])   # live-tee pariteet (vaikimisi [])
                result['ester_id'] = meta.get('ester_id')
                result['external_url'] = meta.get('external_url')
                result['archive_refs'] = meta.get('archive_refs') or []
                result['shareable'] = meta.get('shareable', False)

                # Seeria (kui on)
                if meta.get('series'):
                    result['series'] = meta['series']
                    result['series_title'] = meta['series'].get('title', '')

                # Relatsioonid (kui on)
                if meta.get('relations'):
                    result['relations'] = meta['relations']

                return teose_id, result

        except json.JSONDecodeError as e:
            print(f"!!! SÜNTAKSI VIGA: {metadata_json_path} (rida {e.lineno})")
            return teose_id, result
        except Exception as e:
            print(f"Viga _metadata.json lugemisel {metadata_json_path}: {e}")
            return teose_id, result

    # Kui _metadata.json puudub
    print(f"⚠️  Puudub _metadata.json: {dir_name}")

    return teose_id, result


def build_work_documents(doc_path, dir_name, collections, people_data, archives, labels_store):
    """Ehitab ühe teose kõikide lehekülgede Meilisearch dokumendid (seed/reseed-tee).

    Tagastab (teose_id, [dokumendid]). Dokumendid ehitatakse JAGATUD funktsiooniga
    server.meili_doc._build_page_document — sama, mida kasutab live-tee
    (server/meilisearch_ops.sync_work_to_meilisearch) — nii et seed ja live EI SAA
    enam lahku minna (issue #23). teose_staatus lisatakse hiljem (väljundi kirjutamisel),
    sest see sõltub kõikide lehtede koondstaatusest.

    work_ctx ehitatakse SAMA kujuga nagu live-tees (vt sync_work_to_meilisearch),
    et _build_page_document annaks mõlemas teed identse dokumendi.
    """
    teose_id, doc_metadata = get_work_metadata(doc_path, dir_name, collections)

    # Pildifailid (v.a. thumbnailid), sorteeritud sequence järgi (fallback: tähestik)
    def _seq(img_name):
        jp = os.path.join(doc_path, os.path.splitext(img_name)[0] + '.json')
        if os.path.exists(jp):
            try:
                with open(jp, 'r', encoding='utf-8') as fj:
                    d = json.load(fj)
                    s = d.get('sequence') or d.get('meta_content', {}).get('sequence')
                    if s is not None:
                        return int(s)
            except Exception:
                pass
        return float('inf')

    all_imgs = [f for f in os.listdir(doc_path)
                if f.lower().endswith(('.jpg', '.jpeg', '.png')) and not f.startswith('_thumb_')]
    jpg_files = sorted(all_imgs, key=lambda f: (_seq(f), f))
    if not jpg_files:
        return teose_id, []

    # Kasuta nanoid't page ID-s (kui olemas), muidu fallback slugile
    work_id_for_keys = doc_metadata.get('id') or teose_id

    # --- Teose-tasandi kontekst (konstantne üle kõikide lehtede).
    # Identne live-tee work_ctx-iga, et _build_page_document annaks sama tulemuse. ---
    creators = doc_metadata.get('creators', [])
    autor, respondens = compute_autor_respondens(creators)

    # Tags normaliseeritakse (vana string-andmestiku ühtlustus) — nagu live-tee
    tags = doc_metadata.get('tags', []) or []
    if isinstance(tags, list):
        tags = [normalize_genre(t) for t in tags]

    aliases, authors_text, publisher_aliases, tag_aliases = _compute_work_aliases(
        creators, doc_metadata.get('publisher'), tags, people_data
    )

    series = doc_metadata.get('series')
    work_ctx = {
        'dir_name': dir_name,
        'dir_path': doc_path,
        'work_id': work_id_for_keys,
        'title': doc_metadata.get('title', ''),
        'autor': autor,
        'respondens': respondens,
        'year': doc_metadata.get('year') or 0,   # live: metadata.get('year', 0)
        'year_display': doc_metadata.get('year_display'),
        'year_start': doc_metadata.get('year_start', 0),
        'year_end': doc_metadata.get('year_end', 0),
        'teose_lehekylgede_arv': len(jpg_files),
        'tags': tags,
        'tag_aliases': tag_aliases,
        'work_collections': doc_metadata.get('collections', []),
        'collections': collections,
        'collections_hierarchy': doc_metadata.get('collections_hierarchy', []),
        'shareable': doc_metadata.get('shareable', False),
        'location': doc_metadata.get('location'),
        'publisher': doc_metadata.get('publisher'),
        'publisher_aliases': publisher_aliases,
        'genre': doc_metadata.get('genre'),
        'work_type': doc_metadata.get('type'),
        'languages': doc_metadata.get('languages', []),  # live: metadata.get('languages', [])
        'creators': creators,
        'authors_text': authors_text,
        'people_data': people_data,
        'labels_store': labels_store,
        'ester_id': doc_metadata.get('ester_id'),
        'external_url': doc_metadata.get('external_url'),
        'series': series,
        'series_title': doc_metadata.get('series_title', '') if series else '',
        'relations': doc_metadata.get('relations'),
        'archive_refs': doc_metadata.get('archive_refs') or [],
        '_archives': archives,
    }

    pages = []
    for page_index, jpg_filename in enumerate(jpg_files):
        page_num = page_index + 1
        page_id = f"{work_id_for_keys}-{page_num}"
        base_name = os.path.splitext(jpg_filename)[0]

        # Lehe tekst
        txt_path = os.path.join(doc_path, base_name + '.txt')
        page_text = ""
        if os.path.exists(txt_path):
            try:
                with open(txt_path, 'r', encoding='utf-8') as f:
                    page_text = f.read()
            except Exception:
                pass

        # Lehe metaandmed (annotatsioonid, staatus)
        json_path = os.path.join(doc_path, base_name + '.json')
        page_meta = {
            'tags': [],
            'comments': [],
            'text_annotations': [],
            'status': 'Toores',
            'history': []
        }
        if os.path.exists(json_path):
            try:
                with open(json_path, 'r', encoding='utf-8') as jf:
                    file_json = json.load(jf)
                    source = file_json.get('meta_content', file_json)
                    # tags-fallback: serveril on 35 lehekülge vana 'tags' väljaga (OCR-artefaktid,
                    # stringid, mitte Q-objektid). Eemaldada pärast nende migreerimist.
                    page_meta['tags'] = source.get('page_tags', source.get('tags', []))
                    page_meta['comments'] = source.get('comments', [])
                    page_meta['text_annotations'] = source.get('text_annotations', [])
                    page_meta['status'] = source.get('status', 'Toores')
                    page_meta['history'] = source.get('history', [])
                    # Live-tee pariteet: JSON text_content on fallback ainult siis, kui .txt puudub/tühi.
                    if not page_text and 'text_content' in file_json:
                        page_text = file_json['text_content']
            except Exception as e:
                print(f"Viga JSON lugemisel {json_path}: {e}")

        doc = _build_page_document(
            work_ctx, page_id, page_num, page_text, page_meta, jpg_filename, txt_path
        )
        pages.append(doc)

    return teose_id, pages


def create_meilisearch_data_per_page():
    """Loob Meilisearchi andmefaili."""
    if not os.path.exists(DATA_ROOT_DIR):
        print(f"VIGA: Andmete juurkausta '{DATA_ROOT_DIR}' ei leitud!")
        return

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    print(f"Alustan andmete loomist faili '{OUTPUT_FILE}'...")
    print(f"Andmete kaust: {DATA_ROOT_DIR}")

    # Laeme kollektsioonid hierarhia jaoks
    collections = load_collections()
    people_data = load_people_aliases()
    archives = load_archives()
    labels_store = {}
    if os.path.exists(LABELS_FILE):
        with open(LABELS_FILE, 'r', encoding='utf-8') as _lf:
            labels_store = json.load(_lf)
    print(f"Laetud {len(collections)} kollektsiooni, {len(people_data)} isiku andmed, "
          f"{len(archives)} arhiivi, {len(labels_store)} kanoonilise sildi kirjet")

    # Kogu andmed teose kaupa
    works_data = {}

    SKIP_DIRS = {'prosopography', 'config'}
    doc_dirs = sorted([d for d in os.listdir(DATA_ROOT_DIR)
                       if os.path.isdir(os.path.join(DATA_ROOT_DIR, d)) and not d.startswith('.') and d not in SKIP_DIRS])

    for dir_name in tqdm(doc_dirs, desc="Teoste töötlemine"):
        doc_path = os.path.join(DATA_ROOT_DIR, dir_name)
        teose_id, pages = build_work_documents(
            doc_path, dir_name, collections, people_data, archives, labels_store
        )
        if pages:
            works_data[teose_id] = pages

    # Kirjuta väljundfail teose staatustega
    print(f"\nArvutan teose staatused ja kirjutan väljundfaili...")
    total_pages = 0

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as outfile:
        for teose_id, pages in works_data.items():
            page_statuses = [p['status'] for p in pages]
            teose_staatus = calculate_work_status(page_statuses)

            for meili_doc in pages:
                meili_doc['teose_staatus'] = teose_staatus
                outfile.write(json.dumps(meili_doc, ensure_ascii=False) + '\n')
                total_pages += 1

    print(f"\nValmis! Loodud {total_pages} lehekülge {len(works_data)} teosest.")
    print(f"Väljundfail: {OUTPUT_FILE}")


if __name__ == '__main__':
    create_meilisearch_data_per_page()
