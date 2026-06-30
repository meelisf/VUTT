# Kasutaja piiratud kollektsioonide inline-muutmine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lisada `/admin/users` lehel kasutaja-kaardile võimalus muuta inline (chips + dropdown) tema piiratud (restricted) kollektsioonide ligipääsu; olemasolev kollektsiooni-poolne haldus (`CollectionEditor`) jääb muutmata.

**Architecture:** Uus backend-helper `update_user_allowed_collections` (`server/auth.py`) sanitiseerib ja salvestab kasutaja `allowed_collections` välja `state/users.json`-is ning invalideerib tema sessioonid; uus endpoint `POST /admin/users/update-collections` (`server/routers/admin.py`) tagastab serveris salvestatud nimekirja (tõe allikas). Frontend (`src/pages/admin/Users.tsx`) loeb restricted-kogud `useCollection()` kontekstist ja kuvab muudetavad chip'id + lisamise `<select>`. Mõlemad haldusvood kirjutavad sama `allowed_collections` välja → püsivad sünkroonis.

**Tech Stack:** Python 3.9 / FastAPI (backend), pytest; React 19 + TypeScript + Tailwind, react-i18next (frontend).

## Global Constraints

- **Python 3.9 ühilduvus:** EI kasuta `list[str]` tüübivihjeid funktsiooni-signatuurides ega `X | None` süntaksit — kasuta `Optional`/`List` `typing`-ust või jäta annoteerimata. (Docstring võib mainida `list[str]`.)
- **Õigus AINULT keskse loogika kaudu:** kasuta `can_manage_user` (backend) / `canManageUser` (frontend) — MITTE lokaalset `role == "admin"` võrdlust. Superadmin on juba `ROLE_HIERARCHY`-s (4 taset) integreeritud.
- **Serveri vastus on tõe allikas:** frontend kirjutab state'i `response.allowed_collections`, MITTE optimistlikult enda saadetud nimekirja.
- **`allowed_collections` invariant:** salvestatakse AINULT olemasolevad `visibility == "restricted"` kollektsiooni-id-d; tundmatud / avalikud / mitte-string id-d kukuvad vaikselt välja.
- **Import:** `auth.py` tohib teha `from .cache import get_cached_collections` (cache.py EI impordi auth'i ega routereid — ringimporti pole). `auth.py` EI tohi importida `server/routers/*`.
- **Subagentidele:** testid käivita `.venv/bin/python -m pytest`.
- **Frontend gate:** `npm run typecheck` (mitte ainult `build`).
- **Koodikommentaarid eesti keeles.**

---

### Task 1: Backend-helper `update_user_allowed_collections`

**Files:**
- Modify: `server/auth.py` (lisa import + uus funktsioon `delete_user` (rida ~363) kõrvale/järele)
- Test: `tests/test_user_collections.py` (Create)

**Interfaces:**
- Consumes (olemasolevad `server/auth.py`-s): `load_users()`, `save_users(users)`, `delete_user_sessions(username)`, `can_manage_user(actor_role, target_role)`; `from .cache import get_cached_collections`.
- Produces: `update_user_allowed_collections(username, collection_ids, admin_user) -> (success: bool, message: str, allowed_collections: list)`. Vea korral `allowed_collections` on `[]`. Õnnestumisel on see serveris salvestatud (sanitiseeritud, deterministlikus järjekorras) nimekiri.

- [ ] **Step 1: Kirjuta läbikukkuvad testid**

Loo `tests/test_user_collections.py`:

```python
"""Helper update_user_allowed_collections — õigus, sisendikontroll, sanitiseerimine, no-op."""
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server import auth

# Fikseeritud kollektsioonid: alpha+beta restricted (alpha enne beta), pub avalik
COLLECTIONS = {
    "alpha": {"name": {"et": "Alfa"}, "visibility": "restricted"},
    "beta": {"name": {"et": "Beeta"}, "visibility": "restricted"},
    "pub": {"name": {"et": "Avalik"}, "visibility": "public"},
}


@pytest.fixture
def env(monkeypatch):
    """Isoleeri helper: mälu-users, spy save_users + delete_user_sessions, fikseeritud collections."""
    users = {
        "admin": {"role": "admin", "name": "Admin"},
        "ed": {"role": "editor", "name": "Ed", "allowed_collections": []},
        "ed2": {"role": "editor", "name": "Ed2", "allowed_collections": ["alpha"]},
    }
    calls = {"save": 0, "sessions": []}
    monkeypatch.setattr(auth, "load_users", lambda: users)
    monkeypatch.setattr(auth, "save_users", lambda u: calls.__setitem__("save", calls["save"] + 1))
    monkeypatch.setattr(auth, "delete_user_sessions", lambda u: calls["sessions"].append(u))
    monkeypatch.setattr(auth, "get_cached_collections", lambda: COLLECTIONS)
    return {"users": users, "calls": calls}


ADMIN = {"username": "admin", "role": "admin"}


def test_admin_sets_restricted(env):
    ok, msg, allowed = auth.update_user_allowed_collections("ed", ["beta", "alpha"], ADMIN)
    assert ok is True
    # deterministlik järjekord = konfi restricted-järjekord (alpha enne beta), MITTE sisendi järjekord
    assert allowed == ["alpha", "beta"]
    assert env["users"]["ed"]["allowed_collections"] == ["alpha", "beta"]
    assert env["calls"]["save"] == 1
    assert env["calls"]["sessions"] == ["ed"]


def test_dedupe_and_order(env):
    ok, _msg, allowed = auth.update_user_allowed_collections("ed", ["beta", "alpha", "beta"], ADMIN)
    assert ok is True
    assert allowed == ["alpha", "beta"]


def test_sanitize_drops_unknown_and_public(env):
    ok, _msg, allowed = auth.update_user_allowed_collections("ed", ["alpha", "pub", "ghost"], ADMIN)
    assert ok is True
    assert allowed == ["alpha"]


def test_non_list_input_rejected(env):
    ok, msg, allowed = auth.update_user_allowed_collections("ed", "alpha", ADMIN)
    assert ok is False
    assert allowed == []
    assert env["calls"]["save"] == 0


def test_non_string_ids_ignored(env):
    ok, _msg, allowed = auth.update_user_allowed_collections("ed", ["alpha", 123, None], ADMIN)
    assert ok is True
    assert allowed == ["alpha"]


def test_empty_username_rejected(env):
    ok, msg, allowed = auth.update_user_allowed_collections("  ", ["alpha"], ADMIN)
    assert ok is False
    assert allowed == []


def test_unknown_user(env):
    ok, msg, allowed = auth.update_user_allowed_collections("ghost", ["alpha"], ADMIN)
    assert ok is False
    assert "ei leitud" in msg.lower()
    assert allowed == []


def test_permission_denied_equal_level(env):
    # admin ei tohi muuta teise admini (ega iseenda) kollektsioone
    ok, msg, allowed = auth.update_user_allowed_collections("admin", ["alpha"], ADMIN)
    assert ok is False
    assert allowed == []
    assert env["calls"]["save"] == 0


def test_noop_no_save_no_session(env):
    # ed2 on juba ["alpha"]; sama tulemus → ei salvesta, ei katkesta sessiooni
    ok, _msg, allowed = auth.update_user_allowed_collections("ed2", ["alpha"], ADMIN)
    assert ok is True
    assert allowed == ["alpha"]
    assert env["calls"]["save"] == 0
    assert env["calls"]["sessions"] == []
```

- [ ] **Step 2: Käivita testid — peavad läbi kukkuma**

Run: `.venv/bin/python -m pytest tests/test_user_collections.py -v`
Expected: FAIL — `AttributeError: module 'server.auth' has no attribute 'update_user_allowed_collections'`

- [ ] **Step 3: Lisa import `server/auth.py`-sse**

Leia `server/auth.py` ülaosa importide blokk ja lisa (kui veel pole):

```python
from .cache import get_cached_collections
```

- [ ] **Step 4: Lisa funktsioon `server/auth.py`-sse**

Lisa `delete_user(...)` funktsiooni järele (faili lõpupoole):

```python
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
```

- [ ] **Step 5: Käivita testid — peavad läbima**

Run: `.venv/bin/python -m pytest tests/test_user_collections.py -v`
Expected: PASS (9 testi)

- [ ] **Step 6: Commit**

```bash
git add server/auth.py tests/test_user_collections.py
git commit -m "feat(auth): update_user_allowed_collections helper — sanitiseerimine, no-op, sessiooni-invalideerimine"
```

---

### Task 2: Backend-endpoint `POST /admin/users/update-collections`

**Files:**
- Modify: `server/routers/admin.py` (import-rida 8; uus endpoint `admin_update_role` (rida ~65-71) järele)
- Test: `tests/test_user_collections_api.py` (Create)

**Interfaces:**
- Consumes: `update_user_allowed_collections(username, collection_ids, admin_user) -> (bool, str, list)` (Task 1); `require_role("admin")`, `get_json_data` (`server/deps.py`); `HTTPException`.
- Produces: HTTP `POST /admin/users/update-collections`, body `{username: str, allowed_collections: list[str]}`, vastus `{"status": "success", "allowed_collections": list}` (200) või `{"detail": msg}` (400/401).

- [ ] **Step 1: Kirjuta läbikukkuvad endpoint-testid**

Loo `tests/test_user_collections_api.py`:

```python
"""Endpoint-tasandi testid: POST /admin/users/update-collections."""


def _patch_restricted(monkeypatch):
    """Anna cache'ile üks restricted-kogu 'r1' (ja avalik 'pub'), et sanitiseerimist näha."""
    from server import auth
    monkeypatch.setattr(auth, "get_cached_collections", lambda: {
        "r1": {"name": {"et": "R1"}, "visibility": "restricted"},
        "pub": {"name": {"et": "Avalik"}, "visibility": "public"},
    })


def test_admin_updates_collections(client, login, backend_env, monkeypatch):
    _patch_restricted(monkeypatch)
    token = login("admin", "adminpass")
    r = client.post(
        "/admin/users/update-collections",
        json={"username": "editor", "allowed_collections": ["r1", "pub", "ghost"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    # Server sanitiseerib: ainult restricted 'r1' jääb alles, vastus on tõe allikas
    assert r.json()["allowed_collections"] == ["r1"]


def test_editor_cannot_call_endpoint(client, login, backend_env):
    # require_role("admin") ebaõnnestumisel tõstab deps.get_user HTTPException(401)
    token = login("editor", "editorpass")
    r = client.post(
        "/admin/users/update-collections",
        json={"username": "editor", "allowed_collections": []},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 401


def test_admin_cannot_edit_equal_level(client, login, backend_env, monkeypatch):
    _patch_restricted(monkeypatch)
    token = login("admin", "adminpass")
    # admin proovib muuta iseenda (admin-tase) kollektsioone → helper keeldub → 400
    r = client.post(
        "/admin/users/update-collections",
        json={"username": "admin", "allowed_collections": ["r1"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400
```

- [ ] **Step 2: Käivita testid — peavad läbi kukkuma**

Run: `.venv/bin/python -m pytest tests/test_user_collections_api.py -v`
Expected: FAIL — `404 Not Found` (endpointi pole veel)

- [ ] **Step 3: Lisa helper importi `server/routers/admin.py`-s**

Muuda rida 8:

```python
from ..auth import can_manage_user, delete_user, get_all_users, update_user_allowed_collections, update_user_role
```

- [ ] **Step 4: Lisa endpoint `server/routers/admin.py`-sse**

Lisa `admin_update_role` funktsiooni (rida ~65-71) järele:

```python
@router.post("/admin/users/update-collections")
async def admin_update_collections(request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    # NB: anna allowed_collections muutmatult edasi (tüübikontroll on helperis,
    # et see kehtiks ka otseses ühiktestis); vastus sisaldab serveris salvestatud nimekirja
    success, message, allowed = update_user_allowed_collections(
        data.get("username"), data.get("allowed_collections", []), user)
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return {"status": "success", "allowed_collections": allowed}
```

- [ ] **Step 5: Käivita testid — peavad läbima**

Run: `.venv/bin/python -m pytest tests/test_user_collections_api.py -v`
Expected: PASS (3 testi)

- [ ] **Step 6: Regressioon — kogu backend-test**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: PASS (kõik olemasolevad + uued)

- [ ] **Step 7: Commit**

```bash
git add server/routers/admin.py tests/test_user_collections_api.py
git commit -m "feat(admin): POST /admin/users/update-collections endpoint"
```

---

### Task 3: Frontend — i18n võtmed + Users.tsx inline-muutmine

**Files:**
- Modify: `src/locales/et/admin.json` (`users` blokk, rida 29-56)
- Modify: `src/locales/en/admin.json` (`users` blokk)
- Modify: `src/pages/admin/Users.tsx` (import-rida 17-19; uus state; restricted-kogude derivatsioon; "Piiratud kogud" plokk rida 410-423)

**Interfaces:**
- Consumes: `POST /admin/users/update-collections` (Task 2) → `{status, allowed_collections}`; `useCollection()` → `{ collections: Collections }` (`src/contexts/CollectionContext.tsx`); `Collection.visibility?: 'public' | 'restricted'`, `Collection.name: { et, en }` (`src/services/collectionService.ts`); `apiPost` (`src/services/apiClient.ts`); `canManageUser` (`src/utils/roleUtils.ts`).
- Produces: redigeeritav UI (puhtalt frontend; ei ekspordi uut API-d).

- [ ] **Step 1: Lisa i18n võtmed — eesti keel**

`src/locales/et/admin.json`, `users` bloki sisse (rida 55 `noPermissionManage` järele, lisa koma eelmise rea lõppu):

```json
    "noPermissionManage": "Sul ei ole õigust hallata sama või kõrgema taseme kasutajat",
    "restrictedCollections": "Piiratud kogud",
    "addCollection": "lisa kogu",
    "removeCollection": "Eemalda {{name}}",
    "noRestrictedCollections": "Piiratud kogusid pole",
    "collectionsUpdateFailed": "Kollektsioonide uuendamine ebaõnnestus"
```

- [ ] **Step 2: Lisa i18n võtmed — inglise keel**

`src/locales/en/admin.json`, `users` bloki sisse (`noPermissionManage` järele, lisa koma):

```json
    "noPermissionManage": "You don't have permission to manage a user of equal or higher level",
    "restrictedCollections": "Restricted collections",
    "addCollection": "add collection",
    "removeCollection": "Remove {{name}}",
    "noRestrictedCollections": "No restricted collections",
    "collectionsUpdateFailed": "Failed to update collections"
```

- [ ] **Step 3: Users.tsx — importi `useCollection` + restricted-kogude derivatsioon**

`src/pages/admin/Users.tsx`, lisa import (rida 17 `useUser` järele):

```tsx
import { useCollection } from '../../contexts/CollectionContext';
```

Komponendi sees, `const { user, authToken, isLoading: userLoading } = useUser();` (rida 38) järele lisa:

```tsx
  const { collections } = useCollection();

  // Restricted-kollektsioonid {id, name} kujul, sorditud nime järgi (kuvamiseks).
  // allowed_collections mõjutab ligipääsu AINULT restricted-kogude puhul.
  const restrictedCollections = React.useMemo(
    () =>
      Object.entries(collections)
        .filter(([, c]) => c.visibility === 'restricted')
        .map(([id, c]) => ({ id, name: c.name?.et || id }))
        .sort((a, b) => a.name.localeCompare(b.name, 'et')),
    [collections]
  );

  // Lahenda kollektsiooni id → kuvanimi (fallback toore id)
  const collectionName = (id: string): string => collections[id]?.name?.et || id;

  // Per-kasutaja salvestamis-indikaator kollektsioonide muutmisel
  const [collectionsUpdating, setCollectionsUpdating] = useState<string | null>(null);
```

- [ ] **Step 4: Users.tsx — lisa muutmise käsitleja**

Lisa `handleDeleteUser` (rida ~133) järele:

```tsx
  const handleCollectionsChange = async (username: string, nextAllowedCollections: string[]) => {
    setCollectionsUpdating(username);
    setUsersError(null);
    try {
      const data = await apiPost<{ status: string; allowed_collections?: string[]; message?: string }>(
        '/admin/users/update-collections',
        { username, allowed_collections: nextAllowedCollections },
        { token: authToken }
      );
      if (data.status === 'success') {
        // Serveri vastus on tõe allikas (server sanitiseerib) — ära kasuta optimistlikku nimekirja
        setUsers(users.map(u =>
          u.username === username ? { ...u, allowed_collections: data.allowed_collections || [] } : u
        ));
      } else {
        setUsersError(data.message || t('users.collectionsUpdateFailed'));
      }
    } catch (e) {
      console.error('Collections change error:', e);
      setUsersError(t('users.collectionsUpdateFailed'));
    } finally {
      setCollectionsUpdating(null);
    }
  };
```

- [ ] **Step 5: Users.tsx — asenda read-only "Piiratud kogud" plokk muudetavaga**

Asenda kogu plokk (rida 410-423):

```tsx
                      <div className="flex items-start gap-2">
                        <span className="w-24 flex-shrink-0 text-xs font-medium text-gray-500 mt-1">Piiratud kogud</span>
                        {u.allowed_collections && u.allowed_collections.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {u.allowed_collections.map((c) => (
                              <span key={c} className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                                {c}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400 mt-0.5">—</span>
                        )}
                      </div>
```

järgnevaga:

```tsx
                      <div className="flex items-start gap-2">
                        <span className="w-24 flex-shrink-0 text-xs font-medium text-gray-500 mt-1">
                          {t('users.restrictedCollections')}
                        </span>
                        <div className="min-w-0 flex-1">
                          {(() => {
                            const assigned = u.allowed_collections || [];
                            const editable = canManage;
                            const isUpdating = collectionsUpdating === u.username;
                            // Kogud, mida kasutajal veel pole (lisamise dropdowni jaoks)
                            const available = restrictedCollections.filter(rc => !assigned.includes(rc.id));

                            // Read-only vaade (mitte-hallatav kasutaja / iseennast)
                            if (!editable) {
                              return assigned.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {assigned.map((c) => (
                                    <span key={c} className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                                      {collectionName(c)}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-sm text-gray-400">—</span>
                              );
                            }

                            // Muudetav vaade: chip'id (× eemalda) + lisamise dropdown
                            return (
                              <div className="flex flex-wrap items-center gap-1">
                                {assigned.length > 0 ? (
                                  assigned.map((c) => (
                                    <span key={c} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                                      {collectionName(c)}
                                      <button
                                        type="button"
                                        onClick={() => handleCollectionsChange(u.username, assigned.filter(x => x !== c))}
                                        disabled={isUpdating}
                                        className="hover:text-blue-900 disabled:opacity-50"
                                        title={t('users.removeCollection', { name: collectionName(c) })}
                                        aria-label={t('users.removeCollection', { name: collectionName(c) })}
                                      >
                                        <X size={12} />
                                      </button>
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-sm text-gray-400">—</span>
                                )}
                                {isUpdating && <Loader2 size={12} className="animate-spin text-gray-400" />}
                                {restrictedCollections.length === 0 ? (
                                  <span className="text-xs text-gray-400">{t('users.noRestrictedCollections')}</span>
                                ) : available.length > 0 ? (
                                  <select
                                    value=""
                                    onChange={(e) => {
                                      if (e.target.value) handleCollectionsChange(u.username, [...assigned, e.target.value]);
                                    }}
                                    disabled={isUpdating}
                                    className="text-xs border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                                  >
                                    <option value="">+ {t('users.addCollection')}</option>
                                    {available.map((rc) => (
                                      <option key={rc.id} value={rc.id}>{rc.name}</option>
                                    ))}
                                  </select>
                                ) : null}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
```

- [ ] **Step 6: Käivita typecheck**

Run: `npm run typecheck`
Expected: PASS (vigadeta). Kui `React.useMemo` annab vea (React vaikeimport puudub) — fail kasutab juba `import React, { useState, useEffect } from 'react'`, seega `React.useMemo` on saadaval; alternatiivina lisa `useMemo` nimeliselt importi ja kasuta `useMemo`.

- [ ] **Step 7: Commit**

```bash
git add src/locales/et/admin.json src/locales/en/admin.json src/pages/admin/Users.tsx
git commit -m "feat(users): inline restricted-kollektsioonide muutmine (chips + dropdown) kasutaja-kaardil"
```

---

## Deploy (pärast kõigi tasside läbimist — käsitsi, kasutaja kinnitusel)

Backend (Python muudatus → `--no-cache` kohustuslik) + frontend:

```bash
ssh vutt
cd ~/VUTT
git pull
docker compose build --no-cache backend && docker compose up -d backend
# Frontend (lokaalses masinas):
# npm run build && rsync -avz dist/ vutt:~/VUTT/dist/
```

Meilisearch reseed EI ole vaja (ainult `users.json` muutub, mitte teoste indeks).

---

## Self-Review

**Spec coverage:**
- Backend helper (sanitiseerimine, no-op, sessiooni-invalideerimine, serveri-vastus tõe allikana, tüübikontroll, deterministlik järjekord, õigus keskse loogikaga) → Task 1 ✅
- Endpoint tagastab `allowed_collections` → Task 2 ✅
- Frontend: useCollection restricted-filter, chips+dropdown, serveri-vastus state'i, resolved nimi, tühja seisu eristus (`noRestrictedCollections` vs available==0 vs assigned==0), veakäsitlus → Task 3 ✅
- i18n viis võtit et+en → Task 3 Step 1-2 ✅
- Import-tsükli vältimine (auth←cache) → Global Constraints + Task 1 Step 3 ✅
- Testid: õigus, tüübikontroll, sanitiseerimine, dedupe+järjekord, no-op, endpoint-auth → Task 1+2 ✅
- CollectionEditor puutumata (ulatusest väljas) → ühtegi taski seda ei muuda ✅

**Placeholder scan:** Kõik sammud sisaldavad täielikku koodi; placeholder'eid pole.

**Type consistency:** `update_user_allowed_collections(username, collection_ids, admin_user) -> (bool, str, list)` ühtne Task 1↔2 vahel; frontend `handleCollectionsChange(username, nextAllowedCollections: string[])` ja vastus `{ allowed_collections?: string[] }` ühtsed; `collectionName`/`restrictedCollections`/`collectionsUpdating` defineeritud Task 3 Step 3, kasutatud Step 4-5.
