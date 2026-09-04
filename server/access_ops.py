from .cache import get_cached_collections
from .auth import is_at_least
from typing import Optional


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
    if user.get("role", "contributor") != "contributor":
        return True
    scope = set(user.get("edit_collections", []))
    if not scope:
        return False
    return bool(scope & set(work_metadata.get("collections", [])))
