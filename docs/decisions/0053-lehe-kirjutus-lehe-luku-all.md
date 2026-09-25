# ADR 0053 — Lehe JSON-i lugemine–muutmine–kirjutamine käib lehe luku all

**Kuupäev:** 2026-09-26
**Staatus:** vastu võetud
**Issue:** #416 · **Allikas:** `docs/reviews/2026-09-24-koodibaasi-koondylevaade.md` (R24-03)

## Kontekst

`save_with_git`-i `_git_write_lock` järjestab ainult kirjutused, mitte nende
ees olevat lugemist. Kommentaarivastus luges lehe JSON-i väljaspool lukku:
kaks samaaegset vastust lugesid sama algseisu, mõlemad said edu, teine
kirjutus pühkis esimese vastuse (korratud barjääriga, mitte tootmisintsident).
Lisaks kirjutas vastus (ja kommentaari taaste) tagasi enne lukku loetud
`.txt`-i — vahepeal salvestatud tekst kadus.

## Otsus

- `server/page_locks.py` — `page_lock(path)`: lehe tüve kaupa lukk
  (`pg1.txt` ja `pg1.json` on sama lukk). Iga tee, mis lehe JSON-i loeb ja
  tervikuna tagasi kirjutab, hoiab lukku **lugemisest kirjutamiseni**:
  `/save` (`_save_page_locked`), `/git-restore` (`_git_restore_locked`),
  `/page-comments/reply`, `/page-comments/restore` (`_restore_comment_sync`),
  `/page-annotations/restore-as-comment` (`_restore_annotation_locked`).
- Kommentaaritoimingud kirjutavad **ainult `.json`-i**, mitte muutmata `.txt`-i.
- Lukkude järjekord: `page_lock` → `_git_write_lock`. Vastupidist ei tohi tekkida.
  Teavitused jms luku väliselt.
- Lukk on protsessi-lokaalne (uvicorn single-worker), nagu `RENDER_SEMAPHORE`.

## Mida see EI lahenda

Redaktori Ctrl+S saadab `meta_content`-i tervikuna, sh kommentaarid. Vana
avatud redaktor kirjutab vahepeal lisatud vastuse üle — lukk järjestab, aga
ei tea, et kliendi seis on aegunud. See vajab versioonikontrolli (baasversioon
→ 409) ja redaktori konfliktikäsitlust: eraldi issue.

## Tagajärjed

- Uus lehe JSON-i kirjutaja PEAB võtma `page_lock`-i enne lugemist.
- Mitme workeri korral vaja protsessideülest lukku.
- Valvur: `tests/test_lehelukk.py` (barjääriga võistlus: vastus × vastus,
  vastus × taaste, vastus/taaste × tekstisalvestus, `/save` ootab lukku).
