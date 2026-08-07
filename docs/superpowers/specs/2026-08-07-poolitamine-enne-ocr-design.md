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
- **Lehe väljajätmine enne OCR-i** (tühjad lehed, kaaned, eraldajad).
- PDF-üleslaadimine ja mitmepildi-üleslaadimine (viimasel rasteriseerimist ei ole —
  pildid on juba olemas).

Väljas:

- Pööramine ja järjekorra muutmine. Mõlemad on olemas Manage-lehe pildiredaktoris ja
  töötavad pärast importi.
- Automaatne köitevahe pakkumine (vt eespool: ebausaldusväärne).
- Muudatused OCR-serveris.
- Muudatused OCR-järgsele poolitamisele (`admin_page_ops.split_page`) — see jääb alles,
  juba imporditud teoste jaoks on seda endiselt vaja.

## Voog

```
1 metaandmed → 2 fail → 3 POOLITAMINE (uus) → 4 ülevaatus → import
```

Muudatus 2. sammus: fail **ei lähe enam kohe** OCR-serverisse. Ta salvestatakse
`uploads/{upload_id}/source.pdf`-i ja taustal käivitub 100 DPI eelvaate-renderdus.

Sammul 3 on kaks väljapääsu:

| Olukord | Mis juhtub |
|---|---|
| Ühtki poolitust pole märgitud | PDF saadetakse tervikuna, **täpselt nagu täna**. Null uut CPU-kulu, null regressiooniriski. Väljajäetud lehed kaovad impordil, nagu praegu. |
| Vähemalt üks poolitus märgitud | Lokaalne 300 DPI läbikäik → poolitus → järjestikune nimetamine → SFTP JPG-dena `remote_work_path`-i. Väljajäetud lehti ei renderdata ega saadeta — OCR-aeg jääbki kulutamata. |

Väljajätmine üksi **ei** käivita rasteriseerimist. Reegel on tahtlikult lihtne: uut kulu
maksab ainult see, kes poolitamist kasutab.

## Backend

### Uus moodul `server/upload/prepress.py`

Olemasolevate `file_detection` / `ocr_client` / `thumbs` / `state` / `import_work` kõrvale.

| Funktsioon | Vastutus |
|---|---|
| `render_previews(upload_id)` | `pdftoppm -r 100 -jpeg` → `uploads/{id}/preview/pg_NNN.jpg`; uuendab state'i jooksvalt, et UI saaks voogesitada |
| `render_gutter_strip(id, n, x_frac)` | `pdftoppm -r 300 -x -y -W -H` — ainult riba, nõudmisel; vahemälu `uploads/{id}/strips/{n}_{x}.jpg` |
| `ink_score(id, n, x_frac)` | tindiosakaal joonel ±3 px, arvutatud 100 DPI eelvaatelt (statistikale piisab; lävi = 35. protsentiil lehe enda tonaalsusest) |
| `plan_to_sequence(plan)` | plaan → lõplik lehejärjend `[(src_page, crop|None)]`. Puhas funktsioon, testitav ilma failideta |
| `apply_and_transfer(id)` | 2. läbikäik: 300 DPI q95 → poolitus → `{slug}_pg_NNN.jpg` → SFTP → `status='processing'` |
| `is_trivial_plan(plan)` | kas plaan taandub tänasele PDF-teele |

### Mitmepildi-üleslaadimine

Praegu SFTP-b `add_image_page` iga pildi kohe OCR-serverisse. Uus tee peab pildid
esmalt kohapeal hoidma: `uploads/{upload_id}/source/pg_NNN.jpg`.

Sealt edasi on voog sama, ainult odavam:

- eelvaade = PIL `thumbnail()` allalaaditud pildilt, mitte `pdftoppm` (rasteriseerimist
  ei ole — pildid on juba pikslid);
- `render_gutter_strip` = PIL `crop()` natiivselt originaalilt;
- triviaalse plaani korral SFTP-takse originaalid muutmata, nagu täna;
- mittetriviaalse korral kärbitakse ja saadetakse pooled.

