# Kollektsiooni-põhine ligipääsukontroll — Disainispekk

**Kuupäev:** 2026-06-05
**Staatus:** Heaks kiidetud, ootab implementatsiooni

## Kontekst ja motivatsioon

VUTT on praegu avalik sirvimiseks — kõik teosed on kõigile nähtavad, muutmine nõuab sisselogimist. See on tahtlik disainiotsus ja jääb vaikekäitumiseks.

Vajadus on tekkinud kahest konkreetsest juhtumist:

1. **Herrnhuti arhiiv** — institutsioon lubab materjali kasutada, kuid nõuab et see ei oleks avalikult kättesaadav enne kokkulepitud aega.
2. **Doktorandid** — soovivad et nende transkribeerimistöö oleks nende kontrolli all ja teised kasutajad ei segaks ega näeks seda enne kui töö on valmis.

## Lahenduse ülevaade

Meilisearch'i **tenant tokenid** koos `is_public` väljaga Meilisearch'i dokumentides. Kõik teosed jäävad indekseerituks — piiratud teosed filtreeritakse tokeni tasemel, mitte arhitektuuriliselt eraldatult. See võimaldab piiratud kollektsiooni ühe välja muutmisega koheselt avalikuks teha.

Piltide kaitseks piisab URL-i äraarvamatusest (nanoid-põhised `work_id`-d) — eraldi pildiserveri autentimist ei implementeerita, kuna piiratud teos ei ole Meilisearch'ist leitav ja seega puudub loomulik tee pildi URL-i teada saada.

## Väljaspool skoopi (ei implementeerita praegu)

- Ajalise piiramisega share-lingid
- Kollektsiooni-taseme redigeerimisõiguste eristus (vaata vs muuda grupisisesel tasemel)
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
- Vaikimisi (väli puudub): `"public"` — tagasiühilduv, kõik olemasolevad kollektsioonid jäävad avalikuks
- Ainult admin saab `visibility` muuta

### `state/users.json` — uus `allowed_collections` väli

```json
{
  "mari": {
    "name": "Mari Maasikas",
    "role": "contributor",
    "password_hash": "...",
    "allowed_collections": ["herrnhuter"]
  },
  "jaan": {
    "name": "Jaan Tamm",
    "role": "editor",
    "allowed_collections": []
  }
}
```

**Reeglid:**
- Vaikimisi: `[]` — kasutaja näeb ainult avalikke teoseid
- Admin haldab nimekirja kollektsiooni halduse kaudu (mitte kasutaja halduse kaudu)
- Admin näeb alati kõiki teoseid sõltumata `allowed_collections` väärtusest

### Meilisearch — kaks uut välja igal teosel

| Väli | Tüüp | Vaikimisi | Kirjeldus |
|------|------|-----------|-----------|
| `is_public` | `bool` | `true` | Tuletatud kollektsioonide `visibility`-st |
| `shareable` | `bool` | `false` | Admin/editor saab üksikul teosel sisse lülitada |

**`is_public` tuletamise loogika:**
- Teos pole üheski kollektsioonis → `true`
- Vähemalt üks kollektsioon on `"public"` → `true`
- Kõik kollektsioonid on `"restricted"` → `false`

Mõlemad lisatakse Meilisearch'i `filterableAttributes` nimekirja.

---

## Sektsioon 2: Meilisearch Token Arhitektuur

### Probleemi taust

Praegu on frontendis `VITE_MEILI_API_KEY` — search-only võti, mis on brauseri network tab-is nähtav ja filtreerib mitte midagi. Isegi otse `curl`-iga saab kõiki teoseid pärida. See tuleb asendada tenant tokenitega.

### Tenant token

Meilisearch'i tenant token on JWT, mille backend allkirjastab master-võtmega. Token sisaldab sisseehitatud filtrit mida kasutaja ei saa muuta.

**Anonüümne token** — avalik endpoint:
```
GET /api/meili-token
Auth: ei nõuta
Filter: is_public = true OR shareable = true
TTL: 1 tund
```

**Kasutajapõhine token** — genereeritakse sisselogimisel, lisatakse login-vastusesse:

