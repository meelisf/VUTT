#!/usr/bin/env python3
"""
Sünkroniseerib _metadata.json creator.name prosopo kaardi name_label-iga.

Kui prosopo kaardil muudetakse kaanoonilist nime, ei muutu see automaatselt
_metadata.json-is. See skript leiab kõik lahknevused ja parandab need.

Kasutamine:
  python3 scripts/propagate_prosopo_names.py          # dry-run, näitab muudatused
  python3 scripts/propagate_prosopo_names.py --apply  # kirjutab muudatused
"""
import glob
import json
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_DIR = os.path.join(PROJECT_ROOT, "state")
PROSOPO_DIR = os.path.join(STATE_DIR, "prosopography")
DATA_DIR = os.path.join(PROJECT_ROOT, "data")

DRY_RUN = "--apply" not in sys.argv


def load_prosopo_names() -> dict:
    """Tagastab {vutt:Pxxx: name_label} kõigist prosopo kaartidest."""
    names = {}
    for path in glob.glob(os.path.join(PROSOPO_DIR, "*.json")):
        try:
            with open(path, encoding="utf-8") as f:
                card = json.load(f)
            pid = card.get("id")
            name = card.get("name_label")
            if pid and name and pid.startswith("vutt:P"):
                names[pid] = name
        except Exception:
            pass
    return names


def main():
    print(f"{'DRY RUN — kasuta --apply muudatuste kirjutamiseks' if DRY_RUN else 'APPLY MODE — kirjutan muudatused'}\n")

    prosopo_names = load_prosopo_names()
    print(f"Prosopo kaardid: {len(prosopo_names)}")

    # Leia kõik _metadata.json failid
    meta_files = glob.glob(os.path.join(DATA_DIR, "*", "_metadata.json"))
    print(f"Teosed: {len(meta_files)}\n")

    changed_works = 0
    changed_creators = 0
    skipped = 0

    for meta_path in sorted(meta_files):
        try:
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
        except Exception as e:
            print(f"VIGA lugemisel {meta_path}: {e}")
            continue

        creators = meta.get("creators") or []
        work_changed = False

        for creator in creators:
            pid = creator.get("id") or ""
            if not pid.startswith("vutt:P"):
                continue
            canonical = prosopo_names.get(pid)
            if canonical is None:
                skipped += 1
                continue
            current_name = creator.get("name") or ""
            if current_name == canonical:
                continue

            folder = os.path.basename(os.path.dirname(meta_path))
            print(f"  {folder}: [{pid}] '{current_name}' → '{canonical}'")
            creator["name"] = canonical
            work_changed = True
            changed_creators += 1

        if work_changed:
            changed_works += 1
            if not DRY_RUN:
                with open(meta_path, "w", encoding="utf-8") as f:
                    json.dump(meta, f, ensure_ascii=False, indent=2)
                    f.write("\n")

    print(f"\nKokku: {changed_creators} loojat {changed_works} teoses")
    if skipped:
        print(f"Jäeti vahele (prosopo kaart puudub): {skipped}")

    if DRY_RUN and changed_creators > 0:
        print("\nMuudatuste rakendamiseks käivita uuesti --apply lipuga.")

    if not DRY_RUN and changed_works > 0:
        print("\nPärast rakendamist tuleb Meilisearch uuesti indekseerida:")
        print("  ssh vutt")
        print("  docker exec vutt-backend python3 scripts/1-1_consolidate_data.py")
        print("  docker exec vutt-backend python3 scripts/2-1_upload_to_meili.py")


if __name__ == "__main__":
    main()
