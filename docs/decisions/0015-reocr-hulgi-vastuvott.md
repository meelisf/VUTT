# 0015 — Batch re-OCR tulemused võetakse vastu hulgi, ühe commitina

**Staatus:** kehtib

## Kontekst

Batch re-OCR kirjutab iga lehe tulemuse `.ocr` failina teose kausta (püsiv
staging, `reocr_ops._write_ocr_file`). Manage-leht **näitas** ootel tulemusi
(`build_reocr_status.ocr_ready`), aga rakendada sai neid ainult ühekaupa: admin
avab lehe Workspace'is, `useReOcr.applyReOcr` asendab redaktori teksti, siis
käsitsi salvestus. 200-lehelise teose puhul on see 200 lehevahetust, 200 klikki
ja 200 salvestust — töö, mida keegi tegelikult lõpuni ei tee.

## Otsus

Manage-lehele tuleb teosetasemel tegevus „Rakenda kõik" / „Lükka kõik tagasi".
Rakendus toimub backendis (`server/reocr_apply.py`), mitte kliendipoolse
`/save` tsüklina.

1. **Ulatus = selle teose viimase batch-töö lehed.** `build_reocr_status`
   tagastab `batch_ready` (viimase batchi lehtede stem'id, mille `.ocr` on
   kettal) ja `batch_known`. Nii jääb kellegi teise üksik ootel tulemus samas
   teoses puutumata.

2. **Rakendatavate lehtede loend tuleb kliendilt.** Server valideerib bare
   failinime (path traversal) ja rakendab täpselt selle loendi. Server ei
   arvuta ise „võta kõik" — muidu tekiks aken, kus vahepeal valminud võõras
   `.ocr` satub kaasa, ilma et kasutaja oleks seda kinnitusdialoogis näinud.

3. **Olemasolev tekst kirjutatakse üle.** Vana versioon jääb git-ajalukku ja on
   taastatav Workspace'i „Ajalugu" tabist. Kinnitusdialoog nimetab eraldi,
   mitmel lehel tekst juba on.

4. **Lehe `.json` jääb puutumata.** Re-OCR asendab transkriptsiooni teksti,
   mitte staatust, silte ega kommentaare.

## Tagajärjed

- **Hulgi-rakendus on ÜKS git-commit ja ÜKS Meilisearchi sünk kogu partii
  kohta.** `save_with_git` toetab mitut faili ühes commitis
  (`additional_files`). Lehe kaupa commitimine ujutaks ajaloo üle (200 commiti
  ühe tegevuse kohta) ja lehe kaupa sünkimine tähendaks 200 täisindekseerimist
  — vt ADR 0013.

- **`.ocr` kustutatakse ka siis, kui git-commit ebaõnnestus.** `save_with_git`
  kirjutab failid enne commiti-katset, seega tekst on päris failis olemas.
  Staging'u alles jätmine tekitaks igavesti korduva „ootel" seisu. Vastus
  kannab `git_committed: false` ja UI näitab hoiatust.

- **Ühe lehe tõrge ei katkesta ülejäänuid.** Vigased lehed lähevad `failed`
  loendisse, õnnestunud kirjutatakse ja commititakse ikka.

- **Batch-kirje EI ela üle backendi restardi.** Mapping-fail
  (`state/reocr_batch_maps/{job_id}.json`) kustutatakse batch'i lõppedes ja
  mälukirje kaob `server_update.sh --no-cache` deploy'ga. Seetõttu on
  `batch_known: false` varuvariant **tahtlik, mitte viga**: UI pakub siis
  „Rakenda kõik ootel" ja kinnitusdialoog ütleb selgelt, et rakendatakse kõik
  selle teose ootel tulemused. Ilma selleta jääksid pärast deploy'd valmis
  tulemused hulgi-rakenduseta.

- **Batch-kirje lehtedel ei pruugi olla `stem` välja.** `reocr_active.json`-ist
  elustatud ja vanemad kirjed sisaldavad ainult `page_filename`-i —
  `build_reocr_status` peab selle tuletama, muidu KeyError.

- **Leht, millel käib parasjagu uus OCR, jäetakse hulgi-rakendusest välja**
  (`applicableReocrPages`). Vana tulemuse rakendamine poolelioleva töö ajal
  oleks kasutajale segane.

## Alternatiivid

**Kliendipoolne `/save` tsükkel** — ei nõua backend-tööd, aga 200 lehte
tähendaks 200 päringut, 200 git-commiti ja 200 Meili sünki, ning poole peal
katkedes jääks seis pooleldi rakendatuks. Lükati tagasi.

## Viited

- Spets: `docs/superpowers/specs/2026-08-07-reocr-hulgi-vastuvott-design.md`
- `server/reocr_apply.py` — `apply_ocr_results`, `discard_ocr_results`
- `server/routers/reocr.py` — `/admin/work/{work_id}/reocr-apply`, `.../reocr-discard`
- `src/utils/reocrStatus.ts` — `applicableReocrPages`
- Testid: `tests/test_reocr_apply.py`, `tests/test_reocr_router.py`,
  `tests/test_reocr_batch.py`, `src/utils/__tests__/reocrStatus.test.ts`
- Seotud: ADR 0013 (Meili sünk teose kaupa), ADR 0003/0009 (marginaalia
  normaliseerimine kõigis kirjutusteedes)
