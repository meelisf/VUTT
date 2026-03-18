#!/usr/bin/env python3
"""
Migratsioon: publisher → vutt:P koodid kõigis _metadata.json failides.

Loogika:
  1. Laeb kõik olemasolevad prosopo kaardid → {(scheme, id): vutt_id}
  2. Publisher'il on wikidata Q-kood → otsib prosopo kaardi; kui pole, loob uue
  3. Publisher'il pole ID-d → grupeerib nime järgi; loob ühe kaardi nime-grupi kohta
  4. Uuendab kõik data/*/_metadata.json: publisher.id = vutt:Pxxx, publisher.source = "local"
  5. Käivitab rebuild_indices()

Idempotentne: kui publisher.id algab juba "vutt:P" → jätab vahele.

Käivitus:
    cd /home/meelisf/VUTT
    python3 scripts/migrate_publisher_to_vutt_ids.py --dry-run
    python3 scripts/migrate_publisher_to_vutt_ids.py
"""

import json, glob, os, sys, argparse, secrets, string
from datetime import datetime, timezone
from collections import defaultdict
from urllib.parse import unquote

BASE_DIR = '/home/meelisf/VUTT'
PROSOPO_DIR = os.path.join(BASE_DIR, 'state', 'prosopography')
DATA_DIR = BASE_DIR

BATCH_ID = 'vutt-publisher-migration-2026'
ALPHA = string.ascii_lowercase + string.digits

# Teadaolevad kaardistused: (scheme, ext_id) → vutt_id
# Need on prioriteetsed — prosopo kaarte ei looda uuesti
KNOWN_MAPPINGS = {
    ('wikidata', 'Q60534366'): 'vutt:P82rja6',  # Johann Vogel
    ('wikidata', 'Q57556219'): 'vutt:Ptbc4f4',  # Jakob Becker
}


def nanoid():
    return ''.join(secrets.choice(ALPHA) for _ in range(6))


def atomic_write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def normalize_name(name: str) -> str:
    return name.strip().lower()


def load_existing_prosopo():
    """Laeb kõik prosopo kaardid.
    Tagastab:
      - ident_to_vutt: {(scheme, ext_id): vutt_id}
      - all_persons: {vutt_id: (fpath, data)}
    """
    ident_to_vutt = {}
    all_persons = {}
    for fpath in glob.glob(os.path.join(PROSOPO_DIR, '*.json')):
        if 'images' in fpath:
            continue
        try:
            p = json.load(open(fpath, encoding='utf-8'))
        except Exception:
            continue
        vid = p.get('id', '')
        if not vid:
            continue
        all_persons[vid] = (fpath, p)
        for ident in p.get('identifiers', []):
            scheme = ident.get('scheme', '')
            ext_id = ident.get('id', '')
            if scheme and ext_id:
                ident_to_vutt[(scheme, ext_id)] = vid
    return ident_to_vutt, all_persons


def make_minimal_person(nid, label, identifiers, now):
    return {
        'id': f'vutt:P{nid}',
        'identifiers': identifiers,
        'merged_into': None,
        'import_batch_ids': [BATCH_ID],
        'schema_version': 1,
        'record_status': 'draft',
        'verification_level': 'draft',
        'created_at': now,
        'updated_at': now,
        'created_by': 'migration_script',
        'updated_by': 'migration_script',
        'name': {
            'label': label,
            'family_name': None, 'first_name': None, 'qualifier': None,
            'qualifier_type': None, 'noble_status': None, 'maiden_name': None,
            'aliases': [], 'family_name_variants': [], 'first_name_variants': [],
        },
        'gender': None,
        'birth': {'original_text': None, 'date': None, 'date_to': None, 'bound': None,
                  'precision': None, 'calendar': None, 'is_circa': False, 'place': None, 'notes': None},
        'death': {'original_text': None, 'date': None, 'date_to': None, 'bound': None,
                  'precision': None, 'calendar': None, 'is_circa': False, 'place': None, 'notes': None},
        'origin': {'city': None, 'city_id': None, 'city_labels': None,
                   'region': None, 'region_id': None, 'region_labels': None,
                   'geonames_id': None, 'coordinates': None},
        'status': None, 'confession': None, 'occupations': [], 'education': [],
        'burial': None, 'relations': [], 'sources': [], 'biography': None,
        'notes': None, 'image_url': None, 'source_data': {}, 'floruit': None, 'tags': [],
    }


