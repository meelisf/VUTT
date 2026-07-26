# 0013 — Meilisearchi sünk koondatakse teose kaupa, dirty-lipp elab vea üle

**Staatus:** kehtib

## Kontekst

Iga salvestus lisab teose Meilisearchi sünkroniseerimise töö. Sünk ei uuenda
üht välja, vaid ehitab teose **kõik** lehe-dokumendid uuesti
(`build_work_documents`) ja upsertib need — 9-leheküljelise teose puhul
~0,5–0,6 s. Tootmislogis oli sama teose kolm sünki 9 sekundi jooksul: kasutaja
salvestas kolm korda järjest ja iga salvestus indekseeris kõik lehed otsast
peale.

Töid piiras ainult `ThreadPoolExecutor` (10 töötajat). See hoidis Meilisearchi
koormust vaos, aga ei vähendanud tehtud tööd: N salvestust = N täisindekseerimist.

## Otsus

1. **Korraga üks aktiivne sünk teose kohta.** `_meili_active_syncs` hoiab
   teoseid, mille sünk parasjagu käib.

2. **Aktiivse töö ajal saabuv päring märgib teose ainult dirty'ks**
   (`_meili_dirty_syncs`) ja loeb selle coalesced'iks. Kümme päringut aktiivse
   töö ajal annavad täpselt ühe järeljooksu, mitte kümme.

3. **Järeljooks loeb ketast uuesti.** Sünk ei kanna endaga mingit hetkeseisu —
   see loeb `_metadata.json`-i ja lehefailid käivitumise hetkel. Seetõttu katab
   üks järeljooks kõigi vahepealsete salvestuste tulemuse korraga.

4. **Eri teosed ei blokeeri teineteist** — coalescing on teosepõhine, pool
   jääb endiselt paralleelseks.

5. **Loendurid on health-vastuses** (`requested`, `coalesced`, `active`,
   `dirty`), et koondamise mõju oleks tootmises näha, mitte oletatav.

## Tagajärjed

- **Järeljooksu ajastus PEAB olema `finally`-harus, mitte `try`-haru lõpus.**
  Kui aktiivne sünk viskab vea (Meili maas, võrgutõrge) ja järeljooks jääks
  vahele, kaoks vahepealne salvestus jäljetult ja teos jääks otsingus vanaks.
  See on vaikne andmelahknemine, mitte nähtav viga — seepärast on
  `test_dirty_work_survives_failed_sync` regressioonitestina olemas.

- **Teos jääb `active` hulka järeljooksu ajaks.** Kui ta sealt vahepeal
  eemaldataks, tekiks aken, milles uus päring käivitaks paralleelse sünki
  samale teosele.

- **Sünk peab jääma idempotentseks ja kettapõhiseks.** Kui keegi hakkab
  sünkile andma kaasa "mida muuta" (delta), laguneb coalescing: järeljooks ei
  teaks enam, mida vahepealsed päringud tahtsid. Osaline update (nt üks
  lehekülg) on võimalik alles siis, kui sellega tuleb ka koondamise
  ümbermõtlemine.

- **Väiksem viivitus ei ole garantii.** Kasutaja salvestuse järel võib sünk
  oodata eelmise lõppu. See oli nii ka varem (pool), aga nüüd on ootamine
  teadlik ja mõõdetav (`dirty` loendur).

## Viited

- Issue #176 (koondülevaade #182)
- `server/meilisearch_ops.py` — `sync_work_to_meilisearch_async`, `_sync_work_task`
- Testid: `tests/test_meili_coalescing.py`
- Seotud: ADR 0005 (keep-warm), ADR 0012 (muutusteta salvestus ei tekita sünki üldse)
