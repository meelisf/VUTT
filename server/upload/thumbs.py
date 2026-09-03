"""Uploadi OCR-progressi polling ja pisipiltide sünk.

Moodul küsib OCR-serveri SFTP kaustast valmis JPG+TXT paare, loob lokaalsed
pisipildid ning uuendab uploadi state.json-i.
"""
import io
import os
from datetime import datetime
from typing import Any, Callable, Optional

from ..config import OCR_SERVER_PATH, get_logger
from .. import ocr_err
from . import file_detection, prepress_plan, state as upload_state
from .ocr_client import sftp_open

logger = get_logger(__name__)


def _close_quietly(sftp):
    """Sulgeb SFTP seansi vigu ignoreerides."""
    if sftp:
        try:
            sftp.close()
        except Exception:
            pass


THUMB_BOX = (400, 600)
THUMB_QUALITY = 85


def write_thumbnail(src_path: str, dst_path: str) -> None:
    """Kirjutab pildist pisipildi ATOMAARSELT (`.tmp` + `os.replace`).

    Atomaarsus ei ole ilutsemine: `/admin/upload/{id}/thumb/{n}` serveerib seda
    faili otse ja poll võib samal ajal sama nime kirjutada. Otse lõppteele
    salvestamine (endine käitumine) lasi lugejal näha poolikut JPEG-i.

    Kutsuvad NII poll (SFTP-ga alla laaditud pildist) KUI prepress_apply
    (kohapeal renderdatud 300 DPI pildist) — üks teostus, mitte kaks.

    Sufiks on `.part`, MITTE `.tmp`: poll kasutab `{n:03d}.jpg.tmp` nime
    allalaadimise ajutise failina JA „teine lõim juba laadib" märgina. Sama nime
    kasutades kirjutaks see funktsioon oma sisendi keset lugemist üle ja
    viskaks selle siis `os.replace`-iga minema.
    """
    from PIL import Image

    tmp_path = dst_path + ".part"
    try:
        with Image.open(src_path) as img:
            thumb = img.convert("RGB")
            thumb.thumbnail(THUMB_BOX, Image.LANCZOS)
            thumb.save(tmp_path, "JPEG", quality=THUMB_QUALITY)
        os.replace(tmp_path, dst_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _create_thumbnail(sftp, remote_jpg: str, tmp_thumb: str, thumb_path: str):
    """Laeb remote JPG-i alla ja salvestab sellest lokaalse pisipildi.

    Õhuke SFTP-ümbris `write_thumbnail`-i ümber. `tmp_thumb` on ALLALAADIMISE
    ajutine fail (mitte pisipildi oma) ja jääb kutsuja omandisse — poll kasutab
    selle olemasolu märgina „teine lõim juba laadib".
    """
    sftp.get(remote_jpg, tmp_thumb)
    write_thumbnail(tmp_thumb, thumb_path)
    os.unlink(tmp_thumb)


def _read_err_reason(sftp, remote_work: str, failed_bases: set, page_num: int) -> str:
    """Loeb ebaõnnestunud lehe .err märgendi sisu (lühike põhjus OCR-serverist)."""
    for base in failed_bases:
        if file_detection.extract_page_num(base) != page_num:
            continue
        try:
            buf = io.BytesIO()
            sftp.getfo(f"{remote_work}/{base}.err", buf)
            msg = buf.getvalue().decode("utf-8", errors="replace").strip()
            if msg:
                return msg[:500]
        except Exception as e:
            logger.warning(f".err lugemine ebaõnnestus {base}: {e}")
        break
    return "OCR ebaõnnestus (põhjus teadmata)"


def _planned_pages(state: dict, expected_pages) -> Optional[int]:
    """Mitu lehte OCR-i LÄHEB — viisardi kohatäidete arv.

    Poolitamise ajal on `expected_pages` veel LÄHTE-PDF-i lehtede arv; väljundis
    on igast poolitatavast lehest kaks. Ilma selleta näeks kasutaja vale kuju
    (33 kohatäidet 60 asemel) või mitte midagi, kuni esimesed lehed valmivad.
    """
    # AINULT enne apply lõppu: pärast seda on `expected_pages` juba väljundi arv
    # ja plaani uuesti rakendamine loeks poolitused KAKS korda (62 → 89).
    plaan = state.get("prepress")
    if plaan and expected_pages and state.get("status") in upload_state.PREPRESS_IDLE_STATUSES:
        try:
            return prepress_plan.output_page_count(plaan, int(expected_pages))
        except Exception as e:
            logger.warning(f"planned_pages arvutus ebaõnnestus: {e}")
    return expected_pages


def _payload(state: dict, upload_id: str, status: str, expected_pages, **lisa) -> dict:
    """Staatuse-vastuse ÜKS kuju.

    Iga uus väli tuleb lisada AINULT siia: `poll_and_sync_thumbs`-il on viis
    väljumisteed ja käsitsi lisamisel jäid neist kaks maha (`planned_pages`
    puudus vigase PDF-i ja „töökaust pole veel loodud" harudest).
    """
    payload = {
        "status": status,
        "ready": 0,
        "total": 0,
        "expected_pages": expected_pages,
        "planned_pages": _planned_pages(state, expected_pages),
        "files": state.get("files", []),
        "progress": upload_state.upload_progress.get(upload_id, {}),
        # Mitu LÄHTE-lehte on apply juba läbi töötanud. Viisard näitab seda
        # `applying` ajal — see faas on „renderdan ja saadan", mitte „OCR
        # töötleb" (ADR 0028).
        "applied_done": (state.get("prepress") or {}).get("applied_done", 0),
    }
    payload.update(lisa)
    return payload


def poll_and_sync_thumbs(
    upload_id: str,
    *,
    sftp_open_func: Callable[[str], Any] = sftp_open,
    ocr_server_path: str = OCR_SERVER_PATH,
) -> dict:
    """
    Küsib SFTP kaudu OCR serveri kausta, tuvastab valmis JPG+TXT paarid,
    laeb alla uued pisipildid (Pillow thumbnail 400x600) ja uuendab state.json.

    Tagastab: {status, ready, total, expected_pages, files, progress, error?}
    """
    state_lock = upload_state.get_upload_lock(upload_id)
    with state_lock:
        state = upload_state.read_state(upload_id)
    if not state:
        return {"error": "Upload ei leitud"}

    current_status = state.get("status", "pending")
    expected_pages = state.get("expected_pages")

    # Apply ajal on poll LUGEJA (ADR 0028):
    #   I1 — elutsükli-staatust omab apply-lõim; poll ei tohi seda muuta.
    #   I2 — VUTT ei tõmba tagasi pilte, mille ta ise just saatis.
    on_applying = current_status == "applying"

    # Uploading/pending/collecting_images/error: SFTP-d pole vaja
    # PREPRESS_IDLE_STATUSES: fail on VUTT-i poolel, OCR-serveris pole veel midagi
    if current_status in (
        "pending", "uploading", "error", "imported", "collecting_images",
        # ADA allalaadimine käib VUTT-i poolel; OCR-serveris ei ole veel midagi.
        "ada_fetching", "ada_error",
    ) + upload_state.PREPRESS_IDLE_STATUSES:
        return _payload(state, upload_id, current_status, expected_pages,
                        error=state.get("error_message"))

    slug = state["meta"]["slug"]
    remote_work = f"{ocr_server_path}/{state['remote_work_path']}"
    thumbs_dir = os.path.join(upload_state.upload_dir(upload_id), "thumbs")

    sftp = None
    try:
        sftp = sftp_open_func(upload_id)

        # --- Kontrolli VIGASED kausta ---
        vigased_path = f"{ocr_server_path}/VIGASED/{slug}.pdf"
        try:
            sftp.stat(vigased_path)
            # PDF on vigane — OCR teenus teisaldas selle
            err_msg = "PDF on vigane — OCR teenus ei suutnud seda töödelda"
            with state_lock:
                s = upload_state.read_state(upload_id)
                if s and s.get("status") != "error":
                    s["status"] = "error"
                    s["error_message"] = err_msg
                    upload_state.write_state(upload_id, s)
            return _payload(state, upload_id, "error", expected_pages, error=err_msg)
        except FileNotFoundError:
            pass  # OK — PDF pole vigane

        # --- SFTP ls remote work path ---
        try:
            remote_files = sftp.listdir(remote_work)
        except FileNotFoundError:
            # Töökaust pole veel loodud (OCR pole alustanud)
            return _payload(state, upload_id, "processing", expected_pages)

        # --- Leia JPG-d ja TXT-d ---
        jpg_bases = {os.path.splitext(f)[0] for f in remote_files if f.lower().endswith(".jpg")}
        txt_bases = {os.path.splitext(f)[0] for f in remote_files if f.lower().endswith(".txt")}
        # .err = OCR-server märkis lehe LÕPLIKULT vigaseks (#250). Ilma selleta
        # ei saaks upload kunagi valmis: vigane leht ei jõua ready_bases'i ega
        # kao järjekorrast, ja viisard jääks igavesti "töötleb" seisu.
        err_bases = {os.path.splitext(f)[0] for f in remote_files if f.lower().endswith(".err")}
        ready_bases = jpg_bases & txt_bases  # Mõlemad olemas = OCR valmis
        failed_bases = (jpg_bases & err_bases) - ready_bases

        # --- Laadi alla UUED valmis JPG-d (ainult mille jaoks on ka TXT) ---
        os.makedirs(thumbs_dir, exist_ok=True)
        existing_thumbs = set(os.listdir(thumbs_dir))

        # Pisipilt tõmmatakse iga JPG-ga: pilt ilmub avaldamise tempos ja OCR-i
        # valmimine liigub üle nende eraldi (ready_bases jääb ainult has_ocr
        # märgiks). Varem ootas pisipilt lehe .txt-d ja kasutaja nägi minuteid
        # tühja ekraani.
        #
        # I2: `applying` ajal kirjutab pisipildid prepress_apply LOKAALSELT,
        # sealsamas kus 300 DPI pikslid juba on. publish_atomic ja
        # write_thumbnail vahel on aken, kus kaug-JPG on olemas ja lokaalne
        # pisipilt mitte — ilma selle valvurita tõmbaks poll just selles aknas
        # pildi võrgu kaudu tagasi.
        if not on_applying:
            for base in sorted(jpg_bases):
                page_num = file_detection.extract_page_num(base)
                if page_num <= 0:
                    continue
                thumb_name = f"{page_num:03d}.jpg"
                if thumb_name in existing_thumbs:
                    continue
                tmp_thumb = os.path.join(thumbs_dir, f"{page_num:03d}.jpg.tmp")
                if os.path.exists(tmp_thumb):
                    continue  # Teise threadi poolt juba allalaadimisel

                try:
                    thumb_path = os.path.join(thumbs_dir, thumb_name)
                    _create_thumbnail(sftp, f"{remote_work}/{base}.jpg", tmp_thumb, thumb_path)
                    existing_thumbs.add(thumb_name)
                    logger.info(f"Thumbnail loodud: {upload_id}/{thumb_name}")
                except Exception as e:
                    logger.warning(f"Thumbnail {thumb_name} allalaadimine ebaõnnestus: {e}")
                    try:
                        os.unlink(tmp_thumb)
                    except Exception:
                        pass

        # --- Ehita files massiiv ---
        all_page_nums = sorted(
            {file_detection.extract_page_num(b) for b in jpg_bases if file_detection.extract_page_num(b) > 0}
        )
        ready_page_nums = {file_detection.extract_page_num(b) for b in ready_bases if file_detection.extract_page_num(b) > 0}
        failed_page_nums = {file_detection.extract_page_num(b) for b in failed_bases if file_detection.extract_page_num(b) > 0}
        existing_deleted = {f["page"]: f.get("deleted", False) for f in state.get("files", [])}
        existing_errors = {f["page"]: f.get("ocr_error") for f in state.get("files", [])}

        new_files = []
        for pn in all_page_nums:
            entry = {
                "page": pn,
                "filename": f"{pn:03d}.jpg",
                "has_ocr": pn in ready_page_nums,
                # PILDI märk, eraldi OCR-i märgist: pisipilt tuleb JPG-ga,
                # tekst hiljem. Viisard EI TOHI pilti `has_ocr` taha gate'ida
                # (kasutaja ei näeks minuteid juba alla laaditud pilte), aga ei
                # tohi ka pimesi `<img>`-i renderdada — puuduva faili 404 jääb
                # PÜSIVALT katki, sest `src` string ei muutu ja brauser ei
                # proovi uuesti. Sama muster kui prepressi `isPreviewReady`.
                "has_thumb": f"{pn:03d}.jpg" in existing_thumbs,
                "deleted": existing_deleted.get(pn, False),
            }
            if pn in failed_page_nums:
                # Põhjus loetakse ÜKS kord ja jääb state'i — .err failid on
                # pisikesed, aga poll käib iga 60 s.
                sisu = existing_errors.get(pn) or _read_err_reason(
                    sftp, remote_work, failed_bases, pn)
                entry["ocr_error"] = sisu
                # Kategooria otsustab, kas lehte saab tühjana importida (#250).
                entry["ocr_error_kind"] = ocr_err.parse_err(sisu)[0]
            new_files.append(entry)

        # --- Uus staatus ---
        ready_count = len(ready_page_nums)
        # Lahendatud = valmis VÕI lõplikult ebaõnnestunud. Ainult ready_count'i
        # lugemine jätaks vigase lehega upload'i igavesti pooleli (#250).
        resolved_count = ready_count + len(failed_page_nums)
        new_status = current_status
        # I1: `applying` ajal ei ole sisendvoog veel suletud. Ilma selle
        # valvurita kirjutaks juba esimene JPG-d näinud poll staatuse
        # `reviewing`-uks keset apply't, ja apply-lõimu lõpetav `processing`
        # tuleks alles pärast seda. `applying → processing` teeb AINULT
        # apply-lõim; `processing`-ust alates võtab poll ülemineku üle.
        if not on_applying:
            if expected_pages and resolved_count >= expected_pages:
                new_status = "done"
            elif all_page_nums:
                new_status = "reviewing"

        # --- Stall-indikaator: jälgi millal viimati uus valmis leht tekkis ---
        now_ts = datetime.now().timestamp()
        prev_resolved = sum(1 for f in state.get("files", [])
                            if f.get("has_ocr") or f.get("ocr_error"))
        last_progress_at = state.get("last_progress_at")
        # Edenes (uusi lahendatud lehti) VÕI puudub baseline (esimene poll) → uuenda ajatempel
        if resolved_count > prev_resolved or last_progress_at is None:
            last_progress_at = now_ts

        # --- Uuenda state.json ---
        with state_lock:
            s = upload_state.read_state(upload_id)
            if s:
                s["files"] = new_files
                s["last_progress_at"] = last_progress_at
                if new_status != s.get("status"):
                    s["status"] = new_status
                upload_state.write_state(upload_id, s)

        return _payload(
            state, upload_id, new_status, expected_pages,
            ready=ready_count,
            failed=sorted(failed_page_nums),
            total=len(all_page_nums),
            files=new_files,
            stalled=upload_state.is_stalled(resolved_count, expected_pages, last_progress_at, now_ts),
        )

    except Exception as e:
        logger.error(f"poll_and_sync_thumbs {upload_id}: {e}")
        return _payload(state, upload_id, current_status, expected_pages, error=str(e))
    finally:
        _close_quietly(sftp)
