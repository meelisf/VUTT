"""300 DPI läbikäik: renderda → lõika → saada → kustuta, lehthaaval.

Eraldi moodul prepress.py-st, sest see on ainus koht, mis puudutab SFTP-d ja
OCR-serveri nimekonventsiooni.

Voogedastus, mitte materialiseerimine: 300-leheline topeltlehtedega teos annaks
~1 GB JPG-sid. Kõrvalefektina alustab OCR-server lehest 1 sel ajal, kui meie
alles renderdame lehte 50.
"""
import os
import shutil
import threading
from typing import Optional

from ..config import OCR_SERVER_PATH, get_logger
from . import ocr_client, page_source, prepress, prepress_plan, thumbs
from . import state as upload_state

logger = get_logger(__name__)


def remote_page_name(slug: str, out_index: int) -> str:
    """OCR-serveri nimekonventsioon: valvur leiab pildid rglob-iga."""
    return "{}_pg_{:03d}.jpg".format(slug, out_index)


# Aatomiline avaldamine elab ocr_client.py-s — sama teostust kasutab ka re-OCR
# (#220). Nimi jääb siia re-ekspordina, sest kutsujad ja testid tunnevad seda.
publish_atomic = ocr_client.publish_atomic


def _write_cut(src_img_path: str, x0: int, x1: int, dst: str) -> None:
    """Kirjutab lõike [x0, x1) eraldi JPG-na. x1 == laius → tervikleht."""
    from PIL import Image

    with Image.open(src_img_path) as im:
        rgb = im.convert("RGB")
        if x0 == 0 and x1 >= rgb.size[0]:
            rgb.save(dst, "JPEG", quality=page_source.JPEG_QUALITY)
            return
        rgb.crop((x0, 0, x1, rgb.size[1])).save(
            dst, "JPEG", quality=page_source.JPEG_QUALITY
        )


def can_copy_source_bytes(source, plan: Optional[dict], n: int, width: int) -> bool:
    """Kas lehe N võib avaldada ORIGINAALBAITIDENA, ilma PIL-i läbimata.

    Tingimused on tahtlikult ranged — see peab olema päris identity-teisendus:
      1. allikas on failipõhine (pildikaust, mitte PDF)
      2. `page_cuts` annab TÄPSELT ühe lõike, mis katab kogu laiuse
         (vertikaalset lõikamist andmemudelis ei eksisteeri, seega y-mõõdet ei
         ole vaja kontrollida)
      3. fail on JPEG — LOSS võtab selle muutmata vastu
      4. EXIF orientation puudub või on 1

    Punkt 4 on see, mis kergesti märkamata jääb: PIL-i `convert("RGB").save()`
    viskab EXIF-i ära, baithaaval koopia säilitab selle. Pöördega JPEG näeks
    kahel teel erinev välja.
    """
    path = source.source_file(n)
    if not path:
        return False
    if not path.lower().endswith((".jpg", ".jpeg")):
        return False
    if prepress_plan.page_cuts(plan, n, width) != [(0, width)]:
        return False
    try:
        from PIL import Image
        with Image.open(path) as im:
            if im.getexif().get(274, 1) != 1:      # 274 = Orientation
                return False
    except Exception:
        return False
    return True


def _write_thumb(upload_id: str, thumbs_dir: str, out_index: int, src: str) -> None:
    """Kirjutab väljundlehe pisipildi. Viga EI TOHI apply't katkestada.

    Kaugpilt on selleks hetkeks juba `publish_atomic`-uga avaldatud ja OCR võib
    sellega alustada. Tuletatud UI-artefakti pärast konveieri mahavõtmine oleks
    vale kompromiss; puuduva pisipildi taastab `processing`-aegne backfill.
    """
    try:
        thumbs.write_thumbnail(
            src, os.path.join(thumbs_dir, "{:03d}.jpg".format(out_index))
        )
    except Exception as e:
        logger.warning("Pisipilt {} lk {}: {}".format(upload_id, out_index, e))


def _byte_copy_path(upload_id: str, source, plan: Optional[dict], n: int) -> Optional[str]:
    """Lähtefaili tee, kui lehe võib avaldada baithaaval; muidu None.

    Laius loetakse metaandmetest (PIL ei dekodeeri pikslimassiivi `open`-i
    peale), seega kontroll ise on odav.
    """
    path = source.source_file(n)
    if not path:
        return None
    try:
        from PIL import Image
        with Image.open(path) as im:
            laius = im.size[0]
    except Exception as e:
        logger.warning("Baitkoopia kontroll {} lk {}: {}".format(upload_id, n, e))
        return None
    return path if can_copy_source_bytes(source, plan, n, laius) else None


