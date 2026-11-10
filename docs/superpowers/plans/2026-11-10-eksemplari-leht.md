# Eksemplari leht — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eksemplari leht `/work/:id/exemplar/:eid?` näitab teose eksemplare tervikuna (kirje + pildimaterjal), kirje toimetamine kolib sinna metaandmete modaalist, kõrvutus muutub kahe jada läbilappamise modaaliks ja pildipaarid ei jää lehetoimingute järel valele lehele viitama.

**Architecture:** Server saab kolm väikest muudatust (täielik leheloend eksemplaride vastuses, sihtlehe kontroll paari kirjutusel, olekupõhine paaride koristus + eemaldus enne lehestiku asendust). Klient: puhas loogika eraldi moodulis (`exemplarSequences.ts`), selle peal neli komponenti (loend+vorm, pildimaterjal, pildimodaal, kõrvutusmodaal) ja ümberkirjutatud `ExemplarPage`. Olemasolev vorm, piltide redaktor ja ADA dialoog tõstetakse ümber, mitte ei kirjutata uuesti.

**Tech Stack:** FastAPI + pytest (`.venv/bin/pytest`), React 19 + TypeScript + Tailwind, vitest (komponenditestid `/** @vitest-environment jsdom */`), react-i18next.

**Spec:** `docs/superpowers/specs/2026-11-10-eksemplari-leht-design.md` — loe enne iga taski. Mockupid (gitist väljas, ainult selles masinas): `.superpowers/brainstorm/2115728-1794336221/content/` — `paigutus-v6-halduse-raam.html`, `leht-v7-detailid.html`, `korvutus-v4.html`.

## Global Constraints

- Haru: `feat/eksemplari-leht` `main`-ist. Spike'i (`spike/eksemplari-leht-proto`) koodi EI tooda üle; `ExemplarsProtoPage.tsx` ja marsruut `/exemplars/` ei tohi tekkida.
- Koodikommentaarid eesti keeles. Commit-sõnumid eesti keeles, lõpus `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- i18n: iga uus võti `src/locales/et/workspace.json` JA `src/locales/en/workspace.json` samas commitis (ADR 0011; `localeParity.test.ts`).
- Täisekraani modaal `z-[1300]` (raam nagu `PageImageEditorModal.tsx:326`).
- Tagasiside ainult `useNotify()` / `useConfirm()`; natiivset `alert`/`confirm` ei ole. Salvestamata muudatused: `useUnsavedChangesGuard` + `UnsavedChangesDialog`, uut dialoogi ei tehta.
- Number-sisend: `type="text" inputMode="numeric"`.
- `work_lock` (`server/admin_page_ops.py:36`) EI OLE taassisenetav. Ükski kood, mida kutsutakse `refresh_work_mentions`-ist, ei tohi seda võtta. `metadata_lock` on RLock.
- Blokeeriv I/O `async def` sees on keelatud (ADR 0002).
- Leht: `max-w-4xl mx-auto px-4 py-8`, kaardid `bg-white rounded-xl border border-gray-200 shadow-sm` (nagu `WorkManage.tsx:952,1072`).
- Avalik lugeja ei näe: toiminguid, järjestusnooli, märki „vajab ülevaatust", allikat liigiga `migration` / `manual` / `upload`. Näeb allikat liigiga `ester` / `jaanson` / `ada`.
- Kirje näitab ainult täidetud välju. Tühi piltide jaotis on üks rida; avalikule lugejale tühja jaotist ei näidata.
- Väravad enne iga commit'i taskis, mis puudutab vastavat poolt: `npm run typecheck`, `npm test`, `npm run lint:ci` (lävi 41, ei tohi tõusta), `.venv/bin/pytest tests/`.

## Review Focus

1. **Teos ilma eksemplarideta või ilma lehtedeta** → leht renderdub tühja seisuga, ei viska. Test: Task 8.
2. **Paar olematule lehele (rippuv)** → ei märki, kõrvutus avaneb algusest, salvestamine ei blokeeru. Test: Task 5 (`validPairStem`), Task 2 (muutmata rippuv `page` ei anna 409).
3. **Koristus kutsutakse, kui kutsuja hoiab `work_lock`-i** → ei jää rippuma. Test: Task 3.
4. **Kõrvutuse pooled on eri pikkusega või ühel on üks pilt** → lukus samm peatub mõlemal, indeks ei lähe piirist välja. Test: Task 5 (`stepLocked`).
5. **Eksemplar kustutati teises aknas mustandi ajal** → kirjutus annab 404, kasutaja näeb teadet, loend laeb uuesti, mustand ei jää rippuma. Test: Task 6.

---

### Task 1: Täielik leheloend eksemplaride vastuses

**Files:**
- Modify: `server/routers/work_exemplars.py:45-68` (`list_exemplars`)
- Modify: `src/services/workApi.ts:321-329` (`WorkExemplarsResponse`)
- Test: `tests/test_work_exemplars_api_pages.py` (uus; kasuta kinnitust `exemplar_work`, `tests/conftest.py:386`, ja FastAPI `TestClient`-i nagu `tests/test_exemplar_images_api.py`)

**Interfaces:**
- Produces: `GET /works/{id}/exemplars` vastuses `page_numbers: {tüvi: nr}` KÕIGILE lehtedele (`we.page_stems(path)` järjekorras, nr = koht + 1) ja uus `page_files: string[]` (failinimed samas järjekorras, `meili_doc.enumerate_page_images(path)`). TS: `page_files: string[]` lisatakse `WorkExemplarsResponse`-i.

- [ ] **Step 1: Kirjuta kukkuv test**

```python
def test_page_numbers_katab_koik_lehed(client, exemplar_work):
    # kinnitusel on üks leht 1640-test-w1-001 ja eksemplaril a1b2c3 EI OLE `pages`-i
    r = client.get("/works/w1/exemplars").json()
    assert r["page_numbers"] == {"1640-test-w1-001": 1}
    assert r["page_files"] == ["1640-test-w1-001.jpg"]
    assert r["page_count"] == 1
