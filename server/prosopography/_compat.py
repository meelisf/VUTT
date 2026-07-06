"""Ühilduvuskiht prosopograafia ops-fassaadi ja domeenimoodulite vahel."""
from __future__ import annotations

import sys
from types import ModuleType
from typing import Any

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

_STATE_ORIGINALS = {name: getattr(state, name) for name in _SYNC_NAMES if hasattr(state, name)}
_DEFAULT_FACADE: dict[str, Any] = {}
_MODULE_ORIGINALS: dict[tuple[str, str], Any] = {}
_FACADE_DIRTY = False

# Domeenimoodulid, mille module-global'id võivad vanade ops.py monkeypatch'ide tõttu
# sünkroniseerimist vajada (nt tests patch("server.prosopography.ops._load_index")).
_DOMAIN_MODULES = (
    "server.prosopography.person_crud",
    "server.prosopography.person_search",
    "server.prosopography.relations",
    "server.prosopography.indices",
    "server.prosopography.merge_ops",
)


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


def _sync_attr(module: ModuleType, name: str, facade_value: Any) -> None:
    if not hasattr(module, name):
        return
    key = (module.__name__, name)
    if key not in _MODULE_ORIGINALS:
        _MODULE_ORIGINALS[key] = getattr(module, name)
    default = _DEFAULT_FACADE.get(name, _MODULE_ORIGINALS[key])
    setattr(module, name, _MODULE_ORIGINALS[key] if facade_value is default else facade_value)


def sync_from_facade() -> None:
    """Kanna ops.py monkeypatch'id state'i ja laaditud domeenimoodulitesse."""
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
        if name in _STATE_ORIGINALS:
            default = _DEFAULT_FACADE.get(name, _STATE_ORIGINALS[name])
            setattr(state, name, _STATE_ORIGINALS[name] if value is default else value)
        for module_name in _DOMAIN_MODULES:
            module = sys.modules.get(module_name)
            if module is not None:
                _sync_attr(module, name, value)
    _FACADE_DIRTY = False
