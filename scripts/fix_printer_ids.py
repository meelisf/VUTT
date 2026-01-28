#!/usr/bin/env python3
"""
Parandab trükkalite (publisher) ID-d _metadata.json failides.
Tehtavad asendused:
1. Johann Vogel: Q123498765 -> Q60534366
2. Jacob Becker: Q110825272 -> Q57556219
3. Johann Brendeken: Q56063529 -> Q126846643
"""

import os
import json
import argparse

# Konfiguratsioon
BASE_DIR = os.getenv("VUTT_DATA_DIR", "data")

# Asenduste kaardistus (vana ID -> uus ID)
REPLACEMENTS = {
    "Q123498765": "Q60534366",  # Johann Vogel
    "Q110825272": "Q57556219",  # Jacob Becker
    "Q56063529": "Q126846643"   # Johann Brendeken
}

# Nimede kaardistus logimiseks
NAMES = {
    "Q60534366": "Johann Vogel",
    "Q57556219": "Jacob Becker",
    "Q126846643": "Johann Brendeken"
}

def fix_publisher_ids(dry_run=False):
    print(f"Alustan otsimist kaustast: {BASE_DIR}")
    if dry_run:
        print("--- DRY RUN (SIMULATSIOON) - FAILE EI MUUDETA ---")
    
    print("Otsin ja parandan järgmised ID-d:")
    for old, new in REPLACEMENTS.items():
        print(f"  - {old} -> {new} ({NAMES.get(new, 'Tundmatu')})")
    
    count = 0
    checked_files = 0
    
    for root, dirs, files in os.walk(BASE_DIR):
        if '_metadata.json' in files:
            path = os.path.join(root, '_metadata.json')
            checked_files += 1
            
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    meta = json.load(f)
                
                modified = False
                
                # Kontrolli 'publisher' välja
                publisher = meta.get('publisher')
                
                if isinstance(publisher, dict):
                    old_id = publisher.get('id')
                    
                    if old_id in REPLACEMENTS:
                        new_id = REPLACEMENTS[old_id]
                        print(f"  [LEITUD] {path}")
                        print(f"    - {publisher.get('name', 'Nimetu')} (ID: {old_id} -> {new_id})")
                        
                        publisher['id'] = new_id
                        publisher['source'] = 'wikidata'
                        modified = True
                
                if modified:
                    if not dry_run:
                        with open(path, 'w', encoding='utf-8') as f:
                            json.dump(meta, f, ensure_ascii=False, indent=2)
                        print(f"    -> SALVESTATUD")
                    else:
                        print(f"    -> (oleks salvestatud)")
                    count += 1
                    
            except Exception as e:
                print(f"Viga faili töötlemisel {path}: {e}")

    print("\n--- KOKKUVÕTE ---")
    if dry_run:
        print("DRY RUN: Ühtegi faili ei muudetud.")
    print(f"Läbi vaadatud faile: {checked_files}")
    print(f"Muudetud faile: {count}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Paranda trükkalite Wikidata ID-d.")
    parser.add_argument("--dry-run", action="store_true", help="Käivita simulatsioon ilma faile muutmata")
    args = parser.parse_args()

    if not os.path.exists(BASE_DIR):
        # Fallback juhuks, kui skript käivitatakse valest kaustast
        alt_dir = os.path.join(os.getcwd(), "data")
        if os.path.exists(alt_dir):
            BASE_DIR = alt_dir
            
    if not os.path.exists(BASE_DIR):
        print(f"Viga: Andmekataloogi '{BASE_DIR}' ei leitud.")
    else:
        fix_publisher_ids(dry_run=args.dry_run)