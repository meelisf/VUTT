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

### MapLibre'i käitumine, millele lahendus toetub

Kontrollitud paigaldatud versioonist `maplibre-gl@5.24.0`
(`node_modules/maplibre-gl/dist/maplibre-gl.d.ts:12144–12155`):

- `queryRenderedFeatures()` **jätab välja** kihid, mille `visibility` on `"none"`,
  ja kihid, **mille suumivahemik ei kata praegust suumi**.
- `queryRenderedFeatures()` **kaasab** kihid, millel puudub nähtav panus —
  sealhulgas kihid, mille `opacity` või värvi alfa on **0**.
- Tulemus on järjestatud: *„The topmost rendered feature appears first … subsequent
  features are sorted by descending z-order."*

Kaks tagajärge, mis on lahenduses otseselt ära kasutatud:

1. Läbipaistvus 0 **ei** peida feature'it hiire eest. Seega ei ole vaja jäänuktäidet,
   et level-2 üksus jääks tabatavaks — ja **seega peab interaktiivsus olema
   suumist sõltuv eraldi ja selgesõnaliselt**, muidu tagastaks Euroopa-ülevaade
   tooltipiks „Bayerischer Reichskreis", kuigi kasutaja näeb ainult
   „Sacrum Imperium Romanum".
2. Sama kihi sees võidab **pealmine** feature. Kuna `_normalize_geojson` sordib
   feature'id pindala järgi kahanevalt ja GeoJSON-allikas renderdab
   andmejärjekorras, on pealmine ühtlasi väikseim. See annab „kõige spetsiifilisem
   üksus võidab" ka **taseme sees**, ilma eraldi mehhanismita.

## Otsused

**Granulaarsus: level 2 + 3.** Teadlikult kõige odavam katse — 22 lisaüksust
Euroopa kohta. Kirja pandud reservatsioon: `Bayerischer Reichskreis` **ei ole**
sama mis Kur-Baieri, ja keisririigi ringkonnad võivad segadust ka suurendada.
OSM-i `admin_level` vastab eri jurisdiktsioonides üksteisele ainult ligikaudselt;
varauusaegsete andmete puhul on see lahknevus tõenäoliselt veel suurem. Katsel on
seetõttu **kirjalik edukriteerium** (vt allpool). Kui katse kukub läbi, on järgmine
samm level 4 — ja andmemudel peab selle vahetuse tegema ühe konstandi muudatuseks,
mistõttu hierarhia­arvutus ei tohi olla level-3 spetsiifiline.

**Katusüksus: suumist sõltuv.** Väljasuumitult üks impeerium, sissesuumitult
selle osad. **Nii renderdus kui hit-test** järgivad sama lävendit.

**Värv: ainult hover tugevamaks.** Baastäide, püsijoon ja palett jäävad
puutumata. (Kaalutud ja kõrvale jäetud: naabrusgraafi-põhine värvimine,
küllastunum palett, tugevam püsijoon.)

**Tooltip on kaardi kõige informatiivsem osa** ja ei tohi kuskil suumitasemel
tühjaks jääda ega näidata üksust, mida kasutaja ei näe.

**Puuduv `parent` on parem kui vale `parent`.** Vanem on tooltipis lisainfo, mitte
kandev väide; kaheldava kattuvuse korral jäetakse ta välja.

## Lahendus

### 1. Andmed — `server/prosopography/historical_regions.py`

**Päring.** `_build_overpass_query` küsib mõlemat taset:

```
relation["boundary"="administrative"]["admin_level"~"^[23]$"](bbox)
(if: <sama kuupäevafilter>);
```

Regex genereeritakse moodulikonstandist `ADMIN_LEVELS = (2, 3)`, et level-4-le
üleminek oleks ühe rea muudatus.

**Uued feature-omadused** (`_normalize_geojson`):

| Omadus | Sisu |
|---|---|
| `admin_level` | arv (2 või 3) — renderduse filtri ja hoveri valiku alus |
| `parent_name` | kanooniline nimi lähima kõrgema tasandi üksusest, mis selle sisaldab |
| `parent_label_et`, `parent_label_en` | sama, lokaliseeritult |

**Vanema leidmine.** Tasemest sõltumatu, `ADMIN_LEVELS`-i suvalise komplekti jaoks:

1. Lapsele tasemel *L* vaadatakse kandidaattasemeid **lähimast ülespoole**:
   kõigepealt suurim komplekti tase, mis on väiksem kui *L*, siis järgmine jne.
   (`(2,3,4)` puhul otsib level 4 kõigepealt level-3, alles siis level-2 vanemat —
   muidu võiks L4 hüpata otse L2 alla ja hierarhia sõltuks iteratsioonijärjekorrast.)
