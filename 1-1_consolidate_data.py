import os
import csv
import json
import re
import unicodedata
from tqdm import tqdm

# --- SEADISTUS ---
DATA_ROOT_DIR = 'data/04_sorditud_dokumendid'
METADATA_FILE = 'data/jaanson.tsv'
OUTPUT_FILE = 'output/meilisearch_data_per_page.jsonl'
METADATA_ID_COLUMN = 'fields_r_acad_code'
# --- LÕPP ---

def sanitize_id(text):
    """Puhastab teksti, et see sobiks Meilisearchi dokumendi ID-ks.
    
    Meilisearch lubab ainult: a-z A-Z 0-9, sidekriipsud (-) ja alakriipsud (_).
    Eemaldab diakriitikud (å→a, ö→o jne) ja asendab muud märgid alakriipsuga.
    """
    # Eemalda diakriitikud (NFD normaliseerib, siis eemaldame combining marks)
    normalized = unicodedata.normalize('NFD', text)
    ascii_text = ''.join(c for c in normalized if unicodedata.category(c) != 'Mn')
    
    # Asenda kõik mitte-lubatud märgid alakriipsuga
    sanitized = re.sub(r'[^a-zA-Z0-9_-]', '_', ascii_text)
    
    # Eemalda mitu järjestikust alakriipsu
    sanitized = re.sub(r'_+', '_', sanitized)
    
    # Eemalda algus- ja lõpukriipsud
    sanitized = sanitized.strip('_-')
    
    return sanitized

def load_metadata(filepath):
    """Laeb TSV failist metaandmed."""
    metadata = {}
    if not os.path.exists(filepath):
        print(f"Hoiatus: Metaandmete fail '{filepath}' puudub, jätkan ilma.")
        return metadata
    with open(filepath, mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter='\t')
        for row in reader:
            raw_id = row.get(METADATA_ID_COLUMN, "").strip()
            if not raw_id:
                continue
            try:
                key_part = raw_id.split(' ')[-1]
                lookup_key = key_part.replace(':', '-')
                metadata[lookup_key] = row
            except IndexError:
                continue
    return metadata

def calculate_work_status(page_statuses):
    """Arvutab teose koondstaatuse lehekülgede staatuste põhjal.
    
    Loogika: Kõik Valmis → Valmis, Kõik Toores → Toores, muidu → Töös
    """
    if not page_statuses:
        return 'Toores'
    
    if all(s == 'Valmis' for s in page_statuses):
        return 'Valmis'
    
    if all(s == 'Toores' or not s for s in page_statuses):
        return 'Toores'
    
    return 'Töös'

def normalize_genre(tag):
    """Normaliseerib žanri väärtuse 'disputatsioon'-iks, kui see on üks sünonüümidest."""
    synonyms = ["dissertatsioon", "exercitatio", "teesid", "dissertatio", "theses", "disputatio"]
    if tag and tag.strip().lower() in synonyms:
        return "disputatsioon"
    return tag

def derive_teose_tags_from_title(title):
    """Tuletab teose märksõnad pealkirjast (automaatne).
    
    Näide: "Disputatio de anima..." → ['disputatsioon']
    """
    if not title:
        return []
    
    title_lower = title.lower().strip()
    tags = []
    
    # Žanri tuletamine pealkirja alguse järgi
    genre_patterns = [
        (r'^disputatio\b', 'disputatsioon'),
        (r'^oratio\b', 'oratsioon'),
        (r'^carmen\b', 'carmen'),
        (r'^programma\b', 'programm'),
        (r'^epicedium\b', 'epicedium'),
        (r'^theses\b', 'disputatsioon'),
        (r'^exercitatio\b', 'disputatsioon'),
        (r'^dissertatio\b', 'disputatsioon'),
    ]
    
    for pattern, tag in genre_patterns:
        if re.match(pattern, title_lower):
            tags.append(tag)
            break  # Ainult üks žanr
    
    return tags

