"""
Meilisearch operatsioonid ja sünkroonimine.

=============================================================================
ANDMEKIHTIDE ARHITEKTUUR
=============================================================================

See fail vastutab _metadata.json → Meilisearch kaardistamise eest.

    _metadata.json     →  Meilisearch indeks
    ─────────────────────────────────────────
    title              →  title
    year               →  year + aasta (aasta filtrite jaoks)
    location           →  location + location_object
    publisher          →  publisher + publisher_object
    creators[]         →  creators + autor + respondens + author_names + respondens_names
    tags[]             →  tags + tags_et + tags_en + tags_object
    genre              →  genre + genre_et + genre_en + genre_object
    id (nanoid)        →  work_id

Eestikeelsed väljad mis JÄÄVAD (filtrite/sortimise jaoks):
- aasta, lehekylje_number, originaal_kataloog, autor, respondens

Eestikeelsed väljad mis EEMALDATUD:
- pealkiri (kasuta title), koht (kasuta location), trükkal (kasuta publisher)

Vt docs/DATA_ARCHITECTURE.md täieliku ülevaate jaoks.
=============================================================================
"""
import os
import json
import time
import urllib.request
import urllib.parse
from .config import BASE_DIR, MEILI_URL, MEILI_KEY, INDEX_NAME, COLLECTIONS_FILE
from .utils import (
    atomic_write_json,
    sanitize_id, generate_default_metadata, normalize_genre,
    calculate_work_status, get_label, get_id, get_all_labels, get_all_ids, get_primary_labels,
    get_labels_by_lang
)

# Meilisearch päringu timeout sekundites
MEILI_TIMEOUT = 10
from .git_ops import commit_new_work_to_git

PEOPLE_FILE = os.path.join(BASE_DIR, 'state', 'people.json')