2. Ühel tasemel loetakse kandidaat vanemaks ainult siis, kui
   **`lõikumise pindala / lapse pindala ≥ PARENT_MIN_CONTAINMENT` (0,75)**.
   Kvalifitseerunutest võidab suurima suhtega kandidaat.
3. Kui ükski tase ei anna kvalifitseerunud kandidaati, jäävad `parent_*` väljad
   `None`-iks. See on **täiesti lubatud olek**, mitte veaolukord.

Reegel on tahtlikult üks arv, mitte „representative point pluss kattuvuslävi":
osaliselt kattuvad üksused peavad kukkuma läbi, mitte saama nõrgalt põhjendatud
vanema. Kandev näide on **Brandenburg-Preußen**, mille üks osa (Brandenburg) on
HRR-is ja teine (Hertsogiriik Preisimaa) väljas — 0,75 lävi annab sellele
tõenäoliselt `parent = None`, mis on tooltipis ausam kui „Sacrum Imperium Romanum".

Pindalad arvutatakse projekteerimata kraadides. See on suhtena lubatav, sest
lugeja ja nimetaja on sama laiuskraadi ümbruses ja moonutus taandub suures osas
välja; lävi 0,75 on servamürast piisavalt kaugel.

Arvutus tehakse ühe korra ekstraheerimise ajal, mitte päringu ajal; tulemus
läheb cache'i.

**Cache'i variandivõti.** `_pinned_cache` ja ketta-cache võti on praegu
`(year, south, west, north, east)`. Sellest ei piisa kahel põhjusel:

- Uue väljakujuga vastus ei tõrjuks vana välja. `_warm_default_snapshot_once`
  loeb kinnistatud snapshot'i `_read_disk_cache(KEY, None)`-ga (vanus ei loe) ja
  värskendab alles 7 päeva pärast — vana kujuga snapshot serveeritaks kuni nädala.
- Kui hiljem muuta ainult `ADMIN_LEVELS = (2, 3, 4)`, sobiks vana L2+L3 snapshot
  endiselt sama võtmega ja **level 4 ei ilmuks kunagi** — see lööks otse vastu
  eesmärki, et taseme vahetus on ühe rea muudatus. Sama kehtib
  lihtsustus­profiili muutmisel.

Seetõttu läheb võtme algusesse

```python
CACHE_VARIANT = (SCHEMA_VERSION, ADMIN_LEVELS, SIMPLIFY_PROFILE_VERSION)
```

Vanad failid muutuvad leidmatuks ja tõrjutakse `DISK_CACHE_MAX_ENTRIES` piiriga
tavakorras välja; eraldi migratsiooni ega käsitsi puhastust ei ole vaja.

**Maht.** Reichskreisid on suured polügoonid. Hinnang Euroopa snapshot'ile
120–150 kB gzip (praegu 90 kB). Tegelik number mõõdetakse enne
valmis­kuulutamist. **180 kB on ülevaatuse käivitaja, mitte automaatne värav:**
selle ületamisel vaadatakse geomeetria ja lihtsustus üle ning tehakse teadlik
otsus. Automaatset „simplify seni, kuni mahub" **ei tehta** — `shapely.simplify`
säilitab topoloogia geomeetria sees, aga mitte naaberpolügoonide vahel, nii et
agressiivsem lihtsustamine võib tekitada naabrite vahele pilusid, mis 7 px
casing-joone ja hit-testimise juures muutuvad nähtavaks. 15 kB lisamaht on
odavam kui ajalooliste piiride moonutamine.

### 2. Renderdus — `src/prosopography/components/HistoricalMapLayer.tsx`

Praegune üks täite- ja üks joonekiht asendub **kahe kihipaariga**, kumbki
filtriga `['==', ['get', 'admin_level'], N]`. Level-2 paar on all, level-3 paar
selle peal; mõlemad lisatakse endiselt `admin_country_lines_z10_case` ette,
et aluskaardi sildid jääksid peale.

**Üks jagatud lävend.** Eksporditud konstant `REGION_DETAIL_ZOOM` (MapLibre'i
suumiskaalas) on **ainus** tõe allikas nii paint-avaldistele kui hit-testile.
Paint interpoleerib selle ümber (`REGION_DETAIL_ZOOM ∓ 0,5`), hit-test võrdleb
sellega otse. Nii ei saa renderdus ja interaktiivsus lahku minna.

| Kiht | Alla lävendi | Üle lävendi |
|---|---|---|
| L2 täide | 0,10 | **0** |
| L2 joon | 1 px / 0,5 | 1,8 px / 0,8 |
| L3 täide | 0 | 0,10 |
| L3 joon | 0 | 1 px / 0,5 |

L2 täide läheb päriselt nulli: dokumenteeritud käitumise järgi jääb feature
`queryRenderedFeatures` jaoks tabatavaks ka läbipaistvusega 0, nii et
augud HRR-i sees (ringkondadest jäid välja mh Itaalia läänialad) säilitavad
tooltipi ilma nähtava jäänuktäiteta.

