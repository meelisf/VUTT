# Etapp 2 — kollektsiooniõigused ühisele teele (teostusplaan)

> **Agentidele:** KOHUSTUSLIK ALAMOSKUS: kasuta selle plaani täitmiseks
> `superpowers:subagent-driven-development` (soovitatud) või
> `superpowers:executing-plans`. Sammud on checkbox-kujul (`- [ ]`).

**Eesmärk:** eemaldada kollektsiooniõiguste vana kirjutustee ja viia
`CollectionEditor` etapis 1a ehitatud delta-toimingule; näidata lugemisõigust
ja kirjutamisulatust kahe eraldi teljena koos nende alusega; avada
kollektsioonide loend ja ligipääs adminile, jättes seaded superadminile.

**Arhitektuur:** `PUT /admin/collections/{id}` kaotab `allowed_users` haru ja
lükkab selle välja saatmise 400-ga tagasi. Õigused liiguvad uude
`CollectionAccessPanel` komponenti, mis kasutab
`POST /admin/users/collection-rights` deltat (1a) — sama toimingut, mida
hakkab kasutama ka etapi 3 kasutajadetail. `GET /admin/collections/{id}/users`
laieneb: lisaks `allowed_users`-ile tulevad `edit_users`, `visibility` ja
`is_virtual`. Paneel elab `CollectionEditor`-ist **väljas**, et admin näeks
ligipääsu ilma seadete vormita.

**Tehnoloogia:** FastAPI + Python 3.9, React 19 + TypeScript + Tailwind,
pytest, vitest, i18next.

