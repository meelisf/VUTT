# ADR 0020 — Üleslaadimist piirab seisak, mitte kogupäringu lagi; ja UI räägib faasist, mitte serveri staatusest

**Kuupäev:** 2026-08-15
**Staatus:** vastu võetud

## Kontekst

160 MB PDF (163 lk käsikiri) ei läinud aeglases võrgus üles. Neli katset
järjest, alati samast kohast: nginx logis `POST /admin/upload/{id}/files` →
**499** (klient sulges ühenduse), `bytes_sent 0`, backendi logis mitte ühtki
kirjet, staging jäi `"status": "pending"`, `files: []`.

Põhjus oli `uploadSingleFile()` kutses: `fetchWithTimeout(..., timeout: 300_000)`.
`fetchWithTimeout` on `AbortController` + `setTimeout` — see on **kogu päringu
lagi**, mitte tegevusetuse-timeout. Ta katkestab töötava, edeneva päringu.

Mõõdetud kasutaja ühendus oli 43,7 kB/s:

| | |
|---|---|
| 160 MB vajalik aeg | ~61 min |
| 300 s jooksul jõuab | 13,1 MB = **8 %** |
| Et lakke mahtuda, oleks vaja | 534 kB/s |

Lagi ei kaitsnud millegi eest — see katkestas seda kindlamalt, mida aeglasem
oli kasutaja liin. Kiires kontoris töötav funktsioon oli aeglases võrgus
garanteeritult katki.

Sama juurtükeldus paljastas teise vea. nginx puhverdab päringu keha kettale
(`proxy_request_buffering on`, vaikimisi) ja annab päringu backendile edasi
alles pärast **viimast baiti**. Seega kogu saatmise vältel — käesoleval juhul
tund aega — ei tea backend failist midagi ja polling vastab `pending`. UI aga
tuletas kogu oma teksti sellest poll-staatusest. Tulemus: neli eksitavat teadet
korraga, sh kaks, mis kutsusid kasutajat toimingule, mis üleslaadimise tapaks
(„võid lehelt lahkuda", nupp „Sulge — vaatan progressi hiljem").

## Otsus

**1. Failikeha saatmisel ei ole kogupäringu-timeout'i. Piiratakse ainult
seisakut.**

`sendFileWithProgress()` (`src/pages/upload/uploadApi.ts`) kasutab XHR-i, et
saada edenemissündmusi, ja armeerib kaks eraldi taimerit:

- `stallTimeout` (120 s) — lubatud paus kahe edenemissündmuse vahel **keha
  saatmise ajal**
- `responseTimeout` (300 s) — vastuse ootamine **pärast viimast baiti**, kus
  edenemissündmusi enam ei tule

Seisak katkestab `UploadStalledError`-iga, mis on kasutajale eraldi teade.

**2. Üleslaadimise UI kuvab faasi, milles kasutaja on, mitte staatust, mida
server teab.**

Faase on kaks ja nad on kasutaja jaoks täiesti erinevad:

| Faas | Kes liigutab | Kes teab | Lahkuda tohib |
|---|---|---|---|
| brauser → VUTT | kliendi XHR | ainult klient (`sendProgress`) | **EI** — lahkumine tapab XHR-i |
| VUTT → OCR-server | backend, SFTP | polling (`pollResult.progress`) | jah, progress salvestatakse |

`computeReviewDerived` võtab `sendProgress`-i ja hoiab kuvatava staatuse
`uploading`, kuni klient veel saadab — sõltumata sellest, et polling ütleb
`pending`.

**3. Teadmata kestust ei asendata väljamõeldud numbriga.**

`ocrEstimate` tagastab lehekülgede arvu puudumisel `null`, mitte varasemat
`"~10 min"`. Numbri asemel öeldakse, millest kestus sõltub. Saatmise faasi
kestus tuleb mõõtmisest (`estimateRemainingSeconds` + `formatEta`).

## Tagajärjed

- Suur fail aeglases võrgus läheb läbi. Tootimises kontrollitud: sama fail, mis
  suri neli korda 8 % pealt, läks pärast parandust lõpuni.
- Surnud ühendus tuvastatakse endiselt — 120 s ilma ühegi baidita on seisak,
  mitte aeglus.
- Katkemisel algab üleslaadimine ikka nullist. See jääb lahtiseks: jätkatav
  (chunked) üleslaadimine on issue #235. Üks tunnipikkune päring on halva liini
  peal endiselt õrn — üks katse suri 28 min / 85 MB pealt päris võrguveaga
  (XHR `onerror`, mitte meie timeout).

## Invariandid

- **Suure keha saatmisel ei tohi kasutada `fetchWithTimeout`-i.** Selle
  `timeout` on kogupäringu lagi. Kehata või lühikese kehaga päringutel on see
  õige tööriist; failiga mitte.
- **Timeout, mis piirab õnnestumist proportsionaalselt kasutaja aeglusega, on
  vale timeout.** Piirata tuleb seda, mis viitab rikkele (baite ei liigu), mitte
  seda, mis viitab ainult aeglasele liinile (päring kestab kaua).
- **Saatmise faasis EI TOHI UI pakkuda lahkumist ega „Sulge" nuppu.** Mõlemad
  monteerivad komponendi maha ja katkestavad XHR-i. Nupp on peidetud
  `wizard.sending` ajal, teade on „ära lahku" mitte „võid lahkuda".
- **Poll-staatus ei kirjelda brauser → VUTT faasi.** nginxi keha-puhverdamise
  tõttu vastab server sel ajal `pending`. Kes tuletab kuva ainult poll-staatusest,
  ehitab uuesti sama vea.
- **Hinnang, mille sisendit ei ole, ei ole hinnang.** Teadmata kestuse asemel
  öeldakse, millest see sõltub — vale number on halvem kui numbri puudumine,
  sest kasutaja planeerib selle järgi.

## Tagasi lükatud alternatiivid

- **Kogupäringu lae tõstmine (nt 300 s → 2 h)** — sama viga suurema numbriga.
  Ükski konstant ei tea, kui aeglane on kasutaja liin; iga valitud väärtus on
  kellegi jaoks liiga väike.
- **`fetch` + `AbortSignal` progressi-põhise uuendamisega** — `fetch` ei anna
  keha **saatmise** edenemist (`ReadableStream` upload'i tugi on piiratud ja
  nõuab HTTP/2 duplex'it). XHR on siin ainus, mis annab `upload.onprogress`-i.
- **Serveripoolne timeout'i lõdvendamine** — probleem ei olnud kunagi serveris.
  nginx ja backend töötasid korrektselt; katkestaja oli klient (499 = *client*
  closed request).
- **Kohe chunked upload** — õige lõppsiht (issue #235), aga see nõuab backendi
  vahemike-tuge ja staging'u olekumasina muutmist. Kogulae eemaldamine on
  ühemõtteline parandus, mis lahendab tuvastatud juurpõhjuse, ja seda ei tohi
  siduda suurema ümberehituse ajakavaga.
