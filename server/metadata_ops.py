"""
Metaandmete kirjutamise ühtne loogika.

save_work_metadata() on ainus koht kus _metadata.json uuendatakse —
git commit, person_to_works indeks ja Meilisearch sync ühes kohas.
"""
import json
import os
import time
from typing import Callable

from .config import get_logger
from .utils import metadata_lock
from .git_ops import save_with_git
from .meilisearch_ops import sync_work_to_meilisearch, sync_work_to_meilisearch_async
from .prosopography.indices import update_person_to_works, update_work_collections
from .prosopography.person_crud import ensure_prosopo_stubs

logger = get_logger(__name__)

# Lubatud metaandmete väljad (v2 standard)
ALLOWED_METADATA_FIELDS = {
    "title", "year", "year_display", "location", "publisher", "creators", "tags", "notes",
    "collections", "type", "genre", "languages", "ester_id", "external_url",
    "series", "relations", "archive_refs", "shareable",
}


def clean_archive_refs(value):
    """
    Sanitiseerib archive_refs välja.
    Tagastab puhastatud massiivi või None kui tühi/vigane.
    """
    if not isinstance(value, list):
        return None
    result = []
    for item in value:
        if not isinstance(item, dict):
            continue
        archive_id = str(item.get('archive_id', '') or '').strip()
        reference = str(item.get('reference', '') or '').strip()
        if not archive_id and not reference:
            continue
        clean = {'archive_id': archive_id, 'reference': reference}
        url = str(item.get('url', '') or '').strip()
        if url:
            clean['url'] = url
        result.append(clean)
    return result if result else None

# Vanad v1 väljad mis eemaldatakse kui leitakse
_V1_FIELDS = ["pealkiri", "aasta", "koht", "trükkal", "autor", "respondens"]


def bulk_update_field(
    meta_path: str,
    transform: Callable[[dict], dict],
    username: str,
    git_message: str,
    *,
    background_tasks=None,
    sync_meili: bool = False,
    call_ptw: bool = False,
) -> None:
    """
    Atomaarne bulk-uuendus: loeb, transformeerib ja kirjutab ühe metadata_lock tsükliga.
    Väldib TOCTOU akent, mis tekib eraldi loe+kirjuta kutsete vahel.

    transform(current_meta) → dict of field updates to apply.
    """
    if not os.path.exists(meta_path):
        return

    with metadata_lock:
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)

        updates = transform(meta)
        clean = {k: v for k, v in updates.items() if k in ALLOWED_METADATA_FIELDS}
        meta.update(clean)
        for field in _V1_FIELDS:
            meta.pop(field, None)

        save_with_git(
            meta_path,
            json.dumps(meta, indent=2, ensure_ascii=False),
            username,
            message=git_message,
        )

    slug = os.path.basename(os.path.dirname(meta_path))

    # Kollektsioonid uuenevad ka bulk-collection teel (call_ptw=False) — tingimusteta
    update_work_collections(meta.get("id"), meta.get("collections") or [])

    if call_ptw:
        ptw_args = (
            meta.get("id"),
            meta.get("creators", []),
            meta.get("tags") or [],
            meta.get("publisher"),
            meta.get("title") or "",
            meta.get("year"),
        )
        if background_tasks is not None:
            background_tasks.add_task(update_person_to_works, *ptw_args)
        else:
            update_person_to_works(*ptw_args)

    if sync_meili:
        if background_tasks is not None:
            background_tasks.add_task(sync_work_to_meilisearch_async, slug)
        else:
            sync_work_to_meilisearch(slug)


def save_work_metadata(
    meta_path: str,
    updates: dict,
    username: str,
    git_message: str,
    *,
    background_tasks=None,
    sync_meili: bool = True,
    call_ptw: bool = True,
) -> dict:
    """
    Kirjutab _metadata.json ja käivitab järeloperatsioonid.

    Parameetrid:
      meta_path       — absoluutne tee _metadata.json failini
      updates         — muudetavad väljad (ALLOWED_METADATA_FIELDS filter rakendatakse)
      username        — git commit autor
      git_message     — git commit sõnum
      background_tasks — FastAPI BackgroundTasks; kui antud, ptw + async meili lähevad tausta
      sync_meili      — True → sünkroonne Meilisearch sync (nt import)
                        False → async, kui background_tasks on antud
      call_ptw        — True → kutsub update_person_to_works (nt tags/creators muutumisel)
                        False → jätab vahele (nt bulk-collection, bulk-genre)

    Tagastab uuendatud meta dict-i.
    """
    started = time.monotonic()
    slug = os.path.basename(os.path.dirname(meta_path))

    # Sanitiseeri archive_refs enne salvestamist (None = tühi, eemaldatakse meta-st)
    if 'archive_refs' in updates:
        updates['archive_refs'] = clean_archive_refs(updates['archive_refs'])

    # Loo prosopo stub kaardid Wikidata Q-koodiga creators/tags/publisher jaoks
    if any(k in updates for k in ("creators", "tags", "publisher")):
        updates = ensure_prosopo_stubs(updates, username)
    stubs_done = time.monotonic()

    with metadata_lock:
        if os.path.exists(meta_path):
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        else:
            meta = {}

        clean = {k: v for k, v in updates.items() if k in ALLOWED_METADATA_FIELDS}
        meta.update(clean)

        for field in _V1_FIELDS:
            meta.pop(field, None)

        save_with_git(
            meta_path,
            json.dumps(meta, indent=2, ensure_ascii=False),
            username,
            message=git_message,
        )
    git_done = time.monotonic()

    # Kollektsioonid uuenevad ka bulk-collection teel (call_ptw=False) — tingimusteta
    update_work_collections(meta.get("id"), meta.get("collections") or [])
    collections_done = time.monotonic()

    if call_ptw:
        ptw_args = (
            meta.get("id"),
            meta.get("creators", []),
            meta.get("tags") or [],
            meta.get("publisher"),
            meta.get("title") or "",
            meta.get("year"),
        )
        if background_tasks is not None:
            background_tasks.add_task(update_person_to_works, *ptw_args)
        else:
            update_person_to_works(*ptw_args)

    if sync_meili:
        sync_work_to_meilisearch(slug)
    elif background_tasks is not None:
        background_tasks.add_task(sync_work_to_meilisearch_async, slug)

    finished = time.monotonic()
    logger.info(
        "METADATA SAVE timing (%s): total=%.0fms stubs=%.0fms git=%.0fms collections=%.0fms scheduling=%.0fms sync_meili=%s",
        slug,
        (finished - started) * 1000,
        (stubs_done - started) * 1000,
        (git_done - stubs_done) * 1000,
        (collections_done - git_done) * 1000,
        (finished - collections_done) * 1000,
        sync_meili,
    )
    return meta
