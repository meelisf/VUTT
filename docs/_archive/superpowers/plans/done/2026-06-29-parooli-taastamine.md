# Parooli taastamine (admini-algatatud) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin saab genereerida olemasolevale kasutajale ühekordse parooli-taastamise lingi (kopeerib käsitsi), kasutaja seab uue parooli `SetPassword`-lehel.

**Architecture:** Eraldi reset-token moodul (`server/password_reset.py`) `registration.py` mustri järgi, tokenid `state/reset_tokens.json`. Olemasoleva kasutaja parool vahetub alles lingi kasutamisel; siis invalideeritakse ta sessioonid. Frontend taaskasutab `SetPassword.tsx` lehte (`?reset=1`) ja koondab Users-lehe tegevused kebab-menüüsse.

**Tech Stack:** FastAPI (Python 3.9 compat), bcrypt, React 19 + TypeScript, Tailwind, lucide-react, i18next; testid pytest (backend) + tsc typecheck (frontend).

## Global Constraints

- Python 3.9 compat: kasuta `Optional[X]`, `Dict`, `List` (`typing`), MITTE `X | None` ega `dict | None`.
- Kõik failikirjutused atomaarsed: `from .utils import atomic_write_json`.
- Tokenid `state/`-s (ei ole gitis); konfiguratsioon `data/config/`-s — reset-tokenid on RUNTIME → `state/reset_tokens.json`.
- Backend testid: `.venv/bin/python -m pytest <path> -v`.
- Frontend värav: `npm run typecheck` (Vite build ei typecheck'i) + `npm run test` kui vitest-test lisatud.
- Koodikommentaarid eesti keeles (projekti konventsioon).
- Rolli-hierarhia: `{"contributor": 0, "editor": 1, "admin": 2}` (vt `server/auth.py:require_token`).
- Ära muuda invite-voogu (`/invite/*`, `registration.create_user_from_invite`).

---

### Task 1: Token-moodul — CRUD + revoke (`server/password_reset.py`)

**Files:**
- Create: `server/password_reset.py`
- Modify: `server/config.py` (lisa `RESET_TOKENS_FILE`)
- Modify: `tests/conftest.py` (patchi `RESET_TOKENS_FILE`, loo tühi fail)
- Test: `tests/test_password_reset.py`

**Interfaces:**
- Consumes: `server.config.RESET_TOKENS_FILE`; `server.auth.load_users`; `server.utils.atomic_write_json`; `server.config.get_logger`.
- Produces:
  - `create_reset_token(username: str, created_by: str) -> Tuple[Optional[dict], Optional[str]]` — `(token_data, error)`. `token_data` võtmed: `token, username, name, created_at, expires_at, created_by, used, used_at, revoked, revoked_at, revocation_reason`.
  - `validate_reset_token(token: str) -> Tuple[Optional[dict], Optional[str]]`
  - `revoke_user_reset_tokens(username: str, reason: str) -> int` — tagastab tühistatud arvu.
  - `_validate_and_consume_token(token: str) -> Tuple[Optional[dict], Optional[str]]`
  - `_unconsume_token(token: str) -> None`
  - `load_reset_tokens() -> dict` / `save_reset_tokens(data: dict) -> None`
  - Moduuli konstandid: `RESET_TOKEN_TTL_HOURS = 24`, `RESET_TOKEN_RETENTION_DAYS = 7`.

- [ ] **Step 1: Lisa config konstant**

`server/config.py`, `INVITE_TOKENS_FILE` rea järele (rida ~82):

```python
RESET_TOKENS_FILE = os.path.join(_STATE_DIR, "reset_tokens.json")
```

- [ ] **Step 2: Kirjuta langevad testid** (`tests/test_password_reset.py`)

```python
"""Parooli-taastamise token-mooduli unit-testid.

Failipõhised laadijad on monkeypatch'itud tmp-failile, et vältida reaalset I/O-d
ja jagatud olekut. Kasutajate fail (`load_users`) samuti tmp-failile.
"""
import json
from datetime import datetime, timedelta

import pytest

import server.password_reset as pr


@pytest.fixture
def reset_env(tmp_path, monkeypatch):
    tokens_file = tmp_path / "reset_tokens.json"
    tokens_file.write_text('{"tokens": []}', encoding="utf-8")
    users_file = tmp_path / "users.json"
    users_file.write_text(
        json.dumps({
            "mari": {"password_hash": "x", "name": "Mari Maa", "role": "editor"},
            "juku": {"password_hash": "y", "name": "Juku Tamm", "role": "contributor"},
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(pr, "RESET_TOKENS_FILE", str(tokens_file))
    # load_users loeb auth.USERS_FILE kaudu; pr.load_users on viide auth.load_users-le
    import server.auth as auth
    monkeypatch.setattr(auth, "USERS_FILE", str(users_file))
    monkeypatch.setattr(auth, "_users_cache", None)
    return {"tokens_file": tokens_file, "users_file": users_file}


def test_create_reset_token_kehtivale_kasutajale(reset_env):
    token_data, error = pr.create_reset_token("mari", "admin")
    assert error is None
    assert token_data["username"] == "mari"
    assert token_data["name"] == "Mari Maa"
    assert token_data["used"] is False
    assert token_data["revoked"] is False
    assert len(token_data["token"]) >= 32  # uuid4


def test_create_reset_token_olematu_kasutaja(reset_env):
    token_data, error = pr.create_reset_token("puudub", "admin")
    assert token_data is None
    assert error is not None


def test_validate_kehtiv(reset_env):
    token_data, _ = pr.create_reset_token("mari", "admin")
    got, error = pr.validate_reset_token(token_data["token"])
    assert error is None
    assert got["username"] == "mari"


def test_validate_olematu(reset_env):
    got, error = pr.validate_reset_token("ei-eksisteeri")
    assert got is None
    assert error is not None


def test_validate_aegunud(reset_env):
    token_data, _ = pr.create_reset_token("mari", "admin")
    # Sea aegumine minevikku
    data = pr.load_reset_tokens()
    data["tokens"][0]["expires_at"] = (datetime.now() - timedelta(hours=1)).isoformat()
    pr.save_reset_tokens(data)
    got, error = pr.validate_reset_token(token_data["token"])
    assert got is None
    assert "aeg" in error.lower()


def test_consume_uhekordne(reset_env):
    token_data, _ = pr.create_reset_token("mari", "admin")
    tok = token_data["token"]
    first, e1 = pr._validate_and_consume_token(tok)
    assert e1 is None and first is not None
    second, e2 = pr._validate_and_consume_token(tok)
    assert second is None and e2 is not None  # juba kasutatud


def test_unconsume_taastab(reset_env):
    token_data, _ = pr.create_reset_token("mari", "admin")
    tok = token_data["token"]
    pr._validate_and_consume_token(tok)
    pr._unconsume_token(tok)
    got, error = pr.validate_reset_token(tok)
    assert error is None and got is not None


def test_uus_token_tuhistab_varasema(reset_env):
    first, _ = pr.create_reset_token("mari", "admin")
    second, _ = pr.create_reset_token("mari", "admin")
    # Esimene peab olema revoked superseded
    data = pr.load_reset_tokens()
    by_token = {t["token"]: t for t in data["tokens"]}
    assert by_token[first["token"]]["revoked"] is True
    assert by_token[first["token"]]["revocation_reason"] == "superseded"
    assert by_token[second["token"]]["revoked"] is False
    # Valideerimine: esimene → tühistatud viga, teine OK
    _, e1 = pr.validate_reset_token(first["token"])
    assert e1 is not None
    got2, e2 = pr.validate_reset_token(second["token"])
    assert e2 is None and got2 is not None


def test_revoke_user_reset_tokens(reset_env):
    t1, _ = pr.create_reset_token("mari", "admin")
    n = pr.revoke_user_reset_tokens("mari", "role_changed")
    assert n == 1
    _, error = pr.validate_reset_token(t1["token"])
    assert error is not None


def test_passiivne_puhastus_eemaldab_vanad(reset_env):
    # Loo token, sea aegumine 8 päeva minevikku, siis loo uus → vana kustub failist
    old, _ = pr.create_reset_token("mari", "admin")
    data = pr.load_reset_tokens()
    data["tokens"][0]["expires_at"] = (datetime.now() - timedelta(days=8)).isoformat()
    pr.save_reset_tokens(data)
    pr.create_reset_token("juku", "admin")
    data2 = pr.load_reset_tokens()
    tokens = [t["token"] for t in data2["tokens"]]
    assert old["token"] not in tokens  # > 7 päeva vana eemaldatud
```

- [ ] **Step 3: Käivita testid — peavad FAILIma**

Run: `.venv/bin/python -m pytest tests/test_password_reset.py -v`
Expected: FAIL (`ModuleNotFoundError: server.password_reset` või `AttributeError`).

- [ ] **Step 4: Kirjuta moodul** (`server/password_reset.py`)

```python
"""
Parooli-taastamise tokenid (admini-algatatud).

Eraldatud invite-voost (`registration.py`): invite = loo UUS kasutaja, reset = muuda
OLEMASOLEVAT kasutajat. Tokenid `state/reset_tokens.json` (runtime, ei ole gitis).
Kohaletoimetamine (lingi saatmine) on kutsuja vastutus — SMTP-valmis.
"""
import json
import os
import threading
import uuid
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple

from .auth import load_users
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

    Kasutatakse race-kaitseks: rolli muutus (`role_changed`) / kustutus (`user_deleted`)
    tühistab pooleliolevad reset-lingid. Tagastab tühistatud arvu.
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
```

- [ ] **Step 5: Patchi conftest** (`tests/conftest.py`)

Lisa `backend_env` fikstuuris `invite_tokens_file` loomise kõrvale (rida ~38) reset-tokenite fail:

```python
    reset_tokens_file = state_dir / "reset_tokens.json"
```

Pärast `invite_tokens_file.write_text('{"tokens": []}', encoding="utf-8")` (rida ~62):

```python
    reset_tokens_file.write_text('{"tokens": []}', encoding="utf-8")
```

Pärast `registration = importlib.import_module("server.registration")` (rida ~81) lisa:

```python
    password_reset = importlib.import_module("server.password_reset")
```

Pärast `monkeypatch.setattr(registration, "INVITE_TOKENS_FILE", str(invite_tokens_file))` (rida ~92):

```python
    monkeypatch.setattr(password_reset, "RESET_TOKENS_FILE", str(reset_tokens_file))
```

Lisa `yield`-i dict-i (rida ~166) väljad:

```python
            "password_reset": password_reset,
            "reset_tokens_file": reset_tokens_file,
```

- [ ] **Step 6: Käivita testid — peavad LÄBIma**

Run: `.venv/bin/python -m pytest tests/test_password_reset.py -v`
Expected: PASS (kõik 11 testi).

- [ ] **Step 7: Commit**

```bash
git add server/password_reset.py server/config.py tests/conftest.py tests/test_password_reset.py
git commit -m "feat: parooli-reset token-moodul (CRUD, revoke, passiivne puhastus)"
```

---

### Task 2: `complete_password_reset` + veatee

**Files:**
- Modify: `server/password_reset.py` (lisa funktsioon)
- Test: `tests/test_password_reset.py` (lisa testid)

**Interfaces:**
- Consumes: Task 1 `_validate_and_consume_token`, `_unconsume_token`; `server.registration.validate_password_strength`; `server.auth.hash_password`, `server.auth.load_users`, `server.auth.save_users`, `server.auth.delete_user_sessions`.
- Produces: `complete_password_reset(token: str, new_password: str) -> Tuple[Optional[Dict], Optional[str]]` — `({"username": str}, None)` õnnestumisel.

- [ ] **Step 1: Kirjuta langevad testid** (lisa `tests/test_password_reset.py` lõppu)

```python
def test_complete_reset_muudab_hashi_ja_kustutab_sessioonid(reset_env, monkeypatch):
    import server.auth as auth
    # Loo aktiivne sessioon kasutajale mari
    auth.sessions.clear()
    auth.sessions["tok-mari"] = {"user": {"username": "mari"}, "created_at": datetime.now().isoformat()}
    token_data, _ = pr.create_reset_token("mari", "admin")

    result, error = pr.complete_password_reset(token_data["token"], "uusparool1234")
    assert error is None
    assert result["username"] == "mari"
    # Uus hash on bcrypt
    users = auth.load_users()
    assert users["mari"]["password_hash"].startswith("$2b$")
    assert auth.bcrypt.checkpw(b"uusparool1234", users["mari"]["password_hash"].encode())
    # Sessioon kustutatud
    assert "tok-mari" not in auth.sessions


def test_complete_reset_nork_parool_keeldub(reset_env):
    token_data, _ = pr.create_reset_token("mari", "admin")
    result, error = pr.complete_password_reset(token_data["token"], "lyhike")
    assert result is None
    assert error is not None
    # Token EI tohi olla tarbitud (parool ei läbinud poliitikat enne consume'i)
    got, e = pr.validate_reset_token(token_data["token"])
    assert e is None and got is not None


def test_complete_reset_sessiooni_kustutus_ebaonnestub_taastab_hashi(reset_env, monkeypatch):
    import server.auth as auth
    auth.load_users()  # cache
    old_hash = auth.load_users()["mari"]["password_hash"]
    token_data, _ = pr.create_reset_token("mari", "admin")

    def boom(_username):
        raise RuntimeError("sessiooni kustutus ebaõnnestus")
    monkeypatch.setattr(pr, "delete_user_sessions", boom)

    result, error = pr.complete_password_reset(token_data["token"], "uusparool1234")
    assert result is None
    assert error is not None
    # Vana hash taastatud
    assert auth.load_users()["mari"]["password_hash"] == old_hash
    # Token unconsume'itud
    got, e = pr.validate_reset_token(token_data["token"])
    assert e is None and got is not None


def test_complete_reset_kahe_jarjestikuse_lingi_esimene_kehtetu(reset_env):
    first, _ = pr.create_reset_token("mari", "admin")
    second, _ = pr.create_reset_token("mari", "admin")
    r1, e1 = pr.complete_password_reset(first["token"], "uusparool1234")
    assert r1 is None and e1 is not None  # superseded
    r2, e2 = pr.complete_password_reset(second["token"], "uusparool1234")
    assert e2 is None and r2["username"] == "mari"
```

- [ ] **Step 2: Käivita — peavad FAILIma**

Run: `.venv/bin/python -m pytest tests/test_password_reset.py -k complete -v`
Expected: FAIL (`AttributeError: ... has no attribute 'complete_password_reset'`).

- [ ] **Step 3: Lisa funktsioon ja importid** (`server/password_reset.py`)

Lisa importide juurde (auth-st) mooduli tipus — muuda `from .auth import load_users` reaks:

```python
from .auth import delete_user_sessions, hash_password, load_users, save_users
```

Lisa faili lõppu:

```python
def complete_password_reset(token: str, new_password: str) -> Tuple[Optional[Dict], Optional[str]]:
    """Seab tokeni põhjal olemasolevale kasutajale uue parooli.

    Edu ainult kui MÕLEMAD õnnestuvad: hash-vahetus JA sessioonide invalideerimine.
    Veal rollback (vana hash taastatakse, token unconsume'itakse).
    Tagastab ({"username": str}, None) õnnestumisel, muidu (None, error).
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
```

- [ ] **Step 4: Käivita kõik mooduli testid — peavad LÄBIma**

Run: `.venv/bin/python -m pytest tests/test_password_reset.py -v`
Expected: PASS (15 testi).

- [ ] **Step 5: Commit**

```bash
git add server/password_reset.py tests/test_password_reset.py
git commit -m "feat: complete_password_reset + sessiooni-invalideerimise veatee"
```

---

### Task 3: Race-kaitse — rolli muutus / kustutus tühistab tokenid

**Files:**
- Modify: `server/auth.py` (`update_user_role`, `delete_user`)
- Test: `tests/test_password_reset.py` (lisa testid)

**Interfaces:**
- Consumes: Task 1 `revoke_user_reset_tokens`.
- Produces: (käitumismuutus — `update_user_role`/`delete_user` tühistavad sihtkasutaja reset-tokenid). Lazy import väldib ring-importi (`auth` ↔ `password_reset`).

- [ ] **Step 1: Kirjuta langevad testid** (lisa `tests/test_password_reset.py` lõppu)

```python
def test_rolli_muutus_tuhistab_reset_tokenid(reset_env):
    import server.auth as auth
    token_data, _ = pr.create_reset_token("juku", "admin")
    admin = {"username": "admin", "role": "admin"}
    ok, _ = auth.update_user_role("juku", "editor", admin)
    assert ok
    _, error = pr.validate_reset_token(token_data["token"])
    assert error is not None  # tühistatud


def test_kustutus_tuhistab_reset_tokenid(reset_env):
    import server.auth as auth
    token_data, _ = pr.create_reset_token("juku", "admin")
    admin = {"username": "admin", "role": "admin"}
    ok, _ = auth.delete_user("juku", admin)
    assert ok
    _, error = pr.validate_reset_token(token_data["token"])
    assert error is not None


def test_looja_kustutamine_ei_tuhista_sihtmargi_tokenit(reset_env):
    # Invariant on sihtmärgi-, mitte looja-põhine: kui tokeni LOONUD admin
    # kustutatakse, jääb sihtmärgi token kehtima.
    import server.auth as auth
    # Lisa teine admin "admin2" kasutajate hulka
    users = auth.load_users()
    users["admin2"] = {"password_hash": "z", "name": "Admin Two", "role": "editor"}
    auth.save_users(users)
    token_data, _ = pr.create_reset_token("mari", "admin2")  # looja = admin2
    admin = {"username": "admin", "role": "admin"}
    auth.delete_user("admin2", admin)  # kustuta looja
    got, error = pr.validate_reset_token(token_data["token"])  # mari token kehtib
    assert error is None and got is not None
```

- [ ] **Step 2: Käivita — peavad FAILIma**

Run: `.venv/bin/python -m pytest tests/test_password_reset.py -k "rolli_muutus or kustutus_tuhistab or looja" -v`
Expected: FAIL (tokenid jäävad kehtima, sest revoke pole veel ühendatud).

- [ ] **Step 3: Ühenda revoke `update_user_role`-i** (`server/auth.py`)

`update_user_role`-is, pärast `invalidated = delete_user_sessions(username)` rida (~292), enne `print(...)`:

```python
    # Tühista kasutaja pooleliolevad reset-tokenid (race-kaitse: rolli muutus võib
    # muuta privileegi-invarianti). Lazy import — väldib ring-importi password_reset ↔ auth.
    from .password_reset import revoke_user_reset_tokens
    revoke_user_reset_tokens(username, "role_changed")
```

- [ ] **Step 4: Ühenda revoke `delete_user`-i** (`server/auth.py`)

`delete_user`-is, pärast `removed = delete_user_sessions(username)` rida (~328), enne `print(...)`:

```python
    from .password_reset import revoke_user_reset_tokens
    revoke_user_reset_tokens(username, "user_deleted")
```

- [ ] **Step 5: Käivita kõik mooduli testid — peavad LÄBIma**

Run: `.venv/bin/python -m pytest tests/test_password_reset.py -v`
Expected: PASS (18 testi).

- [ ] **Step 6: Commit**

```bash
git add server/auth.py tests/test_password_reset.py
git commit -m "feat: rolli muutus/kustutus tühistab pooleliolevad reset-tokenid"
```

---

### Task 4: Backend endpointid (admin + avalik) + rate-limit

**Files:**
- Modify: `server/config.py` (`RATE_LIMITS`)
- Modify: `server/routers/admin.py` (`POST /admin/users/reset-password`)
- Modify: `server/routers/auth.py` (`POST /reset/validate`, `POST /reset/set-password`)
- Test: `tests/test_password_reset_api.py`

**Interfaces:**
- Consumes: Task 1 `create_reset_token`, `validate_reset_token`; Task 2 `complete_password_reset`; `server.deps.require_role`, `get_json_data`; `server.rate_limit.get_client_ip`, `check_rate_limit`; `server.auth.load_users`.
- Produces:
  - `POST /admin/users/reset-password` body `{username}` → `{status, reset_url, expires_at, username, name}` | 400/403/404.
  - `POST /reset/validate` body `{token}` → `{status, valid, username, name, expires_at}` | `{status:"error", valid:false, message}`.
  - `POST /reset/set-password` body `{token, password}` → `{status, username}` | 400.

- [ ] **Step 1: Lisa rate-limit kirjed** (`server/config.py`, `RATE_LIMITS` dict, rida ~142)

```python
    '/reset/validate': (10, 300),       # 10 valideerimist 5 min jooksul IP kohta
    '/reset/set-password': (5, 300),    # 5 katset 5 min jooksul (nagu invite)
```

- [ ] **Step 2: Kirjuta langevad integratsioonitestid** (`tests/test_password_reset_api.py`)

```python
"""Parooli-reset endpointide integratsioonitestid (TestClient).

Kasutab conftest backend_env fikstuuri (admin, editor kasutajad).
"""


def test_admin_reset_password_loob_lingi(client, login):
    token = login("admin", "adminpass")
    resp = client.post("/admin/users/reset-password", json={"username": "editor"},
                       headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert "reset_url" in data and "reset=1" in data["reset_url"]
    assert data["username"] == "editor"


def test_admin_reset_password_olematu_kasutaja_404(client, login):
    token = login("admin", "adminpass")
    resp = client.post("/admin/users/reset-password", json={"username": "puudub"},
                       headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 404


def test_admin_reset_password_teist_admini_keelab_403(client, login, backend_env):
    # Lisa teine admin
    auth = backend_env["auth"]
    users = auth.load_users()
    users["admin2"] = {"password_hash": auth.hash_password("admin2pass"),
                       "name": "Admin Two", "role": "admin", "created_at": "2026-01-01T00:00:00"}
    auth.save_users(users)
    token = login("admin", "adminpass")
    resp = client.post("/admin/users/reset-password", json={"username": "admin2"},
                       headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_admin_reset_password_iseennast_lubab(client, login):
    token = login("admin", "adminpass")
    resp = client.post("/admin/users/reset-password", json={"username": "admin"},
                       headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


def test_reset_password_nouab_admini(client, login):
    token = login("editor", "editorpass")
    resp = client.post("/admin/users/reset-password", json={"username": "editor"},
                       headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401  # require_role("admin") → get_user 401


def test_reset_validate_ja_set_password_full_flow(client, login):
    admin = login("admin", "adminpass")
    gen = client.post("/admin/users/reset-password", json={"username": "editor"},
                      headers={"Authorization": f"Bearer {admin}"}).json()
    # reset_url = /set-password?token=<uuid>&reset=1 — eralda token
    reset_token = gen["reset_url"].split("token=")[1].split("&")[0]

    # Valideeri (avalik POST body)
    v = client.post("/reset/validate", json={"token": reset_token})
    assert v.status_code == 200
    vd = v.json()
    assert vd["valid"] is True and vd["username"] == "editor"

    # Sea uus parool
    sp = client.post("/reset/set-password", json={"token": reset_token, "password": "uusparool1234"})
    assert sp.status_code == 200
    assert sp.json()["status"] == "success"

    # Uue parooliga login töötab
    ok = client.post("/login", json={"username": "editor", "password": "uusparool1234"})
    assert ok.status_code == 200 and ok.json()["status"] == "success"


def test_reset_validate_vigane_token(client):
    v = client.post("/reset/validate", json={"token": "ei-eksisteeri"})
    assert v.status_code == 200
    assert v.json()["valid"] is False


def test_reset_set_password_nork_parool_400(client, login):
    admin = login("admin", "adminpass")
    gen = client.post("/admin/users/reset-password", json={"username": "editor"},
                      headers={"Authorization": f"Bearer {admin}"}).json()
    reset_token = gen["reset_url"].split("token=")[1].split("&")[0]
    sp = client.post("/reset/set-password", json={"token": reset_token, "password": "lyhike"})
    assert sp.status_code == 400
```

- [ ] **Step 3: Käivita — peavad FAILIma**

Run: `.venv/bin/python -m pytest tests/test_password_reset_api.py -v`
Expected: FAIL (404 endpoint puudub).

- [ ] **Step 4: Lisa admin endpoint** (`server/routers/admin.py`)

Importide juurde (rida ~14, `from ..registration import (...)`) lisa eraldi rida:

```python
from ..password_reset import create_reset_token
```

Lisa `admin_delete_user` järele (rida ~79):

```python
@router.post("/admin/users/reset-password")
async def admin_reset_password(request: Request, user=Depends(require_role("admin"))):
    """Genereerib olemasolevale kasutajale ühekordse parooli-taastamise lingi.

    Privileegide eskaleerumise kaitse: admin ei tohi lähtestada võrdse/kõrgema õigusega
    kasutajat (sh teist admini), v.a iseennast.
    """
    from ..auth import load_users
    data = await get_json_data(request)
    target = (data.get("username") or "").strip()
    if not target:
        raise HTTPException(status_code=400, detail="Kasutajanimi puudub")

    users = load_users()
    if target not in users:
        raise HTTPException(status_code=404, detail="Kasutajat ei leitud")

    role_hierarchy = {"contributor": 0, "editor": 1, "admin": 2}
    acting_level = role_hierarchy.get(user.get("role", "contributor"), 0)
    target_level = role_hierarchy.get(users[target].get("role", "contributor"), 0)
    if target != user["username"] and target_level >= acting_level:
        raise HTTPException(status_code=403, detail="Ei saa lähtestada võrdse või kõrgema õigusega kasutajat")

    token_data, error = create_reset_token(target, user["username"])
    if not token_data:
        raise HTTPException(status_code=400, detail=error)
    return {
        "status": "success",
        "reset_url": f"/set-password?token={token_data['token']}&reset=1",
        "expires_at": token_data["expires_at"],
        "username": token_data["username"],
        "name": token_data["name"],
    }
```

- [ ] **Step 5: Lisa avalikud endpointid** (`server/routers/auth.py`)

Importide juurde (rida ~13, `from ..registration import (...)`) lisa:

```python
from ..password_reset import complete_password_reset, validate_reset_token
```

Lisa faili lõppu (pärast `set_password`, rida ~169):

```python
@router.post("/reset/validate")
async def reset_validate(request: Request):
    """Valideerib parooli-reset tokeni (POST body, MITTE URL — token logidest väljas)."""
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, "/reset/validate")
    if not allowed:
        return JSONResponse(status_code=429, content={"status": "error", "valid": False, "message": "Liiga palju päringuid"})
    data = await request.json()
    token_data, error = validate_reset_token((data.get("token") or "").strip())
    if token_data:
        return {
            "status": "success",
            "valid": True,
            "username": token_data["username"],
            "name": token_data["name"],
            "expires_at": token_data["expires_at"],
        }
    return {"status": "error", "valid": False, "message": error}


@router.post("/reset/set-password")
async def reset_set_password(request: Request):
    """Seab reset-tokeni põhjal olemasolevale kasutajale uue parooli."""
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, "/reset/set-password")
    if not allowed:
        return JSONResponse(status_code=429, content={"status": "error", "message": "Liiga palju päringuid"})
    data = await request.json()
    result, error = complete_password_reset((data.get("token") or "").strip(), data.get("password", ""))
    if not result:
        raise HTTPException(status_code=400, detail=error)
    return {"status": "success", "username": result["username"]}
```

- [ ] **Step 6: Käivita uued + olemasolevad auth-testid — peavad LÄBIma**

Run: `.venv/bin/python -m pytest tests/test_password_reset_api.py tests/test_auth_password.py tests/test_registration_username.py -v`
Expected: PASS (8 uut + olemasolevad).

- [ ] **Step 7: Commit**

```bash
git add server/config.py server/routers/admin.py server/routers/auth.py tests/test_password_reset_api.py
git commit -m "feat: parooli-reset endpointid (admin gen + avalik validate/set) + rate-limit"
```

---

### Task 5: Frontend — `SetPassword.tsx` reset-režiim + i18n

**Files:**
- Modify: `src/pages/SetPassword.tsx`
- Modify: `src/locales/et/register.json`, `src/locales/en/register.json`

**Interfaces:**
- Consumes: Task 4 `POST /reset/validate`, `POST /reset/set-password`.
- Produces: SetPassword-leht tuvastab `?reset=1` → kutsub reset-endpointe; tekstid kohanduvad.

- [ ] **Step 1: Lisa i18n võtmed — et** (`src/locales/et/register.json`, `setPassword` objekti, pärast `"success"` rida ~42)

```json
    "resetTitle": "Sea uus parool",
    "resetSubtitle": "Vali oma kontole uus tugev parool",
    "resetWelcome": "Tere, {{name}}! Sea oma kontole uus parool.",
    "resetSuccess": "Parool uuendatud! Võid nüüd uue parooliga sisse logida.",
```

- [ ] **Step 2: Lisa i18n võtmed — en** (`src/locales/en/register.json`, sama koht)

```json
    "resetTitle": "Set a new password",
    "resetSubtitle": "Choose a new strong password for your account",
    "resetWelcome": "Hello, {{name}}! Set a new password for your account.",
    "resetSuccess": "Password updated! You can now log in with the new password.",
```

- [ ] **Step 3: Lisa reset-režiimi tuvastus ja tingimuslikud endpointid** (`src/pages/SetPassword.tsx`)

Tee `TokenInfo.email` valikuliseks (reset-validate ei tagasta `email`-i), rida 12:

```tsx
  email?: string;
```

Muuda token-rea järel (rida 20):

```tsx
  const token = searchParams.get('token') || '';
  const isReset = searchParams.get('reset') === '1';
```

Muuda valideerimis-fetch (rida 46) reset-teadlikuks:

```tsx
        const response = isReset
          ? await fetchWithTimeout(`${FILE_API_URL}/reset/validate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token }),
            })
          : await fetchWithTimeout(`${FILE_API_URL}/invite/${token}`);
