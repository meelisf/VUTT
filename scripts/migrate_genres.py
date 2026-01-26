#!/usr/bin/env python3
"""
Migratsiooniskript: Genre format migration (Legacy -> Wikidata)

Teisendab spetsiifilised "legacy" žanrid uuele Wikidata formaadile:
  - Väitekiri (Disputatsioon) -> Q1123131 (disputation)
  - Kõne (Oratsioon) -> Q861911 (oration)

Kasutamine:
  python3 scripts/migrate_genres.py           # Dry-run
  python3 scripts/migrate_genres.py --apply   # Rakenda muudatused
"""

import os
import sys
import json
import argparse

# Vaikimisi andmekataloog (sama mis teistes skriptides)
DATA_ROOT_DIR = os.getenv('VUTT_DATA_DIR', '/home/mf/Dokumendid/LLM/tartu-acad/data/04_sorditud_dokumendid')

def get_target_genre(legacy_genre):
    """
    Kontrollib, kas žanr vajab uuendamist ja tagastab uue struktuuri.
    Tagastab None, kui uuendamist ei ole vaja.
    """
    if not legacy_genre or legacy_genre.get('source') != 'legacy':
        return None

    label = legacy_genre.get('label')

    # Disputatsioon
    if label == "Väitekiri (Disputatsioon)":
        return {
            "id": "Q1123131",
            "label": "disputation",
            "source": "wikidata",
            "labels": {
                "de": "Disputation",
                "en": "disputation",
                "et": "Disputatsioon"
            }
        }

    # Oratsioon
    if label == "Kõne (Oratsioon)":
        return {
            "id": "Q861911",
            "label": "oration",
            "source": "wikidata",
            "labels": {
                "en": "oration",
                "de": "Rede",
                "et": "kõne"
            }
        }

    return None

def process_all_metadata(apply=False):
    if not os.path.exists(DATA_ROOT_DIR):
        print(f"VIGA: Andmete kausta '{DATA_ROOT_DIR}' ei leitud!")
        print("Kasuta --data-dir argumenti õige asukoha määramiseks.")
        sys.exit(1)

    print(f"{'='*60}")
    print(f"Genre Migration: Legacy -> Wikidata")
    print(f"{'='*60}")
    print(f"Andmete kaust: {DATA_ROOT_DIR}")
    print(f"Režiim: {'RAKENDA MUUDATUSED' if apply else 'DRY-RUN (testimine)'}")
    print(f"{'='*60}\n")

    stats = {
        'total_checked': 0,
        'needs_update': 0,
        'updated': 0,
        'errors': 0,
        'skipped': 0
    }

    doc_dirs = sorted([d for d in os.listdir(DATA_ROOT_DIR) 
                       if os.path.isdir(os.path.join(DATA_ROOT_DIR, d))])

    for dir_name in doc_dirs:
        dir_path = os.path.join(DATA_ROOT_DIR, dir_name)
        metadata_path = os.path.join(dir_path, '_metadata.json')

        if not os.path.exists(metadata_path):
            continue

        stats['total_checked'] += 1

        try:
            with open(metadata_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
        except Exception as e:
            print(f"❌ VIGA lugemisel: {dir_name} - {e}")
            stats['errors'] += 1
            continue

        current_genre = meta.get('genre')
        new_genre = get_target_genre(current_genre)

        if new_genre:
            stats['needs_update'] += 1
            print(f"Leitud uuendamist vajav: {dir_name}")
            print(f"   Vana: {current_genre.get('label')} ({current_genre.get('source')})")
            print(f"   Uus:  {new_genre.get('label')} ({new_genre.get('source')}, ID: {new_genre.get('id')})")
            
            if apply:
                meta['genre'] = new_genre
                try:
                    with open(metadata_path, 'w', encoding='utf-8') as f:
                        json.dump(meta, f, ensure_ascii=False, indent=2)
                    print(f"   ✅ Salvestatud")
                    stats['updated'] += 1
                except Exception as e:
                    print(f"   ❌ VIGA salvestamisel: {e}")
                    stats['errors'] += 1
        else:
            stats['skipped'] += 1

    print(f"\n{'='*60}")
    print(f"KOKKUVÕTE")
    print(f"{'='*60}")
    print(f"Kontrollitud faile: {stats['total_checked']}")
    print(f"Vajas uuendamist:   {stats['needs_update']}")
    print(f"Uuendatud:          {stats['updated']}")
    print(f"Vahele jäetud:      {stats['skipped']}")
    print(f"Vigu:               {stats['errors']}")
    print(f"{'='*60}")

    if not apply and stats['needs_update'] > 0:
        print(f"\n⚠️  See oli DRY-RUN. Muudatuste rakendamiseks käivita:")
        print(f"   python3 scripts/migrate_genres.py --apply")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Migreeri žanrid legacy formaadist wikidata formaati')
    parser.add_argument('--apply', action='store_true', help='Rakenda muudatused')
    parser.add_argument('--data-dir', type=str, help='Andmete kaust')

    args = parser.parse_args()

    if args.data_dir:
        DATA_ROOT_DIR = args.data_dir

    process_all_metadata(apply=args.apply)
