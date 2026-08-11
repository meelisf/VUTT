# ADR 0019 — Keelemärgend tähendab „sisaldab olulist osa selles keeles"

**Kuupäev:** 2026-08-11
**Staatus:** vastu võetud

## Kontekst

HUMGRAECA vol. 2 / Helleno-Nordica vajab kreekakeelse materjali korpusena
väljatoomist. `languages` väli oli praktiliselt täitmata: 1322 teosest kandis
`grc` märgendit 7, kuigi kreeka tähemärke sisaldab 775.

Automaattuvastuse jaoks mõõdeti (2026-08-11, tootmisandmed) kaks reeglit:

| Reegel | Teoseid |
|---|---|
| A: teose kogutekstis >= 20 % kreekat | 42 |
| B: vähemalt ühel leheküljel >= 20 % kreekat | 112 |

A on B täielik alamhulk. Vahe on 70 teost ja need on ladinakeelsed köited,
mille sees on kreekakeelne gratulatsioon, matuseluuletus või disputatsiooniosa —
projekti põhimaterjal, mitte servajuht.

## Otsus

`languages` sisaldab keelekoodi K, kui teoses on vähemalt üks lehekülg, mille
tähtedest on >= 20 % keeles K (ja neid tähemärke on >= 20).

Valitud reegel B.

## Tagajärjed

**Keelemärgend ei ütle, mis keeles teos on.** Ladinakeelne disputatsioon, mille
lk 7 on kreekakeelne gratulatsioon, kannab NII `lat` kui `grc`. 112 teosest on
70 tervikuna ladinakeelsed.

See on tahtlik ja see EI ole andmeviga. Kui kunagi on vaja „teos on
kreekakeelne" tähendust, on see eraldi väli, mitte `languages` kitsendamine —
lehepõhine info on väärtuslikum ja kitsam tähendus on sellest tuletatav.

## Invariandid

- **Tuvastus on rangelt lisav.** Skript ei eemalda kunagi olemasolevat
  keelemärgendit. `add_language` on idempotentne, seega kordusjooks ei tekita
  git-commiti.
- **Lävendid elavad `server/greek_detect.py`-s** (`GREEK_RATIO_THRESHOLD`,
  `GREEK_MIN_CHARS`), mitte skriptis. Nende muutmine muudab korpuse koosseisu ja
  on sisuline otsus, mitte häälestus.
- **Ainult kreeka.** Tähemärgistiku järgi on usaldusväärselt eristatav ainult
  kreeka ja heebrea. Ladina-tähestikuliste keelte (lat, deu, swe, est) eristamine
  nõuab keeletuvastusmudelit — see EI kuulu siia skripti.
- **Enne massijooksu käib kuivkäivitus päris andmetel** (ADR 0014 õppetund).
- **Koguosakaalu (`work_ratio`) nimetajas on KÕIGI lehtede tähed**, ka nende,
  kus kreekat ei ole. Osakaalu tagasituletamine üksiku lehe suhtarvust jätab
  kreekata lehed välja ja paisutab numbrit — see number on ainus, mille järgi
  inimene kuivkäivituse tulemust hindab, seega vaikne viga siin teeks
  ülevaatuse mõttetuks.

## Tagasi lükatud alternatiivid

- **Reegel A (kogutekstis >= 20 %)** — kaotanuks 70 teost, sh kõik kreeka
  gratulatsioonid. Lävendi valik oleks olnud pea tähtsusetu (10 % → 46 teost,
  50 % → 39), mis näitab, et A mõõdab teist asja: valdavalt kreekakeelsete
  teoste loomulikku klastrit.
- **Lehepõhine salvestus** — kreekakeelsete lehekülgede märkimine andmemudelis
  oleks võimaldanud võrguanalüüsi servakaale. Lükati edasi: see nõuab lahendust
  probleemile „kuidas siduda konkreetne gratulatsioon konkreetse isikuga", mis on
  omaette suurusjärk. Skripti aruanne salvestab lehefailinimed, seega andmed on
  olemas, kui selleni jõutakse.
- **`save_work_metadata()` kirjutusteena** — annaks 112 eraldi git-commiti, mille
  ADR 0015 hulgi-vastuvõtu puhul tagasi lükkas. Ükski olemasolev
  migratsiooniskript seda ei kasuta; kõik kirjutavad `_metadata.json`-i otse ja
  commitivad partiina.
