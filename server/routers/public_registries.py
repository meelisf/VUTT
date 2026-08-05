import json
import os

from fastapi import APIRouter, BackgroundTasks, Depends

from ..cache import get_cached_people_aliases, get_cached_people_register, get_cached_vocabularies
from ..config import BASE_DIR
from ..deps import require_role
from ..entity_labels_ops import (
    load_entity_labels, refresh_all_entity_labels, enrich_entity_labels_async_qcodes,
    sync_prosopography_inline_labels,
)

router = APIRouter()


@router.get("/vocabularies")
async def vocabularies():
    return {"status": "success", "vocabularies": get_cached_vocabularies()}


@router.get("/people-aliases")
async def people_aliases():
    return {"status": "success", "aliases": get_cached_people_aliases()}


@router.get("/people-register")
async def people_register():
    return {"status": "success", "people": get_cached_people_register()}


# sync def → threadpool: labels.json faililugemine ei blokeeri event-loopi
@router.get("/entity-labels")
def entity_labels():
    return load_entity_labels()


# sync def → threadpool: Wikidata võrgupäringud + failikirjutused ei blokeeri event-loopi
@router.post("/admin/refresh-entity-labels")
def admin_refresh_entity_labels(user=Depends(require_role("admin"))):
    """Värskendab labels.json Q-koodid Wikidatast JA kannab need kaartidele (admin).

    Ainult registri värskendamisest ei piisa: prosopograafia kuvab kirje
    inline `labels`-välja, mitte registrit.
    """
    count = refresh_all_entity_labels()
    synced = sync_prosopography_inline_labels(username=user.get("username", "Automaatne"))
    return {
        "updated": count,
        "persons_updated": synced["files"],
        "slots_updated": synced["slots"],
        "fetched_new": synced["fetched"],
    }


# sync def → threadpool: skannib kõiki lehekülje-JSON-e (raske faililugemine)
@router.post("/admin/enrich-page-tag-labels")
def admin_enrich_page_tag_labels(background_tasks: BackgroundTasks, user=Depends(require_role("admin"))):
    """Rikastab kõik lehekülje-tagide Q-koodid labels.json-i (retroaktiivselt).

    Skannib kõik lehekülje JSON-failid, kogub Q-koodid page_tags väljalt
    ja lisab puuduvad labels.json-i taustal.
    """
    def collect_page_tag_qcodes():
        qcodes = set()
        for entry in os.scandir(BASE_DIR):
            if not entry.is_dir():
                continue
            try:
                for f in os.scandir(entry.path):
                    if not f.name.endswith(".json") or f.name == "_metadata.json" or f.name.startswith("_"):
                        continue
                    with open(f.path, "r", encoding="utf-8") as fh:
                        page = json.load(fh)
                    for t in page.get("page_tags", []):
                        if isinstance(t, dict) and isinstance(t.get("id"), str) and t["id"].startswith("Q"):
                            qcodes.add(t["id"])
            except Exception:
                pass
        return qcodes

    qcodes = collect_page_tag_qcodes()
    if qcodes:
        background_tasks.add_task(enrich_entity_labels_async_qcodes, qcodes)
    return {"queued": len(qcodes)}
