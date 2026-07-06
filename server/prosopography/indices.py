"""Prosopograafia tuletatud indeksid ja kollektsiooniseosed."""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional

from . import state
from ._compat import sync_from_facade


def _load_json_or_default(path: str, default: Any) -> Any:
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return default


def _load_index() -> dict:
    sync_from_facade()
    return _load_json_or_default(state.PROSOPOGRAPHY_INDEX_FILE, {"rebuilt_at": None, "entries": []})


def _load_person_to_works() -> dict:
    sync_from_facade()
    return _load_json_or_default(state.PERSON_TO_WORKS_FILE, {})


def _load_work_collections() -> dict:
    sync_from_facade()
    return _load_json_or_default(state.WORK_COLLECTIONS_INDEX_FILE, {})


def update_work_collections(work_id: str, collections: list) -> None:
    """Uuendab work_collections_index.json üht kirjet teose salvestamisel."""
    if not work_id:
        return
    sync_from_facade()
    with state._work_collections_lock:
        data = _load_work_collections()
        if collections:
            data[work_id] = list(collections)
        else:
            data.pop(work_id, None)
        state.atomic_write_json(state.WORK_COLLECTIONS_INDEX_FILE, data)


def _collection_descendants(collection_id: str, collections: dict) -> set:
    """Tagastab {collection_id} ∪ kõik järglased (rekursiivselt) konfi põhjal."""
    target = {collection_id}
    changed = True
    while changed:
        changed = False
        for cid, col in (collections or {}).items():
            if isinstance(col, dict) and col.get("parent") in target and cid not in target:
                target.add(cid)
                changed = True
    return target


ACADEMIA_INSTITUTION_NAMES = frozenset({"Academia Gustaviana", "Academia Gustavo-Carolina"})

# Teosevälise kuuluvuse kaardistus peab olema eksplitsiitne, mitte tuletatud
# kollektsiooni kuvanimest: admin võib kuvanime muuta, aga domeeniseos jääb samaks.
COLLECTION_EDUCATION_INSTITUTIONS = {
    "academia-gustaviana": frozenset({"Academia Gustaviana"}),
    "academia-gustavo-carolina": frozenset({"Academia Gustavo-Carolina"}),
}


def _normalize_membership_label(value: str) -> str:
    """Normaliseerib asutuse nime kuuluvuse võrdluseks."""
    value = re.sub(r"\s*\([^)]*\)", " ", value or "")
    value = re.sub(r"\s+", " ", value).strip().lower()
    return value


def _collection_membership_institutions(collection_id: str, collections: dict) -> set:
    """Eksplitsiitselt kaardistatud haridusasutused kollektsioonile ja alamkollektsioonidele."""
    labels = set()
    for cid in _collection_descendants(collection_id, collections):
        for institution in COLLECTION_EDUCATION_INSTITUTIONS.get(cid, ()):
            normalized = _normalize_membership_label(institution)
            if normalized:
                labels.add(normalized)
    return labels


def _entry_matches_collection_membership(entry: dict, institutions: set) -> bool:
    """Kas indeksikirje kuulub kollektsiooni teosevälise asutusekuuluvuse kaudu."""
    if not institutions:
        return False
    for inst in entry.get("education_institutions") or []:
        if isinstance(inst, str) and _normalize_membership_label(inst) in institutions:
            return True
    return False


def _persons_in_collection(collection_id: str) -> set:
    """Isikute id-d, kes kuuluvad kollektsiooni või alamkollektsioonidesse."""
    from ..cache import get_cached_collections

    sync_from_facade()
    collections = get_cached_collections() or {}
    target = _collection_descendants(collection_id, collections)
    wc = _load_work_collections()
    ptw = _load_person_to_works()
    result = {
        pid for pid, entries in ptw.items()
        if any(target & set(wc.get(e.get("work_id"), ())) for e in entries)
    }

    membership_institutions = _collection_membership_institutions(collection_id, collections)
    for entry in _load_index().get("entries", []):
        pid = entry.get("id")
        if pid and entry.get("record_status") != "tombstone" and _entry_matches_collection_membership(entry, membership_institutions):
            result.add(pid)
    return result


