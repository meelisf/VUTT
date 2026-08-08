# Topeltlehtede poolitamine enne OCR-i

**Kuupäev:** 2026-08-07
**Staatus:** kinnitatud, teostamata

## Probleem

Topeltlehtedega materjali saab praegu poolitada alles **pärast** importi
(`admin_page_ops.split_page`, Manage-lehe `PageImageEditorModal`). Kasutaja tegelik
töövoog on seetõttu:

1. laeb topeltlehtedega PDF-i üles,
2. ootab kogu teose OCR-i läbi (~24 s/lk — 300-leheline teos ligi 2 tundi),
3. poolitab lehed käsitsi,
4. käivitab batch re-OCR-i ja ootab **teist korda** sama kaua.

Esimene OCR-läbikäik on tervikuna raisus, sest OCR tehti valel kadreeringul. Poolitamine
peab olema võimalik enne, kui midagi OCR-serverisse jõuab.

Blokeeriv põhjus on arhitektuuriline: `save_and_transfer_to_ocr` saadab PDF-i **tervikuna**
OCR-serverisse ja OCR-serveri valvurskript
(`~/Dokumendid/LLM/qwen3.5/kataloogi-jalgimine-ja-ocr.py`) rasteriseerib selle ise
(`convert_from_path(pdf, dpi=300, fmt="jpg")`, `quality=95`). VUTT ei näe üksikuid
lehepilte enne, kui `.jpg`+`.txt` paarid tagasi tulevad.

## Lahenduse võti

OCR-server oskab juba vastu võtta **valmis JPG-sid** — kaustapõhine pildi-OCR on
olemasolev, iga päev kasutuses olev tee (`reocr_ops.start_reocr_batch` laeb pildid
`AUTO-OCR/{print|hand}/{job_id}/{slug}/` kausta; `ocr_client.prepare_image_upload` teeb
sama üksikpildi puhul). Poppler on backendi Dockeris juba olemas (`pdfinfo` kasutuses,
`Dockerfile`: `poppler-utils`).

Seega saab VUTT rasteriseerimise ise üle võtta ja tulemuse samasse torusse saata —
**OCR-serverit muutmata.**

### Mõõdetud maksumus

Päris skaneeritud PDF-idel, sama poppler mis Dockeris:

| Toiming | Kiirus | 300-leheline teos |
|---|---|---|
| 300 DPI täisleht (= OCR-serveri praegune töö) | 0,15–0,47 s/lk | ~1–2,5 min |
| 100 DPI eelvaade | 0,05 s/lk | ~25 s |
| 300 DPI **ainult köitevahe-riba** (`-x -y -W -H`) | 0,09 s/lk | ~45 s |

Suure topeltlehe (~17 Mpx) puhul tuleb 300 DPI täislehele arvestada ~2 s/lk.

Viimane rida on kandev: `pdftoppm` renderdab piirkonna, mitte tervet lehte. Nii saab
köitevahe-riba näidata **natiivses 300 DPI lahutuses**, ilma et terve leht renderdataks.

## Miks UI on siin sisuline, mitte kosmeetiline

Köitevahe on tüüpiliselt ~2% lehe laiusest. 240 px laiusel kontaktlehe pisipildil on see
~5 px — otsustada, kas joon lõikab kirja, **ei ole võimalik**. Käsikirjades on kiri sageli
kirjutatud praktiliselt keskele välja. Iga paigutus peab suutma näidata natiivset
lahutust joone ümbruses.

Automaattuvastust katsetati päris materjalil (EAA 1253 kirikuraamat, 6 lehte):

- **Köitevahe globaalne leidmine on ebausaldusväärne** — pakutav x hüppab 0,38 ja 0,61
  vahel; tumedaim veerg on sageli murdevari, mitte vahe.
- **Tindiskoor joonel on usaldusväärne ainult ühes suunas.** Kõrge skoor (leht 3: 0,995)
  = joon lõikab kindlasti midagi. Madal skoor ≠ õige koht — tühi veeris skoorib samuti 0.
  Kohalik minimeerimine libises kahel lehel −8% peale, ilmselt veerisesse.

Sellest järeldub disainireegel: **automaatika on hoiataja, mitte pakkuja.** Inimene seab
joone, süsteem märgib lehed, kus joon tindisse satub.

### Kolm taset: partii → riba → leht