| Kasutaja | Token filter |
|----------|-------------|
| Sisselogimata | `is_public = true OR shareable = true` |
| Kasutaja, `allowed_collections: []` | `is_public = true OR shareable = true` |
| Kasutaja, `allowed_collections: ["herrnhuter"]` | `is_public = true OR shareable = true OR collections_hierarchy IN ["herrnhuter"]` |
| Admin | Piiranguta (kõik teosed nähtavad) |

**Filtri genereerimine backendis:**
```python
def generate_meili_token(user=None):
    base_filter = "is_public = true OR shareable = true"
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
    ttl_seconds = 3600 if user is None else 86400  # 1h anonüümne, 24h kasutaja
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
    return meilisearch_client.generate_tenant_token(search_rules, expires_at=expires_at)
```

**Token TTL:**
- Anonüümne: 1 tund (frontend uuendab iga 55 minuti järel `setInterval`-iga)
- Kasutajapõhine: 24 tundi (ühtib sessiooni kestusega)

**`VITE_MEILI_API_KEY`** env muutuja eemaldatakse frontendi build'ist.

---

## Sektsioon 3: Frontendi Arhitektuurimuutus

### Praegune olukord

```typescript
// meiliService.ts — staatiliselt mooduli tasemel
const client = new MeiliSearch({ host: MEILI_HOST, apiKey: MEILI_API_KEY });
export const index = client.index(MEILI_INDEX);
```

`searchService.ts`, `pageService.ts`, `workService.ts` impordivad `index`-it staatiliselt.

### Uus: `MeilisearchContext`

```typescript
// src/contexts/MeilisearchContext.tsx
const MeilisearchContext = createContext<Index | null>(null);

export function MeilisearchProvider({ children }) {
  const [meiliIndex, setMeiliIndex] = useState<Index | null>(null);

  // Lae anonüümne token käivitamisel
  useEffect(() => {
    fetch('/api/meili-token')
      .then(r => r.json())
      .then(({ token }) =>
        setMeiliIndex(
          new MeiliSearch({ host: MEILI_HOST, apiKey: token }).index(MEILI_INDEX)
        )
      );
  }, []);

  return (
    <MeilisearchContext.Provider value={meiliIndex}>
      {children}
    </MeilisearchContext.Provider>
  );
}

export const useMeiliIndex = () => useContext(MeilisearchContext);
```

**Sisselogimisel** (login vastuses on `meili_token` väli):
- `AuthContext` uuendab `MeilisearchContext`-i kasutajapõhise tokeniga

**Väljalogimisel:**
- `MeilisearchContext` naaseb anonüümse tokeni juurde (uus fetch `/api/meili-token`)

**Token refresh (anonüümne):**
- `setInterval` iga 55 minuti järel — uus fetch `/api/meili-token`

**Teenuste muutus:**
- `searchService.ts`, `pageService.ts`, `workService.ts` kasutavad `useMeiliIndex()` hook-i staatilise impordi asemel
- Loogika ei muutu, ainult indeksi allikas muutub

---

## Sektsioon 4: Admin UI

### 4a. Kollektsioonide haldus

Olemasolevale kollektsiooni redigeerimise vaatele lisandub `visibility` toggle ja kasutajate haldus. Kasutajate haldus on **kollektsiooni juures** (mitte kasutaja profiili juures), et vältida ringi hüppamist.

```
[Herrnhuti arhiiv]
  Värv:      [amber ▾]
  Nähtavus:  ● Avalik  ○ Piiratud

  — Ligipääsuga kasutajad (nähtav ainult kui Piiratud) ——
  [Mari Maasikas ×]  [Jaan Tamm ×]
  [+ Lisa kasutaja ▾]

  [Salvesta]
```

Kui `visibility` muutub, käivitab backend taustülesande mis uuendab `is_public` kõigil selle kollektsiooni teostel Meilisearch'is.

### 4b. Kasutajate haldus (olemasolev leht)

Kasutaja real kuvatakse milliste piiratud kollektsioonidega on ligipääs — read-only, haldamine toimub kollektsiooni juures:

```
[Mari Maasikas]  contributor  [Muuda rolli ▾]
  Piiratud kollektsioonid: Herrnhuti arhiiv
```

### 4c. Workspace — `shareable` toggle

