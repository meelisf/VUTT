#!/usr/bin/env python3
"""
Meilisearchi sünkroniseerimise skript.

Võrdleb Meilisearchi andmeid failisüsteemiga ja:
- Kustutab lehekülgi, mida failisüsteemis enam pole
- Lisab uued leheküljed, mis failisüsteemis on aga Meilisearchis puuduvad
- Uuendab lehekülgede arvu (teose_lehekylgede_arv) kui see on muutunud

Kasutamine:
    python3 scripts/sync_meilisearch.py          # Näita muudatusi (dry-run)
    python3 scripts/sync_meilisearch.py --apply  # Rakenda muudatused
"""

import os
import sys
import json
import argparse
import re
import unicodedata

# Lisa parent directory path'i, et importida mooduleid
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from meilisearch import Client
except ImportError:
    print("Viga: meilisearch teek puudub. Installi: pip install meilisearch")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv()  # Laeb .env failist
except ImportError:
    pass  # dotenv pole kohustuslik kui keskkonnamuutujad on seadistatud

# --- SEADISTUS ---
# NB: Docker sees on MEILISEARCH_URL=http://meilisearch:7700
#     Otse serveris käivitades kasuta vaikimisi localhost
_env_url = os.environ.get('MEILISEARCH_URL', 'http://localhost:7700')
# Kui .env sisaldab Dockeri hostname'd, kasuta localhost (serveris otse käivitades)
MEILI_URL = _env_url.replace('http://meilisearch:', 'http://localhost:')
MEILI_KEY = os.environ.get('MEILI_MASTER_KEY', '')
MEILI_INDEX = 'teosed'
DATA_ROOT_DIR = os.environ.get('VUTT_DATA_DIR', 'data/')
# --- LÕPP ---


def sanitize_id(text):
    """Puhastab teksti Meilisearchi ID-ks."""
    normalized = unicodedata.normalize('NFD', text)
    ascii_text = ''.join(c for c in normalized if unicodedata.category(c) != 'Mn')
    sanitized = re.sub(r'[^a-zA-Z0-9_-]', '_', ascii_text)
    sanitized = re.sub(r'_+', '_', sanitized)
    return sanitized.strip('_-')


def get_meilisearch_pages(client):
    """Hangib kõik leheküljed Meilisearchist."""
    index = client.index(MEILI_INDEX)

    pages = {}  # id -> document
    offset = 0
    limit = 1000

    while True:
        # Kasuta get_documents API-t - see ei ole piiratud maxTotalHits'iga
        # NB: work_id on nanoid (nt "58sah4"), teose_id on slug (nt "Ametikirjad_1632_1")
        #     Kasutame work_id, sest see ühtib failisüsteemi _metadata.json id väljaga
        result = index.get_documents({
            'offset': offset,
            'limit': limit,
            'fields': ['id', 'work_id', 'teose_id', 'lehekylje_number', 'lehekylje_pilt',
                       'teose_lehekylgede_arv', 'originaal_kataloog']
        })

        docs = result.results if hasattr(result, 'results') else result.get('results', [])

        if not docs:
            break

        for doc in docs:
            # doc võib olla dict või objekt
            if hasattr(doc, '__getitem__'):
                doc_dict = doc
            else:
                doc_dict = doc.__dict__ if hasattr(doc, '__dict__') else {}

            # Kasuta work_id + lehekylje_number composite key'na (mitte dokumendi id)
            # NB: work_id on nanoid, teose_id on slug - failisüsteemis kasutame nanoid'i
            work_id = doc_dict.get('work_id') or getattr(doc, 'work_id', None)
            teose_id_fallback = doc_dict.get('teose_id') or getattr(doc, 'teose_id', None)
            page_num = doc_dict.get('lehekylje_number') or getattr(doc, 'lehekylje_number', None)
            doc_id = doc_dict.get('id') or getattr(doc, 'id', None)  # Algne ID kustutamiseks

            # Eelista work_id (nanoid), fallback teose_id (slug)
            effective_id = work_id or teose_id_fallback

            if effective_id and page_num:
                composite_key = f"{effective_id}-{page_num}"
                pages[composite_key] = {
                    'id': doc_id,  # Säilitame algse ID kustutamiseks
                    'teose_id': effective_id,  # work_id (nanoid) või teose_id (slug)
                    'lehekylje_number': page_num,
                    'lehekylje_pilt': doc_dict.get('lehekylje_pilt') or getattr(doc, 'lehekylje_pilt', None),
                    'teose_lehekylgede_arv': doc_dict.get('teose_lehekylgede_arv') or getattr(doc, 'teose_lehekylgede_arv', None),
                    'originaal_kataloog': doc_dict.get('originaal_kataloog') or getattr(doc, 'originaal_kataloog', None),
                }

        offset += limit
        print(f"  ... loetud {offset} dokumenti", end='\r')

        if len(docs) < limit:
            break

    print()  # Uus rida pärast progressi
    return pages


