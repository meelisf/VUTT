import meilisearch
import os
import json
import time
from dotenv import load_dotenv

# --- SEADISTUS ---
load_dotenv()

MEILI_URL = os.getenv("MEILISEARCH_URL")
MEILI_MASTER_KEY = os.getenv("MEILISEARCH_MASTER_KEY")
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
    
    # UUENDUS: Lisasime tags ja comments.text searchableAttributes hulka
    client.index(INDEX_NAME).update_settings({
        'searchableAttributes': [
            'lehekylje_tekst', 
            'pealkiri', 
            'autor', 
            'tags', 
            'comments.text'
        ],
        'filterableAttributes': [
            'aasta', 
            'autor', 
            'teose_id', 
            'originaal_kataloog', 
            'lehekylje_number',
            'status', # Võimaldab filtreerida staatuse järgi
            'tags'    # Võimaldab filtreerida siltide järgi
        ],
        'sortableAttributes': [
            'aasta', 
            'lehekylje_number',
            'last_modified'
        ],
        # Lisame tekstikatkestused ja esiletõstmise seaded
        'typoTolerance': {
            'minWordSizeForTypos': {
                'oneTypo': 5,
                'twoTypos': 9
            }
        }
    })
    print("Indeksi seadistused uuendatud.")

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
                print(f"Valmis! Indekseeritud dokumente: {task_status.details.get('indexedDocuments', 'N/A')}")
                break
            elif task_status.status == 'failed':
                print(f"Viga: {task_status.error}")
                break
            time.sleep(2)

    except FileNotFoundError:
        print(f"Faili ei leitud: {JSONL_FILE_PATH}")
    except Exception as e:
        print(f"Viga: {e}")

if __name__ == '__main__':
    main()