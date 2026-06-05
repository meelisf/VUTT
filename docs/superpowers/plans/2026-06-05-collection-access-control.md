# Collection Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add collection-level read access control — restricted collections are hidden from unauthenticated users and users without explicit permission, using Meilisearch tenant tokens + backend `can_read_work()` enforcement.

**Architecture:** Meilisearch documents get `is_public` and `shareable` boolean fields. A new `server/access_ops.py` provides `can_read_work()` checked on all read endpoints. Frontend receives a scoped Meilisearch tenant token at login (or from a public endpoint when anonymous) instead of a static API key. A new `MeilisearchContext` manages the dynamic token.

**Tech Stack:** Python/FastAPI backend, React 19 + TypeScript frontend, Meilisearch, existing `get_cached_collections()` cache (TTL 5 min)

---

## File Map

**New files:**
- `server/access_ops.py` — `is_work_public()` + `can_read_work()`
- `src/contexts/MeilisearchContext.tsx` — dynamic Meilisearch client with token management
- `tests/test_access_ops.py` — unit tests for access control logic

**Modified files:**
- `server/meilisearch_ops.py` — add `is_public`/`shareable` fields, `filterableAttributes`, `generate_meili_token()`, mass-update on visibility change
- `server/main.py` — `can_read_work()` on read endpoints, `/api/meili-token` endpoint, login response, collection visibility + user access admin endpoints, `shareable` toggle
- `server/auth.py` — `get_all_users()` returns `allowed_collections`; new user creation includes `allowed_collections: []`
- `server/config.py` — add `MEILI_SEARCH_KEY`, `MEILI_SEARCH_KEY_UID` env vars
- `src/config.ts` — remove `VITE_MEILI_SEARCH_API_KEY`
- `src/services/meiliService.ts` — remove static `index` export
- `src/services/searchService.ts` — `index` as first argument on all exported functions
- `src/services/pageService.ts` — `index` as first argument
- `src/services/workService.ts` — `index` as first argument
- `src/pages/Dashboard.tsx` — use `useMeiliIndex()`
- `src/pages/Workspace.tsx` — use `useMeiliIndex()`, add `shareable` toggle in admin tab
- `src/pages/SearchPage.tsx` — use `useMeiliIndex()`
- `src/pages/Statistics.tsx` — use `useMeiliIndex()`
- `src/pages/search/hooks/useSearchResults.ts` — use `useMeiliIndex()`
- `src/pages/search/hooks/useSearchFacets.ts` — use `useMeiliIndex()`
- `src/pages/search/SearchResults.tsx` — use `useMeiliIndex()`
- `src/pages/Admin.tsx` (or admin sub-components) — collection visibility toggle, allowed_collections user management
- `tests/conftest.py` — add `allowed_collections` to test users, add `MEILI_SEARCH_KEY`/`MEILI_SEARCH_KEY_UID` to backend_env

---

## Task 1: Backend — `server/access_ops.py` with tests

**Files:**
- Create: `server/access_ops.py`
- Create: `tests/test_access_ops.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_access_ops.py
import pytest

# Stub get_cached_collections so tests don't need real cache
COLLECTIONS_PUBLIC = {
    "col-public": {"name": {"et": "Avalik"}, "visibility": "public"},
    "col-restricted": {"name": {"et": "Piiratud"}, "visibility": "restricted"},
}


@pytest.fixture(autouse=True)
def mock_collections(monkeypatch):
    import server.access_ops as ao
    monkeypatch.setattr(ao, "get_cached_collections", lambda: COLLECTIONS_PUBLIC)


def test_no_collections_is_public():
    from server.access_ops import is_work_public
    assert is_work_public({"collections": []}) is True
    assert is_work_public({}) is True


def test_public_collection_wins():
    from server.access_ops import is_work_public
    assert is_work_public({"collections": ["col-public"]}) is True


def test_restricted_collection_is_not_public():
    from server.access_ops import is_work_public
    assert is_work_public({"collections": ["col-restricted"]}) is False


def test_public_wins_over_restricted():
    from server.access_ops import is_work_public
    # teos on kahes kollektsioonis — üks avalik, üks piiratud → avalik
    assert is_work_public({"collections": ["col-restricted", "col-public"]}) is True


def test_unknown_collection_defaults_to_public():
    from server.access_ops import is_work_public
    assert is_work_public({"collections": ["col-unknown"]}) is True


def test_can_read_public_work_anonymous():
    from server.access_ops import can_read_work
    assert can_read_work({"collections": ["col-public"]}, user=None) is True


def test_can_read_shareable_work_anonymous():
    from server.access_ops import can_read_work
    assert can_read_work({"collections": ["col-restricted"], "shareable": True}, user=None) is True


def test_cannot_read_restricted_anonymous():
    from server.access_ops import can_read_work
    assert can_read_work({"collections": ["col-restricted"]}, user=None) is False


def test_admin_reads_restricted():
    from server.access_ops import can_read_work
    user = {"role": "admin", "allowed_collections": []}
    assert can_read_work({"collections": ["col-restricted"]}, user=user) is True


def test_user_with_allowed_collection_reads_restricted():
    from server.access_ops import can_read_work
    user = {"role": "contributor", "allowed_collections": ["col-restricted"]}
    assert can_read_work({"collections": ["col-restricted"]}, user=user) is True


def test_user_without_allowed_collection_cannot_read_restricted():
    from server.access_ops import can_read_work
    user = {"role": "editor", "allowed_collections": []}
    assert can_read_work({"collections": ["col-restricted"]}, user=user) is False


def test_user_without_matching_collection_cannot_read():
    from server.access_ops import can_read_work
    user = {"role": "contributor", "allowed_collections": ["other-col"]}
    assert can_read_work({"collections": ["col-restricted"]}, user=user) is False
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_access_ops.py -v 2>&1 | head -30
```

Expected: `ModuleNotFoundError: No module named 'server.access_ops'`

- [ ] **Step 3: Implement `server/access_ops.py`**

```python
# server/access_ops.py
from .cache import get_cached_collections


def is_work_public(work_metadata: dict) -> bool:
    """Arvutab teose avalikkuse dünaamiliselt collections.json põhjal.
    "public wins": piisab ühest avalikust kollektsioonist.
    """
    work_cols = work_metadata.get("collections", [])
    if not work_cols:
        return True
    collections_config = get_cached_collections()
    for col_id in work_cols:
        if collections_config.get(col_id, {}).get("visibility", "public") == "public":
            return True
    return False


def can_read_work(work_metadata: dict, user: "dict | None") -> bool:
    """Kontrollib kas kasutajal on õigus teost lugeda.
    Kasutatakse kõigil lugemise endpoint'idel, sõltumata Meilisearch'i indeksist.
    """
    if is_work_public(work_metadata):
        return True
    if work_metadata.get("shareable", False):
        return True
    if user is None:
        return False
    if user.get("role") == "admin":
        return True
    allowed = set(user.get("allowed_collections", []))
    work_collections = set(work_metadata.get("collections", []))
    return bool(allowed & work_collections)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_access_ops.py -v
```

