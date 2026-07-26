# CLAUDE.md

Estonian early modern text transcription workbench (React/TypeScript SPA). UI: Estonian + English. Code comments: Estonian.

## Commands

**NB: arendus toimub LOKAALSELT. Server on eraldi masin (`ssh vutt`). Ära eelda, et käsud töötavad serveris — vaata Deploy sektsiooni.**

```bash
# Lokaalne arendus
npm install && npm run dev    # Frontend dev (localhost:5173)
npm run build                 # Production build to dist/
```

**Python/testid lokaalselt:** kasuta alati projekti venv-i (`.venv/bin/python`, `.venv/bin/pytest`). Süsteemi `python3`/`pytest` ei pruugi omada vajalikke sõltuvusi.


### Deploy serverisse

```bash
ssh vutt
cd ~/VUTT

./scripts/server_update.sh       # git pull + docker rebuild + restart (Python kood)
./scripts/server_seed_data.sh    # Meilisearch indeksi uuendamine (kui andmed muutusid)

# Manuaalselt backend logid vaatamiseks:
docker logs vutt-backend
docker compose ps
```

Frontend deploy (pärast `npm run build` lokaalses masinas):
```bash
# --delete on tahtlik: ilma selleta kogunevad serverisse vanad hashitud chunk-failid
rsync -avz --delete dist/ vutt:~/VUTT/dist/
```

`npm run build` teeb Vite build'i JA eelkompressiooni (`scripts/precompress-dist.mjs`):
iga tekstivara kõrvale tekib `.br` (brotli 11) ja `.gz` (gzip 9). nginx serveerib
need `brotli_static`/`gzip_static` kaudu — **need failid PEAVAD rsync'iga kaasa
minema**, muidu langeb server tagasi lennult pakkimisele (~15% suurem).

### nginx konfiguratsioon

Aktiivne config on serveris (`/etc/nginx/sites-available/vutt`), **mitte gitis** —
repos on koopia `nginx.host.conf`. Muutmisel uuenda MÕLEMAT:

```bash
scp nginx.host.conf vutt:/tmp/vutt.nginx.new
ssh vutt 'sudo cp /tmp/vutt.nginx.new /etc/nginx/sites-available/vutt && sudo nginx -t && sudo systemctl reload nginx'
```

Eeldused hostis (ei ole `nginx.host.conf`-is): rate-limit tsoonid
`/etc/nginx/nginx.conf` http{} blokis (`vutt_auth` 1r/s, `vutt_api` 10r/s,
`vutt_meili` 20r/s, `vutt_images` 60r/s) ja brotli moodulid
(`libnginx-mod-http-brotli-filter`, `libnginx-mod-http-brotli-static`).

## Architecture

```
Frontend (Vite + React 19 + TypeScript + Tailwind)
├── Meilisearch (7700) - Search & metadata (index: teosed)
├── Image Server (8001) - Scanned .jpg images
└── File Server (8002) - Edits, auth, backups
    ↓
Filesystem: data/{work-folder}/{page}.txt + .jpg + .json + _metadata.json
```

**Key IDs:**
- `work_id` (nanoid) - used everywhere: routing, filters, API
- `slug` (folder name) - only in filesystem

## Andmeasukohad

Kaks eraldi kausta serveril, mõlemad mountitud Dockerisse:

| Kaust (serveril) | Docker mount | Mis seal on | Git | Lokaalselt |
|-----------------|-------------|-------------|-----|------------|
| `~/VUTT/state/` | `./state:/app/state` | Runtime: `users.json`, sessioonid, tokenid, `reocr_log.json`, `prosopography/` isikukaardid, `user_settings/` | Ei | Ei (ainult serveril) |
| `~/VUTT/data/` | `./data:/data` | Teosed, leheküljed, `data/config/` konfiguratsioon | Sisemises gitis (`data/` oma git) | Ei |

**`data/config/` sisaldab** (backend loeb/kirjutab siia Dockerist):

| Fail | Sisu |
|------|------|
| `collections.json` | Kollektsioonide hierarhia ja värvid |
| `vocabularies.json` | Taksonoomia sõnavarad |
| `places.json` | Kohtade register |
| `labels.json` | Q-kood → label register (kanooniline) |
| `person_aliases.json` | Isikute nimevariantide register |
| `prosopography_index.json` | Tuletatud prosopograafia indeks |
| `person_to_works.json` | Tuletatud isiku→teosed indeks |
| `works_creators_index.json` | Tuletatud teoste loojate indeks (teostest tuletatud isiku-isiku seosed) |

