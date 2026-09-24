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
- **Üldjoon** (protsent) kõigile ootel poolitustele; **lehekohane joon**
  (`split_x` ootel kirjel) tuleb pildiredaktori „Poolita" vahekaardilt, mis
  kirjutab SAMASSE ootel plaani (nagu upload'i detailvaade `custom`-joont).
  Redaktor ei hoia joont oma olekus — varem kadus see modaali sulgemisel ja
  järgmine avamine algas 50 % pealt. „Poolita" (hulgi) jätab lehekohase joone
  alles, „Ära poolita" kustutab selle. Kärbe/kalle/pööre redaktoris jäävad
  kohe kehtivaks. Ootel pöörde korral näitab poolitusvahekaart pilti pööratuna.
- **Rakendus on TAUSTATÖÖ:** `POST /admin/work/{id}/page-ops` kontrollib sisendi
  (`precheck_page_ops`: vigane/puuduv leht → 400) ja käivitab lõime
  (`server/page_ops_jobs.py`); klient pollib `GET …/page-ops/status` ja näitab
  edenemisriba („12 / 65 lehte"). Sünkroonne päring kestis 65 lehega ~5 min
  tummalt ja suur pakk jooksis 600 s piiri vastu. Olek on protsessi mälus (üks
  worker); teose kohta korraga üks töö (409). Leht, mis avatakse keset tööd,
  jätkab jälgimist.
- `apply_page_ops`: üks `work_lock`; lehed lehejärjekorras; lehe sees
  **pööre → poolitus** (nagu upload'is); poolitus kasutab iga kord värsket
  lehenumbrit; **Meili sünk üks kord** lõpus (ka vea korral); lõplik
  kontroll kordub luku all.
- **Poolitus on ÜKS native git-commit** (`git_ops.commit_add_and_remove`, sama
  `_git_write_lock` mis `save_with_git`): pooled lisatud + originaal eemaldatud.
  Varem kaks commitit, teine GitPythoni `index.remove`/`index.commit` kaudu
  (~2 s /data repos) ja ilma git-lukuta — see oligi aeglus. Sõnum algab
  endiselt `SPLIT_COMMIT_PREFIX`-iga (prügikasti liigitus loeb seda).
- **Osaline rakendus on võimalik** ja see öeldakse välja (töö olek `error`,
  sõnum „tehtud X pööret ja Y poolitust"). Klient laeb nimekirja uuesti ja
  **tühjendab ootel plaani** — alles jäänud pööre pööraks uuel „Rakenda"-l
  juba pööratud lehte teist korda.
- Poolituse parema poole jada ei põrka enam järgmise lehega
  (`_right_half_sequence`): pime `+50` andis kaks sama jadaga lehte, kui järgmine
  leht oli ≤ 50 kaugusel — pakk-poolitus teeks selle tavaliseks.

## Tagajärjed

- Pildiredaktori kärbe/kalle/pööre jäävad kohe kehtivaks; kui leht kaob
  (kustutus, asendus), kukub tema ootel toiming plaanist välja (`pruneMissing`).
  Endpoint `POST /admin/work/{id}/page/{n}/split` jääb alles, aga UI seda enam ei kasuta.
- Kaart näitab ootel pööret CSS-iga (90°/270° skaleeritud 3:4 kasti) ja joont
  ainult 0°/180° juures — pööratud kastis oleks joone asukoht oletus.
- Valvurid: `tests/test_page_ops_batch.py`, `src/pages/manage/__tests__/pageOpsPlan.test.ts`,
  `PageCard.pending.test.tsx`.