def get_filesystem_pages(data_dir):
    """Hangib kõik leheküljed failisüsteemist."""
    pages = {}  # id -> info
    works = {}  # teose_id -> {'dir_name': str, 'page_count': int, 'pages': list}
    unreadable_metadata = []  # Loetamatud _metadata.json failid

    if not os.path.exists(data_dir):
        print(f"Hoiatus: Andmekaust '{data_dir}' ei eksisteeri")
        return pages, works, unreadable_metadata

    for dir_name in sorted(os.listdir(data_dir)):
        dir_path = os.path.join(data_dir, dir_name)
        if not os.path.isdir(dir_path):
            continue

        # Leia pildifailid (v.a. thumbnailid)
        image_files = sorted([
            f for f in os.listdir(dir_path)
            if f.lower().endswith(('.jpg', '.jpeg', '.png')) and not f.startswith('_thumb_')
        ])

        if not image_files:
            continue

        # Hangi work_id (nanoid) ja teose_id (slug) _metadata.json failist
        metadata_path = os.path.join(dir_path, '_metadata.json')
        work_id = None  # nanoid
        teose_id = sanitize_id(dir_name)  # slug fallback

        if os.path.exists(metadata_path):
            try:
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    meta = json.load(f)
                    work_id = meta.get('id')  # nanoid
                    teose_id = sanitize_id(meta.get('teose_id') or meta.get('slug') or dir_name)
            except PermissionError:
                # Tõenäoliselt root omanduses fail (nt Docker/serveri poolt loodud)
                unreadable_metadata.append((dir_name, 'Permission denied'))
            except Exception as e:
                unreadable_metadata.append((dir_name, str(e)))

        # Kasuta nanoid't kui olemas, muidu slug
        id_for_pages = work_id or teose_id

        works[id_for_pages] = {
            'dir_name': dir_name,
            'page_count': len(image_files),
            'pages': []
        }

        for page_index, image_file in enumerate(image_files):
            page_num = page_index + 1
            page_id = f"{id_for_pages}-{page_num}"
            image_path = os.path.join(dir_name, image_file)

            pages[page_id] = {
                'teose_id': id_for_pages,
                'lehekylje_number': page_num,
                'lehekylje_pilt': image_path,
                'teose_lehekylgede_arv': len(image_files),
                'originaal_kataloog': dir_name,
            }
            works[id_for_pages]['pages'].append(page_id)

    # Hoiata loetamatute metaandmete failide kohta
    if unreadable_metadata:
        print(f"\n⚠️  HOIATUS: {len(unreadable_metadata)} _metadata.json faili ei saa lugeda!")
        print("   Need tööd kasutavad kaustanime ID-na (võib põhjustada sünkroniseerimisprobleeme):")
        for dir_name, error in unreadable_metadata:
            print(f"   - {dir_name}: {error}")
        print("\n   LAHENDUS: Paranda failide õigused:")
        print("   sudo chown $USER:$USER data/*/_metadata.json")
        print("   sudo chmod 644 data/*/_metadata.json")
        print()

    return pages, works


