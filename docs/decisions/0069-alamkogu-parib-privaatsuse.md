# ADR 0069 — Privaatse kogu alamkogu on privaatne

**Kuupäev:** 2026-10-16
**Staatus:** kehtib
**Seotud:** ADR 0031 (kirjutamisõigus = lugemisõigus + ulatus), ADR 0043 (kogude õiguste toimingud), #617

## Kontekst

Teose `is_public` arvestas ainult teose OTSESTE kogude `visibility`-t. Privaatse
vanema alla loodud alamkogu, millel oma `visibility` puudus (vaikimisi „public"),
tegi oma teosed avalikuks — kuigi kasutaja ootab, et privaatse kogu sisu jääb
privaatseks. Arvutus elas neljas koopias (`access_ops`, `meili_doc`,
`meilisearch_ops` massuuendus, `auth` õiguse määramine), mis võisid lahku minna.

Lugemisõigus oli samuti ebaühtlane: tenant-token lubas `collections_hierarchy IN
[allowed]` (esivanema õigus katab alamkogu), aga `can_read_work` ja
`is_search_visible` vaatasid ainult otseseid kogusid — teos oli leitav, aga mitte
avatav.

## Otsus

1. **Kogu kehtiv nähtavus tuleneb ahelast:** kogu on avalik ainult siis, kui
   tema ise JA kõik esivanemad on avalikud. Kogu enda `visibility` on
   salvestatud määrang; privaatne esivanem kaalub selle üles.
2. **Teose tasandil jääb „public wins"**: piisab ühest kehtivalt avalikust kogust.
3. **Üks allikas: `server/collection_tree.py`** (puhas, stdlib) — kasutavad nii
   live- kui seed-tee. Frontendi peegel: `isCollectionRestricted` /
   `isCollectionAllowed` (`src/services/collectionService.ts`).
4. **Esivanema lugemisõigus katab alamkogu** ka `can_read_work`-is ja
   `is_search_visible`-is (sama hulk, mis Meili `collections_hierarchy`).
5. **Vanema nähtavuse muutus uuendab Meilis ka järglaskogude teosed**
   (`update_collection_is_public_async` → `collection_descendants`).
6. `GET /admin/collections/{id}/users` `visibility` on KEHTIV nähtavus — ta ütleb,
   kas lugemismäärang mõjub; õigust tohib määrata kehtivalt privaatsele kogule.

## Tagajärjed

- Uus nähtavust arvutav koht kutsub `collection_tree`-d, mitte ei loe
  `visibility`-t otse.
- Kirjutamisulatus (`edit_collections`) jääb otseseks — pärimine puudutab ainult
  lugemist.
- Kogu vanemat API kaudu muuta ei saa (ainult loomisel), seega ümberpaigutamise
  sünki ei ole vaja. Käsitsi `collections.json`-i muutmise järel → reindeks.
- Tootmises 2026-10-16 sellist paari ei olnud; andmemigratsiooni ei vaja.

Valvurid: `tests/test_alamkogu_nahtavus.py`, `tests/test_collection_users_endpoint.py`,
`src/services/__tests__/collectionService.test.ts`.
