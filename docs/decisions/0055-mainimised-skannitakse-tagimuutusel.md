# ADR 0055 — Lehe salvestus skannib isikumainimisi ainult isikutägide muutusel

**Kuupäev:** 2026-09-26
**Staatus:** vastu võetud
**Issue:** #420 · **Allikas:** `docs/reviews/2026-09-24-koodibaasi-koondylevaade.md` (R24-07)

## Kontekst

Iga muutusega `/save` lisas taustatöö `update_page_person_mentions`: kogu
teose lehefailide skann ja `person_to_works.json`-i täielik ülekirjutus.
1000-leheküljelisel teosel on see 2000 JSON-lugemist (`enumerate_page_images`
loeb järjestuse jaoks iga JSON-i, seejärel skann uuesti) — ka siis, kui
salvestus muutis ainult teksti.

See skann parandas **juhuslikult** ka `mentioned`-kirjete lehenumbreid pärast
ümberjärjestust, poolitust, lehe lisamist, üksiku lehe kustutamist ja
prügikastist taastamist: ükski neist teedest ei värskendanud mainimisi ise.

## Otsus

- `/save` võrdleb lehe `vutt:P` isikutägide hulka enne ja pärast kirjutust
  (`page_person_ids`, `server/prosopography/indices.py` — sama reegel, mida
  skann kasutab). Skann käivitub ainult siis, kui hulk muutus.
- Iga tee, mis nihutab lehenumbreid või toob lehe tägid tagasi, kutsub
  `refresh_work_mentions(work_dir, work_id)` (`relations.py`): `split_page`,
  `apply_page_ops` (poolitusega), `add_pages`, `/add-page`, üksiku lehe
  kustutamine, `/reorder-pages`, `restore_deleted_page`, `restore_deleted_work`.
  `delete_pages` kutsus juba enne otse `update_page_person_mentions`-it.
- `refresh_work_mentions` logib vea ja ei viska: lehetoiming on selleks
  hetkeks kettal ja commititud.

## Tagajärjed

- **Uus lehenumbreid nihutav tee PEAB kutsuma `refresh_work_mentions`-it** —
  järgmine salvestus seda enam ei paranda.
- Salvestus ei paranda enam varasemat lahknevust `person_to_works`-is (sama
  põhimõte kui ADR 0012 Meili puhul); tõe taastab `rebuild_indices` stardil.
- Isikutäge muutvate salvestuste jada skannib endiselt iga kord — see on
  harv; koondamine teose kaupa jäi tegemata, kuni mõõtmine seda nõuab.
- Valvur: `tests/test_mainimised_420.py`.
