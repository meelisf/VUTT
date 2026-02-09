#!/usr/bin/env python3
"""
VUTT failiserver - refaktoreeritud versioon.
Kasutab server/ mooduleid abifunktsioonide jaoks.
"""
import http.server
import json
import os
import threading
import socketserver
from datetime import datetime

# Impordi kõik vajalik server/ moodulitest
from server import (
    # Konfiguratsioon
    BASE_DIR, PORT, SESSION_DURATION, COLLECTIONS_FILE, VOCABULARIES_FILE,
    # CORS
    send_cors_headers,
    # HTTP helperid
    send_json_response, read_request_data, require_auth_handler,
    # Rate limiting
    get_client_ip, check_rate_limit, rate_limit_response,
    # Autentimine
    sessions, verify_user, create_session,
    # Registreerimine
    add_registration, validate_invite_token,
    # Pending edits (HTTP handlerid)
    handle_save_pending, handle_pending_edits_list,
    handle_pending_edits_check, handle_pending_edits_approve,
    handle_pending_edits_reject,
    # Git
    save_with_git, get_recent_commits, run_git_fsck,
    # Git HTTP handlerid
    handle_backups, handle_restore, handle_git_history,
    handle_git_restore, handle_git_diff, handle_commit_diff,
    # Admin HTTP handlerid
    handle_admin_registrations, handle_admin_registrations_approve,
    handle_admin_registrations_reject, handle_admin_users,
    handle_admin_users_update_role, handle_admin_users_delete,
    handle_invite_set_password,
    handle_admin_git_failures, handle_admin_git_health,
    handle_admin_people_refresh, handle_admin_people_refresh_status,
    # Bulk operatsioonide HTTP handlerid
    handle_bulk_tags, handle_bulk_genre, handle_bulk_collection,
    # Meilisearch
    sync_work_to_meilisearch, sync_work_to_meilisearch_async, metadata_watcher_loop,
    # People/Authors
    load_people_data, process_creators_metadata, people_refresh_loop,
    # Utils
    metadata_lock,
    find_directory_by_id, build_work_id_cache
)

from server.metadata_handler import handle_metadata_request

# =========================================================
# CACHE: Collections, Vocabularies ja Suggestions
# Loetakse serveri stardil, taaslaaditakse perioodiliselt
# =========================================================
_cache_lock = threading.RLock()  # RLock lubab sama lõime poolt korduvat lukustamist
_collections_cache = None
_vocabularies_cache = None
_cache_loaded_at = None
CACHE_TTL_SECONDS = 300  # 5 minutit

# Metadata suggestions cache (keele-põhine)
_suggestions_cache = {}      # lang -> {authors, tags, places, ...}
_suggestions_cache_at = None
SUGGESTIONS_CACHE_TTL = 300  # 5 min (sama mis collections)


def _load_cache_internal():
    """Laeb cache'i (sisekasutuseks, eeldab et lukk on võetud)."""
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

    print(f"Cache laetud: {len(collections)} kollektsiooni, {len(vocabularies)} sõnavara")


def _is_cache_stale():
    """Kontrollib kas cache on aegunud."""
    if _collections_cache is None or _cache_loaded_at is None:
        return True
    return (datetime.now() - _cache_loaded_at).total_seconds() > CACHE_TTL_SECONDS


def get_cached_collections():
    """Tagastab cache'itud kollektsioonid, laeb vajadusel uuesti."""
    with _cache_lock:
        if _is_cache_stale():
            _load_cache_internal()
        return _collections_cache


def get_cached_vocabularies():
    """Tagastab cache'itud sõnavara, laeb vajadusel uuesti."""
    with _cache_lock:
        if _is_cache_stale():
            _load_cache_internal()
        return _vocabularies_cache


def invalidate_cache():
    """Tühjendab cache'i (kutsuda pärast failide muutmist)."""
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
# CACHE: People aliases (alias → kanooniline nimi)
# =========================================================
_people_aliases_cache = None
_people_aliases_cache_at = None
_people_register_cache = None
_people_register_cache_at = None
PEOPLE_ALIASES_CACHE_TTL = 300  # 5 min


