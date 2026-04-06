"""
Teostest tuletatud isiku-isiku seosed.

Indeks: data/state/works_creators_index.json
  { work_id: { "title": str, "year": int|None, "creators": [{ "person_id": str, "roles": [str] }] } }

Kutsumiskohad:
  build_works_creators_index()      — rebuild_indices() ja serveri start
  update_works_creators_index(...)  — /save ja /update-work-metadata järel (background)
  get_work_relations(...)           — GET /prosopography/work-relations/{person_id}
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


def build_works_creators_index() -> None:
    """Ehitab works_creators_index.json nullist kõigi teoste _metadata.json põhjal."""
    index: dict = {}
    if not os.path.exists(BASE_DIR):
        atomic_write_json(WORKS_CREATORS_INDEX_FILE, index)
        return
    for entry in os.scandir(BASE_DIR):
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
        entries = _creators_to_entries(meta.get("creators") or [])
        if entries:
            index[work_id] = {
                "title": meta.get("title") or "",
                "year": meta.get("year"),
                "creators": entries,
            }
    with _creators_lock:
        atomic_write_json(WORKS_CREATORS_INDEX_FILE, index)


def update_works_creators_index(
    work_id: str,
    creators: list,
    title: str = "",
    year: Optional[int] = None,
) -> None:
    """Uuendab ühe teose kirjet works_creators_index.json-s."""
    entries = _creators_to_entries(creators)
    with _creators_lock:
        if os.path.exists(WORKS_CREATORS_INDEX_FILE):
            try:
                with open(WORKS_CREATORS_INDEX_FILE, "r", encoding="utf-8") as f:
                    index = json.load(f)
            except Exception:
                index = {}
        else:
            index = {}
        if entries:
            index[work_id] = {"title": title, "year": year, "creators": entries}
        else:
            index.pop(work_id, None)
        atomic_write_json(WORKS_CREATORS_INDEX_FILE, index)


def get_work_relations(person_id: str, limit: int = 10, offset: int = 0) -> list:
    raise NotImplementedError
