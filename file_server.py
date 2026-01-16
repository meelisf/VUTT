import http.server
import json
import os
import shutil
import hashlib
import glob
import uuid
from datetime import datetime, timedelta
import re
import unicodedata
import threading
import time
import urllib.request
import urllib.parse

# Git versioonihaldus
from git import Repo, Actor
from git.exc import InvalidGitRepositoryError, GitCommandError

# =========================================================
# KONFIGURATSIOON
# VUTT_DATA_DIR env variable allows overriding the path for Docker/Production
DEFAULT_DIR = "/home/mf/Dokumendid/LLM/tartu-acad/data/04_sorditud_dokumendid/"
BASE_DIR = os.getenv("VUTT_DATA_DIR", DEFAULT_DIR) 
USERS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "users.json")
PENDING_REGISTRATIONS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pending_registrations.json")
INVITE_TOKENS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "invite_tokens.json")
PENDING_EDITS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pending_edits.json")
# =========================================================

PORT = 8002

# Sessioonide hoidla (token -> user info)
# NB: Serveri restart kustutab kõik sessioonid
sessions = {}

# Sessiooni kehtivusaeg (24 tundi)
SESSION_DURATION = timedelta(hours=24)

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

# =========================================================
# GIT VERSIOONIHALDUS
# =========================================================

# Git repo globaalne muutuja (initsialiseeritakse esimesel kasutamisel)
_git_repo = None

def get_or_init_repo():
    """
    Tagastab Git repo objekti andmekausta jaoks.
    Initsialiseerib repo, kui see puudub.
    """
    global _git_repo

    if _git_repo is not None:
        return _git_repo

    try:
        _git_repo = Repo(BASE_DIR)
        print(f"Git repo leitud: {BASE_DIR}")
    except InvalidGitRepositoryError:
        _git_repo = Repo.init(BASE_DIR)
        print(f"Git repo initsialiseeritud: {BASE_DIR}")

        # Loome .gitignore, et ignoreerida pilte ja muid suuri faile
        gitignore_path = os.path.join(BASE_DIR, '.gitignore')
        if not os.path.exists(gitignore_path):
            with open(gitignore_path, 'w') as f:
                f.write("# VUTT Git versioonihaldus\n")
                f.write("# Jälgime ainult .txt faile\n")
                f.write("*.jpg\n")
                f.write("*.jpeg\n")
                f.write("*.png\n")
                f.write("*.backup.*\n")  # Vanad backup failid
                f.write("_metadata.json\n")  # Metaandmed eraldi
                f.write("*.json\n")  # Lehekülje metaandmed
            print("Loodud .gitignore")

    return _git_repo

def save_with_git(filepath, content, username, message=None):
    """
    Salvestab faili ja teeb Git commiti.

    Args:
        filepath: Absoluutne tee failini
        content: Faili sisu
        username: Kasutajanimi (commit author)
        message: Commit sõnum (valikuline, genereeritakse automaatselt)

    Returns:
        dict: {"success": bool, "commit_hash": str, "is_first_commit": bool}
    """
    repo = get_or_init_repo()
    relative_path = os.path.relpath(filepath, BASE_DIR)

    # Kontrolli, kas see fail on juba repos (st kas on esimene commit)
    is_first_commit = True
    try:
        # Kui faili ajalugu on olemas, pole esimene commit
        list(repo.iter_commits(paths=relative_path, max_count=1))
        is_first_commit = False
    except:
        is_first_commit = True

    # Kirjuta fail
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

    # Lisa fail indeksisse
    repo.index.add([relative_path])

    # Genereeri commit sõnum
    if not message:
        if is_first_commit:
            message = f"Originaal OCR: {relative_path}"
        else:
            message = f"Muuda: {relative_path}"

    # Tee commit
    author = Actor(username, f"{username}@vutt.local")
    try:
        commit = repo.index.commit(
            message,
            author=author,
            committer=author
        )
        print(f"Git commit: {commit.hexsha[:8]} - {message} (autor: {username})")
        return {
            "success": True,
            "commit_hash": commit.hexsha,
            "is_first_commit": is_first_commit
        }
    except GitCommandError as e:
        print(f"Git commit viga: {e}")
        return {"success": False, "error": str(e)}

