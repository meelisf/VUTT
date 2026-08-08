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
- **Automaatikat ei ole.** Köitevahe globaalne tuvastamine mõõdeti
  ebausaldusväärseks (pakutav x hüppas 0,38–0,61 vahel) ja ka tindiskoor
  eemaldati hiljem — vt revisjoni 2026-08-08. Admin otsustab silmaga;
  kontaktleht näitab joone asendit kõigil lehtedel korraga.
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

Natiivse lahutuse idee jäi esialgu alles üksiklehe kõrval-paanina (`object-none`
+ `object-center`, 1:1 joone peale kärbituna) — **ka see eemaldati, vt allpool.**

Töövoog on nüüd kaheastmeline: kontaktleht (ülevaade) → üksikleht
(kontrolli ja paranda).

## Revisjon 2026-08-08: köitevahe-riba eemaldatud tervikuna

Ka üksiklehe kõrval-paan kadus. Otsuse alus on kasutuskogemus: 100 DPI eelvaade
näitab joone asendit juba piisava täpsusega, et otsustada, kas poolitus on
õiges kohas. Riba lisas selle otsuse kõrvale teise pildi, mida tuli eraldi
tõlgendada, aga ei muutnud ühtki otsust.

Hind oli ebaproportsionaalne — riba tõi endaga kaasa terve ahela:
`/admin/upload/{id}/strip/{n}` endpoint, `get_gutter_strip`, `quantize_x`
(x-kvantimine, et lohistamine ei tekitaks sadu peaaegu identseid faile),
`prune_strip_cache` (LRU, et need failid ei koguneks), `strips/` kataloog
koos oma koristusreegliga, `render_region` mõlemas `PageSource` teostuses ja
frontendis 400 ms debounce koos oma olekuga. Kõik see teenindas ühte
kõrvalpilti.

`full_width` / `_pdfinfo_page_size_pts` kadusid ühtlasi — need eksisteerisid
ainult riba x-koordinaadi arvutamiseks. `_transfer_pages` võtab laiuse
renderdatud lehe enda pikslitest, nagu varemgi.

**Õppetund:** natiivne lahutus oli tehniliselt õige lahendus küsimusele, mida
kasutaja ei esitanud. Enne mehhanismi ehitamist tuleb kontrollida, kas ta
muudab mõnda otsust.

## Revisjon 2026-08-08: tindiskoor eemaldatud

Algne invariant „automaatika on hoiataja, mitte pakkuja" eeldas, et tindiskoor
on **usaldusväärne kõrge väärtuse suunas**. Päris materjalil see ei kehtinud ja
skoor eemaldati tervikuna.

**Esimene läbikukkumine — hoiatus käivitus õige vastuse peale.** Lehe 2 profiil
(EAA-tüüpi kirikuraamat, 100 DPI eelvaade):

| Koht | ink |
|---|---|
| Tekstiveerud | ~0,36 |
| Köitevahe 0,48 / 0,52 | 0,109 / 0,086 |
| **Murdekoht 0,50** | **0,451** |

Skoor oli kõrgeim täpselt seal, kus poolitus on kõige õigem. Kõik kuus lehte
said 0,40–0,52 ehk kogu teos märgiti punaseks, kuigi joon oli igal pool õige.

**Katse päästa — pidevusmõõt.** `ink_profile()` hakkas tagastama ka tindi
vertikaalset pidevust (pikim järjestikuste tumedate ridade jada / kõrgus)
eeldusel, et murre on katkematu joon ja kiri katkendlik. See vähendas hoiatusi
kuuelt kahele, aga ei lahendanud probleemi.

**Teine läbikukkumine — absoluutväärtus ei mõõda lehte.** `INK_PERCENTILE = 0.35`
seab läve nii, et **35% lehe pikslitest on definitsiooni järgi „tint"**. Suvalise
veeru oodatav skoor on seega ~0,35 juba konstruktsiooni tõttu (mõõdetud
tekstiveerud: 0,318–0,387, mediaan 0,36). Hoiatuslävi 0,25 jäi **allapoole seda
baasjoont**, seega iga tekstiga leht ületas selle paratamatult. Lisaks: rea kaupa
kõige tumedama veeru asukoht hüppas 65–121 px ulatuses, mis tähendab, et neil
skännidel ei ole gutteris ühtset tumedat joont, mille külge pidevusmõõt haakuda
saaks.

**Otsus:** eemaldati `ink_score`, `ink_profile`, `percentile_from_hist`,
`INK_PERCENTILE`, plaani väljad `ink`/`ink_cont`, frontendi `inkLevel` ja
kontaktlehe värviraamid. Hoiatus, mis käivitub õige käitumise peale, õpetab
kasutajat hoiatust eirama — see on halvem kui hoiatuse puudumine.

**Kui automaatikat kunagi uuesti proovida:** absoluutne lävi ei tööta. Mõõta
tuleks veeru skoori **suhtena lehe enda veergude jaotusesse** (kas x on tugev
lokaalne miinimum või maksimum), mitte fikseeritud protsentiili vastu.

## Teadaolev, siin mitte parandatud

`reocr_ops.start_reocr_batch` kirjutab OCR-serverisse otse sihtnimega, ilma
`.tmp`+rename-ta, ja jagab sedasama võistlusolukorda. Eraldi issue.

**`RENDER_SEMAPHORE` hoitakse terve partii vältel** (`_render_previews` ja
`apply_and_transfer`), mitte lehe kaupa. Vt issue #219.

