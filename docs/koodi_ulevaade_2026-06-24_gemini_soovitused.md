# Koodi ülevaade: reaalsed leiud ja soovitused

Kuupäev: 2026-06-24  
Allikas: Gemini/Jules soovituste järelkontroll koodibaasi põhjal  
Eesmärk: jätta alles ainult reaalsed probleemid/küsimused, mida implementatsioonil arvesse võtta.

---

## Kokkuvõte

| # | Teema | Hinnang | Prioriteet | Viide |
|---|-------|---------|------------|-------|
| 1 | `sync_work_to_meilisearch` on liiga suur | reaalne hooldatavuse risk | keskmine | `server/meilisearch_ops.py:315-642` |
| 2 | `save_and_transfer_to_ocr` on keeruline | reaalne hooldatavuse risk | madal/keskmine | `server/upload_ops.py:426-665` |
| 3 | `_find_works_with_collection` skaneerib failisüsteemi | ebaefektiivne, admin-only | madal | `server/main.py:1815-1830` |
| 4 | Blocking file I/O async endpointides | tehniliselt reaalne | madal | `server/main.py:1156-1161`, `1853-1856` |
| 5 | OCR cleanup kasutab shellkäsku `rm -rf` | mitte ekspluateeritav, aga halb muster | madal | `server/upload_ops.py:1201,1458,1503` |
| 6 | Tootmise secretite seadistus vajab kinnitamist | konfiguratsiooniküsimus | kontroll | `server/config.py:183,234-267` |
| 7 | `crossLangTypeMap` / `crossLangGenreMap` eemaldamise eeltingimus | andmekontroll enne kustutamist | keskmine | `src/components/AdvancedFilters.tsx:185-210` |
| 8 | Testilüngad | reaalne, mitte kriitiline | madal | vt allpool |
| 9 | Kommenteeritud vana OCR prompt | cleanup | triviaalne | `loss/kataloogi-jalgimine-ja-ocr.py:94-119` |

---

## 1. `sync_work_to_meilisearch` on liiga suur

**Viide:** `server/meilisearch_ops.py:315-642` — umbes 328 rida ühes funktsioonis.

Funktsioonis on koos mitu vastutust:
- metadata lugemine ja normaliseerimine;
- lehekülgede `.txt`/`.json` lugemine;
- otsinguteksti puhastus (`lehekylje_tekst`) vs raw editoritekst (`text_content`);
- autorite/aliaste/labelite väljade koostamine;
- Meilisearchi upsert/delete loogika.

See pole otsene bug, aga muudatuste regressioonirisk on kõrge.

**Soovitus:** enne refaktooringut lisa fixture/snapshot-test, mis fikseerib ühe väikese teose Meilisearchi dokumendi väljad:
- `lehekylje_tekst` vs `text_content`;
- `type_ids` / `genre_ids`;
- `authors_text` aliastega;
- collection fields;
- aasta vahemik (`parse_year_range`).

Seejärel refaktoori väiksemateks abifunktsioonideks, nt:
- `_build_page_document(...)`;
- `_clean_search_text(...)`;
- `_load_work_index_context(...)`;
- `_upsert_work_documents(...)`.

**Prioriteet:** keskmine. Planeerida eraldi PR/issue-na.

---

## 2. `save_and_transfer_to_ocr` on keeruline

**Viide:** `server/upload_ops.py:426-665` — umbes 239 rida.

Funktsioon haldab korraga:
- faili tüübi tuvastust;
- PDF-i `pdfinfo` loogikat;
- pildi/PDF SFTP uploadi;
- PNG/TIFF → JPEG konverteerimist;
- state.json staatuseid;
- taustalõime ja progressi.

Kood on kommenteeritud ja funktsionaalselt arusaadav, aga muutmine on riskantne.

**Soovitus:** refaktoori järk-järgult, mitte koos käitumismuudatustega:
- `_prepare_pdf_upload(...)`;
- `_prepare_image_upload(...)`;
- `_sftp_transfer_pdf(...)`;
- `_sftp_transfer_image(...)`;
- ühine state/progress helper.

**Prioriteet:** madal/keskmine. Mitte esimese kiire PR-i osa.

---

## 3. `_find_works_with_collection` on ebaefektiivne

**Viide:** `server/main.py:1815-1830`.

Funktsioon käib iga kõne ajal läbi kõik `BASE_DIR` kaustad ja loeb iga `_metadata.json` faili. Seda kasutavad:
- `admin_collection_works_count` — `server/main.py:1853-1856`;
- `admin_delete_collection` — `server/main.py:1874`.

Mõju on piiratud, sest tegu on admin-only vooga, aga teoste arvu kasvades muutub see aeglaseks.

**Soovitus:**
- lühiajaliselt piisab blocking-I/O parandusest (vt punkt 4);
- pikemalt kaaluda cached indeksit `collection_id → works` või Meilisearchi filtrit;
- kui kasutada cache’i, tuleb see invalideerida metadata salvestamisel ja kollektsioonide muutmisel.

