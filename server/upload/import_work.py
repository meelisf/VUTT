"""Uploaditud OCR-materjali import VUTT teoseks.

Moodul hoiab import_as_work äriloogika upload_ops koordinaatorist eraldi.
Avalik compatibility-wrapper jääb server/upload_ops.py-sse, et testide/routerite
senised monkeypatchid (_sftp_open, BASE_DIR jne) edasi töötaksid.
"""
from ..work_dating import dating_updates
import json
import os
import shutil
import time

from ..config import BASE_DIR, OCR_SERVER_PATH, get_logger
from ..marginalia_normalize import normalize_marginalia_tags
from ..utils import generate_nanoid, derive_year_fields
from .file_detection import extract_page_num, page_base_name
from .state import get_upload_lock, read_state, write_state
from . import page_status

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


def blank_import_pages(importable):
    """Lehed, mis imporditakse TÜHJA tekstiga: mudeli viga, skaneering korras (#250).

    Tühi lehekülg on osa raamatust ja kordusloopi saanud leht on käsitsi
    täidetav — kumbagi ei tohi impordist välja jätta, muidu lehed nihkuvad.
    """
    return {e['page'] for e in importable
            if page_status.is_importable(e) and not page_status.is_ready(e)}


def validate_remote_ocr_files(importable, remote_items, extract_page_num_func):
    """Kontrollib enne importi, et igal oodatud lehel on remote JPG (+ TXT või .err).

    Mudeli veaga leht (`.err` kategooriaga `mudel`) EI vaja TXT-d — ta imporditakse
    tühjana. Pildi- või kirjutusviga blokeerib impordi: esimesel juhul puudub
    skaneering, teisel viskaks tühi import valmis transkriptsiooni ära.
    """
    remote_set = set(remote_items)
    jpg_map = {}
    for item in remote_items:
        if item.endswith('.jpg') and '_pg_' in item:
            pn = extract_page_num_func(item.rsplit('.', 1)[0])
            if pn > 0:
                jpg_map[pn] = item

    expected_pages = {entry['page'] for entry in importable}
    tuhjad = blank_import_pages(importable)
    missing_jpg = sorted(expected_pages - set(jpg_map))
    missing_txt = sorted(
        pn for pn in expected_pages
        if pn in jpg_map and pn not in tuhjad
        and os.path.splitext(jpg_map[pn])[0] + '.txt' not in remote_set
    )
    # .err ilma „mudel" kategooriata: leht ei ole teel, vaid kukkus nii, et
    # tühjana importimine oleks vale (#250). Kasutaja peab teadma, et ootamisest
    # ei ole abi.
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
                "(skaneering ei ole kasutatav — kustuta need lehed või lae uuesti)")
        raise ValueError(
            "OCR tulemus pole täielik: " + "; ".join(problems) +
            ". Toiming katkestati ja OCR staging säilitati."
        )
    return jpg_map


# Staatused, millest import tohib alata. `imported` ei kuulu siia (teos on juba
# olemas), `importing` samuti mitte — see ongi CAS-i mõte.
IMPORT_LUBATUD_STAATUSED = ("done", "reviewing")


def _alusta_importi(upload_id, get_upload_lock_func, read_state_func, write_state_func):
    """CAS `done|reviewing → importing`. Tagastab eelmise staatuse.

    Import kestab 500-lehelisel teosel üle minuti ja klient annab enne alla
    (nginx `proxy_read_timeout`). Ilma selle märgita ei tea keegi — ei kasutaja,
    ei server —, et töö KÄIB: kordusklikk jõudis „Kaust ... on juba olemas"-ni,
    mis kõlab nagu andmeviga, mitte nagu „oota".
    """
    state_lock = get_upload_lock_func(upload_id)
    with state_lock:
        state = read_state_func(upload_id)
        if not state:
            raise ValueError("Upload ei leitud")
        praegune = state.get('status')
        if praegune == 'importing':
            raise ValueError("Import juba käib — oota, kuni see lõpeb")
        if praegune not in IMPORT_LUBATUD_STAATUSED:
            raise ValueError(
                f"Upload peab olema 'done' või 'reviewing' olekus, praegu: '{praegune}'"
            )
        state['status'] = 'importing'
        # Eelmine staatus PEAB elama state'is, mitte ainult mälus: konteineri
        # restart tapab lõime enne except-haru ja käivitustaaste peab teadma,
        # kuhu tagasi minna (sama muster nagu apply_recovery, #256).
        state['import_prev_status'] = praegune
        write_state_func(upload_id, state)
    return praegune


