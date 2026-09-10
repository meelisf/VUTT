# Prosopograafia: elulugu keelega, mis on väljanimes

**Kuupäev:** 2026-09-10
**Seotud:** ADR 0002 (blokeeriv I/O), ADR 0007 (tuletatud indeksid on read-modelid),
ADR 0008 (markdown allow-list), ADR 0011 (i18n ilma fallbackita), ADR 0014 (inline
sildid vs register), ADR 0031 (kirjutamisõigus), ADR 0033 (serveripoolne kasutajale
nähtav tekst); uus **ADR 0039**
**Staatus:** disain ülevaatamiseks, teostamata

**Versioonilugu**
- *v1:* ainult `biography_en` juurde, `biography` jääb „originaali" pesaks.
- *v2 (ülevaatus 1):* v1 nimetaks 308 saksakeelset AA-kirjet eestikeelseks ega annaks
  ingliskeelsena kirjutatud sissekandele kohta → migratsioon, keel läheb väljanimesse.
- *v3 (ülevaatus 2):* vananemisankru reegel andis vaikselt vale kinnituse (ankur
  uuenes iga EN-salvestusega; commit-viide ei osutanud räsitud tekstile). Ankur on nüüd
  **selgesõnalise kinnituse** kirje, mitte salvestamise kõrvalmõju. Lisaks: avaliku API
  ülemineku kord, migratsiooni kinnitatud vastendus, katke keelemärgistus indeksis.

## Probleem

VUTT-i liides on kahes keeles, sisu ei ole. Isikukaardi `biography` on üks vabateksti
väli ilma keeleta: ingliskeelne lugeja saab isikulehel ette teksti, mida ta ei loe, ja
alternatiivi ei ole. Kasutajaskond on rahvusvaheline (ADR 0033 lähtekoht) ja isikuleht
on sageli esimene, mis otsingust ette satub.

**Mõõdetud seis tootmises 2026-09-10** (`data/config/prosopography/*.json`):

| | arv |
|---|---|
| isikukaarte | 2389 |
| `biography` täidetud | 371 |
| … millest **Album Academicumi toorik** | **308** |
| … millest **inimese kirjutatud proosa** | **63** |
| `notes` täidetud | 7 |
| proosa maht | ~310 kB; mediaan 336 märki, max 30 590 |

`biography` kannab kahte eri asja. AA-toorik on masinkopeeritud struktureeritud
allikakirje, valdavalt saksakeelsete lühenditega ja eestikeelse päisereaga:

```
Immatrikuleerimise kuupäev: 20. September 1634
154. Lünaeus (Lynaeus, Lineus), Emundus, Smål., * 1604, † 1693. V.: Joh. L.
Imm. Uppsala 1. 8. 1639. AG: Dep. 18. 9. 1634; Konv. 1. 11. 1634—36; …
```

See ei ole tekst, vaid kirje. Seda ei tõlgita. **`source_data` on nendel kaartidel
tühi** — kontrollitud; AA-toorik ei ole kuskil mujal olemas ja tuleb kolida, mitte
kustutada.

## Miks migratsioon

Odavam kuju — `biography` jääb puutumata „originaali" pesaks, juurde ainult
`biography_en` — kukub kahe küsimuse peale läbi.

**1. Keelemärge oleks vale kohe.** Varuvariandi silt „see tekst on eesti keeles"
kehtestataks 308 saksakeelse AA-kirje kohta.

**2. Ingliskeelsena kirjutatud sissekandel ei oleks kohta.** Kas `biography`-sse (ta
*on* originaal — aga siis näeb ingliskeelne lugeja silti „tõlget ei ole" ja eestikeelse
versiooni jaoks ei ole välja) või `biography_en`-i (aga siis on „baas" tühi ja
eestikeelne lugeja ei näe elulugu üldse). Keeleneutraalne originaalipesa ei skaleeru
teise keele suunas.

