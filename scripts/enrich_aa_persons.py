#!/usr/bin/env python3
"""
AA rikastamine prosopograafia kaartidele.

Režiimid:
  (vaikimisi)   — rikastab 74 olemasolevat AA kaarti album_academicum.json-ist
  --match       — leiab AA isikud kes on prosopograafias VIAF/WD kaudu aga ilma AA numbrita,
                  kirjutab review faili state/aa_match_review.json
  --apply-matches — rakendab kinnitatud matchid (state/aa_match_review.json confirmed:true kirjed)

Käivitus:
    cd /home/meelisf/VUTT
    python3 scripts/enrich_aa_persons.py
    python3 scripts/enrich_aa_persons.py --match
    python3 scripts/enrich_aa_persons.py --apply-matches
    python3 scripts/enrich_aa_persons.py [--dry-run]
"""

import json, glob, os, sys, argparse
from datetime import datetime, timezone

BASE_DIR = '/home/meelisf/VUTT'
PROSOPO_DIR = os.path.join(BASE_DIR, 'state', 'prosopography')
INDEX_FILE = os.path.join(BASE_DIR, 'state', 'prosopography_index.json')
AA_FILE = os.path.join(BASE_DIR, 'reference_data', 'album_academicum.json')
REVIEW_FILE = os.path.join(BASE_DIR, 'state', 'aa_match_review.json')

BATCH_ID = 'aa-enrich-2026'


def atomic_write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def load_aa_by_number():
    data = json.load(open(AA_FILE, encoding='utf-8'))
    return {e['entry_number']: e for e in data if e.get('entry_number')}


def load_all_prosopo():
    result = {}
    for f in glob.glob(os.path.join(PROSOPO_DIR, '*.json')):
        if 'images' in f:
            continue
        try:
            p = json.load(open(f, encoding='utf-8'))
            result[p['id']] = (f, p)
        except Exception:
            pass
    return result


def make_date_obj(date_str):
    if not date_str:
        return None
    s = str(date_str).strip()
    precision = 'year' if len(s) <= 4 else ('month' if len(s) <= 7 else 'day')
    return {
        'original_text': s,
        'date': s,
        'date_to': None,
        'bound': None,
        'precision': precision,
        'calendar': None,
        'is_circa': False,
        'place': None,
        'notes': None,
    }


def aa_num_to_vutt_id(aa_num, all_prosopo):
    """Leiab vutt:P ID AA numbri järgi prosopograafiast."""
    target = f"AA:{aa_num}"
    for pid, (_, p) in all_prosopo.items():
        for ident in p.get('identifiers', []):
            if ident.get('scheme') == 'album_academicum' and ident.get('id') == target:
                return pid
    return None


def _build_aliases(name_obj):
    """Ehitab name.aliases loendi family/first_name_variants-ist."""
    family_name = name_obj.get('family_name') or ''
    first_name = name_obj.get('first_name') or ''
    aliases = []
    for fv in (name_obj.get('family_name_variants') or []):
        s = f"{first_name} {fv}".strip()
        if s:
            aliases.append(s)
    for fn_v in (name_obj.get('first_name_variants') or []):
        s = f"{fn_v} {family_name}".strip()
        if s:
            aliases.append(s)
    return aliases


