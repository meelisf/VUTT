"""
Metaandmete kirjutamise ühtne loogika.

save_work_metadata() on ainus koht kus _metadata.json uuendatakse —
git commit, person_to_works indeks ja Meilisearch sync ühes kohas.
"""
import json
import os

from .utils import metadata_lock
from .git_ops import save_with_git
from .meilisearch_ops import sync_work_to_meilisearch, sync_work_to_meilisearch_async
from .prosopography.ops import update_person_to_works, ensure_prosopo_stubs

# Lubatud metaandmete väljad (v2 standard)
ALLOWED_METADATA_FIELDS = {
    "title", "year", "year_display", "location", "publisher", "creators", "tags",
    "collections", "type", "genre", "languages", "ester_id", "external_url",
    "series", "relations",
}

# Vanad v1 väljad mis eemaldatakse kui leitakse
_V1_FIELDS = ["pealkiri", "aasta", "koht", "trükkal", "autor", "respondens"]


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
      sync_meili      — True → sünkroonne Meilisearch sync (nt import, metadata update)
                        False → async (nt bulk operatsioonid)
      call_ptw        — True → kutsub update_person_to_works (nt tags/creators muutumisel)
                        False → jätab vahele (nt bulk-collection, bulk-genre)

    Tagastab uuendatud meta dict-i.
    """
    # Loo prosopo stub kaardid Wikidata Q-koodiga creators/tags/publisher jaoks
    if any(k in updates for k in ("creators", "tags", "publisher")):
        updates = ensure_prosopo_stubs(updates, username)

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

    slug = os.path.basename(os.path.dirname(meta_path))

    if call_ptw:
        ptw_args = (
            meta.get("id"),
            meta.get("creators", []),
            meta.get("tags") or [],
            meta.get("publisher"),
        )
        if background_tasks is not None:
            background_tasks.add_task(update_person_to_works, *ptw_args)
        else:
            update_person_to_works(*ptw_args)

    if sync_meili:
        sync_work_to_meilisearch(slug)
    elif background_tasks is not None:
        background_tasks.add_task(sync_work_to_meilisearch_async, slug)

    return meta
