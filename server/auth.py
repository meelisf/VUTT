"""
Autentimise ja sessioonide haldus.
"""
import json
import re
import os
import hashlib
import uuid
import threading
import time
import logging
import unicodedata
import bcrypt
from contextlib import contextmanager
from typing import Optional
from datetime import datetime
from .cache import get_cached_collections
from .collection_tree import is_collection_public
from .config import (USERS_FILE, SESSION_IDLE_TIMEOUT, SESSION_MAX_AGE, SESSIONS_FILE,
                     DELETED_USERNAMES_FILE)
from .utils import atomic_write_json
from .heartbeat import mark_error, mark_success, register_job

logger = logging.getLogger(__name__)

# =========================================================
# SESSIOONID (ADR 0046, ADR 0081)
# =========================================================
# Mälus olev hoidla on päringu teel ainus allikas: `token_key(token)` → kirje
# {user, created_at, last_seen}. Võti on tokeni SHA-256 — toortokenit ei hoita
# ei mälus ega kettal, nii et `state/sessions.json`-i lugeja ei saa sessiooni üle võtta.
#
# Püsikiht `SESSIONS_FILE`: restart/deploy ei logi välja. Kirjutusreeglid:
#   - loomine, kustutamine ja õiguste äravõtmine kirjutatakse KOHE (`_persist`) —
#     äravõetud sessioon ei tohi restardi järel kettalt tagasi tulla (ADR 0046 p 2);
#   - `last_seen` uueneb päringu teel AINULT mälus (get_user on `async def`, kettale
#     kirjutamine seal oleks blokeeriv I/O, ADR 0002); taustalõim kirjutab ta
#     `SESSION_FLUSH_INTERVAL` järel ja lifespan sulgemisel (`flush_sessions`).
# Muutjad, mis kutsuvad `_persist`-i, PEAVAD jooksma threadpool'is, mitte event-loopis.
sessions = {}
_sessions_lock = threading.Lock()
_persist_lock = threading.Lock()   # kirjutajate järjekord; _sessions_lock-i ei hoita I/O ajal
_version = 0             # suureneb igal muudatusel (_sessions_lock all)
_persisted_version = 0   # viimati kettale jõudnud versioon (_persist_lock all)

# Taustalõim: aegunute puhastus + last_seen'i kettale kirjutus.
SESSION_FLUSH_INTERVAL = 60
# last_seen'i ei puudutata sagedamini — iga päring ei pea versiooni tõstma.
SESSION_TOUCH_GRANULARITY = 60
register_job("session_cleanup", interval_seconds=SESSION_FLUSH_INTERVAL,
             description="Aegunud kasutajasessioonide puhastus ja püsikihi kirjutus")


