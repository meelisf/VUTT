import http.server
import json
import os
import shutil
import hashlib
import glob
import uuid
from datetime import datetime
import re
import unicodedata
import threading
import time
import urllib.request
import urllib.parse

# =========================================================
# KONFIGURATSIOON
BASE_DIR = "/home/mf/Dokumendid/LLM/tartu-acad/data/04_sorditud_dokumendid/" 
USERS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "users.json")
# =========================================================

PORT = 8002

# Sessioonide hoidla (token -> user info)
# NB: Serveri restart kustutab kõik sessioonid
sessions = {}

# Meilisearchi konfig (laetakse .env failist)
MEILI_URL = "http://127.0.0.1:7700"
MEILI_KEY = ""
INDEX_NAME = "teosed"

def load_env():
    """Laeb .env failist Meilisearchi andmed."""
    global MEILI_URL, MEILI_KEY
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                if '=' in line and not line.startswith('#'):
                    key, value = line.strip().split('=', 1)
                    value = value.strip('"').strip("'")
                    if key == "MEILISEARCH_URL":
                        MEILI_URL = value
                    elif key == "MEILISEARCH_MASTER_KEY":
                        MEILI_KEY = value
                    elif key == "MEILI_SEARCH_API_KEY" and not MEILI_KEY:
                        MEILI_KEY = value
    print(f"Meilisearch URL: {MEILI_URL}")

load_env()

def send_to_meilisearch(documents):
    """Saadab dokumendid Meilisearchi kasutades urllib-i."""
    if not MEILI_KEY:
        print("HOIATUS: Meilisearchi võti puudub, ei saa indekseerida.")
        return False
    
    url = f"{MEILI_URL}/indexes/{INDEX_NAME}/documents"
    try:
        data = json.dumps(documents).encode('utf-8')
        req = urllib.request.Request(url, data=data, method='POST')
        req.add_header('Content-Type', 'application/json')
        req.add_header('Authorization', f'Bearer {MEILI_KEY}')
        
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            print(f"Meilisearch vastus: {res_data}")
            return True
    except Exception as e:
        print(f"Viga Meilisearchi saatmisel: {e}")
        return False

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

def sanitize_id(text):
    """Puhastab teksti, et see sobiks ID-ks (sama loogika mis 1-1 skriptis)."""
    if not text: return ""
    # Eemalda diakriitikud
    normalized = unicodedata.normalize('NFD', text)
    ascii_text = ''.join(c for c in normalized if unicodedata.category(c) != 'Mn')
    # Asenda kõik mitte-lubatud märgid alakriipsuga
    sanitized = re.sub(r'[^a-zA-Z0-9_-]', '_', ascii_text)
    # Eemalda mitu järjestikust alakriipsu
    sanitized = re.sub(r'_+', '_', sanitized)
    # Eemalda algus- ja lõpukriipsud
    sanitized = sanitized.strip('_-')
    return sanitized

def find_directory_by_id(target_id):
    """Leiab failisüsteemist kausta teose ID järgi."""
    if not target_id: return None
    
    for entry in os.scandir(BASE_DIR):
        if entry.is_dir():
            # 1. Kontrolli _metadata.json faili sisu
            meta_path = os.path.join(entry.path, '_metadata.json')
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, 'r', encoding='utf-8') as f:
                        meta = json.load(f)
                        if meta.get('teose_id') == target_id:
                            return entry.path
                except:
                    pass
            
            # 2. Kontrolli kausta nime (sanitiseeritult)
            if sanitize_id(entry.name) == target_id:
                return entry.path
    return None