```

- [ ] **Step 2: Käivita** — `.venv/bin/pytest tests/test_work_exemplars_api_pages.py -v` → FAIL (`page_numbers == {}`).
- [ ] **Step 3: Muuda `list_exemplars`**: eemalda `used`-filter ja kommentaar „vaade ei tea lehtede loendit"; lisa `page_files`. Lisa `page_files` TS-tüüpi.
- [ ] **Step 4: Käivita** — sama käsk → PASS; `.venv/bin/pytest tests/ -k exemplar` → PASS; `npm run typecheck` → 0 viga.
- [ ] **Step 5: Commit** — `feat(eksemplarid): eksemplaride vastus kannab täielikku leheloendit`

---

### Task 2: Paari kirjutus kontrollib sihtlehte (+ ADR 0079 täiendus)

**Files:**
- Modify: `docs/decisions/0079-eksemplari-pildid.md` (p 3 lõpp: lause „lehetoimingutega seda ei sünkroniseerita" asendub spetsi jaotise „Paarid ja lehetoimingud" punktidega 1–6, lühidalt + viide spetsile)
- Modify: `server/exemplar_images.py:284-303` (`patch_images`)
- Test: `tests/test_exemplar_images.py`

**Interfaces:**
- Produces: `patch_images` viskab `ExemplarImagesError(…, 409, clean_manifest(current))`, kui mõne pildi `page` ERINEB salvestatust ja uus väärtus ei ole `work_exemplars.page_stems(work_dir)` hulgas. Muutmata `page` väärtust ei kontrollita.

- [ ] **Step 1: ADR täiendus** (docs, enne koodi — spets nõuab).
- [ ] **Step 2: Kirjuta kukkuvad testid**

```python
def test_paar_olematule_lehele_409(env):
    m = _add(env)
    imgs = [{**m["images"][0], "page": "olematu-tyvi"}, m["images"][1]]
    with pytest.raises(ei.ExemplarImagesError) as e:
        ei.patch_images(env["work_dir"], env["eid"], m["revision"], imgs, "meelisf")
    assert e.value.status == 409

def test_paar_olemasolevale_lehele_salvestub(env):
    m = _add(env)
    imgs = [{**m["images"][0], "page": "1640-test-w1-001"}, m["images"][1]]
    out = ei.patch_images(env["work_dir"], env["eid"], m["revision"], imgs, "meelisf")
    assert out["images"][0]["page"] == "1640-test-w1-001"

def test_muutmata_rippuv_paar_ei_blokeeri_sildi_muutmist(env):
    # kirjuta rippuv paar otse manifesti (möödudes kontrollist), siis muuda ainult silti
    m = _add(env)
    m["images"][0]["page"] = "kadunud-tyvi"
    with ei.exemplar_locks(env["work_dir"]):
        ei.write_manifest_locked(env["work_dir"], env["eid"], {**m, "revision": m["revision"] + 1}, "t", "test")
    cur = ei.read_manifest(env["work_dir"], env["eid"])
    imgs = [{**cur["images"][0], "label": "kaas"}, cur["images"][1]]
    out = ei.patch_images(env["work_dir"], env["eid"], cur["revision"], imgs, "meelisf")
    assert out["images"][0]["label"] == "kaas"