**Oluline:** lokaalne masin ei peegelda `data/` ega `state/` sisu. Kõik need failid elavad ainult serveril.

Konfiguratsioonifaili serverist alla tõmbamiseks:
```bash
scp vutt:~/VUTT/data/config/collections.json ./data-config-backup/
```

`data/config/` asukohta kontrollib `VUTT_DATA_DIR` env muutuja (`/data` Dockeris). Skriptides kasuta:
```python
DATA_ROOT_DIR = os.getenv("VUTT_DATA_DIR", "data")
CONFIG_DIR = os.path.join(DATA_ROOT_DIR, "config")   # ← ÕIGE
# MIS MITTE: os.path.join(os.path.dirname(__file__), "../state")  # vale — Dockeris /app/state (runtime), mitte /data/config (konfig)
```

**Kriitilised teed:**
- `data/config/` (hostil) = `/data/config/` (Dockeris) — konfiguratsioon (`collections.json` jne) ← `VUTT_DATA_DIR/config`
- `state/` (hostil) = `/app/state/` (Dockeris) — runtime (`users.json`, sessioonid, `user_settings/`) ← MITTE konfiguratsioon

## Data Layers

```
_metadata.json (V2 English)     →  Meilisearch (Estonian fields)  →  Frontend (V2)
title, year, creators[]            pealkiri, aasta, autor            title, year
```

**Text Search vs Editor Text:**
Meilisearch index contains two text fields to balance search accuracy and editor integrity:
- `lehekylje_tekst`: **Cleaned for search**. Hyphens at line-ends removed (`Spen- \ner` → `Spener`), markdown (`*`), code-switch (`~`), marginalia (`[[m:]]`) and footnotes (`[^n]`) removed. Searchable.
- `text_content`: **Raw for editor**. Original text with all markers. Retrievable but not searchable.

Meilisearch uses Estonian field names (legacy). Frontend maps them. Don't change Meilisearch schema without full reindex.

## Key Files

| Location | Purpose |
|----------|---------|
| `src/pages/` | Dashboard, Workspace, SearchPage, Statistics, Review, Admin |
| `src/services/meiliService.ts` | All Meilisearch operations |
| `src/services/collectionService.ts` | Collection helpers, color classes |
| `src/contexts/CollectionContext.tsx` | Collection state (React Context) |
| `src/components/EntityPicker.tsx` | Wikidata linked data picker |
| `src/components/MarkdownEditor.tsx` | Markdown-redaktor (nupuriba + eelvaade) vabateksti väljadele |
| `src/components/MarkdownView.tsx` | Turvaline markdown-renderdaja (allow-list, ei luba toorest HTML-i) |
| `server/main.py` | FastAPI backend, kõik endpointid |
| `server/auth.py` | Autentimine, rollid, sessioonid |
| `server/git_ops.py` | Git version control |
| `server/meilisearch_ops.py` | Meilisearch sync, ThreadPoolExecutor |
| `server/cache.py` | Collections/people/suggestions cache (TTL 5 min) |
| `server/upload_ops.py` | Upload wizard, OCR server integratsioon |
| `state/` | Runtime andmed (ei ole gitis): `users.json`, `pending_registrations.json`, `invite_tokens.json`, `prosopography/`, `user_settings/` |
| `data/config/` | Konfiguratsioon (sisemises gitis): `collections.json`, `vocabularies.json`, `places.json`, `labels.json`, `person_aliases.json`, `prosopography_index.json`, `person_to_works.json` |
| `docs/decisions/` | ADR-otsuste logi — arhitektuuriotsused ja kriitilised invariandid (loe ENNE nende alade muutmist) |

## Linked Data (Wikidata)

All metadata fields support LinkedEntity objects:
```json
{ "label": "Tartu", "id": "Q3258", "labels": {"et": "Tartu", "en": "Tartu"}, "source": "wikidata" }
```

Supported: `genre`, `type`, `location`, `publisher`, `tags`, `creators[]`

Links: Wikidata (`Q12345`), VIAF (`viaf:12345`), Album Academicum (`AA:123` - no public URL)

## Collections

Hierarchical collections with configurable colors. State managed via `CollectionContext`.