Expected: 12 passed

- [ ] **Step 5: Commit**

```bash
git add server/access_ops.py tests/test_access_ops.py
git commit -m "feat: lisa can_read_work() ja is_work_public() access_ops.py"
```

---

## Task 2: Backend — `generate_meili_token()` ja env vars

**Files:**
- Modify: `server/config.py`
- Modify: `server/meilisearch_ops.py`

- [ ] **Step 1: Lisa env muutujad `config.py`-sse**

Ava `server/config.py`. Leia kus `MEILI_KEY` ja `MEILI_URL` on defineeritud (praegu rida ~170). Lisa nende kõrvale:

```python
MEILI_SEARCH_KEY = os.getenv("MEILI_SEARCH_KEY", "")
MEILI_SEARCH_KEY_UID = os.getenv("MEILI_SEARCH_KEY_UID", "")
```

Uuenda ka `config.py` eksporti kus `MEILI_KEY` on imporditud (otsi `from .config import ... MEILI_KEY ...` teistest failidest — `meilisearch_ops.py` impordib seda).

- [ ] **Step 2: Lisa `generate_meili_token()` funktsioon `meilisearch_ops.py`-sse**

Ava `server/meilisearch_ops.py`. Leia impordi plokk ülaosas. Lisa import:

```python
from datetime import datetime, timezone, timedelta
import jwt  # PyJWT — lisatakse requirements.txt-i
```

Lisa faili lõppu (enne `if __name__ == '__main__'` kui see eksisteerib):

```python
def generate_meili_token(user=None, ttl_seconds: int = 3600) -> str:
    """Genereerib Meilisearch'i tenant tokeni kasutaja õiguste põhjal.

    user=None → anonüümne token (filter: is_public = true)
    user admin → piiranguta token
    user contributor/editor → filter: is_public = true + allowed collections
    """
    from .config import MEILI_SEARCH_KEY, MEILI_SEARCH_KEY_UID

    if not MEILI_SEARCH_KEY or not MEILI_SEARCH_KEY_UID:
        raise RuntimeError("MEILI_SEARCH_KEY ja MEILI_SEARCH_KEY_UID peavad olema seadistatud")

    base_filter = "is_public = true"

    if user and user.get("role") == "admin":
        search_rules = {"teosed": {}}  # piiranguta
    else:
        allowed = (user or {}).get("allowed_collections", [])
        if allowed:
            cols = ", ".join(f'"{c}"' for c in allowed)
            meili_filter = f"{base_filter} OR collections_hierarchy IN [{cols}]"
        else:
            meili_filter = base_filter
        search_rules = {"teosed": {"filter": meili_filter}}

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)

    payload = {
        "searchRules": search_rules,
        "apiKeyUid": MEILI_SEARCH_KEY_UID,
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(payload, MEILI_SEARCH_KEY, algorithm="HS256")
    return token if isinstance(token, str) else token.decode("utf-8")
```

- [ ] **Step 3: Kontrolli et PyJWT on requirements.txt-is**

```bash
grep -i "pyjwt\|PyJWT\|jwt" /home/mf/LLM/VUTT/server/requirements.txt
```

Kui puudub, lisa rida `PyJWT>=2.0` requirements.txt-i.

- [ ] **Step 4: Kirjuta test**

```python
# Lisa tests/test_access_ops.py lõppu:

def test_generate_meili_token_anonymous(monkeypatch):
    import jwt
    from server.meilisearch_ops import generate_meili_token
    monkeypatch.setenv("MEILI_SEARCH_KEY", "test-key-32-chars-long-padding-x")
    monkeypatch.setenv("MEILI_SEARCH_KEY_UID", "test-uid-1234")
    # Reimpordime konfigi et env muutujad mõjuksid
    import importlib, server.config as cfg
    cfg.MEILI_SEARCH_KEY = "test-key-32-chars-long-padding-x"
    cfg.MEILI_SEARCH_KEY_UID = "test-uid-1234"

    token = generate_meili_token(user=None)
    payload = jwt.decode(token, "test-key-32-chars-long-padding-x", algorithms=["HS256"])
    assert payload["searchRules"] == {"teosed": {"filter": "is_public = true"}}
    assert payload["apiKeyUid"] == "test-uid-1234"
    assert payload["exp"] > 0


def test_generate_meili_token_admin(monkeypatch):
    import jwt
    from server.meilisearch_ops import generate_meili_token
    import server.config as cfg
    cfg.MEILI_SEARCH_KEY = "test-key-32-chars-long-padding-x"
    cfg.MEILI_SEARCH_KEY_UID = "test-uid-1234"

    token = generate_meili_token(user={"role": "admin", "allowed_collections": []})
    payload = jwt.decode(token, "test-key-32-chars-long-padding-x", algorithms=["HS256"])
    assert payload["searchRules"] == {"teosed": {}}


def test_generate_meili_token_with_collection(monkeypatch):
    import jwt
    from server.meilisearch_ops import generate_meili_token
    import server.config as cfg
    cfg.MEILI_SEARCH_KEY = "test-key-32-chars-long-padding-x"
    cfg.MEILI_SEARCH_KEY_UID = "test-uid-1234"

    user = {"role": "contributor", "allowed_collections": ["herrnhuter"]}
    token = generate_meili_token(user=user)
    payload = jwt.decode(token, "test-key-32-chars-long-padding-x", algorithms=["HS256"])
    assert 'collections_hierarchy IN ["herrnhuter"]' in payload["searchRules"]["teosed"]["filter"]
    assert "is_public = true" in payload["searchRules"]["teosed"]["filter"]
```

- [ ] **Step 5: Käivita testid**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_access_ops.py -v -k "token"
```

Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add server/config.py server/meilisearch_ops.py server/requirements.txt tests/test_access_ops.py
git commit -m "feat: generate_meili_token() Meilisearch tenant tokenite jaoks"
```

---

## Task 3: Backend — `is_public` ja `shareable` Meilisearch'i indekseerimises

**Files:**
- Modify: `server/meilisearch_ops.py`

- [ ] **Step 1: Leia `sync_work_to_meilisearch()` dokumendi ehitamise koht**

`server/meilisearch_ops.py` rida ~516 juures on blokk kus dokumendi väljad pannakse kokku (`"collections": work_collections, "collections_hierarchy": collections_hierarchy, ...`). Leia see koht.