def _build_people_aliases():
    """Ehitab alias→kanooniline nimi kaardi people.json'ist."""
    people_data = load_people_data()
    alias_map = {}
    # Jälgime juba nähtud isikuid (primary_name), et vältida duplikaate
    seen = set()
    for person_id, info in people_data.items():
        primary = info.get('primary_name', '')
        aliases = info.get('aliases', [])
        if not primary or primary in seen:
            # Duplikaat (sama isik mitme ID all) — jätame vahele kui juba töödeldud
            if primary in seen:
                # Aga lisame siiski aliased, mis pole veel kaardis
                for alias in aliases:
                    if alias != primary and alias not in alias_map:
                        alias_map[alias] = primary
                continue
            continue
        seen.add(primary)
        for alias in aliases:
            if alias != primary:
                alias_map[alias] = primary
    return alias_map


def get_cached_people_aliases():
    """Tagastab cache'itud people aliases kaardi."""
    global _people_aliases_cache, _people_aliases_cache_at
    with _cache_lock:
        if _people_aliases_cache is None or _people_aliases_cache_at is None or \
           (datetime.now() - _people_aliases_cache_at).total_seconds() > PEOPLE_ALIASES_CACHE_TTL:
            _people_aliases_cache = _build_people_aliases()
            _people_aliases_cache_at = datetime.now()
            print(f"People aliases cache laetud: {len(_people_aliases_cache)} aliast")
        return _people_aliases_cache


def _build_people_register():
    """Ehitab deduplitseeritud isikute nimekirja people.json'ist.

    Tagastab listi: [{ primary_name, aliases, ids }, ...]
    Deduplitseerib primary_name järgi (sama isik võib olla mitme ID all).
    """
    people_data = load_people_data()
    seen = {}  # primary_name -> index registris
    register = []

    for person_id, info in people_data.items():
        primary = info.get('primary_name', '')
        if not primary:
            continue

        if primary in seen:
            # Lisa puuduvad aliased olemasolevale kirjele
            existing = register[seen[primary]]
            existing_aliases_set = set(existing['aliases'])
            for alias in info.get('aliases', []):
                if alias != primary and alias not in existing_aliases_set:
                    existing['aliases'].append(alias)
                    existing_aliases_set.add(alias)
            # Lisa puuduvad ID-d
            for id_type, id_val in info.get('ids', {}).items():
                if id_val and id_type not in existing['ids']:
                    existing['ids'][id_type] = id_val
            continue

        entry = {
            'primary_name': primary,
            'aliases': [a for a in info.get('aliases', []) if a != primary],
            'ids': dict(info.get('ids', {}))
        }
        seen[primary] = len(register)
        register.append(entry)

    return register


def get_cached_people_register():
    """Tagastab cache'itud people register nimekirja."""
    global _people_register_cache, _people_register_cache_at
    with _cache_lock:
        if _people_register_cache is None or _people_register_cache_at is None or \
           (datetime.now() - _people_register_cache_at).total_seconds() > PEOPLE_ALIASES_CACHE_TTL:
            _people_register_cache = _build_people_register()
            _people_register_cache_at = datetime.now()
            print(f"People register cache laetud: {len(_people_register_cache)} isikut")
        return _people_register_cache


