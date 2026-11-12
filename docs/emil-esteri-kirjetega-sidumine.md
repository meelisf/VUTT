# EMILi sedelite sidumine ESTERi kirjetega

Kuupäev: 2026-11-11. Seis: esmane otsingukatse tehtud; kasutaja saatis kirja
käsikirjade kirjete ekspordi saamiseks. Ootame vastust ja eksporti.
Täpsustus samal päeval: kasutaja osutas avalikule `Mscr` kohaviidaregistrile,
millel on 16 lehekülge. Esmane kandidaatide loend on seega võimalik ise
veebikataloogist koguda; ekspordi saabumist ei pea selleks ootama.
See on tööplaan, mitte valmis teostuse kirjeldus.

**Seis 2026-11-12:** Mscr-registri eksport (`reference_data/mscr-loend.txt`) on
sedelitega võrreldud, kandidaadid on hinnatud ja kahtlased paarid on saadetud
inimesele ülevaatamiseks (vt [Võrdlus Mscr-loendiga](#võrdlus-mscr-loendiga-2026-11-12)).
VUTTi andmeid ei ole muudetud. Kuus sedeli parandust ootavad ettepanekutena
ülevaatust.

## Eesmärk ja andmete tasand

Siduda [EMILi manuskriptide sedelkataloogis](https://vutt.utlib.ut.ee/?collection=emil-manuskriptid)
kirjeldatud säilikud olemasolevate ESTERi kirjetega. Kõigi sedelite kohta ei
pruugi ESTERis kirjet olla. Tulemusetu otsing ei tõesta kirje puudumist.

VUTTis on praegu 22 teemajaotust ehk teost ja 1332 sedelipilti ehk lehekülge.
Importimise taust: [emil_import.py](../scripts/archive/emil_import.py).
Üks VUTTi teos on näiteks „Kokaraamatud – Manuskriptide kogu süstemaatiline
sedelkataloog”, mitte üks sedelil kirjeldatud käsikiri.

- Olemasolev teose `ester_id` kuulub teemajaotuse tasemele; seda ei saa
  kasutada kõigi selle jaotuse sedelite individuaalsete viidete jaoks.
- Kasutajaga arutatud lahendus: sidumise tulemus läheb **lehekülje märkmetesse**.
  Uut eraldi andmevälja pole esimeseks etapiks vaja.
- Märkmete kirjutustee ja täpne salvestuskuju tuleb enne rakendamist koodist
  üle kontrollida. Selle arutelu käigus VUTTi andmeid ei muudetud.

## Samastamise põhimõtted

Tegemist on vana sedelkataloogiga: **muutunud võivad olla nii nimetused kui
kohaviidad**. Kohaviit on hea otsinguvihje, kuid selle võrdsus pole ainus alus
ja erinevus ei välista samastamist.

Võrdleme tunnuste kombinatsiooni: hoidja, vana ja praegune kohaviit,
tulme-/inventarinumber, autor ja nimevariandid, pealkiri ja pealkirjavariandid,
omanikud/provenients, dateering, keel, maht ja mõõdud. Säilitame sedeli
algse sõnastuse ning otsinguks tehtud normaliseeringu eraldi. Eriti muutunud
kohaviida puhul tuleb seose põhjendus sõnaselgelt kirja panna.

Kontrollida tuleb ka seda, kas mitu sedelit kirjeldavad sama säilikut, üks
kirjeldus jätkub mitmel sedelil või sedel käsitleb suurema säiliku osa.
Lehekülg ja ESTERi kirje ei pruugi olla suhtes üks ühele.

## Otsingukatse 2026-11-11

Päringud tehti otse ESTERi avaliku veebikataloogi vastu. Sõnaotsingus
kasutati `searchtype=X`, kohaviidaotsingus `searchtype=c`; kogu kataloogi
`searchscope=1` ja TÜ raamatukogude `searchscope=58`.
Näide: `https://www.ester.ee/search~S1*est/X?searchtype=c&searcharg=Mscr+1309&searchscope=1`.
Need on katse ajal töötanud parameetrid, mitte lubadus püsiva API kohta.

| Sedel või kontrollpäring | Tulemus ja tõlgendus |
|---|---|
| [Ajalugu, lk 1](https://vutt.utlib.ut.ee/work/996o7v/1), `Mscr. 1309` | Kindel vaste [b5547410](https://www.ester.ee/record=b5547410*est): „Die Adresse der Juden an Alexander den Ersten”. Kattuvad kohaviit, aasta 1806, 2 lehte ja mõõdud 31,6 × 20,0 cm. |
| Sõnaotsing `"Adresse der Juden"` | Leidis sama kirje ka kohaviita kasutamata. |
| [Kokaraamatud, lk 1–6](https://vutt.utlib.ut.ee/work/8j89j1/1): `Mscr. 791`, `604`, `602`, `603`, `607`, `612` | Täpsed kohaviidaotsingud ei andnud vastet. Pealkirja- ja nimevariantide piiratud katse ei andnud kinnitatud seost. Kirjete puudumist ei ole tõendatud. |
| Kokaraamatute sõnaotsingud | Prooviti muu hulgas `Koch* AND Artz*`, `t:koch* AND t:arz*`, `"Moserin"`, `koch*`, `toiduvalmistamis*`. Laiad otsingud andsid palju kõrvalisi tulemusi. Kõiki tulemusi ega variante pole läbi kontrollitud. |
| Kontrolliks lähedane kohaviit `Mscr 608` | [b5690747](https://www.ester.ee/record=b5690747*est), „Experimentirte Faerberey Künsten”, 38 lk, 18. sajand. **Ei ole Mscr 604 vaste.** Kirjes ja eksemplarimärkuses on tulmenumber `1940:3083`. |
| `annales AND pomeran*` | Täpset kombinatsiooni ei leitud; ESTER teatas „PÄRINGUT MUUDETI” ja otsis `(annales or pomeran*)`, tulemuseks 1282 kirjet. Need pole algse AND-päringu vasted. |
| Tulmenumbri katsed `1940 3079`, `n:3079`, kontrolliks `n:3083` | Tagastati kõrvalisi tulemusi; tulmenumbri usaldusväärset otsingumeetodit pole selle katsega tõendatud. Tulmenumbrite olemasolu kirjelduses ei taga nende täpset otsitavust. |

Olulised otsingulõksud:

1. Kohaviidaotsing võib vasteta päringu puhul näidata **lähedasi kohaviitu**
   ja teksti „asuks siin”. Selline tulemuste leht ei ole täpne vaste.
2. Sõnaotsing võib päringut automaatselt laiendada. Tulemuste arv ega HTTP 200
   ei tähenda, et algne päring leidis vasteid; kontrollida tuleb ka teadet ja
   tegelikku päringut.
3. Ainult teavikulaadiga „käsikiri” piiramine võib jätta vajalikud kirjed välja:
   kindlalt leitud Mscr 1309 kirjeldab litograafiat. Valida tuleks kogu/fondi järgi.

ESTERi [sõnaotsingu juhend](https://www.elnet.ee/juhend/ester/otsing_s6na.php)
kirjeldab märkuste otsimist, kärpimist ning automaatset AND/OR laiendust.
Alternatiiviks on [Z39.50 liides](https://data.elnet.ee/ester/e-ressursid/),
kuid **seda selles katses ei kasutatud**. Dokumenteeritud otsiväljade loend
ei tõenda kohaviida ega eksemplarimärkuste otsimise tuge.

## Võrdlus Mscr-loendiga 2026-11-12

### Lähteandmed

`reference_data/mscr-loend.txt` on ESTERi Mscr-kohaviidaregistri 16 lehe
eksport. Fail on CSV ja kodeeritud UTF-8-s. Selle veerud on kohaviit,
inventarinumber, b-number, autor, pealkiri, ilmunud, arvandmed, keelemärkus ja
keel. Mitmeväärtuselised väljad on eraldatud `";"`-ga. Mahud:

- 428 rida ja 398 erinevat Mscr-numbrit vahemikus 1–1594, ehk umbes veerand
  numbriruumist. Loend ei tõenda millegi puudumist.
- Ühe numbri all võib olla mitu kirjet (Mscr 956 all on 7). Üks kirje võib
  olla mitme kohaviida all, näiteks `Mscr 1512 (koopia)` ja `378 A70`.
- INV-veeru `Mscr N` kujul väärtus **ei ole vana kohaviit**. Kolm sedelitega
  kattuvat numbrit (956, 668, 826) osutusid sisu järgi kõik juhuslikeks.
- Kokaraamatute numbreid (791, 602, 603, 604, 607, 612) loendis ei ole.

Sedelite tekstid võeti avalikust otsinguindeksist: kogu `emil-manuskriptid`,
1332 lehte. Kohaviite on sedelitel mitmel kujul. Lisaks kirillitsa „Мscr”-ile
esineb OCR-i kujusid „Msgr.”, „Nscr.”, „Mer”, „Msor.” ja „Muscr.”. Mscr-viide
leiti 405 sedelilt, kokku 370 erinevat numbrit. Neist 100 numbrit on loendis.

### Meetod

1. **Kandidaadid koostas skript.** Iga sedeli jaoks valiti ESTERi read, mille
   number kattub sedeli numbriga, ja read, mille pealkirja- või autorisõnad
   kattuvad IDF-kaalutud skooriga (≥ 9, vähemalt 2 sõna). Igale sedelile jäi
   kuni 5 kandidaati. Kandidaate sai 377 sedelit. Neist 256 puhul kattus ainult
   sõnavara, number mitte.
2. **Hindamise tegid keelemudeli agendid.** Neli paralleelset Sonnet-agenti
   andsid igale sedelile oleku `kinnitatud`, `osa`, `kandidaat` või `erinev`
   koos lühikese põhjendusega. Juhend oli: number on ainult üks tunnus ja
   otsustab tunnuste kombinatsioon.
3. **Kõik numbri ja sisu vastuolud kontrolliti pildilt** (`get_page_image`).

Gemini Decisions API-t ei kasutatud. Põhjused: vaja on kolme olekut ja
kirjalikku põhjendust, ning varasemas testis ei kinnitanud see õiget vastet
kunagi kindlalt.

Tulemus 377 sedeli kohta: kinnitatud 149, osa 8, kandidaat 5, erinev 215.
Kinnitatud ja osaliste paaride taga on 132 erinevat b-numbrit. Enamik
erinevaid on sõnakattuvuse valepositiivsed, näiteks õigusteaduse loengud
ühiste sõnadega „Dorpat” ja „Recht”. Neil sedelitel puudub vaste selles
loendis, mitte ESTERis.

### Õppetund: käsitsi kirjutatud numbrite OCR

Kõik leitud „number kattub, sisu erineb” ja „kohaviit muutunud” juhtumid
osutusid pildil numbri OCR-veaks:

| Sedel | OCR | Pildil | Järeldus |
|---|---|---|---|
| 996o7v/51 | 1096 | 1036 (masinkirjas parandus) | ESTERi Mscr 1036, b40111301 |
| 80jmb1/103 | 1253 | 1263 (6 kirjutatud 5 peale) | ESTERi Mscr 1263, b55718577 |
| bg8u9j/7 | 1337 | 1334 | ESTERi Mscr 1334, b55131475 |
| u7dn43/86, 70d6qu/32 | 1036 (d) | 1096 (d) | Lieveni kirjad Ewersile = Mscr 1096, loendis puudub |
| p02t8o/174 | 1427 | Mscr 1127 läbi kriipsutatud → F. 14, 1. 45 | Kattumine ESTERi Mscr 1427-ga (Varmo Pirk) on näiline |

Järeldus: sedelilt OCR-iga loetud number on **otsinguvihje, mitte tõend**.
Sagedased segiajamised on 3↔9, 5↔6, 4↔7 ja 1↔4. Otsus tehakse sisu järgi.
Numbri vastuolu korral tuleb vaadata pilti. Ainus päris kohaviida muutus
selles valimis (p02t8o/174) liikus Mscr-ist fondi poole ja jääb seetõttu
Mscr-loendist välja.

Nende kuue lehe parandused, kohaviide numbrid ja ilmsed OCR-vead, on esitatud
MCP lehe teksti ettepanekutena (#641). Workspace'is kinnitab need superadmin.
p02t8o/174 jaoks on vaja lisaks otsustada, kuidas märkida läbikriipsutus. VUTTi
märgendus seda praegu ei toeta.

### Inimese ülevaatus

Ülevaatusleht (claude.ai artefakt, privaatne, jagamine Share-menüüst):
<https://claude.ai/artifact/1ebD3BchgMAjn8bb7SdoYF>. Lehel on 166 paari, igaühe
juures valikud Kinnitan / Lükkan tagasi / Ebaselge ja märkuse väli. Otsused
salvestuvad artefakti andmebaasi kogusse `otsused`, dokumendi id on
`<work_id>-<lk>`. Sealt saab need hiljem kätte `ArtifactData` `list` abil.

- **Ülevaatamist vajavad (102):** pildilt parandatud, `kandidaat`, `osa`, sama
  b-number mitmel sedelil, märgitud vastuoluga (nt maht Mscr 608 32 vs 38 lk),
  ainult sisu järgi leitud vasted ning number kattub, aga sisu on hinnatud
  erinevaks.
- **Pistekontroll (64):** number ja sisu kattuvad ning vastuolu ei ole
  märgitud.

Töövahendid ja vahetulemused (scratchpad, ei ole repos): `kandidaadid.json`,
`otsused.json` (koondotsused koos pildiparandustega) ja `review_items.json`.
Kui neid on hiljem vaja, kopeeri skriptid ja tulemused `scripts/archive/` alla.

### Märkuse kuju (kokku lepitud 2026-11-12)

Seos kirjutatakse **lehe kommentaarina** (`comments[]`, Markdown, ADR 0008)
kasutaja nimel. Agentide pakutud paarid võetakse vastu tervikuna. Ülevaatuslehel
tagasi lükatud paarid jäetakse välja. Vigu parandatakse töö käigus.

```markdown
**ESTER:** [b5547410x](https://www.ester.ee/record=b5547410*est) · Mscr 1309
Die Adresse der Juden an Alexander den Ersten. [Venemaa], 1806.
_Seos leitud automaatselt ESTERi Mscr-registri põhjal ja pisteliselt üle vaadatud, 2026-11-12._
```

- Esimene rida algab alati `**ESTER` ja sisaldab b-numbrit. Selle järgi
  tunneb skript olemasoleva seose ära ega lisa seda teist korda.
  Säiliku osa puhul on silt `**ESTER (säiliku osa):**` ja b-numbreid võib olla
  mitu.
- Teisel real on ESTERi autor, pealkirja esimene variant (kärbitud 220
  märgini) ja ilmumisandmed.
- Põhjenduse rida lisatakse ainult erijuhul: osa, ebakindel vaste või
  vastuolu (maht, dateering, nimekuju). Sellised read on kirjutatud käsitsi.
- „Sama kirjega on seotud ka: …” lisatakse, kui sama kirje on seotud mitme
  sedeliga. Sama säilik võib olla mitmes teemajaotuses.
- „Erinev” ja vasteta sedelile ei kirjutata midagi.

Teostus: andmed on failis `scripts/archive/emil_ester_seosed.json` (162 märkust,
14 neist säiliku osa) ja kirjutaja on `scripts/archive/emil_ester_markused.py`.
Skript lisab märkuse `/save` kaudu. Nii läbib kirjutus lehe luku,
kolmesuunalise liitmise, commit'i (üks lehe kohta) ja Meili sünkrooni.
Vana `meta_content`-kujuga lehe jätab skript vahele. Käivitamine serveris:

```bash
ssh vutt && cd ~/VUTT && git pull
python3 scripts/archive/emil_ester_markused.py             # kuivkäivitus
python3 scripts/archive/emil_ester_markused.py --kirjuta   # küsib kasutajanime ja parooli
```

Andmefaili koostanud generaator ja selle sisendid on scratchpadis ega ole repos.
Kui ülevaatuslehele lisandub tagasilükkamisi enne käivitamist, tuleb andmefail
uuesti koostada või vastavad kirjed käsitsi eemaldada.

### Järgmised sammud

1. Ülevaatus ära oodata ja kontrollida, kas tagasilükkamisi lisandus.
2. Käivitada `emil_ester_markused.py` serveris (kõigepealt kuivkäivitusena).
3. Ülejäänud umbes 270 sedelinumbri ja 927 Mscr-viiteta sedeli jaoks on vaja
   täisekspordi andmeid või ESTERi sõnaotsingut.

## Oodatav eksport

### Avalik Mscr-loend kui esimene lähteandmestik

Kasutaja täpsustatud lähtekoht on [ESTERi Mscr-kohaviidaotsing](https://www.ester.ee/search~S1*est/X?searchtype=c&searcharg=Mscr&searchscope=1&SORT=DZ&extended=0&SUBMIT=OTSI).
Kasutaja järgi on loendil vaid 16 lehekülge. Esimene leht kontrolliti
2026-11-11: see annab kohaviidaregistri read (nt `Mscr 1036`, `Mscr 105`,
`Mscr 1056`) ja lingi järgmisele lehele. Kõiki lehti veel ei kogutud.

See maht on piisavalt väike, et alustada avalikust kataloogist:

1. Läbida kõik 16 registrilehte ja koguda `Mscr`-algusega kohaviitade lingid.
   Kontrollida prefiksi piiri: register võib jätkuda järgmiste kohaviitadega.
2. Avada iga kohaviida all olevad bibliograafilised kirjed. Registrilehtede,
   kohaviitade ja kirjete arvud on eri asjad; ühe kohaviida all võib olla mitu
   kirjet. Eemaldada topeltkogumine b-numbri järgi, säilitades kõik kohaviidad.
3. Säilitada kirjeldused ja eksemplariandmed koos allikalingi ning kogumise
   kuupäevaga. Kasutada mõõdukat päringusagedust ja jätkatavat kogumist.
4. Võrrelda sedelitega esmalt seda andmestikku. Muutunud kohaviidaga säilik
   võib olla väljaspool praegust `Mscr` loendit, seega pole see kõigi sedelite
   suhtes täielikkuse tõend.

Eksport on täiendav allikas täielike märkuste, varasemate kohaviitade ja
eksemplariväljade jaoks ning veebist kogutu katvuse kontrollimiseks.

### Saadetud ekspordipalve

Kasutaja on ekspordi küsimiseks kirja saatnud; saadetud kirja täpset sisu
siin ei talletata. Arutelus soovitatud ulatus oli TÜ raamatukogu
Manuskriptide kogu / Fond 1 (Mscr), eelistatult MARCXML.

Ekspordi saabumisel kontrollida, kas kaasas on:

- ESTERi b-numbrid, kõik pealkirja- ja autoriväljad koos variantidega;
- dateering, keeled, maht, mõõdud ning täielikud märkused;
- hoidja, praegused ja talletatud varasemad kohaviidad;
- tulme-/inventarinumbrid ning eksemplarimärkused;
- seotud eksemplarikirjed või nende eraldi eksport, kui need
  bibliograafilisse eksporti ei kuulu.

Oluline on kogu/fondi ulatus, mitte ainult „käsikiri” teavikulaad.
Varasemate kohaviitade olemasolu ekspordis ei saa ette eeldada.

## Jätkamise sammud

Esimene praktiline samm: koguda eespool kirjeldatud avalik `Mscr`-loend ja
selle kirjed. Järgnevaid võrdlussamme saab alustada selle põhjal juba enne
ekspordi saabumist; ekspordi saabumisel täiendada ja kontrollida andmestikku.

1. Säilitada ekspordi originaal ja fikseerida kuupäev, ulatus, vorming ning
   bibliograafiliste ja eksemplariandmete katvus. Kontrollida kodeeringut.
2. Võtta VUTTist sedelite tekstid ja püsivad identifikaatorid. Väljundisse
   panna `work_id`, lehekülje püsiv tunnus (kontrollida sobivat lehetüve/ID-d),
   praegune leheküljenumber ja link. Ainult järjekorranumber ei ole piisav,
   sest lehti võidakse ümber järjestada.
3. Eraldada sedelite tunnused ja koostada ekspordi põhjal kandidaatide loend.
   Alustada teadaolevast positiivsest kontrollist Mscr 1309 ja kuuest
   kokaraamatusedelist; laiendada valimit teistesse teemadesse.
4. Võrrelda ka muutunud nimetuste ja kohaviitadega juhtumeid. Talletada iga
   kandidaadi puhul toetavad tunnused, vastuolud ja kontrollimiseks vajalik info.
   Võimalikud tööolekud: kinnitatud, kandidaat, vastet ei leitud.
5. Vaadata proovivalim üle. Hinnata, kui palju vasteid on ühesed ja millised
   reeglid tekitavad valesid kandidaate. Proov ei näita veel kogu kataloogi katvust.
6. Leppida proovivalimi põhjal kokku märkme lõplik kuju. Kontrollida märkmete
   olemasolevat API-t, õigusi ja ajalugu; säilitada senine tekst ning vältida
   sama seose korduvat lisamist. Alles siis kirjutada kinnitatud seosed.

Märkme esialgne näidis, **veel salvestamata**:

```text
ESTERi seos: kinnitatud
Kirje: https://www.ester.ee/record=b5547410*est
Sedeli kohaviit: Mscr. 1309
ESTERi kohaviit: Mscr 1309
Alus: kattuvad pealkiri, aasta 1806, maht 2 lehte ja mõõdud 31,6 × 20,0 cm.
Kontrollitud: 2026-11-11
```

Kandidaat ja tulemuseta otsing tuleb märkida selgelt kinnitatud seosest
erinevalt. „Vastet ei leitud” juurde lisada otsingu kuupäev ja ulatus;
sellest ei tohi saada väidet „ESTERis puudub”.