1. **Kontaktleht** (peavaade) — 100 DPI pisipiltide ruudustik, joone ülekate,
   tindiskoori märgis. Kahtlased lehed esile tõstetud. Siit näeb ka, mis üldse on
   topeltleht ja mis on kaas.
2. **Köitevahe-riba** (kontroll) — lülitatav teine vaade sama järjendi peale: igast lehest
   kitsas natiivse lahutusega vertikaalne lõige joone ümbert (±5% laiusest), kõrvuti.
   Lehe kõrgus on kokku surutud, laius mitte — „kas tint ületab joone" on horisontaalne
   küsimus, nii et vertikaalne surumine ei kaota infot. ~15 lehte korraga ekraanil.
3. **Üksikleht** (erand) — suur pilt, lohistatav joon, suum. Ühe lehe parandamiseks.

## Ulatus

Sees:

- Poolitamine enne OCR-i: globaalne joon + lehepõhine ülekirjutus + „ära poolita".
- **Lehtede varajane väljajätmise märkimine** — admin märgib tühjad lehed, kaaned ja
  eraldajad juba poolitamise sammus, mitte alles ülevaatuses. Vt „Väljajätmise semantika"
  allpool: kui poolitusi on, jäävad märgitud lehed OCR-ist päriselt välja; kui poolitusi
  ei ole, kaovad nad impordil nagu praegu.
- PDF-üleslaadimine ja mitmepildi-üleslaadimine.

Väljas:

- Pööramine ja järjekorra muutmine. Mõlemad on olemas Manage-lehe pildiredaktoris ja
  töötavad pärast importi.
- Automaatne köitevahe pakkumine (vt eespool: ebausaldusväärne).
- Muudatused OCR-serveris.
- Muudatused OCR-järgsele poolitamisele (`admin_page_ops.split_page`) — see jääb alles,
  juba imporditud teoste jaoks on seda endiselt vaja.
