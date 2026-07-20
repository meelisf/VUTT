# Staatilise analüüsi leidude triaaž (2026-07-21)

Allikas: automaatse koodianalüsaatori (tõenäoliselt Gemini/claudi "review") leidude nimekiri.
Iga leide kontrolliti tegelikku koodi ja testide vastu.

## Kokkuvõte

| Kategooria | Leidude arv | Reaalsed probleemid |
|-----------|-------------|---------------------|
| Valed positiivsed (false positive) | ~25 | 0 |
| Reaalsed, kuid madala raskusega | ~6 | vähe |
| Reaalsed turvalisusmure'd (kaitse-sügavus) | 1 | 1 |
| Juhised/ettepanekud (pole bugid) | ~2 | 0 |

**Peamine järeldus:** nimekiri ei sisalda tõsiseid, ekspluateeritavaid probleeme.
Kõige kõlavamad leided (6 × "blocking I/O in async context") on **kõik valed**,
sest analüsaator ei saanud aru FastAPI samaegsuse mudelist. Ükski leid ei nõua
kiiret tootmispärandit.

---

## 🔴 Valed positiivsed — EI vaja tegevust

### 1. "Blocking I/O in async context" (6 leidet) — KÕIK VALED

**Kontrollitud endpointid — kõik on tavalised `def`, mitte `async def`:**

| Asukoht | Reaalne signatuur | Klient |
|--------|-------------------|--------|
| `server/routers/public.py:83` `download_work` | `def download_work(...)` | threadpool |
| `server/routers/public.py:212` `home_meta` | `def home_meta(...)` | threadpool |
| `server/routers/public.py:267` `work_meta` | `def work_meta(...)` | threadpool |
| `server/routers/public.py:287` `sitemap_xml` | `def sitemap_xml(...)` | threadpool |
| `server/routers/pages.py:37` `admin_work_pages` | `def admin_work_pages(...)` | threadpool |
| `server/routers/ocr_jobs.py:40` `_build_admin_ocr_jobs` | sünk. fn, kutsutud `await run_in_threadpool(...)` | threadpool |

**Põhjus:** FastAPI / Starlette jooksutab kõik **sünkroonsed** (`def`) route-handlerid
automaatselt `anyio` threadpoolis (`run_in_threadpool`). Ainult `async def` handlerid
jooksevad otse event loop'is ja saaksid seda blokeerida. Analüsaator eeldas valesti,
et need on `async def`. Seega blokeeritakse event loop **ainult siis**, kui threadpool
ise on täis (mis on hoopis teine, väga suure koormuse probleem).

Abifunktsioonid `build_home_meta_html`, `build_sitemap_xml`, `_load_work_metadata`
päritaksegi sünkroonselt — aga kuna neid kutsutakse threadpool-handleritest, on see
korrektne. **Mitte mingit refaktoreerimist vaja.**

> Kui soovitakse ümber lükata ilma koodi muutmata: vaata `grep -n "async def" server/routers/public.py`.

### 2. "Potential Path Traversal in Image Server" — KAITSUD OLEMAS

`server/image_server.py:495 translate_path` on kaitstud **kahel kihil**:

1. `os.path.normpath(path)` pärast URL-dekodeerimist — lamendab kõik `../` järjestikused
   juba URL-tasemel (testitud: `/foo/../../etc/passwd` → `/data/etc/passwd`, alati `DIRECTORY` sees).
2. `do_GET` (rida 373) kutsub enne serveerimist `_is_safe_image_path(resolved, DIRECTORY)`,
   mis teeb `os.path.realpath` konteineri-kontrolli (`startswith(real_base + os.sep)`)
   **ja** laiendite allow-list'i (ainult pildifailid). Kaitseb ka symlink-põhist traversali.

**Mitte ekspluateeritav.** Võib lisada kommentaari "defense-in-depth juba olemas",
koodimuudatus ei ole vajalik.

### 3. "CORS Allows Credentials Over Wide Pattern" — VALE

`server/config.py:129 ALLOWED_ORIGINS` on **täpne nimekiri** kindlatest hostidest
(tootmisdomeen `vutt.utlib.ut.ee` + lokaalsed dev-pordid). Ei mingit wildcardi (`*`).
`allow_credentials=True` on sel juhul turvaline, sest Starledger/FastAPI ei luba
`*`-i koos credentialsiga ja siin ongi konkreetsed origin'id.