def _lopeta_import(upload_id, uus_staatus, get_upload_lock_func, read_state_func,
                   write_state_func, **lisa):
    """Seab lõppstaatuse ja koristab impordi ajutised märgid."""
    state_lock = get_upload_lock_func(upload_id)
    with state_lock:
        s = read_state_func(upload_id)
        if not s:
            return
        s['status'] = uus_staatus
        s.pop('import_prev_status', None)
        s.pop('import_progress', None)
        for k, v in lisa.items():
            s[k] = v
        write_state_func(upload_id, s)


# Kui tihti tohib edenemine kettale minna. 524-lehelise teose puhul oleks
# lehekaupa kirjutamine 524 täis-state'i ülekirjutust; sekund on kasutajale
# piisavalt sujuv ja kettale odav.
EDENEMISE_SAMM_S = 1.0


class _Edenemine:
    """Impordi edenemine `state.json`-i, ajaliselt hõrendatult.

    Poll on `importing` ajal LUGEJA (ADR 0036), seega on see ainus kirjutaja
    ja lugeja näeb alati tervet kirjet.
    """

    def __init__(self, upload_id, get_upload_lock_func, read_state_func, write_state_func):
        self.upload_id = upload_id
        self.get_lock = get_upload_lock_func
        self.read = read_state_func
        self.write = write_state_func
        self.faas = None
        self.viimati = 0.0

    def __call__(self, faas: str, tehtud: int = 0, kokku: int = 0):
        nyyd = time.monotonic()
        # Faasivahetus ja viimane leht lähevad ALATI kirja: nende vahelejätmine
        # jätaks kasutaja ekraanile lõpetatud faasi poolelioleva loenduri.
        oluline = faas != self.faas or (kokku and tehtud >= kokku)
        if not oluline and nyyd - self.viimati < EDENEMISE_SAMM_S:
            return
        self.faas = faas
        self.viimati = nyyd
        with self.get_lock(self.upload_id):
            s = self.read(self.upload_id)
            if not s:
                return
            s['import_progress'] = {"phase": faas, "done": tehtud, "total": kokku}
            self.write(self.upload_id, s)


def taasta_rippuvad_impordid(read_state_func=read_state,
                             write_state_func=write_state,
                             get_upload_lock_func=get_upload_lock) -> None:
    """Käivitusel: rippuv `importing` saab eelmise staatuse tagasi (#256 muster).

    Ilma selleta jääks upload IGAVESEKS `importing`-usse ja CAS keelaks iga
    uue katse — viga oleks püsivam kui see, mille vastu CAS kaitseb.
    Poolik teosekaust on juba `import_as_work` except-harus kustutatud; kui
    restart tabas täpselt kirjutamise ajal, jääb kaust alles ja järgmine katse
    ütleb seda selgelt („Kaust ... on juba olemas").
    """
    from .state import UPLOADS_DIR
    if not os.path.isdir(UPLOADS_DIR):
        return
    for uid in sorted(os.listdir(UPLOADS_DIR)):
        try:
            s = read_state_func(uid)
            if not s or s.get('status') != 'importing':
                continue
            eelmine = s.get('import_prev_status') or 'reviewing'
            _lopeta_import(uid, eelmine, get_upload_lock_func, read_state_func,
                           write_state_func)
            logger.warning("Import taastatud staatusesse %s: %s", eelmine, uid)
        except Exception:
            # Erand ÜHE upload'i pealt ei tohi ülejäänuid taastamata jätta.
            logger.warning("Impordi taaste ebaõnnestus: %s", uid, exc_info=True)


def import_as_work(
    upload_id: str,
    username: str = None,
    *,
    get_upload_lock_func=get_upload_lock,
    read_state_func=read_state,
    write_state_func=write_state,
    **muud,
) -> dict:
    """CAS-i ja taastega ümbris tegeliku impordi ümber.

    Staatus antakse TAGASI iga vea korral (ka `KeyboardInterrupt`/`SystemExit`
    korral — `BaseException`), muidu jääks upload importimatuks.
    """
    eelmine = _alusta_importi(upload_id, get_upload_lock_func, read_state_func,
                              write_state_func)
    try:
        return _teosta_import(
            upload_id,
            username=username,
            get_upload_lock_func=get_upload_lock_func,
            read_state_func=read_state_func,
            write_state_func=write_state_func,
            **muud,
        )
    except BaseException:
        _lopeta_import(upload_id, eelmine, get_upload_lock_func, read_state_func,
                       write_state_func)
        raise


