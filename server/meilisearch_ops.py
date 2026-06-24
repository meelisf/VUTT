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
import jwt  # PyJWT
from datetime import datetime, timezone, timedelta
from .config import BASE_DIR, MEILI_URL, MEILI_KEY, INDEX_NAME, COLLECTIONS_FILE, PERSON_ALIASES_FILE as PEOPLE_FILE, LABELS_FILE, ARCHIVES_FILE, get_logger
from .utils import (
    atomic_write_json,
    sanitize_id, generate_default_metadata, normalize_genre,
    calculate_work_status, get_label, get_id, get_all_labels, get_all_ids, get_primary_labels,
    get_labels_by_lang, parse_year_range
)

logger = get_logger(__name__)

# Meilisearch päringu timeout sekundites
MEILI_TIMEOUT = 10
from .git_ops import commit_new_work_to_git

# Puhtad kaardistusfunktsioonid (teksti puhastus, aliased, dokumendi ehitamine) elavad
# nüüd side-effect-vabas moodulis server/meili_doc.py (issue #23) — neid impordivad
# nii see live-tee kui scripts/1-1_consolidate_data.py seed/reseed-tee, et kaks teed
# ei saaks vaikselt lahku minna. Re-eksporditakse siit tagasiühilduvuseks.
from .meili_doc import (
    M_CONTENT_RE, split_marginalia, clean_text_for_search, build_text_annotations_text,
    _clean_search_text, _invert_name, get_creator_aliases, normalize_creator,
    _compute_work_aliases, get_collection_hierarchy, _build_page_document,
    compute_autor_respondens,
)


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



def load_collections():
    """Laeb kollektsioonide hierarhia."""
    if os.path.exists(COLLECTIONS_FILE):
        try:
            with open(COLLECTIONS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def wait_for_task(task_uid, timeout=120):
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

    # Lae arhiivide register (arhiivi nimed otsinguteksti jaoks)
    _archives = {}
    if os.path.exists(ARCHIVES_FILE):
        try:
            with open(ARCHIVES_FILE, 'r', encoding='utf-8') as f:
                _archives = json.load(f)
        except Exception:
            pass

    # Metaandmed (v3 formaat: LinkedEntity objektid)
    work_id = metadata.get('id')  # Nanoid (püsiv lühikood)
    slug = metadata.get('slug', sanitize_id(dir_name))
    title = metadata.get('title', 'Pealkiri puudub')
    year = metadata.get('year', 0)
    year_display = metadata.get('year_display') or None
    year_range = parse_year_range(year, year_display)
    # Kui year puudub aga year_display annab vahemiku (nt "ca. 1750", "19. saj"),
    # kasuta sortimisväärtusena vahemiku keskpaika
    if not year and year_range:
        year = (year_range[0] + year_range[1]) // 2
    year_start = year_range[0] if year_range else 0
    year_end = year_range[1] if year_range else 0

    # Autor ja respondens creators massiivist (jagatud loogika — vt meili_doc, issue #23)
    creators = metadata.get('creators', [])
    autor, respondens = compute_autor_respondens(creators)

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
    series = metadata.get('series')
    series_title = series.get('title', '') if isinstance(series, dict) else ''
    relations = metadata.get('relations')
    archive_refs = metadata.get('archive_refs') or []
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

    # Work-level aliased (creators/publisher/tags) sõltuvad ainult metadatast, mitte lehest
    # — arvutatakse üks kord, mitte igal lehel (vt issue #16 refaktoor).
    aliases, authors_text, publisher_aliases, tag_aliases = _compute_work_aliases(
        creators, publisher, tags, people_data
    )

    # Teose-tasandi kontekst (konstantsed väärtused üle kõikide lehtede).
    # Ehitatakse üks kord ja antakse _build_page_document-ile (vt issue #16).
    work_ctx = {
        'dir_name': dir_name,
        'dir_path': dir_path,
        'work_id': work_id,
        'title': title,
        'autor': autor,
        'respondens': respondens,
        'year': year,
        'year_display': year_display,
        'year_start': year_start,
        'year_end': year_end,
        'teose_lehekylgede_arv': len(images),
        'tags': tags,
        'tag_aliases': tag_aliases,
        'work_collections': work_collections,
        'collections': collections,
        'collections_hierarchy': collections_hierarchy,
        'shareable': metadata.get('shareable', False),
        'location': location,
        'publisher': publisher,
        'publisher_aliases': publisher_aliases,
        'genre': genre,
        'work_type': work_type,
        'languages': languages,
        'creators': creators,
        'authors_text': authors_text,
        'people_data': people_data,
        'labels_store': labels_store,
        'ester_id': ester_id,
        'external_url': external_url,
        'series': series,
        'series_title': series_title,
        'relations': relations,
        'archive_refs': archive_refs,
        '_archives': _archives,
    }

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
            'text_annotations': [],
            'history': []
        }
        if os.path.exists(json_path):
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    p_data = json.load(f)
                    # Toeta nii vana kui uut formaati (meta_content wrapper)
                    source = p_data.get('meta_content', p_data)
                    page_meta['status'] = source.get('status', 'Toores')
                    # tags-fallback: serveril on 35 lehekülge vana 'tags' väljaga (OCR-artefaktid, stringid, mitte Q-objektid).
                    # Eemaldada pärast nende lehekülgede migreerimist või puhastamist.
                    page_meta['tags'] = source.get('page_tags', source.get('tags', []))
                    page_meta['comments'] = source.get('comments', [])
                    page_meta['text_annotations'] = source.get('text_annotations', [])
                    page_meta['history'] = source.get('history', [])
                    # Kui JSON-is on tekst ja failis pole, kasuta JSON-it
                    if not page_text and 'text_content' in p_data:
                        page_text = p_data['text_content']
            except Exception:
                pass

        page_statuses.append(page_meta['status'])

        doc = _build_page_document(
            work_ctx, page_id, page_num, page_text, page_meta, img_name, txt_path
        )
        documents.append(doc)

    # 3. Arvuta teose koondstaatus, saada Meilisearchi ja kustuta üleliigne.
    # tsüklile järgnev samm on eraldatud _upsert_work_documents (vt issue #16 refaktoor).
    if documents and work_id:
        return _upsert_work_documents(work_id, slug, documents, page_statuses)


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


