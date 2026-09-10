# Üks tee: VUTT materialiseerib OCR-i lehed, LOSS ainult OCR-ib

**Kuupäev:** 2026-08-31
**Seotud:** #278, PR #277, ADR 0017, ADR 0026
**Ülevaatus:** GPT, 2026-08-31 — „approved with changes"; muudatused sisse viidud, kaks punkti
mõõtmiste põhjal ümber lükatud (vt „Ülevaatuse järeldused").

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
valmis; poolitusteta teel ei saa ka OCR enne renderduse lõppu alata.
Poolitustega teel **OCR juba töötab õigesti** — `publish_atomic` avaldab
lehthaaval, LOSSi `main_loop` skannib iga 5 s, ja apply lõppedes oli 192-st juba
~97 lehte transkribeeritud. Katki oli ainult VUTT-i enda nähtavus.

## Otsus

Üks tee. **VUTT materialiseerib OCR-i lehed** — rasteriseerib PDF-i lehthaaval
või kopeerib pildikausta baidid — ja avaldab iga lehe kohe (`publish_atomic`).
LOSS ainult OCR-ib. Ülevaatuse ekraan täitub apply ajal ja pollib samal ajal ka
valmimise staatust.

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

Numbrid on **praeguse mõõtmise põhjal** ja natuke optimistlikud: uus tee lisab
igale lehele pisipildi dekodeerimise + resize'i + JPEG-kodeerimise. Eeldatavasti
väike (~50 ms/lk), aga tuleb pärast teostust uuesti mõõta.

`pdf_subset.py` docstring vaidleb praegu vastu („alamhulga ehitamine jätab
rasterdamise OCR-serveri poolele, ~36 s vs ~6 min"). See võrdlus loeb ainult
rasterduse maksumust ega arvesta, et LOSSi pool **blokeerib**: 36 s alamhulga
ehitust järgneb ikkagi ~7,6 min `expand_pdf`-i, mille jooksul OCR seisab.
Otsast otsani on üks tee kiirem, mitte ainult tajus.

## Invariandid

Kolm reeglit, mis peavad teostuses eksplitsiitselt kirjas olema. Need EI OLE
teostusdetailid — nad on selle disaini korrektsuse tingimused.

### I1 — `applying` ajal omab elutsükli-staatust apply-lõim, mitte poll

`poll_and_sync_thumbs` teeb praegu tingimusteta:

```python
if expected_pages and resolved_count >= expected_pages:
    new_status = "done"
elif all_page_nums:
    new_status = "reviewing"
```

Kui poll hakkab `applying` ajal jooksma, siis **esimene poll, mis näeb ühtki
JPG-d, kirjutab staatuse `reviewing`-uks** — ammu enne, kui apply-lõim on
avaldamise lõpetanud. Seejärel paneb `apply_and_transfer` lõpus `processing`.
Staatus põrkaks `applying → reviewing → processing`.

Tagajärjed:

- `_planned_pages` võtmestub staatuse järgi — `reviewing` ajal langeks
  kohatäidete arv 192-lt 178-le keset apply't
- kui LOSS jõuab OCR-iga järele, võib poll jõuda `done`-ni, kuni sisendvoog on
  veel lahti

**Ei ole ohus:** `try_begin_applying` CAS lubab ainult
`APPLY_START_STATUSES = ("awaiting_split", "prepping", "error")`, ja `reviewing`
ei kuulu sinna — topelt-apply't see race ei võimalda.

Reegel:

> Kuni staatus on `applying`, tohib `poll_and_sync_thumbs` lugeda `.txt`/`.err`,
> arvutada edenemist ja tagastada selle vastuses, aga **ei tohi upload'i
> põhistaatust muuta**. `applying → processing` teeb ainult apply-lõim.
> `processing`-ust alates võtab poll `done` / `error` ülemineku üle.

Kontseptuaalselt: `applying` tähendab, et sisendvoog ei ole veel suletud.

### I2 — VUTT ei tõmba tagasi pilte, mille ta ise just saatis

Väide „allalaadimise silmus ei tee midagi, sest `existing_thumbs` sisaldab neid
juba" on tõenäosuslik, mitte tõene. Aken on olemas:

```
publish_atomic(remote/001.jpg)
                                 ← poll näeb remote JPG-d, lokaalset veel mitte
write_thumbnail(local/001.jpg)
```

Seega tehakse see invariandiks, mitte lootuseks:

> `applying` ajal poll **ei laadi ühtki kaug-JPG-d alla**. Ta listib kausta,
> loeb `.txt`/`.err` ja kasutab ainult lokaalselt olemasolevaid pisipilte.
> Puuduva pisipildi SFTP-taastamine (backfill) käib alles `processing`-ust
> alates.

### I3 — apply ja poll ei jaga SFTP kanalit

Kontrollitud: `ocr_client.sftp_open` teeb iga kutse peale uue
`paramiko.SFTPClient.from_transport(...)`; jagatud on ainult
`paramiko.Transport` (`ssh_connections[upload_id]`, `ssh_lock` all). Eraldi
kanalid ühise transpordi peal on paramiko toetatud muster, seega **muudatust ei
ole vaja** — aga reegel pannakse kirja, et keegi ei hakkaks ühendust „optimeerimise
mõttes" jagama:

> `apply` ja `poll` ei tohi jagada sama `SFTPClient`-i. Igaüks avab omaenda
> kanali; jagatud on ainult TCP-transport.

## Mis muutub — backend

### 1. Marsruutimine

`routers/upload.py:admin_prepress_apply` kaotab haru. Iga plaan läheb
`prepress_apply.start_apply` kaudu; `is_trivial_plan` jääb alles ainult
kokkuvõtete ja UI teadete jaoks.

Uut renderdusloogikat ei ole vaja: `prepress_plan.page_cuts` annab
`nosplit`-lehele juba ühe terve lehe lõike (`[(0, width)]`) ja `is_excluded` on
`_transfer_pages` tsüklis kaetud.

### 2. `expected_pages` saab ühe tähenduse

Praegu tähendab väli kahte asja ja `_planned_pages` peab staatuse järgi
arvama, kumba. Selle asemel fikseeritakse invariant:

```
awaiting_split, prepping   → expected_pages = LÄHTE-lehtede arv
applying, processing, …    → expected_pages = VÄLJUND-lehtede arv
```

`try_begin_applying` seab väljundi arvu **samas lukus**, kus ta staatuse
`applying`-uks paneb (arvutus: `prepress_plan.output_page_count(plan, expected_pages)`,
kus `expected_pages` on veel lähtearv).

See on lihtsam kui algne kavand, kus poll oleks saanud oma `SFTP_IDLE_STATUSES`
konstandi: kui `expected_pages` tähendus on üks, langevad
`PREPRESS_IDLE_STATUSES`-i **mõlemad** tarbijad samale liikmelisusele
(`awaiting_split`, `prepping`) ja `applying` lahkub konstandist lihtsalt ära.
Teist konstanti ei tule.

Tarbijad on üle vaadatud ja kõik on sisemised: `is_stalled`, `_planned_pages`,
`ocr_jobs_normalize`, ning vastuse kaudu frontend. `store_source` seab juba
täna väljundi arvu (`expected_pages=len(kept)`) — kommentaar seal ütleb otse
„`expected_pages` PEAB tulema plaanist, mitte lähtefailist".

### 3. Pisipilt sünnib apply's — atomaarselt ja mitte-fataalselt

`prepress_apply._transfer_pages` kirjutab pärast `publish_atomic`-ut ja **enne**
`os.unlink(cut)`-i lokaalse pisipildi. Pikslid on juba kettal — null SFTP-d,
null lisarenderdust.

Kaks kaitset:

```python
publish_atomic(sftp, cut, remote)      # kaug-JPG on nüüd LOSSile ametlik
try:
    write_thumbnail(cut, thumb_path)   # tuletatud UI-artefakt
except Exception as e:
    logger.warning(...)                # apply EI katke
finally:
    os.unlink(cut)
```

Pisipildi ebaõnnestumine ei tohi OCR-i konveierit katkestada — kaugpilt on
selleks hetkeks juba avaldatud ja puuduva pisipildi taastab hiljem
`processing`-aegne backfill (I2).

Kirjutamine on **atomaarne**: `{n:03d}.jpg.tmp` → `os.replace`. See parandab
ühtlasi olemasoleva latentse vea — `thumbs._create_thumbnail` salvestab PIL-iga
otse lõppteele, nii et paralleelne HTTP GET või teine poll võib juba täna näha
poolikut JPEG-i.

Ühine kirjutamine läheb omaenda funktsiooni `thumbs.write_thumbnail(src, dst)`;
`_create_thumbnail` jääb selle õhukeseks SFTP-ümbriseks.

### 4. Poll töötab apply ajal

`applying` lahkub `PREPRESS_IDLE_STATUSES`-ist (võimaldatud sammuga 2). Poll
jookseb kahes režiimis:

| | `applying` | `processing`+ |
|---|---|---|
| listdir | jah | jah |
| `.txt` / `.err` lugemine | jah | jah |
| kaug-JPG allalaadimine | **ei** (I2) | jah, puuduvate jaoks |
| staatuse üleminek | **ei** (I1) | jah |

Kõrvalsaadus: paralleelsete pollide duplikaat-allalaadimine kaob. Mõõdetud
0a2k4y pealt **477 allalaadimist 192 faili kohta** (keskmiselt 2,5×, üksikuid
faile kuni 5×), sest iga poll võtab `existing_thumbs` hetktõmmise omaenda alguses.

### 5. Pildikaust: `can_copy_source_bytes()` predikaat

`ImageDirPageSource.render_full` teeb `im.convert("RGB").save(..., quality=95)`
— JPEG **ümberkodeerimine**. Tänane otsetee (`_transfer_images_thread`) saadab
originaalbaidid. Et ühendamine kvaliteeti ei kaotaks, saab baithaaval
kopeerimine oma predikaadi, mida testitakse eraldi:

```
can_copy_source_bytes(source, plan, n)  ⇔
    allikas on pildikaust
    ja page_cuts(plan, n, width) == [(0, width)]      # identity, mitte ainult „terve laius"
    ja fail on JPEG, mille LOSS võtab muutmata vastu
    ja EXIF orientation puudub või on 1
```

EXIF on siin see, mis kergesti märkamata jääb: PIL-i `convert("RGB").save()`
viskab EXIF-i ära ja *rakendab* orientatsiooni alles siis, kui seda eraldi
küsida. Pöördega JPEG võib baithaaval kopeerituna ja PIL-i läbituna näidata
erinevat orientatsiooni.

**Vertikaalset mõõdet ei ole vaja kontrollida:** `page_cuts` annab ainult
x-koordinaate ja `_write_cut` lõikab alati `(x0, 0, x1, height)`, seega kogu
lehe kõrgus on struktuurselt garanteeritud.

## Mis muutub — frontend

`REVIEW_STATUSES` sisaldab juba `applying`-ut, seega 4. samm on apply ajal juba
nähtaval — ta lihtsalt ei saanud senini pollilt midagi.

- Apply ajal on faas „renderdan ja saadan", mitte „OCR töötleb". `prepress`
  kannab juba `applied_done` loendurit, mida keegi ei näita; 4. sammu päis
  kasutab seda `applying` ajal.
- `ocrStartedAt` nimetatakse ümber **`processingStartedAt`**-iks ja seatakse
  `processing`-usse jõudmisel. Vana nimi valetaks pärast seda muudatust veel
  otsesemalt, sest OCR algab tegelikult juba `applying` ajal; timeout mõõdab
  „kaua on möödunud hetkest, mil kõik sisendlehed on avaldatud".
  Selle serveripoolsesse olekusse tõstmine (reload ja mitme kliendi servajuhud)
  on eraldi töö, mitte selle PR-i osa.

## Mis läheb pensionile

- `store_source.transfer_stored_source` + `_transfer_pdf_thread` +
  `_transfer_images_thread`
- `upload/pdf_subset.py` tervikuna
- `remote_staging_path` kasutus upload'i teel (LOSS ei saa enam PDF-e)

Alles jäävad `store_source.store_pdf` / `store_image_page` — lähtefaili
salvestamine VUTT-i poolele ei muutu.

**LOSSi `expand_pdf` jääb alles.** Ta ei teeninda enam ühtki VUTT-i upload'i,
aga käsitsi kausta pandud PDF on endiselt toetatud töövoog. #278 suletakse
VUTT-i muudatusega, LOSSi skripti puutumata — **teenuse restarti ei ole vaja**.

`thumbs.py` `VIGASED` kontroll muutub upload'ide jaoks kättesaamatuks (vigase
PDF-i avastab nüüd VUTT ise, juba 100 DPI eelvaate ajal). Jääb esialgu alles;
eemaldamine on eraldi koristus, kui üks tee on tootmises end tõestanud.

## Riskid

**Veebiserver rasteriseerib iga upload'i puhul.** Hind on mõõdetud (~2,75 s/lk)
ja aktsepteeritud praeguse mahu juures. Kaitsed jäävad: `nice 10`
(`page_source.NICE_LEVEL`) ja `RENDER_SEMAPHORE(1)`.

**`RENDER_SEMAPHORE` on protsessi-lokaalne ja muutub nüüd kriitiliseks.** Täna
triviaalne plaan ei renderdanud üldse; edaspidi läbivad **kõik** upload'id selle
ressursi. Invariant:

> Praegune deployment eeldab ÜHT renderdavat protsessi. Enne web-workerite arvu
> suurendamist tuleb `RENDER_SEMAPHORE(1)` asendada protsessideülese lukuga.

Teostuses lisandub käivitushoiatus, kui `WEB_CONCURRENCY > 1` — muidu on aasta
pärast lihtne panna gunicorn nelja workeri peale ja unustada, miks masin
renderdab korraga nelja 300 DPI PDF-i.

**Katkenud apply.** Puudutab pärast muudatust kõiki upload'e, seega tuleb
määratleda, mitte jätta lahtiseks. `APPLY_START_STATUSES` sisaldab juba
`error`-it, ehk retry ON täna lubatud. Lehenimed on deterministlikud
(`remote_page_name(slug, out_index)`, sama tsükli järjekord), seega kordus
kirjutab samad nimed üle — aga juba tekkinud `.txt` failid jäävad alles ja LOSS
ei OCR-i uuesti, nii et muutunud pildile võiks jääda vana tekst.

Määratud käitumine: **retry puhastab enne kaugtöökausta failid**
(`ocr_client.cleanup_run_files`, mitte `rm -rf` — ADR 0024) ja alustab
`out_index = 1`-st. Kolmandat, defineerimata varianti ei jää.

**Rohkem võrguliiklust:** ~2 MB/lk JPG-sid ühe PDF-i asemel. Sisevõrgus
(172.17.x) ebaoluline.

## Ülevaatuse järeldused: kaks punkti, mis mõõtmisel ei pidanud

**OCR-i sisendraster ei halvene — ta paraneb.** Ülevaatus soovitas ehitada
regressioonitesti korpuse (DPI, CropBox vs MediaBox, /Rotate, eri lehesuurused,
RGB/hall), sest raster liigub `expand_pdf`-ilt VUTT-i `render_full`-ile.
Kontrollitud: `pdf2image` on **pdftoppm-i ümbris** (`use_pdftocairo=False`
vaikimisi), sama tööriist, mida VUTT juba kasutab. Geomeetria, /Rotate ja
CropBox käsitlus on seega konstruktsiooni poolest identsed.

Erinevus on JPEG-põlvkondade arvus ja see soosib VUTT-i:

| | LOSS täna | VUTT |
|---|---|---|
| rasterdus | `pdftoppm -jpeg` **ilma `-jpegopt`-ita** → vaikekvaliteet **75** | `pdftoppm -jpeg -jpegopt quality=95` |
| seejärel | PIL dekodeerib ja salvestab uuesti `quality=95` | — |
| OCR saab | q95 ümberkodeeringu q75 pildist | üks kodeering, q95 |

Ehk tänane OCR-i sisend on kahekordse kadudega kodeering; uus on ühekordne.
Korpuse-testi asemel piisab **käsitsi kontrollist** ühe PDF-iga, millel on
/Rotate, CropBox ja eri lehesuurused — see katab riski, mis reaalselt alles jääb
(et miski ei ole ootamatult *teisiti*, mitte et see oleks halvem).

**Byte-copy predikaadi vertikaalne mõõde ei vaja kontrolli.** Ülevaatus nõudis
`y0 == 0 && y1 == height`. `page_cuts` tagastab ainult `(x0, x1)` ja `_write_cut`
lõikab alati täiskõrguse — vertikaalset lõikamist andmemudelis ei eksisteeri.
EXIF-orientatsiooni punkt seevastu peab paika ja on predikaadis sees.

## Testimine

Ühiktestid (`tests/`):

- marsruutimine: triviaalne plaan läheb samuti `start_apply` kaudu
- `try_begin_applying` seab `expected_pages` väljundi arvule (192, mitte 178)
- **I1:** `poll_and_sync_thumbs` EI muuda staatust, kui see on `applying` —
  ka siis, kui `resolved_count >= expected_pages`
- **I2:** `applying` ajal ei kutsuta ühtki JPG-allalaadimist, isegi kui
  kaug-JPG on olemas ja lokaalne pisipilt puudub
- `_transfer_pages` kirjutab pisipildi iga avaldatud lehe kohta
- pisipildi kirjutamise viga EI katkesta apply't (avaldamine jätkub)
- pisipilt kirjutatakse `.tmp` + `os.replace` kaudu
- `can_copy_source_bytes`: identity-lõige jah; poolitus ei; EXIF-pööre ei

Käsitsi tootmises, neli kuju:

1. poolitusteta PDF
2. poolitustega PDF
3. mitmepildi-upload (kontrolli, et baidid on identsed, mitte ümber kodeeritud)
4. **poolitusteta PDF /Rotate + CropBox + eri lehesuurustega** — võrdle
   väljundpilti vana `expand_pdf` tulemusega

Igal juhul kontrolli, et esimene pisipilt ilmub sekundites ja LOSSi `.txt`-d
hakkavad tekkima renderdusega paralleelselt.

## ADR

Uus **ADR 0028** — „VUTT materialiseerib OCR-i lehed; LOSS ainult OCR-ib".
Pealkiri katab nii rasterdamise kui identity-copy — „VUTT rasteriseerib alati"
ei oleks pildikausta baithaaval kopeerimise tõttu sõna-sõnalt tõsi.

ADR ei tühista ADR 0017 ega 0026 tervikuna: poolitamise mehaanika ja „ülevaatus
on alati nähtav" jäävad kehtima. Tühistatav osa on kitsalt see, et 300 DPI
läbikäik on opt-in. Mõlemasse vanasse ADR-i tuleb viide uuele.

ADR peab eksplitsiitselt sisaldama I1, I2, I3 ja `expected_pages` invariandi —
viimase koos näitega, miks `expected_pages == 178` ja `planned_pages == 192`
korraga eksisteerimine oli lugejat eksitav.

`CLAUDE.md` invariantide plokk „Poolitamine enne OCR-i (ADR 0017, 0026)" tuleb
ümber kirjutada — praegu ütleb ta otse „poolitusteta plaan ei renderda ühtki
300 DPI pikslit".

## Väljaspool skoopi

- `fetchStatus` kattumiskaitse (`setInterval` ilma in-flight liputa).
  Duplikaat-allalaadimine kaob selle tööga niikuinii; ülejäänu on eraldi korrastus.
- `processingStartedAt` tõstmine serveripoolsesse olekusse.
- LOSSi `expand_pdf` lehekaupa renderdamine (#278 algne ettepanek) — ei ole
  enam vajalik, kui VUTT PDF-e enam ei saada.
- OCR-i järjekorra sügavuse näitamine (#251).