def compare_and_sync(meili_pages, fs_pages, fs_works, apply_changes=False):
    """Võrdleb Meilisearchi ja failisüsteemi ning sünkroniseerib."""

    meili_ids = set(meili_pages.keys())
    fs_ids = set(fs_pages.keys())

    # Leheküljed, mida tuleb kustutada (on Meilisearchis, aga pole failisüsteemis)
    to_delete = meili_ids - fs_ids

    # Leheküljed, mida tuleb lisada (on failisüsteemis, aga pole Meilisearchis)
    to_add = fs_ids - meili_ids

    # Leheküljed, kus lehekülgede arv on vale
    to_update_count = []
    for page_id in meili_ids & fs_ids:
        meili_count = meili_pages[page_id].get('teose_lehekylgede_arv', 0)
        fs_count = fs_pages[page_id].get('teose_lehekylgede_arv', 0)
        if meili_count != fs_count:
            to_update_count.append({
                'id': page_id,
                'teose_id': fs_pages[page_id]['teose_id'],
                'old_count': meili_count,
                'new_count': fs_count
            })

    # Kokkuvõte
    print("\n" + "=" * 60)
    print("MEILISEARCHI SÜNKRONISEERIMISE ARUANNE")
    print("=" * 60)

    print(f"\nMeilisearchis lehekülgi: {len(meili_ids)}")
    print(f"Failisüsteemis lehekülgi: {len(fs_ids)}")

    # Kustutamiseks
    if to_delete:
        print(f"\n🗑️  KUSTUTAMISEKS ({len(to_delete)} lehekülge):")
        # Grupeeri teose kaupa
        delete_by_work = {}
        for page_id in to_delete:
            teose_id = meili_pages[page_id].get('teose_id', 'unknown')
            if teose_id not in delete_by_work:
                delete_by_work[teose_id] = []
            delete_by_work[teose_id].append(page_id)

        for teose_id, page_ids in sorted(delete_by_work.items()):
            orig_kataloog = meili_pages[page_ids[0]].get('originaal_kataloog', teose_id)
            print(f"   {orig_kataloog}: {len(page_ids)} lk")
            for pid in sorted(page_ids)[:5]:  # Näita max 5
                print(f"      - {pid}")
            if len(page_ids) > 5:
                print(f"      ... ja veel {len(page_ids) - 5}")
    else:
        print("\n✅ Kustutatavaid lehekülgi pole")

    # Lisamiseks
    if to_add:
        print(f"\n➕ LISAMISEKS ({len(to_add)} lehekülge):")
        # Grupeeri teose kaupa
        add_by_work = {}
        for page_id in to_add:
            teose_id = fs_pages[page_id].get('teose_id', 'unknown')
            if teose_id not in add_by_work:
                add_by_work[teose_id] = []
            add_by_work[teose_id].append(page_id)

        for teose_id, page_ids in sorted(add_by_work.items()):
            orig_kataloog = fs_pages[page_ids[0]].get('originaal_kataloog', teose_id)
            print(f"   {orig_kataloog}: {len(page_ids)} lk")
    else:
        print("\n✅ Lisatavaid lehekülgi pole")

    # Lehekülgede arvu uuendamine
    if to_update_count:
        print(f"\n🔄 LEHEKÜLGEDE ARVU UUENDAMINE ({len(to_update_count)} lehekülge):")
        # Grupeeri teose kaupa
        works_to_update = {}
        for item in to_update_count:
            teose_id = item['teose_id']
            if teose_id not in works_to_update:
                works_to_update[teose_id] = {
                    'old': item['old_count'],
                    'new': item['new_count'],
                    'count': 0
                }
            works_to_update[teose_id]['count'] += 1

        for teose_id, info in sorted(works_to_update.items()):
            print(f"   {teose_id}: {info['old']} → {info['new']} lk")
    else:
        print("\n✅ Lehekülgede arvud on korrektsed")

    # Rakenda muudatused
    if apply_changes and (to_delete or to_add or to_update_count):
        print("\n" + "-" * 60)
        print("RAKENDAN MUUDATUSED...")

        client = Client(MEILI_URL, MEILI_KEY)
        index = client.index(MEILI_INDEX)

        # Kustuta
        if to_delete:
            print(f"Kustutan {len(to_delete)} lehekülge...")
            # Kasuta Meilisearchi algset dokumendi ID-d (mitte composite key'd)
            delete_ids = [meili_pages[key]['id'] for key in to_delete if meili_pages[key].get('id')]
            # Kustutame partiidena, kuna loend võib olla suur
            batch_size = 100
            for i in range(0, len(delete_ids), batch_size):
                batch = delete_ids[i:i + batch_size]
                task = index.delete_documents(batch)
                index.wait_for_task(task.task_uid)
            print(f"   ✅ Kustutatud")

        # Lisa uued (vajab täielikku dokumenti - kasutame consolidate skripti)
        if to_add:
            print(f"\n⚠️  {len(to_add)} uut lehekülge tuleb lisada.")
            print("   Käivita täielik re-indekseerimine:")
            print("   python3 1-1_consolidate_data.py && python3 2-1_upload_to_meili.py")

        # Uuenda lehekülgede arvu
        if to_update_count:
            print(f"Uuendan lehekülgede arvu {len(to_update_count)} lehel...")

            # Grupeeri teose kaupa
            updates_by_work = {}
            for item in to_update_count:
                teose_id = item['teose_id']
                if teose_id not in updates_by_work:
                    updates_by_work[teose_id] = item['new_count']

            # Uuenda kõik teose leheküljed
            for teose_id, new_count in updates_by_work.items():
                # Hangi kõik selle teose leheküljed
                result = index.search('', {
                    'filter': f'teose_id = "{teose_id}"',
                    'limit': 1000
                })
                updates = [{'id': hit['id'], 'teose_lehekylgede_arv': new_count} for hit in result['hits']]
                if updates:
                    task = index.update_documents(updates)
                    index.wait_for_task(task.task_uid)

            print(f"   ✅ Uuendatud")

        print("\n✅ Sünkroniseerimine lõpetatud!")

    elif not apply_changes and (to_delete or to_add or to_update_count):
        print("\n" + "-" * 60)
        print("See oli DRY-RUN. Muudatuste rakendamiseks käivita:")
        print("   python3 scripts/sync_meilisearch.py --apply")

    else:
        print("\n✅ Kõik on sünkroonis!")

    return len(to_delete), len(to_add), len(to_update_count)


