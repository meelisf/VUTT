# ADR 0047 — Üksikfail laetakse üles tükkidena; jätkamise tõde on ketas, uut staatust ei ole

**Kuupäev:** 2026-09-23
**Staatus:** vastu võetud
**Seotud:** ADR 0020 (seisak, mitte kogulagi), ADR 0002 (blokeeriv I/O), #314 (staatuste loend)
**Issue:** #235

## Kontekst

ADR 0020 tegi suure faili üleslaadimise aeglasel liinil võimalikuks, aga jättis
ta **üheks HTTP-päringuks**: 160 MB 27–47 kB/s juures on ~1 h päring, ja
katkemine algas nullist (2026-08-15: üks katse suri 28 min / 85 MB pealt päris
võrguveaga). nginx puhverdab keha ja annab selle backendile alles viimase baidi
järel, seega server ei teadnud pooliku faili kohta midagi.

## Otsus

1. **Üksikfail (PDF või üks pilt) saadetakse 4 MiB tükkidena**
   `POST /admin/upload/{id}/chunk` (päised `X-Upload-Offset`, `-Total`,
   `-Fingerprint`, `X-Filename`). Server kirjutab `uploads/{id}/source.part`-i.
   Pildikausta režiim (`/files` + `X-Page-Number`) jääb samaks — seal on iga
   leht niikuinii eraldi väike päring.
2. **Jätkamise tõde on kettal olev baitide arv**, mitte olekufaili number.
   Nihe peab võrduma `.part` suurusega, muidu 409 koos tegeliku seisuga
   (`received`); tükki ei kirjutata topelt ega auguga. `GET .../chunk` annab
   jätkamispunkti.
3. **Sama fail tuvastatakse sõrmejäljega** (suurus + SHA-256 esimesest ja
   viimasest MiB-st). Brauser ei säilita `File`-objekti üle värskendamise:
   kasutaja valib faili uuesti ja sama sõrmejälg jätkab, erinev alustab otsast.
4. **Uut upload'i staatust ei ole.** Poolik fail on `pending` all väljal
   `partial_upload`. `ALL_STATUSES` ja frontendi klassifikatsioon (#314) ei
   muutu; kommentaar „`uploading` on frontendi-sisene" jääb tõeks.
5. **Viimane tükk annab faili samale teele**, mis ühe-päringu-üleslaadimisel
   (`save_and_transfer_to_ocr` → tüübituvastus magic byte'idest → `store_pdf`).
   Lõpetamise ajal on `partial_upload.finalizing` — sel ajal lükatakse tükid
   tagasi, et nihkega 0 päring (teine vahekaart) loetavat faili ei tühjendaks.
6. **Kogusuuruse lagi (600 MB) jõustab server** — nginx-i
   `client_max_body_size` kehtib nüüd tüki, mitte faili kohta.

Klient: võrgu- või serveriviga tüki peal → ootus (2–30 s) → serverilt seisu
küsimine → jätk, kuni 6 järjestikust katset. 4xx ei korrata.

## Tagajärjed

- Katkemine maksab ühe tüki (~1,5–2,5 min mõõdetud aeglasel liinil), mitte kogu
  edenemise. Lehelt lahkumine peatab saatmise, aga serveris olev osa jääb.
- Poolik `.part` elab upload'i kaustas; `cancel_upload` kustutab kausta koos
  temaga. Hülgatud poolikute automaatset koristust ei ole (sama mis teistel
  hüljatud upload'idel).
- Ootamatu viga lõpetamisel (mitte vigane fail) kustutab pooliku — sama mis
  varem; kordus alustab otsast.
- Vana `/files` ühe-faili-tee jääb serverisse vanade vahemälus bundle'ite jaoks.
- Valvurid: `tests/test_upload_chunked.py` (sh päris PDF otsast lõpuni),
  `src/pages/upload/__tests__/uploadChunked.test.ts`.
