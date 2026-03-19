#!/usr/bin/env python3
"""
Loob prosopograafia kaardid kõigile person_aliases.json isikutele
kellel on väline ID (wikidata, gnd, viaf, album_academicum).

Idempotentne: kui sama identifikaatoriga kirje juba olemas, jätab vahele.
Käivitus:
    cd /home/meelisf/VUTT
    python3 scripts/import_persons_from_aliases.py [--dry-run]
"""

import json
import glob
import os
import sys
import argparse
from datetime import datetime, timezone

BASE_DIR = '/home/meelisf/VUTT'
ALIASES_FILE = os.path.join(BASE_DIR, 'state', 'person_aliases.json')
PROSOPO_DIR = os.path.join(BASE_DIR, 'state', 'prosopography')
INDEX_FILE = os.path.join(BASE_DIR, 'state', 'prosopography_index.json')

import secrets
import string

NANOID_ALPHABET = string.ascii_lowercase + string.digits

def generate_nanoid(length=6):
    """Sama loogika mis server/utils.py generate_nanoid."""
    return ''.join(secrets.choice(NANOID_ALPHABET) for _ in range(length))


def load_aliases():
    with open(ALIASES_FILE, encoding='utf-8') as f:
        return json.load(f)


def load_index():
    if os.path.exists(INDEX_FILE):
        try:
            with open(INDEX_FILE, encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {"rebuilt_at": None, "entries": []}


def atomic_write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def load_existing_identifiers():
    """
    Laeb kõik olemasolevad prosopograafia failid ja ehitab
    { (scheme, id): vutt_id } kaardistuse duplikaadikontrolliks.
    """
    mapping = {}
    files = glob.glob(os.path.join(PROSOPO_DIR, '*.json'))
    for fpath in files:
        if 'images' in fpath:
            continue
        try:
            with open(fpath, encoding='utf-8') as f:
                person = json.load(f)
            vutt_id = person.get('id', '')
            for ident in person.get('identifiers', []):
                scheme = ident.get('scheme', '')
                ext_id = ident.get('id', '')
                if scheme and ext_id:
                    mapping[(scheme, ext_id)] = vutt_id
        except Exception as e:
            print(f"  Viga {fpath}: {e}", file=sys.stderr)
    return mapping


def make_date_obj(year=None):
    return {
        "original_text": None,
        "date": str(year) if year else None,
        "date_to": None,
        "bound": None,
        "precision": "year" if year else None,
        "calendar": None,
        "is_circa": False,
        "place": None,
        "notes": None,
    }


def make_person_record(nanoid, primary_name, aliases, identifiers, now):
    """Ehitab täieliku prosopograafia kirje minimaalse andmestikuga."""
    person_id = f"vutt:P{nanoid}"
    return {
        "id": person_id,
        "identifiers": identifiers,
        "merged_into": None,
        "import_batch_ids": ["aliases-import-2026"],
        "schema_version": 1,
        "record_status": "draft",
        "verification_level": "draft",
        "created_at": now,
        "updated_at": now,
        "created_by": "import_script",
        "updated_by": "import_script",
        "name": {
            "label": primary_name,
            "family_name": None,
            "first_name": None,
            "qualifier": None,
            "qualifier_type": None,
            "noble_status": None,
            "maiden_name": None,
            "aliases": sorted(set(aliases) - {primary_name}),
            "family_name_variants": [],
            "first_name_variants": [],
        },
        "gender": None,
        "birth": make_date_obj(),
        "death": make_date_obj(),
        "origin": {
            "city": None, "city_id": None, "city_labels": None,
            "region": None, "region_id": None, "region_labels": None,
            "geonames_id": None, "coordinates": None,
        },
        "status": None,
        "confession": None,
        "occupations": [],
        "education": [],
        "burial": None,
        "relations": [],
        "sources": [],
        "biography": None,
        "notes": None,
        "image_url": None,
        "source_data": {},
        "floruit": None,
        "tags": [],
    }


def index_entry_from_person(person):
    """Ehitab prosopography_index.json kirje."""
    name_obj = person.get('name') or {}
    label = name_obj.get('label') or person['id']
    family_name = name_obj.get('family_name') or ''
    first_name = name_obj.get('first_name') or ''
    sort_name = f"{family_name}, {first_name}".strip(', ') if family_name else label

    identifiers = person.get('identifiers') or []
    schemes = {i.get('scheme') for i in identifiers}

    return {
        "id": person['id'],
        "label": label,
        "sort_name": sort_name,
        "birth_year": None,
        "death_year": None,
        "gender": None,
        "status_id": None,
        "status_label": None,
        "confession_id": None,
        "has_wikidata": 'wikidata' in schemes,
        "has_gnd": 'gnd' in schemes,
        "has_aa": 'album_academicum' in schemes,
        "record_status": "draft",
        "verification_level": "draft",
        "work_count": 0,
        "biography_snippet": "",
        "image_url": None,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    print("=== Prosopograafia kaartide import person_aliases.json-ist ===\n")

    aliases_data = load_aliases()
    existing = load_existing_identifiers()
    print(f"Olemasolevaid prosopograafia kirjeid: {len(set(existing.values()))}")
    print(f"Olemasolevaid identifikaatoreid: {len(existing)}")

    # Deduplitseeri: üks isik võib olla mitme võtme all (Q, GND, VIAF)
    # Kasuta primary_name + ids kombinatsiooni unikaalsuse aluseks
    seen_persons = {}  # json.dumps(ids_sorted) → entry
    for key, entry in aliases_data.items():
        if not isinstance(entry, dict):
            continue
        # Jäta vahele vutt:P kirjed (need on prosopo ID ristviited)
        if key.startswith('vutt:P'):
            continue
        ids = entry.get('ids', {})
        if not ids:
            continue
        # Unikaalsuse võti: sorteeritud ID paarid
        ids_key = json.dumps(sorted(ids.items()), sort_keys=True)
        if ids_key not in seen_persons:
            seen_persons[ids_key] = entry

    print(f"Unikaalseid importimiseks: {len(seen_persons)}\n")

    created = 0
    skipped = 0
    now = datetime.now(timezone.utc).isoformat()

    index_data = load_index()
    existing_index_ids = {e['id'] for e in index_data.get('entries', [])}

    # Loe aliases_data uuesti kirjutamiseks
    updated_aliases = dict(aliases_data)

    for ids_key, entry in seen_persons.items():
        primary_name = entry.get('primary_name', '')
        aliases = entry.get('aliases', [])
        ids = entry.get('ids', {})

        # Ehita identifikaatorite list
        identifiers = []
        for scheme in ['wikidata', 'gnd', 'viaf', 'album_academicum']:
            ext_id = ids.get(scheme)
            if ext_id:
                identifiers.append({"scheme": scheme, "id": ext_id, "checked_at": None})

        # Duplikaadikontroll
        existing_vutt_id = None
        for ident in identifiers:
            key = (ident['scheme'], ident['id'])
            if key in existing:
                existing_vutt_id = existing[key]
                break

        if existing_vutt_id:
            print(f"  OLEMAS ({existing_vutt_id}): {primary_name}")
            skipped += 1
            # Veendu et vutt:P ID on aliases_data-s
            if existing_vutt_id not in updated_aliases:
                updated_aliases[existing_vutt_id] = {
                    "primary_name": primary_name,
                    "aliases": aliases,
                    "ids": {},
                }
            continue

        nanoid = generate_nanoid()
        person_id = f"vutt:P{nanoid}"
        person = make_person_record(nanoid, primary_name, aliases, identifiers, now)

        print(f"  LOO {person_id}: {primary_name} ({', '.join(ids.keys())})")
        created += 1

        if not args.dry_run:
            # Kirjuta prosopograafia fail
            path = os.path.join(PROSOPO_DIR, f"{nanoid}.json")
            atomic_write(path, person)

            # Uuenda indeks
            if person_id not in existing_index_ids:
                index_data['entries'].append(index_entry_from_person(person))
                existing_index_ids.add(person_id)

            # Lisa vutt:P ID aliases_data-sse
            updated_aliases[person_id] = {
                "primary_name": primary_name,
                "aliases": aliases,
                "ids": {},
            }

            # Uuenda ka existing (juhuks kui sama skripti sees duplikaat)
            for ident in identifiers:
                existing[(ident['scheme'], ident['id'])] = person_id

    print(f"\n{'─'*50}")
    print(f"Loodud: {created}, vahele jäetud (olemas): {skipped}")

    if args.dry_run:
        print("[DRY RUN] Midagi ei kirjutatud.")
        return

    # Salvesta uuendatud indeks
    index_data['rebuilt_at'] = now
    atomic_write(INDEX_FILE, index_data)

    # Salvesta uuendatud aliases (lisatud vutt:P ID-d)
    atomic_write(ALIASES_FILE, updated_aliases)

    print(f"Salvesatitud: {INDEX_FILE}")
    print(f"Uuendatud: {ALIASES_FILE}")
    print(f"\nKokku prosopograafia kirjeid: {len(set(existing.values())) + created}")


if __name__ == '__main__':
    main()