```

Lisa `useEffect` sõltuvustesse `isReset` (rida 69): `}, [token, isReset, t]);`

Muuda submit-fetch (rida 112) reset-teadlikuks:

```tsx
      const endpoint = isReset ? `${FILE_API_URL}/reset/set-password` : `${FILE_API_URL}/invite/set-password`;
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });
```

NB: reset-vastuses on `username` olemas (`{status, username}`), seega `setCreatedUsername(data.username)` (rida 121) töötab mõlemas režiimis.

- [ ] **Step 4: Kohanda tekstid režiimi järgi** (`src/pages/SetPassword.tsx`)

Pealkiri (rida 217):

```tsx
            <h1 className="text-2xl font-bold text-gray-900">{isReset ? t('setPassword.resetTitle') : t('setPassword.title')}</h1>
            <p className="text-gray-500 mt-1">{isReset ? t('setPassword.resetSubtitle') : t('setPassword.subtitle')}</p>
```

Tervitus (rida 222):

```tsx
                <p className="text-sm text-primary-600">
                  {isReset ? t('setPassword.resetWelcome', { name: tokenInfo.name }) : `Tere tulemast, ${tokenInfo.name}!`}
                </p>
```

Edu-pealkiri (rida 175):

```tsx
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{isReset ? t('setPassword.resetSuccess') : t('setPassword.success')}</h1>
```

- [ ] **Step 5: Typecheck — peab LÄBIma**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Manuaalne verifitseerimine (dev)**

Run: `npm run dev`. Ava `http://localhost:5173/set-password?token=test&reset=1`. Oodatav: "Link ei leitud" viga (token puudub backendis) — kinnitab, et reset-haru kutsub `/reset/validate`. (Täielik voog testitakse deploy järel päris tokeniga.)