**Prioriteet:** madal.

---

## 4. Blocking file I/O async endpointides

### 4.1 `admin_collection_works_count`

**Viide:** `server/main.py:1853-1856`.

Endpoint ei kasuta `await`, aga on `async def`. Kuna ta teeb `_find_works_with_collection` kaudu sync faililugemist, blokeerib ta event loopi.

**Soovitus:** muuta endpoint tavaliseks `def`-iks. FastAPI jooksutab sync endpointid threadpoolis.

```python
@app.get("/admin/collections/{collection_id}/works-count")
def admin_collection_works_count(collection_id: str, user=Depends(require_role("admin"))):
    count = len(_find_works_with_collection(collection_id))
    return {"status": "success", "count": count}
```

### 4.2 `get_work_meta_direct`

**Viide:** `server/main.py:1156-1161`.

Seda ei tohi pimesi `def`-iks muuta, sest endpoint kutsub `await get_json_data(request)`.

**Soovitus:** endpoint jääb `async`, aga faililugemine tõsta threadpooli:

```python
from starlette.concurrency import run_in_threadpool


def _read_work_meta_direct_sync(work_id: str, original_path: str):
    path = find_directory_by_id(work_id) or os.path.join(
        BASE_DIR,
        os.path.basename(original_path or ''),
    )
    meta_path = os.path.join(path, '_metadata.json')
    if os.path.exists(meta_path):
        with open(meta_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


@app.post("/get-work-metadata")
async def get_work_meta_direct(request: Request, user=Depends(require_role("editor"))):
    data = await get_json_data(request)
    metadata = await run_in_threadpool(
        _read_work_meta_direct_sync,
        data.get('work_id'),
        data.get('original_path', ''),
    )
    return {"status": "success", "metadata": metadata}
```

**Testisoovitus:** kontrollida vähemalt:
- olemasolev metadata tagastatakse;
- puuduva `_metadata.json` korral vastus on `metadata: {}`.

**Prioriteet:** madal, aga kiire ja puhas parandus.

---

## 5. `upload_ops.py` OCR cleanup kasutab shellkäsku

**Viide:** `server/upload_ops.py:1201,1458,1503`.

Kolmes kohas kasutatakse:

```python
chan.exec_command(f'rm -rf "{remote_staging}"')
```

See ei paista praegu ekspluateeritav, sest:
- `upload_id` on piiratud vorminguga;
- `ocr_model` on ainult `hand` või `print`;
- `remote_staging_path` koostatakse serveris;
- `OCR_SERVER_PATH` tuleb serveri env-ist, mitte kasutajalt.

Aga muster on siiski halb: shellkäsk + string interpolation. Tulevikumuudatus võib selle ohtlikuks muuta.

**Soovitus:** tee üks helper ja kasuta `shlex.quote` + `--`:

```python
import shlex


def _ssh_rm_rf(upload_id: str, remote_path: str):
    """Kustutab OCR serveris staging-kausta. remote_path peab olema serveri koostatud tee."""
    transport = get_or_create_ssh(upload_id)
    chan = transport.open_session()
    try:
        chan.set_combine_stderr(True)
        chan.exec_command(f"rm -rf -- {shlex.quote(remote_path)}")
        status = chan.recv_exit_status()
        if status != 0:
            raise RuntimeError(f"rm -rf ebaõnnestus (exit={status}): {remote_path}")
    finally:
        chan.close()
```

Seejärel asendada kolm kordust:

```python
_ssh_rm_rf(upload_id, remote_staging)
```

**Testisoovitus:** mockida `get_or_create_ssh` / channel ja kontrollida, et käsk sisaldab `rm -rf --` ja `shlex.quote`-itud path’i.

**Prioriteet:** madal, aga soovitatav kiire parandus.

---

## 6. Tootmise secretite seadistus vajab kinnitamist

**Viited:**
- `server/config.py:183` — `IMAGE_TOKEN_SECRET` dev fallback;
- `server/config.py:234-267` — `check_production_secrets()`;
- `docker-compose.yml` — `VUTT_ENV=${VUTT_ENV:-dev}` ja secretite fallbackid.

Koodis on juba kaitse: kui `VUTT_ENV=production`, siis `check_production_secrets()` keeldub käivitumast dev-secretitega. Kontroll käivitatakse mooduli importimisel (`server/config.py:267`).

**Reaalne küsimus:** kas tootmise `.env`-is on `VUTT_ENV=production` päriselt seatud?

**Kontroll serveris:**

```bash
ssh vutt
grep -E 'VUTT_ENV|IMAGE_TOKEN_SECRET|MEILI_MASTER_KEY' ~/VUTT/.env
```

Oodatav:

```bash
VUTT_ENV=production
IMAGE_TOKEN_SECRET=<päris juhuslik väärtus>
MEILI_MASTER_KEY=<päris juhuslik väärtus>
```

Kui `VUTT_ENV` puudub või on `dev`, siis startup-kontroll ei rakendu. See on konfiguratsiooniprobleem, mitte uus koodiviga.

