# Batch re-OCR tulemuste hulgi-vastuvõtmine

**Kuupäev:** 2026-08-07
**Staatus:** kinnitatud, teostamata

## Probleem

Manage-lehelt käivitatud batch re-OCR kirjutab iga lehe tulemuse `.ocr` failina teose
kausta (püsiv staging, `reocr_ops._write_ocr_file`). Manage-leht **näitab** ootel tulemusi
(`build_reocr_status.ocr_ready`), aga rakendada saab neid ainult ühekaupa: admin avab
lehe Workspace'is, `useReOcr.applyReOcr` asendab redaktori teksti, seejärel käsitsi
salvestus. 200-lehelise teose puhul on see 200 lehevahetust, 200 klikki ja 200 salvestust.

Vaja on manage-lehel üks tegevus, mis võtab terve batch'i tulemused korraga vastu.

## Ulatus

Sees:

- Hulgi-rakendus ja hulgi-tagasilükkamine **ühe teose piires** (manage-leht on teosepõhine).
- Ainult selle teose **viimase batch-töö** lehed — teiste kasutajate üksikud ootel
  tulemused samas teoses jäävad puutumata.
- Olemasoleva tekstiga lehed kirjutatakse üle (vana versioon jääb git-ajalukku).

Väljas:

- Lehtede valikupõhine osaline rakendamine (`PageActionBar`). Üksikjuhud lahendab
  endine Workspace'i voog.
- Tulemuse eelvaade / diff enne rakendamist.
- Muudatused üksiklehe re-OCR voole Workspace'is.

## Arhitektuur

### Backend

**Uus moodul `server/reocr_apply.py`.** `reocr_ops.py` on juba 805 rida; rakendus on
eraldi vastutus (staging → päris fail + versioonihaldus) kui OCR-serveri orkestreerimine.

```python
def apply_ocr_results(path: str, page_filenames: List[str], username: str) -> dict
def discard_ocr_results(path: str, page_filenames: List[str]) -> dict
```

`apply_ocr_results`:

1. Iga lehe kohta loeb `{stem}.ocr`, teeb `unicodedata.normalize('NFC', …)` ja
   `normalize_marginalia_tags(…)` — invariant: normaliseerimine käib KÕIGIS
   kirjutusteedes (`server/marginalia_normalize.py`).
2. Kirjutab `{stem}.txt`.
3. Teeb **ühe** `save_with_git(esimene_txt, sisu, username, message=…, additional_files=ülejäänud)`.
   `save_with_git` toetab juba mitut faili ühes commitis (`git_ops.py:343`).
   Commiti sõnum: `Batch re-OCR rakendatud: {N} lehte`.
4. Kustutab `.ocr` failid ainult nendelt lehtedelt, mille kirjutamine õnnestus.
5. Tagastab `{"applied": [...], "failed": [{"filename": ..., "error": ...}], "commit_hash": ..., "git_committed": bool}`.

Lehe `.json` (staatus, sildid, kommentaarid) jääb **puutumata** — re-OCR asendab
ainult transkriptsiooni teksti.

`discard_ocr_results` kustutab ainult `.ocr` failid. Git-commiti ei tehta (staging-failid
ei ole versioonihalduses) ja Meili sünki ei toimu (sisu ei muutunud).

**Uued endpointid `server/routers/reocr.py`-s** (admin-only, nagu ülejäänud re-OCR):

```
POST /admin/work/{work_id}/reocr-apply     body: {"page_filenames": [...]}
POST /admin/work/{work_id}/reocr-discard   body: {"page_filenames": [...]}
```

Failinimed tulevad **kliendilt**, mitte serveri „võta kõik" loogikast. Server rakendab
täpselt seda, mida UI kasutajale näitas; muidu tekib aken, kus vahepeal valminud võõras
`.ocr` satub kaasa.

Valideerimine serveris (klienti ei usaldata):

- `page_filenames` peab olema mittetühi list → muidu 400.
- Iga nimi peab olema bare failinimi (`fn == os.path.basename(fn)`) → muidu 400.
  Sama kaitse nagu `_validate_batch_pages`.
- Puuduv `.ocr` → leht läheb `failed`-i, mitte 500.

Blokeeriv I/O `run_in_threadpool`-i (ADR 0002 — route loeb body't, seega `async def` +
threadpool). Meili sünk `background_tasks.add_task(sync_work_to_meilisearch_async, slug)`
— **üks kord teose kohta**, mitte lehe kohta.

Aktiivne batch EI blokeeri rakendamist: valmis lehed saab vastu võtta, ülejäänud
jooksevad edasi.

### Milliseid lehti pakutakse

`build_reocr_status` (`server/reocr_ops.py:431`) saab kaks uut välja:

| Väli | Sisu |
|---|---|
| `batch_ready: List[str]` | selle teose **viimase** batch-töö (suurim `started_at`) lehtede stem'id, mille `.ocr` on kettal olemas |
| `batch_known: bool` | kas batch-kirje üldse leidus |

Olemasolev `ocr_ready` jääb alles (kõik kettal olevad `.ocr`) — sellest tuletatakse
varuvariant ja üksiklehtede märgised.

