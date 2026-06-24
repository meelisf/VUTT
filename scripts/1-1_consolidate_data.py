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
import types
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
from server.utils import calculate_work_status
# Jagatud dokumendi-ehitamine (issue #23): KOGU _metadata.json → Meili dokumendi
# loogika (get_work_metadata, work_ctx, lehe-tsükkel, kaardistus) elab
# server/meili_doc.py-s. Seda kutsub nii see seed/reseed-tee kui live-tee
# (server/meilisearch_ops.sync_work_to_meilisearch) — üks ainus tee, ei saa lahkneda.
# get_collection_hierarchy re-eksporditud testidele (test_consolidate_data.py).
from server.meili_doc import build_work_documents, get_collection_hierarchy


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
