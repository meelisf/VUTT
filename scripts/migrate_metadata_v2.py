#!/usr/bin/env python3
"""
Migratsiooniskript: _metadata.json v1 → v2

Teisendab olemasoleva formaadi:
  - pealkiri → title
  - autor → creators[{name, role: "praeses"}]
  - respondens → creators[{name, role: "respondens"}]
  - aasta → year
  - koht → location
  - trükkal → publisher
  - teose_tags → genre + tags
  - teose_id → slug
  - Lisa: id (lühikood), type, collection, languages

Kasutamine:
  python3 scripts/migrate_metadata_v2.py           # Dry-run
  python3 scripts/migrate_metadata_v2.py --apply   # Rakenda muudatused
"""

import os
import sys
import json
import random
import string
import argparse
from datetime import datetime

# Seadistus
DATA_ROOT_DIR = os.getenv('VUTT_DATA_DIR', '/home/mf/Dokumendid/LLM/tartu-acad/data/04_sorditud_dokumendid')
STATE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'state')
VOCABULARIES_FILE = os.path.join(STATE_DIR, 'vocabularies.json')

# Nanoid stiilis ID generaator (6 tähemärki)
def generate_short_id(length=6):
    """Genereerib lühikese unikaalse ID (nanoid stiilis)."""
    alphabet = string.ascii_lowercase + string.digits
    return ''.join(random.choices(alphabet, k=length))