**Config:** `data/config/collections.json` (sisemises gitis serveril, koopia lokaalsel arenduses scp-ga)

```json
{
  "academia-gustaviana": {
    "name": { "et": "Academia Gustaviana", "en": "Academia Gustaviana" },
    "parent": "universitas-dorpatensis-1",
    "color": "amber"
  }
}
```

**Colors:** Tailwind color names (`red`, `amber`, `teal`, `violet`, etc.). Default: `indigo`.

**Usage:**
```tsx
import { getCollectionColorClasses } from '../services/collectionService';
const { bg, text, border, hoverBg } = getCollectionColorClasses(collection);
// Returns: { bg: 'bg-amber-50', text: 'text-amber-700', ... }
```

Collection displayed in: Dashboard cards, Workspace info panel, SearchPage results, Header indicator.

## Person Aliases & People Register

To handle historical name variants (e.g., *Lorenz Luden* vs *Laurentius Ludenius*), the system uses a central register.

**File:** `data/config/person_aliases.json` (sisemises gitis serveril)

**Workflow:**
1. Admin saves metadata with a Wikidata/GND ID.
2. Server (`people_ops.py`) automatically fetches aliases in background (only for `et`, `en`, `de`, `la`).
3. Aliases are saved to `data/config/person_aliases.json` under all associated IDs (cross-referencing).
4. Meilisearch indexer (`meilisearch_ops.py`) reads this file and adds aliases to `authors_text` field.

**Search:**
- Users can search for any variant (e.g., "Ludenius").
- Search result shows the canonical name from `_metadata.json` (e.g., "Lorenz Luden").
- Author filter sidebar shows only the canonical names to avoid duplicates.

## Authentication

- Roles: `contributor` < `editor` < `admin`
  - `contributor`: muudatused lähevad ülevaatusele (pending edits)
  - `editor`: saab otse salvestada, staatust muuta
  - `admin`: täielik ligipääs, versiooni taastamine, kasutajate haldus
- Token-based (UUID, 24h expiry)
- localStorage: `vutt_user`, `vutt_token`

## Git Version Control

- Every save commits both `.txt` and `.json` to git
- `_metadata.json` changes also tracked
- First commit = original OCR (always restorable)
- Admin can restore via "Ajalugu" tab in Workspace

## CodeMirror Editor (VuttMarkupExtension)

**File:** `src/components/editor/VuttMarkupExtension.ts`

XML-tägide peitmise ja kaitse süsteem CodeMirror 6-s. Kaks komponenti:

### 1. `vuttMarkupField` (StateField)

Parsib dokumendi igal muutusel ja loob kolm andmestruktuuri:
- **`deco`** — visuaalsed dekoratsioonid: tägid `Decoration.replace({})` (peidetud, ei võta ruumi), sisu `Decoration.mark({ class })` (kursiiv, marginalia jms)
- **`atomic`** — `EditorView.atomicRanges`: kursor ei saa tägide sisse sattuda, hüppab üle tervikuna
- **`tagRanges`** — tägide raw positsioonid `{from, to}[]`, kasutatakse protection filtris

**Kriitilised reeglid `RangeSetBuilder` jaoks:**
- `add()` nõuab rangeid **kasvavalt**: `from ASC`, sama `from` korral `to ASC` (mitte DESC!)
- Kattuvad `replace` dekoratsioonid ei ole lubatud — filter: `if (isReplace && r.from < lastReplaceEnd) continue`
- `mark` dekoratsioonid **võivad** `replace`-idega kattuda — ära blokeeri neid `lastReplaceEnd`-iga

**Tägide tüübid:**
```
<i>, <b>, <cs>, <m>, <hi>  → replace (peida täg) + mark (sisu stiil)
<pb/>                        → replace + PageBreakWidget
<fn>1</fn>                   → kogu blokk ühe replace + FootnoteWidget
```

**Ristuvad tägid** (nt `<cs><i>tekst</cs></i>`) on toetatud — stack-põhine parser, `lastIndexOf` leiab lähima avava tägi.

### 2. `vuttTagProtectionFilter` (transactionFilter)

Kaitseb tägi positsioone kasutaja juhuslike kustutamiste eest.

**Loogika:** kui kasutaja kustutamine (shift+del, ctrl+k jms) kattub tägi positsiooniga, lõigatakse täg muudatusest välja — kustutamine kehtib ainult nähtava teksti kohta.

