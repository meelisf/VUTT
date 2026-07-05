"""
Autentimise ja sessioonide haldus.
"""
import json
import os
import hashlib
import uuid
import threading
import time
import logging
import bcrypt
from datetime import datetime
from .cache import get_cached_collections
from .config import USERS_FILE, SESSION_DURATION
from .utils import atomic_write_json
from .heartbeat import mark_error, mark_success, register_job

logger = logging.getLogger(__name__)

# Sessioonide hoidla (token -> user info)
# NB: Serveri restart kustutab kõik sessioonid
sessions = {}
_sessions_lock = threading.Lock()

# Sessioonide puhastamise intervall (sekundites)
SESSION_CLEANUP_INTERVAL = 300  # 5 minutit
register_job("session_cleanup", interval_seconds=SESSION_CLEANUP_INTERVAL, description="Aegunud kasutajasessioonide puhastus")

# =========================================================
# ROLLIDE HIERARHIA — üks tõeallikas
# =========================================================
# contributor < editor < admin < superadmin. Eriõigus tuleb AINULT rollist,
# mitte kasutajanimest.
ROLE_HIERARCHY = {"contributor": 0, "editor": 1, "admin": 2, "superadmin": 3}


def role_level(role: str) -> int:
    """Tagastab rolli numbrilise taseme. Viskab ValueError tundmatu rolli peal.
    EI KUNAGI vaikselt tasemeks 0 — tundmatu roll on viga, mitte madal õigus."""
    try:
        return ROLE_HIERARCHY[role]
    except KeyError:
        raise ValueError(f"Tundmatu roll: {role!r}")


def is_valid_role(role: str) -> bool:
    """Kas roll on hierarhias? Kasuta API-sisendi valideerimiseks enne role_level-i."""
    return role in ROLE_HIERARCHY


def is_at_least(role: str, min_role: str) -> bool:
    """Kas roll on vähemalt min_role tasemel? Taseme-põhine võimekuse-kontroll.
    KASUTA seda täpse `role == "admin"` võrdluse asemel — superadmin loeb adminiks
    (ja administ kõrgemaks), muidu kukub superadmin admin-funktsioonidest välja."""
    return role_level(role) >= role_level(min_role)


def can_manage_user(actor_role: str, target_role: str) -> bool:
    """Kas actor tohib target-kasutajat üldse puutuda (reset / kustutus / rollimuutus)?
    Sihtmärgi praegune tase peab olema RANGELT madalam actor tasemest."""
    return role_level(target_role) < role_level(actor_role)


def can_assign_role(actor_role: str, new_role: str) -> bool:
    """Kas actor tohib MÄÄRATA rolli new_role? Lagi: rangelt madalam actor tasemest."""
    return role_level(new_role) < role_level(actor_role)


def can_change_role(actor_role: str, target_role: str, new_role: str) -> bool:
    """Rollimuutus = tohib target-i puutuda JA tohib uut rolli määrata."""
    return can_manage_user(actor_role, target_role) and can_assign_role(actor_role, new_role)


def has_superadmin(users: dict) -> bool:
    """Kas users-dictis on vähemalt üks superadmin? Startup-checki jaoks."""
    return any(u.get("role") == "superadmin" for u in users.values())


def warn_if_no_superadmin() -> bool:
    """Logib WARNING-u, kui üheski kasutajas pole superadmin rolli.
    Tagastab True, kui superadmin eksisteerib. Ei paranda automaatselt."""
    users = load_users()
    if has_superadmin(users):
        return True
    logger.warning(
        "ÜHTEGI superadmin rolliga kasutajat pole — admini- ja kollektsioonihalduse "
        "funktsioonid on lukus, kuni keegi seemendatakse superadminiks (users.json)."
    )
    return False