**Prioriteet:** kontrollida kohe. Koodimuudatust pole vaja, kui `.env` on korras.

---

## 7. `crossLangTypeMap` / `crossLangGenreMap` eemaldamise eeltingimus

**Viide:** `src/components/AdvancedFilters.tsx:185-210`.

Koodis on juba TODO: mapid võib eemaldada, kui kõigil teostel on `type_ids` ja `genre_ids` indekseeritud.

**Oluline:** seda ei saa kindlalt kontrollida lokaalses koopias, sest lokaalne masin ei peegelda serveri `data/` ega Meilisearchi sisu.

**Soovituslik protsess:**
1. kontrollida serveri Meilisearchis, kui palju dokumente on ilma `type_ids`/`genre_ids` väljadeta;
2. kui leidub, käivitada serveris reindekseerimine (`./scripts/server_seed_data.sh`);
3. kontrollida uuesti;
4. alles siis eemaldada fallback-mapid frontendist.

**Prioriteet:** keskmine, aga ainult pärast andmekontrolli.

---

## 8. Testilüngad

Reaalselt puuduvad või vajavad täiendust:

| Teema | Viide | Soovitus |
|-------|-------|----------|
| `check_rate_limit` | `server/rate_limit.py:101` | lisada testid olemasolevasse `tests/test_login_throttle.py` |
| `trash_ops.py` | `server/trash_ops.py` | lisada baas-testid prügikasti operatsioonidele |
| `poll_reocr_job` | `server/reocr_ops.py:466` | lisada test mockitud OCR/SFTP olekutega |
| `fetchWithTimeout` | `src/utils/fetchWithTimeout.ts` | testida timeout/abort/error handling |
| `entityLabelsService.ts` | `src/services/entityLabelsService.ts` | fetch-mock testid |
| `collectionService.ts` | `src/services/collectionService.ts` | fetch-mock testid + värvide helperid kui katmata |
| `workService.ts` | `src/services/workService.ts` | fetch-mock testid |
| username derivation | `server/registration.py:117,122,149` | testida `_base_username_from_email`, `_next_available_username`, `suggest_username_for_email` |
| `parse_year_range` edge case’id | `server/utils.py:121`, `tests/test_year_range.py` | lisada puuduvad piirjuhtumid, kui neid tuvastatakse |

**`check_rate_limit` soovitatud testid:**
- tundmatu endpoint → `(True, 0)`;
- limiidi all lubab;
- limiit täis → `(False, retry_after > 0)`;
- akna aegumine lubab uuesti;
- eri IP-d ja endpointid on isoleeritud.

**Prioriteet:** madal. Testid võib jagada eraldi PR-i.

---

## 9. Kommenteeritud vana OCR prompt

**Viide:** `loss/kataloogi-jalgimine-ja-ocr.py:94-119`.

Seal on vana `INSTRUCTION_OLD` prompt plokk-kommentaarina. Kui seda ei kasutata dokumentatsioonina, kustutada. Kui soovitakse säilitada ajaloo tõttu, tõsta pigem `docs/` alla.

**Prioriteet:** triviaalne cleanup.

---

## Soovitatav implementatsioonijärjekord

### Kiire madala riskiga PR

1. Kustutada vana OCR prompt plokk või tõsta dokumentatsiooni.
2. Lisada `_ssh_rm_rf` helper + asendada 3 `exec_command` kohta.
3. Parandada blocking-I/O endpointid:
   - `admin_collection_works_count` → `def`;
   - `get_work_meta_direct` faililugemine `run_in_threadpool` kaudu.
4. Lisada `check_rate_limit` testid.

### Eraldi PR-id

1. `trash_ops.py` ja `poll_reocr_job` testid.
2. `sync_work_to_meilisearch` fixture/snapshot-test + refaktooring.
3. `save_and_transfer_to_ocr` järkjärguline refaktooring.
4. `crossLang*Map` eemaldamine pärast serveri Meilisearchi andmekontrolli.

---

## Kontrollkäsud

```bash
# Suured funktsioonid
awk '/^def sync_work_to_meilisearch\(dir_name\)/{s=NR} s&&/^def /&&NR>s{print NR-s" rida"; exit}' server/meilisearch_ops.py
awk '/^def save_and_transfer_to_ocr\(/{s=NR} s&&/^def /&&NR>s{print NR-s" rida"; exit}' server/upload_ops.py

# OCR cleanup shellkäsud
grep -n "exec_command" server/upload_ops.py

# Blocking-I/O endpointid
grep -n "def get_work_meta_direct\|def admin_collection_works_count" server/main.py

# Testilüngad
grep -R "check_account_lockout" -n tests/
grep -R "check_rate_limit" -n tests/ || true

# Tootmisseadistus serveris
ssh vutt 'grep -E "VUTT_ENV|IMAGE_TOKEN_SECRET|MEILI_MASTER_KEY" ~/VUTT/.env'
```
