# Transkriptsiooni aluse vahetus (PR 2) — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eksemplari lehel nupp „Tee transkriptsiooni aluseks": eksemplari pildid → asendusrežiimis
üleslaadimine → olemasolev viisard (poolitus, OCR) → asendus; lõpetamisel vanad lehed oma päritolu
eksemplari piltideks, tunnistaja märge uuele eksemplarile, imporditud lähtepildid ära.

**Architecture:** Ehitub PR 1 (ADR 0089 p 1–5) peale: asendusmärk, taastemudel (vanad lehefailid
prügikastis), `_after_replace_commit` järelsammud ja `AfterStepError` (kohustuslik samm → märk
jääb, `replace_recovery.recover` kordab). Uus moodul `server/promote.py` (eelvaade, sõrmejäljed,
loomine, lõpetamine); asendus kutsub `promote` korral selle konksud. Frontend: dialoog
eksemplari lehel + olemasolev sügavlink `/upload?resumeUpload={id}`.

**Tech Stack:** Python 3.12 / FastAPI (backend), React 19 + TS + Tailwind (frontend).

**Spec:** `docs/superpowers/specs/2026-11-25-transkriptsiooni-aluse-vahetus-design.md`
(§1–§6, kolm ülevaatust) + `docs/decisions/0089-lehestiku-asendus-ja-aluse-vahetus.md` p 6 ja
täiendused (taastemudel: vanad lehefailid prügikastis, mitte git'is).

## Global Constraints

- Koodikommentaarid eesti keeles; UI-tekst mõlemasse keelde korraga (ADR 0011); uus ikoon
  `icons.ts`-i semantilise nimega + valvuri sõnavara (ADR 0086).
- Õigus: `require_role("admin")` + `can_write_work` (ADR 0031); teose kirjutused `work_lock` →
  `metadata_lock` järjekorras; blokeeriv I/O mitte `async def`-is (ADR 0002).
- Täisekraani/dialoogi modaal `z-[1300]`; tagasiside ainult `useNotify`/`useConfirm`; üks täidetud
  nupp (mälu: dialoogi nupuhierarhia).
- `former_pages` on serveripoolne allikaliik: klient ei saa seda saata (`UPLOAD_KINDS`,
  `EDIT_KINDS` ei sisalda) ega muuta.
- Teose metaandmed ja töökollektsioonid vahetusel EI muutu.
- Väravad järjest: `typecheck` → `lint:ci` (≤ 41) → `npm test` → `.venv/bin/pytest tests/`.

## Review Focus

1. **Eksemplar, mille pildid ei ole lehed** (nt köitepildid segamini) — poolitusviisard laseb
   lehed välja jätta; välja jäetud lähtepilt PEAB eksemplari alla jääma.
   Test: Task 4 `test_valja_jaetud_lahtepilt_jaab`.
2. **Teosel tunnistajat pole ja teadmata päritoluga lehti pole** (kõik lehed erandeksemplaride
   omad) — siht pole vajalik, loomine peab õnnestuma. Test: Task 2 `test_siht_ainult_teadmata_lehtedele`.
3. **Kaks vahetust järjest** samal teosel (A → B, siis B → A) — teine näeb esimese `former_pages`
   pilte tavaliste piltidena; tagasivahetus peab toimima. Test: Task 4 `test_tagasivahetus`.
4. **Lõpetamise katkestus pärast esimest vana lehte** — kordus ei dubleeri.
   Test: Task 4 `test_lopetamise_kordus_ei_dubleeri`.
5. **Vahetuse ajal eksemplari muutmine/kustutamine** — `work_lock` + asendusmärk → 409 (tasuta
   PR 1-st); kontrolli, et eksemplari otspunktid seda tõesti kasutavad.
   Test: Task 4 `test_eksemplari_kustutus_vahetuse_ajal_409`.

---

### Task 1: Eelvaade — lehtede sõrmejäljed, päritolu, toimetatud lehed

**Files:**
- Create: `server/promote.py`
- Modify: `server/routers/work_exemplars.py` (GET otspunkt)
- Test: `tests/test_promote_eelvaade.py`

**Interfaces:**
- Produces (`server/promote.py`):
  - `page_fingerprint(work_dir: str, stem: str) -> str` — sha256 `page_merge._kanooniline(
    page_merge.read_page_view(txt, json))`-ist (sama projektsioon mis `meili_doc`/`/save`: loeb ka vana
    `meta_content`-i ja `tags`-kuju)
  - `is_edited(view: dict) -> bool` — `status != "Toores"` või `page_tags`, `comments` või
    `text_annotations` mittetühi (toorel lehel võivad olla toimetaja märksõnad)
  - `preview(work_dir: str, eid: str) -> dict` →
    `{"pages": [{"stem","page","status","origin","edited","fingerprint"}], "edited": {stem: fp},
      "unknown": [stem], "images": int, "witness": eid|None, "parts": int}`;
    `origin` = `work_exemplars.page_origins(meta, stems)`; `page` = järjekorranumber (`enumerate_page_images`)
  - `class PromoteError(Exception)` (`status: int`, `code: str`, `detail`)
  - eelvaade kannab `unstorable: [{stem, reason}]` — vanad lehepildid, mida eksemplaripildina
    salvestada ei saa (`exemplar_image_files.storable_reason(path) -> str | None`, samad piirid mis
    `store_image`: suurus, `MAX_SIDE`, loetavus); nt 12 001 × 256 JPEG läbis üleslaadimise, aga mitte
    `store_image`-i
- Endpoint: `GET /admin/work/{work_id}/exemplars/{eid}/promote/preview` (sync `def`, admin + `can_write_work`)

- [ ] **Step 1: Failing tests:** `test_sormejalg_muutub_kommentaariga` (sama tekst, lisatud
  kommentaar → teine räsi); `test_toores_leht_ei_ole_toimetatud`;
  `test_toores_leht_markusonaga_on_toimetatud` (ainus muudatus märksõna, ka vanas `tags`/`meta_content` kujus); `test_eelvaade_paritolu`
  (erandeksemplari leht → tema id, tunnistaja leht → tunnistaja, teadmata → None ja `unknown`-is);
  `test_eelvaade_tunnistajale_409` (eid on tunnistaja → `PromoteError(409, "is_witness")`);
  `test_eelvaade_naitab_salvestamatut_vana_lehte` (12 001 × 256 JPEG → `unstorable`);
  `test_eelvaade_piltideta_409`.
- [ ] **Step 2:** pytest → FAIL. **Step 3:** implementeeri. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(eksemplarid): aluse vahetuse eelvaade (sõrmejäljed, päritolu)`

### Task 2: Vahetuse alustamine — üleslaadimine eksemplari piltidest

**Files:**
- Modify: `server/promote.py`, `server/routers/work_exemplars.py`, `server/upload_ops.py` (staatuse vastusesse `promote` kokkuvõte)
- Test: `tests/test_promote_algus.py`

**Interfaces:**
- Consumes: Task 1 `preview`, `PromoteError`.
- Produces:
  - `start(work_dir: str, work_id: str, eid: str, unknown_target: str|None, confirmed_edited: dict, username: str) -> str` (upload_id)
  - upload state `promote = {"exemplar_id", "source_images": [{"page": N, "image_id"}], "manifest_revision",
    "origins": {stem: eid}, "unknown_target", "confirmed_edited": {stem: fp}, "requested_by", "at"}`
  - `POST /admin/work/{work_id}/exemplars/{eid}/promote` keha `{unknown_target, confirmed_edited}` → `{upload_id}`
- Kontrollid (`work_lock` all): eid olemas, pilte ≥ 1, ei ole tunnistaja; teadmata lehti on →
  `unknown_target` olemas ja ≠ eid (muidu 400 `unknown_target_required`); teosel pole teist
  pooleliolevat asendusega üleslaadimist (state'id `replace_work_id == work_id`, staatus ∉
  {`imported`, `error`}) ega asendusmärki → 409; `confirmed_edited` == eelvaate `edited` → muidu
  409 `{"code": "edited_pages_changed", "edited": …}`.
- Loomine: `create_upload` teose `type`-i (Q-kood), pealkirja ja slug'iga + `replace_work_id`.
  Pildid manifesti järjekorras: lähtefail (`original_path` → kohalik tee), kui see on olemas; ADA
  impordil (`original_path` → URL, PDF-i ei hoita) ja muidu `{id}.jpg` vaatamiskuju.
  **`store_image_page` LIIGUTAB faili (PNG/TIFF kustutab pärast teisendust) → anna talle AJUTINE
  KOOPIA** (`shutil.copy2` üleslaadimise tmp-kausta), mitte eksemplari faili.
  **Üks avaldamine (atomaarne kaust):** `create_upload` jagatakse `build_upload_state(meta, username)
  -> (upload_id, state)` + kirjutus. Vahetus ehitab kogu üleslaadimise kausta
  `UPLOADS_DIR/.staging-{upload_id}/` alla (lähtefailid, `state.json` koos `promote`-i, `prepress`-i
  ja `status = "awaiting_split"`-iga) ja avaldab selle **ühe `os.rename`-iga** `UPLOADS_DIR/{id}`-ks.
  Pooleli kaust ei ole kunagi loendis ega avatav. `.staging-*` kaustu ignoreerivad loend ja aktiivse
  asenduse kontroll; **serveri käivitusel** (lifespan, `recover_all` kõrval) kustutatakse need.
  **Lähtepiltide salvestus on ÜKS loogika:** `store_image_page`-ist eraldatakse
  `write_source_image(dest_dir, tmp_path, page_number) -> str` (valideerimine + PNG/TIFF → JPEG
  teisendus + nimi), mida kasutavad nii tavaline üleslaadimine (pärast seda oleku uuendus) kui vahetus
  (ilma olekuta). Muidu jääks `.tif` leheloendist välja ja `.jpg` nimega PNG läbiks baitkoopia kontrolli.
  **Numbriline järjestus:** `ImageDirPageSource._list` sorteerib `pg_(\d+)` järgi numbriliselt
  (mitte tähestikuliselt: `pg_1000.jpg` < `pg_101.jpg`) — sama järjekord, millega `source_images`
  numbrid antakse. Parandab ka tavalise üle 999 pildiga üleslaadimise.
  **`promote` tööl on kliendi lähtefailide teed suletud:** `/files`, `/chunk`, ADA `ada-fetch` →
  409, kui state'is on `promote` (muidu saaks lähtefaile üle kirjutada ja `source_images` seos —
  ning lähtepiltide eemaldus — oleks vale).
  **Salvestamatu vana leht** (`preview.unstorable` mittetühi) → 400 `old_page_unstorable` enne
  üleslaadimise loomist.
  **Vea korral** koristatakse pooleli üleslaadimine (`cancel_upload`), eksemplar jääb puutumata.
- Staatusvastus kannab `promote: {exemplar_id, holder, shelfmark}` ja `replace_phase` (märgist):
  `/status` koostab vastuse `server/upload/thumbs.py` `_payload`-is (`poll_and_sync_thumbs`) → lisa
  sinna; `/admin/uploads` loend samuti.

- [ ] **Step 1: Failing tests:** `test_algus_kopeerib_pildid_jarjekorras` (3 pilti → `source/pg_001..003.jpg`
  sisu = lähtefailid, staatus `awaiting_split`); `test_algus_teos_muutumata`;
  `test_toimetatud_muutus_409` (kinnitus erineb → 409 `edited_pages_changed`);
  `test_siht_ainult_teadmata_lehtedele` (pole teadmata lehti → siht pole vajalik);
  `test_teadmata_lehed_nouavad_sihti`; `test_teine_pooleli_asendus_409`;
  `test_eksemplari_failid_jaavad_alles` (pärast algust on kõik lähtefailid, ka PNG, eksemplari all);
  `test_vea_korral_uleslaadimine_koristatakse`; `test_awaiting_split_alles_parast_promote_i`;
  `test_status_ja_loend_kannavad_promote_i` (nii `/status` kui `/admin/uploads`);
  `test_staging_ei_ole_loendis_ega_avatav`; `test_promote_tool_files_ja_chunk_409`;
  `test_kaivitus_koristab_staging_kausta_ja_uus_algus_onnestub`;
  `test_png_ja_tiff_teisendatakse_mõlemas_voos`;
  `test_ule_999_pildi_jarjestus_ja_valjajatmine` (1 001 pilti; pilt 1000 välja jäetud → lõpetamine
  eemaldab õiged ID-d, pilt 1000 jääb);
  `test_salvestamatu_vana_leht_400`.
- [ ] **Step 2–4:** FAIL → implementeeri → PASS.
- [ ] **Step 5: Commit** `feat(eksemplarid): aluse vahetuse algus eksemplari piltidest`

### Task 3: Eksemplari piltide serveripoolsed abid

**Files:**
- Modify: `server/exemplar_images.py`
- Test: `tests/test_exemplar_images_internal.py`

**Interfaces:**
- Produces:
  - `_SOURCE_KEYS` += `"stem"`, `"upload_id"`; `INTERNAL_KINDS = frozenset({"former_pages"})`
  - `_merge_image`: `kind == "former_pages"` → salvestatud allikas jääb (kliendilt ainult `license`)
  - `add_internal(work_dir: str, eid: str, files: list[tuple[str, dict]], username: str) -> dict` —
    `files` = `[(failitee, allikas)]`, allikas serveri oma (`former_pages`); kutsuja hoiab `work_lock`-i,
    seega võetakse AINULT `metadata_lock` — MITTE `exemplar_locks` (see võtab `work_lock`-i, mis ei
    ole taassisenetav → ummik); manifest loetakse luku all kettalt ja vahele jäetakse failid, mille
    `(source.upload_id, source.stem)` on juba olemas
  - `remove_images_internal(work_dir: str, eid: str, image_ids: set[str], username: str) -> int` —
    ainult need ID-d prügikasti, `imports` ja muud pildid jäävad; samuti ainult `metadata_lock`.
    Järjekord: manifestikirjed ära + commit → failid prügikasti. Korduskindel: ID, mida manifestis
    enam pole, aga mille failid on eksemplari kaustas alles (katkestus pärast manifesti), viiakse
    prügikasti. **Range liigutus:** oma abifunktsioon (mitte `_move_to_trash`, mis logib `OSError`-i
    ja jätkab) — iga liigutuse tõrge → `ExemplarImagesError` → asenduses `AfterStepError` (märk jääb).
  - `add_internal` kasutab `store_image`-i; selle `ImageFileError` → `ExemplarImagesError` (aga
    salvestatavus on juba enne asendust kontrollitud, Task 2 ja `recheck_locked`).
  - **Tulemused on kohustuslikud:** mõlemad viskavad `ExemplarImagesError`, kui `write_manifest_locked`
    tagastab `False`. Kordusel commititakse kettal olev, aga commitimata manifest (`commit_manifest_if_dirty`:
    ketas ≠ HEAD → commit; tõrge → viga), enne kui uusi muudatusi tehakse.
- [ ] **Step 1: Failing tests:** `test_stem_ja_upload_id_puhastuse_jarel_alles`;
  `test_former_pages_allikat_klient_ei_muuda`; `test_add_internal_ei_dubleeri`;
  `test_remove_images_internal_ainult_valitud` (imports + teised pildid alles);
  `test_klient_ei_saa_former_pages_saata` (`add_uploads` → `ExemplarImagesError`);
  `test_commit_torge_viskab` (`write_manifest_locked` → False → viga);
  `test_kordus_commitib_kettal_oleva_manifesti`; `test_kordus_viib_orvud_failid_prugikasti`;
  `test_prugikasti_viimise_torge_viskab` (liigutus kukub → viga, kordus viib faili prügikasti).
- [ ] **Step 2–4:** FAIL → implementeeri → PASS (+ `tests/test_exemplar_images*.py`).
- [ ] **Step 5: Commit** `feat(eksemplarid): former_pages allikas ja serveripoolsed pildiabid`

### Task 4: Asenduse konksud ja lõpetamine

**Files:**
- Modify: `server/upload_ops.py` (`_replace_work_content_locked`, `_after_replace_commit`, `_apply_replace_metadata`), `server/promote.py`, `server/routers/upload.py`
- Test: `tests/test_promote_lopetus.py`

**Interfaces:**
- Consumes: Task 2 state `promote`; Task 3 `add_internal`, `remove_images_internal`; PR 1
  `progress` (`old_files`, `old_numbers`, `trash_dir`), `AfterStepError`, `recover`.
- Produces:
  - `promote.recheck_locked(work_dir: str, promote: dict) -> None` — kutsutakse asenduses PÄRAST
    vanade lehtede lukke ja ENNE paaride eemaldust; kontrollib, et **lähteeksemplar ja KÕIK
    `origins` sihid on olemas**, arvutab sõrmejäljed ja päritolu uuesti; erinevus →
    `PromoteError(409, "edited_pages_changed" | "origins_changed" | "target_missing" |
    "old_page_unstorable")` (vanade lehepiltide salvestatavus kontrollitakse ENNE commit'i — muidu
    jääks lõpetamine pärast commit'i igal kordusel samasse kohta kinni); asendus eemaldab
    siis märgi, vabastab lukud ja viskab `HTTPException(409, detail={code, preview})` (midagi pole muudetud)
  - **Märk kannab kogu lõpetamiseks vajaliku** (üleslaadimise kaust võib kaduda): `progress["promote"] =
    {exemplar_id, origins, upload_id}`, `progress["committed_outputs"]`, `progress["remove_source_ids"]`
    (arvutatud `page_map`-ist ja commititud väljunditest ENNE failimuutusi) ja `progress["old_pages"] =
    [{stem, page, images: [failinimed]}]` — **eelvaate leheloendist** (`enumerate_page_images` →
    tüvi → number, pildifailid sama tüvega; `_thumb_*` EI ole lehed). Lõpetamine loeb ainult märki.
  - **Tühistus ja asenduse algus sama luku all:** `admin_upload_cancel` võtab state'i `replace_work_id`
    teose `work_lock`-i ja kontrollib märki selle all (asendus kirjutab märgi sama luku all).
  - `promote.finish_locked(upload_id: str, state: dict, work_dir: str, progress: dict, username: str) -> None` —
    kutsutakse `_after_replace_commit`-is pärast osade nullimist, KOHUSTUSLIK (tõrge → `AfterStepError`):
    1. vanad lehepildid `progress.old_pages` järgi `trash_dir`-ist `add_internal`-iga
       `promote.origins[stem]` alla, allikas
       `{kind: "former_pages", ref: progress.old_head, page, stem, upload_id}`;
    2. tunnistaja: `work_exemplars._bulk(..., require_commit=True)` + `make_witness(…, exemplar_id)`,
       sellelt `needs_review` ära;
    3. lähtepildid: `remove_images_internal(…, progress.remove_source_ids)`.
    Iga samm on korratav (Task 3 dubleerimiskaitse ja orbude koristus; tunnistaja idempotentne) ja iga
    kirjutuse **tulemust** kontrollitakse (mitte ainult erindeid): `False`/`git_committed is False`
    → `AfterStepError`. `promote` korral on ka `reset_page_origins` kohustuslik (tagastab tulemuse,
    tõrge → `AfterStepError`).
  - `promote` korral jätab `_after_replace_commit` vahele `_apply_replace_metadata` ja töökollektsioonid.
  - **Lõpetamine märgi järgi, mitte üleslaadimise järgi** (kaust võib olla kadunud):
    `POST /admin/work/{work_id}/replace/finish` keha `{upload_id}` (vaates näidatud
    `replace_pending.upload_id`) → teose luku all: aktiivse märgi `upload_id` PEAB võrduma → muidu 409
    `stale` (aegunud vaade ei käivita järgmise asenduse taastet) → `recover_locked`.
    Vastus kannab tulemuse ERALDI: `{"result": "replaced" | "restored" | "cleared" | <tõrge>}` —
    `restored` tähendab, et vana lehestik taastati (vahetus EI toimunud), klient näitab seda eraldi.
    Tõrge (`restore_failed`, `commit_unknown`, `after_failed`, `index_failed`) → 409 koodiga.
  - Jätkamise info tuleb märgist: `GET /works/{id}/exemplars` vastus kannab
    `replace_pending: {upload_id, phase}` (märk olemas), `/admin/uploads` lisab märgid, millel
    üleslaadimise kausta pole (`orphan: true`).
  - `POST /admin/upload/{upload_id}/promote/confirm` keha `{unknown_target, confirmed_edited}` —
    lõppkontrolli 409 järel uus kinnitus sama üleslaadimise juures (kontrollid nagu Task 2; kirjutab
    `promote.confirmed_edited`, `origins`, `unknown_target` ümber); siis asenduse kordus.
- [ ] **Step 1: Failing tests** (`_edukas_asendus_seadistus` mall + eksemplarid `_metadata.json`-is + eksemplari pildid):
  - `test_vanad_lehed_paritolu_eksemplari_alla` (tunnistaja lehed → vana tunnistaja, erandleht → oma eksemplar, õiges järjekorras, õige allikas)
  - `test_tunnistaja_vahetub_taepselt_uks`
  - `test_valja_jaetud_lahtepilt_jaab` (page_map-is välja jäetud / kustutatud väljund → pilt alles)
  - `test_metaandmed_ja_tookollektsioonid_muutumata`
  - `test_toimetatud_leht_ocr_ajal_409_enne_muutusi` (recheck → 409, teose failid puutumata, märk ära)
  - `test_lopetamise_kordus_ei_dubleeri` (katkestus pärast 1. vana lehte → `recover` → iga vana leht täpselt üks kord)
  - `test_lopetamise_torge_jatab_margi` (add_internal viskab → märk alles faasiga `replaced`, `finish` lõpetab)
  - `test_tagasivahetus` (A → B, siis B → A)
  - `test_eksemplari_kustutus_vahetuse_ajal_409`
  - `test_valitud_siht_kustutati_ocr_ajal_409` (siht kustutatakse pärast algust → `target_missing`, midagi ei muutu)
  - `test_pisipildid_ja_eri_laiendid` (`_thumb_*.jpg`, `.JPG`, `.png` lehepildid → ainult lehed `former_pages`-iks, lõpetamine ei takerdu)
  - `test_lopetamine_ainult_margist` (üleslaadimise kaust kustutatud pärast commit'i → `finish` lõpetab)
  - `test_tuhistus_ja_algus_sama_luku_all` (tühistus võtab teose luku; märgi korral 409)
  - `test_tunnistaja_commit_torge_jatab_margi`; `test_paritolu_nullimise_torge_jatab_margi`
  - `test_confirm_parast_409_ja_kordus_onnestub`
  - `test_finish_teose_jargi_ilma_uleslaadimiseta` (kaust kustutatud → `/admin/work/{id}/replace/finish` → `replaced`)
  - `test_finish_aegunud_upload_id_409` (märk on teise üleslaadimise oma → `stale`, midagi ei tehta)
  - `test_finish_tagastab_restored_eraldi` (märk enne commit'i → `restored`, mitte edu)
  - `test_exemplars_vastus_kannab_replace_pending`; `test_uploads_loend_naitab_orvu_margi`
  - `test_salvestamatu_vana_leht_ocr_ajal_409` (recheck → `old_page_unstorable`, midagi ei muutu)
- [ ] **Step 2–4:** FAIL → implementeeri → PASS (+ kõik `tests/test_asendus*.py`, `test_replace_work_content.py`).
- [ ] **Step 5: Commit** `feat(eksemplarid): aluse vahetuse konksud ja lõpetamine asenduses`

### Task 5: Frontend — nupp, dialoog, viisardi bänner, „Lõpeta"

**Files:**
- Create: `src/pages/exemplar/PromoteDialog.tsx` (või `components/exemplars/`, vastavalt eksemplari lehe paigutusele), `src/services/promoteApi.ts`
- Modify: eksemplari lehe kaart (`ExemplarList`/eksemplari leht), `src/pages/upload/` (bänner sammudes 3–4, metaandmete vormi peitmine `promote` korral), üleslaadimiste nimekiri („Lõpeta aluse vahetus"), `src/components/icons.ts` + valvuri `VOCABULARY`, `src/locales/{et,en}/*.json`
- Test: `PromoteDialog.test.tsx`, `promoteApi.test.ts`

**Interfaces:**
- Consumes: Task 1 GET eelvaade, Task 2 POST algus (`{upload_id}`), Task 4 POST finish; staatuse `promote`/`replace_phase`.
- Produces: `fetchPromotePreview(workId, eid, token)`, `startPromote(workId, eid, body, token) -> string`,
  `confirmPromote(uploadId, body, token)`, `finishReplace(workId, uploadId, token) -> {result}`;
  „Lõpeta lehestiku asendus" nupp eksemplari lehel `replace_pending` põhjal ja üleslaadimiste loendis
  (ka `orphan` kirjetel); tulemuse teade eristab `replaced` / `restored` / `cleared`;
  dialoog näitab `unstorable` lehti ja ei luba alustada; nupp nähtav adminile, kui eksemplaril on pilte ja ta ei ole tunnistaja.
- Dialoog: lehtede arv + seisundite jaotus; „vanad lehed → {eksemplar}" päritolu kaupa; teadmata
  lehtede sihi valik (kohustuslik, kui neid on); osade hoiatus (`parts > 0`); toimetatud lehtede punane
  hoiatus + kinnitusruut (nupp keelatud ilma); 409 `edited_pages_changed` → värske eelvaade ja uus
  kinnitus. Õnnestumine → `navigate('/upload?resumeUpload=' + id)`.
- **Viisardi 409 jätkutee:** asenduse 409 (`edited_pages_changed` / `origins_changed` / `target_missing`)
  → sama dialoog „kinnita muutunud seis" režiimis (vastuse `preview`), vajadusel uus siht →
  `confirmPromote(uploadId, body)` → asenduse kordus. Mitte ainult veateade.
- [ ] **Step 1: Failing tests:** dialoog keelab nupu toimetatud lehtede korral ilma ruuduta; nõuab
  teadmata lehtedele sihti; 409 → näitab uut seisu; edu → navigeerib `resumeUpload`-iga;
  viisardi asenduse 409 → kinnitusdialoog → `confirmPromote` → kordus; `promoteApi` saadab õiged kehad.
- [ ] **Step 2–4:** FAIL → implementeeri → PASS; `typecheck` 0.
- [ ] **Step 5: Commit** `feat(eksemplarid): „Tee transkriptsiooni aluseks" dialoog ja viisardi tugi`

### Task 6: Dokumentatsioon ja väravad

- [ ] ADR 0089 p 6 → „teostatud"; disainifaili päis (PR 2 tehtud); CLAUDE.md eksemplari lõiku üks
  rida („aluse vahetus käib `server/promote.py` + asenduse kaudu; `former_pages` serveri liik").
- [ ] Väravad järjest; **Commit** `docs: aluse vahetus teostatud (ADR 0089 p 6)`

## Ülevaatus 2026-11-26 (commit `05dde61a` vastu)

Kõik punktid kontrolliti koodi vastu (`store_image_page` liigutab faili; `old_files` sisaldab
`_thumb_`-e; `write_manifest_locked` → bool; `_bulk(require_commit=…)`; `reset_page_origins` eirab
tulemust; `read_page_view`; `thumbs._payload`). Parandused: ajutised koopiad + koristus +
`awaiting_split` viimasena (T2); sihtide olemasolu lõppkontrollis, leheloend eelvaatest (mitte
laiendi järgi), märk kannab kogu lõpetamise info, tühistus teose luku all, tulemuste kontroll (T3–T4);
viisardi 409 jätkutee (`/promote/confirm`), `read_page_view` sõrmejäljes, märksõnaga toores leht,
`/status` `_payload`-i kaudu (T1, T2, T5).

## Ülevaatus 2 (2026-11-26, commit `1b30156a` vastu)

Kontrollitud koodist: `create_upload` avaldab kohe, `store_image_page` seab `awaiting_split`
eraldi `init_prepress`-ist; `/files` kirjutab lähtefaile; `_move_to_trash` logib `OSError`-i ja
jätkab; `store_image` lükkab `MAX_SIDE`-st suurema pildi tagasi. Parandused: `preparing` + üks
avaldamine, `promote` tööl kliendi failiteed 409 (T2); lõpetamine teose märgi järgi ja tulemused
eraldi, `replace_pending`/orvu märgid loendis (T4–T5); range prügikasti viimine (T3); vanade
lehepiltide salvestatavus eelvaates, algusel ja lõppkontrollis (T1, T2, T4).

## Ülevaatus 3 (2026-11-26, commit `f3d35e6e` vastu)

Kontrollitud koodist: `ImageDirPageSource._list` sorteerib tähestikuliselt ja tunneb ainult
`.jpg/.jpeg/.png`; PNG/TIFF teisendus elab `store_image_page`-is. Parandused: atomaarne
`.staging-*` kaust + käivitusaegne koristus (mitte `preparing` olek); ühine `write_source_image`;
numbriline järjestus (ka tavalisele üleslaadimisele); lõpetamine nõuab vaates näidatud `upload_id`-d.
