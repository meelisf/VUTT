# ADR 0025 — Ebaõnnestunud leht märgitakse `.err` failiga

**Kuupäev:** 2026-08-24
**Staatus:** vastu võetud
**Issue:** #250 · **Kontekst:** #132 (miks mitte HTTP API)

## Kontekst

OCR-server ei jätnud ebaõnnestunud lehest failisüsteemi ühtki jälge. `process_batch`
logis avanematu pildi ja jättis vahele; `model.generate` kukkumine (nt CUDA OOM)
propageerus `main_loop`-ist mooduli tasemele, kus on `sys.exit(1)` — **terve teenus
suri** ja kõigi kasutajate järjekord katkes.

VUTT näeb kaugserverist ainult „`.txt` on olemas / ei ole". Seega oli vigane leht
tellija jaoks eristamatu aeglasest lehest: töö jäi `processing` olekusse kuni
`REOCR_ABSOLUTE_TIMEOUT` = 12 h täitumiseni, upload ei jõudnud kunagi `done`-i.

Kaalusime #132 all HTTP API-t OCR-serverisse. Arutelu järeldus: **puuduv nähtavus ei ole
transpordi probleem** — API-l poleks ka midagi vigade kohta öelda, sest keegi ei salvesta
neid. Vea-signaal on API-st sõltumatu ja API tuleku korral edasi kasutatav.

## Otsus

OCR-server kirjutab ebaõnnestunud lehe kõrvale **`{tüvi}.err`** faili, mille sisu on üks
rida: `ErandiTüüp: sõnum`. Fail elab `.txt`-ga samas kataloogis ja liigub sama kanalit
pidi — VUTT loeb teda olemasoleva `listdir`/`stat` kutsega, uut transporti ei tule.

Pretsedent on olemas: vigane PDF liigutatakse `VIGASED/` kausta ja `thumbs.py` kontrollib
seda juba. `.err` on sama muster ühe taseme võrra allpool (leht, mitte fail).

## Invariandid

- **`.err` on LÕPLIK.** `main_loop` kandidaadi-filter on „ei `.txt` **ega** `.err`".
  Ilma selle tingimuseta võtaks teenus vigase lehe igal tsüklil uuesti ette, põletaks
  GPU-d ja kirjutaks märgendi lõputult üle. **Kordus = tellija kustutab `.err` faili**
  (uus re-OCR laadib pildi niikuinii uuesti üles).
- **Ükski kirjutus ei tohi teenust tappa.** `generate`/`batch_decode` on try/except sees
  ja kukkumine annab `.err` KÕIGILE selle batchi lehtedele; üksiku `.txt` kirjutuse viga
  (kadunud kataloog, ADR 0024) ei katkesta tsüklit; `.err` kirjutus ise on best-effort.
- **Tühi väljund EI OLE viga.** Tühi lehekülg on legitiimne tulemus (OCR-serveril on
  selleks `[tühi lehekülg]` märgend) ja jääb tühjaks `.txt`-ks.
- **Vigane leht on EDENEMINE.** Batch-töö `last_progress_at` ja upload'i stall-indikaator
  peavad lugema lahendatud lehti (`valmis + ebaõnnestunud`), mitte ainult valmis lehti —
  muidu annab seisaku-tuvastus valehäire.
- **Lahendatud leht ei jää kaugserverisse.** Iga lugemistee kustutab `.err` + pildi pärast
  vea kirjapanekut, nagu õnnestumise tee kustutab `.txt` + pildi.
- **Orbude taastes on `.err` „lahendatud".** `reocr_recovery` loeb `.err`-i logisse
  veakirjena; ilma selleta jääks leht igavesti `unresolved`-iks, mapping ei kustuks ja
  kaust ei koristuks.

## Tagajärjed

- Vigane leht läheb `error`-i sekunditega, mitte 12 h pärast; põhjus on nähtav Review-s
  ja `reocr_log.json`-is.
- Upload jõuab `done`-i ka siis, kui mõni leht kukkus; import keeldub selge tekstiga
  („OCR ebaõnnestus lehtedel 3, 7 — kustuta need lehed või proovi uuesti").
- CUDA OOM ei võta enam teenust maha — üks halb batch maksab neli `.err`-i, mitte
  taaskäivituse + mudeli laadimise kõigi kasutajate arvelt.
- OCR-serverit muudeti teadlikult. ADR 0017 „VUTT ei muuda OCR-serverit" kehtib edasi
  **töötlemisloogika** kohta; vea-signaal on liidesekokkulepe, mis kuulub mõlemale.

## Kontroll

Tehtud tootmises 2026-08-24: 0-baidine `.jpg` staging'usse → `.err` tekkis
(`UnidentifiedImageError`), teenuse `ActiveEnterTimestamp` ei muutunud, kordusproovi ei
tulnud (märgend kirjutati täpselt üks kord).
