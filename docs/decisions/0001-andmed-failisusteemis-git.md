# 0001 — Andmed failisüsteemis + git, mitte andmebaasis

**Staatus:** kehtib

## Kontekst

Teadusandmestik (transkriptsioonid, metaandmed, prosopograafia) peab olema
pikaajaliselt loetav, auditeeritav ja taastatav ka ilma rakenduseta.
Kasutajaid on sadu, mitte miljoneid; kirjutuskoormus on madal.

## Otsus

- Iga teos = kaust (`data/{slug}/`), iga lehekülg = `.txt` + `.json` + `.jpg`,
  metaandmed = `_metadata.json`. Prosopograafia = fail isiku kohta
  (`data/config/prosopography/{nanoid}.json`).
- Iga salvestus = git commit (`server/git_ops.py`). Esimene commit on alati
  originaal-OCR — igavesti taastatav.
- Otsing käib Meilisearchi kaudu (tuletatud, taastaastatav — vt ADR 0007).
- Andmebaasi teadlikult EI kasutata põhiandmete jaoks.

## Tagajärjed

- Skeemimuudatused tehakse migratsiooniskriptidega üle failide
  (`scripts/migrate_*.py`), iga migratsioon on git-diffitav ja tagasipööratav.
- Failid on inimloetavad — korpus ei ole rakenduse vangis (vt ka issue #134,
  eksport standardformaati).
- Piirid: täisfaili-ülekirjutusega indeksid ja mälus-filtreerimine töötavad
  ~kümnete tuhandete kirjeteni; suurusjärgu kasvades on plaan B SQLite
  tuletatud andmetele (issue #132 on selle proovikivi), MITTE põhiandmetele.
- Samaaegsus lahendatakse lukkude + atomaarsete kirjutustega
  (`atomic_write_json`), mitte transaktsioonidega — iga uus kirjutustee PEAB
  sama mustrit järgima (vt issues #114–#119, mis parandasid rikkumisi).
