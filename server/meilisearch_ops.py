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
from concurrent.futures import ThreadPoolExecutor
from .config import BASE_DIR, MEILI_URL, MEILI_KEY, INDEX_NAME, COLLECTIONS_FILE, PERSON_ALIASES_FILE as PEOPLE_FILE, LABELS_FILE, get_logger
from .utils import (
    atomic_write_json,
    sanitize_id, generate_default_metadata, normalize_genre,
    calculate_work_status, get_label, get_id, get_all_labels, get_all_ids, get_primary_labels,
    get_labels_by_lang
)

logger = get_logger(__name__)

# Meilisearch päringu timeout sekundites
MEILI_TIMEOUT = 10
from .git_ops import commit_new_work_to_git
import re

def clean_text_for_search(text):
    """Puhastab teksti otsinguindeksi jaoks, eemaldades vormindusmärgid ja liites poolitused.

    Toetab mõlemat märgendusformaati:
    - Uus XML: <i>, <b>, <cs>, <m>, <hi>, <fn>n</fn>, <pb/>
    - Vana pseudo-markdown: *italic*, **bold**, ~cs~, [[m:text]], --lk--, [^n]
    """
    if not text:
        return ""

    # 1. Uus XML märgendus — eemalda kõik VUTT tägid
    # <fn>n</fn> ja <pb/> asendame tühikuga, ülejäänud tägid eemaldame
    text = re.sub(r'<fn>\d+</fn>', ' ', text)  # joonealuse viite marker
    text = re.sub(r'<pb/>', ' ', text)           # leheküljevahetus
    text = re.sub(r'</?[a-z]+>', '', text)       # avamis/sulgemistägid (<i>, </i>, <b>, <cs> jne)

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