def get_work_metadata(doc_path, dir_name, tsv_metadata):
    """Saab teose metaandmed prioriteedi järgi:
    1. _metadata.json (kui olemas)
    2. jaanson.tsv (vana süsteem)
    3. Vaikeväärtused katalooginimest
    
    Tagastab: (teose_id, metadata_dict)
    """
    metadata_json_path = os.path.join(doc_path, '_metadata.json')
    
    # Vaikeväärtused
    result = {
        'pealkiri': 'Pealkiri puudub',
        'autor': '',
        'respondens': '',
        'aasta': 0,
        'teose_tags': [],
        'ester_id': None,
        'external_url': None,
    }
    teose_id = sanitize_id(dir_name)  # Vaikimisi kataloogi nimi (sanitiseeritud)
    
    # 1. Proovi _metadata.json (kõrgeim prioriteet)
    metadata_exists = os.path.exists(metadata_json_path)
    if metadata_exists:
        try:
            with open(metadata_json_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
                teose_id = sanitize_id(meta.get('teose_id', dir_name))
                result['pealkiri'] = meta.get('pealkiri', result['pealkiri'])
                result['autor'] = meta.get('autor', result['autor'])
                result['respondens'] = meta.get('respondens', result['respondens'])
                result['aasta'] = int(meta.get('aasta', 0)) if meta.get('aasta') else 0
                
                raw_tags = meta.get('teose_tags', [])
                if not isinstance(raw_tags, list):
                    raw_tags = [raw_tags] if raw_tags else []
                
                normalized_tags = sorted(list(set([normalize_genre(t) for t in raw_tags])))
                result['teose_tags'] = normalized_tags
                result['ester_id'] = meta.get('ester_id')
                result['external_url'] = meta.get('external_url')
                
                # Kui tagid muutusid normaliseerimise käigus, uuendame faili, et "ground truth" oleks puhas
                if raw_tags != normalized_tags:
                    meta['teose_tags'] = normalized_tags
                    try:
                        with open(metadata_json_path, 'w', encoding='utf-8') as f:
                            json.dump(meta, f, ensure_ascii=False, indent=2)
                        print(f"Normaliseeritud tagid failis: {metadata_json_path}")
                    except Exception as e:
                        print(f"Viga faili uuendamisel: {e}")

                return teose_id, result
        except json.JSONDecodeError as e:
            print(f"!!! SÜNTAKSI VIGA: Failis {metadata_json_path} on vigane JSON (rida {e.lineno}, veerg {e.colno}).")
            print(f"    Veendu, et kõik väärtused on jutumärkides, nt: \"teose_tags\": [\"plakat\"]")
            return teose_id, result
        except Exception as e:
            print(f"Viga _metadata.json lugemisel {metadata_json_path}: {e}")
            # Kui fail on olemas aga vigane, tagastame vaikeväärtused aga EI liigu edasi legacy koodi juurde
            return teose_id, result
    
    # 2. Kui ground truth puudub, proovi legacy allikaid (jaanson.tsv)
    if not metadata_exists:
        found_in_tsv = False
        try:
            # Otsime vastet TSV-st (AAAA-N formaat)
            for lookup_key, doc_meta in tsv_metadata.items():
                if dir_name.startswith(lookup_key):
                    teose_id = sanitize_id(lookup_key)
                    result['pealkiri'] = doc_meta.get('pealkiri', result['pealkiri'])
                    result['autor'] = doc_meta.get('autor', result['autor'])
                    result['respondens'] = doc_meta.get('respondens', result['respondens'])
                    result['aasta'] = int(doc_meta.get('aasta', 0)) if doc_meta.get('aasta') else 0
                    found_in_tsv = True
                    break
        except (IndexError, ValueError):
            pass

        # 3. Kui TSV-st ei leitud, tuletame andmed kataloogi nimest
        if not found_in_tsv:
            # Pealkiri kataloogi nimest (eemaldame aastaarvu ja ID osa)
            clean_title = re.sub(r'^\d{4}[-_]\d+[-_]?', '', dir_name) # AAAA-N-
            if clean_title == dir_name:
                clean_title = re.sub(r'^\d{4}[-_]?', '', dir_name) # AAAA-
            
            if clean_title:
                result['pealkiri'] = clean_title.replace('-', ' ').replace('_', ' ').strip().capitalize()
            
            if result['aasta'] == 0:
                year_match = re.match(r'^(\d{4})', dir_name)
                if year_match:
                    result['aasta'] = int(year_match.group(1))

        # Automaatne tagide tuletamine (kui neid veel pole)
        if not result['teose_tags'] and result['pealkiri'] != 'Pealkiri puudub':
            result['teose_tags'] = derive_teose_tags_from_title(result['pealkiri'])

        # --- AUTOMAATNE SALVESTAMINE (AINULT ESMAKORDSELT) ---
        try:
            save_data = result.copy()
            save_data['teose_id'] = teose_id
            # Normaliseerime tagid ka salvestamisel, et esimene fail oleks puhas
            save_data['teose_tags'] = sorted(list(set([normalize_genre(t) for t in save_data['teose_tags']])))
            
            with open(metadata_json_path, 'w', encoding='utf-8') as f:
                json.dump(save_data, f, ensure_ascii=False, indent=2)
            print(f"Loodud uus ground truth: {metadata_json_path}")
        except Exception as e:
            print(f"Viga _metadata.json loomisel {metadata_json_path}: {e}")

    return teose_id, result

def create_meilisearch_data_per_page():
    metadata_db = load_metadata(METADATA_FILE)
    if not os.path.exists(DATA_ROOT_DIR):
        print(f"VIGA: Andmete juurkausta '{DATA_ROOT_DIR}' ei leitud!")
        return

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    print(f"Alustan andmete loomist lehekülje põhiselt faili '{OUTPUT_FILE}'...")

    # Esimene pass: kogu kõik leheküljed ja nende staatused teose kaupa
    works_data = {}  # teose_id -> list of page dicts
    
    doc_dirs = sorted([d for d in os.listdir(DATA_ROOT_DIR) if os.path.isdir(os.path.join(DATA_ROOT_DIR, d))])
    
    for dir_name in tqdm(doc_dirs, desc="Teoste töötlemine"):
        doc_path = os.path.join(DATA_ROOT_DIR, dir_name)
        
        # Kasuta uut metaandmete hankimise funktsiooni
        # Prioriteet: _metadata.json → jaanson.tsv → vaikeväärtused
        teose_id, doc_metadata = get_work_metadata(doc_path, dir_name, metadata_db)

        # Lähtume PILTIDEST (jpg/png), mitte txt failidest
        # See tagab, et kui pilte kustutati või järjekorda muudeti, kajastub see ka andmetes
        jpg_files = sorted([f for f in os.listdir(doc_path) if f.lower().endswith(('.jpg', '.jpeg', '.png'))])
        if not jpg_files:
            continue

        # Metaandmed doc_metadata sõnastikust
        autor = doc_metadata.get('autor', '')
        respondens = doc_metadata.get('respondens', '')
        teose_lehekylgede_arv = len(jpg_files)  # Lehekülgede arv = jpg failide arv
        teose_tags = doc_metadata.get('teose_tags', [])
        ester_id = doc_metadata.get('ester_id')
        external_url = doc_metadata.get('external_url')

        pages = []
        for page_index, jpg_filename in enumerate(jpg_files):
            page_id = f"{teose_id}-{page_index + 1}"
            
            base_name = os.path.splitext(jpg_filename)[0]
            # Txt fail on sama nimega kui jpg
            txt_filename = base_name + '.txt'
            txt_path = os.path.join(doc_path, txt_filename)
            
            # 1. Loeme teksti (kui txt fail eksisteerib)
            page_text = ""
            if os.path.exists(txt_path):
                try:
                    with open(txt_path, 'r', encoding='utf-8') as f:
                        page_text = f.read()
                except Exception:
                    page_text = ""
            
            # 2. Otsime metaandmeid (JSON failist, mis on sama nimega nagu jpg/txt)
            json_filename = base_name + '.json'
            json_path = os.path.join(doc_path, json_filename)
            
            extra_data = {
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
                        
                        extra_data['tags'] = source.get('tags', [])
                        extra_data['comments'] = source.get('comments', [])
                        extra_data['status'] = source.get('status', 'Toores')
                        extra_data['history'] = source.get('history', [])
                        
                        if 'text_content' in file_json and file_json['text_content']:
                            page_text = file_json['text_content']
                except Exception as e:
                    print(f"Viga JSON lugemisel {json_path}: {e}")

            image_path = os.path.join(dir_name, jpg_filename)
            
            # last_modified: kasutame txt faili muutmisaega kui eksisteerib, muidu jpg
            if os.path.exists(txt_path):
                last_mod = int(os.path.getmtime(txt_path) * 1000)
            else:
                last_mod = int(os.path.getmtime(os.path.join(doc_path, jpg_filename)) * 1000)
        
            # Koostame Meilisearch dokumendi (ilma teose_staatus'eta, lisame hiljem)
            meili_doc = {
                'id': page_id,
                'teose_id': teose_id,
                'pealkiri': doc_metadata.get('pealkiri', 'Pealkiri puudub'),
                'autor': autor,
                'respondens': respondens,
                'teose_lehekylgede_arv': teose_lehekylgede_arv,
                'aasta': doc_metadata.get('aasta', 0),
                'lehekylje_number': page_index + 1,
                'lehekylje_tekst': page_text,
                'lehekylje_pilt': image_path,
                'originaal_kataloog': dir_name,
                'tags': extra_data['tags'],
                'comments': extra_data['comments'],
                'status': extra_data['status'],
                'history': extra_data['history'],
                'last_modified': last_mod,
                'teose_tags': teose_tags,
            }
            
            # Lisa ESTER väljad ainult kui need on olemas
            if ester_id:
                meili_doc['ester_id'] = ester_id
            if external_url:
                meili_doc['external_url'] = external_url
            
            pages.append(meili_doc)
        
        works_data[teose_id] = pages

    # Teine pass: arvuta teose_staatus ja kirjuta väljund
    print(f"\nArvutan teose staatused ja kirjutan väljundfaili...")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as outfile:
        for teose_id, pages in works_data.items():
            # Arvuta teose koondstaatus kõigi lehekülgede staatuste põhjal
            page_statuses = [p['status'] for p in pages]
            teose_staatus = calculate_work_status(page_statuses)
            
            # Lisa teose_staatus igale leheküljele ja kirjuta faili
            for meili_doc in pages:
                meili_doc['teose_staatus'] = teose_staatus
                outfile.write(json.dumps(meili_doc, ensure_ascii=False) + '\n')

    print(f"\nValmis! Andmefail '{OUTPUT_FILE}' on loodud koos annotatsioonide ja teose staatustega.")

if __name__ == '__main__':
    create_meilisearch_data_per_page()