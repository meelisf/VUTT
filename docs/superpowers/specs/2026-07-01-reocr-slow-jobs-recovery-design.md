# Re-OCR: "aeglane, aga elav" tööd + orbude taaste + nähtavus

**Kuupäev:** 2026-07-01
**Staatus:** disain kinnitatud, ootab implementatsiooni-plaani
**Seotud:** issue #65 (upload_ops modulariseerimine — EI mõjuta, vt allpool)

## Probleem

Re-OCR tööd, mis võtavad OCR-serveris kaua (järjekord / suur teos), märgitakse
30 min pärast ekslikult veaks ja nende valmis tulemus jääb OCR-serverisse orvuks.

**Konkreetne tõend (2026-07-01):** Review-lehe "Viimased muudatused" näitas kolme
kirjet `1650-7-In_salutiferam_nativitatem_Domini_et_Salvatoris_no...` (lehed 9, 10, 11)
staatusega **"Viga — Aegumine: OCR server ei vastanud 30 minuti jooksul."** Samal ajal
oli serveris `..._pg_001.txt` **täielikult valmis**. Tulemus jäi kättesaamatuks.

### Juurpõhjus

`server/reocr_ops.py` `_reocr_poll_loop` (u rida 352–376):

```python
if now - job.get("started_at", now) > REOCR_PROCESSING_TIMEOUT:  # 1800s
    _reocr_jobs[jid]["status"] = "error"
    _reocr_jobs[jid]["error"] = "Aegumine: OCR server ei vastanud 30 minuti jooksul."
```

Kaks viga:
1. **Deadline mõõdetakse `started_at`-ist** (üleslaadimise hetk), mitte hetkest kui OCR
   *tegelikult tööd alustab*. Kui OCR-serveril on järjekord, põletab töö oma 30-min
   eelarve järjekorras oodates.
2. **Timeout märgib `error` ilma kontrollimata, kas tulemus on serveris olemas.** Pärast
   `error`-it `poll_reocr_job` short-circuitib (`if current in ("uploading","done","error")`)
   ega lae tulemust enam kunagi alla. Hiljem valmiv `.txt` jääb OCR-serverisse orvuks.

**Kontrast:** upload-tee (`upload_ops.py` `_is_stalled`) teeb juba õigesti — 30-min stall
on ainult *nõuandev*, ei muuda staatust ega katkesta. Re-OCR teeb valesti (kõva `error`).

### Rakendamise mehhanism (taust)

Valmis re-OCR tekst kirjutatakse `{BASE_DIR}/{slug}/{stem}.ocr` faili (`_write_ocr_file`),
kus `stem = splitext(page_filename)[0]`. Kasutaja rakendab `.ocr` → lehe tekst Manage-lehel.
**Sihtlehe määrab ainult `page_filename`.** See on salvestatud mälus (`_reocr_jobs`) ja
`reocr_log`-is (`_append_to_log`), MITTE OCR-serveri staging-tee sees (seal alati `_pg_001`).

OCR-serveril **pole järjekorra-API-t** — suhtlus on puhtalt SFTP faili-drop + tulemuse
pollimine + `rm -rf` koristus. Staging-tee: `AUTO-OCR/{material_type}/{job_id}/{slug}/{slug}_pg_001.txt`,
kus `material_type ∈ {print, hand}`.

## Otsused (kinnitatud)

| Teema | Otsus |
|-------|-------|
| Timeout-käitumine | **Ei loobu** — 30 min ei lõpeta tööd. `status` jääb `processing`, lisandub `slow=true` ja `slow_since`; pollimine jätkub. Tulemus jõuab alati kohale. |
| Absoluutne lagi | `REOCR_ABSOLUTE_TIMEOUT` (env, ~12h) = **sanity cap kogu kliendipoolsele elueale** (sh järjekorras ootamine), MITTE OCR-töötluse lagi → alles siis `error`, JA ainult pärast viimast SFTP-kontrolli. |
| Orbude taaste | Reconciliation-reaper skannib OCR-staging'ut, taastab valmis tulemused (praegused + restardi-järgsed). |
| Restardi-kadu | Kerge püsivus: aktiivsete tööde metaandmed `reocr_active.json`-is, laetakse startup'il tagasi. |
| Nähtavus | Elav kulunud aeg + "~N ees" (VUTT-i FIFO-lähend) + "aeglane" merevaigukollane märk (mitte punane "Viga"). |
| Järjekord | VUTT-i lähend: aktiivsete varasema `started_at`-iga tööde arv. OCR-serverit EI muudeta. |
| Modulaarsus | Uus funktsionaalsus eraldi failidesse; `reocr_ops.py` saab AINULT väikesed kirurgilised editid. |

