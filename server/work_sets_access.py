"""Töökollektsiooni õiguste predikaadid (#354).

Töökollektsioon EI OLE uus teoste ligipääsu allikas: ta ainult piiritleb hulka
teostest, mida kasutaja niikuinii näeb. Seepärast ei tohi ükski siinne funktsioon
ligipääsu LAIENDADA.
"""
import json
import os
from typing import Optional

from .access_ops import is_work_public
from .auth import can_manage_user, is_at_least
from .config import WORK_SET_MAX_ACCESS
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


ACCESS_ROLES = ("viewer", "manager")


def classify_access_diff(old: dict, new: dict) -> dict:
    """Vana ja uue kaardi võtmete ÜHENDI pealt nelja kategooriasse.

    Täisasenduse leping (ADR 0043 p7): puuduv uus võti TÄHENDAB eemaldamist.
    Klient peab seetõttu saatma ka lukustatud ja puutumata pärandkirjed kaasa —
    nende kogemata väljajätmine annab vea, mitte vaikse õiguse eemaldamise.
    """
    old = old or {}
    new = new or {}
    added, changed, unchanged, removed = [], [], [], []
    for kasutaja in sorted(set(old) | set(new)):
        if kasutaja not in old:
            added.append(kasutaja)
        elif kasutaja not in new:
            removed.append(kasutaja)
        elif old[kasutaja] != new[kasutaja]:
            changed.append(kasutaja)
        else:
            unchanged.append(kasutaja)
    return {"added": added, "changed": changed, "unchanged": unchanged, "removed": removed}


def check_access_diff(diff: dict, old: dict, new: dict,
                      users_snapshot: dict, actor: dict) -> Optional[str]:
    """Tagastab veateate või None. Üks keelatud muudatus → midagi ei salvestata.

    `users_snapshot` on {kasutajanimi: roll}, võetud `users_lock` all ja ANTUD
    SIIA KAASA — siin ei kutsuta `load_users`-it, sest see funktsioon jookseb
    `_work_sets_lock` all ja kahte lukku ei hoita korraga (ADR 0043 p3).
    """
    actor_role = actor.get("role") or "contributor"

    # Mahupiir: uus kaart ei tohi piiri ületada; pärandkaart tohib VÄHENEDA.
    if len(new) > WORK_SET_MAX_ACCESS and len(new) >= len(old):
        return f"Õiguste kirjete lagi on {WORK_SET_MAX_ACCESS}"

    for kasutaja in diff["added"] + diff["changed"]:
        if new[kasutaja] not in ACCESS_ROLES:
            return "Roll peab olema viewer või manager"
        sihtroll = users_snapshot.get(kasutaja)
        if sihtroll is None:
            # Ka olemasoleva SURNUD kirje rolli muutmine käib siit läbi.
            return f"Kasutajat '{kasutaja}' ei leitud"
        if is_at_least(sihtroll, "admin"):
            # Uut admin+ määrangut ei looda: nende haldusõigus tuleneb rollist.
            return f"'{kasutaja}' haldusõigus tuleneb rollist, määrangut ei lisata"
        if not can_manage_user(actor_role, sihtroll):
            return f"Pole õigust kasutaja '{kasutaja}' määrangut muuta"

    for kasutaja in diff["removed"]:
        if kasutaja == actor.get("username"):
            continue  # oma dekoratiivse kirje koristus
        sihtroll = users_snapshot.get(kasutaja)
        if sihtroll is None:
            continue  # kustutatud kasutaja jäänuk: eemaldamine on koristus
        if not can_manage_user(actor_role, sihtroll):
            return f"Pole õigust kasutaja '{kasutaja}' määrangut eemaldada"

    return None