def token_key(token: str) -> str:
    """Sessiooni võti: tokeni SHA-256 (hex)."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _session_expired(session: dict, now: datetime) -> bool:
    """Libisev aegumine ülempiiriga: tegevusetus > IDLE või vanus > MAX_AGE."""
    created_at = datetime.fromisoformat(session["created_at"])
    last_seen = datetime.fromisoformat(session.get("last_seen") or session["created_at"])
    return now - last_seen > SESSION_IDLE_TIMEOUT or now - created_at > SESSION_MAX_AGE


def _bump_locked():
    """Kutsuja hoiab `_sessions_lock`-i."""
    global _version
    _version += 1


def _persist():
    """Kirjutab hetke hoidla kettale, kui see on viimasest kirjutusest muutunud.

    Hetktõmmis võetakse `_persist_lock`-i SEES: hilisem kirjutaja näeb alati
    vähemalt sama uut versiooni, nii et vanem tõmmis ei saa uuemat üle kirjutada.
    `_sessions_lock`-i ei hoita kirjutuse ajal — päringu tee ei oota ketast.
    Tõrge logitakse, ei visata: mälu jääb kehtima, järgmine kirjutus proovib uuesti.
    """
    global _persisted_version
    with _persist_lock:
        with _sessions_lock:
            version = _version
            snapshot = {k: dict(v) for k, v in sessions.items()}
        if version <= _persisted_version:
            return
        try:
            atomic_write_json(SESSIONS_FILE, {"version": 1, "sessions": snapshot})
            _persisted_version = version
        except Exception as e:
            logger.error("Sessioonide püsikihi kirjutus ebaõnnestus: %s", e)


def flush_sessions():
    """Avalik: kirjutab ootel `last_seen`-id kettale (taustalõim, lifespan sulgemine)."""
    _persist()


def load_persisted_sessions():
    """Käivitusel: laeb kehtivad sessioonid kettalt. Vigane/puuduv fail → tühi hoidla
    (fail-closed: kasutaja logib uuesti sisse, keegi ei saa võõrast sessiooni)."""
    global _version, _persisted_version
    try:
        with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        stored = data.get("sessions") if isinstance(data, dict) else None
        if not isinstance(stored, dict):
            raise ValueError("oodatud {'sessions': {...}}")
    except FileNotFoundError:
        return 0
    except (OSError, ValueError) as e:
        logger.error("Sessioonide püsikiht loetamatu, alustan tühjalt: %s", e)
        return 0
    now = datetime.now()
    loaded = {}
    for key, session in stored.items():
        try:
            if (isinstance(key, str) and len(key) == 64 and isinstance(session, dict)
                    and isinstance(session.get("user"), dict)
                    and not _session_expired(session, now)):
                loaded[key] = session
        except (KeyError, TypeError, ValueError):
            continue   # üksik vigane kirje ei kuku teisi
    with _sessions_lock:
        sessions.update(loaded)
        _bump_locked()
    _persist()   # aegunud/vigased kirjed kettalt maha
    return len(loaded)

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


def cleanup_expired_sessions() -> int:
    """Eemaldab aegunud sessioonid ja kirjutab püsikihi (ka ootel last_seen-id)."""
    now = datetime.now()
    with _sessions_lock:
        expired = [k for k, s in sessions.items() if _session_expired(s, now)]
        for k in expired:
            del sessions[k]
        if expired:
            _bump_locked()
    _persist()
    return len(expired)


def _cleanup_expired_sessions():
    """Taustalõim: aegunute puhastus + last_seen'i kettale kirjutus."""
    while True:
        time.sleep(SESSION_FLUSH_INTERVAL)
        try:
            removed = cleanup_expired_sessions()
            mark_success("session_cleanup", detail={"removed": removed, "active": len(sessions)})
            if removed:
                print(f"Sessioonide puhastus: eemaldatud {removed} aegunud sessiooni (aktiivseid: {len(sessions)})")
        except Exception as e:
            mark_error("session_cleanup", e)
            print(f"Sessioonide puhastuse viga: {e}")


# Puhastuse taustalõim käivitatakse `start_background()`-is, MITTE impordil:
# pildiserver impordib `auth`-i paketi kaudu ja lõimel pole seal tööd (#412 p5).
_cleanup_thread = None

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


@contextmanager
def users_transaction():
    """Kogu loe-kontrolli-muuda-salvesta tsükkel ühe luku all (ADR 0043 p3).

    `load_users()` tagastab JAGATUD `_users_cache` objekti — mitte koopia.
    Kui üks lõim muudab seda dicti sel ajal, kui teine seda `atomic_write_json`-is
    serialiseerib, kirjutatakse ketta peale olek, mida kumbki kutsuja ei palunud.
    `save_users` sees olev lukk kaitseb ainult kirjutamist, mitte kontrolli ja
    muutmist enne seda.

    `users_lock` on RLock, seega `save_users(users)` tohib olla bloki SEES.
    Sisse EI panda aeglast kõrvaltegevust (sessioonid, tokenid, e-kiri,
    parooliräsi) — see hoiaks lukku ilma põhjuseta.
    """
    with users_lock:
        yield load_users()