**Spekk:** [`docs/superpowers/specs/2026-09-14-kasutajad-ja-kogude-ligipaas-design.md`](../specs/2026-09-14-kasutajad-ja-kogude-ligipaas-design.md) (§2 „Kollektsioon", §3, §5, §6 p2)
**ADR:** [0043](../../decisions/0043-kogude-oiguste-uhised-toimingud.md), [0031](../../decisions/0031-contributor-kollektsiooni-ulatus.md)
**Eelnevad etapid:** [1a](2026-09-14-kasutajad-ja-kogude-ligipaas-1a.md) PR #361, [1b](2026-09-14-kasutajad-ja-kogude-ligipaas-1b.md) PR #362 — mõlemad tootmises 2026-09-14

## Kaks PR-i, mitte üks

**PR A (taskid 1–6) on ATOMAARNE.** Vana kirjutustee eemaldamine serverist ja
kliendi üleviimine peavad olema samas PR-is: kui server lükkab `allowed_users`
tagasi enne, kui `CollectionEditor` on üle viidud, kaob adminilt
lugemisõiguste määramine täielikult. Neid EI TOHI eraldi juurutada.

**PR B (taskid 7–9)** on rollipiiri muudatus ja käib eraldi, PR A liitmise
järel. Virnastatud PR-idele CI checke ei tule
([[project_ci_only_main_prs]] — baasi ümbersuunamine EI käivita, close+reopen
käivitab), seega oota PR A liitmine ära, alles siis haruta PR B.

## Üldised piirangud

- **Koodikommentaarid eesti keeles.** Kommentaar ütleb MIKS, mitte MIDA.
- **Python 3.9:** `Optional[X]`, mitte `X | None`.
- **Blokeeriv I/O `async def` sees keelatud** (ADR 0002).
- **Testid:** ALATI `.venv/bin/pytest`, mitte süsteemi `python3`.
- **i18n (ADR 0011):** `fallbackLng` on VÄLJAS — iga uus võti MÕLEMASSE keelde
  korraga. Valvurid: `localeParity.test.ts`, `translationKeysResolve.test.ts`.
  **Etapis 2 tuleb i18n-i alla viia ka olemasolevad kõvakodeeritud eestikeelsed
  stringid** `CollectionEditor.tsx`-is (`'Salvestab...'`, `'+ Lisa kasutaja'`).
- **Kaks õiguste telge on eraldi (ADR 0031):** `allowed_collections` on
  lugemisõigus piiratud kogudele; `edit_collections` on contributori
  kirjutamisulatus ja kehtib KÕIGILE kollektsioonidele. Üks ei anna teist.
- **Avalikule kogule lugemisõiguse määrangut ei lisata** (server annab 400);
  vana määrangu eemaldamine on lubatud koristustoiming.
- **Õiguste salvestus EI saada kaasa `visibility`-t.** Nähtavuse muutmine jääb
  eraldi superadmini toiminguks ega kirjuta kasutajaid.
- **Nähtavuse muutmine ei korista määranguid.** Avalikuks muutmine ei kirjuta
  `users.json`-i üldse.
- **Õigusotsust EI tehta `work_collections_index.json` põhjal** (read-model,
  ADR 0007) — autoriteet on `users.json` ja `_metadata.json`.
- **Sessioonide hoiatus:** kollektsiooniõiguste salvestus invalideerib
  muudetud kasutajate sessioonid (erinevalt töökollektsioonist). Kasutajaliides
  ütleb seda ENNE salvestust.
- **`server/cache.py` ei hoia kasutajapõhiseid vastuseid** — sealsed vahemälud
  on globaalsed moodulitasandi muutujad.
- **Väravad iga taski lõpus:** `.venv/bin/pytest tests/ -q` (serveritaskid),
  `npm run typecheck` + `npm test` (kliendi taskid). PR-i lõpus kõik +
  `npm run lint:ci` (lävi 44, LANGETA parandades) + `npm run build`.

## Failistruktuur

### PR A

| Fail | Vastutus | Muudatus |
|---|---|---|
| `server/routers/collections.py` | kollektsioonide API | `allowed_users` haru EEMALDATUD + 400; `GET .../users` laiendus |
| `src/services/collectionRightsService.ts` | õiguste päringud apiClient'i kaudu | **uus** |
| `src/pages/admin/collectionRightsDraft.ts` | puhas mustand + kirjete klassifikatsioon | **uus** |
| `src/pages/admin/__tests__/collectionRightsDraft.test.ts` | ülaltoodu ühikkate | **uus** |
| `src/components/CollectionAccessPanel.tsx` | paneeli vaade | **uus** |
| `src/components/CollectionEditor.tsx` | õiguste plokk VÄLJA, paneel asemele | muuda |
| `src/locales/{et,en}/admin.json` | `collections.accessPanel.*` | muuda MÕLEMAD |
| `tests/test_collection_users_endpoint.py` | GET laienduse kate | **uus** |

### PR B

| Fail | Vastutus | Muudatus |
|---|---|---|
| `src/pages/admin/Collections.tsx` | lehe rollipiir | superadmin → admin; seaded eraldi |
| `src/components/CollectionEditor.tsx` | seadete vorm | `canEditSettings` prop |
| `src/pages/Admin.tsx` | plaadi nähtavus | `superadminOnly` maha |
| `src/locales/{et,en}/admin.json` | rollipiiri selgitus | muuda MÕLEMAD |

---

## PR A — vana tee välja, delta sisse

### Task 0: haru

- [ ] **Samm 1: värske main**

```bash
git checkout main && git pull --ff-only && git log --oneline -1
```
Oodatud: `9bbaa127` või uuem (1b merge).

- [ ] **Samm 2: haru**

```bash
git checkout -b feat/kollektsiooni-oigused-delta-2a
```

---

### Task 1: `GET /admin/collections/{id}/users` laiendus

**Failid:**
- Muuda: `server/routers/collections.py:190-208` (`admin_collection_users`)
- Test: `tests/test_collection_users_endpoint.py` (uus)

**Liidesed:**
- Toodab vastuse kuju:
  ```json
  {"status": "success", "collection": {...}, "allowed_users": ["mari"],
   "edit_users": ["juri"], "visibility": "restricted", "is_virtual": false}
  ```
  `allowed_users` = kõik selle ID-ga salvestatud LUGEMISõiguse määrangud.
  `edit_users` = kõik selle ID-ga salvestatud KIRJUTAMISULATUSE määrangud,
  **ka editor/admin omad** — paneel märgib need inertseks, ei peida.
  Kasutaja: Task 4.

- [ ] **Samm 1: kirjuta kukkuvad testid**

Loo `tests/test_collection_users_endpoint.py`:

```python
"""GET /admin/collections/{id}/users laiendus (#318, ADR 0043 p2).

Vastus kannab SALVESTATUD määranguid, mitte kehtivat õigust: `visibility`
ütleb, kas lugemismäärang üldse mõjub. Nii ei kao salvestatud andmed lugeja
rolli- või nähtavusfiltri taha.
"""
import json

import pytest


@pytest.fixture
def kogud(backend_env):
    fail = backend_env["collections_file"]
    fail.write_text(json.dumps({
        "kinnine": {"name": {"et": "Kinnine"}, "visibility": "restricted"},
        "avalik": {"name": {"et": "Avalik"}, "visibility": "public"},
        "ruhm": {"name": {"et": "Rühm"}, "type": "virtual_group"},
    }, ensure_ascii=False), encoding="utf-8")
    return fail


def _sea_oigused(backend_env, **kasutajad):
    auth = backend_env["auth"]
    users = auth.reload_users_cache()
    for uname, (lugemine, ulatus) in kasutajad.items():
        users[uname]["allowed_collections"] = lugemine
        users[uname]["edit_collections"] = ulatus
    auth.save_users(users)


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_tagastab_molemad_teljed(client, login, backend_env, kogud):
    _sea_oigused(backend_env, contrib=(["kinnine"], ["kinnine"]), editor=([], ["kinnine"]))
    token = login("admin", "adminpass")

    r = client.get("/admin/collections/kinnine/users", headers=_auth(token))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["allowed_users"] == ["contrib"]
    # editor'i salvestatud ulatus tuleb KAASA, mitte ei kao rollifiltri taha
    assert sorted(d["edit_users"]) == ["contrib", "editor"]
    assert d["visibility"] == "restricted"
    assert d["is_virtual"] is False
    assert d["collection"]["name"]["et"] == "Kinnine"


def test_avalik_kogu_naitab_salvestatud_maaranguid_ja_alust(client, login, backend_env, kogud):
    # Jäänuk ajast, mil kogu oli piiratud: see EI mõju, aga peab olema nähtav.
    _sea_oigused(backend_env, contrib=(["avalik"], []))
    token = login("admin", "adminpass")

    d = client.get("/admin/collections/avalik/users", headers=_auth(token)).json()
    assert d["allowed_users"] == ["contrib"]
    assert d["visibility"] == "public"


def test_virtuaalne_ruhm_on_margitud(client, login, backend_env, kogud):
    token = login("admin", "adminpass")
    d = client.get("/admin/collections/ruhm/users", headers=_auth(token)).json()
    assert d["is_virtual"] is True
    # Nähtavuse võti puudub konfist → vaikimisi avalik
    assert d["visibility"] == "public"


def test_tundmatu_kogu(client, login, kogud):
    token = login("admin", "adminpass")
    d = client.get("/admin/collections/puudub/users", headers=_auth(token)).json()
    assert d["status"] == "error"


def test_editor_ei_paase_ligi(client, login, kogud):
    token = login("editor", "editorpass")
    r = client.get("/admin/collections/kinnine/users", headers=_auth(token))
    # require_role("admin") ebaõnnestumisel tõstab deps.get_user HTTPException(401)
    assert r.status_code == 401
```

- [ ] **Samm 2: käivita testid, veendu et kukuvad**

Käsk: `.venv/bin/pytest tests/test_collection_users_endpoint.py -v`
Oodatud: FAIL — `KeyError: 'edit_users'`.

- [ ] **Samm 3: laienda endpoint**

Asenda `server/routers/collections.py` `admin_collection_users` keha:

```python
@router.get("/admin/collections/{collection_id}/users")
def admin_collection_users(collection_id: str, user=Depends(require_role("admin"))):
    """Kollektsiooni metaandmed koos MÕLEMA õiguste telje salvestatud määrangutega.

    Vastus kannab SALVESTATUD määranguid, mitte kehtivat õigust: `visibility`
    ütleb, kas lugemismäärang üldse mõjub, ja `edit_users` sisaldab ka
    editor/admin kirjeid, kelle ulatus tuleb niikuinii rollist. Paneel märgib
    need inertseks — peitmine kaotaks salvestatud andmed lugeja filtri taha
    ja teeks nende eemaldamise võimatuks (ADR 0043 p2).
    """
    if not os.path.exists(COLLECTIONS_FILE):
        return {"status": "error", "message": "collections.json ei leitud"}
    data = _read_json(COLLECTIONS_FILE)
    if collection_id not in data:
        return {"status": "error", "message": f"Kollektsioon '{collection_id}' ei leitud"}
    col = data[collection_id]

    # Hetktõmmis luku all: vastust ei koostata muutuvast jagatud cache-objektist.
    with users_transaction() as users_data:
        allowed_usernames = [
            uname for uname, udata in users_data.items()
            if collection_id in (udata.get("allowed_collections") or [])
        ]
        edit_usernames = [
            uname for uname, udata in users_data.items()
            if collection_id in (udata.get("edit_collections") or [])
        ]

    return {
        "status": "success",
        "collection": col,
        "allowed_users": allowed_usernames,
        "edit_users": edit_usernames,
        "visibility": col.get("visibility", "public"),
        "is_virtual": col.get("type") == "virtual_group",
    }
```

- [ ] **Samm 4: käivita testid**

Käsk: `.venv/bin/pytest tests/test_collection_users_endpoint.py tests/test_work_collections.py -v`
Oodatud: PASS.

- [ ] **Samm 5: commit**

```bash
git add server/routers/collections.py tests/test_collection_users_endpoint.py
git commit -m "feat(collections): GET users tagastab mõlemad õiguste teljed (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

### Task 2: `PUT /admin/collections/{id}` lükkab `allowed_users` tagasi

**Failid:**
- Muuda: `server/routers/collections.py` (PUT haru, 1a-s lukustatud plokk)
- Test: `tests/test_collection_users_endpoint.py` (täiendus)

**NB:** see task LÕHUB `CollectionEditor`-i, kuni Task 5 on tehtud. Seepärast
on PR A atomaarne — vahepealset olekut EI juurutata.

- [ ] **Samm 1: kirjuta kukkuvad testid**

Lisa `tests/test_collection_users_endpoint.py` lõppu:

```python
def test_put_lukkab_allowed_usersi_tagasi(client, login, backend_env, kogud):
    """Vana klient ei tohi saada vaikset eduvastust (ADR 0043 p2)."""
    token = login("superadmin", "superpass")
    r = client.put("/admin/collections/kinnine",
                   json={"allowed_users": ["contrib"]},
                   headers=_auth(token))
    assert r.status_code == 400
    assert "allowed_users" in str(r.json().get("detail", r.text))


def test_keeldumine_kaib_ENNE_korvalmojusid(client, login, backend_env, kogud):
    """Seaded ei tohi salvestuda, kui pakett kannab keelatud välja."""
    token = login("superadmin", "superpass")
    enne = json.loads(kogud.read_text())["kinnine"].get("color")

    client.put("/admin/collections/kinnine",
               json={"color": "rose", "allowed_users": ["contrib"]},
               headers=_auth(token))

    assert json.loads(kogud.read_text())["kinnine"].get("color") == enne


def test_put_ilma_allowed_usersita_toimib(client, login, backend_env, kogud):
    token = login("superadmin", "superpass")
    r = client.put("/admin/collections/kinnine",
                   json={"color": "rose"},
                   headers=_auth(token))
    assert r.status_code == 200, r.text
    assert json.loads(kogud.read_text())["kinnine"]["color"] == "rose"
```

- [ ] **Samm 2: käivita testid, veendu et kukuvad**

Käsk: `.venv/bin/pytest tests/test_collection_users_endpoint.py -v -k "allowed_usersi or ENNE"`
Oodatud: FAIL — praegu tuleb 200 ja kasutajad kirjutatakse.

- [ ] **Samm 3: eemalda haru ja lisa keeldumine**

`server/routers/collections.py` PUT-is (`admin_update_collection`, rida 101):
**kustuta** kogu 1a-s lukustatud plokk ridadelt ~163–189
(`allowed_users_param` kuni sessioonide invalideerimise tsüklini, koos
`def _kirjuta_allowed_users()`-iga) ning lisa kohe `body = await
request.json()` järele (rida 103), ENNE ühtki kirjutust:

```python
    # Õigused liikusid eraldi delta-toimingule (ADR 0043 p2):
    # POST /admin/users/collection-rights. Vana väli lükatakse tagasi ENNE
    # kõrvalmõjusid, et vana klient ei saaks vaikset eduvastust.
    if "allowed_users" in body:
        raise HTTPException(
            status_code=400,
            detail="allowed_users ei ole enam selle endpoint'i osa — "
                   "kasuta POST /admin/users/collection-rights")
```

Kui `delete_user_sessions` või `users_transaction` jäid pärast eemaldamist
importideks kasutuseta, kontrolli ja korista:

```bash
grep -n "delete_user_sessions\|users_transaction\|save_users" server/routers/collections.py
```

(Task 1 GET ja koristusfunktsioon kasutavad neid endiselt — ära eemalda
importi, mida veel kasutatakse.)

- [ ] **Samm 4: käivita testid**

Käsk: `.venv/bin/pytest tests/ -q`
Oodatud: PASS. Kui mõni vana test saadab PUT-iga `allowed_users`-i ja ootab
200, on see **teadlik lepingu muutus** — uuenda testi ootust 400-le ja
kommenteeri põhjus.

- [ ] **Samm 5: commit**

```bash
git add server/routers/collections.py tests/test_collection_users_endpoint.py
git commit -m "feat(collections)!: PUT ei kirjuta enam allowed_users välja (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

### Task 3: õiguste klienditeenus

**Failid:**
- Loo: `src/services/collectionRightsService.ts`

**Kontekst:** `CollectionEditor` kasutab praegu toorest `fetchWithTimeout` +
`FILE_API_URL`-i. Uus tee läheb `apiClient`-i kaudu, et saada olemasolev
tokeni-, timeout'i-, `ApiError`- ja 401/sessiooni aegumise käsitlus (ADR 0004).
Paneelile EI tehta uut fetch/auth kihti.

**Liidesed:**
- Toodab:
  ```ts
  export interface CollectionRights {
    collection: { name?: Record<string, string>; [k: string]: unknown };
    allowed_users: string[];
    edit_users: string[];
    visibility: 'public' | 'restricted';
    is_virtual: boolean;
  }
  export type RightsField = 'allowed' | 'edit';
  export interface RightsChange {
    username: string; collection_id: string; field: RightsField;
    action: 'add' | 'remove';
  }
  export interface RightsResult {
    users: Record<string, { allowed_collections: string[]; edit_collections: string[] }>;
  }
  export function getCollectionRights(id: string): Promise<CollectionRights>;
  export function applyCollectionRights(changes: RightsChange[]): Promise<RightsResult>;
  ```
  Kasutajad: Task 5 (paneel), etapp 3 (kasutajadetail).

- [ ] **Samm 1: kirjuta teenus**

Loo `src/services/collectionRightsService.ts`:

```ts
/**
 * Kollektsiooniõiguste päringud (#318, ADR 0043 p2).
 *
 * Kaks telge: `allowed` = lugemisõigus piiratud kogule, `edit` =
 * contributori kirjutamisulatus (kehtib KÕIGILE kogudele, ADR 0031).
 * Üks ei anna teist.
 *
 * Delta saadab AINULT muudetud määrangud — mitte tervet loendit. Vana
 * täisasendus võis avalikuks muutunud kogu ID sanitiseerimisel vaikselt
 * maha võtta; delta puudutab ainult nimetatud kolmikuid.
 */
import { apiGet, apiPost } from './apiClient';

const AUTH = { useAuth: true } as const;

export interface CollectionRights {
  collection: { name?: Record<string, string>; [k: string]: unknown };
  allowed_users: string[];
  edit_users: string[];
  visibility: 'public' | 'restricted';
  is_virtual: boolean;
}

export type RightsField = 'allowed' | 'edit';

export interface RightsChange {
  username: string;
  collection_id: string;
  field: RightsField;
  action: 'add' | 'remove';
}

export interface RightsResult {
  users: Record<string, { allowed_collections: string[]; edit_collections: string[] }>;
}

export async function getCollectionRights(id: string): Promise<CollectionRights> {
  const d = await apiGet<CollectionRights & { status?: string; message?: string }>(
    `/admin/collections/${id}/users`, AUTH);
  if (d.status === 'error') throw new Error(d.message || 'Laadimine ebaõnnestus');
  return d;
}

export async function applyCollectionRights(changes: RightsChange[]): Promise<RightsResult> {
  return apiPost<RightsResult>('/admin/users/collection-rights', { changes }, AUTH);
}
```

- [ ] **Samm 2: kontrolli `ApiRequestOptions` kuju**

`AUTH` peab vastama olemasolevale mustrile. Vaata, kuidas
`src/services/workSetService.ts` oma `AUTH`-i defineerib, ja kasuta SAMA kuju
— ära leiuta teist:

```bash
grep -n "const AUTH" src/services/workSetService.ts
```

- [ ] **Samm 3: typecheck ja commit**

```bash
npm run typecheck
git add src/services/collectionRightsService.ts
git commit -m "feat(collections): õiguste klienditeenus apiClient'i kaudu (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

### Task 4: mustandi- ja klassifikatsioonimoodul

**Failid:**
- Loo: `src/pages/admin/collectionRightsDraft.ts`
- Test: `src/pages/admin/__tests__/collectionRightsDraft.test.ts`

**Kontekst:** see on kollektsioonide vaste 1b moodulile `workSetAccessDraft.ts`.
Kaks telge ja „alus" on siin uued: määrangu tähendus sõltub kogu nähtavusest
ja kasutaja rollist.

**Liidesed:**
- Toodab:
  ```ts
  export type RightsBasis = 'public' | 'assigned' | 'role_based' | 'inert';
  export interface RightsRow {
    username: string;
    /** Kas sellel kasutajal on SALVESTATUD lugemisõiguse määrang? */
    allowed: boolean;
    /** Kas sellel kasutajal on SALVESTATUD kirjutamisulatuse määrang? */
    edit: boolean;
    /** Lugemisõiguse alus kuvamiseks. */
    allowedBasis: RightsBasis;
    /** Kirjutamisulatuse alus kuvamiseks. */
    editBasis: RightsBasis;
    canManage: boolean;
  }
  export interface RightsUser { username: string; name: string; email: string; role: string; }
  export interface RightsState {
    visibility: 'public' | 'restricted';
    isVirtual: boolean;
    allowed: Set<string>;
    edit: Set<string>;
  }
  export function rightsRows(state: RightsState, users: RightsUser[],
                             actor: { username: string; role: string },
                             opts?: { usersKnown?: boolean }): RightsRow[];
  export function canAddAllowed(state: RightsState): boolean;
  export function canAddEdit(state: RightsState, targetRole: string): boolean;
  export function rightsDelta(loaded: RightsState, draft: RightsState,
                              collectionId: string): RightsChange[];
  export function affectedUsernames(changes: RightsChange[]): string[];
  ```
  Kasutaja: Task 5.

- [ ] **Samm 1: kirjuta kukkuvad testid**

Loo `src/pages/admin/__tests__/collectionRightsDraft.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  affectedUsernames, canAddAllowed, canAddEdit, rightsDelta, rightsRows,
  RightsState, RightsUser,
} from '../collectionRightsDraft';