- [ ] **Step 7: Commit**

```bash
git add src/pages/SetPassword.tsx src/locales/et/register.json src/locales/en/register.json
git commit -m "feat: SetPassword leht toetab reset-režiimi (?reset=1)"
```

---

### Task 6: Frontend — Users.tsx kebab-menüü + reset-lingi modaal + i18n

**Files:**
- Modify: `src/pages/admin/Users.tsx`
- Modify: `src/locales/et/admin.json`, `src/locales/en/admin.json`

**Interfaces:**
- Consumes: Task 4 `POST /admin/users/reset-password` → `{status, reset_url, expires_at, username, name}`.
- Produces: Users-leht — tegevuste tulp = kebab-menüü (Taasta parool / Kustuta); reset-lingi inline-paneel kopeerimisnupuga.

- [ ] **Step 1: Lisa i18n võtmed — et** (`src/locales/et/admin.json`, `users` objekti)

```json
    "actionsMenu": "Tegevused",
    "resetPassword": "Taasta parool",
    "resetLinkGenerated": "Parooli-taastamise link loodud",
    "resetLinkHint": "Kopeeri link ja saada kasutajale. Link kehtib 24 tundi.",
    "copyLink": "Kopeeri link",
    "linkCopied": "Kopeeritud!",
    "resetError": "Parooli-taastamise lingi loomine ebaõnnestus"
```

