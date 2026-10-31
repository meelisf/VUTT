# Seotud teosed: variandiseos — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toimetaja saab kahe teose vahele lisada ja eemaldada vastastikuse variandiseose (`isVersionOf`). Seos on näha teose infopaneelil, teosekaardil ja loendireal.

**Architecture:** Ainus kirjutustee on `PUT /works/{id}/relations`. Kahe teose kirjutus käib `bulk_update_works` uue range režiimiga, mis kasutab `save_with_git(rollback_on_error=True)`: üks commit või mitte midagi. Lugemine käib `GET /works/{id}/relations` kaudu, mis loeb sihtteoste metaandmed kettalt värskelt. Teose kustutamine koristab seosed `metadata_lock`-i all enne kausta eemaldamist, ja taastamine eemaldab taastatud teose seosed.

**Tech Stack:** FastAPI (Python 3.12, sync `def` routes, ADR 0002), git CLI + GitPython, React 19 + TypeScript + Tailwind, i18next, vitest.

**Spec:** `docs/superpowers/specs/2026-10-31-seotud-teosed-variant-design.md` — loe enne iga taski. Plaan viitab sellele, ega korda seda.

## Global Constraints

- Ainult `rel_type = "isVersionOf"`; `INVERSE = {"isVersionOf": "isVersionOf"}`. Muu `rel_type` → 400.
- Roll `require_role("admin")` + `can_write_work` mõlemale teosele (PUT); GET `optional_user` + `can_read_work` lähteteosele, muidu 404.
- „Seoseid pole" = võtme `relations` puudumine `_metadata.json`-is; tühi loend ei jõua kunagi kettale.
- Uued kirjed ei salvesta `label`-it. Olemasolevat `label`-it ei puututa ega loeta.
- Commiti sõnumid täpselt: `Seos: lisa variant {a} ↔ {b}`, `Seos: eemalda variant {a} ↔ {b}`, `Kustutamine: eemalda seosed {a} ↔ {b1}, {b2}`.
- PUT vastus 200 = `{"relations": [ResolvedRelation…]}`; commiti/kirjutuse viga → 500 „Seost ei salvestatud" (failid algseisus).
- Olemasoleva paari lisamine ja puuduva eemaldamine = 200, kirjutust ja commitit ei ole.
- GET vastus ei lähe `server/cache.py`-sse (ADR 0042).
- Koodikommentaarid eesti keeles. Uued i18n võtmed MÕLEMASSE keelde korraga (ADR 0011).
- Komponendi testid `*.test.tsx`, failipäises `/** @vitest-environment jsdom */`.
- Väravad: `npm run typecheck`, `npm test`, `npm run lint:ci` (lävi `--max-warnings 41` ei tõuse), `.venv/bin/pytest tests/ mcp/tests/`.
- Tootmises on 0 teosel `relations` (2026-11-01) — migratsiooni ei ole.

## Review Focus

1. **Samaaegne kustutus ja seose lisamine** — kumbki järjekord peab lõppema ilma ühegi seoseta kustutatud teosele (test Task 6).
2. **Teose vahetus infopaneelis sama komponendi sees** — variandi lingilt edasi minnes ei tohi eelmise teose seosed (ega hiljaks jäänud vastus) uue teose plokki jääda (test Task 8).
3. **Klõps loendirea seoste nupul või popoveris** ei tohi navigeerida teosele (test Task 9).
4. **Sihtteos on vahepeal kustutatud** — GET annab `missing: true`, plokk jätab selle vahele, kustutus ei blokeeru (testid Task 4, 6, 8).
5. **Admin lisab seose teosele, mis on teises kogus kui avalehe aktiivne kogu** — valija peab selle leidma (`scopeClauses` ei rakendu; test Task 8).

---

### Task 1: Tühja `relations` normaliseerimine

**Files:**
- Modify: `server/metadata_ops.py` (helper `normalize_title_fields` kõrvale, rida ~62; kutse `bulk_update_works`-is `normalize_title_fields(meta)` järel, rida ~160)
- Test: `tests/test_work_relations.py` (uus fail; kasutab `tests/test_bulk_atomicity.py` `_work`- ja `spies`-mustrit)

**Interfaces:**
- Produces: `drop_empty_relations(meta: dict) -> None` — eemaldab võtme `relations`, kui väärtus on `None` või tühi loend.

