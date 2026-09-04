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
| `npm run lint:ci` | ESLint (ainult `react-hooks`, teadlikult kitsas), lävi `--max-warnings 49` — parandades LANGETA arvu |
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
| `~/VUTT/state/` | `/app/state` | Runtime: `users.json`, sessioonid, tokenid, `reocr_log.json`, `ocr_run_reaps.json`, `user_settings/`, `notifications/` | ei |

`data/config/` sisu: `collections.json`, `vocabularies.json`, `places.json`, `origin_groups.json`,
`labels.json` (Q-kood → label), `person_aliases.json`, `archives.json`, **`prosopography/{nanoid}.json`**
(~2350 isikukaarti; **kaardid JA pildid (`prosopography/images/`) on siin** — pildid ei ole gitis,
`data/.gitignore` ignoreerib `*.jpg`) ning tuletatud indeksid
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
| `upload/`, `upload_ops.py` | Upload-viisard + OCR-serveri integratsioon; poolitamine enne OCR-i elab `upload/prepress*.py` + `page_source.py` + `store_source.py` moodulites |
| `ada/` | ADA (dspace.ut.ee) import: `mapping` (puhas DC-kaardistus), `client` (REST), `fetch` (allalaadimine), `provenance` (ankrud) |
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

### MCP-server (`mcp/`)

Eraldi pakett `vutt_mcp` — agentide (Claude Code, Codex, Gemini, Antigravity) read-only
ligipääs korpusele üle avaliku API. Seitse tööriista, stdio-transport. Vt `mcp/README.md`
ja spekk `docs/superpowers/specs/2026-08-15-vutt-mcp-server-design.md`.

Neli asja, mis on juba korra katki läinud:
- **Ei tohi importida `server`-it runtime'is** — pipx-venv on isoleeritud. Testid tohivad.
- **`mcp/tests/` ilma `__init__.py`-ta** — pakett `mcp.tests` varjutab repo `tests` paketi.
- **`mcp` sõltuvus AINULT `requirements-dev.txt`-is** — Docker on Python 3.9, SDK v2 ei mahu.
- **Iga tööriist `@mcp.tool(structured_output=False)`** — vaikimisi tuleks kaasa
  `structured_content`, mille klienditugi on ebaühtlane.
- **`VuttError` PEAB olema SDK `ToolError` alamtüüp** — alates `mcp` 2.1.0-st
  jõuab mudelini ainult `ToolError`-i sõnum, muu asendub tekstiga
  „Error executing tool X" ja agent kaotab juhise („kasuta `search_works`").

Indeksiseadete leping: `server/meili_settings.py` (ÜKS allikas, mida kasutavad nii
seed-skript kui `meilisearch_ops`) + `mcp/tests/test_meili_contract.py`.

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

Uus filtreeritav väli läheb **mõlemasse** nimekirja `meili_settings.py`-s:
`FILTERABLE_ATTRIBUTES` (seed/täisreindeks) JA `RUNTIME_REQUIRED_FILTERABLE` — ainult
teist rakendab `_ensure_filterable_attributes()` juba jooksvale instantsile. Ainult
esimesse lisamine jätab välja tootmises filtreerimatuks: filter-päring ebaõnnestub,
lai `except` neelab vea, funktsioon ei tööta kunagi ja miski ei anna sellest märku.

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

Rea alguses olev `N.` on CommonMarkis nummerdatud loendi marker — „1759. aastal…" muutus
`<ol start="1759">`-ks. `escapeAccidentalOrderedLists()` (`markdownViewHelpers.ts`) escape'ib
renderdusel markeri, kui number on ≥ 3-kohaline (aastaarv) VÕI kui plokis on ainult üks
loendirida (kuupäev). **Allikteksti EI muudeta** — teisendus elab ainult `MarkdownView`-s.