def enrich_one(person, aa_entry, dry_run=False):
    """
    Rikastab ühe prosopograafia kirje AA andmetega.
    Täidab ainult tühjad väljad (ei kirjuta üle).
    Tagastab muudetud väljade arvu.
    """
    changed = 0
    pdata = aa_entry['person']

    def set_if_empty(obj, key, value):
        nonlocal changed
        if value is not None and value != '' and not obj.get(key):
            if not dry_run:
                obj[key] = value
            changed += 1

    # --- Nimi ---
    name_src = pdata.get('name') or {}
    name = person.setdefault('name', {})
    set_if_empty(name, 'family_name', name_src.get('family_name'))
    set_if_empty(name, 'first_name', name_src.get('first_name'))
    if name_src.get('family_name_variants') and not name.get('family_name_variants'):
        if not dry_run:
            name['family_name_variants'] = name_src['family_name_variants']
        changed += 1
    if name_src.get('first_name_variants') and not name.get('first_name_variants'):
        if not dry_run:
            name['first_name_variants'] = name_src['first_name_variants']
        changed += 1
    noble = name_src.get('noble_status') or name_src.get('noble_title')
    set_if_empty(name, 'noble_status', noble)

    # name.aliases — ehita variantidest (kasutatakse otsingualiaste jaoks)
    if not name.get('aliases'):
        aliases = _build_aliases(name_src)
        if aliases:
            if not dry_run:
                name['aliases'] = aliases
            changed += 1

    # --- Sünd ---
    birth_date = pdata.get('birth', {}).get('date')
    birth = person.get('birth') or {}
    if birth_date and not birth.get('date'):
        if not dry_run:
            person['birth'] = make_date_obj(birth_date)
        changed += 1

    # --- Surm ---
    death_date = pdata.get('death', {}).get('date')
    death = person.get('death') or {}
    if death_date and not death.get('date'):
        if not dry_run:
            person['death'] = make_date_obj(death_date)
        changed += 1

    # --- Päritolu (origin — eraldi väli: linn, regioon, koordinaadid) ---
    origin_data = pdata.get('origin') or {}
    origin = person.setdefault('origin', {})
    set_if_empty(origin, 'city', origin_data.get('city'))
    region = origin_data.get('standardized_region') or origin_data.get('region')
    set_if_empty(origin, 'region', region)
    if origin_data.get('geonames_id') and not origin.get('geonames_id'):
        if not dry_run:
            origin['geonames_id'] = str(origin_data['geonames_id'])
        changed += 1

    # birth.place — seada regionist kui sünnikoht puudub (LinkedEntity formaat, nagu server teeb)
    birth = person.get('birth') or {}
    if region and isinstance(birth, dict) and not birth.get('place'):
        if not dry_run:
            if not person.get('birth'):
                person['birth'] = make_date_obj(None)
            person['birth']['place'] = {'id': None, 'label': region}
        changed += 1

    # --- Biograafia (raw_text) ---
    raw_text = (aa_entry.get('raw_text') or '').strip()
    if raw_text and not person.get('biography'):
        if not dry_run:
            person['biography'] = raw_text
        changed += 1

    # --- Haridus (studies → education) ---
    if aa_entry.get('studies') and not person.get('education'):
        edu = []
        for s in aa_entry['studies']:
            if s.get('institution'):
                entry = {
                    'institution': s['institution'],
                    'institution_id': None,
                    'type': s.get('type'),
                    'date_start': s.get('date') or s.get('arrival_date'),
                    'date_end': s.get('end_date'),
                    'degree': s.get('degree'),
                    'subject': s.get('subject'),
                    'notes': s.get('notes'),
                    'source': 'album_academicum',
                }
                edu.append(entry)
        if edu:
            if not dry_run:
                person['education'] = edu
            changed += 1

    # --- Hilisem karjäär (later_career → occupations) ---
    if aa_entry.get('later_career') and not person.get('occupations'):
        occs = []
        for lc in aa_entry['later_career']:
            role = lc.get('role')
            if role:
                occs.append({
                    'label': role,
                    'id': None,
                    'labels': {},
                    'date_start': lc.get('start_date') or lc.get('appointment_date'),
                    'date_end': lc.get('end_date'),
                    'institution': lc.get('institution'),
                    'notes': lc.get('notes'),
                    'source': 'album_academicum',
                })
        if occs:
            if not dry_run:
                person['occupations'] = occs
            changed += 1

    # --- Suhted (relations — AA numbrid → vutt:P ID-d kui võimalik) ---
    if pdata.get('relations') and not person.get('relations'):
        rels = []
        for r in pdata['relations']:
            ref = r.get('reference', '')
            # Nr. 1377 → 1377
            aa_ref_num = None
            if ref.startswith('Nr.'):
                try:
                    aa_ref_num = int(ref.replace('Nr.', '').strip())
                except ValueError:
                    pass
            rels.append({
                'name': ref,
                'type': r.get('type'),
                'target_id': f"AA:{aa_ref_num}" if aa_ref_num else None,
                'notes': r.get('notes'),
            })
        if rels:
            if not dry_run:
                person['relations'] = rels
            changed += 1

    # --- Akadeemia tegevus source_data-sse ---
    act = aa_entry.get('academia_gustaviana_activity', {})
    total_act = sum(len(act.get(k, [])) for k in
                    ['orations', 'gratulations', 'disputations', 'academic_ceremonies', 'positions'])
    if total_act > 0 and not person.get('source_data', {}).get('album_academicum'):
        if not dry_run:
            person.setdefault('source_data', {})['album_academicum'] = act
        changed += 1

    return changed