Ja siis asi, mis otsuse ära otsustas: **kaks parandust on üks migratsioon.** Kui 63
proosalugu kolivad `biography` → `biography_et`, on see, mis `biography`-sse alles
jääb, täpselt need 308 AA-toorikut. Üks skript, mõlemad probleemid.

## Otsused

### 1. Sisuvälja keel on väljanimes

| Väli | Sisu |
|---|---|
| `biography_et` | eestikeelne elulugu |
| `biography_en` | ingliskeelne elulugu |
| `aa_raw` | Album Academicumi toorik — kirje, mitte tekst; **ei tõlgita** |
| `biography` | **kaob skeemist** |

Kolmas keel (`biography_de`) mahub mustrisse; ta nõuab tüübi-, vormi- ja
indeksimuudatusi nagu iga uus väli, aga mitte andmemigratsiooni ega otsust.

Ükski keeleväli ei ole „baas": `biography_et` ja `biography_en` on sümmeetrilised.
Eesti keel on projekti töökeel ja seetõttu tavaline kirjutamise suund, aga see on tava,
mitte skeem.

### 2. Masintõlge on käsitsi kutsutav abiline, mitte konveier

Toimetaja vajutab vormis nuppu, saab mustandi, toimetab selle üle ja salvestab.
Nuppu näeb ainult **`editor` ja üles**. Avalikul isikulehel lugejale tõlkenuppu ei
tule: see oleks anonüümne LLM-endpoint (kulu- ja kuritarvitusrisk) ja tulemus ei jõuaks
korpusesse.

Automaatset partiitõlget ei tule. Põhjus on mõõdetud: 371 täidetud eluloost tohib
tõlkida 63.

**Masintõlke päritolu lippu ei salvestata.** See on tooteotsus, mitte järeldus:
vananemisankur (otsus 5) kannab **teist** infot — mitte seda, kas tekst tuli masinast,
vaid seda, millise lähteversiooni vastu keegi selle kinnitas. Kui päritolu kunagi vaja
läheb, on see eraldi väli.

### 3. Tõlke-endpoint on olekuta ega puuduta kaarti

`POST /prosopography/translate` — kaardifaili ei avata, git-i ei commitita, lukku ei
võeta. Tagastab mustandi vormi; salvestamine käib tavalist `update_person` teed.

**Põhjus:** isikufailidesse kirjutamine on ühe tee taga (`update_person` →
`save_with_git`, optimistlik konkurentsikontroll `updated_at` järgi). Teine kirjutaja
tähendaks teist võimalust see kontroll mööda minna.

### 4. Kuvamine: eluloo ahel + AA-plokk eraldi

**Eluloo ahel.** Lugeja keel `L ∈ {et, en}`:

1. `biography_{L}` täidetud → näita, märget ei ole.
2. muidu teise keele väli täidetud → näita **koos märkega**, mis nimetab teksti keele
   ja ütleb, et selles keeles tõlget ei ole.
3. muidu eluloo plokki ei ole.

**AA-plokk on ahelast väljas.** `aa_raw` renderdub omaette plokina „Album Academicumi
kirje" / „Album Academicum record" **alati, kui ta on täidetud** — ka siis, kui elulugu
on olemas. Ta ei ole eluloo varuvariant, vaid teist liiki sisu: pealkiri on tõlgitud,
sisu ei ole, ja tõlkenuppu tal ei ole.

**Ploki nähtavust kontrollitakse valitud teksti järgi**, mitte ühe kindla välja järgi.
Praegune `person.biography &&` (`PersonDetailPage.tsx:691`) peidaks ära kirje, millel
on ainult ingliskeelne tekst.

### 5. Vananemisankur on kinnituse kirje, mitte salvestamise kõrvalmõju

Kaks välja, sümmeetriliselt: `biography_et_src` ja `biography_en_src`. Kummagi
väärtus on `null` või `{"hash": "<sha256, 12 hex>", "at": "<ISO ajatempel>"}`, kus
`hash` on **teise keele teksti** räsi kinnituse hetkel.

