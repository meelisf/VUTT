# `server/main.py` Modulariseerimine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jagada 2100-realine `server/main.py` kümneks fokusseeritud routerifailiks, säilitades täielikku tagasiühilduvust ja 259 testi rohelisena.

**Architecture:** FastAPI `APIRouter` muster — iga routerifail defineerib `router = APIRouter()`, `main.py` teeb `app.include_router(router)`. Jagatud sõltuvused (`get_user`, `require_role`, `_load_work_metadata` jt) kolivad `server/deps.py`-sse. Teavituste äriloogika eraldatakse `server/notifications_ops.py`-sse. Sitemapi cache kolib `server/cache.py`-sse. Töö toimub taskide kaupa, iga taski lõpus testid läbivad.

**Tech Stack:** Python 3.9, FastAPI APIRouter, pytest, olemasolev testifraimework (`tests/conftest.py` `backend_env` fixture)

---

## Failide kaart

| Fail | Seis pärast refaktorit |
|------|----------------------|
| `server/main.py` | ~120 rida: app init, middleware, lifespan, router include'id, `/health` |
| `server/deps.py` | **Uus.** Jagatud FastAPI sõltuvused ja abivahendit |
| `server/notifications_ops.py` | **Uus.** Teavituste äriloogika (praegu `main.py`-s) |
| `server/cache.py` | **Muutub.** Lisa sitemapi cache + `invalidate_all_caches()` |
| `server/routers/__init__.py` | **Uus.** Tühi |
| `server/routers/auth.py` | **Uus.** login, logout, token, invite, kasutajad, registreerimine |
| `server/routers/user_settings.py` | **Uus.** user-settings, user-chars |
| `server/routers/notifications.py` | **Uus.** teavitused CRUD |
| `server/routers/editor.py` | **Uus.** /save, /page-comments/reply, git-history, commit-diff, git-restore, recent-edits |
| `server/routers/bulk.py` | **Uus.** bulk-collection, bulk-tags, bulk-genre |
| `server/routers/metadata_config.py` | **Uus.** get/update metadata, suggestions, vocabularies, entity-labels, archives |
| `server/routers/admin_maintenance.py` | **Uus.** trash, git-failures, git-health, people-refresh |
| `server/routers/upload.py` | **Uus.** /admin/upload/**, /admin/uploads |
| `server/routers/admin_work.py` | **Uus.** /admin/work/**, lehekülgede haldus, reocr |
| `server/routers/collections.py` | **Uus.** /collections, /admin/collections/**, /config/archives |
| `server/routers/public.py` | **Uus.** download, viewer-token, shareable, /meta/work, /sitemap.xml |

---

## Enne alustamist: baseline

- [ ] **Käivita testid ja salvesta arv**

```bash
.venv/bin/python -m pytest tests/ --ignore=tests/test_consolidate_data.py -q 2>&1 | tail -3
```

Oodatav: `259 passed`. See on sihtarv — iga taski lõpus peab sama arv läbima.

---

## Task 1: Loo `server/deps.py` jagatud sõltuvustega

**Files:**
- Create: `server/deps.py`
- Modify: `server/main.py` (import jagatud sõltuvused sealt)

Kõik routerid vajavad samu abivahendeid. Enne routerite loomist tuleb need ühte kohta koondada, muidu tekivad tsirkulaarsed impordid.

- [ ] **Samm 1: Loo `server/deps.py`**

```python
"""
Jagatud FastAPI sõltuvused kõigile routeritele.
"""
import json
import os
from fastapi import Request, HTTPException
from .utils import find_directory_by_id
from .auth import require_token, get_session, load_users
from .rate_limit import get_client_ip, check_rate_limit


async def get_user(request: Request, min_role: str = "contributor"):
    """
    Ühtne autentimine. Järjekord:
    1. Authorization: Bearer <token> header (eelistatud)
    2. query-param 'token' (ainult <img src> tüüpi GET-id, nt upload thumb)
    """
    token = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    if not token:
        token = request.query_params.get("token")
    if not token:
        raise HTTPException(status_code=401, detail="Autentimine nõutud")
    user, error = require_token({"auth_token": token}, min_role=min_role)
    if error:
        raise HTTPException(status_code=401, detail=error["message"])
    return user


def require_role(role: str):
    async def role_dependency(request: Request):
        return await get_user(request, min_role=role)
    return role_dependency


async def get_json_data(request: Request):
    return await request.json()


def load_work_metadata(work_id: str):
    """Laeb teose _metadata.json. Tagastab None kui ei leitud."""
    from .config import BASE_DIR
    folder = find_directory_by_id(work_id)
    if not folder:
        return None
    meta_path = os.path.join(folder, "_metadata.json")
    if not os.path.exists(meta_path):
        return None
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def get_optional_user(request: Request):
    """Tagastab autentitud kasutaja või None anonüümsele."""
    token_str = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not token_str:
        return None
    session = get_session(token_str)
    if not session:
        return None
    username = session["user"]["username"]
    users = load_users()
    user_data = users.get(username, {})
    return {**session["user"], "allowed_collections": user_data.get("allowed_collections", [])}
```

- [ ] **Samm 2: Uuenda `server/main.py` — asenda kohalikud definitsioonid impordiga**

Leia `main.py`-st funktsioonid `get_user`, `require_role`, `get_json_data`, `_load_work_metadata`, `_get_optional_user` ja asenda nende **definitsioonid** impordiga:

```python
from .deps import get_user, require_role, get_json_data, load_work_metadata, get_optional_user
```

Seejärel asenda kõik `main.py` sisesed kutsed:
- `_load_work_metadata(x)` → `load_work_metadata(x)`
- `_get_optional_user(x)` → `get_optional_user(x)`

- [ ] **Samm 3: Käivita testid**

```bash
.venv/bin/python -m pytest tests/ --ignore=tests/test_consolidate_data.py -q 2>&1 | tail -3
```

Oodatav: `259 passed`.

- [ ] **Samm 4: Commit**

```bash
git add server/deps.py server/main.py
git commit -m "refactor: tõsta jagatud sõltuvused server/deps.py-sse"
```

---

## Task 2: Tõsta sitemapi cache `server/cache.py`-sse

**Files:**
- Modify: `server/cache.py`
- Modify: `server/main.py`

`_sitemap_cache` elab praegu `main.py`-s, aga routerid peavad saama cache'i tühjendada ilma `main`-i importimata.

- [ ] **Samm 1: Lisa `server/cache.py`-sse sitemap cache ja ühine invalidaator**

Leia `server/cache.py` lõpp ja lisa:

```python
# Sitemapi cache (TTL 1h, uuendatakse /sitemap.xml endpointis)
_sitemap_cache: dict = {"xml": None, "expires": 0.0}


def invalidate_sitemap_cache():
    _sitemap_cache["xml"] = None


def invalidate_all_caches():
    """Tühjendab kõik cache'id: kollektsioonid, soovitused, sitemap."""
    invalidate_cache()
    _sitemap_cache["xml"] = None
```

- [ ] **Samm 2: Uuenda `server/main.py`**

Lisa impordi reale:
```python
from .cache import (
    get_cached_collections, get_cached_vocabularies, get_cached_people_aliases,
    get_cached_people_register, get_cached_suggestions, invalidate_cache,
    get_cached_archives, _sitemap_cache, invalidate_all_caches,
)
```

Kustuta `main.py`-st:
- `_sitemap_cache: dict = {"xml": None, "expires": 0.0}` definitsioon
- `_invalidate_all_caches()` funktsioon definitsioon

Asenda kõik `_invalidate_all_caches()` kutsed → `invalidate_all_caches()`.

Uuenda `sitemap_xml` endpointi et kasutaks imporditud `_sitemap_cache`:
```python
@app.get("/sitemap.xml")
async def sitemap_xml():
    import time
    from . import utils as utils_module
    from .cache import _sitemap_cache
    now = time.time()
    if _sitemap_cache["xml"] is None or now > _sitemap_cache["expires"]:
        _sitemap_cache["xml"] = build_sitemap_xml(
            dict(utils_module.WORK_ID_CACHE),
            is_work_public,
            load_work_metadata,
        )
        _sitemap_cache["expires"] = now + 3600
    return Response(content=_sitemap_cache["xml"], media_type="application/xml")
```

- [ ] **Samm 3: Käivita testid**

```bash
.venv/bin/python -m pytest tests/ --ignore=tests/test_consolidate_data.py -q 2>&1 | tail -3
```

Oodatav: `259 passed`.

- [ ] **Samm 4: Commit**

```bash
git add server/cache.py server/main.py
git commit -m "refactor: tõsta sitemapi cache ja invalidate_all_caches server/cache.py-sse"
```

---

## Task 3: Loo `server/notifications_ops.py`

**Files:**
- Create: `server/notifications_ops.py`
- Modify: `server/main.py`

Teavituste äriloogika (7 abifunktsiooni, ~120 rida) elab praegu `main.py`-s. Routerite lahutamiseks peab see eraldi moodulis olema.

- [ ] **Samm 1: Loo `server/notifications_ops.py`**

```python
"""
Teavituste haldus: loomine, laadimine, salvestamine.
"""
import json
import os
import threading
import uuid
from datetime import datetime
from fastapi import HTTPException
from .config import NOTIFICATIONS_DIR, get_logger
from .utils import atomic_write_json
from .auth import get_all_users

logger = get_logger(__name__)

_notifications_lock = threading.RLock()


def _safe_username(username: str) -> str:
    """Piira teavituste failinimi lihtsa kasutajanime kujule."""
    return os.path.basename(username or "").strip()


def get_notifications_path(username: str) -> str:
    safe = _safe_username(username)
    if not safe:
        raise HTTPException(status_code=400, detail="Vigane kasutajanimi")
    return os.path.join(NOTIFICATIONS_DIR, f"{safe}.json")


def load_notifications(username: str) -> list:
    path = get_notifications_path(username)
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, list) else []


def save_notifications(username: str, notifications: list):
    os.makedirs(NOTIFICATIONS_DIR, exist_ok=True)
    atomic_write_json(get_notifications_path(username), notifications)


def append_notification(username: str, notification: dict):
    with _notifications_lock:
        notifications = load_notifications(username)
        notifications.insert(0, notification)
        save_notifications(username, notifications[:200])


def create_notification(
    recipient_username: str,
    notification_type: str,
    title: str,
    body: str = "",
    link: str = "",
    actor=None,
    metadata=None,
) -> dict:
    now = datetime.now().isoformat()
    notification = {
        "id": uuid.uuid4().hex,
        "type": notification_type,
        "recipient_username": recipient_username,
        "title": title,
        "body": body,
        "link": link,
        "actor_username": actor.get("username") if actor else "",
        "actor_name": (actor.get("name") or actor.get("username")) if actor else "",
        "metadata": metadata or {},
        "created_at": now,
        "read_at": None,
    }
    append_notification(recipient_username, notification)
    return notification


def find_username_by_display_name(display_name: str):
    if not display_name:
        return None
    for account in get_all_users():
        if account.get("username") == display_name or account.get("name") == display_name:
            return account.get("username")
    return None
```

- [ ] **Samm 2: Uuenda `server/main.py` — kasuta notifications_ops**

Lisa importimisel:
```python
from .notifications_ops import (
    _notifications_lock, load_notifications, save_notifications,
    append_notification, create_notification, find_username_by_display_name,
    get_notifications_path,
)
```

Kustuta `main.py`-st funktsioonide definitsioonid:
`_notifications_lock`, `_safe_username`, `_get_notifications_path`, `_load_notifications`,
`_save_notifications`, `_append_notification`, `_create_notification`, `_find_username_by_display_name`

Uuenda kutsed:
- `_load_notifications(x)` → `load_notifications(x)`
- `_save_notifications(x, y)` → `save_notifications(x, y)`
- `_create_notification(...)` → `create_notification(...)`
- `_find_username_by_display_name(x)` → `find_username_by_display_name(x)`
- `_get_notifications_path(x)` → `get_notifications_path(x)`

- [ ] **Samm 3: Käivita testid**

```bash
.venv/bin/python -m pytest tests/ --ignore=tests/test_consolidate_data.py -q 2>&1 | tail -3
```

Oodatav: `259 passed`.

- [ ] **Samm 4: Commit**

```bash
git add server/notifications_ops.py server/main.py
git commit -m "refactor: tõsta teavituste loogika server/notifications_ops.py-sse"
```

---

## Task 4: Router — `server/routers/user_settings.py`

**Files:**
- Create: `server/routers/__init__.py`
- Create: `server/routers/user_settings.py`
- Modify: `server/main.py`

Väikseim router — hea harjutus mustri kinnitamiseks.

- [ ] **Samm 1: Loo `server/routers/__init__.py`**

```python
```
(Tühi fail)

- [ ] **Samm 2: Loo `server/routers/user_settings.py`**

Leia `main.py`-st endpointid `/user-settings` (GET+POST) ja `/user-chars` (GET+POST), sealhulgas nende abivahendit ning lõigud ridade `~1906–2040` vahemikust.

```python
"""
Kasutaja seadete ja isiklike märkide endpointid.
"""
import json
import os
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from ..deps import get_user, require_role, get_json_data
from ..config import USER_SETTINGS_DIR, get_logger
from ..utils import atomic_write_json

router = APIRouter()
logger = get_logger(__name__)


def _user_settings_path(username: str) -> str:
    safe = os.path.basename(username or "").strip()
    return os.path.join(USER_SETTINGS_DIR, f"{safe}.json")


def _load_user_settings(username: str) -> dict:
    path = _user_settings_path(username)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _user_chars_path(username: str) -> str:
    safe = os.path.basename(username or "").strip()
    return os.path.join(USER_SETTINGS_DIR, f"{safe}_chars.json")
```

Seejärel kopeeri endpointide dekoraatorid ja funktsioonide kehad `main.py`-st, asendades `@app.` → `@router.` ja kasutades imporditud `get_user`/`require_role`.

- [ ] **Samm 3: Lisa router `server/main.py`-sse**

```python
from .routers.user_settings import router as user_settings_router
app.include_router(user_settings_router)
```

Kustuta endpointide definitsioonid `main.py`-st.

- [ ] **Samm 4: Käivita testid**

```bash
.venv/bin/python -m pytest tests/ --ignore=tests/test_consolidate_data.py -q 2>&1 | tail -3
```

Oodatav: `259 passed`.

- [ ] **Samm 5: Commit**

```bash
git add server/routers/__init__.py server/routers/user_settings.py server/main.py
git commit -m "refactor: tõsta user-settings ja user-chars server/routers/user_settings.py-sse"
```

---

## Task 5: Router — `server/routers/auth.py`

**Files:**
- Create: `server/routers/auth.py`
- Modify: `server/main.py`

Endpointid: `/login`, `/verify-token`, `/logout`, `/api/meili-token`, `/api/meili-token/refresh`, `/register`, `/register/username-preview`, `/invite/{token}`, `/invite/set-password`, `/admin/registrations`, `/admin/registrations/approve`, `/admin/registrations/reject`, `/admin/users`, `/admin/users/update-role`, `/admin/users/delete`.

- [ ] **Samm 1: Loo `server/routers/auth.py`**

```python
"""
Autentimise, registreerimise ja kasutajahalduse endpointid.
"""
from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import JSONResponse
from ..deps import get_user, require_role, get_json_data
from ..rate_limit import get_client_ip, check_rate_limit
from ..auth import (
    verify_user, create_session, delete_session, require_token,
    get_all_users, update_user_role, delete_user, get_session, load_users,
)
from ..registration import (
    add_registration, load_pending_registrations, get_registration_by_id,
    update_registration_status, create_invite_token, validate_invite_token,
    create_user_from_invite, suggest_username_for_email,
)
from ..config import get_logger

router = APIRouter()
logger = get_logger(__name__)
```

Kopeeri kõik 15 endpointit `main.py`-st, asendades `@app.` → `@router.`.

NB: `/login` kasutab `generate_meili_token` — impordi lokaalselt funktsiooni sees: `from ..meilisearch_ops import generate_meili_token`.

- [ ] **Samm 2: Lisa router `main.py`-sse ja kustuta endpointid sealt**

```python
from .routers.auth import router as auth_router
app.include_router(auth_router)
```

- [ ] **Samm 3: Käivita testid**

```bash
.venv/bin/python -m pytest tests/ --ignore=tests/test_consolidate_data.py -q 2>&1 | tail -3
```

Oodatav: `259 passed`.

- [ ] **Samm 4: Commit**

```bash
git add server/routers/auth.py server/main.py
git commit -m "refactor: tõsta auth/register/users endpointid server/routers/auth.py-sse"
```

---

## Task 6: Router — `server/routers/notifications.py`

**Files:**
- Create: `server/routers/notifications.py`
- Modify: `server/main.py`

Endpointid: `/notifications` (GET), `/notification-recipients` (GET), `/notifications/send` (POST), `/notifications/{id}/read` (POST).

- [ ] **Samm 1: Loo `server/routers/notifications.py`**

```python
"""
Teavituste lugemise ja saatmise endpointid.
"""
import unicodedata
from fastapi import APIRouter, Depends, HTTPException, Request
from ..deps import get_user, require_role, get_json_data
from ..auth import get_all_users
from ..notifications_ops import (
    _notifications_lock, load_notifications, save_notifications,
    create_notification, find_username_by_display_name,
)
from ..config import get_logger

router = APIRouter()
logger = get_logger(__name__)
```

Kopeeri 4 endpointi, asendades `@app.` → `@router.`.

- [ ] **Samm 2: Lisa router, kustuta endpointid `main.py`-st**

```python
from .routers.notifications import router as notifications_router
app.include_router(notifications_router)
```

- [ ] **Samm 3: Käivita testid**

```bash
.venv/bin/python -m pytest tests/ --ignore=tests/test_consolidate_data.py -q 2>&1 | tail -3
```

Oodatav: `259 passed`.

- [ ] **Samm 4: Commit**

```bash
git add server/routers/notifications.py server/main.py
git commit -m "refactor: tõsta teavituste endpointid server/routers/notifications.py-sse"
```

---

## Task 7: Router — `server/routers/editor.py`

**Files:**
- Create: `server/routers/editor.py`
- Modify: `server/main.py`

Endpointid: `/save`, `/page-comments/reply`, `/recent-edits`, `/git-history`, `/commit-diff`, `/git-restore`.

- [ ] **Samm 1: Loo `server/routers/editor.py`**

```python
"""
Toimetamise, salvestamise ja git-ajaloo endpointid.
"""
import json
import os
import unicodedata
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from ..deps import get_user, require_role, get_json_data, load_work_metadata
from ..config import BASE_DIR, get_logger
from ..git_ops import (
    save_with_git, get_recent_commits, get_file_git_history,
    get_file_diff, get_file_at_commit, get_commit_diff,
)
from ..meilisearch_ops import sync_work_to_meilisearch_async
from ..prosopography.ops import update_page_person_mentions
from ..entity_labels_ops import enrich_entity_labels_async_qcodes
from ..notifications_ops import create_notification, find_username_by_display_name

router = APIRouter()
logger = get_logger(__name__)
```

Kopeeri 6 endpointi, asendades `@app.` → `@router.`.

- [ ] **Samm 2: Lisa router, kustuta endpointid `main.py`-st**

```python
from .routers.editor import router as editor_router
app.include_router(editor_router)
```

- [ ] **Samm 3: Käivita testid**

```bash
.venv/bin/python -m pytest tests/ --ignore=tests/test_consolidate_data.py -q 2>&1 | tail -3
```

Oodatav: `259 passed`.

- [ ] **Samm 4: Commit**

```bash
git add server/routers/editor.py server/main.py
git commit -m "refactor: tõsta toimetamise endpointid server/routers/editor.py-sse"
```

---

## Task 8: Router — `server/routers/bulk.py`

**Files:**
- Create: `server/routers/bulk.py`
- Modify: `server/main.py`

Endpointid: `/works/bulk-collection`, `/works/bulk-tags`, `/works/bulk-genre`.

- [ ] **Samm 1: Loo `server/routers/bulk.py`**

```python
"""
Massilised metaandmete uuendused.
"""
from fastapi import APIRouter, BackgroundTasks, Depends, Request
from ..deps import require_role, get_json_data
from ..metadata_ops import bulk_update_field
from ..cache import invalidate_all_caches
from ..config import get_logger

router = APIRouter()
logger = get_logger(__name__)
```

Kopeeri 3 endpointi, asendades `@app.` → `@router.` ja `_invalidate_all_caches()` → `invalidate_all_caches()`.

- [ ] **Samm 2: Lisa router, kustuta endpointid `main.py`-st**

```python
from .routers.bulk import router as bulk_router
app.include_router(bulk_router)
```

- [ ] **Samm 3: Käivita testid**

```bash
.venv/bin/python -m pytest tests/ --ignore=tests/test_consolidate_data.py -q 2>&1 | tail -3
```

Oodatav: `259 passed`.

- [ ] **Samm 4: Commit**

```bash
git add server/routers/bulk.py server/main.py
git commit -m "refactor: tõsta bulk-update endpointid server/routers/bulk.py-sse"
```

---

## Task 9: Router — `server/routers/metadata_config.py`

**Files:**
- Create: `server/routers/metadata_config.py`
- Modify: `server/main.py`

Endpointid: `/update-work-metadata`, `/get-work-metadata`, `/get-metadata-suggestions`, `/vocabularies`, `/people-aliases`, `/people-register`, `/entity-labels`, `/admin/refresh-entity-labels`, `/admin/enrich-page-tag-labels`.

- [ ] **Samm 1: Loo `server/routers/metadata_config.py`**

```python
"""
Metaandmete päringud, soovitused, sõnavarad, isikualiased.
"""
import json
import os
from fastapi import APIRouter, BackgroundTasks, Depends, Request
from ..deps import require_role, get_json_data, load_work_metadata, get_user
from ..config import BASE_DIR, get_logger
from ..metadata_ops import save_work_metadata, ALLOWED_METADATA_FIELDS
from ..cache import (
    get_cached_collections, get_cached_vocabularies, get_cached_people_aliases,
    get_cached_people_register, get_cached_suggestions,
)
from ..entity_labels_ops import (
    load_entity_labels, enrich_entity_labels_async,
    enrich_entity_labels_async_qcodes, refresh_all_entity_labels,
)
from ..people_ops import process_person_fields_metadata
from ..utils import find_directory_by_id

router = APIRouter()
logger = get_logger(__name__)
```

Kopeeri 9 endpointi.

- [ ] **Samm 2: Lisa router, kustuta endpointid**

```python
from .routers.metadata_config import router as metadata_config_router
app.include_router(metadata_config_router)
```

- [ ] **Samm 3: Käivita testid**

```bash
.venv/bin/python -m pytest tests/ --ignore=tests/test_consolidate_data.py -q 2>&1 | tail -3
```

Oodatav: `259 passed`.

- [ ] **Samm 4: Commit**

```bash
git add server/routers/metadata_config.py server/main.py
git commit -m "refactor: tõsta metaandmete konfig-endpointid server/routers/metadata_config.py-sse"
```

---

## Task 10: Router — `server/routers/admin_maintenance.py`

**Files:**
- Create: `server/routers/admin_maintenance.py`
- Modify: `server/main.py`

Endpointid: `/admin/trash`, `/admin/trash/{work_id}/restore`, `/admin/git-failures`, `/admin/git-health`, `/admin/people-refresh`, `/admin/people-refresh-status`, `/admin/reocr/{job_id}/status`, `/admin/reocr/jobs`, `/admin/reocr/log`.

- [ ] **Samm 1: Loo `server/routers/admin_maintenance.py`**

```python
"""
Admin hooldustoimingud: prügikast, git, re-OCR, inimesed.
"""
from fastapi import APIRouter, BackgroundTasks, Depends, Request
from ..deps import require_role
from ..git_ops import run_git_fsck, clear_git_failures, get_git_failures
from ..trash_ops import list_deleted_works, restore_deleted_work
from ..people_ops import get_refresh_status, refresh_all_people_safe
from ..reocr_ops import poll_reocr_job, list_reocr_jobs, get_reocr_log
from ..config import get_logger

router = APIRouter()
logger = get_logger(__name__)
```

Kopeeri 9 endpointi.

- [ ] **Samm 2: Lisa router, kustuta endpointid**

```python
from .routers.admin_maintenance import router as admin_maintenance_router
app.include_router(admin_maintenance_router)
```

- [ ] **Samm 3: Käivita testid ja commit**

```bash
.venv/bin/python -m pytest tests/ --ignore=tests/test_consolidate_data.py -q 2>&1 | tail -3
git add server/routers/admin_maintenance.py server/main.py
git commit -m "refactor: tõsta admin hooldustoimingud server/routers/admin_maintenance.py-sse"
```

---

## Task 11: Router — `server/routers/upload.py`

**Files:**
- Create: `server/routers/upload.py`
- Modify: `server/main.py`

Endpointid: `/admin/uploads`, `/admin/upload/{id}/**` (12 endpointi).

- [ ] **Samm 1: Loo `server/routers/upload.py`**

```python
"""
Üleslaadimise viisard: loomine, staatus, import, tühistamine.
"""
from fastapi import APIRouter, BackgroundTasks, Depends, Request, UploadFile
from ..deps import require_role
from ..upload_ops import (
    sanitize_slug, check_slug_conflict, create_upload, update_upload_meta,
    list_uploads, get_upload, mark_page_deleted, cancel_upload,
    save_and_transfer_to_ocr, add_image_page, poll_and_sync_thumbs,
    import_as_work, replace_work_content,
)
from ..meilisearch_ops import sync_work_to_meilisearch
from ..config import UPLOAD_ENABLED, get_logger

router = APIRouter()
logger = get_logger(__name__)
```

Kopeeri kõik upload endpointid (read ~1283–1443 `main.py`-st).

- [ ] **Samm 2: Lisa router, kustuta endpointid**

```python
from .routers.upload import router as upload_router
app.include_router(upload_router)
```

- [ ] **Samm 3: Käivita testid ja commit**

```bash
.venv/bin/python -m pytest tests/ --ignore=tests/test_consolidate_data.py -q 2>&1 | tail -3
git add server/routers/upload.py server/main.py
git commit -m "refactor: tõsta upload endpointid server/routers/upload.py-sse"
```

---

## Task 12: Router — `server/routers/admin_work.py`

**Files:**
- Create: `server/routers/admin_work.py`
- Modify: `server/main.py`

Suurim ja keerulisim router. Endpointid: `/admin/work/{work_id}` (DELETE), `/admin/work/{work_id}/metadata` (GET), `/admin/work/{work_id}/trash-pages/**`, `/admin/work/{work_id}/pages`, `/admin/work/{work_id}/page/{n}/delete`, `/admin/work/{work_id}/page/{n}/replace-image`, `/admin/work/{work_id}/add-page`, `/admin/work/{work_id}/page/{n}/split`, `/admin/work/{work_id}/reorder-pages`, `/admin/work/{work_id}/reocr-page`, `/admin/work/{work_id}/page-ocr/**`.

- [ ] **Samm 1: Loo `server/routers/admin_work.py`**

```python
"""
Admin teosehaldus: lehekülgede lisamine/kustutamine/järjestus/split/reocr.
"""
import os
import shutil
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, UploadFile
from ..deps import require_role, load_work_metadata
from ..config import BASE_DIR, get_logger
from ..utils import find_directory_by_id, metadata_lock, generate_nanoid
from ..git_ops import delete_work_from_git, delete_page_from_git, save_with_git, get_or_init_repo
from ..meilisearch_ops import sync_work_to_meilisearch_async, delete_work_from_meilisearch
from ..admin_page_ops import get_page_sequence, get_sorted_images, rebalance_sequences, reorder_pages, split_page
from ..image_server import generate_thumbnail
from ..reocr_ops import start_reocr_job, get_active_reocr_count, REOCR_MAX_CONCURRENT
from ..trash_ops import list_deleted_pages, restore_deleted_page
from ..metadata_ops import save_work_metadata

router = APIRouter()
logger = get_logger(__name__)
```

Kopeeri kõik admin/work endpointid (read ~308–1460 `main.py`-st, vahele jättes juba teisaldatud upload/reocr endpointid).

- [ ] **Samm 2: Lisa router, kustuta endpointid**

```python
from .routers.admin_work import router as admin_work_router
app.include_router(admin_work_router)
```

- [ ] **Samm 3: Käivita testid ja commit**

```bash
.venv/bin/python -m pytest tests/ --ignore=tests/test_consolidate_data.py -q 2>&1 | tail -3
git add server/routers/admin_work.py server/main.py
git commit -m "refactor: tõsta admin teosehalduse endpointid server/routers/admin_work.py-sse"
```

---

## Task 13: Router — `server/routers/collections.py`

**Files:**
- Create: `server/routers/collections.py`
- Modify: `server/main.py`

Endpointid: `/collections` (GET), `/config/archives` (GET+POST+PUT+DELETE), `/admin/collections/{id}/**` (PUT, GET users, POST, GET works-count, DELETE).

Sisaldab ka kaks abivahendit mis tuleb kaasa tõsta:
- `_find_works_with_collection(collection_id)` → lisada routerifaili
- `_find_works_with_archive(archive_id)` → lisada routerifaili
- `_cleanup_allowed_collections_on_delete(collection_id)` → lisada routerifaili

- [ ] **Samm 1: Loo `server/routers/collections.py`**

```python
"""
Kollektsioonide ja arhiivide haldus.
"""
import json
import os
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from gitpython import Actor
from ..deps import require_role, get_json_data
from ..config import BASE_DIR, COLLECTIONS_FILE, ARCHIVES_FILE, get_logger
from ..utils import find_directory_by_id, metadata_lock, atomic_write_json
from ..git_ops import get_or_init_repo
from ..meilisearch_ops import (
    sync_work_to_meilisearch_async, update_collection_is_public_async,
)
from ..auth import load_users, save_users
from ..cache import (
    get_cached_collections, get_cached_archives, invalidate_all_caches,
)
from ..metadata_ops import save_work_metadata

router = APIRouter()
logger = get_logger(__name__)
```

Kopeeri `_find_works_with_collection`, `_find_works_with_archive`, `_cleanup_allowed_collections_on_delete` funktsioonid ja kõik endpointid.

NB: `Actor` import on `from git import Actor` — kontrolli import enne kasutamist.

- [ ] **Samm 2: Lisa router, kustuta endpointid**

```python
from .routers.collections import router as collections_router
app.include_router(collections_router)
```

- [ ] **Samm 3: Käivita testid ja commit**

```bash
.venv/bin/python -m pytest tests/ --ignore=tests/test_consolidate_data.py -q 2>&1 | tail -3
git add server/routers/collections.py server/main.py
git commit -m "refactor: tõsta kollektsioonide ja arhiivide endpointid server/routers/collections.py-sse"
```

---

## Task 14: Router — `server/routers/public.py`

**Files:**
- Create: `server/routers/public.py`
- Modify: `server/main.py`

Endpointid: `/download/{work_id}`, `/work/{work_id}/shareable`, `/work/{work_id}/viewer-token`, `/meta/work/{work_id}`, `/sitemap.xml`.

- [ ] **Samm 1: Loo `server/routers/public.py`**

```python
"""
Avalikud ja bot-sõbralikud endpointid: allalaadimine, viewer-token, SEO.
"""
import os
import time
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, Response
from ..deps import require_role, load_work_metadata, get_optional_user
from ..access_ops import can_read_work, is_work_public
from ..config import BASE_DIR, get_logger
from ..metadata_handler import build_meta_html, build_sitemap_xml
from ..metadata_ops import save_work_metadata
from ..meilisearch_ops import sync_work_to_meilisearch_async
from ..rate_limit import get_client_ip, check_rate_limit
from ..cache import _sitemap_cache, invalidate_all_caches
from .. import utils as utils_module
from fastapi.responses import JSONResponse

router = APIRouter()
logger = get_logger(__name__)
```

Kopeeri 5 endpointi. `sitemap_xml` endpointis kasuta `_sitemap_cache` (imporditud `cache.py`-st).

- [ ] **Samm 2: Lisa router, kustuta endpointid**

```python
from .routers.public import router as public_router
app.include_router(public_router)
```

- [ ] **Samm 3: Käivita testid ja commit**

```bash
.venv/bin/python -m pytest tests/ --ignore=tests/test_consolidate_data.py -q 2>&1 | tail -3
git add server/routers/public.py server/main.py
git commit -m "refactor: tõsta avalikud endpointid server/routers/public.py-sse"
```

---

## Task 15: Puhasta `server/main.py`

**Files:**
- Modify: `server/main.py`

Pärast kõikide routerite teisaldamist peaks `main.py` sisaldama ainult:
- importe (ainult need, mis on tegelikult veel vajalikud)
- `lifespan` kontekstihaldurit
- `app = FastAPI(...)` ja middleware
- `app.include_router(...)` read
- `/health` endpointi

- [ ] **Samm 1: Eemalda kasutamata impordid**

```bash
.venv/bin/python -m pip install pyflakes 2>/dev/null; .venv/bin/python -m pyflakes server/main.py 2>&1 | grep "imported but unused"
```

Eemalda kõik loetletud kasutamata impordid.

- [ ] **Samm 2: Kontrolli `main.py` pikkus**

```bash
wc -l server/main.py
```

Oodatav: < 150 rida.

- [ ] **Samm 3: Käivita lõplik testide komplekt**

```bash
.venv/bin/python -m pytest tests/ --ignore=tests/test_consolidate_data.py -q 2>&1 | tail -3
```

Oodatav: `259 passed`.

- [ ] **Samm 4: Lõplik commit ja push**

```bash
git add server/main.py
git commit -m "refactor: puhasta main.py pärast routerite teisaldamist"
git push origin main
```

---

## Kiirviide: tüüpiline routerifail

Iga uus routerifail järgib sama mustrit:

```python
from fastapi import APIRouter, Depends, Request
from ..deps import get_user, require_role, get_json_data   # jagatud sõltuvused
from ..config import get_logger

router = APIRouter()
logger = get_logger(__name__)

@router.post("/minu-endpoint")
async def minu_endpoint(request: Request, user=Depends(require_role("editor"))):
    data = await get_json_data(request)
    ...
```

`main.py`-s:
```python
from .routers.minu_router import router as minu_router
app.include_router(minu_router)
```

## Ohutu eksperimenteerimise soovitus

Kuna tegemist on suure refaktoriga, tasub töötada isoleeritud harus:

```bash
git checkout -b refactor/main-py-modularization
```

Siis saab peaharusse mergida alles siis, kui kõik testid läbivad ja `main.py` on soovitud pikkuses.
