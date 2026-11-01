import meilisearch
import os
import sys
import json
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
    LETTERS_FILTERABLE_ATTRIBUTES,
    LETTERS_INDEX_NAME,
    LETTERS_SEARCHABLE_ATTRIBUTES,
    LETTERS_SORTABLE_ATTRIBUTES,
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
# Kirjaindeks (#526): 1-1 kirjutab selle teosed-faili kõrvale
LETTERS_JSONL_FILE_PATH = os.path.join(os.path.dirname(JSONL_FILE_PATH), 'kirjad.jsonl')
# --- LÕPP ---

# Taskide ootepiir. Meili järjekord võib seista eelmise töö (nt massiline sünk)
# taga minuteid; 5 s vaikimisi jättis indeksi kustutatuna poolele teele (2026-11-01).
TASK_TIMEOUT_MS = 15 * 60 * 1000
STAGING_SUFFIX = '__uus'
CHUNK_SIZE = 500

TEOSED_SETTINGS = {
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
}

LETTERS_SETTINGS = {
    'searchableAttributes': LETTERS_SEARCHABLE_ATTRIBUTES,
    'filterableAttributes': LETTERS_FILTERABLE_ATTRIBUTES,
    'sortableAttributes': LETTERS_SORTABLE_ATTRIBUTES,
    'faceting': {'maxValuesPerFacet': MAX_VALUES_PER_FACET},
    'pagination': {'maxTotalHits': 10000},
}


def _wait(client, task_uid, timeout_ms=TASK_TIMEOUT_MS):
    """Oota task lõpuni; ebaõnnestunud task on viga."""
    task = client.wait_for_task(task_uid, timeout_in_ms=timeout_ms, interval_in_ms=500)
    if task.status != 'succeeded':
        raise RuntimeError(f"Task {task_uid} ({task.type}) ebaõnnestus: {task.error}")
    return task


def rebuild_index(client, name, settings, documents, chunk_size=CHUNK_SIZE, timeout_ms=TASK_TIMEOUT_MS):
    """Ehita indeks kõrvale ja vaheta elava vastu alles valmis kujul.

    Elav indeks jääb kuni vahetuseni puutumata: iga viga (ajalõpp, ebaõnnestunud
    pakk, vale dokumentide arv) katkestab enne vahetust ja otsing töötab vana
    sisuga edasi. Ehituse ajal elavasse indeksisse jõudnud muudatused kaovad
    vahetusel — nagu varem kustutamisega, seepärast käib seed vaiksel ajal.
    """
    staging = name + STAGING_SUFFIX
    # Eelmise katkenud jooksu jääk; puuduva indeksi kustutus ebaõnnestub ja see sobib.
    client.wait_for_task(client.delete_index(staging).task_uid, timeout_in_ms=timeout_ms, interval_in_ms=500)
    _wait(client, client.create_index(staging, {'primaryKey': 'id'}).task_uid, timeout_ms)
    _wait(client, client.index(staging).update_settings(settings).task_uid, timeout_ms)
    print(f"Indeks '{staging}' seadistatud, saadan {len(documents)} dokumenti...")

    uids = []
    for i in range(0, len(documents), chunk_size):
        chunk = documents[i:i + chunk_size]
        uids.append(client.index(staging).add_documents(chunk, primary_key='id').task_uid)
    # Iga pakk eraldi: viimase paki õnnestumine ei tõenda eelmisi.
    for uid in uids:
        _wait(client, uid, timeout_ms)

    expected = len({d.get('id') for d in documents})
    count = client.index(staging).get_stats().number_of_documents
    if count != expected:
        raise RuntimeError(f"'{staging}': {count} dokumenti, oodati {expected} — elavat indeksit ei vahetatud")

    # Vahetus nõuab, et mõlemad on olemas (esmane paigaldus: loo tühi elav indeks).
    try:
        client.get_index(name)
    except meilisearch.errors.MeilisearchApiError:
        _wait(client, client.create_index(name, {'primaryKey': 'id'}).task_uid, timeout_ms)
    _wait(client, client.swap_indexes([{'indexes': [name, staging]}]).task_uid, timeout_ms)

    # `staging` kannab nüüd vana sisu. Koristuse viga ei ole indeksi viga.
    try:
        _wait(client, client.delete_index(staging).task_uid, timeout_ms)
    except Exception as e:
        print(f"HOIATUS: vana sisu indeksit '{staging}' ei saanud kustutada: {e}")
    return count


def _read_jsonl(path):
    with open(path, 'r', encoding='utf-8') as f:
        return [json.loads(line) for line in f]


def main():
    print("--- Alustan andmete üleslaadimist Meilisearchi ---")

    if not MEILI_URL or not MEILI_MASTER_KEY:
        print("VIGA: .env failist puuduvad andmed.")
        return 1

    client = meilisearch.Client(MEILI_URL, MEILI_MASTER_KEY)

    try:
        documents = _read_jsonl(JSONL_FILE_PATH)
    except FileNotFoundError:
        print(f"VIGA: faili ei leitud: {JSONL_FILE_PATH} — elavat indeksit ei puudutatud")
        return 1
    try:
        count = rebuild_index(client, INDEX_NAME, TEOSED_SETTINGS, documents)
    except Exception as e:
        print(f"VIGA: {e}\nElav indeks '{INDEX_NAME}' jäi muutmata.")
        return 1
    print(f"Valmis! Indeksis '{INDEX_NAME}' on {count} dokumenti.")

    return upload_letters(client)


def upload_letters(client):
    """Kirjade indeks (#526, ADR 0065): sama kõrvaleehitus kirjad.jsonl-ist.

    Seaded tulevad meili_settings.py-st — samad, mida runtime
    (meilisearch_ops._ensure_letters_index) rakendab jooksvale instantsile.
    """
    print(f"\n--- Kirjade indeks '{LETTERS_INDEX_NAME}' ---")
    try:
        letters = _read_jsonl(LETTERS_JSONL_FILE_PATH)
    except FileNotFoundError:
        print(f"VIGA: faili ei leitud: {LETTERS_JSONL_FILE_PATH} — elavat indeksit ei puudutatud")
        return 1
    try:
        count = rebuild_index(client, LETTERS_INDEX_NAME, LETTERS_SETTINGS, letters)
    except Exception as e:
        print(f"VIGA: {e}\nElav indeks '{LETTERS_INDEX_NAME}' jäi muutmata.")
        return 1
    print(f"Valmis! Kirjade indeksis on {count} dokumenti.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
