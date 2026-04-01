# Arhitektuurihinnang: flat-andmehoidla jätkusuutlikkus

Kuupäev: 2026-03-31

## Praegune maht

- Teosed: ca 1300
- Leheküljed: ca 20000
- Isikud: ca 1000
- Kasv: mõõdukas; lähiajal ei ole oodata üle 10000 teose ega üle 5000 isiku

## Lühijäreldus

Praeguse mahu juures on olemasolev lahendus jätkusuutlik.

- Teoste hoidmine failisüsteemis on selle mahu juures mõistlik.
- Meilisearch teoste otsinguindeksina on õige arhitektuuriline kiht.
- Prosopograafia hoidmine JSON-failidena on samuti veel mõistlik, kui kõrvalindeksid püsivad kontrolli all.
- Praegu ei ole tehnilist sundi minna üle PostgreSQL-ile või muule täisväärtuslikule andmebaasile.

Suurim arhitektuuriline risk ei ole toorfailide arv, vaid tuletatud indeksite hooldus:

- `person_to_works.json`
- `prosopography_index.json`
- kohad, mis teevad täisskänne üle kogu `data/`

## Mis tuleks praegu ära teha

1. ~~Ühtlustada dokumentatsioon ja runtime-andmete asukohad.~~ **TEHTUD (2026-04-01)**

   - CLAUDE.md uuendatud: `state/` vs `data/state/` jaotus dokumenteeritud, valed viited parandatud
   - `scripts/sync_labels.py` ja `enrich_labels.py` kirjutasid `state/labels.json`-i — parandatud `VUTT_DATA_DIR` kaudu
   - Serveril stale duplikaadid liigutatud `state/vana/`-sse

2. Teha `person_to_works.json` uuendamine odavamaks. **JÄLGIDA**

Praegu on see kõige tõenäolisem koht, mis hakkab ajas halvasti skaleeruma, sest fail loetakse sisse, sellest eemaldatakse kirjeid lineaarse skänniga ja see kirjutatakse tervikuna välja. Praegune maht (572 isikut, 2804 viidet, ~200KB) on triviaalselt kiire — optimeerimist vajab alles ~3000+ isiku juures.

3. Vähendada täisskänne kohtades, kus neid tehakse sageli. **TEHTUD (2026-04-01)**

`_build_suggestions()` (`server/cache.py`) leheküljefailide skannimine (~20 000 faili iga 5 min) asendati ühe Meilisearchi facets-päringuga (`page_tags_suggest_et/en` väli). Metadata-taseme skannimine (1300 `_metadata.json`) jäi alles — see on kiire ja annab suurema osa suggestions-i väärtusest. Teised skännid (prosopo rebuild, reindex) on admin-toimingud, ei sagestu.

4. Hoida canonical source ja derivaadid rangelt lahus.

Soovitatav mudel:

- teosed ja lehed: failisüsteem + Git
- otsing: Meilisearch
- prosopograafia read-modelid: eraldi tuletatud andmed

5. Lisada lihtne jõudlusjälgimine.

Mõõta vähemalt:

- ühe teose Meilisearchi sync aeg
- prosopograafia listingu/filterdamise aeg
- `person_to_works.json` faili kasv
- indeksite taastamise aeg

## Mis võib rahulikult jääda samaks

1. Teoste hoidmine failisüsteemis
2. Git-põhine ajalugu teoste juures
3. Meilisearch teoste otsingu jaoks
4. Prosopograafia mudel "üks isik = üks JSON fail"
5. Suure andmebaasi ennetav kasutuselevõtt

Praeguse mahu juures annaks suur migratsioon tõenäoliselt rohkem keerukust kui väärtust.

## Millal hakata tõsisemalt mõtlema SQLite või PostgreSQL peale

1. Kui prosopograafia listingud või facetid muutuvad tajutavalt aeglaseks.

Praktiline piir:

- lihtpäringud stabiilselt üle 300-500 ms
- keerukamad päringud üle 1 s

2. Kui `person_to_works.json` muutub sagedaseks pudelikaelaks.

Näited:

- teose meta salvestus muutub aeglaseks
- mitu uuendust hakkavad üksteist segama
- indeksifailide ülekirjutamine muutub koormavaks

3. Kui isikute arv läheneb umbes 3000-5000-le ja ristseosed tihenevad.

Oluline ei ole ainult isikute arv, vaid ka:

- aliaste hulk
- merge'ide sagedus
- seoste arv teostega
- keerukamate filtrite vajadus

