"""
Parooli-taastamise tokenid (admini-algatatud).

Eraldatud invite-voost (``registration.py``): invite = loo UUS kasutaja,
reset = muuda OLEMASOLEVAT kasutajat. Tokenid ``state/reset_tokens.json``
(runtime, ei ole gitis). Kohaletoimetamine (lingi saatmine) on kutsuja
vastutus — SMTP-valmis.
"""
import json
import os
import threading
import uuid
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple

from .auth import delete_user_sessions, hash_password, load_users, save_users
from .config import RESET_TOKENS_FILE, get_logger
from .registration import validate_password_strength  # taaskasuta paroolipoliitikat
from .utils import atomic_write_json

logger = get_logger(__name__)

reset_tokens_lock = threading.RLock()

RESET_TOKEN_TTL_HOURS = 24      # lühem kui invite (48h) — turvalisem
RESET_TOKEN_RETENTION_DAYS = 7  # passiivne puhastus: vanemad aegunud kirjed kustutatakse


def load_reset_tokens() -> Dict:
    """Laeb reset-tokenid (loob tühja struktuuri kui faili pole)."""
    with reset_tokens_lock:
        if not os.path.exists(RESET_TOKENS_FILE):
            return {"tokens": []}
        with open(RESET_TOKENS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)


def save_reset_tokens(data: Dict) -> None:
    """Salvestab reset-tokenid (atomic write)."""
    with reset_tokens_lock:
        atomic_write_json(RESET_TOKENS_FILE, data)


def _is_active(token_obj: Dict, now: datetime) -> bool:
    """Token on aktiivne: mitte kasutatud, mitte tühistatud, mitte aegunud."""
    if token_obj.get("used") or token_obj.get("revoked"):
        return False
    try:
        return datetime.fromisoformat(token_obj["expires_at"]) >= now
    except (ValueError, KeyError):
        return False


def _prune_old(tokens: list, now: datetime) -> list:
    """Eemaldab kirjed, mille expires_at on rohkem kui RETENTION_DAYS päeva minevikus."""
    cutoff = now - timedelta(days=RESET_TOKEN_RETENTION_DAYS)
    kept = []
    for t in tokens:
        try:
            if datetime.fromisoformat(t["expires_at"]) >= cutoff:
                kept.append(t)
        except (ValueError, KeyError):
            kept.append(t)  # parssimata kirje — hoia alles (ära kaota vaikselt)
    return kept


def create_reset_token(username: str, created_by: str) -> Tuple[Optional[Dict], Optional[str]]:
    """Loob reset-tokeni olemasolevale kasutajale.

    - Kontrollib, et kasutaja on olemas.
    - Passiivne puhastus (> RETENTION_DAYS aegunud kirjed).
    - Tühistab sama kasutaja varasemad aktiivsed tokenid (superseded).
    Tagastab (token_data, error).
    """
    users = load_users()
    if username not in users:
        return None, "Kasutajat ei leitud"

    with reset_tokens_lock:
        data = load_reset_tokens()
        now = datetime.now()
        data["tokens"] = _prune_old(data.get("tokens", []), now)

        # Tühista sama kasutaja varasemad aktiivsed tokenid
        for t in data["tokens"]:
            if t.get("username") == username and _is_active(t, now):
                t["revoked"] = True
                t["revoked_at"] = now.isoformat()
                t["revocation_reason"] = "superseded"

        token = str(uuid.uuid4())
        token_data = {
            "token": token,
            "username": username,
            "name": users[username].get("name", username),
            "created_at": now.isoformat(),
            "expires_at": (now + timedelta(hours=RESET_TOKEN_TTL_HOURS)).isoformat(),
            "created_by": created_by,
            "used": False,
            "used_at": None,
            "revoked": False,
            "revoked_at": None,
            "revocation_reason": None,
        }
        data["tokens"].append(token_data)
        save_reset_tokens(data)

    logger.info(f"Loodud reset-token kasutajale {username} (looja: {created_by})")
    return token_data, None


def validate_reset_token(token: str) -> Tuple[Optional[Dict], Optional[str]]:
    """Kontrollib reset-tokeni kehtivust. Tagastab (token_data, error)."""
    data = load_reset_tokens()
    now = datetime.now()
    for t in data.get("tokens", []):
        if t["token"] == token:
            if t.get("used"):
                return None, "Link on juba kasutatud"
            if t.get("revoked"):
                return None, "Link on tühistatud (loodi uuem link või kasutaja muutus)"
            try:
                if datetime.fromisoformat(t["expires_at"]) < now:
                    return None, "Link on aegunud"
            except (ValueError, KeyError):
                return None, "Vigane token"
            return t, None
    return None, "Link ei leitud"


