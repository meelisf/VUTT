# ADR 0051 — Lehekirjutus läheb ainult olemasoleva lehe `.txt`/`.json` paarile

**Kuupäev:** 2026-09-25
**Staatus:** vastu võetud
**Issue:** #422 · **Allikas:** `docs/reviews/2026-09-24-koodibaasi-koondylevaade.md` (R24-01)

## Kontekst

`/save` ja taasteteed kontrollisid teose kirjutamisõigust, aga kliendi
`file_name`-ist ainult `basename`-i. Teose kirjutamisõigusega kasutaja
(ka `contributor`) sai seega kirjutada `_metadata.json`-i ja muuta teose
`collections`/`shareable` välju — metaandmete muutmine on admini toiming
(`/update-work-metadata`). Samamoodi sai üle kirjutada pildi või luua suvalise
uue faili teose kausta.

## Otsus

- Failinime leping elab AINULT `server/page_paths.py`-s:
  `check_page_filename` — nimi on `{tüvi}.txt`, tüvi ei alga `_`/`.`-ga
  (reserveeritud: `_metadata.json`, `_thumbs/`, `._originals/`);
  kõrvalfail tuletatakse samast tüvest (`{tüvi}.json`).
  Ainult laiendi kontroll EI piisa: `_metadata.txt` kõrvalfail oleks `_metadata.json`.
- `require_existing_page` — kirjutus tohib minna ainult **olemasolevale lehele**
  (`.txt` või sama tüvega lehepilt on kettal). Salvestus ei loo uut lehte; lehed
  tekivad impordi ja teose halduse kaudu. Kutsutakse **pärast** õiguskontrolli,
  et 404/200 vahe ei reedaks piiratud teose lehti.
- Kasutajad: `/save`, `/git-restore`, `_validate_page_paths` (kommentaaride
  ajalugu/taaste, annotatsiooni taaste), `/page-comments/reply`.

## Tagajärjed

- Uus kliendi `file_name`-i järgi kirjutav tee PEAB kutsuma `check_page_filename`-it
  (ja loova toime puhul `require_existing_page`-it).
- Valvur: `tests/test_page_write_filename.py`.