def main():
    parser = argparse.ArgumentParser(description='Sünkroniseeri Meilisearch failisüsteemiga')
    parser.add_argument('--apply', action='store_true', help='Rakenda muudatused (vaikimisi dry-run)')
    parser.add_argument('--data-dir', default=DATA_ROOT_DIR, help='Andmete kataloog')
    args = parser.parse_args()

    print(f"Meilisearch: {MEILI_URL}")
    print(f"Andmekaust: {args.data_dir}")

    # Ühenda Meilisearchiga
    try:
        client = Client(MEILI_URL, MEILI_KEY)
        client.health()
    except Exception as e:
        print(f"\nViga Meilisearchiga ühendamisel: {e}")
        sys.exit(1)

    # Näita indeksi statistikat
    try:
        stats = client.index(MEILI_INDEX).get_stats()
        print(f"Indeksi statistika: {stats.number_of_documents} dokumenti")
    except Exception as e:
        print(f"Statistika päring ebaõnnestus: {e}")

    print("\nHangin andmeid Meilisearchist...")
    meili_pages = get_meilisearch_pages(client)

    print("Hangin andmeid failisüsteemist...")
    fs_pages, fs_works = get_filesystem_pages(args.data_dir)

    # Võrdle ja sünkroniseeri
    compare_and_sync(meili_pages, fs_pages, fs_works, apply_changes=args.apply)


if __name__ == '__main__':
    main()
