# 0003 — Marginaalia normaliseerimine ainult salvestamisel

**Staatus:** kehtib

## Kontekst

OCR toodab ristuvaid tage (`<i><m>X</i></m>`) ja redigeerimine jätab maha
tühje paaris-tage (`<m></m>`). Neid tuleb koristada — küsimus oli, millal.

## Otsus

Normaliseerimine (`server/marginalia_normalize.py`,
`normalize_marginalia_tags`) toimub AINULT salvestamisel, KÕIGIS
kirjutusteedes (`/save`, `import_as_work`, consolidate `split_marginalia`).
Mitte kunagi elavalt iga klahvivajutuse peal — see lõhuks kursori
positsiooni ja redigeerimisvoo.

Funktsioon on idempotentne: (1) `<m>` tõstetakse rea välimiseks tägiks,
(2) tühjad paaris-tagid eemaldatakse (`m, i, b, cs, hi`; EI puututa
`ann\d*`, `fn`, `pb`).

## Tagajärjed

- Redaktoris VÕIB ajutiselt olla „räpane" markup — see on normaalne;
  ettearvatavus („kogu aeg ühte moodi") on tähtsam kui hetkepuhtus.
- Iga UUS kirjutustee (uus endpoint, skript, migratsioon) PEAB
  `normalize_marginalia_tags` läbi kutsuma — muidu tekivad failid, mida
  ükski olemasolev tee ei toodaks.
- Kopeerimise mudel: kopeeritud marginaalia-sisu on alati plain (tagid
  eemaldatakse copy-handleris), sihtkoht määrab vormingu.
