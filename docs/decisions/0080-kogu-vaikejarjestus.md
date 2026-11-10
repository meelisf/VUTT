# 0080 — Kogu vaikejärjestus avalehel (`default_sort`)

**Staatus:** vastu võetud 2026-11-10

## Kontekst

Avalehe vaikejärjestus on aasta järgi (`year_asc`). EMILi sedelkataloogi kogus
(`sedelkataloog-emil` → `emil-manuskriptid`) aastaid sisuliselt ei ole, teosed on
teemad („Ajalugu – …", „Arstiteadus – …") ja loomulik järjestus on A–Z. Jagatud link
`?collection=…&sort=az` aitab ainult esimesel sisenemisel: päise „Teosed" link
(`Header.tsx`) ja kogu valija viivad paljale `/`-le, kus kogu tuleb kontekstist
kaasa, aga `sort` mitte. Kasutaja tuleb teoselt tagasi menüü kaudu ja järjestus
on jälle aasta järgi.

## Otsus

1. **Kogul on valikuline väli `default_sort`** (`collections.json`), väärtus üks
   järgmistest: `year_asc`, `year_desc`, `az`, `recent`. `relevance` ei kuulu sinna:
   ilma päringuta pole tal tähendust. Loend on kahes kohas, mis peavad kattuma:
   `COLLECTION_DEFAULT_SORTS` serveris (`server/routers/collections.py`) ja kliendis
   (`src/services/collectionService.ts`).
2. **Alamkogu pärib** lähimalt esivanemalt, kellel väli on (`collectionDefaultSort`,
   sama tsüklikindel ahel mis nähtavusel). Lubamatu väärtus jäetakse lugemisel
   vahele: käsitsi muudetud fail ei murra avalehte.
3. **Vaikejärjestuse järjekord avalehel** (`dashboardDefaultSort`): URL-i `sort` võidab
   alati (kasutaja valik); päringuga relevantsus; muidu aktiivse kogu `default_sort`;
   muidu `year_asc`. Päringu tühjendamine relevantsuselt viib päringuta
   vaikejärjestusele ja EI kirjuta seda URL-i — vaikimisi väärtus järgib kogu vahetust,
   mitte ei kinnistu kasutaja valikuna.
4. **Kirjutus** käib olemasoleva `PUT /admin/collections/{id}` kaudu (superadmin,
   `save_config_with_git`, ADR 0040). Puuduv võti = ära puutu (vana klient), `null`/`""`
   = eemalda, vale väärtus → viga ENNE ühtki muutust (paketi ülejäänud väljad ei
   salvestu vaikselt). Haldusvormis on valik „Vaikejärjestus avalehel", tühi valik
   näitab päritud väärtust.

## Tagajärjed

- Menüülink, kogu valija ja `sort`-ita jagatud link annavad kogu järjestuse; uut
  URL-i sünkroniseerimisteed ei tule (ADR 0038 jääb kehtima).
- Töökollektsioonil (`s:<id>`) vaikejärjestust ei ole — vajaduse korral eraldi otsus.
- Uus järjestusvalik avalehel nõuab mõlema loendi täiendamist; valvur on serveri test
  `tests/test_collection_default_sort.py` ja kliendi `collectionService.test.ts`.