def get_file_git_history(relative_path, max_count=50):
    """
    Tagastab faili Git ajaloo.

    Args:
        relative_path: Suhteline tee failini (BASE_DIR suhtes)
        max_count: Maksimaalne commitide arv

    Returns:
        list: Commitide nimekiri, iga element on dict
    """
    repo = get_or_init_repo()

    try:
        commits = list(repo.iter_commits(paths=relative_path, max_count=max_count))
    except:
        return []

    if not commits:
        return []

    # Esimene commit (kõige vanem) on originaal
    original_hash = commits[-1].hexsha if commits else None

    history = []
    for commit in commits:
        history.append({
            "hash": commit.hexsha[:8],
            "full_hash": commit.hexsha,
            "author": commit.author.name,
            "date": commit.committed_datetime.isoformat(),
            "formatted_date": commit.committed_datetime.strftime("%d.%m.%Y %H:%M"),
            "message": commit.message.strip(),
            "is_original": commit.hexsha == original_hash
        })

    return history

def get_file_at_commit(relative_path, commit_hash):
    """
    Tagastab faili sisu kindlas commitist.

    Args:
        relative_path: Suhteline tee failini
        commit_hash: Commiti hash (lühike või täispikk)

    Returns:
        str: Faili sisu või None kui ei leidnud
    """
    repo = get_or_init_repo()

    try:
        content = repo.git.show(f"{commit_hash}:{relative_path}")
        return content
    except GitCommandError as e:
        print(f"Git show viga: {e}")
        return None

def get_file_diff(relative_path, hash1, hash2):
    """
    Tagastab diff kahe commiti vahel.

    Args:
        relative_path: Suhteline tee failini
        hash1: Esimene commit hash
        hash2: Teine commit hash

    Returns:
        str: Diff tekst
    """
    repo = get_or_init_repo()

    try:
        diff = repo.git.diff(hash1, hash2, '--', relative_path)
        return diff
    except GitCommandError as e:
        print(f"Git diff viga: {e}")
        return None

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
    """Laeb kasutajad JSON failist."""
    if not os.path.exists(USERS_FILE):
        print(f"HOIATUS: Kasutajate fail puudub: {USERS_FILE}")
        print("Loo users.json fail koos kasutajatega. Näide:")
        print('  {"admin": {"password_hash": "<sha256>", "name": "Admin", "role": "admin"}}')
        print("Parooli hashi saad: echo -n 'parool' | sha256sum")
        return {}

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

# =========================================================
# REGISTREERIMISE FUNKTSIOONID
# =========================================================

