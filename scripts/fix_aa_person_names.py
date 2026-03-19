#!/usr/bin/env python3
"""
Parandab AA isikute nimed prosopograafias: "Bergius, Thomas" → "Thomas Bergius".
Kasutab rsplit(', ', 1) et lõhkuda viimasel komal — katab ka sulumärgiga nimevariandid:
  "Vegrelius (Leerbogaeus, Lerbogius), Benedictus" → "Benedictus Vegrelius (Leerbogaeus, Lerbogius)"

Uuendab: prosopograafia JSON failid, prosopography_index.json, person_aliases.json.

Käivitus:
    cd /home/meelisf/VUTT
    python3 scripts/fix_aa_person_names.py [--dry-run]
"""

import json, glob, os, sys, argparse
from datetime import datetime, timezone

BASE_DIR = '/home/meelisf/VUTT'
PROSOPO_DIR = os.path.join(BASE_DIR, 'state', 'prosopography')
INDEX_FILE = os.path.join(BASE_DIR, 'state', 'prosopography_index.json')
ALIASES_FILE = os.path.join(BASE_DIR, 'state', 'person_aliases.json')


def invert_name(name: str) -> str:
    """
    'Bergius, Thomas' → 'Thomas Bergius'.
    Leiab esimese ', ' mis on väljaspool sulgusid — katab juhtumid nagu:
      'Vegrelius (Leerbogaeus, Lerbogius), Benedictus'
      'Baaz(ius) (Baacius, Basius, Bazius), Benedictus (Bengt)'
      'Bech(a)elius (Bekerius, Bigelius), Jonas'
    Ilma koma-eraldajata tagastab muutmata.
    """
    depth = 0
    for i, ch in enumerate(name):
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        elif ch == ',' and depth == 0 and i + 1 < len(name) and name[i + 1] == ' ':
            family = name[:i]
            first = name[i + 2:]
            return f"{first} {family}"
    return name  # koma puudub väljaspool sulgusid


def atomic_write(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    now = datetime.now(timezone.utc).isoformat()

    # --- Kogu parandatavad kirjed ---
    # { vutt_id: (fpath, person_dict, old_label, new_label, new_aliases) }
    to_fix = {}

    for fpath in glob.glob(os.path.join(PROSOPO_DIR, '*.json')):
        if 'images' in fpath:
            continue
        try:
            p = json.load(open(fpath, encoding='utf-8'))
        except Exception as e:
            print(f"Viga {fpath}: {e}", file=sys.stderr)
            continue

        ids = {i['scheme'] for i in p.get('identifiers', [])}
        if 'album_academicum' not in ids:
            continue

        old_label = p['name']['label']
        if ', ' not in old_label:
            continue

        new_label = invert_name(old_label)
        old_aliases = p['name'].get('aliases') or []
        new_aliases = [invert_name(a) if ', ' in a else a for a in old_aliases]

        print(f"  {p['id']}: '{old_label}' → '{new_label}'")
        to_fix[p['id']] = (fpath, p, old_label, new_label, new_aliases)

    print(f"\nKokku parandatavaid: {len(to_fix)}")

    if args.dry_run:
        print("[DRY RUN] Midagi ei kirjutata.")
        return

    # --- Uuenda prosopograafia failid ---
    for vutt_id, (fpath, p, old_label, new_label, new_aliases) in to_fix.items():
        p['name']['label'] = new_label
        p['name']['aliases'] = new_aliases
        p['updated_at'] = now
        atomic_write(fpath, p)

    # --- Uuenda prosopography_index.json ---
    index_data = json.load(open(INDEX_FILE, encoding='utf-8'))
    for entry in index_data.get('entries', []):
        if entry['id'] in to_fix:
            _, _, old_label, new_label, _ = to_fix[entry['id']]
            entry['label'] = new_label
            entry['sort_name'] = new_label
    index_data['rebuilt_at'] = now
    atomic_write(INDEX_FILE, index_data)

    # --- Uuenda person_aliases.json ---
    # Ehita kaardistus: vana primary_name → uus primary_name
    old_to_new_name = {old: new for _, _, old, new, _ in to_fix.values()}

    aliases_data = json.load(open(ALIASES_FILE, encoding='utf-8'))
    for key, entry in aliases_data.items():
        if not isinstance(entry, dict):
            continue
        old_pn = entry.get('primary_name', '')
        if old_pn in old_to_new_name:
            entry['primary_name'] = old_to_new_name[old_pn]
        # Uuenda ka aliases listis olevad koma-nimed
        entry['aliases'] = [
            invert_name(a) if ', ' in a else a
            for a in entry.get('aliases') or []
        ]
    atomic_write(ALIASES_FILE, aliases_data)

    print(f"\n✓ Uuendatud {len(to_fix)} kirjet")
    print(f"  {len(to_fix)} prosopograafia JSON faili")
    print(f"  {INDEX_FILE}")
    print(f"  {ALIASES_FILE}")


if __name__ == '__main__':
    main()
