# Fable turva-delta — VUTT

**Kuupäev:** 2026-07-02
**Mudel:** Claude Fable 5
**Skoop:** MUUTUNUD pind — uued OCR-jobs / admin endpointid, upload-tee, hiljutised commitid (PR #106–#110). Eelnev tervik-turvaülevaatus on tehtud (`test_security_fixes.py` jt) — siin ainult regressioonid ja uus rünnakupind.
**Kokkuvõte:** ei leidnud uut kriitilist ega auth-möödahiilimist. Üks kindel path-traversal (admin-only), ülejäänu on info-hügieen / DoS-pind. Auth-mustrid uutel endpointidel on järjepidevad.

---

## KESKMINE

### S1. `admin_reocr_page` path traversal — `page_filename` valideerimata (naaberendpoint on kaitstud)
**Fail:** `server/routers/reocr.py:34-50`
**Raskus:** keskmine. **Kindlus:** kindel.
**Uus vs trackitud:** UUS (muutunud pind).
**Rünnakupind:** `page_filename` võetakse bodyst, `img_path = os.path.join(path, page_filename)`, `os.path.isfile` kontroll, `shutil.copy2` → OCR-server. Puudub basename-kontroll. Sama failis olev `admin_reocr_batch` (rida 141-146) teeb `if fn != os.path.basename(fn): raise 400` eksplitsiitse kommentaariga „väldi path traversal'i (nt ../../state/users.json)". Üksik-lehe endpoint jäeti kaitseta.
**Stsenaarium:** admin-rolliga (mitte tingimata superadmin) konto POST `page_filename="../../state/users.json"` → fail kopeeritakse `/tmp`-i ja edastatakse SFTP-ga OCR-serverisse. `state/` sisaldab bcrypt-hashe, sessioonitokeneid, reset-tokeneid. Info-leke usaldustsooni piiri taha (OCR-server on eraldi masin).
**Soovitus:** lisa `admin_reocr_page`-i sama rida mis batch'is: `if not page_filename or page_filename != os.path.basename(page_filename): raise HTTPException(400)`. (Vt ka pimealade B6 — sama leid.)
**Leevendav asjaolu:** endpoint on `require_role("admin")`. Ei ole anonüümselt/editorilt ligipääsetav.

---

## MADAL

### S2. Ühtne OCR-vaade (`/admin/ocr/jobs`) eksponeerib upload-loojate kasutajanimed adminile — kontrolli, et see on ainult admin
**Fail:** `server/routers/ocr_jobs.py:39-45`, `ocr_jobs_normalize.py:61,95,114` (`username` väli igas kirjes)
**Raskus:** madal. **Kindlus:** kindel (endpoint ON `require_role("admin")`).
**Uus vs trackitud:** UUS (PR #110 lisas creatori username).
**Hinnang:** Endpoint on korrektselt `require_role("admin")`. Username on admin-kontekstis OK. Ainus märkus: `username` ja `slug` (mis võib sisaldada sisulist infot) lähevad ühtsesse loendisse — veendu, et frontend ei kuva `/admin/ocr/jobs` vastust ühelegi mitte-admin vaatele. Ei ole haavatavus, vaid ettevaatuspunkt.
**Soovitus:** OK nagu on; ära lange kiusatusse taaskasutada seda endpointi madalama rolliga vaates.

### S3. `/admin/ocr/jobs` on `async def` + blokeeriv failisüsteemi-I/O (DoS-pind)
**Fail:** `server/routers/ocr_jobs.py:39-45` → `list_uploads()` (skannib `UPLOADS_DIR`, avab iga `state.json`) + `_make_title_reader` (`find_directory_by_id` + `_metadata.json` iga uniq work_id kohta)
**Raskus:** madal. **Kindlus:** tõenäoline.
**Uus vs trackitud:** UUS. (Vt pimealade B1 — sama klass, siin admin-only ja kergem I/O.)
**Rünnakupind:** admin pollib Review-lehel; iga poll teeb sünkroonse kettaskänni event-loopis. Palju uploade + aeglane ketas → event-loop-viivitus. Admin-only, seega DoS-vektor piiratud, aga koormus lisandub kõigi kasutajate arvelt (single-worker).
**Soovitus:** kui B1 lahendatakse (endpointid threadpooli), kaasa see samasse.

### S4. `admin_upload_files`: HTTP-päised `X-Page-Number`/`X-Total-Pages` `int()`-itakse valideerimata
**Fail:** `server/routers/upload.py:70-71`
**Raskus:** madal. **Kindlus:** kindel.
**Rünnakupind:** mittenumbriline päis → `ValueError` enne `try`-blokki → käsitlemata 500. Ainult admin, ainult räpane 500 (mitte turvaauk). Negatiivne/hiigelsuur `X-Total-Pages` läheb `add_image_page`-i loend-loogikasse — kontrolli, et see ei tekita ressursi-probleeme (nt `expected_pages` = suur arv, mis ei lõpe kunagi „done"-iks — aga see on nõuandev stall, mitte krahh).
**Soovitus:** valideeri päised (`try/except` või `int(... or 0)` sanity-piiridega); tagasta 400 vigase päise korral.

### S5. `verify-token` ja `refresh_meili_token` — POST-body / header-token semantika ebakõla (auditipind, mitte auk)
**Fail:** `server/routers/auth.py:62-72` (verify-token loeb body-st, dokumenteeritud põhjusega), `deps.py:12-18` (prosopography router hoiab eraldi body-token kanalit)
**Raskus:** madal. **Kindlus:** spekulatiivne.
**Hinnang:** `deps.py` dokumenteerib teadlikult, et prosopography routeril on eraldi `_get_user`/`_optional_user`, mis loevad tokenit ka JSON-bodyst (legacy). Kaks auth-teed = topelt hooldatav pind; kui üht karastatakse (nt rate-limit, logimine), tuleb meeles pidada teist. Ei ole praegu auk (`require_token` on jagatud tuum), aga risk auth-loogika lahknemiseks tulevikus.
**Soovitus:** `deps.py` juba märgib konsolideerimise TODO-na; hoia see nimekirjas. Ei ole selle akna prioriteet.

---

## Kontrollitud ja PUHTAD (regressioone ei leitud)

- **Uute OCR-endpointide auth:** `/admin/ocr/jobs`, `/admin/reocr/*`, `/admin/work/*/reocr-*` — kõik `require_role("admin")`. `require_role` → `get_user` → `require_token` fail-closed (`role_level` viskab tundmatu rolli peal). ✅
- **Upload-endpointid:** kõik `require_role("admin")`; `_valid_upload_id` regex-kontroll (`^[a-z0-9]{1,20}$`) thumb/files/cancel teedel; `sanitize_slug` idempotentne path-traversal kaitse. ✅
- **Batch reocr path traversal:** eksplitsiitne basename-kontroll (`reocr.py:143`). ✅ (üksik-lehe auk = S1)
- **`_ssh_rm_rf`:** `shlex.quote` + `--` shell-injection kaitse; `remote_path` serveri-koostatud, mitte kasutaja sisend. ✅
- **Rate-limit + konto-lockout:** login kahekihiline (IP + konto), dummy bcrypt timing-equalizer olematu kasutaja korral. Muutmata, endiselt korras. ✅
- **Reset-tokenid (PR #74):** atomaarne consume, rollback, rolli-muutusel/kustutusel revoke, privileegi-eskaleerumise kaitse (`can_manage_user`). ✅
- **Meili tenant-token:** anonüümne = `is_public = true`; scoped = üks work_id; admin = piiranguta. Filter korrektselt koostatud. ✅
- **HTML-escape (SEO meta):** `metadata_handler._escape = html.escape(quote=True)` kõigil kasutaja-andmete väljadel. ✅
- **Image-server:** HMAC-token piiratud teostele + `_is_safe_image_path` (realpath + laiendi allow-list, symlink-kaitse). ✅
- **users.json ei leki:** `get_all_users` ei tagasta `password_hash`. ✅

---

## Prioriteet selle akna jaoks
1. **S1** (path traversal) — ühe-realine fix, kindel, väärib kohest parandust.
2. **S3/S4** — koos B1-ga (async blocking) — operatsiooniline karastus.
3. **S2/S5** — teadlikkuse-punktid, mitte parandust nõudvad.
