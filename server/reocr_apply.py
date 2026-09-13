"""Batch re-OCR tulemuste (.ocr staging) rakendamine päris .txt failidesse.

Eraldi moodul, sest reocr_ops.py orkestreerib OCR-serverit (SFTP, pollimine);
siin on hoopis staging → päris fail + versioonihaldus. Vt spets
docs/_archive/superpowers/specs/done/2026-08-07-reocr-hulgi-vastuvott-design.md.
"""
import json
import os
import unicodedata
from typing import Dict, List, Optional, Tuple

from .annotation_ops import (
    merge_page_json,
    reconcile_page_annotations,
    split_page_json,
)
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


def _json_path(work_path: str, page_filename: str) -> str:
    return os.path.join(work_path, _stem(page_filename) + ".json")


def _reconcile_annotations(
    work_path: str, page_filename: str, text: str
) -> Tuple[str, Optional[Tuple[str, str]]]:
    """Lepitab uue teksti ankrud lehe JSON-i kirjetega (ADR 0041).

    Tagastab `(tekst, json_write)`, kus `json_write` on `None`, kui lepitada
    ei olnud midagi — muutuseta JSON ei tohi committi minna (ADR 0012).

    Lehe JSON-i puudumine või katkiolek EI tohi teksti rakendamist katkestada:
    OCR-i tulemus on väärtuslikum kui lepitus, ja katkise JSON-i saab
    `scripts/reconcile_annotations.py` hiljem üle käia.
    """
    json_path = _json_path(work_path, page_filename)
    if not os.path.exists(json_path):
        return text, None
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            page_json = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        logger.warning(
            "Annotatsioonide lepitus vahele jäetud, JSON ei loe ({}): {}".format(
                json_path, e
            )
        )
        return text, None
    if not isinstance(page_json, dict):
        return text, None

    meta, wrapped = split_page_json(page_json)
    uus_text, uus_meta, changed = reconcile_page_annotations(text, meta)
    if not changed:
        return text, None

    return uus_text, (
        json_path,
        json.dumps(
            merge_page_json(page_json, uus_meta, wrapped), indent=2, ensure_ascii=False
        ),
    )


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
        # Ankrud ja kirjed lahku ei tohi jääda: uus tekst ei kanna vana teksti
        # `<annN>` tägisid, seega kirjed jääksid ilma lepitust õhku rippuma.
        text, json_write = _reconcile_annotations(work_path, page_filename, text)
        writes.append((_txt_path(work_path, page_filename), text))
        if json_write:
            writes.append(json_write)
        applied.append(page_filename)

    if not writes:
        return {"applied": [], "failed": failed, "commit_hash": "", "git_committed": False}

    first_path, first_text = writes[0]
    result = save_with_git(
        first_path,
        first_text,
        username,
        # Lehtede arv, MITTE failide arv: `writes` kannab ka lepitatud
        # lehe-JSON-eid, mille lugemine commiti sõnumisse oleks eksitav.
        message="Batch re-OCR rakendatud: {} lehte".format(len(applied)),
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
