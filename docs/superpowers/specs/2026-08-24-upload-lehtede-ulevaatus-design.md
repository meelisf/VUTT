# Upload'i lehtede ülevaatus — disainidokument

**Kuupäev:** 2026-08-24
**Issue:** #255 · **Mockup:** https://claude.ai/code/artifact/5c737053-5a33-47a6-a4e8-08fa0388f669
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

### 3. OCR-mudelit saab ülevaatuses muuta

Trükis / käsikiri valitakse metaandmete sammus, kus kasutaja ei pruugi veel kindel olla. Mitteaktiivne pool peab olema **selgelt hämaram** (hall tekst hallil), muidu ei ole ühe pilguga näha, kumb kehtib.

### 4. Valikurežiimi ei ole

Klõps pisipildil valib, Shift+klõps vahemiku, märkeruut nurgas on eraldi klõpsatav (klaviatuur). See on **täpselt `PageCard` muster lehekülgede haldusest** — sama žest, sama koht, sama välimus.

### 5. Hulgitegevused hõljuval alumisel ribal

`PageActionBar` anatoomia: `fixed`, servadest 16 px, ümarad nurgad, vari, rühmad õhukeste vertikaaljoontega, „Valitud: N" merevaigus, „Tühista valik" punaselt. Ilmub ainult valiku korral.

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

### 9. Täisvaates on „Ära OCR-i"; navigatsioon ja tegevused ühes rühmas

Praegu on täisvaates ainult „Lähtesta üldjoonele" ja „Ära poolita", ning `‹ ›` on riba vastasservas. Uus järjestus: `Ülevaatesse | ‹ › | Ära poolita · Ära OCR-i · Lähtesta üldjoonele`.

### 10. Paneeli päises valikuabid ja suuruse liugur

„Vali kõik" / „Vali poolitatud" ja pisipildi suuruse liugur — mõlemad on lehekülgede halduses olemas ja 143-lehelise töö juures vajalikud. Valikuabid **ei kuulu tegevusribale**: nad valivad, ei muuda midagi.

## Kaks olemasolevat viga, mis tulid spekki kirjutades välja

Mõlemad on **täna tootmises** ja mõlemad puudutavad otse seda, mida see töö lubab.

### A. `mode: "default"` TÄHENDAB „poolita üldjoonelt"

`default_plan()` loob kõik lehed `mode: "default"`-iga ja `effective_split_x` tõlgendab seda kui „poolita `default_split_x` pealt". Ainus, mis seda kinni hoiab, on `enabled: False`:

```python
if not plan or not plan.get("enabled"):
    return None          # ← ainus pidur
```

Seega **„vaikimisi ei poolitata" ei ole praeguse mudeliga saavutatav** lihtsalt lüliti eemaldamisega: ülevaatuse alati-nähtavaks tegemine (ehk `enabled` sisuliselt alati tõene) poolitaks kohe kõik lehed 50% pealt.

**Lahendus:** `default_plan()` loob lehed `mode: "nosplit"`-iga; „Poolita kõik" seab valitud/kõik lehed `mode: "default"`-i (= järgi üldjoont, nii et joone hilisem muutmine liigutab neid kõiki). `effective_split_x` ise ei muutu. `enabled` lakkab poolitamist väravamast — see väravab edaspidi ainult eelvaadet.

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

**Mis EI muutu:** apply kiirtee. Triviaalne plaan (poolitusi ega väljajätmisi pole) saadab OCR-serverisse endiselt **originaal-PDF-i** ega renderda ühtki 300 DPI pikslit. Kallis osa jääb opt-in-iks; odav osa muutub kohustuslikuks.

**Miks see on vahetust väärt:** eelvaade voogab (`preview_status: "rendering"`, `preview_done: N`) ja ekraan on kasutatav kohatäidetega, nagu samm 4 pärast #259. Kasutaja peab lehed niikuinii üle vaatama; praegu ta lihtsalt ei saa.

## Mudeli vahetamine — backend-mõju

`create_upload` tuletab mudeli tüübist (`meta.type.id == "Q87167"` → `hand`) ja kirjutab selle **kaugteedesse**:

```python
"remote_staging_path": f"AUTO-OCR/{ocr_model}/{upload_id}",
"remote_work_path":    f"AUTO-OCR/{ocr_model}/{upload_id}/{slug}",
```

Mudeli vahetamine ülevaatuses peab need ümber arvutama. Kaks nõuet:

1. **Ainult enne apply't.** Lubatud staatused: `awaiting_split`, `prepping`. Pärast apply't on lehed juba kaugserveris mudeli-kaustas; siis on vastus „katkesta ja alusta uuesti", mitte vaikne ümbertõstmine.
2. **Kaugteed loetakse ALATI state'ist**, mitte ei tuletata kutsekohas — see invariant on juba `feat/upload-ocr-katkestamine` plaanis ja hoiab lennus olevad upload'id töös.