- [ ] **Step 1: Write the failing tests**

```python
def test_tuhi_relations_ei_joua_kettale(tmp_path, spies):
    path = _work(tmp_path, "teos-a", {"id": "w1", "title": "A"})
    res = bulk_update_works([(path, lambda m: {"relations": []})], "u", "msg")
    assert res["updated"] == 0 and res["skipped"] == 1
    assert spies["git"] == []
    assert "relations" not in json.loads(Path(path).read_text())

def test_viimase_seose_eemaldus_eemaldab_votme(tmp_path, spies):
    path = _work(tmp_path, "teos-a", {"id": "w1", "title": "A",
                 "relations": [{"id": "w2", "rel_type": "isVersionOf"}]})
    bulk_update_works([(path, lambda m: {"relations": []})], "u", "msg")
    assert "relations" not in json.loads(spies["git"][0]["content"])
```

- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_work_relations.py -v` → FAIL (`relations: []` jääb alles / commit tekib).
- [ ] **Step 3: Implement `drop_empty_relations`** ja kutsu seda `bulk_update_works`-is iga teose kohta pärast `normalize_title_fields(meta)`.
- [ ] **Step 4: Run** sama käsk → PASS; `.venv/bin/pytest tests/test_bulk_atomicity.py -q` → PASS.
- [ ] **Step 5: Commit** `feat(relations): tühi relations eemaldatakse võtmena (#701)`

---

### Task 2: `save_with_git(rollback_on_error=True)`

**Files:**
- Modify: `server/git_ops.py:416` (`save_with_git`)
- Test: `tests/test_save_with_git_rollback.py` (uus; päris repo nagu `tests/test_delete_pages_git.py` fixture `repo`: `Repo.init(tmp_path)`, `monkeypatch.setattr(git_ops, "BASE_DIR", str(tmp_path))`, `get_or_init_repo` → see repo)

**Interfaces:**
- Produces: `save_with_git(filepath, content, username, message=None, additional_files=None, *, rollback_on_error: bool = False) -> dict`. Kui `rollback_on_error` on tõene ja kirjutamine, `git add` või `git commit` ebaõnnestub, loeb funktsioon kõigi failide algse sisu baitidena (puuduv fail = `None`, taastamisel kustutatakse) ENNE esimest `atomic_write_text`-i, taastab need ja teeb `git reset -q -- <failid>` `_git_write_lock`-i all, seejärel tagastab `{"success": False, "error": str, "rolled_back": True}`. Kui ka taastamine ebaõnnestub: `{"success": False, "error": str, "rolled_back": False}` ja `record_server_error`. Vaikimisi (`False`) on käitumine muutumatu.

- [ ] **Step 1: Write the failing tests**

```python
def test_commiti_viga_taastab_failid_baithaaval(repo, monkeypatch):
    a, b = _tracked(repo, "a/_metadata.json", b'{"x": 1}\n'), _tracked(repo, "b/_metadata.json", b'{ "y":2 }')
    _fail_git_commit(monkeypatch)            # subprocess.run "commit" → CalledProcessError
    res = git_ops.save_with_git(a, '{"x": 2}', "u", "m", [(b, '{"y": 3}')], rollback_on_error=True)
    assert res == {"success": False, "error": ANY, "rolled_back": True}
    assert Path(a).read_bytes() == b'{"x": 1}\n' and Path(b).read_bytes() == b'{ "y":2 }'
    assert repo.git.diff("--cached", "--name-only") == ""

def test_teise_faili_kirjutusviga_taastab_esimese(repo, monkeypatch):
    # atomic_write_text viskab teisel kutsel → esimene fail algseisus, indeks puhas
    ...

def test_vaikimisi_kaitumine_muutumatu(repo, monkeypatch):
    _fail_git_commit(monkeypatch)
    res = git_ops.save_with_git(a, '{"x": 2}', "u", "m")
    assert res["success"] is False and "rolled_back" not in res
    assert Path(a).read_text() == '{"x": 2}'
```

- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_save_with_git_rollback.py -v` → FAIL.
- [ ] **Step 3: Implement.** Taastamine peab toimuma samas `with _git_write_lock:` plokis enne väljumist (spec, range režiim p. 2). `index.lock` korduskatsete loogika jääb samaks; tagasipööramine rakendub alles lõpliku vea korral.
- [ ] **Step 4: Run** → PASS; `.venv/bin/pytest tests/test_config_git_commit.py tests/test_delete_pages_git.py -q` → PASS.
- [ ] **Step 5: Commit** `feat(git): save_with_git rollback_on_error (#701)`

---

### Task 3: `bulk_update_works` range režiim

**Files:**
- Modify: `server/metadata_ops.py:106` (`bulk_update_works`)
- Test: `tests/test_work_relations.py`

**Interfaces:**
- Consumes: Task 2 `save_with_git(..., rollback_on_error=True)`.
- Produces:
  - `class BulkUpdateError(Exception)` (`metadata_ops.py`), atribuut `failed_paths: list[str]`.
  - `bulk_update_works(items, username, git_message, *, background_tasks=None, call_ptw=False, all_or_nothing: bool = False, skip_sync_paths: Iterable[str] = ()) -> dict`.
  - `all_or_nothing=True`: ükskõik milline `failed` → `BulkUpdateError` ENNE kirjutamist; `save_with_git` kutsutakse `rollback_on_error=True`-ga ja ebaõnnestumine → `BulkUpdateError`, ilma järeltegevuste ja Meili sünkita.
  - `skip_sync_paths`: need teed jäävad välja kõigist järeltegevustest (`update_work_collections`, `update_work_facts`, ptw, Meili sünk), aga kirjutatakse ja commititakse.

- [ ] **Step 1: Write the failing tests**

```python
def test_range_puuduv_fail_ei_kirjuta_midagi(tmp_path, spies):
    a = _work(tmp_path, "a", {"id": "w1", "title": "A"})
    with pytest.raises(BulkUpdateError):
        bulk_update_works([(a, _add("w2")), (str(tmp_path / "b/_metadata.json"), _add("w1"))],
                          "u", "m", all_or_nothing=True)
    assert spies["git"] == [] and spies["meili"] == []

def test_range_teise_transformi_viga_ei_kirjuta_esimest(tmp_path, spies): ...

def test_range_commiti_viga_viskab_ja_ei_sunki(tmp_path, spies, monkeypatch):
    monkeypatch.setattr(metadata_ops, "save_with_git",
        lambda *a, **k: {"success": False, "error": "x", "rolled_back": True})
    with pytest.raises(BulkUpdateError):
        bulk_update_works([...kaks teost...], "u", "m", all_or_nothing=True)
    assert spies["meili"] == [] and spies["collections"] == []

def test_skip_sync_paths_kirjutab_aga_ei_sunki(tmp_path, spies):
    ...  # kaks muutunud teost, üks skip-is → git näeb mõlemat, meili ainult teist

def test_vaikimisi_osaline_rike_kaitub_nagu_enne(tmp_path, spies): ...
```

- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_work_relations.py -v -k "range or skip_sync or vaikimisi"` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `.venv/bin/pytest tests/test_bulk_atomicity.py tests/test_metadata_git_tulemus.py tests/test_work_parts.py -q` → PASS.
- [ ] **Step 5: Commit** `feat(metadata): bulk_update_works range režiim ja skip_sync_paths (#701)`

---

### Task 4: Seoste tuumik `server/work_relations.py`

**Files:**
- Create: `server/work_relations.py`
- Test: `tests/test_work_relations.py`

**Interfaces:**
- Consumes: Task 3 `bulk_update_works(..., all_or_nothing=True, skip_sync_paths=…)`, `BulkUpdateError`; `find_directory_by_id` (`server/utils.py`); `load_work_metadata_by_id` (`server/work_sets_access.py:17`); `can_read_work` (`server/access_ops.py`).
- Produces:
  - `INVERSE: dict[str, str] = {"isVersionOf": "isVersionOf"}`
  - `class RelationError(Exception)` atribuudiga `status: int` (400 / 404 / 500).
  - `apply_relation_changes(source_id: str, add: list[dict], remove: list[dict], username: str, background_tasks=None) -> bool` — valideerib (`rel_type ∈ INVERSE`, siht olemas, ei ole iseendale → muidu `RelationError(400)`), ehitab mõlema teose transformid (loevad praegused `relations` luku all, lisavad/eemaldavad idempotentselt, salvestavad ainult `{id, rel_type}`), kutsub `bulk_update_works(…, all_or_nothing=True)` commiti sõnumiga Global Constraints'ist. `BulkUpdateError` → `RelationError(500, "Seost ei salvestatud")`. Tagastab, kas midagi muutus.
  - `resolve_relations(meta: dict, user: Optional[dict]) -> list[dict]` — iga `isVersionOf` kirje kohta `{id, rel_type, title, title_en, title_original, title_devised, year, year_display, dating, archive_ref, readable}` (`archive_ref` = esimene arhiiviviide kujul `"{archive_id} {reference}"` või `None`); puuduv siht → `{id, rel_type, missing: True}`. Muud liigid jäetakse välja.
  - `cleanup_for_deletion(work_id: str, meta_path: str, username: str, background_tasks=None) -> list[str]` — **eeldab, et kutsuja hoiab `metadata_lock`-i**; loeb kustutatava teose `relations`, jätab rippuvad (`find_directory_by_id is None`) välja, eemaldab ühe range partiiga seosed kustutatavalt teoselt ja kõigilt olemasolevatelt vastaspooltelt; `skip_sync_paths=[meta_path]`; sõnum `Kustutamine: eemalda seosed …`; tagastab koristatud vastaspoolte id-d. Ilma seosteta teos → `[]`, `bulk_update_works`-i ei kutsuta.

- [ ] **Step 1: Write the failing tests** (kaks päris kausta `tmp_path`-is, `find_directory_by_id` monkeypatchitud, `spies` nagu Task 1)

```python
def test_lisamine_kirjutab_molemad_uhe_commitiga(works, spies):
    apply_relation_changes("w1", [{"id": "w2", "rel_type": "isVersionOf"}], [], "u")
    assert len(spies["git"]) == 1
    assert spies["git"][0]["message"] == "Seos: lisa variant w1 ↔ w2"
    assert _rels("w1") == [{"id": "w2", "rel_type": "isVersionOf"}]
    assert _rels("w2") == [{"id": "w1", "rel_type": "isVersionOf"}]

def test_eemaldamine_eemaldab_molemalt_ja_votme(works, spies): ...
def test_olemasoleva_lisamine_ja_puuduva_eemaldus_on_noop(works, spies):
    assert apply_relation_changes("w1", [], [{"id": "w2", "rel_type": "isVersionOf"}], "u") is False
    assert spies["git"] == []

@pytest.mark.parametrize("add", [[{"id": "w1", "rel_type": "isVersionOf"}],
                                 [{"id": "w2", "rel_type": "isPartOf"}],
                                 [{"id": "puudub", "rel_type": "isVersionOf"}]])
def test_vigane_lisamine_400(works, spies, add):
    with pytest.raises(RelationError) as e: apply_relation_changes("w1", add, [], "u")
    assert e.value.status == 400 and spies["git"] == []

def test_resolve_piiratud_siht_annab_pealkirja_readable_false(works): ...
def test_resolve_puuduv_siht_on_missing(works): ...
def test_cleanup_jatab_rippuva_vahele_ja_ei_sunki_kustutatavat(works, spies): ...
```

- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_work_relations.py -v` → uued FAIL.
- [ ] **Step 3: Implement** `server/work_relations.py` (ainult eespool nimetatud avalik liides).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(relations): seoste tuumik — vastastikune kirjutus, lahendamine, koristus (#701)`

---

### Task 5: Otspunktid ja üldise salvestuse keeld

**Files:**
- Create: `server/routers/work_relations.py`
- Modify: `server/main.py` (import + `app.include_router(work_relations_router)` teiste kõrvale, ~rida 38 ja ~143)
- Modify: `server/routers/editing.py:327` (keeld `parts` kõrvale)
- Test: `tests/test_work_relations_router.py` (`client`, `login`, `backend_env` fixture'id `tests/conftest.py`-st)

**Interfaces:**
- Consumes: Task 4 `apply_relation_changes`, `resolve_relations`, `RelationError`.
- Produces:
  - `GET /works/{work_id}/relations` → `list[ResolvedRelation]` (sync `def`, `optional_user`; lähteteose puudumine või lugemisõiguse puudumine → 404).
  - `PUT /works/{work_id}/relations`, keha `{"add": [...], "remove": [...]}` → `{"relations": list[ResolvedRelation]}` (`require_role("admin")`, `can_write_work` lähtele ja igale `add`/`remove` sihtmärgile → muidu 403; `RelationError` → `HTTPException(e.status)`).
  - `/update-work-metadata` keha `metadata` sisaldab `relations` → 400 `"Seoseid muudetakse /works/{id}/relations kaudu"`.

- [ ] **Step 1: Write the failing tests**

```python
def test_put_ja_get(client, login, backend_env):
    tok = login("admin", "adminpass")
    r = client.put("/works/w1/relations", json={"add": [{"id": "w2", "rel_type": "isVersionOf"}], "remove": []}, headers=_h(tok))
    assert r.status_code == 200 and r.json()["relations"][0]["id"] == "w2"
    assert client.get("/works/w2/relations").json()[0]["id"] == "w1"

def test_put_editorile_403(client, login, backend_env): ...
def test_get_piiratud_lahteteos_anonuumselt_404(client, backend_env): ...
def test_put_commiti_viga_500(client, login, backend_env, monkeypatch): ...
def test_update_work_metadata_lukkab_relations_tagasi(client, login, backend_env):
    r = client.post("/update-work-metadata", json={"work_id": "w1", "metadata": {"relations": []}}, headers=_h(tok))
    assert r.status_code == 400
```

- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_work_relations_router.py -v` → FAIL.
- [ ] **Step 3: Implement** router + registreerimine + keeld.
- [ ] **Step 4: Run** → PASS. Kontrolli, et `grep -rn "relations" server/upload server/ada server/upload_ops.py` ei leia kirjutajat (spec: ainus kirjutustee).
- [ ] **Step 5: Commit** `feat(relations): GET/PUT /works/{id}/relations, üldine salvestus lükkab relations tagasi (#701)`

---

### Task 6: Kustutus ja taastamine

**Files:**
- Modify: `server/routers/admin.py:394-424` (`admin_work_delete`: lisa `background_tasks: BackgroundTasks`; sammud a–c `with metadata_lock:` all)
- Modify: `server/trash_ops.py:146-172` (`restore_deleted_work`: pärast `git checkout`-i ja JPG-de tagasiliigutamist, enne `repo.index.commit`-i)
- Test: `tests/test_work_relations_delete.py` (uus; kustutus `client` kaudu, taastamine `tests/test_trash_ops.py` `trash_repo` mustriga)

**Interfaces:**
- Consumes: Task 4 `cleanup_for_deletion(work_id, meta_path, username, background_tasks)`, `RelationError`; `metadata_lock` (`server/utils.py:18`).
- Produces: kustutus katkestab 500-ga enne JPG-de liigutamist, kui `cleanup_for_deletion` viskab; taastamine eemaldab taastatud `_metadata.json`-ist `relations` ja teeb `repo.index.add([<metadata rel tee>])` enne commiti.

- [ ] **Step 1: Write the failing tests**

```python
def test_kustutus_eemaldab_vastaspoolte_seosed(...): ...
def test_koristuse_viga_katkestab_kustutuse(...):          # cleanup viskab → 500, kaust alles, seosed alles
def test_rmtree_viga_jatab_seosteta_teose(...):            # shutil.rmtree mock viskab → teos alles, relations puudub, vastaspoolel samuti
def test_rippuv_siht_ei_blokeeri_kustutust(...): ...
def test_samaaegne_lisamine_ja_kustutus(...):
    # kaks lõime: PUT w1↔w2 ja DELETE w2; lõpuks: w2 kaust puudub JA w1-l pole seost w2-le
def test_taastamine_eemaldab_seosed_ka_kui_eelmine_commit_neid_kannab(trash_repo):
    # loo kustutuscommit, mille ^ sisaldab relations-it (kustutus ilma koristuseta)
    # → taastatud failis, taastamise commitis (repo.git.show("HEAD:<tee>")) ja Meili sünkis pole relations-it
```

- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_work_relations_delete.py -v` → FAIL.
- [ ] **Step 3: Implement.** Lukuskoop: luku all on ainult seoste lugemine, `cleanup_for_deletion`, JPG-de liigutus ja `rmtree`. Git-kustutuscommit, Meili kustutus, `update_work_collections`, `remove_work_facts` ja `build_work_id_cache` jäävad väljapoole.
- [ ] **Step 4: Run** → PASS; `.venv/bin/pytest tests/test_trash_ops.py tests/test_backend_smoke.py -q` → PASS.
- [ ] **Step 5: Commit** `feat(relations): kustutus koristab seosed luku all, taastamine eemaldab need (#701)`

---

### Task 7: ADR

**Files:**
- Create: `docs/decisions/0075-teoste-seos-uks-kirjutustee-vastastikune.md` (vorming nagu `docs/decisions/0057-teose-osad.md`)
- Modify: `docs/decisions/README.md` (register), `CLAUDE.md` invariantide alla üks lõik „Teoste seos (ADR 0075)"

- [ ] **Step 1:** Kirjuta ADR spec'i jaotise „ADR" sisu järgi (staatus „kehtib").
- [ ] **Step 2: Commit** `docs(adr): 0075 teoste seos — üks kirjutustee, vastastikune (#701)`

---

### Task 8: Frontend — teenus, tüübid, infopaneeli plokk ja valija

**Files:**
- Modify: `src/types.ts` (`Relation` kõrvale `ResolvedRelation`)
- Create: `src/services/relationsService.ts`
- Modify: `src/services/workService.ts:~70` ja `src/services/searchService.ts:~492` (`attributesToRetrieve` + `'relations'`); kontrolli `grep -n "archive_refs" src/services/*.ts`, et ükski teine kaardiallikas ei jääks ilma
- Create: `src/components/relations/RelatedWorksList.tsx` (ühine loend: paneel + ülekate), `src/components/relations/RelatedWorksBlock.tsx` (paneeli plokk + admini toimetamine), `src/components/relations/RelatedWorkPicker.tsx`
- Modify: `src/components/editor/WorkInfoPanel.tsx` (plokk arhiiviviidete järel, ~rida 340)
- Modify: `src/locales/et/common.json`, `src/locales/en/common.json` (nimeruum `relations`)
- Test: `src/components/relations/__tests__/RelatedWorksBlock.test.tsx`, `src/services/__tests__/relationsService.test.ts`

**Interfaces:**
- Consumes: Task 5 otspunktid; `apiGet`/`apiPut` (`src/services/apiClient.ts`); `workDisplayTitle` (`src/utils/workTitle.ts:33`), `formatYearDisplay` (`src/utils/yearDisplayUtils.ts:130`); `useConfirm`, `useNotify` (`FeedbackContext`).
- Produces:
  - `interface ResolvedRelation extends TitleFields { id: string; rel_type: Relation['rel_type']; year?: number | null; year_display?: string | null; dating?: unknown; archive_ref?: string | null; readable?: boolean; missing?: boolean }`
  - `variantRelations(rels?: Relation[] | null): Relation[]` — ainult `isVersionOf`.
  - `fetchRelations(workId: string, token?: string): Promise<ResolvedRelation[]>`
  - `changeRelations(workId: string, change: { add: Relation[]; remove: Relation[] }, token: string): Promise<ResolvedRelation[]>`
  - `<RelatedWorksList items={ResolvedRelation[]} lang={string} />` — rühmitab liigi järgi, jätab `missing` vahele, `readable` → `<Link to={/work/{id}/1}>`, muidu tekst + `t('common:relations.restricted')`.
  - i18n võtmed (et / en): `relations.title` „Seotud teosed" / „Related works"; `relations.types.isVersionOf` „Variant" / „Variant"; `relations.restricted` „piiratud ligipääs" / „restricted access"; `relations.add` „+ Lisa variant" / „+ Add variant"; `relations.removeConfirm` „Eemalda seos mõlemalt teoselt?" / „Remove the link from both works?"; `relations.saveError` „Seost ei salvestatud" / „The link was not saved"; `relations.searchPlaceholder` „Pealkiri, aasta või work_id" / „Title, year or work_id".

- [ ] **Step 1: Write the failing tests**

```tsx
it('piiratud siht on lingita koos märkega, loetav on link', ...)
it('ilma isVersionOf seoseta teos ei tee fetchRelations päringut', ...)   // ka siis, kui work.relations = [{rel_type:'isPartOf'}]
it('teose vahetus ei näita eelmise teose seoseid ega hilinenud vastust', ...)  // rerender uue work.work_id-ga, vana promise lahendub hiljem
it('PUT 500 → notify viga, plokk endises seisus', ...)
it('valija otsingupäringus ei ole aktiivse kogu filtrit', ...)  // Review Focus 5: päringu filter ei sisalda scopeClauses'i
it('valija jätab välja praeguse teose ja juba seotud teosed', ...)
```

- [ ] **Step 2: Run** `npx vitest run src/components/relations src/services/__tests__/relationsService.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Valija: Meili otsing sama tenant-tokeniga mis avaleht, **ilma** `scopeClauses`-ita; komponendi kuju järgi `EntityPicker`/`WorkSetPicker` mustrit; modaalina `z-[1300]`.
- [ ] **Step 4: Run** sama käsk → PASS; `npm run typecheck` → 0 viga; `npx vitest run src/locales` → PASS (localeParity, translationKeysResolve).
- [ ] **Step 5: Commit** `feat(relations): infopaneeli plokk „Seotud teosed" ja valija (#701)`

---

### Task 9: Frontend — teosekaardi ja loendirea nupp

**Files:**
- Create: `src/components/relations/RelationsButton.tsx`
- Modify: `src/components/WorkCard.tsx:~365-440` (nupp info-nupu alla, `top-10 right-2`; vastastikune sulgemine info-ülekattega)
- Modify: `src/components/WorkListRow.tsx` (ikoon pealkirja kõrval)
- Test: `src/components/relations/__tests__/RelationsButton.test.tsx`

**Interfaces:**
- Consumes: Task 8 `variantRelations`, `fetchRelations`, `RelatedWorksList`.
- Produces: `<RelationsButton workId={string} relations={Relation[] | undefined} variant={'card' | 'row'} open={boolean} onOpenChange={(open: boolean) => void} />` — renderdab `null`, kui `variantRelations(relations).length === 0`; number = sama pikkus; `fetchRelations` kutsutakse esimesel avamisel üks kord. `open`/`onOpenChange` lubab `WorkCard`-il hoida ühte avatud ülekatet korraga.

- [ ] **Step 1: Write the failing tests**

```tsx
it('ainult isPartOf seosega teosel nuppu ei ole', ...)
it('number on isVersionOf seoste arv segaloendis', ...)       // [{isVersionOf},{isVersionOf},{isPartOf}] → "2"
it('esimene avamine teeb ühe päringu, teine mitte', ...)
it('hiir liigub nupult ülekattele — ülekate jääb lahti', ...)  // mouseleave nupult + mouseenter ülekattele viivituse sees
it('Esc sulgeb', ...)
it('row: klõps nupul ja popoveris ei kutsu rea onClick-i', ...)  // Review Focus 3
```

Lisa `WorkCard`-i testi (olemasolev või uus `src/components/__tests__/WorkCard.relations.test.tsx`): seoste ülekatte avamine sulgeb info-ülekatte ja vastupidi.

- [ ] **Step 2: Run** `npx vitest run src/components/relations src/components/__tests__` → FAIL.
- [ ] **Step 3: Implement.** Ikoon ja toon on builderi valik (nt `lucide-react` `GitFork`, violetne); `row` variant on nupu juurest ujuv popover, mida rida ei lõika (`overflow-hidden` ei tohi teda peita).
- [ ] **Step 4: Run** → PASS; `npm run typecheck`; `npm run lint:ci` → lävi ei tõuse.
- [ ] **Step 5: Commit** `feat(relations): seoste nupp teosekaardil ja loendireal (#701)`

---

### Task 10: Lõppkontroll

- [ ] **Step 1:** `npm run typecheck && npm test && npm run lint:ci && .venv/bin/pytest tests/ mcp/tests/` → kõik rohelised; kirjuta väljundi kokkuvõte PR-i.
- [ ] **Step 2:** Käsitsi kontroll tunneli + `npm run dev` kaudu (CLAUDE.md „UI kontroll tootmisandmetega"): **ainult lugemine** — kaardinupp ja plokk ei ilmu ilma seosteta teostel. Seose lisamist tootmises ei tehta enne deploy'd.
- [ ] **Step 3:** PR `feat: seotud teosed — variandiseos (#701)`, kehas viide spec'ile, ADR-ile ja märkus: pärast deploy'd poolitab toimetaja `nri7ga` käsitsi (uus upload lk 2-st + lk 2 kustutus), lisab seose ja märkused (spec „Valmis, kui").
