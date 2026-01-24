
import sys
import os
import time
import meilisearch
from dotenv import load_dotenv

# Lae keskkonnamuutujad
load_dotenv()

MEILI_URL = os.getenv("MEILISEARCH_URL", "http://127.0.0.1:7700")
MEILI_KEY = os.getenv("MEILISEARCH_MASTER_KEY", "masterKey")
INDEX_NAME = "teosed"

print(f"Ühendun Meilisearchiga: {MEILI_URL}")
client = meilisearch.Client(MEILI_URL, MEILI_KEY)
index = client.index(INDEX_NAME)

print("Uuendan seadistusi...")

# Filterable Attributes
filterable_attributes = [
    # V2/V3 väljad
    'work_id',
    'year',
    'title',
    'location_id',
    'publisher_id',
    'genre_ids',
    'tags_ids',
    'creator_ids',
    'type',
    'type_et', 'type_en',
    'genre',
    'genre_et', 'genre_en',
    'collection',
    'collections_hierarchy',
    'authors_text',
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
    'status',
    'teose_staatus',
    'tags',
    'tags_et', 'tags_en'
]

# Searchable Attributes
searchable_attributes = [
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
]

# Sortable Attributes
sortable_attributes = [
    'aasta',
    'lehekylje_number',
    'last_modified',
    'pealkiri'
]

# Ranking Rules
ranking_rules = [
    "exactness",
    "words",
    "typo",
    "proximity",
    "attribute",
    "sort"
]

try:
    print("Saadan seadistused...")
    task = index.update_settings({
        'filterableAttributes': filterable_attributes,
        'searchableAttributes': searchable_attributes,
        'sortableAttributes': sortable_attributes,
        'rankingRules': ranking_rules,
        'faceting': {'maxValuesPerFacet': 5000},
        'pagination': {'maxTotalHits': 10000}
    })
    print(f"Update task: {task.task_uid}")

    # Oota lõppu
    print("Ootan seadistuste rakendumist...")
    client.wait_for_task(task.task_uid)
    print("VALMIS! Indeksi seadistused on uuendatud.")

except Exception as e:
    print(f"VIGA: {e}")
