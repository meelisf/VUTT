# Kollektsiooni-põhine ligipääsukontroll — Disainispekk

**Kuupäev:** 2026-06-05
**Staatus:** Heaks kiidetud (v2 — pärast code review'd)

## Kontekst ja motivatsioon

VUTT on praegu avalik sirvimiseks — kõik teosed on kõigile nähtavad, muutmine nõuab sisselogimist. See on tahtlik disainiotsus ja jääb vaikekäitumiseks.

Vajadus on tekkinud kahest konkreetsest juhtumist:

1. **Herrnhuti arhiiv** — institutsioon lubab materjali kasutada, kuid nõuab et see ei oleks avalikult kättesaadav enne kokkulepitud aega.
2. **Doktorandid** — soovivad et nende transkribeerimistöö oleks nende kontrolli all ja teised kasutajad ei näeks seda enne kui töö on valmis.

**Skoopi kuulub:** lugemise nähtavuse kontroll (kes näeb teost).
**Skoopi ei kuulu:** kollektsiooni-põhised redigeerimisõigused (kes saab muuta) — see on eraldi etapp.

## Lahenduse ülevaade

Meilisearch'i **tenant tokenid** koos `is_public` väljaga Meilisearch'i dokumentides, millele lisandub backend'i **`can_read_work()` kontroll** kõigil lugemise endpoint'idel. Kõik teosed jäävad indekseerituks — piiratud teosed filtreeritakse tokeni tasemel ja backend'i tasemel iseseisvalt.

## Teadlikud kompromissid

**Piltide kaitse:** Pildiserver (8001) ei kontrolli autentimist. Kaitse tugineb nanoid-põhiste `work_id`-de äraarvamatusele — piiratud teos ei ole Meilisearch'ist leitav, seega puudub loomulik tee pildi URL-i teada saada. See on obfuscation, mitte päris access control. URL võib lekkida brauseri ajaloost, refereritest või jagatud lingist. Käesolev spekk aktsepteerib seda kompromissina — pildiserveri autentimine on eraldi tulevane etapp.

## Väljaspool skoopi (ei implementeerita praegu)

- Pildiserveri autentimine
- Ajalise piiramisega share-lingid
- Kollektsiooni-põhised redigeerimisõigused
- Kasutaja ise saab oma ligipääsu hallata (kutse-süsteem)

---

## Sektsioon 1: Andmemudel

### `data/config/collections.json` — uus `visibility` väli

```json
{
  "herrnhuter": {
    "name": { "et": "Herrnhuti arhiiv", "en": "Herrnhut Archive" },
    "color": "amber",
    "visibility": "restricted"
  },
  "academia-gustaviana": {
    "name": { "et": "Academia Gustaviana", "en": "Academia Gustaviana" },
    "color": "indigo",
    "visibility": "public"
  }
}
```

**Reeglid:**
- Lubatud väärtused: `"public"` | `"restricted"`
- Vaikimisi (väli puudub): `"public"` — tagasiühilduv
- Ainult admin saab muuta

### `state/users.json` — uus `allowed_collections` väli

```json
{
  "mari": {
    "name": "Mari Maasikas",
    "role": "contributor",
    "password_hash": "...",
    "allowed_collections": ["herrnhuter"]
  }
}
```

**Reeglid:**
- Vaikimisi: `[]` — näeb ainult avalikke teoseid
- Admin haldab kollektsiooni halduse kaudu (mitte kasutaja halduse kaudu)
- Admin näeb alati kõiki teoseid sõltumata `allowed_collections` väärtusest

### Meilisearch — kaks uut välja igal teosel

| Väli | Tüüp | Vaikimisi | Kirjeldus |
|------|------|-----------|-----------|
| `is_public` | `bool` | `true` | Tuletatud kollektsioonide `visibility`-st |
| `shareable` | `bool` | `false` | "Unlisted link" — otselingiga leitav, otsingusse ei tule |

**`is_public` tuletamise loogika — "public wins":**
- Teos pole üheski kollektsioonis → `true`
- Vähemalt üks kollektsioon on `"public"` → `true`
- Kõik kollektsioonid on `"restricted"` → `false`

Selgitus: privaatkollektsioon on kuratsioonivahend. Sinna saab lisada avalikke teoseid ilma et need kaotaksid oma nähtavuse. Teos muutub piiratuks ainult siis, kui ta on *ainult* piiratud kollektsioonides.

**`shareable` semantika:** teos on ligipääsetav otselingi kaudu, kuid **ei tule otsingusse** ega dashboard'ile. Backend kontrollib `shareable` lippu eraldi (vt Sektsioon 2). Meilisearch'i filter `shareable` välja **ei kasuta**.

Mõlemad lisatakse Meilisearch'i `filterableAttributes` nimekirja. `collections_hierarchy` on juba filterable (kasutatakse olemasolevates dashboard-filtrites).

---

## Sektsioon 2: Ligipääsukontrolli loogika

### Backend `can_read_work()` — kohustuslik kõigil lugemise endpoint'idel

Meilisearch'i tenant token kaitseb ainult otsingut. Otsene API päring work_id-ga läheb Meilisearch'ist mööda. Seega peab kõigil lugemise endpoint'idel olema eraldi kontroll:

```python
def can_read_work(work_metadata: dict, user: dict | None) -> bool:
    """Kontrollib kas kasutajal on õigus teost lugeda."""
    if work_metadata.get("is_public", True):
        return True
    if work_metadata.get("shareable", False):
        return True
    if user is None:
        return False
    if user.get("role") == "admin":
        return True
    allowed = set(user.get("allowed_collections", []))
    work_collections = set(work_metadata.get("collections_hierarchy", []))
    return bool(allowed & work_collections)
```

**`is_public` allikatõde:** `can_read_work()` arvutab `is_public` reaalajas `_metadata.json`-i `collections` välja ja `collections.json` `visibility`-te põhjal — ei tugine Meilisearch'i indekseeritud väärtusele. See tagab et backend'i kontroll on kohene, isegi kui Meilisearch'i indeks pole veel järgi jõudnud.

**Endpoint'id kus `can_read_work()` peab kehtima:**
- `GET /work/{work_id}` (metadata)
- `GET /work/{work_id}/pages`
- `GET /work/{work_id}/page/{n}` (lehekülje tekst)
- Workspace vaade
- Eksport

Kirjutamise endpoint'id (`/save`, `/work/{work_id}/metadata` PUT) on juba kaitstud `require_role("editor")` / `require_role("admin")` dekoraatoritega — need jäävad muutmata.

---

## Sektsioon 3: Meilisearch Token Arhitektuur

### Probleemi taust

Praegu on frontendis `VITE_MEILI_API_KEY` — search-only võti, mis on brauseri network tab-is nähtav ja filtreerib mitte midagi. See tuleb asendada tenant tokenitega.

### API võtmete struktuur backendis

Tenant tokeneid **ei genereerita master key'ga**. Kasutatakse eraldi search-only API võtit:

```
Meilisearch master key  →  hallatav ainult backend'is (docker env)
    ↓ loob
Search-only API key (scoped: teosed index, search route)
    → salvestatud backend'i env-is: MEILI_SEARCH_KEY + MEILI_SEARCH_KEY_UID
    → sellest genereeritakse tenant tokenid
    → VITE_MEILI_API_KEY eemaldatakse frontendist
```

Search-only parent key'l on sama indeksite/route'ide ligipääs mis tenant tokenil — token ei saa rohkem õigusi kui parent key.

### Tenant token filtrid

**Anonüümne token:**
```
Filter: is_public = true
```
Shareable teosed ei tule otsingusse — need on ligipääsetavad ainult otselingi + backend'i kaudu.

**Kasutajapõhine token:**

| Kasutaja | Token filter |
|----------|-------------|
| Sisselogimata | `is_public = true` |
| Kasutaja, `allowed_collections: []` | `is_public = true` |
| Kasutaja, `allowed_collections: ["herrnhuter"]` | `is_public = true OR collections_hierarchy IN ["herrnhuter"]` |
| Admin | Piiranguta |

```python
def generate_meili_token(user=None, ttl_seconds=3600):
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
    return meilisearch_client.generate_tenant_token(
        search_rules,
        api_key_uid=MEILI_SEARCH_KEY_UID,
        expires_at=expires_at
    )
```

**Token TTL — mõlemad 1 tund:**
- Anonüümne: 1h
- Kasutajapõhine: 1h (mitte 24h nagu sessioon)

Lühike TTL vähendab akent kui admin võtab kasutajalt kollektsiooni ligipääsu ära — vana token kehtib kuni 1h, mitte kuni 24h. Token refresh toimub nii anonüümsele kui kasutajale sama mehhanismiga (vt Sektsioon 4).

### Endpoint'id

```
GET /api/meili-token          # anonüümne, auth puudub, tagastab 1h token
POST /login vastus            # sisaldab meili_token välja (1h token)
POST /api/meili-token/refresh # autentitud, pikendab tokeni (sessiooni kehtivuse piires)
```

---

## Sektsioon 4: Frontendi Arhitektuurimuutus

### Praegune olukord

```typescript
// meiliService.ts — staatiliselt mooduli tasemel
const client = new MeiliSearch({ host: MEILI_HOST, apiKey: MEILI_API_KEY });
export const index = client.index(MEILI_INDEX);
```

`searchService.ts`, `pageService.ts`, `workService.ts` impordivad `index`-it staatiliselt.

### Uus: `MeilisearchContext` + dependency injection

React hook'i ei saa kutsuda service-failis (ainult komponentides või custom hook'ides). Lahendus: service funktsioonid saavad `index` argumendina.