Tähendus on kitsas ja täpne: *„keegi kinnitas, et see tekst vastab teise keele
tekstile, mis nägi välja nii."* `null` tähendab **„seost ei ole salvestatud"** — mitte
„see on originaal". Ingliskeelne tekst võib olla käsitsi tõlgitud, imporditud või
originaal; ankur ei tea, kumb.

**Ankrut uuendab AINULT selgesõnaline tegevus** — vormi märkeruut „Vastab
eestikeelsele tekstile" (ja peegelpildis). Tavaline salvestamine ei kinnita midagi.

> **Miks nii:** kui ankur uueneks iga EN-välja muudatusega, siis stsenaarium — ET-s
> muutub sünniaasta, seejärel parandab toimetaja EN-is ainult kirjavea — kustutaks
> hoiatuse ära, kuigi sünniaasta jäi tõlkes parandamata. Salvestamine tõendab
> toimetaja heakskiitu tema enda tekstile, mitte vastavust teisele tekstile.

**Märkeruudu olek:**
- Värske masintõlke rakendamine **märgib ruudu ise** — tõlge tehti demonstreeritavalt
  sellest lähtetekstist ja hilise vastuse valve (otsus 8) kontrollis rakendamise hetkel
  üle, et kumbki väli ei ole vahepeal muutunud.
- **Lähteteksti muutmine kustutab märke.** Sihtteksti toimetamine ei kustuta — toimetaja
  parandab tõlget, see on kinnituse sisu, mitte selle rikkumine.
- Server arvutab räsi ise salvestamise hetkel; klient räsi ei saada.

**Hoiatus vormis ja detaillehel:** kui `hash(teine keel) != ankur.hash`, kuvatakse
„Originaaltekst on muutunud — kontrolli ka tõlget" ja selle kõrval **„Vaata, mis
muutus"**.

**Diffi leping — eraldi endpoint, mitte olemasolev.** `GET /{id}/diff?commit=X`
võrdleb commit'i **tema vanemaga**; see ei ole see võrdlus, mida siin vaja on. Uus:

```
GET /prosopography/{id}/source-diff?field=biography_et
→ {found: bool, commit, date, text}   # tekst ankru-aegses seisus
```

Server käib kaardi git-ajaloo (kuni 50 commiti, `get_file_git_history`) uuest vanemani
läbi ja otsib **värskeima commiti, mille `field` räsi võrdub ankru räsiga**. Leitud →
tagastab selle teksti; klient näitab seda praeguse kõrval. Ei leitud (ajalugu kärbitud,
kaart taastatud) → `found: false` ja aus teade „lähteversiooni ei leitud", mitte vale
diff.

**Räsi on ankur, commit ei ole.** Salvestuseelne HEAD ei kõlba: kui toimetaja muudab
ET-d, tõlgib selle ja salvestab mõlemad korraga, on räsi uuest ET-st, aga HEAD osutaks
vanale — „vaata, mis muutus" näitaks vale lähteversiooni. Räsi-otsing ajaloost osutab
alati täpselt sellele tekstile, mille räsi ankrus on.

`biography_et_src` ja `biography_en_src` lähevad `_DIFF_IGNORED_FIELDS`-i — muidu
tekitavad nad git-ajalukku müra igal kinnitusel.

### 6. Nimekirja katked on keele kaupa eraldi, varuvariandi valib vaade

`prosopography_index.json` kannab **iga allika kohta oma katke**:
`biography_snippet_et`, `biography_snippet_en`, `notes_snippet`, `aa_snippet`.
Igaüks on tuletatud täpselt ühest väljast.

Varuvariandi valiku teeb `PersonCard` — sama ahel nagu kuvamisel, pikendatuna:
`biography_{L}` → teine keel → `notes` → `aa_raw`. Nii **teab vaade, mida ta näitab**,
ja saab keelemärke ausalt valida.

> **Miks mitte üks `biography_snippet_en`, mille sisse varuvariant juba sisse
> arvestatud:** siis võib „ingliskeelses" katkes olla eestikeelne tekst, märkus või
> AA-kirje, ja kaart ei saa välja nime järgi ühtki ausat silti valida.

