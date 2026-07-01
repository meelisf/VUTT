# OCR-tööde koondvaade + recovery hardening

**Kuupäev:** 2026-07-01
**Staatus:** disain kinnitatud, ootab implementatsiooni-plaani
**Eelnev:** `2026-07-01-reocr-slow-jobs-recovery-design.md` (slow-lipp + orbude taaste, deploy'tud)

## Probleem

Kaks eraldi tähelepanekut deploy'tud re-OCR recovery järel:

1. **Batch-orbe ei taastata + logi puudub.** Batch re-OCR tööd EI lähe `reocr_log`-i (ainult üksik-lehe tööd). Startup-recovery jättis 5 batch-orvu vahele (`skip 5`), sest mapping `{slug}_pg_NNN → page_filename` elab ainult batch-jobi mälus.

2. **Nähtavus killustatud + lingid ebajärjekindlad.** Review-lehe OCR-nimekiri näitab AINULT üksik-lehe re-OCR töid. Kui keegi laadib teose üles (`/upload`), seda seal ei näe — peab vaatama eraldi lehel. Lisaks: mõnel kirjel puudub link teosele (rohelised taastatud), teisel on (punased). Kasutaja: "natuke raske on aru saada, mis toimub, mis staatus on."

**Lingi-ebajärjekindluse juurpõhjus:** link renderdatakse ainult kui `work_id && page_number`. Reaperi taastatud kirjed salvestasid `page_filename`, aga MITTE `page_number` → `page_number=None` → pole linki ega "lk N".

## Otsused (kinnitatud)

| Teema | Otsus |
|-------|-------|
| Koondvaate roll | Ühtne **nähtavus**; tegevused (import, .ocr rakendus) jäävad oma lehtedele, koondvaatest lingid sinna |
| Lingi siht | Leht (`/work/{id}/{lk}`) kui `page_number` teada; muidu teos (`/work/{id}`); upload → `/upload` deep-link. Iga kirje ALATI klõpsatav |
| Paigutus | ÜKS ajajärjestatud nimekiri, iga rida märgib tüübi (Upload / Re-OCR / Batch) |
| Batch-orbud | **Püsiv batch-mapping fail** (`state/reocr_batch_maps/{job_id}.json`) batch ALGUSES → reaper taastab; praegune 5 (mapping kadunud) käsitsi |
| Batch mapping püsivus | Fail kirjutatud alguses, kustutatud koristusel → restart/error/crash-kindel (review-punkt 1); orb EI valmi kunagi, seega valmimis-logimine EI sobiks |
| Recovery-eristaja | **Deterministlik: mapping-fail olemas → batch, muidu üksik (log)** — mitte `_pg_NNN`-loenduse heuristika (review-punkt 3) |
| Reaper-turvalisus | Puutub ainult töid, mida POLE `_reocr_jobs` EGA `_reocr_batch_jobs`-is; claim per `(job_id, remote_txt_name)` (review-punkt 2) |
| Logi maht | `REOCR_LOG_MAX` jääb 500 (batch ei floodi logi — mapping eraldi failis); skip-hoiatus üks kord/protsess (review-punkt 4, 7) |
| Upload-link | Deep-link `/upload?resumeUpload={id}` → progress kohe näha; param eemaldatakse pärast resume't (review-punkt 5) |
| Tarne | Kaks faasi: Komponent 1 (backend, parandab kohe) → Komponent 2 (feature) |

## Arhitektuur

### Komponent 1 — Recovery hardening (backend, faas 1)

**1a. Taastatud `page_number` (bugfix).**
`server/reocr_recovery.py` `_resolve_job_meta` tagastab lisaks `page_number` (loetud sama logi-error-kirjest, kust `page_filename` tuleb). `_recover_one` recovery-sündmus (`_append_to_log`) salvestab `page_number` → link + "lk N" ilmuvad. Frontend link-tingimust lõdvendatakse: `work_id` olemas → link (lehele kui `page_number`, muidu teosele).

**KRIITILINE mõistmine (miks mitte "logi valmimisel"):** batch-**orb** on leht, mis EI valmi
kunagi VUTT-i poolel — OCR tootis `.txt` serverisse, aga VUTT kaotas jobi (restart/crash/12h-error)
ENNE allalaadimist. Leht jääb `processing`-uks → valmimis-logimine EI salvesta selle mappingut.
Seega mapping `_pg_NNN → page_filename` peab olema **püsiv batch'i ALGUSEST**. (Batch restardi-kadu
on juba kaetud — batch persist'itakse `reocr_active.json`-i ja resume'ib. Jääb 12h-error-siis-hiline-txt.)