Väike hardcoded-hügieen: tootmises võiks dev-`localhost`-read eemaldada (keskkonna-
põhiselt), aga see ei ole turvaauk — `localhost` on avalikust internetist kättesaamatu.

### 4. "Untested X" — testid on tegelikult olemas (10+ leidet)

| Väide | Tegelik testifail |
|-------|-------------------|
| `normalize_marginalia_tags` | `tests/test_marginalia_normalize.py` (18+ testi, sh idempotentsus) |
| `strip_empty_tags` | `tests/test_marginalia_normalize.py` (10+ testi) |
| `_validate_quad` | `tests/test_transform_page.py` (8 testi: bowtie, NaN, range...) |
| `_validate_base_names` | `tests/test_delete_pages_endpoint.py` |
| `check_rate_limit` | `tests/test_login_throttle.py`, `tests/test_async_endpoint_offload.py` |
| `get_reocr_log` | `tests/test_reocr_state.py`, `tests/test_reocr_recovery.py` |
| `is_work_public` | `tests/test_access_ops.py`, `tests/test_role_permissions.py` |
| `clean_text_for_search` | `tests/test_meilisearch_ops.py`, `tests/test_consolidate_data.py` |
| `isAtLeast` | `src/utils/__tests__/roleUtils.test.ts` |
| `shouldRefreshToken` | `src/utils/__tests__/meiliTokenRefresh.test.ts` |
| `thumbRetryDelay` | `src/utils/__tests__/thumbRetry.test.ts` |
| `expandedBoundingBox` | `src/utils/__tests__/imageTransformGeometry.test.ts` |

### 5. "Fix X bug" (testikommentaarid) — juba lahendatud

- `meiliTokenRefresh sync bug` — koodis (`src/utils/meiliTokenRefresh.ts:4`) selgitatud
  varasem bug + reegel `REFRESH_LOOKAHEAD_MS > CHECK_INTERVAL_MS` (60s vs 5min) — **fikseeritud**.
- `labels missing 'et' translations` — test kirjeldab varasemat bugfixi.
- `marginalia end clusters hiding` — test varasema fixi kohta.

Analüsaator tuvastas need õigesti kui "kirjeldus, mitte ootel tegevus".

---

## 🟡 Reaalsed leided — MADAL raskus

### A. Hardcoded dev-secret fallback (`server/config.py:186`) — kaitse-sügavus

```python
IMAGE_TOKEN_SECRET = os.getenv("IMAGE_TOKEN_SECRET", "dev-image-secret-change-in-production")
```

Kui tootmises keskkonnamuutuja puudub, kehtib avalikult teadaolev vaikeväärtus ja
pildi-HMAC-allkirju saaks võltsida. **Eeldus:** tootmises on env seatud (tõenäoliselt
jah). Soovitus: tootmises tee fail-closed (tõsta viga kui secret on vaikeväärtus või
puudu). ~10 rida. Mõju: kaitse-sügavus, mitte aktiivne auk.

### B. Kasutamata import `PORT` (`server/main.py:6`)

```python
from .config import PORT, ALLOWED_ORIGINS, BASE_DIR, UPLOAD_ENABLED, UPLOADS_DIR, get_logger
```

`PORT` ei kasutata main.py-s (ainus esinemine on importreal). Triviaalne koristus.

### C. Teadmata puhtad funktsioonid, millel testid puuduvad (testikatte lüngad)

Need on **päris** katmata (erinevalt pt. 4) — kuid kõik on lihtsad puhtad fn-id,
puudub bug:

- `validate_password_strength` (`server/registration.py:275`)
- `validate_invite_token` (`server/registration.py:207`)
- `check_slug_conflict` (`server/upload_ops.py:277`)
- `invert_gnd_name` (`server/people_ops.py:93`)
- `compute_autor_respondens` (`server/meili_doc.py:162`)
- `deriveUsernameFromEmail` (`src/utils/username.ts:1`)

Soovitus: lisa üheainsa korraga lihtsad unit-testid. Madal prioriteet, hea "first issue".

