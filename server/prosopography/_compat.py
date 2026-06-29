"""Ühilduvuskiht prosopograafia ops-fassaadi ja domeenimoodulite vahel."""
from __future__ import annotations

import sys
from types import ModuleType
from typing import Any

from . import _legacy_ops as legacy
from . import state

# Nimed, mida vanad testid ja kood võivad patch'ida server.prosopography.ops peal.
_SYNC_NAMES = {
    "PROSOPOGRAPHY_DIR",
    "PROSOPOGRAPHY_IMAGES_DIR",
    "PROSOPOGRAPHY_INDEX_FILE",
    "PERSON_TO_WORKS_FILE",
    "PERSON_ALIASES_FILE",
    "WORK_COLLECTIONS_INDEX_FILE",
    "BASE_DIR",
    "save_with_git",
    "delete_file_from_git",
    "atomic_write_json",
    "_glob",
    "_index_lock",
    "_works_lock",
    "_aliases_lock",
    "_work_collections_lock",
    "_load_index",
    "_load_person_to_works",
    "_load_work_collections",
    "_load_person_aliases",
    "_id_to_path",
    "_person_image_path",
    "_make_snippet",
    "_collection_descendants",
    "_persons_in_collection",
    "_person_collections",
    "_build_work_to_persons",
    "_structured_relation_ids",
    "_entry_occupations",
    "_extract_occupation_entries",
    "_entry_matches_year_range",
    "_update_index_entry",
    "_update_aliases_entry",
    "_remove_aliases_entry",
    "_propagate_name_to_works",
    "get_person",
    "build_works_creators_index",
    "update_works_creators_index",
    "get_work_relations",
    "_resolve_origin_group",
    "_get_parent_place",
    "_get_place_labels",
    "_get_place_coordinates",
    "_enrich_origin_from_places",
    "_load_origin_groups",
}

_ORIGINALS = {name: getattr(legacy, name) for name in _SYNC_NAMES if hasattr(legacy, name)}
_STATE_ORIGINALS = {name: getattr(state, name) for name in _SYNC_NAMES if hasattr(state, name)}
_DEFAULT_FACADE: dict[str, Any] = {}
_FACADE_DIRTY = False


def register_default(name: str, value: Any) -> None:
    """Märgi ops.py fassaadi vaikimisi eksporditud objekt."""
    _DEFAULT_FACADE[name] = value


def mark_facade_dirty() -> None:
    """Märgi, et ops.py façade peal võib olla monkeypatch'e."""
    global _FACADE_DIRTY
    _FACADE_DIRTY = True


class _PatchAwareModule(ModuleType):
    """ModuleType, mis teeb ops.py setattr patch'id sync-kihile nähtavaks."""

    def __setattr__(self, name: str, value: Any) -> None:
        if name in _SYNC_NAMES:
            mark_facade_dirty()
        super().__setattr__(name, value)


def install_facade_patch_hook(module: ModuleType) -> None:
    """Paigalda hook pärast ops.py importi; production no-op sync jääb odavaks."""
    if not isinstance(module, _PatchAwareModule):
        module.__class__ = _PatchAwareModule


def sync_from_facade() -> None:
    """Kanna ops.py monkeypatch'id legacy/state moodulitesse ainult siis, kui midagi muutus."""
    global _FACADE_DIRTY
    if not _FACADE_DIRTY:
        return
    facade = sys.modules.get("server.prosopography.ops")
    if facade is None:
        _FACADE_DIRTY = False
        return
    for name in _SYNC_NAMES:
        if not hasattr(facade, name):
            continue
        value = getattr(facade, name)
        if name in _ORIGINALS:
            default = _DEFAULT_FACADE.get(name, _ORIGINALS[name])
            if value is default:
                setattr(legacy, name, _ORIGINALS[name])
            else:
                setattr(legacy, name, value)
        if name in _STATE_ORIGINALS:
            default = _DEFAULT_FACADE.get(name, _STATE_ORIGINALS[name])
            if value is default:
                setattr(state, name, _STATE_ORIGINALS[name])
            else:
                setattr(state, name, value)
    _FACADE_DIRTY = False


def call(name: str, *args: Any, **kwargs: Any) -> Any:
    sync_from_facade()
    return getattr(legacy, name)(*args, **kwargs)
