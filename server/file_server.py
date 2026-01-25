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
    # Rate limiting
    get_client_ip, check_rate_limit, rate_limit_response,
    # Autentimine
    sessions, verify_user, create_session, require_token,
    get_all_users, update_user_role, delete_user,
    # Registreerimine
    add_registration, load_pending_registrations, get_registration_by_id,
    update_registration_status, create_invite_token, validate_invite_token,
    create_user_from_invite,
    # Pending edits
    load_pending_edits, create_pending_edit, get_pending_edit_by_id,
    get_pending_edits_for_page, get_user_pending_edit_for_page,
    update_pending_edit_status, check_base_text_conflict,
    # Git
    save_with_git, get_file_git_history, get_file_at_commit, get_file_diff,
    get_commit_diff, get_recent_commits,
    # Meilisearch
    sync_work_to_meilisearch, metadata_watcher_loop,
    # Utils
    sanitize_id, find_directory_by_id, generate_default_metadata,
    normalize_genre, calculate_work_status, build_work_id_cache
)

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
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Token puudub"}).encode('utf-8'))
                    return
                
                session = sessions.get(auth_token)
                if not session:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Kehtetu token"}).encode('utf-8'))
                    return
                
                current_user = session['user']
                is_admin = current_user.get('role') == 'admin'
                
                # Admin näeb kõiki, tavaline kasutaja ainult oma muudatusi
                filter_user = params.get('user', [None])[0]
                limit = int(params.get('limit', [30])[0])
                
                # Kui pole admin ja üritab teiste muudatusi vaadata
                if not is_admin and filter_user and filter_user != current_user.get('name'):
                    filter_user = current_user.get('name')
                
                # Kui pole admin ja ei ole filtrit, näita ainult oma muudatusi
                if not is_admin and not filter_user:
                    filter_user = current_user.get('name')
                
                # Hangi commitid
                commits = get_recent_commits(username=filter_user, limit=limit)
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()
                
                response = {
                    "status": "success",
                    "commits": commits,
                    "is_admin": is_admin,
                    "filtered_by": filter_user
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
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

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

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

                self.wfile.write(json.dumps(response).encode('utf-8'))

            except Exception as e:
                print(f"INVITE VALIDATE VIGA: {e}")
                self.send_error(500, str(e))

        # GET /collections - kollektsioonide puu (avalik)
        elif self.path == '/collections':
            try:
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                collections = {}
                if os.path.exists(COLLECTIONS_FILE):
                    with open(COLLECTIONS_FILE, 'r', encoding='utf-8') as f:
                        collections = json.load(f)

                response = {
                    "status": "success",
                    "collections": collections
                }
                self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))

            except Exception as e:
                print(f"COLLECTIONS VIGA: {e}")
                self.send_error(500, str(e))

        # GET /vocabularies - kontrollitud sõnavara (avalik)
        elif self.path == '/vocabularies':
            try:
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                vocabularies = {}
                if os.path.exists(VOCABULARIES_FILE):
                    with open(VOCABULARIES_FILE, 'r', encoding='utf-8') as f:
                        vocabularies = json.load(f)

                response = {
                    "status": "success",
                    "vocabularies": vocabularies
                }
                self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))

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

                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                username = data.get('username', '').strip()
                password = data.get('password', '')
                
                user = verify_user(username, password)
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()
                
                if user:
                    # Loome sessiooni ja tagastame tokeni
                    token = create_session(user)
                    response = {"status": "success", "user": user, "token": token}
                else:
                    response = {"status": "error", "message": "Vale kasutajanimi või parool"}
                
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
            except Exception as e:
                print(f"LOGIN VIGA: {e}")
                self.send_error(500, str(e))
        
        elif self.path == '/verify-token':
            # Tokeni kehtivuse kontroll (lehe laadimisel)
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                token = data.get('token', '').strip()

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                session = sessions.get(token)
                if session:
                    # Kontrolli sessiooni aegumist (24h)
                    created_at = datetime.fromisoformat(session["created_at"])
                    if datetime.now() - created_at > SESSION_DURATION:
                        del sessions[token]
                        response = {"status": "error", "valid": False, "message": "Sessioon aegunud (24h)"}
                    else:
                        response = {"status": "success", "user": session["user"], "valid": True}
                else:
                    response = {"status": "error", "valid": False, "message": "Token aegunud"}

                self.wfile.write(json.dumps(response).encode('utf-8'))

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

                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                name = data.get('name', '').strip()
                email = data.get('email', '').strip()
                affiliation = data.get('affiliation', '').strip() if data.get('affiliation') else None
                motivation = data.get('motivation', '').strip()

                # Valideerimine
                if not name:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Nimi on kohustuslik"}).encode('utf-8'))
                    return

                if not email or '@' not in email:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Kehtiv e-posti aadress on kohustuslik"}).encode('utf-8'))
                    return

                if not motivation:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Motivatsioon on kohustuslik"}).encode('utf-8'))
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
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)
                
                # Autentimise kontroll - nõuab vähemalt 'editor' õigusi
                user, auth_error = require_token(data, min_role='editor')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
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
                # 1. TEKSTIFAILI SALVESTAMINE (.txt) - GIT VERSIOONIHALDUS
                # -------------------------------------------------

                # Salvestame faili ja teeme Git commiti
                git_result = save_with_git(
                    filepath=txt_path,
                    content=text_content,
                    username=user['username']
                )

                if git_result.get("success"):
                    print(f"Salvestatud tekst (Git): {txt_path} -> {git_result.get('commit_hash', '')[:8]}")
                else:
                    print(f"Git commit ebaõnnestus: {git_result.get('error')}")
                    # Fallback: salvestame faili ilma Gitita
                    with open(txt_path, 'w', encoding='utf-8') as f:
                        f.write(text_content)
                    print(f"Salvestatud tekst (ilma Gitita): {txt_path}")
                
                # -------------------------------------------------
                # 2. METAANDMETE SALVESTAMINE (.json)
                # -------------------------------------------------
                json_saved = False
                if meta_content:
                    base_name = os.path.splitext(safe_filename)[0]
                    json_filename = base_name + ".json"
                    json_path = os.path.join(BASE_DIR, safe_catalog, json_filename)
                    
                    with open(json_path, 'w', encoding='utf-8') as f:
                        json.dump(meta_content, f, ensure_ascii=False, indent=2)
                    json_saved = True
                    print(f"Salvestatud JSON: {json_path}")

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
                
                # Sünkrooni Meilisearchiga (taustal või kohe, siin teeme kohe kuna on kiire)
                sync_work_to_meilisearch(safe_catalog)
                
            except Exception as e:
                print(f"VIGA SERVERIS: {e}")
                self.send_error(500, str(e))
        elif self.path == '/backups':
            # Varukoopiate loetelu päring
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)
                
                # Autentimise kontroll - nõuab vähemalt 'admin' õigusi
                user, auth_error = require_token(data, min_role='admin')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
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
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)
                
                # Autentimise kontroll - nõuab 'admin' õigusi (serveripoolne kontroll!)
                user, auth_error = require_token(data, min_role='admin')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
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
            # Git ajaloo päring (asendab /backups)
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                # Autentimise kontroll - nõuab vähemalt 'admin' õigusi
                user, auth_error = require_token(data, min_role='admin')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return

                original_catalog = data.get('original_path')
                target_filename = data.get('file_name')

                if not original_catalog or not target_filename:
                    self.send_error(400, "Puudub 'original_path' või 'file_name'")
                    return

                safe_catalog = os.path.basename(original_catalog)
                safe_filename = os.path.basename(target_filename)
                relative_path = os.path.join(safe_catalog, safe_filename)

                # Küsime Git ajaloo
                history = get_file_git_history(relative_path, max_count=50)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                response = {
                    "status": "success",
                    "history": history,
                    "total": len(history)
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))

            except Exception as e:
                print(f"GIT-HISTORY VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/git-restore':
            # Git versiooni taastamine
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                # Autentimise kontroll - nõuab 'admin' õigusi
                user, auth_error = require_token(data, min_role='admin')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
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
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                # Autentimise kontroll - nõuab 'admin' õigusi
                user, auth_error = require_token(data, min_role='admin')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
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
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                # Autentimise kontroll - kõik sisselogitud kasutajad näevad
                user, auth_error = require_token(data, min_role='viewer')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return

                commit_hash = data.get('commit_hash')
                filepath = data.get('filepath')  # Valikuline

                if not commit_hash:
                    self.send_error(400, "Puudub 'commit_hash'")
                    return

                # Hangi diff
                result = get_commit_diff(commit_hash, filepath)

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
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)
                
                # Autentimise kontroll - ainult admin saab muuta üldisi metaandmeid
                user, auth_error = require_token(data, min_role='admin')
                if auth_error:
                    self.send_response(401)
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return
                
                original_catalog = data.get('original_path')
                work_id = data.get('work_id')
                new_metadata = data.get('metadata') # Sõnastik uute andmetega
                
                if (not original_catalog and not work_id) or not new_metadata:
                    self.send_response(400)
                    send_cors_headers(self)
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Puudub 'original_path'/'work_id' või 'metadata'"}).encode('utf-8'))
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
                
                # Loeme olemasoleva faili (et säilitada välju, mida me ei muuda)
                current_meta = {}
                if os.path.exists(metadata_path):
                    with open(metadata_path, 'r', encoding='utf-8') as f:
                        current_meta = json.load(f)

                # Uuendame andmed
                current_meta.update(new_metadata)

                # V1→V2 normaliseerimine: eemalda v1 väljad kui v2 on olemas
                v1_to_v2_mapping = {
                    'pealkiri': 'title',
                    'aasta': 'year',
                    'koht': 'location',
                    'trükkal': 'publisher',
                    'teose_tags': 'tags',
                    # autor ja respondens → creators (keerulisem, käsitleme eraldi)
                }
                for v1_key, v2_key in v1_to_v2_mapping.items():
                    if v2_key in current_meta and v1_key in current_meta:
                        del current_meta[v1_key]

                # Kui on creators massiiv, eemalda autor ja respondens väljad
                if 'creators' in current_meta and isinstance(current_meta.get('creators'), list):
                    if 'autor' in current_meta:
                        del current_meta['autor']
                    if 'respondens' in current_meta:
                        del current_meta['respondens']

                # Salvestame
                with open(metadata_path, 'w', encoding='utf-8') as f:
                    json.dump(current_meta, f, ensure_ascii=False, indent=2)
                
                print(f"Admin '{user['username']}' uuendas metaandmeid: {metadata_path}")
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success", "message": "Metaandmed salvestatud"}).encode('utf-8'))
                
                # Sünkrooni Meilisearchiga
                sync_work_to_meilisearch(os.path.basename(os.path.dirname(metadata_path)))
                
            except Exception as e:
                print(f"METADATA UPDATE VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/get-work-metadata':
            # Tagastab teose _metadata.json sisu otse failisüsteemist
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)
                
                # Nõuab vähemalt editori õigusi
                user, auth_error = require_token(data, min_role='editor')
                if auth_error:
                    self.send_response(401)
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return
                
                original_catalog = data.get('original_path')
                work_id = data.get('work_id')
                
                if not original_catalog and not work_id:
                    self.send_response(400)
                    send_cors_headers(self)
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Puudub 'original_path' või 'work_id'"}).encode('utf-8'))
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
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)
                
                # Nõuab vähemalt editori õigusi
                user, auth_error = require_token(data, min_role='editor')
                if auth_error:
                    self.send_response(401)
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return
                
                # Sõnastikud kujul: label.lower() -> { label: "Orig", id: "Q..." | None }
                # Eesmärk: Iga nime kohta hoida parimat teadmist (eelistatult ID-ga)
                authors = {}
                tags = {}
                places = {}
                printers = {}
                types = {}
                genres = {}
                
                def add_item(store, val):
                    """Lisab väärtuse hoidlasse. Kui on LinkedEntity koos tõlgetega, lisab kõik tõlked."""
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
                        main_label = val.get('label', '').strip()
                        
                        # Lisa põhisilt
                        if main_label:
                            key = main_label.lower()
                            # Uuenda kui ID on olemas ja vanal polnud
                            if key not in store or (id_code and not store[key]['id']):
                                store[key] = {'label': main_label, 'id': id_code}
                        
                        # Lisa kõik tõlked 'labels' sõnastikust
                        labels = val.get('labels', {})
                        if isinstance(labels, dict):
                            for lang, label_text in labels.items():
                                if label_text and isinstance(label_text, str):
                                    label_text = label_text.strip()
                                    key = label_text.lower()
                                    # Sama loogika: eellista ID-ga varianti
                                    if key not in store or (id_code and not store[key]['id']):
                                        store[key] = {'label': label_text, 'id': id_code}

                # Käime läbi kõik kataloogid ja kogume andmeid
                for entry in os.scandir(BASE_DIR):
                    if entry.is_dir():
                        meta_path = os.path.join(entry.path, '_metadata.json')
                        if os.path.exists(meta_path):
                            try:
                                with open(meta_path, 'r', encoding='utf-8') as f:
                                    meta = json.load(f)

                                    # Creators
                                    for creator in meta.get('creators', []):
                                        add_item(authors, {'label': creator.get('name'), 'id': creator.get('id')})

                                    # V1 fallback authors
                                    if meta.get('autor'): add_item(authors, meta['autor'])
                                    if meta.get('respondens'): add_item(authors, meta['respondens'])

                                    # Tags
                                    for t in meta.get('tags', []): add_item(tags, t)
                                    for t in meta.get('teose_tags', []): add_item(tags, t)

                                    # Location
                                    loc = meta.get('location') or meta.get('koht')
                                    add_item(places, loc)

                                    # Publisher
                                    pub = meta.get('publisher') or meta.get('trükkal')
                                    add_item(printers, pub)

                                    # Type
                                    add_item(types, meta.get('type'))

                                    # Genre
                                    g = meta.get('genre')
                                    if g:
                                        if isinstance(g, list):
                                            for item in g: add_item(genres, item)
                                        else:
                                            add_item(genres, g)
                            except:
                                continue
                
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
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                user, auth_error = require_token(data, min_role='admin')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
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
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                user, auth_error = require_token(data, min_role='admin')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return

                reg_id = data.get('registration_id')
                if not reg_id:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "registration_id puudub"}).encode('utf-8'))
                    return

                # Leia taotlus
                reg = get_registration_by_id(reg_id)
                if not reg:
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Taotlust ei leitud"}).encode('utf-8'))
                    return

                if reg["status"] != "pending":
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Taotlus on juba käsitletud"}).encode('utf-8'))
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
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                user, auth_error = require_token(data, min_role='admin')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return

                reg_id = data.get('registration_id')
                if not reg_id:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "registration_id puudub"}).encode('utf-8'))
                    return

                reg = get_registration_by_id(reg_id)
                if not reg:
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Taotlust ei leitud"}).encode('utf-8'))
                    return

                if reg["status"] != "pending":
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Taotlus on juba käsitletud"}).encode('utf-8'))
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
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                user, auth_error = require_token(data, min_role='admin')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
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
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                user, auth_error = require_token(data, min_role='admin')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return

                username = data.get('username')
                new_role = data.get('new_role')

                if not username or not new_role:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "username ja new_role on kohustuslikud"}).encode('utf-8'))
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
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                user, auth_error = require_token(data, min_role='admin')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return

                username = data.get('username')

                if not username:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "username on kohustuslik"}).encode('utf-8'))
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

                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                token = data.get('token', '').strip()
                password = data.get('password', '')

                if not token:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Token puudub"}).encode('utf-8'))
                    return

                if not password or len(password) < 12:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Parool peab olema vähemalt 12 tähemärki"}).encode('utf-8'))
                    return

                # Lihtsa parooli kontroll
                if len(set(password)) < 4:  # Liiga vähe erinevaid tähemärke
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Parool on liiga lihtne - kasuta rohkem erinevaid tähemärke"}).encode('utf-8'))
                    return

                # Keela numbrijadad ja korduvad mustrid
                simple_patterns = ['123456789012', '111111111111', 'aaaaaaaaaaaa', 'password1234', 'qwertyuiop12']
                if password.lower() in simple_patterns or password == password[0] * len(password):
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Parool on liiga lihtne - vali tugevam parool"}).encode('utf-8'))
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
        # PENDING-EDITS ENDPOINTID
        # =========================================================

        elif self.path == '/save-pending':
            # Salvestab kaastöölise muudatuse pending-olekusse
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                # Nõuab vähemalt contributor õigusi
                user, auth_error = require_token(data, min_role='contributor')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return

                teose_id = data.get('teose_id')
                lehekylje_number = data.get('lehekylje_number')
                original_text = data.get('original_text', '')
                new_text = data.get('new_text', '')

                if not teose_id or lehekylje_number is None:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "teose_id ja lehekylje_number on kohustuslikud"}).encode('utf-8'))
                    return

                # Kontrolli, kas teised kasutajad on juba muudatusi teinud
                other_edits = get_pending_edits_for_page(teose_id, lehekylje_number)
                other_users_edits = [e for e in other_edits if e["user"] != user["username"]]
                has_other_pending = len(other_users_edits) > 0

                # Loo pending-edit
                edit, error = create_pending_edit(
                    teose_id=teose_id,
                    lehekylje_number=lehekylje_number,
                    user=user,
                    original_text=original_text,
                    new_text=new_text
                )

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                response = {
                    "status": "success",
                    "message": "Muudatus salvestatud ülevaatusele",
                    "edit_id": edit["id"],
                    "has_other_pending": has_other_pending
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))

            except Exception as e:
                print(f"SAVE-PENDING VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/pending-edits':
            # Tagastab ootel muudatused (toimetaja+)
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                user, auth_error = require_token(data, min_role='editor')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return

                edits_data = load_pending_edits()

                # Filtreeri ainult pending-staatusega
                pending = [e for e in edits_data["pending_edits"] if e["status"] == "pending"]

                # Sorteeri kuupäeva järgi (uuemad ees)
                pending.sort(key=lambda x: x["submitted_at"], reverse=True)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                response = {
                    "status": "success",
                    "pending_edits": pending
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))

            except Exception as e:
                print(f"PENDING-EDITS VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/pending-edits/check':
            # Kontrollib, kas lehel on ootel muudatusi (contributor näeb oma muudatust)
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                user, auth_error = require_token(data, min_role='contributor')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return

                teose_id = data.get('teose_id')
                lehekylje_number = data.get('lehekylje_number')

                if not teose_id or lehekylje_number is None:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "teose_id ja lehekylje_number on kohustuslikud"}).encode('utf-8'))
                    return

                # Kasutaja enda muudatus
                user_edit = get_user_pending_edit_for_page(teose_id, lehekylje_number, user["username"])

                # Kas on teiste muudatusi (ainult toimetaja näeb)
                all_edits = get_pending_edits_for_page(teose_id, lehekylje_number)
                other_edits_count = len([e for e in all_edits if e["user"] != user["username"]])

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                response = {
                    "status": "success",
                    "has_own_pending": user_edit is not None,
                    "own_pending_edit": user_edit,
                    "other_pending_count": other_edits_count if user["role"] in ['editor', 'admin'] else 0
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))

            except Exception as e:
                print(f"PENDING-EDITS CHECK VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/pending-edits/approve':
            # Kinnitab pending-edit (toimetaja+)
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                user, auth_error = require_token(data, min_role='editor')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return

                edit_id = data.get('edit_id')
                comment = data.get('comment', '')

                if not edit_id:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "edit_id puudub"}).encode('utf-8'))
                    return

                edit = get_pending_edit_by_id(edit_id)
                if not edit:
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Muudatust ei leitud"}).encode('utf-8'))
                    return

                if edit["status"] != "pending":
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Muudatus on juba käsitletud"}).encode('utf-8'))
                    return

                # Leia fail
                dir_path = find_directory_by_id(edit["teose_id"])
                if not dir_path:
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Teost ei leitud"}).encode('utf-8'))
                    return

                # Leia .txt fail
                txt_files = sorted(glob.glob(os.path.join(dir_path, '*.txt')))
                if edit["lehekylje_number"] < 1 or edit["lehekylje_number"] > len(txt_files):
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Lehekülge ei leitud"}).encode('utf-8'))
                    return

                txt_path = txt_files[edit["lehekylje_number"] - 1]

                # Loe praegune tekst konfliktide kontrolliks
                with open(txt_path, 'r', encoding='utf-8') as f:
                    current_text = f.read()

                base_changed = check_base_text_conflict(edit, current_text)

                # Salvesta uus tekst Git commiti abil
                # Autor = kaastööline, kes muudatuse tegi
                author_name = edit.get("user_name", edit["user"])
                commit_message = f"Muuda: {os.path.basename(txt_path)} (kinnitatud {user['username']} poolt)"

                git_result = save_with_git(
                    filepath=txt_path,
                    content=edit["new_text"],
                    username=author_name,
                    message=commit_message
                )

                # Uuenda Meilisearch
                sync_work_to_meilisearch(os.path.basename(dir_path))

                # Märgi muudatus kinnitatuks
                update_pending_edit_status(edit_id, "approved", user["username"], comment)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                response = {
                    "status": "success",
                    "message": "Muudatus kinnitatud",
                    "base_changed": base_changed,
                    "git_commit": git_result.get("commit_hash", "")[:8] if git_result.get("success") else None
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))

                print(f"Toimetaja {user['username']} kinnitas muudatuse: {edit['user']} -> {edit['teose_id']}/{edit['lehekylje_number']}")

            except Exception as e:
                print(f"APPROVE PENDING VIGA: {e}")
                self.send_error(500, str(e))

        elif self.path == '/pending-edits/reject':
            # Lükkab pending-edit tagasi (toimetaja+)
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                user, auth_error = require_token(data, min_role='editor')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return

                edit_id = data.get('edit_id')
                comment = data.get('comment', '')

                if not edit_id:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "edit_id puudub"}).encode('utf-8'))
                    return

                edit = get_pending_edit_by_id(edit_id)
                if not edit:
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Muudatust ei leitud"}).encode('utf-8'))
                    return

                if edit["status"] != "pending":
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Muudatus on juba käsitletud"}).encode('utf-8'))
                    return

                # Märgi muudatus tagasilükatuks
                update_pending_edit_status(edit_id, "rejected", user["username"], comment)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                send_cors_headers(self)
                self.end_headers()

                response = {
                    "status": "success",
                    "message": "Muudatus tagasi lükatud"
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))

                print(f"Toimetaja {user['username']} lükkas tagasi muudatuse: {edit['user']} -> {edit['teose_id']}/{edit['lehekylje_number']}")

            except Exception as e:
                print(f"REJECT PENDING VIGA: {e}")
                self.send_error(500, str(e))

        # =========================================================
        # MASSILINE KOLLEKTSIOONI MÄÄRAMINE
        # =========================================================

        elif self.path == '/works/bulk-collection':
            # Määrab kollektsiooni mitmele teosele korraga (ainult admin)
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                user, auth_error = require_token(data, min_role='admin')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return

                work_ids = data.get('work_ids', [])
                collection = data.get('collection')  # None = eemalda kollektsioon

                if not work_ids:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    send_cors_headers(self)
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "work_ids on kohustuslik"}).encode('utf-8'))
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

                        # Loe olemasolev metadata
                        current_meta = {}
                        if os.path.exists(metadata_path):
                            with open(metadata_path, 'r', encoding='utf-8') as f:
                                current_meta = json.load(f)

                        # Uuenda collection väli
                        current_meta['collection'] = collection

                        # Salvesta
                        with open(metadata_path, 'w', encoding='utf-8') as f:
                            json.dump(current_meta, f, ensure_ascii=False, indent=2)

                        # Sünkrooni Meilisearchiga
                        sync_work_to_meilisearch(os.path.basename(dir_path))

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

if __name__ == '__main__':
    print(f"VUTT Failiserver API käivitus pordil {PORT}.")
    print(f"Jälgitav juurkaust: {BASE_DIR}")
    print(f"Kasutab mooduleid: server/")

    socketserver.TCPServer.allow_reuse_address = True

    # Ehita Work ID cache kiiremaks failide leidmiseks
    build_work_id_cache()

    # Käivita metaandmete jälgija taustal
    # watcher_thread = threading.Thread(target=metadata_watcher_loop, daemon=True)
    # watcher_thread.start()

    # Kasutame ThreadingHTTPServer mitme päringu samaaegseks teenindamiseks
    server = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), RequestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer peatatud.")
    server.server_close()