```

(Kui `ExemplarImagesError` hoiab staatust teise nimega väljal, kasuta seda — vt `exemplar_images.py:40`.)

- [ ] **Step 3: Käivita** — `.venv/bin/pytest tests/test_exemplar_images.py -k "paar" -v` → esimene FAIL.
- [ ] **Step 4: Teosta kontroll** `patch_images`-is pärast `merged` arvutamist, luku all.
- [ ] **Step 5: Käivita** — `.venv/bin/pytest tests/test_exemplar_images.py tests/test_exemplar_images_api.py -v` → PASS.
- [ ] **Step 6: Commit** — `feat(eksemplarid): paari kirjutus kontrollib sihtlehe olemasolu (ADR 0079 p 3 täiendus)`

---

### Task 3: Olekupõhine paaride koristus lehetoimingute järel

**Files:**
- Modify: `server/exemplar_images.py` (uus `prune_dangling_pairs`)
- Modify: `server/prosopography/relations.py:156-185` (`refresh_work_mentions`)
- Modify: `server/admin_page_ops.py` (`split_page` ~:513, `apply_page_ops` ~:782, `delete_pages`) — tulemusse `pairs_removed`
- Modify: `src/pages/WorkManage.tsx` (teade), `src/locales/{et,en}/workspace.json`
- Test: `tests/test_exemplar_pairs_sync.py` (uus)

**Interfaces:**
- Produces:
  - `exemplar_images.prune_dangling_pairs(work_dir: str, username: str = "Automaatne") -> int` — iga `_exemplars/*/images.json`: eemaldab `page`, mille tüvi ei ole `page_stems(work_dir)` hulgas; muutunud manifest saab `revision + 1` ja ühe commit'i (`write_manifest_locked`, sõnum `"Eksemplar: paarid ühtlustatud lehetoimingu järel [{eid}]"`); muutusteta manifesti ei kirjuta. Võtab AINULT `metadata_lock`-i. Tagastab eemaldatud paaride arvu. `_exemplars/` puudumisel `0`.
  - `refresh_work_mentions(...) -> dict` (seni `None`): `{"pairs_removed": int}`. Koristus on neljas `try`-plokk; erind → `logger.exception` + `client_errors.record_server_error("server:thread", exc)` ja `pairs_removed = 0`.
  - `split_page`, `apply_page_ops`, `delete_pages` edutulemus kannab `pairs_removed: int`.
  - i18n: `manage.pairsRemoved_one` / `_other` — et: „{{count}} eksemplari pildipaar eemaldati, sest leht muutus." / „{{count}} eksemplari pildipaari eemaldati, sest lehed muutusid."; en: „{{count}} exemplar image pairing was removed because the page changed." / „{{count}} exemplar image pairings were removed because pages changed."

- [ ] **Step 1: Kirjuta kukkuvad testid**

```python
def test_koristus_eemaldab_ainult_rippuva(env):          # env = exemplar_work + 2 pilti
    # pilt 0 → olemasolev tüvi, pilt 1 → rippuv (kirjuta otse manifesti)
    assert ei.prune_dangling_pairs(env["work_dir"]) == 1
    m = ei.read_manifest(env["work_dir"], env["eid"])
    assert m["images"][0]["page"] == "1640-test-w1-001" and "page" not in m["images"][1]

def test_koristus_on_idempotentne_ja_ei_commiti_tuhjalt(env):
    ei.prune_dangling_pairs(env["work_dir"])
    n = _commits(env)
    assert ei.prune_dangling_pairs(env["work_dir"]) == 0 and _commits(env) == n

def test_koristus_ei_vota_work_locki(env):
    # Review Focus 3: kutsuja hoiab work_lock-i → ei tohi rippuma jääda
    import threading
    from server.admin_page_ops import work_lock
    done = threading.Event()
    with work_lock(os.path.basename(env["work_dir"]), env["work_dir"]):
        t = threading.Thread(target=lambda: (ei.prune_dangling_pairs(env["work_dir"]), done.set()))
        t.start(); t.join(5)
    assert done.is_set()

def test_refresh_tagastab_arvu_ja_viga_ei_levi(env, monkeypatch):
    from server.prosopography import relations
    monkeypatch.setattr(ei, "prune_dangling_pairs", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    assert relations.refresh_work_mentions(env["work_dir"], "w1") == {"pairs_removed": 0}
```

Lisa `tests/test_split_page.py` olemasoleva kinnituse peale üks test: paar poolitatavale lehele → pärast `split_page` on tulemuses `pairs_removed == 1` ja manifestis `page` puudub (poolitus EI jaota paare pooltele).

- [ ] **Step 2: Käivita** — `.venv/bin/pytest tests/test_exemplar_pairs_sync.py -v` → FAIL (`prune_dangling_pairs` puudub).
- [ ] **Step 3: Teosta** `prune_dangling_pairs`, `refresh_work_mentions` neljas plokk + tagastus, `pairs_removed` kolme lehetoimingu tulemuses (taustatöö `apply_page_ops` tulemus jõuab `…/page-ops/status` vastusesse olemasoleva tee kaudu — kontrolli `server/page_ops_jobs.py`).
- [ ] **Step 4: Halduse teade**: `WorkManage.tsx` — kui poolituse, kustutuse või page-ops töö tulemuses on `pairs_removed > 0`, `notify(t('manage.pairsRemoved', { count }), 'warning')`.
- [ ] **Step 5: Käivita** — `.venv/bin/pytest tests/` → PASS (sh `test_split_page.py`, `test_page_ops_batch.py`); `npm run typecheck && npm test` → PASS.
- [ ] **Step 6: Commit** — `feat(eksemplarid): rippuvad pildipaarid koristatakse lehetoimingu järel`

---

### Task 4: Lehestiku asendus eemaldab paarid enne sisu asendamist

**Files:**
- Modify: `server/exemplar_images.py` (uus `clear_all_pairs`)
- Modify: `server/upload_ops.py:560-600` (`_replace_work_content_locked`, kohe pärast sihtkausta leidmist, ENNE sammu „Arhiveerib vanad JPG-d")
- Test: `tests/test_exemplar_pairs_sync.py`

**Interfaces:**
- Produces: `exemplar_images.clear_all_pairs(work_dir: str, username: str) -> int` — eemaldab KÕIK `page` väärtused kõigist teose manifestidest (sama kirjutus- ja lukureegel mis `prune_dangling_pairs`; commit-sõnum `"Eksemplar: paarid eemaldatud, lehestik asendatakse [{eid}]"`). Erindit EI neela.
- `_replace_work_content_locked`: `clear_all_pairs` erind → `HTTPException(500, "Eksemplaride pildipaaride eemaldamine ebaõnnestus; teose sisu ei asendatud")`, enne kui ükski fail on liigutatud.

- [ ] **Step 1: Kirjuta kukkuvad testid**

```python
def test_clear_all_pairs_eemaldab_ka_kehtiva(env):
    # pilt 0 → kehtiv paar
    assert ei.clear_all_pairs(env["work_dir"], "meelisf") == 1
    assert "page" not in ei.read_manifest(env["work_dir"], env["eid"])["images"][0]

def test_asendus_katkeb_kui_paaride_eemaldus_ebaonnestub(env, monkeypatch):
    # monkeypatch ei.clear_all_pairs viskama; kutsu _replace_work_content_locked
    # minimaalse upload-state'iga (vt tests/ olemasolevaid replace-teste) →
    # HTTPException 500 JA teose lehefailid on puutumata (sama faililoend enne ja pärast).
```

- [ ] **Step 2: Käivita** → FAIL.
- [ ] **Step 3: Teosta** mõlemad. `prune_dangling_pairs` ja `clear_all_pairs` jagavad ühte sisemist abilist (predikaat „kas see paar jääb").
- [ ] **Step 4: Käivita** — `.venv/bin/pytest tests/` → PASS.
- [ ] **Step 5: Commit** — `feat(eksemplarid): lehestiku asendus eemaldab pildipaarid enne sisu asendamist`

---

### Task 5: Puhas loogika — jadad, päritolu, paari kehtivus, lukus samm

**Files:**
- Create: `src/components/exemplars/exemplarSequences.ts`
- Test: `src/components/exemplars/__tests__/exemplarSequences.test.ts` (node-keskkond)

**Interfaces:**
- Consumes: `WorkExemplarsResponse` (Task 1), `ExemplarImage` (`exemplarImagesService.ts:20`), `getFullImageUrl`, `getPageThumbUrl`, `getExemplarImageUrl`, `getExemplarThumbUrl` (`workImageService.ts`).
- Produces:

```ts
export const PAGES_KEY = 'pages';                       // rea „Teose lehed" ja jada võti
export interface SeqItem { key: string; label: string; url: string; thumb: string;
  stem?: string;        // teose lehe tüvi (ainult jadas PAGES_KEY)
  pairStem?: string;    // pildi KEHTIV paar (rippuv = undefined)
  ownerNote?: string }  // „Riga LUAB" / 'unknown', kui leht ei ole aluse oma
export interface Sequence { key: string; kind: 'pages' | 'images'; exemplarId?: string; items: SeqItem[] }

/** Tüvi → eksemplari id | 'unknown' | null (ADR 0076 p 4 lahendusjärjekord). */
export function pageOwners(data: WorkExemplarsResponse): Map<string, string | 'unknown' | null>;
/** Rippuv või tühi → undefined. */
export function validPairStem(image: ExemplarImage, pageNumbers: Record<string, number>): string | undefined;
/** Kõik teose lehed teose järjekorras (page_files), ownerNote erand- ja teadmata lehtedel. */
export function pagesSequence(workId: string, data: WorkExemplarsResponse): Sequence;
export function imagesSequence(workId: string, exemplarId: string, images: ExemplarImage[],
  pageNumbers: Record<string, number>): Sequence;
