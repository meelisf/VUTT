# Upload'i lehtede ülevaatus — disainidokument

**Kuupäev:** 2026-08-24
**Issue:** #255 · **Mockup:** https://claude.ai/code/artifact/5c737053-5a33-47a6-a4e8-08fa0388f669
(kolm artboardi: „Ülevaatus — vaikimisi", „Ülevaatus — 3 lehte valitud", „Täisvaade — uus tegevusriba".
Mockup näitab **paigutust ja mikroteksti**, mitte stiili — stiil tuleb lehekülgede haldusest, vt „Visuaalne keel".)
**Puudutab:** ADR 0017 (poolitamine enne OCR-i) — üht selle põhimõtet muudetakse, vt „Mõju ADR 0017-le"

## Kontekst

2026-08-24 laaditi üles kolm tööd (33, 92 ja 143 lehte) ja mõõdeti, mis läbimängus tegelikult juhtub:

- **6 lehte 92-st (~7%) läksid kordusloopi.** Enne loop-valvurit maksis iga selline leht ~6 min GPU-aega ja hoidis kinni kõigi teiste järjekorda. Tühi lehekülg on tüüpiline päästik.
- **Poolitamise samm on „puine"** (kasutaja sõna): lehte saab välja jätta ainult ükshaaval silma-ikooniga, täisvaates ei saa üldse, ja hulgivalikut ei ole. 143 lehe puhul tähendab see sadu klikke.
- **Ülevaatus on opt-in.** Kes lülitit ei puutu, ei näe oma tööst midagi peale teate „OCR server töötleb…".

Otsus, mille see kokku võtab: **lehe saatus tuleb otsustada ENNE OCR-i, kohas, kus inimene lehte niikuinii vaatab.** Loop-valvur (#227) ja `.err` märgend (#250) ravivad tagajärge — see spekk ravib põhjust.

## Otsused

### 1. Ülevaatus on alati nähtav

Opt-in kastike kaob. Samm 3 on alati lehtede ülevaatus, ka siis, kui midagi ei poolitata.

### 2. Vaikimisi ei poolitata; „Poolita kõik" on primaarnupp

Poolitamine on erand. Vaikeplaan jääb `mode: "default"` + `default_split_x` rakendamata — ükski leht ei kanna joont enne, kui kasutaja ütleb. **„Poolita kõik" on primaarnupp poolitusjoone välja kõrval** (mitte eraldi tegevusribal): joon ja selle rakendamine kuuluvad kokku.

Kõrvale tuleb **„Ära poolita ühtki"** sekundaarnupuna (mockup, artboard 2): üldjoon peab olema sama žestiga tagasi võetav, muidu on ainus tee 143 kaardi läbiklõpsimine. Ta ei puutu `custom`-lehti, nagu „Poolita kõik"gi (§7).

### 3. OCR-mudelit saab ülevaatuses muuta

Trükis / käsikiri valitakse metaandmete sammus, kus kasutaja ei pruugi veel kindel olla. Mitteaktiivne pool peab olema **selgelt hämaram** (hall tekst hallil), muidu ei ole ühe pilguga näha, kumb kehtib.

Mudel saab state'is **oma välja** ega muuda `meta.type`-i — vt „Mudeli vahetamine".

### 4. Valikurežiimi ei ole

Klõps pisipildil valib, Shift+klõps vahemiku, märkeruut nurgas on eraldi klõpsatav (klaviatuur). See on **täpselt `PageCard` muster lehekülgede haldusest** — sama žest, sama koht, sama välimus.

### 5. Hulgitegevused hõljuval alumisel ribal

Karkass tuleb `PageActionBar`-ist **muutmata** (vt „Visuaalne keel"): `fixed bottom-0 left-0 right-0 z-[1100]`, tsentreeritud `max-w-4xl`, `rounded-xl border-gray-200 bg-white shadow-lg`, rühmad `border-l border-gray-200 pl-3` vahedega, loendur `text-primary-800`, „Tühista valik" punase tekstina `X`-ikooniga. Ilmub ainult valiku korral.

**Ülemine riba oleks vale:** 143-lehelisel tööl kaob see kerides ära ja tegevus jääb kättesaamatuks — see oli kasutaja otsene vastuväide varasemale mustandile.

### 6. Valiku peal käsud, kaardi peal toggle

Valikul on **„Poolita" ja „Ära poolita" kaks eraldi käsku**, mitte üks toggle: segase valiku (osa poolitatud, osa mitte) korral ei ole toggle ühemõtteline — kas ta pöörab igaühe eraldi või viib kõik ühele küljele? Ühe kaardi peal on toggle loomulik ja töötab juba täna.

Sama kehtib „Ära OCR-i" kohta: valikul käsk, kaardil toggle.

### 7. „Poolita kõik" ei kirjuta üle käsitsi seatud jooni

Käsitsi seatud joon (`mode: "custom"`) jääb puutumata ja riba ütleb selle välja: „27 lehte sai üldjoone, 3 käsitsi seatut jäi puutumata". Käsitsi tehtud töö on väärtuslikum kui hulgikäsk.

### 8. Üks ikoonisüsteem kõikjal

| Tähendus | Ikoon | Vaikeolek | Erinev olek |
|---|---|---|---|
| OCR | silm | hall valgel | **must taust, läbi tõmmatud** |
| Poolitus | vertikaaljoon | hall valgel | **must taust** |

Reegel: **must = see leht erineb vaikeolekust.** Samad ikoonid kannavad sama tähendust kaardil, alumisel ribal ja täisvaates — praegu on pisipildil ikoonid ja täisvaates tekstinupud, mis on kaks eri keelt.

**Kõigil kaartidel on samad ikoonid, ka väljajäetul** — muidu ei saa väljajätmist kaardilt tagasi võtta.

Kuju eristab olekuid, aga must/hall on ainult visuaalne vihje. Sildistus käib
lehekülgede halduse idioomi järgi: **`title`/`aria-label` ütleb TEGEVUSE**
(„Jäta OCR-ist välja" / „Lisa OCR-i", „Poolita" / „Ära poolita") ja **olekut
kannab `aria-pressed`**, nagu `PageCard` märkeruudul. Mockup'i olekusõnastus
(„Läheb OCR-i", „Ei poolitata") jääb kõrvale — nupp, mille silt kirjeldab olekut,
ei ütle klaviatuurikasutajale, mis klõpsust juhtub.

### 9. Täisvaates on „Ära OCR-i"; navigatsioon ja tegevused ühes rühmas

Praegu on täisvaates ainult „Lähtesta üldjoonele" ja „Ära poolita", ning `‹ ›` on riba vastasservas. Uus järjestus: `Ülevaatesse | ‹ › | Ära poolita · Ära OCR-i · Lähtesta üldjoonele`.

### 10. Paneeli päises valikuabid, all suuruse juhtnupp

„Vali kõik" / „Vali poolitatud" päises, ruudustiku kohal `−` · liugur · `+` — täpselt nii, nagu lehekülgede halduses (seal on kõik kolm koos, mitte kas-või). 143-lehelise töö juures on mõlemad vajalikud. Valikuabid **ei kuulu tegevusribale**: nad valivad, ei muuda midagi.

## Visuaalne keel — eeskuju on lehekülgede haldus

**Eeskuju on VISUAALNE, mitte funktsionaalne.** Karkass, mõõdud, ümardused,
olekuvärvid ja ikoonide kest kopeeritakse `manage/`-ist, et kaks ekraani näeksid
välja nagu üks süsteem. Žestid ja töövoog tulevad ülevaatuse enda vajadusest.

**Vajadused on eri suunast** ja seda ei tohi ühtlustada:

| | Lehekülgede haldus | Upload'i ülevaatus |
|---|---|---|
| Lähtekoht | teos on olemas; midagi jäi valesti — leht poolitamata, järjekord paigast | terve teos korraga, enne kui midagi on tehtud |
| Tüüpiline tegevus | üksik järelparandus | hulgiotsus 33–500 lehe peal |
| Millega alustatakse | otsitakse üles see üks leht | vaadatakse kõik läbi ja nopitakse erandid |

Sellepärast erinevad ka ikoonid: seal liiguta/transkribeeri/kustuta, siin
poolita/jäta OCR-ist välja. Sama loogikaga võivad erineda žestid — ainult
välimus peab kattuma.

Täna on ülevaatus teises keeles: `border-2 border-gray-300` ilma ümarduseta,
`bg-black/60` märgised ülanurkades, `opacity-35` kogu kaardil, oma ruudustik
`auto-fill minmax(150px, 1fr)`. Kõik see läheb ümber.

### Kaardi karkass (`PageCard` → `SplitContactSheet`)

| Element | `PageCard` täna | Ülevaatuses |
|---|---|---|
| Kest | `relative flex flex-col rounded-lg border overflow-hidden bg-white` | sama |
| Pisipilt | `aspect-[3/4] bg-gray-100`, `select-none` (Shift+klõps ei tõsta teksti esile) | sama kest ja proportsioon |
| Valitud | `border-primary-500 ring-2 ring-primary-400` | sama |
| Märkeruut | `absolute top-1 left-1 z-10 w-5 h-5 rounded border`, valitult `bg-primary-600`, `Check size={13}`, `aria-pressed` | sama |
| Number | `absolute bottom-1 left-1 text-xs px-1 py-0.5 rounded shadow-sm`, värv seisundist | sama kest, hall (`bg-gray-100 text-gray-600`) — upload'is seisundit veel ei ole |
| Tegevusnupp | `absolute bottom-1 right-1 p-1 bg-white/90 border border-gray-600 rounded shadow-sm`, ikoon `size={14}` | sama kest ja nurk, mitu nuppu kõrvuti |
| Ülemine parem nurk | märgised (`Loader2`, `AlertCircle`, tekstisilt) | eelvaate ootel `Loader2` — märgiste koht, MITTE tegevuste oma |

Kolm asja, mis siit järelduvad ja mockup'ist erinevad:

- **Valikut näitavad ring + märkeruut, mitte lehenumbri värv.** Mockup'i
  merevaigus number kaob — merevaik tähendab `manage`-is „salvestamata muudatus".
  Ülevaatuses salvestamata olekut ei ole (plaan salvestub kohe), seega jääb
  merevaik kasutamata ega tohi tähendust vahetada.
- **Väljajäetud leht tuhmub PILDIST, mitte kaardist.** Täna `opacity-35` kogu
  kaardil, mis tuhmib ka ikoonid — vastuolus §8 nõudega, et väljajätmine peab
  olema kaardilt tagasi võetav. Tuhmi ainult `<img>`.
- **Primaarnupp on `bg-primary-600`, mitte must.** Must jääb AINULT ikooni
  olekumärgiks („see leht erineb vaikest", §8): `bg-gray-900 border-gray-900
  text-white` sama geomeetriaga kui hall kest. Mockup'i must `Poolita kõik`
  oli skitsi lihtsustus.

**Ikoonid on oma, kest on ühine** (lucide-react, `size={14}`): OCR-ist
väljajätmine `EyeOff`/`Eye` (juba kasutuses), poolitus `Columns2`. `Maximize2`
ei tohi tähendada „ära poolita" — lucide'is tähendab ta „suurenda" ja loeb siin
valesti.

### Ruudustik ja paneel (`WorkManage` → `UploadStepSplit`)

- Ruudustik `grid gap-3 p-4` + inline `gridTemplateColumns: repeat(gridCols, 1fr)`.
- Suuruse juhtnupp on `−` · `<input type="range">` · `+` **koos** (`MIN_COLS`…`MAX_COLS`,
  liuguri väärtus pööratud) — spekk ütles varem „liugur", mockup näitas „−/+";
  teostuses on mõlemad.
- Paneeli päis `flex items-center justify-between px-5 py-4 border-b border-gray-100`:
  vasakul pealkiri `font-semibold text-gray-800`, paremal valikuabid
  `px-2 py-1 text-xs border rounded` ja loendur `text-sm text-gray-500`.

### Tegevusriba (`PageActionBar` → `SplitActionBar`)

Karkass 1:1: `fixed bottom-0 left-0 right-0 z-[1100] flex justify-center px-3 pb-3
pointer-events-none` + sisemine `pointer-events-auto w-full max-w-4xl rounded-xl
border border-gray-200 bg-white shadow-lg`. Loendur `text-sm font-medium
text-primary-800`, rühmad `border-l border-gray-200 pl-3`, „Tühista valik"
`text-red-600` + `X size={15}`.

Sisu (mockup, artboard 2): `Valitud: 3 | Poolita · Ära poolita · Ära OCR-i | Tühista valik`,
all vihjerida „Shift+klõps valib vahemiku".

### Mikrotekst (mockup'ist, i18n `upload` nimeruumi mõlemas keeles — ADR 0011)

| Koht | Tekst |
|---|---|
| Kokkuvõte, poolitusteta | „poolitusi pole · OCR-i läheb 32 lehte · välja jäetud 1" |
| Kokkuvõte, poolitustega | „poolitatakse 31 · OCR-i läheb 63 lehte · välja jäetud 1" |
| Täisvaate päis | „Lk 12 · 33-st · poolitatakse joonelt 47%" |
| Täisvaate vihje | „← → liigub lehtede vahel" |
| Eelvaate kohatäide | pöörlev `Loader2` (nagu täna), mitte tekst |

## Kaks olemasolevat viga, mis tulid spekki kirjutades välja

Mõlemad on **täna tootmises** ja mõlemad puudutavad otse seda, mida see töö lubab.

### A. `mode: "default"` TÄHENDAB „poolita üldjoonelt"

`default_plan()` loob kõik lehed `mode: "default"`-iga ja `effective_split_x` tõlgendab seda kui „poolita `default_split_x` pealt". Ainus, mis seda kinni hoiab, on `enabled: False`:

```python
if not plan or not plan.get("enabled"):
    return None          # ← ainus pidur
```

Seega **„vaikimisi ei poolitata" ei ole praeguse mudeliga saavutatav** lihtsalt lüliti eemaldamisega: ülevaatuse alati-nähtavaks tegemine (ehk `enabled` sisuliselt alati tõene) poolitaks kohe kõik lehed 50% pealt.

**Lahendus:** `default_plan()` loob lehed `mode: "nosplit"`-iga; „Poolita kõik" seab valitud/kõik lehed `mode: "default"`-i (= järgi üldjoont, nii et joone hilisem muutmine liigutab neid kõiki). `effective_split_x` ise ei muutu. `enabled` **eemaldatakse** (vt Andmemudel) — ta ei väravaks enam midagi ja jääks nime järgi eksitama.

### B. Väljajätmine EI TÖÖTA, kui midagi ei poolitata

`is_trivial_plan` jätab väljajätmised teadlikult arvestamata (dokumenteeritud: „ainult-väljajätmise plaan on triviaalne ja originaalfail saadetakse muutmata edasi"). Tagajärg:

```
väljajätmisi on, poolitusi ei ole  →  plaan on „triviaalne"
                                   →  originaal-PDF läheb muutmata OCR-serverisse
                                   →  OCR-server pakib lahti KÕIK lehed
                                   →  väljajäetud leht OCR-itakse ja imporditakse ikka
```

Väljajätmine toimib **ainult** siis, kui vähemalt üks leht on poolitatud (siis läheb töö `_transfer_pages` teele, kus `is_excluded` kontrollitakse).

See on täpselt see stsenaarium, mille pärast #255 üldse tekkis: **tühjad lehed, mis lähevad loopi**. Kasutaja jätaks nad välja, ei poolitaks midagi — ja väljajätmine ei teeks mitte midagi.

**Kolm teed, mõõdetud numbritega:**

| Tee | Hind 143-lehelisel tööl | Märkus |
|---|---|---|
| a) väljajätmine muudab plaani mitte-triviaalseks | ~6 min (300 DPI, ~2,5 s/lk) | koodi ei lisandu, aga kallis |
| b) **ehita PDF ilma väljajäetud lehtedeta** | ~36 s + ~800 MB ajutist | poppler on olemas (`pdfseparate`/`pdfunite`) |
| c) jätta nagu on | 0 | väljajätmine on vaikne no-op — **vastuvõetamatu** |

**Soovitus: (b).** Algne otsus võrdles PDF-i ümberehitust *eelvaatega* („kallim kui eelvaade") — aga õige võrdlus on täieliku rasteriseerimisega, mille kõrval on ta 10× odavam. (a) jääb varutee'ks, kui ümberehitus mingil failil ebaõnnestub.

**See on eraldi otsus, mille saab teha enne UI-tööd** — ja mis tasub teha enne, sest UI lubab kasutajale midagi, mida backend praegu ei täida.

**Kaks haru, mitte üks.** Väljajätmist eiratakse MÕLEMAL triviaalteel:

| Lähteallikas | Kood | Praegu | Parandus |
|---|---|---|---|
| PDF (`source.pdf`) | `_transfer_pdf_thread` | saadab originaali muutmata | ehita PDF ilma väljajäetud lehtedeta (tee b) |
| Pildikaust (`source/`) | `_transfer_images_thread` | `enumerate(sorted(listdir))` — laeb üles kõik failid | jäta `is_excluded` lehed vahele; `enumerate` nummerdab ise ümber |

Piltide haru on kolmerealine parandus ja ei vaja poppleri't — aga ilma selleta
oleks väljajätmine pooltel upload'idel endiselt no-op.

**`expected_pages` peab mõlemal teel tulema plaanist.** Poolitustee seab
`expected_pages=sent`; triviaaltee jätab lähtefaili lehtede arvu. Väljajätmisega
jääb see arv liiga suureks ja pool süsteemi ootab lehti, mida ei tule:
`is_stalled` (`state.py`) ei loe tööd kunagi valmis ja sammu 4 `done`-üleminek
jääb rippuma. Triviaaltee peab seadma `expected_pages = output_page_count(plan)`.

**Lehenumbrid nihkuvad — ja see on õige.** OCR-i väljundist tagasi lähtelehe
`pages[].n`-ile mapping'ut ei ole ega tule: `_transfer_pages` nummerdab juba täna
`out_index`-iga ja import loeb numbri kaugfaili nimest (`{slug}_pg_{NNN}`).
Poolitamine teeb sedasama — poolitatud leht 3 annab väljundlehed 3 ja 4.
Imporditud teoses on täpselt need lehed, mis saadeti; väljajäetut seal ei ole ja
järgnevad nihkuvad ette.

## Mõju ADR 0017-le

ADR 0017 ütleb: **„puutumata lülitiga upload ei renderda ühtki pikslit ja käib tänast PDF-teed."** Alati nähtav ülevaatus tähendab, et **100 DPI eelvaade renderdatakse iga upload'i puhul**. See osa ADR-ist muutub ja vajab uut ADR-i.

**Mõõdetud hind (tootmine, 2026-08-24, 143-leheline töö):**

```
143 eelvaadet 82,6 s  =  0,58 s/lk        26,2 MB staging'us
```

Koodi kommentaar (`page_source.py`) lubab „~0,05 s/lk" — **11× optimistlik**, parandada.

| Töö suurus | Eelvaate ootus |
|---|---|
| 33 lk | ~19 s |
| 143 lk | ~83 s |
| 500 lk | ~5 min |

Renderdus käib `RENDER_SEMAPHORE(1)` taga, seega kaks paralleelset upload'i seisavad järjekorras (lehe kaupa põimudes, #219).

**Mis EI muutu:** apply kiirtee. Poolitusteta plaan saadab OCR-serverisse endiselt **PDF-i** ega renderda ühtki 300 DPI pikslit — puutumata plaan originaalina, ainult väljajätmistega plaan ~36 s ümberehituse järel (viga B). Kallis osa jääb opt-in-iks; odav osa muutub kohustuslikuks.

**Miks see on vahetust väärt:** eelvaade voogab (`preview_status: "rendering"`, `preview_done: N`) ja ekraan on kasutatav kohatäidetega, nagu samm 4 pärast #259. Kasutaja peab lehed niikuinii üle vaatama; praegu ta lihtsalt ei saa.

## Eelvaade ja apply — katkestamine

Alati nähtav ülevaatus tõstab esile piirangu, mida täna ei märka: **renderduse
ajal ei saa apply't üldse käivitada.**

```python
APPLY_START_STATUSES = ("awaiting_split", "error")   # state.py
```

Eelvaate ajal on staatus `"prepping"`, seega `try_begin_applying` ütleb ei ja
MÕLEMAD apply-teed (triviaalne ja poolitav) annavad 409. 500-lehelise tööga
tähendaks see ~5 minutit, mille jooksul „Edasi" lihtsalt ei tööta — ja lubadus
„ekraan on kohe kasutatav" jääks poolikuks.

**Otsus: apply ei oota eelvaadet, vaid katkestab selle.**

1. `APPLY_START_STATUSES` saab juurde `"prepping"`.
2. Plaani lisandub katkestuslipp (`preview_cancel`), mida renderdustsükkel
   kontrollib **iga lehe alguses** ja väljub `preview_status: "cancelled"`-iga.
   Lipu seab apply CAS-i sees, ainsa lubatud teed pidi (`mutate_prepress`).
3. Poolik eelvaade on ohutu: `isPreviewReady` käsitleb valmimata lehte juba
   kohatäitena, ja apply järel ei ole eelvaadet enam kellelegi vaja.
4. Katkestamine on **kohustuslik, mitte kena-oleks**: eelvaade ja 300 DPI
   läbikäik jagavad sama `RENDER_SEMAPHORE(1)`-i, seega katkestamata renderdus
   põimub apply'ga lehe kaupa ja ligi kahekordistab selle aja.
5. Sama lipp sulgeb ka koristusvõistluse: `cleanup_prepress_artifacts` teeb
   impordil `preview/`-le `rmtree`, elus renderdaja kirjutaks kausta tagasi.

## Mudeli vahetamine — backend-mõju

Täna **`ocr_model` välja ei ole**. `create_upload` tuletab mudeli tüübist ja see
tuletis jääb elama ainult kaugteedesse:

```python
ocr_model = 'hand' if work_type.get('id') == 'Q87167' else 'print'
"remote_staging_path": f"AUTO-OCR/{ocr_model}/{upload_id}",
"remote_work_path":    f"AUTO-OCR/{ocr_model}/{upload_id}/{slug}",
```

**Otsus: mudel saab state'is oma välja** (`state["ocr_model"]`, väärtused
`"print" | "hand"`), mille vaikeväärtus tuletatakse loomisel tüübist. Lüliti
ülevaatuses EI muuda `meta.type`-i: „mis mudel loeb" on töötlusotsus, mitte
bibliograafiline väide teose kohta, ja tüübi vaikne muutmine jõuaks impordiga
`_metadata.json`-i ja sealt Meilisse.

Neli nõuet:

1. **Ainult enne apply't.** Üldine reegel, mis ka staatuste loendit põhjendab:
   **mudelit tohib muuta seni, kuni ükski OCR-input fail ei ole kaugserverisse
   saadetud.** Praeguses vootee's tähendab see `awaiting_split` ja `prepping`
   (eelvaade elab ainult VUTT-i poolel). Pärast apply't on vastus 409
   „katkesta ja alusta uuesti", mitte vaikne ümbertõstmine.
2. **Vahetus arvutab mõlemad kaugteed ümber** ja kirjutab need state'i.
3. **Kaugteed loetakse ALATI state'ist**, mitte ei tuletata kutsekohas — see
   invariant on juba `feat/upload-ocr-katkestamine` plaanis ja hoiab lennus
   olevad upload'id töös.
4. **`PATCH /meta` EI SOBI selleks.** `update_upload_meta` allow-list viskab
   tundmatu välja vaikselt ära ja tagastab ikka 200 (kood hoiatab selle eest
   nimeliselt — `external_url` ja `ester_id` jäid varem just nii salvestumata),
   ning mudel ei ole ka `meta` väli. Vahetus läheb omaenda endpointi:
   `POST /admin/upload/{id}/ocr-model`.

**Tasub teha koos run-isolatsiooniga** (sama plaani Task 2: iga apply saab oma `run_id`). Mõlemad muudavad kaugtee arvutamist; eraldi tehes tuleb sama koht kaks korda lahti võtta.

## Andmemudel

Plaani kuju: `{default_split_x, preview_status, preview_done, preview_cancel, pages[{n, mode, split_x, excluded}]}`.

- **Vaikeplaani lehed on `mode: "nosplit"`** (vt viga A). „Poolita kõik" seab need `"default"`-i.
- **`enabled` eemaldatakse, mitte ei deprekeerita.** Selles töös muutub ta
  tähendus vastupidiseks („kasutaja lülitas poolitamise sisse" → ei värava enam
  midagi) ja `if plan["enabled"]:` jääks tulevast lugejat eksitama. Eemaldada
  tuleb **seitsmest kohast**: backendis `default_plan`, `effective_split_x`,
  `is_trivial_plan` (`prepress_plan.py`), `prepress/start` ja plaani salvestus
  (`routers/upload.py`); frontendis `summarizePlan`, `countOutputPages`,
  `willSplit` (`prepressPlan.ts`). **Frontendi unustamine annab vaikse
  lahknevuse:** UI ütleks „0 poolitatakse" samal ajal, kui backend poolitab.
- **Eelvaate olek on serveri oma.** Plaani salvestus tohib puutuda AINULT
  kasutaja välju — `default_split_x` ja `pages[].{mode, split_x, excluded}`.
  `preview_status`, `preview_done` ja `preview_cancel` ei tule kliendist kunagi.
  Täna hoiab seda `mutate_prepress` (lugemine-muutmine-kirjutamine sama luku
  sees) ja salvestus kirjutab ainult nimetatud välju; `enabled` oli ainus erand,
  mille kaudu aegunud kliendikoopia oleks saanud renderduse oleku ümber lükata,
  ja see kaob.
- Uusi LEHE-välju ei tule. Valik (`selected`) on **puhtalt kliendi olek**, nagu lehekülgede halduses — serverisse ei salvestata.
- `state["ocr_model"]` on plaanist väljaspool (vt „Mudeli vahetamine").

## Liides

Uus endpoint ei ole vajalik. Olemasolevad kannavad kõik:

| Tegevus | Endpoint |
|---|---|
| Eelvaate käivitus | `POST /admin/upload/{id}/prepress/start` (kutsutakse nüüd automaatselt) |
| Plaani salvestus (sh hulgimuudatused) | `POST /admin/upload/{id}/prepress` |
| Mudeli vahetus | **uus** `POST /admin/upload/{id}/ocr-model` (mitte `PATCH /meta` — vt „Mudeli vahetamine") |
| Rakendamine | `POST /admin/upload/{id}/prepress/apply` — lubatud ka `prepping`-ust, katkestab eelvaate |

Hulgikäsk on **üks plaani salvestus**, mitte N päringut: klient koostab uue `pages` massiivi ja saadab korraga.

**Semantika elab kliendis, mitte serveris.** `src/pages/upload/prepressPlan.ts` on
juba olemas puhta peegelmoodulina koos testidega — sinna lisanduvad
`applyDefaultSplitTo`, `setNoSplit`, `setExcluded`. Serverisse hulgi-abifunktsioone
EI lisandu: server valideerib lehekirjed ja liidab need plaani, nagu täna.
Nimi `applyDefaultSplitTo` on tahtlik — „Poolita kõik" tähendab tegelikult
„rakenda üldjoont kõigile peale `custom`-i" ja funktsiooni nimi peab seda ütlema.

## Puudutatud failid

| Fail | Muutus |
|---|---|
| `UploadStepSplit.tsx` | opt-in kaob; päis (mudel, joon, „Poolita kõik" + „Ära poolita ühtki"); paneeli päis; ruudustik + `−`/liugur/`+` `WorkManage` eeskujul |
| `SplitContactSheet.tsx` | kaardi karkass `PageCard` keelde; valik (klõps, Shift+klõps, märkeruut); ikoonisüsteem (`Columns2` asendab `Maximize2`); väljajäetu tuhmub pildist |
| `SplitPageDetail.tsx` | „Ära OCR-i", tegevusriba ümberjärjestus, samad ikoonid |
| uus `SplitActionBar.tsx` | hõljuv alumine riba — `PageActionBar` karkass 1:1 |
| `src/locales/{et,en}/upload.json` | uus mikrotekst mõlemas keeles korraga (ADR 0011) |
| `prepressPlan.ts` | `enabled` maha (3 funktsiooni); hulgioperatsioonid `applyDefaultSplitTo`, `setNoSplit`, `setExcluded` + testid |
| `prepress_plan.py` | `default_plan` → `nosplit`; `enabled` maha; `is_trivial_plan` jääb poolituspõhiseks, aga selle põhjendav kommentaar („PDF-i ümberehitus on kallim kui eelvaade") tuleb ümber kirjutada — väljajätmist käsitleb nüüd edastustee |
| `prepress.py` | `preview_cancel` kontroll renderdustsüklis, `preview_status: "cancelled"` |
| `store_source.py` | väljajätmine MÕLEMAL triviaalteel (PDF ümberehitus, piltide vahelejätmine) + `expected_pages` plaanist |
| `upload/state.py` | `APPLY_START_STATUSES` + `"prepping"` |
| `upload_ops.py` | `state["ocr_model"]` väli; kaugteed sellest |
| `routers/upload.py` | `enabled` salvestusest maha; uus `POST .../ocr-model`; apply seab `preview_cancel` |
| `page_source.py` | eelvaate kiiruse kommentaar (0,05 → 0,58 s/lk) |

## Riskid

| Risk | Käsitlus |
|---|---|
| Iga upload maksab eelvaate renderduse | Mõõdetud 0,58 s/lk; voogab, ekraan kasutatav kohatäidetega. 300 DPI kiirtee jääb alles. |
| Mudeli vahetus pärast apply't | Keelatud (409); UI peidab valiku pärast apply't |
| Kaks paralleelset upload'i | `RENDER_SEMAPHORE(1)` põimib lehe kaupa (#219) — juba lahendatud |
| Hulgikäsk suurel valikul | Üks salvestus, mitte N päringut |
| Staging kasvab (26 MB / 143 lk eelvaateid) | Koristatakse impordil, nagu praegu |
| „Edasi" renderduse ajal | Apply lubatud `prepping`-ust; `preview_cancel` peatab renderdaja, muidu jagavad nad semafori ja apply aeglustub ~2× |
| PDF-i ümberehitus ebaõnnestub | Varutee (a): plaan läheb 300 DPI teele (vt Lahtised) |

## Lahtised

- **Kaardi nurgatoimingud: alati nähtaval või hoveril?** Täna on `PageCard`-il **alati**. Kui liigume hoverile, tuleb see teha **mõlemas kohas korraga**, muidu tekib uus ebaühtlus.
- **Segane valik.** Käsud on ühemõttelised, aga riba võiks öelda, mitut lehte päriselt muudeti.
- **Kuidas täisvaade avaneb, kui klõps pisipildil valib (§4)?** Täna ongi pisipilt
  ise avamisnupp. Variandid: oma ikoon kaardi nurgas, topeltklõps, või Enter
  fokuseeritud kaardil. Ülevaatuse töövoog on hulgipõhine, seega täisvaade on
  erandi-tee — see ei pea olema kõige kergem žest, aga peab olemas olema.
- **PDF-i ümberehituse varutee.** (b) ebaõnnestumisel on varuvariant (a) — plaan
  muutub mitte-triviaalseks ja töö läheb 300 DPI teele. Kas langeda vaikselt tagasi
  või näidata kasutajale, et OCR läheb kallimat teed?

## Kontroll

- 143-leheline töö: ülevaatus avaneb kohe, kohatäidetega; eelvaated voogavad ~83 s jooksul
- „Poolita kõik" → 143 lehte saavad joone; käsitsi seatud joon jääb puutumata ja riba ütleb selle välja
- Valik + „Ära OCR-i" → valitud lehed muutuvad hallideks, kokkuvõte väheneb
- Mudeli vahetus enne apply't muudab kaugteed; pärast apply't tagastab 409
- Täisvaates saab lehe välja jätta ilma ülevaatesse naasmata
- Kõrvuti avatud `/work/{id}/manage` ja ülevaatus näevad välja nagu üks süsteem: sama kaardi kest, sama märkeruut, sama alumine riba
- Väljajäetud kaardil on ikoonid loetavad ja klõpsatavad (tuhmub pilt, mitte kaart)
- **Väljajätmine ILMA poolitamiseta, PDF-ist:** väljajäetud leht EI jõua OCR-serverisse (viga B) — kontrolli kaugkausta sisu, mitte ainult UI-d
- **Väljajätmine ILMA poolitamiseta, pildikaustast:** sama kontroll teisel harul
- Väljajätmisega töö jõuab sammus 4 `done`-i (st `expected_pages` tuli plaanist, mitte lähtefailist)
- „Edasi" eelvaate renderduse ajal: apply käivitub kohe (ei 409), eelvaade lõpetab ja apply ei jookse poole kiirusega
- Mudeli vahetus enne apply't ei muuda `meta.type`-i — imporditud teose tüüp jääb selleks, mis metaandmete sammus valiti
- Puutumata plaan (ei poolitusi ega väljajätmisi) läheb endiselt originaal-PDF-ina, ilma 300 DPI renderduseta
