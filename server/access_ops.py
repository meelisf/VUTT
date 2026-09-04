import json
import os
from typing import Optional

from fastapi import HTTPException

from .cache import get_cached_collections
from .auth import is_at_least


def is_work_public(work_metadata: dict) -> bool:
    """Arvutab teose avalikkuse dünaamiliselt collections.json põhjal.
    "public wins": piisab ühest avalikust kollektsioonist.
    """
    work_cols = work_metadata.get("collections", [])
    if not work_cols:
        return True
    collections_config = get_cached_collections()
    for col_id in work_cols:
        if collections_config.get(col_id, {}).get("visibility", "public") == "public":
            return True
    return False


def can_read_work(work_metadata: dict, user: Optional[dict]) -> bool:
    """Kontrollib kas kasutajal on õigus teost lugeda.
    Kasutatakse kõigil lugemise endpoint'idel, sõltumata Meilisearch'i indeksist.
    """
    if is_work_public(work_metadata):
        return True
    if work_metadata.get("shareable", False):
        return True
    if user is None:
        return False
    if is_at_least(user.get("role", "contributor"), "admin"):
        return True
    allowed = set(user.get("allowed_collections", []))
    work_collections = set(work_metadata.get("collections", []))
    return bool(allowed & work_collections)


def can_write_work(work_metadata: dict, user: Optional[dict]) -> bool:
    """Kontrollib kas kasutajal on õigus teost MUUTA (salvestada, kommenteerida).

    Kaks tingimust, mõlemad kohustuslikud (ADR 0031):
    1. Lugemisõigus — kirjutamisõigus EI anna kunagi lugemisõigust.
    2. Ulatus — contributor tohib kirjutada ainult oma edit_collections'i teostesse.
       editor+ jaoks on ulatus piiramata ja väli eiratakse.

    Kollektsioonita teos ei ole contributor'ile kirjutatav (fail-closed).
    """
    if user is None:
        return False
    if not can_read_work(work_metadata, user):
        return False
    # `.get(key, default)` ei asenda `None`-i, kui võti EKSISTEERIB väärtusega None
    # (nt {"role": None}) — vaikeväärtus rakendub ainult puuduva võtme korral. Seepärast
    # `or`, mitte `.get(..., "contributor")` üksi: fail-closed ka role=None puhul.
    role = user.get("role") or "contributor"
    if role != "contributor":
        return True
    scope = set(user.get("edit_collections", []))
    if not scope:
        return False
    return bool(scope & set(work_metadata.get("collections", [])))


def require_catalog_access(catalog: str, user: dict, base_dir: str,
                           *, write: bool = False) -> dict:
    """Loeb teose meta ja kontrollib ligipääsu. Fail-closed: vigane või puuduv
    meta ei tähenda avalikku teost.

    base_dir on parameeter, mitte mooduli konstant, sest kutsuja moodul (editing,
    notifications) omab oma BASE_DIR-i ja testid patchivad just seda.
    """
    if not catalog or catalog != os.path.basename(catalog):
        raise HTTPException(status_code=400, detail="Vigane teose tee")
    work_dir = os.path.join(base_dir, catalog)
    meta_path = os.path.join(work_dir, "_metadata.json")
    if not os.path.isdir(work_dir) or not os.path.exists(meta_path):
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
    except Exception:
        raise HTTPException(status_code=503, detail="Teose metaandmeid ei saa praegu lugeda")
    if not isinstance(meta, dict):
        raise HTTPException(status_code=503, detail="Teose metaandmed on vigased")
    allowed = can_write_work(meta, user) if write else can_read_work(meta, user)
    if not allowed:
        raise HTTPException(status_code=403, detail="Puudub õigus sellele teosele")
    return meta