```typescript
// src/contexts/MeilisearchContext.tsx
const MeilisearchContext = createContext<Index | null>(null);

export function MeilisearchProvider({ children }) {
  const [meiliIndex, setMeiliIndex] = useState<Index | null>(null);

  const loadToken = useCallback(async () => {
    const r = await fetch('/api/meili-token');
    const { token } = await r.json();
    setMeiliIndex(
      new MeiliSearch({ host: MEILI_HOST, apiKey: token }).index(MEILI_INDEX)
    );
  }, []);

  // Lae anonüümne token käivitamisel
  useEffect(() => { loadToken(); }, [loadToken]);

  // Refresh iga 55 minuti järel (token TTL = 1h)
  useEffect(() => {
    const id = setInterval(loadToken, 55 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadToken]);

  return (
    <MeilisearchContext.Provider value={meiliIndex}>
      {children}
    </MeilisearchContext.Provider>
  );
}

export const useMeiliIndex = () => useContext(MeilisearchContext);
```

**Sisselogimisel** (login vastuses on `meili_token` väli):
```typescript
// AuthContext-is — asendab anonüümse tokeni kasutajapõhisega
const client = new MeiliSearch({ host: MEILI_HOST, apiKey: meili_token });
setMeiliIndex(client.index(MEILI_INDEX));
// Seab ka uue 55min refresh interval'i kasutajapõhise token refresh endpoint'i vastu
```

