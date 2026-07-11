# Perspektiivikorrektsioon + "Taasta originaal" — disainidokument

**Kuupäev:** 2026-06-28
**Komponent:** lehe pildiredaktor (`PageImageEditorModal`) manage-lehel
**Staatus:** disain kinnitatud, ootab implementatsiooniplaani

## Probleem

Osad lehepildid on pildistatud nurga alt → leht on kaadris **trapetsis** (nn keystone-moonutus),
sageli ka taustaga (laud) ümber. Praegune crop/rotate tööriist (`Muuda`-tab) oskab pöörata,
kärpida ja deskew'da (telg-joondatud kast + kalle), aga **ei oska perspektiivi sirgestada**.

Lisaks: iga teisendus varundab pristine esimese versiooni `._originals/` kausta, **kuid
taastamise võimalust pole** — varukoopia on olemas, ent kasutuseta.

See on mugavusparandus (mitte hädavajadus): kohati oleks lihtsam leht korraga sirgeks
ja mõõtu saada.

## Eesmärgid

1. **Perspektiivikorrektsioon:** kasutaja asetab 4 nurka lehe tegelikele nurkadele;
   tulemus on perspektiivsirgestatud (de-warpitud) puhas ristkülik, taust välja lõigatud.
2. **Taasta originaal:** üks klikk taastab lehe esimese (pristine) versiooni.

## Mitte-eesmärgid (YAGNI)

- **Elav perspektiivsirgestatud eelvaade** — EI. Mudel on "joonista nelinurk → Rakenda → näe tulemust".
  (Elav `matrix3d`/canvas eelvaade kolmekordistaks frontendi töö; teadlikult välja jäetud.)
- Lääts-/kõverusmoonutuse korrektsioon — EI, ainult tasapinnaline perspektiiv (QUAD).
- Automaatne lehe-nurkade tuvastus (edge detection) — EI, kasutaja asetab nurgad käsitsi.
- Täielik "un-split" (teksti taasliitmine, poolte kustutus, sequence-parandus) — EI. Poolitatud
  poole "Taasta originaal" toob tagasi topeltlehe-PILDI (kasutaja croppib käsitsi); teksti ega
  poolte struktuuri ei puudutata.

(NB: minimaalne quad-valideerimine — 4 punkti, [0,1], min serv, bow-tie/convex — EI ole
"keerukas valideerimine" mille me välja jätame, vaid vajalik turvakiht; vt Backend.)

## Otsused (brainstorm)

| Otsus | Valik |
|-------|-------|
| Eelvaade | Pole vaja — joonista → Rakenda |
| Paigutus | **Integreeritud lüliti** "Muuda"-tabis (MITTE eraldi tab) |
| Taasta-nupp olek | Alati nähtav; toast kui originaali pole |
| Quad + jäme 90°/180° pööre | **Pööre lähtestab quad'i** vaikenelinurgaks (deterministlik, ei teisenda nurki) |

## Arhitektuur

### Põhiidee: perspektiiv = ala-valik vabade nurkadega