- PDF-i ümberehitamine ainult väljajätmiste jaoks (vt „Väljajätmise semantika").

## Voog

```
1 metaandmed → 2 fail → 3 POOLITAMINE (uus) → 4 ülevaatus → import
```

Muudatus 2. sammus: fail **ei lähe enam kohe** OCR-serverisse. Ta salvestatakse
`uploads/{upload_id}/source.pdf`-i (või mitmepildi puhul `uploads/{upload_id}/source/`).

### Prepress on opt-in — ka eelvaate renderdus

Samm 3 avaneb **ilma midagi renderdamata**: ainult lüliti „Poolita topeltlehed enne
OCR-i" ja nupp „Edasi".

- Lülitit ei puutu → „Edasi" käitub **absoluutselt nagu täna**. Ühtki pikslit ei
  renderdata, `state.prepress` jääb loomata.
- Lüliti sisse → `preview_status = "rendering"`, 100 DPI läbikäik käivitub, kontaktleht
  hakkab täituma.

See on tahtlik: 100 DPI läbikäik on ~25 s / 300 lk, mis single-worker uvicornil ~300
kasutajaga ei ole null. Kulu maksab ainult see, kes featuuri kasutab. Nii kehtib
invariant „tühi plaan = tänane tee" **kogu voo ulatuses**, mitte ainult 300 DPI läbikäigu
mõttes.

### Kaks teekonda

| Olukord | Mis juhtub |
|---|---|
| Ühtki poolitust pole märgitud | PDF saadetakse tervikuna, tänast teed. Väljajäetud lehed kaovad impordil. |
| Vähemalt üks poolitus märgitud | Lokaalne 300 DPI läbikäik → poolitus → järjestikune nimetamine → SFTP JPG-dena. Väljajäetud lehti ei renderdata ega saadeta — OCR-aeg jääbki kulutamata. |

### Väljajätmise semantika

Kolmandat haru — „poolitusi pole, aga väljajätmised on → ehita PDF ümber ilma nende
lehtedeta" — kaaluti ja **jäeti välja**. Mõõdetud (416-leheline skaneeritud PDF, 885 MB):

| Meetod | Aeg | Väljund |
|---|---|---|
| `pdfseparate` + `pdfunite` | 48 s | 815 MB |
| `qpdf --pages` | 36 s | 775 MB |

Skaneeritud PDF-ist lehtede eemaldamine nõuab kogu faili ümberkirjutamist koos
sisseehitatud pildivoogudega. Rasteriseerimist ei ole, aga ~36 s CPU-d ja ~800 MB
ketta-I/O-d on — **kallim kui 100 DPI eelvaate läbikäik**, mille me just opt-in'i taha
panime. Lisaks ei ole `qpdf` Docker-image'is.

Seetõttu on ulatuses ausalt „varajane väljajätmise **märkimine**". Kui poolitusi on
(peamine kasutusjuht — topeltlehtedega materjal), rakendub väljajätmine tasuta ja
päriselt enne OCR-i. Kui poolitusi ei ole, on see mugavusfunktsioon, mis säästab
ülevaatuse sammus tööd, mitte OCR-aega.

Kui see haru hiljem siiski vaja tuleb, on mõõtmised siin ja liides (`plan`) valmis.

## Backend

### Uus moodul `server/upload/prepress.py`

Olemasolevate `file_detection` / `ocr_client` / `thumbs` / `state` / `import_work` kõrvale.

| Funktsioon | Vastutus |
|---|---|
| `render_previews(upload_id)` | `pdftoppm -r 100 -jpeg` → `uploads/{id}/preview/pg_NNN.jpg`; uuendab edenemist jooksvalt, et UI saaks voogesitada |
| `render_gutter_strip(id, n, x_px)` | `pdftoppm -r 300 -x -y -W -H` — ainult riba, nõudmisel; vahemälu `uploads/{id}/strips/{n}_{x_px}.jpg` |
| `ink_score(id, n, x_frac)` | tindiosakaal joonel ±3 px, arvutatud 100 DPI eelvaatelt (statistikale piisab; lävi = 35. protsentiil lehe enda tonaalsusest) |
| `plan_to_sequence(plan, page_sizes)` | plaan → lõplik lehejärjend. **Puhas funktsioon**, vt leping allpool |
| `apply_and_transfer(id)` | 2. läbikäik, lehthaaval voogedastus (vt allpool) |
| `is_trivial_plan(plan)` | kas plaan taandub tänasele PDF-teele |

### `plan_to_sequence` leping

Puhas funktsioon, testitav ilma failideta. Invariandid:

- `cut_px = round(width * split_x)`
- vasak pool `[0, cut_px)`, parem pool `[cut_px, width)`
- **ükski piksliveerg ei kao ega dubleeru**: `len(vasak) + len(parem) == width`
- väljundjärjekord alati **vasak → parem**
- `width` on **renderdatud lehe** laius, mitte PDF-i MediaBox. PDF `/Rotate` ja CropBox
  on `pdftoppm` väljundis juba rakendatud; `x_frac` käib renderdatud orientatsioonile.
  Ilma selle reeglita tekivad 90° pööratud lehtedel vaiksed valed lõiked.
- iga leht arvutab oma `cut_px` **oma laiusest** — sama `x_frac` erineva laiusega lehtedel
  annab erineva pikslikoordinaadi. Skaneeringute laius kõigub päriselt (mõõdetud
  näidismaterjalil 2280–2344 px).

### Voogedastus, mitte materialiseerimine

`apply_and_transfer` töötleb **ühte lähtelehte korraga**: renderda → lõika → saada →
kustuta ajutine. Kogu teost ei materialiseerita lokaalselt JPG-deks (300-leheline
topeltlehtedega teos oleks ~1 GB). Kõrvalefektina alustab OCR-server lehest 1 sel ajal,
kui meie alles renderdame lehte 50.

### SFTP avaldamise aatomilisus

**Iga fail laaditakse üles nimega `{nimi}.jpg.tmp` ja nimetatakse alles siis ümber**
`{nimi}.jpg`-ks. Kataloogi tervikuna ei varjata.

Põhjendus, kontrollitud valvurskriptist: `wait_for_file_stable()` kutsutakse seal ainult
PDF-ide peale (rida 274). Pildid korjatakse `rglob("*")`-iga, filtrina
`EXTENSIONS = {".jpg", ".jpeg", ".png", ...}`, tingimusel et kõrvalolev `.txt` puudub
(read 391–398) — **stabiilsuskontrolli ei ole**. Poolik JPG võib seega OCR-i sattuda.
`.jpg.tmp` jääb `EXTENSIONS` filtrist välja, nii et rename lahendab selle.

Kataloogipõhine varjamine ei ole vajalik ega soovitav: valvur töötab pildi kaupa, nii et
poolik kataloog on hoopis konveier, mille me tahame alles jätta.

> **Olemasolev viga, mida siin EI parandata:** `reocr_ops.start_reocr_batch` kirjutab
> `sftp.put(src, f"{work_abs}/{remote_img_name}")` otse sihtnimega, ilma `.tmp`+rename-ta,
> ja jagab sedasama võistlusolukorda. Praktikas varjab seda 5 s pollimissamm.
> `ocr_client.transfer_image` teeb seda juba õigesti. Eraldi issue.

### Piirangud

- ADR 0002: kõik renderdus ja SFTP taustalõimedes; marsruudid sync `def` või
  `run_in_threadpool`. Blokeeriv I/O `async def` sees on keelatud.
- CPU-kaitse: moodulitasemel `threading.Semaphore(1)` — üks rasteriseerimistöö korraga.
  Alamprotsess `os.nice(10)`. **See kaitse on protsessi-lokaalne**: praeguse
  single-worker uvicorni juures piisav, aga mitme workeri peale minnes ei ole
  `threading.Semaphore` enam globaalne piirang. Praegu ei lahendata.
- Python 3.9 ühilduvus: `Optional[dict]`, mitte `dict | None`.

### `state.json` laiendus

```json
"prepress": {
  "enabled": false,
  "default_split_x": 0.5,
  "preview_status": "idle",
  "preview_done": 0,
  "pages": [
    { "n": 1, "mode": "default", "split_x": null,  "excluded": false, "ink": 0.08 },
    { "n": 3, "mode": "custom",  "split_x": 0.459, "excluded": false, "ink": 0.99 },
    { "n": 7, "mode": "nosplit", "split_x": null,  "excluded": true,  "ink": 0.02 }
  ]
}
```

- `enabled` **vaikeväärtus on `false`** ja jääb `false`-ks, kuni admin lüliti sisse
  lülitab. Poolitamine on destruktiivne teisendus — vaikimisi 0,5 juures ei tohi ükski
  tavaupload muutuda 300 lehest 600-ks lihtsalt „Edasi" vajutamisega.
- `enabled: false` → **ükski leht ei poolitu**, sõltumata `mode` väärtusest. `custom`
  väärtused jäävad alles, aga on inertsed, nii et lüliti välja-sisse ei kustuta tehtud
  tööd.
- `mode`: `default` = kasuta globaalset joont, `custom` = oma joon, `nosplit` = ära
  poolita. Ilma selleta jääks `split_x: null` mitmetähenduslikuks.
- `preview_status`: `idle` | `rendering` | `ready` | `error`.
- `excluded` on eraldi `files[].deleted`-st: viimane tähistab OCR-järgset väljajätmist
  ülevaatuse sammus ja jääb muutmata.
- `is_trivial_plan(plan)` on tõene, kui `prepress` puudub, `enabled` on väär **või** ükski
  leht ei anna poolitust. Väljajätmised ei mõjuta triviaalsust.

### Oleku samaaegne muutmine

`render_previews` uuendab edenemist samal ajal, kui admin POST-ib plaani. Praegune
`state.set_upload_state(**extra)` seab **terveid ülemise taseme võtmeid** luku all — see
hoiab ära rebenenud kirjutuse, aga mitte kadunud uuenduse: kui eelvaate lõim kirjutab
eelarvutatud `prepress` dikti tervikuna, pühib see admini äsja salvestatud `custom` joone
maha.

**Invariant:** `prepress` alamvälju muudetakse ainult `mutate_prepress(upload_id, fn)`
kaudu, mis loeb, rakendab `fn` ja kirjutab **sama luku sees**. Eelvaate lõim puudutab
ainult `preview_status` / `preview_done`; plaani POST ainult plaani välju. Kumbki ei
kirjuta teise välju üle ega edasta eelarvutatud `prepress` objekti.

### Elutsükkel ja koristus

| Artefakt | Millal kaob |
|---|---|
| `source.pdf` / `source/` | impordil või uploadi tühistamisel |
| `preview/` | impordil või uploadi tühistamisel |
| `strips/` | impordil, tühistamisel **ja** kui vahemälu ületab lehe kohta N faili (LRU) |
| 300 DPI ajutised | kohe pärast iga lehe saatmist (voogedastus, vt eespool) |

Pooleli jäänud `awaiting_split` upload läheb olemasolevasse aegunud-uploadide
koristusse. Ilma selleta koguneksid eriti `strips/` failid `uploads/` alla märkamatult.

### Uued staatused

`prepping` → `awaiting_split` → `applying` → `processing`.

`applying` on eraldi väärtus tahtlikult: ilma selleta oleks lokaalne raske töö UI-le
nähtamatu.

**`apply` on ühekordne ja idempotentne.** Üleminek `awaiting_split → applying` toimub
CAS-tüüpi kontrolliga luku all. Järgmine POST — topeltklikk, retry, brauseri refresh —
saab `409` koos olemasoleva töö seisundiga, mitte ei käivita teist paralleelset 300 DPI
renderdust ega SFTP-d.

### Endpointid (`server/routers/upload.py`)

```
GET  /admin/upload/{id}/prepress            plaan + tindiskoorid + eelvaate edenemine
POST /admin/upload/{id}/prepress/start      lülita prepress sisse, käivita eelvaade
GET  /admin/upload/{id}/preview/{n}         100 DPI pisipilt
GET  /admin/upload/{id}/strip/{n}?x=0.5     300 DPI köitevahe-riba
POST /admin/upload/{id}/prepress            salvesta plaan
POST /admin/upload/{id}/prepress/apply      käivita 2. läbikäik (409 kui juba käib)
```

Kõik `require_role("admin")` ja kõik `/admin/` all. nginx `/api/files/` proksib kogu
backendi avalikult — see on kohustus, mitte stiilivalik. Endpointid lähevad
`routers/upload.py`-sse, mitte `main.py`-sse.

**Valideerimine:** `0 < x < 1`, `n` lehtede vahemikus, `upload_id` olemasolev.

**Riba vahemälu kvantimine:** server normaliseerib `x` **tegelikuks 300 DPI
pikslikoordinaadiks** (`x_px = round(width_300 * x)`) ja kasutab seda nii renderdamiseks
kui vahemälu võtmeks. Ilma selleta tekitaks lohistamine (`x = 0.5001, 0.5002, …`) sadu
peaaegu identseid ribafaile.

## Mitmepildi-üleslaadimine

Praegu SFTP-b `add_image_page` iga pildi kohe OCR-serverisse. Uus tee peab pildid esmalt
kohapeal hoidma: `uploads/{upload_id}/source/pg_NNN.jpg`.

Sealt edasi on voog sama, ainult odavam:

- eelvaade = PIL `thumbnail()`, mitte `pdftoppm` (rasteriseerimist ei ole);
- `render_gutter_strip` = PIL `crop()` natiivselt originaalilt;
- triviaalse plaani korral SFTP-takse originaalid muutmata, nagu täna;
- mittetriviaalse korral kärbitakse ja saadetakse pooled.

`prepress.py` abstraheerib „anna leht N pikslitena" ühe sisemise liidese taha kahe
teostusega: PDF (`pdftoppm`) ja pildikaust (PIL). Ilma selleta dubleeruks kogu
plaaniloogika kaks korda.

## Frontend

Uued failid `src/pages/upload/components/`:

- `UploadStepSplit.tsx` — sammu konteiner. Avaneb opt-in lülitiga; pärast sisselülitamist
  vaate lüliti (kontaktleht ↔ riba), globaalse joone seadmine, kokkuvõte
  („142 lehest 138 poolitatakse, 4 jäetakse välja")
- `SplitContactSheet.tsx` — pisipiltide ruudustik, joone ülekate, tindimärgis,
  väljajätmise lüliti
- `SplitGutterStrip.tsx` — luubiriba; **virtualiseeritud**, ribasid küsitakse ainult
  nähtavale aknale (muidu 300 päringut korraga)
- `SplitPageDetail.tsx` — üksikleht lohistatava joonega

**Joone lohistamine debounce'itakse**: riba ei küsita iga `pointermove` peale, vaid
lühikese pausi järel või `pointerup`-il. Ülekate liigub sujuvalt kohalikult; ainult
pildipäring on viivitatud.

`PageImageEditorModal`-i **ei haruta ega taaskasutata**: see töötab imporditud teose ja
`work_id` peal (`/admin/work/{work_id}/page/{n}/split`), siin ei ole kumbagi ega
git-ajalugu.

`useUploadWizard.ts`: `step` tüüp `1 | 2 | 3` → `1 | 2 | 3 | 4`; olemasolevad `setStep(3)`
kutsed ülevaatusele viitavad → `setStep(4)`. `StepIndicator` saab neljanda sildi.

i18n: uued võtmed nimeruumi `upload`, **mõlemasse keelde korraga** (ADR 0011 —
`fallbackLng` on väljas, puuduv võti katkestab build'i).

Number-sisenditel (joone protsent) `type="text" + inputMode="numeric"`.

## Testimine

Backend (`tests/test_prepress.py`):

- `plan_to_sequence` — default/custom/nosplit/excluded kombinatsioonid → õige järjend ja
  nummerdus.
- **Poolitus täpselt pikslipiiril ei kaota ega dubleeri veergu** —
  `len(vasak) + len(parem) == width` ka paaritu laiuse ja `split_x` servaväärtuste korral.
- **Erineva laiusega lehed** kasutavad sama `x_frac` õigesti (igaüks oma `cut_px`).
- `is_trivial_plan` — **tühi plaan annab tänase PDF-teekonna**, muutumatult.
  Regressioonitest, mitte formaalsus.
- **`POST apply` kahekordne kutse ei käivita kahte tööd** — teine saab 409.
- **Eelvaate edenemise uuendus ei kaota samal ajal salvestatud `custom` plaani**
  (`mutate_prepress` võistluse test).
- `ink_score` sünteetilisel pildil (must tulp teadaoleval x-il).
- `render_gutter_strip` kutsub `pdftoppm`-i õigete `-x -y -W -H` väärtustega ja
  kvantitud `x_px`-ga (mock).

Frontend (`src/pages/upload/__tests__/`):

- plaani-reduktor: globaalse joone muutmine ei kirjuta üle `custom`-lehti.
- `localeParity` ja `translationKeysResolve` katavad uued võtmed automaatselt.

Väravad: `npm run typecheck`, `npm test`, `npm run lint:ci`, `.venv/bin/pytest tests/`.

## Riskid

1. **Uus CPU-koormus veebiserveril.** Seda kannab täna OCR-server (28 tuuma); VUTT-i
   backend on single-worker uvicorn ~300 kasutajaga. Leevendus: kogu prepress on opt-in,
   `Semaphore(1)`, `nice(10)`, voogedastus. Kui see osutub liiga kalliks, on põgenemistee
   2. läbikäigu tõstmine OCR-serverisse — **plaan-JSON ongi see liides**, mille taha see
   mahub.

2. **Uus sidusus OCR-serveriga.** Meie 300 DPI / q95 peab kattuma OCR-serveri
   `PDF_DPI = 300` ja `quality=95` väärtustega.

3. **Originaal topeltlehe pilti ei säilitata.** Nii on ka täna: `split_page` viskab
   originaali minema ja lehe-JPG-d ei ole git-tracked (git hoiab `.txt` + `.json`).

4. **`split_text_at_pb` heuristika ei rakendu.** Enne OCR-i teksti pole; kumbki pool saab
   oma päris OCR-i. Rangelt parem kui `<pb/>` järgi teksti pooleks lõikamine.

5. **Poolituse kvaliteet paraneb.** Täna kärbitakse OCR-serveri JPEG-i (uuesti
   kodeeritud); uus tee kärbib värsket renderdust.

## ADR

Uus **ADR 0016 — „Poolitamine enne OCR-i: rasteriseerimine VUTT-i poolel"**. Invariandid:

- **Prepress on tervikuna opt-in.** Puutumata lülitiga upload ei renderda ühtki pikslit
  ja käib tänast teed. `enabled` vaikeväärtus on `false`.
- Plaan-JSON on liides, mille taha saab 2. läbikäigu hiljem OCR-serverisse tõsta.
- 300 DPI / q95 peab kattuma OCR-serveri `PDF_DPI`-ga.
- Automaatika on hoiataja, mitte pakkuja: tindiskoor on usaldusväärne ainult kõrge
  väärtuse suunas.
- OCR-serverisse avaldatakse **failipõhise `.tmp`+rename-ga** — valvuril ei ole piltide
  jaoks stabiilsuskontrolli.
- `prepress` alamvälju muudetakse ainult `mutate_prepress` kaudu, sama luku sees.
- `apply` on ühekordne: `awaiting_split → applying` CAS, kordus annab 409.
- `Semaphore(1)` on protsessi-lokaalne kaitse, mitte globaalne.
