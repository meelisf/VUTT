#!/usr/bin/env python3
"""
Kahe prosopograafia kirje ühendamine.

Käivitus:
    python3 scripts/merge_persons.py --source vutt:Pold123 --target vutt:Pnew456
    python3 scripts/merge_persons.py --source vutt:Pold123 --target vutt:Pnew456 --dry-run

Toimingud:
  1. Source kirje → record_status=tombstone, merged_into=target_id
  2. Relations teistes kirjetes: target_id vanad viited → uuendatakse
  3. rebuild_indices() — taastab prosopography_index, person_aliases, person_to_works

Eeldus: skript käivitatakse serveris (cd ~/VUTT).
"""

import json, glob, os, sys, argparse
from datetime import datetime, timezone

BASE_DIR = '/home/meelisf/VUTT'
PROSOPO_DIR = os.path.join(BASE_DIR, 'state', 'prosopography')


def atomic_write(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def load_person(vutt_id):
    """Laeb isiku JSON faili. Tagastab (fpath, data) või (None, None)."""
    nanoid = vutt_id.replace('vutt:P', '')
    fpath = os.path.join(PROSOPO_DIR, f'{nanoid}.json')
    if not os.path.exists(fpath):
        return None, None
    try:
        return fpath, json.load(open(fpath, encoding='utf-8'))
    except Exception as e:
        print(f'! Viga faili lugemisel {fpath}: {e}', file=sys.stderr)
        return None, None


def load_all_persons():
    """Laeb kõik prosopo kirjed. Tagastab {vutt_id: (fpath, data)}."""
    result = {}
    for fpath in glob.glob(os.path.join(PROSOPO_DIR, '*.json')):
        if 'images' in fpath:
            continue
        try:
            p = json.load(open(fpath, encoding='utf-8'))
            result[p['id']] = (fpath, p)
        except Exception:
            pass
    return result


def call_rebuild_indices():
    """Kutsub rebuild_indices() otse backend ops.py-st."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        'ops', os.path.join(BASE_DIR, 'server/prosopography/ops.py'))
    ops = importlib.util.module_from_spec(spec)
    # ops.py impordib config.py-st BASE_DIR — patchime sys.path
    sys.path.insert(0, BASE_DIR)
    try:
        spec.loader.exec_module(ops)
        ops.rebuild_indices()
    finally:
        sys.path.pop(0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, help='Liidendatav (vana) vutt:P ID')
    parser.add_argument('--target', required=True, help='Säilitatav vutt:P ID')
    parser.add_argument('--dry-run', action='store_true', help='Ära kirjuta')
    args = parser.parse_args()

    src_id = args.source.strip()
    tgt_id = args.target.strip()

    if src_id == tgt_id:
        print('! Source ja target on samad ID-d.', file=sys.stderr)
        sys.exit(1)

    if not src_id.startswith('vutt:P') or not tgt_id.startswith('vutt:P'):
        print('! Mõlemad ID-d peavad algama "vutt:P"', file=sys.stderr)
        sys.exit(1)

    src_fpath, src = load_person(src_id)
    tgt_fpath, tgt = load_person(tgt_id)

    if src is None:
        print(f'! Source {src_id} ei leitud prosopograafias.', file=sys.stderr)
        sys.exit(1)
    if tgt is None:
        print(f'! Target {tgt_id} ei leitud prosopograafias.', file=sys.stderr)
        sys.exit(1)

    if src.get('record_status') == 'tombstone':
        print(f'! {src_id} on juba tombstone (merged_into: {src.get("merged_into")}).', file=sys.stderr)
        sys.exit(1)
    if tgt.get('record_status') == 'tombstone':
        print(f'! Target {tgt_id} on tombstone — ei saa sellega liita.', file=sys.stderr)
        sys.exit(1)

    # --- Kuva kokkuvõte ---
    print('=== Prosopograafia kirjete liitmine ===\n')
    print(f'  SOURCE (liidendatav):  {src_id}')
    print(f'    Nimi:   {src["name"].get("label")}')
    print(f'    Status: {src.get("record_status")}')
    idents_src = [f'{i["scheme"]}:{i["id"]}' for i in src.get('identifiers', [])]
    if idents_src:
        print(f'    IDs:    {", ".join(idents_src)}')
    print()
    print(f'  TARGET (säilitatav):   {tgt_id}')
    print(f'    Nimi:   {tgt["name"].get("label")}')
    print(f'    Status: {tgt.get("record_status")}')
    idents_tgt = [f'{i["scheme"]}:{i["id"]}' for i in tgt.get('identifiers', [])]
    if idents_tgt:
        print(f'    IDs:    {", ".join(idents_tgt)}')
    print()

    # --- Leia relations mis viitavad source-le ---
    all_persons = load_all_persons()
    refs_in = []
    for pid, (fpath, p) in all_persons.items():
        if p.get('record_status') == 'tombstone':
            continue
        if pid in (src_id, tgt_id):
            continue
        for rel in p.get('relations', []):
            if rel.get('target_id') == src_id:
                refs_in.append((pid, p['name'].get('label', pid), fpath, p))
                break

    if refs_in:
        print(f'  Relations mis viitavad source-le ({len(refs_in)} isikut):')
        for pid, label, _, _ in refs_in:
            print(f'    {pid} {label}')
        print()

    print('Toimingud:')
    print(f'  1. {src_id} → record_status=tombstone, merged_into={tgt_id}')
    if refs_in:
        print(f'  2. {len(refs_in)} isiku relations uuendatakse: {src_id} → {tgt_id}')
    print(f'  {2 + bool(refs_in)}. rebuild_indices() — prosopography_index, person_aliases, person_to_works')

    if args.dry_run:
        print('\n[DRY RUN] Midagi ei kirjutata.')
        return

    print()
    confirm = input('Jätka? (j/N): ').strip().lower()
    if confirm not in ('j', 'jah', 'y', 'yes'):
        print('Katkestatud.')
        return

    now = datetime.now(timezone.utc).isoformat()

    # --- 1. Source → tombstone ---
    src['record_status'] = 'tombstone'
    src['merged_into'] = tgt_id
    src['updated_at'] = now
    src['updated_by'] = 'merge_persons_script'
    atomic_write(src_fpath, src)
    print(f'  ✓ {src_id} → tombstone')

    # --- 2. Uuenda relations teistes kirjetes ---
    for pid, label, fpath, p in refs_in:
        for rel in p.get('relations', []):
            if rel.get('target_id') == src_id:
                rel['target_id'] = tgt_id
        p['updated_at'] = now
        p['updated_by'] = 'merge_persons_script'
        atomic_write(fpath, p)
        print(f'  ✓ {pid} ({label}) relations uuendatud')

    # --- 3. Rebuild indices ---
    print('  Käivitan rebuild_indices()...')
    try:
        call_rebuild_indices()
        print('  ✓ Indeksid taastatud')
    except Exception as e:
        print(f'  ! rebuild_indices viga: {e}', file=sys.stderr)
        print('  Käivita käsitsi: docker exec vutt-backend python3 -c "from server.prosopography.ops import rebuild_indices; rebuild_indices()"')

    print(f'\n✓ Liitmine valmis: {src_id} → {tgt_id}')


if __name__ == '__main__':
    main()
