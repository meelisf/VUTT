#!/usr/bin/env python3
"""
Migratsiooniskript: Lisab püsiva nanoid-stiilis `id` välja kõigile _metadata.json failidele.

Kasutamine:
    python3 scripts/migrate_add_nanoid.py           # Dry-run (näitab muudatusi)
    python3 scripts/migrate_add_nanoid.py --apply   # Rakendab muudatused

Mida teeb:
    1. Käib läbi kõik data/04_sorditud_dokumendid/ kaustad
    2. Loeb _metadata.json failid
    3. Kui `id` väli puudub, genereerib 8-kohalise lühikoodi
    4. Salvestab uuendatud faili

ID formaat: 8 tähemärki (a-z, 0-9), nt: "x9r4mk2p"
"""

import os
import sys
import json
import secrets
import string

# Seadistus
BASE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', '04_sorditud_dokumendid')
ID_LENGTH = 8
ID_ALPHABET = string.ascii_lowercase + string.digits  # a-z, 0-9


def generate_nanoid(length=ID_LENGTH):
    """Genereerib nanoid-stiilis lühikoodi."""
    return ''.join(secrets.choice(ID_ALPHABET) for _ in range(length))


def get_all_existing_ids(base_dir):
    """Kogub kõik olemasolevad ID-d, et vältida duplikaate."""
    existing_ids = set()

    for entry in os.scandir(base_dir):
        if entry.is_dir():
            meta_path = os.path.join(entry.path, '_metadata.json')
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, 'r', encoding='utf-8') as f:
                        meta = json.load(f)
                        if meta.get('id'):
                            existing_ids.add(meta['id'])
                except Exception as e:
                    print(f"  HOIATUS: Ei saanud lugeda {meta_path}: {e}")

    return existing_ids


def generate_unique_id(existing_ids):
    """Genereerib unikaalse ID, mis pole veel kasutuses."""
    max_attempts = 100
    for _ in range(max_attempts):
        new_id = generate_nanoid()
        if new_id not in existing_ids:
            existing_ids.add(new_id)
            return new_id
    raise Exception("Ei suutnud genereerida unikaalset ID-d")


def migrate_metadata(base_dir, apply=False):
    """Käib läbi kõik _metadata.json failid ja lisab id välja."""

    if not os.path.exists(base_dir):
        print(f"VIGA: Kausta ei leitud: {base_dir}")
        return

    print(f"Skanneerin kausta: {base_dir}")
    print(f"Režiim: {'RAKENDA' if apply else 'DRY-RUN (--apply rakendamiseks)'}")
    print("-" * 60)

    # Kogu olemasolevad ID-d
    existing_ids = get_all_existing_ids(base_dir)
    print(f"Olemasolevaid ID-sid: {len(existing_ids)}")
    print()

    updated = 0
    skipped = 0
    errors = 0

    dirs = sorted([e for e in os.scandir(base_dir) if e.is_dir()], key=lambda x: x.name)

    for entry in dirs:
        meta_path = os.path.join(entry.path, '_metadata.json')

        if not os.path.exists(meta_path):
            print(f"  VAHELE: {entry.name} (pole _metadata.json)")
            skipped += 1
            continue

        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)

            # Kontrolli, kas id juba olemas
            if meta.get('id'):
                print(f"  OK: {entry.name} -> id={meta['id']} (juba olemas)")
                skipped += 1
                continue

            # Genereeri uus ID
            new_id = generate_unique_id(existing_ids)

            # Lisa id väli ESIMESENA (loetavuse huvides)
            new_meta = {'id': new_id}
            new_meta.update(meta)

            print(f"  LISA: {entry.name} -> id={new_id}")

            if apply:
                with open(meta_path, 'w', encoding='utf-8') as f:
                    json.dump(new_meta, f, ensure_ascii=False, indent=2)

            updated += 1

        except Exception as e:
            print(f"  VIGA: {entry.name} -> {e}")
            errors += 1

    print()
    print("-" * 60)
    print(f"Kokkuvõte:")
    print(f"  Uuendatud: {updated}")
    print(f"  Vahele jäetud: {skipped}")
    print(f"  Vigu: {errors}")

    if not apply and updated > 0:
        print()
        print("Muudatuste rakendamiseks käivita:")
        print("  python3 scripts/migrate_add_nanoid.py --apply")


if __name__ == '__main__':
    apply = '--apply' in sys.argv
    migrate_metadata(BASE_DIR, apply=apply)
