# Koodibaasi ülevaatuse lõpphinnang: duplitseerimine ja fallbackid

Kuupäev: 2026-06-07

## Kokkuvõte

Kontrollisin ülevaataja hinnangus nimetatud kohad otse koodist üle. Põhijäreldus on, et hinnang on sisuliselt õige: koodibaasis on mitu kohta, kus sama andmemudeli normaliseerimine, siltide lahendamine ja fallback-loogika on paralleelselt implementeeritud. Rakendus võib sellises seisus töötada korrektselt, kuid tehniline risk kasvab iga uue andmemudeli või keeletoega, sest üks reegel tuleb muuta mitmes failis.

Kõige olulisem täpsustus on see, et osa duplitseerimistest ei ole enam identsed koopiad, vaid eri suundades edasi arenenud variandid. See on riskina tõsisem kui lihtne copy-paste, sest tulevikus ei pruugi arendaja enam teada, milline variant on kanooniline.

## Kinnitatud leiud

### 1. Backend utiliidid ja konsolideerimisskript

Kinnitatud. `server/utils.py` ja `scripts/1-1_consolidate_data.py` sisaldavad sama klassi LinkedEntity abifunktsioone:

- `capitalize_first`
- `get_label`
- `get_id`
- `get_all_labels`
- `get_primary_labels`
- `get_labels_by_lang`
- `get_all_ids`

Oluline nüanss: need ei ole enam täielikult samad. `server/utils.py:get_labels_by_lang` (rida 266) aktsepteerib `labels_store` argumenti ja kontrollib kanoonilist Q-koodi registrit esmalt — kui Q-kood on registris, eelistab seda `_metadata.json`-i `labels`-ile. `scripts/1-1_consolidate_data.py:get_labels_by_lang` (rida 290) seda argumenti ei võta ja kasutab ainult `_metadata.json`-i `labels` objekti. Seega võib Meilisearchi indekseerimise käigus (skript) kirjutada erineva sildi kui runtime'is (server) kuvatakse — eriti siis, kui `labels.json` registris on Q-koodile uuem kanooniline silt.

Hinnang: kõrge väärtusega refaktor. Skript peaks kasutama serveri jagatud utiliite või tuleks LinkedEntity loogika tõsta eraldi moodulisse, mida saavad kasutada nii server kui ka skriptid.

### 2. Frontendi Work/Page normaliseerimine

Kinnitatud, aga nüansiga. `src/services/meiliService.ts` sisaldab jagatud normaliseerijaid `normalizeWork` ja `normalizePage`, samas `src/services/workService.ts` funktsioon `getWorkMetadata` ning `src/services/pageService.ts` funktsioon `getPage` ehitavad objektid uuesti käsitsi.

See ei ole päris mehaaniline üks-ühele dubleerimine. Konkreetsed lahknevused koodist:
- `page_tags`: `meiliService.ts:normalizePage` (rida 123) teeb `hit.page_tags || hit.tags || []`; `pageService.ts:getPage` (rida 112–115) eelistab `page_tags_object` ja teisendab legacy stringid lowercase'iks — `normalizePage` ei tee kumbagi.
- `languages`: `meiliService.ts:normalizePage` (rida 136) teeb `hit.languages` ilma fallbackita; `pageService.ts:getPage` (rida 131) lisab `|| ['lat']`.
- `page_number`: `meiliService.ts:normalizePage` loeb `hit.lehekylje_number || 0`; `pageService.ts:getPage` teeb `parseInt(hit.lehekylje_number)` — erinevad tüübikäsitlused.

Seetõttu ei tohiks refaktor piirduda lihtsalt importimisega; enne tuleb jagatud normaliseerijad täiendada tegeliku kasutusvajadusega.

Hinnang: keskmine kuni kõrge prioriteet. Uute väljade lisamisel tekib lihtsasti lahknevus otsinguvaate, töövaate ja lehevaate vahel.

### 3. Nimede normaliseerimine