class DeletedUsernamesCorrupt(Exception):
    """Register on olemas, aga loetamatu.

    Tühjana käsitlemine annaks kustutatud nime uuesti välja — seepärast
    katkestab see konto loomise ja kustutamise, mitte ei jää vaikselt vahele.
    """


_deleted_usernames_cache = None


def _load_deleted_usernames_from_file():
    if not os.path.exists(DELETED_USERNAMES_FILE):
        return set()
    try:
        with open(DELETED_USERNAMES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        raise DeletedUsernamesCorrupt(str(e))
    if not isinstance(data, list) or any(not isinstance(x, str) for x in data):
        raise DeletedUsernamesCorrupt("oodatud on stringide list")
    return set(data)


def load_deleted_usernames():
    """Mälus hoitav `set`: konto loomise nimekontroll on O(1) liikmesuskontroll,
    mitte töökollektsioonide failide skann."""
    global _deleted_usernames_cache
    with users_lock:
        if _deleted_usernames_cache is None:
            _deleted_usernames_cache = _load_deleted_usernames_from_file()
        return _deleted_usernames_cache


def is_username_reserved(username):
    return username in load_deleted_usernames()


def reserve_username(username):
    """Lisab nime registrisse. Cache avaldatakse alles EDUKA kirjutuse järel.

    Kutsutakse ENNE konto eemaldamise salvestust: kui see kukub, jääb konto
    alles ja kustutamist saab uuesti proovida. Vastupidises järjekorras jääks
    konto kustutatuks ja nimi vabaks — just see, mida register välistab.
    """
    global _deleted_usernames_cache
    with users_lock:
        praegu = load_deleted_usernames()
        if username in praegu:
            return
        uus = sorted(praegu | {username})
        atomic_write_json(DELETED_USERNAMES_FILE, uus)
        _deleted_usernames_cache = set(uus)


def users_role_snapshot():
    """Kasutajanimi → roll, KOPEERITUD `users_lock` all (ADR 0043 p3).

    Lukk vabaneb enne tagastust — kutsuja võtab seejärel `_work_sets_lock`-i.
    Kahte lukku ei hoita kunagi korraga ja kasutajalukku ei võeta koguluku sees.
    Vahepealne kasutaja kustutamine talutakse inertse jäänukina, mitte
    failideülese tehinguna.
    """
    with users_lock:
        return {u: d.get("role", "contributor") for u, d in load_users().items()}


def start_background():
    """API-serveri käivitus (FastAPI lifespan): kasutajate cache + sessioonipuhastus.

    Impordil neid ei tehta — `vutt-images` ei mounti `state/`-i ja logis muidu
    iga käivituse peale „Kasutajate fail puudub" (#412 p5). Kordus on no-op.
    """
    global _cleanup_thread
    load_users()
    if _cleanup_thread is None:
        # Püsisessioonid ENNE esimest päringut (lifespan kutsub enne yield'i).
        restored = load_persisted_sessions()
        if restored:
            print(f"Sessioonid taastatud püsikihist: {restored}")
        _cleanup_thread = threading.Thread(
            target=_cleanup_expired_sessions, daemon=True, name="session-cleanup",
        )
        _cleanup_thread.start()


# Dummy bcrypt hash ajastuse-leke vältimiseks: kui kasutajat pole, jooksutame
# ikka bcrypt'i selle vastu, et vastuse aeg ei reedaks kasutajanime olemasolu
# (kasutajanime enumeratsioon ajastuse kaudu). Arvutatakse korra impordil.
_DUMMY_BCRYPT_HASH = bcrypt.hashpw(b"timing-equalizer", bcrypt.gensalt())


# bcrypt (5.x) keeldub pikemast sisendist ValueError-iga. Täpitäht on UTF-8-s
# 2 baiti, seega piir on baitides, mitte märkides.
MAX_PASSWORD_BYTES = 72


def normalize_password(password: str) -> str:
    """Sama „õ" võib tulla ühe (NFC) või kahe koodipunktina (o + kombineeruv
    tilde, NFD). Hash ja kontroll käivad alati NFC kujult."""
    return unicodedata.normalize("NFC", password)


def password_bytes(password: str) -> bytes:
    return normalize_password(password).encode()


def hash_password(password: str) -> str:
    """Hashib parooli bcrypt-iga (soolaga)."""
    return bcrypt.hashpw(password_bytes(password), bcrypt.gensalt()).decode()


def _checkpw(password: bytes, stored: bytes) -> bool:
    # Üle piiri sisend ei saa ühegi salvestatud hashiga klappida (seadmisel
    # keelatud) — ära lase bcryptil visata, sisselogimine annaks muidu 500.
    if len(password) > MAX_PASSWORD_BYTES:
        return False
    return bcrypt.checkpw(password, stored)


def _verify_and_upgrade(username: str, password: str, users: dict) -> bool:
    """Kontrollib parooli ja uuendab SHA-256 hashi bcrypt-ile sisselogimisel."""
    stored = users[username]["password_hash"]
    # Enne NFC-normaliseerimist tehtud hash võib kanda sisestuse toorbaite —
    # need proovitakse teisena, et vana NFD-paroolini kasutaja välja ei jääks.
    kandidaadid = [password_bytes(password)]
    if password.encode() != kandidaadid[0]:
        kandidaadid.append(password.encode())
    if stored.startswith("$2b$") or stored.startswith("$2a$"):
        return any(_checkpw(k, stored.encode()) for k in kandidaadid)
    # SHA-256 tagasiühilduvus — uuenda bcrypt-ile
    if any(stored == hashlib.sha256(k).hexdigest() for k in kandidaadid):
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
        bcrypt.checkpw(password_bytes(password)[:MAX_PASSWORD_BYTES], _DUMMY_BCRYPT_HASH)
        return None
    if not _verify_and_upgrade(username, password, users):
        return None
    return {
        "username": username,
        "name": users[username]["name"],
        "role": users[username].get("role", "contributor"),
        "allowed_collections": users[username].get("allowed_collections", []),
        "edit_collections": users[username].get("edit_collections", []),
    }


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_EMAIL_LEN = 254


def normalize_email(email) -> Optional[str]:
    """Kärbitud väiketähtedes aadress või None, kui kuju ei kõlba."""
    if not isinstance(email, str):
        return None
    email = email.strip().lower()
    if not email or len(email) > MAX_EMAIL_LEN or not _EMAIL_RE.match(email):
        return None
    return email


def set_own_email(username: str, email: str) -> Optional[str]:
    """Salvestab kasutaja e-posti. Tagastab veakoodi või None.

    Parooli kontroll on kutsuja töö ENNE seda (bcrypt ei käi luku all).
    Aadress on unikaalne nagu registreerimisel (`add_registration`): sama
    aadress kahel kontol teeks parooli taastamise mitmeseks.
    """
    with users_transaction() as users:
        if username not in users:
            return "unknown_user"
        for teine, andmed in users.items():
            if teine != username and (andmed.get("email") or "").lower() == email:
                return "email_taken"
        if users[username].get("email") == email:
            return None
        users[username]["email"] = email
        save_users(users)
    return None


def create_session(user):
    """Loob uue sessiooni ja tagastab tokeni. Kirjutab püsikihi → kutsu threadpool'ist."""
    token = str(uuid.uuid4())
    now = datetime.now().isoformat()
    with _sessions_lock:
        sessions[token_key(token)] = {"user": user, "created_at": now, "last_seen": now}
        _bump_locked()
        count = len(sessions)
    _persist()
    print(f"Uus sessioon loodud: {user['username']} (aktiivseid sessioone: {count})")
    return token


def get_session(token):
    """Tagastab sessiooni tokeni järgi või None."""
    with _sessions_lock:
        return sessions.get(token_key(token))


def delete_session(token):
    """Kustutab sessiooni (logout). Kirjutab püsikihi → kutsu threadpool'ist."""
    with _sessions_lock:
        if sessions.pop(token_key(token), None) is not None:
            _bump_locked()
    _persist()


def delete_user_sessions(username):
    """Kustutab kõik kasutaja aktiivsed sessioonid. Tagastab kustutatud sessioonide arvu.

    Kasutatakse kasutaja kustutamisel JA rolli/õiguste muutmisel — sunnib kasutaja uuesti
    sisse logima, et roll/õigused jõustuksid kohe (sessioon hoiab user-hetktõmmist).
    Püsikiht kirjutatakse KOHE: äravõetud sessioon ei tohi restardi järel tagasi tulla.
    """
    with _sessions_lock:
        keys_to_delete = [
            key for key, session_data in sessions.items()
            if session_data["user"]["username"] == username
        ]
        for key in keys_to_delete:
            del sessions[key]
        if keys_to_delete:
            _bump_locked()
    _persist()
    return len(keys_to_delete)


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

    key = token_key(token)
    now = datetime.now()
    with _sessions_lock:
        session = sessions.get(key)
        if not session:
            return None, {"status": "error", "message": "Sessioon aegunud, palun logi uuesti sisse"}

        # Libisev aegumine ülempiiriga (ADR 0081). Eemaldus ainult mälus — kettalt
        # koristab taustalõim; aegunud kirjet ei laeta ka käivitusel.
        if _session_expired(session, now):
            del sessions[key]
            _bump_locked()
            return None, {"status": "error", "message": "Sessioon aegunud, palun logi uuesti sisse"}

        # Tegevus pikendab sessiooni. AINULT mälus (see tee võib olla event-loopis);
        # kettale jõuab taustalõimega. Mitte sagedamini kui SESSION_TOUCH_GRANULARITY.
        last_seen = datetime.fromisoformat(session.get("last_seen") or session["created_at"])
        if (now - last_seen).total_seconds() >= SESSION_TOUCH_GRANULARITY:
            session["last_seen"] = now.isoformat()
            _bump_locked()

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
            "edit_collections": user_data.get("edit_collections", []),
        })
    # Sorteeri loomisaja järgi (uuemad ees), kui loomisaeg puudub, siis lõppu
    result.sort(key=lambda x: x.get("created_at") or "0000", reverse=True)
    return result