def _cleanup_expired_sessions():
    """Taustalõim, mis puhastab aegunud sessioonid perioodiliselt."""
    while True:
        time.sleep(SESSION_CLEANUP_INTERVAL)
        try:
            now = datetime.now()
            expired_tokens = []

            with _sessions_lock:
                for token, session in sessions.items():
                    created_at = datetime.fromisoformat(session["created_at"])
                    if now - created_at > SESSION_DURATION:
                        expired_tokens.append(token)

                for token in expired_tokens:
                    del sessions[token]

            mark_success("session_cleanup", detail={"removed": len(expired_tokens), "active": len(sessions)})
            if expired_tokens:
                print(f"Sessioonide puhastus: eemaldatud {len(expired_tokens)} aegunud sessiooni (aktiivseid: {len(sessions)})")
        except Exception as e:
            mark_error("session_cleanup", e)
            print(f"Sessioonide puhastuse viga: {e}")


# Käivita puhastuse taustalõim
_cleanup_thread = threading.Thread(target=_cleanup_expired_sessions, daemon=True)
_cleanup_thread.start()

# =========================================================
# KASUTAJATE CACHE
# Hoiab kasutajad mälus, et vältida faili lugemist igal päringul
# =========================================================
users_lock = threading.RLock()
_users_cache = None


def _load_users_from_file():
    """Laeb kasutajad failist (sisekasutuseks)."""
    if not os.path.exists(USERS_FILE):
        print(f"HOIATUS: Kasutajate fail puudub: {USERS_FILE}")
        print("Loo users.json fail koos kasutajatega. Näide:")
        print('  {"admin": {"password_hash": "<sha256>", "name": "Admin", "role": "contributor"}}')
        print("Parooli hashi saad: echo -n 'parool' | sha256sum")
        return {}

    with open(USERS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_users():
    """Tagastab kasutajad cache'ist, laeb failist vajadusel."""
    global _users_cache
    with users_lock:
        if _users_cache is None:
            _users_cache = _load_users_from_file()
            print(f"Kasutajate cache laetud: {len(_users_cache)} kasutajat")
        return _users_cache


def save_users(users):
    """Salvestab kasutajad JSON faili ja uuendab cache'i."""
    global _users_cache
    with users_lock:
        atomic_write_json(USERS_FILE, users)
        _users_cache = users  # Uuenda cache kohe


def reload_users_cache():
    """Sunnib cache'i uuesti laadima failist."""
    global _users_cache
    with users_lock:
        _users_cache = _load_users_from_file()
        print(f"Kasutajate cache uuesti laetud: {len(_users_cache)} kasutajat")
        return _users_cache


# Lae cache serveri stardil
load_users()


# Dummy bcrypt hash ajastuse-leke vältimiseks: kui kasutajat pole, jooksutame
# ikka bcrypt'i selle vastu, et vastuse aeg ei reedaks kasutajanime olemasolu
# (kasutajanime enumeratsioon ajastuse kaudu). Arvutatakse korra impordil.
_DUMMY_BCRYPT_HASH = bcrypt.hashpw(b"timing-equalizer", bcrypt.gensalt())


def hash_password(password: str) -> str:
    """Hashib parooli bcrypt-iga (soolaga)."""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_and_upgrade(username: str, password: str, users: dict) -> bool:
    """Kontrollib parooli ja uuendab SHA-256 hashi bcrypt-ile sisselogimisel."""
    stored = users[username]["password_hash"]
    if stored.startswith("$2b$") or stored.startswith("$2a$"):
        return bcrypt.checkpw(password.encode(), stored.encode())
    # SHA-256 tagasiühilduvus — uuenda bcrypt-ile
    if stored == hashlib.sha256(password.encode()).hexdigest():
        users[username]["password_hash"] = hash_password(password)
        save_users(users)
        return True
    return False


def verify_user(username, password):
    """Kontrollib kasutajanime ja parooli."""
    users = load_users()
    if username not in users:
        # Jooksuta bcrypt dummy hashi vastu, et vastuse aeg oleks sama nagu
        # olemasoleva kasutaja korral (ajastuse-leke / enumeratsiooni vältimine).
        bcrypt.checkpw(password.encode(), _DUMMY_BCRYPT_HASH)
        return None
    if not _verify_and_upgrade(username, password, users):
        return None
    return {
        "username": username,
        "name": users[username]["name"],
        "role": users[username].get("role", "contributor"),
        "allowed_collections": users[username].get("allowed_collections", []),
    }


def create_session(user):
    """Loob uue sessiooni ja tagastab tokeni."""
    token = str(uuid.uuid4())
    with _sessions_lock:
        sessions[token] = {
            "user": user,
            "created_at": datetime.now().isoformat()
        }
        count = len(sessions)
    print(f"Uus sessioon loodud: {user['username']} (aktiivseid sessioone: {count})")
    return token


def get_session(token):
    """Tagastab sessiooni tokeni järgi või None."""
    with _sessions_lock:
        return sessions.get(token)


def delete_session(token):
    """Kustutab sessiooni."""
    with _sessions_lock:
        sessions.pop(token, None)


def delete_user_sessions(username):
    """Kustutab kõik kasutaja aktiivsed sessioonid. Tagastab kustutatud sessioonide arvu.

    Kasutatakse kasutaja kustutamisel JA rolli muutmisel — sunnib kasutaja uuesti
    sisse logima, et roll/õigused jõustuksid kohe (sessioon hoiab user-hetktõmmist).
    """
    with _sessions_lock:
        tokens_to_delete = [
            token for token, session_data in sessions.items()
            if session_data["user"]["username"] == username
        ]
        for token in tokens_to_delete:
            del sessions[token]
    return len(tokens_to_delete)


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

    with _sessions_lock:
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
    if min_role:
        # role_level viskab tundmatu rolli peal — fail-closed, mitte vaikne madal õigus
        if role_level(user['role']) < role_level(min_role):
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
            "created_at": user_data.get("created_at"),
            "allowed_collections": user_data.get("allowed_collections", []),
        })
    # Sorteeri loomisaja järgi (uuemad ees), kui loomisaeg puudub, siis lõppu
    result.sort(key=lambda x: x.get("created_at") or "0000", reverse=True)
    return result


