# Eksemplari pildid — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Igal teose eksemplaril on oma pildid (üleslaadimine + ADA import), mida sirvitakse ja kõrvutatakse tekstitunnistajaga eksemplari alamlehel. Töövaade ei muutu.

**Architecture:** Pildid elavad `data/{kaust}/_exemplars/{eid}/`. Manifest `images.json` on gitis, pildifailid ei ole. Manifest muutub ainult moodulis `server/exemplar_images.py` luku `work_lock` → `metadata_lock` all, `revision` on optimistlik lukk. ADA import on failipõhine taastatav taustatöö (`server/exemplar_import.py`). Pildiserver saab kaks uut teed. Klient saab alamlehe `/work/:workId/exemplar/:exemplarId`.

**Tech Stack:** FastAPI (sync `def` routes, ADR 0002), Pillow, poppler (`pdfinfo`, `pdfunite`, `pdftoppm` `PdfPageSource` kaudu), React 19 + TS + Tailwind, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-11-09-eksemplari-pildid-design.md`. Loe enne iga ülesannet; plaan viitab spetsi jaotistele.

## Global Constraints

- Koodikommentaarid eesti keeles. i18n-võti lisatakse **mõlemasse keelde korraga** (`src/locales/{et,en}/*.json`, ADR 0011).
- Python: `.venv/bin/pytest`. Blokeeriv I/O ei tohi olla `async def` sees, kasuta sync `def` route'i.
- Lukustusjärjekord on alati `admin_page_ops.work_lock(basename, work_dir)` → `metadata_lock` (`bulk_update_works` võtab selle). `work_lock` on mitte-reentrantne `threading.Lock`.
- ID-d: `generate_nanoid()` (6 märki, `[a-z0-9]`), valideerimise regex `^[a-z0-9]{6}$`.
- Väärtuseta võtit ei salvestata (ADR 0076 p 2). Muutusteta kirjutus on no-op (ADR 0012).
- Kirjutusõigus `can_write_work`, lugemine `can_read_work` (ADR 0031). Kirjutavad otspunktid `require_role("admin")` nagu `routers/work_exemplars.py`.
- Piirid: fail ≤ 100 MB, pikim külg ≤ 12 000 px, vaatamiskuju pikim külg ≤ 4000 px, JPEG kvaliteet 92. ADA renderdus `FULL_DPI = 300`, `JPEG_QUALITY = 95` (`upload/page_source.py`) `RENDER_SEMAPHORE` all (`upload/prepress.py`).
- Pilditoimingud ei puuduta `_metadata.json`-i ega Meilisearchi (v.a eksemplari `url`, mis käib `work_exemplars` kaudu).
- Natiivseid `alert`/`confirm`-e ei kasutata: `useConfirm`, `useNotify`, `useUnsavedChangesGuard`.
- Väravad enne PR-i: `npm run typecheck`, `npm test`, `npm run lint:ci` (lävi 41, ei tõuse), `.venv/bin/pytest tests/`.

## Review Focus

1. **Päris ADA kirje mitme PDF-iga ja konvoluudiga** (nt `10062/14332`): vahemik `from`–`to` liidetud PDF-is peab andma õiged `bitstream` + `bitstream_page` väärtused. Kõik lehed ühes bitstreamis on liiga lihtne test. → Task 7 `test_leheplaan_mitu_bitstreami_vahemik`.
2. **Mitte-ASCII kaustanimi** (täpitähed, ADR viide #423): pildiserveri uus tee peab leidma teose nagu lehepildi tee. → Task 5 `test_eksemplaripilt_taptahtedega_kaustas`.
3. **Suur TIFF / pildipomm** (16-bit halltoon 9000×12000 OK, 13 000 px keeldutakse enne täisdekodeerimist). → Task 3 `test_liiga_suur_moode_keeldutakse_enne_dekodeerimist`.
4. **Kaks kasutajat:** üks muudab järjekorda, teine kustutab pildi → teine salvestus saab 409, mitte vaikset kadu. → Task 4 `test_patch_vananenud_revisjon_409`.
5. **Mitteavaliku teose eksemplaripilt ilma tokenita** → 403 nii pildil, pisipildil kui `/original`-il. → Task 5 `test_mitteavalik_ilma_tokenita_403` + Task 4 `test_original_lugemisoiguseta_403`.

---

### Task 1: ADR 0079 + gitignore

**Files:**
- Create: `docs/decisions/0079-eksemplari-pildid.md`
- Modify: `docs/decisions/0076-eksemplari-kiht.md` (Tagajärjed: viide 0079-le), `docs/decisions/README.md` (registririda)
- Modify: `server/git_ops.py` `_init_repo_locked` (`.gitignore` sisu)
- Test: `tests/test_exemplar_images_gitignore.py`

**Interfaces:**
- Produces: `git_ops.DATA_GITIGNORE_EXTRA: tuple[str, ...] = ("_imports/", "_thumbs/", "*.pdf", "*.tif", "*.tiff", "*.orig.*", "*.part", "*.tmp*")`

- [ ] **Step 1:** ADR (eesti keeles, ADR 0076 vormis): kontekst = spetsi „Miks"; otsus = spetsi jaotised Andmemudel (asukoht, manifest, serveri väljad, lähtefail/tuletis, ADA ilma PDF-ita), nähtavus = teos, töövaatest eraldi, lukustusjärjekord + revisjon, impordi protokoll lühidalt (viide spetsile). Tagajärjed: `admin_work_delete`/`restore_deleted_work` kannavad `_exemplars/`-i; serveri `data/.gitignore` uuendatakse käsitsi.
- [ ] **Step 2: Failing test** `test_uus_repo_ignoreerib_eksemplari_tooriistafaile`: `_init_repo_locked` tmp-`BASE_DIR`-is → `.gitignore` sisaldab iga `DATA_GITIGNORE_EXTRA` rida; `git check-ignore` tagastab 0 failidele `w/_exemplars/a1b2c3/_imports/q1/job.json`, `w/_exemplars/a1b2c3/x.orig.tif`, `w/_exemplars/a1b2c3/_thumbs/_thumb_x.jpg` ja 1 failile `w/_exemplars/a1b2c3/images.json`.
- [ ] **Step 3:** `.venv/bin/pytest tests/test_exemplar_images_gitignore.py -v` → FAIL.
- [ ] **Step 4:** lisa `DATA_GITIGNORE_EXTRA` ja kirjuta read `_init_repo_locked`-is `.gitignore`-i.
- [ ] **Step 5:** test → PASS. Commit `docs+feat: ADR 0079 eksemplari pildid, data .gitignore laiendus`.

### Task 2: `work_exemplars` lukustatud kirjutus ja kohustuslik commit

**Files:**
- Modify: `server/work_exemplars.py` (`_bulk`, `update_exemplar`)
- Test: `tests/test_work_exemplars_locked.py`

**Interfaces:**
- Produces: `_bulk(work_dir, username, message, mutate, background_tasks=None, *, require_commit: bool = False)`. Kui `require_commit` ja `res["git_committed"] is False` → `ExemplarError("Git commit ebaõnnestus", 500)`.
- Produces: `update_exemplar(work_dir, ex_id, data, username, background_tasks=None, *, locked: bool = False, require_commit: bool = False) -> dict`. `locked=True` → `_bulk` otse (kutsuja hoiab `work_lock`-i).

- [ ] **Step 1: Failing tests:**
  - `test_update_locked_ei_jaa_ummikusse`: kutsu `update_exemplar(..., {"url": "https://hdl.handle.net/10062/1"}, locked=True)` `work_lock`-i seest, lõimes `join(timeout=5)` → lõim lõpetas, url salvestatud.
  - `test_require_commit_viskab_kui_commit_ebaonnestub`: monkeypatch `metadata_ops.save_with_git` → `{"success": False, "error": "x"}` → `ExemplarError`, `status == 500`.
  - `test_kordus_commitib_rippuva_kirjutuse`: kirjuta `_metadata.json` kettale uue url-iga ilma commit'ita, kutsu `update_exemplar(..., sama url, locked=True, require_commit=True)` → `git_ops.uncommitted_paths([meta])` on tühi (`bulk_update_works` #418 tee).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implementeeri.
- [ ] **Step 4:** run + `tests/test_work_exemplars*.py` → PASS. Commit.

### Task 3: Pildifailide töötlus

**Files:**
- Create: `server/exemplar_image_files.py`
- Test: `tests/test_exemplar_image_files.py`

**Interfaces:**
- Produces: `MAX_UPLOAD_BYTES = 100 * 1024 * 1024`, `MAX_SIDE = 12000`, `VIEW_MAX_SIDE = 4000`, `VIEW_QUALITY = 92`
- Produces: `class ImageFileError(ValueError)` (`status: int`, vaikimisi 400; liiga suur → 413)
- Produces: `detect_kind(content: bytes) -> str` → `"jpeg" | "png" | "tiff"` (magic bytes: `\xff\xd8\xff`, `\x89PNG\r\n\x1a\n`, `II*\x00`, `MM\x00*`), muidu `ImageFileError`
- Produces: `store_image(content: bytes, dest_dir: str, image_id: str) -> str | None`. Kirjutab `{id}.jpg` ja vajadusel `{id}.orig.{jpg|png|tif}` (`.tmp` + `os.replace`). Tagastab `original` failinime või `None`, kui `{id}.jpg` on ise lähtefail.

- [ ] **Step 1: Failing tests:**
  - `test_poorata_vaike_jpeg_on_baitkoopia`: 800×600 JPEG ilma EXIF-ita → `None`, `{id}.jpg` baidid == sisend.
  - `test_eksif_poordega_jpeg_saab_originaali`: orientation 6 → `"x.orig.jpg"` == sisend; `{id}.jpg` mõõt on pööratud (600×800).
  - `test_suur_jpeg_saab_originaali_ja_vahendatud_vaate`: 5000×3000 → original olemas, vaate pikim külg == 4000.
  - `test_16bit_tiff_teisendatakse`: `I;16` 300×200 TIFF → `.orig.tif` olemas, `{id}.jpg` avaneb režiimis `L`.
  - `test_cmyk_tiff_rgb_ks`: CMYK → vaade `RGB`.
  - `test_tundmatu_formaat_keeldutakse`: `b"%PDF-1.4"` → `ImageFileError`.
  - `test_liiga_suur_fail_413`: `len > MAX_UPLOAD_BYTES` → `status == 413` (kontrolli suurust enne dekodeerimist).
  - `test_liiga_suur_moode_keeldutakse_enne_dekodeerimist`: 13 000×10 PNG → `ImageFileError`; monkeypatch `Image.Image.load` loendur == 0 (mõõt `Image.open(...).size` pealt).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implementeeri. `ImageOps.exif_transpose` vaatekujul; režiimid `I;16`/`I` → `L` (`point(lambda v: v / 256)`), `CMYK`/`P`/`RGBA` → `RGB`, `LA` → `L`. `Image.MAX_IMAGE_PIXELS = MAX_SIDE * MAX_SIDE` mooduli kohalikult `Image.open`-i ümber.
- [ ] **Step 4:** run → PASS. Commit.

### Task 4: Manifestimoodul ja otspunktid

**Files:**
- Create: `server/exemplar_images.py`, `server/routers/exemplar_images.py`
- Modify: `server/main.py` (`include_router`)
- Test: `tests/test_exemplar_images.py`, `tests/test_exemplar_images_api.py`

**Interfaces:**
- Consumes: Task 3 `store_image`, `detect_kind`, `ImageFileError`.
- Produces (`server/exemplar_images.py`):
  - `class ExemplarImagesError(ValueError)` (`status`; 409 kannab `current: dict`)
  - `exemplar_dir(work_dir: str, eid: str) -> str`, `manifest_path(work_dir, eid) -> str`
  - `read_manifest(work_dir, eid) -> dict`: puuduv fail → `{"revision": 0, "images": [], "imports": {}}`
  - `write_manifest_locked(work_dir, eid, manifest: dict, username: str, message: str) -> bool`: `atomic_write_json` + `git_ops.save_with_git`, tagastab `git_committed`. Kutsuja hoiab lukke.
  - `with exemplar_locks(work_dir)`: `work_lock` → `metadata_lock` (`metadata_ops` lukk), üks koht mõlemale.
  - `require_exemplar(work_dir, eid) -> dict`: luku all `_metadata.json`-ist, puudub → 404
  - `add_uploads(work_dir, eid, files: list[tuple[bytes, dict]], username) -> dict`. `source` kliendist: `kind ∈ {"url","photo","other"}`, `ref`, `license`, `page`. Server lisab `added_by`, `at`. Tagastab manifesti.
  - `patch_images(work_dir, eid, revision: int, images: list[dict], username) -> dict`
  - `delete_image(work_dir, eid, image_id: str, revision: int, username) -> dict`: failid → `._trash/{work_id}/_exemplars/{eid}/`
  - `original_path(work_dir, eid, image_id) -> tuple[str | None, str | None]` → (failitee, ADA puhul suunamise URL)
  - `SERVER_FIELDS = ("import_id", "added_by", "at")`, `IMPORT_IMMUTABLE_SOURCE = True` (impordipildil on muudetav ainult `license`)
- Produces (router, prefix nagu `work_exemplars`): `GET/POST/PATCH /works/{work_id}/exemplars/{eid}/images`, `DELETE …/images/{image_id}?revision=N`, `GET …/images/{image_id}/original`. `POST` on multipart: `files[]` + `source` (JSON string).

- [ ] **Step 1: Failing tests** (`tests/test_exemplar_images.py`, `prosopo_env`-laadne tmp-teos koos `_metadata.json`-iga, kus on eksemplar `a1b2c3`):
  - `test_lisamine_tostab_revisjoni_ja_commitib`: revisjon 0 → 1, `uncommitted_paths([manifest])` tühi
  - `test_patch_vananenud_revisjon_409`: kaks `read_manifest`-i, esimene `patch` õnnestub, teine sama vana revisjoniga → 409, `current.revision == 2`
  - `test_patch_peab_sisaldama_samu_idsid`: puuduv või lisatud ID → 409
  - `test_patch_ei_muuda_serverivalju`: klient saadab `import_id: "voltsi"`, `added_by: "x"` → salvestatud väärtused jäävad
  - `test_impordipildi_allikas_muutumatu_peale_litsentsi`: `source.ref` muutus ignoreeritakse, `license` muutub
  - `test_kustutus_viib_failid_prugikasti_ja_imports_jaab`
  - `test_puuduv_eksemplar_404`
  - `test_muutusteta_patch_ei_commiti` (ADR 0012)
- [ ] **Step 2: Failing API tests** (`tests/test_exemplar_images_api.py`, TestClient nagu `tests/test_work_exemplars_api*.py`):
  - `test_lugemisoiguseta_403` (mitteavalik teos, anonüümne GET)
  - `test_original_lugemisoiguseta_403`
  - `test_original_ada_suunab_handlele`: 302, `Location == "https://hdl.handle.net/10062/14332"`
  - `test_kirjutus_ilma_kirjutusoiguseta_403`
  - `test_upload_multipart_lisab_pildid`
- [ ] **Step 3:** run → FAIL.
- [ ] **Step 4:** implementeeri. Uuenda `server/__init__.py` re-eksporti ainult siis, kui seal on sama muster.
- [ ] **Step 5:** run → PASS. Commit.

### Task 5: Pildiserver

**Files:**
- Modify: `server/image_server.py` (`_handle_image_request`)
- Test: `tests/test_image_server_exemplars.py` (laienda olemasoleva pildiserveri testi mustrit)

**Interfaces:**
- Consumes: kaustakuju Task 4-st.
- Produces: `GET /{kaust|work_id}/_exemplars/{eid}/{image_id}.jpg` ja `GET /{kaust|work_id}/_exemplars/{eid}/_thumbs/_thumb_{image_id}.jpg`. `eid`, `image_id` vastavad regexile `^[a-z0-9]{6}$`. Pisipilt: `get_or_create_page_thumbnail(exemplar_dir, "_thumb_{image_id}.jpg")`.

- [ ] **Step 1: Failing tests:**
  - `test_eksemplaripilt_serveeritakse`, `test_eksemplari_pisipilt_luuakse`
  - `test_mitteavalik_ilma_tokenita_403` (pilt ja pisipilt), `test_mitteavalik_tokeniga_200`
  - `test_originaali_ja_importi_ei_serveerita`: `…/x.orig.tif`, `…/_imports/q1/job.json`, `…/images.json` → 403
  - `test_vigane_id_403`: `../`, `ABC123`, 7 märki
  - `test_eksemplaripilt_taptahtedega_kaustas`: kaust `1640-liefflä-ab12cd` → 200
  - `test_kaanepilt_ei_naita_eksemplaripilti`: teosel ainult eksemplaripildid → `_thumb` 404
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** lisa kaks haru enne üldist `len(parts) > 3` keeldu. Ülejäänud teed ei muutu.
- [ ] **Step 4:** run + olemasolevad pildiserveri testid → PASS. Commit.

### Task 6: Kustutamine ja taastamine

**Files:**
- Modify: `server/work_exemplars.py` `delete_exemplar`, `server/routers/admin.py` `admin_work_delete`, `server/trash_ops.py` `restore_deleted_work`
- Test: `tests/test_exemplar_images_lifecycle.py`

**Interfaces:**
- Consumes: Task 4 `exemplar_dir`, `manifest_path`.
- Produces: `exemplar_images.trash_exemplar_files(work_dir, eid, work_id) -> None` (gitist väljas olevad failid `._trash/{work_id}/_exemplars/{eid}/`), `exemplar_images.trash_all_exemplar_files(work_dir, work_id)`, `exemplar_images.restore_exemplar_files(trash_dir, work_dir)`.

- [ ] **Step 1: Failing tests:**
  - `test_eksemplari_kustutus_eemaldab_manifesti_gitist`: pärast `delete_exemplar` → `git ls-files` ei sisalda `images.json`-i, failid prügikastis
  - `test_eksemplari_kustutus_ilma_piltideta_ei_tee_lisacommiti`
  - `test_teose_kustutus_ja_taastamine_sailitab_eksemplaripildid`: `admin_work_delete` → `restore_deleted_work` → `{id}.jpg` ja `.orig.*` tagasi, manifest gitist
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** `delete_exemplar`: `_write`-i sees pärast `_bulk`-i (sama `work_lock`), kui manifest on olemas, siis `git_ops.delete_file_from_git(manifest, f"Eksemplar: kustuta pildid [{eid}]", username)` + `trash_exemplar_files`. `_write` saab valikulise `after: Callable[[], None]`, mida kutsutakse luku all pärast `_bulk`-i. `admin_work_delete`: enne `rmtree`-d `trash_all_exemplar_files`. `restore_deleted_work`: sammus 5 ka `restore_exemplar_files`.
- [ ] **Step 4:** run → PASS. Commit.

### Task 7: ADA import (taustatöö, protokoll, taastaja)

**Files:**
- Create: `server/exemplar_import.py`
- Modify: `server/routers/exemplar_images.py` (2 otspunkti), `server/main.py` (taastaja lifespan'i taastajate loendisse, rida ~64)
- Test: `tests/test_exemplar_import.py`

**Interfaces:**
- Consumes: `ada.client.lookup(sisend) -> {"handle", "failid": [{name, bitstream_uuid, size_bytes}], …}`, `ada.fetch.laadi_tykk`, `liida_pdfid`, `lehtede_arv`, `upload.page_source.open_page_source(pdf).render_full(n, dst)`, `upload.prepress.RENDER_SEMAPHORE`; Task 2 `update_exemplar(locked=True, require_commit=True)`; Task 4 `exemplar_locks`, `read_manifest`, `write_manifest_locked`, `require_exemplar`.
- Produces:
  - `start_import(work_dir, eid, handle: str, page_from: int | None, page_to: int | None, username) -> str` (`import_id`). 409, kui eksemplaril on aktiivne import (`_imports/*/job.json` olek ∉ {`published`, `aborted`}).
  - `import_status(work_dir, eid, import_id) -> dict` → `{state, pages_total?, pages_done?, error?}`
  - `build_page_plan(bitstream_pages: list[tuple[str, int]], page_from, page_to, new_id) -> list[dict]` (puhas)
  - `publish(work_dir, eid, import_id) -> None` (protokoll, idempotentne)
  - `recover_imports() -> None` (stardil)
  - `job.json` olekud: `fetching` → `rendering` → `publishing` → `published` | `aborted` | `error`
  - Otspunktid: `POST …/images/import-ada` `{handle, from?, to?}` → `{import_id}`; `GET …/images/import-ada/{import_id}`.

- [ ] **Step 1: Failing tests (puhas plaan):**
  - `test_leheplaan_mitu_bitstreami_vahemik`: `[("u1", 4), ("u2", 6)]`, from=3, to=7 → 5 kirjet; `pdf_page` 3..7; `(bitstream, bitstream_page)` = `(u1,3),(u1,4),(u2,1),(u2,2),(u2,3)`
  - `test_leheplaan_vahemik_valjas_viga`: to=11 → `ExemplarImagesError`
  - `test_leheplaan_ilma_vahemikuta_koik`
- [ ] **Step 2: Failing tests (protokoll).** Fixture asendab allalaadimise + renderduse võltsiga, mis kirjutab staging'usse väikese JPEG-i; `publish`-i sammud on monkeypatchiga katkestatavad:
  - `test_import_avaldab_pildid_ja_seab_url`: url == `"https://hdl.handle.net/10062/14332"`, `source.ref == "10062/14332"`, `imports[import_id].count == 5`
  - `test_olemasolevat_url_ei_kirjutata_ule`: url jääb, `url_done` märgitud
  - `test_katkestus_parast_faile`, `test_katkestus_parast_manifesti_enne_commiti`, `test_katkestus_parast_commiti_enne_url`, `test_katkestus_parast_url_enne_koristust`: iga järel `publish` uuesti → pilte täpselt 5, üks `imports`-kirje, `uncommitted_paths([manifest, meta])` tühi, staging kadunud
  - `test_manifesti_commiti_torge_jatab_publishing`; `test_url_commiti_torge_url_done_marki_ei_tule`: kordus commit'ib ja märgib
  - `test_impordipilt_kustutatud_enne_kordust`: manifest commit'itud, URL ebaõnnestub, `delete_image` ühele → kordus ei viska, pilte 4, URL seatud
  - `test_eksemplar_kustutatud_renderdamise_ajal_aborted`; `test_teos_kustutatud_renderdamise_ajal`: `recover_imports` ei viska
  - `test_teine_import_samale_eksemplarile_409`
  - `test_tuhja_urliga_import_ei_jaa_ummikusse`: `publish` lõimes, `join(timeout=5)`
  - `test_imports_ei_satu_replace_work_content_commiti`: pooleli `job.json` kettal, `git add <slug>` → `git diff --cached --name-only` ei sisalda `_imports`-i (sõltub Task 1 `.gitignore`-ist; testi repo `.gitignore` = `_init_repo_locked`)
- [ ] **Step 3:** run → FAIL.
- [ ] **Step 4:** implementeeri spetsi „ADA import" ja „Avaldamine on taastatav protokoll" järgi (sammud 1–5 täpselt nagu spetsis). Taustatöö = `threading.Thread(daemon=True)`. `job.json` kirjutus alati `atomic_write_json`. Renderdus `RENDER_SEMAPHORE` all lehthaaval, valmis leht = `{image_id}.jpg` olemas.
- [ ] **Step 5:** run → PASS. Commit.

### Task 8: Lehtede loendi valvurid

**Files:**
- Test: `tests/test_exemplar_images_isolation.py`

- [ ] **Step 1: Tests** (peaksid kohe läbima; kui ei, paranda lugeja):
  - `test_page_stems_ei_naita_eksemplaripilte`: `work_parts.page_stems` sama enne ja pärast `_exemplars/a1b2c3/x1y2z3.jpg` lisamist
  - `test_meili_dokumendid_samad`: `meili_doc` teose dokumentide ehitaja (`enumerate_page_images`) sama tulemus
  - `test_get_first_image_ei_naita_alamkausta`
- [ ] **Step 2:** run → PASS. Commit.

### Task 9: Klient — teenus, alamleht, sirvimine

**Files:**
- Create: `src/services/exemplarImagesService.ts`, `src/pages/ExemplarPage.tsx`, `src/components/exemplars/ExemplarImageStrip.tsx`
- Modify: `src/App.tsx` (marsruut **enne** `/work/:workId/:pageNum?`), `src/components/exemplars/ExemplarCards.tsx` (pildiriba + link), `src/services/workImageService.ts`, `src/locales/{et,en}/workspace.json` (või olemasolev eksemplaride nimeruum)
- Test: `src/services/__tests__/exemplarImagesService.test.ts`, `src/pages/__tests__/ExemplarPage.test.tsx` (`/** @vitest-environment jsdom */`)

**Interfaces:**
- Produces (`exemplarImagesService.ts`):
  - `type ExemplarImage = { id: string; original?: string; label?: string; page?: string; source: { kind: 'ada'|'url'|'photo'|'paber_ut'|'other'; ref?: string; bitstream?: string; page?: number; import_id?: string; license?: string; added_by?: string; at?: string } }`
  - `type ExemplarManifest = { revision: number; images: ExemplarImage[]; imports: Record<string, unknown> }`
  - `fetchExemplarImages(workId, eid): Promise<ExemplarManifest>`, `patchExemplarImages(workId, eid, revision, images)`, `deleteExemplarImage(workId, eid, imageId, revision)`, `uploadExemplarImages(workId, eid, files: File[], source)`, `startAdaImport(workId, eid, handle, from?, to?)`, `fetchAdaImportStatus(workId, eid, importId)`. 409 → viskab `ManifestConflictError` (`current: ExemplarManifest`).
  - `workImageService.getExemplarImageUrl(workId, eid, imageId)`, `getExemplarThumbUrl(workId, eid, imageId)` (token lisab kutsuja `ImageTokenContext`-iga nagu lehepiltidel)
  - `sourceLabel(src, t): { text: string; href?: string }`: ADA → `"ADA 10062/14332, lk 3"` + `https://hdl.handle.net/…`
