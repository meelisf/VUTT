# PDF-ist lehtede lisamine teose halduses — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teose halduses saab lisada PDF-i; server renderdab selle lehed taustatööna ja sisestab valitud lehe järele ühe commit'iga.

**Architecture:** `add_pages` jagatakse väliskihiks (pildi-HTTP piirid + teisendus) ja sisekihiks
`insert_prepared_pages` (kettal olevad JPEG-id, ankru lahendus luku all, üks commit).
`page_ops_jobs` üldistatakse liigiga (`kind`) tööregistriks; PDF-töö renderdab
`PdfPageSource.render_full`-iga `RENDER_SEMAPHORE` all ja kutsub sisekihti. Klient jälgib
tööd liigi järgi ja tõstab lisatud lehed esile/valituks; töötlus ja OCR käivad olemasolevate
vahenditega.

**Tech Stack:** FastAPI (sync def route'id), pdftoppm/pdfinfo (poppler), pytest; React 19 + TS, vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-pdf-lehtede-lisamine-design.md`

## Global Constraints

- Koodikommentaarid eesti keeles; UI tekstid et + en korraga (ADR 0011, `localeParity.test.ts`).
- PDF renderdatakse AINULT `server/upload/page_source.PdfPageSource.render_full` kaudu — oma `pdftoppm`-kutset ega DPI-konstanti ei tehta.
- Iga rasterdus käib `server.upload.prepress.RENDER_SEMAPHORE` all.
- Renderdus käib `work_lock`-i VÄLJAS; ankur lahendatakse `work_lock`-i SEES.
- Üks PDF = üks git-commit, üks `sync_work_to_meilisearch`, üks `refresh_work_mentions`.
- Pildi-HTTP tee piirid jäävad: `MAX_FILES_PER_REQUEST = 20`, `MAX_REQUEST_BYTES = 200 MB`, `MAX_SINGLE_FILE_BYTES = 50 MB`.
- PDF-tee piirid: `PDF_MAX_BYTES = 200 * 1024 * 1024`, `PDF_MAX_PAGES = 500`.
- Teose kohta korraga üks taustatöö sõltumata liigist; 409 teise liigi töö korral EI tühjenda ootel plaani.
- Ajutine kaust on teose kaustas (`.tmp-pdf-<hex>`), sest `/data` ja `/app/state` on eri mountid ja `os.replace` peab olema sama FS-i sees.
- Backend testid: `.venv/bin/pytest`; väravad `npm run typecheck`, `npm test`, `npm run lint:ci`.

## Review Focus

1. **Vigane / krüpteeritud / mitte-PDF fail `.pdf` laiendiga** → 400 enne töö algust, ajutine kaust koristatud. (Task 3 test `test_add_pdf_vigane_pdf_400`.)
2. **Renderdus kukub keset tööd** (pdftoppm viga lehel k) → töö `error`, teosesse ei sisestata midagi, ajutine kaust kadunud. (Task 3 test `test_renderdusviga_ei_sisesta_midagi`.)
3. **Server taaskäivitub keset renderdust** → järele jääb `.tmp-pdf-*`; järgmine sama teose PDF-töö koristab üle 24 h vanad. (Task 3 test `test_vanad_tmp_kaustad_koristatakse`.)
4. **Kasutaja vahetab lehte/sakki keset tööd ja tuleb tagasi** → lehe avamisel jätkub õige liigi jälgija; lehetoimingute jälgija ei puutu PDF-töö lõppu. (Task 4 test `jobConflictAction` + `resumeFollower`.)
5. **PDF valitakse koos piltidega või mitu PDF-i** → vorm keelab, teade; serverisse ei saadeta. (Task 5 test `classifyAddFiles`.)

---

### Task 0: Haru

- [ ] `git switch main && git pull && git switch -c feat/pdf-lehtede-lisamine` (jooksev haru `chore/666-…` on teise töö oma; spec ja plaan on jälgimata failid ja liiguvad kaasa).
- [ ] `git add docs/superpowers/specs/2026-10-28-pdf-lehtede-lisamine-design.md docs/superpowers/plans/2026-10-28-pdf-lehtede-lisamine.md && git commit -m "docs: PDF-ist lehtede lisamise disain ja plaan"`

### Task 1: Sisestuskiht kettal olevatele JPEG-idele + ankur

**Files:**
- Modify: `server/admin_page_ops.py` (`write_new_page` ~912, `add_pages` ~1004)
- Test: `tests/test_add_pages.py` (olemasolevad peavad jääma roheliseks), uus `tests/test_insert_prepared_pages.py` (fixture kopeeri `test_add_pages.py`-st)

**Interfaces:**
- Produces:
  - `class AnchorMissing(ValueError)` — `admin_page_ops.py`-s; sõnum eesti keeles, atribuut `code = "anchor_missing"`.
  - `insert_prepared_pages(work_id: str, jpeg_paths: list[str], after: int | str, username: str) -> dict` — tagastab sama kuju mis praegu `add_pages` (`found`, `new_page_count`, `inserted: [{filename, sequence}]`, `meili_warning`). `after`: `int` = vana `after_page_num` semantika (-1 lõpp, 0 algus, 1..M), kontrollitakse luku all; `str` = `"start"` | `"end"` | olemasoleva **pildifaili nimi** (nt `…-pg003.jpg`), mille järele sisestada; puuduv nimi → `AnchorMissing`. `jpeg_paths` järjekord = sisestusjärjekord (EI sorteerita). Failid **liigutatakse** (`os.replace`), mitte ei kopeerita; peavad olema teose kaustaga samal FS-il.
  - `write_new_page(..., content, ext, seq, src_path: str | None = None)` — kui `src_path` antud, `os.replace(src_path, img_path)` baitide kirjutamise asemel (`content` ignoreeritakse).
  - `add_pages(...)` signatuur ja käitumine EI muutu: piirid + `detect_and_convert_image` + nimejärgi sort, kirjutab JPEG-id `.tmp-bulk-<hex>` kausta ja kutsub `insert_prepared_pages(work_id, paths, after_page_num, username)`.

- [ ] **Step 1: Kirjuta failivad testid** `tests/test_insert_prepared_pages.py`:
  - `test_ankur_failinimi_sisestab_selle_jarele` — teos 2 lehega (seq 100, 200), 2 JPEG-faili `tmp`-is teose kaustas, `after="1690-test-w1-w1-pg001.jpg"` → `get_sorted_images` järjekord: pg001, uus1, uus2, pg002; lähtefailid kadunud (liigutati).
  - `test_ankur_start_ja_end` — `"start"` → uued ees; `"end"` → uued lõpus.
  - `test_kadunud_ankur_viskab_ja_ei_kirjuta` — `after="puudub.jpg"` → `pytest.raises(AnchorMissing)`; `os.listdir(folder)` sama mis enne (v.a sisendfailid, mis jäävad alles kutsuja koristada).
  - `test_jarjekord_on_sisendi_jarjekord` — sisend `[z.jpg, a.jpg]` → `inserted[0].sequence < inserted[1].sequence` ja `inserted[0]` pilt on `z` sisuga (värv).
  - `test_uks_commit` — `save_with_git` mock loeb kutseid → täpselt 1.
- [ ] **Step 2:** `.venv/bin/pytest tests/test_insert_prepared_pages.py -v` → FAIL (`ImportError: insert_prepared_pages`).
- [ ] **Step 3:** Teosta `AnchorMissing`, `write_new_page(src_path=…)`, `insert_prepared_pages` (tõsta `add_pages`-i luku-osa sinna: vahemikukontroll / ankru lahendus `images.index(after) + 1` → `after_page_num`, `allocate_sequences`, staging, `_cleanup_bulk`, commit, Meili, `refresh_work_mentions`). `add_pages` = väliskiht.
- [ ] **Step 4:** `.venv/bin/pytest tests/test_insert_prepared_pages.py tests/test_add_pages.py tests/test_bulk_atomicity.py -v` → kõik PASS.
- [ ] **Step 5:** Commit: `refactor(manage): add_pages sisekiht kettal olevatele JPEG-idele + failinime-ankur (#PDF)`.

### Task 2: Tööregister liigiga

**Files:**
- Modify: `server/page_ops_jobs.py`, `server/routers/pages.py:351-376`
- Test: uus `tests/test_page_ops_jobs_kind.py`; `tests/test_page_ops_batch.py` jääb roheliseks

**Interfaces:**
- Produces (`server/page_ops_jobs.py`):
  - `start_job(work_id: str, kind: str, total: int, username: str, fn: Callable[[Callable[[int, int], None]], dict], on_error: Callable[[Exception], dict] | None = None) -> bool` — `False`, kui selle teose MISTAHES liigi töö käib. `fn(progress)` tagastab `result`; erindi korral `state="error"`, `error=str(e)`, lisaväljad `on_error(e)`-st. Olekus alati `kind`.
  - `start(work_id, ops, username, total) -> bool` — jääb, kutsub `start_job(..., kind="page_ops", ...)`; praegune `PageOpsPartialError`/`ValueError` lisaväljade loogika läheb tema `on_error`-isse.
  - `get_status(work_id) -> dict` — lisaks `kind` (idle korral puudub).
  - Status-endpoint `GET /admin/work/{id}/page-ops/status` jääb ÜHEKS registri olekuks (kannab `kind`-i); teist status-endpointi ei tehta.

- [ ] **Step 1: Failivad testid:**
  - `test_status_kannab_liiki` — `start_job("w","add_pdf",3,"u",lambda p: {"x":1})` → oota lõime → `get_status("w") == {"state":"done","kind":"add_pdf",…}`.
  - `test_teise_liigi_too_annab_false` — blokeeriv `fn` (threading.Event) liigiga `page_ops` käib → `start_job("w","add_pdf",…)` → `False`; ja vastupidi.
  - `test_on_error_lisavaljad` — `fn` viskab, `on_error` tagastab `{"code":"anchor_missing"}` → olek `error`, `code == "anchor_missing"`, `kind` alles.
  - Lisa `_reset_for_tests()` kasutus fixture'is.
- [ ] **Step 2:** `.venv/bin/pytest tests/test_page_ops_jobs_kind.py -v` → FAIL.
- [ ] **Step 3:** Teosta `start_job`, kirjuta `start` selle peale ümber.
- [ ] **Step 4:** `.venv/bin/pytest tests/test_page_ops_jobs_kind.py tests/test_page_ops_batch.py -v` → PASS.
- [ ] **Step 5:** Commit: `refactor(manage): lehetoimingute tööregister kannab töö liiki`.

### Task 3: PDF-töö ja endpoint + ADR

**Files:**
- Create: `server/add_pdf_pages.py`
- Modify: `server/routers/pages.py` (uus route `add-pages` kõrvale)
- Create: `docs/decisions/0074-pdf-lehtede-lisamine-teose-haldusse.md`; Modify: `docs/decisions/README.md` (register)
- Test: uus `tests/test_add_pdf_pages.py`

**Interfaces:**
- Consumes: `insert_prepared_pages`, `AnchorMissing` (Task 1); `start_job` (Task 2); `PdfPageSource`; `RENDER_SEMAPHORE`; `detect_file_type`.
- Produces (`server/add_pdf_pages.py`):
  - `PDF_MAX_BYTES = 200 * 1024 * 1024`, `PDF_MAX_PAGES = 500`, `TMP_PREFIX = ".tmp-pdf-"`, `STALE_TMP_S = 24 * 3600`.
  - `prepare_pdf(work_dir: str, upload_file) -> tuple[str, int]` — loob `{work_dir}/.tmp-pdf-<hex>/`, voogkopeerib sisendi `source.pdf`-iks (loeb tükkidena, ületus → `ValueError` ja kaust koristatud), `detect_file_type != "pdf"` → `ValueError`, `PdfPageSource(...).page_count()` viga → `ValueError("Vigane PDF …")`, `> PDF_MAX_PAGES` → `ValueError`; tagastab `(tmp_dir, page_count)`. Koristab enne teose kaustast `.tmp-pdf-*` kaustad, mille mtime on vanem kui `STALE_TMP_S`.
  - `run_add_pdf(work_id: str, tmp_dir: str, page_count: int, after: str, username: str, progress) -> dict` — lehed `1..page_count`: `with RENDER_SEMAPHORE: src.render_full(n, f"{tmp_dir}/{n:04d}.jpg")`, `progress(n, page_count)`; siis `insert_prepared_pages(work_id, paths, after, username)`; `finally: shutil.rmtree(tmp_dir, ignore_errors=True)`.
  - Route `POST /admin/work/{work_id}/add-pdf` (sync `def`, `require_role("admin")`): multipart `file` + `after: str` (`"start"`|`"end"`|failinimi). 404 teost pole; `prepare_pdf` `ValueError` → 400; ankur ei ole praegu olemas → 409 `anchor_missing` (kiire tagasiside; lõplik kontroll on luku all); `start_job(work_id, "add_pdf", page_count, user, fn, on_error=lambda e: {"code": "anchor_missing"} if isinstance(e, AnchorMissing) else {})` → `False` → koristab `tmp_dir`, 409; muidu `{"status": "started", "total": page_count}`.

- [ ] **Step 1: Failivad testid** (`work` fixture nagu `test_add_pages.py`; väike PDF PIL-iga: `Image.new(...).save(p, "PDF", save_all=True, append_images=[...])`, 3 lehte eri värvi; pdftoppm on lokaalselt ja CI-s olemas):
  - `test_run_add_pdf_sisestab_koik_lehed_jarjekorras` — `after="end"` → 3 uut lehte lõpus, 1. uue lehe pildi keskmine värv ≈ PDF-i 1. lehe värv; `tmp_dir` kadunud; `save_with_git` 1 kord.
  - `test_render_kaib_semafori_all` — monkeypatch `RENDER_SEMAPHORE` loendavaks objektiks (`__enter__`/`__exit__`) → 3 sisenemist.
  - `test_renderdusviga_ei_sisesta_midagi` — `PdfPageSource.render_full` viskab 2. lehel → `RuntimeError`, teose lehtede arv muutumata, `tmp_dir` kadunud.
  - `test_kadunud_ankur_tmp_koristatud` — `after="puudub.jpg"` → `AnchorMissing`, `tmp_dir` kadunud.
  - `test_add_pdf_vigane_pdf_400` (endpoint, `backend_env`/`login` fixture'id nagu `test_page_ops_batch.py`) — sisu `b"%PDF-1.4 rämps"` → 400; teose kaustas pole `.tmp-pdf-*`.
  - `test_add_pdf_mitte_pdf_400` — JPEG baidid → 400.
  - `test_add_pdf_liiga_palju_lehti_400` — monkeypatch `PDF_MAX_PAGES = 2` → 400.
  - `test_add_pdf_busy_409_koristab` — `start_job` → `False` → 409, `.tmp-pdf-*` puudub.
  - `test_add_pdf_nouab_admini` — editor → 403.
  - `test_vanad_tmp_kaustad_koristatakse` — `.tmp-pdf-old` (mtime −2 päeva) ja `.tmp-pdf-new` → `prepare_pdf` järel `old` kadunud, `new` alles.
- [ ] **Step 2:** `.venv/bin/pytest tests/test_add_pdf_pages.py -v` → FAIL.
- [ ] **Step 3:** Teosta `server/add_pdf_pages.py` ja route.
- [ ] **Step 4:** `.venv/bin/pytest tests/test_add_pdf_pages.py tests/test_add_pages.py tests/test_page_ops_batch.py -v` → PASS.
- [ ] **Step 5:** ADR 0074 (staatus „vastu võetud"): PDF-i lisamine teose haldusse — üks renderdaja (`PdfPageSource`), üks sisestuskiht kettal olevatele JPEG-idele, failinime-ankur luku all, üks liigiga tööregister (teose kohta üks töö), OCR käsitsi. Viita ADR 0028/0049/0050/0061/0073. Lisa register-reale.
- [ ] **Step 6:** Commit: `feat(manage): PDF-ist lehtede lisamine taustatööna (ADR 0074)`.

### Task 4: Klient — liigipõhine töö jälgimine

**Files:**
- Create: `src/pages/manage/jobKind.ts`
- Modify: `src/services/workApi.ts` (`PageOpsStatus`, uus `addWorkPdf`), `src/pages/WorkManage.tsx` (`followPageOps` ~580, `savePageOps` ~631, resume-effect ~650)
- Test: `src/pages/manage/__tests__/jobKind.test.ts`

**Interfaces:**
- Produces:
  - `workApi.ts`: `type WorkJobKind = 'page_ops' | 'add_pdf'`; `PageOpsStatus` saab `kind?: WorkJobKind`, `code?: string`, `result?` laieneb `inserted?: { filename: string; sequence: number }[]`.
  - `addWorkPdf(workId: string, token: string, file: File, after: string): Promise<{ status: string; total: number }>` → `POST /admin/work/{id}/add-pdf`, FormData `file` + `after`, timeout 600000.
  - `jobKind.ts`: `jobConflictAction(status: PageOpsStatus, mine: WorkJobKind): 'follow' | 'other' | 'retry'` — `running` + sama liik → `follow`; `running` + teine liik → `other`; muu (töö lõppes vahepeal) → `retry`. `resumeFollower(status: PageOpsStatus): WorkJobKind | null` — `running` korral `status.kind ?? 'page_ops'` (vana server ilma liigita), muidu `null`.
  - `WorkManage.tsx`: `followPageOps` üldistub `followJob(kind: WorkJobKind, total: number)`; pollimise tsükkel ühine, lõpukäsitlus liigi järgi: `page_ops` = praegune (plaan/valik/`dropApplied`); `add_pdf` = `loadPages()`, `setSelectedFiles(new Set(inserted))`, `setHighlightedFiles(new Set(inserted))`, vorm kinni; vea korral `addPageError` (`code === 'anchor_missing'` → `manage.addPdf.anchorMissing`), plaani EI puudutata.
  - `savePageOps` 409: `getWorkPageOpsStatus` → `jobConflictAction(st, 'page_ops')`: `follow` → `followJob('page_ops', …)`; `other` → `setPageOpsError(t('manage.jobs.otherRunning'))`; `retry` → üks uus `startWorkPageOps`.

- [ ] **Step 1: Failivad testid** `jobKind.test.ts`: kõik kolm `jobConflictAction` haru mõlemale liigile; `resumeFollower` `running` ilma `kind`-ita → `'page_ops'`, `running`+`add_pdf` → `'add_pdf'`, `done` → `null`.
- [ ] **Step 2:** `npx vitest run src/pages/manage/__tests__/jobKind.test.ts` → FAIL.
- [ ] **Step 3:** Teosta `jobKind.ts`, `workApi.ts` muudatused, `WorkManage.tsx` `followJob` + 409 + resume (`resumeFollower`).
- [ ] **Step 4:** `npx vitest run src/pages/manage/__tests__/jobKind.test.ts && npm run typecheck` → PASS.
- [ ] **Step 5:** Commit: `feat(manage): töö jälgimine töö liigi järgi`.

### Task 5: Klient — PDF vormis, esiletõst, tõlked

**Files:**
- Modify: `src/pages/WorkManage.tsx` (lisamisvorm ~1199–1300, `handleAddPage` ~719), `src/pages/manage/PageCard.tsx`, `src/locales/et/workspace.json`, `src/locales/en/workspace.json`
- Create: `src/pages/manage/addFiles.ts`
- Test: `src/pages/manage/__tests__/addFiles.test.ts`, `src/pages/manage/__tests__/PageCard.pending.test.tsx` (laienda)

**Interfaces:**
- Consumes: `addWorkPdf`, `followJob('add_pdf', total)`, `jobConflictAction` (Task 4).
- Produces:
  - `addFiles.ts`: `classifyAddFiles(files: File[]): { kind: 'images' } | { kind: 'pdf'; file: File } | { kind: 'invalid'; reason: 'mixed' | 'multiplePdf' }` (PDF tuvastus `type === 'application/pdf'` või laiend `.pdf`, tõstutundetu). `afterToAnchor(addAfterPage: number, pages: { page_num: number; filename: string }[]): string` — `0` → `"start"`, `-1` → `"end"`, muidu selle `page_num`-i **pildifaili nimi** (sama, mida server `get_sorted_images`-is näeb — kontrolli `pages[]` välja, mis seda kannab, nt `lehekylje_pilt` viimane segment).
  - `PageCard`: uus prop `isHighlighted?: boolean` → nähtav esiletõst (nt `ring-2 ring-amber-400`), mis ei kattu `isSelected`/`isChanged` stiiliga.
  - `WorkManage`: `highlightedFiles: Set<string>` olek (vaate olek, ei salvestata; tühjeneb lehelt lahkudes). Faili-input `accept="image/jpeg,image/png,application/pdf"`. `handleAddPage`: `classifyAddFiles` → `images` = senine tee; `pdf` = `addWorkPdf(workId, token, file, afterToAnchor(...))` → `followJob('add_pdf', total)`; 409 → `jobConflictAction(..., 'add_pdf')` (`other` → `manage.jobs.otherRunning`, `anchor_missing` detail → `manage.addPdf.anchorMissing`); `invalid` → vormi viga, päringut ei tehta.
  - i18n võtmed (mõlemas keeles): `manage.addPageFile` uuendus (mainib PDF-i), `manage.addPdf.progress` („Renderdan PDF-i: {{done}} / {{total}} lehte"), `manage.addPdf.done` („Lisatud {{count}} lehte PDF-ist — valitud ja esile tõstetud"), `manage.addPdf.anchorMissing`, `manage.addPdf.mixed`, `manage.addPdf.multiplePdf`, `manage.jobs.otherRunning`.

- [ ] **Step 1: Failivad testid:** `addFiles.test.ts` — üks PDF → `pdf`; kaks pilti → `images`; PDF + pilt → `invalid/mixed`; kaks PDF-i → `invalid/multiplePdf`; `FOO.PDF` tühja MIME-ga → `pdf`; `afterToAnchor(0)` → `"start"`, `(-1)` → `"end"`, `(2)` → teise lehe failinimi. `PageCard.pending.test.tsx` — `isHighlighted` lisab esiletõstu klassi.
- [ ] **Step 2:** `npx vitest run src/pages/manage/__tests__/addFiles.test.ts src/pages/manage/__tests__/PageCard.pending.test.tsx` → FAIL.
- [ ] **Step 3:** Teosta.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run lint:ci && .venv/bin/pytest tests/` → PASS (lint-hoiatuste arv ei kasva üle 42).
- [ ] **Step 5:** Käsitsi kontroll (tunnel + `npm run dev`, CLAUDE.md): väikese PDF-iga **testteosel** — keskele ja lõppu, edenemisriba, esiletõst, valik → „Rakenda" pööre → OCR tekstita lehtedele. NB: andmed on päris; kasuta testteost.
- [ ] **Step 6:** Commit: `feat(manage): PDF-i lisamine vormis, lisatud lehtede esiletõst`.
