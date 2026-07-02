# Fable pimealade-ülevaatus — VUTT

**Kuupäev:** 2026-07-02
**Mudel:** Claude Fable 5
**Skoop:** kogu backend (`server/`), fookus ristlõikavatel korrektsuse/operatsiooni/andmeterviklikkuse aukudel, mida avatud issue'd EI kata.
**Metoodika:** loetud kõik routerid + reocr/upload/git/meili/auth/cache/access ops. Frontend ainult puutepunktides (Review polling). Coverage-first: raporteeritud ka madala kindlusega leiud — triaaž hiljem.

Iga leid: **Raskus** (kriitiline/kõrge/keskmine/madal) × **Kindlus** (kindel/tõenäoline/spekulatiivne). Järjestatud tõsiduse järgi.

---

## KÕRGE

### B1. Blokeeriv SFTP/git/Meili `async def` endpointides — 2026-06-13 outage'i klass on osaliselt taastunud
**Fail:** `server/routers/upload.py:47-53` (parandatud sync-def), AGA:
- `server/routers/reocr.py:54-57` `admin_reocr_status` — **`async def`** → `poll_reocr_job()` → sünkroonne `_sftp_open` + `sftp.stat/getfo` (`reocr_ops.py:592-661`)
- `server/routers/upload.py:94-101` `admin_upload_import` — **`async def`** → `import_as_work()` laeb SFTP-ga alla KÕIK lehed + teeb sünkroonse `sync_work_to_meilisearch` (`upload_ops.py:1054-1269`)
- `server/routers/upload.py:104-124` `admin_upload_replace_work` — **`async def`** → `replace_work_content()` sama muster (`upload_ops.py:1272`)
- `server/routers/upload.py:143-147` `admin_upload_cancel` — **`async def`** → `cancel_upload()` → `_ssh_rm_rf` blokeeriv SSH (`upload_ops.py:1532`)

**Raskus:** kõrge. **Kindlus:** kindel.
**Uus vs trackitud:** UUS. Brief ütleb eksplitsiitselt: „Kui leiad UUE blokeeriva I/O `async def`-is, see on raporteeritav." `admin_upload_files` (samas failis) teeb seda õigesti `run_in_executor`-iga; `/get-work-metadata`, `works-count`, `add-pages` samuti — need endpointid on lihtsalt vahele jäänud.
**Stsenaarium:** OCR-server aeglane/kättesaamatu. Admin vajutab „Impordi VUTT-i" 200-lehelisele teosele → `import_as_work` blokeerib event-loopi minuteid (SFTP download lehthaaval + sünkroonne Meili-sync). Single-worker uvicorn → **kogu sait ripub** kõigi ~300 kasutaja jaoks impordi ajaks. `admin_reocr_status`-t pollitakse frontendist iga 4s (`Review.tsx:185`) → surnud OCR-hosti korral iga poll blokeerib kuni `OCR_CONNECT_TIMEOUT` (10s) → korduv hang-laine.
**Soovitus:** tõsta kõik neli endpointi `run_in_executor`/`run_in_threadpool` peale (nagu `admin_upload_files` ja `add-pages` juba on), VÕI muuda `def`-iks (FastAPI jooksutab sünk-def threadpoolis). See on sama muster, mida `upload_status` jaoks juba teadlikult rakendati.

---

