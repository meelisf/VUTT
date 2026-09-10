# Contributor aed — teostusplaan (A osa)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `contributor` roll saab tähenduse — ta toimetab täisõigustega oma
kollektsioonides ja mujal mitte.

**Architecture:** Ulatuse-kontroll läheb ühte olemasolevasse funktsiooni
(`server/access_ops.py: can_write_work`), millest kõik kirjutusteed juba läbi käivad.
Uus väli `edit_collections` `users.json`-is on ortogonaalne `allowed_collections`-ile
(lugemine) — kirjutamisõigus on lugemisõigus JA ulatus. Rollivärav lastakse üheksal
endpointil `editor` → `contributor`, sest muidu ei avane Workspace.

**Tech Stack:** FastAPI (Python 3.9 ühilduvus!), pytest, React 19 + TypeScript, vitest,
i18next.

**Spec:** `docs/superpowers/specs/2026-09-04-contributor-kollektsiooni-ulatus-design.md`

## Global Constraints

- **Python 3.9:** `Optional[dict]`, mitte `dict | None`.
- **Blokeeriv I/O `async def` sees on keelatud** (ADR 0002) — sync `def` route või
  `run_in_threadpool`.
- **i18n (ADR 0011):** `fallbackLng` on VÄLJAS — iga uus võti läheb `src/locales/et/`
  JA `src/locales/en/` samasse faili korraga, muidu katkeb build.
- **Väravad enne committi:** `.venv/bin/pytest tests/`, `npm run typecheck`,
  `npm test`, `npm run lint:ci`.
- **Kasuta ALATI projekti venv-i:** `.venv/bin/python`, `.venv/bin/pytest`.
- **Server on tõe allikas.** Frontendi kontroll on ergonoomika, mitte turve.
- Koodikommentaarid eesti keeles.

---

### Task 1: Ulatuse-telg `can_write_work`-i + ADR 0031

**Files:**
- Modify: `server/access_ops.py:36-47` (`can_write_work`)
- Test: `tests/test_access_ops.py`
- Create: `docs/decisions/0031-kirjutamisoigus-on-lugemisoigus-ja-ulatus.md`
- Modify: `CLAUDE.md` (Invariandid), `src/pages/Review.tsx:6-11` (aegunud kommentaar)
- Delete: `state/pending_edits.json`

**Interfaces:**
- Consumes: `can_read_work(work_metadata, user)` (olemasolev).
- Produces: `can_write_work(work_metadata: dict, user: Optional[dict]) -> bool`, mis
  arvestab `user["edit_collections"]`-i, kui `user["role"] == "contributor"`.

- [ ] **Step 1: Write the failing tests**

