# PDF-ist lehtede lisamine teose halduses — disain

**Kuupäev:** 2026-10-28
**Seotud:** ADR 0028 (VUTT materialiseerib), 0049 (lehe teisendus), 0050/0061 (ootel
lehetoimingud), 0073 (PDF-i renderdus allika resolutsioonis)

## Miks

Teosed on sageli skännitud osade kaupa. Puuduvad leheküljed tulevad hiljem eraldi
PDF-ina ja tuleb lisada olemasolevale teosele kas keskele või lõppu. Praegu
saab teose halduses (`WorkManage`) lisada ainult JPG/PNG-faile (`add-pages`),
nii et PDF tuleb käsitsi piltideks teha.

Lisatud lehed vajavad sama töötlust nagu upload'is (pööre, kärbe/sirgestus,
poolitus) ja seejärel OCR-i.

## Põhimõte: ära dubleeri, taaskasuta

Kasutaja nõue: kasutada võimalikult palju olemasolevaid osi, et ei tekiks
paralleelseid teenuseid, mis aja jooksul lahku lähevad. Teose halduses on
upload'i töötlusvahendid juba olemas:

| Vajadus | Olemasolev osa |
|---|---|
| PDF-i lehe renderdus | `server/upload/page_source.py` → `PdfPageSource.render_full` (ADR 0073 reegel jõuab siia, kui see teostatakse) |
| Failitüübi tuvastus | `server/upload/file_detection.py` (magic byte'id) |
| Lehtede sisestus kohta, jada, üks commit | `admin_page_ops.add_pages` + `allocate_sequences` + `write_new_page` |
| Pööre, kärbe, poolitus | ootel plaan `manage/pageOpsPlan.ts` + `POST /admin/work/{id}/page-ops` (ADR 0050, 0061) |
| Taustatöö edenemisega | `server/page_ops_jobs.py` muster |
| OCR | olemasolev re-OCR pakk (`reocr-batch`), valik „tekstita lehed“ (`selectableNoTextFiles`) |

**Upload'i viisardit ega `uploads/` staging'ut teosesse ei kopeerita.**

## Mida kasutaja teeb

1. Teose halduses avab „Lisa lehti“ ja valib PDF-i (JPG/PNG jäävad nagu praegu).
2. Valib koha: algusesse, mingi lehe järele või lõppu (olemasolev `after_page_num`).
3. Server renderdab PDF-i **kõik** lehed ja sisestab need valitud kohta.
   Edenemisriba näitab „N / M lehte“.
4. Lisatud lehed ilmuvad nimekirja kohe, ilma tekstita ja nähtavad ka teoses. Kasutaja nõustus,
   et lehed on töötlemata kujul vahepeal nähtavad.
5. Üleliigsed lehed (kaas, topelt) kustutab ta tavalise kustutusega.
6. Pöörab, kärbib ja poolitab olemasolevate ootel toimingutega → „Rakenda“.
7. **OCR-i käivitab ise nupust** (olemasolev re-OCR pakk) → ülevaatus → rakenda.
   OCR ei käivitu sisestamisel ega pärast „Rakenda“-t automaatselt.
   Põhjus: poolitus pärast OCR-i raiskaks esimese OCR-i. Järjekord on sama mis
   upload'is: kõigepealt töötlus, siis OCR.

## Otsused

**Kasutaja otsustas:**
- Lehed lähevad kohe teosesse. Peidetud vaheetappi ei ole.
- OCR on käsitsi käivitatav, mitte automaatne.
- Maksimaalne taaskasutus. Uut paralleelset renderdus- ega töötlusteed ei tehta.

**Disaini otsused (minu valik, kasutaja saab ümber lükata):**
- **PDF lisatakse alati tervikuna.** Lehevahemiku valikut ei ole, üleliigsed
  lehed kustutatakse olemasoleva kustutusega. See tähendab vähem UI-d ja ühe tee vähem.
- **Üks PDF ühe päringuga, ilma tükelduseta (v1).** Puuduvate lehtede PDF on
  tüüpiliselt väike (BSB: ~0,6 MB lehe kohta). Jätkatav tükeldus (ADR 0047,
  `upload/chunked.py`) on seotud upload'i olekuga (`upload_id`, `pending`,
  `partial_upload`). Selle üldistamine oleks eraldi refaktor. PDF-i lagi on
  `MAX_SINGLE_FILE_BYTES` (50 MB) asemel PDF-ile eraldi lagi, nt 200 MB
  (= olemasolev `MAX_REQUEST_BYTES`). nginx `/api/files/` lubab 600M.
  Kui hiljem on vaja suuremaid PDF-e, üldistatakse `chunked.py` (sihtkoht ja
  finaliseerija parameetriks), mitte ei kirjutata teist tükeldajat.
