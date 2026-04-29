"""
Kasutajate registreerimine ja invite tokenid.
"""
import json
import os
import re
import hashlib
import uuid
import threading
from datetime import datetime, timedelta
from .config import PENDING_REGISTRATIONS_FILE, INVITE_TOKENS_FILE, USERS_FILE, get_logger
from .auth import load_users, users_lock
from .utils import atomic_write_json

logger = get_logger(__name__)

# Lukud failioperatsioonide jaoks
registrations_lock = threading.RLock()
tokens_lock = threading.RLock()

# =========================================================
# REGISTREERIMISE FUNKTSIOONID
# =========================================================

def load_pending_registrations():
    """Laeb ootel registreerimistaotlused."""
    with registrations_lock:
        if not os.path.exists(PENDING_REGISTRATIONS_FILE):
            return {"registrations": []}
        with open(PENDING_REGISTRATIONS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)


def save_pending_registrations(data):
    """Salvestab ootel registreerimistaotlused (atomic write)."""
    with registrations_lock:
        atomic_write_json(PENDING_REGISTRATIONS_FILE, data)


def add_registration(name, email, affiliation, motivation, gdpr_consent=False):
    """Lisab uue registreerimistaotluse."""
    data = load_pending_registrations()

    # Kontrolli, kas sama email on juba ootel
    for reg in data["registrations"]:
        if reg["email"].lower() == email.lower() and reg["status"] == "pending":
            return None, "Selle e-posti aadressiga taotlus on juba ootel"

    # Kontrolli, kas sama email on juba kasutajate seas
    users = load_users()
    for username, user_data in users.items():
        if user_data.get("email", "").lower() == email.lower():
            return None, "Selle e-posti aadressiga kasutaja on juba olemas"

    registration = {
        "id": str(uuid.uuid4()),
        "name": name,
        "email": email.lower(),
        "username": suggest_username_for_email(email),
        "affiliation": affiliation,
        "motivation": motivation,
        "gdpr_consent_at": datetime.now().isoformat() if gdpr_consent else None,
        "submitted_at": datetime.now().isoformat(),
        "status": "pending",
        "reviewed_by": None,
        "reviewed_at": None
    }

    data["registrations"].append(registration)
    save_pending_registrations(data)

    logger.info(f"Uus registreerimistaotlus: {name} ({email})")
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
    with tokens_lock:
        if not os.path.exists(INVITE_TOKENS_FILE):
            return {"tokens": []}
        with open(INVITE_TOKENS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)


def save_invite_tokens(data):
    """Salvestab invite tokenid (atomic write)."""
    with tokens_lock:
        atomic_write_json(INVITE_TOKENS_FILE, data)


def _base_username_from_email(email):
    username = email.split('@')[0].lower()
    return re.sub(r'[^a-z0-9]', '', username)


def _next_available_username(email, tokens_data=None):
    username = _base_username_from_email(email)
    users = load_users()
    taken = set(users.keys())

    if tokens_data:
        now = datetime.now()
        for token in tokens_data.get("tokens", []):
            token_username = token.get("username")
            if not token_username or token.get("used"):
                continue
            try:
                if datetime.fromisoformat(token.get("expires_at", "")) < now:
                    continue
            except ValueError:
                continue
            taken.add(token_username)

    base_username = username
    counter = 1
    while username in taken:
        username = f"{base_username}{counter}"
        counter += 1

    return username


def suggest_username_for_email(email):
    """Tagastab e-posti põhjal järgmise vaba kasutajanime."""
    tokens_data = load_invite_tokens()
    pending_data = load_pending_registrations()
    users = load_users()
    taken = set(users.keys())

    for reg in pending_data.get("registrations", []):
        if reg.get("status") == "pending" and reg.get("username"):
            taken.add(reg["username"])

    now = datetime.now()
    for token in tokens_data.get("tokens", []):
        token_username = token.get("username")
        if not token_username or token.get("used"):
            continue
        try:
            if datetime.fromisoformat(token.get("expires_at", "")) < now:
                continue
        except ValueError:
            continue
        taken.add(token_username)

    username = _base_username_from_email(email)
    base_username = username
    counter = 1
    while username in taken:
        username = f"{base_username}{counter}"
        counter += 1
    return username


