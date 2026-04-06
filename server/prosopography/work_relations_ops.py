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


def build_works_creators_index() -> None:
    raise NotImplementedError


def update_works_creators_index(work_id: str, creators: list, title: str = "", year: Optional[int] = None) -> None:
    raise NotImplementedError


def get_work_relations(person_id: str, limit: int = 10, offset: int = 0) -> list:
    raise NotImplementedError
