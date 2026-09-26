# 0057 — Teose osad: lehetüvede hulk `_metadata.json`-is, muudetakse ainult osade otspunktidega

**Staatus:** kehtib

## Kontekst

Teos on füüsiline üksus; selle sees on iseseisvaid tekste (kirjad, luuletused, kõned,
istungid, lisad). Neil puudus oma kirje: adressaati ei saanud märkida, link ei viinud
õige teksti juurde ja seosed olid hägused (#464). Leheküljenumber on positsioon piltide
järjekorras ning lehetoimingud (järjestus, poolitus, kustutus) nihutavad seda.

## Otsus

- Osad on `_metadata.json` väljal `parts[]`. Osa lehed on **lehefailide tüvede hulk**:
  see võib olla katkendlik (vahelehed kirja sees) ja üks leht võib kuuluda mitmesse
  osasse (üks kiri lõpeb, teine algab samal lehel).
- Liigid: `letter | poem | speech | session | attachment`. Rollid: `auctor |
  addressee | praeses | participant | subject`. Mainitud isikud tulevad lehekülje
  märksõnadest, mitte rollist. Lisa viitab teisele osale (`attached_to`).
- Osi muudetakse **ainult** `/works/{id}/parts` otspunktidega (`server/work_parts.py`).
  Lugemine, muutmine ja kirjutamine käivad `metadata_lock`-i all (`bulk_update_works`)
  ühe git-commit'iga. `/update-work-metadata` lükkab välja `parts` tagasi (400), sest
  terve objekti salvestus kirjutaks samaaegse toimetaja osad üle.
- `refresh_work_mentions` kutsub `sync_work_parts`-i: iga lehetoiming, mis juba
  värskendab mainimisi (ADR 0055), ühtlustab ka osad. Poolitus annab `renamed`
  (`{algne_tüvi: [vasak, parem]}`). Kustutatud tüvi eemaldatakse osast. Tühjaks jäänud
  osa saab `needs_review: true`; seda ei kustutata.

## Tagajärjed

- Uus lehefaile või järjekorda muutev tee kutsub `refresh_work_mentions`-it (nagu ADR
  0055 nõuab) ja saab osade sünkroniseerimise sellega kaasa. Kui tee loob uued failinimed
  (nagu poolitus), peab see andma `renamed`-i.
- Prügikastist taastatud leht ei lähe osasse automaatselt tagasi.
- Seoste ja indeksite integratsioon (osa ulatusega paarid, `evidence.part_id`,
  `place.kind = sent_from | event`) on #464 PR 3.
