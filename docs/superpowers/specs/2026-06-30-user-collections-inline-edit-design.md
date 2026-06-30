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
def update_user_allowed_collections(username, collection_ids, admin_user) -> (bool, str, list[str])
```

Tagastab kolmiku `(success, message, allowed_collections)`, kus kolmas element on serveris
salvestatud (sanitiseeritud) nimekiri — **see on tõe allikas**, mille frontend lokaalsesse
state'i kirjutab (mitte enda saadetud nimekirja). Vea korral tagastab `(False, msg, [])`.

**Import (väldi ringimporti):** `get_cached_collections` elab `server/cache.py`-s, mis EI
impordi `auth.py`-d ega ühtegi routerit. Seega `auth.py` tohib teha
`from .cache import get_cached_collections` — ringimporti EI teki. `auth.py` ei tohi
importida `server/routers/collections.py`-d.

Loogika:
1. **Sisendi valideerimine** (helperis, et endpoint ja testid jagaksid sama kaitset):
   - `username` peab olema mittetühi string, muidu `(False, "Kasutajanimi puudub", [])`.
   - `collection_ids` peab olema **list**, muidu `(False, "Vigane kollektsioonide nimekiri", [])`.
     (Stringi itereerimise vältimiseks — `"abc"` ei tohi muutuda `["a","b","c"]`-ks.)
2. Kasutaja peab eksisteerima (`load_users`), muidu `(False, "Kasutajat ei leitud", [])`.
3. Õigus: AINULT keskne `can_manage_user(admin_user["role"], target_role)` — mitte lokaalne
   admin/editor/contributor-võrdlus (väldib privilege-level drifti). See invariant on sama,
   mida kasutavad rolli muutmine, kustutamine ja parooli reset; superadmin on juba
   `ROLE_HIERARCHY`-s (4 taset) integreeritud. Keelu korral
   `(False, "Pole õigust selle kasutaja kollektsioone muuta", [])`. Blokeerib võrdse/
   kõrgema taseme ja iseenda (admini enda piiramine oleks niikuinii mõttetu, sest admin
   möödub piirangutest).
4. **Sanitiseerimine + deterministlik järjekord:** loe konfiguratsioon
   (`get_cached_collections`). Võta sisendist ainult **string**-id-d hulgaks
   (`submitted = {c for c in collection_ids if isinstance(c, str)}`). Tulemus järjestatakse
   **konfiguratsiooni restricted-kollektsioonide järjekorra järgi**, mitte kliendi sisendi
   järgi — see annab stabiilse, deterministliku diffi ja puhtad testid:
   ```python
   restricted_ordered = [cid for cid, c in collections_config.items()
                         if c.get("visibility") == "restricted"]
   sanitized = [cid for cid in restricted_ordered if cid in submitted]
   ```
   Tundmatud / avalikud / mitte-string id-d kukuvad vaikselt välja. Dedupe on hulga ja
   ühekordse läbikäigu tõttu automaatne. **Invariant:** muutmisel normaliseeritakse
   kasutaja `allowed_collections` alati ainult olemasolevatele restricted-kollektsioonidele
   (ka ajalooliselt sattunud avalikud/tundmatud id-d puhastatakse selle kasutaja juures).
5. **No-op kaitse:** `old = users[username].get("allowed_collections", [])`. Kui
   `old == sanitized` → tagasta `(True, "Kollektsioonid uuendatud", sanitized)` **ilma**
   `save_users` ja `delete_user_sessions` kutsumiseta (ära katkesta kasutaja sessiooni
   asjatult).
6. Muudatuse korral: `users[username]["allowed_collections"] = sanitized` →
   `save_users(users)` → `delete_user_sessions(username)` (uus ligipääs jõustub kohe,
   peegeldab kollektsiooni-poolset käitumist). Reset-tokeneid EI tühistata
   (kollektsiooni-ligipääs ei muuda rolli/privileegi-invarianti).
7. `(True, "Kollektsioonid uuendatud", sanitized)`.

### `server/routers/admin.py` — uus endpoint

```python
@router.post("/admin/users/update-collections")
async def admin_update_collections(request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    success, message, allowed = update_user_allowed_collections(
        data.get("username"), data.get("allowed_collections", []), user)
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return {"status": "success", "allowed_collections": allowed}
```

Sama muster nagu `admin_update_role` (admin.py:65), aga vastus sisaldab serveris salvestatud
nimekirja. NB: anna `data.get("allowed_collections", [])` (mitte `... or []`) edasi
muutmatult — tüübikontroll on helperis, et see kehtiks ka otsestes ühikutestides.

## Frontend — `src/pages/admin/Users.tsx`

- Restricted-kollektsioonide nimekiri tuleb `useCollection()` kontekstist
  (`collections` map) → filtreeri `visibility === 'restricted'`, sordi nime järgi;
  kuva `{ id, name }` (kasuta `et`-nime, fallback id).
- Asenda read-only "Piiratud kogud" plokk (rida 410-423):
  - Kui admin `canManage(u)` → eemaldatavad chip'id (× nupp) + "lisa kogu" `<select>`,
    mis loetleb restricted-kogud, mida kasutajal veel pole. Iga lisamine/eemaldamine
    saadab kohe `POST /admin/users/update-collections` uue täisnimekirjaga ja kirjutab
    lokaalsesse `users` state'i **serveri vastuse `allowed_collections`** (mitte
    optimistlikult enda saadetud `nextAllowedCollections` — server sanitiseerib ja on tõe
    allikas). Per-kasutaja salvestamis-spinner (eraldi `collectionsUpdating` state või
    taaskasuta `roleUpdating`).
  - Kui mitte-hallatav kasutaja / iseennast → jää read-only chip'ideks.
  - Chip kuvab **lahendatud kollektsiooni nime** (mitte toort id-d), id fallback.
- **Tühja seisu eristus** (kaks erinevat olukorda):
  1. Süsteemis pole ühtegi restricted-kogu → chip'id "—", `<select>` puudub.
  2. Süsteemis on restricted-kogusid, aga kasutajale pole määratud → chip'id "—",
     `<select>` nähtav (on veel lisada).
  - `<select>` on nähtav ainult kui `availableRestrictedCollections.length > 0`
    (= restricted-kogud, mida kasutajal veel pole). Kui kõik on juba lisatud → `<select>`
    puudub (või disabled).
- Veakäsitlus: ebaõnnestumisel `setUsersError` (võti `users.collectionsUpdateFailed`).

## i18n — `src/locales/{et,en}/admin.json`

Lisa `users`-blokki:
- `restrictedCollections` — "Piiratud kogud" / "Restricted collections" (asendab
  hardcoded stringi).
- `addCollection` — "lisa kogu" / "add collection" (select placeholder).
- `removeCollection` — "Eemalda {{name}}" / "Remove {{name}}" (chip × tooltip, sisaldab
  nime ligipääsetavuse jaoks).
- `noRestrictedCollections` — "Piiratud kogusid pole" / "No restricted collections".
- `collectionsUpdateFailed` — "Kollektsioonide uuendamine ebaõnnestus" /
  "Failed to update collections".
- Mõlemad `et` ja `en`.

## Testimine

- **pytest** (`update_user_allowed_collections`):
  - õigus keelatud võrdse/kõrgema rolli korral (sh iseenda);
  - sisendi tüübikontroll: mitte-list (nt string) → `(False, "Vigane...", [])`;
  - sanitiseerimine: tundmatu id ja avaliku kollektsiooni id visatakse minema, jääb
    ainult restricted; tagastatav nimekiri = salvestatud nimekiri;
  - **dedupe + järjekord:** sisend `["b", "a", "b"]` → väljund konfiguratsiooni
    restricted-järjekorras (deterministlik), ühekordsed;
  - **no-op:** kui sanitiseeritud nimekiri == praegune, siis `save_users` JA
    `delete_user_sessions` EI käivitu (mock/spy);
  - muudatuse korral: `save_users` kutsutud + `delete_user_sessions` kutsutud.
- **Frontend:** `npm run typecheck` (miinimum). RTL/Vitest komponenditest valikuline, mitte
  kohustuslik.

## Ulatusest väljas (YAGNI)

- `CollectionEditor` kollektsiooni-poolne voog jääb puutumata (puhtalt lisanduv muudatus).
- Pole bulk-määramist mitmele kasutajale korraga.
- Pole "kõik kogud" valikut — ainult restricted (avalikud ei mõjuta ligipääsu).
