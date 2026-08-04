# CLAUDE.md

Varauusaegsete tekstide transkriptsioonitöölaud (vutt.utlib.ut.ee).
Frontend: React 19 + TypeScript + Tailwind + Vite. Backend: FastAPI + Meilisearch.
UI eesti + inglise keeles. **Koodikommentaarid eesti keeles.**

## Töökord

- **Skoop:** tee see, mida küsiti, küsitud ulatuses. Rutiinsed otsused langeta ise; küsi ainult siis, kui erinevad tõlgendused annaksid sisuliselt erineva töö. Kui ülesanne tundub vale või on parem tee, ütle seda ühe lausega ja tee siis küsitu — ära vaikselt kitsenda, laienda ega asenda.
- **Vastus:** alusta tulemusest, siis detailid. Vahepealne uudis siis, kui leiad midagi olulist või muudad suunda.
- **Enne muutmist loe `docs/decisions/`** (ADR-register). Seal on invariandid, mille rikkumine on varem rikke põhjustanud. Uus arhitektuuriotsus → uus ADR-fail, mitte ainult vestlus. Ülejäänud dokumentide kaart: `docs/README.md` (elav) vs `docs/_archive/` (ajalugu, ei pruugi kehtida).
- **Kui sama käsk ebaõnnestub kaks korda samamoodi**, peatu ja ütle, mis blokeerib. Ära proovi variatsioone edasi.
- **Subagendid:** ainult suurele, tõeliselt sõltumatule tööle (nt lai mitmefaililine otsing). Mitte oma töö ülekontrollimiseks ega tööks, mille teed ise mõne tööriistakutsega ära.
- **Andmed elavad serveril.** Lokaalne `data/` ja `state/` EI peegelda tootmist — ära tee järeldusi nende sisu põhjal (vt [Andmeasukohad](#andmeasukohad)).
- **Suuremad featuurid** planeeritakse GitHub Issues kaudu (`gh issue list`, `gh issue create`).

## Käsud

**Arendus toimub LOKAALSELT. Server on eraldi masin (`ssh vutt`).** Lokaalsed käsud ei tööta serveris ja vastupidi.

```bash
npm install && npm run dev    # localhost:5173
npm run build                 # → dist/ + eelkompressioon (.br/.gz)
```

Väravad (samad jooksevad CI-s, `.github/workflows/ci.yml`):

| Käsk | Märkus |
|------|--------|
| `npm run typecheck` | Vite EI typecheck'i — `build` üksi ei püüa tüübivigu |
| `npm test` | vitest |
| `npm run lint:ci` | ESLint (ainult `react-hooks`, teadlikult kitsas), lävi `--max-warnings 55` — parandades LANGETA arvu |
| `.venv/bin/pytest tests/` | Kasuta ALATI projekti venv-i (`.venv/bin/python`), süsteemi `python3`-l puuduvad sõltuvused |

CI käivitub ainult main'i-PR-idel: virnastatud PR checke ei saa (baasi ümbersuunamine EI käivita, close+reopen käivitab). Merge-stiil = merge-commit.

### Deploy

```bash
# Backend (Python) — serveris
ssh vutt && cd ~/VUTT
./scripts/server_update.sh --no-cache   # git pull + docker build + restart; --no-cache on Python-muudatusel kohustuslik
./scripts/server_seed_data.sh           # Meilisearch reindeks (kui andmed/skeem muutusid)
docker logs vutt-backend                # backend jookseb Dockeris (vutt-backend)

# Frontend — lokaalses masinas
npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/
```

`--delete` on tahtlik: ilma selleta kogunevad vanad hashitud chunk-failid.
`.br`/`.gz` failid PEAVAD rsync'iga kaasa minema — nginx serveerib need
`brotli_static`/`gzip_static` kaudu, muidu vaikne ~15% kaotus.

### nginx

Aktiivne config on **hostis** (`/etc/nginx/sites-available/vutt`), mitte gitis ega Dockeris; repos on koopia `nginx.host.conf`. **Muutmisel uuenda MÕLEMAT:**

```bash
scp nginx.host.conf vutt:/tmp/vutt.nginx.new
ssh vutt 'sudo cp /tmp/vutt.nginx.new /etc/nginx/sites-available/vutt && sudo nginx -t && sudo systemctl reload nginx'
```

Eeldused hostis (ei ole `nginx.host.conf`-is): rate-limit tsoonid `nginx.conf` http{} blokis
(`vutt_auth` 1r/s, `vutt_api` 10r/s, `vutt_meili` 20r/s, `vutt_images` 60r/s) ja brotli moodulid.

**`/api/files/` proksib KÕIK backend-teed avalikult** — sisemist infot lekitav endpoint pane
`/admin/` alla JA lisa `require_role("admin")`.

## Arhitektuur

```
Frontend (Vite/React 19)
├── Meilisearch (7700) — otsing + metaandmed (indeks: teosed)
├── Image Server (8001) — skaneeringud .jpg
└── File Server (8002) — FastAPI: toimetamine, auth, git, prosopograafia
    ↓
Failisüsteem: data/{kaust}/{lehekülg}.txt + .jpg + .json + _metadata.json
```

Backend-pordid (7700, 8001, 8002) ei ole väljapoole avatud. HTTPS + HSTS, CSP nginx-is
(**kahel real — muuda mõlemat**). Meilisearch: frontend kasutab search-only võtit.

**Võtme-ID-d:** `work_id` (nanoid) — marsruutimine, filtrid, API. `slug` (kaustanimi) — ainult failisüsteemis.

### Andmeasukohad

Kaks eraldi kausta serveril, mõlemad Dockerisse mountitud. Teed tulevad `server/config.py`-st:

| Kaust (host) | Docker | Sisu | Git |
|---|---|---|---|
| `~/VUTT/data/` | `/data` | Teosed + leheküljed; `data/config/` konfiguratsioon | jah (`data/` oma sisemine git) |
| `~/VUTT/state/` | `/app/state` | Runtime: `users.json`, sessioonid, tokenid, `reocr_log.json`, `user_settings/`, `notifications/`, `prosopography/images/` | ei |

`data/config/` sisu: `collections.json`, `vocabularies.json`, `places.json`, `origin_groups.json`,
`labels.json` (Q-kood → label), `person_aliases.json`, `archives.json`, **`prosopography/{nanoid}.json`**
(~2200 isikukaarti; **kaardid ise on siin, ainult pildid on `state/`-is**) ning tuletatud indeksid
`prosopography_index.json`, `person_to_works.json`, `works_creators_index.json`, `work_collections_index.json`.

Tuletatud indeksid on read-modelid — nullist taastatavad (`rebuild_indices()` jookseb serveri
stardil taustalõimes), vt ADR 0007. Skriptides:

```python
from server.config import DATA_CONFIG_DIR, STATE_DIR   # ← ainuõige allikas
# MITTE: os.path.join(os.path.dirname(__file__), "../state")
```

Faili serverist alla tõmbamiseks: `scp vutt:~/VUTT/data/config/collections.json ./`

## Koodi paigutus

### Backend (`server/`)

`main.py` on ~140 rida: lifespan (taustalõimed, indeksid, keep-warm) + routerite ühendamine.
**Endpointid elavad routerites** — uus endpoint lisa õigesse routerisse, mitte `main.py`-sse.

| Asukoht | Sisu |
|---|---|
| `routers/` | `auth`, `admin`, `pages`, `editing`, `public`, `public_registries`, `collections`, `notifications`, `upload`, `reocr`, `ocr_jobs`, `user_settings` |
| `prosopography/` | Oma alampakett + `router.py`: `person_crud`, `person_search`, `merge_ops`, `relations`, `reciprocal_ops`, `work_relations_ops`, `indices`, `places_ops`, `enrichment`, `git_history`, `locks` |
| `config.py` | Kõik teed, pordid, rate-limitid, CORS, saladuste stardikontroll |
| `deps.py` | `get_user`, `require_role`, `get_json_data` — üks tõene allikas |
| `metadata_ops.py` | `save_work_metadata()` — **KÕIK `_metadata.json` uuendused** käivad siit (`sync_meili`, `call_ptw`, `background_tasks`) |
| `meili_doc.py` | Puhas `_metadata.json` → Meili-dokument kaardistus (side-effect-vaba) |
| `meilisearch_ops.py` | Meili sünk, ThreadPoolExecutor, keep-warm |
| `git_ops.py`, `auth.py`, `cache.py`, `rate_limit.py` | Versioonihaldus, autentimine, cache (TTL 5 min), rate-limit |
| `upload/`, `upload_ops.py` | Upload-viisard + OCR-serveri integratsioon |
| `marginalia_normalize.py` | `normalize_marginalia_tags()` — kutsutakse KÕIGIS kirjutusteedes |

**Python 3.9 ühilduvus:** `Optional[dict]`, mitte `dict | None`.
Blokeeriv I/O `async def` sees on keelatud (ADR 0002) — kas sync `def` route või `run_in_threadpool`.
Funktsiooni eemaldamisel kontrolli ka `server/__init__.py` re-eksporte.

### Frontend (`src/`)

| Asukoht | Sisu |
|---|---|
| `pages/` | Dashboard, Workspace, SearchPage, Statistics, Review, Admin, WorkManage, Settings, Notifications + alamkaustad `admin/`, `manage/`, `search/`, `upload/` |
| `prosopography/` | Oma alampuu: `pages/` (PersonsPage + detail/edit), `components/` (PersonCard, personForm, PersonsMap — kaardivaade on PersonsPage'i sees, laisalt laetud), `services/`, `utils/` |
| `components/editor/` | TextEditor'i osad: CodeMirror-laiendid (`VuttMarkupExtension`, `MarginaliaExtension`), paneelid, hookid (`useEditorState`, `useEditorSave`) |
| `services/meiliService.ts` | Kõik Meilisearch-operatsioonid (`normalizeWork()` mapib legacy väljanimed) |
| `contexts/` | `UserContext`, `CollectionContext`, `MeilisearchContext` |
| `components/` | `EntityPicker` (Wikidata), `MarkdownEditor`/`MarkdownView`, `UnsavedChangesDialog`, `Pagination`, `PageImageEditorModal` |

## Invariandid

Iga rida siin on midagi, mis on varem katki läinud. Detailid: `docs/decisions/`.

**i18n (ADR 0011)** — `fallbackLng` on VÄLJAS: uus võti tuleb lisada **mõlemasse keelde korraga**,
muidu katkeb build. Kaks valvurit: `localeParity.test.ts` (et/en võtmestik identne) ja
`translationKeysResolve.test.ts`. Uus nimeruum → `src/locales/namespaces.ts` (MITTE `i18n.ts`,
selle import käivitab init'i). Keeletuvastus käib enne init'i `utils/detectLanguage.ts`-is.

```tsx
const { t } = useTranslation(['workspace', 'common']);
t('tabs.edit'); t('common:status.Valmis');
```

**Meilisearch (ADR 0006)** — indeks kasutab eestikeelseid legacy-väljanimesid (`pealkiri`,
`aasta`, `lehekylje_tekst`, `genre_et`, `type_ids`…). Ümbernimetamine nõuab täisreindeksit +
kõigi filtrite muutmist → eraldi projekt, mitte möödaminnes. **Uus indekseeritav väli läheb
AINULT `meili_doc.py`-sse** — mõlemad teed (live `meilisearch_ops.py` + seed
`scripts/1-1_consolidate_data.py`) impordivad sealt. `attributesToSearchOn` väli PEAB
dokumendis eksisteerima. `*_object` väljad on ainult Meili dokumentides; `work_id` peab olema KÕIGIS.

Kaks tekstivälja: `lehekylje_tekst` (**otsinguks puhastatud** — reavahetuse sidekriipsud liidetud,
markup eemaldatud) vs `text_content` (**toores, redaktorile** — kõik märgendid alles, otsitav ei ole).

**Salvestus (ADR 0012)** — muutusteta salvestus on no-op: ei kirjuta, ei commiti, ei indekseeri.
`save_work_metadata` tagastab `(meta, changed)`. Salvestamine EI paranda enam Meili lahknevust —
selleks on reindeks. Meili sünk koondatakse teose kaupa, dirty-lipp elab vea üle (ADR 0013).

**Marginaalia (ADR 0003, 0009)** — iga sisuline füüsiline marginaaliarida on eraldi `<m>…</m>`
plokk; `<m>` on VÄLIMINE täg ega sisalda reavahetust. Järjestikused plokid koondatakse üheks
kaardiks ainult renderduses (`groupMarginaliaBlocks`). Normaliseerimine toimub **ainult
salvestamisel** (`normalize_marginalia_tags` — `<m>` väliseks + `strip_empty_tags`), MITTE elavalt
iga klahvivajutuse peal. Kopeeritud marginaalia-sisu on alati **plain**; vormingu määrab sihtkoht.

**CodeMirror `VuttMarkupExtension`** — paaristägid (`<i> <b> <cs> <m> <hi> <ann>`) on
**mark-dekoratsioon + `atomicRanges`**, MITTE `Decoration.replace` (replace murdis plain-kursori
nooleliikumise, kuigi Shift+Nool töötas). Replace/widget on ainult `<pb/>` ja `<fn>…</fn>` jaoks.
`RangeSetBuilder.add()` nõuab `from ASC`, sama `from` korral `to ASC` (**mitte DESC**).
Replace-dekoratsioonid EI TOHI kattuda (`isReplace && r.from < lastReplaceEnd`); mark-dekoratsioonid
VÕIVAD — ära blokeeri neid `lastReplaceEnd`-iga. Naaber-atomic-vahemikke EI ühendata (kursor jäi
ühendatud vahemikku kinni). Orvud tägid koristab `vuttAutoSanitizer` (updateListener) — ainult
pärast userEvent-tehingut, `SANITIZE`-annotatsioon väldib rekursiooni.

Kustutamise eest kaitseb `marginaliaProtectionFilter` (`MarginaliaExtension.ts`): peidetud plokid
lõigatakse kasutaja muudatusest välja. See peab jääma `marginaliaExtension()` listis **viimaseks**
ja tegutseb ainult `Transaction.userEvent`-tehingutel; ümberkirjutatud tehing peab `effects`-id
kaasa võtma. `wrapWithTag` ja annotatsioonitegevused kasutavad `userEvent.of('input.format')` —
filtrid peavad selle läbi laskma.

**Lehe vahetus (ADR 0010)** — lehepööre sama teose sees EI monteeri CodeMirrorit maha.
Programmaatiline dokumendi asendus peab kandma `pageSwapAnnotation`-it (`editorAnnotations.ts`),
ja see **EI TOHI olla `Transaction.userEvent`** (muidu hakkavad sanitiseerijad kettalt laetud
teksti muutma). Komponendisisene olek, mis varem lähtestus remountiga (`isDirty`, `saveError`,
kerimispositsioon), tuleb lehevahetuse effectis **selgesõnaliselt** lähtestada. Üldisemalt:
remount on vaikiv olekulähtestaja — early-returni eemaldamisel auditeeri kogu komponendi olek.

**Markdown (ADR 0008)** — vabateksti väljad (Märkmed, Elulugu) kasutavad `MarkdownEditor` +
`MarkdownView`. **Ei mingit `rehype-raw`-i**, toores HTML escape'itakse; renderduv DOM on
allow-list (`p, strong, em, del, a, ul, ol, li, h1-h3, blockquote, code, br`), `urlTransform`
blokeerib `javascript:`. GFM on sees AINULT autolinkimiseks. See on eraldi süsteem
transkriptsiooni XML-märgendusest.

**Frontend, muu** — number-sisenditel `type="text" + inputMode="numeric"` (mitte `type="number"`,
tühjendamine katki). Salvestamata muudatuste jaoks on ÜKS dialoog (`UnsavedChangesDialog` +
`useUnsavedChangesGuard`) — ära lisa uut confirm-varianti. Kerib AKEN, mitte konteiner (v.a
Workspace). `LoginModal` `isOpen` EI TOHI olla seotud `sessionExpired`-iga.

## Domeen

**Linked data** — kõik metaandmeväljad toetavad `LinkedEntity`-objekte:
`{ label, id, labels: {et, en}, source }`. Toetatud: `genre`, `type`, `location`, `publisher`,
`tags`, `creators[]`. Allikad: Wikidata (`Q12345`), VIAF (`viaf:12345`), Album Academicum (`AA:123`).
Label-resolutsioon `et→en→la→de`, register `data/config/labels.json`, abiline `useEntityLabel`.
Prosopograafia massiiviväljad (`statuses[]`, `confessions[]`) kannavad inline `labels{et,en}`.

**Kollektsioonid** — hierarhilised, `data/config/collections.json`; olek `CollectionContext`.
Värvid on Tailwindi värvinimed (vaikimisi `indigo`):

```tsx
const { bg, text, border, hoverBg } = getCollectionColorClasses(collection);
```

**Isikute nimevariandid** — *Lorenz Luden* vs *Laurentius Ludenius*: admin salvestab Wikidata/GND
ID, `people_ops.py` tõmbab taustal aliased (`et, en, de, la`) → `person_aliases.json` →
`authors_text` Meilis. Otsing leiab kõik variandid, kuvatakse kanooniline nimi.

**`person_to_works.json` — kaks kirjutajat:** metaandmete rollid (autor jne) JA lehe-tägide
`mentioned`. **Kumbki ei tohi teise kirjeid pühkida.**

**Autentimine** — rollid `contributor` < `editor` < `admin` < `superadmin`. Kontroll ALATI
`is_at_least()` / `isAtLeast()`, **mitte** `role == "admin"`. Token UUID, 24h;
localStorage `vutt_user`, `vutt_token`. `contributor` muudatused lähevad ülevaatusele.
Login: kahekihiline rate-limit (nginx 1r/s + app 5/60s) + konto-lockout.

**Git-versioonihaldus** — iga salvestus commitib `.txt` + `.json`; esimene commit = originaal-OCR
(alati taastatav). Sama kehtib prosopograafia kaartidele (`save_with_git`). Admin taastab
Workspace'i „Ajalugu" tabist. **Kommentaaride taaste = ÜKS git-commit** (`onCommentsRestored`).

**Upload (admin, `/upload`)** — kolmeastmeline viisard: metaandmed → fail → ülevaatus.
Failitüüp tuvastatakse magic byte'idest (mitte laiendist). PDF → `pdfinfo` → SFTP → OCR-server
lõhub lehekülgedeks; JPG/PNG → SFTP otse. Import: SFTP alla → `_metadata.json` + lehe-JSON-id →
git commit → **sünkroonne** Meili sünk → navigeerimine teosele. Staging `uploads/{upload_id}/`
säilib üle seansi. Kausta nimi = `{slug}-{work_id}`.

**Uue metaandmevälja lisamine:** `types.ts` → `meiliService.ts` (`attributesToRetrieve`) →
`meili_doc.py` (kui indekseeritav) → komponent.

## Jõudlus

Sihtkoormus ~300 samaaegset kasutajat. Peamised valikud:

- **Async Meili sünk** — `/save` ei oota indekseerimist; `ThreadPoolExecutor` (`MEILISEARCH_POOL_SIZE = 10`).
- **Keep-warm** (`MEILI_KEEPWARM_INTERVAL = 7200`) — väldib ~60s cold-startit; põhjus:
  `prefixSearch: "indexingTime"` skannib igal updateil kogu FST-i. `prefixSearch: "disabled"`
  EI SOBI — „risin" ei leiaks „Risingh" (ADR 0005).
- **Cache** (`server/cache.py`, `CACHE_TTL_SECONDS = 300`) + `users.json` mälus.
- **Taustapuhastus** — sessioonid 5 min (`auth.py`), rate-limit 10 min (`rate_limit.py`).
- **Dashboard** — server-side pagineerimine, 12/lk, `page`/`hitsPerPage` (mitte `estimatedTotalHits`,
  oli 7,5× vale). `distinct` EI mõjuta Meili `facetDistribution`-it.
- Kaanepilt mõõdetakse kaardi kastile (`object-cover` seob LAIUSE); `COVER_VERSION` tõsta MÕLEMAS otsas.
- Jõudlusliin #182 on lõpetatud — mõõda muudatusi ALATI gzip'itud suurusega.

## TODO

| Ülesanne | Prioriteet |
|---|---|
| Varunduse kontroll (varundamise teeb ülikool, #131) | kesk |
| `tags`-fallbacki eemaldamine (35 lk kasutab veel vana välja) | madal |
| JSON-i koristus (`page_number` eemaldamine) | madal |

Skaleerimine (kui koormus kasvab): gunicorn mitme workeriga (praegu uvicorn single-worker,
kui GIL hakkab piirama), Redis sessioonidele (mitu instantsi), Prometheuse metrics-endpoint.