### B2. Reaper kustutab batch-mapping'u enne kui OCR-server on lehed valmis saanud → püsiv andmekadu
**Fail:** `server/reocr_recovery.py:154-165` (`_recover_batch` lõpp)
**Raskus:** kõrge. **Kindlus:** tõenäoline (loogika teest tuletatud; sõltub OCR-serveri ajastusest).
**Uus vs trackitud:** UUS. Recovery-hardening on hiljutine töö (PR #108) — see on selle enda pimeala.
**Stsenaarium:** Batch re-OCR upload ebaõnnestub poole pealt (`start_reocr_batch._upload` viskab → `job.status="error"`). `persist_active_jobs` **ei salvesta error-jobe** (`reocr_state.py:23`), aga `persist_batch_mapping` on juba kirjutatud (`reocr_ops.py:188`). Mõned pildid jõudsid OCR-serverisse ja OCR töötleb neid taustal. Serveri restart / mälust kadu → job pole enam aktiivselt jälitatud. Reaper (iga 5 min) → `_recover_batch` → `listdir(work_dir)` tagastab veel ainult `.jpg`-d (ükski `.txt` pole valmis) → `remaining = []` → `remove_batch_mapping(job_id)` (rida 165). Hiljem OCR-server lõpetab ja kirjutab `.txt`-d → **mapping on kadunud, `reocr_log`-is pole batch-lehtede kirjeid → tulemused on igaveseks orvud**.
**Soovitus:** ära kustuta mappingut nii kaua kui staging-kaustas on veel pilte (`.jpg`), mille kohta pole `.txt`-d saabunud. Kustuta alles siis, kui KÕIK mapping'u lehed on kas taastatud (`recovered`) või staging tervikuna kadunud (`FileNotFoundError`). Praegu on „txt-de arv = 0" ekslikult võrdsustatud „töö on valmis"-ga.

---

## KESKMINE

### B3. `poll_reocr_job` / batch-poll muteerivad job-dict'e ILMA lukuta → check-then-act race
**Fail:** `server/reocr_ops.py:643-648` (`poll_reocr_job` seab `job["status"]="done"` väljaspool `_reocr_jobs_lock`), `_poll_batch_job:273-303` (batch `entry`/`job` mutatsioonid lukuta)
**Raskus:** keskmine. **Kindlus:** kindel (race olemas), tõenäoline (avaldub harva).
**Uus vs trackitud:** UUS. Dokumenteeritud invariant ütleb, et daemon-thread'id jooksevad samas protsessis (prosopography lukustus lahendab sama probleemi `person_lock`-iga) — re-OCR pool seda mustrit ei järgi.
**Stsenaarium:** `_poll_iteration` (daemon-thread) tuvastab abs-timeout'i ja seab luku all `status="error"` + `_append_to_log` (`reocr_ops.py:437-444`). Samal ajal jookseb `poll_reocr_job` (kutsutud frontendi `admin_reocr_status` päringust) — leiab `.txt` valmis, seab **lukuta** `status="done"` + `_append_to_log` (rida 643-648). Tulemus: kaks logikirjet samale jobile, või `done`↔`error` ülekirjutus sõltuvalt ajastusest. `_reocr_jobs[job_id]` ise ei ole atomaarne mitme välja seadmisel.
**Soovitus:** vii kõik `_reocr_jobs[jid][...] = ` mutatsioonid `_reocr_jobs_lock` alla (nagu `_mark_slow_if_stale` juba teeb). Batch-pool sama.

### B4. `reocr_log.json` kirjutus EI ole atomaarne — erinevalt kõigist teistest state-failidest
**Fail:** `server/reocr_ops.py:37-50` (`_append_to_log`: otse `open(...,"w")` + `json.dump`)
**Raskus:** keskmine. **Kindlus:** kindel.
**Uus vs trackitud:** UUS. `reocr_state.py` (`persist_active_jobs`, `persist_batch_mapping`) kasutab õigesti `tmp + os.replace`; `utils.atomic_write_json` on olemas; `reocr_log` jäi kaitseta.
**Stsenaarium:** Protsess crashib/kill'itakse keset `json.dump` ajal → `reocr_log.json` on poolik/vigane JSON. `get_reocr_log` (rida 60-62) püüab erindi kinni ja tagastab **vaikselt tühja loendi**. `reocr_recovery._resolve_job_meta` kasutab logi orbude PÕHI-allikana (rida 39) → kõik varasemad üksik-lehe orvud jäävad taastamata. Review-ajalugu kaob samuti.
**Soovitus:** kasuta `utils.atomic_write_json` (tmp + `os.replace`). Väike muudatus, kõrvaldab vaikse andmekao.

### B5. `list_uploads()` loeb `state.json`-e ILMA per-upload lukuta → poolik lugemine
**Fail:** `server/upload_ops.py:367-394` (`list_uploads` avab `state.json` otse, väljaspool `_get_upload_lock`); kirjutuspool `_write_state:88-92` samuti mitte-atomaarne (otse `open("w")`)
**Raskus:** keskmine. **Kindlus:** tõenäoline.
**Uus vs trackitud:** UUS. Kõik ÜKSIK-upload operatsioonid võtavad `_get_upload_lock`, aga `list_uploads` (mida kutsub nii `/admin/uploads`, `/admin/ocr/jobs` kui taustasünk-loop iga 60s) skanni ei lukusta.
**Stsenaarium:** Taustasünk-loop kirjutab `state.json` (`_write_state`, mitte-atomaarne) samal ajal kui `admin_ocr_jobs` loeb sama faili `list_uploads`-iga → `json.load` võib saada poolkirjutatud faili → `except` haarab → upload **kaob ühtsest OCR-vaatest** kuni järgmise pollini; halvimal juhul (crash kirjutuse ajal) jääb `state.json` püsivalt katki → upload kaob jäädavalt vaatest.
**Soovitus:** tee `_write_state` atomaarseks (`atomic_write_json`). See kõrvaldab ka poolik-lugemise akna (`os.replace` on atomaarne).

### B6. `admin_reocr_page`: `page_filename` EI ole valideeritud path traversal'i vastu (batch on)
**Fail:** `server/routers/reocr.py:37` (`img_path = os.path.join(path, page_filename)` ilma basename-kontrollita) vs `:141-146` (batch teeb eksplitsiitse `fn != os.path.basename(fn)` kontrolli kommentaariga „väldi path traversal")
**Raskus:** keskmine (admin-only, aga admin ≠ superadmin). **Kindlus:** kindel.
**Uus vs trackitud:** UUS. Ebakõla kahe naaberendpoindi vahel samas failis — üks kaitstud, teine mitte.
**Stsenaarium:** Admin (nt kompromiteeritud/pahatahtlik editor, kes tõsteti adminiks) POST `/admin/work/{id}/reocr-page` bodyga `page_filename="../../state/users.json"`. `os.path.isfile` läbib (fail eksisteerib) → `shutil.copy2` kopeerib `users.json` (bcrypt-hashid) `/tmp/`-i → `start_reocr_job` saadab selle OCR-serverisse. Vähemalt info-leke serverite vahel; ka `shutil.copy2` jookseb event-loopis (B1 alaliik).
**Soovitus:** lisa sama kontroll mis batch'is: `if page_filename != os.path.basename(page_filename): raise HTTPException(400)`.

### B7. `import_as_work`: git commiti ebaõnnestumine on ainult WARNING → „originaal-OCR alati taastatav" invariant puruneb vaikselt
**Fail:** `server/upload_ops.py:1217-1223`
**Raskus:** keskmine. **Kindlus:** kindel.
**Uus vs trackitud:** UUS. CLAUDE.md: „First commit = original OCR (always restorable)". Kui see samm vaikselt ebaõnnestub, on invariant rikutud ilma et keegi teaks.
**Stsenaarium:** `commit_new_work_to_git` viskab (nt `index.lock` kollisioon paralleelse salvestusega, ketas täis) → püütakse kinni, logitakse warning, import **jätkub ja tagastab success**. Teos on failisüsteemis ja Meilis, aga gitis puudub → Ajaloo-tab tühi, originaal-OCR-i ei saa taastada. Kasutaja ei saa veast teada.
**Soovitus:** kui esimene commit ebaõnnestub, tuleks see esile tuua (nt lisada `reocr`-stiilis git-failure kirje / tagastada hoiatus vastuses), mitte ainult logi. Vähemalt `_record_git_failure` kutse.

### B8. `replace_work_content`: `git rm` vea korral jäävad vanad `.txt/.json` alles → vana+uue sisu segu
**Fail:** `server/upload_ops.py:1339-1353` (`git rm` ümbritsetud `try/except` → ainult warning), samas kui rida 1327-1337 on JPG-d juba prügikasti liigutatud
**Raskus:** keskmine. **Kindlus:** tõenäoline.
**Uus vs trackitud:** UUS.
**Stsenaarium:** Asendamisel liigutatakse vanad JPG-d prügikasti (destruktiivne), siis `git rm` vanad `.txt/.json`. Kui `git rm` viskab (index.lock, õigused) → warning, jätkab. Uued lehed laetakse alla teiste failinimedega (`_page_base_name` võib erineda lehtede arvu tõttu) → kaustas on nii vanad kui uued `.txt`-d. Meili-sync indekseerib mõlemad → teos näitab topelt/segatud lehti. Rollback käivitub ainult download-vea korral, mitte `git rm`-vea korral.
**Soovitus:** `git rm` ebaõnnestumine peaks käivitama sama rollback-tee mis download-viga (või vähemalt katkestama enne allalaadimist), mitte vaikselt jätkama.

### B9. `_revive_dead_uploads` ei taasta batch per-lehe staatust → surnud batch-upload venib 12h + sõltub B2-st
**Fail:** `server/reocr_ops.py:675-685` (flipib ainult job-tasandi `uploading`→`processing`, `pages[].status` jääb `"uploading"`)
**Raskus:** keskmine. **Kindlus:** tõenäoline.
**Uus vs trackitud:** UUS.
**Stsenaarium:** Restart batch-jobi upload-faasis. `_revive_dead_uploads` teeb job-tasandi `processing`, aga `_poll_batch_job` pollib ainult `entry["status"]=="processing"` lehti (`reocr_ops.py:251`) — revived kirjed on `"uploading"` → neid ei pollita kunagi. Abs-timeout (12h) märgib nad lõpuks error-iks. Kui B2 vahepeal kustutab mapping'u, kaovad tulemused. Parimal juhul 12h viivitus.
**Soovitus:** `_revive_dead_uploads` peaks batch'i puhul flippima ka `pages[].status` `uploading`→`processing`, et poll neid katab.

---

## MADAL

### B10. `get_active_reocr_count()` itereerib `_reocr_jobs.values()` ilma lukuta
**Fail:** `server/reocr_ops.py:471-473`; kutsuja `routers/reocr.py:27` (max-concurrent värav)
**Raskus:** madal. **Kindlus:** kindel.
**Stsenaarium:** `_reocr_cleanup_loop` (daemon) del'ib `_reocr_jobs`-ist samal ajal → `RuntimeError: dictionary changed size during iteration` → 500 concurrent-värava kontrollil. Harv (CPython GIL + väike dict), aga reaalne.
**Soovitus:** `with _reocr_jobs_lock:` ümber summeerimise.

### B11. `reocr_ops` käivitab 3 daemon-threadi module-level impordil (mitte lifespan'ist)
**Fail:** `server/reocr_ops.py:368, 386, 468` (`threading.Thread(...).start()` mooduli tasandil)
**Raskus:** madal. **Kindlus:** kindel.
**Uus vs trackitud:** UUS. `start_upload_sync_loop` ja `start_reocr_background` on teadlikult lifespan'i taha viidud (kommentaarid selgitavad, et image_server import ei tohi teist SFTP-loopi tekitada), AGA `_reocr_batch_poll_loop`, `_reocr_cleanup_loop` ja `_reocr_poll_loop` stardivad ikka igas protsessis, mis `reocr_ops`-i impordib. `server/__init__.py` re-ekspordib `reocr_ops`-ist → `import server` (nt image_server, testid) käivitab need pollid ka väljaspool API-protsessi.
**Stsenaarium:** Pildiserveri protsess (`python -m server.image_server`) impordib `server` paketi → 3 re-OCR polliloopi käivituvad seal asjatult (üks teeb iga 10s tühja `_reocr_jobs` skanni — kahjutu, aga vale koht; test-keskkonnas käivituvad samuti).
**Soovitus:** vii kolm loop-starti `start_reocr_background`-i (või oma `start_*` funktsiooni), mida kutsub AINULT lifespan — sama muster mis upload-sync.

### B12. `metadata_watcher_loop` loob metaandmed + Meili-indeksi ka kaustadele, mis on veel impordi/replace destruktiivses aknas
**Fail:** `server/meilisearch_ops.py:568-614`
**Raskus:** madal. **Kindlus:** spekulatiivne.
**Uus vs trackitud:** UUS.
**Stsenaarium:** Watcher skannib `BASE_DIR` iga 60s. `replace_work_content` liigutab JPG-d prügikasti ja teeb `git rm`, siis laeb uued alla — kui watcher tabab kausta pärast `_metadata.json` olemasolu kontrolli, aga pooleliolevas seisus, võib see indekseerida ebatäieliku seisu. Väike aken (watcher nõuab 60s stabiilsust + `_metadata.json` puudumist), seega madal — aga import loob `_metadata.json` alles LÕPUS, nii et watcher ei tohiks poolikut kausta näha. Spekulatiivne; väärib kontrolli et watcher ja upload/replace ei võistle sama kausta pärast.
**Soovitus:** kaalu upload/replace pooleliolevate kaustade märkimist (nt `.importing` lipp), mida watcher ignoreerib.

### B13. `save_with_git` retry ainult `index.lock`-ile; muud `GitCommandError`-id → vaikne salvestamata jäämine
**Fail:** `server/git_ops.py:369-376`
**Raskus:** madal. **Kindlus:** kindel.
**Stsenaarium:** `/save` → `save_with_git` viskab muu GitCommandError (nt korrumpeerunud objekt, disk full) → tagastab `{"success": False}`, AGA `routers/editing.py:83` ei kontrolli `success`-lippu — endpoint tagastab ikka `{"status":"success", "commit_hash":""}`. Fail on kettal (rida 328 kirjutas), aga commitimata. Kasutaja arvab, et salvestati versioonihaldusega. `_record_git_failure` küll logib.
**Soovitus:** `/save` peaks kontrollima `git_result.get("success")` ja tagastama hoiatuse, kui commit ebaõnnestus (tekst on kettal, aga versioonita).

### B14. Meili tenant-token TTL 3600s, aga sessioon 24h → piiratud kollektsioonide otsing „kaob" iga tunni tagant
**Fail:** `server/meilisearch_ops.py:482` (`ttl_seconds=3600`), `auth.py` `SESSION_DURATION` (24h)
**Raskus:** madal. **Kindlus:** tõenäoline (osaliselt juba teadaolev — vt `project_meili_anon_degradation`).
**Uus vs trackitud:** OSALT trackitud (anon-degradation self-heal on mälus). Siin konkreetne juur: token aegub 24× tihedamini kui sessioon; frontendi refresh (`/api/meili-token/refresh`) peab jõudma enne aegumist, muidu restricted-teosed kaovad otsingust kuni refreshini. Kui self-heal katab selle, on OK — aga TTL-de vahe on struktuurne fragiilsus.
**Soovitus:** dokumenteeri seos või tõsta token-TTL sessiooniga sünkroonseks; veendu refresh-loop katab kogu sessiooni eluea.

---

## Testkatte tähelepanekud (fragiilsete kohtade ümber)

- **B2/B9 (batch recovery servajuhud)** — `test_reocr_recovery.py` olemas, aga kontrolli, kas see katab „mapping kustutatakse enne kui .txt saabub" ja „revived batch pages jäävad uploading" juhud. Tõenäoliselt EI (need on just leitud pimealad).
- **B1 (async blocking)** — pole automaattesti, mis kinnitaks, et upload/reocr endpointid ei blokeeri event-loopi. `test_upload_ssh_timeout.py` katab connect-timeout'i, mitte event-loop-blokeeringut. Kaalu regressioonitesti (nt endpoint on `def` või kutsub `run_in_executor`).
- **B3/B10 (lukuta mutatsioon)** — race-condition'e on raske testida; vähemalt lisa lukk ja märgi invariant kommentaariga (nagu `locks.py` prosopograafias).
- Positiivne: `test_meili_seed_live_parity.py` katab kahe indekseerimistee ühtsuse (build_work_documents on ainus tee → **ebakõla kahe tee vahel ei leidnud**, see risk on hästi maandatud jagatud `meili_doc.py`-ga).

## Mida EI leitud (maandatud riskid)
- Meili kaks indekseerimisteed: ühine `build_work_documents` → ei saa lahkneda. ✅
- Path traversal upload-slug/failinimedes: `sanitize_slug` idempotentne + batch basename-kontroll + `_validate_page_paths` `realpath`-kontroll + image_server `_is_safe_image_path`. Ainus auk: B6 (üksik reocr-page). ✅ (v.a B6)
- Rollide hierarhia: `role_level` fail-closed (viskab tundmatu rolli peal), `can_manage_user`/`can_assign_role` järjepidevalt kasutatud. ✅
- Ligipääsukontroll: `can_read_work`/`can_write_work` kutsutud sõltumatult Meili-indeksist kõigil lugemis/kirjutus-teedel. ✅