def load_people_aliases():
    """Laeb inimeste aliased JSON failist."""
    if os.path.exists(PEOPLE_FILE):
        try:
            with open(PEOPLE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {}


def get_creator_aliases(creators, people_data):
    """Leiab isikutele aliased (nimevariandid)."""
    aliases = []
    for creator in creators:
        creator_id = creator.get('id')
        # Otsi ID järgi (nt Q123)
        if creator_id and people_data.get(creator_id):
            person = people_data[creator_id]
            if person.get('aliases'):
                aliases.extend(person['aliases'])
    return aliases


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

            with urllib.request.urlopen(req, timeout=MEILI_TIMEOUT) as response:
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

        with urllib.request.urlopen(req, timeout=MEILI_TIMEOUT) as response:
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

    # Metaandmed (v3 formaat: LinkedEntity objektid)
    work_id = metadata.get('id')  # Nanoid (püsiv lühikood)
    slug = metadata.get('slug', sanitize_id(dir_name))
    title = metadata.get('title', 'Pealkiri puudub')
    year = metadata.get('year', 0)

    # Autor ja respondens creators massiivist
    creators = metadata.get('creators', [])
    autor = ''
    respondens = ''
    if creators:
        # Prioriteet: auctor > praeses > esimene isik
        praeses = next((c for c in creators if c.get('role') == 'praeses'), None)
        auctor = next((c for c in creators if c.get('role') == 'auctor'), None)
        resp = next((c for c in creators if c.get('role') == 'respondens'), None)
        if auctor:
            autor = auctor.get('name', '')
        elif praeses:
            autor = praeses.get('name', '')
        elif creators:
            first_creator = creators[0]
            if first_creator.get('role') not in ['respondens', 'gratulator', 'dedicator']:
                autor = first_creator.get('name', '')
        if resp:
            respondens = resp.get('name', '')

    # Tags (LinkedEntity objektide massiiv või stringid)
    tags = metadata.get('tags', [])
    if isinstance(tags, list):
        tags = [normalize_genre(t) for t in tags]

    # Kollektsioon
    collection = metadata.get('collection')
    collections = load_collections()
    collections_hierarchy = get_collection_hierarchy(collections, collection)

    ester_id = metadata.get('ester_id')
    external_url = metadata.get('external_url')
    location = metadata.get('location')
    publisher = metadata.get('publisher')
    work_type = metadata.get('type')
    genre = metadata.get('genre')
    languages = metadata.get('languages', [])

    # 2. Leia leheküljed (pildid)
    # NB: Lehekülje number (page_num) tuleneb pildi POSITSIOONIST tähestikuliselt
    # sorteeritud nimekirjas, MITTE failinimest. See võimaldab lehekülgi ümber
    # järjestada (nt kui avastatakse puuduv lk) ilma failinimesid muutmata.
    # Näide: 001.jpg=lk1, 002.jpg=lk2. Kui lisada 001a.jpg, siis: 001.jpg=lk1, 001a.jpg=lk2, 002.jpg=lk3
    images = sorted([f for f in os.listdir(dir_path) if f.lower().endswith(('.jpg', '.jpeg', '.png')) and not f.startswith('_thumb_')])
    if not images:
        print(f"SÜNK: Pilte ei leitud kaustas: {dir_name}")
        return False

    documents = []
    page_statuses = []

    # Dokumendi ID = nanoid + lehekülje number (nt "cymbv7-1")
    if not work_id:
        print(f"HOIATUS: Teosel {dir_name} puudub nanoid (_metadata.json 'id' väli)")
        work_id = slug  # Fallback slugile

    # Lae inimeste aliased ÜKS KORD enne tsüklit (mitte iga lehe kohta!)
    people_data = load_people_aliases()

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

    # NB: page_meta['tags'] sisaldab lehekülje märksõnu (loetud page_tags väljalt)
        page_tags_data = page_meta.get('tags', [])

        # Kasuta eellaetud people_data (laetud enne tsüklit)
        aliases = get_creator_aliases(creators, people_data)
        
        # authors_text sisaldab nüüd ka aliaseid, et otsing leiaks "Lorenz" kui nimi on "Laurentius"
        authors_text = [c['name'] for c in creators if c.get('name')] + aliases

        doc = {
            "id": page_id,
            "work_id": work_id,  # Nanoid (püsiv lühikood)
            "title": title,
            "autor": autor,      # Filtreerimiseks (jääb)
            "respondens": respondens,  # Filtreerimiseks (jääb)
            "aasta": year,       # Filtreerimiseks ja sortimiseks (jääb)
            "year": year,
            "lehekylje_number": page_num,
            "teose_lehekylgede_arv": len(images),
            "lehekylje_tekst": page_text,
            "lehekylje_pilt": os.path.join(dir_name, img_name),
            "originaal_kataloog": dir_name,
            "status": page_meta['status'],
            "page_tags": [l.lower() for l in get_primary_labels(page_tags_data)],
            "page_tags_et": [l.lower() for l in get_labels_by_lang(page_tags_data, 'et')],
            "page_tags_en": [l.lower() for l in get_labels_by_lang(page_tags_data, 'en')],
            "page_tags_suggest_et": [
                f"{get_label(t, 'et')}|||{t.get('id') if isinstance(t, dict) else ''}"
                for t in page_tags_data
            ],
            "page_tags_suggest_en": [
                f"{get_label(t, 'en')}|||{t.get('id') if isinstance(t, dict) else ''}"
                for t in page_tags_data
            ],
            "page_tags_object": page_tags_data,
            "comments": page_meta['comments'],
            "history": page_meta['history'],
            "last_modified": int(os.path.getmtime(txt_path if os.path.exists(txt_path) else os.path.join(dir_path, img_name)) * 1000),
            "tags": get_primary_labels(tags),
            "tags_et": get_labels_by_lang(tags, 'et'),
            "tags_en": get_labels_by_lang(tags, 'en'),
            "tags_object": tags,
            "tags_search": get_all_labels(tags),
            "tags_ids": get_all_ids(tags),
            "collection": collection,
            "collections_hierarchy": collections_hierarchy,
            "location": get_label(location),
            "location_object": location,
            "location_id": get_id(location),
            "location_search": get_all_labels(location),
            "publisher": get_label(publisher),
            "publisher_object": publisher,
            "publisher_id": get_id(publisher),
            "publisher_search": get_all_labels(publisher),
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
            "authors_text": authors_text,
            "author_names": [c['name'] for c in creators if c.get('name') and c.get('role') != 'respondens'],
            "respondens_names": [c['name'] for c in creators if c.get('name') and c.get('role') == 'respondens'],
            "creator_ids": [c.get('id') for c in creators if c.get('id')]
            # NB: pealkiri, koht, trükkal eemaldatud - kasuta title, location, publisher
        }

        if ester_id:
            doc['ester_id'] = ester_id
        if external_url:
            doc['external_url'] = external_url

        documents.append(doc)

    # 3. Arvuta teose koondstaatus
    teose_staatus = calculate_work_status(page_statuses)
    for doc in documents:
        doc['teose_staatus'] = teose_staatus

    # 4. Saada Meilisearchi
    if documents:
        print(f"AUTOMAATNE SÜNK: Teos {slug} ({len(documents)} lk), staatus: {teose_staatus}")
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
                            if f.lower().endswith(('.jpg', '.jpeg', '.png')) and not f.startswith('_thumb_'):
                                has_images = True
                                break

                        if has_images:
                            try:
                                metadata = generate_default_metadata(entry.name)
                                atomic_write_json(meta_path, metadata)
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
