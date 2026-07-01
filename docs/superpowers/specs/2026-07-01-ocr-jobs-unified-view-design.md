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
| Batch-orbud | Logi batch edaspidi `reocr_log`-i → reaper taastab edaspidised batch-orvud; praegune 5 (mapping kadunud) käsitsi/jäta |
| Batch idempotentsus | **Logi vastu, MITTE mälu vastu** — `_batch_logged_txt_names(job_id)` loeb logist, restart-kindel (review-punkt 1) |
| Recovery-tee | **ÜKS koodirada** — mappi `(job_id, remote_txt_name)` järgi; single/batch eristust pole (review-punkt 3) |
| Reaper-turvalisus | Puutub ainult töid, mida POLE `_reocr_jobs` EGA `_reocr_batch_jobs`-is; claim per `(job_id, remote_txt_name)` (review-punkt 2) |
| Logi maht | `REOCR_LOG_MAX` 500 → 5000; pagineeritud; skip-hoiatus üks kord/protsess (review-punkt 4, 7) |
| Upload-link | Deep-link `/upload?resumeUpload={id}` → progress kohe näha; param eemaldatakse pärast resume't (review-punkt 5) |
| Tarne | Kaks faasi: Komponent 1 (backend, parandab kohe) → Komponent 2 (feature) |

## Arhitektuur

### Komponent 1 — Recovery hardening (backend, faas 1)

**1a. Taastatud `page_number` (bugfix).**
`server/reocr_recovery.py` `_resolve_job_meta` tagastab lisaks `page_number` (loetud sama logi-error-kirjest, kust `page_filename` tuleb). `_recover_one` recovery-sündmus (`_append_to_log`) salvestab `page_number` → link + "lk N" ilmuvad. Frontend link-tingimust lõdvendatakse: `work_id` olemas → link (lehele kui `page_number`, muidu teosele).

**1b. Batch logimine — idempotentsus LOGI vastu (mitte mälu vastu).**
`server/reocr_ops.py` `_poll_batch_job` (ja batch abs-timeout/inactivity haru) lisab iga lahenenud lehe kohta `reocr_log`-i kirje. Kirje sisaldab **`remote_txt_name`** (nt `{slug}_pg_007.txt`), et taaste saaks staging-faili → page_filename mappida:
```
{job_id, work_id, slug, page_filename, page_number, remote_txt_name, username,
 status: "done"|"error", started_at, finished_at}
```
**Idempotentsus on logi vastu, MITTE in-memory "eelmine seis" vastu** (see kaoks restardil → topeltkirje või puuduv kirje). Helper `_batch_logged_txt_names(job_id) -> set` loeb `reocr_log`-ist selle job_id juba-logitud `remote_txt_name`-id; leht logitakse AINULT kui tema `remote_txt_name` pole hulgas. Nii on log-i seis taastuv üle restardi ja 1c vundament kindel. **NB: üksik-lehe logimine (`start_reocr_job` done/error) saab samuti `remote_txt_name` välja** (alati `{slug}_pg_001.txt`), et recovery-tee oleks ÜKS.