Kinnitatud. Nimepööramise loogika on mitmes kohas:

- `src/services/gndService.ts` pöörab kujul `Perenimi, Eesnimi` nimed ümber.
- `src/services/viafService.ts` teeb põhjalikuma puhastuse, eemaldades muu hulgas aastaarve ja lisandeid.
- `server/people_ops.py` funktsioon `invert_gnd_name` teeb lihtsa GND nime ümberpööramise.

See on aktsepteeritav seni, kuni frontend vajab ainult kuvamiseelset normaliseerimist ja backend salvestuseelset rikastamist. Risk tekib siis, kui samu isikuid võrreldakse või deduplikeeritakse eri allikate põhjal: VIAF ja GND võivad anda erinevalt puhastatud nimekuju.

Hinnang: keskmine prioriteet. Parim lahendus oleks määratleda üks kanooniline nime-normaliseerimise reegel backendis ning frontendis kasutada seda ainult kuvamise abina, mitte andmete tähenduse otsustamiseks.

### 4. Bulk-operatsioonide korduvus ja TOCTOU risk

Kinnitatud. `server/main.py` funktsioonid `bulk_collection`, `bulk_tags` ja `bulk_genre` kordavad sama mustrit:

- leia teose kataloog,
- loe `_metadata.json` luku sees,
- vabasta lukk,
- arvuta uus väärtus,
- kutsu `save_work_metadata`, mis võtab luku uuesti.

Koodis on risk ka kommentaarina tunnistatud. See tähendab, et risk ei ole varjatud bugi, vaid teadlik kompromiss praeguse kasutusmudeli jaoks.

TOCTOU probleem on siiski päris: kahe samaaegse muudatuse puhul võib teine kirjutaja esimese arvutatud väljaväärtuse üle kirjutada. `save_work_metadata` teeb küll `meta.update(clean)`, mis kaitseb teiste väljade vastu, kuid sama välja samaaegsed listimuudatused võivad kaduma minna.

Hinnang: kõrge prioriteet, kui admin-kasutajaid või automaatseid bulk-protsesse lisandub. Praeguse ühe-adminni töövoo korral on risk piiratud, aga refaktor oleks suhteliselt selge väärtusega.

## Fallback-loogika hinnang

### 1. Keele fallbackid

Kinnitatud. Fallback-ahelad on eri kohtades erinevad:

- `server/cache.py:_build_suggestions` (rida 172–177): ainult `preferred_lang → vastandkeel (et↔en) → value.label` — kõige lühem ahel, `la/de` puudub täielikult.
- `src/utils/labelUtils.ts:resolveEntityLabel` (rida 19): `UI keel → et → en → la → de → raw Q-kood` — kõige täielikum ahel, töötab enrichedLabels cache'iga.
- `src/utils/metadataUtils.ts:getLabel` (rida 35): `lang → baseLang → value.label` — kesktee, aga `la/de` puudub; lisaks eristab Wikidata (`source !== 'local'`) ja lokaalse LinkedEntity käsitluse, mis teistes utiliitides puudub.

See tähendab, et sama Q-kood või LinkedEntity võib sõltuvalt kuvamiskohast saada erineva labeli. Praktikas on see eriti nähtav varauusaegsete isikute, žanrite, kohtade ja ladinakeelsete nimetuste puhul, kus eestikeelne Wikidata label võib puududa.

Hinnang: kõrge prioriteet. Keele fallback peaks olema eraldi dokumenteeritud ja üks kanooniline utiliit peaks seda võimalikult laialt kasutama. Backend suggestions peab samuti sama prioriteediloogikat järgima või teadlikult dokumenteerima, miks ta erineb.

### 2. Legacy struktuuride fallbackid

Kinnitatud. Koodis on endiselt V1/V2 ühilduvuse kohti:

- `server/prosopography/ops.py` toetab `status` vs `statuses` ja `confession` vs `confessions` välju.
- `server/prosopography/places_ops.py` otsib legacy `origin.place` väärtust registrist labeli järgi, kui võtit ei leita.
- `server/git_ops.py` tuletab leheküljenumbri failinimest, kui pildi ja teksti basename ei klapi.

Need fallbackid on mõistetavad migratsiooniperioodi kaitsed. Suurim tehniline risk on kohtade registri labeli järgi lineaarne runtime-otsing, sest see võib kasvada jõudlusprobleemiks ja peidab ära andmete mittestandardsuse.

Hinnang: keskmine prioriteet. Legacy fallbackid tuleks jagada kaheks: ajutised migratsioonikaitsed, millel on eemaldamisplaan, ja püsivad robustsusmehhanismid, mis jäävad koodi.

## Täiendavad tähelepanekud

### 1. Normaliseerijate vastutuspiir on ebaselge

`meiliService.ts` kommentaar ütleb, et fail sisaldab jagatud normaliseerijaid, aga teenused ei kasuta neid järjepidevalt. See on arhitektuurne lõhn: koodibaasis on küll nimetatud kanooniline koht olemas, kuid selle staatus ei ole tegelikult jõustatud.

Soovitus: otsustada, kas `normalizeWork` ja `normalizePage` on avalik leping kõigi Meilisearchi hit'ide jaoks. Kui jah, peaksid `getWorkMetadata`, `getPage` ja otsinguteenused seda kasutama või põhjendatud erandeid selgelt kommentaarides märkima.

### 2. Fallbackid segavad kolme eri eesmärki

Praeguses koodis kasutatakse fallbacke vähemalt kolmel eesmärgil:

- kasutajale parima sildi kuvamine;
- legacy andmete lugemine ilma katkestamata;
- puuduliku välise andmeallika kompenseerimine.

Need on erinevad probleemid. Kui need jäävad samadesse utiliitidesse segamini, muutub raske otsustada, millal fallback peab tagastama Q-koodi, millal tühja stringi ja millal tõstma vea.

Soovitus: nimetada fallbackid eesmärgi järgi, näiteks `resolveDisplayLabel`, `readLegacyCompatiblePerson`, `resolveCanonicalRegistryLabel`.

### 3. `getWorkStatuses` päringumuster on teadlik kompromiss

`src/services/workService.ts` teeb iga teose kohta eraldi paralleelse Meilisearchi päringu. Kommentaar selgitab, et põhjus on indeksi `distinct='work_id'` seadistus. Seega ei ole see juhuslik viga, vaid andmemudeli ja indeksi seadistuse tagajärg.

Risk jääb siiski alles: suure tööde arvu korral võib klient korraga teha liiga palju päringuid. Kui see vaade muutub suurema mahuga tööriistaks, tasub lisada piiratud konkurentsiga päringujärjekord või backend endpoint, mis arvutab staatused serveri poolel.

## Prioriteetne tegevuskava

### ✅ P1: Ühtlustada labelite ja keele fallback (tehtud 2026-06-08)

Loodud kanooniline `pickLabelByLang()` (`labelUtils.ts`) ja `pick_best_label()` (`server/utils.py`). `metadataUtils.ts`, `cache.py` ja `resolveEntityLabel` kasutavad neid. Fallback-järjekord: `et → en → la → de → raw`.

### ✅ P1: Konsolideerida backend LinkedEntity utiliidid (tehtud 2026-06-08)

`scripts/1-1_consolidate_data.py` impordib nüüd `server/utils.py`-st; `labels.json` laaditakse indekseerimise käigus, et Meilisearch ja runtime kuvaksid samu kanoonilisi silte (commit `a7b9532`).

### P2: Tugevdada frontendi normaliseerijad

Täiendada `normalizePage` ja `normalizeWork` nii, et need kataksid praegused erijuhud (`page_tags_object`, legacy väljad, `languages` fallbackid, thumbnailid). Alles seejärel asendada inline-kaardistused teenustes.

