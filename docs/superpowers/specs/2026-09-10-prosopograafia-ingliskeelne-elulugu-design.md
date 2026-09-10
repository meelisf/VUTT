# Prosopograafia: elulugu keelega, mis on väljanimes

**Kuupäev:** 2026-09-10
**Seotud:** ADR 0002 (blokeeriv I/O), ADR 0007 (tuletatud indeksid on read-modelid),
ADR 0008 (markdown allow-list), ADR 0011 (i18n ilma fallbackita), ADR 0014 (inline
sildid vs register), ADR 0031 (kirjutamisõigus), ADR 0033 (serveripoolne kasutajale
nähtav tekst); uus **ADR 0039**
**Staatus:** disain ülevaatamiseks, teostamata
**Muudetud 2026-09-10 pärast ülevaatust:** algne disain lisas ainult `biography_en`
ja jättis `biography` „originaali" pesaks. Ülevaatus näitas, et see nimetab 308
saksakeelset AA-kirjet eestikeelseks ja ei anna vastust ingliskeelsena kirjutatud
sissekandele. Disain läks migratsiooni peale — vt „Miks migratsioon".

## Probleem

VUTT-i liides on kahes keeles, sisu ei ole. Isikukaardi `biography` on üks vabateksti
väli ilma keeleta: ingliskeelne lugeja saab isikulehel ette teksti, mida ta ei loe, ja
alternatiivi ei ole. Kasutajaskond on rahvusvaheline (ADR 0033 lähtekoht) ja
isikuleht on sageli esimene, mis otsingust ette satub.

**Mõõdetud seis tootmises 2026-09-10** (`data/config/prosopography/*.json`):

| | arv |
|---|---|
| isikukaarte | 2389 |
| `biography` täidetud | 371 |
| … millest **Album Academicumi toorik** | **308** |
| … millest **inimese kirjutatud proosa** | **63** |
| `notes` täidetud | 7 |
| proosa maht | ~310 kB; mediaan 336 märki, max 30 590 |

Mõõtmine paljastas, et `biography` kannab kahte eri asja. AA-toorik on
masinkopeeritud struktureeritud allikakirje, valdavalt saksakeelsete lühenditega ja
eestikeelse päisereaga:

```
Immatrikuleerimise kuupäev: 20. September 1634
154. Lünaeus (Lynaeus, Lineus), Emundus, Smål., * 1604, † 1693. V.: Joh. L.
Imm. Uppsala 1. 8. 1639. AG: Dep. 18. 9. 1634; Konv. 1. 11. 1634—36; …
```

See ei ole tekst, vaid kirje. Seda ei tõlgita. **`source_data` on nendel kaartidel
tühi** — kontrollitud; AA-toorik ei ole kuskil mujal olemas ja tuleb päriselt kolida,
mitte kustutada.

## Miks migratsioon

Kaalutud ja **kõrvale jäetud** oli odavam kuju: `biography` jääb puutumata „originaali"
pesaks, juurde tuleb ainult `biography_en`. See kukub kahe küsimuse peale läbi.