`prepress.py` peab seetõttu abstraheerima „anna leht N pikslitena" ühe sisemise
liidese taha, mille kaks teostust on PDF (`pdftoppm`) ja pildikaust (PIL). Ilma selleta
dubleeruks kogu plaaniloogika kaks korda.

Piirangud:

- ADR 0002: kõik renderdus ja SFTP taustalõimedes; marsruudid sync `def` või
  `run_in_threadpool`. Blokeeriv I/O `async def` sees on keelatud.
- CPU-kaitse: moodulitasemel `threading.Semaphore(1)` — üks rasteriseerimistöö korraga.
  Alamprotsess `os.nice(10)`.
- Python 3.9 ühilduvus: `Optional[dict]`, mitte `dict | None`.

### `state.json` laiendus

```json
"prepress": {
  "enabled": true,
  "default_split_x": 0.5,
  "preview_status": "rendering",
  "preview_done": 42,
  "pages": [
    { "n": 1, "mode": "default", "split_x": null,  "excluded": false, "ink": 0.08 },
    { "n": 3, "mode": "custom",  "split_x": 0.459, "excluded": false, "ink": 0.99 },
    { "n": 7, "mode": "nosplit", "split_x": null,  "excluded": true,  "ink": 0.02 }
  ]
}
```

`mode` eristab selgelt kolme olekut: `default` = kasuta globaalset joont, `custom` = sellel
lehel oma joon, `nosplit` = ära poolita. Ilma selleta jääks `split_x: null` mitmetähenduslikuks.

`enabled: false` tähendab, et **ükski leht ei poolitu**, sõltumata `mode` väärtusest.
`custom` väärtused jäävad alles, aga on inertsed — nii ei kaota admin tehtud tööd, kui
poolitamise vahepeal välja lülitab.

`preview_status` väärtused: `rendering` | `ready` | `error`.

`excluded` on eraldi `files[].deleted`-st: viimane tähistab OCR-**järgset** väljajätmist
ülevaatuse sammus ja jääb muutmata.

`is_trivial_plan(plan)` on tõene, kui `enabled` on väär **või** ükski leht ei anna
poolitust. Väljajätmised ei mõjuta triviaalsust — plaan, kus ainult lehti jäetakse välja,
on triviaalne ja läheb tänast teed.

### Uued staatused

`state["status"]` väärtustele lisandub kaks: `prepping` (eelvaadet renderdatakse) ja
`awaiting_split` (ootab admini otsust). Mõlemad tuleb lisada `thumbs.poll_and_sync_thumbs`
varajase väljumise loendisse, kus juba on `pending`/`uploading`/`error`/`imported`/
`collecting_images` — nende puhul SFTP-d pole vaja.

### Endpointid (`server/routers/upload.py`)

```
GET  /admin/upload/{id}/prepress          plaan + tindiskoorid + eelvaate edenemine
GET  /admin/upload/{id}/preview/{n}       100 DPI pisipilt
GET  /admin/upload/{id}/strip/{n}?x=0.5   300 DPI köitevahe-riba
POST /admin/upload/{id}/prepress          salvesta plaan
POST /admin/upload/{id}/prepress/apply    käivita 2. läbikäik (või kukub tänasele PDF-teele)
```

Kõik `require_role("admin")` ja kõik `/admin/` all. nginx `/api/files/` proksib kogu
backendi avalikult — see on kohustus, mitte stiilivalik.

Endpointid lähevad `routers/upload.py`-sse, mitte `main.py`-sse.

## Frontend

Uued failid `src/pages/upload/components/`:

- `UploadStepSplit.tsx` — sammu konteiner, vaate lüliti (kontaktleht ↔ riba), globaalse
  joone seadmine, kokkuvõte („142 lehest 138 poolitatakse, 4 jäetakse välja")
- `SplitContactSheet.tsx` — pisipiltide ruudustik, joone ülekate, tindimärgis,
  väljajätmise lüliti
- `SplitGutterStrip.tsx` — luubiriba; **virtualiseeritud**, ribasid küsitakse ainult
  nähtavale aknale (muidu 300 päringut korraga)
- `SplitPageDetail.tsx` — üksikleht lohistatava joonega

`PageImageEditorModal`-i **ei haruta ega taaskasutata**: see töötab imporditud teose ja
`work_id` peal (`/admin/work/{work_id}/page/{n}/split`), siin ei ole kumbagi ega ka
git-ajalugu.

`useUploadWizard.ts`: `step` tüüp `1 | 2 | 3` → `1 | 2 | 3 | 4`; olemasolevad
`setStep(3)` kutsed ülevaatusele viitavad → `setStep(4)`. Uus olek plaani jaoks.
`StepIndicator` saab neljanda sildi.

i18n: uued võtmed nimeruumi `upload`, **mõlemasse keelde korraga** (ADR 0011 —
`fallbackLng` on väljas, puuduv võti katkestab build'i).

Number-sisenditel (joone protsent) `type="text" + inputMode="numeric"`.

## Testimine

Backend (`tests/test_prepress.py`):

- `plan_to_sequence` — default/custom/nosplit/excluded kombinatsioonid → õige lõplik
  järjend ja nummerdus. Puhas funktsioon, ei vaja faile.
- `is_trivial_plan` — **tühi plaan peab andma tänase PDF-teekonna**, muutumatult. See on
  regressioonitesti väärtusega, mitte formaalsus.
- `ink_score` sünteetilisel pildil (must tulp teadaoleval x-il).
- `render_gutter_strip` kutsub `pdftoppm`-i õigete `-x -y -W -H` väärtustega (mock).

Frontend (`src/pages/upload/__tests__/`):

- plaani-reduktor: globaalse joone muutmine ei kirjuta üle `custom`-lehti.
- `localeParity` ja `translationKeysResolve` katavad uued võtmed automaatselt.

Väravad: `npm run typecheck`, `npm test`, `npm run lint:ci`, `.venv/bin/pytest tests/`.

## Riskid ja invariandid

1. **Uus CPU-koormus veebiserveril.** Seda kannab täna OCR-server (28 tuuma); VUTT-i
   backend on single-worker uvicorn ~300 kasutajaga. Leevendus: kulu tekib ainult
   featuuri kasutamisel, `Semaphore(1)`, `nice`. Kui see osutub liiga kalliks, on
   põgenemistee 2. läbikäigu tõstmine OCR-serverisse — **plaan-JSON ongi see liides**,
   mille taha see mahub, ülejäänut puutumata.

2. **Uus sidusus OCR-serveriga.** Meie 300 DPI / q95 peab kattuma OCR-serveri
   `PDF_DPI = 300` ja `quality=95` väärtustega. Kui need seal muutuvad, tuleb muuta ka
   siin. Kuulub ADR-i, mitte kellegi mällu.

3. **Originaal topeltlehe pilti ei säilitata.** Nii on ka täna: `split_page` viskab
   originaali minema ja lehe-JPG-d ei ole git-tracked (git hoiab ainult `.txt` + `.json`).
   Uus tee ei kaota rohkem kui vana — aga see öeldakse välja, mitte ei lasta avastada.

4. **`split_text_at_pb` heuristika ei rakendu.** Enne OCR-i teksti pole; kumbki pool saab
   oma päris OCR-i. See on rangelt parem kui `<pb/>` järgi teksti pooleks lõikamine.

5. **Poolituse kvaliteet paraneb.** Täna kärbitakse OCR-serveri JPEG-i (uuesti
   kodeeritud); uus tee kärbib värsket renderdust.

## ADR

Uus **ADR 0016 — „Poolitamine enne OCR-i: rasteriseerimine VUTT-i poolel"**. Invariandid:

- Tühi plaan = tänane PDF-tee, muutumatult.
- Plaan-JSON on liides, mille taha saab 2. läbikäigu hiljem OCR-serverisse tõsta.
- 300 DPI / q95 peab kattuma OCR-serveri `PDF_DPI`-ga.
- Automaatika on hoiataja, mitte pakkuja: tindiskoor on usaldusväärne ainult kõrge
  väärtuse suunas.
