# ADR 0074 — PDF-ist lehtede lisamine teose haldusse: üks renderdaja, üks sisestuskiht, üks tööregister

**Kuupäev:** 2026-10-28
**Staatus:** vastu võetud
**Seotud:** ADR 0028, 0049, 0050, 0061, 0073 · Disain: `docs/superpowers/specs/2026-10-28-pdf-lehtede-lisamine-design.md`

## Kontekst

Teosed on sageli skännitud osade kaupa ja puuduvad lehed tulevad hiljem eraldi
PDF-ina, mis tuleb lisada olemasolevale teosele kas keskele või lõppu. Teose halduses sai lisada ainult
JPG/PNG-d (`add-pages`, 20 faili / 200 MB, kõik mälus, sünkroonne). Upload'i
viisardi kopeerimine teosesse tooks kaasa teise renderdus- ja töötlustee,
mis aja jooksul lahku läheks. Teose halduses on pööre, kärbe ja poolitus juba
ootel plaanina olemas (ADR 0050/0061), samuti re-OCR pakk.

## Otsus

- **PDF renderdatakse AINULT `PdfPageSource.render_full`-iga** (`server/add_pdf_pages.py`)
  ja `RENDER_SEMAPHORE` all. Teose halduses ei ole oma pdftoppm-kutset ega
  DPI-konstanti, nii et ADR 0073 parandus jõuab siia automaatselt.
- **Üks sisestuskiht kettal olevatele valmis piltidele:** `insert_prepared_pages`
  (`admin_page_ops.py`) liigutab failid (`os.replace`) ja teeb ühe `work_lock`-i
  all jada-jaotuse, **ühe commit'i**, ühe Meili sünkrooni ja `refresh_work_mentions`-i. `add_pages`
  on selle väliskiht: pildi-HTTP piirid jäävad sinna. Renderdusi mällu ei loeta
  (ADR 0073: 102 MB PDF → 2,2 GB pilte).
- **Sisestuskoht on lehe failinimi (`after`: `"start"` | `"end"` | pildifaili nimi),
  mis lahendatakse luku all.** Renderdus käib luku väljas ja võib kesta minuteid.
  Kui ankur on vahepeal kadunud, saab kasutaja `AnchorMissing` (`code: "anchor_missing"`)
  ja midagi ei sisestata.
- **Üks tööregister liigiga** (`page_ops_jobs.start_job`, `kind: page_ops | add_pdf`).
  Teose kohta on korraga üks töö sõltumata liigist. Olekus on `kind`, klient jälgib
  ainult oma liiki ja käsitleb lõppu liigi järgi: PDF-töö lõpp ei puuduta ootel
  lehetoimingute plaani.
- **PDF lisatakse tervikuna.** Üleliigsed lehed kustutatakse tavalise kustutusega.
  Lisatud lehed tõstetakse kliendis esile ja jäetakse valituks.
- **OCR käivitatakse käsitsi** olemasoleva re-OCR pakiga, pärast töötlust
  (poolitus pärast OCR-i raiskaks esimese OCR-i).
- Lehed on teoses kohe nähtavad, ka töötlemata ja tekstita kujul. Peidetud vaheetappi ei ole.

## Tagajärjed

- Ajutine kaust on teose kaustas (`.tmp-pdf-<hex>`, `/data` ja `/app/state` on eri
  mountid). Restart keset tööd jätab selle maha; järgmine sama teose PDF koristab
  üle 24 h vanad.
- Ühe päringuga üles laaditava PDF-i lagi on 200 MB ja lehtede lagi 500. Jätkatavat tükeldust (ADR 0047) siin ei ole.
  Kui seda vajatakse, üldistatakse `upload/chunked.py`, mitte ei kirjutata teist.
- Uus renderdav tee PEAB läbima `RENDER_SEMAPHORE`-i. Uus teose taustatöö PEAB
  kasutama `start_job`-i, mitte oma registrit.
