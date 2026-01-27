#!/usr/bin/env python3
"""
Migratsiooniskript: lisab koht ja trükkal väljad _metadata.json failidele.

Loogika:
- koht: Tartu (< 1699), Pärnu (>= 1699)
- trükkal:
  - 1632–1635: Jacob Becker (Pistorius)
  - 1636–1641: Typis Academicis
  - 1642–1656: Johann Vogel (Vogelius)
  - 1657–1689: Typis Academicis
  - 1690–1710: Johann Brendeken
  - Muu: Typis Academicis

Kasutamine:
    python3 scripts/add_printer_place.py          # Dry-run
    python3 scripts/add_printer_place.py --apply  # Rakenda muudatused
"""

import os
import sys
import json
import argparse

# Andmekaust
DATA_ROOT_DIR = os.environ.get('VUTT_DATA_DIR', 'data/04_sorditud_dokumendid')


def get_place(year: int) -> str:
    """Määrab koha aasta järgi."""
    if year >= 1699:
        return "Pärnu"
    return "Tartu"


def get_printer(year: int) -> str:
    """Määrab trükkali aasta järgi."""
    if 1632 <= year <= 1635:
        return "Jacob Becker (Pistorius)"
    elif 1642 <= year <= 1656:
        return "Johann Vogel (Vogelius)"
    elif 1690 <= year <= 1710:
        return "Johann Brendeken"
    else:
        # 1636-1641, 1657-1689, ja muud aastad
        return "Typis Academicis"


def process_metadata_files(data_dir: str, apply_changes: bool = False):
    """Töötleb kõik _metadata.json failid."""

    if not os.path.exists(data_dir):
        print(f"Viga: Andmekaust '{data_dir}' ei eksisteeri")
        return

    stats = {
        'total': 0,
        'updated': 0,
        'skipped_no_year': 0,
        'already_has_fields': 0,
    }

    updates = []  # (path, old_data, new_data)

    for dir_name in sorted(os.listdir(data_dir)):
        dir_path = os.path.join(data_dir, dir_name)
        if not os.path.isdir(dir_path):
            continue

        metadata_path = os.path.join(dir_path, '_metadata.json')
        if not os.path.exists(metadata_path):
            continue

        stats['total'] += 1

        try:
            with open(metadata_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            print(f"Viga lugemisel {metadata_path}: {e}")
            continue

        year = data.get('aasta', 0)
        if not year or year == 0:
            stats['skipped_no_year'] += 1
            continue

        # Kontrolli kas väljad on juba olemas
        has_koht = 'koht' in data and data['koht']
        has_trykkal = 'trükkal' in data and data['trükkal']

        if has_koht and has_trykkal:
            stats['already_has_fields'] += 1
            continue

        # Määra uued väärtused
        new_data = data.copy()
        changed = False

        if not has_koht:
            new_data['koht'] = get_place(year)
            changed = True

        if not has_trykkal:
            new_data['trükkal'] = get_printer(year)
            changed = True

        if changed:
            stats['updated'] += 1
            updates.append((metadata_path, data, new_data))

    # Näita kokkuvõtet
    print("\n" + "=" * 60)
    print("MIGRATSIOONIARUANNE: koht ja trükkal")
    print("=" * 60)
    print(f"\nKokku _metadata.json faile: {stats['total']}")
    print(f"Uuendatakse: {stats['updated']}")
    print(f"Juba olemas: {stats['already_has_fields']}")
    print(f"Aasta puudub: {stats['skipped_no_year']}")

    if updates:
        print(f"\n📝 MUUDATUSED ({len(updates)} faili):")

        # Grupeeri trükkali järgi
        by_printer = {}
        for path, old, new in updates:
            printer = new.get('trükkal', 'unknown')
            if printer not in by_printer:
                by_printer[printer] = []
            by_printer[printer].append((path, old, new))

        for printer, items in sorted(by_printer.items()):
            print(f"\n   {printer}: {len(items)} teost")
            # Näita mõned näited
            for path, old, new in items[:3]:
                year = new.get('aasta', '?')
                koht = new.get('koht', '?')
                title = new.get('pealkiri', os.path.basename(os.path.dirname(path)))[:50]
                print(f"      {year} {koht}: {title}...")
            if len(items) > 3:
                print(f"      ... ja veel {len(items) - 3}")

    # Rakenda muudatused
    if apply_changes and updates:
        print("\n" + "-" * 60)
        print("RAKENDAN MUUDATUSED...")

        for path, old, new in updates:
            try:
                with open(path, 'w', encoding='utf-8') as f:
                    json.dump(new, f, ensure_ascii=False, indent=2)
            except Exception as e:
                print(f"Viga kirjutamisel {path}: {e}")

        print(f"✅ Uuendatud {len(updates)} faili")

    elif not apply_changes and updates:
        print("\n" + "-" * 60)
        print("See oli DRY-RUN. Muudatuste rakendamiseks:")
        print("   python3 scripts/add_printer_place.py --apply")

    else:
        print("\n✅ Kõik failid on juba uuendatud!")


def main():
    parser = argparse.ArgumentParser(description='Lisa koht ja trükkal väljad')
    parser.add_argument('--apply', action='store_true', help='Rakenda muudatused')
    parser.add_argument('--data-dir', default=DATA_ROOT_DIR, help='Andmete kataloog')
    args = parser.parse_args()

    print(f"Andmekaust: {args.data_dir}")
    process_metadata_files(args.data_dir, apply_changes=args.apply)


if __name__ == '__main__':
    main()
