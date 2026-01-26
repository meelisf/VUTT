import meilisearch
import os
import json
import time
from dotenv import load_dotenv

# --- SEADISTUS ---
# Leia projekti juurkaust (kaks taset kõrgemal scripts/ kaustast)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(BASE_DIR, '.env')

# Lae .env fail kindlast asukohast
load_dotenv(dotenv_path=ENV_PATH)

MEILI_URL = os.getenv("MEILISEARCH_URL") or os.getenv("MEILI_URL") or "http://127.0.0.1:7700"
MEILI_MASTER_KEY = os.getenv("MEILISEARCH_MASTER_KEY") or os.getenv("MEILI_MASTER_KEY") or os.getenv("MEILI_SEARCH_API_KEY")
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
        'searchableAttributes': [
            # V2/V3 väljad
            'title',
            'authors_text',
            'year',
            'location_search',
            'publisher_search',
            'genre_search',
            'tags_search',
            'series_title',
            # Tagasiühilduvus
            'pealkiri',
            'autor',
            'respondens',
            'aasta',
            'teose_id',
            'originaal_kataloog',
            'lehekylje_tekst',
            'page_tags',
            'page_tags_et',
            'page_tags_en',
            'comments.text'
        ],
        'filterableAttributes': [
            # V2/V3 väljad
            'work_id',
            'year',
            'title',
            'location_id',
            'publisher_id',
            'publisher',
            'genre_ids',
            'tags_ids',
            'creator_ids',
            'creators',
            'type',
            'type_et', 'type_en', # Keeltepõhised filtrid
            'genre',
            'genre_et', 'genre_en',
            'collection',
            'collections_hierarchy',
            'authors_text',
            'author_names',
            'respondens_names',
            'languages',
            # Tagasiühilduvus
            'aasta',
            'autor',
            'respondens',
            'trükkal',
            'teose_id',
            'lehekylje_number',
            'originaal_kataloog',
            'page_tags',
            'page_tags_et',
            'page_tags_en',
            'page_tags_suggest_et',
            'page_tags_suggest_en',
            'status',
            'teose_staatus',
            'tags',
            'tags_et', 'tags_en'
        ],
        'sortableAttributes': [
            'aasta', 
            'lehekylje_number',
            'last_modified',
            'pealkiri'
        ],
        'rankingRules': [
            "exactness",
            "words",
            "typo",
            "proximity",
            "attribute",
            "sort"
        ],
        'faceting': {
            'maxValuesPerFacet': 5000
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