**Lävendi väärtus.** Vaikevaade on `PersonsMap.tsx:259` `zoom={5}` Baltikumi
keskmega ja peab näitama **juba ringkondi**; kokkutõmbumine HRR-iks toimub alles
Euroopa-ülevaates. Konstant on MapLibre'i suumis, sest paint-avaldised kasutavad
seda; `maplibre-gl-leaflet` võib Leafleti suumist nihkes olla, nii et täpne arv
kalibreeritakse brauseris. Lähtepunkt: üleminek Leaflet-suumi ≈ 4,5 juures.

### 3. Hover ja tooltip

**Kihivalik on suumist sõltuv.** Puhas funktsioon:

```ts
regionQueryLayers(zoom: number): string[]
// zoom < REGION_DETAIL_ZOOM  → [L2_FILL]
// zoom >= REGION_DETAIL_ZOOM → [L3_FILL, L2_FILL]
```

`featureAt()` võtab suumi **MapLibre'i kaardilt** (`mapLibre.getZoom()`), mitte
Leafletilt — nii on paint ja hit-test samas koordinaatsüsteemis. Kihte küsitakse
loetelu järjekorras ja võidab esimene kiht, mis üldse midagi tagastab; L2 jääb
seega fallback'iks L3-augu kohal.

Tooltip vahetub täpselt lävendil — üks selge punkt, sest tooltip ise
interpoleeruda ei saa. Renderdus on seal parajasti üleminekuvahemiku keskel
(L3 ≈ pool läbipaistvusest), mis on tahtlik: vahetus toimub siis, kui L3 on
juba nähtav.

**Kahemõttelisus.** L3 → L2 prioriteet on üheselt määratud. Sama taseme sees
(nt Brandenburg-Preußen vs Obersächsischer Reichskreis, mille liige Brandenburg
ajalooliselt oli) võib `queryRenderedFeatures` tagastada mitu kattuvat feature'it;
võtame **esimese**, mis on z-order'i järgi pealmine ja pindala-kahanevast
sortimisest tulenevalt **väikseim**. See on tahtlik reegel, mitte juhus, ja
toetub eespool tsiteeritud dokumentatsioonile.

**Hover'i puhastus suumimisel.** Kui kasutaja hoiab hiirt paigal ja suumib üle
lävendi, uut `mousemove`'i ei tule ning vana esiletõst + tooltip jääksid külge —
vale tasemega. `zoomstart` puhastab hover-oleku, `zoomend` arvutab selle viimase
teadaoleva hiirekoha põhjal uuesti.

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

## Katse edukriteerium

Level 3 on **katse**, mitte lõppseis. Hinnang antakse kuuel kontrollpunktil
vaikevaates (Leaflet zoom 5) ja neid vaadatakse enne merge'i:

| Kontrollpunkt | Ootus |
|---|---|
| Baieri | Kas kasutaja saab tooltipiks üksuse, mis vastab aluskaardil nähtavale nimele? |
| Brandenburg | Kas Brandenburg-Preußen ja Obersächsischer Reichskreis kattuvus loeb välja või tekitab müra? |
| Magdeburg | Level-4 üksus ilma oma level-3 katteta — mida kasutaja saab? |
| Böömimaa | `Země Koruny české` level-3 üksusena |
| Poola-Leedu | `Korona Królestwa Polskiego` L3 vs `Rzeczpospolita` L2 — kas vanem on õige? |
| Rootsi / Baltikum | Piirkond ilma level-3 katteta: kas L2 käitub muutumatult? |