**Filtreeritakse:** ainult `Transaction.userEvent` annotatsiooniga tehingud (kasutaja input/delete). Programmaatilised muudatused (laadimine, toolbar-nupud) jäetakse puutumata.

**EI TOHI muuta:**
- `sortFn`: peab olema `to ASC` sama `from` korral (mitte `to DESC`)
- `isReplace && r.from < lastReplaceEnd`: ainult replace'id blokeeritakse, mitte markid
- Protection filter peab jääma `vuttMarkupExtension` listi viimaseks (pärast `vuttMarkupField`)

### 3. Lehe vahetus ei monteeri editorit maha (ADR 0010)

Lehepööre sama teose sees **ei** võta CodeMirrorit maha — sisu vahetab
`useEditorState` `page`-effect. Sellel on kaks tagajärge:

- **Programmaatiline dokumendi asendus peab kandma `pageSwapAnnotation`-it**
  (`editorAnnotations.ts`), muidu loeb updateListener selle kasutaja
  muudatuseks ja lehelt lahkumisel küsitakse asjatult salvestamist.
- **See märgistus EI TOHI olla `Transaction.userEvent`** — `marginaliaProtectionFilter`
  ja `vuttAutoSanitizer` tegutsevad ainult userEvent-tehingutel ja hakkaksid
  muidu kettalt laetud teksti muutma.

Komponendisisene olek, mis varem lähtestus remountiga, tuleb nüüd lehe vahetuse
effectis **selgesõnaliselt** lähtestada (`isDirty`, `annotationDraftDirty`,
`saveError`, kerimispositsioon, pildi asend).

## Marginaalia — normaliseerimine ja kopeerimine

**Kanooniline formaat:** iga sisuline füüsiline marginaaliarida on eraldi `<m>…</m>`
plokk; `<m>` ei sisalda reavahetust ega teist `<m>` tägi. Järjestikused plokid
koondatakse üheks kaardiks ainult renderduses (`groupMarginaliaBlocks`), alusandmeid
muutmata. Legacy-parser loeb ajutiselt ka vanu mitmerealisi plokke. Vt ADR 0009.

**Põhimõte: ettearvatav, kogu aeg ühte moodi.** Koristus toimub ainult **salvestamisel**
(`server/marginalia_normalize.py`), MITTE elavalt iga klahvivajutuse peal (see lõhuks
kursori/voo). `normalize_marginalia_tags(text)` teeb kaks asja, idempotentselt:
1. **`<m>` välimiseks tägiks** real, mis on tervikuna marginaalia-plokk (ristuvate
   OCR-tägide `<i><m>X</i></m>` parandus).
2. **`strip_empty_tags`** — eemaldab tühjad paaris-tagid (`<m></m>`, `<i></i>`,
   `<m><i></i></m>` pesastatud püsipunktini). Komplekt: `m, i, b, cs, hi`. Säilitab sisu
   (ws ei kao: `<i> </i>` → ` `). **EI puutu** `ann\d*` (ID), `fn`, `pb`.

Kutsutud KÕIGIS kirjutusteedes: `/save` (`main.py`), `import_as_work` (`upload_ops.py`),
meili/consolidate `split_marginalia`. Olemasolevate failide koristus:
`scripts/migrate_marginalia_normalize.py` (serveris Dockeris, `--dry-run` → `--apply --commit`).

**Kopeerimise mudel (oluline, ettearvatav):** kopeeritud marginaalia-sisu on alati **plain**
— `TextEditor.tsx` copy-handler eemaldab tagid. **Sihtkoht määrab vormingu**: marginaaliasse
(avatud plokk) kleepides → marginaalia, põhiteksti → tavatekst. Üle ploki-piiri kustutus
avatud plokis liidab `<m>` plokid; jäänused koristab salvestamisel `strip_empty_tags`.

## Markdown-redaktor (Märkmed / Elulugu)

Vabateksti väljade (prosopograafia **Märkmed** ja **Elulugu**) jaoks on eraldi,
**domeeni-neutraalne** markdown-redaktor. EI OLE seotud transkriptsiooni CodeMirror-
editoriga (`VuttMarkupExtension`) — see kasutab XML-tägisid, siin on tavaline markdown.
Salvestus on tavaline markdown-string (`notes`/`biography` `_metadata.json`-is); backend/
andmemudel/migratsioon ei muutu.

