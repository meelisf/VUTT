"""
Vahemälu haldus (Collections, Vocabularies, People aliases ja Suggestions).
Eraldatud file_server.py-st.
"""
import json
import os
import threading
import urllib.request
from datetime import datetime

from .config import BASE_DIR, COLLECTIONS_FILE, VOCABULARIES_FILE, ARCHIVES_FILE, MEILI_URL, MEILI_KEY, INDEX_NAME
from .people_ops import load_people_data
from .utils import get_label, get_id, get_primary_labels, get_labels_by_lang, pick_best_label
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
    global _archives_cache, _archives_cache_at
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
        _archives_cache = None
        _archives_cache_at = None

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
                label_text = pick_best_label(labels_store[id_code], preferred_lang)
            else:
                label_text = pick_best_label(val.get('labels', {}), preferred_lang) or val.get('label', '').strip()
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
                except Exception: pass

    # page_tags Meilisearchist (asendab leheküljefailide skänni)
    try:
        facet_field = f"page_tags_suggest_{preferred_lang}"
        url = f"{MEILI_URL}/indexes/{INDEX_NAME}/search"
        body = json.dumps({"q": "", "limit": 0, "facets": [facet_field]}).encode('utf-8')
        req = urllib.request.Request(url, data=body, method='POST')
        req.add_header('Content-Type', 'application/json')
        req.add_header('Authorization', f'Bearer {MEILI_KEY}')
        with urllib.request.urlopen(req, timeout=5) as resp:
            result = json.loads(resp.read())
        facet_dist = result.get('facetDistribution', {}).get(facet_field, {})
        for entry_str in facet_dist:
            label, _, id_code = entry_str.partition('|||')
            label = label.strip()
            if label and not id_code.startswith('vutt:P'):
                add_item(tags, {'label': label, 'id': id_code or None}, 'tags')
    except Exception as e:
        print(f"SUGGESTIONS: page_tags Meilisearchist ebaõnnestus: {e}")

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

# =========================================================
# CACHE: Archives
# =========================================================
_archives_cache = None
_archives_cache_at = None
ARCHIVES_CACHE_TTL = 300

def get_cached_archives():
    global _archives_cache, _archives_cache_at
    with _cache_lock:
        if _archives_cache is None or _archives_cache_at is None or \
           (datetime.now() - _archives_cache_at).total_seconds() > ARCHIVES_CACHE_TTL:
            _archives_cache = {}
            if os.path.exists(ARCHIVES_FILE):
                try:
                    with open(ARCHIVES_FILE, 'r', encoding='utf-8') as f:
                        _archives_cache = json.load(f)
                except Exception as e:
                    print(f"Archives cache laadimine ebaõnnestus: {e}")
            _archives_cache_at = datetime.now()
        return _archives_cache
