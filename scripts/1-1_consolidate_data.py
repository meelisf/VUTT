#!/usr/bin/env python3
"""
VUTT Meilisearch indekseerimise skript v2.

Loeb _metadata.json failid (v2 formaat) ja genereerib JSONL faili Meilisearchi jaoks.
Iga lehekülg on eraldi dokument.

Uus formaat sisaldab:
  - id, slug, title, year, location, publisher
  - genre, collection, collections_hierarchy
  - creators, authors_text (denormaliseeritud)
  - tags, languages

Kasutamine:
  python3 scripts/1-1_consolidate_data.py
"""

import os
import sys
import json
import re
import types
import unicodedata
from tqdm import tqdm

# --- SEADISTUS ---
DATA_ROOT_DIR = os.getenv('VUTT_DATA_DIR', 'data')
OUTPUT_FILE = 'output/meilisearch_data_per_page.jsonl'
CONFIG_DIR = os.path.join(DATA_ROOT_DIR, 'config')
COLLECTIONS_FILE = os.path.join(CONFIG_DIR, 'collections.json')
PEOPLE_FILE = os.path.join(CONFIG_DIR, 'person_aliases.json')
ARCHIVES_FILE = os.path.join(CONFIG_DIR, 'archives.json')
LABELS_FILE = os.path.join(CONFIG_DIR, 'labels.json')
# --- LÕPP ---

# Impordime LinkedEntity utiliidid server/utils.py-st.
# Kasutame fake-package mustrit, et vältida server/__init__.py kõrvalefekte
# (FastAPI, gitpython, kasutajate cache jms).
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if 'server' not in sys.modules:
    _server_pkg = types.ModuleType('server')
    _server_pkg.__path__ = [os.path.join(_project_root, 'server')]
    _server_pkg.__package__ = 'server'
    sys.modules.setdefault('server', _server_pkg)
sys.path.insert(0, _project_root)
from server.utils import (
    capitalize_first, get_label, get_id, get_all_labels,
    get_primary_labels, get_labels_by_lang, get_all_ids
)


def sanitize_id(text):
    """Puhastab teksti, et see sobiks Meilisearchi dokumendi ID-ks."""
    normalized = unicodedata.normalize('NFD', text)
    ascii_text = ''.join(c for c in normalized if unicodedata.category(c) != 'Mn')
    sanitized = re.sub(r'[^a-zA-Z0-9_-]', '_', ascii_text)
    sanitized = re.sub(r'_+', '_', sanitized)
    sanitized = sanitized.strip('_-')
    return sanitized


def clean_text_for_search(text):
    """Puhastab teksti otsinguindeksi jaoks, eemaldades vormindusmärgid ja liites poolitused.

    Toetab mõlemat märgendusformaati:
    - Uus XML: <i>, <b>, <cs>, <m>, <hi>, <fn>n</fn>, <pb/>
    - Vana pseudo-markdown: *italic*, **bold**, ~cs~, [[m:text]], --lk--, [^n]

    NB: hoia SÜNKROONIS server/meilisearch_ops.py clean_text_for_search-iga
    (kaks indekseerimisteed — vt MEMORY project_meili_two_index_paths).
    """
    if not text:
        return ""

    # 1. Uus XML märgendus — eemalda kõik VUTT tägid
    # <fn>n</fn> ja <pb/> asendame tühikuga, ülejäänud tägid eemaldame
    text = re.sub(r'<fn>\d+</fn>', ' ', text)  # joonealuse viite marker
    text = re.sub(r'<pb/>', ' ', text)           # leheküljevahetus
    text = re.sub(r'</?[a-z]+\d*>', '', text)    # avamis/sulgemistägid (<i>, </i>, <cs>, <ann1>, </ann1> jne)

    # 2. Vana pseudo-markdown (legacy, kui faile pole veel migreeritud)
    text = text.replace('*', ' ')               # bold/italic tärnid
    text = text.replace('~', ' ')               # koodivahetus
    text = text.replace('[[m:', ' ').replace(']]', ' ')  # ääremärkus
    text = text.replace('--lk--', ' ')          # leheküljevahetus
    text = re.sub(r'\[\^\d+\]', ' ', text)      # joonealuse viite marker

    # 3. Käitle reavahetuse poolituskriipse PÄRAST tägide eemaldamist
    # (nt "<i>Sueco¬</i>\n<i>rum" -> pärast tägide eemaldust "Sueco¬\nrum" -> "Suecorum")
    text = re.sub(r'[-⸗¬]\s*\n\s*', '', text)

    # 4. Eemalda üleliigsed tühikud
    text = re.sub(r'\s+', ' ', text).strip()

    return text