/** Eksemplari lehe jaotis: tema teose lehed (alus: kõik peale erand- ja teadmata lehtede). */
export function ownPages(workId: string, data: WorkExemplarsResponse, exemplarId: string): SeqItem[];
/** Rea „Teose lehed" sisu (alus märkimata): kõik lehed peale erandlehtede. */
export function unassignedPages(workId: string, data: WorkExemplarsResponse): SeqItem[];
/** Vaikimisi valik: esimene piltidega eksemplar → alus → PAGES_KEY (kui lehti on) → esimene eksemplar → null. */
export function defaultSelection(data: WorkExemplarsResponse): string | null;
export function hasWitness(data: WorkExemplarsResponse): boolean;
/** Lukus samm: mõlemad +delta; kui kumbki läheks piirist välja, ei liigu kumbki. */
export function stepLocked(l: number, r: number, delta: 1 | -1, lenL: number, lenR: number): [number, number];
/** ADA (hdl.handle.net/10062/, dspace.ut.ee) | ESTER | Alvin | DIGAR | Libris | host; vigane URL → 'link'. */
export function externalLinkLabel(url: string): string;
/** Avalikule lugejale nähtav allikas: ester | jaanson | ada. */
export function isCitationSource(kind?: string): boolean;
```

- [ ] **Step 1: Kirjuta kukkuvad testid** — üks `describe` funktsiooni kohta; kohustuslikud juhud:

```ts
// pageOwners: erandleht → eksemplari id; unknown_pages → 'unknown'; alus olemas → ülejäänud alusele; alust pole → null
// validPairStem: page 'x' ja pageNumbers ilma 'x'-ta → undefined (Review Focus 2); page puudub → undefined
// pagesSequence: 3 lehte, neist 1 erandleht → items.length === 3, erandlehel ownerNote === hoidja võti
// pagesSequence: failinimi 'Liefflä-001.jpg' → url sisaldab 'Liefl%C3%A4' kuju (encodeURI), stem === 'Liefflä-001'
// ownPages(alus): ei sisalda erand- ega teadmata lehti; ownPages(erandeksemplar): ainult tema pages
// defaultSelection: {images:{b:{count:2}}} → 'b'; pilte pole + alus 'a' → 'a'; alust pole, page_count 5 → 'pages';
//                   eksemplare 0 ja page_count 0 → null (Review Focus 1)
// stepLocked(2, 7, 1, 3, 8) → [2, 7] (vasak lõpus, kumbki ei liigu; Review Focus 4)
// stepLocked(0, 0, -1, 1, 1) → [0, 0];  stepLocked(1, 4, 1, 6, 8) → [2, 5]
// externalLinkLabel('http://hdl.handle.net/10062/14332') → 'ADA'; ('pole url') → 'link'
// isCitationSource('jaanson') true; ('migration') false; (undefined) false
```

- [ ] **Step 2: Käivita** — `npx vitest run src/components/exemplars/__tests__/exemplarSequences.test.ts` → FAIL.
- [ ] **Step 3: Teosta moodul.** Lehe pildi URL: `getFullImageUrl(\`${workId}/${file}\`)`, pisipilt `getPageThumbUrl(workId, file)`; token lisab kutsuja (`withImageToken`).
- [ ] **Step 4: Käivita** → PASS; `npm run typecheck` → 0.
- [ ] **Step 5: Commit** — `feat(eksemplarid): jadade, lehe päritolu ja lukus sammu puhas loogika`

---

### Task 6: Loendikaart — kirje täisvaade ja toimetamine lehel

**Files:**
- Create: `src/components/exemplars/ExemplarList.tsx` (vorm, kirjutused ja valideerimine tõstetakse `ExemplarsSection.tsx`-ist: `toDraft`, `convoluteFromDraft`, `reproductionFromDraft`, `write`, `saveDraft`, `toggleWitness`, `clearReview`, `remove`, `move`)
- Create: `src/components/exemplars/__tests__/ExemplarList.test.tsx` (lähtu `ExemplarsSection.test.tsx`-ist)
- Modify: `src/locales/{et,en}/workspace.json`
- (`ExemplarsSection.tsx` jääb selle taski lõpuni alles; eemaldatakse Task 10-s.)

**Interfaces:**
- Consumes: `exemplarSequences` (Task 5), `workApi` eksemplaride kirjutused, `SameVolumeBlock`, `ArchiveSelect`.
- Produces:

```ts
interface ExemplarListProps {
  workId: string; authToken: string | null; userRole?: string; isManuscript: boolean;
  data: WorkExemplarsResponse;                       // lehe laetud vastus
  archives: Record<string, { name: string; url?: string }>;
  onArchiveAdded: (id: string, info: { name: string; url?: string }) => void;
  selected: string | null;                           // eksemplari id | PAGES_KEY | null
  onSelect: (key: string) => void;
  onChanged: () => Promise<void>;                    // leht laeb `data` uuesti
  onDirtyChange?: (dirty: boolean) => void;
  ref?: React.Ref<{ saveDraft: () => Promise<boolean> }>;
}
```

- Käitumine (spets „Kaart „Eksemplarid"" ja „Rida „Teose lehed""):
  - kinnine rida: hoidja võti, kohaviit (puudumisel hoidja täisnimi hallilt), aluse pill, välislingi kiip (`externalLinkLabel`), arv („N lehte" / „N pilti"), viiteallikas (`isCitationSource`) paremal; admin: ↑↓ ja „vajab ülevaatust";
  - lahtine rida (= `selected`): ainult täidetud väljad; konvoluudi all `SameVolumeBlock` + `convolute.contents`; admin: Muuda, Märgi aluseks / Eemalda aluse märge, Märgi üle vaadatuks, Kustuta;
  - „Muuda" → sama rida vormina, kõik rühmad lahti (ei ole „Rohkem ▾");
  - `hasWitness(data) === false && data.page_count > 0` → kollane rida `PAGES_KEY`; admin: „Märgi alus…" avab eksemplaride valiku ja kutsub sama `toggleWitness` tee; eksemplare 0 → nupp puudub;
  - `data.unknown_pages.length > 0` → rida „Teadmata päritoluga lehed · N" (ei ole valitav);
  - avalik lugeja (`!isAtLeast(userRole, 'admin')`): ei nuppe, ei nooli, ei „vajab ülevaatust", ei tehnilist allikat.