Lisa `tests/test_access_ops.py` lõppu (fail kasutab juba autouse `mock_collections`
fixture'it, kus `col-public` on avalik ja `col-restricted` piiratud):

```python
def _contributor(edit_collections, allowed_collections=None):
    return {
        "username": "contrib",
        "role": "contributor",
        "edit_collections": edit_collections,
        "allowed_collections": allowed_collections or [],
    }


def test_contributor_can_write_own_collection():
    from server.access_ops import can_write_work
    meta = {"collections": ["col-public"]}
    assert can_write_work(meta, _contributor(["col-public"])) is True


def test_contributor_cannot_write_other_collection():
    from server.access_ops import can_write_work
    meta = {"collections": ["col-public"]}
    assert can_write_work(meta, _contributor(["col-muu"])) is False


def test_contributor_cannot_write_work_without_collections():
    from server.access_ops import can_write_work
    assert can_write_work({"collections": []}, _contributor(["col-public"])) is False


def test_contributor_with_empty_scope_writes_nothing():
    from server.access_ops import can_write_work
    assert can_write_work({"collections": ["col-public"]}, _contributor([])) is False


def test_contributor_scope_does_not_grant_read_access():
    """Invariant 1: kirjutamisulatus EI muutu kaudseks lugemisõiguseks.
    edit_collections=["col-restricted"], aga allowed_collections=[] → keeld."""
    from server.access_ops import can_write_work
    meta = {"collections": ["col-restricted"]}
    user = _contributor(["col-restricted"], allowed_collections=[])
    assert can_write_work(meta, user) is False


def test_contributor_writes_restricted_with_both_fields():
    from server.access_ops import can_write_work
    meta = {"collections": ["col-restricted"]}
    user = _contributor(["col-restricted"], allowed_collections=["col-restricted"])
    assert can_write_work(meta, user) is True


def test_editor_ignores_edit_collections():
    from server.access_ops import can_write_work
    meta = {"collections": ["col-public"]}
    user = {"username": "ed", "role": "editor", "edit_collections": [], "allowed_collections": []}
    assert can_write_work(meta, user) is True


def test_contributor_without_field_writes_nothing():
    """Puuduv edit_collections = tühi ulatus (fail-closed)."""
    from server.access_ops import can_write_work
    meta = {"collections": ["col-public"]}
    assert can_write_work(meta, {"username": "c", "role": "contributor"}) is False


def test_decision_does_not_consult_derived_index(monkeypatch):
    """ADR 0031 invariant 2: õigusotsus ei tohi puudutada work_collections_index'it.
    Kui mõni tulevane muudatus paneb ta sellest sõltuma, kukub see test."""
    import server.prosopography.indices as indices

    def _explode(*args, **kwargs):
        raise AssertionError("õigusotsus ei tohi tuletatud indeksit lugeda")

    monkeypatch.setattr(indices, "_load_work_collections", _explode)
    meta = {"collections": ["col-public"]}
    assert can_write_work(meta, _contributor(["col-public"])) is True
```

**NB testi kirjutamisel:** `AssertionError` mocki sees neelataks laia `except
Exception` alla, kui kutsutav kood selle ümbritseb. Kontrolli jooksutamisel, et test
päriselt kukub, kui `can_write_work`-i lisada `_load_work_collections()` kutse — muidu
on see vaikne no-op.

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_access_ops.py -k contributor -v`
Expected: FAIL — praegu tagastab `can_write_work` iga loetava teose puhul `True`.

- [ ] **Step 3: Implement**

Asenda `server/access_ops.py`-s `can_write_work` tervikuna:

```python
def can_write_work(work_metadata: dict, user: Optional[dict]) -> bool:
    """Kontrollib kas kasutajal on õigus teost MUUTA (salvestada, kommenteerida).

    Kaks tingimust, mõlemad kohustuslikud (ADR 0031):
    1. Lugemisõigus — kirjutamisõigus EI anna kunagi lugemisõigust.
    2. Ulatus — contributor tohib kirjutada ainult oma edit_collections'i teostesse.
       editor+ jaoks on ulatus piiramata ja väli eiratakse.

    Kollektsioonita teos ei ole contributor'ile kirjutatav (fail-closed).
    """
    if user is None:
        return False
    if not can_read_work(work_metadata, user):
        return False
    if user.get("role") != "contributor":
        return True
    scope = set(user.get("edit_collections", []))
    if not scope:
        return False
    return bool(scope & set(work_metadata.get("collections", [])))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_access_ops.py -v`
Expected: PASS (ka kõik vanad testid — editor/admin käitumine ei tohi muutuda).

- [ ] **Step 5: Kirjuta ADR 0031**

Loo `docs/decisions/0031-kirjutamisoigus-on-lugemisoigus-ja-ulatus.md`. Vaata vormi
`docs/decisions/0030-page-map-lahteleht-valjundlehtedeks.md`-st. Sisu peab katma:

1. **Otsus:** kirjutamisõigus = lugemisõigus JA ulatus, ühes funktsioonis
   (`can_write_work`), et kaks kontrolli ei saaks ajas lahkneda.
2. **Otsus:** õigusotsust ei tehta tuletatud indeksi (`work_collections_index.json`)
   põhjal — see on read-model (ADR 0007), mille puudumine teeks otsuse
   ettearvamatuks; fail-open lekitab, fail-closed lukustab kasutaja välja. Indeks
   tohib kandidaate kitsendada, autoriteet on `_metadata.json`.
3. **Tagajärg:** iga uus kirjutustee kutsub `can_write_work`-i, mitte oma kontrolli.

- [ ] **Step 6: Lisa invariant CLAUDE.md-sse**

`## Invariandid` sekstiooni, `**Salvestus (ADR 0012)**` ploki järele:

```markdown
**Õigused (ADR 0031)** — kirjutamisõigus on **lugemisõigus JA ulatus**, mõlemad
`can_write_work`-is (`server/access_ops.py`). Kirjutamisulatus (`edit_collections`,
ainult `contributor`) ei anna KUNAGI lugemisõigust; lugemisõigus on
`allowed_collections`. Uus kirjutustee kutsub `can_write_work`-i, ei kirjuta oma
kontrolli. Õigusotsust EI tehta `work_collections_index.json` põhjal — see on
read-model (ADR 0007); autoriteet on `_metadata.json`.
```

- [ ] **Step 7: Koristus**

`src/pages/Review.tsx:6-11` kommentaar väidab, et `server/pending_edits.py` on
implementeeritud. Faili ei ole (kustutatud commitis `099d0ad`). Asenda plokk:

```tsx
 * MÄRKUS: Algselt oli see leht mõeldud pending-edits ülevaatuseks (contributor-rolli
 * muudatuste kinnitamiseks). See süsteem ehitati ja EEMALDATI (099d0ad), sest
 * eelkinnitamine tekitas liiga suure halduskoormuse. Järelevalve käib nüüd nähtavuse
 * kaudu: vt ADR 0031 ja spekk 2026-09-04-contributor-kollektsiooni-ulatus-design.md.
```

Kustuta jäänuk: `rm state/pending_edits.json`

- [ ] **Step 8: Väravad ja commit**

```bash
.venv/bin/pytest tests/ -q
npm run typecheck
git add server/access_ops.py tests/test_access_ops.py docs/decisions/0031-*.md CLAUDE.md src/pages/Review.tsx
git rm --cached state/pending_edits.json 2>/dev/null || true
git commit -m "feat(access): can_write_work arvestab contributor'i kollektsiooni-ulatust (ADR 0031)"
```

---

### Task 2: `edit_collections` kasutajaobjekti ja halduse API-sse

**Files:**
- Modify: `server/auth.py:205-211` (`verify_user`), `server/auth.py:308-316`
  (`get_all_users`), uus funktsioon `update_user_edit_collections`
- Modify: `server/routers/admin.py` (uus endpoint)
- Test: `tests/test_admin_role_endpoints.py`

**Interfaces:**
- Consumes: `can_manage_user(admin_role, target_role)`, `get_cached_collections()`,
  `delete_user_sessions(username)` — kõik olemasolevad `server/auth.py`-s.
- Produces:
  `update_user_edit_collections(username, collection_ids, admin_user) -> tuple[bool, str, list]`
  ja endpoint `POST /admin/users/update-edit-collections`
  (body `{username, edit_collections}` → `{status, edit_collections}`).

- [ ] **Step 1: Write the failing test**

Lisa `tests/test_admin_role_endpoints.py` lõppu:

```python
def test_admin_sets_edit_collections(client, login, backend_env):
    token = login("admin", "adminpass")
    response = client.post(
        "/admin/users/update-edit-collections",
        json={"username": "editor", "edit_collections": ["sample"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["edit_collections"] == ["sample"]


def test_edit_collections_sanitizes_unknown_ids(client, login, backend_env):
    """Tundmatu kollektsiooni-id ei tohi salvestuda."""
    token = login("admin", "adminpass")
    response = client.post(
        "/admin/users/update-edit-collections",
        json={"username": "editor", "edit_collections": ["sample", "olematu"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.json()["edit_collections"] == ["sample"]


def test_edit_collections_change_invalidates_sessions(client, login, backend_env):
    """Ulatuse muutus peab lõpetama kasutaja sessiooni — muidu jääks vana ulatus 24h."""
    editor_token = login("editor", "editorpass")
    admin_token = login("admin", "adminpass")
    client.post(
        "/admin/users/update-edit-collections",
        json={"username": "editor", "edit_collections": ["sample"]},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    verify = client.post("/verify-token", json={"token": editor_token})
    assert verify.json()["valid"] is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_admin_role_endpoints.py -k edit_collections -v`
Expected: FAIL — 404, endpointi ei ole.

- [ ] **Step 3: Lisa väli kasutajaobjekti**

`server/auth.py`, `verify_user` tagastuses (rida ~205) ja `get_all_users` kirjes
(rida ~312) lisa `allowed_collections` kõrvale:

```python
        "edit_collections": users[username].get("edit_collections", []),
```

(`get_all_users`-is `user_data.get("edit_collections", [])`.)

- [ ] **Step 4: Lisa haldusfunktsioon**

`server/auth.py`-sse, `update_user_allowed_collections` järele. NB erinevus: siin
sanitiseeritakse KÕIGI olemasolevate kollektsioonide vastu, mitte ainult restricted
omade — contributor võib toimetada ka avalikku kollektsiooni.

```python
def update_user_edit_collections(username, collection_ids, admin_user):
    """Muudab kasutaja kirjutamisulatust (edit_collections).

    Erinevalt allowed_collections'ist (lugemisõigus piiratud kogudele) on see
    KIRJUTAMISULATUS ja kehtib kõigile kollektsioonidele. Mõjub ainult
    contributor-rollile (vt can_write_work, ADR 0031).

    Returns: (success, message, edit_collections)
    """
    if not isinstance(username, str) or not username.strip():
        return False, "Kasutajanimi puudub", []
    if not isinstance(collection_ids, list):
        return False, "Vigane kollektsioonide nimekiri", []

    users = load_users()
    if username not in users:
        return False, "Kasutajat ei leitud", []

    target_role = users[username].get("role", "contributor")
    if not can_manage_user(admin_user["role"], target_role):
        return False, "Pole õigust selle kasutaja ulatust muuta", []

    collections_config = get_cached_collections()
    submitted = {c for c in collection_ids if isinstance(c, str)}
    sanitized = [cid for cid in collections_config if cid in submitted]

    old = users[username].get("edit_collections", [])
    if old == sanitized:
        return True, "Ulatus uuendatud", sanitized

    users[username]["edit_collections"] = sanitized
    save_users(users)
    # Sessioon kannab kasutajaobjekti hetktõmmist (require_token tagastab
    # session["user"]) — ilma invalideerimiseta jääks vana ulatus 24h kehtima.
    delete_user_sessions(username)
    return True, "Ulatus uuendatud", sanitized
```

- [ ] **Step 5: Lisa endpoint**

`server/routers/admin.py`, `admin_update_collections` järele:

```python
@router.post("/admin/users/update-edit-collections")
async def admin_update_edit_collections(request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    success, message, scope = await run_in_threadpool(
        update_user_edit_collections,
        data.get("username"), data.get("edit_collections", []), user)
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return {"status": "success", "edit_collections": scope}
```

Impordi `update_user_edit_collections` faili ülaosas olevasse `..auth` importi.

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_admin_role_endpoints.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
.venv/bin/pytest tests/ -q
git add server/auth.py server/routers/admin.py tests/test_admin_role_endpoints.py
git commit -m "feat(auth): edit_collections väli ja selle haldamise endpoint"
```

---

### Task 3: Rollivärav alla + `/page-comments/reply` ligipääsukontroll

**Files:**
- Modify: `server/access_ops.py` (uus jagatud helper)
- Modify: `server/routers/editing.py:62-84, 106, 195, 207, 261, 273, 331, 341, 396`
- Modify: `server/routers/notifications.py:158-180`
- Modify: `tests/conftest.py` (contributor-kasutajad)
- Test: `tests/test_contributor_scope_endpoints.py` (uus)

**Interfaces:**
- Consumes: `can_write_work` (Task 1), `can_read_work`.
- Produces: `require_catalog_access(catalog, user, base_dir, *, write=False) -> dict`
  `server/access_ops.py`-s; `editing._require_catalog_access` jääb õhukeseks
  wrapperiks, mis annab kaasa oma mooduli `BASE_DIR`-i.

**NB miks base_dir on parameeter:** testid patchivad `editing.BASE_DIR`-i
(`tests/test_restricted_work_endpoint_access.py:30`). Kui helper loeks BASE_DIR-i
`access_ops`-i nimeruumist, katkeksid need patchid vaikselt ja ligipääsukontroll
vaataks päris andmekausta.

- [ ] **Step 1: Lisa conftest'i contributor-kasutajad**

`tests/conftest.py`, `users_file.write_text(...)` dict'i, `"editor"` kirje järele:

```python
                "contrib": {
                    "password_hash": _sha256("contribpass"),
                    "name": "Contributor User",
                    "email": "contrib@example.test",
                    "role": "contributor",
                    "edit_collections": ["oma"],
                    "created_at": "2026-01-01T00:00:00",
                },
                "contrib_muu": {
                    "password_hash": _sha256("contribpass"),
                    "name": "Contributor Other",
                    "email": "contrib2@example.test",
                    "role": "contributor",
                    "edit_collections": ["muu"],
                    "created_at": "2026-01-01T00:00:00",
                },
```

- [ ] **Step 2: Write the failing tests**

Loo `tests/test_contributor_scope_endpoints.py`:

```python
"""Contributor'i kirjutamisulatus endpointide tasemel (#297, ADR 0031)."""
import json

import pytest


@pytest.fixture
def scoped_work_env(backend_env, monkeypatch, tmp_path):
    import server.access_ops as access_ops
    import server.routers.editing as editing
    import server.routers.notifications as notifications
    import server.utils as utils

    data_dir = tmp_path / "data"
    work_dir = data_dir / "oma-teos"
    work_dir.mkdir(parents=True)
    (work_dir / "_metadata.json").write_text(json.dumps({
        "id": "w-oma", "slug": "oma-teos", "title": "Oma teos", "collections": ["oma"],
    }), encoding="utf-8")
    (work_dir / "page1.txt").write_text("tekst", encoding="utf-8")
    (work_dir / "page1.json").write_text(json.dumps({
        "comments": [{"id": "c1", "author": "editor", "text": "küsimus", "replies": []}]
    }), encoding="utf-8")

    monkeypatch.setattr(access_ops, "get_cached_collections", lambda: {
        "oma": {"visibility": "public"},
        "muu": {"visibility": "public"},
    })
    monkeypatch.setattr(editing, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(notifications, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(utils, "BASE_DIR", str(data_dir))
    utils.WORK_ID_CACHE.clear()
    utils.WORK_ID_CACHE["w-oma"] = str(work_dir)
    yield {"data_dir": data_dir}
    utils.WORK_ID_CACHE.clear()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _save_body():
    return {
        "original_path": "oma-teos",
        "file_name": "page1.txt",
        "content": "uus tekst",
        "meta_content": {},
    }


def test_contributor_saves_own_collection(client, login, scoped_work_env):
    token = login("contrib", "contribpass")
    response = client.post("/save", json=_save_body(), headers=_auth(token))
    assert response.status_code == 200, response.text


def test_contributor_cannot_save_other_collection(client, login, scoped_work_env):
    token = login("contrib_muu", "contribpass")
    response = client.post("/save", json=_save_body(), headers=_auth(token))
    assert response.status_code == 403


def test_contributor_reads_metadata_of_public_work(client, login, scoped_work_env):
    """Lugemisteed peavad olema contributor'ile avatud, muidu ei avane Workspace."""
    token = login("contrib_muu", "contribpass")
    response = client.post("/get-work-metadata",
                           json={"original_path": "oma-teos"}, headers=_auth(token))
    assert response.status_code == 200, response.text


def test_reply_requires_catalog_access(client, login, scoped_work_env):
    """Elav auk enne parandust: /page-comments/reply ei kontrollinud midagi."""
    token = login("contrib_muu", "contribpass")
    response = client.post("/page-comments/reply", json={
        "original_path": "oma-teos", "file_name": "page1.txt",
        "comment_id": "c1", "text": "vastus", "work_id": "w-oma", "page_number": 1,
    }, headers=_auth(token))
    assert response.status_code == 403


def test_reply_allowed_in_own_collection(client, login, scoped_work_env):
    token = login("contrib", "contribpass")
    response = client.post("/page-comments/reply", json={
        "original_path": "oma-teos", "file_name": "page1.txt",
        "comment_id": "c1", "text": "vastus", "work_id": "w-oma", "page_number": 1,
    }, headers=_auth(token))
    assert response.status_code == 200, response.text


def test_contributor_cannot_toggle_shareable(client, login, scoped_work_env):
    """Jagamine muudab juurdepääsu, mitte sisu — see jääb editor+ pärusmaaks.
    Valvurtest: /work/{id}/shareable ei tohi kunagi contributor'ini alla libiseda."""
    token = login("contrib", "contribpass")
    response = client.post("/work/w-oma/shareable", json={"shareable": True},
                           headers=_auth(token))
    assert response.status_code == 401


def test_contributor_cannot_edit_person_card(client, login, scoped_work_env):
    """Prosopograafia on contributor'ile lugemisõigusega (kaardid on globaalsed)."""
    token = login("contrib", "contribpass")
    response = client.put("/prosopography/vutt:Ptest123",
                          json={"name": "Muudetud"}, headers=_auth(token))
    assert response.status_code in (401, 403)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_contributor_scope_endpoints.py -v`
Expected: FAIL — `/save` ja `/get-work-metadata` annavad 401 („Vajab vähemalt 'editor'
õigusi"), `test_reply_requires_catalog_access` annab 200 (auk).

- [ ] **Step 4: Tõsta helper jagatuks**

`server/access_ops.py` lõppu (impordid faili algusesse: `import json`, `import os`,
`from fastapi import HTTPException`):

```python
def require_catalog_access(catalog: str, user: dict, base_dir: str,
                           *, write: bool = False) -> dict:
    """Loeb teose meta ja kontrollib ligipääsu. Fail-closed: vigane või puuduv
    meta ei tähenda avalikku teost.

    base_dir on parameeter, mitte mooduli konstant, sest kutsuja moodul (editing,
    notifications) omab oma BASE_DIR-i ja testid patchivad just seda.
    """
    if not catalog or catalog != os.path.basename(catalog):
        raise HTTPException(status_code=400, detail="Vigane teose tee")
    work_dir = os.path.join(base_dir, catalog)
    meta_path = os.path.join(work_dir, "_metadata.json")
    if not os.path.isdir(work_dir) or not os.path.exists(meta_path):
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
    except Exception:
        raise HTTPException(status_code=503, detail="Teose metaandmeid ei saa praegu lugeda")
    if not isinstance(meta, dict):
        raise HTTPException(status_code=503, detail="Teose metaandmed on vigased")
    allowed = can_write_work(meta, user) if write else can_read_work(meta, user)
    if not allowed:
        raise HTTPException(status_code=403, detail="Puudub õigus sellele teosele")
    return meta
```

`server/routers/editing.py`: asenda `_read_catalog_metadata` ja
`_require_catalog_access` (read 62-84) ühe wrapperiga; `_read_catalog_metadata`-l ei
ole muid kutsujaid (kontrolli: `grep -n _read_catalog_metadata server/`).

```python
def _require_catalog_access(catalog: str, user: dict, *, write: bool = False) -> dict:
    return require_catalog_access(catalog, user, BASE_DIR, write=write)
```

Impordi `require_catalog_access` `..access_ops`-ist.

- [ ] **Step 5: Lase rollivärav alla**

`server/routers/editing.py` — asenda `require_role("editor")` → `require_role("contributor")`
ridadel 106, 195, 207, 261, 273, 331, 341, 396. Kontrolli ükshaaval, et tegemist on
teost puudutava endpointiga:

```bash
grep -n 'require_role("editor")' server/routers/editing.py
```

`update_work_metadata` (169) ja bulk-endpointid (447, 479, 509) on `admin` — need
jäävad puutumata.

- [ ] **Step 6: Pane auk kinni**

`server/routers/notifications.py`, `reply_to_page_comment`: värav
`require_role("contributor")` ja pärast väljade valideerimist, ENNE
`_apply_reply_sync` kutset:

```python
    await run_in_threadpool(
        require_catalog_access, catalog, user, BASE_DIR, write=True
    )
```

Impordi `require_catalog_access` `..access_ops`-ist.

- [ ] **Step 7: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_contributor_scope_endpoints.py tests/test_restricted_work_endpoint_access.py -v`
Expected: PASS — ka vanad piirangutestid, sest `editing.BASE_DIR` patch töötab endiselt.

- [ ] **Step 8: Kogu testikomplekt ja commit**

```bash
.venv/bin/pytest tests/ -q
git add server/access_ops.py server/routers/editing.py server/routers/notifications.py tests/
git commit -m "feat(access): contributor pääseb teosele oma kollektsioonis; /page-comments/reply saab ligipääsukontrolli"
```

---

### Task 4: Kutsevoog — roll ja ulatus ühe operatsioonina

**Files:**
- Modify: `server/registration.py:181-203` (`create_invite_token`), `:283-330`
  (`create_user_from_invite`)
- Modify: `server/routers/admin.py:44-63` (`approve_registration`)
- Test: `tests/test_registration_flow.py` (kontrolli nimi: `ls tests/ | grep regist`)

**Interfaces:**
- Consumes: `add_registration`, `update_registration_status` (olemasolevad).
- Produces: `create_invite_token(email, name, created_by, username=None, role="editor",
  edit_collections=None)`; invite-token kannab välju `role` ja `edit_collections`;
  `create_user_from_invite` kirjutab need `users.json`-i.

- [ ] **Step 1: Write the failing test**

```python
def test_approve_with_contributor_role_and_scope(client, login, backend_env):
    """Roll ja ulatus tekivad ühe operatsiooniga — vahepealset seisundit ei ole."""
    client.post("/register", json={
        "name": "Uus Kasutaja", "email": "uus@example.test",
        "motivation": "soovin aidata", "gdpr_consent": True,
    })
    admin_token = login("admin", "adminpass")
    listing = client.post("/admin/registrations",
                          headers={"Authorization": f"Bearer {admin_token}"})
    reg_id = listing.json()["registrations"][0]["id"]

    approve = client.post("/admin/registrations/approve", json={
        "registration_id": reg_id, "role": "contributor", "edit_collections": ["sample"],
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert approve.status_code == 200, approve.text
    token = approve.json()["invite_token"]

    created = client.post("/invite/set-password",
                          json={"token": token, "password": "pikkparool123"})
    assert created.status_code == 200, created.text

    users_response = client.post("/admin/users",
                                 headers={"Authorization": f"Bearer {admin_token}"})
    new_user = [u for u in users_response.json()["users"]
                if u["username"] == created.json()["username"]][0]
    assert new_user["role"] == "contributor"
    assert new_user["edit_collections"] == ["sample"]


def test_approve_defaults_to_editor_without_role(client, login, backend_env):
    """Tagasiühilduvus: rollita kinnitamine annab senise vaikeväärtuse."""
    client.post("/register", json={
        "name": "Teine", "email": "teine@example.test",
        "motivation": "test", "gdpr_consent": True,
    })
    admin_token = login("admin", "adminpass")
    listing = client.post("/admin/registrations",
                          headers={"Authorization": f"Bearer {admin_token}"})
    reg_id = listing.json()["registrations"][0]["id"]
    approve = client.post("/admin/registrations/approve", json={"registration_id": reg_id},
                          headers={"Authorization": f"Bearer {admin_token}"})
    token = approve.json()["invite_token"]
    created = client.post("/invite/set-password",
                          json={"token": token, "password": "pikkparool123"})
    users_response = client.post("/admin/users",
                                 headers={"Authorization": f"Bearer {admin_token}"})
    new_user = [u for u in users_response.json()["users"]
                if u["username"] == created.json()["username"]][0]
    assert new_user["role"] == "editor"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_registration_flow.py -k approve -v`
Expected: FAIL — `edit_collections` puudub, roll on alati `editor`.

- [ ] **Step 3: Implement**

`server/registration.py`, `create_invite_token`: lisa parameetrid ja tokeni väljad.

```python
def create_invite_token(email, name, created_by, username=None, role="editor",
                        edit_collections=None):
    """Loob uue invite tokeni (kehtiv 48h).

    role ja edit_collections salvestatakse tokenisse, et konto tekiks
    lõpliku õigusseisundiga — mitte kaheastmeliselt (ADR 0031 mõte:
    kasutajaseisund on kontseptuaalselt atomaarne).
    """
```

Tokeni dict'i lisa:

```python
        "role": role if role in ("contributor", "editor") else "editor",
        "edit_collections": [c for c in (edit_collections or []) if isinstance(c, str)],
```

`create_user_from_invite`, kasutaja loomisel — asenda kõvakodeeritud roll:

```python
    users[username] = {
        "password_hash": password_hash,
        "name": name,
        "email": email,
        "role": token_data.get("role", "editor"),
        "edit_collections": token_data.get("edit_collections", []),
        "created_at": datetime.now().isoformat()
    }
```

ja tagastuses `"role": users[username]["role"]`.

`server/routers/admin.py`, `approve_registration` — anna body väljad edasi:

```python
    token_data = await run_in_threadpool(
        create_invite_token, reg["email"], reg["name"], user["username"],
        username=reg.get("username"),
        role=data.get("role", "editor"),
        edit_collections=data.get("edit_collections", []),
    )
```

ja lisa vastusesse `"role": token_data["role"], "edit_collections": token_data["edit_collections"]`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_registration_flow.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
.venv/bin/pytest tests/ -q
git add server/registration.py server/routers/admin.py tests/
git commit -m "feat(registration): roll ja kirjutamisulatus valitakse kinnitamisel"
```

---

### Task 5: Frontend — `canEditWork` ja Workspace'i peegeldus

**Files:**
- Modify: `src/utils/roleUtils.ts`, `src/contexts/UserContext.tsx:14-19`
- Modify: `src/pages/Workspace.tsx:684`
- Test: `src/utils/__tests__/roleUtils.test.ts`

**Interfaces:**
- Consumes: `User` (laiendatud väljaga `edit_collections?: string[]`).
- Produces: `canEditWork(user, work)` — `work` on objekt väljaga
  `collections?: string[]`. Sama reegel mis serveri `can_write_work`, ilma
  lugemisõiguse osata (seda frontend ei tea; server keeldub niikuinii).

- [ ] **Step 1: Write the failing test**

Lisa `src/utils/__tests__/roleUtils.test.ts`-i:

```ts
describe('canEditWork', () => {
  const work = { collections: ['oma'] };

  it('lubab editoril kõike', () => {
    expect(canEditWork({ role: 'editor' }, work)).toBe(true);
  });

  it('lubab contributoril oma kollektsiooni', () => {
    expect(canEditWork({ role: 'contributor', edit_collections: ['oma'] }, work)).toBe(true);
  });

  it('keelab contributoril võõra kollektsiooni', () => {
    expect(canEditWork({ role: 'contributor', edit_collections: ['muu'] }, work)).toBe(false);
  });

  it('keelab contributoril kollektsioonita teose', () => {
    expect(canEditWork({ role: 'contributor', edit_collections: ['oma'] }, { collections: [] })).toBe(false);
  });

  it('keelab välja logitud kasutajal', () => {
    expect(canEditWork(null, work)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- roleUtils`
Expected: FAIL — `canEditWork is not defined`.

- [ ] **Step 3: Implement**

`src/utils/roleUtils.ts`:

```ts
interface WorkScope { collections?: string[] }
interface UserScope { role?: string; edit_collections?: string[] }

/**
 * Kas kasutaja tohib teost muuta. Peegeldab serveri can_write_work'i
 * ulatuse-osa (ADR 0031). Lugemisõiguse osa jääb serverile — frontend on
 * ergonoomika, mitte turve.
 */
export function canEditWork(user: UserScope | null | undefined, work: WorkScope | null | undefined): boolean {
  if (!user) return false;
  if (user.role !== 'contributor') return true;
  const scope = user.edit_collections ?? [];
  if (scope.length === 0) return false;
  const workCollections = work?.collections ?? [];
  return workCollections.some((c) => scope.includes(c));
}
```

`src/contexts/UserContext.tsx:14-19` — lisa `User`-i:

```ts
  edit_collections?: string[];
```

`src/pages/Workspace.tsx:684` — asenda:

```tsx
            readOnly={!canEditWork(user, work)}
```

Impordi `canEditWork` `../utils/roleUtils`-ist (`isAtLeast` on juba imporditud
real 2).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- roleUtils && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run lint:ci
git add src/utils/roleUtils.ts src/utils/__tests__/roleUtils.test.ts src/contexts/UserContext.tsx src/pages/Workspace.tsx
git commit -m "feat(frontend): canEditWork peegeldab kirjutamisulatust Workspace'is"
```

---

### Task 6: Frontend — admin-UI ja tõlked

**Files:**
- Modify: `src/pages/admin/Registrations.tsx` (rolli + kollektsiooni valik kinnitamisel)
- Modify: `src/pages/admin/Users.tsx:28, 44, 157-166` (`edit_collections` haldus)
- Modify: `src/locales/et/admin.json`, `src/locales/en/admin.json`

**Interfaces:**
- Consumes: `POST /admin/registrations/approve` (uued body-väljad `role`,
  `edit_collections`), `POST /admin/users/update-edit-collections`.
- Produces: UI, millest tekib contributor koos ulatusega ühe nupuvajutusega.

- [ ] **Step 1: Lisa tõlkevõtmed MÕLEMASSE keelde**

`src/locales/et/admin.json`, `registrations` ja `users` objektidesse:

```json
    "roleLabel": "Roll",
    "roleEditor": "Toimetaja (kogu korpus)",
    "roleContributor": "Kaastööline (valitud kollektsioonid)",
    "editCollections": "Kirjutamisulatus",
    "editCollectionsHint": "Kaastööline saab toimetada ainult neid kollektsioone.",
    "editCollectionsNone": "Ulatust pole valitud — kaastööline ei saa midagi muuta"
```

`src/locales/en/admin.json` — samad võtmed:

```json
    "roleLabel": "Role",
    "roleEditor": "Editor (whole corpus)",
    "roleContributor": "Contributor (selected collections)",
    "editCollections": "Write scope",
    "editCollectionsHint": "A contributor can only edit these collections.",
    "editCollectionsNone": "No scope selected — this contributor cannot edit anything"
```

- [ ] **Step 2: Run the locale parity test**

Run: `npm test -- localeParity`
Expected: PASS. Kui FAIL, on võti ainult ühes keeles — paranda enne edasiminekut
(ADR 0011, `fallbackLng` on väljas).

- [ ] **Step 3: Registrations.tsx — rolli ja ulatuse valik**

Impordi kollektsioonid (`Users.tsx:18` kasutab sama hooki):

```tsx
import { useCollection } from '../../contexts/CollectionContext';
```

Komponendi sisse, olemasolevate `useState`-ide juurde:

```tsx
  const { collections } = useCollection();
  const [approveRole, setApproveRole] = useState<'editor' | 'contributor'>('editor');
  const [approveScope, setApproveScope] = useState<string[]>([]);

  // KÕIK kollektsioonid, mitte ainult restricted: kirjutamisulatus kehtib ka
  // avalikele kogudele (erinevalt allowed_collections'ist).
  const allCollections = React.useMemo(
    () =>
      Object.entries(collections)
        .map(([id, c]) => ({ id, name: c.name?.et || id }))
        .sort((a, b) => a.name.localeCompare(b.name, 'et')),
    [collections]
  );
```

`handleApprove` — anna roll ja ulatus kaasa (üks päring, üks seisund):

```tsx
      const data = await apiPost<RegistrationActionResponse>('/admin/registrations/approve', {
        registration_id: regId,
        role: approveRole,
        edit_collections: approveRole === 'contributor' ? approveScope : []
      }, { token: authToken });
```

Kinnitusnupu kõrvale, taotluse kaardi sisse:

```tsx
  <div className="flex flex-col gap-2 mb-3">
    <label className="text-xs font-medium text-gray-500">{t('registrations.roleLabel')}</label>
    <select
      value={approveRole}
      onChange={(e) => setApproveRole(e.target.value as 'editor' | 'contributor')}
      className="text-sm border border-gray-300 rounded px-2 py-1"
    >
      <option value="editor">{t('registrations.roleEditor')}</option>
      <option value="contributor">{t('registrations.roleContributor')}</option>
    </select>

    {approveRole === 'contributor' && (
      <div>
        <span className="text-xs font-medium text-gray-500">{t('registrations.editCollections')}</span>
        <div className="flex flex-wrap gap-2 mt-1">
          {allCollections.map((c) => (
            <label key={c.id} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={approveScope.includes(c.id)}
                onChange={(e) =>
                  setApproveScope((prev) =>
                    e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id)
                  )
                }
              />
              {c.name}
            </label>
          ))}
        </div>
        {approveScope.length === 0 && (
          <p className="text-xs text-amber-700 mt-1">{t('registrations.editCollectionsNone')}</p>
        )}
      </div>
    )}
  </div>
```

Kinnitusnupule lisa `disabled`:

```tsx
    disabled={processingId === reg.id || (approveRole === 'contributor' && approveScope.length === 0)}
```

- [ ] **Step 4: Users.tsx — ulatuse muutmine olemasoleval kasutajal**

Tüüpi (rida 28) lisa:

```tsx
  edit_collections?: string[];
```

`handleCollectionsChange` järele uus handler (sama muster: serveri vastus on tõe
allikas, mitte optimistlik nimekiri):

```tsx
  const handleEditCollectionsChange = async (username: string, nextScope: string[]) => {
    setCollectionsUpdating(username);
    setUsersError(null);
    try {
      const data = await apiPost<{ status: string; edit_collections?: string[]; message?: string }>(
        '/admin/users/update-edit-collections',
        { username, edit_collections: nextScope },
        { token: authToken }
      );
      if (data.status === 'success') {
        setUsers(users.map(u =>
          u.username === username ? { ...u, edit_collections: data.edit_collections || [] } : u
        ));
      } else {
        setUsersError(data.message || t('users.collectionsUpdateFailed'));
      }
    } catch (e) {
      console.error('Edit collections update error:', e);
      setUsersError(t('common:errors.connectionFailed'));
    } finally {
      setCollectionsUpdating(null);
    }
  };
```

`allowed_collections` ploki järele (rida ~452) uus plokk, nähtav ainult
contributor'ile — kõigi kollektsioonide seast, mitte ainult restricted:

```tsx
  {u.role === 'contributor' && (
    <div className="flex items-start gap-2">
      <span className="w-24 flex-shrink-0 text-xs font-medium text-gray-500 mt-1">
        {t('users.editCollections')}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap gap-2">
          {allCollections.map((c) => (
            <label key={c.id} className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                disabled={!canManage || collectionsUpdating === u.username}
                checked={(u.edit_collections || []).includes(c.id)}
                onChange={(e) => {
                  const cur = u.edit_collections || [];
                  handleEditCollectionsChange(
                    u.username,
                    e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)
                  );
                }}
              />
              {c.name}
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-1">{t('users.editCollectionsHint')}</p>
      </div>
    </div>
  )}
```

`allCollections` memo (kõik kollektsioonid) lisa `restrictedCollections` memo kõrvale
`Users.tsx:45` juurde — sama kuju, ilma `visibility` filtrita.

**NB:** ulatuse muutmine kustutab serveris kasutaja sessioonid (Task 2) — kasutaja
peab uuesti sisse logima. See on sama käitumine mis `allowed_collections` juures.

- [ ] **Step 5: Väravad**

Run: `npm run typecheck && npm test && npm run lint:ci`
Expected: kõik PASS; `lint:ci` hoiatuste arv ei tohi kasvada.

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/Registrations.tsx src/pages/admin/Users.tsx src/locales/
git commit -m "feat(admin): rolli ja kirjutamisulatuse valik kinnitamisel ja kasutajate lehel"
```

---

## Käsitsi läbimäng enne PR-i

1. Loo testkasutaja rolliga `contributor`, ulatus üks kollektsioon.
2. Logi sisse: teos oma kollektsioonis avaneb toimetatavana, salvestamine töötab.
3. Ava teos teisest kollektsioonist: tekst on nähtav, redaktor read-only.
4. Proovi salvestada `curl`-iga otse — server peab andma 403 (frontendi keeld ei ole
   ainus kaitse).
5. Kontrolli, et prosopograafia kaardi muutmise nupud on peidus (roll < editor).
6. Muuda admin-lehel ulatust — kasutaja sessioon peab katkema (uus login nõutav).
