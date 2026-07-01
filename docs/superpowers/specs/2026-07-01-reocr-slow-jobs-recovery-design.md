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
| Timeout-käitumine | **Ei loobu** — 30 min → nõuandev "aeglane" lipp, pollib edasi. Tulemus jõuab alati kohale. |
| Absoluutne lagi | Kaugem `REOCR_ABSOLUTE_TIMEOUT` (~12h) → alles siis `error`, JA ainult pärast viimast SFTP-kontrolli. |
| Orbude taaste | Reconciliation-reaper skannib OCR-staging'ut, taastab valmis tulemused (praegused + restardi-järgsed). |
| Restardi-kadu | Kerge püsivus: aktiivsete tööde metaandmed `reocr_active.json`-is, laetakse startup'il tagasi. |
| Nähtavus | Elav kulunud aeg + "~N ees" (VUTT-i FIFO-lähend) + "aeglane" merevaigukollane märk (mitte punane "Viga"). |
| Järjekord | VUTT-i lähend: aktiivsete varasema `started_at`-iga tööde arv. OCR-serverit EI muudeta. |
| Modulaarsus | Uus funktsionaalsus eraldi failidesse; `reocr_ops.py` saab AINULT väikesed kirurgilised editid. |

## Arhitektuur

Kolm käitumis-komponenti, jaotatud moodulite vahel nii et `reocr_ops.py` ei ven-i.

### Uued moodulid (flat, järgib olemasolevat `*_ops.py` konventsiooni)

**`server/reocr_state.py` — aktiivsete tööde püsivus**
- Vastutus: `state/reocr_active.json` lugemine/kirjutamine, startup-load.
- Salvestab AINULT aktiivsete (`uploading`/`processing`/`slow`) tööde metaandmed:
  `{job_id, work_id, slug, page_filename, page_number, material_type, username, started_at,
  slow, slow_since, remote_staging, remote_work, remote_img, remote_txt}`.
- Funktsioonid (kavand):
  - `persist_active_jobs(jobs: dict) -> None` — atomaarne kirjutus (tmp + rename).
  - `load_active_jobs() -> dict` — startup'il, tagastab `_reocr_jobs`-i taastamiseks.
  - `remove_job(job_id) -> None` — kui töö läheb `done`/`error` (lõppseis).
- Kutsutakse staatuse-üleminekutel `reocr_ops.py`-st (upload→processing, →slow, →done/error).
- Idempotentne, tahaühilduv: puuduv/vigane fail → tühi dict, ei crash'i.

**`server/reocr_recovery.py` — reconciliation-reaper**
- Vastutus: leida OCR-serveri staging'ust valmis tulemused, mille job pole aktiivselt
  pollitav, ja taastada need.
- `scan_and_recover() -> dict` (tagastab `{recovered: [...], skipped: [...]}`):
  1. SFTP-list `AUTO-OCR/print/` ja `AUTO-OCR/hand/` → `{job_id}` kataloogid.
  2. Iga kataloog, kus `{slug}/{slug}_pg_001.txt` olemas JA `job_id` pole mälus
     `processing`/`slow` (st error / kadunud / restardi-järel):
     - Leia `page_filename` järjekorras: (a) `reocr_active.json`, (b) `reocr_log` `job_id` järgi.
     - Leitud → laeb `.txt` alla → `_write_ocr_file(slug, page_filename, text)` → uuenda
       logi-kirje staatuseks `done` (märge: taastatud) → koristab staging (`rm -rf`).
     - `page_filename` puudub kõikjalt → `skipped`, logi hoiatus (ei arva ära lehte).
- Daemon-thread (intervall env-st, nt 300s) + üks käivitus serveri startup'il.
- Kasutab `_sftp_open`/`close_ssh` (sama primitiiv mis `reocr_ops`; #65 järel `ocr_client.py`).

### Kirurgilised editid `server/reocr_ops.py`-s

1. **`_reocr_poll_loop`**: `now - started_at > REOCR_PROCESSING_TIMEOUT` → EI `error`,
   vaid `job["slow"] = True`, `job["slow_since"] = now`, jätkab pollimist. Uus haru:
   `now - started_at > REOCR_ABSOLUTE_TIMEOUT` → viimane `poll_reocr_job` (SFTP-kontroll);
   kui ikka pole `.txt` → `error` (märge: absoluutne lagi ületatud).
2. **`_reocr_batch_poll_loop`**: analoogne — inactivity → `slow`, absoluutne lagi → error
   pärast viimast batch-pollimist.
3. **Uued konstandid**: `REOCR_ABSOLUTE_TIMEOUT` (env, vaikimisi 43200s = 12h).
   `REOCR_PROCESSING_TIMEOUT` semantika muutub: "aeglane"-läve, mitte error-läve.
4. **`list_reocr_jobs`**: lisa väljad `slow`, `slow_since` ja arvutatud `queue_ahead`
   (mitu aktiivset `uploading`/`processing`/`slow` tööd varasema `started_at`-iga).
5. **Wiring**: staatuse-üleminekutel kutsu `reocr_state.persist_active_jobs`/`remove_job`.
   Startup'il kutsu `reocr_state.load_active_jobs()` → täida `_reocr_jobs` +
   `reocr_recovery.scan_and_recover()` (üks kord) + käivita reaper-loop.

### Frontend `src/pages/Review.tsx`

- **Elav kulunud aeg**: aktiivsetele (`uploading`/`processing`/`slow`) töödele arvuta
  `now - started_at` → "töötab 12 min" (uueneb polli-tsükliga, 4s).
- **"~N ees"**: näita `queue_ahead` kui > 0 ("~3 tööd ees").
- **"aeglane" märk**: `slow === true` → merevaigukollane badge "aeglane, töötab edasi"
  (MITTE punane "Viga"). Päris `error` jääb punaseks.
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
