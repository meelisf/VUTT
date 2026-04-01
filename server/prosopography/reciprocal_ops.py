# server/prosopography/reciprocal_ops.py
"""
Vastastikuste seoste sünkroniseerimine.
Kutsutakse router.py PUT endpointist pärast isiku salvestamist.
Kasutab atomic_write_json otse — EI kasuta update_person() — vältimaks lõputut tsüklit.
"""
import json
import os
from datetime import datetime, timezone

from ..config import PROSOPOGRAPHY_DIR, get_logger
from ..utils import atomic_write_json

logger = get_logger(__name__)


def _id_to_path(person_id: str) -> str:
    """vutt:Pabc123 → state/prosopography/abc123.json"""
    nanoid = person_id.removeprefix("vutt:P")
    return os.path.join(PROSOPOGRAPHY_DIR, f"{nanoid}.json")


def _load_person(person_id: str) -> dict | None:
    path = _id_to_path(person_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        logger.exception("Ei suutnud lugeda prosopograafia faili isiku %s jaoks", person_id)
        return None


def sync_reciprocals(
    person_id: str,
    old_relations: list,
    new_relations: list,
    a_label: str,
    username: str,
) -> list[str]:
    """
    Võrdleb A vana ja uut relations-nimekirja (mõlemad server-side).
    Lisab/eemaldab vastastikuseid seoseid puudutatud B kaartidel.
    Tagastab uuendatud isikute ID-d.

    Käitumisreeglid:
    1. Arvestab ainult target_id-ga seoseid.
    2. Diff võrdleb target_id hulkasid, mitte üksikuid ridu.
    3. B-le lisatakse auto-seos ainult kui B-l puudub igasugune seos A-ga.
    4. B-lt eemaldatakse ainult read kus target_id==A.id ja reciprocal_auto==True.
    5. Olemasolevaid ridu ei muudeta osaliselt.
    6. Ei kasuta update_person() — väldib rekursiivset sync'i.
    """
    old_ids = {r["target_id"] for r in old_relations if r.get("target_id")}
    new_ids = {r["target_id"] for r in new_relations if r.get("target_id")}

    added = new_ids - old_ids    # B-dele, kellele lisati seos
    removed = old_ids - new_ids  # B-dele, kellelt eemaldati viimane seos

    synced: list[str] = []
    # Üks timestamp kogu sync-jooksu jaoks — kõik uuendatud B kaardid saavad sama ajamärgi
    now = datetime.now(timezone.utc).isoformat()

    for b_id in added:
        b = _load_person(b_id)
        if b is None:
            logger.warning("sync_reciprocals: isikut %s ei leitud, jätan vahele", b_id)
            continue
        # Reegel 3: idempotentsus — ära lisa kui B-l on juba seos A-ga
        if any(r.get("target_id") == person_id for r in b.get("relations", [])):
            continue
        b.setdefault("relations", []).append({
            "name": a_label,
            "type": "",
            "target_id": person_id,
            "reciprocal_auto": True,
        })
        b["updated_at"] = now
        b["updated_by"] = username
        atomic_write_json(_id_to_path(b_id), b)
        synced.append(b_id)

    for b_id in removed:
        b = _load_person(b_id)
        if b is None:
            logger.warning("sync_reciprocals: isikut %s ei leitud, jätan vahele", b_id)
            continue
        before = b.get("relations", [])
        after = [
            r for r in before
            if not (r.get("target_id") == person_id and r.get("reciprocal_auto"))
        ]
        if len(after) == len(before):
            continue  # midagi ei muutunud
        b["relations"] = after
        b["updated_at"] = now
        b["updated_by"] = username
        atomic_write_json(_id_to_path(b_id), b)
        synced.append(b_id)

    return synced
