"""Prosopograafia jagatud seis ja patch'itavad sõltuvused.

See moodul hoiab domeenimoodulite ühiseid konstante/lukke/sõltuvusi. `_compat`
sünkroniseerib siia ka vana `ops.py` façade peal tehtud monkeypatch'id.
"""
from __future__ import annotations

import glob as _glob
import logging
import threading

from ..config import (
    PROSOPOGRAPHY_DIR,
    PROSOPOGRAPHY_IMAGES_DIR,
    PROSOPOGRAPHY_INDEX_FILE,
    PERSON_TO_WORKS_FILE,
    PERSON_ALIASES_FILE,
    WORK_COLLECTIONS_INDEX_FILE,
    BASE_DIR,
)
from ..utils import generate_nanoid, atomic_write_json
from ..git_ops import save_with_git, delete_file_from_git
from .work_relations_ops import update_works_creators_index, build_works_creators_index, get_work_relations
from .places_ops import (
    _resolve_origin_group,
    _get_parent_place,
    _get_place_labels,
    _get_place_coordinates,
    _enrich_origin_from_places,
    _load_origin_groups,
)

logger = logging.getLogger(__name__)

PERSON_IMAGES_DIR_NAME = "images"

_index_lock = threading.Lock()
_works_lock = threading.Lock()
_aliases_lock = threading.Lock()
_work_collections_lock = threading.Lock()