const USERS: RightsUser[] = [
  { username: 'mari', name: 'Mari Mets', email: 'mari@ut.ee', role: 'contributor' },
  { username: 'juri', name: 'Jüri Jõgi', email: 'juri@ut.ee', role: 'editor' },
  { username: 'aadu', name: 'Aadu Admin', email: 'aadu@ut.ee', role: 'admin' },
];
const ADMIN = { username: 'aadu', role: 'admin' };

const olek = (p: Partial<RightsState> = {}): RightsState => ({
  visibility: 'restricted', isVirtual: false,
  allowed: new Set<string>(), edit: new Set<string>(), ...p,
});

describe('rightsRows — alus', () => {
  it('piiratud kogul on määratud lugemisõigus „assigned"', () => {
    const [r] = rightsRows(olek({ allowed: new Set(['mari']) }), USERS, ADMIN);
    expect(r.username).toBe('mari');
    expect(r.allowed).toBe(true);
    expect(r.allowedBasis).toBe('assigned');
  });

  it('avalikul kogul on salvestatud lugemismäärang INERTNE, mitte kehtiv', () => {
    const [r] = rightsRows(
      olek({ visibility: 'public', allowed: new Set(['mari']) }), USERS, ADMIN);
    expect(r.allowed).toBe(true);
    expect(r.allowedBasis).toBe('inert');
  });

  it('editor+ salvestatud kirjutamisulatus on inertne — ulatus tuleb rollist', () => {
    const [r] = rightsRows(olek({ edit: new Set(['juri']) }), USERS, ADMIN);
    expect(r.username).toBe('juri');
    expect(r.edit).toBe(true);
    expect(r.editBasis).toBe('role_based');
  });

  it('contributori kirjutamisulatus on päris määrang', () => {
    const [r] = rightsRows(olek({ edit: new Set(['mari']) }), USERS, ADMIN);
    expect(r.editBasis).toBe('assigned');
  });

  it('admin+ kasutaja lugemisõigus tuleneb rollist', () => {
    const [r] = rightsRows(olek({ allowed: new Set(['aadu']) }), USERS, ADMIN);
    expect(r.allowedBasis).toBe('role_based');
  });

  it('sama kasutaja mõlemal teljel annab ÜHE rea', () => {
    const read = rightsRows(
      olek({ allowed: new Set(['mari']), edit: new Set(['mari']) }), USERS, ADMIN);
    expect(read).toHaveLength(1);
    expect(read[0].allowed && read[0].edit).toBe(true);
  });

  it('järjestab kasutajanime järgi', () => {
    const read = rightsRows(
      olek({ allowed: new Set(['mari', 'juri']) }), USERS, ADMIN);
    expect(read.map(r => r.username)).toEqual(['juri', 'mari']);
  });

  it('võrdse rolliga kasutaja rida ei ole hallatav', () => {
    const [r] = rightsRows(olek({ allowed: new Set(['aadu']) }), USERS, ADMIN);
    expect(r.canManage).toBe(false);
  });

  it('tundmatu kasutajaloend ei märgi kedagi rollipõhiseks', () => {
    // Loendi puudumine ei ole teadmine puudumisest (sama viga mis 1b-s).
    const [r] = rightsRows(olek({ allowed: new Set(['keegi']) }), [], ADMIN,
                           { usersKnown: false });
    expect(r.allowedBasis).toBe('assigned');
    expect(r.canManage).toBe(false);
  });
});