def _transfer_pages(upload_id: str, slug: str, remote_dirs: tuple,
                    remote_work: str, plan: Optional[dict]) -> int:
    """Renderdab, lõikab ja saadab kõik lehed. Tagastab saadetud lehtede arvu.

    `remote_dirs` on VANEM-ENNE järjekorras: work-kaust elab staging-kausta all
    ja SFTP mkdir ei loo vanemaid ise — puuduv vanem annab ENOENT ja kogu
    partii kukub läbi. Sama järjekord nagu `_prepare_image_upload` tagastab.
    """
    src_path = prepress.source_path(upload_id)
    if not src_path:
        raise FileNotFoundError("Lähteallikat ei leitud: {}".format(upload_id))

    source = page_source.open_page_source(src_path)
    count = source.page_count()
    work_dir = os.path.join(upload_state.upload_dir(upload_id), "apply_tmp")
    os.makedirs(work_dir, exist_ok=True)
    # Pisipildid sünnivad SIIN, mitte hiljem SFTP-ga tagasi tõmmates: pikslid on
    # niikuinii kettal. Vastutasuks tohib poll apply ajal olla pelk lugeja (I2).
    thumbs_dir = os.path.join(upload_state.upload_dir(upload_id), "thumbs")
    os.makedirs(thumbs_dir, exist_ok=True)

    sftp = ocr_client.sftp_open(upload_id)
    out_index = 0
    try:
        ocr_client.ensure_remote_dirs(sftp, remote_dirs)
        for n in range(1, count + 1):
            if prepress_plan.is_excluded(plan, n):
                continue

            # Baithaaval kiirtee: pildikausta leht, millel teisendust ei ole.
            # Rasteriseerimist ei toimu, seega ka semafori ei ole vaja.
            kiirtee = _byte_copy_path(upload_id, source, plan, n)
            if kiirtee:
                out_index += 1
                name = remote_page_name(slug, out_index)
                publish_atomic(sftp, kiirtee, "{}/{}".format(remote_work, name))
                _write_thumb(upload_id, thumbs_dir, out_index, kiirtee)
                upload_state.mutate_prepress(
                    upload_id, lambda p, n=n: p.update(applied_done=n)
                )
                continue

            full = os.path.join(work_dir, "full.jpg")
            # Semafor LEHE kaupa, mitte partii ümber (#219): kaitse eesmärk on
            # üks rasteriseerimine korraga. Partii ümber hoituna seisaks teise
            # uploadi eelvaade terve 300 DPI läbikäigu taga (minuteid). Lõikamine
            # ja SFTP jäävad välja — võrguootel ei ole CPU-semaforis kohta.
            with prepress.RENDER_SEMAPHORE:
                source.render_full(n, full)
            try:
                from PIL import Image
                with Image.open(full) as im:
                    width = im.size[0]

                for (x0, x1) in prepress_plan.page_cuts(plan, n, width):
                    out_index += 1
                    name = remote_page_name(slug, out_index)
                    cut = os.path.join(work_dir, name)
                    try:
                        _write_cut(full, x0, x1, cut)
                        publish_atomic(sftp, cut, "{}/{}".format(remote_work, name))
                        _write_thumb(upload_id, thumbs_dir, out_index, cut)
                    finally:
                        if os.path.exists(cut):
                            os.unlink(cut)
            finally:
                if os.path.exists(full):
                    os.unlink(full)

            upload_state.mutate_prepress(
                upload_id, lambda p, n=n: p.update(applied_done=n)
            )
    finally:
        try:
            sftp.close()
        except Exception:
            pass
        shutil.rmtree(work_dir, ignore_errors=True)

    return out_index


def apply_and_transfer(upload_id: str) -> None:
    """Taustalõime siht. Eeldab, et try_begin_applying on juba loa andnud."""
    state = upload_state.read_state(upload_id)
    if not state:
        return
    slug = state["meta"]["slug"]
    remote_staging = "{}/{}".format(OCR_SERVER_PATH, state["remote_staging_path"])
    remote_work = "{}/{}".format(OCR_SERVER_PATH, state["remote_work_path"])
    plan = state.get("prepress")

    try:
        sent = _transfer_pages(
            upload_id, slug, (remote_staging, remote_work), remote_work, plan
        )
        upload_state.set_upload_state(
            upload_id, status="processing", expected_pages=sent
        )
        logger.info("Prepress apply valmis: {} → {} lehte".format(upload_id, sent))
    except Exception as e:
        logger.error("Prepress apply {}: {}".format(upload_id, e))
        upload_state.set_upload_state(
            upload_id, status="error", error_message=str(e)
        )


def start_apply(upload_id: str) -> bool:
    """CAS + taustalõim. False = töö juba käib (topeltklikk, retry, refresh)."""
    if not upload_state.try_begin_applying(upload_id):
        return False
    threading.Thread(
        target=apply_and_transfer, args=(upload_id,),
        daemon=True, name="prepress-apply-{}".format(upload_id),
    ).start()
    return True