**Väljalogimisel:** naaseb anonüümsele tokenile (uus fetch `/api/meili-token`).

### Service failide muutus — dependency injection

```typescript
// Enne (staatilise impordiga):
// searchService.ts
import { index } from './meiliService';
export async function searchWorks(query, filters) {
  return index.search(query, filters);
}

// Pärast (index argumendina):
export async function searchWorks(index: Index, query, filters) {
  return index.search(query, filters);
}

// Komponentides/hook'ides:
function SearchPage() {
  const index = useMeiliIndex();
  const results = await searchWorks(index, query, filters);
}
```

`searchService.ts`, `pageService.ts`, `workService.ts` — kõik funktsioonid saavad `index` esimese argumendina. Loogika ei muutu.

---

## Sektsioon 5: Admin UI

### 5a. Kollektsioonide haldus

```
[Herrnhuti arhiiv]
  Värv:      [amber ▾]
  Nähtavus:  ● Avalik  ○ Piiratud

  — Ligipääsuga kasutajad (nähtav ainult kui Piiratud) ——
  [Mari Maasikas ×]  [Jaan Tamm ×]
  [+ Lisa kasutaja ▾]

  [Salvesta]
```

Kasutajate haldus on **kollektsiooni juures** — admin valib kollektsioonile kasutajad, mitte vastupidi.

Kui `visibility` muutub `public → restricted`, käivitub backend'is Meilisearch'i massuuendus (`is_public = false` kõigil selle kollektsiooni teostel) ja **ootab task'i lõppu** enne vastuse saatmist. See välistab lekkeakna kus config on juba restricted aga indeks veel mitte.

### 5b. Kasutajate haldus (olemasolev leht)

Kasutaja real kuvatakse milliste piiratud kollektsioonidega on ligipääs — read-only viide, haldamine toimub kollektsiooni juures.

### 5c. Workspace — `shareable` toggle