`aa_snippet` jääb ahela lõppu teadlikult: ilma selleta kaotaks 308 kaarti nimekirjas
katke ära, ja AA-kirje algus (nimi, aastad, päritolu) on nimekirjavaates informatiivne.

Indeks on read-model, mis ehitatakse nullist üles (ADR 0007) — lisandus ei nõua
migratsiooni, ainult `rebuild_indices()` läbimist.

### 7. Ühendamisel ankur ei kandu kaasa

`merge_ops`: kolm tekstivälja (`biography_et`, `biography_en`, `aa_raw`) järgivad
tavalist „allikas täidab ainult tühja sihtvälja" reeglit.

**Ankur mitte.** Kui allikast kopeeritakse EN-elulugu, aga sihtmärgil on juba
*teistsugune* ET-elulugu, siis ankur väidaks vastavust, mida keegi ei ole kunagi
kinnitanud. Reegel: **pärast ühendamist on mõlemad ankrud `null`**, välja arvatud kui
mõlemad keeleväljad tulid samalt kaardilt ja sihtmärgil ei olnud kumbagi — siis kandub
ankur kaasa muutumatult. Kahtluse korral `null`: kaotatud kinnitus on üks märkeruudu
vajutus, vale kinnitus on vaikne viga.

### 8. Hiline tõlkevastus ei tohi tööd üle kirjutada

Päringu alguses võetakse **mõlema välja** hetktõmmis. Vastus rakendub automaatselt
ainult siis, kui mõlemad on saabumise hetkel endiselt samad; muidu tulemust ei
kirjutata kasti, vaid pakutakse eraldi kinnitamiseks.

**See ei asenda ülekirjutuse kinnitust.** Kui sihtväli on juba täidetud, küsitakse
enne päringu saatmist kinnitust — kaks eri kaitset kahe eri olukorra vastu (toimetaja
teadlik valik vs võistlus).

## Avaliku API üleminek

`GET /prosopography/{id}` on autentimata avalik ja `biography` **eemaldatakse**. See on
päris katkestus, mitte lisandus — v1 argument „API kuju ei muutu" enam ei kehti.

**Tuntud tarbijad:** VUTT-i frontend, `mcp/vutt_mcp/persons.py` (eraldi pipx-pakett),
SEO-prerender (serveris), skriptid `scripts/`-is. Väliseid tarbijaid ei ole teada, aga
endpoint on avalik — seetõttu läheb muutus ADR-i ja `data/config` skeemi kirjeldusse.

**Expand–migrate–contract, et lugemine ei katkeks kordagi:**

| # | Samm | Miks |
|---|---|---|
| 1 | **Migratsioon, pass A** — kirjutab `biography_et` / `aa_raw`, **jätab `biography` alles** | vana kood loeb edasi `biography`-t; midagi ei kao |
| 2 | **Backend deploy** — loeb uusi välju, kirjutusteel pärandvälja reegel (allpool) | uus lugemine töötab, vana andmekuju on veel olemas |
| 3 | **Frontend deploy** + `rebuild_indices()` | uus UI, uued katked |
| 4 | **Kontroll tootmises** — 63 elulugu nähtavad, AA-plokid nähtavad, katked nimekirjas | enne pöördumatut sammu |
| 5 | **Migratsioon, pass B** — eemaldab `biography` kaartidelt | contract |
| 6 | **MCP-paketi uuendus** | eraldi juurutus, oma tempos |

**Pärandvälja reegel kirjutusteel** (samm 2 alates). `update_person` teeb
`person.update(data)` — vana avatud vorm saadaks `biography` tagasi ja **tekitaks välja
uuesti** ka pärast passi B. Seetõttu:

- kui `data["biography"]` on **identne** salvestatud väärtusega → **vaikselt maha**
  (vana klient ei muutnud seda; ei ole põhjust kedagi tülitada);
- kui ta **erineb** → **409** selge sõnumiga „vorm on aegunud, laadi leht uuesti".
  Vaikne teisendamine `biography_et`-sse võiks üle kirjutada teksti, mida uus vorm
  vahepeal muutis.

