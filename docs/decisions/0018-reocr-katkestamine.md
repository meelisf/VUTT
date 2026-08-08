# ADR 0018 — Re-OCR töö katkestamine

**Kuupäev:** 2026-08-08
**Staatus:** vastu võetud
**Issue:** #217 · **Spekk:** `docs/superpowers/specs/2026-08-08-reocr-katkestamine-design.md`

## Kontekst

Käimasolevat re-OCR tööd ei saanud katkestada. Valesti käivitatud töö puhul jäi ainsaks
võimaluseks oodata `REOCR_ABSOLUTE_TIMEOUT` = 12 h täitumist; vahepeal andis
`get_active_batch_for_work()` uuele batch'ile 409 ja teos oli lukus.

Intsident 2026-08-07: batch käivitati käsikirja-mudelil topeltlehtedega. Käsitsi
puhastamine nõudis backendi seiskamist ja `reocr_active.json` muutmist — tootmise katkestust.

## Otsus

`DELETE /admin/reocr/{job_id}` katkestab töö. **Semantika: tööd ei olnud.**

## Invariandid

- **Osalisi tulemusi ei säilitata.** OCR jookseb taustal — katkestamine ei võida aega, vaid
  annab suvalise algusprefiksi valmis lehtedest. Väiksem maht tuleb valida käivitamisel ja
  lehti hiljem juurde lisada.
- **`.ocr` omand tuleb `produced_pages`-ist, mitte plaanist.** Batch-mapping ütleb, mida
  töö PLAANIS teha; `produced_pages` ütleb, mida ta PÄRISELT kirjutas. Kustutamine plaani
  järgi hävitaks varasema ootel tulemuse lehel, mida katkestatud töö ei jõudnud puutuda.
- **Ülekirjutamine varundatakse.** `_write_ocr_file` nihutab olemasoleva `.ocr` faili
  `state/reocr_backups/{job_id}/` alla; katkestamine taastab, normaalne lõpp kustutab.
  **Varukoopia EI TOHI minna teose kausta:** `data/.gitignore` ignoreerib `*.ocr`, aga
  varukoopia nimi ei vastaks mustrile ja ilmuks `git status`-isse.
- **`cancelling` on persisteeritud vaheolek.** `_ACTIVE_STATUSES` sisaldab seda, muidu
  kaoks pooleli jäänud katkestamine `reocr_active.json`-ist ja muutuks restardi järel
  taas aktiivseks tööks.
- **Terminalüleminekud on vastastikku välistavad.** `processing → done` ja
  `processing → cancelling` käivad sama luku all CAS-ina; katkestamise võidu järel ei tohi
  ükski worker enam `ready`/`done`/`error` kirjutada.
- **Workerid vaigistatakse ENNE koristust, aga erineval viisil.** Üleslaadimine on
  töö-põhine lõim → `Event` + `join`. Poll on **jagatud singleton** (üks iteratsioon iga
  10 s kõigi tööde üle) → teda ei saa join'ida, teda vaigistab sama CAS. Kui `join` aegub,
  koristust EI TEHTA: töö jääb `cancelling` olekusse ja jääk kaugserveris on parem kui
  võistlus.
- **`200` garanteerib ainult VUTT-i poole.** Pollimist ei ole, teose lukk on vaba, tulemust
  ei rakendata. Kui LOSSi koristus ebaõnnestus, võib kaugserveris jääk edasi eksisteerida —
  logikirjes `remote_cleanup: "failed"`.
- **`cancelled` on LOGI tasandi staatus.** Manage-riba põhineb aktiivsel tööl ja kaob;
  püsiv ajalugu elab Review-vaates (`reocr_log.json`).

## LOSSi peatamine

Per-töö peatamise mehhanismi OCR-serveris ei ole; ainus tõeline signaal (SIGTERM →
`shutdown_requested`) peataks terve teenuse. **Piltide kustutamine on peatamismehhanism**:
`process_batch` avab pildid enne mudeli kutsumist ja väljub, kui ükski ei avane, seega
kustutamise järel maksab iga järelejäänud batch neli ebaõnnestunud `open()` kutset.

**Kõva piir: `BATCH_SIZE = 4`.** `main_loop` teeb `rglob` üks kord tsükli kohta, seega kuni
üks lennusolev batch jõuab lõpuni. OCR-serverit ei muudeta (ADR 0017 põhimõte).

Sünkroniseerimine on ühesuunaline: VUTT → LOSS failipõhine, LOSS → VUTT staatust ei ole.
VUTT ei oota katkestamisel kinnitust — kinnitust ei ole kellelt küsida.

## Tagajärjed

- Teos vabaneb kohe, mitte 12 h pärast.
- Kuni 4 lehte võib LOSSis lõpuni joosta; nende `.txt` kaob koos kataloogiga.
- Katkestamine ei ole HTTP mõttes idempotentne: korduv `DELETE` annab 404, sest töö on
  aktiivregistrist eemaldatud.
- `_write_ocr_file` võtab nüüd `job_id` argumendi — kutsekohti on neli, sh
  `reocr_recovery.py` orbude taaste.
