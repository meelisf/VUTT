# 0007 — Tuletatud indeksid on nullist taastatavad read-modelid

**Staatus:** kehtib

## Kontekst

Prosopograafia ja teoste seosed vajavad kiireid päringuid (isiku teosed,
kollektsiooni isikud, loojate-vahelised seosed), aga põhiandmed on
failides (ADR 0001) — iga päringu peale kõigi failide lugemine ei skaleeru.

## Otsus

Tuletatud indeksid (`prosopography_index.json`, `person_to_works.json`,
`works_creators_index.json`, `work_collections_index.json`) on
**read-modelid**: neid uuendatakse inkrementaalselt kirjutamisel JA nad on
ALATI täielikult taastaastatavad põhiandmetest
(`server/prosopography/indices.py` `rebuild_indices()`, käivitub ka serveri
stardil taustalõimes). Sama põhimõte kehtib Meilisearchi indeksile
(seed-skript = täisrebuild).

## Tagajärjed

- Indeksi skeemi muutmine on ohutu: muuda ehitusloogikat + käivita rebuild.
  Indeksifailide käsitsi parandamine on keelatud muster — parandus tehakse
  põhiandmetes.
- Inkrementaalne uuendus ja rebuild PEAVAD andma sama tulemuse — kui lisad
  välja indeksisse, lisa see MÕLEMASSE teesse (sama lõks nagu ADR 0006).
- Kahtluse korral („indeks tundub vale") on esimene samm rebuild, mitte
  silumine.
- Piir: täisfaili-ülekirjutus + mälus-filtreerimine kannab ~kümneid
  tuhandeid kirjeid; sealt edasi SQLite (vt ADR 0001, issue #132).
