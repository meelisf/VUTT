# Prosopo ametite ja hariduse allikapõhine rikastus — rakendusplaan

Kuupäev: 2026-09-26  
Staatus: arutelu põhjal koostatud plaan; teostamata  
Seotud: [#462](https://github.com/meelisf/VUTT/issues/462) (asutuste register),
[#471](https://github.com/meelisf/VUTT/issues/471) (ametite register),
[#463](https://github.com/meelisf/VUTT/issues/463) (eluteekond), ADR 0001, 0014,
0023, 0039, 0040, 0048

## 1. Eesmärk ja piir

Agent leiab allikatest isiku ametid ja hariduse, seob need VUTT-i ametite ja
asutuste registriga ning koostab **kirjepõhised ettepanekud**. Toimetaja näeb
VUTT-i isikuvormis iga ettepaneku algset sõnastust, registrivastet, aega,
allikakohta ja olemasolevaid andmeid. Alles tema kinnitatud kirjed salvestatakse.

Esimeses versioonis ei kuulu voogu eluloo koostamine, identifikaatorite muutmine,
isikute liitmine, isikuseosed ega kaardi `review`/`verification_level` muutmine.
Ettepanek ei ole väide, et allikast loetud tekst on õige: OCR-i seisund ja
toimetajamärkused peavad olema ülevaates nähtavad.

Edu mõõt: toimetaja saab ühe isiku ametid ja hariduse korraga üle vaadata,
ilma et peaks käsitsi Q-koode, nimevariante, asutuse kohta ja kuupäevi eri
vaadetest kokku sobitama. Ebakindel vaste jääb selgesõnaliselt lahtiseks.

## 2. Põhiinvariandid

1. **Amet ja haridus on võrdsed isikufaktid.** Mõlemal on allika toores
   sõnastus, võimalik asutus, ajavahemik ja *selle kirje* allikaviide.
   Hariduse olemasolev `source` (nt `album_academicum`) jääb alles allikaliigi
   märgina; see ei asenda täpset tõendit.
2. **Registri identiteet ja allikatekst on eri väljad.** `occupation.label` ja
   `education.institution` (samuti ameti `institution`) säilitavad allikast või
   senisest kaardist pärit kuju. Registri silt kuvatakse viite põhjal eraldi.
   Valija ei kirjuta toorest kuju kanoonilise sildiga üle.
3. **Vaste võti on registri püsivõti, mitte sildi sarnasus.** Nimevariandid
   leiavad kandidaate, kuid mitmetähenduslik vaste ei muutu automaatselt
   kinnitatud seoseks. Q-kood on mõlemas registris valikuline. Asutus ja koht
   on eri üksused: asutuse registrikirje `place_key` viitab kohtade registrile;
   ameti tegevuspiirkond võib viidata kohale otse (§10).
4. **Ettepanek ei muuda kaarti ega registrit.** Kinnitamine kontrollib kaardi
   värsket `updated_at`-i ning registrivastete kehtivust. 409 korral ei tehta
   osalist kirjutust; toimetaja laadib muudatused uuesti võrdluseks.
5. **Uus registrikirje vajab oma kinnitust.** „Uus amet/asutus” on kandidaadi
   staatus, mitte isikufakti salvestamise kõrvalmõju. Kui kinnitatud registrikirje
   puudub, võib toimetaja jätta fakti toorkujul alles, kuid seda ei esitata
   kontrollitud registrivastena ega tuletata sellest elukäigu kaardile kohta.
6. **Tõend ja otsus on jälgitavad.** Kinnitatud isikufakti juurde jääb allika
   täpne lokaator. Registri ja kaardi muudatused saavad autori ning git-ajaloos
   eristatava põhjuse (ADR 0001, 0040). Agendi genereeritud tekst ei lähe
   vaikimisi kaardi elulukku ega üldmärkmetesse.

## 3. Eeldused: #462 ja #471

[#462](https://github.com/meelisf/VUTT/issues/462) loob autoriteetse
`institutions.json` registri. Kirjel on püsiv VUTT-i võti, valikuline Wikidata
Q-kood, keelesildid, ajaloolised nimevariandid, liik ja valikuline `place_key`.
Sama register teenindab `education[]` ja `occupations[]` asutusi. Kui asutusel
pole Q-koodi, vajab isikufakt viidet VUTT-i registrivõtmele: senine
`institution_id` saab jääda Q-koodi ühilduvusväljaks, kuid ei saa üksi
registreerida Q-koodita asutust. **Enne migratsiooni tuleb selles issue's
fikseerida `institution_key` ja `institution_id` täpne suhe.**

[#471](https://github.com/meelisf/VUTT/issues/471) loob autoriteetse
`occupations.json` registri VUTT-i püsivõtmega ja valikulise Q-koodiga.
Ametit otsitakse esmalt olemasoleva registrivõtme või Q-koodi ja seejärel
ajalooliste variantide järgi. Variant võib anda mitu kandidaati; näide
„Pfarrer” ei tõesta iseenesest, kas sobiv vaste on kitsam `pastor` või laiem
`vaimulik`. Q-koodita olemasolev ametisilt ei kao migratsioonis.

Mõlema registri kirjutaja kasutab `save_config_with_git`-i; `labels.json`
jääb tuletatud kuvamissiltide registriks (ADR 0014, 0040). Registri otsingu
API peab andma lisaks nimele ID, variandi tabamuse, oleku ja asutuse korral
`place_key`-i. Üldise `/entity-labels` vastus ei ole ametite sõnavara.

## 4. Ühine isikufakti ja tõendi kuju

Täpsed väljanimed lukustatakse #462/#471 skeemimuudatustega; käitumisleping:

```json
{
  "kind": "occupation | education",
  "raw_occupation": "Prof. theol.",
  "raw_institution": "AGC",
  "occupation_key": "professor-of-theology",
  "institution_key": "academia-gustaviana | null",
  "place_key": null,
  "date_from": {"date": "1640", "precision": "year"},
  "date_to": null,
  "evidence": [{
    "source_kind": "vutt_page | literature | external",
    "source_id": "püsiv ID või allikaviide",
    "locator": "lk / folio / kirjenumber",
    "work_id": "VUTT-i teose ID, kui allikas on VUTT-is",
    "page": 12,
    "printed_page": "24 | null",
    "part_id": "teose osa ID | null",
    "quote": "lühike kontrollitav katke",
    "url": "valikuline otselink"
  }]
}
```

See on **loogiline näide**, mitte praeguse `ProsopoRecord`-i JSON ega käsk
`person.update`-ile. Salvestatav kirje kasutab olemasolevaid `occupations[]`
ja `education[]` välju, lisades mõlemale ühesuguse `evidence`-struktuuri ja
vajaliku asutuse registrivõtme. Olemasolevates kaartides võib tõend puududa;
puudumine ei tähenda, et väide on ümber lükatud. VUTT-i lehe puhul talletatakse
`work_id`, skaneeringu 1-põhine leheküljenumber ja vajadusel trükise paginatsioon
**eraldi**. Kirjanduse puhul ei segata PDF-i lehekülge trükise leheküljega.

Tõendisse ei kopeerita pikka OCR-teksti ega kaitstud skaneeringut. Katke pikkus
on piiratud, viide kontrollitav ja lehe seisund näidatakse kinnitamisvaates
värske päringu põhjal. Piiratud teose lugemisõigust kontrollitakse enne sisu
kuvamist; ettepanek ise ei anna sellele lisaligipääsu.

## 5. Agendi tööriistad ja vasteotsus

MCP `get_person` on praegu tekstiline kokkuvõte: selles puuduvad täielikud
`occupations[]`/`education[]`, allikad ja `updated_at`. Lisada piiratud
masinloetav lugemistööriist, mis tagastab ühe isiku nimetatud kirjed,
`updated_at`-i ja vajalikud registriviited, mitte kogu kaardi suvalise
kirjutamise vormi. Teine tööriist otsib ametite/asutuste registrist kandidaate
ning tagastab ka nimevariandi, mille põhjal kandidaat leiti. MCP ei impordi
backend-paketti runtime'is.

Agendi vastus iga leitud fakti kohta on üks neljast:

| Olek | Tähendus | Kinnitamisvaade |
|---|---|---|
| `already_present` | Sama fakt on kaardil; toor- või registrivaste ning aeg sobivad | Näita, ära dubleeri |
| `matched` | Registrivaste on üheselt põhjendatav | Näita ID-d, nimevarianti, tõendit |
| `ambiguous` | Mitu võimalikku ID-d, erinev ajavahemik või allikate vastuolu | Nõua inimese valikut |
| `new_registry_candidate` | Kinnitatud registrivastet ei leitud | Suuna eraldi registriülevaatusele |

Vaste algoritm järjestab registrivõtme, Q-koodi täpse vaste, kinnitatud
nimevariandi ja normeeritud kirjakuju. Stringi sarnasus on *soovitus*, mitte
kinnitatud ID. `already_present` võrdleb registrivõtmeid, asutust või
tegevuspiirkonda ning ajavahemikku (§10), mitte üksnes silti.
Hariduse asutusest ei tuletata kohta vabateksti põhjal; koht tuleb ainult
kinnitatud asutuse `place_key` kaudu. Tühja/kahtlase `place_key` korral kaardile
elukäigu jaama ei lisata.

## 6. Ettepaneku üleandmine ja õigused

Esimene kasutajavoog: toimetaja avab isikuvormis „Agendi ettepanekud” ja
alustab selle isiku jaoks üleandmist. Server annab **ühekordse, lühikese
kehtivusega, ainult ettepaneku esitamiseks sobiva koodi**. Kood seotakse
isiku ID ja toimetaja sessiooniga. Agent annab koodi koos struktureeritud
ettepanekuga MCP `submit_person_enrichment_proposal` tööriistale. See endpoint
võib luua ainult ootel ettepaneku; ta ei kutsu `update_person`-it ega kirjuta
registreid. Koodi hoitakse serveris räsina, seda ei logita ja seda ei salvestata
püsiva MCP keskkonnamuutujana. Koodi avalikuks sattumise võimalik mõju on
piiratud ühe isiku ühe ootel ettepanekuga, mitte editor-õigusega.

Ootel ettepanek on ajutine tööolek (nt `state/` all, väljaspool `data/` giti),
mitte autoriteetne isikufakt. Sellel on juhuslik ID, `person_id`,
`base_updated_at`, esitaja, loomise/kehtivuse aeg, piiratud arv kirjeid ja
olek `pending | applied | expired`. Server kontrollib sisendi kuju, suurust,
lubatud välju, ID-formaate ja ühekordset koodi. Ülevaatuse API nõuab editori
sessiooni; kood ega ettepaneku ID ei anna lugemisõigust. Aegunud ettepanekud
koristatakse ning esitatud sisu ei kanta automaatselt ajalukku.

See on teadlik muudatus MCP senisesse read-only reeglisse (ADR 0023): MCP
saab kirjutada **ainult ajutise ettepaneku**, mitte teadusandmestikku. Enne
teostust lisada uus ADR, mis fikseerib selle piiri, tokeni õigused ja ajutise
oleku elutsükli. Tavalist editori sessioonitokenit ei panda MCP globaalsesse
konfiguratsiooni ega agendi vestlusse.

## 7. VUTT-i vormis kinnitamine

Isikuvormi „Ametid ja haridus” sektsioonis avaneb ootel ettepanekute paneel.
Iga rida näitab:

- allikast leitud sõnasõnalist kuju, täpset viidet ja vajadusel OCR-i või
  toimetajamärkuse hoiatust;
- praegust isikukirjet ja pakutud muutust kõrvuti, sh daatumi täpsus;
- ameti ja asutuse registri ID-d, nende kuvatavaid silte ja varianti, mille
  järgi vaste leiti; asutuse kinnitatud `place_key`-d;
- tegevust `Lisa`, `Täienda olemasolevat`, `Jäta vahele` või `Lahenda vaste`.

Ridade vaikeseis on **kinnitamata**. Toimetaja võib valida teise registrikirje,
parandada kuupäeva või allikaviidet ning kinnitada ainult osa ridu. Uue ameti
või asutuse ettepanek avab registri töövoo; registrikirje kinnitamise järel
laaditakse isiku ettepanek uuesti ja kontrollitakse ID ning `place_key` üle.
Vormi tavapärane salvestus ei kinnita peidetud või vaatamata agendiettepanekuid.

Kinnituse serverioperatsioon võtab ainult valitud ettepanekuridade ID-d ja
toimetaja parandused. Server loeb kaardi uuesti, kontrollib `updated_at`-i,
võrdleb olemasolevaid kirjeid, valideerib registriviited ning salvestab ühe
isiku muudatuse olemasoleva `person_lock`-i ja git-kirjutaja kaudu. Ta ei
rakenda kogu kliendi saadetud kaardi objekti ega kasuta vabade väljaradadega
`/{id}/enrich`-otspunkti. Kui kaart või register on vahepeal muutunud, vastab
ta 409-ga ja näitab uut diffi; kinnitatud ridu ei kirjutata pooleldi.

## 8. Teostusjärjekord

### Etapp A — registrite ja isikukirje pariteet (#462, #471)

- [ ] Fikseeri asutuse püsivõtme ja Q-koodi eristus; lisa registri viide nii
  `education[]` kui `occupations[]` kirjetele.
- [ ] Lisa mõlemale kirjetüübile ühine tõendikuju, kuupäevade valideerimine ja
  ühine vormi kuvamisloogika. Säilita vanad `source`-väljad ning toorsildid.
- [ ] Lisa registrite lugemis- ja haldus-API ning admini/kinnitaja vaade uute
  registrikirjete ülevaatuseks. Uued autoriteetsed failid käivad ADR 0040 järgi.
- [ ] Tee olemasolevate stringide migratsioon **kuivkäivituse ja kinnitatava
  tabeliga**; ära seo mitmetähenduslikke variante automaatselt. Kontrolli
  tootmisandmete diffis ajaloolisi nimesid, lühendeid ja Q-koodita kirjeid.
- [ ] Uuenda elukäigu kihi `lifeStations` resolutsioon: asutuse kinnitatud
  `place_key`, ameti territooriumi otsene `place_key`, tundmatu koht eraldi
  kaardita jaamana. Eemalda asutuse sildi põhjal koha oletamine (§10).

### Etapp B — agendi lugemine ja ettepanek

- [ ] Lisa MCP-sse täielike ameti-/hariduskirjete ja registrikandidaatide
  lugemistööriistad. Hoia vastused mahupiiri all; tagasta kaardi `updated_at`.
- [ ] Kirjelda ja valideeri ettepaneku skeem; lisa ühekordse üleandmiskoodiga
  ajutine ettepaneku API ja MCP esitustööriist. Kirjuta uus ADR MCP õiguste kohta.
- [ ] Näita ettepaneku esitamisel klassifikatsioon (`already_present`,
  `matched`, `ambiguous`, `new_registry_candidate`) ja registreeri
  selgesõnaliselt, millist allikakatket ning registrivarianti kasutati.

### Etapp C — vormis kinnitamine

- [ ] Lisa isikuvormi kirjepõhine diff ja allika kontrolllink, sh OCR-i
  seisund ning toimetajamärkused. Kõik uued võtmed et/en korraga.
- [ ] Lisa kitsas kinnitamisendpoint, mis kontrollib kaardi versiooni,
  registriviiteid, dublikaate ja kinnitatud ridade valikut ühe luku all.
- [ ] Uue registrikandidaadi puhul ava eraldi kinnitamine ning nõua pärast
  registrimuudatust isikufakti uuesti valideerimist.

## 9. Kontroll ja valmimistingimused

Automatiseeritud testid katavad vähemalt: sama ameti/asutuse kaks kirjakuju;
mitu võimalikku Q-koodi; Q-koodita asutus; asutuse `place_key` puudumine;
olemasoleva kirje täiendamine ilma dublikaadita; vastuoluline ajavahemik;
toore sõnastuse säilimine; kirjetaseme tõendi säilimine; aegunud
`updated_at` → 409; aegunud/korduskasutatud/võõra isiku üleandmiskood →
keeld; ettepaneku katsed muuta `review`, `identifiers`, `biography_*` või
registrit → keeld; piiratud allika sisu kuvamine ainult õigustatud kasutajale.

Visuaalses kontrollis tuleb päris näidetega läbi teha vähemalt „Pfarrer”
(laiem/kitsam amet), „AGC”/„Academia Gustaviana” (sama asutus), „Uppsala”/
„Univ. Uppsala” (koht või asutus) ja üks puuduva Q-koodiga kirje. Valmis on
siis, kui toimetaja näeb iga kinnitatud fakti juures algset sõnastust ja
täpset allikaviidet, registrivalik on kontrollitav ning agent ei saa ühegi
MCP-kutsega kaarti ega autoriteetset registrit muuta.

## 10. Kooskõla #461 seoste vaatega (märkused 2026-09-26)

#461 on tootmises (PR #466–#472): isiku seoste võrgustik, ajatelg, loend ja kaart,
sh kiht **„Elukäik"**, mis kuvab isikukaardi ameteid ja haridust kaardil. Allolev tuleb
arvestada, muidu lähevad plaan ja tootmises olev kood lahku.

1. **Ameti koht võib olla territoorium, mitte asutus.** Näide: Fischer „Superintendent,
   Pfalz-Sulzbach" (Q454436) ja „Superintendent, Liivimaa" (Q183464). Mõlemad on
   kohtade registris tüübiga `historical_region`. Neil ametitel on praegu
   `institution_id` = koha Q-kood. Ametikirjel peab olema **kas** `institution_key`
   (asutus → `institutions.json` → `place_key`) **või** `place_key` (tegevuspiirkond
   otse kohtade registrist), mitte ainult `institution_key`. Muidu taandataks
   territoorium asutuseks, mida §2 p 3 keelab. Migratsioon (etapp A) peab suunama
   praegused koha-Q-koodiga ametid (nt Tartu, Tallinn, Pfalz-Sulzbach, Liivimaa)
   `place_key`-sse, mitte asutuste registrisse.

2. **Elukäigu kiht muutub etapis A. Lisa see ülesandeks.**
   `lifeStations` (`src/prosopography/utils/relationsMap.ts`, testid
   `src/prosopography/utils/__tests__/relationsMap.test.ts`) otsib praegu ameti ja
   hariduse asutuse koha kohtade registrist Q-koodi **ja sildi** järgi. Pärast #462-te:
   - asutus → `institutions.json` → kinnitatud `place_key`;
   - ameti `place_key` (territoorium) loetakse otse;
   - **asutuse sildi järgi kohta ei tuletata** (§5). Tühja või kahtlase `place_key`
     korral läheb jaam loendisse „Kaardita jaamad" põhjusega, mitte kaardile;
   - sünni-, surma-, matuse- ja päritolukoha sildi tagavara jääb, sest need on kohad;
   - testides Fischeri näide (territooriumiga ametid), „AGC"/„Academia Gustaviana"
     (üks asutus → Tartu) ja asutus ilma `place_key`-ta.

   Trükikoha sildi tagavara `server/prosopography/network.py` `_place_coords`-is
   (#470) on teoste trükikoha **kuvamise** resolutsioon, mitte registrivaste. Seda see
   plaan ei muuda.

3. **Registrite võti on VUTT-i püsivõti, Q-kood on valikuline — mõlemas registris.**
   §3 eristab asutuse `institution_key`-d ja Q-koodi. Sama skeem on vajalik ka
   ametitele: 61 ametil (98 kasutust) puudub Q-kood. Ametikirje viitab
   `occupation_key`-le, Q-kood on registrikirje väli. Issue'd #462 ja #471 on selle
   järgi uuendatud.

4. **Tõendi kuju ühtib seoste lepinguga.** Seoste servad (`GET
   /prosopography/{id}/network`, ADR 0056) kannavad `evidence: {work_id, pages,
   part_id?}`; `part_id` tuleb teose osadest (#464). VUTT-i lehe tõend kasutab samu
   nimesid: `work_id`, `page` (skaneeringu 1-põhine), `printed_page` (trükise
   paginatsioon, valikuline), `part_id` (valikuline). Nii on kiri või luuletus (#464)
   mõlemas mudelis samal kujul viidatav.

5. **`already_present` võrreldakse võtmete ja aja järgi, mitte sildi järgi.** Sama
   fakt on andmetes mitmel kujul: „Superintendent" kolm korda eri kohaga; haridus
   AA-allikast ja vormist. Reegel:
   - sama `occupation_key` + sama `institution_key`/`place_key` + kattuv või puuduv
     ajavahemik → `already_present`, kui olemas on üks üheselt sobiv kirje;
   - hariduses peab ühtima ka õpingusündmuse liik (`education.type`), kui see
     on teada: immatrikuleerumine ja kraadi saamine samas asutuses ei ole üks fakt;
   - sama võti, aga vastuoluline aeg → `ambiguous`;
   - puuduva aja või liigiga ettepanek, mis sobiks mitme olemasoleva kirjega →
     `ambiguous`, mitte automaatne tõendite liitmine;
   - silt üksi ei tee kirjet samaks.
   Testides kolm juhtu: sama amet eri kohtades (pole duplikaat), sama
   õpingusündmus kahest allikast (üks kirje, kaks tõendit) ja samas asutuses
   eri liiki õpingusündmused (kaks kirjet).