def update_user_role(username, new_role, admin_user):
    """
    Muudab kasutaja rolli.

    Args:
        username: Muudetava kasutaja kasutajanimi
        new_role: Uus roll ('contributor', 'editor', 'admin', 'superadmin')
        admin_user: Admin kasutaja, kes muudatuse teeb

    Returns:
        (success: bool, message: str)
    """
    # Valideeri sissetulev roll ENNE taseme-arvutust
    if not is_valid_role(new_role):
        return False, f"Vigane roll. Lubatud: {', '.join(ROLE_HIERARCHY.keys())}"

    # Admin ei saa oma rolli muuta (lukustumis-kaitse)
    if username == admin_user["username"]:
        return False, "Ei saa muuta enda rolli"

    users = load_users()

    if username not in users:
        return False, "Kasutajat ei leitud"

    target_current = users[username].get("role", "contributor")
    # Invariant: tohib target-i puutuda JA tohib uut rolli määrata
    if not can_change_role(admin_user["role"], target_current, new_role):
        return False, "Pole õigust seda kasutajat sellele rollile määrata"

    old_role = target_current
    users[username]["role"] = new_role
    save_users(users)

    # Invalideeri kasutaja sessioonid, et uus roll jõustuks kohe (sessioon hoiab
    # user-hetktõmmist) — sama muster nagu delete_user. Kasutaja peab uuesti sisse logima.
    invalidated = delete_user_sessions(username)

    # Tühista kasutaja pooleliolevad reset-tokenid (race-kaitse: rolli muutus võib
    # muuta privileegi-invarianti). Lazy import — väldib ring-importi password_reset ↔ auth.
    from .password_reset import revoke_user_reset_tokens
    revoke_user_reset_tokens(username, "role_changed")

    print(f"Admin '{admin_user['username']}' muutis kasutaja '{username}' rolli: {old_role} -> {new_role}. Invalideeritud {invalidated} sessiooni.")
    return True, "Roll muudetud"


