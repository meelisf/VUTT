#!/usr/bin/env python3
"""
Migreerib _metadata.json failid:
  collection: "x"    →  collections: ["x"]
  collection: null   →  collections: []

Eemaldab vana `collection` välja.
Idempotentne: kui `collections` juba olemas, jätab faili vahele.

Käivitus:
  python3 scripts/migrate_collections.py [--dry-run]
"""
import os
import sys
import json
import subprocess

BASE_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
DRY_RUN = '--dry-run' in sys.argv

def main():
    base = os.path.abspath(BASE_DIR)
    if not os.path.exists(base):
        print(f"VIGA: Kataloog ei leitud: {base}")
        sys.exit(1)

    updated = []
    skipped_already = []
    skipped_no_meta = []
    errors = []

    for folder in sorted(os.listdir(base)):
        folder_path = os.path.join(base, folder)
        if not os.path.isdir(folder_path) or folder.startswith('.'):
            continue

        meta_path = os.path.join(folder_path, '_metadata.json')
        if not os.path.exists(meta_path):
            skipped_no_meta.append(folder)
            continue

        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
        except Exception as e:
            errors.append((folder, str(e)))
            continue

        # Idempotentsuse kontroll
        if 'collections' in meta:
            skipped_already.append(folder)
            continue

        # Migratsioon
        old_value = meta.get('collection')
        if old_value:
            new_value = [old_value]
        else:
            new_value = []

        del meta['collection']
        meta['collections'] = new_value

        if DRY_RUN:
            print(f"[DRY] {folder}: collection={repr(old_value)} → collections={new_value}")
        else:
            try:
                content = json.dumps(meta, indent=2, ensure_ascii=False)
                with open(meta_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                updated.append(folder)
            except Exception as e:
                errors.append((folder, str(e)))

    # Kokkuvõte
    print(f"\n{'[DRY RUN] ' if DRY_RUN else ''}Migratsioon lõpetatud:")
    print(f"  Uuendatud:          {len(updated)}")
    print(f"  Juba migreeritud:   {len(skipped_already)}")
    print(f"  Metaandmeid pole:   {len(skipped_no_meta)}")
    print(f"  Vigu:               {len(errors)}")
    if errors:
        print("\nVead:")
        for folder, err in errors:
            print(f"  {folder}: {err}")

    if not DRY_RUN and updated:
        # data/ on eraldi git repo (VUTT repo gitignore'd selle)
        data_git_dir = base
        print(f"\nLuun git commit ({len(updated)} faili) data/ repos...")
        try:
            result = subprocess.run(
                ['git', 'add', '-A'],
                cwd=data_git_dir,
                capture_output=True, text=True
            )
            if result.returncode != 0:
                print(f"git add viga: {result.stderr}")
                return

            result = subprocess.run(
                ['git', 'commit', '-m', f'migrate: collection → collections[] ({len(updated)} teost)'],
                cwd=data_git_dir,
                capture_output=True, text=True
            )
            if result.returncode == 0:
                print("Git commit loodud.")
            else:
                print(f"Git commit viga: {result.stderr}")
        except Exception as e:
            print(f"Git viga: {e}")

if __name__ == '__main__':
    main()
