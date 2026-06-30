# Kasutaja piiratud kollektsioonide muutmine Users-lehel

**Kuupäev:** 2026-06-30
**Staatus:** kinnitatud (ootab implementatsiooniplaani)

## Eesmärk

Võimaldada kasutaja piiratud (restricted) kollektsioonide ligipääsu muuta otse tema
kaardilt lehel `/admin/users` — inline chips + dropdown. Olemasolev kollektsiooni-poolne
haldus (`CollectionEditor`, kus admin valib kollektsiooni juures lubatud kasutajad) jääb
muutmata. Mõlemad kirjutavad sama `users.json` välja `allowed_collections`, seega püsivad
nad automaatselt sünkroonis.

## Taust (olemasolev seis)

- **Salvestus:** `state/users.json` → iga kasutaja `allowed_collections: string[]`.
- **Kollektsiooni-poolne muutmine (olemas):** `src/components/CollectionEditor.tsx` →
  admin valib kollektsiooni, muudab selle `allowed_users` nimekirja. Backend
  `PUT /admin/collections/{id}` (server/routers/collections.py:153) lülitab `collection_id`
  sisse/välja iga kasutaja `allowed_collections`-ist ja invalideerib muutunud kasutajate
  sessioonid (collections.py:171).
- **Users-leht (praegu read-only):** `src/pages/admin/Users.tsx:410-423` kuvab
  `allowed_collections` hallide chip'idena (toore id, mitte nimi); muutmist pole.
- **Ligipääsuloogika:** `server/access_ops.py` `can_read_work` — admin möödub
  piirangutest; muidu nõutakse `allowed_collections ∩ work.collections` kattuvust.
  `allowed_collections` mõjutab seega ligipääsu **ainult restricted** kollektsioonide
  puhul (avalikud on niikuinii kõigile nähtavad).
- **Õiguste muster:** `server/auth.py` `can_manage_user(actor_role, target_role)` —
  kasutatakse `delete_user` ja `reset-password` juures; lubab puutuda ainult rangelt
  madalama tasemega kasutajat (sh blokeerib iseenda). Frontend vaste:
  `canManageUser` (`src/utils/roleUtils.ts`).

## Backend

### `server/auth.py` — uus helper

```python
def update_user_allowed_collections(username, collection_ids, admin_user) -> (bool, str)
```

Loogika:
1. Kasutaja peab eksisteerima (`load_users`), muidu `(False, "Kasutajat ei leitud")`.
2. Õigus: `can_manage_user(admin_user["role"], target_role)` — vastasel juhul
   `(False, "Pole õigust selle kasutaja kollektsioone muuta")`. See blokeerib võrdse/
   kõrgema taseme ja iseenda (admini enda piiramine oleks niikuinii mõttetu, sest admin
   möödub piirangutest).
3. **Sanitiseerimine:** loe kollektsioonide konfiguratsioon (`get_cached_collections`);
   jäta alles ainult id-d, mis (a) eksisteerivad konfis JA (b) on
   `visibility == "restricted"`. Tundmatud / avalikud id-d visatakse vaikselt minema.
   Salvesta dedupe'itud nimekiri.
4. `users[username]["allowed_collections"] = sanitized` → `save_users(users)`.
5. `delete_user_sessions(username)` — uus ligipääs jõustub kohe (peegeldab kollektsiooni-
   poolset käitumist). Reset-tokeneid EI tühistata (kollektsiooni-ligipääs ei muuda rolli/
   privileegi-invarianti).
6. `(True, "Kollektsioonid uuendatud")`.

### `server/routers/admin.py` — uus endpoint

```python
@router.post("/admin/users/update-collections")
async def admin_update_collections(request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    success, message = update_user_allowed_collections(
        data.get("username"), data.get("allowed_collections") or [], user)
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return {"status": "success"}
```

Sama muster nagu `admin_update_role` (admin.py:65).

## Frontend — `src/pages/admin/Users.tsx`

- Restricted-kollektsioonide nimekiri tuleb `useCollection()` kontekstist
  (`collections` map) → filtreeri `visibility === 'restricted'`, sordi nime järgi;
  kuva `{ id, name }` (kasuta `et`-nime, fallback id).
- Asenda read-only "Piiratud kogud" plokk (rida 410-423):
  - Kui admin `canManage(u)` → eemaldatavad chip'id (× nupp) + "lisa kogu" `<select>`,
    mis loetleb restricted-kogud, mida kasutajal veel pole. Iga lisamine/eemaldamine
    salvestab kohe (`POST /admin/users/update-collections` uue täisnimekirjaga) ja
    uuendab lokaalset `users` state'i. Per-kasutaja salvestamis-spinner
    (eraldi `collectionsUpdating` state või taaskasuta `roleUpdating`).
  - Kui mitte-hallatav kasutaja / iseennast → jää read-only chip'ideks.
  - Chip kuvab **lahendatud kollektsiooni nime** (mitte toort id-d), id fallback.
  - Kui restricted-kogusid pole üldse → peida dropdown, kuva "—".
- Veakäsitlus: ebaõnnestumisel `setUsersError` (sama muster nagu rolli muutus).

## i18n — `src/locales/{et,en}/admin.json`

- Tõsta hardcoded "Piiratud kogud" → võti (nt `users.restrictedCollections`).
- Lisa `users.addCollection` ("lisa kogu" / "add collection"),
  `users.removeCollection` (× tooltip).
- Mõlemad `et` ja `en`.

## Testimine

- **pytest** (`update_user_allowed_collections`):
  - õigus keelatud võrdse/kõrgema rolli korral (sh iseenda);
  - sanitiseerimine: tundmatu id ja avaliku kollektsiooni id visatakse minema, jääb
    ainult restricted;
  - edukal teel `save_users` kutsutud + `delete_user_sessions` kutsutud.
- **Frontend:** `npm run typecheck`.

## Ulatusest väljas (YAGNI)

- `CollectionEditor` kollektsiooni-poolne voog jääb puutumata (puhtalt lisanduv muudatus).
- Pole bulk-määramist mitmele kasutajale korraga.
- Pole "kõik kogud" valikut — ainult restricted (avalikud ei mõjuta ligipääsu).