def update_user_allowed_collections(username, collection_ids, admin_user):
    """Muudab kasutaja piiratud kollektsioonide ligipääsu (allowed_collections).

    Args:
        username: Muudetava kasutaja kasutajanimi
        collection_ids: Soovitud kollektsiooni-id-de list (kliendilt, valideerimata)
        admin_user: Admin kasutaja, kes muudatuse teeb

    Returns:
        (success: bool, message: str, allowed_collections: list[str])
        allowed_collections on serveris salvestatud (sanitiseeritud, deterministlikus
        järjekorras) nimekiri — see on tõe allikas, mille frontend state'i kirjutab.
        Vea korral on see [].
    """
    # Sisendi tüübikontroll (väldib nt stringi itereerimist tähtedeks)
    if not isinstance(username, str) or not username.strip():
        return False, "Kasutajanimi puudub", []
    if not isinstance(collection_ids, list):
        return False, "Vigane kollektsioonide nimekiri", []

    users = load_users()
    if username not in users:
        return False, "Kasutajat ei leitud", []

    # Õigus: AINULT keskne can_manage_user (rangelt madalam tase; superadmin integreeritud).
    # Blokeerib võrdse/kõrgema taseme ja iseenda — admini piiramine oleks niikuinii mõttetu.
    target_role = users[username].get("role", "contributor")
    if not can_manage_user(admin_user["role"], target_role):
        return False, "Pole õigust selle kasutaja kollektsioone muuta", []

    # Sanitiseerimine + deterministlik järjekord: jäta ainult olemasolevad restricted-id-d,
    # järjesta konfiguratsiooni restricted-kollektsioonide järjekorra järgi (stabiilne diff).
    collections_config = get_cached_collections()
    submitted = {c for c in collection_ids if isinstance(c, str)}
    restricted_ordered = [
        cid for cid, c in collections_config.items()
        if c.get("visibility") == "restricted"
    ]
    sanitized = [cid for cid in restricted_ordered if cid in submitted]

    # No-op kaitse: ära salvesta ega katkesta sessiooni asjatult
    old = users[username].get("allowed_collections", [])
    if old == sanitized:
        return True, "Kollektsioonid uuendatud", sanitized

    users[username]["allowed_collections"] = sanitized
    save_users(users)
    # Invalideeri sessioonid, et uus ligipääs jõustuks kohe (peegeldab kollektsiooni-poolset
    # CollectionEditor käitumist). Reset-tokeneid EI tühistata — ligipääs ei muuda rolli.
    delete_user_sessions(username)
    print(f"Admin '{admin_user['username']}' muutis kasutaja '{username}' kollektsioone: {old} -> {sanitized}")
    return True, "Kollektsioonid uuendatud", sanitized


def delete_user(username, admin_user):
    """
    Kustutab kasutaja.

    Args:
        username: Kustutatava kasutaja kasutajanimi
        admin_user: Admin kasutaja, kes kustutamise teeb

    Returns:
        (success: bool, message: str)
    """
    # Admin ei saa ennast kustutada (lukustumis-kaitse)
    if username == admin_user["username"]:
        return False, "Ei saa kustutada ennast"

    users = load_users()

    if username not in users:
        return False, "Kasutajat ei leitud"

    # Invariant: tohib kustutada ainult rangelt madalamat taset
    if not can_manage_user(admin_user["role"], users[username].get("role", "contributor")):
        return False, "Pole õigust seda kasutajat kustutada"

    deleted_name = users[username].get("name", username)
    del users[username]
    save_users(users)

    # Eemalda kasutaja aktiivsed sessioonid (lukuga, vt delete_user_sessions)
    removed = delete_user_sessions(username)

    from .password_reset import revoke_user_reset_tokens
    revoke_user_reset_tokens(username, "user_deleted")

    print(f"Admin '{admin_user['username']}' kustutas kasutaja '{username}' ({deleted_name}). Eemaldatud {removed} sessiooni.")
    return True, "Kasutaja kustutatud"