- [ ] **Step 2: Lisa `is_public` ja `shareable` dokumendi väljadeks**

Leia rida kus `"collections_hierarchy": collections_hierarchy,` on. Lisa selle järele:

```python
            # Ligipääsukontroll
            "is_public": any(
                collections.get(c, {}).get("visibility", "public") == "public"
                for c in work_collections
            ) if work_collections else True,
            "shareable": metadata.get("shareable", False),
```

(Muutuja `collections` on juba laetud seal plokis — see on `load_collections()` tulemus.)

- [ ] **Step 3: Lisa `filterableAttributes` uuendus**

Otsi `meilisearch_ops.py`-st funktsioon mis seadistab Meilisearch'i indeksi sätteid (otsib `filterableAttributes` sõna). Kui sellist funktsiooni pole, leia kus indeks luuakse/seadistatakse. Lisa `is_public` ja `shareable` filterable attributes nimekirja.

Kui konfiguratsiooni funktsiooni pole, lisa `sync_work_to_meilisearch()` algusesse ühekordseks init-kutseks:

```python
def _ensure_filterable_attributes():
    """Tagab et is_public ja shareable on filterableAttributes-s."""
    from .config import MEILI_URL, MEILI_KEY, INDEX_NAME
    import urllib.request, json
    url = f"{MEILI_URL}/indexes/{INDEX_NAME}/settings/filterable-attributes"
    req = urllib.request.Request(url, method='GET')
    req.add_header('Authorization', f'Bearer {MEILI_KEY}')
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            current = json.loads(r.read())
        needed = {"is_public", "shareable", "collections_hierarchy", "collections"}
        if not needed.issubset(set(current)):
            new_attrs = list(set(current) | needed)
            patch_req = urllib.request.Request(
                url,
                data=json.dumps(new_attrs).encode(),
                method='PUT'
            )
            patch_req.add_header('Authorization', f'Bearer {MEILI_KEY}')
            patch_req.add_header('Content-Type', 'application/json')
            urllib.request.urlopen(patch_req, timeout=10)
    except Exception as e:
        print(f"filterableAttributes uuendus ebaõnnestus: {e}")
```

Kutsu `_ensure_filterable_attributes()` serveris ühe korra käivitamisel (lisa `rebuild_indices()` funktsiooni algusesse või `main.py` startup sündmusse).

- [ ] **Step 4: Lisa massuuendus `update_collection_visibility()` funktsioon**

```python
def update_collection_is_public_async(collection_id: str, is_public: bool):
    """Uuendab kõigi antud kollektsiooni teoste is_public välja Meilisearchi asünkroonselt."""
    from .config import BASE_DIR, MEILI_URL, MEILI_KEY, INDEX_NAME
    import urllib.request, json

    # Leia kõik teosed mis kuuluvad sellesse kollektsiooni
    docs_to_update = []
    if os.path.isdir(BASE_DIR):
        for folder in os.listdir(BASE_DIR):
            meta_path = os.path.join(BASE_DIR, folder, '_metadata.json')
            if not os.path.exists(meta_path):
                continue
            try:
                with open(meta_path, 'r', encoding='utf-8') as f:
                    meta = json.load(f)
                work_cols = meta.get('collections', [])
                if collection_id not in work_cols:
                    continue
                work_id = meta.get('work_id')
                if not work_id:
                    continue
                # Arvuta uus is_public kõigi kollektsioonide põhjal
                all_cols = load_collections()
                new_is_public = any(
                    all_cols.get(c, {}).get("visibility", "public") == "public"
                    for c in work_cols
                ) if work_cols else True
                docs_to_update.append({"id": f"{work_id}-1", "work_id": work_id, "is_public": new_is_public})
            except Exception:
                continue

    if not docs_to_update:
        return

    # Meilisearch'i osauuendus (ainult is_public väli)
    url = f"{MEILI_URL}/indexes/{INDEX_NAME}/documents"
    req = urllib.request.Request(url, data=json.dumps(docs_to_update).encode(), method='POST')
    req.add_header('Authorization', f'Bearer {MEILI_KEY}')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            result = json.loads(r.read())
            print(f"is_public massuuendus käivitatud, task_uid={result.get('taskUid')}, {len(docs_to_update)} teost")
    except Exception as e:
        print(f"is_public massuuendus ebaõnnestus: {e}")
```

NB: see funktsioon kutsutakse `background_tasks.add_task(...)` kaudu `main.py`-st — ei blokeeri HTTP vastust.

- [ ] **Step 5: Commit**

```bash
git add server/meilisearch_ops.py
git commit -m "feat: lisa is_public ja shareable Meilisearchi indekseerimisse"
```

---

## Task 4: Backend — `/api/meili-token` endpoint ja login uuendus

**Files:**
- Modify: `server/main.py`

- [ ] **Step 1: Leia login endpoint (rida ~120)**

```python
@app.post("/login")
async def login(request: Request):
    ...
    if user: return {"status": "success", "user": user, "token": create_session(user)}
```

- [ ] **Step 2: Uuenda login vastust — lisa `meili_token`**

Asenda login return:

```python
    if user:
        from .meilisearch_ops import generate_meili_token
        try:
            meili_token = generate_meili_token(user=user, ttl_seconds=3600)
        except Exception as e:
            print(f"Meili token genereerimine ebaõnnestus: {e}")
            meili_token = None
        return {
            "status": "success",
            "user": user,
            "token": create_session(user),
            "meili_token": meili_token,
        }
```

- [ ] **Step 3: Lisa `/api/meili-token` endpoint (anonüümne)**

Lisa endpoint `main.py`-sse `/login` järele:

```python
@app.get("/api/meili-token")
async def public_meili_token():
    """Anonüümne Meilisearchi tenant token — filter: is_public = true."""
    from .meilisearch_ops import generate_meili_token
    try:
        token = generate_meili_token(user=None, ttl_seconds=3600)
        return {"token": token}
    except Exception as e:
        # Kui token genereerimine ebaõnnestub (nt võti puudub), tagasta tühi string
        print(f"Meili token genereerimine ebaõnnestus: {e}")
        return {"token": ""}


@app.post("/api/meili-token/refresh")
async def refresh_meili_token(request: Request):
    """Uuendab autentitud kasutaja Meilisearchi tokeni."""
    from .meilisearch_ops import generate_meili_token
    token_str = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    session = get_session(token_str)
    if not session:
        raise HTTPException(status_code=401, detail="Sessioon aegunud")
    user = session["user"]
    # Lae värske allowed_collections (kasutaja õigused võivad olla muutunud)
    users = load_users()
    full_user = users.get(user["username"], user)
    user_with_collections = {**user, "allowed_collections": full_user.get("allowed_collections", [])}
    try:
        new_token = generate_meili_token(user=user_with_collections, ttl_seconds=3600)
        return {"token": new_token}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Token refresh ebaõnnestus: {e}")
```