**1b. Püsiv batch-mapping fail (recovery vundament).**
`server/reocr_state.py` saab batch-mapping'u püsivuse (eraldi aktiivsete tööde failist):
- `persist_batch_mapping(job_id, work_id, slug, pages) -> None` — kirjutab
  `state/reocr_batch_maps/{job_id}.json` = `{work_id, slug, pages: {remote_txt_name: {page_filename, page_number}}}`.
  Kutsutakse `start_reocr_batch`-is (batch ALGUSES, `_build_batch_pages` järel). Atomaarne (tmp+replace). Idempotentne.
- `load_batch_mapping(job_id) -> dict|None` — reaperile.
- `remove_batch_mapping(job_id) -> None` — kutsutakse kui batch täielikult koristatud (kõik lehed
  resolved + staging eemaldatud `_poll_batch_job`-is) VÕI reaper koristas staging'u.
- `list_batch_mapping_ids() -> list` — job_id-d, millel mapping-fail (reaperile eristajaks).

See on **restart-, error- JA crash-kindel** (fail kirjutatud alguses, kustutatakse alles koristusel)
ja hoiab `reocr_log`-i puhtana (EI floodi ajalugu 400 kirjega — dissolveerib logi-mahu mure).

**1c. Batch-orbude taaste — deterministlik eristaja (mitte habras heuristika).**
`server/reocr_recovery.py` reaper, iga staging job_id-kausta korral:
- **Eristaja = `load_batch_mapping(job_id)`.** Kui mapping olemas → **batch**: iga staging-fail
  `{slug}_pg_NNN.txt` → `page_filename` = `mapping["pages"][remote_txt_name]` → `_write_ocr_file` →
  recovery-sündmus (`page_number`-iga). Kui mapping puudub → **üksik**: nagu praegu, `reocr_log`
  `job_id` järgi (`_pg_001`). Ei mingit `_pg_NNN`-loenduse heuristikat.
- **Reaper puutub AINULT töid, mida aktiivses mälus POLE** (ei `_reocr_jobs` EGA `_reocr_batch_jobs`)
  → väldib elava polleri ja reaperi võidujooksu. Claim per `(job_id, remote_txt_name)`.