Kärpe-kast ON juba 4 nurgasangaga. Perspektiiv ja kärbe teevad sama tööd ("vali lehe ala →
väljasta puhas ristkülik"), erinevus on ainult kas nurgad on seotud (ristkülik) või vabad
(suvaline nelinurk). Seetõttu **lüliti "Muuda"-tabis**, mitte eraldi tab.

| | Perspektiiv OFF (vaikimisi) | Perspektiiv ON |
|---|---|---|
| Nurgad | ristküliku resize (seotud) | 4 vaba nurka (igaüht eraldi) |
| Serva-sangad (n/e/s/w) | olemas | peidetud (ainult 4 nurka) |
| Deskew-pöördesang | olemas | peidetud (nurgad katavad kalde) |
| Väljund serverile | telg-joondatud `crop` + `angle` | `quad` + jäme `angle` |
| Vihjetekst | praegune cropHint | "Pilt sirgestatakse ja lõigatakse nelinurga järgi mõõtu" |

**Sujuv üleminek:** kui kärpe-kast on juba joonistatud ja kasutaja vajutab "Perspektiiv",
initsialiseeritakse quad kasti 4 nurgast → jämeda ristküliku saab täpseteks nurkadeks
nihutada. Kui kasti pole, luuakse vaikenelinurk veidi pildi servadest sissepoole.

**Jäme 90°/180° pööre perspektiivirežiimis:** rakendub pildile (nagu praegu), aga
**lähtestab quad'i vaikenelinurgaks** — me EI teisenda nurki uude pööratud raami. Põhjus:
nurkade teisendamine (`rotateQuad`) on salakaval (peegelduse/vale-pöörde vead) ja
praktikas seab kasutaja orientatsiooni enne nurkade asetamist. Lähtestus on deterministlik
ja testitav.

## Backend

### `transform_page_image` laiendus (`server/admin_page_ops.py`)

Uus valikuline parameeter `quad` — 4 nurka normaliseeritud `[0..1]` koordinaatides
**rotated-display-raamis** (sama raam, mida `crop` juba kasutab), järjekord **TL, TR, BR, BL**.

Kogu olemasolev infrastruktuur jääb **muutmata ja taaskasutatud**: `work_lock`,
`._trash` varundus, `._originals` pristine, atomaarne tmp + `os.replace`, thumbnaili regen,
struktureeritud logimine.

Töötlusloogika (`PILImage` plokis, pärast `exif_transpose`):

```python
# Jäme pööre nagu praegu (CSS+ = päripäeva → Pillow -angle)
if abs(angle) >= ANGLE_EPS:
    img = img.rotate(-angle, expand=True, fillcolor=fill)

if quad is not None:
    # quad: 4 nurka [0..1] rotated-raamis (TL, TR, BR, BL)
    W, H = img.width, img.height
    pts = [(x * W, y * H) for (x, y) in quad]   # → pikslid
    TL, TR, BR, BL = pts
    # Väljundi mõõdud: keskmised servapikkused (säilitab proportsiooni)
    out_w = round((dist(TL, TR) + dist(BL, BR)) / 2)
    out_h = round((dist(TL, BL) + dist(TR, BR)) / 2)
    # Image.QUAD data: lähtenurgad järjekorras UL, LL, LR, UR (Pillow konventsioon)
    data = [TL[0], TL[1], BL[0], BL[1], BR[0], BR[1], TR[0], TR[1]]
    img = img.transform((out_w, out_h), PILImage.QUAD, data,
                        resample=PILImage.BICUBIC, fillcolor=fill)
elif crop is not None:
    box = _compute_crop_box(crop, img.width, img.height)
    if box is not None:
        img = img.crop(box)
```

**NB Pillow QUAD konventsioon:** `Image.QUAD` `data` on lähte-nelinurk järjekorras
**UL, LL, LR, UR** (ülemine-vasak, alumine-vasak, alumine-parem, ülemine-parem) ja need
mapitakse väljundristküliku vastavatesse nurkadesse. Implementatsioonis kontrolli see
Pillow versiooni dokist üle ja kata testiga (vt all).

**Vastastikune välistus:** `quad` ja `crop` ei tohi olla korraga. Kui mõlemad antud →
`raise ValueError`. No-op kaitse laieneb: `abs(angle) < ANGLE_EPS and crop is None and quad is None`.

**Quad valideerimine (`_validate_quad`, uus abifunktsioon).** Mitte "keerukas valideerimine",
vaid minimaalne turvakiht enne Pillow'd (väldib veidraid tulemusi ja segaseid hilisemaid buge):
- täpselt **4 punkti**;
- kõik väärtused **lõplikud arvud** (mitte NaN/Inf);
- iga `x`, `y` vahemikus **[0, 1]**;
- iga **serva pikkus üle min-läve** (nt ≥ 0.02 normaliseeritult);
- **ei ole self-intersecting ("bow-tie")** nelinurk (kontrolli, et vastasservad ei ristu);
- soovitavalt **kumer (convex)** — kontrolli ristkorrutiste märgi järjepidevust; mittekumer → `ValueError`.

`Image.QUAD` polygon järjekord eeldab korrektset nurkade järjestust (TL, TR, BR, BL) — vale
järjekord annaks katki tulemuse, mille bow-tie/convex kontroll suuremas osas püüab.

**Väljundmõõdu klamber:** `out_w`/`out_h` peavad olema ≥ MIN (nt 8 px), muidu `ValueError`.

`dist` on lihtne eukleidiline kaugus — lisa väike abifunktsioon või inline.

### "Taasta originaal" semantika (eksplitsiitne)

**Mida "originaal" tähendab:** lehe failinime praeguse "elujoone" (lineage) **esimene
pristine versioon** — `._originals/{work_id}/{filename}`, mis luuakse esimesel teisendusel.
Konkreetsemalt:
- **Asendamine = uus originaal.** "Asenda pilt" kutsub `clear_original_backup` → `._originals`
  nullitakse; järgmine teisendus salvestab asendatud pildi uueks pristine'iks. Seega pärast
  asendamist taastab "Taasta originaal" **asendatud pildi** (mitte originaalset esimest faili).
  See on tahtlik ja juba koodis olemas — dokumenteerime, et käitumine oleks ootuspärane.
- **Poolitatud lehed → topeltlehekülg taastatav.** Poolitamine seab **mõlema poole
  `._originals`-iks poolituseelse topeltlehekülje**. Seega "Taasta originaal" ükskõik kummal
  poolel toob tagasi terve topeltlehe (selle faili kohale), mille kasutaja croppib vastavalt.
  EI ole vaja "un-split"-i (tekstiliitmist, poolte kustutust, sequence-parandust) — see
  kasutab täpselt sama per-faili restore-mehhanismi.
  - **"Kõige algsem" allikas:** poolitamisel vali `._originals` allikaks: kui originaalil oli
    juba `._originals` (teisendati ENNE poolitamist) → kasuta seda (tõeline pristine);
    muidu poolituseelne pilt ise (= pristine skann). Nii saab alati kõige algsema topeltlehe.
  - **Forward-only:** see kehtib ENNE seda muudatust poolitatud lehtedele — nende pooltel pole
    `._originals` → `no_original`. Tagasitäide pole usaldusväärne (puudub provenance, mis pool
    millisest originaalist) → out of scope; kui kunagi vaja, vajab eraldi otsust.
  - **Provenance (valikuline, läbipaistvuse jaoks):** salvesta poolitamisel mõlema poole
    `.json`-i ka `split_source: { orig_filename, side: 'left'|'right' }`. Restore'iks pole
    vajalik (`._originals` koopia on funktsionaalne "märge"), aga selgem ja toetab tulevast
    un-split'i kui soovitakse.

**Restore puudutab ainult PILTI.** `restore_original_page_image` asendab ainult `.jpg`-faili;
`.txt`, `.json`, sequence ja failinimi jäävad muutumatuks (sama nagu `transform_page_image`).
Poolitatud poole topeltlehe-taastel jääb seega `.txt` endiseks (poole tekst) — kasutaja
korrastab teksti ise pärast pildi uut kärpimist.

**"Taasta originaal" EI OLE "Undo".** Kui kasutaja teeb hea kärpe, siis katsetab perspektiivi
ja rikub tulemuse, viskab "Taasta originaal" ära **kõik** hilisemad pildimuudatused (sh hea
kärpe), mitte ainult viimase sammu. Kinnitusdialoogi tekst peab olema selge:
*"Taastatakse lehe esimene algversioon; kõik hilisemad pildimuudatused (pööre, kärbe,
perspektiiv) kaovad."*

