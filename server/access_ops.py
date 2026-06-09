from .cache import get_cached_collections
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
    if user.get("role") == "admin":
        return True
    allowed = set(user.get("allowed_collections", []))
    work_collections = set(work_metadata.get("collections", []))
    return bool(allowed & work_collections)


def can_write_work(work_metadata: dict, user: Optional[dict]) -> bool:
    """Kontrollib kas kasutajal on õigus teost MUUTA (salvestada, shareable lippu seada).

    Kirjutamisõigus järgib lugemisõigust: editor/admin saab kirjutada teosesse, mida ta
    saab lugeda. Avalikud/shareable teosed on editorile alati kirjutatavad (töölaua
    normaalne kasutus); piiratud kollektsioonide teostele on vaja allowed_collections
    kattuvust või admin-rolli. Anonüümne kasutaja ei saa kirjutada.

    NB: kutsuja peab juba olema autenditud editor+ (require_role("editor")).
    """
    if user is None:
        return False
    return can_read_work(work_metadata, user)