### D. Pikad funktsioonid (~16 leidet "Complex Function")

Refaktoreerimis-võimalused (100–270 rida): `import_as_work` (230), `replace_work_content`
(272), `merge_person` (179), `get_recent_commits` (165), `split_page` (151) jne.
**Need pole bugid.** Lõhu oht puudub; puhtalt loetavus/testitavus. Töö võib olla
riskantne (-struktuurimuudatused), seega madal prioriteet.

### E. Muud mitte-bugid

- **`Rename server/auth.py → auth_ops.py`** — nimetamisettepanek, mitte viga. Kaks sama
  nimega faili erinevates pakettides (`server/auth.py` vs `server/routers/auth.py`) on
  Pythonis täiesti korrektne; konflikti ei teki. Vabatahtlik esteetiline koristus.
- **"Remove code when type_ids/genre_ids indexed"** (`AdvancedFilters.tsx:194`) —
  uurimis-TODO, eeldab Meilisearch indeksi seisu kontrollimist.
- **`scripts/reconcile_authors.py` loop exit** — ühekordne skript, mitte tootmiskood.
- **"Handle early loop exit on rename"** — madal, mitte-kriitiline.

---

## Soovituslik tegevusjärjekord

1. **(valikuline, kiire)** Eemalda kasutamata `PORT` import — 1 rida.
2. **(soovitus)** Tee `IMAGE_TOKEN_SECRET` tootmises fail-closed (kaitse-sügavus) — ~10 rida.
3. **(hea "good first issue")** Lisa puhtatele fn-idele (pt. C) unit-testid.
4. **(vabatahtlik)** Tõsta koodikommentaaridesse märge, et `translate_path` path-traversali
   kaitse on juba olemas (`normpath` + `_is_safe_image_path`), et tulevased analüsaatorid
   seda uuesti ei reportiks.

**Ära tee:** ära refaktoreeri 6 "async blocking" endpointi — need pole async ja ei blokeeri
event loop'i. Analüsaator tegi süstemaatilise vea.

---

## 🆕 Analüsaatori poolt VAHELE JÄETUD leited (käsitsi ülevaatamisel leitud)

Need on tegelikud (küll madala raskusega) probleemid, mida automaatne nimekiri ei
leidnud. Tekkisid koodi sügavamal, kui analüsaator vaatas.

### N1. SPARQL-injektsioon `_fetch_wikidata` nõrga Q-ID valideerimise tõttu

**Asukoht:** `server/prosopography/enrichment.py:101`

```python
def _fetch_wikidata(qid: str) -> Optional[dict]:
    ...
    if not qid.startswith("Q"):      # ← liiga nõrk!
        return None
    sparql1 = f"""
      ... wd:{qid} wdt:P21 ?gender. ...   # ← Q-id interpoleeritakse otse SPARQL-i
    """
```

**Väide:** `ext_id` tuleb isikukaardi välisest identifikaatorist (Wikidata ID),
mille seab editor/admin. `_fetch_wikidata` kontrollib ainult `startswith("Q")`,
aga `Q1} OPTIONAL{...} #x` läheb sellest läbi (testitud). Q-ID interpoleeritakse
f-stringina SPARQL-päringusse → **SPARQL-injektsioon** Wikidata avalikku
päringuendpointi (`query.wikidata.org/sparql`).

**Mõju:** Madal–keskmine. Nõuab autenditud editorit; sihtmärk on avalik, rate-
limited Wikidata teenus (mitte meie enda infra). Tõsisem risk on raskete päringute
gennemine (DoS Wikidata vastu) või andmete kombineerimine.

**Fix:** rakenda ranget valideerimist (muster on koodis **juba olemas** real 367:
`qid.startswith("Q") and qid[1:].isdigit()`):
```python
import re
if not re.fullmatch(r"Q\d+", qid):
    return None
```

### N2. `_check_image_access` fail-OPEN, kui metaandmeid ei õnnestu laadida

**Asukoht:** `server/image_server.py:57-59`

```python
def _check_image_access(work_id, meta, query_string):
    if meta is None or is_work_public(meta) or meta.get('shareable', False):
        return True          # ← meta is None ⇒ juurdepääs LUBATUD ilma tokenita
    ...
```