def update_index_entry(person):
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

    def _year(d):
        s = d.get('date') if isinstance(d, dict) else None
        try: return int(str(s)[:4]) if s else None
        except: return None

    for entry in index_data.get('entries', []):
        if entry['id'] == pid:
            entry['label'] = label
            entry['sort_name'] = sort_name
            entry['birth_year'] = _year(birth)
            entry['death_year'] = _year(death)
            break
    index_data['rebuilt_at'] = datetime.now(timezone.utc).isoformat()
    atomic_write(INDEX_FILE, index_data)


# =========================================================
# REŽIIM 1: rikasta 74 olemasolevat AA kaarti
# =========================================================

def cmd_enrich(dry_run):
    aa_by_num = load_aa_by_number()
    all_prosopo = load_all_prosopo()
    now = datetime.now(timezone.utc).isoformat()

    enriched = 0
    skipped = 0

    for pid, (fpath, person) in all_prosopo.items():
        if person.get('record_status') == 'tombstone':
            continue
        aa_ident = next((i for i in person.get('identifiers', [])
                         if i.get('scheme') == 'album_academicum'), None)
        if not aa_ident:
            continue

        if BATCH_ID in person.get('import_batch_ids', []):
            skipped += 1
            continue

        raw_id = aa_ident.get('id', '')
        try:
            aa_num = int(raw_id.replace('AA:', ''))
        except ValueError:
            print(f"  ! Vigane AA ID: {raw_id}", file=sys.stderr)
            continue

        aa_entry = aa_by_num.get(aa_num)
        if not aa_entry:
            print(f"  ! AA:{aa_num} ei leitud reference_data-s")
            continue

        label = person['name'].get('label', pid)
        n = enrich_one(person, aa_entry, dry_run)
        print(f"  AA:{aa_num:4} {label:40} → {n} välja")

        if not dry_run:
            if BATCH_ID not in person.get('import_batch_ids', []):
                person.setdefault('import_batch_ids', []).append(BATCH_ID)
            person['updated_at'] = now
            person['updated_by'] = 'enrich_aa_script'
            atomic_write(fpath, person)
            update_index_entry(person)
        enriched += 1

    print(f"\n✓ Rikastatud: {enriched}, vahele (juba tehtud): {skipped}")


# =========================================================
# REŽIIM 2: leia AA matchid
# =========================================================

def normalize(s):
    import re
    s = s.lower()
    s = re.sub(r'\([^)]*\)', '', s)  # eemalda sulud
    s = re.sub(r'[^a-zäöüõšž\s]', '', s)
    return s.strip()


