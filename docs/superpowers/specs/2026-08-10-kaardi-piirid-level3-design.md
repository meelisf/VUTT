# Kaardi halduspiiride granulaarsus ja hover-esiletõst

Kuupäev: 2026-08-10
Seotud kood: `server/prosopography/historical_regions.py`, `src/prosopography/components/HistoricalMapLayer.tsx`

## Probleem

`/persons` kaardivaade joonistab kaks visuaalselt eraldiseisvat süsteemi üksteise peale:

1. **OHM-i aluskaart** (MapLibre-vektorkiht) näitab silte ja peenikesi piirjooni
   halduskihtidelt 2–4. Neid tuunitakse `enhanceAdministrativeReadability()`-s.
2. **VUTT-i oma piirkonnakiht** (`vutt-historical-regions`) küsib Overpassist
   **ainult `admin_level=2`** ning annab neile värvitäite, piirjoone ja hover-tooltipi.

Sellest tekivad kaks kaebust:

- **Granulaarsus.** 1650. aasta Euroopas on `Sacrum Imperium Romanum` üks level-2
  polügoon. Selle sees olevate üksuste nimed on aluskaardilt loetavad
  (`Churfürstenthum Baiern`, `Erzstift Magdeburg`, …), aga VUTT-i kiht neid ei tunne:
  need on kõik ühe suure „Saksa-Rooma riigi" täite all. Kõrval seisavad aga
  Rootsi, Venemaa ja Taani-Norra omaette üksustena. Kasutajale näib see
  ebajärjekindlana.
- **Hover.** Esiletõst on liiga vaoshoitud (täide 0,10 → 0,24, joon 1 px → 2,5 px
  sama summutatud tooniga). Reljeefse aluskaardi peal ei loe piir välja.

### Mõõdetud lähteandmed (OHM Overpass, 1650-01-01)

Euroopa bbox `(30, −40, 70, 80)`:

| admin_level | üksusi | näited |
|---|---|---|
| 2 | 56 | Sacrum Imperium Romanum, Konungariket Sverige, Danmark-Norge, Rzeczpospolita Obojga Narodów |
| 3 | 22 | 10 Reichskreisi, Brandenburg-Preußen, Korona Królestwa Polskiego, Země Koruny české |
| 4 | 210 | Churfürstenthum Baiern, Erzstift Magdeburg, Bremen-Verden, ~45 vaba riigilinna |
| 5 | 93 | Markgrafschaft Oberlausitz, Grafschaft Tecklenburg |

Praeguse Euroopa snapshot'i suurus tootmises: **90 kB gzip** (56 polügooni).

## Otsused

**Granulaarsus: level 2 + 3.** Teadlikult kõige odavam katse — 22 lisaüksust
Euroopa kohta. Kirja pandud reservatsioon: `Bayerischer Reichskreis` **ei ole**
sama mis Kur-Baieri, ja keisririigi ringkonnad võivad segadust ka suurendada.
Kui katse seda näitab, on järgmine samm level 4. Sellepärast peab andmemudel
tegema taseme vahetuse triviaalseks: hierarhia­arvutus ei tohi olla level-3
spetsiifiline.

**Katusüksus: suumist sõltuv.** Väljasuumitult üks impeerium, sissesuumitult
selle osad.

**Värv: ainult hover tugevamaks.** Baastäide, püsijoon ja palett jäävad
puutumata. (Kaalutud ja kõrvale jäetud: naabrusgraafi-põhine värvimine,
küllastunum palett, tugevam püsijoon.)

**Tooltip on kaardi kõige informatiivsem osa** ja ei tohi kuskil suumitasemel
tühjaks jääda. See piirab, kui radikaalselt katusüksus tohib kaduda.

## Lahendus

### 1. Andmed — `server/prosopography/historical_regions.py`

**Päring.** `_build_overpass_query` küsib mõlemat taset:

```
relation["boundary"="administrative"]["admin_level"~"^[23]$"](bbox)
(if: <sama kuupäevafilter>);
```

Tasemete komplekt tuleb ühest moodulikonstandist (nt `ADMIN_LEVELS = (2, 3)`),
et level-4-le üleminek oleks ühe rea muudatus.

**Uued feature-omadused** (`_normalize_geojson`):

| Omadus | Sisu |
|---|---|
| `admin_level` | arv (2 või 3) — renderduse filtri ja hoveri valiku alus |
| `parent_name` | kanooniline nimi kõrgemal tasemel üksusest, mis selle sisaldab |
| `parent_label_et`, `parent_label_en` | sama, lokaliseeritult |

