#!/usr/bin/env python3
"""
Migratsioon: kustutab *_object duplikaatväljad _metadata.json failidest.

Enne migratsiooni:
  tags, tags_object, genre, genre_object, type, type_object,
  location, location_object, publisher, publisher_object

Pärast migratsiooni:
  tags, genre, type, location, publisher
  (kõik sisaldavad LinkedEntity objekte otse, *_object väljad kustutatud)

Loogika:
  - tags:      tags_object väärtus kui olemas ja mitte-tühi,
               muidu tags kust filtreeritakse ainult dict-kirjed,
               muidu []
  - genre:     genre_object väärtus kui olemas, muidu genre, muidu []
  - type:      type_object väärtus kui olemas, muidu type, muidu null
  - location:  location_object väärtus kui olemas, muidu location, muidu null
  - publisher: publisher_object väärtus kui olemas, muidu publisher, muidu null

Skript on idempotentne — kui *_object väljad puuduvad, ei tee midagi.

Kasutamine:
  python3 scripts/migrate_object_fields.py [--dry-run]
"""

import json
import os
import sys

DATA_DIR = os.path.join(os.getcwd(), 'data')

OBJECT_FIELDS = [
    'tags_object', 'genre_object', 'type_object',
    'location_object', 'publisher_object',
]


def migrate_metadata(meta: dict) -> tuple[dict, bool]:
    """
    Migreerib ühe _metadata.json sisu.
    Tagastab (uuendatud_meta, muutus_toimus).
    """
    changed = False

    # Kas üldse on midagi migreerida?
    has_object_fields = any(k in meta for k in OBJECT_FIELDS)
    if not has_object_fields:
        return meta, False

    # tags
    if 'tags_object' in meta:
        tags_obj = meta.get('tags_object')
        if tags_obj:  # mitte-tühi
            meta['tags'] = tags_obj
        else:
            # Filtreeri tags massiiv — ainult dict-kirjed
            meta['tags'] = [t for t in meta.get('tags', []) if isinstance(t, dict)]
        del meta['tags_object']
        changed = True

    # genre
    if 'genre_object' in meta:
        genre_obj = meta.get('genre_object')
        if genre_obj is not None:
            meta['genre'] = genre_obj
        else:
            # Jäta genre nii nagu on (või [] kui puudub)
            if 'genre' not in meta:
                meta['genre'] = []
        del meta['genre_object']
        changed = True

    # type
    if 'type_object' in meta:
        type_obj = meta.get('type_object')
        if type_obj is not None:
            meta['type'] = type_obj
        else:
            if 'type' not in meta:
                meta['type'] = None
        del meta['type_object']
        changed = True

    # location
    if 'location_object' in meta:
        loc_obj = meta.get('location_object')
        if loc_obj is not None:
            meta['location'] = loc_obj
        else:
            if 'location' not in meta:
                meta['location'] = None
        del meta['location_object']
        changed = True

    # publisher
    if 'publisher_object' in meta:
        pub_obj = meta.get('publisher_object')
        if pub_obj is not None:
            meta['publisher'] = pub_obj
        else:
            if 'publisher' not in meta:
                meta['publisher'] = None
        del meta['publisher_object']
        changed = True

    return meta, changed


def main():
    dry_run = '--dry-run' in sys.argv

    if not os.path.isdir(DATA_DIR):
        print(f"VIGA: Andmete kausta ei leitud: {DATA_DIR}")
        sys.exit(1)

    print(f"Andmete kaust: {DATA_DIR}")
    if dry_run:
        print("TESTKÄIVITUS (--dry-run): faile ei kirjutata\n")
    else:
        print()

    total = 0
    migrated = 0
    errors = 0

    for entry in sorted(os.scandir(DATA_DIR), key=lambda e: e.name):
        if not entry.is_dir():
            continue
        meta_path = os.path.join(entry.path, '_metadata.json')
        if not os.path.exists(meta_path):
            continue

        total += 1
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)

            new_meta, changed = migrate_metadata(meta)

            if changed:
                migrated += 1
                print(f"  Migreerin: {entry.name}")
                if not dry_run:
                    tmp_path = meta_path + '.tmp'
                    with open(tmp_path, 'w', encoding='utf-8') as f:
                        json.dump(new_meta, f, ensure_ascii=False, indent=2)
                    os.replace(tmp_path, meta_path)

        except Exception as e:
            errors += 1
            print(f"  VIGA {entry.name}: {e}")

    print(f"\nValmis: {total} faili läbi vaadatud, {migrated} migreeritud, {errors} viga")
    if dry_run and migrated > 0:
        print("Käivita ilma --dry-run liputa muudatuste rakendamiseks.")


if __name__ == '__main__':
    main()