- [ ] **Step 2: Lisa i18n võtmed — en** (`src/locales/en/admin.json`, sama)

```json
    "actionsMenu": "Actions",
    "resetPassword": "Reset password",
    "resetLinkGenerated": "Password reset link created",
    "resetLinkHint": "Copy the link and send it to the user. The link is valid for 24 hours.",
    "copyLink": "Copy link",
    "linkCopied": "Copied!",
    "resetError": "Failed to create password reset link"
```

- [ ] **Step 3: Lisa importid ja state** (`src/pages/admin/Users.tsx`)

Muuda lucide-import (rida 4-9):

```tsx
import {
  Users,
  Loader2,
  Trash2,
  ChevronLeft,
  MoreVertical,
  KeyRound,
  Copy,
  CheckCircle
} from 'lucide-react';
```

Lisa state'id (pärast `deleteConfirm`, rida 38):

```tsx
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ username: string; name: string; reset_url: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
```

Lisa rolli-hierarhia helper (pärast interface'id, rida 27):

```tsx
const ROLE_LEVEL: Record<string, number> = { contributor: 0, editor: 1, admin: 2 };
```

- [ ] **Step 4: Lisa reset-handler + menüü-sulgemine** (`src/pages/admin/Users.tsx`, pärast `handleDeleteUser`, rida ~120)

```tsx
  const handleResetPassword = async (username: string) => {
    setOpenMenu(null);
    setRoleUpdating(username);
    setUsersError(null);
    setResetResult(null);
    setLinkCopied(false);
    try {
      const data = await apiPost<{ status: string; reset_url?: string; username?: string; name?: string; message?: string }>(
        '/admin/users/reset-password', { username }, { token: authToken });
      if (data.status === 'success' && data.reset_url) {
        setResetResult({ username: data.username || username, name: data.name || '', reset_url: data.reset_url });
      } else {
        setUsersError(data.message || t('users.resetError'));
      }
    } catch (e) {
      console.error('Reset password error:', e);
      setUsersError(t('users.resetError'));
    } finally {
      setRoleUpdating(null);
    }
  };

  const copyResetLink = () => {
    if (resetResult) {
      navigator.clipboard.writeText(`${window.location.origin}${resetResult.reset_url}`);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  // Sulge kebab-menüü klõpsul mujale
  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openMenu]);
```

- [ ] **Step 5: Lisa reset-lingi paneel** (`src/pages/admin/Users.tsx`, pärast `usersError` plokki, rida ~161)

```tsx
          {resetResult && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-medium text-green-800">{t('users.resetLinkGenerated')}</h3>
                  <p className="text-sm text-green-700 mt-1">
                    {resetResult.name} (<span className="font-mono">{resetResult.username}</span>)
                  </p>
                  <p className="text-xs text-green-700 mt-1">{t('users.resetLinkHint')}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <code className="flex-1 bg-white px-3 py-2 rounded border border-green-300 text-sm text-gray-800 overflow-x-auto">
                      {window.location.origin}{resetResult.reset_url}
                    </code>
                    <button
                      onClick={copyResetLink}
                      className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors flex items-center gap-1 whitespace-nowrap"
                    >
                      {linkCopied ? <CheckCircle size={16} /> : <Copy size={16} />}
                      {linkCopied ? t('users.linkCopied') : t('users.copyLink')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
```

- [ ] **Step 6: Asenda tegevuste-lahter kebab-menüüga** (`src/pages/admin/Users.tsx`)

Asenda kogu viimase `<td>` plokk (rida ~230-265, `isCurrentUser ? ... : deleteConfirm === ... : <button delete>`) järgmisega:

```tsx
                        <td className="px-4 py-3 text-sm text-right relative">
                          {(() => {
                            const canReset = isCurrentUser || (ROLE_LEVEL[u.role] ?? 0) < (ROLE_LEVEL[user.role] ?? 0);
                            const canDelete = !isCurrentUser;
                            if (!canReset && !canDelete) return <span className="text-gray-400">-</span>;
                            return (
                              <div className="inline-block" onClick={(e) => e.stopPropagation()}>
                                <button
                                  onClick={() => setOpenMenu(openMenu === u.username ? null : u.username)}
                                  disabled={isProcessing}
                                  className="p-1 text-gray-500 hover:bg-gray-100 rounded disabled:opacity-50"
                                  aria-haspopup="menu"
                                  aria-expanded={openMenu === u.username}
                                  title={t('users.actionsMenu')}
                                >
                                  {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <MoreVertical size={16} />}
                                </button>
                                {openMenu === u.username && (
                                  <div
                                    role="menu"
                                    className="absolute right-4 z-10 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-left"
                                    onKeyDown={(e) => { if (e.key === 'Escape') setOpenMenu(null); }}
                                  >
                                    {canReset && (
                                      <button
                                        role="menuitem"
                                        onClick={() => handleResetPassword(u.username)}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                      >
                                        <KeyRound size={15} /> {t('users.resetPassword')}
                                      </button>
                                    )}
                                    {canDelete && (
                                      <button
                                        role="menuitem"
                                        onClick={() => { setOpenMenu(null); setDeleteConfirm(u.username); }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                      >
                                        <Trash2 size={15} /> {t('users.delete')}
                                      </button>
                                    )}
                                  </div>
                                )}
                                {deleteConfirm === u.username && (
                                  <div className="absolute right-4 z-10 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-left w-56">
                                    <p className="text-xs text-red-600 mb-2">{t('users.confirmDelete')}</p>
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => handleDeleteUser(u.username)}
                                        disabled={isProcessing}
                                        className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 disabled:opacity-50"
                                      >
                                        {isProcessing ? <Loader2 size={12} className="animate-spin" /> : t('users.yes')}
                                      </button>
                                      <button
                                        onClick={() => setDeleteConfirm(null)}
                                        className="px-2 py-1 bg-gray-300 text-gray-700 rounded text-xs hover:bg-gray-400"
                                      >
                                        {t('users.no')}
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </td>
```

NB: `deleteConfirm` paneel ja `handleDeleteUser`/`setDeleteConfirm` jäävad alles (taaskasutatakse menüüst). Veendu, et `useEffect` import on olemas (rida 1 — `import React, { useState, useEffect }`).

- [ ] **Step 7: Typecheck — peab LÄBIma**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 8: Manuaalne verifitseerimine (dev)**

Run: `npm run dev`. Logi admina, ava `/admin/users`. Oodatav:
- "Tegevused" tulp näitab `⋮` ikooni, mitte kahte nuppu (tulp ei jää enam serva taha).
- `⋮` klõps avab menüü; teise admini real "Taasta parool" puudub; editoril olemas.
- "Taasta parool" → roheline paneel lingiga + "Kopeeri link" töötab.
- Esc / klõps mujale sulgeb menüü.

- [ ] **Step 9: Commit**

```bash
git add src/pages/admin/Users.tsx src/locales/et/admin.json src/locales/en/admin.json
git commit -m "feat: Users-lehe kebab-menüü + parooli-reset lingi genereerimine"
```

---

## Deploy (pärast kõigi tasside läbimist)

- [ ] Täielik backend test-jooks: `.venv/bin/python -m pytest tests/ -q` (kõik rohelised).
- [ ] Frontend: `npm run typecheck && npm run build`.
- [ ] Backend serverisse: `ssh vutt`, `cd ~/VUTT`, `git pull && docker compose build --no-cache backend && docker compose up -d backend`.
- [ ] Frontend serverisse: `rsync -avz dist/ vutt:~/VUTT/dist/`.
- [ ] Serveris loob `state/reset_tokens.json` automaatselt esimesel kasutusel.
- [ ] (Infra, valikuline) kaaluda tokenite redigeerimist nginx access-logist — reset-token on POST-body's, mitte URL-is, seega ei satu päringuteele.
- [ ] Manuaalne suitsutest serveris: admin genereerib editorile lingi → ava link → sea uus parool → logi sisse uue parooliga → vanad sessioonid välja logitud.

## Self-Review checklist (täida enne handoff'i)

- Spec-i iga sektsioon kaetud? Token-moodul (T1-2), race-kaitse (T3), endpointid+privileeg+rate-limit (T4), SetPassword reset (T5), kebab+a11y (T6), deploy. ✔
- `used` vs `revoked` eristus: T1 token-kirje + valideerimise eri veateated. ✔
- Sessiooni-veatee (success ainult kui mõlemad): T2 + test. ✔
- POST /reset/validate (mitte GET): T4 + T5. ✔
- Rate-limit võti IP+endpoint (check_rate_limit signatuur juba selline). ✔
- Privileeg: admin→admin 403, self OK: T4 testid. ✔
