# ADR 0050 — Teose halduse pöörded ja poolitused on ootel plaan, rakendus ühe pakina

**Kuupäev:** 2026-09-24
**Staatus:** vastu võetud
**Issue:** #431 (etapp 3) · **Eelneb:** ADR 0049

## Kontekst

Upload'i ülevaatuses märgib kasutaja kontaktlehel valitud lehtedele poolituse ja
pöörde, näeb eelvaadet ja rakendab kõik korraga. Teose halduses sai sama teha
ainult pildiredaktoris, üks leht korraga ja iga klõps kohe kettale. Kasutaja
harjub upload'is ühe loogikaga ja leiab haldusest teise.

Teose halduses on lehel aga juba tekst, git-ajalugu ja `._originals`: poolitus
lõikab teksti `<pb/>` kohalt ja teeb kaks git-commitit (prügikasti rühmitus loeb
`SPLIT_COMMIT_PREFIX`-it). Salvestusmudelit upload'i plaaniga üheks teha ei saa.

## Otsus

- **Hulgipööre ja -poolitus on ootel plaan kliendis** (`manage/pageOpsPlan.ts`),
  võti on failinimi (lehenumber nihkuks iga poolitusega). Muster on sama mis
  järjekorra mustandil: kollane rida „N lehel ootel …", „Tühista" / „Rakenda",
  kinnitusdialoog, `useUnsavedChangesGuard`.
- **Järjekorra mustand ja ootel lehetoimingud välistavad teineteist** (nupud
  blokeeritud) — mõlemad sõltuvad failinimede loendist.
- **Üks üldjoon** (protsent) kõigile ootel poolitustele. Lehekohane joon jääb
  pildiredaktorisse (kohe kehtiv, nagu ka kärbe/kalle).
- **Rakendus: `POST /admin/work/{id}/page-ops`** → `apply_page_ops`. Kogu sisend
  valideeritakse ENNE ühegi faili puudutamist (puuduv leht → 400). Üks
  `work_lock`; lehed lehejärjekorras; lehe sees **pööre → poolitus** (nagu
  upload'is); poolitus kasutab iga kord värsket lehenumbrit. Iga poolitus teeb
  oma commitid, **Meili sünk üks kord** lõpus (ka vea korral).
- **Osaline rakendus on võimalik** ja see öeldakse välja (500, sõnum „tehtud X
  pööret ja Y poolitust"). Klient laeb nimekirja uuesti ja `pruneMissing` viskab
  ootel plaanist lehed, mida enam ei ole.
- Poolituse parema poole jada ei põrka enam järgmise lehega
  (`_right_half_sequence`): pime `+50` andis kaks sama jadaga lehte, kui järgmine
  leht oli ≤ 50 kaugusel — pakk-poolitus teeks selle tavaliseks.

## Tagajärjed

- Pildiredaktori toimingud jäävad kohe kehtivaks; kui redaktoris poolitatakse
  leht, millel oli ootel toiming, kukub see plaanist välja.
- Kaart näitab ootel pööret CSS-iga (90°/270° skaleeritud 3:4 kasti) ja joont
  ainult 0°/180° juures — pööratud kastis oleks joone asukoht oletus.
- Valvurid: `tests/test_page_ops_batch.py`, `src/pages/manage/__tests__/pageOpsPlan.test.ts`,
  `PageCard.pending.test.tsx`.
