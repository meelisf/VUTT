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
| Upload-link | Deep-link `/upload?resumeUpload={id}` → progress kohe näha |
| Tarne | Kaks faasi: Komponent 1 (backend, parandab kohe) → Komponent 2 (feature) |

## Arhitektuur

### Komponent 1 — Recovery hardening (backend, faas 1)

**1a. Taastatud `page_number` (bugfix).**
`server/reocr_recovery.py` `_resolve_job_meta` tagastab lisaks `page_number` (loetud sama logi-error-kirjest, kust `page_filename` tuleb). `_recover_one` recovery-sündmus (`_append_to_log`) salvestab `page_number` → link + "lk N" ilmuvad. Frontend link-tingimust lõdvendatakse: `work_id` olemas → link (lehele kui `page_number`, muidu teosele).

**1b. Batch logimine.**
`server/reocr_ops.py` `_poll_batch_job` (ja batch abs-timeout/inactivity haru) lisab iga lahenenud lehe kohta `reocr_log`-i kirje: `{job_id, work_id, slug, page_filename, page_number, username, status: "done"|"error", started_at, finished_at}`. Nii on batch-tulemused ajaloos JA reaperi jaoks mappitavad. Idempotentne: leht logitakse ainult üleminekul `processing → ready/error` (mitte igal pollil).

**1c. Batch-orbude taaste.**
`server/reocr_recovery.py` reaper laiendatud: staging-kaustas mitme `{slug}_pg_NNN.txt` korral (batch) taastab iga lehe, kasutades `reocr_log` per-lehe kirjeid (`job_id` + `remote_txt_name`/`_pg_NNN` → `page_filename`). Skoop: batch-kaust tuvastatakse >1 `_pg_NNN.txt` järgi VÕI job puudub üksik-`_pg_001` mustrist. Praegune 5 orvu (enne 1b logimist tehtud) jääb käsitsi — mapping puudub, reaper `skip`.

### Komponent 2 — Ühtne OCR-tööde vaade (faas 2)

**2a. Backend ühtne endpoint** `GET /admin/ocr/jobs` (`server/routers/reocr.py` või uus `ocr_jobs.py`):
normaliseerib upload-tööd (`list_uploads`) + re-OCR (`list_reocr_jobs` üksik + batch-summaarid) ÜHE kujuni. Normaliseerija on **puhas funktsioon** (testitav): `normalize_ocr_jobs(uploads, reocr_jobs) -> list`.

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
- Ajajärjestatud (`started_at` DESC).
- Säilib olemasolev "Ajalugu" (püsiv `reocr_log`) sektsioon all — nüüd ka batch-kirjetega (1b).

**2c. Upload deep-link** `src/pages/upload/useUploadWizard.ts`:
- Loe `searchParams.get('resumeUpload')` mount'il. Kui `pendingUploads` laetud ja match leitud (ja veel resume'imata — `useRef` valvur), kutsu olemasolev `handleResume(saved)`. Ei muuda `handleResume` loogikat.

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

## Testid (`.venv/bin/python -m pytest` + `npm run typecheck`)

**Faas 1:**
- `test_resolve_job_meta_includes_page_number`: logi-error-kirjest loetakse `page_number`.
- `test_recovery_event_has_page_number`: taastatud kirje sisaldab `page_number`-i.
- `test_batch_page_logged_on_ready`: batch leht `ready` → `reocr_log` kirje `page_number`-iga.
- `test_batch_page_logged_once`: sama leht ei logita topelt (idempotentsus).
- `test_reaper_recovers_batch_orphan_from_log`: batch-staging (mitu `_pg_NNN`) + logi → taastatud.

**Faas 2:**
- `test_normalize_upload_job`: upload reviewing → `status_key=review`, `link=/upload?resumeUpload=…`, `progress`.
- `test_normalize_reocr_single`: done + page_number → `link=/work/{id}/{lk}`.
- `test_normalize_reocr_batch`: `type=batch`, `link=/work/{id}`, `progress`.
- `test_normalize_missing_fields_safe`: puuduv title → slug; puuduv work_id → link fallback.
- Frontend: `npm run typecheck`; olemasolevad upload/reocr testid ei regresseeru.

## Tarne (kaks faasi)

- **Faas 1 (PR): recovery hardening** — 1a+1b+1c. Backend `--no-cache` deploy. Parandab lingid + batch-taaste kohe.
- **Faas 2 (PR): ühtne vaade** — 2a+2b+2c. Backend + frontend deploy.

## Väljaspool skoopi

- Tegevuste (import/apply) toomine Review-lehele — jäävad oma lehtedele (otsus: ühtne nähtavus).
- Praeguse 5 batch-orvu automaatne taaste — mapping kadunud, käsitsi.
- OCR-serveri päris järjekorra-API — `queue_ahead` lokaalne lähend piisab (eelmine spec).
- Upload-tööde `reocr_log`-i-laadne püsiv ajalugu — uploadid kaovad importimisel; koondvaade näitab aktiivseid + re-OCR ajalugu.

## Issue #65 mõju

Komponent 1 on `reocr_ops.py`/`reocr_recovery.py`-s (ei mõjuta). Komponent 2a normaliseerija loeb `list_uploads` (upload_ops) + `list_reocr_jobs` — ainult LUGEMINE avalike funktsioonide kaudu; kui #65 splitib upload_ops, muutub ainult import. Normaliseerija ise võiks elada uues `server/routers/ocr_jobs.py`-s (puhas, upload_ops-ist sõltumatu peale ühe import-rea).
