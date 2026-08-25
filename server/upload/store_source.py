"""Lähtefaili salvestamine VUTT-i poolele.

MUUDATUS TÄNASE VOO SUHTES: fail EI lähe enam kohe OCR-serverisse. Ta jääb
uploads/{id}/source.pdf-i (või source/ kausta), kuni admin on sammu 3 läbinud.
Muidu oleks poolitamiseks hilja — OCR oleks juba alanud.

Tegelik edastus toimub prepress/apply endpointist:
  - triviaalne plaan → transfer_stored_source() (tänane PDF-tee)
  - poolitusi on   → prepress_apply.start_apply() (300 DPI JPG-d)
"""
import os
import shutil
import threading

from ..config import get_logger
from . import file_detection, ocr_client, pdf_subset, prepress_apply, prepress_plan
from . import state as upload_state

logger = get_logger(__name__)


def source_pdf_path(upload_id: str) -> str:
    return os.path.join(upload_state.upload_dir(upload_id), "source.pdf")


def source_images_dir(upload_id: str) -> str:
    return os.path.join(upload_state.upload_dir(upload_id), "source")


def store_pdf(upload_id: str, tmp_path: str) -> int:
    """Salvestab üleslaaditud PDF-i lokaalselt ja loob prepress-plaani.

    Tagastab lehtede arvu. Tõstab ValueError vigase või toetamata faili korral.
    """
    file_type = file_detection.detect_file_type(tmp_path)
    if file_type != "pdf":
        file_detection.safe_unlink(tmp_path)
        raise ValueError(
            "Toetamata failivorming. Palun laadi üles PDF, JPG, PNG või TIFF fail."
        )

    # count_pdf_pages kustutab vigase PDF-i ise — see on siin õige käitumine.
    pages = file_detection.count_pdf_pages(tmp_path)

    dst = source_pdf_path(upload_id)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.move(tmp_path, dst)
    os.chmod(dst, 0o644)

    upload_state.set_upload_state(
        upload_id, status="awaiting_split", expected_pages=pages
    )
    upload_state.init_prepress(upload_id, pages)
    logger.info("Lähte-PDF salvestatud: {} ({} lk)".format(upload_id, pages))
    return pages


def store_image_page(upload_id: str, tmp_path: str, page_number: int,
                     total_pages: int) -> int:
    """Salvestab ühe pildilehe source/ kausta. Rasteriseerimist ei ole."""
    try:
        file_detection.validate_upload_image(tmp_path)
    except ValueError:
        file_detection.safe_unlink(tmp_path)
        raise
    file_type = file_detection.detect_file_type(tmp_path)

    directory = source_images_dir(upload_id)
    os.makedirs(directory, exist_ok=True)
    dst = os.path.join(directory, "pg_{:03d}.jpg".format(page_number))

    if file_type in ("png", "tiff"):
        from PIL import Image
        with Image.open(tmp_path) as im:
            im.convert("RGB").save(dst, "JPEG", quality=95)
        file_detection.safe_unlink(tmp_path)
    else:
        shutil.move(tmp_path, dst)
    os.chmod(dst, 0o644)

    if page_number >= total_pages:
        upload_state.set_upload_state(
            upload_id, status="awaiting_split", expected_pages=total_pages
        )
        upload_state.init_prepress(upload_id, total_pages)
    else:
        upload_state.set_upload_state(
            upload_id, status="collecting_images", expected_pages=total_pages
        )
    return total_pages


def transfer_stored_source(upload_id: str) -> None:
    """Triviaalse plaani tee: saadab salvestatud originaali muutmata.

    See on TÄNANE käitumine, ainult lähtekoht on muutunud (uploads/{id}/ tmp
    faili asemel). Lähtefail jääb alles kuni impordini.
    """
    state = upload_state.read_state(upload_id)
    if not state:
        return

    pdf = source_pdf_path(upload_id)
    if os.path.isfile(pdf):
        _transfer_pdf_thread(upload_id, state, pdf)
        return

    directory = source_images_dir(upload_id)
    if os.path.isdir(directory):
        _transfer_images_thread(upload_id, state, directory)
        return

    upload_state.set_upload_state(
        upload_id, status="error", error_message="Lähteallikat ei leitud"
    )


