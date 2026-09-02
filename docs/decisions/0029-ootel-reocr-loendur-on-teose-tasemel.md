# ADR 0029 — Ootel re-OCR loendur ja hulgi-rakendus on teose, mitte partii tasemel

**Kuupäev:** 2026-09-02
**Staatus:** vastu võetud
**Asendab osaliselt:** ADR 0015 (§1 „Ulatus = viimase batch-töö lehed")

## Kontekst

Manage-vaate re-OCR plokk näitas kahte numbrit, mis mõõtsid eri asja ja valisid
selleks isegi eri batch-töö:

- **„OCR: 15/15 valmis, 0 veaga"** — `build_reocr_status.progress`. Tingimus oli
  `if is_active or progress is None: progress = summary`, seega ilma aktiivse
  tööta jäi kehtima **esimene nähtud** kirje. `_reocr_batch_jobs` on
  lisamisjärjestuses, mistõttu see oli teose **vanim** partii viimase 24 h
  jooksul (`REOCR_JOB_TTL`). Koodi kohal olev kommentaar lubas vastupidist
  („muidu viimast nähtut").
- **„33 re-OCR tulemust ootel"** — `applicableReocrPages`, mis kasutas
  `batch_ready`-d ehk teadlikult **uusimat** partiid (`max(started_at)`).

Kaks järjestikust partiid ühel teosel andsid seega ekraanile paari „15/15
valmis" + „33 ootel", mis ei ole omavahel taandatav. Reprodutseeritud
`build_reocr_status`-iga otse (vana partii 1 leht varjutas uue 2-lehelise).

Sügavam probleem on ADR 0015 §1 ise. Ulatus „viimane batch" valiti selleks, et
kellegi teise üksik ootel tulemus samas teoses jääks puutumata. Praktikas:

- Üksik re-OCR **kirjutab samuti `.ocr` faili** (`_write_ocr_file`, #217), seega
  ootel tulemus võib tekkida ilma ühegi partiita.
- Vanema partii ootel tulemused jäid loendurist ja hulgi-rakendusest välja
  **ilma et UI oleks seda öelnud** — need lihtsalt puudusid arvust.
- Varuvariant (`batch_known: false`) rakendas juba niikuinii kõik ootel
  tulemused ja see tee käivitus iga deploy järel, sest mälukirje ei ela restarti
  üle. Kitsam ulatus kehtis seega ainult juhuslikult, kuni järgmise restardini.

Kasutaja küsimus oli lihtne: mitu tulemust on **kokku** ootel.

## Otsus

1. **Ootel-loendur ja hulgi-rakendus katavad kõik selle teose ootel
   `.ocr`-tulemused.** `applicableReocrPages` võtab aluseks `ocr_ready`
   (kettal olev tõde), mitte partii lõike. `batch_ready` ja `batch_known` on
   `build_reocr_status`-ist eemaldatud, samuti `ApplicableReocr.isFallback`.

2. **Kinnitusdialoog nimetab ulatuse alati välja.** Varasem ainult
   varuvariandil kuvatud `confirmFallback` asendub püsiva reaga
   `confirmScope`: „Rakendatakse KÕIK selle teose ootel tulemused, ka need, mis
   ei pruugi olla sinu omad." Kaitse ei ole enam ulatuse kitsendamine, vaid see,
   et kasutaja näeb arvu ja ulatust enne kinnitamist (ADR 0015 §2 jääb kehtima:
   loend tuleb kliendilt, server ei arvuta „võta kõik" ise).

3. **`progress` on teose tasemel.** Aktiivse partii ajal näitab see seda
   partiid — elav edenemine ja katkestamisnupp (#217) vajavad ühe töö numbreid.
   Kui ükski partii ei ole aktiivne, on `progress` **kõigi selle teose
   batch-tööde koond** (`total`/`ready`/`errors` summeeritud, `active: false`).

## Tagajärjed

- Kaks numbrit ei saa enam eri partiist tulla. Pärast kahte partiid: „48/48
  valmis" + „48 ootel".
- **Numbrid võivad ikka lahkneda, aga arusaadavalt:** `progress` räägib sellest,
  mida OCR viimase 24 h jooksul tegi, ootel-loendur sellest, mis on veel vastu
  võtmata. Osa tulemuste rakendamine langetab ootel-arvu, `progress` jääb.
  Üksik re-OCR-i tulemus tõstab ootel-arvu, aga mitte `progress`-it (üksiktööd
  ei ole batch-kirjed).
- **„Rakenda kõik" võib nüüd kaasa võtta teise kasutaja ootel tulemuse.** Vana
  tekst jääb git-ajalukku ja on taastatav (ADR 0015 §3); dialoog ütleb ulatuse
  välja. Enne ei olnud see garantii niikuinii tõene — restardi järel rakendati
  kõik.
- Batch-kirje lehe väli `stem` jääb alles (kirjutatakse `_build_batch_pages`-is),
  aga seda ei loe enam keegi.

## Alternatiivid

**Ainult `progress` viia uusima partii peale** (algne diagnoos). Numbrid oleksid
klappinud kahe partii korral juhuslikult, aga „kokku ootel" jääks endiselt
nähtamatuks ja üksik re-OCR-i tulemus oleks ikka loendurist väljas. Lükati
tagasi.

**Loendur teose peale, rakendus partii peale.** Kasutaja näeks 48, nupp rakendaks
33 — täpselt see lahknevus, mille pärast ADR üldse kirjutati. Lükati tagasi.

## Viited

- `server/reocr_ops.py` — `build_reocr_status`
- `src/utils/reocrStatus.ts` — `applicableReocrPages`
- `src/pages/WorkManage.tsx` — progress-riba ja ootel-plokk
- Testid: `tests/test_reocr_batch.py`, `src/utils/__tests__/reocrStatus.test.ts`
- Seotud: ADR 0015 (hulgi-vastuvõtt), ADR 0018 (katkestamine)