- [ ] **Step 1: Failing tests:** teenuse URL-id ja `sourceLabel`; `ManifestConflictError` 409 peal. `ExemplarPage`: renderdab pisipildid, `?image=` valib pildi, allikarida lingiga, mitte-toimetaja ei näe muutmisnuppe, tundmatu `eid` → teade.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implementeeri. Suur pilt kasutab sama zoom/pan komponenti mis lehepildid (otsi `Workspace`-i pildivaatajast, ära tee uut). Kerib aken. `ExemplarCards`: kui eksemplaril on pilte, siis pisipiltide rida (max 6) + arv → link alamlehele.
- [ ] **Step 4:** run + `npm run typecheck` → PASS. Commit.

### Task 10: Klient — kõrvutamine ja toimetamine

**Files:**
- Create: `src/components/exemplars/ExemplarCompare.tsx`, `src/components/exemplars/ExemplarImageEditor.tsx`, `src/components/exemplars/AdaImportDialog.tsx`
- Modify: `src/pages/ExemplarPage.tsx`, locale-failid
- Test: `src/components/exemplars/__tests__/ExemplarCompare.test.tsx`, `ExemplarImageEditor.test.tsx`, `AdaImportDialog.test.tsx`

**Interfaces:**
- Consumes: Task 9 teenus. Tekstitunnistaja lehed: olemasolev teose lehtede loend (sama allikas, mida Workspace kasutab lehenumbrite jaoks).
- Produces: `?compare={tüvi}` URL-is. „Salvesta paar" kirjutab pildi `page`-i `patchExemplarImages`-iga.

