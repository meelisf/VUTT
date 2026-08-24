# ADR 0024 — Kaugkoristus kustutab failid, kataloogi eemaldab reaper

**Kuupäev:** 2026-08-24
**Staatus:** vastu võetud
**Issue:** #225 · **Parandab:** ADR 0018 tagajärje-väidet

## Kontekst

Katkestamise kaugkoristus (`rmdir` re-OCR-is, `rm -rf` upload'is) kukutas OCR-teenuse,
kui katkestamise hetkel oli üks batch juba GPU-s. Mõõdetud tootmises 2026-08-08:

```
16:24:49  [print] Töötlen 1–4 / 10                    ← batch läheb GPU-sse
16:25:12  (VUTT) Re-OCR 5qxwhg katkestatud: kaugkoristus=ok
16:26:29  Kriitiline viga: [Errno 2] No such file or directory: .../..._pg_001.txt
16:26:41  systemd taaskäivitas teenuse
```

Mehhanism on OCR-serveri poolel: `process_batch` kirjutab tulemuse
`open(txt_path, "w")`-ga **ilma veakäsitluseta**, `main_loop` ei püüa `process_batch`
erandeid ja mooduli tasemel on `except Exception: sys.exit(1)`. Kadunud kataloog =
`FileNotFoundError` = terve teenus sureb. `Restart=on-failure` taastab, aga lisandub
~1 min mudeli laadimist ja **katkeb kõigi teiste kasutajate järjekord**.

ADR 0018 väide „kuni 4 lehte võib LOSSis lõpuni joosta; nende `.txt` kaob koos
kataloogiga" oli seega vale: kirjutus ei kuku vaikselt läbi, vaid võtab teenuse maha.

## Otsus

**Katkestamine kustutab kaugkataloogi FAILID, aga JÄTAB KATALOOGI ALLES.** Tühja
kataloogi eemaldab hiljem reaper, kui ükski batch ei saa enam lennus olla.

OCR-serverit ennast ei muudeta (ADR 0017 põhimõte) — parandus on tervikuna VUTT-i poolel.

## Invariandid

- **`rm -rf`/`rmdir` kaugkataloogile on keelatud, kui batch võib olla lennus.** Kõik
  katkestamise teed käivad `ocr_client.cleanup_run_files()` kaudu; see kustutab failid
  ega puutu kataloogi. Puuduv kataloog ei ole viga (intsidendi kuju).
- **Peatamismehhanism ei muutu.** Piltide kustutamine peatab GPU-töö endiselt:
  `process_batch` väljub enne mudeli kutsumist, kui ükski pilt ei avane. ADR 0018
  „kuni 4 lehte" piir kehtib edasi.
- **Orbu ei jäeta.** `ocr_reaper` hoiab `state/ocr_run_reaps.json`-is nimekirja
  katalooge; `reap_due` eemaldab need `rm -rf`-iga, kui `RUN_DIR_REAP_GRACE` = 600 s on
  täis (mõõdetud batch, 4 lk ≈ 100 s — varu on tahtlik). Reaper elab upload-sync lõimes.
- **Tõrkuv kirje jääb nimekirja.** Kaugserver võib olla ajutiselt maas; eemaldatakse
  ainult õnnestunud teed.
- **Ajastatud kataloog on taastereaperi jaoks märgistatud.** `reocr_recovery._recover_one`
  jätab `ocr_reaper.is_scheduled()` kataloogi vahele: sinna pärast koristust maandunud
  `.txt` kuulub katkestamise hetkel lennus olnud batchile, mitte orvule. Ilma selleta
  taastaks reaper (300 s) enne armuaja lõppu katkestatud töö tulemuse — täpselt selle,
  mille kasutaja tühistas.
- **Eduka impordi järgne koristus jääb `rm -rf`-iks.** Impordi eeldus on, et igal lehel
  on `.txt` olemas — siis ei ole ühtki pilti, millest batch saaks tekkida.

## Tagajärjed

- Katkestamine ei kukuta enam OCR-teenust ega katkesta teiste kasutajate järjekorda.
- Kaugserverisse jääb kuni 10 minutiks tühi (või ühe lennusoleva batchi `.txt`-ga)
  run-kataloog. VUTT seda ei loe: re-OCR pool on töö aktiivregistrist eemaldatud ja
  taastereaper jätab ajastatud kataloogi vahele.
- Kui backend restardib enne armuaja täitumist, jääb kirje faili alles ja reaper jätkab
  sealt — nimekiri on püsiv olek, mitte mälus.

## Kontroll

- Katkesta töö ajal, mil batch on GPU-s → `ocr-service.log`-is EI tohi olla „Kriitiline
  viga"; teenuse `ActiveEnterTimestamp` ei muutu.
- Reaper eemaldab jäänud kataloogi armuaja järel.
