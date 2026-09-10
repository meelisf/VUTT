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
- **Indeksifailid EI OLE `data/` gitis** (alates 2026-09-10). `rebuild_indices()`
  kirjutab nad iga serveri stardi ajal üle, seega olid nad repos pidevalt
  „muudetud" ja see püsiv müra peitis päris muudatusi: 437 committimata
  lehteksti seisid märkamatult, sest `git status` ei olnud kunagi puhas.
  `data/.gitignore` ignoreerib neid nüüd; failid elavad kettal ja varunduses.
  Sama põhjendus mis ülal — nad on nullist taastatavad, ajaloos ei ole neist kasu.
- Piir: täisfaili-ülekirjutus + mälus-filtreerimine kannab ~kümneid
  tuhandeid kirjeid; sealt edasi SQLite (vt ADR 0001, issue #132).
