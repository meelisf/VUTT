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
    "_make_snippets",
    "_collection_descendants",
    "_persons_in_collection",
    "_person_collections",
    "_build_work_to_persons",
    "_structured_relation_ids",
    "_entry_occupations",
    "_entry_tags",
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
# Mida ME oleme moodulisse kirjutanud: (kirjutatud väärtus, mis seal enne oli).
_APPLIED: dict[tuple[str, str], Any] = {}
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


def _module_default(module: ModuleType, name: str) -> Any:
    """Domeenimooduli vaikeväärtus = ops.py impordil registreeritud objekt.

    Mõõdetud: impordi hetkel on iga domeenimooduli atribuut sama objekt mis
    fassaadi vaikimisi eksport (77 nime, 0 lahknevust). `_MODULE_ORIGINALS` on
    ainult varutee nimedele, mida fassaad ei registreeri.
    """
    if name in _DEFAULT_FACADE:
        return _DEFAULT_FACADE[name]
    key = (module.__name__, name)
    if key not in _MODULE_ORIGINALS:
        _MODULE_ORIGINALS[key] = getattr(module, name)
    return _MODULE_ORIGINALS[key]


def _apply(module: Any, name: str, facade_value: Any, default: Any) -> None:
    """Kanna fassaadi patch domeenimoodulisse — ja AINULT fassaadi patch.

    Vana versioon cache'is „originaali" laisalt esimesel sync'il: kui see hetk
    tabas testi, mis oli domeenimoodulit OTSE patchinud, talletus mokk
    originaalina ja kirjutati hiljem sõltumatusse testi tagasi (#342).

    Nüüd on kaks muutust:
      1. vaikeväärtus tuleb `_DEFAULT_FACADE`-ist (registreeritud ops.py impordil,
         enne kui ükski test jõuab patchida);
      2. kui fassaad KANNAB vaikeväärtust, ei puuduta me moodulit üldse — peale
         selle, et võtame tagasi oma enda varasema kirjutise. Võõrast patchi me
         ei kirjuta üle ega talleta.
    """
    if not hasattr(module, name):
        return
    key = (module.__name__, name)

    if facade_value is default:
        kirjutatud = _APPLIED.pop(key, None)
        if kirjutatud is not None and getattr(module, name) is kirjutatud[0]:
            setattr(module, name, kirjutatud[1])
        return

    if key not in _APPLIED:
        _APPLIED[key] = (facade_value, getattr(module, name))
    else:
        _APPLIED[key] = (facade_value, _APPLIED[key][1])
    setattr(module, name, facade_value)


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
            _apply(state, name, value, _DEFAULT_FACADE.get(name, _STATE_ORIGINALS[name]))
        for module_name in _DOMAIN_MODULES:
            module = sys.modules.get(module_name)
            if module is None:
                continue
            _apply(module, name, value, _module_default(module, name))
    _FACADE_DIRTY = False