def generate_default_metadata(dir_name):
    """Genereerib vaike-metaandmed kataloogi nime põhjal."""
    teose_id = sanitize_id(dir_name)
    
    # Pealkiri kataloogi nimest (eemaldame aastaarvu ja ID osa kui võimalik)
    # Sama loogika mis 1-1_consolidate_data.py skriptis
    clean_title = re.sub(r'^\d{4}[-_]\d+[-_]?', '', dir_name)
    if clean_title == dir_name:
        clean_title = re.sub(r'^\d{4}[-_]?', '', dir_name)
    
    title = clean_title.replace('-', ' ').replace('_', ' ').strip().capitalize() if clean_title else "Pealkiri puudub"
    
    # Proovi leida aasta
    year = 0
    year_match = re.match(r'^(\d{4})', dir_name)
    if year_match:
        year = int(year_match.group(1))

    return {
        "teose_id": teose_id,
        "pealkiri": title,
        "autor": "",
        "respondens": "",
        "aasta": year,
        "teose_tags": [],
        "ester_id": None,
        "external_url": None
    }

def normalize_genre(tag):
    """Normaliseerib žanri väärtuse 'disputatsioon'-iks, kui see on üks sünonüümidest."""
    synonyms = ["dissertatsioon", "exercitatio", "teesid", "dissertatio", "theses", "disputatio"]
    if tag and tag.strip().lower() in synonyms:
        return "disputatsioon"
    return tag.strip().lower() if tag else tag

def calculate_work_status(page_statuses):
    """Arvutab teose koondstaatuse lehekülgede staatuste põhjal.
    
    Loogika: Kõik Valmis → Valmis, Kõik Toores/Leidmata → Toores, muidu → Töös
    """
    if not page_statuses: return 'Toores'
    
    # Valmis / Tehtud (Frontendis näib olevat DONE või Tehtud)
    done_aliases = ['Valmis', 'Tehtud', 'DONE']
    # Toores / Algne
    raw_aliases = ['Toores', 'Algne', 'RAW', '']
    
    is_all_done = all(s in done_aliases for s in page_statuses)
    if is_all_done: return 'Valmis'
    
    is_all_raw = all(s in raw_aliases or s is None for s in page_statuses)
    if is_all_raw: return 'Toores'
    
    return 'Töös'

def sync_work_to_meilisearch(dir_name):
    """
    Sünkroonib ühe teose kõik leheküljed Meilisearchi.
    Loeb andmed failisüsteemist (_metadata.json, pildid, .txt, .json).
    """
    dir_path = os.path.join(BASE_DIR, dir_name)
    if not os.path.exists(dir_path):
        print(f"SÜNK: Kausta ei leitud: {dir_path}")
        return False

    # 1. Lae teose metaandmed
    meta_path = os.path.join(dir_path, '_metadata.json')
    metadata = {}
    if os.path.exists(meta_path):
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
        except Exception as e:
            print(f"SÜNK: Viga metaandmete lugemisel: {e}")
            return False
    
    if not metadata:
        metadata = generate_default_metadata(dir_name)
        
    teose_id = metadata.get('teose_id', sanitize_id(dir_name))
    pealkiri = metadata.get('pealkiri', 'Pealkiri puudub')
    autor = metadata.get('autor', '')
    respondens = metadata.get('respondens', '')
    aasta = metadata.get('aasta', 0)
    teose_tags = metadata.get('teose_tags', [])
    if isinstance(teose_tags, list):
        teose_tags = [normalize_genre(t) for t in teose_tags]
    
    ester_id = metadata.get('ester_id')
    external_url = metadata.get('external_url')

    # 2. Leia leheküljed (pildid)
    images = sorted([f for f in os.listdir(dir_path) if f.lower().endswith(('.jpg', '.jpeg', '.png'))])
    if not images:
        print(f"SÜNK: Pilte ei leitud kaustas: {dir_name}")
        return False
    
    documents = []
    page_statuses = []
    
    for i, img_name in enumerate(images):
        page_num = i + 1
        page_id = f"{teose_id}-{page_num}"
        base_name = os.path.splitext(img_name)[0]
        
        # Tekst
        txt_path = os.path.join(dir_path, base_name + '.txt')
        page_text = ""
        if os.path.exists(txt_path):
            try:
                with open(txt_path, 'r', encoding='utf-8') as f:
                    page_text = f.read()
            except: pass
            
        # Lehekülje meta (status, tags, comments)
        json_path = os.path.join(dir_path, base_name + '.json')
        page_meta = {
            'status': 'Toores',
            'tags': [],
            'comments': [],
            'history': []
        }
        if os.path.exists(json_path):
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    p_data = json.load(f)
                    # Toeta nii vana kui uut formaati (meta_content wrapper)
                    source = p_data.get('meta_content', p_data)
                    page_meta['status'] = source.get('status', 'Toores')
                    page_meta['tags'] = source.get('tags', [])
                    page_meta['comments'] = source.get('comments', [])
                    page_meta['history'] = source.get('history', [])
                    # Kui JSON-is on tekst ja failis pole, kasuta JSON-it
                    if not page_text and 'text_content' in p_data:
                        page_text = p_data['text_content']
            except: pass
            
        page_statuses.append(page_meta['status'])
        
        doc = {
            "id": page_id,
            "teose_id": teose_id,
            "pealkiri": pealkiri,
            "autor": autor,
            "respondens": respondens,
            "aasta": aasta,
            "lehekylje_number": page_num,
            "teose_lehekylgede_arv": len(images),
            "lehekylje_tekst": page_text,
            "lehekylje_pilt": os.path.join(dir_name, img_name),
            "originaal_kataloog": dir_name,
            "status": page_meta['status'],
            "tags": [t.lower() for t in page_meta['tags']],
            "comments": page_meta['comments'],
            "history": page_meta['history'],
            "last_modified": int(os.path.getmtime(txt_path if os.path.exists(txt_path) else os.path.join(dir_path, img_name)) * 1000),
            "teose_tags": teose_tags
        }
        
        if ester_id: doc['ester_id'] = ester_id
        if external_url: doc['external_url'] = external_url
        
        documents.append(doc)
    
    # 3. Arvuta teose koondstaatus
    teose_staatus = calculate_work_status(page_statuses)
    for doc in documents:
        doc['teose_staatus'] = teose_staatus
        
    # 4. Saada Meilisearchi
    if documents:
        print(f"AUTOMAATNE SÜNK: Teos {teose_id} ({len(documents)} lk), staatus: {teose_staatus}")
        return send_to_meilisearch(documents)
    return False