def _revoke_agent_handoffs(username):
    """MCP agendikoodid (ADR 0058) kehtivad kuni 8 h ja on seotud KASUTAJAGA —
    konto kustutamine või rolli muutus peab need tühistama nagu sessioonid (#619).
    Ootel ettepanekud jäävad: neid kinnitab sisselogitud toimetaja. Tõrge ei
    katkesta haldustoimingut — kood aegub niikuinii."""
    from . import agent_handoff
    try:
        agent_handoff.revoke_user(username)
    except Exception as e:
        print(f"MCP koodide tühistus ebaõnnestus ({username}): {e}")


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

    with users_transaction() as users:
        if username not in users:
            return False, "Kasutajat ei leitud"

        target_current = users[username].get("role", "contributor")
        # Invariant: tohib target-i puutuda JA tohib uut rolli määrata
        if not can_change_role(admin_user["role"], target_current, new_role):
            return False, "Pole õigust seda kasutajat sellele rollile määrata"

        old_role = target_current
        users[username]["role"] = new_role
        save_users(users)

    # Sessioonide ja tokenite käsitlus on TEADLIKULT luku VÄLJAS: nad võtavad
    # oma lukud ja pesastamine tekitaks lukujärjekorra-sõltuvuse.
    # Invalideeri kasutaja sessioonid, et uus roll jõustuks kohe (sessioon hoiab
    # user-hetktõmmist) — sama muster nagu delete_user. Kasutaja peab uuesti sisse logima.
    invalidated = delete_user_sessions(username)

    # Tühista kasutaja pooleliolevad reset-tokenid (race-kaitse: rolli muutus võib
    # muuta privileegi-invarianti). Lazy import — väldib ring-importi password_reset ↔ auth.
    from .password_reset import revoke_user_reset_tokens
    revoke_user_reset_tokens(username, "role_changed")
    _revoke_agent_handoffs(username)

    print(f"Admin '{admin_user['username']}' muutis kasutaja '{username}' rolli: {old_role} -> {new_role}. Invalideeritud {invalidated} sessiooni.")
    return True, "Roll muudetud"


