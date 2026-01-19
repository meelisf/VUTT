#!/usr/bin/env python3
"""
Migratsiooniskript: lisab teose_id igasse _metadata.json faili.

Probleem: 
- 1-1_consolidate_data.py kasutab sanitize_id() kaustanimele
- git_ops.py kasutas tooreid kaustanimesid
- Seetõttu tekkis ebakõla URL-ides

Lahendus:
- Salvesta teose_id eksplitsiitselt _metadata.json faili
- Kõik kohad loevad teose_id AINULT _metadata.json-ist
- Katalooginimi on ainult failisüsteemi detail

Käivitamine:
    python3 scripts/migrate_teose_id.py           # Dry-run (näitab muudatusi)
    python3 scripts/migrate_teose_id.py --apply   # Rakenda muudatused
"""

import os
import sys
import json
import re
import unicodedata
import argparse

# Andmete asukoht (sama mis teistes skriptides)
DATA_DIR = os.environ.get('VUTT_DATA_DIR', '/home/mf/Dokumendid/LLM/tartu-acad/data/04_sorditud_dokumendid')


def sanitize_id(text):
    """Puhastab teksti, et see sobiks ID-ks."""
    if not text:
        return ""
    # Eemalda diakriitikud
    normalized = unicodedata.normalize('NFD', text)
    ascii_text = ''.join(c for c in normalized if unicodedata.category(c) != 'Mn')
    # Asenda kõik mitte-lubatud märgid alakriipsuga
    sanitized = re.sub(r'[^a-zA-Z0-9_-]', '_', ascii_text)
    # Eemalda mitu järjestikust alakriipsu
    sanitized = re.sub(r'_+', '_', sanitized)
    # Eemalda algus- ja lõpukriipsud
    sanitized = sanitized.strip('_-')
    return sanitized


def migrate_teose_id(apply=False):
    """Lisab teose_id igasse _metadata.json faili."""
    
    if not os.path.isdir(DATA_DIR):
        print(f"VIGA: Andmekataloog puudub: {DATA_DIR}")
        sys.exit(1)
    
    stats = {
        'total': 0,
        'already_has_id': 0,
        'updated': 0,
        'no_metadata': 0,
        'errors': 0
    }
    
    # Käi läbi kõik alamkaustad
    for entry in sorted(os.scandir(DATA_DIR), key=lambda e: e.name):
        if not entry.is_dir():
            continue
        if entry.name.startswith('.'):
            continue
            
        stats['total'] += 1
        folder_name = entry.name
        expected_id = sanitize_id(folder_name)
        metadata_path = os.path.join(entry.path, '_metadata.json')
        
        # Kontrolli kas _metadata.json eksisteerib
        if not os.path.exists(metadata_path):
            stats['no_metadata'] += 1
            print(f"  PUUDUB: {folder_name}/_metadata.json")
            continue
        
        try:
            with open(metadata_path, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            stats['errors'] += 1
            print(f"  VIGA: {folder_name}/_metadata.json - {e}")
            continue
        
        # Kontrolli kas teose_id juba olemas
        if 'teose_id' in metadata:
            current_id = metadata['teose_id']
            if current_id == expected_id:
                stats['already_has_id'] += 1
                # print(f"  OK: {folder_name} (teose_id olemas)")
            else:
                # teose_id on olemas aga erinev - see võib olla tahtlik
                stats['already_has_id'] += 1
                print(f"  INFO: {folder_name} - teose_id on '{current_id}' (mitte '{expected_id}')")
            continue
        
        # Lisa teose_id
        stats['updated'] += 1
        print(f"  LISA: {folder_name} -> teose_id='{expected_id}'")
        
        if apply:
            metadata['teose_id'] = expected_id
            try:
                with open(metadata_path, 'w', encoding='utf-8') as f:
                    json.dump(metadata, f, ensure_ascii=False, indent=2)
            except IOError as e:
                print(f"    VIGA kirjutamisel: {e}")
                stats['errors'] += 1
    
    # Kokkuvõte
    print()
    print("=" * 50)
    print("KOKKUVÕTE:")
    print(f"  Kokku kaustu: {stats['total']}")
    print(f"  teose_id juba olemas: {stats['already_has_id']}")
    print(f"  {'Uuendatud' if apply else 'Uuendataks'}: {stats['updated']}")
    print(f"  _metadata.json puudub: {stats['no_metadata']}")
    print(f"  Vigu: {stats['errors']}")
    
    if not apply and stats['updated'] > 0:
        print()
        print("Muudatuste rakendamiseks käivita:")
        print("  python3 scripts/migrate_teose_id.py --apply")
    
    return stats


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Lisa teose_id igasse _metadata.json faili')
    parser.add_argument('--apply', action='store_true', help='Rakenda muudatused (vaikimisi dry-run)')
    args = parser.parse_args()
    
    print(f"Andmekataloog: {DATA_DIR}")
    print(f"Režiim: {'RAKENDA' if args.apply else 'DRY-RUN'}")
    print("=" * 50)
    print()
    
    migrate_teose_id(apply=args.apply)
