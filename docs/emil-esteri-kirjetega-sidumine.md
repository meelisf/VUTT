# EMILi sedelite sidumine ESTERi kirjetega

**Seis 2026-11-13.**

- **Esimene voor on tehtud.** ESTERi Mscr-kohaviidaregister võrreldi sedelitega ja
  162 seost kirjutati lehe märkusteks.
- **Teine voor käib.** Selles otsitakse Z39.50 kaudu autori ja pealkirja järgi.
  Õigusteaduse (Balti) jaotus on tehtud: 19 märkust on kirjutatud ja 10 neist
  parandatud b-numbri vea tõttu (vt [Lõksud](#lõksud)). Ootel on ülejäänud
  20 teemajaotust, umbes 920 seostamata sedelit.
- **Eksport.** Kasutaja palus kirjaga ESTERist käsikirjade eksporti. Vastust
  pole veel tulnud (vt [Ekspordipalve](#ekspordipalve)).

Jätkamiseks loe [Teise vooru töövoog](#teise-vooru-töövoog) ja [Lõksud](#lõksud).

## Eesmärk ja andmete tasand

Siduda [EMILi manuskriptide sedelkataloogis](https://vutt.utlib.ut.ee/?collection=emil-manuskriptid)
kirjeldatud säilikud ESTERi kirjetega. Kõigil sedelitel ei pruugi ESTERis
kirjet olla. Tulemusetu otsing ei tõesta, et kirjet pole.

VUTTis on 22 teemajaotust (teost) ja 1332 sedelipilti (lehekülge). Importimise
taust: [emil_import.py](../scripts/archive/emil_import.py). Teos on teemajaotus,
näiteks „Kokaraamatud – Manuskriptide kogu süstemaatiline sedelkataloog”, mitte
üks sedelil kirjeldatud käsikiri. Teose `ester_id` kuulub seega jaotusele. Sedeli
seos kirjutatakse **lehe märkuseks** ja uut andmevälja ei ole.

## Samastamise põhimõtted

Kataloog on vana: **muutunud võivad olla nii nimetused kui kohaviidad**.
Kohaviit on hea otsinguvihje, aga mitte ainus alus, ja erinevus ei välista
samastamist. Võrreldakse tunnuste kombinatsiooni: hoidja, vana ja praegune
kohaviit, tulme- ja inventarinumber, autor ja nimevariandid, pealkiri,
provenients, dateering, keel, maht ja mõõdud.

Suhe ei pruugi olla üks ühele. Mitu sedelit võib kirjeldada sama säilikut. Sedel
võib kirjeldada säiliku osa. Ühele sedelile võib ESTERis vastata mitu kirjet,
näiteks köited või isikuarhiivi üksused.

**Sedelilt OCR-iga loetud number on otsinguvihje, mitte tõend.** Käsitsi
kirjutatud numbreid aetakse sageli segi: 3↔9, 5↔6, 4↔7, 1↔4. Esimese vooru kõik
juhtumid tüüpi „number kattub, sisu erineb” ja „kohaviit muutunud” osutusid pildil
OCR-veaks. Numbri vastuolu korral vaata pilti (`get_page_image`).

## Märkuse kuju

Seos kirjutatakse **lehe kommentaarina** (`comments[]`, Markdown, ADR 0008)
kasutaja nimel. Agentide vasted pannakse paika ilma inimülevaatuseta (kasutaja
otsus 2026-11-12), sest märkus ütleb, et seos on leitud automaatselt. Vead
parandatakse töö käigus.

```markdown
**ESTER:** [b46422390](https://www.ester.ee/record=b4642239*est) · F 55, nim. 1, endine Mscr 1171
Bröcker, Erdmann Gustav von. Die ausserordentlichen Prozesse … \[Dorpat\], 1830.
_Seos leitud automaatselt ESTERi otsingu põhjal (autor ja pealkiri), 2026-11-13._
```

- **Esimene rida** algab alati `**ESTER`. Rida sisaldab b-numbreid ja kohaviidet:
  esimeses voorus `Mscr N`, teises väli `773` kujul „F 55, nim. 1” pluss
  „endine Mscr N”, kui väli `500` selle märgib.
  - Kirjutaja tunneb olemasoleva seose ära `**ESTER` ja b-numbri järgi.
  - Sulgudes võib olla silt: `säiliku osa`, `kandidaat`, `köited` või
    `mitu kirjet`. Mitme kirje korral järgneb kirjete loend.
- **Link** on `https://www.ester.ee/record=<b ilma viimase märgita>*est`. Viimane
  märk on kontrollnumber.
- **Teisel real** on autor, pealkiri (kärbitud 220 märgini) ja ilmumisandmed.
- **Põhjenduse rida** lisatakse ainult erijuhul: osa, ebakindel vaste
  („Ebakindel vaste: …”), vastuolu (maht, formaat, nimekuju). Samuti juhul, kui
  ESTERis kohaviit puudub („Sedelil Alex 2935, ESTERis kohaviit puudub.”). Need
  read on kirjutatud käsitsi.
- „Sama kirjega on seotud ka: …” lisatakse, kui kirje on seotud mitme sedeliga.
- **Jalus:** esimeses voorus „… Mscr-registri põhjal ja pisteliselt üle
  vaadatud”, teises „… ESTERi otsingu põhjal (autor ja pealkiri)”.
- **„Erinev” ja vasteta sedelile ei kirjutata midagi.**

**Kirjutaja** on `scripts/archive/emil_ester_markused.py`. See käib serveris
`/save` kaudu, nii et kirjutus läbib lehe luku, kolmesuunalise liitmise, commit'i
(üks lehe kohta) ja Meili sünkrooni. Vana `meta_content`-kujuga lehe jätab
skript vahele.

- Kordus on ohutu: sama b-numbriga märkusega leht jäetakse vahele.
- Kui kirjel on väli `asenda_b` (varem kirjutatud vale number), asendatakse
  selle numbriga märkuse tekst. Kommentaari id, autor ja aeg jäävad samaks.

```bash
ssh vutt
cd ~/VUTT && git pull && cd scripts/archive
python3 emil_ester_markused.py --andmed emil_ester_z3950/<jaotus>_markused.json            # kuivkäivitus
python3 emil_ester_markused.py --andmed emil_ester_z3950/<jaotus>_markused.json --kirjuta  # küsib kasutajanime ja parooli
```

Ilma `--andmed` võtmeta loeb skript esimese vooru faili `emil_ester_seosed.json`.
`--kirjuta` küsib parooli, seega käivitab selle kasutaja ise. Agent teeb
kuivkäivituse.

## Teise vooru töövoog

### Miks Z39.50

ESTERis on Mscr-kohaviidaga eksemplare ainult umbes 400. Ülejäänud säilikud on
**muude kohaviidete all** või kataloogimata. Kohaviited on näiteks isiku- ja
arhiivifondid: F 14 Haubold, F 55 Tartu Ülikool 1802–1919 (loengukonspektid),
F 8 Müthel, F 20 Rummel, F 26 tsensuurikomitee. Alexandri kogul („Alex 29xx”)
puudub ESTERis kohaviit sageli täiesti. Selliseid kirjeid leiab ainult sisu
järgi.

Sobimatud allikad:

- **OAI-PMH:** aeglane, kogumaht teadmata, eksemplariandmed puuduvad.
- **Veebiotsing:** laiendab päringu vaikselt OR-iks.

Z39.50 andmed:

- Ühendus: `www.ester.ee:212/innopac`, UTF-8, avalik. Port 210 on MARC-8.
- Klient: `yaz-client` (apt-pakett `yaz`). Pythoni teeki PyPI-s ei ole.
- Vastuseks tuleb täielik MARC-kirje.

### Sammud ühe teemajaotuse kohta

Tööfailid on scratchpadis, ühes kaustas jaotuse kohta. Lõpptulemus kopeeritakse
kausta `scripts/archive/emil_ester_z3950/` jaotuse eesliitega (`oigusteadus_…`).

1. **Sedelid.**
   - Võta jaotuse lehtede tekstid avalikust otsinguindeksist (kogu
     `emil-manuskriptid`, väli `text_content`) või MCP `get_pages` kaudu.
   - Jäta välja lehed, millel on juba seos (`emil_ester_seosed.json`, varasemad
     `*_markused.json`).
   - Kuju: `[{work_id, lk, tekst}]`.
2. **Märksõnad (Haiku-agent).**
   - Igalt sedelilt võetakse autorite perenimed (ka lektor ja kirjutaja, OCR-vead
     parandatud, nt Kilchen → Hilchen), 1–3 iseloomulikku pealkirjasõna
     originaalkujul, kohaviit ja aasta.
   - Väljund: `margsonad.jsonl`, rida kujul
     `{work_id, lk, autorid[], pealkirjasonad[], kohaviit, aasta, loetav}`.
3. **Päringud:** `python3 scripts/archive/emil_ester_z3950/z_otsi.py <kaust>`.
   - Igal sedelil on kuni 8 päringut: `1003` iga perenimi, `1=4` iga
     pealkirjasõna ning `1016` perenimi + sõna ja sõna + sõna (ainult täppideta
     sõnad).
   - Filter: TÜ käsikirjad (`040 ErTUR` ja leader/6 `t`/`d`/`f`, `773`,
     `351 Säilik` või `500 Käsikiri`).
   - Kirje, mille leidis mitu päringut, tuleb ettepoole. Ühe päringu tabamus jääb
     alles ainult siis, kui päring andis ≤ 5 TÜ käsikirja.
   - Väljund: `z_kandidaadid.json`. 246 sedelit võttis umbes 15 minutit.
4. **Hindamine (Sonnet-agendid, umbes 50 sedelit agendi kohta).**
   - Agent saab sedeli teksti ja kandidaadid.
   - Olek on üks neist: `kinnitatud`, `osa`, `kandidaat`, `erinev`.
   - Juhend:
     - Endise kohaviite kattumine on tugev tõend.
     - Eri kirjutaja või aastaga konspekt on eri säilik.
     - Sama teose teine eksemplar (nt 4° vs 34 cm) on erinev.
     - Kui sedelile vastab mitu kirjet (köited, arhiiviüksused), siis `osa` ja
       kõik b-numbrid.
   - **Iga sedel saab oma põhjenduse, ka „erinev” puhul:** parim kandidaat ja üks
     lause, miks see ei sobi, või „kandidaate ei olnud”.
   - Väljund: `otsused.jsonl`, rida kujul
     `{work_id, lk, olek, b, ester_kogu, endine_kohaviit_kattub, alus}`.
5. **Andmefail:** `python3 scripts/archive/emil_ester_z3950/koosta_markused.py <jaotus>`.
   - Loeb failid `<jaotus>_otsused.jsonl` ja `<jaotus>_z_kandidaadid.json`.
   - Lisa enne skripti `KAUSTAD`-isse jaotuse kaust ja lühinimi.
   - Lisa `LISA`-sse käsitsi read: kohaviide, vastuolud, mitme kirje b-loend ja
     lühipealkirjad (kui ESTERi pikk pealkiri kärbiks eristava osa, näiteks köite
     numbri).
   - Väljund: `<jaotus>_markused.json`.
6. **Märkuste kirjutamine:** kuivkäivitus, siis kasutaja käivitab `--kirjuta`
   (vt [Märkuse kuju](#märkuse-kuju)). Enne kirjutamist ava paar linki ESTERis ja
   veendu, et need avavad õige kirje.

### Lõksud

**b-number tuleb ainult väljast `907`** (see on sama mis `035 (ErESTER)b…`).
Vanematel kirjetel on väljas `035` lisaks vana Tartu kohaliku süsteemi number
`.b25711295 (Tartu)`. See näeb välja nagu ESTERi number, aga link ei avaks
ühtegi kirjet.

- Esimene `z_otsi.py` võttis esimese vaste väljadest `035`+`907`.
- Õigusteaduse 19 märkusest 10 kirjutati vale lingiga.
- Viga leiti lehel [2li9jm/3](https://vutt.utlib.ut.ee/work/2li9jm/3).
- Parandatud 2026-11-13: vanad numbrid leiti uuesti Z39.50 kaudu (vastendus
  failis `oigusteadus_b_kaart.json`) ja märkused asendati `asenda_b` kaudu.
  Failis `oigusteadus_z_kandidaadid.json` on parandatud ainult seotud kirjete
  numbrid.
- Esimest vooru see ei puuduta, sest seal tulid numbrid ESTERi registrist.

Z39.50 indeksid (mõõdetud 2026-11-12). Ilma neid teadmata jääb enamik päringuid
tühjaks:

| Indeks | Käitumine |
|---|---|
| `1=4` pealkiri | Üks sõna = sõna pealkirjas (ka `$p`). Mitu sõna = fraas. Algusartikkel jääb välja: „Die Adresse…” annab 0, „Adresse…” annab 1. Täpitähed töötavad. |
| `1=1003` autor | Perekonnanimi, täpitähed töötavad („Müthel” 90). |
| `1=1016` sõna | Mitu sõna = AND, järjekorrast sõltumata („Haubold Basilicorum” 7). **Täpitähtedega sõnu ei leia** („kurländische” 0). |
| `@and` | Ei tööta, annab alati 0. Kombineeri `1=1016`-ga või kliendi poolel. |
| kärpimine | `@attr 5=1` / `*` ei toiminud usaldusväärselt. |
| lagi | Lai päring annab kuni 500 tulemust. Kogu (`773`) järgi otsida ei saa. |

Muud tähelepanekud:

- **Leitakse ka teiste raamatukogude kirjeid**, näiteks TLÜ käsikiri
  „[Kochbuch]”. Filter `040 ErTUR` on vajalik.
- **Kirje väljad:**

  | Väli | Sisu |
  |---|---|
  | `300` | maht |
  | `500` | märkused, sh „Endine kohaviit: Mscr …” |
  | `541` | tulme |
  | `773` | kogu või fond |

### Õigusteaduse (Balti) tulemus

Jaotuses oli 246 seostamata sedelit. Kandidaate leiti 107-le. Neist 14 said
oleku kinnitatud, 4 osa, 1 kandidaat ja 88 erinev. 139 sedelil kandidaate ei
olnud.

- Pildilt kontrolliti kaks juhtumit ja mõlemad olid õiged:
  - lk 71: läbi kriipsutatud „136” = ESTERis endine Mscr 136;
  - lk 202: OCR luges 1465, pildil Mscr 1165.
- Kasutaja vaatas „erinevate” näidised üle ja pidas otsuseid õigeks. Enamik on
  ühesõnalise päringu müra.
- Vasteta 139 sedelit on enamasti Samson von Himmelstierni käsikirjad ja
  numbrita sedelid (Acc. 1922). Need on tõenäoliselt kataloogimata, aga
  täpitähtede tõttu pole see tõendatud.
- Mitme kirjega sedeleid on neli:
  - lk 96: Poola seaduste köited II–VI, kõik viis leitud;
  - lk 123: viis Kuramaa köidet;
  - lk 108: Mütheli kaks kogu;
  - lk 171: Rummeli pärand.

Failid: `scripts/archive/emil_ester_z3950/oigusteadus_*`.

## Esimene voor: Mscr-register (tehtud 2026-11-12)

**Lähteandmed:** `reference_data/mscr-loend.txt`, ESTERi Mscr-kohaviidaregistri
16 lehe eksport (CSV, UTF-8).

- Failis on 428 rida ja 398 eri numbrit vahemikus 1–1594, ehk umbes veerand
  numbriruumist.
- Ühe numbri all võib olla mitu kirjet.
- INV-veeru väärtus `Mscr N` **ei ole vana kohaviit**.

**Sedelid:** Mscr-viide leiti 405 sedelilt. OCR-i kujud olid muu hulgas
„Msgr.”, „Nscr.” ja kirillitsa „Мscr”.

**Meetod:**

1. Skript leidis kandidaadid numbri kattuvuse ja IDF-kaalutud sõnakattuvuse
   järgi.
2. Neli Sonnet-agenti hindasid need.
3. Kõik numbri ja sisu vastuolud kontrolliti pildilt.

Tulemus 377 sedeli kohta: kinnitatud 149, osa 8, kandidaat 5, erinev 215.

**Ülevaatus:** üle vaadati 166 paari ülevaatuslehel
<https://claude.ai/artifact/1ebD3BchgMAjn8bb7SdoYF> (otsused artefakti
andmebaasi kogus `otsused`). Tulemusena kirjutati 162 märkust
(`scripts/archive/emil_ester_seosed.json`). Kuue sedeli OCR-parandus esitati
lehe teksti ettepanekutena (#641) ja need on vastu võetud.

OCR-vigade näited (number kattus näiliselt):

| Sedel | OCR | Pildil |
|---|---|---|
| 996o7v/51 | 1096 | 1036 → ESTERi Mscr 1036 |
| 80jmb1/103 | 1253 | 1263 → ESTERi Mscr 1263 |
| bg8u9j/7 | 1337 | 1334 → ESTERi Mscr 1334 |
| p02t8o/174 | 1427 | Mscr 1127 läbi kriipsutatud → F. 14 (kohaviit päriselt muutunud) |

## Veebikataloogi lõksud (otsingukatse 2026-11-11)

- **Kohaviidaotsing:** vasteta päringu korral näitab see lähedasi kohaviitu ja
  teksti „asuks siin”. See ei ole vaste.
- **Sõnaotsing:** laiendab AND-päringu vaikselt OR-iks („PÄRINGUT MUUDETI”).
  HTTP 200 ja tulemuste arv ei tähenda, et algne päring leidis midagi.
- **Teavikulaad „käsikiri”:** sellega piiramine jätab kirjeid välja. Näiteks
  Mscr 1309 on kirjeldatud litograafiana.
- **Tulmenumber:** usaldusväärset otsimise viisi ei leitud.

## Ekspordipalve

Kasutaja palus kirjaga TÜ raamatukogu Manuskriptide kogu (Fond 1, Mscr) eksporti,
eelistatult MARCXML-is. Ekspordi saabumisel kontrolli, kas selles on:

- b-numbrid, pealkirja- ja autorivariandid;
- dateering, maht, mõõdud ja täielikud märkused;
- praegused ja varasemad kohaviidad;
- tulme- ja inventarinumbrid, eksemplarimärkused.

Oluline on kogu või fondi ulatus, mitte teavikulaad. Eksport võimaldaks
kontrollida ka teise vooru vasteta sedeleid. Lisaks oleks sellest näha, kas
nende kirje puudub ESTERis või ei leidnud Z39.50 seda.
