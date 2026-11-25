# Lehestiku asenduse karastamine (PR 1) — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Olemasolev „Asenda sisu" (`replace_work_content`) on seotud õige teosega, taastatav
katkestuse järel, kaitstud samaaegsete kirjutuste eest, ei lase aegunud redaktoril uut lehte üle
kirjutada ega jäta osi viitama valedele lehtedele.

**Architecture:** Püsiv asendusmärk `state/work_replacing/{slug}.json` + lukkude kontroll
(`page_lock`, `work_lock`); taasteinfo upload state'is enne esimest failimuutust; commit'i
treiler; lehe serveriväli `content_generation`; osade nullimine. PR 2 (aluse vahetus) ehitub
nende liideste peale.

**Tech Stack:** Python 3.12 / FastAPI / GitPython (backend), React 19 + TS (osade vihje).

**Spec:** `docs/superpowers/specs/2026-11-25-transkriptsiooni-aluse-vahetus-design.md`
(§4 asendus, §6 invariandid; „kehtib kõigile asendustele" osad) ja
`docs/decisions/0089-lehestiku-asendus-ja-aluse-vahetus.md` p 1–5.

## Global Constraints

- Koodikommentaarid eesti keeles; UI-tekst mõlemasse keelde korraga (`et` + `en`, ADR 0011).
- Blokeeriv I/O `async def` sees keelatud (ADR 0002): sync `def` või `run_in_threadpool`.
- Lehe JSON-i uus serveriväli PEAB minema `SERVERIPOOLSED_LEHE_VALJAD`-i (CLAUDE.md).
- Lukujärjekord: `work_lock` → `page_lock`-id → `metadata_lock` → git.
- Teed `server.config`-ist (`STATE_DIR`, `BASE_DIR`), mitte `__file__`-i suhtes.
- Testid: `.venv/bin/pytest`; vitest jsdom-päisega komponenditestides; väravad järjest, mitte
  paralleelselt (mälu, CLAUDE.md).
- 409 teksti muster lehe aegumisel: kahekeelne string nagu ADR 0077 („… laadi leht uuesti. /
  … please reload.").

## Review Focus

1. **Asendus, mis kukub commit'i järel, aga enne märgi eemaldamist** — märk jääb, teos peab olema
   uue lehestikuga kasutatav pärast käivitusaegset tuvastust (treiler leitud → märk ära).
   Test: Task 3 `test_katkestus_parast_commiti_tuvastatakse`.
2. **Teise teose `page_lock` asendusmärgi ajal** — kaitse peab olema teose-, mitte globaalne.
   Test: Task 2 `test_teise_teose_leht_ei_ole_blokeeritud`.
3. **Leht, mida pole kunagi asendatud** (`content_generation` puudub nii kliendil kui kettal) —
   `/save` peab käituma nagu enne. Test: Task 4 `test_asendamata_leht_salvestub_nagu_enne`.
4. **Tavaline asendus ilma osadeta teosel** — osade samm ei tohi kirjutada `_metadata.json`-i
   (no-op, ADR 0012). Test: Task 5 `test_osadeta_teos_ei_muutu`.
5. **Taastamine, kui uus lehestik on vanast pikem** (16 → 21) — lisalehtede JPG-d ja txt/json
   kustuvad, vanad 16 tulevad tagasi. Test: Task 3 `test_taastamine_pikema_uue_lehestikuga`.

---

### Task 1: Asenduse sidumine üleslaadimisega

**Files:**
- Modify: `server/upload_ops.py` (`_replace_work_content_locked`, staatuse kontrolli järel)
- Test: `tests/test_asendus_sidumine.py`

**Interfaces:**
- Produces: `replace_work_content` tõstab `HTTPException(409)`, kui
  `state.get("replace_work_id")` on olemas ja ≠ `target_work_id`.

- [ ] **Step 1: Failing test** — `test_url_ja_replace_work_id_erinevad_409`: upload state
  `replace_work_id="aaa111"`, kutse `replace_work_content(uid, "bbb222", {}, "u", None)` →
  `HTTPException.status_code == 409`, teose kaust puutumata. Ja
  `test_sobiv_work_id_laheb_edasi` (sama ID → ei viska 409 enne järgmist kontrolli).
  Mallid: olemasolevad asenduse testid (`grep -l replace_work_content tests/`).
- [ ] **Step 2:** `.venv/bin/pytest tests/test_asendus_sidumine.py -v` → FAIL.
- [ ] **Step 3:** Kontroll `_replace_work_content_locked`-is kohe pärast staatuse kontrolli.
  `replace_work_id` puudumisel (vanad üleslaadimised) lase edasi.
- [ ] **Step 4:** test → PASS.
- [ ] **Step 5: Commit** `fix(upload): asendus nõuab URL-i teose = replace_work_id (ADR 0089 p 1)`

### Task 2: Asendusmärk ja kirjutuskaitse

**Files:**
- Create: `server/replace_marker.py`
- Modify: `server/page_locks.py` (`page_lock`), `server/admin_page_ops.py` (`work_lock`),
  `server/main.py` (exception handler)
- Test: `tests/test_asendusmark.py`

**Interfaces:**
- Produces (`server/replace_marker.py`):
  - `class WorkReplacingError(Exception)` (atribuut `slug`)
  - `write_marker(slug: str, upload_id: str) -> None` — `atomic_write_json`
    `STATE_DIR/work_replacing/{slug}.json` = `{"upload_id", "at"}`
  - `read_marker(slug: str) -> dict | None`
  - `remove_marker(slug: str) -> None` (idempotentne)
  - `list_markers() -> list[tuple[str, dict]]`
  - `@contextmanager marker_owner(upload_id: str)` — lõimelokaalne omanik
  - `check_not_replacing(slug: str) -> None` — viskab `WorkReplacingError`, kui märk on ja
    lõimelokaalne omanik ≠ märgi `upload_id`
- `page_lock(path)`: kui `os.path.dirname(os.path.dirname(abspath(path))) == BASE_DIR`, kutsu
  `check_not_replacing(basename(dirname(path)))` ENNE luku võtmist **ja** pärast (märk võis tekkida
  ootamise ajal).
- `work_lock(work_id, work_dir)`: `check_not_replacing(basename(work_dir))` samuti enne ja pärast.
- `main.py`: `@app.exception_handler(WorkReplacingError)` → 409
  `{"detail": "Teose lehestik on asendamisel, proovi hetke pärast uuesti. / The work's pages are being replaced, try again shortly."}`.

- [ ] **Step 1: Failing tests:**
  - `test_mark_blokeerib_page_lock_vooraal` — `write_marker("slug1","u1")`; `page_lock(BASE_DIR/slug1/x.txt)` viskab `WorkReplacingError`.
  - `test_omanik_paaseb` — `with marker_owner("u1"): with page_lock(...)` ei viska.
  - `test_teise_teose_leht_ei_ole_blokeeritud` — `page_lock(BASE_DIR/slug2/x.txt)` ei viska.
  - `test_work_lock_blokeeritud` — `work_lock("slug1", BASE_DIR/slug1)` viskab; omanikuna ei viska.
  - `test_save_marki_ajal_409` — TestClient `/save` asendatava teose lehele → 409, kahekeelne detail.
  - `test_remove_marker_idempotentne`.
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** Implementeeri moodul ja kontrollid (`threading.local` omanikule).
- [ ] **Step 4:** pytest → PASS; lisaks `tests/test_page_lock*.py` ja `test_async_ei_blokeeri.py` → PASS.
- [ ] **Step 5: Commit** `feat(asendus): asendusmärk ja kirjutuskaitse (ADR 0089 p 2)`

### Task 3: Taastatav asendus (taasteinfo, treiler, taastamine, käivitusaegne tuvastus)

**Files:**
- Create: `server/upload/replace_recovery.py`
- Modify: `server/upload_ops.py` (`_replace_work_content_locked`), `server/main.py` (lifespan)
- Test: `tests/test_asendus_taaste.py`

**Interfaces:**
- Consumes: Task 2 `write_marker`, `remove_marker`, `marker_owner`, `list_markers`.
- Produces:
  - upload state väli `replace_progress = {"phase": "replacing"|"replaced", "old_head", "trash_dir", "old_jpgs": [nimi], "new_files": [nimi]}` — kirjutatakse **enne** `clear_all_pairs`-i
  - commit'i sõnum `f"Asenda sisu: {slug} ({work_id})\n\nUpload: {upload_id}"`
  - `replace_recovery.find_replace_commit(repo, old_head: str, slug: str, upload_id: str) -> str | None`
  - `replace_recovery.restore_replace(work_dir: str, progress: dict, repo) -> None` — ADR 0089 p 3
    (jälgitavad uued failid `git diff --name-only old_head -- slug` → `git rm -f`; `git checkout old_head -- slug`; JPG-reegel prügikasti oleku järgi; `new_files` JPG-d, mille nime `old_jpgs`-is pole → kustuta)
  - `replace_recovery.recover(upload_id: str) -> str` — tagastab `"replaced"` (treiler leitud: märk ära, `phase="replaced"`) või `"restored"` (taastatud, `replace_progress` ära, märk ära); `work_lock` + `marker_owner` all
  - `replace_recovery.recover_all() -> None` — lifespan'is taustalõimes (nagu `rebuild_indices`): iga `list_markers()` → `recover(upload_id)`; vead `record_server_error`-isse
- `_replace_work_content_locked` muutused: taasteinfo + `write_marker` enne esimest failimuutust; kogu
  failitöö `marker_owner(upload_id)` all; olemasolevad kaks rollback-kohta (`checkout(old_head, '--', slug)`)
  asenduvad `restore_replace`-iga; pärast commit'i `phase="replaced"`, `remove_marker` alles Task 4
  põlvkonna kirjutuse järel (selles taskis kohe pärast commit'i; Task 4 nihutab).
  Commit'i tõrke senine käitumine (hoiatus) jääb tavalisele asendusele (PR 2 teeb `promote`-ile vea).

- [ ] **Step 1: Failing tests** (ajutine git-repo + `BASE_DIR`/`STATE_DIR` tmp, nagu juur-`conftest.py`):
  - `test_rollback_eemaldab_uued_stagetud_failid` — git rm vea simulatsioon pärast uute failide kirjutust → uued `.txt/.json` kadunud, vanad tagasi, `git status` puhas.
  - `test_jpg_katkestus_enne_liigutamist` — `old_jpgs` kõik algses kohas, `trash_dir` tühi → `restore_replace` ei kustuta ühtki vana JPG-d.
  - `test_jpg_katkestus_liigutamise_keskel` — pool vanadest prügikastis + samanimelised uued algses kohas → liikunud tagasi (sisu = vana), liikumata puutumata.
  - `test_taastamine_pikema_uue_lehestikuga` — 2 vana lehte, 3 uut → kolmas `.jpg/.txt/.json` kadunud.
  - `test_katkestus_parast_commiti_tuvastatakse` — treileriga commit tehtud, märk alles → `recover` tagastab `"replaced"`, märk ära, failid uued.
  - `test_recover_all_kaivitusel` — kaks märki → mõlemad töödeldud.
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** Implementeeri `replace_recovery.py` ja muudatused `upload_ops.py`-s; lifespan:
  `threading.Thread(target=replace_recovery.recover_all, daemon=True, name="replace-recovery").start()`.
- [ ] **Step 4:** pytest → PASS; kõik olemasolevad asenduse testid (`grep -l replace_work_content tests/`) → PASS.
- [ ] **Step 5: Commit** `feat(asendus): taasteinfo, commit'i treiler ja taastamine (ADR 0089 p 3)`

### Task 4: Lehe põlvkond — aegunud redaktor ei kirjuta uut lehte üle

**Files:**
- Modify: `server/upload_ops.py` (uute lehtede JSON-i kirjutus), `server/routers/editing.py`
  (`SERVERIPOOLSED_LEHE_VALJAD`, `/save`, `_save_page_locked`)
- Test: `tests/test_lehe_polvkond.py`

**Interfaces:**
- Consumes: Task 3 asenduse failitöö.
- Produces: lehe JSON-i väli `content_generation: str` (= `upload_id`); `SERVERIPOOLSED_LEHE_VALJAD = ("sequence", "source", "content_generation")`.
- `/save`: `require_existing_page` liigub `_save_page_locked`-i (leheluku sisse); seal võrreldakse
  `(client_meta or {}).get("content_generation")` ketta JSON-i omaga **enne** `merge_serveripoolsed_valjad`-i
  ja liitmist; erinev → 409
  `"Teose lehestik asendati vahepeal — laadi leht uuesti. / The work's pages were replaced in the meantime — please reload."`.
  Kui klient ei saatnud `meta_content`-i üldse, võrdlust ei tehta (vana käitumine).
- Asendus: lehelukud vanadel tüvedel (järjekorras) võetakse `marker_owner` all enne vanade failide
  eemaldamist ja vabastatakse alles pärast uute lehtede JSON-ide (koos `content_generation`-iga)
  kirjutamist; `remove_marker` liigub siia järele.

- [ ] **Step 1: Failing tests:**
  - `test_aegunud_klient_saab_409` — kettal `content_generation="u2"`, klient saadab `meta_content` ilma väljata (vana leht) → 409, tekst sisaldab „laadi leht uuesti".
  - `test_sama_polvkond_salvestub` — klient saadab `"u2"` → 200.
  - `test_asendamata_leht_salvestub_nagu_enne` — kummalgi pole välja → 200.
  - `test_olemasolu_kontroll_luku_sees` — leht kustub enne luku võtmist (monkeypatch) → 404, mitte kirjutus.
  - `test_asendus_kirjutab_polvkonna` — pärast asendust on igal uuel lehe JSON-il `content_generation == upload_id`.
  - `test_klient_ei_saa_polvkonda_kustutada` — salvestus ilma väljata samal põlvkonnal (`merge_serveripoolsed_valjad`) jätab välja kettale alles.
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** Implementeeri.
- [ ] **Step 4:** pytest → PASS; `tests/test_page_merge*.py`, `tests/test_save*.py` → PASS.
- [ ] **Step 5: Commit** `feat(asendus): lehe põlvkond, olemasolu kontroll luku sees (ADR 0089 p 4)`

### Task 5: Osad kogu lehestiku asendusel

**Files:**
- Modify: `server/work_parts.py` (`reset_parts_for_replace`, `_normalize`, `update_part`),
  `server/upload_ops.py` (kutse enne `refresh_work_mentions`-it),
  `src/pages/manage/parts/PartsList.tsx`, `src/types.ts` (osa tüüp), `src/locales/{et,en}/*.json`
- Test: `tests/test_osad_asendusel.py`, `src/pages/manage/parts/__tests__/PartsList.test.tsx`

**Interfaces:**
- Produces:
  - `work_parts.reset_parts_for_replace(work_dir: str, old_numbers: dict[str, int], username: str) -> bool` — `bulk_update_works` kaudu (`metadata_lock`), iga osa: `pages=[]`, `needs_review=True`, `pages_before_replace={"at": ISO, "page_numbers": sorted(old_numbers[s] for s in pages if s in old_numbers)}`; osadeta teos → `False`, midagi ei kirjutata
  - `_normalize` säilitab `pages_before_replace` ainult salvestatud kirjest ja ainult kui `pages` on tühi; kliendi saadetud väärtust ignoreeritakse
  - `update_part`: mittetühja `pages`-iga kirjutus kustutab `pages_before_replace`
  - asendus arvutab `old_numbers` (tüvi → lehenumber, `meili_doc.enumerate_page_images`) enne vanade failide liigutamist
  - TS: `WorkPart.pages_before_replace?: { at: string; page_numbers: number[] }`
  - UI: `PartsList` reas `needs_review` kõrval vihje `t('parts.pagesBeforeReplace', { pages })` (nt „Enne lehestiku asendust: lk 3–7"), lehenumbrid vahemikeks
- [ ] **Step 1: Failing tests:**
  - `test_osad_nullitakse_ja_vihje_jaab` — 2 osa (`pages` tüved lk 3–5, 7) → `pages == []`, `needs_review`, `pages_before_replace.page_numbers == [3,4,5]` / `[7]`.
  - `test_osadeta_teos_ei_muutu` — `_metadata.json` mtime/sisu muutumata, tagastab `False`.
  - `test_lehtede_maaramine_kustutab_vihje` — `update_part(..., {"pages": [...]})` → välja pole.
  - `test_klient_ei_saa_vihjet_kirjutada` — `create_part`/`update_part` kliendi `pages_before_replace` ignoreeritakse.
  - `test_asendus_kutsub_osade_nullimist` — asenduse järel osad nullitud ja `refresh_work_mentions` ei taasta vanu tüvesid.
  - Vitest: `PartsList` näitab vihjet „lk 3–5" `pages_before_replace` korral.
- [ ] **Step 2:** pytest + `npx vitest run src/pages/manage/parts` → FAIL.
- [ ] **Step 3:** Implementeeri; i18n võti mõlemasse keelde.
- [ ] **Step 4:** testid → PASS; `tests/test_work_parts*.py` → PASS.
- [ ] **Step 5: Commit** `feat(asendus): osade leheviited nullitakse kogu lehestiku asendusel (ADR 0089 p 5)`

### Task 6: Dokumentatsioon ja väravad

**Files:**
- Modify: `CLAUDE.md` (Invariandid: lühike lõik „Lehestiku asendus (ADR 0089)"), `docs/decisions/README.md` (0089 rida), disainifaili päis (PR 1 tehtud)
- ADR `docs/decisions/0089-lehestiku-asendus-ja-aluse-vahetus.md` on juba olemas — kontrolli, et teostus vastab p 1–5.

- [ ] **Step 1:** CLAUDE.md lõik: märk + lukud, taasteinfo enne failimuutust, treiler, JPG-reegel,
  `content_generation` luku sees, osade nullimine; „uus asendustee kasutab neid, ei kirjuta oma".
- [ ] **Step 2: Väravad järjest:** `npm run typecheck` → 0 viga; `npm run lint:ci` → ≤ 41;
  `npm test` → kõik läbivad; `.venv/bin/pytest tests/` → kõik läbivad.
- [ ] **Step 3: Commit** `docs: ADR 0089 lehestiku asendus, CLAUDE.md invariant`
