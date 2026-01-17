"""
Autentimise ja sessioonide haldus.
"""
import json
import os
import hashlib
import uuid
from datetime import datetime
from .config import USERS_FILE, SESSION_DURATION

# Sessioonide hoidla (token -> user info)
# NB: Serveri restart kustutab kõik sessioonid
sessions = {}


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


def save_users(users):
    """Salvestab kasutajad JSON faili."""
    with open(USERS_FILE, 'w', encoding='utf-8') as f:
        json.dump(users, f, ensure_ascii=False, indent=2)


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


def get_session(token):
    """Tagastab sessiooni tokeni järgi või None."""
    return sessions.get(token)


def delete_session(token):
    """Kustutab sessiooni."""
    if token in sessions:
        del sessions[token]


def require_token(data, min_role=None):
    """
    Kontrollib tokenit päringus.
    Tagastab (user, error_response) tuple.
    Kui autentimine õnnestub, on error_response None.
    min_role: 'contributor', 'editor', 'admin' - minimaalne nõutav roll
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


# Tagasiühilduvus
def require_auth(data, min_role=None):
    """DEPRECATED: Kasuta require_token() asemel."""
    return require_token(data, min_role)


# =========================================================
# KASUTAJATE HALDUS
# =========================================================

def get_all_users():
    """
    Tagastab kõigi kasutajate nimekirja (ilma paroolihashideta).
    """
    users = load_users()
    result = []
    for username, user_data in users.items():
        result.append({
            "username": username,
            "name": user_data.get("name", ""),
            "email": user_data.get("email", ""),
            "role": user_data.get("role", "contributor"),
            "created_at": user_data.get("created_at")
        })
    # Sorteeri loomisaja järgi (uuemad ees), kui loomisaeg puudub, siis lõppu
    result.sort(key=lambda x: x.get("created_at") or "0000", reverse=True)
    return result


def update_user_role(username, new_role, admin_user):
    """
    Muudab kasutaja rolli.

    Args:
        username: Muudetava kasutaja kasutajanimi
        new_role: Uus roll ('contributor', 'editor', 'admin')
        admin_user: Admin kasutaja, kes muudatuse teeb

    Returns:
        (success: bool, message: str)
    """
    # Kontrolli rolli kehtivust
    valid_roles = ['contributor', 'editor', 'admin']
    if new_role not in valid_roles:
        return False, f"Vigane roll. Lubatud: {', '.join(valid_roles)}"

    # Admin ei saa oma rolli muuta
    if username == admin_user["username"]:
        return False, "Ei saa muuta enda rolli"

    users = load_users()

    if username not in users:
        return False, "Kasutajat ei leitud"

    old_role = users[username].get("role", "contributor")
    users[username]["role"] = new_role
    save_users(users)

    print(f"Admin '{admin_user['username']}' muutis kasutaja '{username}' rolli: {old_role} -> {new_role}")
    return True, "Roll muudetud"


def delete_user(username, admin_user):
    """
    Kustutab kasutaja.

    Args:
        username: Kustutatava kasutaja kasutajanimi
        admin_user: Admin kasutaja, kes kustutamise teeb

    Returns:
        (success: bool, message: str)
    """
    # Admin ei saa ennast kustutada
    if username == admin_user["username"]:
        return False, "Ei saa kustutada ennast"

    users = load_users()

    if username not in users:
        return False, "Kasutajat ei leitud"

    # Eemalda kasutaja
    deleted_name = users[username].get("name", username)
    del users[username]
    save_users(users)

    # Eemalda kasutaja aktiivsed sessioonid
    tokens_to_delete = []
    for token, session_data in sessions.items():
        if session_data["user"]["username"] == username:
            tokens_to_delete.append(token)

    for token in tokens_to_delete:
        del sessions[token]

    print(f"Admin '{admin_user['username']}' kustutas kasutaja '{username}' ({deleted_name}). Eemaldatud {len(tokens_to_delete)} sessiooni.")
    return True, "Kasutaja kustutatud"