**1c. Batch-orbude taaste — ÜKS koodirada (single/batch eristust POLE).**
`server/reocr_recovery.py` reaper: iga staging-faili `{slug}_pg_NNN.txt` korral (olgu üksik `_pg_001` või batch `_pg_NNN`) lahenda page_filename `reocr_log`-ist matchides `job_id` JA `remote_txt_name == {slug}_pg_NNN.txt` (tagurpidiühilduvus: kui logi-kirjel pole `remote_txt_name`-i — vana üksik-kirje — ja job_id-l on ainult üks kirje, kasuta seda). Batch-heuristikat (">1 _pg_NNN") EI ole vaja — üks tee katab mõlemad.
**Reaper puutub AINULT töid, mida aktiivses mälus POLE** (ei `_reocr_jobs` ega `_reocr_batch_jobs`) → väldib elava polleri ja reaperi võidujooksu batch-lehtede kirjutamisel. Claim-mehhanism (eelmisest spec'ist) laiendatakse batch-lehe granulaarsuseni: claim per `(job_id, remote_txt_name)`.
Praegune 5 orvu (enne 1b logimist tehtud) jääb käsitsi — mapping puudub, reaper `skip`.

**1d. Logi maht ja skip-müra (teadlik otsus).**
Per-lehe batch-logimine tähendab, et 400-leheline batch = 400 kirjet. `reocr_log` on **cap'itud** (`REOCR_LOG_MAX`, praegu 500, kärbib viimase N-ni) ja `get_reocr_log` on **pagineeritud** (50/lk). Otsus: **tõsta `REOCR_LOG_MAX` 5000-ni**, et suured batch'id ei sööks ajalugu tühjaks (5000-kirjeline JSON-fail loeb ikka <ms). Aktsepteerime kärpe 5000 juures; kui kunagi liiga aeglane, siis rotatsioon (out of scope). **Skip-müra:** reaper hoiab protsessi-taseme `_warned_skips` set'i → sama unmappable `job_id` hoiatust logitakse ÜKS kord (mitte igal 5-min skannil). Praegune 5 orvu koristatakse **käsitsi Faas 1 deploy'l** (nende `job_id`-d on logides), et need üldse kaoksid staging'ust.

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
  batch _poll_batch_job → leht ready/error → _append_to_log (per leht)
  reaper scan → batch staging (_pg_NNN) → log-mapping → _write_ocr_file → recovery event
  reaper üksik → _resolve_job_meta (nüüd + page_number) → recovery event page_number-iga

Faas 2:
  GET /admin/ocr/jobs → normalize_ocr_jobs(list_uploads(), list_reocr_jobs())
                      → ühtne nimekiri (title-enrich, status_key, link)
  Review.tsx → üks nimekiri, tüübi-badge, järjekindel link
  upload link → /upload?resumeUpload={id} → handleResume → progress kohe
```

## Veakäsitlus

- `normalize_ocr_jobs` on puhas: vigane/puuduv väli → turvaline vaikeväärtus (title=slug, progress=None), ei crash'i.
- Batch logimine idempotentne (üleminekul, mitte igal pollil) → logi ei paisu.
- Reaper batch-taaste per-leht isoleeritud; puuduv mapping → `skip` + hoiatus (ei arva lehte).
- Deep-link: puuduv/vale `resumeUpload` id → ignoreeritakse vaikselt (jääb tavaline `/upload` vaade).
- `page_number` puudub taastatud üksik-kirjel (vana, 1a-eelne) → link teosele (fallback), mitte katki.
- **Upload import-viga** (`import_as_work` ebaõnnestus) → upload state `error` + `error_message` → normaliseerija `status_key=error`, `link=/upload?resumeUpload={id}` (admin näeb/proovib uuesti). Sama rida mis muud error'id.
- **Sort `started_at=None`** → normaliseerija coerc'ib `0.0`, ei crash'i.
- **Reaper skip-müra:** unmappable `job_id` hoiatus ÜKS kord protsessi kohta (`_warned_skips`).

## Testid (`.venv/bin/python -m pytest` + `npm run typecheck`)

**Faas 1:**
- `test_resolve_job_meta_includes_page_number`: logi-error-kirjest loetakse `page_number`.
- `test_recovery_event_has_page_number`: taastatud kirje sisaldab `page_number`-i.
- `test_batch_page_logged_on_ready`: batch leht `ready` → `reocr_log` kirje `page_number` + `remote_txt_name`-iga.
- `test_batch_page_logged_once_across_restart`: `_batch_logged_txt_names` loeb logist → juba-logitud leht EI logita uuesti, ka kui in-memory seis tühi (restart-simulatsioon). **(review-punkt 1)**
- `test_reaper_recovers_batch_orphan_from_log`: batch-staging (mitu `_pg_NNN`) + per-lehe logi → kõik lehed taastatud õigetele `page_filename`-idele.
- `test_reaper_skips_live_batch_job`: kui `job_id` on `_reocr_batch_jobs`-is aktiivne, reaper EI puutu selle staging'ut. **(review-punkt 2)**
- `test_reaper_single_path_matches_by_remote_txt_name`: nii üksik (`_pg_001`) kui batch-fail lahendatakse ÜHE tee kaudu (`job_id`+`remote_txt_name`); vana kirje ilma `remote_txt_name`-ita → job_id-fallback.

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