Asub teose **halduse sektsioonis** (kus on muudatuste ajalugu, lehekülgede haldus jms) — mitte infopaanelil. Nähtav ainult editorile ja adminile.

```
[Redigeeri]  [Haldus]  [Ajalugu]

— Jagamine ————————————————————————
○ Privaatne  ● Jagatav
Jagatav link: https://vutt.ee/workspace/[work-id]  [Kopeeri]
————————————————————————————————————
```

`Jagatav` tähendab: teos on leitav kõigile kellel on otsene link, isegi kui kollektsioon on `restricted`. Külastaja ilma sisselogimiseta näeb teost lugeda-ainult režiimis.

---

## Sektsioon 5: Migratsioon ja Deploy

### Olemasolevad andmed

Migratsioon on triviaalne — kõik praegused teosed on avalikud:

- Kõigile Meilisearch'i dokumentidele lisatakse `is_public: true`, `shareable: false`
- `collections.json` — puuduv `visibility` väli loetakse backendis kui `"public"` (ei nõua failimuutust)
- `users.json` — puuduv `allowed_collections` väli loetakse kui `[]` (ei nõua failimuutust)

Migratsioon toimub osana tavalisest `server_seed_data.sh` re-indekseerimisest.

### Deploy järjekord (kriitiline)

Backend peab olema üleval enne frontendit — muidu tekib hetk kus frontend otsib `/api/meili-token` endpoint'i mis pole veel olemas ja dashboard jääb tühjaks.

```
1. Backend deploy
   git pull && docker compose build --no-cache backend && docker compose up -d backend
   → /api/meili-token endpoint aktiivsed
   → login vastuses meili_token väli aktiivsed

2. Re-indekseerimine
   ./scripts/server_seed_data.sh
   → kõik teosed saavad is_public: true, shareable: false
   → is_public ja shareable filterableAttributes nimekirjas

3. Frontend deploy
   npm run build  (lokaalsel masinal)
   rsync -avz dist/ vutt:~/VUTT/dist/
   → VITE_MEILI_API_KEY eemaldatud
   → MeilisearchContext aktiivsed
```

---

## Ääreolukorrad

**Olemasolevad sessioonid kui visibility muutub:** Kasutajapõhised tokenid kehtivad 24h. Kui admin muudab kollektsiooni `public → restricted`, näevad olemasolevad aktiivsed sessioonid (kuni 24h) sisu endiselt. See on aktsepteeritav — admin saab vajadusel kasutajal sessiooni katkestada (token kustutada), aga tavakasutuses on see TTL piisavalt lühike.

**Kollektsiooni kustutamine:** Kui admin kustutab piiratud kollektsiooni, peab backend eemaldama selle ID kõigi kasutajate `allowed_collections` nimekirjast automaatselt.

---

## Komponentide kokkuvõte

| Komponent | Muutus |
|-----------|--------|
| `data/config/collections.json` | Lisa `visibility` väli uutele piiratud kollektsioonidele |
| `state/users.json` | Backend lisab `allowed_collections: []` automaatselt uutele kasutajatele |
| `server/auth.py` | `verify_user()` tagastab `allowed_collections`; `get_all_users()` lisab välja |
| `server/main.py` | Uus `GET /api/meili-token`; login vastusesse `meili_token`; kollektsiooni `visibility` haldus; kasutaja `allowed_collections` haldus kollektsiooni kaudu; teose `shareable` toggle endpoint |
| `server/meilisearch_ops.py` | Lisa `is_public`, `shareable` indekseerimisse; `filterableAttributes` uuendus; `is_public` massuuendus kollektsiooni visibility muutumisel |
| `src/contexts/MeilisearchContext.tsx` | Uus context (asendab staatilise `index` ekspordi) |
| `src/services/meiliService.ts` | Eemalda staatiline `index` eksport; `VITE_MEILI_API_KEY` ei kasutata |
| `src/services/searchService.ts` jt | Kasuta `useMeiliIndex()` hook-i |
| `src/pages/Admin` | Kollektsiooni visibility toggle + kasutajate haldus kollektsiooni juures |
| `src/pages/Workspace` | `shareable` toggle halduse sektsioonis |
| `.env` / `.env.production` | Eemalda `VITE_MEILI_API_KEY` |