def _upsert_work_documents(work_id, slug, documents, page_statuses):
    """Lisab teose koondstaatuse kõikidele dokumentidele ja saadab Meilisearchi.

    Teostab tsüklile järgneva sammu (vt issue #16 refaktoor):
    1. arvutab teose koondstaatuse kõikide lehtede staatustest
       (Toores/Valmis/Töös — vt utils.calculate_work_status);
    2. kannab selle igale dokumendile (teose_staatus väli);
    3. saadab uued dokumendid upsert'ina (send_to_meilisearch);
    4. kustutab üleliigsed (kustutatud) leheküljed PÄRAST lisamist
       (_delete_extra_pages — ärge kustuta enne, muidu teos on hetkeks otsinguks kättesaamatu).

    Tagastab send_to_meilisearch tulemi (True/False) või None kui dokumendid puuduvad.
    """
    if not documents:
        return None

    teose_staatus = calculate_work_status(page_statuses)
    for doc in documents:
        doc['teose_staatus'] = teose_staatus

    new_count = len(documents)
    logger.info(f"AUTOMAATNE SÜNK: Teos {slug} ({new_count} lk), staatus: {teose_staatus}")
    result = send_to_meilisearch(documents)
    _delete_extra_pages(work_id, new_count)
    return result


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


def _ensure_filterable_attributes():
    """Tagab et filterableAttributes sisaldab kõiki vajalikke filtrite välju."""
    url = f"{MEILI_URL}/indexes/{INDEX_NAME}/settings/filterable-attributes"
    req = urllib.request.Request(url, method='GET')
    req.add_header('Authorization', f'Bearer {MEILI_KEY}')
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            current = json.loads(r.read())
        needed = {"is_public", "shareable", "collections_hierarchy", "collections", "year_start", "year_end"}
        if not needed.issubset(set(current)):
            new_attrs = list(set(current) | needed)
            patch_req = urllib.request.Request(
                url,
                data=json.dumps(new_attrs).encode(),
                method='PUT'
            )
            patch_req.add_header('Authorization', f'Bearer {MEILI_KEY}')
            patch_req.add_header('Content-Type', 'application/json')
            urllib.request.urlopen(patch_req, timeout=10)
            logger.info("filterableAttributes uuendatud: lisati puuduvad atribuudid")
    except Exception as e:
        logger.warning(f"filterableAttributes uuendus ebaõnnestus: {e}")


