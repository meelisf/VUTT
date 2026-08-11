# ADR 0019 — `languages` loetleb teoses sisuliselt esinevad keeled, mitte põhikeelt

**Kuupäev:** 2026-08-11
**Staatus:** vastu võetud

## Kontekst

`languages` välja tähendus ei olnud kunagi kirja pandud. Praktikas kandis
enamik teoseid ühte koodi (`lat`) ja seda loeti vaikimisi „teose keeleks" ehk
põhikeeleks. Väli oli ühtlasi peaaegu täitmata: 1322 teosest kandis `grc`
märgendit 7, kuigi kreeka tähemärke sisaldab 775.

HUMGRAECA vol. 2 / Helleno-Nordica vajab kreekakeelse materjali korpusena
väljatoomist. Automaattuvastuse jaoks mõõdeti (2026-08-11, tootmisandmed) kaks
reeglit:

| Reegel | Teoseid |
|---|---|
| A: teose kogutekstis >= 20 % kreekat | 42 |
| B: vähemalt ühel leheküljel >= 20 % kreekat | 112 |

A on B täielik alamhulk. Vahe on 70 teost ja need on ladinakeelsed köited,
mille sees on kreekakeelne gratulatsioon, matuseluuletus või disputatsiooniosa —
projekti põhimaterjal, mitte servajuht.

Reegli B valimine tähendab, et ladinakeelne köide hakkab kandma ka `grc`
märgendit. Kui `languages` semantika jääks defineerimata, kehtiks väljal kaks
tähendust korraga: `grc` tähendaks „sisaldab kreekakeelset osa", aga `lat`
tähendaks endiselt „on ladinakeelne". See on tegelik otsustuskoht — `grc`
lisamine on ainult selle esimene rakendus.

## Otsus

**`languages` loetleb keeled, mis teoses sisuliselt esinevad. See EI ole teose
põhikeel ja väljast ei saa põhikeelt tuletada.**

Semantika kehtib **kõigi** keelekoodide kohta ühtemoodi, mitte ainult `grc`
kohta.

Operatiivne lävend: keel K kuulub loendisse, kui teoses on vähemalt üks
lehekülg, mille tähtedest on >= 20 % keeles K (ja neid tähemärke on >= 20).
Lehekülg on ühik, mitte teos.

Kreeka automaattuvastus (`scripts/detect_greek.py`, `server/greek_detect.py`) on
selle reegli esimene masinrakendus. Käsitsi märgistamisel kehtib sama tähendus.

## Tagajärjed

- **Ladinakeelne disputatsioon, mille lk 7 on kreekakeelne gratulatsioon, kannab
  NII `lat` kui `grc`.** 112 teosest on 70 tervikuna ladinakeelsed. See ei ole
  andmeviga.
- **Ükski väli ei kanna praegu teose põhikeelt.** Kui seda kunagi vaja läheb, on
  see eraldi väli — `languages` kitsendamine oleks infokaotus, sest kitsam
  tähendus on laiemast tuletatav, vastupidi mitte.
- **Teemat ei märgita keelena.** Ladinakeelne töö *kreeklastest* ei ole
  kreekakeelne. Praegustest käsitsi märgitud kirjetest kolm rikuvad seda
  (*Vitae Hannibalis epitome*, *De hospitalitate veterum Graecorum*,
  *De lyrica graecorum tragoedia*) — need on sisulised parandused, mitte
  skripti ülesanne, ja tuvastus neid ei puutu.

## Invariandid

- **Sama semantika kehtib kõigi keelte kohta.** Uue keele lisamisel (käsitsi või
  skriptiga) ei tohi tekkida erandit, kus üks kood tähendab „põhikeel" ja teine
  „esineb".
- **Tuvastus on rangelt lisav.** Skript ei eemalda kunagi olemasolevat
  keelemärgendit. `add_language` on idempotentne, seega kordusjooks ei tekita
  git-commiti.
- **Lävendid elavad `server/greek_detect.py`-s** (`GREEK_RATIO_THRESHOLD`,
  `GREEK_MIN_CHARS`), mitte skriptis. Nende muutmine muudab korpuse koosseisu ja
  on sisuline otsus, mitte häälestus.
- **Automaattuvastus ainult kreekale.** Tähemärgistiku järgi on usaldusväärselt
  eristatav ainult kreeka ja heebrea. Ladina-tähestikuliste keelte (lat, deu,
  swe, est) eristamine nõuab keeletuvastusmudelit — see EI kuulu siia skripti.
  Nende koodide käsitsi märkimisel kehtib sama 20 % tähendus.
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
- **`languages` jätmine põhikeele väljaks + eraldi „sisaldab" väli** — nõuaks
  uut välja, Meili indeksi muudatust ja kahe välja sünkroonis hoidmist. Ainus
  võit oleks olnud tagasiühilduvus lugemisviisiga, mida kuskil kirja pandud ei
  olnud.
- **Lehepõhine salvestus** — kreekakeelsete lehekülgede märkimine andmemudelis
  oleks võimaldanud võrguanalüüsi servakaale. Lükati edasi: see nõuab lahendust
  probleemile „kuidas siduda konkreetne gratulatsioon konkreetse isikuga", mis on
  omaette suurusjärk. Skripti aruanne salvestab lehefailinimed, seega andmed on
  olemas, kui selleni jõutakse.
- **`save_work_metadata()` kirjutusteena** — annaks 112 eraldi git-commiti, mille
  ADR 0015 hulgi-vastuvõtu puhul tagasi lükkas. Ükski olemasolev
  migratsiooniskript seda ei kasuta; kõik kirjutavad `_metadata.json`-i otse ja
  commitivad partiina.
