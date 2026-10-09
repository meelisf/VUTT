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
- Liigid: `letter | poem | prose | speech | session | section | attachment`. Rollid: `auctor |
  addressee | praeses | participant | subject`.
  `section` (täiendus 2026-10-09, silt „Osa”) on žanrineutraalne struktuuriüksus
  (raamatu peatükk, register), et sisukorda saaks teha ka teosele, mille osad ei ole
  ükski vormiliik; `prose` ei sobi selleks, sest see on vormiväide.
- **Liik on teksti VORM, mitte ülesanne** (täiendus 2026-10-05). Gratulatsioon,
  pulma- ja leinaluuletus, pühendus ning hinnang on sama funktsiooni variandid ja
  tulevad rollipaarist: `auctor` → `subject` (õnnitletav / lahkunu), pöördumise saaja
  `addressee`. Uut liiki `gratulation` ei lisata: värsis gratulatsioonil poleks siis
  üht õiget liiki. `prose` katab vormilt proosatekstid (eessõna, järelsõna, tellitud
  tutvustus või hinnang, proosas pühendus). Teose tasandi rolli `gratulator` kood jääb
  (seoste reeglid ja Meili sõltuvad sellest), silt on „Kaasteksti autor", sest ta
  kehtib ka leinatrükistes. **`dedicator` ≠ `gratulator`** (täiendus 2026-10-06):
  pühendaja kirjutab teosele pühenduse (võib olla ka autor ise → kaks kannet);
  kaasteksti autor kirjutab teosesse oma teksti (gratulatsioon, leinaluuletus) —
  pühenduslik funktsioon ei tee temast pühendajat. Segi läinud 36 kannet neljas
  leinatrükises parandati (`scripts/migrate_dedicator_to_gratulator.py`); vormis on
  rolli juures vihje. Mainitud isikud tulevad lehekülje
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
- Indeksid (#464 PR 3): osa isikud on `person_to_works`-is `part_id`-ga, mainimised
  `part_ids` / `part_only`-ga (`indices.metadata_entries` ja `mention_entries` — üks
  ehitaja rebuildile ja uuendusele). Teose faktid kannavad `parts`-i koos
  leheküljenumbritega, mis arvutatakse **kirjutamisel**: `update_work_facts` vajab
  teose kausta ja `sync_work_parts` kirjutab faktid ka siis, kui osad ei muutunud
  (ümberjärjestus nihutab numbreid). Osa toiming uuendab isikud (`call_ptw`) ja
  mainimised. Seosed osa ulatuses: ADR 0056.