- i18n (mõlemas keeles): `exemplars.convolute.contents` → et „Köite sisu", en „Volume contents"; uus `exemplars.convolute.contentsHint` → et „Kõik samas köites olevad trükised, ka need, mida VUTT-is ei ole." / en „All prints bound in the same volume, including those not in VUTT."; `exemplarPage.pagesRow` („Teose lehed" / „Work pages"), `exemplarPage.pagesRowHint` („pole märgitud, millise eksemplari skaneering see on" / „not marked which exemplar this scan is from"), `exemplarPage.markWitness` („Märgi alus…" / „Mark source…"), `exemplarPage.unknownPagesRow` („Teadmata päritoluga lehed" / „Pages of unknown origin"), `exemplarPage.pageCount_one/_other` („{{count}} leht"/„{{count}} lehte"; „{{count}} page"/„{{count}} pages").

- [ ] **Step 1: Kirjuta kukkuvad testid** (jsdom-päis). Kohustuslikud:

```tsx
// 1. hõre kirje: lahtisel real EI OLE silte „Seisund", „Köide", „Provenients" (ainult täidetud väljad)
// 2. avalik (userRole undefined): pole nuppu „Muuda", pole teksti „vajab ülevaatust",
//    source {kind:'migration'} ei kuvata, source {kind:'jaanson', ref:'Jaanson 946'} kuvatakse
// 3. alus märkimata + page_count 25: rida „Teose lehed" on olemas; admin näeb „Märgi alus…", avalik mitte
// 4. alus märgitud: rida „Teose lehed" puudub
// 5. „Muuda" → väli „Köite sisu" on kohe nähtav (rühmad lahti)
// 6. salvestus kutsub updateWorkExemplar samade väljadega mis ExemplarsSection (võrdle olemasoleva testiga)
// 7. Review Focus 5: updateWorkExemplar reject'ib 404-ga → notify('…', 'error') kutsutud,
//    onChanged kutsutud, vorm on suletud
// 8. käsikiri ühe eksemplariga: „Lisa eksemplar" puudub, vihje on olemas
```

- [ ] **Step 2: Käivita** — `npx vitest run src/components/exemplars/__tests__/ExemplarList.test.tsx` → FAIL.
- [ ] **Step 3: Teosta `ExemplarList.tsx`** + i18n võtmed mõlemas keeles.
- [ ] **Step 4: Käivita** — sama test + `npm test` (sh `localeParity`, `translationKeysResolve`) → PASS; `npm run typecheck`, `npm run lint:ci` → PASS.
- [ ] **Step 5: Commit** — `feat(eksemplarid): loendikaart kirje täisvaate ja toimetamisega`

---

### Task 7: Pildivaaturi juhitud suurendus

**Files:**
- Modify: `src/components/ImageViewer.tsx` (`scale` :36, `position` :37, lähtestus src-i vahetusel ~:99)
- Test: `src/components/__tests__/ImageViewer.controlled.test.tsx` (uus, jsdom)

**Interfaces:**
- Produces:

```ts
export interface ViewState { scale: number;   // 1 = „mahub aknasse" (praegune algväärtus)
  x: number; y: number }                      // nihe konteineri laiuse/kõrguse OSANA (px / mõõt)
// ImageViewerProps lisandub:
view?: ViewState;                             // antud → komponent on juhitud
onViewChange?: (v: ViewState) => void;
```

- Reeglid: `view` puudub → käitumine bait-haaval sama mis praegu (töölaud ei muutu). `view` antud → rull, lohistamine ja nupud kutsuvad `onViewChange`, sisemist olekut ei muudeta; `src`-i vahetus EI lähtesta vaadet.

- [ ] **Step 1: Kirjuta kukkuvad testid**

```tsx
// juhtimata: wheel pildil muudab transform'i (regressioonikaitse — peab läbima ka ENNE muudatust)
// juhitud: view={{scale:2,x:0.1,y:0}} → transform sisaldab scale(2)
// juhitud: wheel → onViewChange kutsutud suurema scale'iga; transform jääb scale(2) (olek ei muutu ise)
// juhitud: rerender uue src-iga → transform jääb scale(2)
```

- [ ] **Step 2: Käivita** — `npx vitest run src/components/__tests__/ImageViewer.controlled.test.tsx` → juhtimata test PASS, juhitud FAIL.
- [ ] **Step 3: Teosta** — üks sisemine „praegune vaade" allikas (`view ?? olek`) ja üks kirjutaja (`onViewChange ?? setState`); x/y teisendus osa ↔ px konteineri mõõdu järgi.
- [ ] **Step 4: Käivita** — `npm test` → PASS (sh `workspacePageLoad.test.ts`); `npm run typecheck`, `npm run lint:ci` → PASS.
- [ ] **Step 5: Commit** — `feat(pildivaatur): valikuline väljast juhitud suurendus`

---

### Task 8: Eksemplari leht — raam, pildimaterjal, suur pilt

