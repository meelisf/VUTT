# 0078 — Isikukaardi allikas võib viidata VUTT-i teosele või osale

**Staatus:** kehtib (2026-11-08)

## Kontekst

Isikukaardi „Allikad ja bibliograafia" (`sources[]`) oli vabatekst `{text, note}`.
VUTT-i enda teost (nt personaalia matusetrükises) sai seal mainida ainult tekstina,
lingita, ja pealkiri kopeeriti kaardile käsitsi. Faktide tõenditel (`evidence`) oli
VUTT-i viide juba olemas (`source_kind: "vutt_page"`, `work_id`, `page`, `part_id`).

Laiem probleem — sama kirjandus sisestatakse igale kaardile uuesti — lahendatakse
eraldi uurimisbaasiga (LOSSis, VUTT-ist sõltumatu moodul). See ADR katab ainult
VUTT-i-sisese viite.

## Otsus

1. **Kirje kuju.** `{text?, note?, work_id?, part_id?, page?, printed_page?}`.
   `work_id` olemas → VUTT-i viide; muidu vabatekst (`text` kohustuslik). Väljade
   nimed on samad mis `vutt_page` tõendil. `page` = lehe järjenumber teoses
   (`/work/{id}/{page}`), `printed_page` = trükitud number viites (vabatekst).
2. **Pealkirja ei salvestata.** Teose pealkiri ja osa silt tulevad vaate ajal teoselt
   (`POST /prosopography/work-titles`, `GET /works/{id}/parts`). VUTT-i kirjel on
   `text` valikuline täiendus („personaalia").
3. **Kontroll ainult kirjutusteel** (`server/prosopography/person_sources.py`,
   `update_person`): tundmatu väli, kehtetu `work_id`, teisele teosele kuuluv
   `part_id` või mittepositiivne `page` → 400. Tühi väli = võtme puudumine; tühi rida
   visatakse vaikselt ära. Hiljem kustutatud teos/osa kaarti ei riku — vaade näitab
   siis `work_id`-d.
4. **Lingi poliitika** on sama mis tõenditel: pealkiri ei ole salajane, botile (SEO-HTML)
   antakse link ainult avalikule teosele.
5. **Vastupidist seost ei tehta.** Allikaviide EI kirjuta `person_to_works.json`-isse —
   sellel on juba kaks kirjutajat (rollid, `mentioned`). Teose lehel „kasutatud allikana"
   on eraldi otsus.
6. **MCP ettepanek ei paku allikakirjeid** enne, kui uurimisbaas on olemas: siis viitab
   agent baasi kirjele, mitte vabatekstile.

## Tagajärjed

- Vanad kirjed (`{text, note}`, ka paljas string) kehtivad muutmata.
- Uus allikavälja liik lisatakse kõigisse kolme kohta: `person_sources.py`,
  `personForm/helpers.ts` (ümarreis) ja `PersonSourceLine`.