- [ ] **Step 4: Lisa testimine**

```python
# tests/test_backend_smoke.py lõppu lisa:

def test_public_meili_token_endpoint(client, backend_env):
    """GET /api/meili-token tagastab tokeni ilma authita."""
    response = client.get("/api/meili-token")
    assert response.status_code == 200
    data = response.json()
    assert "token" in data
    # Token võib olla tühi string kui MEILI_SEARCH_KEY pole seadistatud (test env)
    assert isinstance(data["token"], str)


def test_login_returns_meili_token(client, login, backend_env):
    """Login vastus sisaldab meili_token välja."""
    token = login("editor", "editorpass")
    # login() fixture tagastab ainult session tokeni, kontrollime otse:
    response = client.post("/login", json={"username": "editor", "password": "editorpass"})
    assert response.status_code == 200
    data = response.json()
    assert "meili_token" in data
```

- [ ] **Step 5: Käivita testid**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_backend_smoke.py -v -k "meili_token" 2>&1 | tail -15
```

Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add server/main.py tests/test_backend_smoke.py
git commit -m "feat: /api/meili-token endpoint ja login meili_token väli"
```

---

## Task 5: Backend — `can_read_work()` read endpoint'idel

**Files:**
- Modify: `server/main.py`

- [ ] **Step 1: Lisa import `main.py` ülaossa**

Leia impordiplokk `main.py` alguses. Lisa:

```python
from .access_ops import can_read_work
```

- [ ] **Step 2: Kaitseabi-funktsioon work metaandmete laadimiseks**

Lisa `main.py`-sse helper funktsioon (kasuta olemasolevat `find_directory_by_id` ja `load_users` mustrit):

```python
def _load_work_metadata(work_id: str) -> dict | None:
    """Laeb teose _metadata.json faili sisu. Tagastab None kui teos ei leitud."""
    folder = find_directory_by_id(work_id)
    if not folder:
        return None
    meta_path = os.path.join(folder, '_metadata.json')
    if not os.path.exists(meta_path):
        return None
    try:
        with open(meta_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _get_optional_user(request: Request) -> dict | None:
    """Loeb valikulise autentimise — tagastab kasutaja dict'i või None."""
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not token:
        return None
    session = get_session(token)
    if not session:
        return None
    username = session["user"]["username"]
    users = load_users()
    user_data = users.get(username, {})
    return {**session["user"], "allowed_collections": user_data.get("allowed_collections", [])}
```

- [ ] **Step 3: Kaitsemine `/download/{work_id}` endpoint'il**

Leia rida ~1611: `@app.get("/download/{work_id}")`. Pärast `folder = find_directory_by_id(work_id)` ja 404-kontrolli, lisa:

```python
    # Ligipääsukontroll
    user = _get_optional_user(request)
    meta_path_check = os.path.join(folder, '_metadata.json')
    if os.path.exists(meta_path_check):
        with open(meta_path_check, 'r', encoding='utf-8') as f:
            meta_check = json.load(f)
        if not can_read_work(meta_check, user):
            raise HTTPException(status_code=403, detail="Ligipääs keelatud")
```

- [ ] **Step 4: Kaitsemine `/meta/work/{work_id}` endpoint'il**

Leia rida ~1732: `@app.get("/meta/work/{work_id}")`. Muuda:

```python
@app.get("/meta/work/{work_id}")
async def work_meta(work_id: str, request: Request):
    meta = _load_work_metadata(work_id)
    if meta:
        user = _get_optional_user(request)
        if not can_read_work(meta, user):
            return HTMLResponse(content="<html><body>Ligipääs keelatud</body></html>", status_code=403)
    return HTMLResponse(content=build_meta_html(work_id))
```

- [ ] **Step 5: Lisa `can_read_work()` test**

```python
# tests/test_backend_smoke.py lõppu:

def test_download_restricted_work_blocked(client, backend_env, monkeypatch):
    """Piiratud teose allalaadimine on blokeeritud anonüümsele kasutajale."""
    import server.access_ops as ao
    # Stub can_read_work → False (simuleerib piiratud teost)
    monkeypatch.setattr(ao, "can_read_work", lambda meta, user: False)
    # Stub find_directory_by_id → tagasta midagi
    import server.utils as utils
    monkeypatch.setattr(utils, "find_directory_by_id", lambda wid: "/fake/path")
    import os
    monkeypatch.setattr(os.path, "exists", lambda p: True)

    response = client.get("/download/fake-work-id")
    assert response.status_code == 403
```

- [ ] **Step 6: Käivita testid**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_backend_smoke.py -v -k "restricted" 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
git add server/main.py tests/test_backend_smoke.py
git commit -m "feat: can_read_work() read endpoint'ide kaitseks"
```

---

## Task 6: Backend — kollektsiooni `visibility` ja kasutajate `allowed_collections` admin endpoint'id

**Files:**
- Modify: `server/main.py`
- Modify: `server/auth.py`

- [ ] **Step 1: Uuenda `admin_update_collection` endpoint (rida ~1356)**

Leia `@app.put("/admin/collections/{collection_id}")`. Pärast `color` töötlemist, enne `atomic_write_json` kutsumist, lisa `visibility` töötlemine:

```python
    visibility = body.get("visibility")
    if visibility in ("public", "restricted"):
        data[collection_id]["visibility"] = visibility
    elif visibility is not None:
        return {"status": "error", "message": "visibility peab olema 'public' või 'restricted'"}

    old_visibility = data[collection_id].get("visibility", "public")
```

Pärast `atomic_write_json` ja `invalidate_cache()` kutsumist, lisa asünkroonne Meilisearch'i uuendus:

```python
    # Kui visibility muutus, uuenda Meilisearch'is is_public asünkroonselt
    new_visibility = data[collection_id].get("visibility", "public")
    if visibility and old_visibility != new_visibility:
        background_tasks.add_task(
            update_collection_is_public_async,
            collection_id,
            new_visibility == "public"
        )
```

Uuenda funktsiooni signatuuri et see aktsepteerib `BackgroundTasks`:

```python
async def admin_update_collection(collection_id: str, request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("admin"))):
```

Lisa import: `from .meilisearch_ops import update_collection_is_public_async`

- [ ] **Step 2: Lisa `allowed_collections` haldus kollektsiooni endpoint'ile**

Sama endpoint'i lõpus (enne `return`), lisa:

```python
    # allowed_collections: kasutajate haldus kollektsiooni tasandil
    allowed_users = body.get("allowed_users")  # list kasutajanimedest või None
    if allowed_users is not None:
        users = load_users()
        for username, udata in users.items():
            current = set(udata.get("allowed_collections", []))
            if username in allowed_users:
                current.add(collection_id)
            else:
                current.discard(collection_id)
            users[username]["allowed_collections"] = list(current)
        save_users(users)