def calculate_work_status(page_statuses):
    """Arvutab teose koondstaatuse lehekülgede staatuste põhjal."""
    if not page_statuses:
        return 'Toores'
    if all(s == 'Valmis' for s in page_statuses):
        return 'Valmis'
    if all(s == 'Toores' or not s for s in page_statuses):
        return 'Toores'
    return 'Töös'


def load_collections():
    """Laeb kollektsioonide hierarhia."""
    if os.path.exists(COLLECTIONS_FILE):
        with open(COLLECTIONS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def load_people_aliases():
    """Laeb inimeste aliased JSON failist."""
    if os.path.exists(PEOPLE_FILE):
        try:
            with open(PEOPLE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {}


def load_archives():
    """Laeb arhiivide registri JSON failist."""
    if os.path.exists(ARCHIVES_FILE):
        try:
            with open(ARCHIVES_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {}


def build_archive_refs_text(archive_refs, archives):
    """Koostab otsitava teksti arhiiviviidetest."""
    if not archive_refs:
        return None
    parts = []
    for ref in archive_refs:
        if not isinstance(ref, dict):
            continue
        archive_id = ref.get('archive_id', '')
        if archive_id:
            parts.append(archive_id)
            archive_name = archives.get(archive_id, {}).get('name', '')
            if archive_name:
                parts.append(archive_name)
        if ref.get('reference'):
            parts.append(ref['reference'])
    return ' '.join(parts) if parts else None


def build_text_annotations_text(text_annotations):
    """Koostab otsitava teksti tekst-annotatsioonide kommentaaridest."""
    if not text_annotations:
        return None
    parts = [
        a['comment']
        for a in text_annotations
        if isinstance(a, dict) and a.get('comment')
    ]
    return ' '.join(parts) if parts else None


def _invert_name(name):
    """Teisendab 'Perenimi, Eesnimi' → 'Eesnimi Perenimi'. Tagastab None kui komat pole."""
    if ',' in name:
        parts = name.split(',', 1)
        return f"{parts[1].strip()} {parts[0].strip()}"
    return None


def get_creator_aliases(creators, people_data):
    """Leiab isikutele aliased (nimevariandid).
    Lisab igale 'Perenimi, Eesnimi' aliasele ka inverteeritud 'Eesnimi Perenimi' versiooni.
    (Sünk meilisearch_ops-iga — vt MEMORY project_meili_two_index_paths.)"""
    aliases = []
    for creator in creators:
        creator_id = creator.get('id')
        if creator_id and people_data.get(creator_id):
            person = people_data[creator_id]
            for alias in person.get('aliases', []):
                aliases.append(alias)
                inverted = _invert_name(alias)
                if inverted:
                    aliases.append(inverted)
    return aliases


def get_entity_aliases(entity_or_list, people_data):
    """Leiab LinkedEntity(te) aliased people.json-ist (trükkal, märksõnad vms).
    Lisab ka inverteeritud nimevariandid (sünk meilisearch_ops-iga)."""
    aliases = []
    items = entity_or_list if isinstance(entity_or_list, list) else ([entity_or_list] if entity_or_list else [])
    for item in items:
        if not isinstance(item, dict):
            continue
        item_id = item.get('id')
        if item_id and people_data.get(item_id):
            for alias in people_data[item_id].get('aliases', []):
                aliases.append(alias)
                inverted = _invert_name(alias)
                if inverted:
                    aliases.append(inverted)
    return aliases


def get_collection_hierarchy(collections, collection_ids):
    """
    Tagastab kollektsioonide hierarhia (kõigi kuuluvate kollektsioonide esivanemate union).

    Args:
        collections: Kõigi kollektsioonide dict
        collection_ids: Üks ID (str) või list ID-sid
    """
    if not collection_ids or not collections:
        return []

    if isinstance(collection_ids, str):
        ids = [collection_ids]
    else:
        ids = [c for c in collection_ids if c]

    seen = set()
    result = []

    for cid in ids:
        current = cid
        while current:
            if current not in seen:
                seen.add(current)
                result.append(current)
            col = collections.get(current)
            current = col.get('parent') if col else None

    return result



def get_work_metadata(doc_path, dir_name, collections):
    """
    Loeb teose metaandmed _metadata.json failist.

    TOETAB NII V1 KUI V2 FORMAATI - vt CLAUDE.md "_metadata.json Formaadid"
    - v1 = eestikeelsed väljad (pealkiri, aasta, teose_tags, koht, trükkal, autor, respondens)
    - v2 = ingliskeelsed väljad (title, year, tags, location, publisher, creators[])

    Tagastab: (teose_id, metadata_dict)
    """
    metadata_json_path = os.path.join(doc_path, '_metadata.json')

    # Vaikeväärtused (v2 formaat)
    result = {
        'id': None,
        'slug': sanitize_id(dir_name),
        'type': 'impressum',
        'genre': None,
        'collections': [],
        'collections_hierarchy': [],
        'title': 'Pealkiri puudub',
        'year': None,
        'year_display': None,
        'location': None,
        'publisher': None,
        'creators': [],
        'authors_text': [],
        'tags': [],
        'languages': ['lat'],
        'ester_id': None,
        'external_url': None,
        'archive_refs': [],
    }

    teose_id = sanitize_id(dir_name)

    if os.path.exists(metadata_json_path):
        try:
            with open(metadata_json_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)

                # Identifikaatorid
                result['id'] = meta.get('id')
                result['slug'] = meta.get('slug') or meta.get('teose_id', teose_id)
                teose_id = result['slug']  # Kasuta slug'i teose ID-na

                result['type'] = meta.get('type', 'impressum')
                result['genre'] = meta.get('genre')
                result['collections'] = meta.get('collections', [])

                # Hierarhia laiendamine
                if result['collections']:
                    result['collections_hierarchy'] = get_collection_hierarchy(
                        collections, result['collections']
                    )

                # V1/V2 fallback: v2 esmalt, siis v1
                result['title'] = meta.get('title') or meta.get('pealkiri', result['title'])
                result['year'] = meta.get('year') or meta.get('aasta')
                result['year_display'] = meta.get('year_display') or None
                # Kui year puudub aga year_display sisaldab aastat (nt "ca. 1750"),
                # kasuta seda numbrilise year-filtri jaoks (sama loogika nagu meilisearch_ops.py)
                if not result['year'] and result['year_display']:
                    _ym = re.search(r'\d{4}', result['year_display'])
                    if _ym:
                        result['year'] = int(_ym.group())
                result['location'] = meta.get('location') or meta.get('koht')
                result['publisher'] = meta.get('publisher') or meta.get('trükkal')

                # V1/V2 fallback: tags
                result['tags'] = meta.get('tags') or meta.get('teose_tags', [])

                # Creators: v2=creators massiiv, v1=autor/respondens otseväljad
                creators = meta.get('creators', [])

                # Kui v1 formaat (autor/respondens väljad), konverteeri creators massiiviks
                if not creators:
                    v1_autor = meta.get('autor')
                    v1_respondens = meta.get('respondens')
                    if v1_autor:
                        creators.append({'name': v1_autor, 'role': 'praeses'})
                    if v1_respondens:
                        creators.append({'name': v1_respondens, 'role': 'respondens'})

                result['creators'] = creators

                # Denormaliseeritud nimed otsinguks
                result['authors_text'] = [c['name'] for c in creators if c.get('name')]

                result['languages'] = meta.get('languages', ['lat'])
                result['ester_id'] = meta.get('ester_id')
                result['external_url'] = meta.get('external_url')
                result['archive_refs'] = meta.get('archive_refs') or []
                result['shareable'] = meta.get('shareable', False)

                # Seeria (kui on)
                if meta.get('series'):
                    result['series'] = meta['series']
                    result['series_title'] = meta['series'].get('title', '')

                # Relatsioonid (kui on)
                if meta.get('relations'):
                    result['relations'] = meta['relations']

                return teose_id, result

        except json.JSONDecodeError as e:
            print(f"!!! SÜNTAKSI VIGA: {metadata_json_path} (rida {e.lineno})")
            return teose_id, result
        except Exception as e:
            print(f"Viga _metadata.json lugemisel {metadata_json_path}: {e}")
            return teose_id, result

    # Kui _metadata.json puudub
    print(f"⚠️  Puudub _metadata.json: {dir_name}")

    return teose_id, result


def create_meilisearch_data_per_page():
    """Loob Meilisearchi andmefaili."""
    if not os.path.exists(DATA_ROOT_DIR):
        print(f"VIGA: Andmete juurkausta '{DATA_ROOT_DIR}' ei leitud!")
        return

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    print(f"Alustan andmete loomist faili '{OUTPUT_FILE}'...")
    print(f"Andmete kaust: {DATA_ROOT_DIR}")

    # Laeme kollektsioonid hierarhia jaoks
    collections = load_collections()
    people_data = load_people_aliases()
    archives = load_archives()
    labels_store = {}
    if os.path.exists(LABELS_FILE):
        with open(LABELS_FILE, 'r', encoding='utf-8') as _lf:
            labels_store = json.load(_lf)
    print(f"Laetud {len(collections)} kollektsiooni, {len(people_data)} isiku andmed, "
          f"{len(archives)} arhiivi, {len(labels_store)} kanoonilise sildi kirjet")

    # Kogu andmed teose kaupa
    works_data = {}

    SKIP_DIRS = {'prosopography', 'config'}
    doc_dirs = sorted([d for d in os.listdir(DATA_ROOT_DIR)
                       if os.path.isdir(os.path.join(DATA_ROOT_DIR, d)) and not d.startswith('.') and d not in SKIP_DIRS])

    for dir_name in tqdm(doc_dirs, desc="Teoste töötlemine"):
        doc_path = os.path.join(DATA_ROOT_DIR, dir_name)

        # Hangi metaandmed (v2 formaat)
        teose_id, doc_metadata = get_work_metadata(doc_path, dir_name, collections)

        # Isikud ja aliased
        creators = doc_metadata.get('creators', [])
        aliases = get_creator_aliases(creators, people_data)
        authors_text = doc_metadata.get('authors_text', []) + aliases

        # Leia pildifailid (v.a. thumbnailid), sordi sequence järgi
        def _seq(img_name):
            jp = os.path.join(doc_path, os.path.splitext(img_name)[0] + '.json')
            if os.path.exists(jp):
                try:
                    with open(jp, 'r', encoding='utf-8') as fj:
                        d = json.load(fj)
                        s = d.get('sequence') or d.get('meta_content', {}).get('sequence')
                        if s is not None:
                            return int(s)
                except Exception:
                    pass
            return float('inf')

        all_imgs = [f for f in os.listdir(doc_path)
                    if f.lower().endswith(('.jpg', '.jpeg', '.png')) and not f.startswith('_thumb_')]
        alpha_sorted = sorted(all_imgs)
        alpha_pos = {f: i for i, f in enumerate(alpha_sorted)}

        def _eff_seq(img_name):
            s = _seq(img_name)
            return (alpha_pos[img_name] + 1) * 100 if s == float('inf') else s

        jpg_files = sorted(all_imgs, key=lambda f: (_eff_seq(f), f))
        if not jpg_files:
            continue

        teose_lehekylgede_arv = len(jpg_files)

        pages = []
        # Kasuta nanoid't page ID-s (kui olemas), muidu fallback slugile
        work_id_for_keys = doc_metadata.get('id') or teose_id
        for page_index, jpg_filename in enumerate(jpg_files):
            page_id = f"{work_id_for_keys}-{page_index + 1}"
            base_name = os.path.splitext(jpg_filename)[0]

            # Loe tekst
            txt_path = os.path.join(doc_path, base_name + '.txt')
            page_text = ""
            if os.path.exists(txt_path):
                try:
                    with open(txt_path, 'r', encoding='utf-8') as f:
                        page_text = f.read()
                except Exception:
                    pass

            # Loe lehekülje metaandmed (annotatsioonid, staatus)
            json_path = os.path.join(doc_path, base_name + '.json')
            page_meta = {
                'tags': [],
                'comments': [],
                'text_annotations': [],
                'status': 'Toores',
                'history': []
            }

            if os.path.exists(json_path):
                try:
                    with open(json_path, 'r', encoding='utf-8') as jf:
                        file_json = json.load(jf)
                        source = file_json.get('meta_content', file_json)
                        # tags-fallback: serveril on 35 lehekülge vana 'tags' väljaga (OCR-artefaktid, stringid, mitte Q-objektid).
                        # Eemaldada pärast nende lehekülgede migreerimist või puhastamist.
                        page_meta['tags'] = source.get('page_tags', source.get('tags', []))
                        page_meta['comments'] = source.get('comments', [])
                        page_meta['text_annotations'] = source.get('text_annotations', [])
                        page_meta['status'] = source.get('status', 'Toores')
                        page_meta['history'] = source.get('history', [])

                        if 'text_content' in file_json and file_json['text_content']:
                            page_text = file_json['text_content']
                except Exception as e:
                    print(f"Viga JSON lugemisel {json_path}: {e}")

            # Last modified
            if os.path.exists(txt_path):
                last_mod = int(os.path.getmtime(txt_path) * 1000)
            else:
                last_mod = int(os.path.getmtime(os.path.join(doc_path, jpg_filename)) * 1000)

            image_path = os.path.join(dir_name, jpg_filename)

            # Meilisearch dokument (v2/v3 formaat)
            meili_doc = {
                # Identifikaatorid
                'id': page_id,
                'work_id': work_id_for_keys,  # Kasuta nanoidi või slug'i (nagu page_id-s)

                # Teose andmed (lamedaks lüüdud otsinguks ja kuvamiseks)
                'title': doc_metadata.get('title', ''),
                'year': doc_metadata.get('year'),
                'year_display': doc_metadata.get('year_display'),
                'location': get_label(doc_metadata.get('location')),
                'location_id': get_id(doc_metadata.get('location')),
                'location_object': doc_metadata.get('location'),
                'publisher': get_label(doc_metadata.get('publisher')),
                'publisher_id': get_id(doc_metadata.get('publisher')),
                'publisher_object': doc_metadata.get('publisher'),

                # Taksonoomia
                'type': get_label(doc_metadata.get('type', 'impressum')), # Vaikimisi (et)
                'type_et': get_labels_by_lang(doc_metadata.get('type', 'impressum'), 'et', labels_store),
                'type_en': get_labels_by_lang(doc_metadata.get('type', 'impressum'), 'en', labels_store),
                'type_object': doc_metadata.get('type'),
                'type_ids': get_all_ids(doc_metadata.get('type')),
                
                'genre': get_label(doc_metadata.get('genre')), # Vaikimisi (et)
                'genre_et': get_labels_by_lang(doc_metadata.get('genre'), 'et', labels_store),
                'genre_en': get_labels_by_lang(doc_metadata.get('genre'), 'en', labels_store),
                'genre_object': doc_metadata.get('genre'),
                'genre_search': get_all_labels(doc_metadata.get('genre')),
                'genre_ids': get_all_ids(doc_metadata.get('genre')),
                
                'collections': doc_metadata.get('collections', []),
                'collections_hierarchy': doc_metadata.get('collections_hierarchy', []),
                'is_public': any(
                    collections.get(c, {}).get("visibility", "public") == "public"
                    for c in doc_metadata.get('collections', [])
                ) if doc_metadata.get('collections') else True,
                'shareable': doc_metadata.get('shareable', False),

                # Isikud
                'creators': creators,
                'authors_text': authors_text,
                'author_names': [c['name'] for c in creators if c.get('name') and c.get('role') != 'respondens'],
                'respondens_names': [c['name'] for c in creators if c.get('name') and c.get('role') == 'respondens'],
                'creator_ids': [c.get('id') for c in creators if c.get('id')],

                # Täiendav klassifikatsioon (märksõnad)
                'tags': get_primary_labels(doc_metadata.get('tags', [])), # Vaikimisi (et)
                'tags_et': get_labels_by_lang(doc_metadata.get('tags', []), 'et', labels_store),
                'tags_en': get_labels_by_lang(doc_metadata.get('tags', []), 'en', labels_store),
                'tags_object': doc_metadata.get('tags', []),
                'tags_search': get_all_labels(doc_metadata.get('tags')) + get_entity_aliases(doc_metadata.get('tags', []), people_data),
                'tags_ids': get_all_ids(doc_metadata.get('tags')),
                'languages': doc_metadata.get('languages', ['lat']),

                # Lehekülje andmed
                'teose_lehekylgede_arv': teose_lehekylgede_arv,
                'lehekylje_number': page_index + 1,
                'lehekylje_tekst': clean_text_for_search(page_text), # OTSINGU JAOKS (puhastatud märkidest ja poolitustest)
                'text_content': page_text,                          # REDAKTORI JAOKS (algne tekst koos kõigi märkidega)
                'lehekylje_pilt': image_path,
                'originaal_kataloog': dir_name,

                # Annotatsioonid ja staatus
                'page_tags': get_primary_labels(page_meta.get('tags', [])),                          # capitalize_first (ühtlane teose tags-iga, sünk meilisearch_ops-iga)
                'page_tags_et': get_labels_by_lang(page_meta.get('tags', []), 'et', labels_store),
                'page_tags_en': get_labels_by_lang(page_meta.get('tags', []), 'en', labels_store),
                'page_tags_ids': get_all_ids(page_meta.get('tags', [])),
                'page_tags_suggest_et': [
                    f"{(get_labels_by_lang(t, 'et', labels_store) or [''])[0]}|||{t.get('id') or '' if isinstance(t, dict) else ''}"
                    for t in page_meta.get('tags', [])
                ],
                'page_tags_suggest_en': [
                    f"{(get_labels_by_lang(t, 'en', labels_store) or [''])[0]}|||{t.get('id') or '' if isinstance(t, dict) else ''}"
                    for t in page_meta.get('tags', [])
                ],
                'page_tags_object': page_meta.get('tags', []),
                'has_annotations': bool(page_meta.get('tags') or page_meta['comments'] or page_meta['text_annotations']),
                'comments': page_meta['comments'],
                'text_annotations': page_meta['text_annotations'],
                'status': page_meta['status'],
                'history': page_meta['history'],
                'last_modified': last_mod,
            }

            # Valikulised väljad
            if doc_metadata.get('ester_id'):
                meili_doc['ester_id'] = doc_metadata['ester_id']
            if doc_metadata.get('external_url'):
                meili_doc['external_url'] = doc_metadata['external_url']
            if doc_metadata.get('series'):
                meili_doc['series'] = doc_metadata['series']
                meili_doc['series_title'] = doc_metadata.get('series_title', '')
            if doc_metadata.get('relations'):
                meili_doc['relations'] = doc_metadata['relations']

            # Arhiiviviited (alati lisatud, et Meilisearch registreeriks välja)
            archive_refs = doc_metadata.get('archive_refs') or []
            if archive_refs:
                meili_doc['archive_refs'] = archive_refs
            meili_doc['archive_refs_text'] = build_archive_refs_text(archive_refs, archives) or ''

            # Tekst-annotatsioonid (alati lisatud, et Meilisearch registreeriks välja)
            meili_doc['text_annotations_text'] = build_text_annotations_text(page_meta['text_annotations']) or ''

            # V3 bibliograafia: täisobjektid on juba location_object/publisher_object väljadel.
            # Flat location/publisher JÄÄB string-labeliks (filter `publisher = "Vogel"` + display),
            # sünk meilisearch_ops-iga — ÄRA kirjuta neid siin objektiga üle.
            meili_doc['location_search'] = get_all_labels(doc_metadata.get('location'))
            meili_doc['publisher_search'] = get_all_labels(doc_metadata.get('publisher')) + get_entity_aliases(doc_metadata.get('publisher'), people_data)

            pages.append(meili_doc)

        works_data[teose_id] = pages

    # Kirjuta väljundfail teose staatustega
    print(f"\nArvutan teose staatused ja kirjutan väljundfaili...")
    total_pages = 0

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as outfile:
        for teose_id, pages in works_data.items():
            page_statuses = [p['status'] for p in pages]
            teose_staatus = calculate_work_status(page_statuses)

            for meili_doc in pages:
                meili_doc['teose_staatus'] = teose_staatus
                outfile.write(json.dumps(meili_doc, ensure_ascii=False) + '\n')
                total_pages += 1

    print(f"\nValmis! Loodud {total_pages} lehekülge {len(works_data)} teosest.")
    print(f"Väljundfail: {OUTPUT_FILE}")


if __name__ == '__main__':
    create_meilisearch_data_per_page()