- [ ] **Step 1: Failing tests:**
  - Compare: pildi `page` → parem pool näitab seda tüve; nooled vahetavad paremat lehte sõltumatult; olematu tüvi → „paar puudub" ilma veata; „Salvesta paar" saadab õige revisjoniga PATCH-i.
  - Editor: lohistamine → `uploadExemplarImages`; järjekorra muutus + salvesta → PATCH; kustuta → `askConfirm`, siis DELETE; 409 → `notify('warning')` + manifest laetakse uuesti; salvestamata muudatus → `useUnsavedChangesGuard` aktiivne.
  - AdaImportDialog: handle + vahemik → `startAdaImport`; pollib olekut, kuni `published` (manifest laetakse uuesti) või `error` (teade); 409 „import juba käib".
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implementeeri. Number-sisendid `type="text" inputMode="numeric"`. Modaalid `z-[1300]`.
- [ ] **Step 4:** kõik väravad (Global Constraints) → PASS. Commit.

### Task 11: Kontroll tootmisandmetega ja deploy ettevalmistus

- [ ] **Step 1:** tunnel + `npm run dev` (CLAUDE.md). `6mwgby` eksemplari alamleht avaneb, piltideta eksemplaril on tühi olek. **Salvestusi tootmisse ei tehta.**
- [ ] **Step 2:** PR-i kirjelduses deploy järjekord: (1) serveri `data/.gitignore` laiendus `DATA_GITIGNORE_EXTRA` ridadega, commit konteinerist; (2) `server_update.sh --no-cache`; (3) frontend build + rsync. Reindeksit pole vaja.
- [ ] **Step 3:** pärast deploy'd: ADA import `6mwgby` TÜR-i eksemplarile (`10062/14332`, vahemik kasutajaga kokku leppida), kontrolli pilte ja url-i.
