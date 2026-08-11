# Kreeka keele tuvastus ja märgistus — disain

**Kuupäev:** 2026-08-11
**Staatus:** kinnitatud, ootab teostust
**Kontekst:** HUMGRAECA vol. 2 / Helleno-Nordica projektitaotlus

## Probleem

Projektitaotlus eeldab, et VUTT-ist saab kreekakeelse materjali korpusena välja
tuua. Praegu ei saa: 1322 teosest on `languages` väljal `grc` märgitud **7-l**,
samal ajal kui kreeka tähemärke sisaldab **775 teost**. Otsingulehel puudub
keelefilter täielikult, kuigi väli ise on Meilis filtreeritav.

Ülesanne on tahtlikult kitsas: täiendada `languages` välja skriptiga ja lisada
otsingulehele filter. Konkreetse teoseosa (gratulatsioon, dedikatsioon) sidumine
isikuga on eraldi ja suurem probleem — vt [Skoobist väljas](#skoobist-väljas).

## Mõõtmised

Mõõdetud tootmisandmetel 2026-08-11 (`data/*/*.txt`, 1322 teost).

Lehe kreeka osakaal = kreeka tähed / (kreeka + ladina tähed), kus
kreeka = `U+0370–U+03FF` + `U+1F00–U+1FFF`, ladina = `A–Z a–z À–ÿ`.

**Kaks kandidaatreeglit:**

| Reegel | Teoseid |
|---|---|
| A: teose kogutekstis ≥ 20 % kreekat | 42 |
| B: vähemalt ühel lehel ≥ 20 % kreekat | 112 |

A on B täielik alamhulk (0 teost läbib A, aga mitte B).

Reegel A on lävendi suhtes praktiliselt tundetu — 10 % → 46, 20 % → 42,
30 % → 42, 50 % → 39 teost. See tähendab, et andmetes on loomulik klaster
~40 valdavalt kreekakeelset teost.

**Vahe on 70 teost ja need on projekti põhimaterjal** — ladinakeelsed köited,
mille sees on kreekakeelne osa:

```
 5,1% teoses,  2/14 lk   1643-9-Sacris_nuptiarum_honoribus_Johannis_Georgii_Gezeli…
 8,1% teoses,  2/ 9 lk   1647-5-Naeniae_in_obitum_ac_abitum_Laurentii_Torstani…
15,9% teoses,  2/ 6 lk   1648-26-Ultimo_honori_Josephi_Paulini_Ulsbeckii…
```

**Müra ei ole.** Kõigil 112 teosel on vähemalt üks leht, kus on nii ≥ 20 %
osakaal kui ≥ 50 kreeka tähemärki. Minimaalse tähemärgiarvu valvur ei muuda
üheski praeguses andmepunktis otsust (0 → 112 teost, 50 → 112 teost).

**Olemasolevad 7 märgendit ei ole etalon.** Reeglit läbib neist 4. Ülejäänud
kolm — *Vitae Hannibalis epitome* (max lehe osakaal 1 %),
*De hospitalitate veterum Graecorum* (14 %), *De lyrica graecorum tragoedia*
(14 %) — on ladinakeelsed tööd *kreeklastest*, kus `grc` on pandud teema, mitte
keele tähenduses. Skript neid ei puuduta; parandamine on sisuline töö ja käib
projekti poolel.

## Otsus

**Reegel B.** Teos saab `languages += "grc"`, kui vähemalt ühel lehel on kreeka
osakaal ≥ 20 % **ja** ≥ 20 kreeka tähemärki.

Tähemärgi-valvur ei muuda praegustes andmetes ühtki otsust. Ta on seal
tulevaste OCR-tulemuste vastu: lühikesel tiitellehel võib üksik kreekakeelne
moto anda kunstlikult kõrge osakaalu.

Skript tuvastab **ainult kreeka keelt**. Tähemärgistiku järgi on usaldusväärselt
eristatav ainult kreeka ja heebrea; ladina, saksa, rootsi ja eesti jagavad sama
tähestikku ja nõuaksid keeletuvastusmudelit — see on eraldi projekt. Heebrea
jäetakse välja, sest maht on mõõtmata ja sama tsitaadi-probleem on valideerimata.

## Komponendid

### 1. Tuvastusskript — `scripts/detect_greek.py`

Jookseb serveris Dockeris: `docker exec vutt-backend python3 scripts/detect_greek.py`.
See on `server_seed_data.sh` ja `migrate_prosopo_status_labels.py` muster — konteineris
lahenevad teed samamoodi nagu tootmises (`/data`). Teed tulevad `server/config.py`-st
(`BASE_DIR`), mitte `os.path.join(__file__, …)`.

Puhas tuvastusloogika eraldatakse eraldi funktsiooniks, et see oleks testitav
ilma failisüsteemita:

- `greek_ratio(text) -> tuple[int, float]` — (kreeka tähemärke, osakaal)
- `work_qualifies(page_texts) -> tuple[bool, list[str]]` — (kas läbib, kvalifitseerivad lehed)

**Idempotentne ja rangelt lisav.** Olemasolevaid keeli ei eemaldata kunagi,
`grc` ei lisata teist korda. Teistkordne jooksutamine ei tekita ühtki commiti.

### 2. Kirjutamine

Skript kirjutab `_metadata.json`-i **otse** ja teeb kogu partii kohta **ühe
git-commiti** `data/` repos.

See kaldub kõrvale CLAUDE.md invariandist „kõik `_metadata.json` uuendused käivad
`save_work_metadata()` kaudu" ja see kõrvalekalle on tahtlik. Invariant kehtib
*serveri kirjutusteede* kohta (routerid), kus loeb samaaegsus ja Meili sünk.
Ühekordse massimigratsiooni jaoks annaks `save_work_metadata()` **112 eraldi
git-commiti**, mis on täpselt see, mille ADR 0015 hulgi-vastuvõtu puhul tagasi
lükkas („lehe kaupa commitimine ujutaks ajaloo üle"). Lisaks ei kasuta ükski
olemasolev migratsiooniskript (`migrate_genres.py`, `migrate_collections.py`,
`migrate_prosopo_status_labels.py`) `save_work_metadata()`-t — kõik kirjutavad
otse ja commitivad partiina.

Hind: skript ei läbi `ALLOWED_METADATA_FIELDS` filtrit ega v1→v2 transformi.
Ühe massiivivälja täiendamisel ei ole kummalgi rolli. Samaaegse serveri-salvestuse
risk on olemas ja aktsepteeritud — sama risk on kõigil olemasolevatel
migratsiooniskriptidel.

Kaks režiimi:

| Režiim | Käitumine |
|---|---|
| `--dry-run` (**vaikimisi**) | Ei kirjuta midagi; toodab aruande |
| `--apply` | Kirjutab ja toodab sama aruande |

Kuivkäivitus vaikimisi on ADR 0014 õppetund: massiline sildiparandus läks
2026-08-05 valesti just seetõttu, et päris andmetel ei jooksutatud enne läbi.

**Aruanne** (JSON, `--report <tee>`, vaikimisi `state/greek_detection.json`):
teose `work_id` ja slug, teose kogutekstis kreeka osakaal, kvalifitseerivate
lehtede arv ja **failinimed**, kas `grc` oli juba olemas.

Lehefailinimed salvestatakse ka `--apply` režiimis, sest need on tasuta: see on
täpselt see andmestik, mida edaspidi gratulatsioon ↔ isik sidumiseks vaja läheb,
ilma et praegu andmemudelit puutuks.

### 3. Meilisearch

**Seadistust muuta ei ole vaja.** `languages` on juba nii
`filterableAttributes`-is (`scripts/2-1_upload_to_meili.py`) kui
`meili_doc.py`-s, ja `searchService.ts` küsib selle juba
`attributesToRetrieve`-ga. Kontrollitud facet-päringuga elava indeksi vastu.

Pärast `--apply` jooksu: `./scripts/server_seed_data.sh`.

### 4. Otsingufilter

Uus `CollapsibleSection` „Keel" `src/pages/search/SearchFilters.tsx`-is.
Lihtsam kui `type`-filter kahel põhjusel:

- **Sildid tulevad otse** `vocabularies.languages[kood][et|en]`-ist, seega
  Q-koodi ↔ labeli mappingut (`typeIdMap`/`typeLabelToId`) ei ole vaja.
- **Facet-loendureid ei tehta.** Sõnavara on kinnine kaheksa keelega, seega
  loend renderdatakse tervikuna sõnavarast. Meili facetid loendavad
  *lehekülgi*, mitte teoseid (`searchService.ts` kommentaar) — „grc 3915"
  oleks eksitav. Seega ei puutu see `useSearchFacets.ts`-i üldse.

URL-parameeter on **`langs`**, mitte `lang`: `searchContent` options-objektis on
juba `lang` väli (UI keelekood), mille ülekirjutamine murraks sildilahenduse.

Muudetavad failid:

| Fail | Muudatus |
|---|---|
| `useSearchUrlParams.ts` | uus param `langs` → `languages: string[]` |
| `useFilterDraft.ts` | `selectedLanguages` olek, URL-sünk, `clearFilters` |
| `SearchFilters.tsx` | uus sektsioon + `onLanguageToggle` |
| `SearchPage.tsx` | oleku edasiandmine + aktiivse filtri kiip |
| `useSearchResults.ts` | `languages` edasi `searchContent`-ile |
| `searchService.ts` | `languages?: string[]` options-is + filtriklausel |
| `src/locales/{et,en}/search.json` | `filters.languages` |

Tõlkevõti läheb **mõlemasse keelde korraga** — `fallbackLng` on väljas (ADR 0011),
ühte keelde lisamine katkestab buildi.

### 5. ADR 0019

`docs/decisions/0019-keelemargend-grc-sisaldab-osa.md`.

Pärast seda tööd tähendab `languages: grc` „sisaldab olulist kreekakeelset osa",
mitte „on kreekakeelne teos" — 112-st teosest on 70 tervikuna ladinakeelsed ja
kannavad nii `lat` kui `grc`. Ilma kirjaliku otsuseta näeb see hilisemale
vaatajale välja nagu andmeviga.

## Testimine

**Python** (`tests/test_detect_greek.py`, `.venv/bin/pytest`):

- `greek_ratio` — puhas kreeka, puhas ladina, segu, tühi tekst (nulliga jagamine)
- lävendi käitumine piiril: 19,9 % ei läbi, 20,0 % läbib
- tähemärgi-valvur: 19 tähemärki 100 % osakaaluga ei läbi
- `work_qualifies` — üks kvalifitseeruv leht 200 mittekvalifitseeruva seas läbib
- idempotentsus: `grc` juba olemas → faili ei kirjutata
- olemasoleva keele säilimine: `["lat"]` → `["lat", "grc"]`, mitte `["grc"]`
- `languages` võti puudub täielikult → tekib `["grc"]`

**Frontend** (`npm test`):

- `searchService` ehitab õige filtriklausli ühe ja mitme keele korral ega
  sega options-objekti `lang` välja
- `parseListParam` (eksporditud `useSearchUrlParams`-ist) parsib `langs`
  parameetri

Projektis **ei ole jsdom-i ega `@testing-library/react`-i** (`vitest.config.ts`:
`environment: 'node'`). Hooke ei saa renderdada, seega `commit`/`clearFilters`
juhtmestik kontrollitakse käsitsi brauseris. Uusi testisõltuvusi ei lisata —
see ei kuulu ülesande skoopi.

**Väravad enne lõpetamist:** `npm run typecheck`, `npm test`, `npm run lint:ci`,
`.venv/bin/pytest tests/`.

## Veakäsitlus

- **Loetamatu `.txt`** — logi hoiatus, jäta leht vahele, ära katkesta jooksu.
- **Puuduv `_metadata.json`** — logi hoiatus, jäta teos vahele.
- **Kirjutamine viskab erindi** — logi teose slug ja jätka; lõpuks kokkuvõte,
  mitu õnnestus ja mitu ebaõnnestus. Osaline jooks peab olema ohutu, sest skript
  on idempotentne ja kordamine parandab poolikuse.
- **Git-commit ebaõnnestub** — failid on juba kirjutatud ja jäävad alles;
  logi viga ja lõpeta nullist erineva väljumiskoodiga, et see silma jääks.
- **Aruanne kirjutatakse alati**, ka siis kui osa teoseid ebaõnnestus.

## Skoobist väljas

Teadlikult tegemata, sest need on suuremad ja eraldi läbi mõtlemist väärivad:

- **Lehe tasandile ei kirjutata midagi.** Aruanne sisaldab lehefailinimesid, aga
  andmemudel jääb puutumata.
- **Kollektsiooni ei looda.** Helleno-Nordica kollektsioon on eraldi otsus.
- **Isikuid ja rolle ei puututa.** Konkreetse gratulatsiooni sidumine konkreetse
  isikuga eeldab, et teose metaandmetes olev gratulant seotakse lehenumbriga —
  praegu seda seost ei ole ja gratulatsioone võib olla lehekülgede viisi.
- **Olemasolevaid `grc` märgendeid ei parandata.** Kolm valesti märgendatud
  teost lahendatakse projekti poolel.
- **Muid keeli ei tuvastata.** Ladina-tähestikuliste keelte eristamine nõuab
  keeletuvastusmudelit.
