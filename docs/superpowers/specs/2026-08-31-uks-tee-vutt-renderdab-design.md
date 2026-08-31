# Üks tee: VUTT renderdab, LOSS ainult OCR-ib

**Kuupäev:** 2026-08-31
**Seotud:** #278, PR #277, ADR 0017, ADR 0026

## Probleem

Upload'i 3. sammust 4. sammu jõudes ei näe kasutaja minuteid mitte midagi. Mõõdetud
tootmises 2026-08-31, kaks eri teekonda, kaks eri põhjust:

**Poolitustega tee** (`0a2k4y`, 178 → 192 lk):

| Kell | Sündmus |
|---|---|
| 10:55:54 | apply algab — VUTT renderdab 300 DPI ja avaldab lehthaaval |
| 11:04:43 | apply valmis (**8 min 49 s**) |
| 11:04:48–11:06:12 | VUTT tõmbab needsamad 192 pilti SFTP-ga tagasi pisipiltideks |

Kogu apply ajal on staatus `applying`, mis kuulub `PREPRESS_IDLE_STATUSES`-i, ja
`poll_and_sync_thumbs` väljub esimese `if`-i pealt. VUTT pani 9 minutit lehti
kaugkataloogi ükshaaval ja keeldus samal ajal sinnasamasse vaatamast.

**Poolitusteta tee** (`6yoog3`, 35 lk): originaal-PDF läheb LOSSi, kus
`expand_pdf` teeb `convert_from_path` kogu faili peale ja kirjutab JPG-d kettale
alles pärast seda — 1 min 52 s tühja kataloogi, skaleerub lineaarselt.

Ühine muster: kummalgi teel ei ole midagi vaadata enne, kui terve partii on
valmis. Mõlemal juhul lisandub sellele see, et OCR ei saa alata enne renderduse
lõppu — poolitusteta teel. Poolitustega teel **OCR juba töötab õigesti**:
`publish_atomic` avaldab lehthaaval, LOSSi `main_loop` skannib iga 5 s, ja
apply lõppedes oli 192-st juba ~97 lehte transkribeeritud. Katki oli ainult
VUTT-i enda nähtavus.

## Otsus

Üks tee. **VUTT rasteriseerib alati**, lehthaaval, ja avaldab iga lehe kohe
(`publish_atomic`). LOSS ainult OCR-ib. Ülevaatuse ekraan täitub apply ajal ja
pollib samal ajal ka valmimise staatust.

