# ADR 0054 — Lehe salvestus liidab kolmesuunaliselt kliendi baasseisu vastu

**Kuupäev:** 2026-09-26
**Staatus:** vastu võetud
**Issue:** #455 · **Disain:** `docs/superpowers/specs/2026-09-26-lehe-kolmesuunaline-liitmine-design.md`

## Kontekst

Redaktori Ctrl+S saadab lehe `meta_content`-i tervikuna, sh kommentaarid. Vana
avatud redaktor kirjutas vahepeal lisatud kommentaarivastuse (või teise akna
salvestuse, taaste, re-OCR-i) vaikselt üle. Lehelukk (ADR 0053) järjestab
kirjutused, aga ei tea, et kliendi seis on aegunud. Redaktor laeb lehe
Meilisearchist, mis uueneb asünkroonselt — ka oma eelmise salvestuse järel võib
redaktor näidata vana seisu.

## Otsus

- `/save` võtab valikulise `base`-i: lehe väljad (`text_content`, `status`,
  `page_tags`, `comments`, `text_annotations`) nii, nagu klient need laadis või
  viimati salvestas. Server liidab lehe luku all (`_save_page_locked`)
  `server/page_merge.py` reeglitega: *mine* = *base* → *theirs*; *theirs* = *base*
  → *mine*; sama muudatus → *mine*; muidu kokkupõrge → **409**, midagi ei kirjutata.
- Üksused: **tekst + `text_annotations` koos** (ankrud elavad tekstis, ADR 0041),
  `status`, `page_tags`, kommentaarid **id kaupa**.
- Võrdlus **Meili-projektsioonis** (`read_page_view` = `meili_doc`-i lugemisloogika;
  kommentaari tekst läbi `normalize_eszett`-i; baastekst läbi sama NFC +
  marginaalia normaliseerimise nagu salvestatav tekst). Versioonihashi EI ole —
  baasi võrdlus kettaga püüab kinni ka aegunud Meili. Eelkontroll: 1000 lehel
  0 erinevust Meili ja ketta vahel.
- `base`-ita salvestus (vana bundle) kirjutab nagu varem.
- Klient: `EditorSavedState.text` on baastekst; baasi staatus tuleb Workspace
  `page.status`-ist (staatust omab Workspace). Kommentaarivastus ja kommentaari
  taaste uuendavad baasis AINULT kommentaare. Kokkupõrge → `PageConflictDialog`
  (salvesta minu / võta serveri / tühista).

## Tagajärjed

- Uus lehe väli, mida redaktor toimetab, PEAB minema `PAGE_FIELDS`-i ja
  `merge_page`-i, muidu kirjutab vana redaktor ta endiselt üle.
- `read_page_view` ja `meili_doc` lehe lugemine peavad jääma samaks projektsiooniks.
- Workspace ei neela enam salvestusvigu: `runSave` saab vea ja `isDirty` jääb.
- Valvurid: `tests/test_page_merge.py`, `tests/test_save_liitmine.py`,
  `src/components/editor/__tests__/pageConflict*.test.ts(x)`.