def cmd_match():
    aa_by_num = load_aa_by_number()
    all_prosopo = load_all_prosopo()
    aa_data = json.load(open(AA_FILE, encoding='utf-8'))

    # Prosopo kaardid ilma AA identifikaatorita
    no_aa = {pid: (f, p) for pid, (f, p) in all_prosopo.items()
             if not any(i.get('scheme') == 'album_academicum'
                        for i in p.get('identifiers', []))}

    # Tegevusega AA isikud kes pole veel prosopograafias
    existing_aa_nums = set()
    for _, (_, p) in all_prosopo.items():
        for i in p.get('identifiers', []):
            if i.get('scheme') == 'album_academicum':
                try: existing_aa_nums.add(int(i['id'].replace('AA:', '')))
                except: pass

    candidates = []
    for entry in aa_data:
        num = entry.get('entry_number')
        if not num or num in existing_aa_nums:
            continue
        act = entry.get('academia_gustaviana_activity', {})
        total = sum(len(act.get(k, [])) for k in
                    ['orations', 'gratulations', 'disputations', 'academic_ceremonies', 'positions'])
        if total == 0:
            continue

        pname = entry['person']['name']
        family = pname.get('family_name', '') or ''
        first = pname.get('first_name', '') or ''

        for pid, (_, p) in no_aa.items():
            label = p['name'].get('label', '')
            norm_label = normalize(label)
            norm_family = normalize(family)
            norm_first = normalize(first[:4]) if first else ''

            if norm_family and norm_family in norm_label:
                if not norm_first or norm_first in norm_label:
                    candidates.append({
                        'aa_number': num,
                        'aa_name': f"{family}, {first}",
                        'aa_activity_count': total,
                        'prosopo_id': pid,
                        'prosopo_label': label,
                        'confirmed': None,  # kasutaja täidab: true/false
                    })
                    break

    candidates.sort(key=lambda x: -x['aa_activity_count'])
    atomic_write(REVIEW_FILE, candidates)
    print(f"Kirjutatud {len(candidates)} potentsiaalset matchi → {REVIEW_FILE}")
    print("Ava fail, sea confirmed: true/false iga kirje juures, siis käivita --apply-matches")


# =========================================================
# REŽIIM 3: rakenda kinnitatud matchid
# =========================================================

def cmd_apply_matches(dry_run):
    if not os.path.exists(REVIEW_FILE):
        print(f"Review fail puudub: {REVIEW_FILE}")
        return

    aa_by_num = load_aa_by_number()
    all_prosopo = load_all_prosopo()
    review = json.load(open(REVIEW_FILE, encoding='utf-8'))
    now = datetime.now(timezone.utc).isoformat()

    confirmed = [r for r in review if r.get('confirmed') is True]
    print(f"Kinnitatud matchid: {len(confirmed)} / {len(review)}")

    for r in confirmed:
        aa_num = r['aa_number']
        pid = r['prosopo_id']
        if pid not in all_prosopo:
            print(f"  ! {pid} ei leitud")
            continue

        fpath, person = all_prosopo[pid]
        aa_entry = aa_by_num.get(aa_num)
        if not aa_entry:
            print(f"  ! AA:{aa_num} ei leitud")
            continue

        label = person['name'].get('label', pid)
        print(f"  AA:{aa_num} ↔ {pid} {label}")

        if not dry_run:
            # Lisa AA identifikaator
            person.setdefault('identifiers', []).append({
                'scheme': 'album_academicum',
                'id': f"AA:{aa_num}",
                'checked_at': now[:10],
            })
            # Rikata
            enrich_one(person, aa_entry, dry_run=False)
            if BATCH_ID not in person.get('import_batch_ids', []):
                person.setdefault('import_batch_ids', []).append(BATCH_ID)
            person['updated_at'] = now
            person['updated_by'] = 'enrich_aa_script'
            atomic_write(fpath, person)
            update_index_entry(person)

    if dry_run:
        print("[DRY RUN]")


# =========================================================
# MAIN
# =========================================================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--match', action='store_true', help='Leia AA matchid, kirjuta review fail')
    parser.add_argument('--apply-matches', action='store_true', help='Rakenda kinnitatud matchid')
    args = parser.parse_args()

    if args.match:
        cmd_match()
    elif args.apply_matches:
        cmd_apply_matches(args.dry_run)
    else:
        print("=== AA rikastamine (74 olemasolevat AA kaarti) ===\n")
        cmd_enrich(args.dry_run)


if __name__ == '__main__':
    main()