**Vanema leidmine.** Üldine, mitte level-3 spetsiifiline: iga feature'i kohta,
mille `admin_level` ei ole komplekti väikseim (ehk mis ei ole hierarhia tipp),
otsitakse kandidaatide hulgast (madalama
`admin_level`-i väärtusega feature'id) see, mille polügoon katab antud feature'i
`representative_point()`-i. Kui punkt ei lange ühessegi, valitakse suurima
lõikumis­pindalaga kandidaat. Kui kandidaate ei ole, jäävad `parent_*` väljad
`None`-iks — see on lubatud olek (nt Brandenburg-Preußen ulatub HRR-ist välja,
Korona Królestwa Polskiego vanem on Rzeczpospolita).

Arvutus tehakse ühe korra ekstraheerimise ajal, mitte päringu ajal; tulemus
läheb cache'i.

**Cache'i versioonivõti.** `_pinned_cache` ja ketta-cache võti on praegu
`(year, south, west, north, east)`. Uue väljakujuga vastus **ei tõrjuks vana
välja**: `_warm_default_snapshot_once` loeb kinnistatud snapshot'i
`_read_disk_cache(KEY, None)`-ga (vanus ei loe) ja värskendab alles 7 päeva
pärast — vana kujuga snapshot serveeritaks kuni nädal. Seetõttu lisandub võtme
algusesse `SCHEMA_VERSION` konstant. Vanad failid muutuvad leidmatuks ja
tõrjutakse `DISK_CACHE_MAX_ENTRIES` piiriga tavakorras välja; eraldi
migratsiooni ega käsitsi puhastust ei ole vaja.

**Maht.** Reichskreisid on suured polügoonid. Hinnang Euroopa snapshot'ile
120–150 kB gzip (praegu 90 kB). Tegelik number mõõdetakse enne valmis­kuulutamist.
Kui tulemus ületab 180 kB, tõstetakse level-3 feature'ite
lihtsustus­tolerantsi (`geometry.simplify`) seni, kuni maht mahub.

### 2. Renderdus — `src/prosopography/components/HistoricalMapLayer.tsx`

Praegune üks täite- ja üks joonekiht asendub **kahe kihipaariga**, kumbki
filtriga `['==', ['get', 'admin_level'], N]`. Level-2 paar on all, level-3 paar
selle peal; mõlemad lisatakse endiselt `admin_country_lines_z10_case` ette,
et aluskaardi sildid jääksid peale.

Läbipaistvused on suumi funktsioonid (`interpolate` üle ~1 suumiastme, mitte hüpe):

| Kiht | Väljasuumitult | Sissesuumitult |
|---|---|---|
| L2 täide | 0,10 | 0,02 |
| L2 joon | 1 px / 0,5 | 1,8 px / 0,8 |
| L3 täide | 0 | 0,10 |
| L3 joon | 0 | 1 px / 0,5 |

**Miks L2 täide 0,02, mitte 0.** Reichskreisid ei katnud kogu impeeriumi —
ringkondadest jäid välja mh Itaalia läänialad, seega tekivad impeeriumi sisse
katmata augud. Ilma jäänuktäiteta poleks nendes
aukudes midagi hover'ida ja tooltip kaoks. 0,02 on silmale märkamatu, aga hoiab
feature'i `queryRenderedFeatures` jaoks tabatavana. (Nulliga sõltuks käitumine
MapLibre'i sisemisest detailist, kas nullläbipaistvusega kiht on veel
päritav — sellele ei toetuta.)

**Lävend.** Vaikevaade on `PersonsMap.tsx:259` `zoom={5}` Baltikumi keskmega ja
peab näitama **juba ringkondi**; kokkutõmbumine HRR-iks toimub alles Euroopa-
ülevaates. Avaldised kirjutatakse MapLibre'i suumis; täpne arvväärtus
kalibreeritakse brauseris, sest `maplibre-gl-leaflet` võib Leafleti suumist
nihkes olla. Lähtepunkt: üleminek Leaflet-suumi ≈ 4,5 juures.

### 3. Hover ja tooltip

**Valik.** `featureAt()` küsib **esmalt level-3 täitekihilt, seejärel level-2
omalt** ja võtab esimese leitu. Kõige spetsiifilisem üksus võidab; kahemõttelisust
kattuvate polügoonide vahel ei teki.

**Tooltip** (`regionTooltipContent`) saab kolmanda elemendi: üksuse nimi
rasvaselt (nagu praegu), olemasolev aastavahemik, ning vanema nimi vaiksemas
kirjas, kui `parent_label_*` on olemas. Uusi i18n-võtmeid ei lisandu — kuvatakse
ainult nimed, keelevalik käib olemasoleva `lang`-loogikaga. ADR 0011 väravaid
see ei puuduta.

**Esiletõst** (ainus värvimuudatus):

| Omadus | Praegu | Uus |
|---|---|---|
| täide hover'il | 0,24 | 0,42 |
| joone laius hover'il | 2,5 px | 4 px |
| joone läbipaistvus hover'il | 0,95 | 0,95 (jääb) |
| valge „casing" joon | — | ~7 px, `rgba(255,255,255,0.85)`, ainult hover'il |

Casing-joon on eraldi joonekiht **põhijoone all** ja on nähtav ainult hoveritud
feature'il. See on see, mis paneb piiri lugema tumeda reljeefse tausta peal.
Casing kehtib mõlemale tasemele.

`setFeatureState` kasutab endiselt feature ID-d (`relation_id`), mis on
tasemete üleselt unikaalne — kahe allika segunemise ohtu ei ole.

## Testid

`tests/test_historical_regions.py` laieneb:

- `_build_overpass_query` sisaldab mõlemat haldustaset ja säilitab kuupäevafiltri
- `_normalize_geojson` kirjutab igale feature'ile `admin_level`-i arvuna
- sisaldava level-2 polügooniga level-3 feature saab õiged `parent_*` väljad
- ilma sisaldava vanemata level-3 feature ei kuku läbi, `parent_*` on `None`
- cache'i võti sisaldab skeemi­versiooni: vana kujuga kettafail ei rahulda uut päringut

Frontendi muudatus on peamiselt MapLibre'i paint-avaldised; automaattestide
asemel kontrollitakse localhostil silmaga (vaikevaade + väljasuumitud
Euroopa-vaade + hover mõlemal tasemel + auk HRR-i sees).

## Väravad

`npm run typecheck`, `npm test`, `npm run lint:ci`, `.venv/bin/pytest tests/`.

## Väljaspool skoopi

- Level 4 / 5 üksused (järgmine samm, kui ringkonnad ei rahulda)
- Naabrusgraafi-põhine värvimine, küllastunum palett, tugevam püsijoon
- Piirkonna klikkimine → filtreerimine isikute järgi
- Aluskaardi (`enhanceAdministrativeReadability`) sildi- ja joonestiili muutmine