**Varuvariant.** Batch-kirje elab mälus 24 h (`REOCR_JOB_TTL`) ja mapping-fail
(`state/reocr_batch_maps/{job_id}.json`) kustutatakse batch'i lõppedes
(`reocr_ops.py:332`). Seega batch-kirje **ei ela üle backendi restardi** — pärast
`server_update.sh --no-cache` deploy'd oleks `batch_known === false`, kuigi `.ocr` failid
on alles. Sel juhul pakub UI nuppu „Rakenda kõik ootel (M)" ja kinnitusdialoog ütleb
selgelt, et batch'i info ei ole enam teada ja rakendatakse **kõik** selle teose ootel
tulemused. Ilma varuvariandita jääksid pärast deploy'd tulemused hulgi-rakenduseta.

### Frontend

Tegevused lähevad WorkManage'i **olemasoleva re-OCR edenemisriba juurde**
(`WorkManage.tsx:688`), mitte `PageActionBar`-i — see riba on valikupõhine, siin on
tegevus teose tasemel ja peab olema nähtav ka ilma valikuta.

```
12 tulemust ootel   [Rakenda kõik]  [Lükka kõik tagasi]
```

Kinnitus avaneb inline, sama muster nagu `bulkDeleteConfirm` PageActionBar'is. Kinnituse
tekst nimetab arvud:

> Rakendan 12 lehe re-OCR tulemused. 3 lehel on juba tekst — see kirjutatakse üle,
> vana versioon jääb git-ajalukku.

Pärast õnnestumist: lehtede uuestilaadimine + `setReocrPollNonce((n) => n + 1)`,
kokkuvõte „12 rakendatud" (või „10 rakendatud, 2 ebaõnnestus").

**Puhas loogika `src/utils/reocrStatus.ts`-i**, et see oleks testitav ilma renderdamiseta:

```ts
export interface ApplicableReocr {
  filenames: string[];   // täisfailinimed (.jpg), mitte stem'id
  withTextCount: number; // mitmel neist on juba tekst → ülekirjutuse hoiatus
  isFallback: boolean;   // batch_known === false → laiendatud ulatus + teistsugune tekst
}
export function applicableReocrPages(
  pages: { filename: string; has_text: boolean }[],
  status: ReocrStatusResponse | null,
): ApplicableReocr
```

`ReocrStatusResponse` tüüp laieneb `batch_ready` ja `batch_known` väljadega.

`src/services/workApi.ts`: `applyReocrResults(workId, token, filenames)` ja
`discardReocrResults(workId, token, filenames)`.

**i18n:** uued võtmed **mõlemasse keelde korraga** (ADR 0011 — `fallbackLng` on väljas,
puuduv võti katkestab build'i). Nimeruum `workspace`, prefiks `manage.reocr.`:
`applyAll`, `discardAll`, `pendingCount`, `confirmApply`, `confirmDiscard`,
`overwriteWarning`, `fallbackWarning`, `applied`, `appliedPartial`, `applyError`.

## Vead

- **Ühe lehe tõrge ei katkesta tervikut.** Õnnestunud lehed kirjutatakse ja commititakse;
  vastus kannab `failed` loendit; UI näitab „10 rakendatud, 2 ebaõnnestus".
- **Git-commiti tõrge:** tekst on kettal, vastus kannab `git_committed: false` +
  hoiatuse, nagu `/save` (`editing.py:135`). `.ocr` failid kustutatakse ikka —
  tekst on päris failis olemas.
- **Kõik lehed ebaõnnestusid:** git-commiti ei tehta, Meili sünki ei toimu, vastus
  `applied: []`.
- **Teos ei leitud:** 404.

## Testid

**pytest `tests/test_reocr_apply.py`:**

- `.ocr` → `.txt`, sisu läbib marginaalia-normaliseerimise
- N faili = üks git-commit (commitide arv enne/pärast erineb 1 võrra)
- õnnestunud lehtede `.ocr` kustutatud
- path traversal (`../../state/users.json`) → 400, midagi ei kirjutata
- puuduv `.ocr` → `failed`-is, teised lehed rakenduvad ikka
- tühi `page_filenames` → 400
- `discard` kustutab `.ocr` ega puutu `.txt`-d

**vitest `src/utils/__tests__/reocrStatus.test.ts` (laiendus):**

- `applicableReocrPages` tagastab ainult `batch_ready` lehed kui `batch_known === true`
- võõras ootel `.ocr` (`ocr_ready`-s, aga mitte `batch_ready`-s) jääb välja
- `batch_known === false` → varuvariant: kõik `ocr_ready`, `isFallback === true`
- `withTextCount` loeb ainult rakendatavaid lehti
- `status === null` → tühi tulemus

## Otsused ja põhjendused

| Otsus | Põhjendus |
|---|---|
| Backend hulgi-endpoint, mitte kliendipoolne `/save` tsükkel | 200 lehte = 1 commit + 1 Meili sünk, mitte 200 + 200; poole peal katkedes pole pooleldi rakendatud seisu |
| Failinimed kliendilt | server rakendab täpselt seda, mida UI näitas; väldib võõra vahepeal valminud `.ocr` kaasahaaramist |
| Ainult viimase batch'i lehed | teiste kasutajate üksikud ootel tulemused samas teoses jäävad puutumata |
| Ülekirjutamine ilma valikuta | etteaimatav; vana tekst on git-ajaloos ja taastatav Workspace'i „Ajalugu" tabist |
| Lehe `.json` puutumata | re-OCR asendab transkriptsiooni, mitte staatust/silte/kommentaare |
| Eraldi moodul `reocr_apply.py` | `reocr_ops.py` on 805 rida; rakendus on eraldi vastutus |
| Tegevus edenemisriba juures, mitte `PageActionBar`-is | `PageActionBar` on valikupõhine; see tegevus on teose tasemel |