- **Sisestus on taustatöö.** Renderdus 300 ppi juures võtab sekundeid lehe kohta,
  sünkroonne päring jookseks pika PDF-iga ajapiiri vastu. Muster on sama mis `page_ops_jobs`:
  olek protsessi mälus, teose kohta korraga üks töö (409), klient pollib.
- **Tööregister on üks ja kannab töö liiki** (`page_ops_jobs` üldistatakse;
  `kind: "page_ops" | "add_pdf"`). **Teose kohta on korraga üks töö sõltumata
  liigist** (mõlemad võtavad `work_lock`-i ja muudavad failinimede loendit).
  Olek ja 409 vastus kannavad `kind`-i. **Klient kontrollib liiki enne
  jälgimist ja käsitleb lõppu liigi järgi:** praegu hakkab `savePageOps` 409
  peale `followPageOps`-iga jälgima ja lõpus tühjendab ootel plaani ning valiku
  (`WorkManage.tsx:640`). Kui PDF-töö satuks sinna, kustutaks see rakendamata
  pöörde- ja kärpeplaani. Vale liigi 409 → teade „teosel käib teine töö",
  plaani ei puututa. Lehe avamisel käiva töö taasavastus (`WorkManage.tsx:653`)
  valib jälgija samuti liigi järgi.
- **Renderdus läbib `RENDER_SEMAPHORE(1)`-i** (`prepress.py`). Rasterdus on
  protsessis ainult üks korraga. Upload'i apply ja eelvaade jagavad seda juba
  (CLAUDE.md: kriitiline).
