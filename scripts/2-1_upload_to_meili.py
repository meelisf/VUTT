import meilisearch
import os
import sys
import json
import time
from dotenv import load_dotenv

# --- SEADISTUS ---
# Leia projekti juurkaust (kaks taset kõrgemal scripts/ kaustast)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(BASE_DIR, '.env')

# Atribuudinimekirjad tulevad server/meili_settings.py-st — ÜKS tõene allikas,
# mida jagab ka runtime (meilisearch_ops._ensure_filterable_attributes).
sys.path.insert(0, BASE_DIR)
from server.meili_settings import (  # noqa: E402
    FILTERABLE_ATTRIBUTES,
    MAX_VALUES_PER_FACET,
    SEARCHABLE_ATTRIBUTES,
    SORTABLE_ATTRIBUTES,
)

# Lae .env fail kindlast asukohast
load_dotenv(dotenv_path=ENV_PATH)

# Kanoonilised nimed, üks kummagi kohta (ADR 0021)
MEILI_URL = os.getenv("MEILI_URL") or "http://127.0.0.1:7700"
MEILI_MASTER_KEY = os.getenv("MEILI_MASTER_KEY")
JSONL_FILE_PATH = 'output/meilisearch_data_per_page.jsonl' 
INDEX_NAME = 'teosed'
# --- LÕPP ---

def main():
    print("--- Alustan andmete üleslaadimist Meilisearchi ---")

    if not MEILI_URL or not MEILI_MASTER_KEY:
        print("VIGA: .env failist puuduvad andmed.")
        return

    try:
        client = meilisearch.Client(MEILI_URL, MEILI_MASTER_KEY)
    except Exception as e:
        print(f"VIGA: Ühendus ebaõnnestus: {e}")
        return

    # Kustutame vana indeksi, et tagada puhas struktuur
    try:
        client.delete_index(INDEX_NAME)
        time.sleep(1) # Väike paus
    except Exception:
        pass

    print(f"Loon indeksi '{INDEX_NAME}' ja seadistan parameetrid...")
    
    # UUENDUS: Lisasime V3 väljad ja täiendavad seaded
    task = client.index(INDEX_NAME).update_settings({
        'searchableAttributes': SEARCHABLE_ATTRIBUTES,
        'filterableAttributes': FILTERABLE_ATTRIBUTES,
        'sortableAttributes': SORTABLE_ATTRIBUTES,
        'rankingRules': [
            "exactness",
            "words",
            "typo",
            "proximity",
            "attribute",
            "sort"
        ],
        'faceting': {
            'maxValuesPerFacet': MAX_VALUES_PER_FACET
        },
        'pagination': {
            'maxTotalHits': 10000
        },
        'typoTolerance': {
            'minWordSizeForTypos': {
                'oneTypo': 5,
                'twoTypos': 9
            }
        }
    })
    
    print(f"Indeksi seadistused saadetud (Task ID: {task.task_uid}). Ootan rakendumist...")
    client.wait_for_task(task.task_uid)
    print("Indeksi seadistused on rakendatud.")

    try:
        print(f"Laen andmed failist '{JSONL_FILE_PATH}'...")
        documents_to_upload = []
        with open(JSONL_FILE_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                documents_to_upload.append(json.loads(line))
        
        print(f"Dokumente kokku: {len(documents_to_upload)}")
        
        # Laeme üles pakkidena (chunks), et vältida liiga suuri päringuid
        chunk_size = 500
        for i in range(0, len(documents_to_upload), chunk_size):
            chunk = documents_to_upload[i:i + chunk_size]
            task = client.index(INDEX_NAME).add_documents(chunk, primary_key='id')
            print(f"Saatsin paki {i}-{i+len(chunk)}. Task ID: {task.task_uid}")
        
        print("\nKõik andmed saadetud. Ootan Meilisearchi töötlemist...")
        
        # Ootame viimast taski
        while True:
            task_status = client.get_task(task.task_uid)
            if task_status.status == 'succeeded':
                break
            elif task_status.status == 'failed':
                print(f"Viga viimases paketis: {task_status.error}")
                break
            time.sleep(2)
            
        # Küsi lõplikku statistikat
        stats = client.index(INDEX_NAME).get_stats()
        print(f"Valmis! Indeksis on kokku {stats.number_of_documents} dokumenti.")
        print(f"Indekseerimine on lõppenud: {stats.is_indexing}")

    except FileNotFoundError:
        print(f"Faili ei leitud: {JSONL_FILE_PATH}")
    except Exception as e:
        print(f"Viga: {e}")

if __name__ == '__main__':
    main()