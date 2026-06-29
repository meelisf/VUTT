"""Isikute ja teoste vahelised seosed ning relation-helperid."""
from __future__ import annotations

import json
import os
import time
from typing import Optional

from . import _legacy_ops as legacy
from . import state
from ._compat import sync_from_facade

_work_to_persons_cache = {"map": None, "expires": 0.0}
_WORK_TO_PERSONS_TTL = 300  # sekundit


def get_person_with_works(person_id: str) -> Optional[dict]:
    """Laeb isiku + tema teosed pöördindeksist (O(1))."""
    sync_from_facade()
    person = legacy.get_person(person_id)
    if person is None:
        return None
    works = legacy._load_person_to_works()
    person["works"] = works.get(person_id, [])
    return person


def _build_work_to_persons() -> dict:
    """Pöörab person_to_works → {work_id: [{id, label}]}, label isikuindeksist."""
    sync_from_facade()
    ptw = legacy._load_person_to_works()
    index = legacy._load_index()
    labels = {e.get("id"): (e.get("label") or e.get("name") or e.get("id"))
              for e in index.get("entries", [])}
    result: dict = {}
    for person_id, entries in ptw.items():
        label = labels.get(person_id, person_id)
        seen_works = set()
        for entry in entries or []:
            wid = entry.get("work_id")
            if not wid or wid in seen_works:
                continue
            seen_works.add(wid)
            result.setdefault(wid, []).append({"id": person_id, "label": label})
    return result


def get_persons_for_work(work_id: str) -> list:
    """Tagastab teose loojate isikukaardid [{id, label}] (cache'itud pöördindeks)."""
    now = time.time()
    cache = _work_to_persons_cache
    if cache["map"] is None or now > cache["expires"]:
        cache["map"] = _build_work_to_persons()
        cache["expires"] = now + _WORK_TO_PERSONS_TTL
    return cache["map"].get(work_id, [])


def _structured_relation_ids(person: Optional[dict]) -> list[str]:
    if not person:
        return []
    result: list[str] = []
    for relation in person.get("relations") or []:
        target_id = relation.get("target_id") if isinstance(relation, dict) else None
        if isinstance(target_id, str) and target_id.startswith("vutt:P"):
            result.append(target_id)
    return result


def get_person_relation_network_ids(person_id: str, work_limit: int = 500) -> list[str]:
    """Tagastab isiku kaardivõrgustiku ID-d."""
    sync_from_facade()
    ids: list[str] = []

    def add(pid: Optional[str]) -> None:
        if isinstance(pid, str) and pid.startswith("vutt:P") and pid not in ids:
            ids.append(pid)

    add(person_id)
    person = legacy.get_person(person_id)
    for target_id in _structured_relation_ids(person):
        add(target_id)

    pattern = os.path.join(state.PROSOPOGRAPHY_DIR, "*.json")
    for path in state._glob.glob(pattern):
        try:
            with open(path, "r", encoding="utf-8") as f:
                other = json.load(f)
        except Exception:
            continue
        other_id = other.get("id")
        if other_id == person_id or other.get("record_status") == "tombstone":
            continue
        if person_id in _structured_relation_ids(other):
            add(other_id)

    for relation in state.get_work_relations(person_id, limit=work_limit, offset=0):
        add(relation.get("person_id"))

    return ids


def get_relation_type_suggestions() -> list:
    """Kogub kõigist isikukaartidest unikaalsed seose tüübid."""
    sync_from_facade()
    seen: dict[str, dict] = {}
    pattern = os.path.join(state.PROSOPOGRAPHY_DIR, "*.json")
    for path in state._glob.glob(pattern):
        try:
            with open(path, "r", encoding="utf-8") as f:
                person = json.load(f)
        except Exception:
            continue
        for rel in person.get("relations", []):
            type_label = (rel.get("type") or "").strip()
            type_id = rel.get("type_id") or None
            type_labels = rel.get("type_labels") or None
            if not type_label:
                continue
            key = type_id or f"manual:{type_label.lower()}"
            if key not in seen:
                seen[key] = {"label": type_label, "id": type_id, "labels": type_labels}
    return sorted(seen.values(), key=lambda x: (x["label"] or "").lower())


def update_page_person_mentions(work_id: str, work_dir: str):
    """Uuendab person_to_works 'mentioned' rolle antud teose lehekülje page_tags põhjal."""
    if not work_id:
        return
    sync_from_facade()

    person_ids: set[str] = set()
    try:
        for fname in os.listdir(work_dir):
            if not fname.endswith('.json') or fname == '_metadata.json':
                continue
            fpath = os.path.join(work_dir, fname)
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    page = json.load(f)
                source = page.get('meta_content', page)
                for tag in source.get('page_tags', []):
                    if isinstance(tag, dict):
                        pid = tag.get('id') or ''
                        if pid.startswith('vutt:P'):
                            person_ids.add(pid)
            except Exception:
                pass
    except Exception as e:
        print(f"update_page_person_mentions viga: {e}")
        return

    with state._works_lock:
        data = legacy._load_person_to_works()
        # Eemalda ainult 'mentioned' viited sellele teosele.
        for pid_entries in data.values():
            pid_entries[:] = [
                e for e in pid_entries
                if not (e.get('work_id') == work_id and e.get('role') == 'mentioned')
            ]
        # Lisa uued.
        for pid in person_ids:
            if pid not in data:
                data[pid] = []
            data[pid].append({'work_id': work_id, 'role': 'mentioned'})
        state.atomic_write_json(state.PERSON_TO_WORKS_FILE, data)


__all__ = ['get_person_with_works', '_build_work_to_persons', 'get_persons_for_work', '_structured_relation_ids', 'get_person_relation_network_ids', 'get_relation_type_suggestions', 'update_page_person_mentions']