def sanitize_edit_collections(collection_ids, collections_config):
    """Ühine sanitiseerimine kirjutamisulatuse (edit_collections) jaoks.

    Jätab alles ainult string-tüüpi id-d, mis eksisteerivad `collections_config`-is
    JA EI OLE `virtual_group` — teosele ei saagi virtuaalset gruppi kunagi määrata
    (vt frontend `MetadataModal.tsx`), seega ei saa see olla ka mõistlik
    kirjutamisulatuse liige (ADR 0031). Server on tõe allikas, mitte UI: sama
    reeglit jõustab ka delta-tee (`apply_collection_rights_delta` lükkab
    virtuaalse rühma tagasi) ja seda helperit kasutab konto loomishetkel
    `registration.create_invite_token` — kirjutajad ei tohi lahkneda.

    Vigane sisend (mitte list) → tühi ulatus (fail-closed), mitte erind.
    Tulemus on konfiguratsiooni järjekorras (deterministlik, stabiilne diff).
    """
    if not isinstance(collection_ids, list):
        return []
    submitted = {c for c in collection_ids if isinstance(c, str)}
    return [
        cid for cid, c in collections_config.items()
        if cid in submitted and c.get("type") != "virtual_group"
    ]


_RIGHTS_FIELDS = {"allowed": "allowed_collections", "edit": "edit_collections"}