def load_pending_registrations():
    """Laeb ootel registreerimistaotlused."""
    if not os.path.exists(PENDING_REGISTRATIONS_FILE):
        return {"registrations": []}
    with open(PENDING_REGISTRATIONS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_pending_registrations(data):
    """Salvestab ootel registreerimistaotlused."""
    with open(PENDING_REGISTRATIONS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def add_registration(name, email, affiliation, motivation):
    """Lisab uue registreerimistaotluse."""
    data = load_pending_registrations()

    # Kontrolli, kas sama email on juba ootel
    for reg in data["registrations"]:
        if reg["email"].lower() == email.lower() and reg["status"] == "pending":
            return None, "Selle e-posti aadressiga taotlus on juba ootel"

    # Kontrolli, kas sama email on juba kasutajate seas
    users = load_users()
    for username, user_data in users.items():
        # Kui kasutajal on email väli (tulevikus võib olla)
        if user_data.get("email", "").lower() == email.lower():
            return None, "Selle e-posti aadressiga kasutaja on juba olemas"

    registration = {
        "id": str(uuid.uuid4()),
        "name": name,
        "email": email.lower(),
        "affiliation": affiliation,
        "motivation": motivation,
        "submitted_at": datetime.now().isoformat(),
        "status": "pending",
        "reviewed_by": None,
        "reviewed_at": None
    }

    data["registrations"].append(registration)
    save_pending_registrations(data)

    print(f"Uus registreerimistaotlus: {name} ({email})")
    return registration, None

def get_registration_by_id(reg_id):
    """Leiab registreerimistaotluse ID järgi."""
    data = load_pending_registrations()
    for reg in data["registrations"]:
        if reg["id"] == reg_id:
            return reg
    return None

def update_registration_status(reg_id, status, reviewed_by):
    """Uuendab registreerimistaotluse staatust."""
    data = load_pending_registrations()
    for reg in data["registrations"]:
        if reg["id"] == reg_id:
            reg["status"] = status
            reg["reviewed_by"] = reviewed_by
            reg["reviewed_at"] = datetime.now().isoformat()
            save_pending_registrations(data)
            return reg
    return None

# =========================================================
# INVITE TOKENITE FUNKTSIOONID
# =========================================================

def load_invite_tokens():
    """Laeb invite tokenid."""
    if not os.path.exists(INVITE_TOKENS_FILE):
        return {"tokens": []}
    with open(INVITE_TOKENS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_invite_tokens(data):
    """Salvestab invite tokenid."""
    with open(INVITE_TOKENS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def create_invite_token(email, name, created_by):
    """Loob uue invite tokeni (kehtiv 48h)."""
    data = load_invite_tokens()

    token = str(uuid.uuid4())
    expires_at = datetime.now() + timedelta(hours=48)

    token_data = {
        "token": token,
        "email": email.lower(),
        "name": name,
        "created_at": datetime.now().isoformat(),
        "expires_at": expires_at.isoformat(),
        "created_by": created_by,
        "used": False
    }

    data["tokens"].append(token_data)
    save_invite_tokens(data)

    print(f"Loodud invite token kasutajale {name} ({email})")
    return token_data

def validate_invite_token(token):
    """Kontrollib invite tokeni kehtivust. Tagastab (token_data, error)."""
    data = load_invite_tokens()

    for t in data["tokens"]:
        if t["token"] == token:
            if t["used"]:
                return None, "Token on juba kasutatud"

            expires = datetime.fromisoformat(t["expires_at"])
            if datetime.now() > expires:
                return None, "Token on aegunud"

            return t, None

    return None, "Token ei leitud"

def use_invite_token(token):
    """Märgib tokeni kasutatuks."""
    data = load_invite_tokens()

    for t in data["tokens"]:
        if t["token"] == token:
            t["used"] = True
            t["used_at"] = datetime.now().isoformat()
            save_invite_tokens(data)
            return True

    return False

def create_user_from_invite(token, password):
    """Loob kasutaja invite tokeni põhjal."""
    token_data, error = validate_invite_token(token)
    if error:
        return None, error

    email = token_data["email"]
    name = token_data["name"]

    # Genereeri kasutajanimi emaili põhjal
    username = email.split('@')[0].lower()
    username = re.sub(r'[^a-z0-9]', '', username)

    # Kontrolli, kas kasutajanimi on juba olemas
    users = load_users()
    base_username = username
    counter = 1
    while username in users:
        username = f"{base_username}{counter}"
        counter += 1

    # Loo uus kasutaja
    password_hash = hashlib.sha256(password.encode()).hexdigest()

    users[username] = {
        "password_hash": password_hash,
        "name": name,
        "email": email,
        "role": "contributor",
        "created_at": datetime.now().isoformat()
    }

    # Salvesta users.json
    with open(USERS_FILE, 'w', encoding='utf-8') as f:
        json.dump(users, f, ensure_ascii=False, indent=2)

    # Märgi token kasutatuks
    use_invite_token(token)

    print(f"Loodud uus kasutaja: {username} ({name})")
    return {"username": username, "name": name, "role": "contributor"}, None

# =========================================================
# PENDING-EDITS FUNKTSIOONID
# =========================================================

def load_pending_edits():
    """Laeb ootel muudatused."""
    if not os.path.exists(PENDING_EDITS_FILE):
        return {"pending_edits": []}
    with open(PENDING_EDITS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_pending_edits(data):
    """Salvestab ootel muudatused."""
    with open(PENDING_EDITS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def create_pending_edit(teose_id, lehekylje_number, user, original_text, new_text):
    """
    Loob uue pending-edit kirje.
    Kontrollib konflikte ja tagastab (edit, error) tuple.
    """
    data = load_pending_edits()

    # Arvuta base_text_hash konfliktide tuvastamiseks
    base_text_hash = hashlib.sha256(original_text.encode('utf-8')).hexdigest()

    # Kontrolli, kas sama kasutaja on juba teinud muudatuse samale lehele
    # Kui jah, siis kirjuta see üle
    existing_idx = None
    other_pending = False

    for idx, edit in enumerate(data["pending_edits"]):
        if edit["teose_id"] == teose_id and edit["lehekylje_number"] == lehekylje_number:
            if edit["status"] == "pending":
                if edit["user"] == user["username"]:
                    # Sama kasutaja - kirjutame üle
                    existing_idx = idx
                else:
                    # Teine kasutaja on juba muudatuse teinud
                    other_pending = True

    # Konflikti tüüp
    conflict_type = None
    if other_pending:
        conflict_type = "other_pending"

    new_edit = {
        "id": str(uuid.uuid4()),
        "teose_id": teose_id,
        "lehekylje_number": lehekylje_number,
        "user": user["username"],
        "user_name": user["name"],
        "role_at_submission": user["role"],
        "submitted_at": datetime.now().isoformat(),
        "original_text": original_text,
        "new_text": new_text,
        "base_text_hash": base_text_hash,
        "status": "pending",
        "has_conflict": other_pending,
        "conflict_type": conflict_type,
        "reviewed_by": None,
        "reviewed_at": None,
        "review_comment": None
    }

    if existing_idx is not None:
        # Asenda olemasolev
        data["pending_edits"][existing_idx] = new_edit
        print(f"Uuendatud pending-edit: {user['username']} -> {teose_id}/{lehekylje_number}")
    else:
        # Lisa uus
        data["pending_edits"].append(new_edit)
        print(f"Uus pending-edit: {user['username']} -> {teose_id}/{lehekylje_number}")

    save_pending_edits(data)

    return new_edit, None

def get_pending_edit_by_id(edit_id):
    """Leiab pending-edit ID järgi."""
    data = load_pending_edits()
    for edit in data["pending_edits"]:
        if edit["id"] == edit_id:
            return edit
    return None

def get_pending_edits_for_page(teose_id, lehekylje_number):
    """Tagastab kõik ootel muudatused konkreetse lehe jaoks."""
    data = load_pending_edits()
    return [
        edit for edit in data["pending_edits"]
        if edit["teose_id"] == teose_id
        and edit["lehekylje_number"] == lehekylje_number
        and edit["status"] == "pending"
    ]

def get_user_pending_edit_for_page(teose_id, lehekylje_number, username):
    """Tagastab kasutaja ootel muudatuse konkreetse lehe jaoks."""
    data = load_pending_edits()
    for edit in data["pending_edits"]:
        if (edit["teose_id"] == teose_id
            and edit["lehekylje_number"] == lehekylje_number
            and edit["user"] == username
            and edit["status"] == "pending"):
            return edit
    return None

def update_pending_edit_status(edit_id, status, reviewed_by, comment=None):
    """Uuendab pending-edit staatust."""
    data = load_pending_edits()
    for edit in data["pending_edits"]:
        if edit["id"] == edit_id:
            edit["status"] = status
            edit["reviewed_by"] = reviewed_by
            edit["reviewed_at"] = datetime.now().isoformat()
            if comment:
                edit["review_comment"] = comment
            save_pending_edits(data)
            return edit
    return None

def check_base_text_conflict(edit, current_text):
    """
    Kontrollib, kas originaaltekst on vahepeal muutunud.
    Tagastab True kui on konflikt.
    """
    current_hash = hashlib.sha256(current_text.encode('utf-8')).hexdigest()
    return current_hash != edit["base_text_hash"]

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

    # Kontrolli sessiooni aegumist (24h)
    created_at = datetime.fromisoformat(session["created_at"])
    if datetime.now() - created_at > SESSION_DURATION:
        # Eemalda aegunud sessioon
        del sessions[token]
        return None, {"status": "error", "message": "Sessioon aegunud (24h), palun logi uuesti sisse"}

    user = session["user"]

    # Rollide hierarhia kontroll
    # contributor = kaastööline (muudatused vajavad ülevaatust)
    # editor = toimetaja (muudatused rakenduvad kohe, saab kinnitada)
    # admin = administraator (kõik õigused)
    if min_role:
        role_hierarchy = {'contributor': 0, 'editor': 1, 'admin': 2}
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
    koht = metadata.get('koht')
    trükkal = metadata.get('trükkal')

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
        if koht: doc['koht'] = koht
        if trükkal: doc['trükkal'] = trükkal

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

def commit_new_work_to_git(dir_name):
    """Lisab uue teose txt failid Git reposse originaal-OCR commitina."""
    try:
        repo = get_or_init_repo()
        dir_path = os.path.join(BASE_DIR, dir_name)

        # Leia kõik txt failid kaustas
        txt_files = []
        for f in os.listdir(dir_path):
            if f.endswith('.txt'):
                relative_path = os.path.join(dir_name, f)
                txt_files.append(relative_path)

        if not txt_files:
            return False

        # Lisa failid indeksisse
        repo.index.add(txt_files)

        # Tee commit
        author = Actor("Automaatne", "auto@vutt.local")
        repo.index.commit(
            f"Originaal OCR: {dir_name} ({len(txt_files)} lehekülge)",
            author=author,
            committer=author
        )
        print(f"GIT: Lisatud uus teos {dir_name} ({len(txt_files)} txt faili)")
        return True
    except Exception as e:
        print(f"GIT viga uue teose lisamisel ({dir_name}): {e}")
        return False

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

                                # Lisa txt failid Giti originaal-OCR commitina
                                commit_new_work_to_git(entry.name)
                            except Exception as e:
                                print(f"Viga metaandmete loomisel ({entry.name}): {e}")
            
            # Oota 30 sekundit järgmise skannimiseni
            time.sleep(30)
        except Exception as e:
            print(f"Jälgija viga: {e}")
            time.sleep(60)

class RequestHandler(http.server.SimpleHTTPRequestHandler):
    # TODO: Pärast kindla domeeni saamist piirata CORS lubatud domeenidele
    # Praegu '*' lubab päringuid igalt poolt (sisevõrgus OK, avalikus mitte)
    # Näide: allowed_origins = ['https://vutt.ut.ee', 'http://localhost:5173']

    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        # GET /invite/{token} - tokeni kehtivuse kontroll (avalik)
        if self.path.startswith('/invite/'):
            token = self.path.split('/invite/')[1].split('?')[0]  # Eemalda query params

            try:
                token_data, error = validate_invite_token(token)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
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

        else:
            self.send_error(404)

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
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Nimi on kohustuslik"}).encode('utf-8'))
                    return

                if not email or '@' not in email:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Kehtiv e-posti aadress on kohustuslik"}).encode('utf-8'))
                    return

                if not motivation:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Motivatsioon on kohustuslik"}).encode('utf-8'))
                    return

                # Lisa taotlus
                registration, error = add_registration(name, email, affiliation, motivation)

                self.send_response(200 if registration else 400)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
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
                self.send_header('Access-Control-Allow-Origin', '*')
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
                relative_path = os.path.join(safe_catalog, safe_filename)

                # Küsime Git ajaloo
                history = get_file_git_history(relative_path, max_count=50)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
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
                    self.send_header('Access-Control-Allow-Origin', '*')
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
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    response = {"status": "error", "message": "Versiooni ei leitud"}
                    self.wfile.write(json.dumps(response).encode('utf-8'))
                    return

                print(f"Git restore: {commit_hash[:8]} -> {relative_path} (kasutaja: {user['username']})")

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
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
                    self.send_header('Access-Control-Allow-Origin', '*')
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
                self.send_header('Access-Control-Allow-Origin', '*')
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
            # Tagastab unikaalsed autorid, žanrid, kohad ja trükkalid soovitusteks
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
                places = set()
                printers = set()
                
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
                                    if meta.get('koht'):
                                        places.add(meta['koht'].strip())
                                    if meta.get('trükkal'):
                                        printers.add(meta['trükkal'].strip())
                            except:
                                continue
                
                # Lisa vaikimisi kohad ja trükkalid kui neid pole veel
                places.update(['Tartu', 'Pärnu'])
                printers.update(['Typis Academicis', 'Jacob Becker (Pistorius)', 'Johann Vogel (Vogelius)', 'Johann Brendeken'])
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                response = {
                    "status": "success",
                    "authors": sorted(list(authors)),
                    "tags": sorted(list(tags)),
                    "places": sorted(list(places)),
                    "printers": sorted(list(printers))
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
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return

                reg_data = load_pending_registrations()

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
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
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return

                reg_id = data.get('registration_id')
                if not reg_id:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "registration_id puudub"}).encode('utf-8'))
                    return

                # Leia taotlus
                reg = get_registration_by_id(reg_id)
                if not reg:
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Taotlust ei leitud"}).encode('utf-8'))
                    return

                if reg["status"] != "pending":
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
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
                self.send_header('Access-Control-Allow-Origin', '*')
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
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return

                reg_id = data.get('registration_id')
                if not reg_id:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "registration_id puudub"}).encode('utf-8'))
                    return

                reg = get_registration_by_id(reg_id)
                if not reg:
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Taotlust ei leitud"}).encode('utf-8'))
                    return

                if reg["status"] != "pending":
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Taotlus on juba käsitletud"}).encode('utf-8'))
                    return

                # Uuenda staatus
                update_registration_status(reg_id, "rejected", user["username"])

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
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
        # PAROOLI SEADMISE ENDPOINT
        # =========================================================

        elif self.path == '/invite/set-password':
            # Seab parooli invite tokeni abil (avalik)
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)

                token = data.get('token', '').strip()
                password = data.get('password', '')

                if not token:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Token puudub"}).encode('utf-8'))
                    return

                if not password or len(password) < 8:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Parool peab olema vähemalt 8 tähemärki"}).encode('utf-8'))
                    return

                # Loo kasutaja
                new_user, error = create_user_from_invite(token, password)

                self.send_response(200 if new_user else 400)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
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
                    self.send_header('Access-Control-Allow-Origin', '*')
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
                    self.send_header('Access-Control-Allow-Origin', '*')
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
                self.send_header('Access-Control-Allow-Origin', '*')
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
                    self.send_header('Access-Control-Allow-Origin', '*')
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
                self.send_header('Access-Control-Allow-Origin', '*')
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
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return

                teose_id = data.get('teose_id')
                lehekylje_number = data.get('lehekylje_number')

                if not teose_id or lehekylje_number is None:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
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
                self.send_header('Access-Control-Allow-Origin', '*')
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
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return

                edit_id = data.get('edit_id')
                comment = data.get('comment', '')

                if not edit_id:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "edit_id puudub"}).encode('utf-8'))
                    return

                edit = get_pending_edit_by_id(edit_id)
                if not edit:
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Muudatust ei leitud"}).encode('utf-8'))
                    return

                if edit["status"] != "pending":
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Muudatus on juba käsitletud"}).encode('utf-8'))
                    return

                # Leia fail
                dir_path = find_directory_by_id(edit["teose_id"])
                if not dir_path:
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Teost ei leitud"}).encode('utf-8'))
                    return

                # Leia .txt fail
                txt_files = sorted(glob.glob(os.path.join(dir_path, '*.txt')))
                if edit["lehekylje_number"] < 1 or edit["lehekylje_number"] > len(txt_files):
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
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
                self.send_header('Access-Control-Allow-Origin', '*')
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
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(auth_error).encode('utf-8'))
                    return

                edit_id = data.get('edit_id')
                comment = data.get('comment', '')

                if not edit_id:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "edit_id puudub"}).encode('utf-8'))
                    return

                edit = get_pending_edit_by_id(edit_id)
                if not edit:
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Muudatust ei leitud"}).encode('utf-8'))
                    return

                if edit["status"] != "pending":
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "message": "Muudatus on juba käsitletud"}).encode('utf-8'))
                    return

                # Märgi muudatus tagasilükatuks
                update_pending_edit_status(edit_id, "rejected", user["username"], comment)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
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