**Väide:** Kui `_metadata.json` puudub või on katki (`meta is None`), serveeritakse
piiratud teose pildid **ilma HMAC-tokeni kontrollita**. See on **fail-open** disain —
kindluse-sügavuse printsiibi vastu (tundmata olekus peaks vaikimisi keelama).

**Mõju:** Madal. Eeldab, et teose metaandmed on puudu/katki JA ründaja teab teose
teed. Normaalkäituses kõigil teostel meta olemas.

**Fix:** muuda fail-closed — kui meta on None ja teos pole teadaolevalt avalik,
nõua ikkagi kehtivat tokenit (või keela). Või vähemalt: teenuse spetsiifika
dokumenteerimine, et see on teadlik valik.

### N3. `get_client_ip` usaldab kliendi-kontrollitavaid päiseid (rate-limit bypass)

**Asukoht:** `server/rate_limit.py` `get_client_ip`

```python
ip = request.headers.get('X-Real-IP')                    # primaarne
if ip and ip.strip(): return ip.strip()
forwarded = request.headers.get('X-Forwarded-For')        # fallback
if forwarded: return forwarded.split(',')[0].strip()      # ← vasakpoolseim (spuufitav)
```

**Väite:** X-Real-IP on OK **ainult siis**, kui nginx selle alati üle kirutab
(`proxy_set_header X-Real-IP $remote_addr;`). X-Forwarded-For fallback võtab
**vasakpoolseima** väärtuse, mille klient ise saab määrata (nt `X-Forwarded-For: 1.2.3.4`).
Kui backend on kätteühtegi teed otse ligipääsetav (dev, eksposetud port,
vale proxy-konfig), saab rate-limiti/X-i päringute arvu piiranguid mööda hiilida.

**Mõju:** Madal, **deployment-sõltuv**. CLAUDE.md ütleb, et backend-porte (7700/8001/8002)
tootmises ei eksponeerita → tõenäoliselt OK. Aga kood ise on habras: usaldab
päiseid ilma trusted-proxy ahela kontrollita.

**Fix:** hoia X-Real-IP (kui nginx tagab ülekirjutamise), aga eemalda või piira
X-Forwarded-For fallback. Või kontrolli, et ühenduse päritolu on usaldusväärne proxy
(`request.client.host` whitelisted proxy IP-de vastu).

### Märkused (väiksemad)

- **GND/VIAF ID-d valideerimata** (`enrichment.py:247,350`): `gnd_id`/`viaf_id`
  interpoleeritakse URL-i ilma kontrollita. Mõju praktiliselt olematu — fixed hostid
  (`lobid.org`, `viaf.org`), pääseb ainult path-injektsioonile neis teenustes.
- **CORS `allow_headers=["*"]` koos credentials**: OK, sest origin'id on täpne nimekiri
  (mitte `*`); Starledge peegeldab päised ainult lubatud origin'itele. Mitte probleem.
- **Sessioonid mälus dict'is** (`auth.py:22`): OK — ei leki kettale (plaintext tokenid
  oleksid hullem). Dict-lookup (`sessions.get(token)`) ei ole konstantse ajaga, aga
  128-bitise uuid4 tokeni korral on ajastusrünne ebapraktiline.
- **Paroolihashid**: bcrypt soolaga (head); SHA-256 rada on **ainult** legacy migratsioon,
  mis sisselogimisel bcrypt-ile uueneb (head); dummy-bcrypt ajastuse-ekvalaiser
  takistab kasutajanime enumeratsiooni (peen).

### Kokkuvõte käsitsi-ülevaatele

Analüsaator jäi vahele 3 reaalset (madala raskusega) leidet:
1. SPARQL-injektsioon Wikidata-sse — lihtne 2-realine fix (trivitaalne, muster olemas).
2. Image-access fail-open — defense-in-depth, vajab disainiotsust.
3. Rate-limit XFF bypass — deployment-sõltuv, tõenäoliselt juba kaetud nginx-ga.

Need kõik on **madalama raskusega** kui analüsaatori 6 vale-positiivset "async
blocking" teadet paistisid olevat. Puuduvad kriitilised/ekspluateeritavad augud.