def load_people_aliases():
    """Laeb inimeste aliased JSON failist."""
    if os.path.exists(PEOPLE_FILE):
        try:
            with open(PEOPLE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def load_labels_store():
    """Laeb kanooniilise Q-koodi → label registri (state/labels.json)."""
    if os.path.exists(LABELS_FILE):
        try:
            with open(LABELS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _invert_name(name: str):
    """Teisendab 'Perenimi, Eesnimi' → 'Eesnimi Perenimi'. Tagastab None kui komat pole."""
    if ',' in name:
        parts = name.split(',', 1)
        return f"{parts[1].strip()} {parts[0].strip()}"
    return None


def get_creator_aliases(creators, people_data):
    """Leiab isikutele aliased (nimevariandid).
    Lisab igale 'Perenimi, Eesnimi' aliasele ka inverteeritud 'Eesnimi Perenimi' versiooni."""
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


def normalize_creator(creator, people_data):
    """Normaliseerib isiku nime ja ID people.json kaudu.

    Tagastab (kanooniline_nimi, eelistatud_id) tuple.
    Eelistab Wikidata Q-koodi teiste ID-de üle.
    """
    cid = creator.get('id')
    name = creator.get('name', '')

    if not cid or not people_data or cid not in people_data:
        return name, cid

    person = people_data[cid]
    canonical_name = person.get('primary_name', name)

    # Eelistatavalt Wikidata Q-kood
    ids = person.get('ids', {})
    wikidata_id = ids.get('wikidata')
    if wikidata_id:
        # Veendu et Q-prefiks on olemas
        best_id = wikidata_id if wikidata_id.startswith('Q') else f'Q{wikidata_id}'
    else:
        best_id = cid

    return canonical_name, best_id


def load_collections():
    """Laeb kollektsioonide hierarhia."""
    if os.path.exists(COLLECTIONS_FILE):
        try:
            with open(COLLECTIONS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def get_collection_hierarchy(collections, collection_ids):
    """Tagastab kollektsioonide hierarhia (kõigi kuuluvate kollektsioonide esivanemate union).

    Args:
        collections: Kõigi kollektsioonide dict (state/collections.json)
        collection_ids: Üks kollektsiooni ID (str) või list ID-sid

    Returns:
        Kõigi kollektsioonide ja nende esivanemate ID-de list (duplikaadid eemaldatud)
    """
    if not collection_ids or not collections:
        return []

    # Normaliseeri listiks
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
                    logger.info(f"Meilisearch task {task_uid} õnnestus ({elapsed:.2f}s)")
                    return True
                elif status == 'failed':
                    logger.error(f"Meilisearch task {task_uid} ebaõnnestus: {task_data.get('error')}")
                    return False
                # status on 'enqueued' või 'processing' - ootame edasi
        except Exception as e:
            logger.error(f"Viga taski staatuse kontrollimisel: {e}")
            return False

        time.sleep(0.1)  # Oota 100ms enne järgmist kontrolli

    logger.warning(f"Meilisearch task timeout ({timeout}s)")
    return False


def send_to_meilisearch(documents, wait=True):
    """Saadab dokumendid Meilisearchi kasutades urllib-i.

    Args:
        documents: Dokumentide list
        wait: Kui True, ootab kuni indekseerimine on lõppenud
    """
    if not MEILI_KEY:
        logger.warning("HOIATUS: Meilisearchi võti puudub, ei saa indekseerida.")
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
            logger.info(f"Meilisearch task: {task_uid}")

            if wait and task_uid:
                return wait_for_task(task_uid)
            return True
    except Exception as e:
        logger.error(f"Viga Meilisearchi saatmisel: {e}")
        return False


def sync_work_to_meilisearch(dir_name):
    """
    Sünkroonib ühe teose kõik leheküljed Meilisearchi.
    Loeb andmed failisüsteemist (_metadata.json, pildid, .txt, .json).
    """
    dir_path = os.path.join(BASE_DIR, dir_name)
    if not os.path.exists(dir_path):
        logger.warning(f"SÜNK: Kausta ei leitud: {dir_path}")
        return False

    # 1. Lae teose metaandmed
    meta_path = os.path.join(dir_path, '_metadata.json')
    metadata = {}
    if os.path.exists(meta_path):
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
        except Exception as e:
            logger.error(f"SÜNK: Viga metaandmete lugemisel: {e}")
            return False

    if not metadata:
        metadata = generate_default_metadata(dir_name)

    # Metaandmed (v3 formaat: LinkedEntity objektid)
    work_id = metadata.get('id')  # Nanoid (püsiv lühikood)
    slug = metadata.get('slug', sanitize_id(dir_name))
    title = metadata.get('title', 'Pealkiri puudub')
    year = metadata.get('year', 0)
    year_display = metadata.get('year_display') or None

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
            if first_creator.get('role') not in ['respondens', 'gratulator', 'dedicator', 'editor', 'aui']:
                autor = first_creator.get('name', '')
        if resp:
            respondens = resp.get('name', '')

    # Tags (LinkedEntity objektide massiiv või stringid)
    tags = metadata.get('tags', [])
    if isinstance(tags, list):
        tags = [normalize_genre(t) for t in tags]

    # Kollektsioonid (uus formaat: massiiv)
    work_collections = metadata.get('collections', [])
    collections = load_collections()
    collections_hierarchy = get_collection_hierarchy(collections, work_collections)

    ester_id = metadata.get('ester_id')
    external_url = metadata.get('external_url')
    location = metadata.get('location')
    publisher = metadata.get('publisher')
    work_type = metadata.get('type')
    genre = metadata.get('genre')
    languages = metadata.get('languages', [])

    # 2. Leia leheküljed (pildid)
    # NB: Lehekülje number (page_num) tuleneb pildi POSITSIOONIST SEQUENCE järgi sorteeritud
    # nimekirjas, MITTE failinimest. Sequence on .json failis (100, 200, 300...).
    # Tähestikuline sort on fallback kui sequence puudub.
    def _get_page_sequence(img_name):
        json_path = os.path.join(dir_path, os.path.splitext(img_name)[0] + '.json')
        if os.path.exists(json_path):
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    d = json.load(f)
                    seq = d.get('sequence') or d.get('meta_content', {}).get('sequence')
                    if seq is not None:
                        return int(seq)
            except Exception:
                pass
        return float('inf')  # fallback: lõppu

    images_list = [f for f in os.listdir(dir_path) if f.lower().endswith(('.jpg', '.jpeg', '.png')) and not f.startswith('_thumb_')]
    images = sorted(images_list, key=lambda f: (_get_page_sequence(f), f))
    if not images:
        logger.warning(f"SÜNK: Pilte ei leitud kaustas: {dir_name}")
        return False

    documents = []
    page_statuses = []

    # Dokumendi ID = nanoid + lehekülje number (nt "cymbv7-1")
    if not work_id:
        logger.warning(f"HOIATUS: Teosel {dir_name} puudub nanoid (_metadata.json 'id' väli)")
        work_id = slug  # Fallback slugile

    # Lae inimeste aliased ja kanooniilised labelid ÜKS KORD enne tsüklit
    people_data = load_people_aliases()
    labels_store = load_labels_store()

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
            except Exception:
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
            except Exception:
                pass

        page_statuses.append(page_meta['status'])

    # NB: page_meta['tags'] sisaldab lehekülje märksõnu (loetud page_tags väljalt)
        page_tags_data = page_meta.get('tags', [])

        # Kasuta eellaetud people_data (laetud enne tsüklit)
        aliases = get_creator_aliases(creators, people_data)

        # authors_text sisaldab nüüd ka aliaseid, et otsing leiaks "Lorenz" kui nimi on "Laurentius"
        authors_text = [c['name'] for c in creators if c.get('name')] + aliases

        # Trükkali aliased (trükkalid on ka mitme nimega)
        publisher_aliases = []
        pub_id = get_id(publisher)
        if pub_id and people_data.get(pub_id):
            for alias in people_data[pub_id].get('aliases', []):
                publisher_aliases.append(alias)
                inverted = _invert_name(alias)
                if inverted:
                    publisher_aliases.append(inverted)

        # Märksõna aliased (isiku märksõnade nimevariandid, nt Ludenius → Luden)
        tag_aliases = []
        for tag in tags if isinstance(tags, list) else []:
            tag_id = get_id(tag) if isinstance(tag, dict) else None
            if tag_id and people_data.get(tag_id):
                for alias in people_data[tag_id].get('aliases', []):
                    tag_aliases.append(alias)
                    inverted = _invert_name(alias)
                    if inverted:
                        tag_aliases.append(inverted)

        doc = {
            "id": page_id,
            "work_id": work_id,  # Nanoid (püsiv lühikood)
            "title": title,
            "autor": autor,      # Filtreerimiseks (jääb)
            "respondens": respondens,  # Filtreerimiseks (jääb)
            "aasta": year,       # Filtreerimiseks ja sortimiseks (jääb)
            "year": year,
            "year_display": year_display,
            "lehekylje_number": page_num,
            "teose_lehekylgede_arv": len(images),
            "lehekylje_tekst": clean_text_for_search(page_text), # OTSINGU JAOKS (puhastatud märkidest ja poolitustest)
            "text_content": page_text,                          # REDAKTORI JAOKS (algne tekst koos kõigi märkidega)
            "lehekylje_pilt": os.path.join(dir_name, img_name),
            "originaal_kataloog": dir_name,
            "status": page_meta['status'],
            "page_tags": get_primary_labels(page_tags_data),                          # Eesti label, capitalize_first (teose tags-iga ühtlane)
            "page_tags_et": get_labels_by_lang(page_tags_data, 'et', labels_store), # Eesti label, capitalize_first
            "page_tags_en": get_labels_by_lang(page_tags_data, 'en', labels_store), # Inglise label, capitalize_first
            "page_tags_ids": get_all_ids(page_tags_data),              # Q-koodid (filtreeritav, nagu tags_ids)
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
            "tags_et": get_labels_by_lang(tags, 'et', labels_store),
            "tags_en": get_labels_by_lang(tags, 'en', labels_store),
            "tags_object": tags,
            "tags_search": get_all_labels(tags) + tag_aliases,
            "tags_ids": get_all_ids(tags),
            "collections": work_collections,
            "collections_hierarchy": collections_hierarchy,
            "location": get_label(location),
            "location_object": location,
            "location_id": get_id(location),
            "location_search": get_all_labels(location),
            "publisher": get_label(publisher),
            "publisher_object": publisher,
            "publisher_id": get_id(publisher),
            "publisher_search": get_all_labels(publisher) + publisher_aliases,
            "genre": get_label(genre),
            "genre_et": get_labels_by_lang(genre, 'et', labels_store),
            "genre_en": get_labels_by_lang(genre, 'en', labels_store),
            "genre_object": genre,
            "genre_search": get_all_labels(genre),
            "genre_ids": get_all_ids(genre),
            "type": get_label(work_type),
            "type_et": get_labels_by_lang(work_type, 'et', labels_store),
            "type_en": get_labels_by_lang(work_type, 'en', labels_store),
            "type_object": work_type,
            "type_ids": get_all_ids(work_type),
            "languages": languages,
            "creators": creators,
            "authors_text": authors_text,
            "author_names": list(dict.fromkeys(
                name for c in creators
                if c.get('name') and c.get('role') != 'respondens'
                for name in ([normalize_creator(c, people_data)[0], c['name']] if normalize_creator(c, people_data)[0] != c['name'] else [c['name']])
            )),
            "respondens_names": list(dict.fromkeys(
                name for c in creators
                if c.get('name') and c.get('role') == 'respondens'
                for name in ([normalize_creator(c, people_data)[0], c['name']] if normalize_creator(c, people_data)[0] != c['name'] else [c['name']])
            )),
            "creator_ids": [normalize_creator(c, people_data)[1] for c in creators if c.get('id')]
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

    # 4. Saada uued dokumendid Meilisearchi (upsert — uuendab olemasolevad, lisab uued)
    # Kustutame PÄRAST lisamist ainult need dokumendid mis jäid üle (leheküljed kustutati).
    # NB: Ära kustuta enne lisamist — sellel ajal oleks teos otsinguks kättesaamatu (race condition).
    if documents and work_id:
        new_count = len(documents)
        logger.info(f"AUTOMAATNE SÜNK: Teos {slug} ({new_count} lk), staatus: {teose_staatus}")
        result = send_to_meilisearch(documents)
        _delete_extra_pages(work_id, new_count)
        return result


def _delete_extra_pages(work_id, new_count):
    """Kustutab leheküljed mille lehekylje_number > new_count (kui neid eksisteerib).

    Kasutatakse pärast upsert-sünkroonimist, et eemaldada kustutatud lehekülgede
    jäänused Meilisearchist. Ei loo downtime-akent.
    """
    if not MEILI_KEY:
        return
    check_url = f"{MEILI_URL}/indexes/{INDEX_NAME}/search"
    check_body = json.dumps({
        "filter": [f'work_id = "{work_id}"', f'lehekylje_number > {new_count}'],
        "limit": 1,
        "attributesToRetrieve": ["id"]
    }).encode('utf-8')
    req = urllib.request.Request(check_url, data=check_body, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Authorization', f'Bearer {MEILI_KEY}')
    try:
        with urllib.request.urlopen(req, timeout=MEILI_TIMEOUT) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            if data.get('estimatedTotalHits', 0) == 0:
                return
    except Exception:
        return

    del_url = f"{MEILI_URL}/indexes/{INDEX_NAME}/documents/delete"
    del_body = json.dumps({
        "filter": [f'work_id = "{work_id}"', f'lehekylje_number > {new_count}']
    }).encode('utf-8')
    del_req = urllib.request.Request(del_url, data=del_body, method='POST')
    del_req.add_header('Content-Type', 'application/json')
    del_req.add_header('Authorization', f'Bearer {MEILI_KEY}')
    try:
        with urllib.request.urlopen(del_req, timeout=MEILI_TIMEOUT) as resp:
            res_data = json.loads(resp.read().decode('utf-8'))
            task_uid = res_data.get('taskUid')
            if task_uid:
                wait_for_task(task_uid)
                logger.info(f"Kustutatud üleliigsed leheküljed (work_id={work_id}, new_count={new_count})")
    except Exception as e:
        logger.error(f"Viga üleliigsete lehekülgede kustutamisel: {e}")


def delete_work_from_meilisearch(work_id):
    """Kustutab kõik teose dokumendid Meilisearchi indeksist filtri järgi."""
    if not MEILI_KEY:
        return False
    url = f"{MEILI_URL}/indexes/{INDEX_NAME}/documents/delete"
    body = {"filter": f'work_id = "{work_id}"'}
    data = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Authorization', f'Bearer {MEILI_KEY}')
    try:
        with urllib.request.urlopen(req, timeout=MEILI_TIMEOUT) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            task_uid = res_data.get('taskUid')
            if task_uid:
                return wait_for_task(task_uid)
    except Exception as e:
        logger.error(f"Viga Meilisearchi kustutamisel: {e}")
    return False


def index_new_work(dir_name, metadata):
    """Loob lehekülgede dokumendid ja saadab Meilisearchi."""
    return sync_work_to_meilisearch(dir_name)


# =========================================================
# ASYNC MEILISEARCH SYNC
# Käivitab indekseerimise lõimede pool'is, et päring ei blokeeruks
# =========================================================

# Lõimede pool Meilisearch päringute jaoks
# Max 10 samaaegset päringut - rohkem tekitaks Meilisearchile liiga suure koormuse
MEILISEARCH_POOL_SIZE = 10
_meilisearch_executor = ThreadPoolExecutor(
    max_workers=MEILISEARCH_POOL_SIZE,
    thread_name_prefix="meili_sync"
)


def _sync_work_task(dir_name):
    """Meilisearch sync task (käivitatakse pool'is)."""
    try:
        sync_work_to_meilisearch(dir_name)
    except Exception as e:
        logger.error(f"ASYNC MEILISEARCH VIGA ({dir_name}): {e}")


def sync_work_to_meilisearch_async(dir_name):
    """Käivitab Meilisearch sync'i lõimede pool'is.

    Kasutaja päring ei pea ootama indekseerimise lõppu.
    Vead logitakse, aga ei katkesta kasutaja tööd.
    Pool piirab samaagsete päringute arvu (max 10).
    """
    _meilisearch_executor.submit(_sync_work_task, dir_name)


def metadata_watcher_loop():
    """Taustalõim, mis otsib uusi kaustu ja loob neile metaandmed."""
    logger.info(f"Metaandmete jälgija käivitatud (kataloog: {BASE_DIR})")
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
                                logger.info(f"AUTOMAATNE METADATA: Loodud fail {meta_path}")

                                # Indekseeri kohe Meilisearchis
                                index_new_work(entry.name, metadata)

                                # Lisa txt failid Giti originaal-OCR commitina
                                commit_new_work_to_git(entry.name)
                            except Exception as e:
                                logger.error(f"Viga metaandmete loomisel ({entry.name}): {e}")

            # Oota 60 sekundit järgmise skannimiseni
            time.sleep(60)
        except Exception as e:
            logger.error(f"Jälgija viga: {e}")
            time.sleep(60)
