#!/usr/bin/env python3
"""
Täiendab _metadata.json failides LinkedEntity objektide puuduvaid keelesilte
state/labels.json cache'ist.

Näide: kui metadata sisaldab {"id": "Q567303", "labels": {"et": "Teadaanne"}}
ja labels.json-is on {"Q567303": {"et": "teadaanne", "en": "announcement"}},
siis lisatakse puuduv "en" silt.

Olemasolevaid silte EI kirjutata üle — ainult puuduvad täidetakse.
"""

import os
import json
import argparse

BASE_DIR = os.getenv("VUTT_DATA_DIR", "data")
LABELS_FILE = os.path.join("state", "labels.json")

# Metaandmete väljade nimed mis sisaldavad LinkedEntity objekte.
# Isikute (creators) ja trükkalite (publisher) nimesid ei rikastata —
# need on samad kõigis keeltes.
SINGLE_ENTITY_FIELDS = ["genre", "type", "location"]
ARRAY_ENTITY_FIELDS = ["tags"]


def enrich_entity(entity, labels_cache):
    """Täiendab ühe LinkedEntity objekti puuduvaid labels välju. Tagastab True kui muudeti."""
    if not isinstance(entity, dict):
        return False
    entity_id = entity.get("id")
    if not entity_id or entity_id not in labels_cache:
        return False

    cached = labels_cache[entity_id]
    if not isinstance(cached, dict):
        return False

    if "labels" not in entity or not isinstance(entity["labels"], dict):
        entity["labels"] = {}

    modified = False
    for lang, label in cached.items():
        if lang == "manual":
            continue
        if lang not in entity["labels"] and label:
            entity["labels"][lang] = label
            modified = True

    return modified


def enrich_metadata(dry_run=False):
    if not os.path.exists(LABELS_FILE):
        print(f"Viga: {LABELS_FILE} ei leitud.")
        return

    with open(LABELS_FILE, "r", encoding="utf-8") as f:
        labels_cache = json.load(f)

    print(f"Laaditud {len(labels_cache)} kirjet failist {LABELS_FILE}")
    if dry_run:
        print("--- DRY RUN (SIMULATSIOON) - FAILE EI MUUDETA ---")

    checked = 0
    modified_files = 0
    enriched_entities = 0

    for root, dirs, files in os.walk(BASE_DIR):
        if "_metadata.json" not in files:
            continue

        path = os.path.join(root, "_metadata.json")
        checked += 1

        try:
            with open(path, "r", encoding="utf-8") as f:
                meta = json.load(f)

            file_modified = False

            # Üksikud entity väliad
            for field in SINGLE_ENTITY_FIELDS:
                obj = meta.get(field)
                if isinstance(obj, list):
                    for item in obj:
                        if enrich_entity(item, labels_cache):
                            file_modified = True
                            enriched_entities += 1
                            print(f"  [{field}] {path}: lisatud label ID-le {item.get('id')}")
                elif isinstance(obj, dict):
                    if enrich_entity(obj, labels_cache):
                        file_modified = True
                        enriched_entities += 1
                        print(f"  [{field}] {path}: lisatud label ID-le {obj.get('id')}")

            # Massiivi väliad
            for field in ARRAY_ENTITY_FIELDS:
                items = meta.get(field, [])
                if not isinstance(items, list):
                    continue
                for item in items:
                    if enrich_entity(item, labels_cache):
                        file_modified = True
                        enriched_entities += 1
                        print(f"  [{field}] {path}: lisatud label ID-le {item.get('id')}")

            if file_modified:
                if not dry_run:
                    with open(path, "w", encoding="utf-8") as f:
                        json.dump(meta, f, ensure_ascii=False, indent=2)
                modified_files += 1

        except Exception as e:
            print(f"Viga faili töötlemisel {path}: {e}")

    print("\n--- KOKKUVÕTE ---")
    if dry_run:
        print("DRY RUN: Ühtegi faili ei muudetud.")
    print(f"Läbi vaadatud faile: {checked}")
    print(f"Muudetud faile: {modified_files}")
    print(f"Täiendatud entity kirjeid: {enriched_entities}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Täienda _metadata.json failide puuduvaid keelesilte labels.json-ist.")
    parser.add_argument("--dry-run", action="store_true", help="Käivita simulatsioon ilma faile muutmata")
    args = parser.parse_args()

    if not os.path.exists(BASE_DIR):
        alt_dir = os.path.join(os.getcwd(), "data")
        if os.path.exists(alt_dir):
            BASE_DIR = alt_dir

    if not os.path.exists(BASE_DIR):
        print(f"Viga: Andmekataloogi '{BASE_DIR}' ei leitud.")
    else:
        enrich_metadata(dry_run=args.dry_run)
