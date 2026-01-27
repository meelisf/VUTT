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
import json
import re
import unicodedata
from tqdm import tqdm

# --- SEADISTUS ---
DATA_ROOT_DIR = os.getenv('VUTT_DATA_DIR', 'data')
OUTPUT_FILE = 'output/meilisearch_data_per_page.jsonl'
STATE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'state')
COLLECTIONS_FILE = os.path.join(STATE_DIR, 'collections.json')
# --- LÕPP ---


def sanitize_id(text):
    """Puhastab teksti, et see sobiks Meilisearchi dokumendi ID-ks."""
    normalized = unicodedata.normalize('NFD', text)
    ascii_text = ''.join(c for c in normalized if unicodedata.category(c) != 'Mn')
    sanitized = re.sub(r'[^a-zA-Z0-9_-]', '_', ascii_text)
    sanitized = re.sub(r'_+', '_', sanitized)
    sanitized = sanitized.strip('_-')
    return sanitized


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


def get_collection_hierarchy(collections, collection_id):
    """
    Tagastab kollektsiooni hierarhia (vanematest lapseni).
    Näiteks: ["universitas-dorpatensis-1", "academia-gustaviana"]
    """
    if not collection_id or not collections:
        return []

    hierarchy = []
    current_id = collection_id

    while current_id:
        hierarchy.insert(0, current_id)
        collection = collections.get(current_id)
        current_id = collection.get('parent') if collection else None

    return hierarchy


def derive_place(year):
    """Tuletab trükikoha aasta järgi."""
    if not year:
        return "Tartu"
    if year >= 1699:
        return "Pärnu"
    return "Tartu"


def derive_printer(year):
    """Tuletab trükkali aasta järgi."""
    if not year:
        return "Typis Academicis"
    if 1632 <= year <= 1635:
        return "Jacob Becker (Pistorius)"
    elif 1642 <= year <= 1656:
        return "Johann Vogel (Vogelius)"
    elif 1690 <= year <= 1710:
        return "Johann Brendeken"
    return "Typis Academicis"


def capitalize_first(text):
    """Teeb esimese tähe suureks, ülejäänud jätab samaks."""
    if not text:
        return ""
    return text[0].upper() + text[1:]


def get_label(value, lang='et'):
    """Tagastab sildi LinkedEntity objektist või stringist eelistatud keeles."""
    if not value:
        return ""
    if isinstance(value, str):
        return capitalize_first(value)
    if isinstance(value, dict):
        # Proovi leida silti konkreetses keeles
        labels = value.get('labels')
        if labels and isinstance(labels, dict):
            if labels.get(lang):
                return capitalize_first(labels[lang])
            # Fallback eesti keelele
            if labels.get('et'):
                return capitalize_first(labels['et'])
        
        # Fallback peamisele sildile
        return capitalize_first(value.get('label', ''))
    return capitalize_first(str(value))


def get_id(value):
    """Tagastab ID LinkedEntity objektist."""
    if isinstance(value, dict):
        return value.get('id')
    return None


def get_all_labels(value):
    """Kogub kõik sildid (sh mitmekeelsed) LinkedEntity objektist või massiivist."""
    if not value:
        return []
    
    values = value if isinstance(value, list) else [value]
    labels = []
    
    for val in values:
        if isinstance(val, str):
            labels.append(capitalize_first(val))
        elif isinstance(val, dict):
            # Peamine silt
            if val.get('label'):
                labels.append(capitalize_first(val['label']))
            # Mitmekeelsed sildid
            if val.get('labels') and isinstance(val['labels'], dict):
                for l in val['labels'].values():
                    if l:
                        labels.append(capitalize_first(l))
    
    return sorted(list(set(labels)))


def get_primary_labels(value):
    """Tagastab ainult peamised sildid LinkedEntity objektist või massiivist. Eelistab eesti keelt."""
    if not value:
        return []
    
    values = value if isinstance(value, list) else [value]
    labels = []
    
    for val in values:
        if isinstance(val, str):
            labels.append(capitalize_first(val))
        elif isinstance(val, dict):
            # Eelisjärjekord: et > label > esimene väärtus labels dictist
            label = None
            if val.get('labels') and isinstance(val['labels'], dict):
                label = val['labels'].get('et')
            
            if not label:
                label = val.get('label')
            
            if label:
                labels.append(capitalize_first(label))
                
    return labels


