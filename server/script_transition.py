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
from .script_migration import cs_to_f, infer_base, is_premigration_base, load_manifest

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


def _base_for(slug: str, text: str) -> str:
    """Põhikiri: manifestist; uue teose puhul lehe poolitusmärgist; muidu 'A'."""
    entry = load_manifest()["works"].get(_work_id(slug) or "")
    if entry:
        return entry["base"]
    return infer_base([text])[0] or "A"


def incoming_to_absolute(slug: str, text: str) -> str:
    """`<cs>`-iga sisend (vana JS-kimp, vana mudel) → `<f>`. Ilma `<cs>`-ita muutumata."""
    if "<cs>" not in (text or ""):
        return text
    base = _base_for(slug, text)
    logger.warning("ADR 0077: <cs>-iga sisend teisendati (%s, põhikiri %s)", slug, base)
    return cs_to_f(text, base)


def ocr_to_absolute(slug: str, text: str, *, manuscript: Optional[bool] = None) -> str:
    """Vana trükimudeli väljund üleminekuajal. Idempotentne (kutsutakse mitu korda).

    - `<cs>`-iga leht → teisendus teose põhikirjaga;
    - `<cs>`-ita leht teisendatakse ainult siis, kui LEHE ENDA signaal on fraktuur
      (vana mudel ei märgi terves fraktuurlehes midagi). Manifesti põhikirja siin ei
      kasutata: teisendusest märgenduseta jäänud antiikvaleht mähitaks muidu teisel
      kutsel tervikuna `<f>`-i.
    Käekiri ei kanna kirjamärgendust → muutumata.
    """
    if not config.OCR_OUTPUT_RELATIVE_CS or not text:
        return text
    if manuscript is None:
        manuscript = (_work_meta(slug).get("type") or {}).get("id") == MANUSCRIPT_TYPE
    if manuscript:
        return text
    if "<cs>" in text:
        return cs_to_f(text, _base_for(slug, text))
    if "<f>" not in text and infer_base([text])[0] == "F":
        return cs_to_f(text, "F")
    return text


def _commit_time(commit_hash: str) -> Optional[datetime]:
    try:
        from .git_ops import get_or_init_repo
        return get_or_init_repo().commit(commit_hash).committed_datetime
    except Exception:
        return None


def restored_to_absolute(slug: str, content: str, commit_hash: str) -> str:
    """Ajaloo versioon enne kirjutamist (`/git-restore`).

    `<cs>`-iga versioon on migratsioonieelne definitsiooni järgi. Fraktuurteose
    märgendamata vana tekst (`<cs>`-i ega `<f>`-i ei ole) on migratsioonieelne, kui
    tema commit on vanem kui teose `migrated_at` manifestis.
    """
    if "<cs>" in (content or ""):
        return cs_to_f(content, _base_for(slug, content))
    entry = load_manifest()["works"].get(_work_id(slug) or "")
    if not entry or entry.get("base") != "F" or "<f>" in (content or ""):
        return content
    migrated_at = entry.get("migrated_at")
    when = _commit_time(commit_hash)
    if not migrated_at or when is None:
        return content
    if when < datetime.fromisoformat(migrated_at):
        return cs_to_f(content, "F")
    return content


def stale_premigration_base(slug: str, filename: str, base_text: str) -> bool:
    """Kas kliendi `base` on migratsioonieelne tekst (vahelehe avas enne migratsiooni)."""
    wid = _work_id(slug)
    return bool(wid) and is_premigration_base(wid, filename, base_text or "")