def _build_suggestions(preferred_lang):
    """Ehitab metadata soovituste andmestruktuuri failisüsteemist."""
    # Sõnastikud kujul: label.lower() -> { label: "Orig", id: "Q..." | None }
    authors = {}
    tags = {}
    places = {}
    printers = {}
    types = {}
    genres = {}
    seen_ids = {}  # (store_name, id) -> True

    def add_item(store, val, store_name=''):
        """Lisab väärtuse hoidlasse. Kasutab eelistatud keele silti."""
        if not val: return

        # 1. Lihtne string
        if isinstance(val, str):
            label = val.strip()
            if label:
                key = label.lower()
                if key not in store:
                    store[key] = {'label': label, 'id': None}
            return

        # 2. Objekt (LinkedEntity)
        if isinstance(val, dict):
            id_code = val.get('id')

            # Kui see ID on juba samas hoidlas, ära lisa uuesti
            if id_code and (store_name, id_code) in seen_ids:
                return
            if id_code:
                seen_ids[(store_name, id_code)] = True

            labels_dict = val.get('labels', {})

            # Leia silt eelistatud keeles, fallback teisele UI keelele, siis põhisildile
            label_text = None
            if isinstance(labels_dict, dict):
                fallback_lang = 'en' if preferred_lang == 'et' else 'et'
                label_text = labels_dict.get(preferred_lang) or labels_dict.get(fallback_lang)

            # Kui tõlget ei leitud, kasuta põhisilti
            if not label_text:
                label_text = val.get('label', '').strip()

            if label_text and isinstance(label_text, str):
                label_text = label_text.strip()
                key = label_text.lower()
                if key not in store or (id_code and not store[key]['id']):
                    store[key] = {'label': label_text, 'id': id_code}

    # Käime läbi kõik kataloogid ja kogume andmeid
    for entry in os.scandir(BASE_DIR):
        if entry.is_dir():
            # 1. Teose metaandmed (_metadata.json)
            meta_path = os.path.join(entry.path, '_metadata.json')
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, 'r', encoding='utf-8') as f:
                        meta = json.load(f)

                        # Creators
                        for creator in meta.get('creators', []):
                            add_item(authors, {'label': creator.get('name'), 'id': creator.get('id')}, 'authors')

                        # Tags
                        for t in meta.get('tags', []): add_item(tags, t, 'tags')

                        # Location
                        add_item(places, meta.get('location'), 'places')

                        # Publisher
                        add_item(printers, meta.get('publisher'), 'printers')

                        # Type
                        add_item(types, meta.get('type'), 'types')

                        # Genre
                        g = meta.get('genre')
                        if g:
                            if isinstance(g, list):
                                for item in g: add_item(genres, item, 'genres')
                            else:
                                add_item(genres, g, 'genres')
                except:
                    pass

            # 2. Lehekülje märksõnad (*.json failid, v.a _metadata.json)
            try:
                for page_file in os.scandir(entry.path):
                    if page_file.name.endswith('.json') and page_file.name != '_metadata.json':
                        try:
                            with open(page_file.path, 'r', encoding='utf-8') as f:
                                page_data = json.load(f)
                                # Toeta nii vana kui uut formaati
                                source = page_data.get('meta_content', page_data)
                                page_tags = source.get('page_tags', source.get('tags', []))
                                for pt in page_tags:
                                    add_item(tags, pt, 'tags')
                        except:
                            pass
            except:
                pass

    # Vaikimisi väärtused
    defaults_places = ['Tartu', 'Pärnu']
    for p in defaults_places:
        if p.lower() not in places: places[p.lower()] = {'label': p, 'id': None}

    # Vorminda vastus listiks, sorteeri nime järgi
    def to_sorted_list(store):
        return sorted(list(store.values()), key=lambda x: x['label'])

    return {
        "authors": to_sorted_list(authors),
        "tags": to_sorted_list(tags),
        "places": to_sorted_list(places),
        "printers": to_sorted_list(printers),
        "types": to_sorted_list(types),
        "genres": to_sorted_list(genres)
    }


def get_cached_suggestions(lang):
    """Tagastab cache'itud metadata soovitused, ehitab vajadusel uuesti."""
    global _suggestions_cache, _suggestions_cache_at
    with _cache_lock:
        # Kontrolli kas cache on aegunud
        if _suggestions_cache_at is None or \
           (datetime.now() - _suggestions_cache_at).total_seconds() > SUGGESTIONS_CACHE_TTL:
            _suggestions_cache = {}
            _suggestions_cache_at = None

        if lang in _suggestions_cache:
            return _suggestions_cache[lang]

        # Ehita ja cache'i
        result = _build_suggestions(lang)
        _suggestions_cache[lang] = result
        if _suggestions_cache_at is None:
            _suggestions_cache_at = datetime.now()
        return result


# Lae cache serveri stardil
with _cache_lock:
    _load_cache_internal()


