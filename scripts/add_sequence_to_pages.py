"""
Migratsiooniskript: lisab sequence välja kõigile lehe .json failidele.

Sequence väärtused: 100, 200, 300, ... (sammuga 100) tähestikulise failinime järgi.
See lahutab failinime kuvamisjärjekorrast — tulevikus saab sequence muuta
ilma failinimesid muutmata.

Käivitus: python3 scripts/add_sequence_to_pages.py [--dry-run]
"""
import os
import sys
import json

# Leia projekti juurkaust (skript on scripts/ all)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.join(SCRIPT_DIR, '..', 'data')
BASE_DIR = os.path.normpath(BASE_DIR)

def process_work_dir(dir_path, dry_run=False):
    """
    Töötleb ühe teose kausta: lisab sequence välja kõigile lehe .json failidele.
    Tagastab (uuendatud, jäetud_vahele, loodud) arvud.
    """
    # Leia kõik pildifailid (sama loogika mis meilisearch_ops.py)
    try:
        all_files = os.listdir(dir_path)
    except PermissionError as e:
        print(f"  VIGA: {e}")
        return 0, 0, 0

    images = sorted([
        f for f in all_files
        if f.lower().endswith(('.jpg', '.jpeg', '.png'))
        and not f.startswith('_thumb_')
    ])

    if not images:
        return 0, 0, 0

    updated = 0
    skipped = 0
    created = 0

    for i, img_name in enumerate(images):
        sequence = (i + 1) * 100
        base_name = os.path.splitext(img_name)[0]
        json_path = os.path.join(dir_path, base_name + '.json')

        if os.path.exists(json_path):
            # Loe olemasolev JSON
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                print(f"  VIGA JSON lugemisel {json_path}: {e}")
                continue

            # Toeta nii vana (meta_content wrapper) kui uut formaati
            if 'meta_content' in data:
                # Vana formaat: sequence läheb meta_content alla
                existing = data['meta_content'].get('sequence')
                if existing == sequence:
                    skipped += 1
                    continue
                if not dry_run:
                    data['meta_content']['sequence'] = sequence
                    with open(json_path, 'w', encoding='utf-8') as f:
                        json.dump(data, f, indent=2, ensure_ascii=False)
                updated += 1
            else:
                # Uus formaat: sequence otse objektis
                existing = data.get('sequence')
                if existing == sequence:
                    skipped += 1
                    continue
                if not dry_run:
                    data['sequence'] = sequence
                    with open(json_path, 'w', encoding='utf-8') as f:
                        json.dump(data, f, indent=2, ensure_ascii=False)
                updated += 1
        else:
            # JSON puudub — loo minimaalne fail
            new_data = {
                'sequence': sequence,
                'status': 'Toores'
            }
            if not dry_run:
                with open(json_path, 'w', encoding='utf-8') as f:
                    json.dump(new_data, f, indent=2, ensure_ascii=False)
                os.chmod(json_path, 0o644)
            created += 1

    return updated, skipped, created


def main():
    dry_run = '--dry-run' in sys.argv

    if dry_run:
        print("=== DRY RUN (ei kirjuta midagi) ===\n")
    else:
        print("=== Sequence migratsioon ===\n")

    if not os.path.exists(BASE_DIR):
        print(f"VIGA: data kausta ei leitud: {BASE_DIR}")
        sys.exit(1)

    total_works = 0
    total_updated = 0
    total_skipped = 0
    total_created = 0

    for entry in sorted(os.listdir(BASE_DIR)):
        # Ignoreeri varjatud kaustu ja mittekaustu
        if entry.startswith('.') or entry.startswith('_'):
            continue
        dir_path = os.path.join(BASE_DIR, entry)
        if not os.path.isdir(dir_path):
            continue

        # Kontrolli kas on teose kaust (_metadata.json olemasolu)
        if not os.path.exists(os.path.join(dir_path, '_metadata.json')):
            continue

        updated, skipped, created = process_work_dir(dir_path, dry_run)
        total = updated + skipped + created

        if total > 0:
            total_works += 1
            total_updated += updated
            total_skipped += skipped
            total_created += created
            print(f"  {entry}: {updated} uuendatud, {skipped} jäetud vahele, {created} loodud")

    print(f"\nKokku:")
    print(f"  Teoseid: {total_works}")
    print(f"  Uuendatud: {total_updated}")
    print(f"  Jäetud vahele (juba OK): {total_skipped}")
    print(f"  Loodud uued JSON: {total_created}")

    if dry_run:
        print("\n(Tegelike muudatuste tegemiseks käivita ilma --dry-run)")


if __name__ == '__main__':
    main()
