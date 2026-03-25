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


def create_user_from_invite(token, password):
    """Loob kasutaja invite tokeni põhjal."""
    # Atomaarne validate + consume — kaitseb race condition'i eest
    token_data, error = _validate_and_consume_token(token)
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
    with users_lock:
        atomic_write_json(USERS_FILE, users)

    logger.info(f"Loodud uus kasutaja: {username} ({name})")
    return {"username": username, "name": name, "role": "editor"}, None
