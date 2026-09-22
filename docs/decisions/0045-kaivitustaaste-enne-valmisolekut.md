# ADR 0045 — Käivitustaaste lõpeb enne, kui server päringuid vastu võtab

**Kuupäev:** 2026-09-22
**Staatus:** vastu võetud
**Seotud:** ADR 0002 (blokeeriv I/O), ADR 0028 (apply CAS, I1), ADR 0036
**Issue:** #389

## Kontekst

Restart tapab taustalõimed keset tööd ja jätab `state.json`-i vahepealse
staatuse (`ada_fetching`, `applying`, `importing`, `preview_status="rendering"`).
Neli käivitustaastet (`taasta_rippuvad_fetchid`, `_applyd`, `_impordid`,
`_eelvaated`) viivad need tagasi kasutatavasse olekusse.

Iga taaste otsustab **lokaalse state'i hetktõmmise** põhjal ja kirjutab
tingimusteta. Nad jooksid daemon-lõimedes ja `lifespan` jõudis `yield`-ini
neid ootamata — server võttis päringuid vastu, kuni taaste alles käis. Kui
„Rakenda" CAS (`awaiting_split → applying`) jõudnuks taaste lugemise ja
kirjutuse vahele, lähtestanuks taaste päriselt käimasoleva töö. Taastete
docstringid nõudsid „ainult enne, kui uusi apply-sid saab alustada", aga
miski seda ei jõustanud. Tootmisjuhtumit ei ole; sama klass (vananenud
hetktõmmis kirjutusel) on tabanud neli korda (PR #372/#373, I1).

## Otsus

Käivitustaasted jooksevad `lifespan`-is **enne `yield`-i**, ühe
`run_in_threadpool(_kaivitustaasted)` kutsena (`server/main.py`). Ühe taaste
erand logitakse ega peata teisi ega käivitust.

Värava-varianti (taaste märgib oma upload'id, CAS keeldub) ei valitud: ta
lisaks igale CAS-ile uue oleku, samas kui ootamine maksab mõõdetult ~66 ms
(68 upload'i, tootmine 2026-09-22).

## Tagajärjed

- Käivitustaaste tohib olla AINULT lokaalne failisüsteem. Võrgutöö (SSH,
  OCR-server) siia ei kuulu — see lükkaks valmisolekut edasi määramata ajaks
  (#181); see jääb taustalõime nagu `start_reocr_background`.
- Uus käivitustaaste lisatakse `_kaivitustaasted`-i, mitte eraldi lõime.
- Valvur: `tests/test_kaivitustaaste_enne_valmisolekut.py`.