def index_new_work(dir_name, metadata):
    """Loob lehekülgede dokumendid ja saadab Meilisearchi."""
    return sync_work_to_meilisearch(dir_name)

def metadata_watcher_loop():
    """Taustalõim, mis otsib uusi kaustu ja loob neile metaandmed."""
    print(f"Metaandmete jälgija käivitatud (kataloog: {BASE_DIR})")
    while True:
        try:
            if not os.path.exists(BASE_DIR):
                time.sleep(60)
                continue

            for entry in os.scandir(BASE_DIR):
                if entry.is_dir():
                    meta_path = os.path.join(entry.path, '_metadata.json')
                    if not os.path.exists(meta_path):
                        # Kontrollime kas on pilte
                        has_images = False
                        for f in os.listdir(entry.path):
                            if f.lower().endswith(('.jpg', '.jpeg', '.png')):
                                has_images = True
                                break
                        
                        if has_images:
                            try:
                                metadata = generate_default_metadata(entry.name)
                                with open(meta_path, 'w', encoding='utf-8') as f:
                                    json.dump(metadata, f, ensure_ascii=False, indent=2)
                                print(f"AUTOMAATNE METADATA: Loodud fail {meta_path}")
                                
                                # Indekseeri kohe Meilisearchis
                                index_new_work(entry.name, metadata)
                            except Exception as e:
                                print(f"Viga metaandmete loomisel ({entry.name}): {e}")
            
            # Oota 30 sekundit järgmise skannimiseni
            time.sleep(30)
        except Exception as e:
            print(f"Jälgija viga: {e}")
            time.sleep(60)

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
                    # ORIGINAALI KAITSE: Kui .backup.ORIGINAL ei eksisteeri, loome selle
                    # See on ALGNE OCR-tekst, mida ei kustutata kunagi
                    original_backup_path = f"{txt_path}.backup.ORIGINAL"
                    if not os.path.exists(original_backup_path):
                        # Kontrollime, kas on olemas vanemaid varukoopiad
                        existing_backups = sorted(glob.glob(f"{txt_path}.backup.*"))
                        if existing_backups:
                            # Vanemad backupid olemas - kõige vanem on originaal
                            # Nimetame selle ümber .backup.ORIGINAL nimeks
                            oldest_backup = existing_backups[0]
                            shutil.copy2(oldest_backup, original_backup_path)
                            print(f"Originaal kaitstud (kopeeritud vanemast): {os.path.basename(original_backup_path)}")
                        else:
                            # Pole ühtegi backupi - praegune .txt ON originaal
                            shutil.copy2(txt_path, original_backup_path)
                            print(f"Originaal kaitstud (esimene salvestus): {os.path.basename(original_backup_path)}")
                    
                    # Tavaline varukoopia praegusest versioonist
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    backup_path = f"{txt_path}.backup.{timestamp}"
                    shutil.copy2(txt_path, backup_path)
                    
                    # Piirame varukoopiate arvu (max 10 faili kohta, v.a ORIGINAL)
                    existing_backups = sorted(glob.glob(f"{txt_path}.backup.*"))
                    # Eemaldame ORIGINAL loendist - seda ei arvestata limiidi hulka
                    existing_backups = [b for b in existing_backups if not b.endswith('.backup.ORIGINAL')]
                    if len(existing_backups) > 10:
                        # Kustutame vanemad vaheversioonid, jätame 10 uuemat
                        for old_backup in existing_backups[:-10]:
                            os.remove(old_backup)
                            print(f"Kustutatud vana varukoopia: {os.path.basename(old_backup)}")
                
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
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return
                
                original_catalog = data.get('original_path')
                work_id = data.get('work_id')
                new_metadata = data.get('metadata') # Sõnastik uute andmetega
                
                if (not original_catalog and not work_id) or not new_metadata:
                    self.send_response(400)
                    self.send_header('Access-Control-Allow-Origin', '*')
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
                
                # Salvestame
                with open(metadata_path, 'w', encoding='utf-8') as f:
                    json.dump(current_meta, f, ensure_ascii=False, indent=2)
                
                print(f"Admin '{user['username']}' uuendas metaandmeid: {metadata_path}")
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
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
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return
                
                original_catalog = data.get('original_path')
                work_id = data.get('work_id')
                
                if not original_catalog and not work_id:
                    self.send_response(400)
                    self.send_header('Access-Control-Allow-Origin', '*')
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
                self.send_header('Access-Control-Allow-Origin', '*')
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
            # Tagastab unikaalsed autorid ja žanrid (tagid) soovitusteks
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)
                
                # Nõuab vähemalt editori õigusi
                user, auth_error = require_token(data, min_role='editor')
                if auth_error:
                    self.send_response(401)
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return
                
                authors = set()
                tags = set()
                
                # Käime läbi kõik kataloogid ja kogume andmeid
                for entry in os.scandir(BASE_DIR):
                    if entry.is_dir():
                        meta_path = os.path.join(entry.path, '_metadata.json')
                        if os.path.exists(meta_path):
                            try:
                                with open(meta_path, 'r', encoding='utf-8') as f:
                                    meta = json.load(f)
                                    if meta.get('autor'):
                                        authors.add(meta['autor'].strip())
                                    if meta.get('respondens'):
                                        authors.add(meta['respondens'].strip())
                                    for t in meta.get('teose_tags', []):
                                        tags.add(t.strip().lower())
                            except:
                                continue
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                response = {
                    "status": "success",
                    "authors": sorted(list(authors)),
                    "tags": sorted(list(tags))
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
            except Exception as e:
                print(f"SUGGESTIONS VIGA: {e}")
                self.send_error(500, str(e))
                
        else:
            self.send_error(404)

print(f"Failiserver API käivitus pordil {PORT}.")
print(f"Jälgitav juurkaust: {BASE_DIR}")

import socketserver
socketserver.TCPServer.allow_reuse_address = True

# Käivita metaandmete jälgija taustal
watcher_thread = threading.Thread(target=metadata_watcher_loop, daemon=True)
watcher_thread.start()

server = http.server.HTTPServer(('0.0.0.0', PORT), RequestHandler)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
server.server_close()