# 0006 — Meili eestikeelsed legacy-väljanimed + ühine `meili_doc.py`

**Staatus:** kehtib

## Kontekst

Meilisearchi indeks `teosed` kasutab ajaloolistel põhjustel eestikeelseid
ja vana ortograafiaga väljanimesid (`lehekylje_tekst`, `pealkiri`,
`teose_lehekylgede_arv`, `aasta` jne), kuigi `_metadata.json` on V2
ingliskeelne. Lisaks oli indekseerimisloogika DUBLEERITUD kahes kohas:
`server/meilisearch_ops.py` (live-tee) ja `scripts/1-1_consolidate_data.py`
(seed-tee) — need lahknesid vaikselt (issue #23).

## Otsus

1. Väljanimesid EI nimetata ümber ilma täieliku reindeksita ja kõigi
   otsingufiltrite koordineeritud muudatuseta (issue #16). Frontend mapib
   nimed (`normalizeWork()`).
2. Kogu dokumendi-ehitusloogika elab ÜHES side-effect-vabas moodulis
   `server/meili_doc.py`, mida impordivad MÕLEMAD teed. Lahknemine on
   konstruktsiooni järgi võimatu.

## Tagajärjed

- Uus indekseeritav väli → AINULT `meili_doc.py`-sse; mõlemad teed saavad
  selle automaatselt.
- Väljanimede „parandamine" on võimalik (täisreindeks on odav, vt
  `docs/reviews/2026-07-09-skaleerimise-ulevaade.md` §1.5), aga see on
  teadlik projekt, mitte möödaminnes tehtav muudatus.
- `*_object` väljad (nt `tags_object`) eksisteerivad AINULT Meili
  dokumentides, mitte `_metadata.json`-is; `work_id` peab olema KÕIGIS
  dokumentides.