def update_collection_is_public_async(collection_id: str, is_public_flag: bool):
    """Uuendab kõigi antud kollektsiooni teoste is_public välja Meilisearchi asünkroonselt."""
    def _do_update():
        if not os.path.isdir(BASE_DIR):
            return
        docs_to_update = []
        all_cols = load_collections()
        for folder in os.listdir(BASE_DIR):
            meta_path = os.path.join(BASE_DIR, folder, '_metadata.json')
            if not os.path.exists(meta_path):
                continue
            try:
                with open(meta_path, 'r', encoding='utf-8') as f:
                    meta = json.load(f)
                work_cols = meta.get('collections', [])
                if collection_id not in work_cols:
                    continue
                work_id = meta.get('work_id')
                if not work_id:
                    continue
                new_is_public = any(
                    all_cols.get(c, {}).get("visibility", "public") == "public"
                    for c in work_cols
                ) if work_cols else True
                folder_path = os.path.join(BASE_DIR, folder)
                images = sorted([
                    f for f in os.listdir(folder_path)
                    if f.lower().endswith(('.jpg', '.jpeg', '.png')) and not f.startswith('_thumb_')
                ])
                page_count = len(images) or 1
                for page_num in range(1, page_count + 1):
                    docs_to_update.append({"id": f"{work_id}-{page_num}", "work_id": work_id, "is_public": new_is_public})
            except Exception:
                continue

        if not docs_to_update:
            return

        url = f"{MEILI_URL}/indexes/{INDEX_NAME}/documents"
        req = urllib.request.Request(url, data=json.dumps(docs_to_update).encode(), method='POST')
        req.add_header('Authorization', f'Bearer {MEILI_KEY}')
        req.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                result = json.loads(r.read())
                logger.info(f"is_public massuuendus: task_uid={result.get('taskUid')}, {len(docs_to_update)} teost")
        except Exception as e:
            logger.error(f"is_public massuuendus ebaõnnestus: {e}")

    _meilisearch_executor.submit(_do_update)


MEILI_KEEPWARM_INTERVAL = 7200  # 2 tundi sekundites
MEILI_SEARCH_KEEPWARM_INTERVAL = int(os.getenv("MEILI_SEARCH_KEEPWARM_INTERVAL", "1800"))
DEFAULT_DASHBOARD_COLLECTION = os.getenv("VUTT_DEFAULT_COLLECTION", "universitas-dorpatensis-1")


def _meili_search(body, timeout=30):
    """Käivitab ühe Meilisearch search päringu warm-up'i jaoks."""
    url = f"{MEILI_URL}/indexes/{INDEX_NAME}/search"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
    )
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {MEILI_KEY}")
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _dashboard_search_warmup_body(collection_id=None):
    """Sama kujuga päring nagu dashboardi esmane riiulivaade."""
    filters = ["lehekylje_number = 1"]
    if collection_id:
        filters.append(f'collections_hierarchy = "{collection_id}"')

    return {
        "q": "",
        "attributesToRetrieve": [
            "id", "work_id", "title", "year", "year_display", "publisher_id",
            "type_object", "genre_object", "collections", "collections_hierarchy",
            "creators", "authors_text", "tags_object", "languages",
            "series", "series_title", "ester_id", "external_url",
            "last_modified", "teose_lehekylgede_arv", "teose_staatus",
        ],
        "attributesToSearchOn": ["title", "authors_text", "tags_search"],
        "filter": filters,
        "limit": 5000,
        "facets": ["genre_ids", "type_ids", "tags_ids", "teose_staatus"],
        "distinct": "work_id",
        "sort": ["year:asc"],
    }