def _person_collections(person_id: str) -> list:
    """Kollektsioonid, kuhu isiku teosed kuuluvad; dedup esmaesinemise järjekorras."""
    sync_from_facade()
    wc = _load_work_collections()
    ptw = _load_person_to_works()
    result: list = []
    for entry in ptw.get(person_id, ()):
        for cid in wc.get(entry.get("work_id"), ()):
            if cid not in result:
                result.append(cid)
    return result


def _update_index_entry(person: dict):
    """Uuendab ühe kirje prosopography_index.json-s."""
    sync_from_facade()
    from .person_search import _index_entry_from_person

    person_id = person["id"]
    works = _load_person_to_works()
    work_count = len(set(w["work_id"] for w in works.get(person_id, [])))
    new_entry = _index_entry_from_person(person, work_count)

    with state._index_lock:
        index = _load_index()
        entries = [e for e in index["entries"] if e["id"] != person_id]
        if person.get("record_status") != "tombstone":
            entries.append(new_entry)
        index["entries"] = entries
        state.atomic_write_json(state.PROSOPOGRAPHY_INDEX_FILE, index)


def _update_aliases_entry(person: dict):
    """Uuendab person_aliases.json — vutt:P ID → nimevariandid."""
    sync_from_facade()
    person_id = person["id"]
    name_obj = person.get("name") or {}
    label = name_obj.get("label") or ""
    aliases = name_obj.get("aliases") or []
    all_names = list({label} | set(aliases))

    from .person_search import _load_person_aliases

    with state._aliases_lock:
        data = _load_person_aliases()
        if person.get("record_status") == "tombstone":
            data.pop(person_id, None)
        else:
            data[person_id] = {
                "primary_name": label,
                "aliases": all_names,
                "ids": {},
            }
        state.atomic_write_json(state.PERSON_ALIASES_FILE, data)


def update_person_to_works(
    work_id: str,
    creators: list,
    tags: list,
    publisher=None,
    title: str = "",
    year: Optional[int] = None,
):
    """Uuendab person_to_works.json pöördindeksit ühe teose salvestamisel."""
    sync_from_facade()
    new_entries: dict[str, set[str]] = {}

    for creator in (creators or []):
        pid = creator.get("id") or ""
        if pid.startswith("vutt:P"):
            role = creator.get("role") or "creator"
            new_entries.setdefault(pid, set()).add(role)

    for tag in (tags or []):
        if isinstance(tag, dict) and tag.get("entity_type") == "person":
            pid = tag.get("id") or ""
            if pid.startswith("vutt:P"):
                new_entries.setdefault(pid, set()).add("subject")

    if publisher and isinstance(publisher, dict):
        pid = publisher.get("id") or ""
        if pid.startswith("vutt:P"):
            new_entries.setdefault(pid, set()).add("publisher")

    with state._works_lock:
        data = _load_person_to_works()

        # Eemalda kõik olemasolevad viited sellele teosele.
        for pid_entries in data.values():
            pid_entries[:] = [e for e in pid_entries if e.get("work_id") != work_id]

        # Lisa uued.
        for pid, roles in new_entries.items():
            if pid not in data:
                data[pid] = []
            for role in roles:
                data[pid].append({"work_id": work_id, "role": role})

        state.atomic_write_json(state.PERSON_TO_WORKS_FILE, data)

    try:
        state.update_works_creators_index(work_id, creators, title=title, year=year)
    except Exception:
        state.logger.exception("update_works_creators_index viga teose %s jaoks", work_id)