describe('canAddAllowed / canAddEdit', () => {
  it('avalikule kogule lugemisõigust ei lisata', () => {
    expect(canAddAllowed(olek({ visibility: 'public' }))).toBe(false);
    expect(canAddAllowed(olek())).toBe(true);
  });

  it('virtuaalsele rühmale kirjutamisulatust ei pakuta', () => {
    expect(canAddEdit(olek({ isVirtual: true }), 'contributor')).toBe(false);
  });

  it('kirjutamisulatust pakutakse ainult contributor-ile', () => {
    expect(canAddEdit(olek(), 'contributor')).toBe(true);
    expect(canAddEdit(olek(), 'editor')).toBe(false);
  });

  it('kirjutamisulatus AVALIKUL kogul on lubatud — teljed on eraldi', () => {
    expect(canAddEdit(olek({ visibility: 'public' }), 'contributor')).toBe(true);
  });
});

describe('rightsDelta', () => {
  const laetud = olek({ allowed: new Set(['mari']), edit: new Set(['juri']) });

  it('muutusteta mustand annab tühja delta', () => {
    expect(rightsDelta(laetud, olek({ allowed: new Set(['mari']), edit: new Set(['juri']) }), 'k'))
      .toEqual([]);
  });

  it('lisamine ja eemaldamine mõlemal teljel', () => {
    const d = rightsDelta(laetud, olek({ allowed: new Set(['juri']), edit: new Set() }), 'k');
    expect(d).toEqual([
      { username: 'juri', collection_id: 'k', field: 'allowed', action: 'add' },
      { username: 'mari', collection_id: 'k', field: 'allowed', action: 'remove' },
      { username: 'juri', collection_id: 'k', field: 'edit', action: 'remove' },
    ]);
  });

  it('puutumata telg ei tekita ühtki muudatust', () => {
    const d = rightsDelta(laetud, olek({ allowed: new Set(['mari']), edit: new Set() }), 'k');
    expect(d.every(c => c.field === 'edit')).toBe(true);
  });
});

describe('affectedUsernames', () => {
  it('üks nimi inimese kohta, ka kahe muudatuse korral', () => {
    expect(affectedUsernames([
      { username: 'mari', collection_id: 'k', field: 'allowed', action: 'add' },
      { username: 'mari', collection_id: 'k', field: 'edit', action: 'add' },
      { username: 'juri', collection_id: 'k', field: 'allowed', action: 'remove' },
    ])).toEqual(['juri', 'mari']);
  });
});
```

- [ ] **Samm 2: käivita testid, veendu et kukuvad**

Käsk: `npx vitest run src/pages/admin/__tests__/collectionRightsDraft.test.ts`
Oodatud: FAIL — moodulit ei leita.

- [ ] **Samm 3: kirjuta moodul**

Loo `src/pages/admin/collectionRightsDraft.ts`:

```ts
/**
 * Kollektsiooniõiguste MUSTAND ja kirjete alus (#318, ADR 0043 p2).
 *
 * Kaks telge (ADR 0031): `allowed` on lugemisõigus piiratud kogule,
 * `edit` on contributori kirjutamisulatus ja kehtib KÕIGILE kogudele.
 * Üks ei anna teist.
 *
 * „Alus" eristab kolme asja, mis vaates näevad sarnased välja: kehtiv
 * määrang, rollist tulenev õigus (mida ei saa eemaldada) ja salvestatud
 * jäänuk, mis praegu ei mõju. Siinsed funktsioonid PEEGELDAVAD serveri
 * reegleid — otsus tehakse serveris (`apply_collection_rights_delta`).
 */