### Uus funktsioon `restore_original_page_image(work_id, filename, username)`

1. Path-traversal kaitse (sama muster nagu `transform_page_image`).
2. `orig_backup = ._originals/{work_id}/{filename}`. Kui puudub →
   `{"restored": False, "reason": "no_original"}`.
3. `work_lock` all: varunda praegune pilt → `._trash/{work_id}/replaced_images/` (ajatempel).
4. Kopeeri originaal tmp-faili samas kaustas → atomaarne `os.replace` → `img_path`.
5. Regenereeri thumbnail (vea korral `thumbnail_warning`, ei rollback'i — sama nagu transform).
6. **`._originals` JÄÄB alles** → leht on alati esimese versiooni juurde taastatav, ka
   pärast korduvaid muudatusi.
7. Logi (`transform_image.log` või eraldi rida, `username`, `restore`).
8. Tagasta `{"success": True, "restored": True, "filename": ..., "thumbnail_warning": ...}`.

### `split_page` muudatus (`server/admin_page_ops.py`)

Et topeltlehekülg oleks kummalt poolelt taastatav, populeerib `split_page` poolitamisel
**mõlema poole `._originals`** kirje:
1. Määra allikas: `src = ._originals/{work_id}/{orig_filename}` kui olemas, muidu poolituseelne
   pilt (`orig_img_path`, enne prügikasti liigutamist).
2. `shutil.copy2(src, ._originals/{work_id}/{left_filename})` ja sama `{right_filename}`.
3. (Valikuline) lisa mõlema poole `.json`-i `split_source: { orig_filename, side }`.
4. Ülejäänu nagu praegu (uued failid, tekst `<pb/>` juures, originaal `._trash/pages/`-i,
   git commit'id, Meili sync).

Nii "lihtsalt töötab" `restore_original_page_image` poolitatud poolel — see ei pea
poolitamisest midagi teadma; `._originals/{half}` ON juba topeltlehekülg.

### Endpoint'id (`server/routers/pages.py`)

- **Olemasolev** `admin_transform_page_image` (`POST .../page/{filename}/transform` vms) loeb
  request-bodyst lisaks `angle`/`crop` ka valikulise `quad` ja annab `transform_page_image`-le.
- **Uus** `POST /admin/work/{work_id}/page/{filename}/restore-original`
  (`require_role("admin")`) → `restore_original_page_image(...)`.

## Frontend (`src/components/PageImageEditorModal.tsx`)

### Uus olek

- `perspective: boolean` — lüliti olek (vaikimisi `false`).
- `quad: { x: number; y: number }[]` — 4 nurka normaliseeritud `[0..1]` rotated-display-raamis,
  järjekord TL, TR, BR, BL. `null`/tühi kui perspektiiv pole aktiivne.
- `activeCorner` — lohistatav nurga-indeks, hoitakse `interaction` refis (uus mode `'corner'`).

### Lüliti ja üleminek

- Toolbar'i nupp "Perspektiiv" (toggle). Ainult `tab === 'edit'`.
- ON lülitades:
  - kui `cropRect` olemas → `quad` = kasti 4 nurka (display-raamist normaliseeritud);
  - muidu → vaikenelinurk ~5% servadest sissepoole;
  - peida deskew-pöördesang ja serva-sangad (n/e/s/w).
- OFF lülitades: `quad = null`, tagasi praeguse kärpe-kasti käitumise juurde.

### Overlay-renderdus (perspektiiv ON)

- SVG overlay pildi peal (rotated-display-raamis, sama `displayW/displayH`):
  `<polygon>` ühendab 4 nurka (poolläbipaistev indigo täide + äär), 4 ringikujulist nurgasanga.
- Lohistus taaskasutab täpselt sama **"kuula aknast"** mustrit (`window` mousemove/up refide
  kaudu), mis kärpe-kastil. Nurk klambitakse `[0..1]`.
- Vihjetekst: "Aseta nurgad lehe nurkadesse. Pilt sirgestatakse ja lõigatakse nelinurga järgi mõõtu."

**Overlay täpsus (oluline):** SVG/nurgad peavad istuma TÄPSELT pildi tegelikult renderdatud
ala peal, mitte modaali/container'i peal. Overlay paigutatakse samasse `displayW × displayH`
konteinerisse, mis kärpe-kastil juba on (`overlayRef`, `inset-0`), ja koordinaadid
arvutatakse `getBoundingClientRect()` järgi **sama nähtava pildikasti** suhtes. Jälgi, et
`object-fit`, padding, zoom ega scroll ei tekitaks nihet — kuna pilt mahutatakse `fit`-iga
täpselt konteinerisse (pole `object-fit`/padding'ut), langeb see kokku olemasoleva kärpe-
loogikaga, aga implementatsioonis verifitseeri visuaalselt.

### Geomeetria (uus util `src/utils/perspectiveQuad.ts`)

Triviaalne normaliseeri/denormaliseeri (display-pikslid ↔ `[0..1]`, jagades `displayW/displayH`-ga).
**Pole** pöörde-matemaatikat nagu `rotatedCropParams` — quad antakse serverile rotated-raamis,
server rotate + QUAD on järjepidev. Util eksponeerib teste (nurgad ekraanil ↔ normaliseeritud).

### `doApply` — `tab === 'edit'` haru laiendus

- **perspektiiv ON:** saada `{ angle: grossAngle, quad: [4 normaliseeritud nurka] }`
  (deskew `boxAngle` EI kasutata — nurgad katavad kalde).
- **perspektiiv OFF:** praegune tee muutmata (`angle = gross + deskew`, telg-joondatud `crop`).
- `transformPageImage` (`src/services/pageService.ts`) saab valikulise `quad` argumendi;
  saadab body's `quad` (kui antud) `crop` asemel.
- Edu: `onPagesChanged()` + cache-bust → eelvaade värske, sama anchor/toast-loogika.

**API-skeem (TS, discriminated union → välistab `crop` + `quad` kompileerimisajal):**

```typescript
type Quad4 = [Pt, Pt, Pt, Pt];           // TL, TR, BR, BL, normaliseeritud [0..1]
interface Pt { x: number; y: number }

type TransformRequest =
  | { angle?: number; crop?: CropRect; quad?: never }
  | { angle?: number; quad?: Quad4; crop?: never };
```

### "Taasta originaal" nupp

- Päises, **asenda-pildi nupu kõrval** — alati nähtav, **sõltumatu tabist** (pildi-tasandi
  operatsioon). Ikoon `Undo2` või `History`.
- Klikk → kinnitusdialoog (destruktiivne: viskab kõik muudatused minema), taaskasutab
  olemasolevat `showConfirm` mustrit (eraldi lipp, nt `showRestoreConfirm`).
- Kinnitusel `POST .../restore-original`:
  - `restored: false, reason: "no_original"` → toast "Originaali pole (lehte pole muudetud)".
  - `restored: true` → cache-bust + **lähtesta kogu lokaalne editor-olek**
    (`cropRect`, `quad`, `boxAngle`, `grossAngle`, `perspective`), toast "Originaal taastatud".
    (`resetTransforms` katab enamiku; lisa `perspective=false` ja `quad=null`.)
  - Frontend paneb cache-bust query-parameetri ise → restore-vastus ei pea `updated_at`/
    `version` tagastama (piisab edu-signaalist).
- i18n: uued võtmed `et` ja `en` (`manage.editor.*` ja `manage.restoreOriginal*`).

## Servajuhud

- **Degenereerunud / vigane nelinurk** (nurgad kokku, bow-tie, mittekumer, väljaspool [0,1]):
  `_validate_quad` → `ValueError` → frontend näitab veateadet. Lisaks MIN out_w·out_h kaitse.
- **No-op:** quad ≈ täis-pilt (kõik nurgad servades) → Rakenda lubatud (puhas de-warp on
  legitiimne), ei blokeeri.
- **Quad + gross-pööre perspektiivirežiimis:** pööre **lähtestab quad'i** vaikenelinurgaks
  (deterministlik; me ei teisenda nurki uude raami). Käitumine testitud.
- **Thumbnaili regen ebaõnnestub:** `thumbnail_warning`, ei rollback'i (sama nagu praegu).
- **Korduv taastamine:** `._originals` ei kustutata → alati taastatav.
- **Poolitatud lehe restore:** uued poolitused → `._originals` = topeltlehekülg, restore toob
  selle tagasi (kasutaja croppib). Vanad (enne muudatust) poolitused → `no_original`. Vt
  "Taasta originaal" semantika.

## Testid

### Backend (`server/tests/`)
- **Värviliste nurgamarkeritega QUAD-test (kriitiline):** sünteetiline pilt nurkadega
  TL=punane, TR=roheline, BR=sinine, BL=kollane. Pärast transformi kontrolli, et iga värv
  jõuab väljundi ÕIGESSE nurka. **See püüab kinni peegelduse ja vale punktijärjekorra** —
  pelk mõõtude kontroll seda ei tee.
- `transform_page_image` quad'iga: trapets → väljund õige mõõt (keskmised servapikkused).
- Pillow QUAD `data` järjekorra test (UL, LL, LR, UR konventsioon) — kinnita versiooni dokist.
- `_validate_quad`: bow-tie (self-intersecting) → `ValueError`; mittekumer → `ValueError`;
  väljaspool [0,1] → `ValueError`; ≠4 punkti → `ValueError`; liiga lühike serv → `ValueError`;
  NaN/Inf → `ValueError`.
- `quad` + `crop` korraga → `ValueError`.
- Degenereerunud (liiga väike out_w/out_h) → `ValueError`.
- No-op (angle=0, crop=None, quad=None) → `changed: False`.
- `restore_original_page_image`: originaali olemasolul taastab; puudumisel `reason: no_original`;
  `._originals` jääb alles pärast taastamist.
- **Poolitamine populeerib `._originals`:** pärast `split_page` on mõlemal poolel
  `._originals/{half}` = poolituseelne topeltlehekülg; restore kummalgi poolel toob selle
  tagasi. Kui originaalil oli eelnev `._originals`, kasutatakse SEDA (pristine eelistus).
- **Vana poolitus (enne muudatust):** poolel pole `._originals` → `no_original`.

### Frontend (`src/utils/__tests__/` vms)
- `perspectiveQuad.ts` ümarsõit: display-pikslid → normaliseeritud → display-pikslid.
- Gross-rotate perspektiivirežiimis **lähtestab quad'i vaikenelinurgaks** (oleku-test).
- (Modaali interaktsioon — käsitsi test + olemasolev Playwright-harness vajadusel.)

## Failid mida puudutab

| Fail | Muudatus |
|------|----------|
| `server/admin_page_ops.py` | `transform_page_image` + `quad`; `_validate_quad`; uus `restore_original_page_image`; `split_page` populeerib mõlema poole `._originals` |
| `server/routers/pages.py` | `quad` body's; uus restore-original endpoint |
| `src/services/pageService.ts` | `transformPageImage` + valikuline `quad`; restore-original kutse |
| `src/components/PageImageEditorModal.tsx` | perspektiivi lüliti, quad overlay, taasta-nupp |
| `src/utils/perspectiveQuad.ts` | UUS — normaliseeri/denormaliseeri |
| `src/locales/{et,en}/workspace.json` | uued i18n võtmed |
| `server/tests/...`, `src/utils/__tests__/...` | testid |

## Deploy

- Backend (Docker, `--no-cache` kohustuslik): `git pull && docker compose build --no-cache backend && docker compose up -d backend`.
- Frontend: `npm run typecheck` (gate) → `npm run build` → `rsync -avz dist/ vutt:~/VUTT/dist/`.
- Meilisearchi EI puuduta (failinimi/tekst/sequence muutumatud — sama nagu praegune transform).