```

- [ ] **Step 3: Lisa `GET /admin/collections/{collection_id}/users` endpoint**

Lisa `main.py`-sse (lisada uus endpoint kollektsiooni nägemise jaoks koos kasutajate infoga):

```python
@app.get("/admin/collections/{collection_id}/users")
async def admin_collection_users(collection_id: str, user=Depends(require_role("admin"))):
    """Tagastab kollektsiooni metaandmed koos ligipääsuga kasutajate nimekirjaga."""
    if not os.path.exists(COLLECTIONS_FILE):
        return {"status": "error", "message": "collections.json ei leitud"}
    with open(COLLECTIONS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if collection_id not in data:
        return {"status": "error", "message": f"Kollektsioon '{collection_id}' ei leitud"}

    col = data[collection_id]
    users = load_users()
    allowed_usernames = [
        uname for uname, udata in users.items()
        if collection_id in udata.get("allowed_collections", [])
    ]
    return {
        "status": "success",
        "collection": col,
        "allowed_users": allowed_usernames,
    }
```

- [ ] **Step 4: Uuenda `auth.py` — `get_all_users()` tagastab `allowed_collections`**

Leia `get_all_users()` funktsioon `server/auth.py`-s (rida ~193). Uuenda return dict:

```python
    for username, user_data in users.items():
        result.append({
            "username": username,
            "name": user_data.get("name", ""),
            "email": user_data.get("email", ""),
            "role": user_data.get("role", "contributor"),
            "created_at": user_data.get("created_at"),
            "allowed_collections": user_data.get("allowed_collections", []),  # UUS
        })
```

- [ ] **Step 5: Uuenda `verify_user()` tagastus — lisa `allowed_collections`**

Leia `verify_user()` (rida ~102). Uuenda return:

```python
    if users[username]["password_hash"] == password_hash:
        return {
            "username": username,
            "name": users[username]["name"],
            "role": users[username].get("role", "user"),
            "allowed_collections": users[username].get("allowed_collections", []),  # UUS
        }
```

- [ ] **Step 5b: Paranda `test_login_and_verify_token_roundtrip` test**

`verify_user()` tagastab nüüd `allowed_collections` välja. Olemasolev test kasutab täpset dict võrdsust ja lõhub. Leia `tests/test_backend_smoke.py`-s `test_login_and_verify_token_roundtrip` ja uuenda assertion:

```python
data = response.json()
assert data["status"] == "success"
assert data["valid"] is True
assert data["user"]["username"] == "admin"
assert data["user"]["role"] == "admin"
assert "allowed_collections" in data["user"]  # ei kontrolli täpset väärtust
```

- [ ] **Step 6: Kollektsiooni kustutamisel puhasta `allowed_collections`**

Leia `admin_delete_collection` endpoint `main.py`-st (kui see eksisteerib) või `_find_works_with_collection` funktsioon rida ~1448 juures. Lisa kollektsiooni kustutamise loogikasse:

```python
def _cleanup_allowed_collections_on_delete(collection_id: str):
    """Eemaldab kustutatud kollektsiooni ID kõigi kasutajate allowed_collections'ist."""
    users = load_users()
    changed = False
    for uname, udata in users.items():
        current = udata.get("allowed_collections", [])
        if collection_id in current:
            users[uname]["allowed_collections"] = [c for c in current if c != collection_id]
            changed = True
    if changed:
        save_users(users)
```

Kutsu seda kus kollektsioon kustutatakse.

- [ ] **Step 7: Test**

```python
# tests/test_backend_smoke.py lõppu:

def test_collection_visibility_update(client, login, backend_env):
    """Admin saab kollektsiooni visibility muuta."""
    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}

    # Lisa testimiseks kollektsioon collections.json-i
    import json
    from pathlib import Path
    cols_file = Path(backend_env["COLLECTIONS_FILE"])
    data = json.loads(cols_file.read_text()) if cols_file.exists() else {}
    data["test-col"] = {"name": {"et": "Test"}, "visibility": "public"}
    cols_file.write_text(json.dumps(data))

    response = client.put(
        "/admin/collections/test-col",
        headers=headers,
        json={"visibility": "restricted"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "success"

    updated = json.loads(cols_file.read_text())
    assert updated["test-col"]["visibility"] == "restricted"
```

- [ ] **Step 8: Käivita testid**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_backend_smoke.py -v -k "collection_visibility" 2>&1 | tail -10
```

- [ ] **Step 9: Commit**

```bash
git add server/main.py server/auth.py
git commit -m "feat: kollektsiooni visibility ja allowed_collections admin endpoint'id"
```

---

## Task 7: Backend — `shareable` toggle endpoint

**Files:**
- Modify: `server/main.py`

- [ ] **Step 1: Lisa `shareable` toggle endpoint**

```python
@app.post("/work/{work_id}/shareable")
async def toggle_shareable(work_id: str, request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("editor"))):
    """Seab teose shareable lipu. Body: {shareable: bool}"""
    body = await request.json()
    shareable = bool(body.get("shareable", False))

    folder = find_directory_by_id(work_id)
    if not folder:
        return {"status": "error", "message": "Teos ei leitud"}

    result = save_work_metadata(
        work_id,
        {"shareable": shareable},
        username=user["username"],
        commit_msg=f"{'Aktiveeri' if shareable else 'Deaktiveeri'} jagamine: {work_id}",
        sync_meili=True,
        background_tasks=background_tasks,
    )
    return result
```

- [ ] **Step 2: Commit**

```bash
git add server/main.py
git commit -m "feat: shareable toggle endpoint teose jagamise jaoks"
```

---

## Task 8: Frontend — `MeilisearchContext`

**Files:**
- Create: `src/contexts/MeilisearchContext.tsx`
- Modify: `src/main.tsx` (või kus `App` on mähitud provideritega)

- [ ] **Step 1: Loo `src/contexts/MeilisearchContext.tsx`**

```tsx
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { MeiliSearch, Index } from 'meilisearch';
import { MEILI_HOST, MEILI_INDEX } from '../config';

interface MeilisearchContextValue {
  index: Index | null;
  refreshToken: () => Promise<void>;
  setUserToken: (token: string) => void;
  clearUserToken: () => void;
}

const MeilisearchContext = createContext<MeilisearchContextValue>({
  index: null,
  refreshToken: async () => {},
  setUserToken: () => {},
  clearUserToken: () => {},
});

function makeIndex(token: string): Index {
  return new MeiliSearch({ host: MEILI_HOST, apiKey: token }).index(MEILI_INDEX);
}

export function MeilisearchProvider({ children }: { children: React.ReactNode }) {
  const [index, setIndex] = useState<Index | null>(null);
  const tokenExpiresAt = useRef<number>(0);
  const isUserToken = useRef(false);

  const fetchAnonToken = useCallback(async () => {
    try {
      const r = await fetch('/api/meili-token');
      const { token } = await r.json();
      if (token) {
        setIndex(makeIndex(token));
        tokenExpiresAt.current = Date.now() + 60 * 60 * 1000; // 1h
        isUserToken.current = false;
      }
    } catch (e) {
      console.error('Meili anonüümse tokeni laadimine ebaõnnestus', e);
    }
  }, []);

  const refreshToken = useCallback(async () => {
    if (isUserToken.current) {
      // Kasutajapõhine token — pikenda sessiooni kaudu
      try {
        const sessionToken = localStorage.getItem('vutt_token') || '';
        const r = await fetch('/api/meili-token/refresh', {
          method: 'POST',
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (r.ok) {
          const { token } = await r.json();
          if (token) {
            setIndex(makeIndex(token));
            tokenExpiresAt.current = Date.now() + 60 * 60 * 1000;
            return;
          }
        }
      } catch {}
    }
    await fetchAnonToken();
  }, [fetchAnonToken]);

  const setUserToken = useCallback((token: string) => {
    setIndex(makeIndex(token));
    tokenExpiresAt.current = Date.now() + 60 * 60 * 1000;
    isUserToken.current = true;
  }, []);

  const clearUserToken = useCallback(() => {
    isUserToken.current = false;
    fetchAnonToken();
  }, [fetchAnonToken]);

  // Lae anonüümne token käivitamisel
  useEffect(() => {
    fetchAnonToken();
  }, [fetchAnonToken]);

  // Perioodiline refresh (55 min) — kaitseb suspended tab vastu kontrollides ka enne päringut
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() > tokenExpiresAt.current - 60_000) {
        refreshToken();
      }
    }, 55 * 60 * 1000);
    return () => clearInterval(id);
  }, [refreshToken]);

  return (
    <MeilisearchContext.Provider value={{ index, refreshToken, setUserToken, clearUserToken }}>
      {children}
    </MeilisearchContext.Provider>
  );
}

export function useMeiliIndex(): Index | null {
  return useContext(MeilisearchContext).index;
}

export function useMeilisearch(): MeilisearchContextValue {
  return useContext(MeilisearchContext);
}
```

- [ ] **Step 2: Lisa `MeilisearchProvider` rakenduse juure**

Ava `src/main.tsx`. Leia kus `<App />` on mähitud muude provideritega. Lisa `MeilisearchProvider`:

```tsx
import { MeilisearchProvider } from './contexts/MeilisearchContext';

// ... olemasolevate providerite sees:
<MeilisearchProvider>
  <App />
</MeilisearchProvider>
```

- [ ] **Step 3: Uuenda `AuthContext` (või kus login/logout toimub) et kasutada `setUserToken`/`clearUserToken`**

Leia kus login vastust töödeldakse (`localStorage.setItem('vutt_token', ...)` jms). Lisa:

```tsx
import { useMeilisearch } from './contexts/MeilisearchContext';

// login handler sees:
const { setUserToken } = useMeilisearch();
// ...
if (response.meili_token) {
  setUserToken(response.meili_token);
}

// logout handler sees:
const { clearUserToken } = useMeilisearch();
clearUserToken();
```

- [ ] **Step 4: Commit**

```bash
git add src/contexts/MeilisearchContext.tsx src/main.tsx src/contexts/UserContext.tsx
git commit -m "feat: MeilisearchContext dünaamiliste tenant tokenite jaoks"
```

---

## Task 9: Frontend — service failide refaktor (dependency injection)

**Files:**
- Modify: `src/services/meiliService.ts`
- Modify: `src/services/searchService.ts`
- Modify: `src/services/pageService.ts`
- Modify: `src/services/workService.ts`

- [ ] **Step 1: Eemalda staatiline `index` eksport `meiliService.ts`-st**

Leia `src/services/meiliService.ts` ridad kus `client` ja `index` on mooduli tasemel loodud:

```typescript
const client = new MeiliSearch({
  host: MEILI_HOST,
  apiKey: MEILI_API_KEY,
});
export const index = client.index(MEILI_INDEX);
```

Asenda see (eemalda `index` eksport, hoia klient ainult kui seda on mujal vaja):

```typescript
// index eksporti enam ei ole — kasutatakse MeilisearchContext'i
// MEILI_API_KEY import eemaldatakse config.ts-st hiljem
```

Kontrolli et `checkMixedContent`, `normalizeWork`, `normalizePage`, `normalizeContentSearchHit`, `calculateWorkStatus` jäävad ekspordituks — neid kasutatakse teistes failides.

- [ ] **Step 2: Uuenda `searchService.ts` — `index` esimese argumendina**

Leia kõik exportitud funktsioonid (`getTeoseTagsFacets`, `getGenreFacets`, `getTypeFacets`, `getGenreLabelMap`, `getTagsLabelMap`, `getAuthorFacets`, `searchWorks`, `searchContent`, `searchWorkHits`, `getAllTags`). Igale funktsioonile lisa `index: Index` esimese parameetrina. Eemalda `import { index } from './meiliService'` — asenda `import type { Index } from 'meilisearch'`-ga.

Näide (muutus üks funktsioon):

```typescript
// Enne:
export const getTeoseTagsFacets = async (...): Promise<...> => {
  const response = await index.search('', { ... });
  ...
};

// Pärast:
export const getTeoseTagsFacets = async (index: Index, ...): Promise<...> => {
  const response = await index.search('', { ... });
  ...
};
```

Tee sama kõigile funktsioonidele selles failis.

- [ ] **Step 3: Uuenda `pageService.ts`**

Leia `getPage` (rida ~87). Lisa `index: Index` esimese parameetrina. Eemalda staatiline import.

```typescript
// Enne:
export const getPage = async (workId: string, pageNum: number): Promise<Page | null> => {
  const response = await index.search(...);

// Pärast:
export const getPage = async (index: Index, workId: string, pageNum: number): Promise<Page | null> => {
  const response = await index.search(...);
```

`savePage` ei kasuta `index`-it (läheb läbi backendi) — jätke muutmata.

- [ ] **Step 4: Uuenda `workService.ts`**

`getWorkStatuses` (rida ~11) ja `getWorkMetadata` (rida ~46) kasutavad `index`-it. Lisa `index: Index` esimese parameetrina mõlemale. `getWorkPageImages` ei kasuta `index`-it — jätke.

- [ ] **Step 5: Uuenda kõik kutsujad**

Iga koht kus service funktsioone kutsutakse, lisa `index` esimese argumendina. Kasuta `useMeiliIndex()`:

```tsx
// src/pages/Dashboard.tsx
import { useMeiliIndex } from '../contexts/MeilisearchContext';
import { searchWorks } from '../services/searchService';

function Dashboard() {
  const index = useMeiliIndex();
  // ...
  const results = await searchWorks(index!, query, options);
}
```

Käi läbi kõik failid mis importivad service funktsioone:
- `src/pages/Dashboard.tsx`
- `src/pages/Workspace.tsx`
- `src/pages/SearchPage.tsx`
- `src/pages/Statistics.tsx`
- `src/pages/search/hooks/useSearchResults.ts`
- `src/pages/search/hooks/useSearchFacets.ts`
- `src/pages/search/SearchResults.tsx`

- [ ] **Step 6: TypeScript build kontroll**

```bash
cd /home/mf/LLM/VUTT && npm run build 2>&1 | tail -20
```

Expected: build õnnestub ilma TypeScript vigadeta.

- [ ] **Step 7: Commit**

```bash
git add src/services/ src/pages/ src/contexts/
git commit -m "refactor: searchService/pageService/workService saavad index argumendina"
```

---

## Task 10: Frontend — eemaldame `VITE_MEILI_SEARCH_API_KEY`

**Files:**
- Modify: `src/config.ts`
- Modify: `.env` / `.env.production` (kohalik)

- [ ] **Step 1: Uuenda `src/config.ts`**

Leia rida `export const MEILI_API_KEY = import.meta.env.VITE_MEILI_SEARCH_API_KEY || '';`. Eemalda see rida täielikult (või asenda kommentaariga et see on liikunud MeilisearchContext'i).

Kontrolli et `MEILI_API_KEY` pole enam kuskil kasutuses:

```bash
grep -rn "MEILI_API_KEY" /home/mf/LLM/VUTT/src/
```

Kui leiab kasutusi — eemalda need.

- [ ] **Step 2: Kontrolli build`**

```bash
cd /home/mf/LLM/VUTT && npm run build 2>&1 | grep -i "error\|MEILI_API_KEY"
```

Expected: ei leidu vigu.

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "refactor: eemalda VITE_MEILI_SEARCH_API_KEY — asendatud MeilisearchContext'iga"
```

---

## Task 11: Frontend — Admin UI kollektsiooni visibility ja kasutajate haldus

**Files:**
- Modify: `src/pages/Admin.tsx` (või admin sub-komponentide failid)

Leia admin lehel kus kollektsioone kuvatakse/redigeeritakse. Täpne failistruktuur selgub vaatamisel:

```bash
grep -rn "admin_update_collection\|PUT.*collections\|/admin/collections" /home/mf/LLM/VUTT/src/ | head -10
```

- [ ] **Step 1: Lisa `visibility` toggle kollektsiooni redigeerimise vaatesse**

Leia kollektsiooni edit form. Lisa:

```tsx
{/* Nähtavus */}
<div className="flex items-center gap-4 mt-3">
  <span className="text-sm font-medium text-gray-700">Nähtavus:</span>
  <label className="flex items-center gap-1.5 cursor-pointer">
    <input
      type="radio"
      name="visibility"
      value="public"
      checked={visibility === 'public'}
      onChange={() => setVisibility('public')}
    />
    <span className="text-sm">Avalik</span>
  </label>
  <label className="flex items-center gap-1.5 cursor-pointer">
    <input
      type="radio"
      name="visibility"
      value="restricted"
      checked={visibility === 'restricted'}
      onChange={() => setVisibility('restricted')}
    />
    <span className="text-sm">Piiratud</span>
  </label>
</div>

{/* Ligipääsuga kasutajad — ainult kui piiratud */}
{visibility === 'restricted' && (
  <div className="mt-3">
    <p className="text-sm font-medium text-gray-700 mb-1">Ligipääsuga kasutajad:</p>
    {allowedUsers.map(username => (
      <span key={username} className="inline-flex items-center gap-1 bg-gray-100 px-2 py-0.5 rounded text-sm mr-1">
        {username}
        <button onClick={() => removeUser(username)} className="text-gray-400 hover:text-red-500">×</button>
      </span>
    ))}
    <select
      onChange={e => { if (e.target.value) addUser(e.target.value); e.target.value = ''; }}
      className="text-sm border rounded px-2 py-0.5 mt-1"
    >
      <option value="">+ Lisa kasutaja</option>
      {allUsers.filter(u => !allowedUsers.includes(u.username)).map(u => (
        <option key={u.username} value={u.username}>{u.name} ({u.username})</option>
      ))}
    </select>
  </div>
)}
```

Lisa state ja API kutsed:

```typescript
const [visibility, setVisibility] = useState<'public' | 'restricted'>(collection.visibility || 'public');
const [allowedUsers, setAllowedUsers] = useState<string[]>([]);

// Lae kasutajad kollektsiooni avamisel
useEffect(() => {
  fetch(`/api/admin/collections/${collectionId}/users`, {
    headers: { Authorization: `Bearer ${token}` }
  })
    .then(r => r.json())
    .then(data => setAllowedUsers(data.allowed_users || []));
}, [collectionId]);

// Salvestamisel lisa visibility ja allowed_users body'sse
const handleSave = async () => {
  await fetch(`/admin/collections/${collectionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ color, description, visibility, allowed_users: allowedUsers }),
  });
};
```

- [ ] **Step 2: Kasutaja real näita allowed_collections (read-only)**

Leia admin kasutajate tabel. Lisa veergu:

```tsx
<td className="text-xs text-gray-500">
  {user.allowed_collections?.length > 0
    ? user.allowed_collections.join(', ')
    : '—'}