4. Kui teoste arv liigub umbes 5000+ suunas ja admin-operatsioonid aeglustuvad.

Teoste failipõhine hoidmine võib jääda alles ka siis, kuid read-modelid ja haldusloogika võiksid selleks hetkeks olla tugevamad.

5. Kui tekib vajadus keerukate ristpäringute järele.

Näiteks:

- näita kindla tüübi isikuid kindla kollektsiooni teostes
- tee aggregatsioone üle isikute, rollide ja ajavahemike
- kasvab analüütika ja aruandluse vajadus

6. Kui kirjutajaid või protsesse tuleb rohkem.

Flat-fail + lock-muster töötab hästi ühe serveri ja mõõduka kirjutuskoormuse juures. Hajusamas või paralleelsemas kirjutusmudelis muutub andmebaas oluliselt atraktiivsemaks.

## Soovitus

Praeguse mahu juures ei soovita teha suurt tehnoloogiamigratsiooni.

Kõige mõistlikum tee on:

1. parandada olemasoleva failipõhise arhitektuuri nõrgemad kohad
2. jälgida paari konkreetset jõudlusnäitajat
3. lükata andmebaasimigratsioon edasi hetkeni, kui tekib päris vajadus

Kui valida ainult kaks lähiaja parandust, siis prioriteet oleks:

1. `person_to_works.json` uuendamise ümbertegemine
2. dokumentatsiooni, deploy-juhiste ja tegelike andmeasukohtade kooskõlla viimine

## Täiendavad tähelepanekud koodi koherentsuse kohta (2026-04-01)

Peale koodibaasi analüüsi on selgunud järgmised süsteemsed tähelepanekud:

### 1. "God-file" sündroom serveris

`server/main.py` on kasvanud ca 1400 realiseks, sisaldades segamini API otspunkte, abifunktsioone ja taustalõimede loogikat. Kuigi `prosopography` on juba eraldi moodulis, vajab ülejäänud API samasugust tükeldamist FastAPI ruuteriteks (nt `works`, `auth`, `admin`).

### 2. Hübriidne lugemis-kirjutamismudel

Süsteem kasutab efektiivset, kuid koordineerimist nõudvat mustrit:
- **Lugemine:** Frontend suhtleb suuresti otse Meilisearchiga (`index.search`), mis tagab kiire reageerimise ja vähendab Pythoni bäkkendi koormust.
- **Kirjutamine:** Kõik muudatused läbivad Pythoni bäkkendi, mis tagab Giti ajaloo, indeksite ja Meilisearchi sünkroonsuse.

See muster on õige, kuid nõuab, et andmete normaliseerimise loogika (nt Wikidata Q-koodide ja labelite sidumine) oleks frontendis ja bäkkendis identne.

### 3. Konkurentsi haldus on robustne

`atomic_write_json` (temp-fail + rename) ja `threading.Lock()` (indeksite ja metaandmete jaoks) kasutamine on failipõhise andmebaasi kohta üllatavalt korrektne. See vähendab andmete riknemise riski, kuid kinnitab veelgi, et süsteem on mõeldud töötama ühe protsessina (single-instance).

### 4. Giti integratsioon kui audit-logi

Giti kasutamine `server/metadata_ops.py` kaudu on süsteemi üks tugevamaid külgi. See annab tasuta audit-logi ja võimaldab tulevikus ehitada "undo" funktsionaalsust ilma keerulise andmebaasilooja ehitamiseta.

## Täiendavad soovitused (lühiajaline vaade)

1. **API tükeldamine:** Viia `server/main.py` loogika üle eraldi ruuteritesse, et parandada testitavust ja loetavust.
2. **Staatuse ja andmete range eraldamine:**
   - `data/` (või `VUTT_DATA_DIR`): teosed, lehed, taksonoomia, isikud. See, mis on Gitis ja mida varundatakse.
   - `state/`: sessioonid, kasutajad, logid, staging-üleslaadimised. See, mis on serverispetsiifiline ja ajutine.
3. **Frontend-Backend koherentsus:** Liigutada andmete normaliseerimise loogika (nt isikute nimede ja rollide kuvamine) ühte kohta või tagada ühtne testbaas mõlema poole jaoks.
4. **Indeksfailide optimeerimine:** `person_to_works.json` puhul kaaluda append-only logi või SQLite-i kasutamist indeksina, kui faili suurus ületab mõne megabaidi, et vältida tervikfaili pidevat ülekirjutamist.