See pöörab ümber ADR 0017 / ADR 0026 tahtliku valiku, et 300 DPI on opt-in
(„triviaalne tähendab siin ainult *meie pool ei pea ühtki pikslit renderdama*").
Otsus on teadlik ja hind on teada — vt allpool.

## Miks — numbrid

Mõõdetud: VUTT 2,75 s/lk (renderdus + lõikamine + SFTP, 192 lk / 529 s);
LOSS `expand_pdf` 3,2 s/lk (35 lk / 112 s). Ehk **VUTT ei ole aeglasem** — ta
teeb sama töö sama suurusjärgu ajaga, aga voona ja mitte kõike-või-mitte-midagi.

143-leheline poolitusteta teos:

| | täna | ühe tee peal |
|---|---|---|
| esimene JPG kaugkataloogis | ~8 min (upload + `expand_pdf`) | **~3 s** |
| OCR algab | ~8 min | **~5 s** |
| esimene pisipilt ekraanil | ~8 min | **~3 s + üks poll (≤5 s)** |
| kõik lehed avaldatud | ~8 min | ~6,5 min |
| VUTT-i CPU | 0 pikslit | ~6,5 min üht tuuma |

`pdf_subset.py` docstring vaidleb praegu vastu („alamhulga ehitamine jätab
rasterdamise OCR-serveri poolele, ~36 s vs ~6 min"). See võrdlus loeb ainult
rasterduse maksumust ega arvesta, et LOSSi pool **blokeerib**: 36 s alamhulga
ehitust järgneb ikkagi ~7,6 min `expand_pdf`-i, mille jooksul OCR seisab.
Otsast otsani on üks tee kiirem, mitte ainult tajus.

## Mis muutub — backend

### 1. Marsruutimine

`routers/upload.py:admin_prepress_apply` kaotab haru. Iga plaan läheb
`prepress_apply.start_apply` kaudu; `is_trivial_plan` jääb alles ainult
kokkuvõtete ja UI teadete jaoks.

Uut renderdusloogikat ei ole vaja: `prepress_plan.page_cuts` annab
`nosplit`-lehele juba ühe terve lehe lõike ja `is_excluded` on `_transfer_pages`
tsüklis kaetud.

### 2. Pisipilt sünnib apply's

`prepress_apply._transfer_pages` kirjutab pärast `publish_atomic`-ut ja **enne**
`os.unlink(cut)`-i lokaalse pisipildi `uploads/{id}/thumbs/{out_index:03d}.jpg`
(sama 400×600 / quality 85, mis `thumbs._create_thumbnail`). Pikslid on juba
kettal — null SFTP-d, null lisarenderdust.

Ühine pisipildi kirjutamine läheb omaenda funktsiooni (nt
`thumbs.write_thumbnail(src_path, thumb_path)`), mida kutsuvad mõlemad pooled;
`_create_thumbnail` jääb selle õhukeseks SFTP-ümbriseks.

### 3. Poll töötab apply ajal

`applying` eemaldatakse `thumbs.poll_and_sync_thumbs` varajase väljumise
loendist. Tavaline tsükkel jookseb: `listdir` → `.txt`/`.err` → staatus.
JPG-de allalaadimise silmus **ei tee midagi**, sest `existing_thumbs` sisaldab
neid juba (samm 2). See on ka põhjus, miks poll apply ajal ohutu on: ilma
sammuta 2 tõmbaks ta võrgu kaudu tagasi täpselt need failid, mille VUTT just
üles laadis.

Kõrvalsaadus: paralleelsete pollide duplikaat-allalaadimine kaob (mõõdetud:
iga pisipilt tõmmati 5×, 477 allalaadimist 192 faili kohta).

### 4. `PREPRESS_IDLE_STATUSES` läheb kaheks

Konstant teenib praegu **kahte eri otstarvet** ja need lahknevad nüüd:

```python
PREPRESS_IDLE_STATUSES = ("awaiting_split", "prepping", "applying")
```

- `thumbs.poll_and_sync_thumbs` — „SFTP-d pole vaja" → `applying` **lahkub**
- `thumbs._planned_pages` — „`expected_pages` on veel LÄHTE-lehtede arv" →
  `applying` **peab jääma**

`expected_pages` uuendatakse väljundi arvule alles `apply_and_transfer` lõpus
(`set_upload_state(status="processing", expected_pages=sent)`). Kui `applying`
kaob mõlemast, näitaks ruudustik apply ajal 178 kohatäidet 192 asemel.

Seega: `PREPRESS_IDLE_STATUSES` jääb `_planned_pages` tarbeks nagu on, ja
pollile tuleb oma, kitsam loend (nt `SFTP_IDLE_STATUSES` ilma `applying`-uta).
Mõlema juurde kommentaar, kumb kumba teenib.

### 5. Pildikausta lehed: kopeeri, ära re-enkodeeri

`ImageDirPageSource.render_full` teeb `im.convert("RGB").save(..., quality=95)`
— see on JPEG **ümberkodeerimine**. Tänane otsetee (`_transfer_images_thread`)
saadab originaalbaidid. Et ühendamine kvaliteeti ei kaotaks: kui allikas on
pildikaust ja `page_cuts` annab lehele täpselt ühe, kogu laiust katva lõike,
kopeeritakse failibaidid otse, ilma PIL-i läbimata. Iga muu juhtum (poolitus,
serva lõikamine) läheb endiselt läbi PIL-i, nagu praegugi.

## Mis muutub — frontend

Vähe. `REVIEW_STATUSES` sisaldab juba `applying`-ut, seega 4. samm on apply
ajal juba nähtaval — ta lihtsalt ei saanud senini pollilt midagi.

Kaks täpsustust:

- Apply ajal on faas „renderdan ja saadan", mitte „OCR töötleb". `prepress`
  kannab juba `applied_done` loendurit, mida keegi ei näita. Teate tekst
  4. sammu päises peab `applying` ajal seda kasutama.
- `ocrStartedAt` seatakse praegu 4. sammu avanemisel, seega apply aeg läheb
  OCR-i timeout'i arvestusse. Kui apply on nüüd nähtav faas, tuleb timeout'i
  alguspunkt nihutada `processing`-usse.

## Mis läheb pensionile

- `store_source.transfer_stored_source` + `_transfer_pdf_thread` +
  `_transfer_images_thread`
- `upload/pdf_subset.py` tervikuna
- `remote_staging_path` kasutus upload'i teel (LOSS ei saa enam PDF-e)

Alles jäävad `store_source.store_pdf` / `store_image_page` — lähtefaili
salvestamine VUTT-i poolele ei muutu.

**LOSSi `expand_pdf` jääb alles.** Ta ei teeninda enam ühtki VUTT-i upload'i,
aga käsitsi kausta pandud PDF on endiselt toetatud töövoog. #278 suletakse
VUTT-i osas, mitte LOSSi skripti muutmisega.

`thumbs.py` `VIGASED` kontroll muutub upload'ide jaoks kättesaamatuks (vigase
PDF-i avastab nüüd VUTT ise, juba 100 DPI eelvaate ajal). Jääb esialgu alles;
eemaldamine on eraldi koristus, kui üks tee on tootmises end tõestanud.

## Riskid

**Veebiserver rasteriseerib iga upload'i puhul.** Hind on mõõdetud (~2,75 s/lk)
ja aktsepteeritud praeguse mahu juures. Kaitsed on olemas ja jäävad:
`nice 10` (`page_source.NICE_LEVEL`) ja `RENDER_SEMAPHORE(1)`.

**Kõik upload'id konkureerivad nüüd sama semafori pärast.** Täna triviaalne
plaan ei renderdanud üldse; edaspidi seisab teine samaaegne upload esimese
taga. Praeguse mahu juures vastuvõetav, aga see on uus omadus, mitte
olemasolev. `RENDER_SEMAPHORE` on lisaks **protsessi-lokaalne** — mitme
workeri peale minnes ei ole see enam globaalne piirang.

**Rohkem võrguliiklust:** ~2 MB/lk JPG-sid ühe PDF-i asemel. Sisevõrgus
(172.17.x) ebaoluline.

**Katkenud apply** jätab poolikult avaldatud töö — see risk on juba täna
poolitatud teel olemas ja käitub samamoodi.

## Testimine

Ühiktestid (`tests/`):

- marsruutimine: triviaalne plaan läheb samuti `start_apply` kaudu
- `_transfer_pages` kirjutab pisipildi iga avaldatud lehe kohta
- `poll_and_sync_thumbs` tagastab `applying` ajal `files` massiivi ega tee
  ühtki JPG-allalaadimist (pisipildid on juba olemas)
- `_planned_pages` annab `applying` ajal endiselt väljundi arvu (192, mitte 178)
- pildikausta `nosplit` leht avaldatakse baithaaval, mitte PIL-i kaudu

Käsitsi tootmises, kolm kuju: poolitusteta PDF, poolitustega PDF, mitmepildi-
upload. Igal juhul kontrolli, et esimene pisipilt ilmub sekundites ja LOSSi
`.txt`-d hakkavad tekkima renderdusega paralleelselt.

## ADR

Uus **ADR 0028** — „Üks tee: VUTT rasteriseerib alati". Ta ei tühista ADR 0017
ega 0026 tervikuna: poolitamise mehaanika ja „ülevaatus on alati nähtav"
jäävad kehtima. Tühistatav osa on kitsalt see, et 300 DPI läbikäik on opt-in.
Mõlemasse vanasse ADR-i tuleb viide uuele.

`CLAUDE.md` invariantide plokk „Poolitamine enne OCR-i (ADR 0017, 0026)" tuleb
ümber kirjutada — praegu ütleb ta otse „poolitusteta plaan ei renderda ühtki
300 DPI pikslit".

## Väljaspool skoopi

- `fetchStatus` kattumiskaitse (`setInterval` ilma in-flight liputa). Duplikaat-
  allalaadimine kaob selle tööga niikuinii; ülejäänu on eraldi korrastus.
- LOSSi `expand_pdf` lehekaupa renderdamine (#278 algne ettepanek) — ei ole
  enam vajalik, kui VUTT PDF-e enam ei saada.
- Vahemikuline OCR-i järjekorra sügavus (#251).
