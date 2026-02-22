"""
Vahemälu haldus (Collections, Vocabularies, People aliases ja Suggestions).
Eraldatud file_server.py-st.
"""
import json
import os
import threading
from datetime import datetime

from .config import BASE_DIR, COLLECTIONS_FILE, VOCABULARIES_FILE
from .people_ops import load_people_data
from .utils import get_label, get_id, get_primary_labels, get_labels_by_lang
from .meilisearch_ops import load_labels_store

# =========================================================
# CACHE: Collections, Vocabularies ja Suggestions
# =========================================================
_cache_lock = threading.RLock()
_collections_cache = None
_vocabularies_cache = None
_cache_loaded_at = None
CACHE_TTL_SECONDS = 300

_suggestions_cache = {}
_suggestions_cache_at = None
SUGGESTIONS_CACHE_TTL = 300

def _load_cache_internal():
    global _collections_cache, _vocabularies_cache, _cache_loaded_at
    collections = {}
    vocabularies = {}

    if os.path.exists(COLLECTIONS_FILE):
        try:
            with open(COLLECTIONS_FILE, 'r', encoding='utf-8') as f:
                collections = json.load(f)
        except Exception as e:
            print(f"Collections cache laadimine ebaõnnestus: {e}")

    if os.path.exists(VOCABULARIES_FILE):
        try:
            with open(VOCABULARIES_FILE, 'r', encoding='utf-8') as f:
                vocabularies = json.load(f)
        except Exception as e:
            print(f"Vocabularies cache laadimine ebaõnnestus: {e}")

    _collections_cache = collections
    _vocabularies_cache = vocabularies
    _cache_loaded_at = datetime.now()

def _is_cache_stale():
    if _collections_cache is None or _cache_loaded_at is None:
        return True
    return (datetime.now() - _cache_loaded_at).total_seconds() > CACHE_TTL_SECONDS

def get_cached_collections():
    with _cache_lock:
        if _is_cache_stale(): _load_cache_internal()
        return _collections_cache

def get_cached_vocabularies():
    with _cache_lock:
        if _is_cache_stale(): _load_cache_internal()
        return _vocabularies_cache

def invalidate_cache():
    global _collections_cache, _vocabularies_cache, _cache_loaded_at
    global _suggestions_cache, _suggestions_cache_at
    global _people_aliases_cache, _people_aliases_cache_at
    global _people_register_cache, _people_register_cache_at
    with _cache_lock:
        _collections_cache = None
        _vocabularies_cache = None
        _cache_loaded_at = None
        _suggestions_cache = {}
        _suggestions_cache_at = None
        _people_aliases_cache = None
        _people_aliases_cache_at = None
        _people_register_cache = None
        _people_register_cache_at = None

# =========================================================
# CACHE: People aliases ja register
# =========================================================
_people_aliases_cache = None
_people_aliases_cache_at = None
_people_register_cache = None
_people_register_cache_at = None
PEOPLE_ALIASES_CACHE_TTL = 300

def _build_people_aliases():
    people_data = load_people_data()
    alias_map = {}
    seen = set()
    for person_id, info in people_data.items():
        primary = info.get('primary_name', '')
        aliases = info.get('aliases', [])
        if not primary or primary in seen:
            if primary in seen:
                for alias in aliases:
                    if alias != primary and alias not in alias_map: alias_map[alias] = primary
            continue
        seen.add(primary)
        for alias in aliases:
            if alias != primary: alias_map[alias] = primary
    return alias_map

def get_cached_people_aliases():
    global _people_aliases_cache, _people_aliases_cache_at
    with _cache_lock:
        if _people_aliases_cache is None or _people_aliases_cache_at is None or \
           (datetime.now() - _people_aliases_cache_at).total_seconds() > PEOPLE_ALIASES_CACHE_TTL:
            _people_aliases_cache = _build_people_aliases()
            _people_aliases_cache_at = datetime.now()
        return _people_aliases_cache

def _build_people_register():
    people_data = load_people_data()
    seen = {}
    register = []
    for person_id, info in people_data.items():
        primary = info.get('primary_name', '')
        if not primary: continue
        if primary in seen:
            existing = register[seen[primary]]
            existing_aliases_set = set(existing['aliases'])
            for alias in info.get('aliases', []):
                if alias != primary and alias not in existing_aliases_set:
                    existing['aliases'].append(alias)
                    existing_aliases_set.add(alias)
            for id_type, id_val in info.get('ids', {}).items():
                if id_val and id_type not in existing['ids']: existing['ids'][id_type] = id_val
            continue
        entry = {'primary_name': primary, 'aliases': [a for a in info.get('aliases', []) if a != primary], 'ids': dict(info.get('ids', {}))}
        seen[primary] = len(register)
        register.append(entry)
    return register