Asub teose **halduse sektsioonis** (kus on muudatuste ajalugu, lehekülgede haldus). Nähtav editorile ja adminile.

```
— Jagamine ————————————————————————
○ Privaatne  ● Jagatav (otselingiga)
Link: https://vutt.ee/workspace/[work-id]  [Kopeeri]
————————————————————————————————————
```

`Jagatav` tähendab: teos on ligipääsetav otselingi kaudu (`can_read_work()` lubab `shareable=true`), kuid **ei tule dashboard'ile ega otsingusse** (Meilisearch'i filter seda ei kata).

---

## Sektsioon 6: Migratsioon ja Deploy

### Olemasolevad andmed

- Kõigile Meilisearch'i dokumentidele lisatakse `is_public: true`, `shareable: false`
- `collections.json` — puuduv `visibility` väli loetakse backendis kui `"public"`
- `users.json` — puuduv `allowed_collections` väli loetakse kui `[]`
- `is_public` ja `shareable` lisatakse `filterableAttributes` nimekirja

Toimub osana tavalisest `server_seed_data.sh` re-indekseerimisest.

### Deploy järjekord (kriitiline)

```
1. Backend deploy
   git pull && docker compose build --no-cache backend && docker compose up -d backend
   → /api/meili-token endpoint aktiivsed
   → login vastuses meili_token väli aktiivsed
   → can_read_work() kõigil lugemise endpoint'idel

2. Re-indekseerimine
   ./scripts/server_seed_data.sh
   → is_public: true, shareable: false kõigil teostel
   → filterableAttributes uuendatud

3. Frontend deploy
   npm run build && rsync -avz dist/ vutt:~/VUTT/dist/
   → VITE_MEILI_API_KEY eemaldatud
   → MeilisearchContext aktiivsed
```

---

## Ääreolukorrad

**Ligipääsu äravõtmine:** Kasutajapõhine token kehtib 1h. Kui admin eemaldab kasutaja `allowed_collections`-ist, saab kasutaja vana tokeniga veel kuni 1h piiratud teoseid otsida. Backend'i `can_read_work()` kontroll on kohene (lugeb users.json cache'ist), seega teose sisu ei ole ligipääsetav isegi kui otsing veel token'i kaudu tulemuse tagastab.

**Kollektsiooni kustutamine:** Backend eemaldab kustutatud kollektsiooni ID kõigi kasutajate `allowed_collections` nimekirjast automaatselt.

**`public → restricted` muutus:** Backend ootab Meilisearch'i update task'i lõppu enne vastuse saatmist. `can_read_work()` on kohene (config põhjal), seega backend endpoint'id on kaitstud kohe.

---

## Komponentide kokkuvõte

| Komponent | Muutus |
|-----------|--------|
| `data/config/collections.json` | Lisa `visibility` väli uutele piiratud kollektsioonidele |
| `state/users.json` | Backend lisab `allowed_collections: []` automaatselt uutele kasutajatele |
| `server/auth.py` | `get_all_users()` lisab `allowed_collections` välja |
| `server/utils.py` | Uus `can_read_work(work_metadata, user)` helper |
| `server/main.py` | `can_read_work()` kõigil lugemise endpoint'idel; `/api/meili-token` endpoint; login vastusesse `meili_token`; kollektsiooni `visibility` haldus + kasutajate haldus kollektsiooni kaudu; Meilisearch massuuendus visibility muutumisel (blocking); `shareable` toggle endpoint; `allowed_collections` cleanup kollektsiooni kustutamisel |
| `server/meilisearch_ops.py` | Lisa `is_public`, `shareable` indekseerimisse; `filterableAttributes` uuendus; `generate_meili_token()` funktsioon (search-only key + UID); massuuendus visibility muutumisel |
| `src/contexts/MeilisearchContext.tsx` | Uus context, 55min refresh interval |
| `src/services/meiliService.ts` | Eemalda staatiline `index` eksport |
| `src/services/searchService.ts` jt | `index` esimese argumendina (dependency injection) |
| `src/pages/Admin` | Kollektsiooni visibility toggle + kasutajate haldus kollektsiooni juures |
| `src/pages/Workspace` | `shareable` toggle halduse sektsioonis |
| `.env` / `.env.production` | Eemalda `VITE_MEILI_API_KEY`; lisa `MEILI_SEARCH_KEY`, `MEILI_SEARCH_KEY_UID` backend'i env-i |