**Lehtede materialiseerimine (ADR 0028; varem 0017, 0026)** — **üks tee: VUTT
materialiseerib OCR-i lehed ja avaldab lehthaaval; LOSS ainult OCR-ib.** 300 DPI
EI OLE enam opt-in ja `admin_prepress_apply` ei hargne `is_trivial_plan` järgi.
Pildikausta leht, millel teisendust ei ole, kopeeritakse baithaaval
(`can_copy_source_bytes` — identity-lõige + JPEG + EXIF orientation 1/puudub;
PIL viskaks EXIF-i ära ja pöördega pilt näeks kahel teel erinev välja).

Kolm invarianti, iga rikkumine on nähtav viga:
- **I1** — kuni staatus on `applying`, ei muuda `poll_and_sync_thumbs` upload'i
  põhistaatust. Ilma selleta kirjutab juba esimene JPG-d näinud poll staatuse
  `reviewing`-uks keset apply't (`elif all_page_nums`).
- **I2** — `applying` ajal ei laadi poll ühtki kaug-JPG-d alla; pisipildid
  kirjutab `prepress_apply` kohapeal (mitte-fataalselt: kaugpilt on juba
  avaldatud). Aken `publish_atomic` ja `write_thumbnail` vahel on reaalne.
- **I3** — apply ja poll ei jaga sama `SFTPClient`-i; jagatud on ainult
  `paramiko.Transport`.

`expected_pages` on ÜKS tähendus: `awaiting_split`/`prepping` → lähte-lehtede arv,
`applying`-ust alates → väljund-lehtede arv (`try_begin_applying` seab).
`PREPRESS_IDLE_STATUSES` ei sisalda `applying`-ut.

Katkenud apply kordus puhastab kaugtöökausta **failid** (`cleanup_run_files`,
mitte `rm -rf`) — muidu jääks muutunud pildile eelmise katse `.txt`.
`RENDER_SEMAPHORE(1)` on protsessi-lokaalne ja nüüd KRIITILINE (kõik upload'id
läbivad selle) — enne workerite lisamist vaja protsessideülene lukk;
`config.check_render_concurrency()` hoiatab käivitusel.

100 DPI ülevaatus renderdatakse endiselt igal upload'il.
`FULL_DPI`/`JPEG_QUALITY` (`server/upload/page_source.py`) PEAVAD kattuma
OCR-serveri `PDF_DPI = 300` / `quality=95` väärtustega. OCR-serverisse
avaldatakse **failipõhise `.tmp`+rename-ga** — valvuril pole piltidele
stabiilsuskontrolli. `prepress` alamvälju muudetakse AINULT `mutate_prepress`
kaudu (`set_upload_state(**extra)` seab terve ülemise taseme võtme ja pühiks
paralleelse muudatuse). `apply` on ühekordne CAS
(`awaiting_split | prepping | error → applying`, kordus = 409).

Plaani semantika: vaikimisi on kõik lehed `mode: "nosplit"`; `default_split_x` on
üldjoone VÄÄRTUS, mis rakendub alles „Poolita kõik" käsuga. `excluded` ja `mode` on
**risti** — väljajätmine domineerib väljundi koostamisel, aga EI kustuta poolitusolekut.
`ocr_model` on töötlusotsus omas state-väljas; `meta.type` on bibliograafiline väide ja
seda EI muudeta vaikselt. `preview_cancel` on ühe tsükli lipp (apply seab, `prepress/start`
nullib) ja seda kontrollitakse IGA lehe alguses — apply ja eelvaade jagavad
`RENDER_SEMAPHORE(1)`-i. Renderdaja tohib staatust lähtestada ainult siis, kui ta on
selle omanik (`_reset_status_if_prepping`), muidu lubaks ta teise apply CAS-i sisse.