def revoke_user_reset_tokens(username: str, reason: str) -> int:
    """Tühistab kasutaja kõik aktiivsed (kasutamata, mitte-tühistatud) tokenid.

    Kasutatakse race-kaitseks: rolli muutus (``role_changed``) / kustutus
    (``user_deleted``) tühistab pooleliolevad reset-lingid. Tagastab tühistatud arvu.
    """
    with reset_tokens_lock:
        data = load_reset_tokens()
        now = datetime.now()
        count = 0
        for t in data.get("tokens", []):
            if t.get("username") == username and _is_active(t, now):
                t["revoked"] = True
                t["revoked_at"] = now.isoformat()
                t["revocation_reason"] = reason
                count += 1
        if count:
            save_reset_tokens(data)
            logger.info(f"Tühistatud {count} reset-tokenit kasutajale {username} (põhjus: {reason})")
        return count


def _validate_and_consume_token(token: str) -> Tuple[Optional[Dict], Optional[str]]:
    """Atomaarne: valideerib + märgib kasutatuks ühe lukustatud sektsiooni sees."""
    with reset_tokens_lock:
        data = load_reset_tokens()
        now = datetime.now()
        for t in data.get("tokens", []):
            if t["token"] == token:
                if t.get("used"):
                    return None, "Link on juba kasutatud"
                if t.get("revoked"):
                    return None, "Link on tühistatud"
                try:
                    if datetime.fromisoformat(t["expires_at"]) < now:
                        return None, "Link on aegunud"
                except (ValueError, KeyError):
                    return None, "Vigane token"
                t["used"] = True
                t["used_at"] = now.isoformat()
                save_reset_tokens(data)
                return dict(t), None
        return None, "Link ei leitud"


def _unconsume_token(token: str) -> None:
    """Märgib tokeni tagasi kasutamata (rollback, kui parooli salvestus ebaõnnestub)."""
    with reset_tokens_lock:
        data = load_reset_tokens()
        for t in data.get("tokens", []):
            if t["token"] == token:
                t["used"] = False
                t["used_at"] = None
                save_reset_tokens(data)
                logger.warning(f"Reset-token taastatud (kasutamata): {token[:8]}…")
                return


def complete_password_reset(token: str, new_password: str) -> Tuple[Optional[Dict], Optional[str]]:
    """Seab tokeni põhjal olemasolevale kasutajale uue parooli.

    Edu ainult kui MÕLEMAD õnnestuvad: hash-vahetus JA sessioonide invalideerimine.
    Veal rollback (vana hash taastatakse, token unconsume'itakse).
    Tagastab ``({"username": str}, None)`` õnnestumisel, muidu ``(None, error)``.
    """
    # 1. Paroolipoliitika ENNE consume'i (vigane parool ei tohi tokenit tarbida)
    pw_error = validate_password_strength(new_password)
    if pw_error:
        return None, pw_error

    # 2. Atomaarne consume
    token_data, error = _validate_and_consume_token(token)
    if error:
        return None, error

    username = token_data["username"]

    # 3. Sea uus hash (loe vana välja rollbacki jaoks)
    users = load_users()
    if username not in users:
        _unconsume_token(token)
        return None, "Kasutajat ei leitud"
    old_hash = users[username].get("password_hash")
    users[username]["password_hash"] = hash_password(new_password)
    try:
        save_users(users)
    except Exception as e:
        _unconsume_token(token)
        logger.error(f"Reset: parooli salvestus ebaõnnestus ({username}): {e}")
        return None, "Parooli salvestamine ebaõnnestus, palun proovi uuesti"

    # 4. Invalideeri sessioonid — turvainvariant: peavad kaduma
    try:
        delete_user_sessions(username)
    except Exception as e:
        # Rollback: taasta vana hash, vabasta token
        try:
            users = load_users()
            users[username]["password_hash"] = old_hash
            save_users(users)
        except Exception as e2:
            logger.error(f"Reset: hash-rollback ebaõnnestus ({username}): {e2}")
        _unconsume_token(token)
        logger.error(f"Reset: sessioonide invalideerimine ebaõnnestus ({username}): {e}")
        return None, "Parooli lähtestamine ebaõnnestus, palun proovi uuesti"

    logger.info(f"Parool lähtestatud kasutajale {username}")
    return {"username": username}, None