def apply_collection_rights_delta(changes, admin_user):
    """Muudab AINULT nimetatud määranguid (ADR 0043 p2).

    Vana täisasendus (`update_user_allowed_collections`) kirjutas terve loendi
    üle ja võis avalikuks muutunud kogu ID sanitiseerimisel vaikselt maha võtta.
    Delta puudutab ainult loetletud (kasutaja, kogu, väli) kolmikuid; teised
    kasutajad ja kogud jäävad puutumata.

    Kogu pakett valideeritakse ENNE ühtki muudatust: vea korral ei rakendu
    sellest midagi. Tagastab (ok, sõnum, kinnitatud_olek), kus kinnitatud_olek
    katab ainult puudutatud kasutajaid — klient kirjutab selle oma state'i,
    mitte oma optimistlikku oletust.
    """
    if not isinstance(changes, list):
        return False, "Vigane muudatuste nimekiri", {}

    collections_config = get_cached_collections()

    # 1) Kuju ja vastuolude kontroll
    soovid = {}  # (username, field, collection_id) -> "add" | "remove"
    for muudatus in changes:
        if not isinstance(muudatus, dict):
            return False, "Vigane muudatus", {}
        username = muudatus.get("username")
        collection_id = muudatus.get("collection_id")
        field = muudatus.get("field")
        action = muudatus.get("action")
        if not isinstance(username, str) or not username.strip():
            return False, "Kasutajanimi puudub", {}
        if not isinstance(collection_id, str) or not collection_id.strip():
            return False, "Kollektsiooni ID puudub", {}
        if field not in _RIGHTS_FIELDS:
            return False, "field peab olema 'allowed' või 'edit'", {}
        if action not in ("add", "remove"):
            return False, "action peab olema 'add' või 'remove'", {}
        voti = (username, field, collection_id)
        if voti in soovid and soovid[voti] != action:
            return False, f"Vastuoluline kordus: {username}/{collection_id}/{field}", {}
        soovid[voti] = action

    # 2) Sisuline valideerimine (kogu pakett ENNE muutmist) ja 3) rakendamine
    #    sama luku all — vahepealne rollimuutus ei tohi valideerimist möödutada.
    with users_transaction() as users:
        for (username, field, collection_id), action in soovid.items():
            if username not in users:
                return False, f"Kasutajat '{username}' ei leitud", {}
            target_role = users[username].get("role", "contributor")
            if not can_manage_user(admin_user["role"], target_role):
                return False, f"Pole õigust kasutaja '{username}' õigusi muuta", {}
            if action == "remove":
                # Eemaldamine on koristustoiming: puuduv või avalikuks muutunud
                # kogu ID tohib alati maha võtta.
                continue
            kogu = collections_config.get(collection_id)
            if kogu is None:
                return False, f"Kollektsiooni '{collection_id}' ei leitud", {}
            # Kehtiv nähtavus (#617): avaliku määranguga alamkogu privaatse
            # vanema all on privaatne ja lugemisõigus on talle mõtekas.
            if field == "allowed" and is_collection_public(collection_id, collections_config):
                return False, (f"Kollektsioon '{collection_id}' on avalik — "
                               f"lugemisõiguse määrangut ei lisata"), {}
            if field == "edit" and kogu.get("type") == "virtual_group":
                return False, (f"Virtuaalsele rühmale '{collection_id}' "
                               f"kirjutamisulatust ei määrata"), {}

        jarjekord = list(collections_config.keys())
        muutunud = set()
        for (username, field, collection_id), action in soovid.items():
            vali = _RIGHTS_FIELDS[field]
            praegu = list(users[username].get(vali, []))
            if action == "add" and collection_id not in praegu:
                praegu.append(collection_id)
            elif action == "remove" and collection_id in praegu:
                praegu = [c for c in praegu if c != collection_id]
            else:
                continue  # juba soovitud olekus
            # Deterministlik järjekord: konfiguratsiooni oma, tundmatud lõppu.
            praegu.sort(key=lambda c: (jarjekord.index(c) if c in jarjekord
                                       else len(jarjekord), c))
            users[username][vali] = praegu
            muutunud.add(username)

        if muutunud:
            save_users(users)

        kinnitatud = {
            u: {
                "allowed_collections": list(users[u].get("allowed_collections", [])),
                "edit_collections": list(users[u].get("edit_collections", [])),
            }
            for u in {kasutaja for kasutaja, _, _ in soovid}
        }

    # Sessioonid luku VÄLJAS, üks kord muutunud inimese kohta: viis muudetud
    # kasutajat = viie inimese sessioonide lõpp, aga ühe inimese kaks muudatust
    # ei logi teda kaks korda välja.
    for username in sorted(muutunud):
        delete_user_sessions(username)

    return True, "Õigused uuendatud", kinnitatud


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

    with users_transaction() as users:
        if username not in users:
            return False, "Kasutajat ei leitud"

        # Invariant: tohib kustutada ainult rangelt madalamat taset
        if not can_manage_user(admin_user["role"], users[username].get("role", "contributor")):
            return False, "Pole õigust seda kasutajat kustutada"

        deleted_name = users[username].get("name", username)
        try:
            # Reserveering ENNE konto eemaldamist (ADR 0043 p8): kirjutusviga
            # jätab konto alles, mitte ei vabasta nime.
            reserve_username(username)
        except (DeletedUsernamesCorrupt, OSError) as e:
            print(f"Kustutamine katkestatud: nimeregistri kirjutus ebaõnnestus ({username}): {e}")
            return False, "Kasutajanime registreerimine ebaõnnestus, proovi uuesti"
        del users[username]
        save_users(users)

    # Eemalda kasutaja aktiivsed sessioonid (lukuga, vt delete_user_sessions)
    removed = delete_user_sessions(username)

    from .password_reset import revoke_user_reset_tokens
    revoke_user_reset_tokens(username, "user_deleted")
    _revoke_agent_handoffs(username)

    print(f"Admin '{admin_user['username']}' kustutas kasutaja '{username}' ({deleted_name}). Eemaldatud {removed} sessiooni.")
    return True, "Kasutaja kustutatud"