## Arhitektuur

Kolm käitumis-komponenti, jaotatud moodulite vahel nii et `reocr_ops.py` ei ven-i.

### KRIITILINE invariant: `slow` on lipp, MITTE staatus

`status ∈ {uploading, processing, done, error}` — **muutumatu enum**. `slow` on eraldi
**boolean nähtavuse-lipp** (`slow_since` = lisaväli). **Aktiivsed tööd on `uploading` ja
`processing`**, millest osa võib olla `slow=true`. See hoiab kõik olemasolevad
staatusekontrollid puutumata — ei mingit "slow"-staatust kuskil. Kus varem tekstis seisis
"processing/slow" või "uploading/processing/slow", loe: **aktiivne = `uploading` või
`processing`**, `slow` on ainult lipp nende peal.

### Uued moodulid (flat, järgib olemasolevat `*_ops.py` konventsiooni)

**`server/reocr_state.py` — aktiivsete tööde püsivus (RESTARDI-JÄTKAMINE)**
- Vastutus: `state/reocr_active.json` lugemine/kirjutamine, startup-load.
- **Roll recovery hierarhias:** `reocr_active.json` on eelkõige **restardi-järgne
  jätkamine** (aktiivsed tööd mälust kadusid). Ta EI ole orbude põhi-allikas — sisaldab
  ainult aktiivseid töid ja töö eemaldatakse `done`/`error` korral, seega error-iks
  märgitud või crash'i-eelselt eemaldatud töö kohta ei pruugi seal enam midagi olla.
  **Orbude põhi-allikas on `reocr_log`** (vt reocr_recovery.py).
- Salvestab AINULT aktiivsete (`uploading`/`processing`, sh `slow=true`) tööde metaandmed:
  `{job_id, work_id, slug, page_filename, page_number, material_type, username, started_at,
  slow, slow_since, remote_staging, remote_work, remote_img, remote_txt}`.
- Funktsioonid (kavand):
  - `persist_active_jobs(jobs: dict) -> None` — atomaarne kirjutus (tmp + `os.replace`).
  - `load_active_jobs() -> dict` — startup'il, tagastab `_reocr_jobs`-i taastamiseks.
  - `remove_job(job_id) -> None` — kui töö läheb `done`/`error` (lõppseis).
- **Debounce:** kirjuta AINULT üleminekutel (upload→processing, esimene slow=true→,
  done/error→remove), MITTE igal 10s pollil. Muster:
  `if not job.get("slow") and age > slow_timeout: job["slow"]=True; persist(...)`.
- Idempotentne, tahaühilduv: puuduv/vigane fail → tühi dict, ei crash'i.

**`server/reocr_recovery.py` — reconciliation-reaper**
- Vastutus: leida OCR-serveri staging'ust valmis tulemused, mille job pole aktiivselt
  pollitav, ja taastada need. **Orbude põhi-allikas mapping'uks on `reocr_log`.**
- `scan_and_recover() -> dict` (tagastab `{recovered: [...], skipped: [...]}`):
  1. SFTP-list `AUTO-OCR/print/` ja `AUTO-OCR/hand/` → `{job_id}` kataloogid.
  2. Iga kataloog, kus `{slug}/{slug}_pg_001.txt` olemas.
  3. **Skip-tingimus (KRIITILINE):** jäta job puutumata, kui `job_id` on `_reocr_jobs` sees
     JA `status in {"uploading", "processing"}`. **Ka `uploading` skip'itakse** — SFTP-tee
     võib olla poolikus seisus. (Kuna `slow` on lipp, mitte staatus, ei ole eraldi
     slow-kontrolli vaja — slow-töö on `status=processing`, seega juba kaetud.)
  4. **Claim (idempotentsus-kaitse):** enne allalaadimist "claimi" `job_id` — lisa
     jagatud `_recovering_job_ids` set'i (kaitstud `_reocr_jobs_lock`-iga). Kui juba
     claimitud → skip. Nii ei tekita tavaline poller + reaper sama `.txt`-i topelt-
     allalaadimist / topelt-`.ocr`-kirjutust / staging'u topelt-koristust.
     Alternatiiv: taaskasuta sama globaalset `_reocr_jobs_lock`-i kogu recover-sammu ümber.
     Claim vabastatakse `finally`-s.
  5. Leia `page_filename` järjekorras: (a) `reocr_log` `job_id` järgi (PÕHI-allikas),
     (b) `reocr_active.json` (restardi-jätkamise varu).
  6. Leitud → laeb `.txt` alla → `_write_ocr_file(slug, page_filename, text)` → **lisa
     `reocr_log`-i UUS sündmus-kirje** (mitte muuda vana): `{status: "done", recovered: true,
     recovered_at, original_status: "error", job_id, work_id, slug, page_filename}` — toimib
     ka siis kui originaal-kirje on 500-akna alt kärbitud → koristab staging (`rm -rf`).
  7. `page_filename` puudub kõikjalt → `skipped`, logi hoiatus (ei arva ära lehte).
