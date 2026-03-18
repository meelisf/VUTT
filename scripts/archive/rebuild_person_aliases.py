#!/usr/bin/env python3
"""
Taastab state/person_aliases.json kõigist _metadata.json failidest.

Kogub kõik creators väliste ID-dega (wikidata, gnd, viaf),
grupeerib unikaalse ID järgi, tõmbab aliased Wikidatast/GND-st.

Käivitus:
    cd /home/meelisf/VUTT
    python3 scripts/rebuild_person_aliases.py [--dry-run] [--no-fetch]
"""

import json
import glob
import time
import sys
import os
import argparse
import urllib.request
import urllib.parse
from collections import defaultdict

BASE_DIR = '/home/meelisf/VUTT'
ALIASES_FILE = os.path.join(BASE_DIR, 'state', 'person_aliases.json')
DATA_GLOB = os.path.join(BASE_DIR, 'data', '**', '_metadata.json')

HEADERS = {
    'User-Agent': 'VUTT-Historical-Archive/1.0 (https://vutt.utlib.ut.ee; vutt@utlib.ut.ee)'
}


def invert_gnd_name(name):
    """GND 'Perenimi, Eesnimi' → 'Eesnimi Perenimi'."""
    if ', ' in name:
        parts = name.split(', ', 1)
        return f"{parts[1]} {parts[0]}"
    return name


def fetch_wikidata_aliases(wikidata_id):
    """Küsib Wikidatast aliased, primary_name, GND ja VIAF cross-ref-id."""
    url = f"https://www.wikidata.org/wiki/Special:EntityData/{wikidata_id}.json"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            entity = data.get('entities', {}).get(wikidata_id, {})

            aliases = []
            TARGET_LANGS = ['et', 'en', 'de', 'la', 'mul']

            for lang in TARGET_LANGS:
                for a in entity.get('aliases', {}).get(lang, []):
                    aliases.append(a.get('value'))
            for lang in TARGET_LANGS:
                lbl = entity.get('labels', {}).get(lang, {}).get('value')
                if lbl:
                    aliases.append(lbl)

            aliases = sorted(list(set(a for a in aliases if a)))

            ids = {'wikidata': wikidata_id}
            claims = entity.get('claims', {})
            gnd_claims = claims.get('P227', [])
            if gnd_claims:
                ids['gnd'] = gnd_claims[0].get('mainsnak', {}).get('datavalue', {}).get('value')
            viaf_claims = claims.get('P214', [])
            if viaf_claims:
                ids['viaf'] = viaf_claims[0].get('mainsnak', {}).get('datavalue', {}).get('value')

            primary_name = (
                entity.get('labels', {}).get('et', {}).get('value') or
                entity.get('labels', {}).get('en', {}).get('value') or
                entity.get('labels', {}).get('de', {}).get('value') or
                (aliases[0] if aliases else wikidata_id)
            )
            return {'primary_name': primary_name, 'aliases': aliases, 'ids': ids}
    except Exception as e:
        print(f"  [VIAG] Wikidata viga ({wikidata_id}): {e}", file=sys.stderr)
        return None


def fetch_gnd_aliases(raw_gnd_id):
    """Küsib GND-st aliased, primary_name, Wikidata ja VIAF cross-ref-id."""
    clean_id = raw_gnd_id.replace('GND:', '').replace('gnd:', '')
    url = f"https://lobid.org/gnd/{clean_id}.json"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))

            variants = data.get('variantName', [])
            if isinstance(variants, str):
                variants = [variants]
            aliases = sorted(list(set(v for v in variants if v)))

            primary_name = invert_gnd_name(data.get('preferredName', clean_id))
            ids = {'gnd': clean_id}
            for item in data.get('sameAs', []):
                id_url = item.get('id', '')
                if 'wikidata.org/entity/' in id_url:
                    ids['wikidata'] = id_url.split('/')[-1]
                elif 'viaf.org/viaf/' in id_url:
                    ids['viaf'] = id_url.split('/')[-1]

            return {'primary_name': primary_name, 'aliases': aliases, 'ids': ids}
    except Exception as e:
        print(f"  [GND] GND viga ({clean_id}): {e}", file=sys.stderr)
        return None


def collect_creators_from_metadata():
    """
    Loeb kõik _metadata.json failid ja kogub creators isikukaardid:
    Tagastab: { canonical_key → {'primary_name', 'aliases', 'ids', 'source'} }
    kus canonical_key on Wikidata Q-kood > GND number > VIAF number > raw id.
    Samuti tagastab name_variants: { canonical_key → set(nimevariandid _metadata.json-ist) }
    """
    files = glob.glob(DATA_GLOB, recursive=True)
    print(f"Leitud {len(files)} _metadata.json faili")

    # { canonical_key → {'source', 'raw_id', 'names': set} }
    by_id = {}

    for fpath in files:
        try:
            with open(fpath, encoding='utf-8') as f:
                meta = json.load(f)
        except Exception as e:
            print(f"  Viga {fpath}: {e}", file=sys.stderr)
            continue

        for creator in meta.get('creators', []):
            raw_id = (creator.get('id') or '').strip()
            source = (creator.get('source') or '').strip()
            name = (creator.get('name') or '').strip()

            if not raw_id or raw_id.startswith('vutt:'):
                continue  # ilma ID-ta või juba migreeritud

            # Normaliseeri canonical key
            if source == 'wikidata' or (raw_id.startswith('Q') and raw_id[1:].isdigit()):
                canonical = raw_id
                source = 'wikidata'
            elif source == 'gnd' or raw_id.upper().startswith('GND:'):
                canonical = raw_id.replace('GND:', '').replace('gnd:', '')
                source = 'gnd'
            elif source == 'viaf' or raw_id.upper().startswith('VIAF:'):
                canonical = raw_id.replace('VIAF:', '').replace('viaf:', '')
                source = 'viaf'
            elif source == 'album_academicum' or raw_id.startswith('AA:'):
                canonical = raw_id
                source = 'album_academicum'
            else:
                canonical = raw_id

            if canonical not in by_id:
                by_id[canonical] = {'source': source, 'raw_id': raw_id, 'names': set()}
            if name:
                by_id[canonical]['names'].add(name)

    return by_id