def _teosta_import(
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

    # Staatuse värav on `_alusta_importi`-s (CAS) — siia jõuab ainult
    # 'importing', mille selle kutse enda CAS just seadis.
    edenemine = _Edenemine(upload_id, get_upload_lock_func, read_state_func,
                           write_state_func)

    meta = dating_updates(state['meta'])
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
    # Mudeli veaga leht kuulub teosesse: tühi lehekülg on osa raamatust ja
    # skaneering on olemas, nii et inimene täidab teksti Workspace'is (#250).
    # Ilma selleta kukkus leht vaikselt välja ja järgnevad lehed nihkusid.
    importable = [f for f in state.get('files', [])
                  if not f.get('deleted') and page_status.is_importable(f)]
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

    # ADA provenance: milline lõplik lehekülg kannab millise lähtefaili viidet.
    ada_plokk = state.get('ada') or {}
    ada_ankrud = {}
    if ada_plokk.get('sources'):
        from ..ada import provenance as ada_provenance
        page_map = ((state.get('prepress') or {}).get('page_map')) or {}
        ada_ankrud = ada_provenance.leia_ankrud(
            ada_plokk['sources'], page_map, [f['page'] for f in importable]
        )

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

        tuhjad = blank_import_pages(importable)

        # Lae alla iga soovitud leht
        downloaded = 0
        for jrk, entry in enumerate(importable, start=1):
            pn = entry['page']
            jpg_name = jpg_map[pn]
            txt_name = jpg_name.replace('.jpg', '.txt')

            base_name = page_base_name_func(slug, work_id, pn)
            local_jpg = os.path.join(work_dir, f"{base_name}.jpg")
            local_txt = os.path.join(work_dir, f"{base_name}.txt")
            local_json = os.path.join(work_dir, f"{base_name}.json")

            sftp.get(f"{remote_work}/{jpg_name}", local_jpg)
            os.chmod(local_jpg, 0o644)

            if pn in tuhjad:
                # Mudel ei andnud teksti (tühi leht, kordusloop) — leht luuakse
                # TÜHJA tekstiga ja inimene täidab selle Workspace'is (#250).
                with open(local_txt, 'w', encoding='utf-8') as f:
                    f.write('')
                logger.info(f"import {upload_id}: lk {pn} imporditi tühja tekstiga "
                            f"({entry.get('ocr_error', '')[:120]})")
            else:
                try:
                    sftp.get(f"{remote_work}/{txt_name}", local_txt)
                    normalize_txt_file_func(local_txt)
                except FileNotFoundError:
                    raise ValueError(f"OCR TXT kadus allalaadimise ajal (lk {pn}); import katkestati")
            os.chmod(local_txt, 0o644)

            page_json = {"sequence": pn * 100, "status": "Toores", "page_tags": [],
                         "comments": [], "history": []}
            allikas = ada_ankrud.get(jrk)
            if allikas:
                ada_handle = ada_plokk.get('handle')
                if ada_handle:
                    page_json["source"] = ada_provenance.ehita_source_vali(ada_handle, allikas)
                    page_json["comments"].append(
                        ada_provenance.ehita_kommentaar(ada_handle, allikas)
                    )
                else:
                    # Puuduv handle EI TOHI toota katkist hdl.handle.net/-URL-i —
                    # parem jätta provenance sootuks kirjutamata (vt task-8 review).
                    logger.warning(
                        f"import {upload_id}: ADA handle puudub, lk {pn} jääb "
                        "provenance'ita"
                    )
            with open(local_json, 'w', encoding='utf-8') as f:
                json.dump(page_json, f, ensure_ascii=False, indent=2)
            os.chmod(local_json, 0o644)
            downloaded += 1
            edenemine("downloading", downloaded, len(importable))

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
        "ester_id", "external_url", "year_display", "dating",
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

    edenemine("git", len(importable), len(importable))

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

    edenemine("meili", len(importable), len(importable))

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
    _lopeta_import(upload_id, 'imported', get_upload_lock_func, read_state_func,
                   write_state_func, work_id=work_id)

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