def call_rebuild_indices():
    import importlib.util
    sys.path.insert(0, BASE_DIR)
    try:
        spec = importlib.util.spec_from_file_location(
            'ops', os.path.join(BASE_DIR, 'server/prosopography/ops.py'))
        ops = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ops)
        ops.rebuild_indices()
    finally:
        sys.path.pop(0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    print('=== Migratsioon: publisher → vutt:P koodid ===\n')

    now = datetime.now(timezone.utc).isoformat()

    # --- Laeb olemasolevad prosopo kaardid ---
    ident_to_vutt, all_persons = load_existing_prosopo()
    print(f'Olemasolevaid prosopo kaarte: {len(all_persons)}')
    print(f'Olemasolevaid identifikaatoreid: {len(ident_to_vutt)}\n')

    # --- Laeb kõik _metadata.json ---
    meta_files = sorted(glob.glob(os.path.join(DATA_DIR, 'data', '*', '_metadata.json')))
    print(f'Teoste _metadata.json faile: {len(meta_files)}\n')

    # --- Pass 1: kogu kõik publisherid, ehita kaardistused ---
    # Välise ID-ga: (scheme, ext_id) → name_counts
    ext_id_groups = {}
    # Ilma ID-ta: norm_name → name_counts
    name_groups = {}

    pub_count = 0
    already_vutt = 0
    skipped_no_data = 0

    for meta_f in meta_files:
        try:
            meta = json.load(open(meta_f, encoding='utf-8'))
        except Exception as e:
            print(f'! Viga {meta_f}: {e}', file=sys.stderr)
            continue

        pub = meta.get('publisher')
        if not pub:
            continue

        # publisher on LinkedEntity objekt
        if isinstance(pub, str):
            # vana formaat — string
            name = pub.strip()
            pub_id = ''
            src = ''
        else:
            pub_id = unquote((pub.get('id') or '').strip())
            src = (pub.get('source') or '').strip()
            name = (pub.get('label') or '').strip()

        pub_count += 1

        if pub_id.startswith('vutt:P'):
            already_vutt += 1
            continue

        if pub_id:
            scheme = src if src else 'wikidata'
            key = (scheme, pub_id)
            if key not in ext_id_groups:
                ext_id_groups[key] = defaultdict(int)
            if name:
                ext_id_groups[key][name] += 1
        else:
            if not name:
                skipped_no_data += 1
                continue
            norm = normalize_name(name)
            if norm not in name_groups:
                name_groups[norm] = defaultdict(int)
            name_groups[norm][name] += 1

    print(f'Kokku publisher kirjeid: {pub_count}')
    print(f'Juba vutt:P ID-ga: {already_vutt}')
    print(f'Välise ID-ga gruppe: {len(ext_id_groups)}')
    print(f'Ilma ID-ta nime-gruppe: {len(name_groups)}')
    if skipped_no_data:
        print(f'Vahele jäetud (ei nime ega ID): {skipped_no_data}')
    print()

    # --- Pass 2: loo puuduvad prosopo kaardid ---
    ext_to_vutt = dict(ident_to_vutt)
    ext_to_vutt.update(KNOWN_MAPPINGS)  # teadaolevad kaardistused on prioriteetsed
    norm_to_vutt = {}

    # Täida norm_to_vutt olemasolevate kaartide nimedega
    for vid, (_, p) in all_persons.items():
        label = p.get('name', {}).get('label', '')
        if label:
            norm_to_vutt[normalize_name(label)] = vid
        for alias in p.get('name', {}).get('aliases', []):
            if alias:
                norm_to_vutt[normalize_name(alias)] = vid

    created_ext = 0
    created_name = 0

    for (scheme, ext_id), name_counts in ext_id_groups.items():
        if (scheme, ext_id) in ext_to_vutt:
            continue

        label = max(name_counts, key=name_counts.get) if name_counts else ext_id
        nid = nanoid()
        vid = f'vutt:P{nid}'

        print(f'  Loo kaart: {vid} — "{label}" ({scheme}:{ext_id})')

        if not args.dry_run:
            person = make_minimal_person(nid, label, [{'scheme': scheme, 'id': ext_id, 'checked_at': None}], now)
            aliases = [n for n in name_counts if n != label]
            person['name']['aliases'] = aliases
            fpath = os.path.join(PROSOPO_DIR, f'{nid}.json')
            atomic_write(fpath, person)
            all_persons[vid] = (fpath, person)

        ext_to_vutt[(scheme, ext_id)] = vid
        created_ext += 1

    for norm, name_counts in name_groups.items():
        if norm in norm_to_vutt:
            continue

        label = max(name_counts, key=name_counts.get)
        nid = nanoid()
        vid = f'vutt:P{nid}'

        print(f'  Loo kaart (nimepõhine): {vid} — "{label}"')

        if not args.dry_run:
            person = make_minimal_person(nid, label, [], now)
            aliases = [n for n in name_counts if n != label]
            person['name']['aliases'] = aliases
            fpath = os.path.join(PROSOPO_DIR, f'{nid}.json')
            atomic_write(fpath, person)
            all_persons[vid] = (fpath, person)

        norm_to_vutt[norm] = vid
        created_name += 1

    print(f'\nLoodud uusi prosopo kaarte:')
    print(f'  välise ID-ga: {created_ext}')
    print(f'  nime järgi:   {created_name}')
    print()

    # --- Pass 3: uuenda _metadata.json ---
    updated_files = 0
    unresolved = []

    for meta_f in meta_files:
        try:
            meta = json.load(open(meta_f, encoding='utf-8'))
        except Exception:
            continue

        pub = meta.get('publisher')
        if not pub:
            continue

        if isinstance(pub, str):
            pub_id = ''
            src = ''
            name = pub.strip()
        else:
            pub_id = unquote((pub.get('id') or '').strip())
            src = (pub.get('source') or '').strip()
            name = (pub.get('label') or '').strip()

        if pub_id.startswith('vutt:P'):
            continue

        vutt_id = None

        if pub_id:
            scheme = src if src else 'wikidata'
            vutt_id = ext_to_vutt.get((scheme, pub_id))
        else:
            norm = normalize_name(name) if name else ''
            if norm:
                vutt_id = norm_to_vutt.get(norm)

        if vutt_id:
            if not args.dry_run:
                if isinstance(meta['publisher'], str):
                    meta['publisher'] = {'label': name, 'id': vutt_id, 'source': 'local'}
                else:
                    meta['publisher']['id'] = vutt_id
                    meta['publisher']['source'] = 'local'
                # publisher_id väli (kui on) — eemalda, on vananenud
                meta.pop('publisher_id', None)
                atomic_write(meta_f, meta)
            updated_files += 1
        else:
            unresolved.append({'file': meta_f, 'name': name, 'id': pub_id, 'source': src})

    print(f'Uuendatud _metadata.json faile: {updated_files}')

    if unresolved:
        print(f'\n! Lahendamata ({len(unresolved)}):')
        for u in unresolved:
            print(f'  {u["file"]}: name="{u["name"]}" id="{u["id"]}"')

    if args.dry_run:
        print('\n[DRY RUN] Midagi ei kirjutatud.')
        return

    # --- Pass 4: rebuild_indices ---
    print('\nKäivitan rebuild_indices()...')
    try:
        call_rebuild_indices()
        print('✓ Indeksid taastatud')
    except Exception as e:
        print(f'! rebuild_indices viga: {e}', file=sys.stderr)
        print('Käivita käsitsi Dockeris:')
        print('  docker exec vutt-backend python3 -c "from server.prosopography.ops import rebuild_indices; rebuild_indices()"')

    print(f'\n✓ Migratsioon lõpetatud.')
    print(f'Järgmine samm: python3 scripts/sync_meilisearch.py')


if __name__ == '__main__':
    main()
