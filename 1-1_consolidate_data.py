import os
import csv
import json
from tqdm import tqdm

# --- SEADISTUS ---
DATA_ROOT_DIR = 'data/04_sorditud_dokumendid'
METADATA_FILE = 'data/jaanson.tsv'
OUTPUT_FILE = 'output/meilisearch_data_per_page.jsonl'
METADATA_ID_COLUMN = 'fields_r_acad_code'
# --- LÕPP ---

def load_metadata(filepath):
    """Laeb TSV failist metaandmed."""
    metadata = {}
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

def create_meilisearch_data_per_page():
    metadata_db = load_metadata(METADATA_FILE)
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    print(f"Alustan andmete loomist lehekülje põhiselt faili '{OUTPUT_FILE}'...")

    # Esimene pass: kogu kõik leheküljed ja nende staatused teose kaupa
    works_data = {}  # teose_id -> list of page dicts
    
    doc_dirs = sorted([d for d in os.listdir(DATA_ROOT_DIR) if os.path.isdir(os.path.join(DATA_ROOT_DIR, d))])
    
    for dir_name in tqdm(doc_dirs, desc="Teoste töötlemine"):
        doc_path = os.path.join(DATA_ROOT_DIR, dir_name)
        try:
            key_parts = dir_name.split('-', 2)
            lookup_key = f"{key_parts[0]}-{key_parts[1]}"
        except IndexError:
            continue

        doc_metadata = metadata_db.get(lookup_key)
        if not doc_metadata:
            continue

        # Lähtume PILTIDEST (jpg), mitte txt failidest
        # See tagab, et kui pilte kustutati või järjekorda muudeti, kajastub see ka andmetes
        jpg_files = sorted([f for f in os.listdir(doc_path) if f.endswith('.jpg')])
        if not jpg_files:
            continue

        # UUED VÄLJAD: eraldi autor ja respondens + lehekülgede arv
        autor = doc_metadata.get('autor', '')
        respondens = doc_metadata.get('respondens', '')
        teose_lehekylgede_arv = len(jpg_files)  # Lehekülgede arv = jpg failide arv

        pages = []
        for page_index, jpg_filename in enumerate(jpg_files):
            page_id = f"{lookup_key}-{page_index + 1}"
            
            # Txt fail on sama nimega kui jpg
            txt_filename = jpg_filename.replace('.jpg', '.txt')
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
            json_filename = jpg_filename.replace('.jpg', '.json')
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
                'teose_id': lookup_key,
                'pealkiri': doc_metadata.get('pealkiri', 'Pealkiri puudub'),
                'autor': autor,
                'respondens': respondens,
                'teose_lehekylgede_arv': teose_lehekylgede_arv,
                'aasta': int(doc_metadata.get('aasta', 0)),
                'lehekylje_number': page_index + 1,
                'lehekylje_tekst': page_text,
                'lehekylje_pilt': image_path,
                'originaal_kataloog': dir_name,
                'tags': extra_data['tags'],
                'comments': extra_data['comments'],
                'status': extra_data['status'],
                'history': extra_data['history'],
                'last_modified': last_mod
            }
            
            pages.append(meili_doc)
        
        works_data[lookup_key] = pages

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