**Komponendid (`src/components/`):**
- `markdownEditorHelpers.ts` — puhtad tekstiteisendused (`applyWrap`, `applyLinePrefix`,
  `looksLikeUrl`, `linkPrefillFromSelection`, `insertLink`, `normalizeLinkUrl`); DOM-vabad,
  unit-testitud (`__tests__/markdownEditorHelpers.test.ts`)
- `MarkdownEditor.tsx` — nupuriba (Paks/Kursiiv/Pealkiri/Link/Loend/`?`), Kirjuta/Eelvaade
  tabid (vaikimisi Kirjuta), lingi-popover (valikupõhine eeltäide + fookusehaldus),
  autosuurus (jäetakse vahele kui kasutaja on käsitsi suurust muutnud). API:
  `{ value, onChange, placeholder?, minRows?, id?, disabled? }`
- `MarkdownView.tsx` — `react-markdown` + `remark-gfm`, **allow-list** (`allowedElements`
  + `unwrapDisallowed`); tagastab `null` tühja sisu korral

**Turvalisus (KRIITILINE):** ainult markdown, **EI kasuta `rehype-raw`-i** → toores HTML
escape'itud. Renderduv DOM on piiratud: `p, strong, em, del, a, ul, ol, li, h1-h3,
blockquote, code, br`. Lingid `_blank`/`noopener`; react-markdowni `urlTransform` lubab
ainult kindlaid protokolle (`javascript:` blokeeritud). GFM on sees AINULT autolinkimiseks
— tabelid/footnote'd/tasklist'id ei renderdu struktuurina (tekst säilib `unwrapDisallowed`-ga).

**Stiil:** `.vutt-md` klass `src/index.css`-is (eraldi transkriptsiooni `.markdown-preview`-st).
**i18n:** `common` namespace, võti `markdownEditor`. **Nupud v1 ainult lisavad süntaksit**
(pole toggle-eemaldust). Disain/plaan: `docs/superpowers/{specs,plans}/2026-06-29-markdown-notes-editor*`.

## i18n

```tsx
const { t } = useTranslation(['workspace', 'common']);
t('tabs.edit')  // From workspace namespace
t('common:status.Valmis')  // From common namespace
```

Files: `src/locales/{et,en}/*.json`

**Keelepakid laetakse laisalt** — üks keel korraga, dünaamilise impordiga
(`src/locales/{et,en}/index.ts` = üks chunk keele kohta). Keeletuvastus käib
käsitsi `src/utils/detectLanguage.ts`-is **enne** i18n init'i, sest
`fallbackLng` sunniks i18nexti laadima ka varukeele paki. Vt ADR 0011.

**`fallbackLng` on VÄLJAS.** Puuduvat võtit ei võeta enam vaikselt teisest
keelest → **uus võti tuleb lisada mõlemasse keelde korraga**, muidu katkeb
build (`src/locales/__tests__/localeParity.test.ts`). Uus nimeruum lisa ka
`src/locales/namespaces.ts`-i (mitte `i18n.ts`-i — selle importimine käivitab
init'i).

## Common Patterns

**Adding new field:**
1. `types.ts` - add to interface
2. `meiliService.ts` - add to attributesToRetrieve
3. `1-1_consolidate_data.py` - if from filesystem
4. Component - display it

**Adding translations:**
1. Add to both `locales/et/` and `locales/en/`
2. Use `t('key')` in component

## Security Notes

- HTTPS + HSTS enabled
- Rate limiting on auth endpoints
- Meilisearch: frontend uses search-only API key
- Backend ports (7700, 8001, 8002) not exposed

## Performance Optimizations

Server on optimeeritud ~300 samaaegse kasutaja jaoks. Tehtud optimeeringud:

**Async Meilisearch sync** (`meilisearch_ops.py`)
- `/save` ei blokeeru Meilisearch indekseerimist oodates
- `ThreadPoolExecutor` (max 10 töötajat) piirab samaagseid päringuid
- Kasutaja saab vastuse kohe pärast Git commit'i (~100-500ms vs varem kuni 30s)

**Cache'imine** (`server/cache.py`)
- `users.json` - laetakse stardil, uuendatakse ainult muudatuste korral (`auth.py`)
- `collections.json`, `vocabularies.json`, `person_aliases.json` - cache TTL 5 min
- Suggestions cache TTL 5 min

**Meilisearch keep-warm** (`meilisearch_ops.py`)
- `_keepwarm_loop`: iga 2h sync-ib ühe teose Meilisearchi
- Väldib ~60s cold-start viivitust esimesel indekseerimistehingul pärast pikka pausi
- Põhjus: `prefixSearch: "indexingTime"` skannib kogu sõnavara FST-i igal updateil —
  esimesel kord pärast pikka pausi on B-puu LMDB-s külm (vt `MEILI_KEEPWARM_INTERVAL`)
- `prefixSearch: "disabled"` EI SOBI — "risin" ei leia "Risingh" (2 editi > typo piir)

**Automaatne puhastus (daemon threads)**
- Aegunud sessioonid - iga 5 min (`auth.py`)
- Tühjad rate limit IP kirjed - iga 10 min (`rate_limit.py`)

**Konfigureeritavad konstandid:**
```python
# meilisearch_ops.py
MEILISEARCH_POOL_SIZE = 10      # Max samaagseid Meilisearch päringuid

# server/cache.py
CACHE_TTL_SECONDS = 300          # Collections/vocabularies cache TTL

# auth.py
SESSION_CLEANUP_INTERVAL = 300   # Sessioonide puhastuse intervall

# rate_limit.py
RATE_LIMIT_CLEANUP_INTERVAL = 600  # Rate limit puhastuse intervall
```

## Töövoog

Suuremad muudatused ja featuurid planeeritakse ja jälgitakse **GitHub Issues** kaudu:
```bash
gh issue list                    # Vaata avatud issueid
gh issue create --title "..."    # Loo uus issue
gh issue view 1                  # Vaata issue detaile
```

## TODO

| Task | Priority |
|------|----------|
| Automatic backup system | High (waiting for IT) |
| JSON cleanup (page_number removal) | Low |
| Code fallback removal | Low |

### Skaleerimise TODO (kui koormus kasvab)

| Task | Millal vaja |
|------|-------------|
| FastAPI + gunicorn (praegu uvicorn single-worker) | Kui Python GIL hakkab piirama (>500 kasutajat) |
| Lisa Redis sessioonide ja cache jaoks | Kui vaja mitut serveri instantsi (horisontaalne skaleerimine) |
| Lisa metrics endpoint (Prometheus) | Kui vaja jälgida mälukasutust ja jõudlust tootmises |

## Upload Workflow (Admin)

Admin saab lisada uue teose PDF-i või pildina (`/upload`). Kolmeastmeline viisard:

**Samm 1 — Metaandmed:** pealkiri, aasta, slug (kaustanimi), kollektsioon.

**Samm 2 — Faili üleslaadimine:** PDF, JPG või PNG.
- Failitüüp tuvastatakse **magic bytes** alusel (`_detect_file_type()` in `upload_ops.py`), mitte failinime järgi
- **PDF:** `pdfinfo` → lehekülgede arv → SFTP → `AUTO-OCR/{id}/slug.pdf` → OCR server lõhub lehekülgedeks
- **JPG/PNG:** SFTP otse → `AUTO-OCR/{id}/slug/slug_pg_001.jpg` → OCR server teeb OCR ilma PDF-i lahti lõhkumata (PNG teisendatakse JPEG-iks Pillowiga)
- Kuni üleslaadimise lõpuni: "Sulge — jätkan hiljem" sulgeb viisardi ilma uploadi katkestamata; kasutaja näeb pooleliolevate nimekirja
- "Katkesta üleslaadimine ja kustuta" kustutab ka OCR serveri staging kausta

**Samm 3 — Ülevaatus:** OCR server töötleb taustal. Polling iga 2–5s. Pisipiltide ruudustik, võimalik üksikuid lehekülgi kustutada.

**Import:** "Impordi VUTT-i" → `import_as_work()`:
1. SFTP: laeb alla JPG + TXT OCR serverist → `data/{slug}/`
2. Loob `_metadata.json` + lehekülgede `.json` failid
3. Git commit (originaal OCR)
4. Meilisearch sync (**sünkroonne** — ootab lõpuni, et teos oleks kohe kättesaadav)
5. Navigeerib otse teose lehele

**Staging:** `uploads/{upload_id}/state.json` + `thumbs/`. Pooleliolevad uploadid säilivad üle seansi.

**Key file:** `server/upload_ops.py` — `create_upload`, `save_and_transfer_to_ocr`, `poll_and_sync_thumbs`, `import_as_work`, `cancel_upload`

