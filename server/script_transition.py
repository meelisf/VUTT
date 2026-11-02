"""ADR 0077 üleminekukiht: vana suhteline `<cs>` ei tohi korpusesse tagasi tulla.

Kolm teed (ADR 0077 p 7), kõik ühe teisendusfunktsiooniga (`cs_to_f`) ja manifestiga:
- vana mudeli väljund üleminekuajal (`ocr_to_absolute`: re-OCR `.ocr`, upload'i import);
- ajaloo taastamine (`restored_to_absolute`, `/git-restore`);
- vananenud redaktoriseanss (`stale_premigration_base` → `/save` 409) ja vana
  JS-kimp, mis saadab veel `<cs>`-i (`incoming_to_absolute`).

Mudeli vahetusel (uus LOSSi trükimudel + mõlemad juhised `<f>`-ile) pannakse
`config.OCR_OUTPUT_RELATIVE_CS = False`; siis jääb alles ainult ajaloo ja
vananenud sisendi kaitse.
"""
import json
from typing import Optional
import os
from datetime import datetime

from . import config
from .config import BASE_DIR, get_logger
from .script_migration import infer_base, is_premigration_base, load_manifest, to_absolute

logger = get_logger(__name__)

MANUSCRIPT_TYPE = "Q87167"


def _work_meta(slug: str) -> dict:
    try:
        with open(os.path.join(BASE_DIR, os.path.basename(slug), "_metadata.json"), encoding="utf-8") as f:
            meta = json.load(f)
        return meta if isinstance(meta, dict) else {}
    except (OSError, ValueError):
        return {}


def _work_id(slug: str) -> Optional[str]:
    return _work_meta(slug).get("id")


def _abs(text: str):
    """`to_absolute` kirjutusteel: tundmatu keele korral EI tohi `<cs>` alles jääda —
    varuvariant on lehe poolitusmärk, siis antiikva (migratsioonis läheb selline leht
    hoopis ülevaatusse)."""
    return to_absolute(text, fallback=infer_base([text])[0] or "A")


def incoming_to_absolute(slug: str, text: str) -> str:
    """`<cs>`-iga sisend (vana JS-kimp) → `<f>` keelepõhise põhikirjaga. Ilma `<cs>`-ita muutumata."""
    if "<cs>" not in (text or ""):
        return text
    new, info = _abs(text)
    logger.warning("ADR 0077: <cs>-iga sisend teisendati (%s, %s)", slug, info.get("reason"))
    return new


def ocr_to_absolute(slug: str, text: str, *, manuscript: Optional[bool] = None) -> str:
    """Vana trükimudeli väljund üleminekuajal — sama `to_absolute` mis migratsioonil
    (põhikiri keelest; OCR-väljundi poolitusmärk on mudeli oma, mitte tõend).
    Idempotentne: `<f>`-iga tekst ja antiikvaleht jäävad teisel kutsel samaks.
    Käekiri ei kanna kirjamärgendust → muutumata."""
    if not config.OCR_OUTPUT_RELATIVE_CS or not text:
        return text
    if manuscript is None:
        manuscript = (_work_meta(slug).get("type") or {}).get("id") == MANUSCRIPT_TYPE
    if manuscript:
        return text
    return _abs(text)[0]


def _commit_time(commit_hash: str) -> Optional[datetime]:
    try:
        from .git_ops import get_or_init_repo
        return get_or_init_repo().commit(commit_hash).committed_datetime
    except Exception:
        return None


def restored_to_absolute(slug: str, content: str, commit_hash: str) -> str:
    """Ajaloo versioon enne kirjutamist (`/git-restore`).

    `<cs>`-iga versioon on migratsioonieelne definitsiooni järgi. `<cs>`-ita versioon on
    migratsioonieelne, kui tema commit on vanem kui teose `migrated_at` manifestis —
    siis läbib ta sama keelepõhise teisenduse (märgendamata vana fraktuurtekst).
    """
    if "<cs>" in (content or ""):
        return _abs(content)[0]
    if "<f>" in (content or ""):
        return content
    entry = load_manifest()["works"].get(_work_id(slug) or "")
    migrated_at = (entry or {}).get("migrated_at")
    when = _commit_time(commit_hash) if migrated_at else None
    if when is not None and when < datetime.fromisoformat(migrated_at):
        return _abs(content)[0]
    return content


def stale_premigration_base(slug: str, filename: str, base_text: str) -> bool:
    """Kas kliendi `base` on migratsioonieelne tekst (vahelehe avas enne migratsiooni)."""
    wid = _work_id(slug)
    return bool(wid) and is_premigration_base(wid, filename, base_text or "")
