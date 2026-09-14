"""Töökollektsiooni õiguste predikaadid (#354).

Töökollektsioon EI OLE uus teoste ligipääsu allikas: ta ainult piiritleb hulka
teostest, mida kasutaja niikuinii näeb. Seepärast ei tohi ükski siinne funktsioon
ligipääsu LAIENDADA.
"""
import json
import os
from typing import Optional

from .access_ops import is_work_public
from .auth import is_at_least
from .utils import find_directory_by_id


def load_work_metadata_by_id(work_id: str) -> Optional[dict]:
    """Eraldi funktsioon, et testid saaksid ta asendada ilma failisüsteemita."""
    directory = find_directory_by_id(work_id)
    if not directory:
        return None
    path = os.path.join(directory, "_metadata.json")
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def can_view_set(ws: dict, user: Optional[dict]) -> bool:
    if ws.get("visibility") == "public":
        return True
    if user is None:
        return False
    if is_at_least(user.get("role") or "contributor", "admin"):
        return True
    return user.get("username") in (ws.get("access") or {})


def can_manage_set(ws: dict, user: Optional[dict]) -> bool:
    if user is None:
        return False
    if is_at_least(user.get("role") or "contributor", "admin"):
        return True
    return (ws.get("access") or {}).get(user.get("username")) == "manager"


def is_search_visible(work_metadata: dict, user: Optional[dict]) -> bool:
    """Kordab tenant-tokeni filtrit: `is_public = true OR collections_hierarchy IN [allowed]`.

    `shareable` siin TEADLIKULT ei osale: jagatav teos on lingiga avatav, mitte
    otsitav. Kui ta loendisse lubada, näitaks kogu arv teost, mida sirvimine ei näita.
    """
    if is_work_public(work_metadata):
        return True
    if user is None:
        return False
    if is_at_least(user.get("role") or "contributor", "admin"):
        return True
    allowed = set(user.get("allowed_collections") or [])
    return bool(allowed & set(work_metadata.get("collections") or []))


def search_visible_work_ids(ws: dict, user: Optional[dict]) -> list:
    """Kogu liikmed, mis on sellele kutsujale OTSINGUS nähtavad, algses järjekorras."""
    out = []
    for work_id in ws.get("works") or []:
        meta = load_work_metadata_by_id(work_id)
        if meta is None:
            continue  # kustutatud teos: jäetakse vahele, koristatakse eemaldamisel
        if is_search_visible(meta, user):
            out.append(work_id)
    return out
