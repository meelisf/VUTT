# Superadmin-roll — implementatsiooniplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lisada neljas roll `superadmin`, mis sulgeb adminide-vahelise privileegi-eskaleerimise augu ja annab ühele kasutajale unikaalse autoriteedi hallata admine ja kollektsioonistruktuuri.

**Architecture:** Tsentraliseeritud `ROLE_HIERARCHY` + range taseme-helperid `server/auth.py`-s. Üks invariant ("haldad ainult rangelt madalamat taset") rakendub kõigis kirjutusteedes (`update_user_role`, `delete_user`, `admin_reset_password`). Kollektsioonide struktuursed endpointid liiguvad `superadmin`-värava taha. Frontend peegeldab piiranguid mugavuse mõttes, backend jääb ainutõeks.

**Tech Stack:** Python 3.9 / FastAPI (backend), pytest (`.venv/bin/python -m pytest`), React 19 + TypeScript (frontend), vitest + `tsc --noEmit`.

## Global Constraints

- **Pytest käivitamine:** alati `.venv/bin/python -m pytest <path>` (host venv, MITTE Docker).
- **Frontend gate:** `npm run typecheck` (tsc) JA `npm run test` (vitest) peavad mõlemad läbima.
- **Python 3.9 compat:** ei kasuta `X | None` süntaksit; kasuta `Optional[...]`.
- **Range tasemed:** EI KUNAGI `.get(role, 0)` rollitaseme leidmiseks — tundmatu roll ei tohi vaikselt muutuda tasemeks 0. Kasuta `role_level()`, mis viskab tundmatu rolli peal.
- **Rollide vaikeväärtus** (`.get("role", ...)`) on alati `"contributor"` (valiidne, madalaim) — MITTE `"user"`.
- **Eriõigus tuleb AINULT rollist** — kustutatakse kõik `username == "meelis"` kõvakood-erandid.
- Koodikommentaarid eesti keeles (codebase'i konventsioon).
- Spec: `docs/superpowers/specs/2026-06-29-superadmin-role-design.md`.

---

## File Structure

- `server/auth.py` — lisa `ROLE_HIERARCHY`, `role_level`, `is_valid_role`, `can_manage_user`, `can_assign_role`, `can_change_role`, `has_superadmin`; muuda `require_token`, `update_user_role`, `delete_user`, `verify_user`.
- `server/routers/admin.py` — `admin_reset_password` kasutab `can_manage_user`.
- `server/routers/collections.py` — PUT/POST/DELETE → `require_role("superadmin")`.
- `server/main.py` — lifespan startup-check (`has_superadmin` → WARNING).
- `tests/test_role_permissions.py` — UUS, tuum-invariandi unit-testid.
- `tests/test_session_invalidation.py` — paranda olemasolev test, mis uue reegli all katki läheb.
- `tests/test_admin_role_endpoints.py` — UUS, endpoint-tasandi testid (reset + collections).
- `src/utils/roleUtils.ts` — UUS, puhtad frontend-helperid.
- `src/utils/__tests__/roleUtils.test.ts` — UUS, vitest.
- `src/pages/admin/Users.tsx` — juhtmesta roleUtils, lisa superadmin tugi, tooltip (ehitatakse WIP peale).
- `src/locales/{et,en}/common.json` — `roles.superadmin`.
- `src/locales/{et,en}/admin.json` — `users.noPermissionManage` tooltip.

---

## Task 1: Range rolli-helperid (auth.py, puhtad funktsioonid)

**Files:**
- Modify: `server/auth.py` (lisa moodul-tasandi definitsioonid)
- Test: `tests/test_role_permissions.py` (UUS)

**Interfaces:**
- Produces:
  - `ROLE_HIERARCHY: dict[str,int]` = `{"contributor":0,"editor":1,"admin":2,"superadmin":3}`
  - `role_level(role: str) -> int` — viskab `ValueError` tundmatu rolli peal
  - `is_valid_role(role: str) -> bool`
  - `can_manage_user(actor_role: str, target_role: str) -> bool`
  - `can_assign_role(actor_role: str, new_role: str) -> bool`
  - `can_change_role(actor_role: str, target_role: str, new_role: str) -> bool`
  - `has_superadmin(users: dict) -> bool`

- [ ] **Step 1: Write the failing test**

Loo `tests/test_role_permissions.py`:

```python
"""Tuum-invariant: rolli-tasemed ja kes-tohib-keda hallata."""
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.auth import (
    ROLE_HIERARCHY,
    role_level,
    is_valid_role,
    can_manage_user,
    can_assign_role,
    can_change_role,
    has_superadmin,
)


def test_hierarchy_has_four_tiers():
    assert ROLE_HIERARCHY == {"contributor": 0, "editor": 1, "admin": 2, "superadmin": 3}


def test_role_level_known():
    assert role_level("contributor") == 0
    assert role_level("superadmin") == 3


def test_role_level_unknown_raises():
    # KRIITILINE: tundmatu roll EI TOHI vaikselt muutuda tasemeks 0
    with pytest.raises(ValueError):
        role_level("user")
    with pytest.raises(ValueError):
        role_level("")


def test_is_valid_role():
    assert is_valid_role("admin") is True
    assert is_valid_role("superadmin") is True
    assert is_valid_role("user") is False


def test_can_manage_user_strictly_lower():
    # admin saab hallata editorit/contributorit
    assert can_manage_user("admin", "editor") is True
    assert can_manage_user("admin", "contributor") is True
    # admin EI saa hallata teist admini ega superadmini (augu sulgemine)
    assert can_manage_user("admin", "admin") is False
    assert can_manage_user("admin", "superadmin") is False
    # superadmin saab hallata admini, mitte teist superadmini
    assert can_manage_user("superadmin", "admin") is True
    assert can_manage_user("superadmin", "superadmin") is False


def test_can_assign_role_ceiling():
    # admin saab määrata kuni editor, mitte admin/superadmin
    assert can_assign_role("admin", "editor") is True
    assert can_assign_role("admin", "contributor") is True
    assert can_assign_role("admin", "admin") is False
    assert can_assign_role("admin", "superadmin") is False
    # superadmin saab määrata kuni admin, mitte superadmin (võrdne tase)
    assert can_assign_role("superadmin", "admin") is True
    assert can_assign_role("superadmin", "superadmin") is False


def test_can_change_role_requires_both():
    # admin: tohib editorit puutuda JA contributoriks määrata
    assert can_change_role("admin", "editor", "contributor") is True
    # admin: ei tohi editorit adminiks tõsta (lagi)
    assert can_change_role("admin", "editor", "admin") is False
    # admin: ei tohi admini puutuda (sihtmärk)
    assert can_change_role("admin", "admin", "contributor") is False
    # superadmin: tohib admini editoriks alandada
    assert can_change_role("superadmin", "admin", "editor") is True


def test_has_superadmin():
    assert has_superadmin({"a": {"role": "admin"}}) is False
    assert has_superadmin({"a": {"role": "superadmin"}}) is True
    assert has_superadmin({}) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_role_permissions.py -v`
Expected: FAIL — `ImportError: cannot import name 'ROLE_HIERARCHY'`.

- [ ] **Step 3: Write minimal implementation**

`server/auth.py` — lisa moodul-tasandi definitsioonid lähedale faili algusesse (pärast importe/olemasolevaid konstante nagu `SESSION_DURATION`, ENNE funktsioone):

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_role_permissions.py -v`
Expected: PASS (kõik 8 testi).

- [ ] **Step 5: Commit**

```bash
git add server/auth.py tests/test_role_permissions.py
git commit -m "feat(auth): range rolli-hierarhia ja can_manage helperid"
```

---

## Task 2: Juhtmesta invariant kirjutusteedesse + koRista meelis-häkid (auth.py)

**Files:**
- Modify: `server/auth.py` — `require_token` (~216), `verify_user` (~140), `update_user_role` (~256), `delete_user` (~303), `auth.py:64` print-näide
- Test: `tests/test_session_invalidation.py` (paranda olemasolev katki-minev test)

**Interfaces:**
- Consumes: `role_level`, `is_valid_role`, `can_change_role`, `can_manage_user`, `ROLE_HIERARCHY` (Task 1).
- Produces: `update_user_role(username, new_role, admin_user) -> (bool, str)` ja `delete_user(username, admin_user) -> (bool, str)` jõustavad invariandi; `superadmin` on valiidne väärtus.

- [ ] **Step 1: Paranda olemasolev test, mis uue reegli all katki läheb**

`tests/test_session_invalidation.py::test_update_user_role_invalidates_sessions` tõstab praegu bob (editor) → admin, mille teeb alice (admin). Uue lae all on see KEELATUD (admin ei saa määrata admini rolli). Muuda test valiidseks rollimuutuseks (alandus editor→contributor, mis säilitab sessiooni-invalideerimise kontrolli). Asenda funktsioon:

```python
def test_update_user_role_invalidates_sessions(auth):
    _add_session(auth, "tb", "bob")
    admin = {"username": "alice", "role": "admin"}
    # editor -> contributor on valiidne (admin tohib editorit puutuda ja contributoriks määrata)
    ok, _ = auth.update_user_role("bob", "contributor", admin)
    assert ok is True
    # Bob peab uuesti sisse logima — sessioon kustutatud
    assert "tb" not in auth.sessions
    # Roll on uuendatud
```

Lisa samasse faili uus regressioon-test (augu sulgemine):

```python
def test_admin_cannot_demote_another_admin(auth):
    # alice (admin) EI tohi teist admini (carol) puutuda
    auth._users_cache["carol"] = {"name": "Carol", "role": "admin", "allowed_collections": []}
    _add_session(auth, "tc", "carol")
    admin = {"username": "alice", "role": "admin"}
    ok, msg = auth.update_user_role("carol", "editor", admin)
    assert ok is False
    # Carol sessioon EI tohi olla invalideeritud (operatsioon blokeeriti)
    assert "tc" in auth.sessions


def test_superadmin_can_demote_admin(auth):
    auth._users_cache["carol"] = {"name": "Carol", "role": "admin", "allowed_collections": []}
    root = {"username": "root", "role": "superadmin"}
    ok, _ = auth.update_user_role("carol", "editor", root)
    assert ok is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_session_invalidation.py -v`
Expected: `test_admin_cannot_demote_another_admin` ja `test_superadmin_can_demote_admin` FAIL (invariant pole veel juhtmestatud — `update_user_role` lubab praegu kõik).

- [ ] **Step 3: Juhtmesta invariant + koRista häkid**

**3a.** `server/auth.py` `verify_user` (~rida 140) — paranda default:

```python
        "role": users[username].get("role", "contributor"),
```

**3b.** `server/auth.py:64` print-näites asenda demonstratsioon (kosmeetiline, hoia konsistentsus):

```python
        print('  {"admin": {"password_hash": "<sha256>", "name": "Admin", "role": "contributor"}}')
```

**3c.** `require_token` (~read 216-221) — asenda inline hierarhia range tasemega:

```python
    if min_role:
        # role_level viskab tundmatu rolli peal — fail-closed (500), mitte vaikne madal õigus
        if role_level(user['role']) < role_level(min_role):
            return None, {"status": "error", "message": f"Vajab vähemalt '{min_role}' õigusi"}
```

**3d.** `update_user_role` (~read 268-288) — asenda algusplokk (kuni `save_users` eelseni):

```python
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
```

(Kustutab `valid_roles = [...]` käsitsi-nimekirja JA `if username == "meelis"` ploki.)

**3e.** `delete_user` (~read 314-330) — asenda algusplokk:

```python
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
```

(Kustutab `if username == "meelis"` ploki.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_session_invalidation.py tests/test_role_permissions.py -v`
Expected: PASS (kõik).

- [ ] **Step 5: Run broader auth suite for regressions**

Run: `.venv/bin/python -m pytest tests/test_auth_password.py tests/test_password_reset.py tests/test_backend_smoke.py -v`
Expected: PASS. Kui mõni test eeldab vana käitumist (nt admin tõstab kellegi adminiks), paranda test vastama uuele invariandile (valiidne kombinatsioon või superadmin-actor).

- [ ] **Step 6: Commit**

```bash
git add server/auth.py tests/test_session_invalidation.py
git commit -m "feat(auth): jõusta rolli-invariant update/delete; eemalda meelis-häkid; verify_user default contributor"
```

---

## Task 3: admin_reset_password kasutab can_manage_user

**Files:**
- Modify: `server/routers/admin.py` (read ~84-106)
- Test: `tests/test_admin_role_endpoints.py` (UUS)

**Interfaces:**
- Consumes: `can_manage_user` (Task 1), `backend_env` fixture + TestClient (conftest).

- [ ] **Step 1: Write the failing test**

Loo `tests/test_admin_role_endpoints.py`. Kasuta olemasolevaid `client` + `login` fixtureid ja `backend_env["auth"]` mustrit superadmini lisamiseks (täpselt nagu `test_password_reset_api.py::test_admin_reset_password_teist_admini_keelab_403` lisab admin2). EI muudeta jagatud `conftest.py` seemet. Märkus: admin-ei-saa-admini-resettida on JUBA kaetud `test_password_reset_api.py`-s — siin testime AINULT uut superadmin-teed.

```python
"""Endpoint-tasandi testid: superadmin-tee resetil ja kollektsioonidel."""


def _seed_superadmin(backend_env):
    auth = backend_env["auth"]
    users = auth.load_users()
    users["root"] = {
        "password_hash": auth.hash_password("rootpass"),
        "name": "Root",
        "role": "superadmin",
        "created_at": "2026-01-01T00:00:00",
    }
    auth.save_users(users)


def test_superadmin_can_reset_admin(client, login, backend_env):
    _seed_superadmin(backend_env)
    token = login("root", "rootpass")
    r = client.post("/admin/users/reset-password",
                    json={"username": "admin"},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text


def test_admin_can_still_reset_editor(client, login):
    # Regressioon: helper-asendus ei tohi adminilt editori-reset õigust võtta
    token = login("admin", "adminpass")
    r = client.post("/admin/users/reset-password",
                    json={"username": "editor"},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_admin_role_endpoints.py -v`
Expected: `test_superadmin_can_reset_admin` FAIL — `superadmin` pole veel valiidne `min_role` enne Task 2 helpereid, VÕI reset-loogika kasutab veel vana hierarhiat. (`test_admin_can_still_reset_editor` võib juba pass-ida.) Kui mõlemad juba pass-ivad (Task 1-2 olemas), jätka — Step 3 on käitumist säilitav refaktor.

- [ ] **Step 3: Asenda inline-loogika helperiga**

`server/routers/admin.py` `admin_reset_password` — asenda `role_hierarchy = {...}` plokk (read ~100-103):

```python
    from ..auth import load_users, can_manage_user
    ...
    if target != user["username"] and not can_manage_user(user["role"], users[target].get("role", "contributor")):
        raise HTTPException(status_code=403, detail="Ei saa lähtestada võrdse või kõrgema õigusega kasutajat")
```

(Eemalda `role_hierarchy`, `acting_level`, `target_level` read; impordi `can_manage_user` ülemise `from ..auth import ...` reaga koos.)

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_admin_role_endpoints.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/admin.py tests/test_admin_role_endpoints.py tests/conftest.py
git commit -m "feat(admin): reset-password kasutab can_manage_user; superadmin saab admini resettida"
```

---

## Task 4: Kollektsioonide struktuursed endpointid → superadmin

**Files:**
- Modify: `server/routers/collections.py` — PUT (~92), POST (~196), DELETE (~298)
- Test: `tests/test_admin_role_endpoints.py` (lisa)

**Interfaces:**
- Consumes: `require_role("superadmin")`, `backend_env` (`admin` + `root`).

- [ ] **Step 1: Write the failing test**

Lisa `tests/test_admin_role_endpoints.py`-sse (kasutab sama `_seed_superadmin` helperit):

```python
def test_admin_cannot_create_collection(client, login):
    token = login("admin", "adminpass")
    r = client.post("/admin/collections",
                    json={"id": "x", "name": {"et": "X", "en": "X"}},
                    headers={"Authorization": f"Bearer {token}"})
    # require_role("superadmin") ebaõnnestumisel tõstab deps.get_user HTTPException(401)
    assert r.status_code == 401


def test_superadmin_can_create_collection(client, login, backend_env):
    _seed_superadmin(backend_env)
    token = login("root", "rootpass")
    r = client.post("/admin/collections",
                    json={"id": "testcoll", "name": {"et": "Test", "en": "Test"}},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
```

NB: kinnitatud — `require_role` ebaõnnestumisel `deps.get_user` tõstab `HTTPException(401)` (`require_token` tagastab error → `raise HTTPException(status_code=401)`). Seega admin → superadmin-endpoint = **401**. Kui `admin_create_collection` eeldab keha-välju, mida testi payload ei anna, ja jõuab 200/500-ni superadminina, kohanda payload endpointi tegeliku ootuse järgi (vt `collections.py:196` keha-parsimist) — väravakontroll (401 admini puhul) on testi tuum.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_admin_role_endpoints.py -k collection -v`
Expected: `test_admin_cannot_create_collection` FAIL (praegu `require_role("admin")` lubab admini läbi).

- [ ] **Step 3: Muuda väravad**

`server/routers/collections.py` — kolmel endpointil asenda `require_role("admin")` → `require_role("superadmin")`:

```python
# rida ~92
async def admin_update_collection(collection_id: str, request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("superadmin"))):
# rida ~196
async def admin_create_collection(request: Request, user=Depends(require_role("superadmin"))):
# rida ~298
async def admin_delete_collection(collection_id: str, background_tasks: BackgroundTasks, user=Depends(require_role("superadmin"))):
```

EI muudeta: `admin_collection_users` (GET, ~176), `admin_collection_works_count` (GET, ~288), ega `editing.py` `bulk_collection` — need jäävad `require_role("admin")`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_admin_role_endpoints.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/collections.py tests/test_admin_role_endpoints.py
git commit -m "feat(collections): struktuursed CRUD endpointid nõuavad superadmini"
```

---

## Task 5: Startup-check — hoiata, kui ühtegi superadmini pole

**Files:**
- Modify: `server/main.py` (lifespan, ~rida 36-42)
- Test: `tests/test_role_permissions.py` (lisa `has_superadmin` käitumise integratsioon — juba kaetud Task 1-s; siin lisa lifespan-loogika otsene test)

**Interfaces:**
- Consumes: `has_superadmin`, `load_users` (auth.py).

- [ ] **Step 1: Write the failing test**

Lisa `tests/test_role_permissions.py`-sse funktsioon, mis testib uut `warn_if_no_superadmin` helperit (eraldame lifespan-loogika testitavaks funktsiooniks):

```python
def test_warn_if_no_superadmin(monkeypatch, caplog):
    import logging
    import server.auth as auth_mod
    monkeypatch.setattr(auth_mod, "load_users", lambda: {"a": {"role": "admin"}})
    with caplog.at_level(logging.WARNING):
        present = auth_mod.warn_if_no_superadmin()
    assert present is False
    assert any("superadmin" in r.message.lower() for r in caplog.records)


def test_warn_if_no_superadmin_present(monkeypatch, caplog):
    import server.auth as auth_mod
    monkeypatch.setattr(auth_mod, "load_users", lambda: {"a": {"role": "superadmin"}})
    present = auth_mod.warn_if_no_superadmin()
    assert present is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_role_permissions.py -k superadmin -v`
Expected: FAIL — `warn_if_no_superadmin` puudub.

- [ ] **Step 3: Lisa helper + kutsu lifespan-is**

`server/auth.py` — lisa (vajab moodulis `logger`-it; kui pole, kasuta olemasolevat logimismustrit — kontrolli faili algust, kas `logger = logging.getLogger(...)` on olemas, muidu lisa):

```python
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
```

`server/main.py` lifespan — lisa `build_work_id_cache()` kõrvale (pärast importe), nt pärast `run_git_fsck()`:

```python
    from .auth import warn_if_no_superadmin
    warn_if_no_superadmin()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_role_permissions.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/auth.py server/main.py tests/test_role_permissions.py
git commit -m "feat(auth): startup-hoiatus kui ühtegi superadmini pole"
```

---

## Task 6: Frontend — roleUtils helperid + Users.tsx + i18n

**Files:**
- Create: `src/utils/roleUtils.ts`, `src/utils/__tests__/roleUtils.test.ts`
- Modify: `src/pages/admin/Users.tsx`, `src/locales/{et,en}/common.json`, `src/locales/{et,en}/admin.json`

**Interfaces:**
- Produces: `ROLE_LEVELS`, `Role`, `roleLevel`, `canManageUser`, `canAssignRole`, `assignableRoles`.

- [ ] **Step 1: Write the failing test**

Loo `src/utils/__tests__/roleUtils.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { roleLevel, canManageUser, canAssignRole, assignableRoles, ROLE_LEVELS } from '../roleUtils';

describe('roleUtils', () => {
  it('hierarhia neli taset', () => {
    expect(ROLE_LEVELS).toEqual({ contributor: 0, editor: 1, admin: 2, superadmin: 3 });
  });
  it('tundmatu roll = -1 (ei anna õigusi)', () => {
    expect(roleLevel('user')).toBe(-1);
    expect(roleLevel('admin')).toBe(2);
  });
  it('canManageUser ainult rangelt madalam', () => {
    expect(canManageUser('admin', 'editor')).toBe(true);
    expect(canManageUser('admin', 'admin')).toBe(false);
    expect(canManageUser('superadmin', 'admin')).toBe(true);
    expect(canManageUser('superadmin', 'superadmin')).toBe(false);
  });
  it('canAssignRole lagi', () => {
    expect(canAssignRole('admin', 'editor')).toBe(true);
    expect(canAssignRole('admin', 'admin')).toBe(false);
    expect(canAssignRole('superadmin', 'admin')).toBe(true);
    expect(canAssignRole('superadmin', 'superadmin')).toBe(false);
  });
  it('assignableRoles filter', () => {
    expect(assignableRoles('admin')).toEqual(['contributor', 'editor']);
    expect(assignableRoles('superadmin')).toEqual(['contributor', 'editor', 'admin']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- roleUtils`
Expected: FAIL — `Cannot find module '../roleUtils'`.

- [ ] **Step 3: Loo roleUtils.ts**

`src/utils/roleUtils.ts`:

```ts
// Rolli-hierarhia frontend-pool. Peegeldab backendi ROLE_HIERARCHY-t.
// MUGAVUS, MITTE TURVE: kõik piirangud dubleeritakse backendis (can_manage_user jne).
export const ROLE_LEVELS: Record<string, number> = {
  contributor: 0,
  editor: 1,
  admin: 2,
  superadmin: 3,
};

export type Role = 'contributor' | 'editor' | 'admin' | 'superadmin';

const ORDER: Role[] = ['contributor', 'editor', 'admin', 'superadmin'];

/** Tundmatu roll = -1 (ei anna õigusi). EI vaikselt 0 — peegeldab backendi rangust. */
export function roleLevel(role: string): number {
  const lvl = ROLE_LEVELS[role];
  return lvl === undefined ? -1 : lvl;
}

export function canManageUser(actorRole: string, targetRole: string): boolean {
  return roleLevel(targetRole) < roleLevel(actorRole);
}

export function canAssignRole(actorRole: string, newRole: string): boolean {
  return roleLevel(newRole) < roleLevel(actorRole);
}

/** Rollid, mida actor tohib määrata (rangelt madalamad), hierarhia järjekorras. */
export function assignableRoles(actorRole: string): Role[] {
  return ORDER.filter((r) => canAssignRole(actorRole, r));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- roleUtils`
Expected: PASS.

- [ ] **Step 5: i18n — lisa superadmin + tooltip**

`src/locales/et/common.json` `roles` blokki lisa:
```json
    "superadmin": "Superadministraator"
```
`src/locales/en/common.json` `roles` blokki:
```json
    "superadmin": "Superadministrator"
```
`src/locales/et/admin.json` `users` blokki lisa:
```json
    "noPermissionManage": "Sul ei ole õigust hallata sama või kõrgema taseme kasutajat"
```
`src/locales/en/admin.json` `users` blokki:
```json
    "noPermissionManage": "You don't have permission to manage a user of equal or higher level"
```
(NB: jälgi JSON-i komasid — lisa eelmise rea lõppu koma.)

- [ ] **Step 6: Juhtmesta Users.tsx**

`src/pages/admin/Users.tsx` muudatused:

**6a.** Import (faili ülaosa, teiste importide juurde):
```tsx
import { ROLE_LEVELS, canManageUser, canAssignRole, assignableRoles, roleLevel } from '../../utils/roleUtils';
```

**6b.** Kustuta lokaalne `const ROLE_LEVEL: Record<string, number> = { contributor: 0, editor: 1, admin: 2 };` (rida ~35) — kasuta imporditud `ROLE_LEVELS`.

**6c.** `User` tüübi `role` union (rida ~24) → lisa superadmin:
```tsx
  role: 'contributor' | 'editor' | 'admin' | 'superadmin';
```

**6d.** Lehe-väravad: asenda KÕIK `user.role !== 'admin'` / `user?.role === 'admin'` kontrollid taseme-põhisega (superadmin PEAB lehele pääsema). Read ~55, ~61, ~212:
```tsx
// rida ~55 (redirect kui pole õigust)
    if (!userLoading && (!user || roleLevel(user.role) < ROLE_LEVELS.admin)) {
// rida ~61 (fetch)
    if (authToken && user && roleLevel(user.role) >= ROLE_LEVELS.admin) {
// rida ~212 (render guard)
  if (roleLevel(user.role) < ROLE_LEVELS.admin) return null;
```

**6e.** `canReset` (rida ~283) → kasuta canManageUser:
```tsx
                const canReset = isCurrentUser || canManageUser(user.role, u.role);
                const canManage = canManageUser(user.role, u.role);
                const canDelete = !isCurrentUser && canManage;
```

**6f.** Rolli-select (read ~395-404) — näita select ainult kui `canManage`, muidu staatiline badge; options = `assignableRoles(user.role)`:
```tsx
                        {isCurrentUser || !canManage ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs"
                                title={!isCurrentUser && !canManage ? t('users.noPermissionManage') : undefined}>
                            {t(`common:roles.${u.role}`)}
                          </span>
                        ) : (
                          <select
                            value={u.role}
                            onChange={(e) => handleRoleChange(u.username, e.target.value)}
                            disabled={isProcessing}
                            className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                          >
                            {assignableRoles(user.role).map((r) => (
                              <option key={r} value={r}>{t(`common:roles.${r}`)}</option>
                            ))}
                          </select>
                        )}
```

(Kuna `canManage` ⟹ target on rangelt madalam ⟹ tema praegune roll on alati `assignableRoles(user.role)` hulgas, on `value={u.role}` alati valiidne valik.)

- [ ] **Step 7: Verify typecheck + tests**

Run: `npm run typecheck && npm run test -- roleUtils`
Expected: tsc puhas (0 viga), vitest PASS.

- [ ] **Step 8: Commit**

```bash
git add src/utils/roleUtils.ts src/utils/__tests__/roleUtils.test.ts src/pages/admin/Users.tsx src/locales/et/common.json src/locales/en/common.json src/locales/et/admin.json src/locales/en/admin.json
git commit -m "feat(users): frontend superadmin-roll, rolli-piirangud + tooltip"
```

---

## Lõppkontroll (pärast kõiki taske)

- [ ] **Backend täissuit:** `.venv/bin/python -m pytest -q` — kõik PASS.
- [ ] **Frontend:** `npm run typecheck && npm run test` — mõlemad PASS.
- [ ] **Spec-coverage käsitsi:** kõvakood-meelis eemaldatud (`grep -rn '"meelis"' server/` → tühi); `.get(role, 0)` puudub uutes helperites; verify_user default contributor.

## Deploy (käsitsi, pärast merge'i — vt spec runbook)

1. Backup `state/users.json` serveris.
2. Muuda Meelise `role` → `superadmin` (`users.json`), atomic.
3. `git pull && docker compose build --no-cache backend && docker compose up -d backend`.
4. Frontend: `npm run build` lokaalselt + `rsync -avz dist/ vutt:~/VUTT/dist/`.
5. Kontrolli: Meelis login; `/admin/users` laeb; admin ei saa admini-rida muuta; superadmin näeb admin-valikut; startup-logis pole "ühtegi superadmini pole" hoiatust.
