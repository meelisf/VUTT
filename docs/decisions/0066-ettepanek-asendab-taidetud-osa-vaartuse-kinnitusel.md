# ADR 0066 — Ettepanek võib asendada täidetud osa tekstivälja, ainult toimetaja kinnitusel

**Kuupäev:** 2026-10-07
**Staatus:** ettepanek
**Seotud:** ADR 0023 (MCP lugemine), ADR 0039 (vananemisankur), ADR 0057 (teose osad),
ADR 0058 (MCP kirjutab ainult ootel ettepaneku), ADR 0063 (kokkuvõte ja ankur)

## Kontekst

MCP `submit_work_parts_proposal` kirjutab ainult ootel ettepaneku; toimetaja kinnitab osa kaupa.
Olemasoleva osa parandamiseks annab agent `part_id`. `merge_part`
(`server/work_part_proposals.py`) täidab tekstiväljad (`_KEEP_EXISTING_TEXT`: `title`,
`incipit`, `notes`, `abstract_et`, `abstract_en`) ainult siis, kui väli on tühi — ka
`part_id` korral. `kind`, `dating` ja `place` seevastu võidavad `part_id` korral täidetud
väärtuse.

Tagajärg on vaikne kadu, mitte ainult piirang: toimetaja vorm alustab liidetud kujust
(`PartsTab.tsx` `editProposal`: `source = item.merged`), seega agendi pakutud uus tekst
täidetud väljale ei jõua toimetaja ette üldse. Toimetaja ei saa seda kinnitada ega tagasi
lükata, sest ta ei näe seda.

Git-ajalugu teeb muudatuse tagasipööratavaks, aga ei asenda kinnitust: avalikku kokkuvõtet
ega toimetaja märkust ei muuda agent ilma inimese otsuseta.

## Otsus

1. Kui ettepanek viitab olemasolevale osale (`part_id`), asendavad selle `title`,
   `incipit`, `abstract_et` ja `abstract_en` täidetud väärtuse. `notes` on toimetaja
   märkus (ADR 0063 p 2) ja ainult täieneb: pakutud tekst lisatakse olemasoleva järele
   (kui seda seal juba pole); toimetaja kohendab käsitsi. Ettepanekute loend näitab iga
   muudetud välja juures vana ja pakutud teksti (`text_changes`) enne kinnitamist.
2. Ilma `part_id`-ta (sama liigi ja samade lehtedega osa, tuvastatud automaatselt) jääb
   liitmine konservatiivseks: täidetud tekstivälja ei asendata. Vana teksti juurde näitab
   vorm siiski pakutud teksti, et see ei kaoks vaikselt.
3. Ankur käib nagu käsitsi muutmisel (`work_parts._with_anchor`, ADR 0039 p 2): ettepanek
   ankrut ei sea ega kustuta, `update_part` jätab eelmise alles. Kui ettepanek asendab
   `abstract_et`, jääb ankur vanaks ja vaade hoiatab tõlke vananemisest — see on soovitud.
4. Ettepanek ei kustuta osi ega välju. Tühi või puuduv väärtus jätab olemasoleva muutmata.
5. Kinnitus käib olemasoleva `decide`-teega (`update_part`, git-commit). MCP-le ei lisandu
   otsest kirjutust ega uut tööriista.

## Tagajärjed

- Agendi parandus jõuab toimetajani ettepanekuna; ADR 0058 põhimõte jääb kehtima.
- `merge_part`: `explicit` korral asendavad tekstiväljad, `notes` täieneb (`_APPEND_ONLY_TEXT`).
- `list_pending` annab iga ettepaneku kohta `text_changes` (vana, pakutud, `replace` | `append` | `kept`);
  `PartProposals` näitab neid ettepaneku real.
- MCP tööriista juhis (`mcp/vutt_mcp/server.py`, „OLEMASOLEVA OSA PARANDUS") uueneb:
  `part_id`-ga saadetud tekstiväli asendab täidetud välja, ilma `part_id`-ta mitte.
- Testid: `merge_part` mõlemas režiimis; ankur ei muutu ettepaneku kinnitusel.