def build_person_aliases(by_id, fetch=True, sleep_secs=1.0):
    """
    Ehitab person_aliases dict-i.
    fetch=True: küsib aliased Wikidatast/GND-st.
    fetch=False: kasutab ainult _metadata.json nimesid.
    """
    result = {}
    total = len(by_id)

    # Sorteeri: wikidata esmalt (et saaksime cross-ref-id GND-le)
    def sort_key(item):
        src = item[1]['source']
        return 0 if src == 'wikidata' else (1 if src == 'gnd' else 2)

    items = sorted(by_id.items(), key=sort_key)

    for i, (canonical, info) in enumerate(items, 1):
        source = info['source']
        names = info['names']

        print(f"[{i}/{total}] {source}:{canonical} — {', '.join(list(names)[:2])}")

        fetched = None
        if fetch:
            if source == 'wikidata':
                fetched = fetch_wikidata_aliases(canonical)
                time.sleep(sleep_secs)
            elif source == 'gnd':
                # Kontrolli esmalt: äkki juba Wikidata kaudu sisse saanud
                already_in = any(
                    d.get('ids', {}).get('gnd') == canonical
                    for d in result.values()
                    if isinstance(d, dict) and 'primary_name' in d
                )
                if already_in:
                    print(f"  → juba olemas Wikidata kaudu, jätan vahele")
                    continue
                fetched = fetch_gnd_aliases(canonical)
                time.sleep(sleep_secs)
            elif source == 'viaf':
                # VIAF-il pole lihtsat JSON API-t — kasuta ainult _metadata andmeid
                fetched = None

        if fetched:
            # Ühenda _metadata nimevariandid fetched aliaste hulka
            all_aliases = set(fetched.get('aliases', []))
            all_aliases.update(names)
            fetched['aliases'] = sorted(all_aliases)
            entry = fetched
            print(f"  ✓ {entry['primary_name']} ({len(entry['aliases'])} aliast, ids: {list(entry['ids'].keys())})")
        else:
            # Fallback: kasuta _metadata andmeid
            names_list = sorted(names)
            primary = names_list[0] if names_list else canonical
            ids = {}
            if source == 'wikidata':
                ids['wikidata'] = canonical
            elif source == 'gnd':
                ids['gnd'] = canonical
            elif source == 'viaf':
                ids['viaf'] = canonical
            elif source == 'album_academicum':
                ids['album_academicum'] = canonical
            entry = {
                'primary_name': primary,
                'aliases': names_list,
                'ids': ids
            }
            print(f"  ~ (fetch puudus) {primary} — {names_list[:3]}")

        # Salvesta kõigi teadaolevate ID-de alla (cross-reference)
        for key_type, key_val in entry['ids'].items():
            if key_val:
                result[key_val] = entry

    return result


def main():
    parser = argparse.ArgumentParser(description='Taasta person_aliases.json _metadata.json failidest')
    parser.add_argument('--dry-run', action='store_true', help='Ära kirjuta faili, näita ainult statistikat')
    parser.add_argument('--no-fetch', action='store_true', help='Ära kutsu Wikidata/GND API-t')
    args = parser.parse_args()

    print("=== person_aliases.json taastamine ===\n")

    by_id = collect_creators_from_metadata()
    print(f"\nKokku unikaalseid välise ID-ga isikuid: {len(by_id)}")

    by_source = defaultdict(int)
    for info in by_id.values():
        by_source[info['source']] += 1
    for src, cnt in sorted(by_source.items()):
        print(f"  {src}: {cnt}")

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}{'[EI FETCHI] ' if args.no_fetch else ''}Alustab töötlemist...\n")

    result = build_person_aliases(by_id, fetch=not args.no_fetch)

    # Statistika
    unique_persons = len(set(
        json.dumps(v, sort_keys=True)
        for v in result.values()
        if isinstance(v, dict)
    ))
    print(f"\n{'─'*50}")
    print(f"Kokku kirjeid (key-id): {len(result)}")
    print(f"Unikaalseid isikuid: {unique_persons}")

    if args.dry_run:
        print("\n[DRY RUN] Faili ei kirjutata.")
        return

    # Atomic write
    tmp_path = ALIASES_FILE + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, ALIASES_FILE)
    print(f"\nSalvestatud: {ALIASES_FILE}")


if __name__ == '__main__':
    main()