**`biography_et_src` / `biography_en_src` eemaldatakse kliendi sisendist alati** —
nagu `id`, `created_at` ja `SECRET_FIELDS` täna. Ankur on serveri tuletis; lubadus, et
uus frontend seda ei saada, ei ole kaitse.

## Migratsioon

`scripts/migrate_biography_language_fields.py`, **kuivkäivitus vaikimisi** (nagu
`scripts/detect_greek.py`), kaks passi (`--pass a` / `--pass b`).

**Klassifikatsioon.** AA-toorik = tekst **algab** AA-markeriga (`Immatrikuleerimise
kuupäev`, `[NR]`, `AG: Dep.`) — mitte „sisaldab kuskil". Inimese kirjutatud elulugu, mis
tsiteerib AA-kirjet, ei tohi tervikuna `aa_raw`-ks muutuda: andmed küll säiliksid, aga
tekst kaoks eluloo kohalt ja muutuks vormis mittemuudetavaks.

**Kuivkäivituse aruanne katab KÕIK 371 kirjet**, mitte ainult 63 mitte-AA oma —
`id`, nimi, pikkus, sihtväli, esimesed 200 märki. Lisaks **kahtluse lipud**: marker ei
ole teksti alguses; pikkus on AA-mediaanist kaugel; tekstis on Markdowni süntaks;
AA-ks liigitatud tekstis on proosalauseid. Lipuga read on aruande alguses.

**Kinnitatud vastendus.** Aruandest tekib `id → sihtväli` fail, mille inimene üle
vaatab. `--apply` **loeb ainult seda faili** ja teeb kolm kontrolli:

1. lähtetekst ei ole ülevaatusest saadik muutunud (räsi per kirje) → muidu peatub;
2. sihtväli on tühi → muidu **peatub konfliktiga**, ei kirjuta üle;
3. kirje on juba migreeritud → jäetakse vahele (idempotentsus).