def _transfer_pdf_thread(upload_id: str, state: dict, pdf: str) -> None:
    from ..config import OCR_SERVER_PATH

    slug = state["meta"]["slug"]
    staging = "{}/{}".format(OCR_SERVER_PATH, state["remote_staging_path"])
    remote_tmp = "{}/{}.pdf.tmp".format(staging, slug)
    remote_dst = "{}/{}.pdf".format(staging, slug)

    plan = state.get("prepress")
    page_count = len((plan or {}).get("pages", []))
    keep = [n for n in range(1, page_count + 1)
            if not prepress_plan.is_excluded(plan, n)]
    needs_subset = page_count > 0 and len(keep) < page_count

    def _run():
        send_path, expected = pdf, None
        if needs_subset:
            try:
                subset = os.path.join(
                    upload_state.upload_dir(upload_id), "apply_tmp", "subset.pdf"
                )
                os.makedirs(os.path.dirname(subset), exist_ok=True)
                expected = pdf_subset.build_subset_pdf(pdf, keep, subset)
                send_path = subset
            except Exception as e:
                # Varutee (a): plaan läheb 300 DPI teele, kus page_cuts
                # väljajätmist juba arvestab. Kasutajat ei tüüdata — ainus
                # tagajärg on ooteaeg —, aga ilma selle logireata ei ole
                # hiljem võimalik aru saada, miks 143-leheline töö võttis
                # 36 sekundi asemel kuus minutit.
                logger.warning(
                    "exclusion-only PDF fast path failed; falling back to "
                    "raster path: upload=%s: %s", upload_id, e
                )
                # apply_and_transfer eeldab, et CAS on juba loa andnud —
                # try_begin_applying jooksis apply endpointis. Uut CAS-i ei
                # tohi teha: staatus on praegu "uploading", mitte
                # "awaiting_split", ja start_apply ütleks lihtsalt ei.
                prepress_apply.apply_and_transfer(upload_id)
                return

        sftp = None
        try:
            sftp = ocr_client.sftp_open(upload_id)
            ocr_client.ensure_remote_dirs(sftp, (staging,))
            sftp.put(send_path, remote_tmp)
            sftp.rename(remote_tmp, remote_dst)
            if expected is not None:
                upload_state.set_upload_state(
                    upload_id, status="processing", expected_pages=expected
                )
            else:
                upload_state.set_upload_state(upload_id, status="processing")
            logger.info("Lähte-PDF edastatud OCR-serverisse: {}".format(upload_id))
        except Exception as e:
            logger.error("PDF edastus {}: {}".format(upload_id, e))
            upload_state.set_upload_state(
                upload_id, status="error", error_message=str(e)
            )
        finally:
            if sftp:
                try:
                    sftp.close()
                except Exception:
                    pass

    upload_state.set_upload_state(upload_id, status="uploading")
    threading.Thread(
        target=_run, daemon=True, name="store-pdf-{}".format(upload_id)
    ).start()


def _transfer_images_thread(upload_id: str, state: dict, directory: str) -> None:
    from ..config import OCR_SERVER_PATH
    from .prepress_apply import publish_atomic

    slug = state["meta"]["slug"]
    # Vanem enne last: work-kaust elab staging-kausta all ja SFTP mkdir ei loo
    # vanemaid ise (vt prepress_apply._transfer_pages).
    remote_staging = "{}/{}".format(OCR_SERVER_PATH, state["remote_staging_path"])
    remote_work = "{}/{}".format(OCR_SERVER_PATH, state["remote_work_path"])

    plan = state.get("prepress")
    names = sorted(os.listdir(directory))
    # Väljajäetud leht ei tohi OCR-serverisse jõuda (viga B). enumerate annab
    # ülejäänutele uue järjenumbri — lehenumbrid nihkuvad ja see on õige:
    # imporditud teoses on täpselt need lehed, mis saadeti.
    kept = [name for i, name in enumerate(names, start=1)
            if not prepress_plan.is_excluded(plan, i)]

    def _run():
        sftp = None
        try:
            sftp = ocr_client.sftp_open(upload_id)
            ocr_client.ensure_remote_dirs(sftp, (remote_staging, remote_work))
            for i, name in enumerate(kept, start=1):
                publish_atomic(
                    sftp,
                    os.path.join(directory, name),
                    "{}/{}_pg_{:03d}.jpg".format(remote_work, slug, i),
                )
            # expected_pages PEAB tulema plaanist, mitte lähtefailist: muidu
            # ootab is_stalled lehti, mida ei tule, ja sammu 4 done-üleminek
            # jääb rippuma. Triviaalteel poolitusi ei ole, seega see arv on
            # sama mis prepress_plan.output_page_count(plan, len(names)).
            upload_state.set_upload_state(
                upload_id, status="processing", expected_pages=len(kept)
            )
        except Exception as e:
            logger.error("Piltide edastus {}: {}".format(upload_id, e))
            upload_state.set_upload_state(
                upload_id, status="error", error_message=str(e)
            )
        finally:
            if sftp:
                try:
                    sftp.close()
                except Exception:
                    pass

    upload_state.set_upload_state(upload_id, status="uploading")
    threading.Thread(
        target=_run, daemon=True, name="store-img-{}".format(upload_id)
    ).start()
