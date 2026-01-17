"""
Kasutajate registreerimine ja invite tokenid.
"""
import json
import os
import re
import hashlib
import uuid
from datetime import datetime, timedelta
from .config import PENDING_REGISTRATIONS_FILE, INVITE_TOKENS_FILE, USERS_FILE
from .auth import load_users

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