**Files:**
- Modify: `src/App.tsx` (marsruut `/work/:workId/exemplar/:exemplarId?`)
- Rewrite: `src/pages/ExemplarPage.tsx`
- Create: `src/components/exemplars/ExemplarMaterial.tsx`, `src/components/exemplars/ExemplarImageModal.tsx`
- Rewrite: `src/pages/__tests__/ExemplarPage.test.tsx`
- Modify: `src/locales/{et,en}/workspace.json`

**Interfaces:**
- Consumes: `ExemplarList` (Task 6), `exemplarSequences` (Task 5), `ExemplarImageEditor`, `AdaImportDialog`, `ImageViewer`, `useImageToken(workId, { refresh: true })`, `useUnsavedChangesGuard`.
- Produces:

```ts
// ExemplarMaterial: valitud võtme pildimaterjal ühes kaardis
interface ExemplarMaterialProps { workId: string; selected: string; data: WorkExemplarsResponse;
  manifest: ExemplarManifest | null;               // valitud eksemplari manifest (null = laeb / pole)
  canEdit: boolean; canCompare: boolean; imageToken: ImageToken | null; authToken: string | null;
  onOpen: (seqKey: string, index: number) => void; // suur pilt
  onCompare: (seqKey: string, index: number) => void;
  onManifest: (m: ExemplarManifest) => void; onImported: () => void }
// ExemplarImageModal: üks jada, üks pilt
interface ExemplarImageModalProps { title: string; sequence: Sequence; index: number;
  onIndex: (i: number) => void; onClose: () => void; onCompare?: () => void;
  sourceLine?: { text: string; href?: string } }
```

- URL-leping: `:exemplarId` = eksemplari id või `pages`; puudub → `defaultSelection(data)` (asendatakse `replace`-iga URL-i). `?image=<SeqItem.key>` = suur pilt avatud; `?page=N` = töölaua leht (tagasilink „Tagasi lehele N" → `/work/:id/N`, muidu „Tagasi teose juurde"). Kõrvutuse parameetrid lisab Task 9.
- Käitumine (spets „Leht", „Pildimaterjal"):
  - raam nagu `WorkManage`: tagasilink, ikoon (`Copy`, `bg-sky-100`) + „Eksemplarid" + teose pealkiri;
  - `ExemplarMaterial`: teose lehed (`ownPages` / `unassignedPages`) ja oma pildid samas kaardis, kaks alapealkirja ainult siis, kui mõlemad on; teose lehtedel „ainult vaatamiseks" + admin „Halda lehti →" (`/work/:id/manage`); üle 24 üksuse → esimesed 24 + „… N veel · Näita kõiki"; `loading="lazy"`; veerulaiuse liugur (3–8 veergu, nagu `WorkManage.tsx:1248`);
  - oma piltide päis (admin): „Laadi üles", „ADA import…", „Muuda pilte" (lülitab `ExemplarImageEditor`-i);
  - tühi: admin näeb ühte rida „pilte ei ole" + üleslaadimise nupud; avalik ei näe kaarti üldse;
  - `canCompare` = vähemalt kaks mittetühja jada (jada `pages` + iga piltidega eksemplar);
  - mustandi kaitse: `useUnsavedChangesGuard({ isDirty, onSave: () => listRef.current.saveDraft() })`;
  - laadimisviga → punane teade; `data.exemplars.length === 0` → kaart „Teosel ei ole eksemplare" (+ admin „Lisa eksemplar"); kui lisaks `page_count === 0`, pildimaterjali kaarti ei ole.
- i18n: `exemplarPage.title` („Eksemplarid"/„Exemplars"), `.backToPage` („Tagasi lehele {{n}}"/„Back to page {{n}}"), `.none` („Teosel ei ole eksemplare."/„This work has no exemplars."), `.viewOnly` („ainult vaatamiseks"/„view only"), `.managePages` („Halda lehti →"/„Manage pages →"), `.showAll` („Näita kõiki"/„Show all"), `.more` („… {{count}} veel"/„… {{count}} more"), `.noImages` („Pilte ei ole."/„No images."), `.editImages` („Muuda pilte"/„Edit images"), `.ownPages` („Teose lehed"/„Work pages"), `.ownImages` („Pildid"/„Images").

