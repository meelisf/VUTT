# ADR 0028 — VUTT materialiseerib OCR-i lehed; LOSS ainult OCR-ib

**Kuupäev:** 2026-08-31
**Staatus:** vastu võetud
**Issue:** #278 · **Asendab osaliselt:** ADR 0017, ADR 0026
**Spekk:** `docs/superpowers/specs/2026-08-31-uks-tee-vutt-renderdab-design.md`

## Kontekst

ADR 0017 tegi 300 DPI läbikäigu opt-in-iks ja ADR 0026 kitsendas opt-in-i just
selle peale: „triviaalne tähendab siin ainult *meie pool ei pea ühtki pikslit
renderdama*". Poolitusteta plaan läks originaal-PDF-ina LOSSi, kus valvurskript
pakkis selle lahti.

Mõõtmised 2026-08-31 näitasid, et see „odav" tee ei ole otsast otsani odavam.

**Poolitusteta tee** (`6yoog3`, 35 lk): LOSSi `expand_pdf` teeb
`convert_from_path` **kogu faili peale** ja kirjutab JPG-d kettale alles pärast
seda — 1 min 52 s tühja kataloogi, mille jooksul ei ole midagi näidata ega
OCR-ida. Skaleerub lineaarselt: 143 lk ≈ 7,6 min.

**Poolitustega tee** (`0a2k4y`, 178 → 192 lk): apply kestis 8 min 49 s, mille
jooksul VUTT avaldas lehti ükshaaval ja LOSS OCR-is neid paralleelselt —
apply lõppedes oli juba ~97 lehte transkribeeritud. Aga viisard ei näidanud
midagi, sest `applying` kuulus `PREPRESS_IDLE_STATUSES`-i ja poll väljus
esimese `if`-i pealt. VUTT pani 9 minutit lehti kaugkataloogi ja keeldus samal
ajal sinnasamasse vaatamast. Seejärel tõmbas ta needsamad 192 pilti SFTP-ga
tagasi pisipiltideks.

Jõudlusnumbrid: VUTT 2,75 s/lk (renderdus + lõikamine + SFTP), LOSS `expand_pdf`
3,2 s/lk. **VUTT ei ole aeglasem** — ta teeb sama töö sama suurusjärgu ajaga,
aga voona, mitte kõike-või-mitte-midagi.

## Otsus

**Üks tee. VUTT materialiseerib OCR-i lehed ja avaldab iga lehe kohe; LOSS
ainult OCR-ib.**

„Materialiseerib", mitte „rasteriseerib": pildikausta leht, millel teisendust ei
ole, kopeeritakse baithaaval (`can_copy_source_bytes`). Rasterdus on üks kahest
teostusest, mitte otsuse sisu.

`admin_prepress_apply` ei hargne enam `is_trivial_plan` järgi — see funktsioon
jääb ainult kokkuvõtete ja UI teadete tarbeks. `store_source.transfer_stored_source`
ja `upload/pdf_subset.py` on eemaldatud.

**LOSSi `expand_pdf` jääb alles.** Ta ei teeninda enam ühtki VUTT-i upload'i,
aga käsitsi kausta pandud PDF on endiselt toetatud töövoog. LOSSi skripti selle
otsuse jaoks ei muudetud.

## Invariandid

### I1 — `applying` ajal omab elutsükli-staatust apply-lõim, mitte poll

`poll_and_sync_thumbs` tegi tingimusteta:

```python
if expected_pages and resolved_count >= expected_pages:
    new_status = "done"
elif all_page_nums:
    new_status = "reviewing"
```

Kui poll jookseb apply ajal, kirjutab **esimene poll, mis ühtki JPG-d näeb**,
staatuse `reviewing`-uks — ammu enne, kui apply-lõim on avaldamise lõpetanud.
See ei ole harv võistlusolukord, vaid peaaegu garanteeritud. Tagajärg on lisaks
vaikne: `_planned_pages` võtmestub staatuse järgi, seega kohatäidete arv kukuks
keset apply't väljundi arvult lähtearvule.

> Kuni staatus on `applying`, tohib poll lugeda `.txt`/`.err`, arvutada
> edenemist ja tagastada selle vastuses, aga **ei tohi upload'i põhistaatust
> muuta**. `applying → processing` teeb ainult apply-lõim; `processing`-ust
> alates võtab poll `done`/`reviewing` ülemineku üle.

Kontseptuaalselt: `applying` tähendab, et sisendvoog ei ole veel suletud.

Topelt-apply ohtu see race ei loonud — `APPLY_START_STATUSES` on
`("awaiting_split", "prepping", "error")` ja `reviewing` ei kuulu sinna.

### I2 — VUTT ei tõmba tagasi pilte, mille ta ise just saatis

„Allalaadimise silmus ei tee midagi, sest pisipilt on juba olemas" on
tõenäosuslik, mitte tõene. Aken on olemas:

```
publish_atomic(remote/001.jpg)
                                 ← poll näeb kaugpilti, lokaalset veel mitte
write_thumbnail(local/001.jpg)
```

> `applying` ajal poll **ei laadi ühtki kaug-JPG-d alla**. Ta listib kausta,
> loeb `.txt`/`.err` ja kasutab ainult lokaalselt olemasolevaid pisipilte.
> Puuduva pisipildi SFTP-taastamine käib alles `processing`-ust alates.