import { isAtLeast } from '../../utils/roleUtils';
import { RightsChange } from '../../services/collectionRightsService';

export type RightsBasis = 'public' | 'assigned' | 'role_based' | 'inert';

export interface RightsRow {
  username: string;
  allowed: boolean;
  edit: boolean;
  allowedBasis: RightsBasis;
  editBasis: RightsBasis;
  canManage: boolean;
}

export interface RightsUser {
  username: string;
  name: string;
  email: string;
  role: string;
}

export interface RightsState {
  visibility: 'public' | 'restricted';
  isVirtual: boolean;
  allowed: Set<string>;
  edit: Set<string>;
}

/** Serveri `can_manage_user` peegeldus: RANGELT madalam tase. */
function tohibHallata(actorRole: string, targetRole: string): boolean {
  const tasemed = ['contributor', 'editor', 'admin', 'superadmin'];
  const a = tasemed.indexOf(actorRole);
  const t = tasemed.indexOf(targetRole);
  return a > -1 && t > -1 && a > t;
}

export function rightsRows(
  state: RightsState, users: RightsUser[],
  actor: { username: string; role: string },
  opts: { usersKnown?: boolean } = {},
): RightsRow[] {
  // Tühi kasutajaloend ei tähenda „kõik on tundmatud" (1b õppetund):
  // rolle ei teata, seega rollipõhist alust ei omistata ja midagi ei hallata.
  const usersKnown = opts.usersKnown ?? true;
  const rollid = new Map(users.map(u => [u.username, u.role]));

  const nimed = [...new Set([...state.allowed, ...state.edit])].sort();
  return nimed.map(username => {
    const roll = rollid.get(username);
    const allowed = state.allowed.has(username);
    const edit = state.edit.has(username);

    let allowedBasis: RightsBasis = 'assigned';
    let editBasis: RightsBasis = 'assigned';

    if (usersKnown && roll !== undefined) {
      if (isAtLeast(roll, 'admin')) {
        // Admin+ näeb ja toimetab kõike rollist tulenevalt.
        allowedBasis = 'role_based';
        editBasis = 'role_based';
      } else if (isAtLeast(roll, 'editor')) {
        // Toimetaja kirjutamisulatus on üldine, aga piiratud kogu
        // LUGEMISõigust vajab ta endiselt (ADR 0031).
        editBasis = 'role_based';
      }
    }
    // Avalikul kogul ei mõju salvestatud lugemismäärang — aga ta on alles ja
    // hakkab uuesti mõjuma, kui kogu piiratakse.
    if (allowedBasis === 'assigned' && state.visibility === 'public') {
      allowedBasis = 'inert';
    }

    return {
      username, allowed, edit, allowedBasis, editBasis,
      canManage: usersKnown && roll !== undefined && tohibHallata(actor.role, roll),
    };
  });
}

/** Lugemisõiguse määrangu saab lisada AINULT piiratud kogule (server: 400). */
export function canAddAllowed(state: RightsState): boolean {
  return state.visibility === 'restricted';
}

/**
 * Kirjutamisulatust pakutakse ainult contributor-ile: editor+ ulatus tuleb
 * rollist. Virtuaalsele rühmale mitte kunagi — teosele ei saagi virtuaalset
 * gruppi määrata, seega ei saa see olla ka kirjutamisulatuse liige.
 */
export function canAddEdit(state: RightsState, targetRole: string): boolean {
  if (state.isVirtual) return false;
  return !isAtLeast(targetRole, 'editor');
}

/** Muudetud määrangud ühe kogu piires. Puutumata telg ei tekita muudatust. */
export function rightsDelta(
  loaded: RightsState, draft: RightsState, collectionId: string,
): RightsChange[] {
  const out: RightsChange[] = [];
  for (const field of ['allowed', 'edit'] as const) {
    const vana = loaded[field];
    const uus = draft[field];
    for (const username of [...uus].sort()) {
      if (!vana.has(username)) {
        out.push({ username, collection_id: collectionId, field, action: 'add' });
      }
    }
    for (const username of [...vana].sort()) {
      if (!uus.has(username)) {
        out.push({ username, collection_id: collectionId, field, action: 'remove' });
      }
    }
  }
  return out;
}

/** Mitu INIMEST pakett puudutab — sessioonide hoiatuse jaoks. */
export function affectedUsernames(changes: RightsChange[]): string[] {
  return [...new Set(changes.map(c => c.username))].sort();
}
```

- [ ] **Samm 4: käivita testid**

Käsk: `npx vitest run src/pages/admin/__tests__/collectionRightsDraft.test.ts`
Oodatud: PASS (17 testi).

- [ ] **Samm 5: kontrolli regexit ja typecheck**

Selles moodulis regexit ei ole, aga kontrolli, et fail ei sisalda
kõvakodeeritud kasutajanähtavaid stringe (need kuuluvad i18n-i alla):

```bash
npm run typecheck
```

- [ ] **Samm 6: commit**

```bash
git add src/pages/admin/collectionRightsDraft.ts src/pages/admin/__tests__/collectionRightsDraft.test.ts
git commit -m "feat(collections): õiguste mustandi ja aluse arvutus (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

### Task 5: `CollectionAccessPanel` ja `CollectionEditor`-i üleviimine

**Failid:**
- Loo: `src/components/CollectionAccessPanel.tsx`
- Muuda: `src/components/CollectionEditor.tsx`
- Muuda: `src/locales/{et,en}/admin.json`

**Liidesed:**
- Tarbib: Task 3 teenus, Task 4 moodul.
- Toodab:
  ```tsx
  interface CollectionAccessPanelProps {
    collectionId: string;
    users: RightsUser[];
    usersKnown: boolean;
    actor: { username: string; role: string };
    /** Kutsutakse pärast edukat salvestust (nt kogude värskenduseks). */
    onSaved?: () => void;
  }
  export default function CollectionAccessPanel(p: CollectionAccessPanelProps): JSX.Element;
  ```

- [ ] **Samm 1: lisa i18n võtmed MÕLEMASSE keelde**

`src/locales/et/admin.json` → `collections` objekti sisse:

```json
"accessPanel": {
  "title": "Ligipääs",
  "readRight": "Lugemisõigus",
  "writeScope": "Kirjutamisulatus",
  "basisPublic": "Avalik",
  "basisAssigned": "Määratud",
  "basisRoleBased": "Rollist tulenev",
  "basisInert": "Praegu ei mõju: kogu on avalik",
  "publicNoRead": "Kogu on avalik — lugemisõiguse määrangut ei ole vaja ega saa lisada.",
  "editorNeedsRead": "Toimetaja kirjutamisulatus on üldine, aga piiratud kogu lugemisõigust vajab ta endiselt.",
  "scopeWithoutRead": "See ulatus üksi ei ava piiratud teoseid. Lisa eraldi ka lugemisõigus.",
  "addReadRight": "Lisa lugemisõigus",
  "notFullAudit": "See on selle kollektsiooni kaudu antud õigus. Teose tegelikku ligipääsu võivad mõjutada teised kollektsioonid, avalikkus või jagatav link.",
  "searchPlaceholder": "Otsi nime, kasutajanime või e-posti järgi",
  "noMatches": "Ühtki kasutajat ei leitud",
  "addPerson": "Lisa kasutaja",
  "remove": "Eemalda",
  "noEntries": "Ühtki määrangut ei ole",
  "sessionWarning": "Õiguste muutmisel peavad mõjutatud kasutajad uuesti sisse logima.",
  "sessionWarningCount": "Mõjutatud kasutajaid: {{count}}",
  "save": "Salvesta muudatused",
  "cancel": "Loobu",
  "saving": "Salvestan…",
  "loadFailed": "Ligipääsu laadimine ebaõnnestus",
  "saveFailed": "Salvestamine ebaõnnestus"
}
```

