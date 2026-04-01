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
    raise NotImplementedError