</td>
```

- [ ] **Step 3: Build ja manuaalne test**

```bash
cd /home/mf/LLM/VUTT && npm run build 2>&1 | tail -5
```

Ava localhost:5173/admin, kontrolli et kollektsiooni redigeerimisel näed visibility toggle'it ja kasutajate haldust.

- [ ] **Step 4: Commit**

```bash
git add src/pages/
git commit -m "feat: admin UI — kollektsiooni visibility ja kasutajate ligipääs"
```

---

## Task 12: Frontend — `shareable` toggle Workspace halduse sektsioonis

**Files:**
- Modify: `src/pages/Workspace.tsx`

- [ ] **Step 1: Leia Workspace'is admin/halduse sektsioon**

```bash
grep -n "Ajalugu\|Haldus\|history\|admin.*tab\|shareable" /home/mf/LLM/VUTT/src/pages/Workspace.tsx | head -15
```

- [ ] **Step 2: Lisa `shareable` state ja toggle**

```tsx
const [shareable, setShareable] = useState<boolean>(work?.shareable ?? false);

// Sünkroniseeri kui work muutub
useEffect(() => {
  setShareable(work?.shareable ?? false);
}, [work?.shareable]);

const handleShareableToggle = async (newValue: boolean) => {
  setShareable(newValue);
  await fetch(`/work/${workId}/shareable`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ shareable: newValue }),
  });
};
```

- [ ] **Step 3: Lisa UI halduse sektsiooni**

```tsx
{/* Jagamine — ainult editor/admin */}
{(user?.role === 'editor' || user?.role === 'admin') && (
  <div className="border-t pt-4 mt-4">
    <p className="text-sm font-semibold text-gray-700 mb-2">Jagamine</p>
    <div className="flex items-center gap-4">
      <label className="flex items-center gap-1.5 cursor-pointer">
        <input
          type="radio"
          checked={!shareable}
          onChange={() => handleShareableToggle(false)}
        />
        <span className="text-sm">Privaatne</span>
      </label>
      <label className="flex items-center gap-1.5 cursor-pointer">
        <input
          type="radio"
          checked={shareable}
          onChange={() => handleShareableToggle(true)}
        />
        <span className="text-sm">Jagatav (otselingiga)</span>
      </label>
    </div>
    {shareable && (
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-gray-500 font-mono truncate">
          {window.location.origin}/workspace/{workId}
        </span>
        <button
          onClick={() => navigator.clipboard.writeText(`${window.location.origin}/workspace/${workId}`)}
          className="text-xs text-blue-600 hover:underline whitespace-nowrap"
        >
          Kopeeri
        </button>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4: Lisa `shareable` väli `Work` tüübile kui puudub**

```bash
grep -n "shareable" /home/mf/LLM/VUTT/src/types.ts
```

Kui puudub, lisa `Work` interface'i:

```typescript
shareable?: boolean;
```

Lisa ka `meiliService.ts` `normalizeWork()` funktsiooni:

```typescript
shareable: hit.shareable ?? false,
```

- [ ] **Step 5: Build ja manuaalne test**

```bash
cd /home/mf/LLM/VUTT && npm run build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/Workspace.tsx src/types.ts src/services/meiliService.ts
git commit -m "feat: shareable toggle Workspace halduse sektsioonis"
```

---

## Task 13: Migratsioon — re-indekseerimine serveris

**Eesmärk:** Kõik olemasolevad teosed saavad `is_public: true`, `shareable: false`. `filterableAttributes` uuendatakse.

- [ ] **Step 1: Kontrolli et backend on üles (pärast deployd)**

```bash
ssh vutt 'docker compose ps'
```

Expected: `vutt-backend` on `running`.

- [ ] **Step 2: Käivita re-indekseerimine**

```bash
ssh vutt 'cd ~/VUTT && ./scripts/server_seed_data.sh'
```

Jälgi väljundit — otsid ridu kus `is_public` ja `shareable` välju lisatakse.

- [ ] **Step 3: Kontrolli Meilisearch'is et filterableAttributes on uuendatud**

```bash
ssh vutt 'curl -s -H "Authorization: Bearer $(grep MEILISEARCH_MASTER_KEY ~/VUTT/.env | cut -d= -f2)" http://127.0.0.1:7700/indexes/teosed/settings/filterable-attributes'
```

Expected: vastuses on `is_public` ja `shareable`.

- [ ] **Step 4: Kontrolli et `is_public` on indekseeritud**

```bash
ssh vutt 'curl -s -H "Authorization: Bearer $(grep MEILISEARCH_MASTER_KEY ~/VUTT/.env | cut -d= -f2)" -X POST http://127.0.0.1:7700/indexes/teosed/search -H "Content-Type: application/json" -d "{\"q\":\"\",\"limit\":1,\"attributesToRetrieve\":[\"work_id\",\"is_public\",\"shareable\"]}"'
```

Expected: vastuses on `is_public: true` ja `shareable: false`.

---

## Task 14: Deploy ja lõplik kontroll

- [ ] **Step 1: Lisa `MEILI_SEARCH_KEY` ja `MEILI_SEARCH_KEY_UID` serveri `.env`-i**

Serveris on vaja luua search-only API võti:

```bash
ssh vutt
cd ~/VUTT

# Loe master key
MASTER_KEY=$(grep MEILISEARCH_MASTER_KEY .env | cut -d= -f2)

# Loo search-only API võti
curl -X POST http://127.0.0.1:7700/keys \
  -H "Authorization: Bearer $MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "VUTT frontend search-only key",
    "actions": ["search"],
    "indexes": ["teosed"],
    "expiresAt": null
  }'
```

Kopeeri vastusest `key` ja `uid` väärtused. Lisa `.env`-i:

```
MEILI_SEARCH_KEY=<key väärtus>
MEILI_SEARCH_KEY_UID=<uid väärtus>
```

- [ ] **Step 2: Backend deploy**

```bash
ssh vutt 'cd ~/VUTT && git pull && docker compose build --no-cache backend && docker compose up -d backend'
```

Oota ~30s, kontrolli:

```bash
ssh vutt 'curl -s http://127.0.0.1:8002/api/meili-token'
```

Expected: `{"token": "eyJ..."}`

- [ ] **Step 3: Frontend deploy**

Lokaalsel masinal:

```bash
cd /home/mf/LLM/VUTT && npm run build && rsync -avz dist/ vutt:~/VUTT/dist/
```

- [ ] **Step 4: Lõplik manuaalne test**

1. Ava brauser, mine VUTT-i
2. Ava DevTools → Network, otsige `/api/meili-token` päring — peab olema 200
3. Loo testiks piiratud kollektsioon Admin lehel
4. Lisa teos piiratud kollektsiooni
5. Logi välja — veendu et teos ei ole dashboard'il nähtav
6. Logi sisse kasutajaga kellel pole ligipääsu — veendu et teos pole nähtav
7. Lisa kasutajale ligipääs kollektsioonile — veendu et teos on nähtav pärast uuesti sisselogimist
8. Testi `shareable` toggle — jaga link, ava inkognito aknas — veendu et teos on nähtav

- [ ] **Step 5: Lõplik commit**

```bash
git add -A
git commit -m "feat: kollektsiooni-põhine ligipääsukontroll valmis"
```