**Kaugkoristus (ADR 0024)** — katkestamine kustutab OCR-serveris ainult **failid**
(`ocr_client.cleanup_run_files`), kataloog jääb alles: `rm -rf`/`rmdir` lennusoleva batchi
alt annab OCR-valvuri veakäsitluseta `.txt`-kirjutusele `FileNotFoundError`, mis kukutab
KOGU teenuse (#225). Tühja kataloogi eemaldab `server/ocr_reaper.py` armuaja
(`RUN_DIR_REAP_GRACE` = 600 s) järel; `reocr_recovery` jätab ajastatud kataloogi vahele.
Eduka impordi järgne koristus tohib jääda `rm -rf`-iks — seal ei ole ühtki pilti, millest
batch tekiks.

**`page_map` (ADR 0030)** — `_transfer_pages` kirjutab iga avaldatud lähtelehe kohta
listi temast tekkinud väljundlehtedest, MÕLEMAS kohas kus `out_index` kasvab, ja kaart
nullitakse apply alguses. `int` ei kõlba: sammu 4 `deleted` käib väljundlehe kohta ja
poolitatud lehe ühe poole kustutamine jätaks ankru kustutatud lehele.

**Lehe JSON serveripoolsed väljad** — `editing.py` kirjutab `meta_content`-i kliendilt
TERVIKUNA üle. Uus serveripoolne lehe-väli PEAB minema `SERVERIPOOLSED_LEHE_VALJAD`-i,
muidu kaob ta esimese Ctrl+S peale, ilma vea ja logita.

**OCR vea-märgend (ADR 0025)** — OCR-server kirjutab ebaõnnestunud lehe kõrvale
`{tüvi}.err` (üks rida: `ErandiTüüp: sõnum`). Märgend on **lõplik**: `main_loop` ei võta
`.err`-iga lehte enam ette, kordus = märgendi kustutamine. Iga uus lugemistee peab `.err`-i
käsitlema nagu `.txt`-d: leht on **lahendatud**, mitte ootel — see puudutab ka
seisaku-tuvastust (`last_progress_at`, `is_stalled`) ja upload'i `done`-üleminekut.
Tühi väljund EI ole viga. Lugemiskohad: `reocr_ops` (üksik + batch poll),
`reocr_recovery`, `upload/thumbs.py`, `upload/import_work.py`.

**z-index kihid** — `Header` on `sticky z-[1200]`. Täisekraani-modaal PEAB olema **`z-[1300]`**
(nagu `PageImageEditorModal`), muidu katab päis modaali ülemise serva ja sulgemisnupp kaob
väikesel ekraanil ära. Tegevusribad (`PageActionBar`, `DashboardBulkActionBar`) on `z-[1100]`
ehk teadlikult päise all. `z-50` EI OLE piisav.

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

**Keeled (ADR 0019)** — `languages` loetleb teoses **sisuliselt esinevad** keeled, MITTE põhikeelt.
Keel kuulub loendisse, kui vähemalt ühe lehekülje tähtedest on ≥20 % selles keeles. Ladinakeelne
disputatsioon kreekakeelse gratulatsiooniga kannab nii `lat` kui `grc` — see ei ole viga.
Semantika on kõigil koodidel sama; põhikeelt ei kanna praegu ükski väli.
Kreeka automaattuvastus: `scripts/detect_greek.py` (kuivkäivitus vaikimisi).

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

`GET /prosopography/{id}` on **autentimata avalik** ja tagastab salvestatud kaardi JSON-i.
Seepärast filtreerib `person_crud.get_person` väljad `SECRET_FIELDS` (`auth_token`, `token`)
**lugemisel** (#237) — kirjutustee popid üksi ei puhastanud juba salvestatud kirjeid.
Uus tundlik väli lisa `SECRET_FIELDS`-i, mitte ainult kirjutusteele.

**Git-versioonihaldus** — iga salvestus commitib `.txt` + `.json`; esimene commit = originaal-OCR
(alati taastatav). Sama kehtib prosopograafia kaartidele (`save_with_git`). Admin taastab
Workspace'i „Ajalugu" tabist. **Kommentaaride taaste = ÜKS git-commit** (`onCommentsRestored`).

**Upload (admin, `/upload`)** — neljaastmeline viisard: metaandmed → fail → **poolitamine**
→ ülevaatus. Failitüüp tuvastatakse magic byte'idest (mitte laiendist). Fail salvestatakse
esmalt VUTT-i poolele (`uploads/{id}/source.pdf` või `source/`) ja läheb OCR-serverisse alles
sammu 3 otsuse järel — ALATI lehthaaval materialiseerituna work-kausta (ADR 0028). Import: SFTP alla →
`_metadata.json` + lehe-JSON-id →
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
