#!/usr/bin/env python3
"""
Migratsiooniskript: v2 String -> v3 Object

Konverteerib `genre` ja `type` väljad _metadata.json failides
lihtsatest stringidest (nt "disputatio") rikasteks objektideks
koos tõlgetega, kasutades `state/vocabularies.json` andmeid.

Kasutamine:
    python3 scripts/migrate_v2_to_v3_objects.py
"""

import os
import json
from pathlib import Path

# Seadistus
PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / 'data' / '04_sorditud_dokumendid'
VOCAB_FILE = PROJECT_ROOT / 'state' / 'vocabularies.json'

def load_vocabularies():
    if not VOCAB_FILE.exists():
        print(f"VIGA: Sõnavara faili ei leitud: {VOCAB_FILE}")
        return {}
    with open(VOCAB_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def migrate_field(value, vocabulary):
    """Teisendab stringi objektiks, kui vaste leitakse."""
    if not value or not isinstance(value, str):
        return value
    
    key = value.lower().strip()
    if key in vocabulary:
        entry = vocabulary[key]
        return {
            "id": None, # Ei tea Wikidata ID-d, aga pole hullu
            "label": entry.get('et', value), # Primaarne silt eesti keeles
            "source": "legacy",
            "labels": entry
        }
    return value

def main():
    print("--- Alustan v2 -> v3 migratsiooni ---")
    vocabs = load_vocabularies()
    genres = vocabs.get('genres', {})
    types = vocabs.get('types', {})
    
    if not genres or not types:
        print("VIGA: Sõnavara on tühi või vigane.")
        return

    count = 0
    modified_count = 0

    if not DATA_DIR.exists():
        print(f"VIGA: Andmete kausta ei leitud: {DATA_DIR}")
        return

    for meta_file in DATA_DIR.rglob('_metadata.json'):
        count += 1
        try:
            with open(meta_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            changed = False
            
            # Migreeri Genre
            if 'genre' in data and isinstance(data['genre'], str):
                new_genre = migrate_field(data['genre'], genres)
                if new_genre != data['genre']:
                    data['genre'] = new_genre
                    changed = True
            
            # Migreeri Type
            if 'type' in data and isinstance(data['type'], str):
                new_type = migrate_field(data['type'], types)
                if new_type != data['type']:
                    data['type'] = new_type
                    changed = True

            if changed:
                with open(meta_file, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                modified_count += 1
                print(f"Muudetud: {meta_file.parent.name}")
                
        except Exception as e:
            print(f"Viga failis {meta_file}: {e}")

    print(f"\nValmis! Töötlesin {count} faili, muutsin {modified_count} faili.")
    print("NB: Jooksuta nüüd 'python scripts/1-1_consolidate_data.py' ja 'python scripts/2-1_upload_to_meili.py' muudatuste rakendamiseks.")

if __name__ == '__main__':
    main()