`src/locales/en/admin.json` → SAMASSE kohta, sama võtmestik:

```json
"accessPanel": {
  "title": "Access",
  "readRight": "Read access",
  "writeScope": "Write scope",
  "basisPublic": "Public",
  "basisAssigned": "Assigned",
  "basisRoleBased": "Derives from role",
  "basisInert": "Currently has no effect: the collection is public",
  "publicNoRead": "This collection is public — a read access entry is neither needed nor allowed.",
  "editorNeedsRead": "An editor's write scope is general, but they still need read access to a restricted collection.",
  "scopeWithoutRead": "This scope alone does not open restricted works. Add read access separately.",
  "addReadRight": "Add read access",
  "notFullAudit": "These are the rights granted through this collection. Actual access to a work may also be affected by other collections, by it being public, or by a shareable link.",
  "searchPlaceholder": "Search by name, username or email",
  "noMatches": "No users found",
  "addPerson": "Add user",
  "remove": "Remove",
  "noEntries": "No entries",
  "sessionWarning": "Changing rights forces the affected users to sign in again.",
  "sessionWarningCount": "Affected users: {{count}}",
  "save": "Save changes",
  "cancel": "Cancel",
  "saving": "Saving…",
  "loadFailed": "Loading access failed",
  "saveFailed": "Saving failed"
}
```

Käivita i18n valvurid:

```bash
npx vitest run src/locales
```

- [ ] **Samm 2: kirjuta paneel**

Loo `src/components/CollectionAccessPanel.tsx`:

```tsx
/**
 * Kollektsiooni ligipääsupaneel (#318, ADR 0043 p2).
 *
 * Kaks telge (ADR 0031): lugemisõigus piiratud kogule ja contributori
 * kirjutamisulatus. Üks EI anna teist — seepärast on siin kaks eraldi
 * märkeruutu, mitte üks „ligipääs".
 *
 * Mustand + „Salvesta muudatused": saadetakse DELTA, mitte tervet loendit.
 * Vana täisasendus võis avalikuks muutunud kogu ID sanitiseerimisel vaikselt
 * maha võtta; delta puudutab ainult nimetatud kolmikuid.
 *
 * Erinevalt töökollektsiooni paneelist INVALIDEERIB salvestus mõjutatud
 * kasutajate sessioonid — hoiatus on nupu juures, enne vajutust.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Trash2, UserPlus } from 'lucide-react';
import {
  applyCollectionRights, getCollectionRights,
} from '../services/collectionRightsService';
import {
  affectedUsernames, canAddAllowed, canAddEdit, rightsDelta, rightsRows,
  RightsBasis, RightsState, RightsUser,
} from '../pages/admin/collectionRightsDraft';

interface CollectionAccessPanelProps {
  collectionId: string;
  users: RightsUser[];
  usersKnown: boolean;
  actor: { username: string; role: string };
  onSaved?: () => void;
}

const klooni = (s: RightsState): RightsState =>
  ({ ...s, allowed: new Set(s.allowed), edit: new Set(s.edit) });

const CollectionAccessPanel: React.FC<CollectionAccessPanelProps> = ({
  collectionId, users, usersKnown, actor, onSaved,
}) => {
  const { t } = useTranslation(['admin', 'common']);

  const [laetud, setLaetud] = useState<RightsState | null>(null);
  const [mustand, setMustand] = useState<RightsState | null>(null);
  const [laadin, setLaadin] = useState(true);
  const [salvestan, setSalvestan] = useState(false);
  const [viga, setViga] = useState<string | null>(null);
  const [otsing, setOtsing] = useState('');

  const lae = useCallback(async () => {
    setLaadin(true);
    setViga(null);
    try {
      const d = await getCollectionRights(collectionId);
      const olek: RightsState = {
        visibility: d.visibility,
        isVirtual: d.is_virtual,
        allowed: new Set(d.allowed_users),
        edit: new Set(d.edit_users),
      };
      setLaetud(olek);
      setMustand(klooni(olek));
    } catch {
      // Laadimisviga EI tohi muutuda tühjaks õiguste kaardiks: tühi kaart
      // näeks välja nagu „õigusi ei ole" ja selle salvestamine kustutaks kõik.
      setLaetud(null);
      setMustand(null);
      setViga(t('collections.accessPanel.loadFailed'));
    } finally {
      setLaadin(false);
    }
  }, [collectionId, t]);

  useEffect(() => { lae(); }, [lae]);

  const read = useMemo(
    () => (mustand ? rightsRows(mustand, users, actor, { usersKnown }) : []),
    [mustand, users, actor, usersKnown]);

  const delta = useMemo(
    () => (laetud && mustand ? rightsDelta(laetud, mustand, collectionId) : []),
    [laetud, mustand, collectionId]);

  const mojutatud = useMemo(() => affectedUsernames(delta), [delta]);

  const lisatavad = useMemo(() => {
    if (!mustand) return [];
    const q = otsing.trim().toLowerCase();
    if (!q) return [];
    return users.filter(u => {
      if (mustand.allowed.has(u.username) || mustand.edit.has(u.username)) return false;
      return `${u.name} ${u.username} ${u.email}`.toLowerCase().includes(q);
    });
  }, [users, mustand, otsing]);

  const lyliti = (username: string, field: 'allowed' | 'edit', peal: boolean) => {
    setMustand(prev => {
      if (!prev) return prev;
      const next = klooni(prev);
      if (peal) next[field].add(username);
      else next[field].delete(username);
      return next;
    });
  };

  const eemaldaRida = (username: string) => {
    setMustand(prev => {
      if (!prev) return prev;
      const next = klooni(prev);
      next.allowed.delete(username);
      next.edit.delete(username);
      return next;
    });
  };

  const salvesta = async () => {
    if (!mustand || delta.length === 0) return;
    setSalvestan(true);
    setViga(null);
    try {
      const tulemus = await applyCollectionRights(delta);
      // Kinnitatud olek tuleb serverilt: arvuta uus kaart sellest, mitte
      // optimistlikust oletusest.
      const uus = klooni(mustand);
      for (const [username, olek] of Object.entries(tulemus.users || {})) {
        if (olek.allowed_collections.includes(collectionId)) uus.allowed.add(username);
        else uus.allowed.delete(username);
        if (olek.edit_collections.includes(collectionId)) uus.edit.add(username);
        else uus.edit.delete(username);
      }
      setLaetud(klooni(uus));
      setMustand(uus);
      setOtsing('');
      onSaved?.();
    } catch (e) {
      setViga((e as { message?: string }).message
        || t('collections.accessPanel.saveFailed'));
    } finally {
      setSalvestan(false);
    }
  };

  const loobu = () => {
    if (laetud) setMustand(klooni(laetud));
    setViga(null);
    setOtsing('');
  };

  const alusSilt = (b: RightsBasis): string | null => {
    if (b === 'role_based') return t('collections.accessPanel.basisRoleBased');
    if (b === 'inert') return t('collections.accessPanel.basisInert');
    return null;
  };

  if (laadin) {
    return <div className="mt-3"><Loader2 size={16} className="animate-spin text-gray-400" /></div>;
  }

  if (!mustand || !laetud) {
    return (
      <div className="mt-3 rounded border border-red-200 bg-red-50 p-3">
        <p className="text-sm text-red-700">{viga}</p>
        <button type="button" onClick={lae}
                className="mt-2 text-sm text-red-700 underline">
          {t('common:retry', { defaultValue: '' }) || t('collections.accessPanel.title')}
        </button>
      </div>
    );
  }

  const roll = (username: string) =>
    users.find(u => u.username === username)?.role || 'contributor';

  return (
    <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-4">
      <h4 className="font-semibold text-gray-800">{t('collections.accessPanel.title')}</h4>
      <p className="mt-1 text-xs text-gray-500">{t('collections.accessPanel.notFullAudit')}</p>
      {mustand.visibility === 'public' && (
        <p className="mt-1 text-xs text-gray-500">{t('collections.accessPanel.publicNoRead')}</p>
      )}

      <ul className="mt-3 divide-y divide-gray-200">
        {read.length === 0 && (
          <li className="py-2 text-sm text-gray-500">{t('collections.accessPanel.noEntries')}</li>
        )}
        {read.map(rida => {
          const inimene = users.find(u => u.username === rida.username);
          // Kirjutamisulatus ilma lugemisõiguseta PIIRATUD kogul ei ava
          // teoseid — seda ei paranda vaikselt, vaid selgitatakse ja
          // pakutakse eraldi tegevust (spekk §2).
          const ulatusIlmaLugemiseta =
            rida.edit && !rida.allowed && mustand.visibility === 'restricted'
            && rida.editBasis === 'assigned';
          return (
            <li key={rida.username} className="py-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-gray-800">
                  {inimene ? `${inimene.name} (${rida.username})` : rida.username}
                </span>

                <label className="flex items-center gap-1 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={rida.allowed}
                    disabled={salvestan || !rida.canManage
                      || (!rida.allowed && !canAddAllowed(mustand))}
                    onChange={e => lyliti(rida.username, 'allowed', e.target.checked)}
                  />
                  {t('collections.accessPanel.readRight')}
                  {alusSilt(rida.allowedBasis) && (
                    <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700">
                      {alusSilt(rida.allowedBasis)}
                    </span>
                  )}
                </label>

                <label className="flex items-center gap-1 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={rida.edit}
                    disabled={salvestan || !rida.canManage
                      || (!rida.edit && !canAddEdit(mustand, roll(rida.username)))}
                    onChange={e => lyliti(rida.username, 'edit', e.target.checked)}
                  />
                  {t('collections.accessPanel.writeScope')}
                  {alusSilt(rida.editBasis) && (
                    <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700">
                      {alusSilt(rida.editBasis)}
                    </span>
                  )}
                </label>

                {rida.canManage && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-sm text-red-700 hover:underline"
                    disabled={salvestan}
                    onClick={() => eemaldaRida(rida.username)}
                  >
                    <Trash2 size={14} /> {t('collections.accessPanel.remove')}
                  </button>
                )}
              </div>

              {rida.editBasis === 'role_based' && rida.edit && (
                <p className="mt-1 text-xs text-gray-500">
                  {t('collections.accessPanel.editorNeedsRead')}
                </p>
              )}
              {ulatusIlmaLugemiseta && (
                <p className="mt-1 text-xs text-amber-700">
                  {t('collections.accessPanel.scopeWithoutRead')}{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => lyliti(rida.username, 'allowed', true)}
                  >
                    {t('collections.accessPanel.addReadRight')}
                  </button>
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-3">
        <input
          type="text"
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          placeholder={t('collections.accessPanel.searchPlaceholder')}
          value={otsing}
          onChange={e => setOtsing(e.target.value)}
        />
        {otsing.trim() !== '' && (
          <ul className="mt-2 max-h-48 overflow-y-auto rounded border border-gray-200 bg-white">
            {lisatavad.length === 0 && (
              <li className="px-2 py-1 text-sm text-gray-500">
                {t('collections.accessPanel.noMatches')}
              </li>
            )}
            {lisatavad.map(u => (
              <li key={u.username} className="flex items-center justify-between px-2 py-1">
                <span className="text-sm text-gray-800">{u.name} ({u.username})</span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-sm text-indigo-700 hover:underline"
                  onClick={() => {
                    // Lisamine algab sellest teljest, mis on üldse lubatud:
                    // avalikul kogul ainult ulatus, piiratud kogul lugemisõigus.
                    lyliti(u.username, canAddAllowed(mustand) ? 'allowed' : 'edit', true);
                    setOtsing('');
                  }}
                >
                  <UserPlus size={14} /> {t('collections.accessPanel.addPerson')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {viga && <p className="mt-3 text-sm text-red-700">{viga}</p>}

      {delta.length > 0 && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2">
          <p className="text-xs text-amber-800">
            {t('collections.accessPanel.sessionWarning')}{' '}
            {t('collections.accessPanel.sessionWarningCount', { count: mojutatud.length })}
          </p>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          disabled={delta.length === 0 || salvestan}
          onClick={salvesta}
        >
          {salvestan
            ? <span className="inline-flex items-center gap-1">
                <Loader2 className="animate-spin" size={14} />
                {t('collections.accessPanel.saving')}
              </span>
            : t('collections.accessPanel.save')}
        </button>
        <button
          type="button"
          className="rounded border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50"
          disabled={delta.length === 0 || salvestan}
          onClick={loobu}
        >
          {t('collections.accessPanel.cancel')}
        </button>
      </div>
    </div>
  );
};

export default CollectionAccessPanel;
```

