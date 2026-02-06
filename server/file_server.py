#!/usr/bin/env python3
"""
VUTT failiserver - refaktoreeritud versioon.
Kasutab server/ mooduleid abifunktsioonide jaoks.
"""
import http.server
import json
import os
import glob
import shutil
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
    sessions, verify_user, create_session, require_token,
    get_all_users, update_user_role, delete_user,
    # Registreerimine
    add_registration, load_pending_registrations, get_registration_by_id,
    update_registration_status, create_invite_token, validate_invite_token,
    create_user_from_invite,
    # Pending edits (HTTP handlerid)
    handle_save_pending, handle_pending_edits_list,
    handle_pending_edits_check, handle_pending_edits_approve,
    handle_pending_edits_reject,
    # Git
    save_with_git, get_file_git_history, get_file_at_commit, get_file_diff,
    get_commit_diff, get_recent_commits,
    # Meilisearch
    sync_work_to_meilisearch, sync_work_to_meilisearch_async, metadata_watcher_loop,
    # People/Authors
    process_creators_metadata,
    # Utils
    atomic_write_json,
    sanitize_id, find_directory_by_id, generate_default_metadata,
    normalize_genre, calculate_work_status, build_work_id_cache
)

# Lukud failioperatsioonide jaoks (race condition'ide vältimine)
metadata_lock = threading.RLock()  # _metadata.json operatsioonid
page_json_lock = threading.RLock()  # Lehekülje .json failide operatsioonid

# =========================================================
# CACHE: Collections ja Vocabularies
# Loetakse serveri stardil, taaslaaditakse perioodiliselt
# =========================================================
_cache_lock = threading.RLock()  # RLock lubab sama lõime poolt korduvat lukustamist
_collections_cache = None
_vocabularies_cache = None
_cache_loaded_at = None
CACHE_TTL_SECONDS = 300  # 5 minutit


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
    with _cache_lock:
        _collections_cache = None
        _vocabularies_cache = None
        _cache_loaded_at = None


# Lae cache serveri stardil
with _cache_lock:
    _load_cache_internal()


