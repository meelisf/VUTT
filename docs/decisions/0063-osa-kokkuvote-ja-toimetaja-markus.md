# ADR 0063 — Osa avalik kokkuvõte on keelega väljades, toimetaja märkus on eraldi

**Kuupäev:** 2026-10-05
**Staatus:** kehtib
**Seotud:** ADR 0039 (sisuvälja keel on väljanimes), ADR 0057 (teose osad),
ADR 0058 (MCP ettepanekud)

## Kontekst

Teose osa `notes` kandis kahte eri asja korraga (mõõdetud 2026-10-05, 154 märget
163 osast, mediaan 764 märki):

- **toimetaja info** — „Indeks F114 · liik „kiri/fragment" · lehed 405–409;
  aadress 404", kahtlused saatja samastamisel;
- **avalik sisukokkuvõte** (regest) — „Sisu: Stade kiriklikud ja kohtuasjad; …".

Kõik oli eesti keeles; ingliskeelsel lugejal kokkuvõtet ei olnud. Ühes väljas ei
saanud ka valida, mida avalik vaade näitab.

## Otsus

1. **`abstract_et` / `abstract_en`** — avalik sisukokkuvõte, keel väljanimes nagu
   eluloo puhul (ADR 0039). Vaade näitab lugeja keelt, puudumisel teist keelt
   keelemärgiga (`partAbstract`).
2. **`notes`** — toimetaja märkus. **Ei ole salajane**: API annab ta kõigile ja MCP
   loeb seda (agendile on indeks ja kahtlused vajalik kontekst). Avalik vaade
   (töölaua sisukord) näitab teda ainult toimetajale. Kui märkus peaks kunagi
   saama mitteavalikuks, on see eraldi otsus (API-filter + MCP koodiga ligipääs).
3. **Ankur ainult ingliskeelsel** (`abstract_en_src` = eestikeelse räsi
   `text_hash`): tõlge käib ainult eesti → inglise. Ankru kirjutab AINULT server ja
   ainult kinnituse peale (`confirm_abstract_translation`); kliendi saadetud ankur
   visatakse ära, muul muutmisel jääb eelmine alles (`work_parts._with_anchor`).
   Ingliskeelne tühjaks → ankur kaob. ADR 0039 „vaata, mis muutus" diffi siin EI
   ole — vorm ainult hoiatab.
4. **Agent** annab `abstract_et`/`abstract_en`/`notes` eraldi (MCP juhis), ankrut
   mitte (`_PART_KEYS`). Liitmine olemasoleva osaga ei kirjuta täidetud
   kokkuvõtet üle (`_KEEP_EXISTING_TEXT`).
5. **Migratsioon** (`scripts/migrate_part_abstracts.py`, üks pass): „Sisu:" ees →
   `notes`, järel → `abstract_et`; markerita tekst → `abstract_et`. Vana välja
   nime ei kaotata, ainult tähendus kitseneb, seega contract-passi pole.

## Tagajärjed

- Vana MCP klient (pipx, uue juhiseta) võib panna kokkuvõtte `notes`-i — see
  jääb toimetaja märkuseks, kuni toimetaja selle ümber tõstab.
- CMIF-eksport (#464 PR 4) saab `abstract_*`-ist regesti, `notes`-ist mitte midagi.
- Isikukaardi `notes` (7 kirjet, 2026-10-05) on sama küsimus, mida see ADR ei
  lahenda.
