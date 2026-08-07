"""Batch re-OCR tulemuste (.ocr staging) rakendamine päris .txt failidesse.

Eraldi moodul, sest reocr_ops.py orkestreerib OCR-serverit (SFTP, pollimine);
siin on hoopis staging → päris fail + versioonihaldus. Vt spets
docs/superpowers/specs/2026-08-07-reocr-hulgi-vastuvott-design.md.
"""
import os
import unicodedata
from typing import Dict, List, Tuple

from .config import get_logger
from .git_ops import save_with_git
from .marginalia_normalize import normalize_marginalia_tags

logger = get_logger(__name__)


def _stem(page_filename: str) -> str:
    return os.path.splitext(os.path.basename(page_filename))[0]


def _ocr_path(work_path: str, page_filename: str) -> str:
    return os.path.join(work_path, _stem(page_filename) + ".ocr")


def _txt_path(work_path: str, page_filename: str) -> str:
    return os.path.join(work_path, _stem(page_filename) + ".txt")


def apply_ocr_results(work_path: str, page_filenames: List[str], username: str) -> Dict:
    """Rakendab ootel .ocr tulemused .txt failidesse ÜHE git-commitina.

    Ühe lehe tõrge ei katkesta ülejäänuid — vigased lehed lähevad 'failed' loendisse.
    Tagastab {"applied", "failed", "commit_hash", "git_committed"}.
    """
    applied: List[str] = []
    failed: List[Dict[str, str]] = []
    writes: List[Tuple[str, str]] = []  # [(txt_path, tekst)]

    for page_filename in page_filenames:
        ocr_path = _ocr_path(work_path, page_filename)
        try:
            with open(ocr_path, "r", encoding="utf-8") as f:
                text = f.read()
        except FileNotFoundError:
            failed.append({"filename": page_filename, "error": ".ocr fail puudub"})
            continue
        except OSError as e:
            failed.append({"filename": page_filename, "error": str(e)})
            continue
        # Sama normaliseerimine kui /save teel — marginaalia-tägid kanoonilisele kujule.
        text = normalize_marginalia_tags(unicodedata.normalize("NFC", text))
        writes.append((_txt_path(work_path, page_filename), text))
        applied.append(page_filename)

    if not writes:
        return {"applied": [], "failed": failed, "commit_hash": "", "git_committed": False}

    first_path, first_text = writes[0]
    result = save_with_git(
        first_path,
        first_text,
        username,
        message="Batch re-OCR rakendatud: {} lehte".format(len(writes)),
        additional_files=writes[1:],
    )
    git_committed = bool(result.get("success", False))
    if not git_committed:
        logger.warning(
            "Batch re-OCR: tekst kirjutatud, git-commit ebaõnnestus ({}): {}".format(
                work_path, result.get("error")
            )
        )

    # .ocr koristus ka commiti-tõrke korral: tekst on päris failis juba olemas
    # (save_with_git kirjutab failid enne commiti). Staging'u alles jätmine
    # tekitaks igavesti korduva "ootel" seisu.
    for page_filename in applied:
        try:
            os.remove(_ocr_path(work_path, page_filename))
        except OSError:
            pass

    logger.info(
        "Batch re-OCR rakendatud: {} lehte, {} viga ({})".format(
            len(applied), len(failed), work_path
        )
    )
    return {
        "applied": applied,
        "failed": failed,
        "commit_hash": (result.get("commit_hash") or "")[:8],
        "git_committed": git_committed,
    }


def discard_ocr_results(work_path: str, page_filenames: List[str]) -> Dict:
    """Kustutab ootel .ocr failid ilma rakendamata.

    Git-commiti ega Meili sünki ei toimu — .ocr on staging, mitte versioonihalduses.
    """
    discarded: List[str] = []
    failed: List[Dict[str, str]] = []
    for page_filename in page_filenames:
        try:
            os.remove(_ocr_path(work_path, page_filename))
            discarded.append(page_filename)
        except FileNotFoundError:
            failed.append({"filename": page_filename, "error": ".ocr fail puudub"})
        except OSError as e:
            failed.append({"filename": page_filename, "error": str(e)})
    logger.info(
        "Batch re-OCR tagasi lükatud: {} tulemust ({})".format(len(discarded), work_path)
    )
    return {"discarded": discarded, "failed": failed}
