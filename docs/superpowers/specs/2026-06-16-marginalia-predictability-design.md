# Marginaalia ettearvatavus — disain (2026-06-16)

## Probleem

Marginaalia toimib enamasti, aga **ettearvamatult**. Kaks tõestatud nähtust:

1. **Tühjad tagid** (`<m><i></i></m>`, `<m></m>` jms) jäävad `.txt`-faili kopeerimiste/
   kustutuste tagajärjel. Ei renderdu, aga risustavad faili ja segavad mudeli treenimist.

2. **Osa kopeerimine/nihutamine sassib struktuuri.** Tõestatud reprodutseerimisega:
   - Kohandatud copy-handler (`TextEditor.tsx:169`) eemaldab kopeerimisel KÕIK tagid
     (`replace(/<\/?[a-z]+[^>]*>/g,'')`) → marginaaliast kopeeritud sisu kaotab `<m>`
     ümbrise ja kleebitakse tavatekstina.
   - Üle ploki-piiri kustutus avatud plokis liidab kaks `<m>` plokki üheks (artefaktid:
     topelt-tühik), jättes "osa marginaaliaks, osa tavatekstiks" mulje.

Tõestus (vitest-repro, eemaldatud pärast diagnoosi):
```
Toore valik : "Vide</m>\n<m>Picrium"   →  Clipboard: "Vide Picrium"  (tagid kadunud)
Pärast cut  : "<m>Apoc. 12.  loci</m>"  (2 plokki → 1)
```

## Juhtpõhimõte

**Ettearvatavus: kogu aeg ühte moodi, deterministlikult.** Üks koristustee, mis jookseb
**salvestamisel** (mitte elavalt iga klahvivajutuse peal — see lõhuks kursori/voo).

## Lahendus

### Fix 1 — Tühjade tagide koristus (lahendab #1 + liitmise artefaktid)

`server/marginalia_normalize.py`: uus puhas funktsioon `strip_empty_tags(text)`.

- Eemaldab tühjad paaris-tagid komplektist `m, i, b, cs, hi`.
- **Säilitab sisu, eemaldab ainult tagid:** `<TAG>SISU</TAG>`, kus `SISU` vastab `^\s*$`,
  asendatakse `SISU`-ga (mitte tühjaga) → **mitte kunagi ei kao nähtavat märki** (nt
  põhiteksti `foo<i> </i>bar` → `foo bar`, mitte `foobar`).
- **Pesastatud tühjad püsipunktini:** `<m><i></i></m>` → `<m></m>` → `` (korda kuni stabiilne).
- **EI puutu:** `ann\d*` (ID-d viitavad andmetele), `fn` (joonealuste viited), `pb` (self-closing).
- Idempotentne.

`normalize_marginalia_tags(text)` laiendatakse: pärast `<m>`-järjestamist kutsub
`strip_empty_tags`. Varajane väljumine viiakse nii, et inline-tühjad koristatakse ka
failides ILMA `<m>`-ta. → **kõik olemasolevad kutsekohad saavad koristuse automaatselt**
(`/save`, `import_as_work`, meili/consolidate split). Üks tee, võimatu mööda minna.

### Fix 2 — Kopeerimise mudel (valitud: plain sisu)

Koodimuudatust ei vaja. Kinnistatud reegel:

> Kopeeritud marginaalia-sisu on alati **plain**; **sihtkoht** määrab vormingu
> (marginaaliasse kleepides → marginaalia, põhiteksti → tavatekst).

Fix 1 koristab piiriülese kustutuse jäänused. Käitumine on nüüd determinstlik ja
dokumenteeritud. Dokumenteeritakse CLAUDE.md marginaalia-sektsioonis.

### Migratsioon

`scripts/migrate_marginalia_normalize.py`: lõdvenda valvur (`<m>`-nõue → mistahes täg),
et inline-tühjad failid samuti koristataks. Jooksutatakse **serveris** (Docker):
dry-run → `--apply --commit` → reindeks. Katab ka teadaoleva `jyxgrs/5`.

## Teadlik MITTE-eesmärk

- **Ei** live-koristust iga klahvivajutuse peal (kursorihüpped, ettearvamatus).
- **Ei** frontend-poolset salvestusaegset teksti-muutmist (muudaks editori sisu salvestusel).
- **Ei** copy-handleri muutmist (plain-mudel on valitud käitumine).

## Testid (TDD)

`tests/test_marginalia_normalize.py`: `strip_empty_tags` (lihtne, pesastatud, ws-säilitus,
ann/fn/pb puutumatus, idempotentsus) + `normalize_marginalia_tags` kombineeritud käitumine.

## Failid

| Fail | Muudatus |
|------|----------|
| `server/marginalia_normalize.py` | +`strip_empty_tags`, laienda `normalize_marginalia_tags` |
| `tests/test_marginalia_normalize.py` | +testid |
| `scripts/migrate_marginalia_normalize.py` | lõdvenda valvur |
| `CLAUDE.md` | dokumenteeri koristus + kopeerimise mudel |
| `docs/tegemata_tood.md` | eemalda lahendatud #1 märkus |
```

