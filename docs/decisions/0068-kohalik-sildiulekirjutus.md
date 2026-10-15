# ADR 0068 — Kohalik sildiülekirjutus Wikidata peale

**Kuupäev:** 2026-10-15
**Staatus:** kehtib
**Seotud:** ADR 0014 (inline sildid vs register), ADR 0040 (jälgitav fail on autoriteetne fail)

## Kontekst

`labels.json` on Wikidata vahemälu (ADR 0040: väline cache, gitist väljas).
Meili fassetid (`genre_et`, `genre_en` …) eelistavad registri silti teose
inline sildile (`get_labels_by_lang`). Registrit kirjutavad kolm teed —
`refresh_all_entity_labels` (admin „Värskenda sildid"), `enrich_entity_labels_async_qcodes`
(metaandmete salvestus) ja `_fetch_missing_into_registry` (prosopograafia sünk) —
ning kõik asendavad kirje tervikuna Wikidata vastusega.

Konstitutsioonide žanri arutelul (2026-10-15) selgus, et Wikidata silt ei sobi
alati VUTT-i kasutajale: Q3497659 põhisilt on „articles of association"
(äriõiguslik), meie dokumentide jaoks on õige „statutes". Wikidata põhisilti me
muuta ei saa — mõiste katab ka ettevõtteid. Käsitsi `labels.json`-i parandus
kaoks esimesel täisvärskendusel vaikselt.

## Otsus

1. **`data/config/label_overrides.json`** — Q-kood → `{keel: silt}`. Autoriteetne,
   `data/` gitis (ADR 0040 ämber 1). Kasutajaliidest ei ole; muudatus käib
   käsitsi + commit konteinerist.
2. **Ülekirjutus rakendub ühes kohas: `_fetch_wikidata_labels`**, mille kaudu
   käivad kõik registri Wikidata-kirjutused. Uus Wikidata-kirjutustee PEAB
   kasutama seda funktsiooni, mitte `_fetch_wikidata_labels_raw`-i.
3. **Ainult saabunud kirjetele.** Kui Wikidata Q-koodi ei tagastanud, ei tehta
   ülekirjutusest uut kirjet — kutsujad asendavad registrikirje tervikuna ja
   ebaõnnestunud päringu järel jääks alles ainult ülekirjutatud keel.
4. Ülekirjutus on keelepõhine: ülejäänud keeled tulevad endiselt Wikidatast.
   Puuduv eesti silt lisatakse eelistatult **Wikidatasse** (kasu ka teistele);
   ülekirjutus on siis, kui Wikidata silt on õige, aga meie kontekstis eksitav.

## Tagajärjed

- Uus ülekirjutus jõuab registrisse järgmisel Wikidata päringul selle koodi
  kohta (nt „Värskenda sildid") või käsitsi registrisse kirjutades; Meili
  dokument uueneb teose järgmisel sünkil või reindeksil.
- Teose inline `labels` kirjutatakse salvestusel registrist — vana inline silt
  jääb, kuni teos salvestatakse; fassett kasutab niikuinii registrit.
- Valvur: `tests/test_entity_labels.py` (`test_taisvarskendus_hoiab_ulekirjutust`,
  `test_ulekirjutus_ei_tee_osalist_kirjet_ebaonnestunud_paringust`).