- [ ] **Step 1: Kirjuta kukkuvad testid** (jsdom; `getWorkExemplars`, `fetchExemplarImages` mock'itud):

```tsx
// 1. Review Focus 1: exemplars [], page_count 0 → tekst „Teosel ei ole eksemplare", ei viska, pildikaarti pole
// 2. hõre (3 eksemplari, pilte pole, alus märkimata, page_count 25), URL ilma id-ta →
//    valitud on rida „Teose lehed", all 24 pisipilti + „Näita kõiki"
// 3. piltidega eksemplar: võrgus 6 kaarti, paarimärk „⇄ lk 3" pildil, mille page on kehtiv tüvi;
//    pildil rippuva page-iga märki EI OLE
// 4. avalik + pildita eksemplar valitud: teksti „Pilte ei ole" EI OLE
// 5. klõps pisipildil → URL saab ?image=<key>, modaal on DOM-is, allikarida kuvatud
// 6. ?page=7 → tagasilink „Tagasi lehele 7" href /work/w1/7
// 7. alus valitud + erandleht olemas → aluse lehtede hulgas erandlehte EI OLE
```

- [ ] **Step 2: Käivita** — `npx vitest run src/pages/__tests__/ExemplarPage.test.tsx` → FAIL.
- [ ] **Step 3: Teosta** marsruut, leht, kaks komponenti, i18n.
- [ ] **Step 4: Käivita** — `npm test`, `npm run typecheck`, `npm run lint:ci` → PASS.
- [ ] **Step 5: Commit** — `feat(eksemplarid): eksemplari leht kirje ja pildimaterjaliga`

---

### Task 9: Kõrvutusmodaal

**Files:**
- Create: `src/components/exemplars/ExemplarCompareModal.tsx`
- Create: `src/components/exemplars/__tests__/ExemplarCompareModal.test.tsx`
- Modify: `src/pages/ExemplarPage.tsx` (avamine, URL, paari salvestus)
- Delete: `src/components/exemplars/ExemplarCompare.tsx`, `__tests__/ExemplarCompare.test.tsx`
- Modify: `src/locales/{et,en}/workspace.json` (eemalda kasutuseta `exemplarImages.compare.*` võtmed, mida enam ei viidata)

**Interfaces:**
- Consumes: `Sequence`, `SeqItem`, `stepLocked`, `PAGES_KEY` (Task 5); `ImageViewer` `view`/`onViewChange` (Task 7); `patchExemplarImages`, `ManifestConflictError`.
- Produces:

```ts
interface CompareSide { seq: string; index: number }          // seq = PAGES_KEY | eksemplari id
interface ExemplarCompareModalProps {
  title: string; sequences: Sequence[];                        // kõik jadad; tühi jada = menüüs hall
  seqLabel: (key: string) => { main: string; sub?: string };   // „Teose lehed" / „alus: Tartu TÜR"
  left: CompareSide; right: CompareSide;
  onChange: (l: CompareSide, r: CompareSide) => void;          // leht kirjutab URL-i
  canEdit: boolean; onSavePair?: (exemplarId: string, imageKey: string, stem: string) => Promise<void>;
  onClose: () => void }
```

- URL (leht): `?cmp=<vasak seq>:<index>~<parem seq>:<index>`; vigane või piirist väljas väärtus → kõrvutust ei avata (ei viska).
- Avamine lehelt: vasak = jada ja indeks, kust „Kõrvuta" vajutati; parem = kui vasak on pildijada → `PAGES_KEY` indeksiga (pildi `pairStem` → selle lehe indeks; muidu `?page` → N−1; muidu 0); kui vasak on `PAGES_KEY` → esimene mittetühi pildijada indeksiga 0.
- Käitumine (spets „Kõrvutus"; mockup `korvutus-v4.html`):
  - olek `locked` (vaikimisi `true`) ja `zoomTogether` (vaikimisi `true`) on komponendi sees;
  - lukus: ← / → ja kummagi poole ‹ › kutsuvad `stepLocked`; lahti: nupud liigutavad oma poolt, klaviatuur poolt, mille kohal on hiir (vaikimisi vasak);
  - poole päis: jada rippmenüü, üksuse silt, `pairStem` märk (sinine, kui teise poole avatud leht on sama tüvi; kollane „paar: lk N", kui erineb), `ownerNote` märk, „i / N";
  - jalus: lukus „praegu A2r ↔ lk 3"; admin + üks pool `PAGES_KEY` ja teine pildijada → „Salvesta paar {{image}} ↔ lk {{n}}" (peidetud, kui see paar on juba salvestatud);
  - `zoomTogether`: üks `ViewState` mõlemale `ImageViewer`-ile + päises liugur `scale` 1–8 (samm 0.1); linnukeseta kummalgi oma olek (juhtimata `ImageViewer`), liugur `disabled`;
  - pisipildiriba kummagi poole all; valitud üksus keritakse nähtavale.
- Paari salvestus lehel: `patchExemplarImages` uue `page`-ga; `ManifestConflictError` (ka Task 2 409) → `notify(t('exemplarImages.editor.conflict'), 'warning')`, manifest veast, `data` uuesti (`getWorkExemplars`); `git_committed === false` → `'warning'`.
- i18n: `compare.title` („Kõrvutus"/„Compare"), `.locked` („Liigub koos"/„Moving together"), `.unlocked` („Pooled eraldi · Lukusta"/„Sides separate · Lock"), `.zoomTogether` („suurendus koos"/„zoom together"), `.now` („praegu {{left}} ↔ {{right}}"/„now {{left}} ↔ {{right}}"), `.savePair` („Salvesta paar {{image}} ↔ lk {{n}}"/„Save pairing {{image}} ↔ p. {{n}}"), `.pairSaved` („paar salvestatud"/„pairing saved"), `.pairElsewhere` („paar: lk {{n}}"/„paired: p. {{n}}"), `.alignHint` („Sea pooled kohakuti ja lukusta."/„Align both sides, then lock."), `.pagesSeq` („Teose lehed"/„Work pages"), `.witnessIs` („alus: {{name}}"/„source: {{name}}"), `.witnessUnset` („alus märkimata"/„source not marked"), `.unknownOrigin` („päritolu teadmata"/„origin unknown"), `.noMaterial` („pilte ei ole"/„no images").

- [ ] **Step 1: Kirjuta kukkuvad testid** (jsdom):

```tsx
// 1. lukus, vasak 3/6, parem 3/8, klahv → : onChange({index:3},{index:3})  (0-põhised 2→3)
// 2. lukus, vasak viimasel (5/6-st 6/6), klahv → : onChange EI kutsuta
// 3. lukk lahti (klõps lukunupul), parema poole › : onChange muudab ainult paremat
// 4. „Salvesta paar" on nähtav: canEdit, vasak pildijada, parem PAGES_KEY, paar erineb salvestatust;
//    klõps → onSavePair(exemplarId, imageKey, stem)
// 5. „Salvesta paar" puudub: mõlemad pooled pildijadad; ja puudub, kui canEdit=false
// 6. erandleht paremal: päises on ownerNote tekst
// 7. menüüs tühi jada on disabled
// 8. zoomTogether linnuke maha → liugur disabled
```

Lehe testile (`ExemplarPage.test.tsx`) lisa: `?cmp=katkine` → modaali ei ole, leht renderdub.

- [ ] **Step 2: Käivita** → FAIL.
- [ ] **Step 3: Teosta** modaal, lehe ühendus, kustuta `ExemplarCompare`.
- [ ] **Step 4: Käivita** — `npm test`, `npm run typecheck`, `npm run lint:ci` → PASS.
- [ ] **Step 5: Commit** — `feat(eksemplarid): kõrvutusmodaal kahe jada läbilappamiseks`

---

### Task 10: Sissepääsud ja vana toimetamiskoha eemaldamine

**Files:**
- Modify: `src/components/exemplars/ExemplarCards.tsx`, `__tests__/ExemplarCards.test.tsx`
- Modify: `src/components/editor/WorkInfoPanel.tsx:322-334`
- Modify: `src/components/MetadataModal.tsx` (:240-292 kaitse-torustik, :803-813 sektsioon), `src/components/__tests__/MetadataModal.exemplars.test.tsx`
- Modify: `src/pages/WorkManage.tsx` (vahekaardi „Leheküljed" kaardi päise all, ~:1072)
- Delete: `src/components/exemplars/ExemplarsSection.tsx`, `__tests__/ExemplarsSection.test.tsx`, `src/components/exemplars/ExemplarImageStrip.tsx` (kui Task 8 järel kasutuseta — kontrolli `grep`-iga)
- Modify: `src/locales/{et,en}/workspace.json`

**Interfaces:**
- Consumes: `externalLinkLabel`, `hasWitness` (Task 5); marsruut Task 8-st.
- Käitumine (spets „Sissepääsud", „Haldus ja eksemplari leht"):
  - `ExemplarCards`: hoidja nimi on `Link` → `/work/:id/exemplar/:eid` (+ `?page=N`, kui töölaual on leht avatud — `useParams().pageNum`); välislink kiibina `externalLinkLabel(url) ↗`; pisipildiriba kaob, piltide arv tekstina (`exemplarImages.count`); `imageToken` prop eemaldatakse. `WorkInfoPanel`: pealkirja real paremal `Link` „Kõik andmed →" → `/work/:id/exemplar`.
  - `MetadataModal`: `ExemplarsSection` asemel rida „Eksemplarid · N" + `Link` „Muuda eksemplaride lehel →" (`/work/:id/exemplar`); eemalda `exemplarsRef`, `exemplarsDirtyRef`, `setExemplarsDirty`, `handleExemplarsChanged` ja nende sulgemiskaitse haru; modaali üldine salvestamata muudatuste kaitse jääb.
  - `WorkManage` „Leheküljed": rida „Skaneering: {hoidja} {kohaviit}" (`Link` → `/work/:id/exemplar/:witnessId`), kui `exemplars` hulgas on `text_witness`; muidu „alus märkimata — Märgi alus…" (`Link` → `/work/:id/exemplar/pages`); eksemplarideta teosel rida puudub.
- i18n: `info.exemplarsAll` („Kõik andmed →"/„All details →"), `metadata.exemplarsMoved` („Muuda eksemplaride lehel →"/„Edit on the exemplars page →"), `manage.scanOrigin` („Skaneering:"/„Scan:"), `manage.scanOriginUnset` („alus märkimata"/„source not marked"), `manage.scanOriginMark` („Märgi alus…"/„Mark source…").

- [ ] **Step 1: Uuenda/kirjuta kukkuvad testid**

```tsx
// ExemplarCards: hoidja nimi on link href="/work/w1/exemplar/a1b2c3"; url hdl.handle.net/10062/… → tekst „ADA";
//                data-testid="exemplar-image-strip" EI OLE; 6 pildiga eksemplaril tekst „6 pilti"
// MetadataModal.exemplars: data-testid="exemplars-section" EI OLE; link „Muuda eksemplaride lehel" href="/work/w1/exemplar";
//                modaali sulgemine ilma metaandmete muudatuseta EI ava UnsavedChangesDialog-i
// WorkManage (uus väike test või olemasoleva laiendus): text_witness eksemplar → „Skaneering:" + link;
//                ilma → „alus märkimata"
```

- [ ] **Step 2: Käivita** → FAIL.
- [ ] **Step 3: Teosta** neli muudatust, kustuta surnud failid, eemalda kasutuseta i18n võtmed MÕLEMAST keelest.
- [ ] **Step 4: Käivita** — `npm test`, `npm run typecheck`, `npm run lint:ci` → PASS; `grep -rn "ExemplarsSection\|ExemplarCompare\b\|ExemplarsProtoPage\|/exemplars/" src` → 0 vastet.
- [ ] **Step 5: Commit** — `feat(eksemplarid): sissepääsud eksemplari lehele; modaali toimetamisplokk eemaldatud`

---

### Task 11: Lõppkontroll ja dokumendid

**Files:**
- Modify: `CLAUDE.md` (invariantide jaotisse lühike lõik „Eksemplari leht" — üks kirjutuskoht `ExemplarList`, paari kehtivuse reegel, `page_numbers` täielik, koristus ei võta `work_lock`-i), `docs/decisions/README.md` (kui ADR-register loetleb täiendusi), `docs/README.md` (kui spetside kaart vajab rida)

- [ ] **Step 1: Väravad** — `npm run typecheck && npm test && npm run lint:ci && .venv/bin/pytest tests/` → kõik PASS.
- [ ] **Step 2: `npm run build`** → õnnestub; võrdle `dist/` põhichunk'i gzip-suurust `main`-iga (uus kood peab jääma laisalt laetavasse `ExemplarPage` chunk'i).
- [ ] **Step 3: Käsitsi kontroll tootmisandmetega** (tunnel + `npm run dev`, vt CLAUDE.md „UI kontroll tootmisandmetega"; **välja logituna** — sisselogituna läheb salvestus tootmisse): `/work/7zot7j/exemplar` (hõre: rida „Teose lehed" valitud, 25 lehte), `/work/6mwgby/exemplar` (piltidega eksemplar, kõrvutus avaneb, lukus lappamine, suurendus koos), `/work/7zot7j/exemplar/<Riga LUAB id>` (avalik + pildita: piltide kaarti pole). NB: täielik `page_numbers` tuleb serverist alles pärast backendi deploy'd — enne seda on teose lehtede võrk tootmise vastu tühi; märgi see kontrolli tulemusse, ära loe veaks.
- [ ] **Step 4: Dokumendid + commit** — `docs(eksemplarid): eksemplari lehe invariandid`
- [ ] **Step 5: Deploy järjekord PR-i kirjeldusse** (ära deploy ilma kasutaja loata): backend enne (`server_update.sh --no-cache`), siis frontend (`npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/`). Vana klient uue serveriga töötab (`page_numbers` on ülemhulk); uus klient vana serveriga näitaks tühja lehtede võrku.
