"""
Teostest tuletatud isiku-isiku seosed.

Indeks: data/config/works_creators_index.json — kirje IGALE teosele (#461)
  { work_id: { "title": str, "year": int|None, "creators": [{ "person_id": str, "roles": [str] }],
               "location": {"id": str|None, "label": str}|None, "genres": [str] } }
  Kogud ja avalikkus EI OLE siin: need elavad work_collections_index.json-is (ADR 0056).

Kutsumiskohad:
  build_works_creators_index()  — rebuild_indices() ja serveri start
  update_work_facts(meta)       — save_work_metadata, bulk_update_works, import_work (tingimusteta)
  remove_work_facts(work_id)    — teose kustutus
  get_work_relations(...)       — GET /prosopography/work-relations/{person_id}
"""
import json
import os
import threading
from typing import Optional

from ..config import WORKS_CREATORS_INDEX_FILE, PERSON_TO_WORKS_FILE, PROSOPOGRAPHY_INDEX_FILE, BASE_DIR, get_logger
from ..utils import atomic_write_json

logger = get_logger(__name__)
_creators_lock = threading.Lock()


def _creators_to_entries(creators: list) -> list:
    """Koondab sama isiku mitu rolli massiivi."""
    entries: list = []
    for creator in (creators or []):
        pid = (creator.get("id") or "")
        if not pid.startswith("vutt:P"):
            continue
        role = creator.get("role") or "creator"
        existing = next((e for e in entries if e["person_id"] == pid), None)
        if existing:
            if role not in existing["roles"]:
                existing["roles"].append(role)
        else:
            entries.append({"person_id": pid, "roles": [role]})
    return entries


def _location_of(meta: dict) -> Optional[dict]:
    """Trükikoht {id, label} või None (tühi string ja puuduv = None)."""
    loc = meta.get("location")
    if isinstance(loc, dict):
        label = loc.get("label") or ""
        return {"id": loc.get("id"), "label": label} if (label or loc.get("id")) else None
    if isinstance(loc, str) and loc.strip():
        return {"id": None, "label": loc.strip()}
    return None


def _genres_of(meta: dict) -> list:
    g = meta.get("genre")
    items = g if isinstance(g, list) else ([g] if g else [])
    out = []
    for item in items:
        label = item.get("label") if isinstance(item, dict) else item
        if isinstance(label, str) and label:
            out.append(label)
    return out


def _work_facts_entry(meta: dict) -> dict:
    """Ühe teose kirje — ÜKS ehitaja nii rebuildile kui uuendusele (ADR 0007).

    Kogusid ja avalikkust siia ei kopeerita: need elavad work_collections_index.json-is,
    mida uuendatakse tingimusteta ka call_ptw=False teedel (#461).
    """
    return {
        "title": meta.get("title") or "",
        "year": meta.get("year"),
        "creators": _creators_to_entries(meta.get("creators") or []),
        "location": _location_of(meta),
        "genres": _genres_of(meta),
    }


def _write_entry(work_id: str, entry: Optional[dict]) -> None:
    with _creators_lock:
        index = _load_creators_index()
        if entry is None:
            index.pop(work_id, None)
        else:
            index[work_id] = entry
        atomic_write_json(WORKS_CREATORS_INDEX_FILE, index)


def update_work_facts(meta: dict) -> None:
    """Kirjutab teose faktid. Kutsutakse tingimusteta update_work_collections kõrval."""
    work_id = meta.get("id") or meta.get("work_id")
    if work_id:
        _write_entry(work_id, _work_facts_entry(meta))


def remove_work_facts(work_id: str) -> None:
    if work_id:
        _write_entry(work_id, None)


def build_works_creators_index() -> None:
    """Ehitab indeksi nullist: kirje IGALE teosele, millel on _metadata.json."""
    index: dict = {}
    if os.path.exists(BASE_DIR):
        for entry in os.scandir(BASE_DIR):
            meta_path = os.path.join(entry.path, "_metadata.json")
            if not entry.is_dir() or not os.path.exists(meta_path):
                continue
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
            except Exception:
                continue
            work_id = meta.get("id") or meta.get("work_id")
            if work_id:
                index[work_id] = _work_facts_entry(meta)
    with _creators_lock:
        atomic_write_json(WORKS_CREATORS_INDEX_FILE, index)


def _load_person_to_works() -> dict:
    if os.path.exists(PERSON_TO_WORKS_FILE):
        try:
            with open(PERSON_TO_WORKS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _load_creators_index() -> dict:
    if os.path.exists(WORKS_CREATORS_INDEX_FILE):
        try:
            with open(WORKS_CREATORS_INDEX_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _load_person_name_map() -> dict:
    """Tagastab { person_id: label } kaardi prosopography_index.json-st."""
    if os.path.exists(PROSOPOGRAPHY_INDEX_FILE):
        try:
            with open(PROSOPOGRAPHY_INDEX_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return {e["id"]: e.get("label", e["id"]) for e in data.get("entries", [])}
        except Exception:
            pass
    return {}


def get_work_relations(person_id: str, limit: int = 10, offset: int = 0) -> list:
    """
    Tagastab isikud, kellega person_id jagab teoseid creators[] kaudu.
    Sorteeritud shared_works_count järgi kahanevalt.
    """
    ptw = _load_person_to_works()
    creators_index = _load_creators_index()
    name_map = _load_person_name_map()

    a_work_ids = {w["work_id"] for w in ptw.get(person_id, [])}

    # b_id → { work_id → (a_roles, b_roles, title, year) }
    shared: dict = {}

    for work_id in a_work_ids:
        work_entry = creators_index.get(work_id)
        if not work_entry:
            continue
        work_creators = work_entry.get("creators", [])
        a_entry = next((e for e in work_creators if e["person_id"] == person_id), None)
        if a_entry is None:
            continue
        a_roles = a_entry["roles"]
        for entry in work_creators:
            b_id = entry["person_id"]
            if b_id == person_id or not b_id.startswith("vutt:P"):
                continue
            shared.setdefault(b_id, {})[work_id] = (
                a_roles,
                entry["roles"],
                work_entry.get("title", ""),
                work_entry.get("year"),
            )

    results = []
    for b_id, works in shared.items():
        work_list = [
            {
                "work_id": wid,
                "work_title": title,
                "work_year": year,
                "a_roles": a_roles,
                "b_roles": b_roles,
            }
            for wid, (a_roles, b_roles, title, year) in works.items()
        ]
        results.append({
            "person_id": b_id,
            "person_name": name_map.get(b_id, b_id),
            "shared_works_count": len(works),
            "shared_works": work_list,
        })

    results.sort(key=lambda x: x["shared_works_count"], reverse=True)
    return results[offset: offset + limit]