def _warm_dashboard_searches():
    """Soojendab dashboardi kallid otsingu/facet päringud.

    Teeme nii vaikimisi kollektsiooni kui ka kogu indeksi päringu. Esimene katab
    tavakasutaja riiuli, teine katab juhu, kus kollektsioon ei ole veel
    kontekstis või kasutaja sirvib kõiki teoseid.
    """
    warmups = [("all", None)]
    collections = load_collections()
    if DEFAULT_DASHBOARD_COLLECTION and DEFAULT_DASHBOARD_COLLECTION in collections:
        warmups.insert(0, (DEFAULT_DASHBOARD_COLLECTION, DEFAULT_DASHBOARD_COLLECTION))

    for label, collection_id in warmups:
        start = time.time()
        result = _meili_search(_dashboard_search_warmup_body(collection_id))
        elapsed = time.time() - start
        logger.info(
            "Dashboard search warm-up valmis (%s): %.2fs, Meili %sms, hits=%s",
            label,
            elapsed,
            result.get("processingTimeMs"),
            result.get("estimatedTotalHits"),
        )


def generate_meili_token(user=None, ttl_seconds: int = 3600) -> str:
    """Genereerib Meilisearch tenant tokeni kasutaja õiguste põhjal.

    user=None → anonüümne token (filter: is_public = true)
    user admin → piiranguta token
    user contributor/editor → filter: is_public = true + allowed collections
    """
    from .config import MEILI_SEARCH_KEY, MEILI_SEARCH_KEY_UID

    if not MEILI_SEARCH_KEY or not MEILI_SEARCH_KEY_UID:
        raise RuntimeError("MEILI_SEARCH_KEY ja MEILI_SEARCH_KEY_UID peavad olema seadistatud")

    base_filter = "is_public = true"

    if user and user.get("role") == "admin":
        search_rules = {"teosed": {}}
    else:
        allowed = (user or {}).get("allowed_collections", [])
        if allowed:
            cols = ", ".join(f'"{c}"' for c in allowed)
            meili_filter = f"{base_filter} OR collections_hierarchy IN [{cols}]"
        else:
            meili_filter = base_filter
        search_rules = {"teosed": {"filter": meili_filter}}

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)

    payload = {
        "searchRules": search_rules,
        "apiKeyUid": MEILI_SEARCH_KEY_UID,
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(payload, MEILI_SEARCH_KEY, algorithm="HS256")
    return token if isinstance(token, str) else token.decode("utf-8")


def generate_work_scoped_meili_token(work_id: str, ttl_seconds: int = 3600) -> str:
    """Genereerib Meilisearch tokeni mis annab lugemisjuurdepääsu ainult ühele teosele."""
    from .config import MEILI_SEARCH_KEY, MEILI_SEARCH_KEY_UID

    if not MEILI_SEARCH_KEY or not MEILI_SEARCH_KEY_UID:
        raise RuntimeError("MEILI_SEARCH_KEY ja MEILI_SEARCH_KEY_UID peavad olema seadistatud")

    search_rules = {"teosed": {"filter": f'work_id = "{work_id}"'}}
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
    payload = {
        "searchRules": search_rules,
        "apiKeyUid": MEILI_SEARCH_KEY_UID,
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(payload, MEILI_SEARCH_KEY, algorithm="HS256")
    return token if isinstance(token, str) else token.decode("utf-8")


def _keepwarm_loop():
    """Taustalõim, mis hoiab Meilisearchi otsingu- ja sync-rajad soojad.

    Hoiab Meilisearchi eesliitetabeli (prefixSearch: indexingTime) sooja,
    et vältida ~60s viivitust esimesel indekseerimistehingul pärast pikka pausi.
    """
    last_sync_warmup = time.time()
    while True:
        try:
            _warm_dashboard_searches()

            if not os.path.exists(BASE_DIR):
                time.sleep(MEILI_SEARCH_KEEPWARM_INTERVAL)
                continue

            now = time.time()
            if now - last_sync_warmup >= MEILI_KEEPWARM_INTERVAL:
                # Leia esimene teos kataloogist
                for entry in os.scandir(BASE_DIR):
                    if entry.is_dir() and not entry.name.startswith('.'):
                        meta_path = os.path.join(entry.path, '_metadata.json')
                        if os.path.exists(meta_path):
                            logger.info("Meilisearch keep-warm sync...")
                            sync_work_to_meilisearch(entry.name)
                            last_sync_warmup = now
                            break
        except Exception as e:
            logger.error(f"Keep-warm viga: {e}")
        time.sleep(MEILI_SEARCH_KEEPWARM_INTERVAL)


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