def create_invite_token(email, name, created_by, username=None):
    """Loob uue invite tokeni (kehtiv 48h)."""
    data = load_invite_tokens()

    token = str(uuid.uuid4())
    expires_at = datetime.now() + timedelta(hours=48)
    username = username or _next_available_username(email, data)

    token_data = {
        "token": token,
        "email": email.lower(),
        "username": username,
        "name": name,
        "created_at": datetime.now().isoformat(),
        "expires_at": expires_at.isoformat(),
        "created_by": created_by,
        "used": False
    }

    data["tokens"].append(token_data)
    save_invite_tokens(data)

    logger.info(f"Loodud invite token kasutajale {name} ({email})")
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


def _validate_and_consume_token(token):
    """Atomaarne: valideerib tokeni ja märgib kasutatuks ühe lukustatud sektsiooni sees.
    Tagastab (token_data, error). Ebaõnnestumise korral token jääb muutmata."""
    with tokens_lock:
        if not os.path.exists(INVITE_TOKENS_FILE):
            return None, "Token ei leitud"
        with open(INVITE_TOKENS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)

        token_obj = None
        for t in data["tokens"]:
            if t["token"] == token:
                token_obj = t
                break

        if token_obj is None:
            return None, "Token ei leitud"
        if token_obj["used"]:
            return None, "Token on juba kasutatud"
        expires = datetime.fromisoformat(token_obj["expires_at"])
        if datetime.now() > expires:
            return None, "Token on aegunud"

        token_obj["used"] = True
        token_obj["used_at"] = datetime.now().isoformat()
        atomic_write_json(INVITE_TOKENS_FILE, data)

        return dict(token_obj), None


def _unconsume_token(token):
    """Märgib tokeni tagasi kasutamata (kasutatakse rollback'iks kui kasutaja salvestamine ebaõnnestub)."""
    with tokens_lock:
        if not os.path.exists(INVITE_TOKENS_FILE):
            return
        with open(INVITE_TOKENS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        for t in data["tokens"]:
            if t["token"] == token:
                t["used"] = False
                t.pop("used_at", None)
                atomic_write_json(INVITE_TOKENS_FILE, data)
                logger.warning(f"Invite token taastatud (kasutaja salvestamine ebaõnnestus): {token[:8]}…")
                return


MIN_PASSWORD_LENGTH = 12
MIN_UNIQUE_CHARS = 4


def validate_password_strength(password):
    """Kontrollib parooli tugevust. Tagastab veateate stringina või None kui OK."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Parool peab olema vähemalt {MIN_PASSWORD_LENGTH} tähemärki pikk"
    if len(set(password)) < MIN_UNIQUE_CHARS:
        return "Parool on liiga lihtne (vähemalt 4 erinevat tähemärki nõutud)"
    if password == password[0] * len(password):
        return "Parool on liiga lihtne (korduvad tähemärgid)"
    return None


def create_user_from_invite(token, password):
    """Loob kasutaja invite tokeni põhjal."""
    # Serveripoolne paroolipoliitika
    pw_error = validate_password_strength(password)
    if pw_error:
        return None, pw_error

    # Atomaarne validate + consume — kaitseb race condition'i eest
    token_data, error = _validate_and_consume_token(token)
    if error:
        return None, error

    email = token_data["email"]
    name = token_data["name"]

    # Kasuta kutse loomisel arvutatud kasutajanime; vanade tokenite puhul tuleta e-posti põhjal.
    username = token_data.get("username") or _base_username_from_email(email)

    # Kontrolli, kas kasutajanimi on vahepeal kasutusse läinud
    users = load_users()
    base_username = username
    counter = 1
    while username in users:
        username = f"{base_username}{counter}"
        counter += 1

    # Loo uus kasutaja (vaikimisi editor-roll)
    # Vaikimisi roll on 'editor' (mitte 'contributor'), kuna pending-edits voog
    # pole veel implementeeritud. Muuta ainult koos /save endpointi uuendamisega.
    password_hash = hashlib.sha256(password.encode()).hexdigest()

    users[username] = {
        "password_hash": password_hash,
        "name": name,
        "email": email,
        "role": "editor",  # Oli: "contributor" - vt kommentaari ülal
        "created_at": datetime.now().isoformat()
    }

    # Salvesta users.json (atomic write + lock)
    # NB: token on juba tarbitud — kui salvestamine ebaõnnestub, taastame tokeni
    try:
        with users_lock:
            atomic_write_json(USERS_FILE, users)
    except Exception as e:
        _unconsume_token(token)
        logger.error(f"Kasutaja salvestamine ebaõnnestus ({username}): {e}")
        return None, "Kasutaja loomine ebaõnnestus, palun proovi uuesti"

    logger.info(f"Loodud uus kasutaja: {username} ({name})")
    return {"username": username, "name": name, "role": "editor"}, None
