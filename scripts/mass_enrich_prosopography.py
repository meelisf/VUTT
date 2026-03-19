#!/usr/bin/env python3
"""
Massrikastamine: täidab kõigi prosopograafia kaartide tühjad väljad
Wikidatast ja GND-st.

Loogika:
  - Eelistab Wikidata (rohkem andmeid), siis GND
  - Rakendab ainult auto_filled (kohalik null → täida) — ei kirjuta üle olemasolevaid andmeid
  - Konflikte ei rakendata, logitakse ainult statistikas
  - Idempotentne: identifier.checked_at täidetud → jätab vahele

Rate limit: 2 sek WD SPARQL päringute vahel, 1 sek GND vahel.

Käivitus:
    cd /home/meelisf/VUTT
    python3 scripts/mass_enrich_prosopography.py [--dry-run] [--limit N]
"""

import json, glob, os, sys, argparse, time
from datetime import datetime, timezone

BASE_DIR = '/home/meelisf/VUTT'
PROSOPO_DIR = os.path.join(BASE_DIR, 'state', 'prosopography')
INDEX_FILE = os.path.join(BASE_DIR, 'state', 'prosopography_index.json')
ALIASES_FILE = os.path.join(BASE_DIR, 'state', 'person_aliases.json')

sys.path.insert(0, BASE_DIR)
# Impordi ainult enrichment ja ops — ei lähe läbi server/__init__.py
import importlib.util

def _load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

enrichment = _load_module('enrichment', os.path.join(BASE_DIR, 'server/prosopography/enrichment.py'))
fetch_and_diff = enrichment.fetch_and_diff