class RequestHandler(http.server.SimpleHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200, "ok")
        send_cors_headers(self)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        # GET /recent-edits - viimased muudatused (Git-põhine)
        if self.path.startswith('/recent-edits'):
            try:
                # Parsi query parameetrid
                from urllib.parse import urlparse, parse_qs
                parsed = urlparse(self.path)
                params = parse_qs(parsed.query)

                # Autentimine on kohustuslik
                auth_token = params.get('token', [None])[0]
                if not auth_token:
                    send_json_response(self, 401, {"status": "error", "message": "Token puudub"})
                    return

                session = sessions.get(auth_token)
                if not session:
                    send_json_response(self, 401, {"status": "error", "message": "Kehtetu token"})
                    return

                current_user = session['user']
                is_admin = current_user.get('role') == 'admin'

                # Admin näeb kõiki, tavaline kasutaja ainult oma muudatusi
                filter_user = params.get('user', [None])[0]
                limit = int(params.get('limit', [30])[0])

                # Kui pole admin ja üritab teiste muudatusi vaadata
                if not is_admin and filter_user and filter_user != current_user.get('username'):
                    filter_user = current_user.get('username')

                # Kui pole admin ja ei ole filtrit, näita ainult oma muudatusi
                if not is_admin and not filter_user:
                    filter_user = current_user.get('username')

                # Hangi commitid
                commits = get_recent_commits(username=filter_user, limit=limit)

                send_json_response(self, 200, {
                    "status": "success",
                    "commits": commits,
                    "is_admin": is_admin,
                    "filtered_by": filter_user
                })

            except Exception as e:
                print(f"RECENT-EDITS VIGA: {e}")
                import traceback
                traceback.print_exc()
                self.send_error(500, str(e))
            return

        # GET /invite/{token} - tokeni kehtivuse kontroll (avalik)
        if self.path.startswith('/invite/'):
            token = self.path.split('/invite/')[1].split('?')[0]  # Eemalda query params

            try:
                token_data, error = validate_invite_token(token)

                if token_data:
                    response = {
                        "status": "success",
                        "valid": True,
                        "email": token_data["email"],
                        "name": token_data["name"],
                        "expires_at": token_data["expires_at"]
                    }
                else:
                    response = {
                        "status": "error",
                        "valid": False,
                        "message": error
                    }

                send_json_response(self, 200, response)

            except Exception as e:
                print(f"INVITE VALIDATE VIGA: {e}")
                self.send_error(500, str(e))

        # GET /collections - kollektsioonide puu (avalik, cache'itud)
        elif self.path == '/collections':
            try:
                collections = get_cached_collections()
                send_json_response(self, 200, {"status": "success", "collections": collections})

            except Exception as e:
                print(f"COLLECTIONS VIGA: {e}")
                self.send_error(500, str(e))

        # GET /vocabularies - kontrollitud sõnavara (avalik, cache'itud)
        elif self.path == '/vocabularies':
            try:
                vocabularies = get_cached_vocabularies()
                send_json_response(self, 200, {"status": "success", "vocabularies": vocabularies})

            except Exception as e:
                print(f"VOCABULARIES VIGA: {e}")
                self.send_error(500, str(e))

        # GET /people-aliases - alias→kanooniline nimi kaart (avalik, cache'itud)
        elif self.path == '/people-aliases':
            try:
                aliases = get_cached_people_aliases()
                send_json_response(self, 200, {"status": "success", "aliases": aliases})

            except Exception as e:
                print(f"PEOPLE ALIASES VIGA: {e}")
                self.send_error(500, str(e))

        # GET /people-register - deduplitseeritud isikute nimekiri (avalik, cache'itud)
        elif self.path == '/people-register':
            try:
                register = get_cached_people_register()
                send_json_response(self, 200, {"status": "success", "people": register})

            except Exception as e:
                print(f"PEOPLE REGISTER VIGA: {e}")
                self.send_error(500, str(e))

        # GET /meta/work/{id} - dünaamilised metasildid robotitele
        elif self.path.startswith('/meta/work/'):
            try:
                work_id = self.path.split('/meta/work/')[1].split('?')[0]
                handle_metadata_request(self, work_id)
            except Exception as e:
                print(f"METADATA HANDLER VIGA: {e}")
                self.send_error(500, str(e))

        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == '/login':
            try:
                # Rate limit kontroll
                client_ip = get_client_ip(self)
                allowed, retry_after = check_rate_limit(client_ip, '/login')
                if not allowed:
                    print(f"RATE LIMIT: /login blokeeritud IP-le {client_ip}")
                    rate_limit_response(self, retry_after)
                    return

                data = read_request_data(self)

                username = data.get('username', '').strip()
                password = data.get('password', '')

                user = verify_user(username, password)

                if user:
                    token = create_session(user)
                    send_json_response(self, 200, {"status": "success", "user": user, "token": token})
                else:
                    send_json_response(self, 200, {"status": "error", "message": "Vale kasutajanimi või parool"})

            except Exception as e:
                print(f"LOGIN VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/verify-token':
            # Tokeni kehtivuse kontroll (lehe laadimisel)
            try:
                data = read_request_data(self)

                token = data.get('token', '').strip()

                session = sessions.get(token)
                if session:
                    # Kontrolli sessiooni aegumist (24h)
                    created_at = datetime.fromisoformat(session["created_at"])
                    if datetime.now() - created_at > SESSION_DURATION:
                        del sessions[token]
                        send_json_response(self, 200, {"status": "error", "valid": False, "message": "Sessioon aegunud (24h)"})
                    else:
                        send_json_response(self, 200, {"status": "success", "user": session["user"], "valid": True})
                else:
                    send_json_response(self, 200, {"status": "error", "valid": False, "message": "Token aegunud"})

            except Exception as e:
                print(f"VERIFY-TOKEN VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/register':
            # Avalik registreerimistaotluse esitamine
            try:
                # Rate limit kontroll
                client_ip = get_client_ip(self)
                allowed, retry_after = check_rate_limit(client_ip, '/register')
                if not allowed:
                    print(f"RATE LIMIT: /register blokeeritud IP-le {client_ip}")
                    rate_limit_response(self, retry_after)
                    return

                data = read_request_data(self)

                # Honeypot kontroll - kui täidetud, siis bot
                honeypot = data.get('website', '')
                if honeypot:
                    print(f"HONEYPOT: Tuvastatud bot IP-lt {client_ip}, website='{honeypot}'")
                    # Tagastame "edu" et bot arvaks, et õnnestus
                    send_json_response(self, 200, {"status": "success", "message": "Taotlus esitatud"})
                    return

                name = data.get('name', '').strip()
                email = data.get('email', '').strip().lower()
                affiliation = data.get('affiliation', '').strip() if data.get('affiliation') else None
                motivation = data.get('motivation', '').strip()

                # Valideerimine
                if not name:
                    send_json_response(self, 400, {"status": "error", "message": "Nimi on kohustuslik"})
                    return

                if not email or '@' not in email:
                    send_json_response(self, 400, {"status": "error", "message": "Kehtiv e-posti aadress on kohustuslik"})
                    return

                if not motivation:
                    send_json_response(self, 400, {"status": "error", "message": "Motivatsioon on kohustuslik"})
                    return

                # Lisa taotlus
                registration, error = add_registration(name, email, affiliation, motivation)

                status_code = 200 if registration else 400
                if registration:
                    response = {"status": "success", "message": "Taotlus esitatud", "id": registration["id"]}
                else:
                    response = {"status": "error", "message": error}

                send_json_response(self, status_code, response)

            except Exception as e:
                print(f"REGISTER VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/save':
            try:
                data = read_request_data(self)

                # Autentimise kontroll - nõuab vähemalt 'editor' õigusi
                user = require_auth_handler(self, data, min_role='editor')
                if not user:
                    return

                print(f"SAVE: Kasutaja '{user['username']}' ({user['role']})")

                # Andmed frontendist
                text_content = data.get('text_content')
                meta_content = data.get('meta_content')
                original_catalog = data.get('original_path')
                target_filename = data.get('file_name')

                if not original_catalog or not target_filename:
                    self.send_error(400, "Puudub 'original_path' või 'file_name'")
                    return

                # Turvalisuse huvides võtame ainult failinime, mitte teekonda
                safe_catalog = os.path.basename(original_catalog)
                safe_filename = os.path.basename(target_filename)

                txt_path = os.path.join(BASE_DIR, safe_catalog, safe_filename)

                # Kui faili ei leita otse, proovime ilma kataloogita
                if not os.path.exists(os.path.dirname(txt_path)):
                     print(f"Hoiatus: Kausta {os.path.dirname(txt_path)} ei leitud.")

                # Valmista ette lisafailid (JSON metaandmed)
                additional_files = []
                json_saved = False
                if meta_content:
                    base_name = os.path.splitext(safe_filename)[0]
                    json_filename = base_name + ".json"
                    json_path = os.path.join(BASE_DIR, safe_catalog, json_filename)
                    json_content = json.dumps(meta_content, indent=2, ensure_ascii=False)
                    additional_files.append((json_path, json_content))
                    json_saved = True

                # Salvestame failid ja teeme Git commiti
                git_result = save_with_git(
                    filepath=txt_path,
                    content=text_content,
                    username=user['username'],
                    additional_files=additional_files if additional_files else None
                )

                if git_result.get("success"):
                    print(f"Salvestatud (Git): {txt_path} + {len(additional_files)} lisafaili -> {git_result.get('commit_hash', '')[:8]}")
                else:
                    print(f"Git commit ebaõnnestus: {git_result.get('error')}")
                    # Fallback: salvestame failid ilma Gitita
                    with open(txt_path, 'w', encoding='utf-8') as f:
                        f.write(text_content)
                    os.chmod(txt_path, 0o644)
                    for add_path, add_content in additional_files:
                        with open(add_path, 'w', encoding='utf-8') as f:
                            f.write(add_content)
                        os.chmod(add_path, 0o644)
                    print(f"Salvestatud (ilma Gitita): {txt_path}")

                # Sünkrooni Meilisearchiga TAUSTAL (kasutaja ei oota)
                sync_work_to_meilisearch_async(safe_catalog)

                response = {
                    "status": "success",
                    "commit_hash": git_result.get("commit_hash", "")[:8] if git_result.get("success") else None,
                    "is_first_commit": git_result.get("is_first_commit", False),
                    "json_created": json_saved
                }
                if not git_result.get("success"):
                    response["warning"] = "Fail salvestatud, aga versiooniajalukku ei jõudnud (git commit ebaõnnestus)"

                send_json_response(self, 200, response)

            except Exception as e:
                print(f"VIGA SERVERIS: {e}")
                self.send_error(500, str(e))

        elif self.path == '/update-work-metadata':
            # Teose üldiste metaandmete (_metadata.json) uuendamine
            try:
                data = read_request_data(self)

                # Autentimise kontroll - ainult admin saab muuta üldisi metaandmeid
                user = require_auth_handler(self, data, min_role='admin')
                if not user:
                    return

                original_catalog = data.get('original_path')
                work_id = data.get('work_id')
                new_metadata = data.get('metadata')  # Sõnastik uute andmetega

                if (not original_catalog and not work_id) or not new_metadata:
                    send_json_response(self, 400, {"status": "error", "message": "Puudub 'original_path'/'work_id' või 'metadata'"})
                    return

                if original_catalog:
                    safe_catalog = os.path.basename(original_catalog)
                    metadata_path = os.path.join(BASE_DIR, safe_catalog, '_metadata.json')
                else:
                    # Fallback: otsime kausta ID järgi
                    found_path = find_directory_by_id(work_id)
                    if not found_path:
                        raise Exception(f"Ei leidnud kausta ID-ga: {work_id}")
                    metadata_path = os.path.join(found_path, '_metadata.json')

                # Loeme olemasoleva faili, uuendame ja salvestame Gitiga
                with metadata_lock:
                    current_meta = {}
                    if os.path.exists(metadata_path):
                        with open(metadata_path, 'r', encoding='utf-8') as f:
                            current_meta = json.load(f)

                    # Uuendame andmed
                    current_meta.update(new_metadata)

                    # Salvestame Gitiga
                    json_content = json.dumps(current_meta, indent=2, ensure_ascii=False)
                    git_result = save_with_git(
                        filepath=metadata_path,
                        content=json_content,
                        username=user['username'],
                        message=f"Metaandmed: {os.path.basename(os.path.dirname(metadata_path))}"
                    )

                if git_result.get("success"):
                    print(f"Admin '{user['username']}' uuendas metaandmeid (Git): {metadata_path} -> {git_result.get('commit_hash', '')[:8]}")
                else:
                    print(f"Admin '{user['username']}' uuendas metaandmeid (Git ebaõnnestus): {metadata_path}")

                # Automaatne isikute nimede rikastamine taustal
                creators = current_meta.get('creators', [])
                if creators:
                    process_creators_metadata(creators)

                # Sünkrooni Meilisearchiga ENNE vastuse saatmist
                dir_name = os.path.basename(os.path.dirname(metadata_path))
                sync_ok = sync_work_to_meilisearch(dir_name)

                # Invalideerime suggestions cache, kuna metaandmed muutusid
                invalidate_cache()

                if sync_ok:
                    send_json_response(self, 200, {"status": "success", "message": "Metaandmed salvestatud"})
                else:
                    send_json_response(self, 200, {"status": "success", "message": "Metaandmed salvestatud (otsinguindeksi uuendamine ebaõnnestus)"})

            except Exception as e:
                print(f"METADATA UPDATE VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/get-work-metadata':
            # Tagastab teose _metadata.json sisu otse failisüsteemist
            try:
                data = read_request_data(self)

                # Nõuab vähemalt editori õigusi
                user = require_auth_handler(self, data, min_role='editor')
                if not user:
                    return

                original_catalog = data.get('original_path')
                work_id = data.get('work_id')

                if not original_catalog and not work_id:
                    send_json_response(self, 400, {"status": "error", "message": "Puudub 'original_path' või 'work_id'"})
                    return

                if original_catalog:
                    safe_catalog = os.path.basename(original_catalog)
                    metadata_path = os.path.join(BASE_DIR, safe_catalog, '_metadata.json')
                else:
                    # Fallback: otsime kausta ID järgi
                    found_path = find_directory_by_id(work_id)
                    if not found_path:
                        metadata_path = ""
                    else:
                        metadata_path = os.path.join(found_path, '_metadata.json')

                metadata = {}
                if metadata_path and os.path.exists(metadata_path):
                    with open(metadata_path, 'r', encoding='utf-8') as f:
                        metadata = json.load(f)

                send_json_response(self, 200, {
                    "status": "success",
                    "metadata": metadata
                })

            except Exception as e:
                print(f"GET METADATA VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/get-metadata-suggestions':
            # Tagastab unikaalsed autorid, žanrid, kohad ja trükkalid soovitusteks (cache'itud)
            try:
                data = read_request_data(self)

                # Nõuab vähemalt editori õigusi
                user = require_auth_handler(self, data, min_role='editor')
                if not user:
                    return

                # Kasutaja eelistatud keel (vaikimisi 'et')
                preferred_lang = data.get('lang', 'et')
                if preferred_lang not in ('et', 'en'):
                    preferred_lang = 'et'

                # Kasuta cache'i
                suggestions = get_cached_suggestions(preferred_lang)

                send_json_response(self, 200, {
                    "status": "success",
                    **suggestions
                })

            except Exception as e:
                print(f"SUGGESTIONS VIGA: {e}")
                self.send_error(500, str(e))

        # =========================================================
        # GIT/BACKUP ENDPOINTID (vt server/git_handlers.py)
        # =========================================================

        elif self.path == '/backups':
            handle_backups(self)

        elif self.path == '/restore':
            handle_restore(self)

        elif self.path == '/git-history':
            handle_git_history(self)

        elif self.path == '/git-restore':
            handle_git_restore(self)

        elif self.path == '/git-diff':
            handle_git_diff(self)

        elif self.path == '/commit-diff':
            handle_commit_diff(self)

        # =========================================================
        # ADMIN ENDPOINTID (vt server/admin_handlers.py)
        # =========================================================

        elif self.path == '/admin/registrations':
            handle_admin_registrations(self)

        elif self.path == '/admin/registrations/approve':
            handle_admin_registrations_approve(self)

        elif self.path == '/admin/registrations/reject':
            handle_admin_registrations_reject(self)

        elif self.path == '/admin/users':
            handle_admin_users(self)

        elif self.path == '/admin/users/update-role':
            handle_admin_users_update_role(self)

        elif self.path == '/admin/users/delete':
            handle_admin_users_delete(self)

        elif self.path == '/admin/git-failures':
            handle_admin_git_failures(self)

        elif self.path == '/admin/git-health':
            handle_admin_git_health(self)

        elif self.path == '/admin/people-refresh':
            handle_admin_people_refresh(self)
            invalidate_cache()  # People cache invalideerumine

        elif self.path == '/admin/people-refresh-status':
            handle_admin_people_refresh_status(self)

        elif self.path == '/invite/set-password':
            handle_invite_set_password(self)

        # =========================================================
        # PENDING-EDITS ENDPOINTID (vt server/pending_edits_handlers.py)
        # =========================================================

        elif self.path == '/save-pending':
            handle_save_pending(self)

        elif self.path == '/pending-edits':
            handle_pending_edits_list(self)

        elif self.path == '/pending-edits/check':
            handle_pending_edits_check(self)

        elif self.path == '/pending-edits/approve':
            handle_pending_edits_approve(self)

        elif self.path == '/pending-edits/reject':
            handle_pending_edits_reject(self)

        # =========================================================
        # BULK OPERATSIOONID (vt server/bulk_handlers.py)
        # =========================================================

        elif self.path == '/works/bulk-tags':
            handle_bulk_tags(self)
            invalidate_cache()  # Suggestions cache invalideerumine

        elif self.path == '/works/bulk-genre':
            handle_bulk_genre(self)
            invalidate_cache()

        elif self.path == '/works/bulk-collection':
            handle_bulk_collection(self)
            invalidate_cache()

        else:
            self.send_error(404)


# =========================================================
# SERVERI KÄIVITAMINE
# =========================================================

class SafeThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """ThreadingHTTPServer parema exception handlinguga.

    - daemon_threads=True tagab, et server sulgub korrektselt
    - handle_error logib vead ilma serverit crashimata
    """
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        """Logib vea ilma serverit crashimata."""
        import traceback
        print(f"[ERROR] Viga päringu töötlemisel kliendilt {client_address}:")
        traceback.print_exc()


if __name__ == '__main__':
    print(f"VUTT Failiserver API käivitus pordil {PORT}.")
    print(f"Jälgitav juurkaust: {BASE_DIR}")
    print(f"Kasutab mooduleid: server/")

    # Ehita Work ID cache kiiremaks failide leidmiseks
    build_work_id_cache()

    # Kontrolli git repo terviklikkust stardil
    print("Git repo terviklikkuse kontroll...")
    fsck_result = run_git_fsck()
    if fsck_result["ok"]:
        print("Git repo terviklikkus: OK")
    else:
        print(f"HOIATUS: Git repo terviklikkuse kontroll leidis vigu!")
        print(f"  Vead: {fsck_result['errors']}")

    # Käivita metaandmete jälgija taustalõimena
    watcher_thread = threading.Thread(target=metadata_watcher_loop, daemon=True)
    watcher_thread.start()

    # Käivita isikute aliaste perioodiline uuendamine (24h tsükkel, algab 5 min pärast starti)
    people_thread = threading.Thread(target=people_refresh_loop, daemon=True)
    people_thread.start()

    # Kasutame SafeThreadingHTTPServer mitme päringu samaaegseks teenindamiseks
    server = SafeThreadingHTTPServer(('0.0.0.0', PORT), RequestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer peatatud.")
    server.server_close()