**NB kolm kohta, mida teostusel kontrollida:**

1. Laadimisviga annab `mustand === null` ja paneel EI renderda salvestusnuppu.
   Tühi kaart näeks välja nagu „õigusi ei ole" ja selle salvestamine
   kustutaks kõik — laadimisviga ei tohi muutuda tühjaks õiguste kaardiks.
2. Uue inimese lisamine paneb märkeruudu sellele teljele, mis on lubatud
   (`canAddAllowed`). Kui kumbki ei ole lubatud, ei tohiks teda üldse
   pakkuda — kontrolli, kas `lisatavad` vajab lisafiltrit.
3. `t('common:retry', …)` on ajutine kohatäide veavaate nupul. Vaata, kas
   `common.json`-is on sobiv olemasolev võti (`retry`, `tryAgain`); kui ei
   ole, lisa `collections.accessPanel.retry` MÕLEMASSE keelde ja kasuta seda.
   Ära jäta `defaultValue`-põhist lahendust sisse.

- [ ] **Samm 3: eemalda vana õiguste plokk `CollectionEditor`-ist**

`src/components/CollectionEditor.tsx`-is:

1. **Kustuta** `saveAllowedUsers`, `handleAddUser`, `handleRemoveUser`.
2. **Kustuta** `allowed_users` rida `handleSave` payloadist (rida ~205) —
   server annaks nüüd 400 ja seaded ei salvestuks.
3. **Kustuta** `editVisibility === 'restricted'` sisene õiguste JSX plokk
   (read ~377–420) koos `allowedUsers`, `usersLoading`, `usersSaving`
   olekutega ja `/admin/collections/{id}/users` laadimisega.
4. **Asenda** see `<CollectionAccessPanel …/>`-ga, mis on nähtavuse
   valiku ploki KÕRVAL, mitte selle sees — kirjutamisulatust saab määrata ka
   avalikul kogul.
