# ADR 0017 — Poolitamine enne OCR-i: rasteriseerimine VUTT-i poolel

**Kuupäev:** 2026-08-07
**Staatus:** vastu võetud

## Kontekst

Topeltlehti sai poolitada alles pärast importi, mis tähendas kaht täielikku
OCR-läbikäiku (300-leheline teos ≈ 2 h × 2). Blokeeriv põhjus: PDF läks
tervikuna OCR-serverisse, mis rasteriseeris selle ise.

OCR-server oskab aga juba vastu võtta valmis JPG-sid (kaustapõhine pildi-OCR,
mida batch re-OCR iga päev kasutab), ja poppler on VUTT-i Dockeris olemas.

## Otsus

VUTT rasteriseerib PDF-i ise ja saadab poolitatud lehed olemasolevat
pildi-OCR teed pidi. OCR-serverit ei muudeta.

## Invariandid

- **Prepress on tervikuna opt-in.** Puutumata lülitiga upload ei renderda ühtki
  pikslit ja käib tänast teed. `enabled` vaikeväärtus on `false` — poolitamine
  on destruktiivne teisendus ja „Edasi" ei tohi 300 lehte 600-ks teha.
- **Plaan-JSON on liides**, mille taha saab 300 DPI läbikäigu hiljem
  OCR-serverisse tõsta, kui CPU-koormus VUTT-is osutub liiga kalliks.
- **`FULL_DPI = 300` ja `JPEG_QUALITY = 95` peavad kattuma** OCR-serveri
  `PDF_DPI` ja `quality=95` väärtustega (`qwen3.5/kataloogi-jalgimine-ja-ocr.py`).
  Kui need seal muutuvad, tuleb muuta ka `server/upload/page_source.py`.
- **Automaatika on hoiataja, mitte pakkuja.** Tindiskoor on usaldusväärne
  ainult kõrge väärtuse suunas: kõrge skoor = joon lõikab kindlasti kirja;
  madal skoor ≠ õige koht (tühi veeris skoorib samuti 0). Köitevahe globaalne
  tuvastamine mõõdeti ebausaldusväärseks (pakutav x hüppas 0,38–0,61 vahel).
- **OCR-serverisse avaldatakse failipõhise `.tmp`+rename-ga.** Valvuril EI OLE
  piltide jaoks stabiilsuskontrolli — `wait_for_file_stable()` kutsutakse seal
  ainult PDF-ide peale. Kataloogi tervikuna ei varjata: valvur töötab pildi
  kaupa, nii et poolik kataloog on konveier, mille me tahame alles jätta.
- **`prepress` alamvälju muudetakse ainult `mutate_prepress` kaudu**, sama luku
  sees. `set_upload_state(**extra)` seab terveid ülemise taseme võtmeid ja
  pühiks paralleelse plaanimuudatuse maha.
- **`apply` on ühekordne:** `awaiting_split → applying` CAS, kordus annab 409.
- **`Semaphore(1)` on protsessi-lokaalne** kaitse. Mitme uvicorni workeri peale
  minnes ei ole see enam globaalne piirang. Praegu ei lahendata.
- **Poolituse geomeetria:** `cut_px = round(width * split_x)`, vasak `[0, cut)`,
  parem `[cut, width)`, ükski piksliveerg ei kao ega dubleeru, järjekord alati
  vasak → parem. `width` on RENDERDATUD lehe laius — PDF `/Rotate` ja CropBox
  on `pdftoppm` väljundis juba rakendatud.

## Tagajärjed

- Uus CPU-koormus VUTT-i veebiserveril, mida varem kandis OCR-server.
  Leevendused: opt-in, `Semaphore(1)`, `nice(10)`, voogedastus lehthaaval.
- Lähtefail jääb VUTT-i poolele kuni sammu 3 otsuseni — OCR algab hiljem kui
  varem, admini otsustusaja võrra.
- Ainult-väljajätmise plaan on triviaalne ja saadab originaali muutmata.
  PDF-i ümberehitus mõõdeti (qpdf 36 s / 775 MB) ja jäeti teadlikult välja.
- Olemasolev OCR-järgne poolitamine (`admin_page_ops.split_page`) jääb alles.
- Viisardil on nüüd neli sammu (metaandmed → fail → poolitamine → ülevaatus).
  `tests/test_save_and_transfer.py` dispatch-testid kirjutati ümber: nad
  lukustasid vana käitumise (kohene SFTP-thread), mille see otsus muudab.

## Revisjon 2026-08-08: eraldi köitevahe-riba vaade eemaldatud

Algne disain nägi ette kolm taset: kontaktleht → köitevahe-riba → üksikleht.
**Ribavaade eemaldati esimese päriskasutuse järel.**

Põhjus mõõdetuna: server renderdas riba korrektselt (224 × 1776 px natiivselt),
aga UI kuvas seda 120 × 300 px kastis `objectFit: 'fill'`-iga — 1,9× horisontaalne
vähendus, **5,9× vertikaalne kokkusurumine** ja ~3:1 moonutus. Kogu natiivne
lahutus, mille pärast riba eksisteeris, visati CSS-is minema; tekst muutus
loetamatuks määrdeks. Vaade dubleeris kontaktlehte, ainult halvemini.

Sisuline põhjus kaalus tehnilise üles: üksikleht annab **sama info pluss
tegutsemisvõimaluse** — joont saab kohe nihutada ja korraga näeb tervet lehte.
Kitsam vaade ilma tegutsemisvõimaluseta ei teeni oma koodi.

Natiivse lahutuse idee ise jäi alles, aga ainult seal, kus seda kasutatakse:
üksiklehe kõrval-paan kuvab riba `object-none` + `object-center`-iga **1:1**,
joone peale kärbituna. `w-auto` + fikseeritud kõrgus oleks kuivatanud selle
~53 px sliveriks — sama viga väiksemas mastaabis.

Töövoog on nüüd kaheastmeline: kontaktleht (ülevaade + tindihoiatus) → üksikleht
(kontrolli ja paranda). Backend jäi muutmata — `/strip/` endpoint, `get_gutter_strip`
ja LRU-vahemälu teenindavad endiselt üksiklehe paani.

## Teadaolev, siin mitte parandatud

`reocr_ops.start_reocr_batch` kirjutab OCR-serverisse otse sihtnimega, ilma
`.tmp`+rename-ta, ja jagab sedasama võistlusolukorda. Eraldi issue.
