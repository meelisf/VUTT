"""Teoste seosed (#701, ADR 0075).

Seos muutub AINULT siin (`PUT /works/{id}/relations`) ja kirjutatakse alati
mõlemasse teosesse ühe range `bulk_update_works` partiiga: üks commit või mitte
midagi. `/update-work-metadata` lükkab `relations` välja tagasi.

NB: `server/prosopography/work_relations_ops.py` on isikute ja teoste faktide
moodul — nimi on juhuslikult sarnane.
"""
import os
from typing import Optional

from .access_ops import can_read_work
from .metadata_ops import BulkUpdateError, bulk_update_works
from .utils import find_directory_by_id
from .work_sets_access import load_work_metadata_by_id

# Pöördliik: A → B liigiga X tähendab B → A liigiga INVERSE[X].
INVERSE = {"isVersionOf": "isVersionOf"}

_VERB_LABEL = {"isVersionOf": "variant"}


class RelationError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _meta_path(work_id: str) -> Optional[str]:
    directory = find_directory_by_id(work_id)
    return os.path.join(directory, "_metadata.json") if directory else None


def _clean(item) -> tuple[str, str]:
    """Kliendi kirje → (id, rel_type). `label` ja muud väljad visatakse ära."""
    if not isinstance(item, dict):
        raise RelationError("Vigane seos")
    target, rel_type = item.get("id"), item.get("rel_type")
    if not isinstance(target, str) or not target:
        raise RelationError("Seose sihtteos puudub")
    if rel_type not in INVERSE:
        raise RelationError(f"Tundmatu seose liik: {rel_type}")
    return target, rel_type


def _apply(meta: dict, add: list[tuple[str, str]], remove: list[tuple[str, str]]) -> dict:
    """Transform: lisab ja eemaldab idempotentselt; salvestab ainult {id, rel_type}."""
    rels = [r for r in (meta.get("relations") or []) if isinstance(r, dict)]
    pairs = {(r.get("id"), r.get("rel_type")) for r in rels}
    drop = set(remove)
    out = [r for r in rels if (r.get("id"), r.get("rel_type")) not in drop]
    for target, rel_type in add:
        if (target, rel_type) not in pairs and (target, rel_type) not in drop:
            out.append({"id": target, "rel_type": rel_type})
            pairs.add((target, rel_type))
    return {"relations": out}


def apply_relation_changes(source_id: str, add: list, remove: list, username: str,
                           background_tasks=None) -> bool:
    """Lisab/eemaldab seosed lähteteose ja sihtteoste vahel, mõlemale poole.

    Tagastab, kas midagi muutus. Viga: `RelationError` (400 sisend, 404 lähe,
    500 salvestus — failid on siis algseisus).
    """
    source_path = _meta_path(source_id)
    if not source_path:
        raise RelationError("Teost ei leitud", 404)
    adds = [_clean(i) for i in add or []]
    removes = [_clean(i) for i in remove or []]
    targets: dict[str, str] = {}
    for target, _ in adds + removes:
        if target == source_id:
            raise RelationError("Teos ei saa olla seotud iseendaga")
        path = _meta_path(target)
        if not path:
            raise RelationError(f"Sihtteost ei leitud: {target}")
        targets[target] = path
    if not adds and not removes:
        return False

    items = [(source_path, lambda m: _apply(m, adds, removes))]
    for target, path in targets.items():
        t_add = [(source_id, INVERSE[rt]) for t, rt in adds if t == target]
        t_rem = [(source_id, INVERSE[rt]) for t, rt in removes if t == target]
        items.append((path, lambda m, a=t_add, r=t_rem: _apply(m, a, r)))

    parts = []
    if adds:
        parts.append("lisa " + ", ".join(f"{_VERB_LABEL[rt]} {source_id} ↔ {t}" for t, rt in adds))
    if removes:
        parts.append("eemalda " + ", ".join(f"{_VERB_LABEL[rt]} {source_id} ↔ {t}" for t, rt in removes))
    message = "Seos: " + "; ".join(parts)
    try:
        res = bulk_update_works(items, username, message, background_tasks=background_tasks,
                                all_or_nothing=True)
    except BulkUpdateError:
        raise RelationError("Seost ei salvestatud", 500)
    return res.get("updated", 0) > 0


def _first_archive_ref(meta: dict) -> Optional[str]:
    for ref in meta.get("archive_refs") or []:
        if isinstance(ref, dict):
            text = " ".join(p for p in (ref.get("archive_id"), ref.get("reference")) if p)
            if text:
                return text
    return None


def resolve_relations(meta: dict, user: Optional[dict]) -> list[dict]:
    """Lähteteose `isVersionOf` seosed kuvamiseks; sihtteose metaandmed kettalt värskelt.

    Piiratud sihtteose pealkiri ja aasta on nähtavad (`readable: False`) —
    kaitstakse pilte ja teksti, mitte seose olemasolu (ADR 0075).
    """
    out = []
    for rel in meta.get("relations") or []:
        if not isinstance(rel, dict) or rel.get("rel_type") not in INVERSE:
            continue
        target = load_work_metadata_by_id(rel.get("id") or "")
        if target is None:
            out.append({"id": rel.get("id"), "rel_type": rel["rel_type"], "missing": True})
            continue
        out.append({
            "id": rel["id"],
            "rel_type": rel["rel_type"],
            "title": target.get("title"),
            "title_en": target.get("title_en"),
            "title_original": target.get("title_original"),
            "title_devised": target.get("title_devised"),
            "year": target.get("year"),
            "year_display": target.get("year_display"),
            "dating": target.get("dating"),
            "archive_ref": _first_archive_ref(target),
            "readable": can_read_work(target, user),
        })
    return out


def cleanup_for_deletion(work_id: str, meta_path: str, username: str,
                         background_tasks=None) -> list[str]:
    """Eemaldab kustutatava teose seosed temalt ja kõigilt vastaspooltelt.

    Kutsuja hoiab `metadata_lock`-i kuni kausta eemaldamiseni (ADR 0075).
    Rippuvad sihtmärgid jäetakse välja; kustutatav teos ei saa Meili sünki.
    Viga → `BulkUpdateError` (midagi ei muutunud) — kutsuja katkestab kustutuse.
    """
    meta = load_work_metadata_by_id(work_id) or {}
    rels = [r for r in (meta.get("relations") or []) if isinstance(r, dict)]
    if not rels:
        return []
    others = []
    items = [(meta_path, lambda m: {"relations": []})]
    for rel in rels:
        target = rel.get("id")
        path = _meta_path(target) if target and target != work_id else None
        if not path or target in others:
            continue
        others.append(target)
        items.append((path, lambda m, w=work_id: {
            "relations": [r for r in (m.get("relations") or [])
                          if not (isinstance(r, dict) and r.get("id") == w)]}))
    message = f"Kustutamine: eemalda seosed {work_id} ↔ {', '.join(others)}"
    bulk_update_works(items, username, message, background_tasks=background_tasks,
                      all_or_nothing=True, skip_sync_paths=[meta_path])
    return others
