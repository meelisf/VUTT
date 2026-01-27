"""
Meilisearch operatsioonid ja sünkroonimine.
"""
import os
import json
import time
import urllib.request
import urllib.parse
from .config import BASE_DIR, MEILI_URL, MEILI_KEY, INDEX_NAME, COLLECTIONS_FILE
from .utils import (
    sanitize_id, generate_default_metadata, normalize_genre, 
    calculate_work_status, get_label, get_id, get_all_labels, get_all_ids, get_primary_labels,
    get_labels_by_lang
)
from .git_ops import commit_new_work_to_git


def load_collections():
    """Laeb kollektsioonide hierarhia."""
    if os.path.exists(COLLECTIONS_FILE):
        try:
            with open(COLLECTIONS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {}


def get_collection_hierarchy(collections, collection_id):
    """Tagastab kollektsiooni hierarhia (vanematest lapseni)."""
    if not collection_id or not collections:
        return []

    hierarchy = []
    current_id = collection_id

    while current_id:
        hierarchy.insert(0, current_id)
        collection = collections.get(current_id)
        current_id = collection.get('parent') if collection else None

    return hierarchy


def wait_for_task(task_uid, timeout=30):
    """Ootab Meilisearchi taski lõppu.

    Args:
        task_uid: Meilisearchi taski ID
        timeout: Maksimaalne ooteaeg sekundites

    Returns:
        True kui task õnnestus, False kui ebaõnnestus või timeout
    """
    url = f"{MEILI_URL}/tasks/{task_uid}"
    start_time = time.time()

    while time.time() - start_time < timeout:
        try:
            req = urllib.request.Request(url)
            req.add_header('Authorization', f'Bearer {MEILI_KEY}')

            with urllib.request.urlopen(req) as response:
                task_data = json.loads(response.read().decode('utf-8'))
                status = task_data.get('status')

                if status == 'succeeded':
                    elapsed = time.time() - start_time
                    print(f"Meilisearch task {task_uid} õnnestus ({elapsed:.2f}s)")
                    return True
                elif status == 'failed':
                    print(f"Meilisearch task {task_uid} ebaõnnestus: {task_data.get('error')}")
                    return False
                # status on 'enqueued' või 'processing' - ootame edasi
        except Exception as e:
            print(f"Viga taski staatuse kontrollimisel: {e}")
            return False

        time.sleep(0.1)  # Oota 100ms enne järgmist kontrolli

    print(f"Meilisearch task timeout ({timeout}s)")
    return False


def send_to_meilisearch(documents, wait=True):
    """Saadab dokumendid Meilisearchi kasutades urllib-i.

    Args:
        documents: Dokumentide list
        wait: Kui True, ootab kuni indekseerimine on lõppenud
    """
    if not MEILI_KEY:
        print("HOIATUS: Meilisearchi võti puudub, ei saa indekseerida.")
        return False

    url = f"{MEILI_URL}/indexes/{INDEX_NAME}/documents"
    try:
        data = json.dumps(documents).encode('utf-8')
        req = urllib.request.Request(url, data=data, method='POST')
        req.add_header('Content-Type', 'application/json')
        req.add_header('Authorization', f'Bearer {MEILI_KEY}')

        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            task_uid = res_data.get('taskUid')
            print(f"Meilisearch task: {task_uid}")

            if wait and task_uid:
                return wait_for_task(task_uid)
            return True
    except Exception as e:
        print(f"Viga Meilisearchi saatmisel: {e}")
        return False


def sync_work_to_meilisearch(dir_name):
    """
    Sünkroonib ühe teose kõik leheküljed Meilisearchi.
    Loeb andmed failisüsteemist (_metadata.json, pildid, .txt, .json).
    """
    dir_path = os.path.join(BASE_DIR, dir_name)
    if not os.path.exists(dir_path):
        print(f"SÜNK: Kausta ei leitud: {dir_path}")
        return False

    # 1. Lae teose metaandmed
    meta_path = os.path.join(dir_path, '_metadata.json')
    metadata = {}
    if os.path.exists(meta_path):
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
        except Exception as e:
            print(f"SÜNK: Viga metaandmete lugemisel: {e}")
            return False

    if not metadata:
        metadata = generate_default_metadata(dir_name)

    # =================================================================
    # V2 FORMAAT (esmane) koos v1 fallback'iga turvavõrguna
    # v2 = title, year, tags, location, publisher, creators[]
    # v1 = pealkiri, aasta, teose_tags, koht, trükkal, autor, respondens
    # =================================================================
    work_id = metadata.get('id')  # Nanoid (püsiv lühikood)
    teose_id = metadata.get('slug') or metadata.get('teose_id', sanitize_id(dir_name))
    pealkiri = metadata.get('title') or metadata.get('pealkiri', 'Pealkiri puudub')
    aasta = metadata.get('year') or metadata.get('aasta', 0)

    # Autor ja respondens: v2=creators massiiv, v1=otsene (fallback)
    creators = metadata.get('creators', [])
    autor = ''
    respondens = ''
    if creators:
        # Prioriteet: praeses > auctor > esimene isik
        praeses = next((c for c in creators if c.get('role') == 'praeses'), None)
        auctor = next((c for c in creators if c.get('role') == 'auctor'), None)
        resp = next((c for c in creators if c.get('role') == 'respondens'), None)
        if praeses:
            autor = praeses.get('name', '')
        elif auctor:
            autor = auctor.get('name', '')
        elif creators:
            # Fallback: esimene isik, kui pole praeses ega auctor
            first_creator = creators[0]
            if first_creator.get('role') not in ['respondens', 'gratulator', 'dedicator']:
                autor = first_creator.get('name', '')
        if resp:
            respondens = resp.get('name', '')
    # v1 fallback
    if not autor:
        autor = metadata.get('autor', '')
    if not respondens:
        respondens = metadata.get('respondens', '')

    # Tags: v2=tags, v1=teose_tags (fallback)
    teose_tags = metadata.get('tags') or metadata.get('teose_tags', [])
    if isinstance(teose_tags, list):
        teose_tags = [normalize_genre(t) for t in teose_tags]

    # Kollektsioon
    collection = metadata.get('collection')
    collections = load_collections()
    collections_hierarchy = get_collection_hierarchy(collections, collection)

    ester_id = metadata.get('ester_id')
    external_url = metadata.get('external_url')
    # Koht ja trükkal: v2=location/publisher, v1=koht/trükkal (fallback)
    koht = metadata.get('location') or metadata.get('koht')
    trükkal = metadata.get('publisher') or metadata.get('trükkal')

    # Type ja genre (v2 väljad)
    work_type = metadata.get('type')  # impressum / manuscriptum
    genre = metadata.get('genre')  # disputatio, oratio, carmen, jne
    languages = metadata.get('languages', [])

    # 2. Leia leheküljed (pildid)
    images = sorted([f for f in os.listdir(dir_path) if f.lower().endswith(('.jpg', '.jpeg', '.png'))])
    if not images:
        print(f"SÜNK: Pilte ei leitud kaustas: {dir_name}")
        return False

    documents = []
    page_statuses = []

    # Dokumendi ID = nanoid + lehekülje number (nt "cymbv7-1")
    # Peab vastama 1-1_consolidate_data.py loogikale!
    if not work_id:
        print(f"HOIATUS: Teosel {dir_name} puudub nanoid (_metadata.json 'id' väli)")
        work_id = teose_id  # Fallback slugile

    for i, img_name in enumerate(images):
        page_num = i + 1
        page_id = f"{work_id}-{page_num}"
        base_name = os.path.splitext(img_name)[0]

        # Tekst
        txt_path = os.path.join(dir_path, base_name + '.txt')
        page_text = ""
        if os.path.exists(txt_path):
            try:
                with open(txt_path, 'r', encoding='utf-8') as f:
                    page_text = f.read()
            except:
                pass

        # Lehekülje meta (status, tags, comments)
        json_path = os.path.join(dir_path, base_name + '.json')
        page_meta = {
            'status': 'Toores',
            'tags': [],
            'comments': [],
            'history': []
        }
        if os.path.exists(json_path):
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    p_data = json.load(f)
                    # Toeta nii vana kui uut formaati (meta_content wrapper)
                    source = p_data.get('meta_content', p_data)
                    page_meta['status'] = source.get('status', 'Toores')
                    # Eelistame uut nime 'page_tags'
                    page_meta['tags'] = source.get('page_tags', source.get('tags', []))
                    page_meta['comments'] = source.get('comments', [])
                    page_meta['history'] = source.get('history', [])
                    # Kui JSON-is on tekst ja failis pole, kasuta JSON-it
                    if not page_text and 'text_content' in p_data:
                        page_text = p_data['text_content']
            except:
                pass

        page_statuses.append(page_meta['status'])

        doc = {
            "id": page_id,
            "work_id": work_id,  # Nanoid (püsiv lühikood)
            "teose_id": teose_id,
            "pealkiri": pealkiri,
            "title": pealkiri,
            "autor": autor,
            "respondens": respondens,
            "aasta": aasta,
            "year": aasta,
            "lehekylje_number": page_num,
            "teose_lehekylgede_arv": len(images),
            "lehekylje_tekst": page_text,
            "lehekylje_pilt": os.path.join(dir_name, img_name),
            "originaal_kataloog": dir_name,
            "status": page_meta['status'],
            "page_tags": [l.lower() for l in get_primary_labels(page_meta.get('page_tags', page_meta.get('tags', [])))],
            "page_tags_et": [l.lower() for l in get_labels_by_lang(page_meta.get('page_tags', page_meta.get('tags', [])), 'et')],
            "page_tags_en": [l.lower() for l in get_labels_by_lang(page_meta.get('page_tags', page_meta.get('tags', [])), 'en')],
            "page_tags_suggest_et": [
                f"{get_label(t, 'et')}|||{t.get('id') if isinstance(t, dict) else ''}" 
                for t in page_meta.get('page_tags', page_meta.get('tags', []))
            ],
            "page_tags_suggest_en": [
                f"{get_label(t, 'en')}|||{t.get('id') if isinstance(t, dict) else ''}" 
                for t in page_meta.get('page_tags', page_meta.get('tags', []))
            ],
            "page_tags_object": page_meta.get('page_tags', page_meta.get('tags', [])),
            "comments": page_meta['comments'],
            "history": page_meta['history'],
            "last_modified": int(os.path.getmtime(txt_path if os.path.exists(txt_path) else os.path.join(dir_path, img_name)) * 1000),
            "tags": get_primary_labels(teose_tags), # Faceti jaoks stringide massiiv (et)
            "tags_et": get_labels_by_lang(teose_tags, 'et'),
            "tags_en": get_labels_by_lang(teose_tags, 'en'),
            "tags_object": teose_tags,
            "tags_search": get_all_labels(teose_tags),
            "tags_ids": get_all_ids(teose_tags),
            "collection": collection,
            "collections_hierarchy": collections_hierarchy,
            "location": get_label(koht),
            "location_object": koht,
            "location_id": get_id(koht),
            "location_search": get_all_labels(koht),
            "publisher": get_label(trükkal),
            "publisher_object": trükkal,
            "publisher_id": get_id(trükkal),
            "publisher_search": get_all_labels(trükkal),
            "genre": get_label(genre),
            "genre_et": get_labels_by_lang(genre, 'et'),
            "genre_en": get_labels_by_lang(genre, 'en'),
            "genre_object": genre,
            "genre_search": get_all_labels(genre),
            "genre_ids": get_all_ids(genre),
            "type": get_label(work_type),
            "type_et": get_labels_by_lang(work_type, 'et'),
            "type_en": get_labels_by_lang(work_type, 'en'),
            "type_object": work_type,
            "languages": languages,
            "creators": creators,
            "authors_text": [c['name'] for c in creators if c.get('name')],
            # Rolliga eraldatud väljad filtreerimiseks
            "author_names": [c['name'] for c in creators if c.get('name') and c.get('role') != 'respondens'],
            "respondens_names": [c['name'] for c in creators if c.get('name') and c.get('role') == 'respondens'],
            "creator_ids": [c.get('id') for c in creators if c.get('id')]
        }

        if ester_id:
            doc['ester_id'] = ester_id
        if external_url:
            doc['external_url'] = external_url
        
        # Tagasiühilduvus
        doc['koht'] = get_label(koht)
        doc['trükkal'] = get_label(trükkal)

        documents.append(doc)

    # 3. Arvuta teose koondstaatus
    teose_staatus = calculate_work_status(page_statuses)
    for doc in documents:
        doc['teose_staatus'] = teose_staatus

    # 4. Saada Meilisearchi
    if documents:
        print(f"AUTOMAATNE SÜNK: Teos {teose_id} ({len(documents)} lk), staatus: {teose_staatus}")
        return send_to_meilisearch(documents)
    return False


def index_new_work(dir_name, metadata):
    """Loob lehekülgede dokumendid ja saadab Meilisearchi."""
    return sync_work_to_meilisearch(dir_name)


def metadata_watcher_loop():
    """Taustalõim, mis otsib uusi kaustu ja loob neile metaandmed."""
    print(f"Metaandmete jälgija käivitatud (kataloog: {BASE_DIR})")
    while True:
        try:
            if not os.path.exists(BASE_DIR):
                time.sleep(60)
                continue

            for entry in os.scandir(BASE_DIR):
                # Ignoreeri peidetud kaustu (nt .git)
                if entry.is_dir() and not entry.name.startswith('.'):
                    meta_path = os.path.join(entry.path, '_metadata.json')
                    if not os.path.exists(meta_path):
                        # Kontrolli kas kaust on "stabiilne" (pole muutunud viimase 60 sek jooksul)
                        # See annab aega aeglasele kopeerimisele lõpule jõuda
                        dir_mtime = entry.stat().st_mtime
                        age_seconds = time.time() - dir_mtime
                        if age_seconds < 60:
                            continue  # Kaust on liiga uus, oota veel

                        # Kontrollime kas on pilte
                        has_images = False
                        for f in os.listdir(entry.path):
                            if f.lower().endswith(('.jpg', '.jpeg', '.png')):
                                has_images = True
                                break

                        if has_images:
                            try:
                                metadata = generate_default_metadata(entry.name)
                                with open(meta_path, 'w', encoding='utf-8') as f:
                                    json.dump(metadata, f, ensure_ascii=False, indent=2)
                                print(f"AUTOMAATNE METADATA: Loodud fail {meta_path}")

                                # Indekseeri kohe Meilisearchis
                                index_new_work(entry.name, metadata)

                                # Lisa txt failid Giti originaal-OCR commitina
                                commit_new_work_to_git(entry.name)
                            except Exception as e:
                                print(f"Viga metaandmete loomisel ({entry.name}): {e}")

            # Oota 60 sekundit järgmise skannimiseni
            time.sleep(60)
        except Exception as e:
            print(f"Jälgija viga: {e}")
            time.sleep(60)