- Daemon-thread (intervall env-st, nt 300s) + üks käivitus serveri startup'il (PÄRAST
  `load_active_jobs`-i, vt startup-wiring).
- Kasutab `_sftp_open`/`close_ssh` (sama primitiiv mis `reocr_ops`; #65 järel `ocr_client.py`).

### Kirurgilised editid `server/reocr_ops.py`-s

1. **`_reocr_poll_loop`**: `now - started_at > REOCR_PROCESSING_TIMEOUT` → EI `error`.
   `status` JÄÄB `processing`. **Debounce:** `if not job.get("slow"): job["slow"]=True;
   job["slow_since"]=now; persist(...)` — sea slow AINULT esimesel korral, mitte igal
   pollil. Uus haru: `now - started_at > REOCR_ABSOLUTE_TIMEOUT` → viimane `poll_reocr_job`
   (SFTP-kontroll); kui ikka pole `.txt` → `error` (märge: absoluutne sanity-lagi ületatud).
2. **`_reocr_batch_poll_loop`** (eraldi semantika, EI ole naiivne "analoogne"):
   - Batch on üks job mitme lehega; **osaliselt valminud lehed imporditakse edasi**
     (`_poll_batch_job` kirjutab `.ocr` per valmis leht — jätkub muutmata).
   - `slow` on **batch-tasemel lipp** (kogu batch): kui `now - started_at > INACTIVITY`
     (või pole edenemist) → `batch.slow = True`, batch jääb aktiivseks, per-lehe import
     jätkub. Üksik valmis leht EI jää teise aegluse taha kinni.
   - Absoluutne lagi (`REOCR_ABSOLUTE_TIMEOUT`) → alles pärast **kõigi veel-pending lehtede
     viimast SFTP-kontrolli** märgitakse allesjäänud pending-lehed `error`-iks; juba valmis
     lehed jäävad `ready`-ks.
   - `batch.started_at` = kogu batch'i algus.
3. **Uued konstandid**: `REOCR_ABSOLUTE_TIMEOUT` (env, vaikimisi 43200s = 12h) —
   **sanity cap kliendipoolsele elueale, MITTE OCR-töötluse timeout**.
   `REOCR_PROCESSING_TIMEOUT` semantika muutub: "aeglane"-läve, mitte error-läve.
4. **`list_reocr_jobs`**: lisa väljad `slow`, `slow_since` ja arvutatud `queue_ahead`
   (mitu aktiivset `uploading`/`processing` tööd varasema `started_at`-iga). **Kommentaar
   koodis:** `queue_ahead` on AINULT lokaalne VUTT FIFO-lähend — OCR-serveri päris
   järjekorda ei teata (seal võib olla muid/käsitsi lisatud töid).
5. **Startup-wiring (JÄRJEKORD ON KRIITILINE):**
   1. `reocr_state.load_active_jobs()` → täida `_reocr_jobs`.
   2. Taasta polling (aktiivsed on nüüd mälus).
   3. `reocr_recovery.scan_and_recover()` (üks kord) — **alles siis kui `_reocr_jobs` on
      juba täidetud**, et aktiivseid töid ei peetaks orvuks (skip-tingimus töötab).
   4. Käivita periodic reaper-loop.
   Staatuse-üleminekutel kutsu `reocr_state.persist_active_jobs`/`remove_job`.

### Frontend `src/pages/Review.tsx`

- **Elav kulunud aeg**: aktiivsetele (`uploading`/`processing`/`slow`) töödele arvuta
  `now - started_at` → "töötab 12 min" (uueneb polli-tsükliga, 4s).
- **"~N ees"**: näita `queue_ahead` kui > 0. Sõnastus **ettevaatlik**: "~3 varasemat
  re-OCR tööd" / "~3 ees selles süsteemis" — MITTE kategooriline "3 tööd ees" (OCR-serveri
  päris järjekorda ei teata).