Vastutasu selle eest annab `prepress_apply`, mis kirjutab pisipildi sealsamas,
kus 300 DPI pikslid juba kettal on. Pisipildi kirjutamise viga on **mitte-fataalne**:
kaugpilt on selleks hetkeks juba avaldatud ja OCR võib alata; tuletatud
UI-artefakti pärast konveieri mahavõtmine oleks vale kompromiss.

### I3 — apply ja poll ei jaga SFTP kanalit

`ocr_client.sftp_open` teeb iga kutse peale uue
`paramiko.SFTPClient.from_transport(...)`; jagatud on ainult
`paramiko.Transport` (`ssh_connections[upload_id]`, `ssh_lock` all). Eraldi
kanalid ühise transpordi peal on paramiko toetatud muster.

> `apply` ja `poll` ei tohi jagada sama `SFTPClient`-i. Igaüks avab omaenda
> kanali; jagatud on ainult TCP-transport.

Reegel on kirjas selleks, et keegi ei hakkaks ühendust „optimeerimise mõttes"
jagama — see viga ei ilmneks testides ja avalduks tootmises kummaliselt.

### `expected_pages` on üks tähendus, mitte kaks

```
awaiting_split, prepping   → LÄHTE-lehtede arv
applying, processing, …    → VÄLJUND-lehtede arv
```

`try_begin_applying` seab väljundi arvu samas lukus, kus ta staatuse
`applying`-uks paneb.

Varem tähendas väli kahte asja ja `_planned_pages` pidi staatuse järgi arvama,
kumba — nii et 178-leheline töö näitas korraga `expected_pages == 178` ja
`planned_pages == 192`. See oli lugejale eksitav ja masinale habras: konstandi
`PREPRESS_IDLE_STATUSES` muutmine oleks vaikselt tähendanud poolituste
kahekordset lugemist (sama viga oli tootmises varem: 62 → 89).

Ühe tähendusega langesid `PREPRESS_IDLE_STATUSES`-i mõlemad tarbijad samale
liikmelisusele (`awaiting_split`, `prepping`) ja teist konstanti ei olnud vaja.

### `RENDER_SEMAPHORE` protsessi-lokaalsus on nüüd blokeeriv eeltingimus

Pärast seda otsust läbivad **kõik** upload'id rasterduse; varem ainult
poolitatavad.

> Praegune deployment eeldab ÜHT renderdavat protsessi. Enne web-workerite arvu
> suurendamist tuleb `RENDER_SEMAPHORE(1)` asendada protsessideülese lukuga.

`config.check_render_concurrency()` logib käivitusel hoiatuse, kui
`WEB_CONCURRENCY` / `UVICORN_WORKERS` / `GUNICORN_WORKERS` on üle ühe.

### Katkenud apply kordus

`APPLY_START_STATUSES` sisaldab `error`-it, seega retry on lubatud. Lehenimed on
deterministlikud ja kordus kirjutaks need üle — aga eelmise katse `.txt` failid
jääksid alles ja LOSS ei OCR-iks lehte uuesti, nii et muutunud pildile jääks
vana tekst.

> Teisest katsest alates puhastab apply kaugtöökausta **failid**
> (`ocr_client.cleanup_run_files`) enne avaldamist. Kataloog jääb alles —
> kadunud kataloog lennusoleva batchi alt kukutab kogu OCR-teenuse (ADR 0024,
> #225).

## Tagajärjed

**Hea:** esimene JPG kaugkataloogis ~3 s (varem ~8 min 143-lehelisel
poolitusteta tööl); OCR algab ~5 s; pisipildid ilmuvad renderdamise tempos.
Kaks teed muutusid üheks; `pdf_subset` ja `store_source` edastusahel kadusid
(−340 rida). Paralleelsete pollide duplikaat-allalaadimine kadus — mõõdetud
477 allalaadimist 192 faili kohta.

**Hind:** veebiserver rasteriseerib iga upload'i puhul (~2,75 s/lk; 178-leheline
teos hoiab ühte tuuma ~9 min). Kaitsed on `nice 10` ja `RENDER_SEMAPHORE(1)`.
Kõik upload'id konkureerivad nüüd sama semafori pärast — täna triviaalne plaan ei
renderdanud üldse. Praeguse mahu juures vastuvõetav, aga see on uus omadus.
Võrguliiklust on rohkem (~2 MB/lk JPG-sid ühe PDF-i asemel); sisevõrgus
ebaoluline.

**OCR-i sisendraster paraneb.** `pdf2image` on pdftoppm-i ümbris
(`use_pdftocairo=False`), sama tööriist mida VUTT kasutab — geomeetria, /Rotate
ja CropBox on identsed. Erinevus on JPEG-põlvkondade arvus: LOSS kutsub
`convert_from_path` **ilma `jpegopt`-ita**, seega pdftoppm vaikekvaliteet 75, ja
PIL salvestab selle uuesti `quality=95`. VUTT teeb `-jpegopt quality=95` ühe
käiguga. Tänane sisend on kahekordse kaoga, uus ühekordne.

## Mis EI muutu

ADR 0017 poolitamise mehaanika (`mutate_prepress`, apply CAS, `preview_cancel`,
`page_cuts` semantika) ja ADR 0026 „ülevaatus on alati nähtav" jäävad kehtima.
Tühistatav on kitsalt see, et 300 DPI läbikäik on opt-in.

`FULL_DPI` / `JPEG_QUALITY` peavad endiselt kattuma OCR-serveri valvurskripti
väärtustega (`PDF_DPI = 300`, `quality=95`).