- **Ühine sisestuskiht võtab vastu kettal olevad valmis JPEG-id**, mitte baite
  mälus. `add_pages` jagatakse kaheks:
  - **väliskiht (pildi-HTTP tee)**: jätab oma piirid (`MAX_FILES_PER_REQUEST` 20,
    `MAX_REQUEST_BYTES` 200 MB, `MAX_SINGLE_FILE_BYTES`), teisendab
    (`detect_and_convert_image`) ja kirjutab JPEG-id ajutisse kausta;
  - **sisekiht** (nt `insert_prepared_pages(work_id, jpeg_paths, anchor, username)`):
    ainult teekonnad, `work_lock`, jada-jaotus, staging (`os.replace`, mitte
    baitide kopeerimine), **üks git-commit**, Meili sünk üks kord,
    `refresh_work_mentions` (ADR 0055 / #420), `_cleanup_bulk`-tagasipööre.
  PDF-tee renderdab lehthaaval otse ajutisse kausta (**enne** `work_lock`-i) ja
  kutsub sisekihti. Põhjus: PDF-i sisendmaht ei piira renderduse mahtu
  (ADR 0073: 102 MB → 2,2 GB), nii et mälus hoidmine ei ole võimalik. PDF-teel on oma
  lehtede arvu lagi (nt 500) ja sisendfaili lagi (200 MB).
- **Sisestuskoht on ankur, mitte number.** Renderdus käib luku väljas ja võib
  kesta minuteid. Selle aja jooksul võib keegi lehti kustutada, poolitada või järjestada ning
  `after_page_num` osutaks valele lehele. Klient saadab ankruks **failinime**,
  mille järele sisestada (`"start"` / `"end"` erijuhtudena). Sisekiht lahendab
  positsiooni **`work_lock`-i all**. Kui ankrut enam ei ole (kustutatud või poolitatud),
  tagastatakse **konflikt** (töö olek `error`, kood `anchor_missing`) ja
  ajutine kaust koristatakse; midagi ei sisestata. Pildi-HTTP tee võib jääda
  `after_page_num`-i peale (sünkroonne, kontroll kohe luku all) või võtta
  sama ankru. See jääb ehitaja otsustada, eelistus on üks kuju.
- **Lisatud lehed tõstetakse esile** kliendis (töö vastus annab `inserted`
  failinimed) ja jäävad valituks (`selectedFiles`). Nii on pööre, poolitus ja OCR
  kohe nende peal. Esiletõst on vaate olek, seda ei salvestata.
- **Ootel plaan ja järjekorra mustand:** PDF-i lisamine on blokeeritud samadel
  tingimustel nagu praegune piltide lisamine (kui seal blokeeringut ei ole, siis
  vähemalt järjekorra mustandi ajal, sest see sõltub failinimede loendist; ADR 0050).
  Ootel lehetoimingud on failinime-põhised ja sisestus neid ei murra.

## Mitte-eesmärgid

- Upload'i kontaktlehe/viisardi kopeerimine teose haldusse.
- Automaatne OCR sisestamisel või pärast „Rakenda“-t.
- Peidetud vaheetapp (staging), kust lehed alles hiljem teosesse lähevad.
- PDF-i lehevahemiku valik.
- Jätkatav tükeldus teose halduses (v1).
- ADR 0073 teostamine. See on teise töö skoop. See disain sõltub ainult sellest,
  et kasutatakse sama `PdfPageSource`-i.

## Anti-eesmärgid (läbikukkumine, isegi kui töötab)

- Teose halduses on oma `pdftoppm`-kutse või oma DPI-konstant. Siis ei jõuaks ADR 0073
  parandus siia ja skannid oleksid jälle venitatud.
- Iga PDF-i leht on eraldi commit või Meili sünk.
- Renderdus käib `work_lock`-i all ja blokeerib teose minuteid.
- Rasterdus mööda `RENDER_SEMAPHORE`-ist.
- Renderdatud lehed hoitakse korraga mälus.
- PDF-töö lõpp tühjendab ootel lehetoimingute plaani.
- PDF läheb vale lehe järele, sest koht nihkus renderduse ajal.

## Ehitaja otsustada

- Kas PDF läheb olemasolevasse `add-pages` endpointi (tüübi järgi hargnev) või
  eraldi `POST /admin/work/{id}/add-pdf` + `…/status`. Eelistus: eraldi endpoint,
  sest vastuse kuju (töö id, pollimine) on erinev.
- Lehe ajutise renderduse asukoht (teose kausta `.tmp-…` nagu `add_pages`
  staging või `STATE_DIR` all).
- i18n võtmed (et + en korraga, ADR 0011).
- Testid: renderdus + sisestus (väike PDF fixture), vigane PDF → 400, töö
  topelt → 409 (ka risti: `page_ops` käib → `add_pdf` 409 ja vastupidi), üks
  commit, `inserted` järjekord = PDF-i lehejärjekord, kadunud ankur → konflikt
  ilma sisestuseta, pildi-HTTP tee piirid kehtivad endiselt; frontend: vale
  liigi 409 ei tühjenda ootel plaani.

## Avatud küsimus

- Kas sama PDF-tee peaks hiljem asendama ka `replace-image` (lehe pildi
  asendus PDF-ist)? Praegu ei ole see skoobis.