**Läbikukkumise reegel:** kui zoom 5 juures annab level 3 kasutajale süstemaatiliselt
kummalisema üksuse kui aluskaardil nähtav nimi (nt „Bayerischer Reichskreis"
seal, kus aluskaart ütleb „Churfürstenthum Baiern"), loetakse katse
läbikukkunuks ja `ADMIN_LEVELS` muudetakse `(2, 4)`-ks. Cache invalideerub
`CACHE_VARIANT`-i tõttu automaatselt.

### Mõõdetud tulemused (2026-08-10)

**Maht.** Euroopa 1650 snapshot **124,7 kB gzip** (varem 90 kB), 68 piirkonda:
49 × level 2, 19 × level 3. Alla 180 kB lävendi — lihtsustusprofiili ei muudetud,
`SIMPLIFY_PROFILE_VERSION` jääb 1.

**Suumilävend.** `maplibre-gl-leaflet` seab MapLibre'i suumiks alati
`leafletZoom - 1` (`leaflet-maplibre-gl.js`, viis kohta). Seega on
`REGION_DETAIL_ZOOM = 3.5` **tuletatud, mitte kalibreeritud katse-eksituse teel**:
±0,5 üleminekuriba katab ML 3,0…4,0, mis on täpselt Leaflet 4 (Euroopa-ülevaade,
ainult katusüksus) → Leaflet 5 (vaikevaade, ainult alamüksused).

**Vanema määramine.** 19-st level-3 üksusest sai vanema 14. Kontrollitud
piirjuhud:

| Üksus | Kattuvus | Tulemus |
|---|---|---|
| Brandenburg-Preußen | 0,61 HRR-iga | `None` ✓ — täpselt see juhtum, mille jaoks lävi tehti |
| Korona Królestwa Polskiego | 0,71 Rzeczpospolitaga | `None` — ajalooliselt vale tagasilükkamine |
| Lietuvos Didžioji Kunigaikštystė | — | `Rzeczpospolita Obojga Narodów` ✓ |
| Bayerischer Reichskreis jt 7 ringkonda | — | `Sacrum Imperium Romanum` ✓ |
| Herzogtum Kurland und Semgallen | — | `Rzeczpospolita Obojga Narodów` ✓ |
| Svenska Ingermanland | — | `Konungariket Sverige` ✓ |
| Regnum Neapolitanum, Zaporoże, Principatus Oneliae | 0,00–0,04 | `None` ✓ (tõesti ei kuulu ühegi L2 sisse) |

**Otsus lävendi kohta:** `PARENT_MIN_CONTAINMENT` jääb **0,75**, kuigi see maksab
Poola Krooni õige seose. Põhjus: 0,65 peale langetamine jätaks Brandenburgi
0,61-ni vaid 4 punkti varu, ja üks OHM-i geomeetriaparandus võiks ta üle lävendi
lükata — siis väidaks tooltip täpselt seda, mille vältimiseks reegel olemas on.
Poola Krooni 29% lahknevus on OHM-i kahe polügooni servade erinevus, mitte
ajalugu; õige parandus on ülesvoolu, mitte lävendi lõdvendamine.

**Visuaalsed kontrollpunktid:** teadlikult jäetud päris kasutuse otsustada.
Mõõdetav pool (maht, lävend, vanemate määramine) on kontrollitud; kas
keisririigi ringkonnad on kasutajale mõistlik üksus, selgub tootmises. Kui ei
ole, on järgmine samm `ADMIN_LEVELS = (2, 4)` — cache invalideerub ise.

## Testid

**Backend** — `tests/test_historical_regions.py` laieneb:

- `_build_overpass_query` sisaldab mõlemat haldustaset ja säilitab kuupäevafiltri
- `_normalize_geojson` kirjutab igale feature'ile `admin_level`-i arvuna
- täielikult sisalduv level-3 feature saab õiged `parent_*` väljad
- alla `PARENT_MIN_CONTAINMENT`-i kattuv level-3 feature saab `parent_* = None`
  (Brandenburg-Preußeni juhtum)
- kolmetasemelise komplekti korral valitakse **lähim** ülemine tase, mitte tipp
- cache'i võti sisaldab `CACHE_VARIANT`-i: `ADMIN_LEVELS`-i muutmine teeb vana
  kettafaili leidmatuks

**Frontend** — pärast seda muudatust ei ole tegu enam ainult paint-avaldistega,
vaid päris valikuloogikaga. Puhtad funktsioonid testitakse ilma MapLibre'i
mockimata:

- `regionQueryLayers(zoom)`: alla lävendi ainult L2; üle lävendi L3 enne L2
- esimese mittetühja kihi valik: L3-tabamus võidab; L3-augu kohal langetakse
  tagasi L2-le; kummastki tabamust puudumisel `null`

**Käsitsi kontroll localhostil** (kaardi visuaal ei ole automaattestitav):
vaikevaade, väljasuumitud Euroopa-vaade, hover mõlemal tasemel, tavaline
Reichskreis HRR-i sees, Brandenburg-Preußeni osaline kattuvus, Poola-Leedu L3
üksus, ja auk HRR-i sees ilma level-3 katteta. Need katavad ühtlasi
edukriteeriumi kontrollpunktid — st kontroll ütleb korraga, kas andmemudel
töötab geomeetriliselt **ja** kas ta töötab ajaloolise kaardina.

## Väravad

`npm run typecheck`, `npm test`, `npm run lint:ci`, `.venv/bin/pytest tests/`.

## Väljaspool skoopi

- Level 4 / 5 üksused (järgmine samm, kui ringkonnad ei rahulda)
- Naabrusgraafi-põhine värvimine, küllastunum palett, tugevam püsijoon
- Piirkonna klikkimine → filtreerimine isikute järgi
- Aluskaardi (`enhanceAdministrativeReadability`) sildi- ja joonestiili muutmine
- Sama taseme kattuvuse **semantiline** lahendamine (praegu: väikseim võidab)