class RequestHandler(http.server.SimpleHTTPRequestHandler):
    # TODO: Pärast kindla domeeni saamist piirata CORS lubatud domeenidele
    # Praegu '*' lubab päringuid igalt poolt (sisevõrgus OK, avalikus mitte)
    # Näide: allowed_origins = ['https://vutt.ut.ee', 'http://localhost:5173']

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

                self.send_response(200 if registration else 400)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                if registration:
                    response = {"status": "success", "message": "Taotlus esitatud", "id": registration["id"]}
                else:
                    response = {"status": "error", "message": error}

                self.wfile.write(json.dumps(response).encode('utf-8'))

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
                
                # Koostame täistee: BASE_DIR / kataloog / failinimi
                # NB! Kontrolli, kas sinu struktuur on BASE_DIR/KATALOOG/FAIL või otse BASE_DIR/FAIL.
                # Eeldame siin, et 'original_path' on alamkaust BASE_DIR sees.
                txt_path = os.path.join(BASE_DIR, safe_catalog, safe_filename)
                
                # Kui faili ei leita otse, proovime ilma kataloogita (juhuks kui struktuur on lame)
                if not os.path.exists(os.path.dirname(txt_path)):
                     print(f"Hoiatus: Kausta {os.path.dirname(txt_path)} ei leitud.")
                
                # Loome kausta kui vaja (valikuline, sõltub kas tahad uusi faile luua)
                # os.makedirs(os.path.dirname(txt_path), exist_ok=True)

                # -------------------------------------------------
                # FAILIDE SALVESTAMINE (.txt + .json) - GIT VERSIOONIHALDUS
                # -------------------------------------------------

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

                # VASTUS
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                response = {
                    "status": "success",
                    "commit_hash": git_result.get("commit_hash", "")[:8] if git_result.get("success") else None,
                    "is_first_commit": git_result.get("is_first_commit", False),
                    "json_created": json_saved
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
            except Exception as e:
                print(f"VIGA SERVERIS: {e}")
                self.send_error(500, str(e))
        elif self.path == '/backups':
            # Varukoopiate loetelu päring
            try:
                data = read_request_data(self)
                
                # Autentimise kontroll - nõuab vähemalt 'admin' õigusi
                user = require_auth_handler(self, data, min_role='admin')
                if not user:
                    return
                
                original_catalog = data.get('original_path')
                target_filename = data.get('file_name')
                
                if not original_catalog or not target_filename:
                    self.send_error(400, "Puudub 'original_path' või 'file_name'")
                    return
                
                safe_catalog = os.path.basename(original_catalog)
                safe_filename = os.path.basename(target_filename)
                txt_path = os.path.join(BASE_DIR, safe_catalog, safe_filename)
                
                # Leiame kõik varukoopiad
                backups = sorted(glob.glob(f"{txt_path}.backup.*"), reverse=True)
                
                backup_list = []
                original_backup_path = f"{txt_path}.backup.ORIGINAL"
                has_original_backup = os.path.exists(original_backup_path)
                
                for backup_path in backups:
                    # ORIGINAL käsitleme eraldi lõpus
                    if backup_path.endswith('.backup.ORIGINAL'):
                        continue
                        
                    # Eraldame timestampi failinimest
                    parts = backup_path.rsplit('.backup.', 1)
                    if len(parts) == 2:
                        timestamp_str = parts[1]
                        try:
                            dt = datetime.strptime(timestamp_str, "%Y%m%d_%H%M%S")
                            backup_list.append({
                                "filename": os.path.basename(backup_path),
                                "timestamp": timestamp_str,
                                "formatted_date": dt.strftime("%d.%m.%Y %H:%M:%S"),
                                "is_original": False
                            })
                        except ValueError:
                            pass
                
                # Originaali käsitlemine - nüüd kasutame .backup.ORIGINAL faili
                if has_original_backup:
                    # .backup.ORIGINAL on olemas - see on tõeline originaal
                    file_mtime = os.path.getmtime(original_backup_path)
                    file_dt = datetime.fromtimestamp(file_mtime)
                    backup_list.append({
                        "filename": os.path.basename(original_backup_path),
                        "timestamp": "ORIGINAL",
                        "formatted_date": f"Originaal (OCR) - {file_dt.strftime('%d.%m.%Y')}",
                        "is_original": True
                    })
                elif os.path.exists(txt_path) and not backup_list:
                    # Pole ühtegi backupi - praegune .txt ON originaal (pole veel muudetud)
                    file_mtime = os.path.getmtime(txt_path)
                    file_dt = datetime.fromtimestamp(file_mtime)
                    backup_list.append({
                        "filename": safe_filename,
                        "timestamp": "original",
                        "formatted_date": f"Originaal (OCR) - {file_dt.strftime('%d.%m.%Y')}",
                        "is_original": True
                    })
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()
                
                response = {
                    "status": "success",
                    "backups": backup_list,
                    "total": len(backup_list)
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
            except Exception as e:
                print(f"BACKUPS VIGA: {e}")
                self.send_error(500, str(e))
                
        elif self.path == '/restore':
            # Varukoopia taastamine
            try:
                data = read_request_data(self)
                
                # Autentimise kontroll - nõuab 'admin' õigusi (serveripoolne kontroll!)
                user = require_auth_handler(self, data, min_role='admin')
                if not user:
                    return
                
                original_catalog = data.get('original_path')
                target_filename = data.get('file_name')
                backup_filename = data.get('backup_filename')
                
                # Turvakontroll: backup_filename peab olema ainult failinimi
                backup_filename = os.path.basename(backup_filename) if backup_filename else ''
                
                if not original_catalog or not target_filename or not backup_filename:
                    self.send_error(400, "Puudub 'original_path', 'file_name' või 'backup_filename'")
                    return
                
                safe_catalog = os.path.basename(original_catalog)
                safe_filename = os.path.basename(target_filename)
                txt_path = os.path.join(BASE_DIR, safe_catalog, safe_filename)
                
                # Kui backup_filename on sama mis safe_filename, siis tahetakse taastada originaali
                # (st praegust .txt faili, mitte .backup.* faili)
                if backup_filename == safe_filename:
                    # Originaali taastamine - lihtsalt loeme praeguse faili sisu
                    if not os.path.exists(txt_path):
                        self.send_response(404)
                        self.send_header('Content-type', 'application/json')
                        send_cors_headers(self)
                        self.end_headers()
                        response = {"status": "error", "message": "Originaalfaili ei leitud"}
                        self.wfile.write(json.dumps(response).encode('utf-8'))
                        return
                    backup_path = txt_path
                else:
                    backup_path = os.path.join(BASE_DIR, safe_catalog, backup_filename)
                
                # Kontrollime, et backup fail eksisteerib
                if not os.path.exists(backup_path):
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    response = {"status": "error", "message": "Varukoopiat ei leitud"}
                    self.wfile.write(json.dumps(response).encode('utf-8'))
                    return
                
                # NB: Originaali SAAB taastada, lihtsalt ei kustutata seda kunagi
                
                # Loeme taastamise faili sisu
                with open(backup_path, 'r', encoding='utf-8') as f:
                    restored_content = f.read()
                
                # Teeme praegusest versioonist varukoopia enne taastamist
                if os.path.exists(txt_path):
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    pre_restore_backup = f"{txt_path}.backup.{timestamp}"
                    shutil.copy2(txt_path, pre_restore_backup)
                    print(f"Loodud varukoopia enne taastamist: {pre_restore_backup}")
                
                # Kirjutame taastatud sisu
                with open(txt_path, 'w', encoding='utf-8') as f:
                    f.write(restored_content)
                os.chmod(txt_path, 0o644)

                print(f"Taastatud versioon: {backup_filename} -> {safe_filename}")
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()
                
                response = {
                    "status": "success",
                    "message": "Versioon taastatud",
                    "restored_content": restored_content
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
            except Exception as e:
                print(f"RESTORE VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/git-history':
            # Git ajaloo päring - kõik sisselogitud kasutajad näevad ajalugu
            try:
                data = read_request_data(self)

                # Autentimise kontroll - kõik sisselogitud kasutajad
                user = require_auth_handler(self, data, min_role='editor')
                if not user:
                    return

                original_catalog = data.get('original_path')
                target_filename = data.get('file_name')

                if not original_catalog or not target_filename:
                    self.send_error(400, "Puudub 'original_path' või 'file_name'")
                    return

                safe_catalog = os.path.basename(original_catalog)
                safe_filename = os.path.basename(target_filename)
                
                # Jälgi nii .txt kui .json faile
                txt_path = os.path.join(safe_catalog, safe_filename)
                json_filename = os.path.splitext(safe_filename)[0] + '.json'
                json_path = os.path.join(safe_catalog, json_filename)
                
                files_to_check = [txt_path, json_path]

                # Küsime Git ajaloo mõlema faili jaoks
                history = get_file_git_history(files_to_check, max_count=50)

                send_json_response(self, 200, {
                    "status": "success",
                    "history": history,
                    "total": len(history)
                })

            except Exception as e:
                print(f"GIT-HISTORY VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/git-restore':
            # Git versiooni taastamine
            try:
                data = read_request_data(self)

                # Autentimise kontroll - nõuab 'admin' õigusi
                user = require_auth_handler(self, data, min_role='admin')
                if not user:
                    return

                original_catalog = data.get('original_path')
                target_filename = data.get('file_name')
                commit_hash = data.get('commit_hash')

                if not original_catalog or not target_filename or not commit_hash:
                    self.send_error(400, "Puudub 'original_path', 'file_name' või 'commit_hash'")
                    return

                safe_catalog = os.path.basename(original_catalog)
                safe_filename = os.path.basename(target_filename)
                relative_path = os.path.join(safe_catalog, safe_filename)

                # Loe faili sisu kindlast commitist
                restored_content = get_file_at_commit(relative_path, commit_hash)

                if restored_content is None:
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    response = {"status": "error", "message": "Versiooni ei leitud"}
                    self.wfile.write(json.dumps(response).encode('utf-8'))
                    return

                print(f"Git restore: {commit_hash[:8]} -> {relative_path} (kasutaja: {user['username']})")

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                response = {
                    "status": "success",
                    "message": "Versioon laaditud",
                    "restored_content": restored_content,
                    "from_commit": commit_hash
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))

            except Exception as e:
                print(f"GIT-RESTORE VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/git-diff':
            # Git diff kahe commiti vahel
            try:
                data = read_request_data(self)

                # Autentimise kontroll - nõuab 'admin' õigusi
                user = require_auth_handler(self, data, min_role='admin')
                if not user:
                    return

                original_catalog = data.get('original_path')
                target_filename = data.get('file_name')
                hash1 = data.get('hash1')
                hash2 = data.get('hash2')

                if not original_catalog or not target_filename or not hash1 or not hash2:
                    self.send_error(400, "Puudub 'original_path', 'file_name', 'hash1' või 'hash2'")
                    return

                safe_catalog = os.path.basename(original_catalog)
                safe_filename = os.path.basename(target_filename)
                relative_path = os.path.join(safe_catalog, safe_filename)

                # Genereeri diff
                diff = get_file_diff(relative_path, hash1, hash2)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                response = {
                    "status": "success",
                    "diff": diff or "",
                    "hash1": hash1,
                    "hash2": hash2
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))

            except Exception as e:
                print(f"GIT-DIFF VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/commit-diff':
            # Ühe commiti diff (võrreldes parent commitiga)
            try:
                data = read_request_data(self)

                # Autentimise kontroll - kõik sisselogitud kasutajad näevad
                user = require_auth_handler(self, data, min_role='viewer')
                if not user:
                    return

                commit_hash = data.get('commit_hash')
                filepath = data.get('filepath')  # Valikuline

                if not commit_hash:
                    self.send_error(400, "Puudub 'commit_hash'")
                    return
                
                # Kui filepath on antud, arvuta ka json fail
                filepaths = None
                if filepath:
                    if filepath.endswith('.txt'):
                        json_path = filepath.rsplit('.', 1)[0] + '.json'
                        filepaths = [filepath, json_path]
                    else:
                        filepaths = [filepath]

                # Hangi diff (toetab nüüd listi)
                result = get_commit_diff(commit_hash, filepaths)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                if result:
                    response = {
                        "status": "success",
                        "diff": result["diff"],
                        "additions": result["additions"],
                        "deletions": result["deletions"],
                        "files": result["files"]
                    }
                else:
                    response = {
                        "status": "error",
                        "message": "Diff'i ei leitud"
                    }
                self.wfile.write(json.dumps(response).encode('utf-8'))

            except Exception as e:
                print(f"COMMIT-DIFF VIGA: {e}")
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

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                if sync_ok:
                    self.wfile.write(json.dumps({"status": "success", "message": "Metaandmed salvestatud"}).encode('utf-8'))
                else:
                    # Fail salvestati, aga Meilisearch sync ebaõnnestus
                    self.wfile.write(json.dumps({"status": "success", "message": "Metaandmed salvestatud (otsinguindeksi uuendamine ebaõnnestus)"}).encode('utf-8'))
                
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
                        # Kui ei leia, tagastame tühja objekti (mitte vea), et UI ei jookseks kokku
                        metadata_path = "" 
                    else:
                        metadata_path = os.path.join(found_path, '_metadata.json')
                
                metadata = {}
                if metadata_path and os.path.exists(metadata_path):
                    with open(metadata_path, 'r', encoding='utf-8') as f:
                        metadata = json.load(f)
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()
                
                response = {
                    "status": "success",
                    "metadata": metadata
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
            except Exception as e:
                print(f"GET METADATA VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/get-metadata-suggestions':
            # Tagastab unikaalsed autorid, žanrid, kohad ja trükkalid soovitusteks koos ID-dega
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

                # Sõnastikud kujul: label.lower() -> { label: "Orig", id: "Q..." | None }
                # Eesmärk: Iga nime kohta hoida parimat teadmist (eelistatult ID-ga)
                # seen_ids: jälgib, millised Wikidata ID-d on juba lisatud (vältimaks duplikaate)
                authors = {}
                tags = {}
                places = {}
                printers = {}
                types = {}
                genres = {}
                seen_ids = {}  # id -> store_name, et jälgida duplikaate üle kõigi hoidlate

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
                            # Eelistatud keel esimesena
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
                
                # Vaikimisi väärtused (kui puuduvad, lisa ilma ID-ta, v.a kui tahame hardcodeda ID-sid)
                defaults_places = ['Tartu', 'Pärnu']
                for p in defaults_places:
                    if p.lower() not in places: places[p.lower()] = {'label': p, 'id': None}
                
                # Vorminda vastus listiks, sorteeri nime järgi
                def to_sorted_list(store):
                    return sorted(list(store.values()), key=lambda x: x['label'])

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()
                
                response = {
                    "status": "success",
                    "authors": to_sorted_list(authors),
                    "tags": to_sorted_list(tags),
                    "places": to_sorted_list(places),
                    "printers": to_sorted_list(printers),
                    "types": to_sorted_list(types),
                    "genres": to_sorted_list(genres)
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
            except Exception as e:
                print(f"SUGGESTIONS VIGA: {e}")
                self.send_error(500, str(e))

        # =========================================================
        # ADMIN REGISTREERINGUTE ENDPOINTID
        # =========================================================

        elif self.path == '/admin/registrations':
            # Tagastab ootel registreerimistaotlused (admin)
            try:
                data = read_request_data(self)

                user = require_auth_handler(self, data, min_role='admin')
                if not user:
                    return

                reg_data = load_pending_registrations()

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                response = {
                    "status": "success",
                    "registrations": reg_data["registrations"]
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))

            except Exception as e:
                print(f"ADMIN REGISTRATIONS VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/admin/registrations/approve':
            # Kinnitab registreerimistaotluse ja loob invite tokeni (admin)
            try:
                data = read_request_data(self)

                user = require_auth_handler(self, data, min_role='admin')
                if not user:
                    return

                reg_id = data.get('registration_id')
                if not reg_id:
                    send_json_response(self, 400, {"status": "error", "message": "registration_id puudub"})
                    return

                # Leia taotlus
                reg = get_registration_by_id(reg_id)
                if not reg:
                    send_json_response(self, 404, {"status": "error", "message": "Taotlust ei leitud"})
                    return

                if reg["status"] != "pending":
                    send_json_response(self, 400, {"status": "error", "message": "Taotlus on juba käsitletud"})
                    return

                # Uuenda staatus
                update_registration_status(reg_id, "approved", user["username"])

                # Loo invite token
                token_data = create_invite_token(reg["email"], reg["name"], user["username"])

                # Genereeri link (kasutaja peab selle käsitsi saatma)
                invite_url = f"/set-password?token={token_data['token']}"

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                response = {
                    "status": "success",
                    "message": "Taotlus kinnitatud",
                    "invite_url": invite_url,
                    "invite_token": token_data["token"],
                    "expires_at": token_data["expires_at"],
                    "email": reg["email"],
                    "name": reg["name"]
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))

                print(f"Admin {user['username']} kinnitas taotluse: {reg['name']} ({reg['email']})")

            except Exception as e:
                print(f"APPROVE REGISTRATION VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/admin/registrations/reject':
            # Lükkab registreerimistaotluse tagasi (admin)
            try:
                data = read_request_data(self)

                user = require_auth_handler(self, data, min_role='admin')
                if not user:
                    return

                reg_id = data.get('registration_id')
                if not reg_id:
                    send_json_response(self, 400, {"status": "error", "message": "registration_id puudub"})
                    return

                reg = get_registration_by_id(reg_id)
                if not reg:
                    send_json_response(self, 404, {"status": "error", "message": "Taotlust ei leitud"})
                    return

                if reg["status"] != "pending":
                    send_json_response(self, 400, {"status": "error", "message": "Taotlus on juba käsitletud"})
                    return

                # Uuenda staatus
                update_registration_status(reg_id, "rejected", user["username"])

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                response = {
                    "status": "success",
                    "message": "Taotlus tagasi lükatud"
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))

                print(f"Admin {user['username']} lükkas tagasi taotluse: {reg['name']} ({reg['email']})")

            except Exception as e:
                print(f"REJECT REGISTRATION VIGA: {e}")
                self.send_error(500, str(e))

        # =========================================================
        # KASUTAJATE HALDUSE ENDPOINTID
        # =========================================================

        elif self.path == '/admin/users':
            # Tagastab kõigi kasutajate nimekirja (admin)
            try:
                data = read_request_data(self)

                user = require_auth_handler(self, data, min_role='admin')
                if not user:
                    return

                users = get_all_users()

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                response = {
                    "status": "success",
                    "users": users
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))

            except Exception as e:
                print(f"ADMIN USERS VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/admin/users/update-role':
            # Muudab kasutaja rolli (admin)
            try:
                data = read_request_data(self)

                user = require_auth_handler(self, data, min_role='admin')
                if not user:
                    return

                username = data.get('username')
                new_role = data.get('new_role')

                if not username or not new_role:
                    send_json_response(self, 400, {"status": "error", "message": "username ja new_role on kohustuslikud"})
                    return

                success, message = update_user_role(username, new_role, user)

                self.send_response(200 if success else 400)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                response = {
                    "status": "success" if success else "error",
                    "message": message
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))

            except Exception as e:
                print(f"UPDATE USER ROLE VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/admin/users/delete':
            # Kustutab kasutaja (admin)
            try:
                data = read_request_data(self)

                user = require_auth_handler(self, data, min_role='admin')
                if not user:
                    return

                username = data.get('username')

                if not username:
                    send_json_response(self, 400, {"status": "error", "message": "username on kohustuslik"})
                    return

                success, message = delete_user(username, user)

                self.send_response(200 if success else 400)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                response = {
                    "status": "success" if success else "error",
                    "message": message
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))

            except Exception as e:
                print(f"DELETE USER VIGA: {e}")
                self.send_error(500, str(e))

        # =========================================================
        # PAROOLI SEADMISE ENDPOINT
        # =========================================================

        elif self.path == '/invite/set-password':
            # Seab parooli invite tokeni abil (avalik)
            try:
                # Rate limit kontroll
                client_ip = get_client_ip(self)
                allowed, retry_after = check_rate_limit(client_ip, '/invite/set-password')
                if not allowed:
                    print(f"RATE LIMIT: /invite/set-password blokeeritud IP-le {client_ip}")
                    rate_limit_response(self, retry_after)
                    return

                data = read_request_data(self)

                token = data.get('token', '').strip()
                password = data.get('password', '')

                if not token:
                    send_json_response(self, 400, {"status": "error", "message": "Token puudub"})
                    return

                if not password or len(password) < 12:
                    send_json_response(self, 400, {"status": "error", "message": "Parool peab olema vähemalt 12 tähemärki"})
                    return

                # Lihtsa parooli kontroll
                if len(set(password)) < 4:  # Liiga vähe erinevaid tähemärke
                    send_json_response(self, 400, {"status": "error", "message": "Parool on liiga lihtne - kasuta rohkem erinevaid tähemärke"})
                    return

                # Keela numbrijadad, korduvad mustrid ja näidisparoolid
                simple_patterns = [
                    '123456789012', '111111111111', 'aaaaaaaaaaaa', 'password1234', 'qwertyuiop12',
                    'minukassarmastabkala', 'mycatloveseatingfish'  # Näidisparoolid vihjest
                ]
                if password.lower() in simple_patterns or password == password[0] * len(password):
                    send_json_response(self, 400, {"status": "error", "message": "Parool on liiga lihtne - vali tugevam parool"})
                    return

                # Loo kasutaja
                new_user, error = create_user_from_invite(token, password)

                self.send_response(200 if new_user else 400)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                if new_user:
                    response = {
                        "status": "success",
                        "message": "Kasutaja loodud",
                        "username": new_user["username"],
                        "name": new_user["name"]
                    }
                else:
                    response = {
                        "status": "error",
                        "message": error
                    }

                self.wfile.write(json.dumps(response).encode('utf-8'))

            except Exception as e:
                print(f"SET PASSWORD VIGA: {e}")
                self.send_error(500, str(e))

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
        # MASSILISED METAANDMETE UUENDUSED (admin)
        # =========================================================

        elif self.path == '/works/bulk-tags':
            # Määrab märksõnad mitmele teosele korraga (ainult admin)
            try:
                data = read_request_data(self)

                user = require_auth_handler(self, data, min_role='admin')
                if not user:
                    return

                work_ids = data.get('work_ids', [])
                tags = data.get('tags', [])  # LinkedEntity objektide list
                mode = data.get('mode', 'add')  # 'add' või 'replace'

                if not work_ids:
                    send_json_response(self, 400, {"status": "error", "message": "work_ids on kohustuslik"})
                    return

                if not tags and mode == 'replace':
                    # Replace tühja listiga = eemalda kõik märksõnad
                    pass
                elif not tags:
                    send_json_response(self, 400, {"status": "error", "message": "tags on kohustuslik"})
                    return

                updated = 0
                failed = []

                for work_id in work_ids:
                    try:
                        dir_path = find_directory_by_id(work_id)
                        if not dir_path:
                            failed.append({"id": work_id, "error": "Kausta ei leitud"})
                            continue

                        metadata_path = os.path.join(dir_path, '_metadata.json')

                        with metadata_lock:
                            current_meta = {}
                            if os.path.exists(metadata_path):
                                with open(metadata_path, 'r', encoding='utf-8') as f:
                                    current_meta = json.load(f)

                            if mode == 'replace':
                                # Asenda kõik märksõnad
                                current_meta['tags'] = tags
                            else:
                                # Lisa olemasolevatele (väldi duplikaate ID või labeli järgi)
                                existing_tags = current_meta.get('tags', [])
                                existing_ids = set()
                                existing_labels = set()
                                for t in existing_tags:
                                    if isinstance(t, dict):
                                        if t.get('id'):
                                            existing_ids.add(t['id'])
                                        existing_labels.add(t.get('label', '').lower())
                                    elif isinstance(t, str):
                                        existing_labels.add(t.lower())

                                for new_tag in tags:
                                    tag_id = new_tag.get('id') if isinstance(new_tag, dict) else None
                                    tag_label = new_tag.get('label', '').lower() if isinstance(new_tag, dict) else str(new_tag).lower()

                                    if tag_id and tag_id in existing_ids:
                                        continue  # Sama ID juba olemas
                                    if tag_label in existing_labels:
                                        continue  # Sama label juba olemas

                                    existing_tags.append(new_tag)
                                    if tag_id:
                                        existing_ids.add(tag_id)
                                    existing_labels.add(tag_label)

                                current_meta['tags'] = existing_tags

                            json_content = json.dumps(current_meta, indent=2, ensure_ascii=False)
                            save_with_git(
                                filepath=metadata_path,
                                content=json_content,
                                username=user['username'],
                                message=f"Märksõnad: {os.path.basename(dir_path)}"
                            )

                        sync_work_to_meilisearch_async(os.path.basename(dir_path))
                        updated += 1

                    except Exception as e:
                        failed.append({"id": work_id, "error": str(e)})

                tag_labels = ', '.join([t.get('label', str(t)) if isinstance(t, dict) else str(t) for t in tags[:3]])
                if len(tags) > 3:
                    tag_labels += f" (+{len(tags) - 3})"
                print(f"Admin '{user['username']}' määras märksõnad [{tag_labels}] ({mode}) {updated} teosele")

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                response = {
                    "status": "success",
                    "message": f"Uuendatud {updated} teost",
                    "updated": updated,
                    "failed": failed
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))

            except Exception as e:
                print(f"BULK-TAGS VIGA: {e}")
                import traceback
                traceback.print_exc()
                self.send_error(500, str(e))

        elif self.path == '/works/bulk-genre':
            # Määrab žanri mitmele teosele korraga (ainult admin)
            try:
                data = read_request_data(self)

                user = require_auth_handler(self, data, min_role='admin')
                if not user:
                    return

                work_ids = data.get('work_ids', [])
                genre = data.get('genre')  # LinkedEntity objekt või null

                if not work_ids:
                    send_json_response(self, 400, {"status": "error", "message": "work_ids on kohustuslik"})
                    return

                updated = 0
                failed = []

                for work_id in work_ids:
                    try:
                        dir_path = find_directory_by_id(work_id)
                        if not dir_path:
                            failed.append({"id": work_id, "error": "Kausta ei leitud"})
                            continue

                        metadata_path = os.path.join(dir_path, '_metadata.json')

                        with metadata_lock:
                            current_meta = {}
                            if os.path.exists(metadata_path):
                                with open(metadata_path, 'r', encoding='utf-8') as f:
                                    current_meta = json.load(f)

                            # Uuenda žanri väli (võib olla null)
                            current_meta['genre'] = genre

                            json_content = json.dumps(current_meta, indent=2, ensure_ascii=False)
                            save_with_git(
                                filepath=metadata_path,
                                content=json_content,
                                username=user['username'],
                                message=f"Žanr: {os.path.basename(dir_path)}"
                            )

                        sync_work_to_meilisearch_async(os.path.basename(dir_path))
                        updated += 1

                    except Exception as e:
                        failed.append({"id": work_id, "error": str(e)})

                genre_label = genre.get('label', str(genre)) if isinstance(genre, dict) else str(genre) if genre else 'eemaldatud'
                print(f"Admin '{user['username']}' määras žanri '{genre_label}' {updated} teosele")

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                response = {
                    "status": "success",
                    "message": f"Uuendatud {updated} teost",
                    "updated": updated,
                    "failed": failed
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))

            except Exception as e:
                print(f"BULK-GENRE VIGA: {e}")
                import traceback
                traceback.print_exc()
                self.send_error(500, str(e))

        elif self.path == '/works/bulk-collection':
            # Määrab kollektsiooni mitmele teosele korraga (ainult admin)
            try:
                data = read_request_data(self)

                user = require_auth_handler(self, data, min_role='admin')
                if not user:
                    return

                work_ids = data.get('work_ids', [])
                collection = data.get('collection')  # None = eemalda kollektsioon

                if not work_ids:
                    send_json_response(self, 400, {"status": "error", "message": "work_ids on kohustuslik"})
                    return

                # Valideeri kollektsioon (kui pole None/null)
                if collection:
                    collections_data = {}
                    if os.path.exists(COLLECTIONS_FILE):
                        with open(COLLECTIONS_FILE, 'r', encoding='utf-8') as f:
                            collections_data = json.load(f)
                    if collection not in collections_data:
                        self.send_response(400)
                        self.send_header('Content-type', 'application/json')
                        send_cors_headers(self)
                        self.end_headers()
                        self.wfile.write(json.dumps({"status": "error", "message": f"Kollektsiooni '{collection}' ei leitud"}).encode('utf-8'))
                        return

                updated = 0
                failed = []

                for work_id in work_ids:
                    try:
                        # Leia kaust ID järgi
                        dir_path = find_directory_by_id(work_id)
                        if not dir_path:
                            failed.append({"id": work_id, "error": "Kausta ei leitud"})
                            continue

                        metadata_path = os.path.join(dir_path, '_metadata.json')

                        # Loe olemasolev metadata ja salvesta Gitiga
                        with metadata_lock:
                            current_meta = {}
                            if os.path.exists(metadata_path):
                                with open(metadata_path, 'r', encoding='utf-8') as f:
                                    current_meta = json.load(f)

                            # Uuenda collection väli
                            current_meta['collection'] = collection

                            # Salvesta Gitiga
                            json_content = json.dumps(current_meta, indent=2, ensure_ascii=False)
                            save_with_git(
                                filepath=metadata_path,
                                content=json_content,
                                username=user['username'],
                                message=f"Kollektsioon: {os.path.basename(dir_path)}"
                            )

                        # Sünkrooni Meilisearchiga (taustal)
                        sync_work_to_meilisearch_async(os.path.basename(dir_path))

                        updated += 1

                    except Exception as e:
                        failed.append({"id": work_id, "error": str(e)})

                print(f"Admin '{user['username']}' määras kollektsiooni '{collection}' {updated} teosele")

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                response = {
                    "status": "success",
                    "message": f"Uuendatud {updated} teost",
                    "updated": updated,
                    "failed": failed
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))

            except Exception as e:
                print(f"BULK-COLLECTION VIGA: {e}")
                import traceback
                traceback.print_exc()
                self.send_error(500, str(e))

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

    # Käivita metaandmete jälgija taustalõimena
    watcher_thread = threading.Thread(target=metadata_watcher_loop, daemon=True)
    watcher_thread.start()

    # Kasutame SafeThreadingHTTPServer mitme päringu samaaegseks teenindamiseks
    server = SafeThreadingHTTPServer(('0.0.0.0', PORT), RequestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer peatatud.")
    server.server_close()