**1. Keelemärge oleks vale kohe, mitte kunagi tulevikus.** Varuvariandi silt („see
tekst on eesti keeles") kehtestataks 308 saksakeelse AA-kirje kohta.

**2. Ingliskeelsena kirjutatud sissekandel ei oleks kohta.** Kui elulugu kirjutatakse
inglise keeles, siis kas ta läheb `biography`-sse (ta *on* originaal — aga siis näeb
ingliskeelne lugeja silti „tõlget ei ole" ja eestikeelse versiooni jaoks ei ole välja,
kuhu minna) või `biography_en`-i (aga siis on „baas" tühi ja eestikeelne lugeja ei näe
elulugu üldse). Keeleneutraalne originaalipesa ei skaleeru teise keele suunas.

Ja siis asi, mis otsuse ära otsustas: **kaks parandust on üks migratsioon.** Kui 63
proosalugu kolivad `biography` → `biography_et`, siis see, mis `biography`-sse alles
jääb, on **täpselt need 308 AA-toorikut**. AA väljakolimine juhtub väljajätmise teel.
Üks skript, mõlemad probleemid, ja pärast seda on iga sisuväli keelega nimetatud.

Sama migratsioon tuleks `biography_de` päeval niikuinii — siis lihtsalt suurema
andmehulga peale.

## Otsused

### 1. Sisuvälja keel on väljanimes

Pärast migratsiooni:

| Väli | Sisu |
|---|---|
| `biography_et` | eestikeelne elulugu |
| `biography_en` | ingliskeelne elulugu |
| `aa_raw` | Album Academicumi toorik — kirje, mitte tekst; **ei tõlgita** |
| `biography` | **kaob skeemist** |

Kolmas keel (`biography_de`) mahub samasse mustrisse; ta nõuab tüübi-, vormi- ja
indeksimuudatusi nagu iga uus väli, aga mitte andmemigratsiooni ega otsust.

Ükski väli ei ole „baas": `biography_et` ja `biography_en` on sümmeetrilised. Eesti keel
on projekti töökeel ja seetõttu vaikimisi kirjutamise suund, aga see on tava, mitte
skeem.

### 2. Masintõlge on käsitsi kutsutav abiline, mitte konveier

Toimetaja vajutab vormis nuppu, saab mustandi, toimetab selle üle ja salvestab.
Salvestamine on **toimetaja heakskiit — mitte tõend, et tekst on üle loetud**; eraldi
„masintõlke" lippu sellest hoolimata ei lisata, sest see lipp ei kannaks rohkem infot
kui see, mida vananemisankur (otsus 5) juba kannab.

Nuppu näeb ainult **`editor` ja üles** isiku muutmise vormis. Avalikul isikulehel
lugejale tõlkenuppu ei tule: see oleks anonüümne LLM-endpoint (kulu- ja
kuritarvitusrisk) ja tulemus ei jõuaks kunagi korpusesse.

Automaatset partiitõlget ei tule. Põhjus on mõõdetud: 371 täidetud eluloost tohib
tõlkida 63, ja needki tahaks keegi niikuinii üle lugeda.

### 3. Tõlke-endpoint on olekuta ega puuduta kaarti

`POST /prosopography/translate` — kaardifaili ei avata, git-i ei commitita, lukku ei
võeta. Tagastab mustandi vormi; salvestamine käib tavalist `update_person` teed.

**Põhjus:** isikufailidesse kirjutamine on täna ühe tee taga (`update_person` →
`save_with_git`, optimistlik konkurentsikontroll `updated_at` järgi). Teine kirjutaja
tähendaks teist võimalust see kontroll mööda minna.

### 4. Kuvamisahel valib keele ja ütleb ausalt, kui varuvarianti kasutati

Lugeja keel `L ∈ {et, en}`:

1. `biography_{L}` täidetud → näita, märget ei ole.
2. muidu teise keele väli täidetud → näita **koos märkega**, mis nimetab teksti keele
   ja ütleb, et selles keeles tõlget ei ole. Keelt saab nüüd nimetada, sest väli on
   keelega märgitud.
3. `aa_raw` täidetud → **omaette plokk** „Album Academicumi kirje" / „Album Academicum
   record", alati nähtav, keelest sõltumata, tõlkimata. Pealkiri on tõlgitud, sisu ei
   ole.

**Ploki nähtavust kontrollitakse valitud teksti järgi, mitte ühe kindla välja järgi.**
Praegune `person.biography &&` (`PersonDetailPage.tsx:691`) peidaks ära kirje, millel
on ainult ingliskeelne tekst.

Miks mitte peita plokk, kui oma keeles teksti ei ole: kaoks kogu sisu korraga. Miks
mitte näidata mõlemat kõrvuti: leht muutub pikaks ja keelevalik ei tähendaks midagi.

### 5. Vananemisankur: räsi ütleb *et*, commit ütleb *mis*

Uus väli `biography_en_src` — `null` või
`{"hash": "<sha256 12 hex>", "commit": "<git sha>"}`.

**Serveripoolne reegel** (`update_person`): kui `biography_en` **muutus** ja
`biography_et` ei ole tühi, kirjutatakse ankur = `biography_et` räsi + repo HEAD enne
seda salvestust. Kui `biography_et` on tühi, ankur on `null` — ja see tähendab
täpselt „see ingliskeelne tekst ei ole tõlge, vaid originaal".

Klient ankrut ei saada; server tuletab selle. Nii ei saa ankur kliendi vea või vana
vormi tõttu valetada.

**Kasutus vormis:** kui `hash(biography_et) != ankur.hash`, kuvatakse hoiatus
„Originaaltekst on muutunud — kontrolli ka ingliskeelset elulugu" ja selle kõrval
**„Vaata, mis originaalis muutus"**. Masinavärk on olemas:
`get_file_at_commit(path, ankur.commit)` annab kaardi selle seisuga, millest tõlgiti,
ja `GET /prosopography/{id}/diff` teeb juba sama tööd „Ajalugu" tabis. Toimetaja näeb,
et muutus oli üks lause, ja parandab tõlkes sama lause.

`biography_en_src` läheb `_DIFF_IGNORED_FIELDS`-i — muidu tekitab ta git-ajalukku müra
igal tõlkesalvestusel.

**Teadaolev auk, teadlikult lahtine:** vastassuunda (ingliskeelne originaal →
eestikeelne tõlge) ei ankurdata. Kaks vastastikust ankrut satuksid vastuollu niipea,
kui üht keelt eraldi parandatakse — üks väidaks „sünkroonis", teine „vananenud". Üks
ankur ühes suunas on ainus kuju, mis jääb iseendaga kooskõlla.

### 6. Nimekirja katke järgib sama ahelat

`prosopography_index.json` kannab `biography_snippet` (et) ja `biography_snippet_en`.
Ahel keele `L` kohta on **sama järjekord nagu kuvamisel** (otsus 4), pikendatuna
`notes`-iga:

```
biography_{L} → teine keel → notes → aa_raw
```

- **Teine keel tuleb enne `notes`-i.** `notes` on keeleta vabatekst (7 kaarti);
  ingliskeelsesse katkesse ei tohi sattuda eestikeelne märkus, kui ingliskeelse
  lugeja jaoks on olemas mõni päris elulugu.
- **`aa_raw` jääb ahela lõppu teadlikult.** Ilma selleta kaotaks 308 kaarti nimekirjas
  katke ära — AA-kirje algus (nimi, aastad, päritolu) on nimekirjavaates päriselt
  informatiivne, isegi lühendatult.

Indeks on read-model, mis ehitatakse nullist üles (ADR 0007) — lisandus ei nõua
migratsiooni, ainult `rebuild_indices()` läbimist.

## Migratsioon

`scripts/migrate_biography_language_fields.py`, **kuivkäivitus vaikimisi** (nagu
`scripts/detect_greek.py`).

**Klassifikatsioon:** AA-toorik = tekst sisaldab mõnda markerit `Immatrikuleerimise
kuupäev`, `AG: Dep.`, `[NR]` → `aa_raw`. Ülejäänu → `biography_et`.
Mõõdetud jaotus: 308 / 63.

**Inimese värav:** kuivkäivitus trükib **kõik 63 mitte-AA kirjet** (nimi, pikkus,
esimesed 200 märki) ülevaatamiseks. Heuristika ei tohi vaikselt otsustada, mis on
eesti keeles. Kui mõni neist osutub saksa- või rootsikeelseks, otsustatakse see kirje
eraldi (kas tekib `biography_de` või jääb käsitsi lahendada) — skript ei paiguta
midagi, mille kohta inimene ei ole öelnud „jah".

**Käivitus:** konteinerist (`data/` git commitib root'ina — hostist „Permission
denied"), laval AINULT skripti enda failid. Skript on **idempotentne**: kaart, kus
`biography` puudub, jäetakse vahele.

**Pärast:** `rebuild_indices()`.

## Puutepunktid (kontrollitud koodis)

| Fail | Mida teha |
|---|---|
| `src/prosopography/types.ts` | `biography_et`, `biography_en`, `aa_raw`, `biography_en_src`; `biography_snippet_en` |
| `src/prosopography/components/personForm/types.ts` | draft-väljad + algväärtused |
| `src/prosopography/components/personForm/helpers.ts` | `fromPerson` / `toPayload`; AA-autotäide läheb `aa_raw`-sse |
| `src/prosopography/components/personForm/EnrichExistingSection.tsx` | rikastuse väljakaardistus (`biography` → `aa_raw`) |
| `src/prosopography/pages/PersonEditPage.tsx` | keeletabid, tõlkenupp, vananemishoiatus, AA-plokk (kirjutamiseks ei avata) |
| `src/prosopography/pages/PersonDetailPage.tsx` | kuvamisahel + märge + AA-plokk |
| `src/prosopography/components/PersonCard.tsx` | katke keele järgi |
| `src/prosopography/services/prosopographyService.ts` | tõlkepäring: timeout, veavastused, 429 |
| `src/locales/{et,en}/prosopography.json` | uued võtmed **mõlemasse** (ADR 0011) |
| `server/prosopography/person_crud.py` | uue kaardi skeem; `_make_snippet` mõlemale keelele; ankrureegel `update_person`-is |
| `server/prosopography/person_search.py` | indeksikirje `biography_snippet_en` |
| `server/prosopography/merge_ops.py` | kolm välja, igaüks „allikas täidab ainult tühja sihtvälja" |
| `server/prosopography/enrichment.py` | AA-rikastus kirjutab `aa_raw`, mitte eluloo välja |
| `server/prosopography/git_history.py` | `biography_en_src` → `_DIFF_IGNORED_FIELDS` |
| `server/prosopography/router.py` | uus `POST /translate` |
| `server/text_translate.py` | **uus** olekuta tõlkeklient |
| `server/config.py` | `GEMINI_TRANSLATE_MODEL`, sisendi ülempiir, rate-limit kirje |
| `server/metadata_handler.py` | **kohustuslik:** loeb täna `biography`-t — ilma paranduseta saaks 308 kaardi SEO-kirjelduseks AA-toorik ja 63 proosalugu kaoks |
| `mcp/vutt_mcp/persons.py` | **kohustuslik:** sama põhjus (`persons.py:83`) |
| `scripts/migrate_biography_language_fields.py` | **uus** |

**Mis EI vaja muutmist — kontrollitud, et mitte ehitada olematut probleemi:**

- `update_person` teeb `person.update(data)` — merge, mitte ülekirjutus, ja
  välja-lubaloendit ei ole. Uued võtmed lähevad läbi. (Vastupidi lehe JSON-ile, kus
  `SERVERIPOOLSED_LEHE_VALJAD` puudumine kaotaks välja esimese salvestusega.)
- `compute_person_diff` käib üle kõigi võtmete peale `_DIFF_IGNORED_FIELDS`-i —
  git-ajalugu näitab uusi välju ilma koodita.
- `get_file_at_commit` ja `GET /{id}/diff` on olemas — vananemisankur ei ehita uut
  ajaloomasinavärki, vaid kasutab olemasolevat.

## Tõlkemoodul (`server/text_translate.py`)

Olekuta, samas vaimus nagu `server/ocr_providers/gemini.py`: sisse tekst + lähte- ja
sihtkeel, välja tekst + normaliseeritud usage. Ei impordi prosopograafiat, ei loe faile.

**Pakkuja: Gemini** — võti, retry, timeout ja sisufiltri-keeldumise käsitlus (#292,
prefiksimuster) on olemas ja tootmises. Mudel oma env-nimes `GEMINI_TRANSLATE_MODEL`
(ADR 0021), ülejäänu jagab `GEMINI_API_KEY` / `GEMINI_REQUEST_TIMEOUT` /
`GEMINI_MAX_RETRIES` väärtusi. Kui tõlkekvaliteet osutub praktikas kehvaks, on pakkuja
vahetus selle mooduli sees lokaalne muudatus — kumb pakkuja ajaloolises eesti↔inglise
teadustekstis parem on, on kontrollimata hüpotees, mitte selle speki eeldus.

**Juhis mudelile:**
- Säilita Markdowni struktuur ja linkide sihtaadressid.
- Kuupäevadel säilita **tähendus ja täpsus**; vorm kohandub sihtkeelele („20. septembril
  1634" → „20 September 1634"). Ligikaudsus jääb ligikaudsuseks.
- Isiku- ja kohanimed jäävad allikas kirjutatud kujule — ei tõlgita ega
  moderniseerita.
- **Allikatsitaadid (jutumärkides või ploktsitaadis) jäävad tõlkimata.** Tsitaat on
  allikas, mitte tekst.
- Ära lisa midagi juurde. Tagasta ainult tõlge.

**Piirid ja vead:**
- Sisendi ülempiir **50 000 märki** (pikim olemasolev elulugu on 30 590 — piir peab
  selle mahutama). Üle piiri **selge viga**, mitte vaikne lõikamine.
- Tühi või ainult tühikutest sisend → 400, mudelikutset ei tehta.
- **Tühi või poolelijäänud mudelivastus ei ole edukas tõlge** — viga, mitte tühi
  tekst vormi.
- Pakkuja viga jõuab kasutajani sõnumina, mis ei sisalda võtit ega vastuse keha
  (`GeminiError` konventsioon).

## Endpoint

- `POST /prosopography/translate`, `Depends(_require_role("editor"))`.
- Keha: `{source_lang, target_lang, text}`; `source_lang` ja `target_lang` on lubatud
  väärtuste loendid (esialgu `et`, `en`) ja peavad erinema.
- **Marsruudi järjekord:** `router.py` lõpus on `GET /{person_id:path}` ja
  `PUT /{person_id:path}`. Uus konkreetne tee registreeritakse enne neid.
- **Sünkroonne `def` route Pydantic-kehaga** — FastAPI viib selle ise threadpooli.
  ADR 0002 nõue tuleb blokeerivast **pakkujakutsest**, mitte keha lugemisest.
- **Rate-limit kasutaja, mitte IP järgi.** `config.py` enda kommentaar ütleb, et
  ülikooli pöördproksi tõttu jõuavad eri kliendid serverini sama IP-ga — IP-võti
  tähendaks ühist eelarvet kõigile toimetajatele korraga. `check_rate_limit(key,
  endpoint)` võti on lihtsalt sõnastikuvõti, nii et autenditud endpointil antakse
  sinna kasutajanimi. Kirje: `'/prosopography/translate': (60, 3600)`.
  **Ilma kirjeta `RATE_LIMITS`-is lubab `check_rate_limit` tundmatu endpointi
  piiranguta läbi** (`rate_limit.py:112`) — kirje ei ole valikuline.

## Frontend

**Vorm.** Eluloo plokk saab keeletabid **ET | EN** (skaleerub `de`-le). Igal tabil
`MarkdownEditor` (ADR 0008 allow-list kehtib edasi) ja nupp „Tõlgi [teisest keelest]",
mis on aktiivne, kui lähtekeel on täidetud. AA-kirje on omaette plokk, kirjutamiseks
ei avata.

**Hiline vastus ei tohi tööd üle kirjutada.** Päringu alguses võetakse **mõlema
välja** hetktõmmis. Vastus rakendub automaatselt ainult siis, kui mõlemad on
saabumise hetkel endiselt samad; muidu tulemust ei kirjutata kasti, vaid pakutakse
eraldi kinnitamiseks. Ülekirjutuse kinnitus **enne** päringut ei kata seda: toimetaja
võib kirjutada päringu kestel ja ET-lähtetekst võib vahepeal muutuda.

**Kuvamine.** `PersonDetailPage` ja `PersonCard` järgivad otsuse 4 ahelat. Kõik uued
i18n-võtmed lähevad **korraga et- ja en-faili** — `fallbackLng` on väljas ja puuduv
võti katkestab buildi (ADR 0011, `localeParity.test.ts`).

## Testid

**Migratsioon**
- Klassifikatsioon fikstuuridel: AA-markerid → `aa_raw`, proosa → `biography_et`.
- Idempotentsus: teine käivitus ei muuda midagi.
- Kuivkäivitus ei kirjuta.

**Backend**
- `text_translate` üksustestid mockitud HTTP-ga. Mock-vastuse kuju peab olema **elava
  vastuse vastu kontrollitud**, mitte välja mõeldud — Gemini faas A õpetas, et
  mockitud leping ei ole leping.
- Endpoint: rollikontroll (`contributor` → 403, `editor` → 200), keelte valideerimine,
  pikkuspiir, tühi sisend, tühi mudelivastus → viga, **429 rate-limitil**.
- Ankrureegel: `biography_en` muutus + ET olemas → ankur kirjutatakse; ET tühi → ankur
  `null`; ET muutus üksi → ankur EI muutu (hoiatus tekib).
- `merge_ops`: kolm välja, igaüks täidab ainult tühja sihtvälja.
- `_make_snippet`: mõlema keele ahelad, markup maha, 120 märki.
- **Salvestus → uuestilugemine kogu vorm–API–fail teed pidi** — `person.update(data)`
  kinnitab läbipääsu, aga mitte kogu teed.

**Frontend**
- Kuvamisahel: oma keel olemas; ainult teine keel (+ märge); ainult `aa_raw`; tühi.
- Vormi tabid: ühe keele kirjutamine ei puuduta teist.
- Hiline vastus: vahepeal muutunud väli → automaatselt ei rakendata.
- Vananemishoiatus ilmub, kui ET räsi ei klapi ankruga.
- i18n pariteet jookseb olemasolevate valvuritega.

## Lahtised punktid (ei blokeeri teostust)

1. **SEO-prerender kakskeelseks.** `metadata_handler.py` on läbivalt kõvakodeeritud
   eesti keeles. Selles spekis parandatakse ainult väljakaardistus (`biography_et`,
   `aa_raw` omaette); ingliskeelne elulugu jääb Google'i eest varju, kuni bot-tee
   keelevalik, `hreflang` ja kaks URL-kuju on omaette tööna tehtud.
2. **MCP kakskeelsus.** `get_person` hakkab näitama `biography_et`-i; kas agent
   vajab ka `biography_en`-i, otsustatakse kasutuse põhjal.
3. **Vastassuuna ankur** (EN originaal → ET tõlge) — vt otsus 5.
4. **`biography_de`** — mahub mustrisse; nõuab tüübi-, vormi- ja indeksimuudatusi,
   aga mitte andmemigratsiooni.
