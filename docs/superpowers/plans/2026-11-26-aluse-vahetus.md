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
  - `page_fingerprint(work_dir: str, stem: str) -> str` — sha256 kanoonilisest JSON-ist
    `{"text": <.txt sisu>, **{f: json.get(f) for f in page_merge.PAGE_FIELDS if f != "text_content"}}`
    (`page_merge._kanooniline`)
  - `is_edited(page_json: dict) -> bool` — `status != "Toores"` või `comments` või `text_annotations` mittetühi
  - `preview(work_dir: str, eid: str) -> dict` →
    `{"pages": [{"stem","page","status","origin","edited","fingerprint"}], "edited": {stem: fp},
      "unknown": [stem], "images": int, "witness": eid|None, "parts": int}`;
    `origin` = `work_exemplars.page_origins(meta, stems)`; `page` = järjekorranumber (`enumerate_page_images`)
  - `class PromoteError(Exception)` (`status: int`, `code: str`, `detail`)
- Endpoint: `GET /admin/work/{work_id}/exemplars/{eid}/promote/preview` (sync `def`, admin + `can_write_work`)

- [ ] **Step 1: Failing tests:** `test_sormejalg_muutub_kommentaariga` (sama tekst, lisatud
  kommentaar → teine räsi); `test_toores_leht_ei_ole_toimetatud`; `test_eelvaade_paritolu`
  (erandeksemplari leht → tema id, tunnistaja leht → tunnistaja, teadmata → None ja `unknown`-is);
  `test_eelvaade_tunnistajale_409` (eid on tunnistaja → `PromoteError(409, "is_witness")`);
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
- Loomine: `create_upload` teose `type`-i (Q-kood), pealkirja ja slug'iga + `replace_work_id`;
  pildid manifesti järjekorras `store_source.store_image_page`-iga: lähtefail (`original_path` →
  kohalik tee), kui see on olemas; ADA impordil (`original_path` → URL, PDF-i ei hoita) ja muidu
  `{id}.jpg` vaatamiskuju; viimane leht → `awaiting_split`; seejärel `promote` state'i.
- Staatusvastus (`GET /admin/upload/{id}/status` ja `/admin/uploads`) kannab
  `promote: {exemplar_id, holder, shelfmark}` ja `replace_phase` (märgist), kui on.

- [ ] **Step 1: Failing tests:** `test_algus_kopeerib_pildid_jarjekorras` (3 pilti → `source/pg_001..003.jpg`
  sisu = lähtefailid, staatus `awaiting_split`); `test_algus_teos_muutumata`;
  `test_toimetatud_muutus_409` (kinnitus erineb → 409 `edited_pages_changed`);
  `test_siht_ainult_teadmata_lehtedele` (pole teadmata lehti → siht pole vajalik);
  `test_teadmata_lehed_nouavad_sihti`; `test_teine_pooleli_asendus_409`.
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
    ainult need ID-d prügikasti, `imports` ja muud pildid jäävad; samuti ainult `metadata_lock`
- [ ] **Step 1: Failing tests:** `test_stem_ja_upload_id_puhastuse_jarel_alles`;
  `test_former_pages_allikat_klient_ei_muuda`; `test_add_internal_ei_dubleeri`;
  `test_remove_images_internal_ainult_valitud` (imports + teised pildid alles);
  `test_klient_ei_saa_former_pages_saata` (`add_uploads` → `ExemplarImagesError`).
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
    vanade lehtede lukke ja ENNE paaride eemaldust; arvutab sõrmejäljed ja päritolu uuesti; erinevus →
    `PromoteError(409, "edited_pages_changed" | "origins_changed")`; asendus eemaldab siis märgi,
    vabastab lukud ja viskab `HTTPException(409, detail={...})` (midagi pole muudetud)
  - `progress["committed_outputs"] = [f["page"] for f in importable]` (taasteinfos, enne failimuutusi)
  - `promote.finish_locked(upload_id: str, state: dict, work_dir: str, progress: dict, username: str) -> None` —
    kutsutakse `_after_replace_commit`-is pärast osade nullimist, KOHUSTUSLIK (tõrge → `AfterStepError`):
    1. vanad lehepildid (`old_files`, pildilaiendid) `trash_dir`-ist `old_numbers` järjekorras
       `add_internal`-iga `promote.origins[stem]` alla, allikas
       `{kind: "former_pages", ref: progress.old_head, page: old_numbers[stem], stem, upload_id}`;
    2. tunnistaja: `work_exemplars._bulk` + `make_witness(…, promote.exemplar_id)`, sellelt `needs_review` ära;
    3. lähtepildid: N eemaldatakse, kui `prepress.page_map[str(N)]` ⊆ `committed_outputs` ja on
       mittetühi → `remove_images_internal(…, {image_id})`.
    Iga samm on korratav (Task 3 dubleerimiskaitse; tunnistaja seadmine idempotentne).
  - `promote` korral jätab `_after_replace_commit` vahele `_apply_replace_metadata` ja töökollektsioonid.
  - `POST /admin/upload/{upload_id}/promote/finish` → `replace_recovery.recover(upload_id, slug)`;
    tulemus ∉ `OK_RESULTS` → 409 tulemuse koodiga.
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
  `finishPromote(uploadId, token)`; nupp nähtav adminile, kui eksemplaril on pilte ja ta ei ole tunnistaja.
- Dialoog: lehtede arv + seisundite jaotus; „vanad lehed → {eksemplar}" päritolu kaupa; teadmata
  lehtede sihi valik (kohustuslik, kui neid on); osade hoiatus (`parts > 0`); toimetatud lehtede punane
  hoiatus + kinnitusruut (nupp keelatud ilma); 409 `edited_pages_changed` → värske eelvaade ja uus
  kinnitus. Õnnestumine → `navigate('/upload?resumeUpload=' + id)`.
- [ ] **Step 1: Failing tests:** dialoog keelab nupu toimetatud lehtede korral ilma ruuduta; nõuab
  teadmata lehtedele sihti; 409 → näitab uut seisu; edu → navigeerib `resumeUpload`-iga;
  `promoteApi` saadab õiged kehad.
- [ ] **Step 2–4:** FAIL → implementeeri → PASS; `typecheck` 0.
- [ ] **Step 5: Commit** `feat(eksemplarid): „Tee transkriptsiooni aluseks" dialoog ja viisardi tugi`

### Task 6: Dokumentatsioon ja väravad

- [ ] ADR 0089 p 6 → „teostatud"; disainifaili päis (PR 2 tehtud); CLAUDE.md eksemplari lõiku üks
  rida („aluse vahetus käib `server/promote.py` + asenduse kaudu; `former_pages` serveri liik").
- [ ] Väravad järjest; **Commit** `docs: aluse vahetus teostatud (ADR 0089 p 6)`
