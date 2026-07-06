"""Prosopograafia operatsioonide ühilduvusfassaad.

Domeenipõhised impordid asuvad moodulites `person_crud`, `person_search`,
`relations`, `indices`, `merge_ops` ja `git_history`. See fail säilitab vana
`server.prosopography.ops` API, et routerid ja testid ei peaks korraga muutuma.
"""
from __future__ import annotations

import sys

from . import state
from ._compat import install_facade_patch_hook, register_default

# Vana API kaudu patch'itavad sõltuvused/konstandid.
PROSOPOGRAPHY_DIR = state.PROSOPOGRAPHY_DIR
PROSOPOGRAPHY_IMAGES_DIR = state.PROSOPOGRAPHY_IMAGES_DIR
PROSOPOGRAPHY_INDEX_FILE = state.PROSOPOGRAPHY_INDEX_FILE
PERSON_TO_WORKS_FILE = state.PERSON_TO_WORKS_FILE
PERSON_ALIASES_FILE = state.PERSON_ALIASES_FILE
WORK_COLLECTIONS_INDEX_FILE = state.WORK_COLLECTIONS_INDEX_FILE
BASE_DIR = state.BASE_DIR

save_with_git = state.save_with_git
delete_file_from_git = state.delete_file_from_git
atomic_write_json = state.atomic_write_json
_glob = state._glob
build_works_creators_index = state.build_works_creators_index
update_works_creators_index = state.update_works_creators_index
get_work_relations = state.get_work_relations
_resolve_origin_group = state._resolve_origin_group
_get_parent_place = state._get_parent_place
_get_place_labels = state._get_place_labels
_get_place_coordinates = state._get_place_coordinates
_enrich_origin_from_places = state._enrich_origin_from_places
_load_origin_groups = state._load_origin_groups

# Lukud jäävad nähtavaks vana API jaoks.
_index_lock = state._index_lock
_works_lock = state._works_lock
_aliases_lock = state._aliases_lock
_work_collections_lock = state._work_collections_lock

from .person_crud import (
    _safe_nanoid,
    _id_to_path,
    _strip_markup,
    _make_snippet,
    get_person,
    create_person,
    _make_date_obj,
    _propagate_name_to_works,
    update_person,
    add_identifier,
    _person_image_path,
    upload_person_image,
    get_person_image_path,
    delete_person_image,
    apply_enrichment,
    _find_by_external_id,
    ensure_prosopo_for_entity,
    ensure_prosopo_stubs,
    bulk_update_occupation,
)

from .person_search import (
    list_persons,
    _filter_index_entries,
    _entry_matches_year_range,
    get_person_map_markers,
    get_person_facets,
    _load_person_aliases,
    _index_entry_from_person,
    _extract_occupation_entries,
    _entry_occupations,
)

from .relations import (
    get_person_with_works,
    _build_work_to_persons,
    get_persons_for_work,
    _structured_relation_ids,
    get_person_relation_network_ids,
    get_relation_type_suggestions,
    update_page_person_mentions,
)

from .indices import (
    _load_index,
    _load_person_to_works,
    _load_work_collections,
    update_work_collections,
    _collection_descendants,
    _persons_in_collection,
    _person_collections,
    _update_index_entry,
    _update_aliases_entry,
    update_person_to_works,
    rebuild_indices,
    _remove_aliases_entry,
)

from .merge_ops import (
    merge_person,
    delete_person,
)

from .git_history import (
    compute_person_diff,
)

__all__ = ['PROSOPOGRAPHY_DIR', 'PROSOPOGRAPHY_IMAGES_DIR', 'PROSOPOGRAPHY_INDEX_FILE', 'PERSON_TO_WORKS_FILE', 'PERSON_ALIASES_FILE', 'WORK_COLLECTIONS_INDEX_FILE', 'BASE_DIR', 'save_with_git', 'delete_file_from_git', 'atomic_write_json', '_glob', 'build_works_creators_index', 'update_works_creators_index', 'get_work_relations', '_resolve_origin_group', '_get_parent_place', '_get_place_labels', '_get_place_coordinates', '_enrich_origin_from_places', '_load_origin_groups', '_index_lock', '_works_lock', '_aliases_lock', '_work_collections_lock', '_safe_nanoid', '_id_to_path', '_strip_markup', '_make_snippet', 'get_person', 'create_person', '_make_date_obj', '_propagate_name_to_works', 'update_person', 'add_identifier', '_person_image_path', 'upload_person_image', 'get_person_image_path', 'delete_person_image', 'apply_enrichment', '_find_by_external_id', 'ensure_prosopo_for_entity', 'ensure_prosopo_stubs', 'bulk_update_occupation', 'list_persons', '_filter_index_entries', '_entry_matches_year_range', 'get_person_map_markers', 'get_person_facets', '_load_person_aliases', '_index_entry_from_person', '_extract_occupation_entries', '_entry_occupations', 'get_person_with_works', '_build_work_to_persons', 'get_persons_for_work', '_structured_relation_ids', 'get_person_relation_network_ids', 'get_relation_type_suggestions', 'update_page_person_mentions', '_load_index', '_load_person_to_works', '_load_work_collections', 'update_work_collections', '_collection_descendants', '_persons_in_collection', '_person_collections', '_update_index_entry', '_update_aliases_entry', 'update_person_to_works', 'rebuild_indices', '_remove_aliases_entry', 'merge_person', 'delete_person', 'compute_person_diff']

for _name in __all__:
    register_default(_name, globals()[_name])

del _name

install_facade_patch_hook(sys.modules[__name__])