def get_labels_by_lang(value, lang):
    """Tagastab sildid konkreetses keeles (või fallback)."""
    if not value:
        return []
    
    values = value if isinstance(value, list) else [value]
    labels = []
    
    for val in values:
        if isinstance(val, str):
            # Stringi puhul ei tea keelt, tagastame alati (eeldades et on primaarne)
            labels.append(capitalize_first(val))
        elif isinstance(val, dict):
            label = None
            # Otsi konkreetses keeles
            if val.get('labels') and isinstance(val['labels'], dict):
                label = val['labels'].get(lang)
            
            # Fallback: primaarne label
            if not label:
                label = val.get('label')
            
            if label:
                labels.append(capitalize_first(label))
                
    return labels


def get_all_ids(value):
    """Kogub kõik ID-d LinkedEntity objektist või massiivist."""
    if not value:
        return []
    
    values = value if isinstance(value, list) else [value]
    ids = []
    
    for val in values:
        if isinstance(val, dict) and val.get('id'):
            ids.append(val['id'])
            
    return sorted(list(set(ids)))


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
        'collection': None,
        'collections_hierarchy': [],
        'title': 'Pealkiri puudub',
        'year': None,
        'location': None,
        'publisher': None,
        'creators': [],
        'authors_text': [],
        'tags': [],
        'languages': ['lat'],
        'ester_id': None,
        'external_url': None,
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
                result['collection'] = meta.get('collection')

                # Hierarhia laiendamine
                if result['collection']:
                    result['collections_hierarchy'] = get_collection_hierarchy(
                        collections, result['collection']
                    )

                # V1/V2 fallback: v2 esmalt, siis v1
                result['title'] = meta.get('title') or meta.get('pealkiri', result['title'])
                result['year'] = meta.get('year') or meta.get('aasta')
                result['location'] = meta.get('location') or meta.get('koht') or derive_place(result['year'])
                result['publisher'] = meta.get('publisher') or meta.get('trükkal') or derive_printer(result['year'])

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

    # Kui _metadata.json puudub, kasuta vaikeväärtusi
    print(f"⚠️  Puudub _metadata.json: {dir_name}")
    result['location'] = derive_place(result['year'])
    result['publisher'] = derive_printer(result['year'])

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
    print(f"Laetud {len(collections)} kollektsiooni")

    # Kogu andmed teose kaupa
    works_data = {}

    doc_dirs = sorted([d for d in os.listdir(DATA_ROOT_DIR)
                       if os.path.isdir(os.path.join(DATA_ROOT_DIR, d)) and not d.startswith('.')])

    for dir_name in tqdm(doc_dirs, desc="Teoste töötlemine"):
        doc_path = os.path.join(DATA_ROOT_DIR, dir_name)

        # Hangi metaandmed (v2 formaat)
        teose_id, doc_metadata = get_work_metadata(doc_path, dir_name, collections)

        # Leia pildifailid
        jpg_files = sorted([f for f in os.listdir(doc_path)
                           if f.lower().endswith(('.jpg', '.jpeg', '.png'))])
        if not jpg_files:
            continue

        teose_lehekylgede_arv = len(jpg_files)

        pages = []
        # Kasuta nanoid't page ID-s (kui olemas), muidu fallback slugile
        work_id = doc_metadata.get('id') or teose_id
        for page_index, jpg_filename in enumerate(jpg_files):
            page_id = f"{work_id}-{page_index + 1}"
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
                'status': 'Toores',
                'history': []
            }

            if os.path.exists(json_path):
                try:
                    with open(json_path, 'r', encoding='utf-8') as jf:
                        file_json = json.load(jf)
                        source = file_json.get('meta_content', file_json)
                        page_meta['tags'] = source.get('page_tags', source.get('tags', []))
                        page_meta['comments'] = source.get('comments', [])
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
                'work_id': doc_metadata.get('id'),  # Püsiv lühikood
                'teose_id': teose_id,               # Slug (tagasiühilduvus)

                # Teose andmed (lamedaks lüüdud otsinguks ja kuvamiseks)
                'title': doc_metadata.get('title', ''),
                'year': doc_metadata.get('year'),
                'location': get_label(doc_metadata.get('location')),
                'location_id': get_id(doc_metadata.get('location')),
                'publisher': get_label(doc_metadata.get('publisher')),
                'publisher_id': get_id(doc_metadata.get('publisher')),

                # Taksonoomia
                'type': get_label(doc_metadata.get('type', 'impressum')), # Vaikimisi (et)
                'type_et': get_labels_by_lang(doc_metadata.get('type', 'impressum'), 'et'),
                'type_en': get_labels_by_lang(doc_metadata.get('type', 'impressum'), 'en'),
                'type_object': doc_metadata.get('type'),
                
                'genre': get_label(doc_metadata.get('genre')), # Vaikimisi (et)
                'genre_et': get_labels_by_lang(doc_metadata.get('genre'), 'et'),
                'genre_en': get_labels_by_lang(doc_metadata.get('genre'), 'en'),
                'genre_object': doc_metadata.get('genre'),
                'genre_search': get_all_labels(doc_metadata.get('genre')),
                'genre_ids': get_all_ids(doc_metadata.get('genre')),
                
                'collection': doc_metadata.get('collection'),
                'collections_hierarchy': doc_metadata.get('collections_hierarchy', []),

                # Isikud
                'creators': doc_metadata.get('creators', []),
                'authors_text': doc_metadata.get('authors_text', []),
                'author_names': [c['name'] for c in doc_metadata.get('creators', []) if c.get('name') and c.get('role') != 'respondens'],
                'respondens_names': [c['name'] for c in doc_metadata.get('creators', []) if c.get('name') and c.get('role') == 'respondens'],
                'creator_ids': [c.get('id') for c in doc_metadata.get('creators', []) if c.get('id')],

                # Täiendav klassifikatsioon (märksõnad)
                'tags': get_primary_labels(doc_metadata.get('tags', [])), # Vaikimisi (et)
                'tags_et': get_labels_by_lang(doc_metadata.get('tags', []), 'et'),
                'tags_en': get_labels_by_lang(doc_metadata.get('tags', []), 'en'),
                'tags_object': doc_metadata.get('tags', []),
                'tags_search': get_all_labels(doc_metadata.get('tags')),
                'tags_ids': get_all_ids(doc_metadata.get('tags')),
                'languages': doc_metadata.get('languages', ['lat']),

                # Lehekülje andmed
                'teose_lehekylgede_arv': teose_lehekylgede_arv,
                'lehekylje_number': page_index + 1,
                'lehekylje_tekst': page_text,
                'lehekylje_pilt': image_path,
                'originaal_kataloog': dir_name,

                # Annotatsioonid ja staatus
                'page_tags': [l.lower() for l in get_primary_labels(page_meta.get('tags', []))],
                'page_tags_et': [l.lower() for l in get_labels_by_lang(page_meta.get('tags', []), 'et')],
                'page_tags_en': [l.lower() for l in get_labels_by_lang(page_meta.get('tags', []), 'en')],
                'page_tags_suggest_et': [
                    f"{get_label(t, 'et')}|||{t.get('id') if isinstance(t, dict) else ''}" 
                    for t in page_meta.get('tags', [])
                ],
                'page_tags_suggest_en': [
                    f"{get_label(t, 'en')}|||{t.get('id') if isinstance(t, dict) else ''}" 
                    for t in page_meta.get('tags', [])
                ],
                'page_tags_object': page_meta.get('tags', []),
                'comments': page_meta['comments'],
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

            # Tagasiühilduvus (ajutine - eemaldada hiljem)
            meili_doc['pealkiri'] = doc_metadata.get('title', '')
            meili_doc['aasta'] = doc_metadata.get('year')
            meili_doc['koht'] = get_label(doc_metadata.get('location'))
            meili_doc['trükkal'] = get_label(doc_metadata.get('publisher'))
            
            # V3 bibliograafia (täisobjektid dünaamilise UI jaoks)
            meili_doc['location'] = doc_metadata.get('location')
            meili_doc['publisher'] = doc_metadata.get('publisher')
            meili_doc['location_search'] = get_all_labels(doc_metadata.get('location'))
            meili_doc['publisher_search'] = get_all_labels(doc_metadata.get('publisher'))

            # Autor ja respondens (denormaliseeritud tagasiühilduvuseks)
            creators = doc_metadata.get('creators', [])
            
            # Autor: praeses > auctor > esimene mitterespondent
            autor_name = ''
            praeses = next((c for c in creators if c.get('role') == 'praeses'), None)
            auctor = next((c for c in creators if c.get('role') == 'auctor'), None)
            
            if praeses:
                autor_name = praeses.get('name', '')
            elif auctor:
                autor_name = auctor.get('name', '')
            elif creators:
                # Fallback: esimene isik, kes pole respondens
                first = next((c for c in creators if c.get('role') not in ['respondens', 'gratulator', 'dedicator']), None)
                if first:
                    autor_name = first.get('name', '')
            
            meili_doc['autor'] = autor_name
            
            respondents = [c for c in creators if c.get('role') == 'respondens']
            meili_doc['respondens'] = respondents[0]['name'] if respondents else ''

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