**Käivitus:** konteinerist (`data/` git commitib root'ina — hostist „Permission
denied"), laval AINULT skripti enda failid.

## Puutepunktid (kontrollitud koodis)

| Fail | Mida teha |
|---|---|
| `src/prosopography/types.ts` | `biography_et`, `biography_en`, `aa_raw`, kaks ankrut; neli katkevälja |
| `src/prosopography/components/personForm/types.ts` | draft-väljad + algväärtused |
| `src/prosopography/components/personForm/helpers.ts` | `fromPerson` / `toPayload`; AA-autotäide → `aa_raw`; ankrud EI lähe payloadi |
| `src/prosopography/components/personForm/EnrichExistingSection.tsx` | rikastuse väljakaardistus (`biography` → `aa_raw`) |
| `src/prosopography/pages/PersonEditPage.tsx` | keeletabid, tõlkenupp, kinnitusruut, vananemishoiatus, AA-plokk (kirjutamiseks ei avata) |
| `src/prosopography/pages/PersonDetailPage.tsx` | eluloo ahel + märge + AA-plokk eraldi |
| `src/prosopography/components/PersonCard.tsx` | katke ahel + keelemärge |
| `src/prosopography/services/prosopographyService.ts` | tõlkepäring ja `source-diff`: timeout, veavastused, 429 |
| `src/locales/{et,en}/prosopography.json` | uued võtmed **mõlemasse** (ADR 0011) |
| `server/prosopography/person_crud.py` | skeem; `_make_snippet` neljale allikale; pärandvälja reegel + ankru pop `update_person`-is |
| `server/prosopography/person_search.py` | indeksikirjed (neli katget) |
| `server/prosopography/merge_ops.py` | kolm välja + ankru nullimine |
| `server/prosopography/enrichment.py` | AA-rikastus kirjutab `aa_raw` |
| `server/prosopography/git_history.py` | ankrud → `_DIFF_IGNORED_FIELDS` |
| `server/prosopography/router.py` | `POST /translate`, `GET /{id}/source-diff` |
| `server/text_translate.py` | **uus** olekuta tõlkeklient |
| `server/config.py` | `GEMINI_TRANSLATE_MODEL`, sisendi ülempiir, rate-limit kirje |
| `server/metadata_handler.py` | **kohustuslik:** loeb täna `biography`-t — ilma paranduseta saaks 308 kaardi SEO-kirjelduseks AA-toorik ja 63 proosalugu kaoks |
| `mcp/vutt_mcp/persons.py` | **kohustuslik:** `get_person` tagastab mõlemad keeleväljad keelemärgistusega + `aa_raw` eraldi (ainult `biography_et` peidaks ingliskeelsena kirjutatud eluloo) |
| `scripts/migrate_biography_language_fields.py` | **uus** |

**Mis EI vaja muutmist — kontrollitud:**

- `compute_person_diff` käib üle kõigi võtmete peale `_DIFF_IGNORED_FIELDS`-i — uued
  tekstiväljad ilmuvad ajalukku ilma koodita.
- `get_file_git_history` ja `get_file_at_commit` on olemas — `source-diff` ei ehita uut
  ajaloomasinavärki. (`GET /{id}/diff` ise **ei sobi**: ta võrdleb vanemaga.)

## Tõlkemoodul (`server/text_translate.py`)

Olekuta, samas vaimus nagu `server/ocr_providers/gemini.py`: sisse tekst + lähte- ja
sihtkeel, välja tekst + normaliseeritud usage. Ei impordi prosopograafiat, ei loe faile.

**Pakkuja: Gemini** — võti, retry, timeout ja sisufiltri-keeldumise käsitlus (#292,
prefiksimuster) on olemas ja tootmises. Mudel oma env-nimes `GEMINI_TRANSLATE_MODEL`
(ADR 0021), ülejäänu jagab `GEMINI_API_KEY` / `GEMINI_REQUEST_TIMEOUT` /
`GEMINI_MAX_RETRIES` väärtusi. Kumb pakkuja ajaloolises eesti↔inglise teadustekstis
parem on, on **kontrollimata hüpotees**; pakkuja vahetus on selle mooduli sees lokaalne
muudatus.

**Juhis mudelile:**
- Säilita Markdowni struktuur ja linkide sihtaadressid.
- Kuupäevadel säilita **tähendus ja täpsus**; vorm kohandub sihtkeelele („20. septembril
  1634" → „20 September 1634"). Ligikaudsus jääb ligikaudsuseks.
- Isiku- ja kohanimed jäävad allikas kirjutatud kujule — ei tõlgita ega moderniseerita.
- **Allikatsitaadid (jutumärkides või ploktsitaadis) jäävad tõlkimata.**
- Ära lisa midagi juurde. Tagasta ainult tõlge.

**Piirid ja vead:**
- Sisendi ülempiir **50 000 märki** (pikim olemasolev elulugu 30 590). Üle piiri selge
  viga, mitte vaikne lõikamine.
- Tühi või ainult tühikutest sisend → 400, mudelikutset ei tehta.
- **Tühi või poolelijäänud mudelivastus ei ole edukas tõlge** — viga, mitte tühi tekst
  vormi.
- Pakkuja viga jõuab kasutajani sõnumina, mis ei sisalda võtit ega vastuse keha.

## Endpointid

**`POST /prosopography/translate`**, `Depends(_require_role("editor"))`.
Keha `{source_lang, target_lang, text}`; keeled on lubatud väärtuste loendid (esialgu
`et`, `en`) ja peavad erinema.

**`GET /prosopography/{id}/source-diff?field=…`**, `editor`+. Vt otsus 5.

**Mõlemad:**
- **Marsruudi järjekord:** `router.py` lõpus on `GET /{person_id:path}` ja
  `PUT /{person_id:path}` — konkreetsed teed registreeritakse enne neid.
- **Sünkroonne `def` route** — FastAPI viib selle ise threadpooli. ADR 0002 nõue tuleb
  blokeerivast **pakkujakutsest**, mitte keha lugemisest.
- **Rate-limit kasutaja, mitte IP järgi.** `config.py` enda kommentaar ütleb, et
  ülikooli pöördproksi tõttu jõuavad eri kliendid serverini sama IP-ga — IP-võti
  tähendaks ühist eelarvet kõigile toimetajatele. `check_rate_limit(key, endpoint)`
  võti on lihtsalt sõnastikuvõti, nii et sinna antakse kasutajanimi. Kirje:
  `'/prosopography/translate': (60, 3600)`. **Ilma kirjeta `RATE_LIMITS`-is lubab
  `check_rate_limit` tundmatu endpointi piiranguta läbi** (`rate_limit.py:112`).

## Frontend

Eluloo plokk saab keeletabid **ET | EN** (skaleerub `de`-le), igal tabil
`MarkdownEditor` (ADR 0008 allow-list kehtib), nupp „Tõlgi [teisest keelest]" ja
kinnitusruut „Vastab [teisele keelele]". AA-kirje on omaette plokk, kirjutamiseks ei
avata.

Kõik uued i18n-võtmed lähevad **korraga et- ja en-faili** — `fallbackLng` on väljas ja
puuduv võti katkestab buildi (ADR 0011, `localeParity.test.ts`).

## Testid

**Migratsioon**
- Klassifikatsioon fikstuuridel, sh **AA-marker keset proosat → `biography_et`**, mitte
  `aa_raw`.
- `--apply` peatub, kui lähtetekst on ülevaatusest saadik muutunud.
- `--apply` peatub, kui sihtväli on täidetud (ei kirjuta üle).
- Idempotentsus; kuivkäivitus ei kirjuta; pass B eemaldab ainult migreeritud kaartidelt.

**Backend**
- `text_translate` mockitud HTTP-ga; mock-vastuse kuju **elava vastuse vastu
  kontrollitud**, mitte välja mõeldud (Gemini faas A: mockitud leping ei ole leping).
- Endpoint: rollikontroll (`contributor` → 403), keelte valideerimine, pikkuspiir, tühi
  sisend, tühi mudelivastus → viga, **429**.
- **Ankur:** kinnitusruut märgitud → ankur kirjutatakse; ruut märkimata → ankur EI
  muutu, ka siis kui `biography_en` muutus; lähteteksti muutus → hoiatus tekib;
  kliendi saadetud ankur visatakse ära.
- **Pärandväli:** identne `biography` → vaikselt maha; erinev → 409.
- **`source-diff`:** leiab ankru-räsiga commiti; ei leia → `found: false`.
- **Merge:** ankrud nullitakse, v.a mõlemad väljad samalt kaardilt tühjale sihtmärgile.
- `_make_snippet`: neli allikat eraldi, markup maha, 120 märki.
- **Salvestus → uuestilugemine kogu vorm–API–fail teed pidi.**

**Frontend**
- Eluloo ahel: oma keel; ainult teine keel (+ märge); kumbagi ei ole; AA-plokk nähtav
  **koos** eluloo olemasoluga.
- Katke ahel valib õige allika ja märgib keele.
- Hiline vastus: vahepeal muutunud väli → automaatselt ei rakendata.
- Täidetud sihtväli → kinnitus enne päringut.
- Kinnitusruut: värske tõlge märgib; lähteteksti muutmine kustutab; sihtteksti
  toimetamine ei kustuta.
- i18n pariteet olemasolevate valvuritega.

## Lahtised punktid (ei blokeeri teostust)

1. **SEO-prerender kakskeelseks.** `metadata_handler.py` on läbivalt eestikeelne; siin
   parandatakse ainult väljakaardistus. Ingliskeelne elulugu jääb Google'i eest varju,
   kuni bot-tee keelevalik, `hreflang` ja kaks URL-kuju on omaette tööna tehtud.
2. **`biography_de`** — mahub mustrisse; nõuab tüübi-, vormi- ja indeksimuudatusi, aga
   mitte migratsiooni.
3. **Masintõlke päritolu lipp** — vt otsus 2; eraldi väli, kui vaja läheb.