### P2: Refaktoreerida bulk-operatsioonide kirjutamine

Viia sama välja lugemine, arvutamine ja kirjutamine ühte atomaarsemasse operatsiooni. Praktiline variant on lisada `save_work_metadata` kõrvale helper, mis võtab callbacki: loeb meta luku sees, arvutab uue väärtuse sama luku sees ja salvestab kohe.

### P3: Sulgeda legacy fallbackid migratsioonidega

Kohtade labeli järgi runtime-otsing ja `status/confession` legacy fallbackid tuleks siduda migratsiooniskriptide või andmeauditiga. Kui kõik andmed on normaliseeritud, saab fallbacki kas eemaldada või jätta ainult diagnostilise hoiatusega.

## Antigravity (AI) täiendavad tähelepanekud ja soovitused

Lisaks teise ülevaataja poolt kinnitatud leidudele tuvastasin koodibaasi detailsemal uurimisel veel neli infrastruktuurset ja funktsionaalset murekohta, mis liigituvad tehnilise võla alla ning võivad tulevikus ootamatuid probleeme tekitada:

### 1. Vaikimisi keele fallback ('lat') koodis
Failis [workService.ts](file:///home/mf/LLM/VUTT/src/services/workService.ts#L92) ja [pageService.ts](file:///home/mf/LLM/VUTT/src/services/pageService.ts#L131) kasutatakse Meilisearchi hit'i normaliseerimisel hardcoded keele-fallbacki:
```typescript
languages: hit.languages || ['lat']
```
*   **Probleem:** Kui teosel pole keeli määratud, eeldab süsteem automaatselt, et see on ladinakeelne (`lat`). Kuna andmekogus on ka eesti- ja saksakeelseid teoseid, on selline vaikimisi väärtus eksitav.
*   **Täpsustus (kinnitatud koodist):** See lahknevus esineb ka normaliseerijate sees endas. `meiliService.ts:normalizePage` (rida 136) teeb `hit.languages` *ilma fallbackita*, kuid `pageService.ts:getPage` (rida 131) ja `workService.ts` (rida 92) mõlemad lisavad `|| ['lat']`. Seega otsinguvaade ja töölaud võivad sama lehekülje kohta tagastada erineva `languages` väärtuse — otsinguvaade tühja massiivi, töölaud `['lat']`.
*   **Soovitus:** Keele puudumisel peaks väli jääma tühjaks või tuleks keelte määramata olekut käsitleda eraldi, mitte suruda peale ühte keelt vaikimisi fallbackina.

### 2. CodeMirror editori (VuttMarkupExtension) struktuurne haprus
XML-tägide peitmise ja kaitse süsteem failis [VuttMarkupExtension.ts](file:///home/mf/LLM/VUTT/src/components/editor/VuttMarkupExtension.ts) tugineb CodeMirror 6 madala taseme API-dele. Seal kehtivad ülikriitilised ja dokumenteerimata reeglid:
*   `RangeSetBuilder` nõuab rangeid kasvavaid positsioone (`from ASC`, sama `from` korral `to ASC`).
*   `sortFn` peab sortima `to ASC` (mitte `to DESC`).
*   Tägituvastuse `transactionFilter` peab olema pikenduse massiivis kõige viimane element.
*   **Probleem:** Kuna tegemist on äärmiselt spetsiifilise lahendusega, võib iga tulevane editori muudatus või uuendus need reeglid märkamatult lõhkuda, mis toob kaasa XML-struktuuride rikkumise teksti salvestamisel.
*   **Soovitus:** See editori osa vajab põhjalikku ühikutestide katvust, mis simuleerivad erinevaid kasutaja sisestusi ja kustutamisi.

### 3. LMDB külmkäivituse workaround (Keep-Warm Loop)
Failis [meilisearch_ops.py](file:///home/mf/LLM/VUTT/server/meilisearch_ops.py) on implemented taustal töötav `_keepwarm_loop`, mis süngib iga 2 tunni tagant ühe teose Meilisearchi.
*   **Taust:** See on vajalik, kuna Meilisearchi LMDB andmebaasi B-puu külmub pärast pikka tegevusetust ja esimesel päringul/indekseerimisel tekib kuni 60-sekundiline cold-start viivitus (FST indeksi taasehitamise tõttu, kuna prefixSearch on seadistatud väärtusele "indexingTime").
*   **Probleem:** Tegemist on infrastruktuurse fallbackiga, mis peidab Meilisearchi enda konfiguratsiooniprobleemi. Kui Meilisearchi ressurssi või konfiguratsiooni tulevikus muudetakse, võib see keep-warm loogika muutuda tarbetuks või hakata segama teisi taustaprotsesse.
*   **Täpsustus:** Keep-warm on teadlik ja dokumenteeritud otsus (vt `CLAUDE.md` — `prefixSearch: "disabled"` EI SOBI, sest "risin" ei leia "Risingh"). See ei ole varjatud tehniline võlg, vaid konkreetse Meilisearchi piirangu workaround, millel puudub praegu parem alternatiiv. Risk realiseerub peamiselt Meilisearchi versiooniuuendusel.
*   **Soovitus:** Kaaluda pikemas perspektiivis Meilisearchi uuendamist või prefiksite otsingu (prefixSearch) häälestamist viisil, mis ei nõua pidevat kunstlikku "soojana hoidmist".

### 4. Konfiguratsioonifailide sünkroonimise puudumine lokaalses arenduses
Vastavalt `CLAUDE.md` juhistele elavad konfiguratsioonifailid (sh `collections.json` ja `person_aliases.json`) ainult serveri hostil (`/data/config/`) ning neid ei hallata lokaalses git repos. Lokaalses arenduses kasutatakse nende backuppe lokaalselt ainult siis, kui arendaja tõmbab need käsitsi `scp` kaudu alla.
*   **Probleem:** Arendaja võib testida koodi lokaalselt aegunud või puuduvate konfiguratsioonidega (näiteks seoses uute isikute aliastega), mis võib viia vigadeni, mida on lokaalselt võimatu reprodutseerida.
*   **Soovitus:** Luua lihtne skript (nt `npm run sync-config`), mis tõmbab vajalikud arenduskonfiguratsioonid automaatselt serverist alla, või hoida konfiguratsioonide arendusmalle (templates/stubs) git repos.

## Lõpphinnang

Mõlema ülevaataja ja teostatud koodianalüüsi tulemusel on lõpphinnang täielikult kinnitatav. VUTT koodibaasis esineb kiire arengu tulemusena kuhjunud tehnilist võlga, mis avaldub peamiselt:
1.  **Lahknevates koodikoopiates** (normaliseerijad ja utiliidid, mis on hakanud kopeerimise järel iseseisvalt erisuunaliselt arenema).
2.  **Segunenud fallback-reeglites** (kus keeleline kuvamine, legacy andmete tugi ja infrastruktuursed piirangud on lahendatud üksteisest sõltumatult ja kohati ebajärjekindlalt).
3.  **Haprates süsteemikomponentides** (CodeMirrori XML-kaitse, Meilisearchi LMDB keep-warm daemon).

Kuna süsteem praegu töötab stabiilselt, on soovitatav vältida kiirustades tehtud suuri refaktoreerimisi. Selle asemel tuleks kokku leppida kanoonilised andme- ja keelereeglid, kirjutada katvad testid hapratele komponentidele (CodeMirror) ning hakata lahknevaid utiliite ja normaliseerijaid etappide kaupa konsolideerima, alustades P1 prioriteetidest.
Soovitus on mitte teha suurt korraga-refaktorit, vaid liikuda järjekorras: esmalt sõnastada kanoonilised reeglid, seejärel teha jagatud utiliidid, seejärel vahetada kasutuskohad ükshaaval testidega.