- **"aeglane" märk**: `slow === true` (staatus on endiselt `processing`) → merevaigukollane
  badge "aeglane, töötab edasi" (MITTE punane "Viga"). Päris `error` jääb punaseks.
- i18n: uued võtmed `review` namespace'i (`et` + `en`).

## Andmevoog

```
start_reocr_job → status=uploading → persist_active_jobs
   ↓ SFTP put
status=processing → persist_active_jobs
   ↓ _reocr_poll_loop (10s)
   ├─ .txt olemas → download → _write_ocr_file → status=done → remove_job + log
   ├─ >30min → slow=true → persist (jääb processing, pollib edasi)
   └─ >12h → viimane SFTP-kontroll → done VÕI error → remove_job + log

Restart:
   startup → load_active_jobs → _reocr_jobs taastatud → polling jätkub
           → scan_and_recover (üks kord) → orvud imporditud

Reaper (300s):
   scan_and_recover → staging-orvud (error/kadunud) → taastatud
```

## Veakäsitlus

- Reaper per-orb isoleeritud (üks vigane job ei blokeeri teisi); SFTP-vead logitakse, ei crash'i.
- **Võistlus poller vs reaper:** claim-mehhanism (`_recovering_job_ids` set `_reocr_jobs_lock`
  all) tagab, et sama `.txt`-i töötleb ainult üks — ei topelt-allalaadimist, topelt-`.ocr`-
  kirjutust ega topelt-koristust. Claim vabastatakse `finally`-s.
- `reocr_active.json` vigane/puudub → tühi dict (tahaühilduv).
- Absoluutne lagi väldib igavest pollimist kui OCR-server on tõesti surnud.
- `page_filename` puudub → `skipped` + hoiatus, EI arva lehte ära (andmete terviklikkus).
- Atomaarne state-kirjutus (tmp + `os.replace`) väldib katkist JSON-i võistlusel.

## Testid (`.venv/bin/python -m pytest`)

- `test_reocr_slow_transition`: >30min processing → `slow=true`, staatus jääb `processing`.
- `test_reocr_absolute_timeout_final_check`: >12h + `.txt` olemas → `done`; puudub → `error`.
- `test_reocr_state_roundtrip`: persist → load tagastab sama; vigane fail → tühi dict.
- `test_reocr_recovery_from_log`: staging-orb + logi-kirje → taastatud, `.ocr` kirjutatud,
  logi `done`.
- `test_reocr_recovery_skips_unmapped`: staging-orb ilma `page_filename`-ita → `skipped`.
- `test_queue_ahead`: kolm aktiivset → keskmine saab `queue_ahead=1`.
- `test_reaper_skips_active_uploading_or_processing_job`: reaper EI puutu mälus olevat
  aktiivset tööd (nii `uploading` kui `processing`), isegi kui `.txt` juba staging'us.
- `test_reaper_idempotent_when_polled_concurrently`: claim-mehhanism → sama `.txt` ei tekita
  topelt-`.ocr`-kirjutust ega topelt-koristuse crash'i (poller + reaper korraga).
- `test_startup_load_before_recovery_scan`: `load_active_jobs` enne `scan_and_recover`-it →
  taastatud aktiivset tööd EI käsitleta orvuna.
- Olemasolevad `tests/` re-OCR testid peavad läbima (ei regressiooni).

## Väljaspool skoopi

- OCR-serveri poole muudatus (päris järjekorra-API) — VUTT-i lähend piisab.
- `reocr_ops.py` täielik paketiks-lõhkumine (võib olla eraldi #65-stiilis issue).
- Upload-tee (`upload_ops.py`) käitumise muutus — teeb juba õigesti (nõuandev stall).

## Issue #65 mõju

Fix on `reocr_ops.py` + uued `reocr_*.py` moodulid, MITTE `upload_ops.py`. Ainus jagatud
sõltuvus on `_sftp_open`/`close_ssh` (imporditud `upload_ops`-ist). Kui #65 viib need
`server/upload/ocr_client.py`-sse, muutub ainult import-rida — käitumine ei sõltu upload-splitist.
Uus kood EI lisa upload_ops-ile uut sõltuvust.