**Tasub teha koos run-isolatsiooniga** (sama plaani Task 2: iga apply saab oma `run_id`). Mõlemad muudavad kaugtee arvutamist; eraldi tehes tuleb sama koht kaks korda lahti võtta.

## Andmemudel

Plaani kuju ei muutu (`prepress_plan.default_plan`): `{enabled, default_split_x, preview_status, preview_done, pages[{n, mode, split_x, excluded}]}`.

- **Vaikeplaani lehed on `mode: "nosplit"`** (vt viga A). „Poolita kõik" seab need `"default"`-i.
- `enabled` **kaotab tähenduse „kasutaja lülitas sisse"** ja väravab edaspidi ainult eelvaadet, MITTE poolitamist. `effective_split_x` ja `is_trivial_plan` ei tohi enam `enabled`-ist sõltuda. Kaaluda välja eemaldamist eraldi koristusena.
- Uusi välju ei tule. Valik (`selected`) on **puhtalt kliendi olek**, nagu lehekülgede halduses — serverisse ei salvestata.

## Liides

Uus endpoint ei ole vajalik. Olemasolevad kannavad kõik:

| Tegevus | Endpoint |
|---|---|
| Eelvaate käivitus | `POST /admin/upload/{id}/prepress/start` (kutsutakse nüüd automaatselt) |
| Plaani salvestus (sh hulgimuudatused) | `POST /admin/upload/{id}/prepress` |
| Mudeli vahetus | `PATCH /admin/upload/{id}/meta` — **vajab kaugteede ümberarvutust** |
| Rakendamine | `POST /admin/upload/{id}/prepress/apply` |

Hulgikäsk on **üks plaani salvestus**, mitte N päringut: klient koostab uue `pages` massiivi ja saadab korraga. See hoiab ka „ei kirjuta üle käsitsi seatuid" loogika ühes kohas.

## Puudutatud failid

| Fail | Muutus |
|---|---|
| `UploadStepSplit.tsx` | opt-in kaob; päis (mudel, joon, „Poolita kõik"); paneeli päis + liugur |
| `SplitContactSheet.tsx` | valik (klõps, Shift+klõps, märkeruut), ikoonisüsteem, valitud kaardi kuju |
| `SplitPageDetail.tsx` | „Ära OCR-i", tegevusriba ümberjärjestus, samad ikoonid |
| uus `SplitActionBar.tsx` | hõljuv alumine riba `PageActionBar` eeskujul |
| `prepress_plan.py` | hulgikäskude abifunktsioonid (`apply_default_to`, `set_nosplit`, `set_excluded`) |
| `routers/upload.py` | mudeli vahetus + kaugteede ümberarvutus |
| `page_source.py` | eelvaate kiiruse kommentaar (0,05 → 0,58 s/lk) |

## Riskid

| Risk | Käsitlus |
|---|---|
| Iga upload maksab eelvaate renderduse | Mõõdetud 0,58 s/lk; voogab, ekraan kasutatav kohatäidetega. 300 DPI kiirtee jääb alles. |
| Mudeli vahetus pärast apply't | Keelatud (409); UI peidab valiku pärast apply't |
| Kaks paralleelset upload'i | `RENDER_SEMAPHORE(1)` põimib lehe kaupa (#219) — juba lahendatud |
| Hulgikäsk suurel valikul | Üks salvestus, mitte N päringut |
| Staging kasvab (26 MB / 143 lk eelvaateid) | Koristatakse impordil, nagu praegu |

## Lahtised

- **Kaardi nurgatoimingud: alati nähtaval või hoveril?** Täna on `PageCard`-il **alati**. Kui liigume hoverile, tuleb see teha **mõlemas kohas korraga**, muidu tekib uus ebaühtlus.
- **Segane valik.** Käsud on ühemõttelised, aga riba võiks öelda, mitut lehte päriselt muudeti.
- **`enabled` välja saatus** (vt Andmemudel).

## Kontroll

- 143-leheline töö: ülevaatus avaneb kohe, kohatäidetega; eelvaated voogavad ~83 s jooksul
- „Poolita kõik" → 143 lehte saavad joone; käsitsi seatud joon jääb puutumata ja riba ütleb selle välja
- Valik + „Ära OCR-i" → valitud lehed muutuvad hallideks, kokkuvõte väheneb
- Mudeli vahetus enne apply't muudab kaugteed; pärast apply't tagastab 409
- Täisvaates saab lehe välja jätta ilma ülevaatesse naasmata
- **Väljajätmine ILMA poolitamiseta:** väljajäetud leht EI jõua OCR-serverisse (viga B) — kontrolli kaugkausta sisu, mitte ainult UI-d
- Puutumata plaan (ei poolitusi ega väljajätmisi) läheb endiselt originaal-PDF-ina, ilma 300 DPI renderduseta