- Batch täielikult taastatud/koristatud → `remove_batch_mapping(job_id)`.
Praegune 5 orvu (enne 1b mapping'ut tehtud) jääb käsitsi — mapping puudub, reaper `skip`.

**1d. Skip-müra.**
Reaper hoiab protsessi-taseme `_warned_skips` set'i → sama unmappable `job_id` hoiatust logitakse
ÜKS kord (mitte igal 5-min skannil). Praegune 5 orvu koristatakse **käsitsi Faas 1 deploy'l**, et
need staging'ust kaoksid. **`reocr_log` cap jääb 500-ks** (batch ei floodi enam logi → mahumure kadus).

### Komponent 2 — Ühtne OCR-tööde vaade (faas 2)

**2a. Backend ühtne endpoint** `GET /admin/ocr/jobs` (uus `server/routers/ocr_jobs.py`):
normaliseerib upload-tööd (`list_uploads`) + re-OCR (`list_reocr_jobs` üksik + batch-summaarid) ÜHE kujuni. Normaliseerija on **puhas funktsioon** (testitav, DOM-/IO-vaba): `normalize_ocr_jobs(uploads, reocr_jobs, title_of) -> list`, kus `title_of(work_id) -> str` on süstitav (test annab lambda; endpoint annab cache'itud lugeja). **Title-cache:** endpoint kasutab lühikese TTL-iga cache'i `work_id → title` (`server/cache.py` muster), et vältida N `_metadata.json` avamist igal 4s pollil.

Ühtne kirje:
```
{
  "id": str,                      # upload_id VÕI reocr job_id
  "type": "upload"|"reocr"|"batch",
  "title": str,                   # teose pealkiri (upload meta / _metadata.json)
  "slug": str,                    # tehniline, OCR-serveris vaatamiseks
  "work_id": str|None,            # None upload-il enne importi
  "page_number": int|None,        # re-OCR üksik; None batch/upload
  "status_key": str,              # normaliseeritud (vt allpool)
  "slow": bool,                   # re-OCR slow-lipp
  "started_at": float|None,
  "progress": {"ready": int, "total": int}|None,  # upload + batch; None üksik
  "link": str,                    # eelarvutatud siht (vt Lingi siht)
  "error": str|None
}
```

**Status_key normaliseerimine:**
| Allikas (upload / reocr) | status_key | Kuva (i18n) | Tegevus |
|--------------------------|-----------|-------------|---------|
| upload: pending/uploading/collecting_images | `uploading` | "üleslaadimine" | — |
| upload+reocr: processing | `processing` | "OCR töötleb" | — |
| (processing + slow=true) | `processing` +slow | "aeglane, töötab edasi" | — |
| upload: reviewing/done | `review` | "ülevaatusel" | → impordi |
| reocr: done | `ready` | "valmis" | → rakenda (Manage) |
| upload: imported | `imported` | "imporditud" | → teos |
| upload+reocr: error | `error` | "viga" | → leht/teos |

**Lingi siht (backend arvutab):**
- reocr üksik done/error: `/work/{work_id}/{page_number}` kui `page_number`, muidu `/work/{work_id}`
- reocr batch: `/work/{work_id}` (mitu lehte)
- upload aktiivne/review: `/upload?resumeUpload={upload_id}`
- upload imported: `/work/{work_id}` (kui teada)

**2b. Frontend** `src/pages/Review.tsx`:
- Asenda re-OCR-spetsiifiline nimekiri ühtse nimekirjaga, mis loeb `/admin/ocr/jobs`.
- Iga rida: tüübi-badge (Upload/Re-OCR/Batch), `title` + `slug` (monospace tehniline), `status_key` kuva, `slow` kollane märk, kulunud aeg (aktiivsele), `progress` "X/Y lk" (upload/batch), link (`link` väljalt).
- Ajajärjestatud `started_at` DESC. **Sort-võti coerc'itakse `started_at or 0`** (None → 0 → järjestuse lõppu), et vältida `TypeError`-it (Py) / ebastabiilset võrdlust (JS) kui `started_at=None`. Normaliseerija väljastab alati võrreldava `started_at` (float, vaikimisi 0.0).
- Säilib olemasolev "Ajalugu" (püsiv `reocr_log`) sektsioon all — nüüd ka batch-kirjetega (1b).

**2c. Upload deep-link** `src/pages/upload/useUploadWizard.ts`:
- Loe `searchParams.get('resumeUpload')`. Resume-loogika elab **effect'is, mis sõltub `pendingUploads` laadimisest** (mitte paljast mount'ist, sest nimekiri laetakse asünkroonselt). Kui match leitud ja veel resume'imata (`useRef` valvur), kutsu olemasolev `handleResume(saved)` (loogikat ei muuda).
- **Pärast õnnestunud resume't `navigate(pathname, { replace: true })`** — eemalda `resumeUpload` param, et back/forward remount ei käivitaks resume't uuesti. Puuduv/vale id → ignoreeritakse vaikselt.

## Andmevoog

```
Faas 1:
  start_reocr_batch → persist_batch_mapping(job_id, pages)  [state/reocr_batch_maps/]
  _poll_batch_job → kõik lehed resolved + staging koristatud → remove_batch_mapping(job_id)
  reaper scan, iga job_id-kaust:
    load_batch_mapping(job_id)?  ── jah → BATCH: iga _pg_NNN → mapping[pages] → recover → remove_mapping
                                 └─ ei  → ÜKSIK: reocr_log (job_id, _pg_001) → recover
    (skip kui job_id aktiivne _reocr_jobs VÕI _reocr_batch_jobs-is)
  reaper üksik → _resolve_job_meta (nüüd + page_number) → recovery event page_number-iga

Faas 2:
  GET /admin/ocr/jobs → normalize_ocr_jobs(list_uploads(), list_reocr_jobs(), title_of)
                      → ühtne nimekiri (status_key, eelarvutatud link, sort started_at or 0)
  Review.tsx → üks nimekiri, tüübi-badge, järjekindel link
  upload link → /upload?resumeUpload={id} → handleResume → progress kohe
```

## Veakäsitlus

- `normalize_ocr_jobs` on puhas: vigane/puuduv väli → turvaline vaikeväärtus (title=slug, progress=None), ei crash'i.
- Batch-mapping fail atomaarne (tmp+replace); vigane/puuduv → `None` (üksik-tee fallback), ei crash'i.
- Reaper batch-taaste per-leht isoleeritud; mapping'us puuduv `_pg_NNN` → `skip` + hoiatus (ei arva lehte).
- Deep-link: puuduv/vale `resumeUpload` id → ignoreeritakse vaikselt (jääb tavaline `/upload` vaade).
- `page_number` puudub taastatud üksik-kirjel (vana, 1a-eelne) → link teosele (fallback), mitte katki.
- **Upload import-viga** (`import_as_work` ebaõnnestus) → upload state `error` + `error_message` → normaliseerija `status_key=error`, `link=/upload?resumeUpload={id}` (admin näeb/proovib uuesti). Sama rida mis muud error'id.
- **Sort `started_at=None`** → normaliseerija coerc'ib `0.0`, ei crash'i.
- **Reaper skip-müra:** unmappable `job_id` hoiatus ÜKS kord protsessi kohta (`_warned_skips`).

## Testid (`.venv/bin/python -m pytest` + `npm run typecheck`)

**Faas 1:**
- `test_resolve_job_meta_includes_page_number`: logi-error-kirjest loetakse `page_number`.
- `test_recovery_event_has_page_number`: taastatud kirje sisaldab `page_number`-i.
- `test_batch_mapping_roundtrip`: `persist_batch_mapping` → `load_batch_mapping` tagastab sama; `remove_batch_mapping` kustutab; puuduv → None. **(review-punkt 1)**
- `test_batch_mapping_persisted_at_start`: `start_reocr_batch` kirjutab mapping-faili (pages: remote_txt_name → page_filename+page_number).
- `test_reaper_recovers_batch_orphan_via_mapping`: batch-staging (mitu `_pg_NNN`) + mapping-fail → kõik lehed taastatud õigetele `page_filename`-idele, `page_number`-iga.
- `test_reaper_single_when_no_mapping`: mapping-fail puudub → üksik-tee (log `job_id` järgi, `_pg_001`).
- `test_reaper_skips_live_batch_job`: kui `job_id` on `_reocr_batch_jobs`-is aktiivne, reaper EI puutu selle staging'ut. **(review-punkt 2)**
- `test_reaper_removes_mapping_after_recovery`: batch täielikult taastatud → mapping-fail kustutatud.

**Faas 2:**
- `test_normalize_upload_job`: upload reviewing → `status_key=review`, `link=/upload?resumeUpload=…`, `progress`.
- `test_normalize_reocr_single`: done + page_number → `link=/work/{id}/{lk}`.
- `test_normalize_reocr_batch`: `type=batch`, `link=/work/{id}`, `progress`.
- `test_normalize_missing_fields_safe`: puuduv title → slug; puuduv work_id → link fallback; **`started_at=None` → sort-võti 0.0, sort ei crash'i (review-punkt 6)**.
- `test_normalize_upload_import_error`: upload import-viga → `status_key=error`, `link=/upload?resumeUpload=…`.
- Frontend: `npm run typecheck`; olemasolevad upload/reocr testid ei regresseeru. Deep-link resume käivitub `pendingUploads` laadimisel (mitte enne), param eemaldatakse pärast (review-punkt 5).

## Tarne (kaks faasi)

- **Faas 1 (PR): recovery hardening** — 1a+1b+1c+1d. Backend `--no-cache` deploy. Parandab lingid + batch-taaste kohe. **Deploy-samm:** korista käsitsi praegune 5 unmappable batch-orvu staging'ust (nende `job_id`-d logides), et skip-müra kaoks.
- **Faas 2 (PR): ühtne vaade** — 2a+2b+2c. Backend + frontend deploy.

## Väljaspool skoopi

- Tegevuste (import/apply) toomine Review-lehele — jäävad oma lehtedele (otsus: ühtne nähtavus).
- Praeguse 5 batch-orvu automaatne taaste — mapping kadunud, käsitsi.
- OCR-serveri päris järjekorra-API — `queue_ahead` lokaalne lähend piisab (eelmine spec).
- Upload-tööde `reocr_log`-i-laadne püsiv ajalugu — uploadid kaovad importimisel; koondvaade näitab aktiivseid + re-OCR ajalugu.

## Issue #65 mõju

Komponent 1 on `reocr_ops.py`/`reocr_recovery.py`-s (ei mõjuta). Komponent 2a normaliseerija loeb `list_uploads` (upload_ops) + `list_reocr_jobs` — ainult LUGEMINE avalike funktsioonide kaudu; kui #65 splitib upload_ops, muutub ainult import. Normaliseerija ise võiks elada uues `server/routers/ocr_jobs.py`-s (puhas, upload_ops-ist sõltumatu peale ühe import-rea).