def atomic_write(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _deep_set(obj, path, value):
    parts = path.split('.', 1)
    if len(parts) == 1:
        obj[parts[0]] = value
    else:
        if parts[0] not in obj or not isinstance(obj[parts[0]], dict):
            obj[parts[0]] = {}
        _deep_set(obj[parts[0]], parts[1], value)


def apply_auto_filled(person, auto_filled, scheme, dry_run=False):
    """Rakendab auto_filled väljad isikule. Tagastab muudetud väljade arvu."""
    if not auto_filled:
        return 0
    if not dry_run:
        for field_path, value in auto_filled.items():
            if field_path == '_enrichment_scheme':
                continue
            _deep_set(person, field_path, value)
        # Märgi checked_at
        for ident in person.get('identifiers') or []:
            if ident.get('scheme') == scheme:
                ident['checked_at'] = datetime.now(timezone.utc).date().isoformat()
        now = datetime.now(timezone.utc).isoformat()
        person['updated_at'] = now
        person['updated_by'] = 'mass_enrich_script'
    return len([k for k in auto_filled if k != '_enrichment_scheme'])


def update_index_entry(person):
    """Uuendab prosopography_index.json ühe isiku kirjet."""
    if not os.path.exists(INDEX_FILE):
        return
    index_data = json.load(open(INDEX_FILE, encoding='utf-8'))
    pid = person['id']
    birth = person.get('birth') or {}
    death = person.get('death') or {}
    name_obj = person.get('name') or {}
    label = name_obj.get('label') or pid
    family_name = name_obj.get('family_name') or ''
    first_name = name_obj.get('first_name') or ''
    sort_name = f"{family_name}, {first_name}".strip(', ') if family_name else label
    identifiers = person.get('identifiers') or []
    schemes = {i.get('scheme') for i in identifiers}
    status_obj = person.get('status') or {}
    confession_obj = person.get('confession') or {}

    def _year(d):
        date_str = d.get('date') if isinstance(d, dict) else None
        if date_str:
            try: return int(str(date_str)[:4])
            except: pass
        return None

    for entry in index_data.get('entries', []):
        if entry['id'] == pid:
            entry['label'] = label
            entry['sort_name'] = sort_name
            entry['birth_year'] = _year(birth)
            entry['death_year'] = _year(death)
            entry['gender'] = person.get('gender')
            entry['status_id'] = status_obj.get('id') if status_obj else None
            entry['status_label'] = status_obj.get('label') if status_obj else None
            entry['confession_id'] = confession_obj.get('id') if confession_obj else None
            entry['has_wikidata'] = 'wikidata' in schemes
            entry['has_gnd'] = 'gnd' in schemes
            entry['has_aa'] = 'album_academicum' in schemes
            break

    index_data['rebuilt_at'] = datetime.now(timezone.utc).isoformat()
    atomic_write(INDEX_FILE, index_data)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='Ära kirjuta, näita statistikat')
    parser.add_argument('--limit', type=int, default=0, help='Töötle max N isikut')
    parser.add_argument('--force', action='store_true', help='Töötle ka juba checked_at-ga kirjed')
    args = parser.parse_args()

    print("=== Prosopograafia massrikastamine ===\n")

    files = sorted(glob.glob(os.path.join(PROSOPO_DIR, '*.json')))
    files = [f for f in files if 'images' not in f]
    print(f"Prosopograafia kirjeid: {len(files)}")

    stats = {'wd_ok': 0, 'wd_skip': 0, 'wd_err': 0,
             'gnd_ok': 0, 'gnd_skip': 0, 'gnd_err': 0,
             'fields_filled': 0, 'conflicts': 0}

    processed = 0

    for fpath in files:
        if args.limit and processed >= args.limit:
            break

        try:
            person = json.load(open(fpath, encoding='utf-8'))
        except Exception as e:
            print(f"Viga {fpath}: {e}", file=sys.stderr)
            continue

        if person.get('record_status') == 'tombstone':
            continue

        pid = person['id']
        label = person.get('name', {}).get('label', pid)
        identifiers = {i['scheme']: i for i in person.get('identifiers') or []}

        wd_ident = identifiers.get('wikidata')
        gnd_ident = identifiers.get('gnd')

        did_something = False

        # --- Wikidata ---
        if wd_ident:
            already_checked = wd_ident.get('checked_at') and not args.force
            if already_checked:
                stats['wd_skip'] += 1
            else:
                qid = wd_ident['id']
                print(f"WD {qid:15} {label}")
                try:
                    result = fetch_and_diff('wikidata', qid, person)
                    auto_filled = result.get('auto_filled', {})
                    n_conflicts = len(result.get('conflicts', []))
                    n_filled = apply_auto_filled(person, auto_filled, 'wikidata', args.dry_run)
                    stats['fields_filled'] += n_filled
                    stats['conflicts'] += n_conflicts
                    stats['wd_ok'] += 1
                    did_something = True
                    if n_filled or n_conflicts:
                        print(f"  → {n_filled} välja täidetud, {n_conflicts} konflikti")
                    else:
                        print(f"  → midagi uut pole")
                except Exception as e:
                    print(f"  ! Viga: {e}", file=sys.stderr)
                    stats['wd_err'] += 1
                time.sleep(2)

        # --- GND (ainult kui Wikidata ei andnud GND cross-ref) ---
        if gnd_ident:
            already_checked = gnd_ident.get('checked_at') and not args.force
            # Kui Wikidata juba lisas GND cross-ref, märgi checked
            wd_added_gnd = (wd_ident and wd_ident.get('checked_at') and
                            not already_checked and not args.dry_run)
            if already_checked:
                stats['gnd_skip'] += 1
            elif wd_added_gnd:
                # Wikidata kaudu juba töödeldud — märgi GND ka checked
                if not args.dry_run:
                    gnd_ident['checked_at'] = datetime.now(timezone.utc).date().isoformat()
                stats['gnd_skip'] += 1
            else:
                gnd_id = gnd_ident['id']
                print(f"GND {gnd_id:15} {label}")
                try:
                    result = fetch_and_diff('gnd', gnd_id, person)
                    auto_filled = result.get('auto_filled', {})
                    n_conflicts = len(result.get('conflicts', []))
                    n_filled = apply_auto_filled(person, auto_filled, 'gnd', args.dry_run)
                    stats['fields_filled'] += n_filled
                    stats['conflicts'] += n_conflicts
                    stats['gnd_ok'] += 1
                    did_something = True
                    if n_filled or n_conflicts:
                        print(f"  → {n_filled} välja täidetud, {n_conflicts} konflikti")
                    else:
                        print(f"  → midagi uut pole")
                except Exception as e:
                    print(f"  ! Viga: {e}", file=sys.stderr)
                    stats['gnd_err'] += 1
                time.sleep(1)

        # Salvesta kui midagi muutus
        if did_something and not args.dry_run:
            atomic_write(fpath, person)
            update_index_entry(person)

        if did_something:
            processed += 1

    print(f"\n{'═'*50}")
    print(f"Wikidata:  {stats['wd_ok']} töödeldud, {stats['wd_skip']} vahele, {stats['wd_err']} viga")
    print(f"GND:       {stats['gnd_ok']} töödeldud, {stats['gnd_skip']} vahele, {stats['gnd_err']} viga")
    print(f"Väljad täidetud kokku: {stats['fields_filled']}")
    print(f"Konfliktid (logitud, ei rakendatud): {stats['conflicts']}")
    if args.dry_run:
        print("\n[DRY RUN] Midagi ei kirjutatud.")


if __name__ == '__main__':
    main()
