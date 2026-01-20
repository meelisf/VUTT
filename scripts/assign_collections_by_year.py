#!/usr/bin/env python3
"""
Määrab kollektsioonid teostele aasta järgi.

Reeglid:
  - 1632-1656 → academia-gustaviana (esimene periood)
  - 1689-1710 → academia-gustavo-carolina (teine periood)

Kasutamine:
    python3 scripts/assign_collections_by_year.py           # Dry-run
    python3 scripts/assign_collections_by_year.py --apply   # Rakenda muudatused

NB: Skript ei muuda teoseid, millel on juba kollektsioon määratud.
    Kasuta --force, et üle kirjutada olemasolevad kollektsioonid.
"""

import os
import sys
import json
import re

# Seadistus
BASE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', '04_sorditud_dokumendid')


def extract_year_from_dirname(dirname):
    """Eraldab aasta kaustanimest (nt '1709-22-Pealkiri' -> 1709)."""
    match = re.match(r'^(\d{4})', dirname)
    if match:
        return int(match.group(1))
    return None

# Kollektsioonide reeglid aasta järgi
YEAR_RULES = [
    (1632, 1656, 'academia-gustaviana'),
    (1689, 1710, 'academia-gustavo-carolina'),
]


def get_collection_for_year(year):
    """Tagastab kollektsiooni ID aasta järgi või None kui pole reeglit."""
    if not year:
        return None
    for start, end, collection_id in YEAR_RULES:
        if start <= year <= end:
            return collection_id
    return None


def assign_collections(base_dir, apply=False, force=False):
    """Määrab kollektsioonid aasta järgi."""

    if not os.path.exists(base_dir):
        print(f"VIGA: Kausta ei leitud: {base_dir}")
        return

    print(f"Skanneerin kausta: {base_dir}")
    print(f"Režiim: {'RAKENDA' if apply else 'DRY-RUN (--apply rakendamiseks)'}")
    if force:
        print("HOIATUS: --force režiim - ülekirjutab olemasolevad kollektsioonid!")
    print("-" * 60)
    print()

    # Statistika
    stats = {
        'total': 0,
        'assigned': 0,
        'skipped_has_collection': 0,
        'skipped_no_rule': 0,
        'skipped_no_year': 0,
        'errors': 0,
        'by_collection': {}
    }

    dirs = sorted([e for e in os.scandir(base_dir) if e.is_dir()], key=lambda x: x.name)

    for entry in dirs:
        meta_path = os.path.join(entry.path, '_metadata.json')
        stats['total'] += 1

        if not os.path.exists(meta_path):
            print(f"  VAHELE: {entry.name} (pole _metadata.json)")
            continue

        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)

            # Toeta nii v2 (year) kui v1 (aasta) formaati
            year = meta.get('year') or meta.get('aasta') or 0
            current_collection = meta.get('collection')

            # Kui aasta puudub metaandmetest, proovi kaustanimest
            if not year:
                year = extract_year_from_dirname(entry.name)

            # Kontrolli, kas juba on kollektsioon
            if current_collection and not force:
                print(f"  VAHELE: {entry.name} (aasta {year}) -> juba määratud: {current_collection}")
                stats['skipped_has_collection'] += 1
                continue

            # Kontrolli aastat
            if not year:
                print(f"  VAHELE: {entry.name} -> aasta puudub (ka kaustanimes)")
                stats['skipped_no_year'] += 1
                continue

            # Leia kollektsioon aasta järgi
            new_collection = get_collection_for_year(year)

            if not new_collection:
                print(f"  VAHELE: {entry.name} (aasta {year}) -> pole reeglit")
                stats['skipped_no_rule'] += 1
                continue

            # Määra kollektsioon
            action = "ÜLEKIRJUTA" if current_collection else "MÄÄRA"
            print(f"  {action}: {entry.name} (aasta {year}) -> {new_collection}")

            if apply:
                meta['collection'] = new_collection
                with open(meta_path, 'w', encoding='utf-8') as f:
                    json.dump(meta, f, ensure_ascii=False, indent=2)

            stats['assigned'] += 1
            stats['by_collection'][new_collection] = stats['by_collection'].get(new_collection, 0) + 1

        except Exception as e:
            print(f"  VIGA: {entry.name} -> {e}")
            stats['errors'] += 1

    # Kokkuvõte
    print()
    print("-" * 60)
    print("Kokkuvõte:")
    print(f"  Kokku teoseid: {stats['total']}")
    print(f"  Määratud: {stats['assigned']}")
    print(f"  Vahele jäetud (juba määratud): {stats['skipped_has_collection']}")
    print(f"  Vahele jäetud (pole reeglit): {stats['skipped_no_rule']}")
    print(f"  Vahele jäetud (aasta puudub): {stats['skipped_no_year']}")
    print(f"  Vigu: {stats['errors']}")
    print()

    if stats['by_collection']:
        print("Kollektsioonide kaupa:")
        for coll, count in sorted(stats['by_collection'].items()):
            print(f"  {coll}: {count}")

    if not apply and stats['assigned'] > 0:
        print()
        print("Muudatuste rakendamiseks käivita:")
        print("  python3 scripts/assign_collections_by_year.py --apply")
        print()
        print("NB: Pärast rakendamist käivita ka indekseerimine:")
        print("  python3 scripts/1-1_consolidate_data.py")
        print("  python3 scripts/2-1_upload_to_meili.py")


if __name__ == '__main__':
    apply = '--apply' in sys.argv
    force = '--force' in sys.argv
    assign_collections(BASE_DIR, apply=apply, force=force)
