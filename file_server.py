import http.server
import json
import os
import shutil
import hashlib
import glob
import uuid
from datetime import datetime

# =========================================================
# KONFIGURATSIOON
BASE_DIR = "/home/mf/Dokumendid/LLM/tartu-acad/data/04_sorditud_dokumendid/" 
USERS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "users.json")
# =========================================================

PORT = 8002

# Sessioonide hoidla (token -> user info)
# NB: Serveri restart kustutab kõik sessioonid
sessions = {}

def load_users():
    """Laeb kasutajad JSON failist. Loob faili kui ei eksisteeri."""
    if not os.path.exists(USERS_FILE):
        # Loome vaikimisi admin kasutaja (parool: admin123)
        default_users = {
            "admin": {
                "password_hash": hashlib.sha256("admin123".encode()).hexdigest(),
                "name": "Administraator",
                "role": "admin"
            }
        }
        with open(USERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(default_users, f, ensure_ascii=False, indent=2)
        print(f"Loodud vaikimisi kasutajate fail: {USERS_FILE}")
        return default_users
    
    with open(USERS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def verify_user(username, password):
    """Kontrollib kasutajanime ja parooli."""
    users = load_users()
    if username not in users:
        return None
    
    password_hash = hashlib.sha256(password.encode()).hexdigest()
    if users[username]["password_hash"] == password_hash:
        return {
            "username": username,
            "name": users[username]["name"],
            "role": users[username].get("role", "user")
        }
    return None

def create_session(user):
    """Loob uue sessiooni ja tagastab tokeni."""
    token = str(uuid.uuid4())
    sessions[token] = {
        "user": user,
        "created_at": datetime.now().isoformat()
    }
    print(f"Uus sessioon loodud: {user['username']} (aktiivseid sessioone: {len(sessions)})")
    return token

def require_token(data, min_role=None):
    """
    Kontrollib tokenit päringus.
    Tagastab (user, error_response) tuple.
    Kui autentimine õnnestub, on error_response None.
    min_role: 'viewer', 'editor', 'admin' - minimaalne nõutav roll
    """
    token = data.get('auth_token', '').strip()
    
    if not token:
        return None, {"status": "error", "message": "Autentimine nõutud (token puudub)"}
    
    session = sessions.get(token)
    if not session:
        return None, {"status": "error", "message": "Sessioon aegunud, palun logi uuesti sisse"}
    
    user = session["user"]
    
    # Rollide hierarhia kontroll
    if min_role:
        role_hierarchy = {'viewer': 0, 'editor': 1, 'admin': 2}
        user_level = role_hierarchy.get(user['role'], 0)
        required_level = role_hierarchy.get(min_role, 0)
        if user_level < required_level:
            return None, {"status": "error", "message": f"Vajab vähemalt '{min_role}' õigusi"}
    
    return user, None

# Vana funktsioon tagasiühilduvuseks (eemaldatakse tulevikus)
def require_auth(data, min_role=None):
    """DEPRECATED: Kasuta require_token() asemel."""
    return require_token(data, min_role)

class RequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        if self.path == '/login':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)
                
                username = data.get('username', '').strip()
                password = data.get('password', '')
                
                user = verify_user(username, password)
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
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
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                session = sessions.get(token)
                if session:
                    response = {"status": "success", "user": session["user"], "valid": True}
                else:
                    response = {"status": "error", "valid": False, "message": "Token aegunud"}
                
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
            except Exception as e:
                print(f"VERIFY-TOKEN VIGA: {e}")
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
                    self.send_header('Access-Control-Allow-Origin', '*')
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
                # 1. TEKSTIFAILI SALVESTAMINE (.txt)
                # -------------------------------------------------
                
                # Teeme varukoopia kui fail juba eksisteerib
                backup_path = ""
                if os.path.exists(txt_path):
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    backup_path = f"{txt_path}.backup.{timestamp}"
                    shutil.copy2(txt_path, backup_path)
                    
                    # Piirame varukoopiate arvu (max 10 faili kohta)
                    # Kõige esimene (vanim) varukoopia on alati kaitstud - see on originaal
                    existing_backups = sorted(glob.glob(f"{txt_path}.backup.*"))
                    if len(existing_backups) > 10:
                        # Jätame esimese (originaal) ja 9 uuemat alles, kustutame vahelt
                        original_backup = existing_backups[0]  # Kõige vanem = originaal
                        newer_backups = existing_backups[1:]   # Kõik peale originaali
                        # Kustutame vanemad vaheversioonid, jätame 9 uuemat
                        for old_backup in newer_backups[:-9]:
                            os.remove(old_backup)
                            print(f"Kustutatud vana varukoopia: {os.path.basename(old_backup)}")
                        print(f"Originaal kaitstud: {os.path.basename(original_backup)}")
                
                # Kirjutame teksti
                with open(txt_path, 'w', encoding='utf-8') as f:
                    f.write(text_content)
                print(f"Salvestatud tekst: {txt_path}")
                
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
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                response = {
                    "status": "success", 
                    "backup": os.path.basename(backup_path) if backup_path else None,
                    "json_created": json_saved
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
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
                    self.send_header('Access-Control-Allow-Origin', '*')
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
                for backup_path in backups:
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
                
                # Originaalfaili käsitlemine:
                # 1. Kui originaal .txt fail eksisteerib → näita seda kui "Originaal (OCR)"
                # 2. Kui .txt faili pole → kõige vanem backup on originaal
                if os.path.exists(txt_path):
                    # Originaal .txt fail on olemas - lisa see nimekirja lõppu (kõige vanem)
                    file_mtime = os.path.getmtime(txt_path)
                    file_dt = datetime.fromtimestamp(file_mtime)
                    backup_list.append({
                        "filename": safe_filename,  # Originaalfaili nimi (ilma .backup)
                        "timestamp": "original",
                        "formatted_date": f"Originaal (OCR) - {file_dt.strftime('%d.%m.%Y')}",
                        "is_original": True
                    })
                elif backup_list:
                    # Originaal .txt faili pole, aga on varukoopiad
                    # Kõige vanem backup on "originaal" (kustutamatu)
                    backup_list[-1]["is_original"] = True
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
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
                    self.send_header('Access-Control-Allow-Origin', '*')
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
                        self.send_header('Access-Control-Allow-Origin', '*')
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
                    self.send_header('Access-Control-Allow-Origin', '*')
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
                self.send_header('Access-Control-Allow-Origin', '*')
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
                
        else:
            self.send_error(404)

print(f"Failiserver API käivitus pordil {PORT}.")
print(f"Jälgitav juurkaust: {BASE_DIR}")

import socketserver
socketserver.TCPServer.allow_reuse_address = True
server = http.server.HTTPServer(('0.0.0.0', PORT), RequestHandler)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
server.server_close()