# Laeme sõnavara genre mappinguks
def load_vocabularies():
    """Laeb vocabularies.json faili."""
    if os.path.exists(VOCABULARIES_FILE):
        with open(VOCABULARIES_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {'genres': {}}

# Eestikeelne tag → ingliskeelne genre ID
TAG_TO_GENRE = {
    'disputatsioon': 'disputatio',
    'dissertatsioon': 'disputatio',
    'oratsioon': 'oratio',
    'carmen': 'carmen',
    'programm': 'programma',
    'jutlus': 'sermo',
    'plakat': 'placatum',
    'meditatsioon': 'meditatio',
    'kiri': 'epistola',
    'päevik': 'diarium',
}

# Tagid, mis EI ole žanrid (jäävad tags[] massiivi)
NON_GENRE_TAGS = {'ajalugu', 'teoloogia', 'filosoofia', 'meditsiin', 'õigus', 'matemaatika'}


def migrate_metadata(old_meta, dir_name):
    """
    Teisendab vana _metadata.json formaadi uueks.

    Args:
        old_meta: Vana formaadi sõnastik
        dir_name: Kausta nimi (fallback slug jaoks)

    Returns:
        Uue formaadi sõnastik
    """
    new_meta = {}

    # 1. ID - genereeri uus lühikood (kui pole juba olemas)
    new_meta['id'] = old_meta.get('id') or generate_short_id()

    # 2. Slug - kasuta teose_id või tuleta kausta nimest
    new_meta['slug'] = old_meta.get('slug') or old_meta.get('teose_id') or dir_name

    # 3. Type - vaikimisi impressum (trükis)
    new_meta['type'] = old_meta.get('type', 'impressum')

    # 4. Genre ja Tags - eralda teose_tags põhjal
    old_tags = old_meta.get('teose_tags', [])
    if isinstance(old_tags, str):
        old_tags = [old_tags] if old_tags else []

    genre = None
    remaining_tags = []

    for tag in old_tags:
        tag_lower = tag.lower().strip()
        if tag_lower in TAG_TO_GENRE:
            # Esimene leitud genre võidab
            if not genre:
                genre = TAG_TO_GENRE[tag_lower]
        elif tag_lower in NON_GENRE_TAGS or tag_lower not in TAG_TO_GENRE:
            remaining_tags.append(tag_lower)

    new_meta['genre'] = genre
    new_meta['tags'] = remaining_tags if remaining_tags else []

    # 5. Collection - alguses null
    new_meta['collection'] = old_meta.get('collection', None)

    # 6. Title
    new_meta['title'] = old_meta.get('title') or old_meta.get('pealkiri', '')

    # 7. Year
    year = old_meta.get('year') or old_meta.get('aasta')
    new_meta['year'] = int(year) if year else None

    # 8. Location
    new_meta['location'] = old_meta.get('location') or old_meta.get('koht', '')

    # 9. Publisher
    new_meta['publisher'] = old_meta.get('publisher') or old_meta.get('trükkal', '')

    # 10. Creators - teisenda autor ja respondens
    creators = old_meta.get('creators', [])

    if not creators:
        # Migreerime vanast formaadist
        autor = old_meta.get('autor', '').strip()
        respondens = old_meta.get('respondens', '').strip()

        if autor:
            creators.append({'name': autor, 'role': 'praeses'})
        if respondens:
            creators.append({'name': respondens, 'role': 'respondens'})

    new_meta['creators'] = creators

    # 11. Languages - vaikimisi ladina
    new_meta['languages'] = old_meta.get('languages', ['lat'])

    # 12. ESTER ID ja external URL
    if old_meta.get('ester_id'):
        new_meta['ester_id'] = old_meta['ester_id']

    if old_meta.get('external_url'):
        new_meta['external_url'] = old_meta['external_url']

    # 13. Series (kui on)
    if old_meta.get('series'):
        new_meta['series'] = old_meta['series']

    # 14. Relations (kui on)
    if old_meta.get('relations'):
        new_meta['relations'] = old_meta['relations']

    return new_meta


def process_all_metadata(apply=False):
    """
    Töötleb kõik _metadata.json failid.

    Args:
        apply: Kui True, salvestab muudatused. Muidu dry-run.
    """
    if not os.path.exists(DATA_ROOT_DIR):
        print(f"VIGA: Andmete kausta '{DATA_ROOT_DIR}' ei leitud!")
        sys.exit(1)

    print(f"{'='*60}")
    print(f"VUTT Metadata Migration v1 → v2")
    print(f"{'='*60}")
    print(f"Andmete kaust: {DATA_ROOT_DIR}")
    print(f"Režiim: {'RAKENDA MUUDATUSED' if apply else 'DRY-RUN (testimine)'}")
    print(f"{'='*60}\n")

    # Statistika
    stats = {
        'total': 0,
        'migrated': 0,
        'already_v2': 0,
        'errors': 0,
        'created': 0,
    }

    # Genereeri kõik ID-d ette, et kontrollida unikaalsust
    existing_ids = set()

    # Esimene pass: kogu olemasolevad ID-d
    for dir_name in os.listdir(DATA_ROOT_DIR):
        dir_path = os.path.join(DATA_ROOT_DIR, dir_name)
        if not os.path.isdir(dir_path):
            continue

        metadata_path = os.path.join(dir_path, '_metadata.json')
        if os.path.exists(metadata_path):
            try:
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    meta = json.load(f)
                    if meta.get('id'):
                        existing_ids.add(meta['id'])
            except:
                pass

    # Teine pass: migratsioon
    doc_dirs = sorted([d for d in os.listdir(DATA_ROOT_DIR)
                       if os.path.isdir(os.path.join(DATA_ROOT_DIR, d))])

    for dir_name in doc_dirs:
        dir_path = os.path.join(DATA_ROOT_DIR, dir_name)
        metadata_path = os.path.join(dir_path, '_metadata.json')

        stats['total'] += 1

        # Loe olemasolev metadata
        old_meta = {}
        if os.path.exists(metadata_path):
            try:
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    old_meta = json.load(f)
            except json.JSONDecodeError as e:
                print(f"❌ JSON VIGA: {metadata_path} - {e}")
                stats['errors'] += 1
                continue
            except Exception as e:
                print(f"❌ VIGA: {metadata_path} - {e}")
                stats['errors'] += 1
                continue
        else:
            print(f"⚠️  Puudub _metadata.json: {dir_name}")
            stats['created'] += 1

        # Kontrolli, kas juba v2 formaadis
        if old_meta.get('id') and old_meta.get('slug') and old_meta.get('title'):
            print(f"✓  Juba v2: {dir_name}")
            stats['already_v2'] += 1
            continue

        # Migratsioon
        new_meta = migrate_metadata(old_meta, dir_name)

        # Tagame unikaalse ID
        while new_meta['id'] in existing_ids:
            new_meta['id'] = generate_short_id()
        existing_ids.add(new_meta['id'])

        # Näita muudatusi
        print(f"\n📄 {dir_name}")
        print(f"   id: {new_meta['id']}")
        print(f"   slug: {new_meta['slug']}")
        print(f"   title: {new_meta['title'][:60]}..." if len(new_meta['title']) > 60 else f"   title: {new_meta['title']}")
        print(f"   genre: {new_meta['genre']}")
        print(f"   creators: {len(new_meta['creators'])} isikut")
        if new_meta['tags']:
            print(f"   tags: {new_meta['tags']}")

        stats['migrated'] += 1

        # Salvesta kui --apply
        if apply:
            try:
                with open(metadata_path, 'w', encoding='utf-8') as f:
                    json.dump(new_meta, f, ensure_ascii=False, indent=2)
                print(f"   ✅ Salvestatud")
            except Exception as e:
                print(f"   ❌ Salvestamise viga: {e}")
                stats['errors'] += 1

    # Kokkuvõte
    print(f"\n{'='*60}")
    print(f"KOKKUVÕTE")
    print(f"{'='*60}")
    print(f"Kokku kaustasid:    {stats['total']}")
    print(f"Migreeritud:        {stats['migrated']}")
    print(f"Juba v2 formaadis:  {stats['already_v2']}")
    print(f"Loodud uued:        {stats['created']}")
    print(f"Vigu:               {stats['errors']}")
    print(f"{'='*60}")

    if not apply and stats['migrated'] > 0:
        print(f"\n⚠️  See oli DRY-RUN. Muudatuste rakendamiseks käivita:")
        print(f"   python3 scripts/migrate_metadata_v2.py --apply")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Migreeri _metadata.json failid v2 formaati')
    parser.add_argument('--apply', action='store_true', help='Rakenda muudatused (vaikimisi dry-run)')
    parser.add_argument('--data-dir', type=str, help='Andmete kaust (vaikimisi: VUTT_DATA_DIR env või hardcoded)')

    args = parser.parse_args()

    if args.data_dir:
        DATA_ROOT_DIR = args.data_dir

    process_all_metadata(apply=args.apply)