def get_cached_people_register():
    global _people_register_cache, _people_register_cache_at
    with _cache_lock:
        if _people_register_cache is None or _people_register_cache_at is None or \
           (datetime.now() - _people_register_cache_at).total_seconds() > PEOPLE_ALIASES_CACHE_TTL:
            _people_register_cache = _build_people_register()
            _people_register_cache_at = datetime.now()
        return _people_register_cache

def _build_suggestions(preferred_lang):
    authors, tags, places, printers, types, genres = {}, {}, {}, {}, {}, {}
    seen_ids = {}
    # Kanooniilised labelid — ületavad _metadata.json labeli (nt Q861911 → "Oratsioon")
    labels_store = load_labels_store()

    def add_item(store, val, store_name=''):
        if not val: return
        if isinstance(val, str):
            label = val.strip()
            if label:
                key = label.lower()
                if key not in store: store[key] = {'label': label, 'id': None}
            return
        if isinstance(val, dict):
            id_code = val.get('id')
            if id_code and (store_name, id_code) in seen_ids: return
            if id_code: seen_ids[(store_name, id_code)] = True
            # Kontrolli labels_store esmalt (kanooniline allikas)
            if id_code and id_code in labels_store:
                fallback_lang = 'en' if preferred_lang == 'et' else 'et'
                label_text = labels_store[id_code].get(preferred_lang) or labels_store[id_code].get(fallback_lang, '')
            else:
                labels_dict = val.get('labels', {})
                fallback_lang = 'en' if preferred_lang == 'et' else 'et'
                label_text = labels_dict.get(preferred_lang) or labels_dict.get(fallback_lang) or val.get('label', '').strip()
            if label_text and isinstance(label_text, str):
                label_text = label_text.strip()
                key = label_text.lower()
                if key not in store or (id_code and not store[key]['id']): store[key] = {'label': label_text, 'id': id_code}

    for entry in os.scandir(BASE_DIR):
        if entry.is_dir():
            meta_path = os.path.join(entry.path, '_metadata.json')
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, 'r', encoding='utf-8') as f:
                        meta = json.load(f)
                        for creator in meta.get('creators', []): add_item(authors, {'label': creator.get('name'), 'id': creator.get('id')}, 'authors')
                        for t in meta.get('tags', []): add_item(tags, t, 'tags')
                        add_item(places, meta.get('location'), 'places')
                        add_item(printers, meta.get('publisher'), 'printers')
                        add_item(types, meta.get('type'), 'types')
                        g = meta.get('genre')
                        if g:
                            if isinstance(g, list):
                                for item in g: add_item(genres, item, 'genres')
                            else: add_item(genres, g, 'genres')
                except: pass
            try:
                for page_file in os.scandir(entry.path):
                    if page_file.name.endswith('.json') and page_file.name != '_metadata.json':
                        try:
                            with open(page_file.path, 'r', encoding='utf-8') as f:
                                page_data = json.load(f)
                                source = page_data.get('meta_content', page_data)
                                for pt in source.get('page_tags', source.get('tags', [])): add_item(tags, pt, 'tags')
                        except: pass
            except: pass

    for p in ['Tartu', 'Pärnu']:
        if p.lower() not in places: places[p.lower()] = {'label': p, 'id': None}

    def to_sorted_list(store): return sorted(list(store.values()), key=lambda x: x['label'])
    return {"authors": to_sorted_list(authors), "tags": to_sorted_list(tags), "places": to_sorted_list(places), "printers": to_sorted_list(printers), "types": to_sorted_list(types), "genres": to_sorted_list(genres)}

def get_cached_suggestions(lang):
    global _suggestions_cache, _suggestions_cache_at
    with _cache_lock:
        if _suggestions_cache_at is None or (datetime.now() - _suggestions_cache_at).total_seconds() > SUGGESTIONS_CACHE_TTL:
            _suggestions_cache = {}
            _suggestions_cache_at = None
        if lang in _suggestions_cache: return _suggestions_cache[lang]
        result = _build_suggestions(lang)
        _suggestions_cache[lang] = result
        if _suggestions_cache_at is None: _suggestions_cache_at = datetime.now()
        return result