def rebuild_indices():
    """Taastab prosopograafia read-modelid nullist."""
    sync_from_facade()
    if not os.path.exists(state.PROSOPOGRAPHY_DIR):
        return

    all_persons = []
    for fname in os.listdir(state.PROSOPOGRAPHY_DIR):
        if not fname.endswith(".json"):
            continue
        path = os.path.join(state.PROSOPOGRAPHY_DIR, fname)
        try:
            with open(path, "r", encoding="utf-8") as f:
                person = json.load(f)
            all_persons.append(person)
        except Exception:
            continue

    ptw: dict[str, list] = {}
    wc: dict[str, list] = {}
    if os.path.exists(state.BASE_DIR):
        for entry in os.scandir(state.BASE_DIR):
            if not entry.is_dir():
                continue
            meta_path = os.path.join(entry.path, "_metadata.json")
            if not os.path.exists(meta_path):
                continue
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
            except Exception:
                continue
            work_id = meta.get("id") or meta.get("work_id")
            if not work_id:
                continue
            cols = meta.get("collections") or []
            if cols:
                wc[work_id] = list(cols)
            for creator in meta.get("creators") or []:
                pid = creator.get("id") or ""
                if pid.startswith("vutt:P"):
                    role = creator.get("role") or "creator"
                    ptw.setdefault(pid, []).append({"work_id": work_id, "role": role})
            tags_list = meta.get("tags") or []
            for tag in tags_list:
                if isinstance(tag, dict) and tag.get("entity_type") == "person":
                    pid = tag.get("id") or ""
                    if pid.startswith("vutt:P"):
                        ptw.setdefault(pid, []).append({"work_id": work_id, "role": "subject"})
            pub = meta.get("publisher")
            if pub and isinstance(pub, dict):
                pid = pub.get("id") or ""
                if pid.startswith("vutt:P"):
                    ptw.setdefault(pid, []).append({"work_id": work_id, "role": "publisher"})

            mentioned_ids: set[str] = set()
            try:
                for page_fname in os.listdir(entry.path):
                    if not page_fname.endswith('.json') or page_fname == '_metadata.json':
                        continue
                    page_fpath = os.path.join(entry.path, page_fname)
                    try:
                        with open(page_fpath, 'r', encoding='utf-8') as pf:
                            page_data = json.load(pf)
                        source = page_data.get('meta_content', page_data)
                        for tag in source.get('page_tags', []):
                            if isinstance(tag, dict):
                                pid = tag.get('id') or ''
                                if pid.startswith('vutt:P'):
                                    mentioned_ids.add(pid)
                    except Exception:
                        pass
            except Exception:
                pass
            for pid in mentioned_ids:
                ptw.setdefault(pid, []).append({'work_id': work_id, 'role': 'mentioned'})

    with state._works_lock:
        state.atomic_write_json(state.PERSON_TO_WORKS_FILE, ptw)

    with state._work_collections_lock:
        state.atomic_write_json(state.WORK_COLLECTIONS_INDEX_FILE, wc)

    try:
        state.build_works_creators_index()
    except Exception:
        state.logger.exception("build_works_creators_index viga rebuild_indices sees")

    entries = []
    aliases_data = {}
    for person in all_persons:
        if person.get("record_status") == "tombstone":
            continue
        pid = person["id"]
        works_list = ptw.get(pid, [])
        work_count = len({w["work_id"] for w in works_list})
        from .person_search import _index_entry_from_person
        entries.append(_index_entry_from_person(person, work_count))

        name_obj = person.get("name") or {}
        label = name_obj.get("label") or ""
        person_aliases = name_obj.get("aliases") or []
        all_names = list({label} | set(person_aliases))
        aliases_data[pid] = {
            "primary_name": label,
            "aliases": all_names,
            "ids": {},
        }

    entries.sort(key=lambda e: (e.get("sort_name") or "").lower())

    with state._index_lock:
        state.atomic_write_json(state.PROSOPOGRAPHY_INDEX_FILE, {
            "rebuilt_at": datetime.now(timezone.utc).isoformat(),
            "entries": entries,
        })

    with state._aliases_lock:
        state.atomic_write_json(state.PERSON_ALIASES_FILE, aliases_data)


def _remove_aliases_entry(person_id: str):
    """Eemaldab person_aliases.json-st kõik viited person_id-le."""
    sync_from_facade()
    aliases_file = state.PERSON_ALIASES_FILE
    if not os.path.exists(aliases_file):
        return
    try:
        with open(aliases_file, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return
    if person_id in data:
        del data[person_id]
        state.atomic_write_json(aliases_file, data)


__all__ = ['_load_index', '_load_person_to_works', '_load_work_collections', 'update_work_collections', '_collection_descendants', '_persons_in_collection', '_person_collections', '_update_index_entry', '_update_aliases_entry', 'update_person_to_works', 'rebuild_indices', '_remove_aliases_entry']
