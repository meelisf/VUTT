# ADR 0073 — PDF-i skannilehte ei venitata üle allika resolutsiooni

**Kuupäev:** 2026-10-28
**Staatus:** ettepanek
**Issue:** #666 · **Täpsustab:** ADR 0028 (`FULL_DPI` = 300)

## Kontekst

`PdfPageSource.render_full` (`server/upload/page_source.py`) renderdab iga lehe
fikseeritult `pdftoppm -r 300`-ga. Pikslite arv tuleb seega PDF-i **deklareeritud
lehe suurusest** × 300.

Pikslid, füüsiline suurus ja ppi ei ole kolm sõltumatut suurust: pikslid =
füüsiline suurus × ppi. Skannitud allika puhul on päriselt olemas ainult pikslid
(skannitud info); lehe suurus ja ppi on metaandmed. Paljud digiteerijad (BSB,
Google Books jt) märgivad pildi 72 ppi-ks, nii et deklareeritud leht on
mitmekordselt suurem kui raamat.

Upload `kju4xj` (1658, BSB `bsb11130229`, 169 lk): lehe pilt 1753 × 2298 px,
72 ppi → PDF väidab lehe suuruseks ~1750 × 2300 pt (24 × 32 tolli, 62 × 81 cm).
Tegelik raamat on kvarto, ~15 × 20 cm. `-r 300` andis 7184 × 9475 px — iga
allikapiksel venitati ~4 × 4 pikslile. Infot ei lisandunud, aga JPEG (q95) kasvas
~13 MB-ni lehe kohta: PDF 102 MB → OCR-i lehed 2,2 GB.

See on kasutajakogemuse viga, mitte ainult kettaruumi küsimus: Workspace laeb iga
lehevahetusel terve skaneeringu (13 MB). Sama muster on `data/` all vähemalt viiel
teosel (1660 `1ezlp7` 6,3 GB, 1626 *Hexen-Predigt* 1,8 GB, 1644 `l6xrce` 1,3 GB,
1658 `63y11m` 1,2 GB, 1675 `x6p3tp` 0,76 GB).

Tähelepanuväärne: päris suurus (15 × 20 cm) × 300 ppi ≈ 1770 × 2360 px ehk peaaegu
täpselt allika pikslid. BSB skannis ~300 ppi-ga; vale on ainult metaandmestik.

## Otsus

**300 ppi jääb sihiks, aga skannilehe pilti ei venitata üles.** Esimene teostus
kehtib kitsalt ühele lehetüübile; kõik muu renderdatakse nagu seni (300 ppi).

1. **Ulatus: ühe kogu lehte katva skannipildiga leht.** Lehel on täpselt üks
   rasterpilt (`pdfimages -list` tüüp `image`; `mask`/`smask` objekte ei loeta),
   mille kuvamõõt (`width / x-ppi` × `height / y-ppi`) katab praktiliselt kogu
   lehe (lävi määratakse teostuses, nt ≥ 90 % pindalast). Skanni peal olev
   nähtamatu OCR-tekstikiht on lubatud — see ei muuda lehte digitaalseks.
2. **Sellisel lehel renderduse ppi = `min(300, x-ppi, y-ppi)`.** Väiksema telje
   järgi, et kumbagi telge ei suurendataks. Kompromiss: kui telgede ppi erineb,
   kaotab suurema ppi-ga telg osa detailist. Skannides on telgede ppi praktiliselt
   alati võrdne; erinevus on märk ebatavalisest allikast ja see logitakse.
   Lehe pikslimõõt võib manustatud pildi omast veidi erineda (veeris, ümardus) —
   lubadus on „skanni ei venitata", mitte „lehel ei ole kunagi rohkem piksleid".
3. **Kõik muu jääb 300 ppi peale:** digitaalne leht (rasterpilti ei ole), leht,
   kus rasterpilt on ainult osa lehest (nt digitaalne tekst + 72 ppi foto — seal
   halvendaks piiramine teksti ja OCR-i), mitme pildiga leht ja leht, mille
   tuvastus on ebakindel. Nende üldistus on eraldi otsus, kui vajadus tekib.
4. **Füüsilist suurust ei parandata ega tuletata.** Formaadist (kvarto, oktaav)
   oletamine oleks uus oletus. Me ainult ei lase valel metaandmestikul skanni
   pikslite arvu üles ajada.
5. **Otsus on vaikne.** Viisard ei näita hoiatust ega numbreid — tavakasutaja ei
   saa „PDF väidab 62 × 81 cm" teatest midagi peale segaduse ja tal ei ole siin
   midagi valida. Lehe tüüp, valitud ppi ja põhjus kirjutatakse upload'i state'i
   (diagnostika), mitte UI-sse.

Pildikausta upload'i (`ImageDirPageSource`) see ei puuduta: seal ei ole
rasterdust, pikslid on allika omad.

## Tagajärjed

- **ADR 0028 invariant „`FULL_DPI` = OCR-serveri `PDF_DPI`" kitseneb.** ADR 0028-st
  alates materialiseerib PDF-i VUTT ja LOSS ainult OCR-ib, seega kattumine on
  oluline ainult LOSSi `expand_pdf` käsitsi-voole. `FULL_DPI = 300` jääb laeks.
- **OCR-i kvaliteet mõõdetakse, mitte ei eeldata.** Mudelisisend sõltub LOSSi
  eeltöötlusest (teenuses `fit_to_grid`, treeningus `image_processor`); erinev
  sisendresolutsioon võib vahepealse skaleerimise kaudu tulemust muuta. Enne
  „kehtib"-staatust: kontrolltranskriptsioonid (Valmis-lehed) mitmest teosest,
  mis katavad peenkirja, kehva kontrasti ja topeltlehti; sama leht allika
  suuruses vs 300 ppi venitusega; lubatud CER-i halvenemine lepitakse kokku
  enne mõõtmist.
- **Lõikekoordinaadid ei sõltu resolutsioonist** (ADR 0049: `adjust` 0..1), nii et
  allika suuruses renderdus ei murra poolitust ega kärbet.
- **Olemasolevad teosed** (#666): inventuur → ümbertegemine teose kaupa.
  - **PDF alles** (`uploads/{id}/source.pdf` või digiteerija allikas uuesti
    alla laaditav) → ümberrenderdus selle ADR-i reegli järgi.
  - **PDF-i ei ole** → vähendamine ainult **tõendatud sihtmõõdule** (allika pildi
    mõõt mõnest säilinud kirjest), ja see on **ligikaudne taastamine**, mitte
    ümberrenderdusega samaväärne: suurendus → JPEG → vähendus muudab detaile.
    Säilinud JPG mõõtudest üksi algset resolutsiooni teada ei saa — ilma
    tõendatud sihtmõõduta lehte ei puututa.
  - Pildid ei ole gitis (tekstid ja metaandmed on), nii et ümbertegemine ei
    tekita commit'i. Pisipildid, kaanepilt (`COVER_VERSION`) ja laisad
    suurusvariandid tuleb pärast uuendada.

## Viited

- `server/upload/page_source.py` — `PdfPageSource.render_full`, `FULL_DPI`
- ADR 0028 (VUTT materialiseerib), ADR 0049 (lehe teisendus, `adjust` 0..1)
- Upload `kju4xj` / teos `0arsyg` — avastatud 2026-10-28