5. `allUsers` laadimine jääb, aga vii see `apiPost`-ile ja lisa `usersKnown`
   lipp (1b õppetund: tühi loend ≠ „kõik tundmatud").
6. Kõvakodeeritud stringid `'Salvestab...'` ja `'+ Lisa kasutaja'` kaovad
   koos vana plokiga — kontrolli, et `CollectionEditor.tsx`-i ei jää ühtki
   kõvakodeeritud kasutajanähtavat eestikeelset stringi:

```bash
grep -nE "'[A-ZÕÄÖÜ][a-zõäöü ]{3,}[.…]?'" src/components/CollectionEditor.tsx
```

- [ ] **Samm 4: väravad**

```bash
npm run typecheck
npm test
npm run lint:ci
```
Oodatud: PASS; lint ≤ 44.

- [ ] **Samm 5: commit**

```bash
git add src/components/CollectionAccessPanel.tsx src/components/CollectionEditor.tsx src/locales/et/admin.json src/locales/en/admin.json
git commit -m "feat(collections): õigused delta-toimingule ja kahele teljele (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

### Task 6: PR A väravad ja juurutus

- [ ] **Samm 1: kõik väravad**

```bash
.venv/bin/pytest tests/ -q
npm run typecheck
npm test
npm run lint:ci
npm run build
```

- [ ] **Samm 2: PR**

```bash
git push -u origin feat/kollektsiooni-oigused-delta-2a
gh pr create --base main --title "Etapp 2A: kollektsiooniõigused delta-toimingule (#318)" --body "..."
```

Kirjeldusse PEAB minema: see on **murdev muudatus** (`PUT
/admin/collections/{id}` lükkab `allowed_users` 400-ga tagasi) ja
server + klient peavad juurutuma KOOS.

- [ ] **Samm 3: juurutus — MÕLEMAD pooled**

```bash
# 1) backend
ssh vutt 'cd ~/VUTT && ./scripts/server_update.sh --no-cache'
# 2) frontend KOHE järele
npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/
```

Nende vahel on aken, mille jooksul vana bundle saab 400. Aken on lühike ja
puudutab ainult superadmini kollektsioonivaadet — aga tee need järjest, mitte
eri päevadel.

- [ ] **Samm 4: kontrolli tootmises**

- Piiratud kogu: lugemisõiguse lisamine/eemaldamine salvestub ühe nupuga;
  kuni nupuvajutuseni päringut ei lähe.
- Avalik kogu: lugemisõiguse lisamise nuppu ei ole; olemasolev jäänuk on
  märkega „Praegu ei mõju" ja eemaldatav.
- Contributorile ulatus ilma lugemisõiguseta → selgitus + eraldi nupp.
- Editori salvestatud ulatus kuvatakse inertsena, eemaldamisel ulatus säilib.
- Seadete salvestus (värv, kirjeldus, nähtavus) töötab ja EI saada
  `allowed_users`-it.
- Nähtavuse muutmine ei kirjuta kasutajaid: muuda kogu avalikuks ja kontrolli
  konteinerist, et `users.json` ei muutunud.

---

## PR B — kollektsioonide loend adminile

**Alusta alles siis, kui PR A on main'is ja tootmises.**

### Task 7: lehe rollipiir

**Failid:**
- Muuda: `src/pages/admin/Collections.tsx`
- Muuda: `src/components/CollectionEditor.tsx` (uus prop)
- Muuda: `src/pages/Admin.tsx`

- [ ] **Samm 1: haru**

```bash
git checkout main && git pull --ff-only
git checkout -b feat/kogude-loend-adminile-2b
```

- [ ] **Samm 2: ava leht adminile**

`src/pages/admin/Collections.tsx` — asenda `superadmin` kontroll `admin`-iga
MÕLEMAS kohas (`useEffect` navigeerimine ja `if (!isAtLeast(...)) return null`):

```tsx
    if (!userLoading && (!user || !isAtLeast(user.role, 'admin'))) {
      navigate('/');
    }
```

```tsx
  if (!isAtLeast(user.role, 'admin')) return null;
```

ja anna editorile teada, kas seadeid tohib muuta:

```tsx
        <CollectionEditor canEditSettings={isAtLeast(user.role, 'superadmin')} />
```

- [ ] **Samm 3: `CollectionEditor` seadete piir**

Lisa prop ja peida seadete osad, JÄTTES ligipääsupaneeli alles:

```tsx
interface CollectionEditorProps {
  /**
   * Kas kutsuja tohib kogu STRUKTUURI ja SEADEID muuta? Väär adminil:
   * ligipääs on admin+, seaded superadmin (ADR 0043 p4). Peitmine EI OLE
   * autoriseerimine — serveri `require_role("superadmin")` jääb alles.
   */
  canEditSettings?: boolean;
}
```

Peida `canEditSettings === false` korral: kirjelduse väljad, värvivalik,
nähtavuse valik, „Salvesta" nupp, loomise vorm ja kustutamise plokk.
`CollectionAccessPanel` JÄÄB nähtavaks.

- [ ] **Samm 4: admini plaat**

`src/pages/Admin.tsx` — eemalda `superadminOnly: true` `collections` kirjelt.
Kontrolli, kuidas plaadi nähtavust arvutatakse, ja veendu, et admin näeb
plaati; kui seal on eraldi rollikontroll, kohanda seda.

- [ ] **Samm 5: väravad**

```bash
npm run typecheck
npm test
npm run lint:ci
npm run build
.venv/bin/pytest tests/ -q
```

- [ ] **Samm 6: commit ja PR**

```bash
git add src/pages/admin/Collections.tsx src/components/CollectionEditor.tsx src/pages/Admin.tsx
git commit -m "feat(collections): kogude loend ja ligipääs adminile, seaded superadminile (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
git push -u origin feat/kogude-loend-adminile-2b
gh pr create --base main --title "Etapp 2B: kogude loend adminile (#318)" --body "..."
```

- [ ] **Samm 7: juurutus (ainult frontend)**

```bash
npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/
```

- [ ] **Samm 8: kontrolli tootmises**

- Admin näeb `/admin/collections`-i: loend ja ligipääsupaneel on olemas,
  kirjelduse/värvi/nähtavuse väljad ja kustutamine EI OLE.
- Superadmin näeb kõike nagu varem.
- **Admin ei saa seadeid muuta ka otse API kaudu** — server annab
  `require_role("superadmin")` tõttu 401. Peitmine ei ole autoriseerimine;
  kontrolli see eraldi üle, mitte ainult UI-st.
- Editor/contributor ei pääse `/admin/collections`-ile.

---

### Task 8: ADR ja registri staatus

- [ ] **Samm 1: eemalda üleminekumärkus**

ADR 0043 „Tagajärjed" all on märkus, mis ütleb, et etapid on tegemata:

> Kuni need etapid pole tehtud, ei kirjelda see ADR juba töötavat garantiid.
> Teostuse lõpus eemaldatakse see üleminekumärkus ning uuendatakse ADR-i ja
> README registri staatus koos; enne seda jääb märkus alles.

**Etapid 3 ja 4 on ikka tegemata**, seega ÄRA eemalda märkust veel —
kitsenda seda: nimeta, mis on tehtud (1a, 1b, 2) ja mis on lahti (3, 4).

- [ ] **Samm 2: commit**

```bash
git add docs/decisions/0043-kogude-oiguste-uhised-toimingud.md
git commit -m "docs(adr): 0043 etapid 1a/1b/2 tehtud, 3/4 lahtised (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

## Väljaspool etappi 2

- **3** — otsitav kasutajanimekiri (`q`, `role`, `rights_collection`,
  `rights_work_set` URL-is), `/admin/users/:username` detail kolme plokiga,
  `/admin/users/activity` (#318 viimane muudatus git-logist, TTL 300,
  threadpool). `Users.tsx` töökollektsioonide osa läheb siis koondsalvestusele.
- **4** — ühine „Kogud" sisenemiskoht, tüübifilter, vanade URL-ide suunamine.
- **Teadaolev kitsaskoht (1b-st):** töökollektsiooni halduri lugemisvaade
  näitab ainult kasutajanimesid. Lahendus on serveripoolne ja sobiks etappi 3.
