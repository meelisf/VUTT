"""Uploaditud OCR-materjali import VUTT teoseks.

Moodul hoiab import_as_work äriloogika upload_ops koordinaatorist eraldi.
Avalik compatibility-wrapper jääb server/upload_ops.py-sse, et testide/routerite
senised monkeypatchid (_sftp_open, BASE_DIR jne) edasi töötaksid.
"""
import json
import os
import shutil

from ..config import BASE_DIR, OCR_SERVER_PATH, get_logger
from ..marginalia_normalize import normalize_marginalia_tags
from ..utils import generate_nanoid, derive_year_fields
from .file_detection import extract_page_num, page_base_name
from .state import get_upload_lock, read_state, write_state

logger = get_logger(__name__)


def normalize_txt_file(path: str):
    """Normaliseerib alla laetud OCR .txt marginaalia-tägid kanoonilisele kujule.
    OCR-mudel toodab ristuvaid <i><m>...</i></m> — vt server/marginalia_normalize.py."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            raw = f.read()
        fixed = normalize_marginalia_tags(raw)
        if fixed != raw:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(fixed)
    except Exception:
        pass  # normaliseerimise tõrge ei tohi importi katkestada


def validate_remote_ocr_files(importable, remote_items, extract_page_num_func):
    """Kontrollib enne importi, et igal oodatud lehel on remote JPG+TXT paar."""
    remote_set = set(remote_items)
    jpg_map = {}
    for item in remote_items:
        if item.endswith('.jpg') and '_pg_' in item:
            pn = extract_page_num_func(item.rsplit('.', 1)[0])
            if pn > 0:
                jpg_map[pn] = item

    expected_pages = {entry['page'] for entry in importable}
    missing_jpg = sorted(expected_pages - set(jpg_map))
    missing_txt = sorted(
        pn for pn in expected_pages
        if pn in jpg_map
        and os.path.splitext(jpg_map[pn])[0] + '.txt' not in remote_set
    )
    # .err = OCR-server märkis lehe lõplikult vigaseks (#250). „TXT puudub" oleks
    # siin eksitav: leht ei ole teel, vaid kukkus — kasutaja peab teadma, et
    # ootamisest ei ole abi.
    failed_ocr = [pn for pn in missing_txt
                  if os.path.splitext(jpg_map[pn])[0] + '.err' in remote_set]
    missing_txt = [pn for pn in missing_txt if pn not in failed_ocr]
    if missing_jpg or missing_txt or failed_ocr:
        problems = []
        if missing_jpg:
            problems.append(f"JPG puudub lehtedel {', '.join(map(str, missing_jpg))}")
        if missing_txt:
            problems.append(f"TXT puudub lehtedel {', '.join(map(str, missing_txt))}")
        if failed_ocr:
            problems.append(
                f"OCR ebaõnnestus lehtedel {', '.join(map(str, failed_ocr))} "
                "(kustuta need lehed või proovi uuesti)")
        raise ValueError(
            "OCR tulemus pole täielik: " + "; ".join(problems) +
            ". Toiming katkestati ja OCR staging säilitati."
        )
    return jpg_map


def import_as_work(
    upload_id: str,
    username: str = None,
    *,
    base_dir: str = BASE_DIR,
    ocr_server_path: str = OCR_SERVER_PATH,
    get_upload_lock_func=get_upload_lock,
    read_state_func=read_state,
    write_state_func=write_state,
    sftp_open_func=None,
    ssh_rm_rf_func=None,
    close_ssh_func=None,
    page_base_name_func=page_base_name,
    extract_page_num_func=extract_page_num,
    generate_nanoid_func=generate_nanoid,
    normalize_txt_file_func=normalize_txt_file,
) -> dict:
    """
    Impordib OCR-itud teose VUTT andmebaasi.

    1. Laeb alla JPG+TXT failid OCR serverist (SFTP)
    2. Loob data/{slug}/ struktuuri
    3. Loob _metadata.json ja lehekülgede JSON-id
    4. Git commit (originaal OCR)
    5. Meilisearch sünk (sünkroonne)
    6. Koristab OCR serveri staging kausta
    7. Märgib upload 'imported'-ks
    """
    if sftp_open_func is None:
        raise ValueError("SFTP avamise funktsioon puudub")

    state_lock = get_upload_lock_func(upload_id)
    with state_lock:
        state = read_state_func(upload_id)
    if not state:
        raise ValueError("Upload ei leitud")

    current_status = state.get('status')
    if current_status not in ('done', 'reviewing'):
        raise ValueError(
            f"Upload peab olema 'done' või 'reviewing' olekus, praegu: '{current_status}'"
        )

    meta = state['meta']
    title = meta['title']
    slug = meta['slug']
    work_collections = meta.get('collections') or []
    languages = meta.get('languages') or []
    # Samm 1 aastalahter on vabatekst ("1634-1653", "ca. 1650", "17. saj") —
    # `int()` kukuks ja aasta läheks vaikselt kaotsi (teos sai aastaks 0).
    year, derived_year_display = derive_year_fields(
        meta.get('year'), meta.get('year_display')
    )

    # Filtreeri: ainult OCR-iga, mitte-kustutatud lehed
    importable = [f for f in state.get('files', []) if f.get('has_ocr') and not f.get('deleted')]
    if not importable:
        raise ValueError("Imporditavaid lehekülgi pole (kõik kustutatud või OCR puudub)")
    importable.sort(key=lambda f: f['page'])

    # Kasuta create_upload-is genereeritud work_id'd; vana pooleliolev upload
    # (enne deploy't, ilma meta.work_id'ta) saab uue nanoid'i (vana failinime konventsioon).
    work_id = meta.get('work_id') or generate_nanoid_func()

    # Sihtkoha kaust data/{slug}/
    work_dir = os.path.join(base_dir, slug)
    if os.path.exists(work_dir):
        raise ValueError(f"Kaust data/{slug}/ on juba olemas")
    os.makedirs(work_dir)

    remote_work = f"{ocr_server_path}/{state['remote_work_path']}"

    sftp = None
    try:
        sftp = sftp_open_func(upload_id)

        # Leia tegelikud remote failinimed
        try:
            remote_items = sftp.listdir(remote_work)
        except Exception as e:
            raise ValueError(f"Ei saa lugeda OCR kausta: {e}")

        # Täielikkuse preflight ENNE allalaadimist: osalist teost ei impordita.
        jpg_map = validate_remote_ocr_files(importable, remote_items, extract_page_num_func)

        # Lae alla iga soovitud leht
        downloaded = 0
        for entry in importable:
            pn = entry['page']
            jpg_name = jpg_map[pn]
            txt_name = jpg_name.replace('.jpg', '.txt')

            base_name = page_base_name_func(slug, work_id, pn)
            local_jpg = os.path.join(work_dir, f"{base_name}.jpg")
            local_txt = os.path.join(work_dir, f"{base_name}.txt")
            local_json = os.path.join(work_dir, f"{base_name}.json")

            sftp.get(f"{remote_work}/{jpg_name}", local_jpg)
            os.chmod(local_jpg, 0o644)

            try:
                sftp.get(f"{remote_work}/{txt_name}", local_txt)
                normalize_txt_file_func(local_txt)
            except FileNotFoundError:
                raise ValueError(f"OCR TXT kadus allalaadimise ajal (lk {pn}); import katkestati")
            os.chmod(local_txt, 0o644)

            page_json = {"sequence": pn * 100, "status": "Toores", "page_tags": [], "comments": [], "history": []}
            with open(local_json, 'w', encoding='utf-8') as f:
                json.dump(page_json, f, ensure_ascii=False, indent=2)
            os.chmod(local_json, 0o644)
            downloaded += 1

        sftp.close()
        sftp = None

        if downloaded == 0:
            raise ValueError("Ühtegi lehekülge ei õnnestunud alla laadida")

    except ValueError:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise
    except Exception as e:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise ValueError(f"Failide allalaadimine ebaõnnestus: {e}")
    finally:
        if sftp:
            try:
                sftp.close()
            except Exception:
                pass

    # _metadata.json — kõik upload formis sisestatud metaandmed
    optional_meta_fields = [
        "creators", "tags",
        "type", "genre",
        "location", "publisher",
        "ester_id", "external_url", "year_display",
        "archive_refs",
    ]
    metadata = {
        "id": work_id,
        "slug": slug,
        "title": title,
        "collections": work_collections,
        "languages": languages,
    }
    if year is not None:
        metadata["year"] = year
    if derived_year_display:
        metadata["year_display"] = derived_year_display
    for field in optional_meta_fields:
        if field in meta and meta[field] not in (None, [], ""):
            metadata[field] = meta[field]
    # tags ja creators peavad alati olemas olema (tühi list kui puudub)
    metadata.setdefault("tags", [])
    metadata.setdefault("creators", [])

    # Asenda Wikidata Q-koodid vutt:P ID-dega (loo stub kaardid vajadusel)
    try:
        from ..prosopography.person_crud import ensure_prosopo_stubs
        metadata = {**metadata, **{
            k: v for k, v in ensure_prosopo_stubs(metadata, username).items()
            if k in ("creators", "tags", "publisher")
        }}
    except Exception as e:
        logger.warning(f"import {upload_id}: prosopo stub loomine ebaõnnestus: {e}")

    meta_path = os.path.join(work_dir, '_metadata.json')
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
    os.chmod(meta_path, 0o644)

    # Git commit
    git_committed = False
    git_warning = None
    try:
        from ..git_ops import commit_new_work_to_git
        git_committed = bool(commit_new_work_to_git(slug, username=username))
        if git_committed:
            logger.info(f"import {upload_id}: git commit OK ({slug})")
        else:
            git_warning = "Teos imporditi, aga Git versioonihalduse commit ebaõnnestus."
            logger.warning(f"import {upload_id}: git commit ebaõnnestus ({slug})")
    except Exception as e:
        git_warning = "Teos imporditi, aga Git versioonihalduse commit ebaõnnestus."
        logger.warning(f"import {upload_id}: git commit ebaõnnestus: {e}")
        try:
            from ..git_ops import _record_git_failure
            _record_git_failure(slug, username or "Automaatne", e)
        except Exception:
            pass

    # Person-to-works indeks (uus teos võib juba sisaldada creators/tags isikuid)
    try:
        from ..prosopography.indices import update_person_to_works, update_work_collections
        update_person_to_works(
            work_id,
            metadata.get("creators", []),
            metadata.get("tags") or [],
            metadata.get("publisher"),
            metadata.get("title") or "",
            metadata.get("year"),
        )
        update_work_collections(work_id, metadata.get("collections") or [])
    except Exception as e:
        logger.warning(f"import {upload_id}: person_to_works viga: {e}")

    # Meilisearch sünk (sünkroonne — ootame lõpuni, et teos oleks kohe kättesaadav)
    try:
        from ..meilisearch_ops import sync_work_to_meilisearch
        ok = sync_work_to_meilisearch(slug)
        if ok:
            logger.info(f"import {upload_id}: meilisearch sync OK ({slug})")
        else:
            logger.warning(f"import {upload_id}: meilisearch sync ebaõnnestus või timeout ({slug})")
    except Exception as e:
        logger.warning(f"import {upload_id}: meilisearch sync viga: {e}")

    # Uuenda upload state → 'imported'
    with state_lock:
        s = read_state_func(upload_id)
        if s:
            s['status'] = 'imported'
            s['work_id'] = work_id
            write_state_func(upload_id, s)

    # Prepress-artefaktid ei ole enam vajalikud — preview/ ja eriti strips/
    # koguneksid muidu uploads/ alla märkamatult.
    try:
        from .prepress import cleanup_prepress_artifacts
        cleanup_prepress_artifacts(upload_id)
    except Exception as e:
        logger.warning(f"Prepress-artefaktide koristus ebaõnnestus {upload_id}: {e}")

    # Koristame OCR serveri (mitte kriitiline)
    remote_staging = f"{ocr_server_path}/{state['remote_staging_path']}"
    if ssh_rm_rf_func is not None:
        try:
            ssh_rm_rf_func(upload_id, remote_staging)
            if close_ssh_func is not None:
                close_ssh_func(upload_id)
            logger.info(f"import {upload_id}: OCR serveri kaust koristatud: {remote_staging}")
        except Exception as e:
            logger.warning(f"import {upload_id}: OCR koristamine ebaõnnestus: {e}")

    logger.info(f"import {upload_id}: valmis → work_id={work_id}, slug={slug}, lehed={downloaded}")
    result = {"work_id": work_id, "slug": slug, "git_committed": git_committed}
    if git_warning:
        result["warning"] = git_warning
    return result
