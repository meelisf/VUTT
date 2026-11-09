# Eksemplari pildid — disain

**Kuupäev:** 2026-11-09 · **Issue:** #696 (etapi 3 esimene pool) · **Alus:** ADR 0076

## Miks

Teosel on üks tekstitunnistaja ja töövaates tema lehed. Teistel eksemplaridel on praegu
ainult kirje (hoidja, kohaviit, link). Ajend: `6mwgby` transkriptsioon on tehtud Uppsala UB
eksemplari paberkoopiast. TÜR-i originaali digikoopia on ADA-s (`10062/14332`), aga seal on
köitja ülemised read ära lõiganud. Doktorant tahab transkriptsiooni aluseks jätta
paberkoopia ja panna ADA pildid TÜR-i eksemplari juurde.

Eksemplari piltidel on kaks rolli:

1. **Võrdlus:** teise eksemplari lehti vaadatakse tekstitunnistaja lehtede kõrval.
2. **Paber:** vesimärkide, ahel- ja ribijoonte, köite fotod. See on eksemplari vaates
   peamine. Vaatlused (vesimärgi kirjeldus) tulevad **järgmises etapis** ja viitavad selle
   etapi piltidele.

## Eesmärgid

- Igal eksemplaril (ka lehtedeta) on oma pildid: järjekord, allikas, valikuline silt.
- Pildid tulevad igalt poolt: ADA, muud digiraamatukogud, uurijate fotod, hiljem
  paber.ut.ee ühekordne import. Kõik hoitakse VUTT-is endas, ainult linkimisest ei piisa.
- Eksemplari vaates saab pilte sirvida ja ühte pilti tekstitunnistaja lehe kõrval vaadata.
- ADA kirjest saab eksemplari pildid importida ühe toiminguga (handle → lehed).

## Mitte-eesmärgid

- **Töövaade ei muutu.** Workspace näitab ainult tekstitunnistaja lehti. Eksemplari pildid
  sinna ei jõua.
- Vaatlused, IPH sõnastik, vesimärgivormid, paber.ut.ee import: järgmine etapp.
- Teiste eksemplaride transkribeerimine, OCR, Meili indekseerimine.
- Pildipõhine nähtavus või litsentsihaldus.
- Automaatne lehtede vastavus eksemplaride vahel. Köitja kärped, puuduvad lehed ja
  konvoluudi järjekord teevad selle ebausaldusväärseks.

## Anti-eesmärgid (läbikukkumine, isegi kui töötab)

- Eksemplari pilt ilmub töövaatesse, kaanepildiks, pisipildiks või `lehekylje_number`-päringutesse.
- Pildi allikas läheb kaduma, nii et ADA-st kopeeritud lehte ei saa originaalile viidata.
- Mitteavaliku teose eksemplaripilt on ilma õiguseta kättesaadav.

## Kasutaja otsused

- **Koht:** eksemplari vaade (teose lehel eksemplari kaart → pildid). Töövaade jääb puhtaks.
- **Nähtavus = teose nähtavus.** Kui pilt ei tohi olla avalik, tehakse kogu teos
  mitteavalikuks. Eraldi pildi tasemel eristust ei ole.
- **Pildid kuuluvad eksemplarile, vaatlus viitab neile.** Järjekord: kõigepealt pildikiht
  koos sirvimise ja kõrvutamisega, vaatlused hiljem.

## Andmemudel (minu otsus, ehitaja võib täpsustada)

```
data/{kaust}/_exemplars/{exemplar_id}/
  images.json              ← manifest, gitis (autoriteetne)
  {image_id}.jpg           ← vaatamiskuju (tuletis), gitist väljas
  {image_id}.orig.{ext}    ← lähtefail muutmata baitidega, kui see EI OLE vaatamiskuju ise
  _sources/{import_id}.pdf ← ADA impordi allalaaditud PDF (lähtefail), gitist väljas
  _imports/{import_id}/    ← impordi staging (renderdus enne avaldamist)
  _thumbs/                 ← laisad pisipildid, nagu teose _thumbs
```

`data/.gitignore` laiendus: `*.pdf`, `*.tif`, `*.tiff`, `*.orig.*` (praegu on ignoreeritud
ainult `jpg/jpeg/png`, PDF/TIFF satuks muidu `data/` gitti).

`images.json`:

```jsonc
{
  "revision": 7,                       // kasvab iga kirjutusega (optimistlik lukk, vt Server)
  "images": [
    {
      "id": "k3j9qa",                  // nanoid, püsiv; vaatamiskuju = {id}.jpg
      "original": "k3j9qa.orig.tif",   // valikuline; puudub = {id}.jpg ON lähtefail
      "label": "a2 r",                 // valikuline vabatekst: asukoht, „tiitelleht", „köide"
      "page": "…-003",                 // valikuline: tekstitunnistaja lehe tüvi kõrvutamiseks (käsitsi)
      "source": {                      // kohustuslik
        "kind": "ada",                 // ada | url | photo | paber_ut (järgmine etapp) | other
        "ref": "10062/14332",          // handle / URL / vabatekst („M. F. foto, TÜR lugemissaal")
        "bitstream": "…uuid…",         // ainult ada: bitstreami UUID
        "page": 3,                     // valikuline: 1-põhine leht SELLES failis (ada: bitstreamis)
        "import_id": "q8x2mz",         // ainult importidel: mis impordiga lisati
        "license": null,               // valikuline vabatekst
        "added_by": "meelisf",
        "at": "2026-11-09"
      }
    }
  ]
}
```

- Järjekord = massiivi järjekord. Väärtuseta võtit ei salvestata (ADR 0076 p 2).
- Manifest on eraldi failis, mitte `_metadata.json`-is. Kümnete lehtedega ADA import ei
  paisuta teose metaandmeid ega puuduta Meili sünki (ADR 0012/0013).
- **Lähtefail ja tuletis.** Vesimärgi ja paberistruktuuri detail ei tohi kaduda kadudega
  teisenduses. JPEG, mille EXIF-orientatsioon on 1 või puudub, hoitakse muutmata
  baitidega ja see on ise vaatamiskuju (`original` puudub). Sama reegel kehtib
  `can_copy_source_bytes`-is, ADR 0028. Muu (PNG, TIFF, pööratud JPEG) säilitatakse kujul
  `{id}.orig.{ext}` ja `{id}.jpg` on sellest tehtud vaatamiskuju. ADA impordil on
  lähtefail allalaaditud PDF `_sources/`-is ja lehe JPEG on tuletis. Allalaadimine
  teenindab ainult toimetajat (`GET …/images/{image_id}/original`, `can_read_work`).
- Eksemplari kustutamisel liigub tema `_exemplars/{id}/` `._trash`-i (nagu
  `replaced_images`). Kui pildid on olemas, nõuab kustutamine kinnitust.
- `page` on ainult kõrvutamise mugavus. Kui tüve enam pole (lehtede ümberjärjestus,
  kustutus), kuvatakse pilt ilma paarita. Serveri sünki lehetoimingutega **ei tehta**.

## Server

- Uus moodul `server/exemplar_images.py`. **Lukustusjärjekord on sama mis eksemplaride
  kirjutusteel: `work_lock` → `metadata_lock`.** Iga manifesti kirjutus (üleslaadimine,
  muutmine, kustutus, impordi avaldamine) ja eksemplari kustutus hoiavad mõlemat. Nii ei
  saa eksemplar kaduda manifesti kirjutamise ajal, ega manifest tekkida kustutatud
  eksemplarile. Iga kirjutus kontrollib luku all, et eksemplar on `_metadata.json`-is
  olemas (muidu 404). Iga muudatus = üks git-commit (`images.json`), autor toimingust.
- **Revisjon (optimistlik lukk).** `GET` tagastab `revision`. Kliendi kirjutus
  (`PATCH`, `DELETE`) kannab oma `revision`-it. Kui see erineb luku all loetust, vastab
  server **409** ja praeguse manifestiga, ning klient laeb uuesti (salvestamata muudatused
  jäävad dialoogi). Serveripoolne impordi avaldamine tõstab revisjoni, nii et vananenud
  loendi salvestus ei saa impordi pilte ära kaotada ega järjekorda lõhkuda.
  Üleslaadimine (`POST`) ainult lisab lõppu ja revisjoni ei nõua.
- Otspunktid (router: sama, kus `work_exemplars`):
  - `GET  /works/{id}/exemplars/{eid}/images`: lugemisõigus (`can_read_work`).
  - `POST /works/{id}/exemplars/{eid}/images`: failide üleslaadimine (JPEG/PNG/TIFF,
    tuvastus magic byte'idest), `source` kaasas. Lähtefaili käsitlus: vt Andmemudel.
  - `PATCH …/images` `{revision, images: [...]}`: järjekord + `label`/`page`/`source`.
    Loend peab sisaldama täpselt praegused ID-d (lisamine/kustutus siit ei käi), muidu 409.
  - `DELETE …/images/{image_id}?revision=N`: failid `._trash`-i, kirje manifestist.
  - `POST …/images/import-ada` `{handle, from?, to?}` → `import_id`; olek
    `GET …/images/import-ada/{import_id}`.
  - Kirjutusõigus: `can_write_work` (ADR 0031). Uut rolli ei tule.
- **ADA import.** Kasutab olemasolevat `server/ada/client` + `fetch`-i: handle →
  bitstreamid (sorteeritud nagu `mapping.sordi_bitstreamid`) → PDF-id → liidetud PDF.
  - `from`–`to` on **1-põhine lehevahemik liidetud PDF-is** (valikuline, puudub = kõik).
    Vajalik, sest ADA kirje võib olla terve konvoluut (nt TÜR R Est.A-5085), millest selle
    teose alla kuulub ainult osa. Iga lehe kohta salvestatakse `source.bitstream` (UUID)
    ja `source.page` = leht SELLES bitstreamis, mitte liidetud PDF-is. Arvutus tuleb
    bitstreamide lehtede arvust.
  - **Püsiv impordi ID ja piltide ID-d.** `POST` loob `import_id` ja kirjutab
    `_imports/{import_id}/job.json`: handle, vahemik, eksemplar, kasutaja ja iga
    väljundlehe kohta eelnevalt määratud `image_id`. Kordus kasutab samu ID-sid.
  - **Renderdus staging-kausta** `_imports/{import_id}/` sama renderdajaga, millega teeb
    seda upload (`upload/page_source.py`, `FULL_DPI`/`JPEG_QUALITY`, `RENDER_SEMAPHORE`).
    Valmis leht = `{image_id}.jpg` olemas (`.tmp` + rename). Manifest selle aja jooksul
    ei muutu.
  - **Avaldamine on üks lukustatud toiming** (`work_lock` → `metadata_lock`):
    1. kontrolli uuesti, et eksemplar on olemas. Kui ei, märgi import katkestatuks ja
       staging `._trash`-i;
    2. kui manifestis on juba mõni pilt selle `import_id`-ga, on import avaldatud.
       Lõpeta ilma kirjutuseta (idempotentne: kordus avaldab täpselt ühe korra);
    3. liiguta failid staging'ust eksemplari kausta, lisa kirjed manifesti lõppu, tõsta
       `revision`, üks commit;
    4. kui eksemplari `url` on tühi, sea see **täislingiks**
       `https://hdl.handle.net/{handle}` (`source.ref` jääb paljaks handle'iks). See käib
       **olemasoleva `work_exemplars` kirjutustee kaudu** samas lukus, mitte otse
       `_metadata.json`-i;
    5. staging kustutatakse pärast edukat commit'i.
  - Serveri stardil jätkab taastaja pooleli jäänud importe `job.json` järgi (mustriks
    `ada/fetch.taasta_rippuvad_fetchid`): renderdab puuduvad lehed ja avaldab. Juba
    avaldatud impordi staging koristatakse.
- Teose olemasolevate lehepiltide viimine eksemplari alla (nt `7zot7j` vana Uppsala
  kseroks prügikastis) **ei kuulu** sellesse etappi (minu otsus). Vajaduse korral käib see
  üleslaadimisena `source.kind = "other"`, või hiljem #705 lehtede liigutamise kaudu.
- **Pildiserver** (`server/image_server.py`): uus tee
  `/{kaust}/_exemplars/{eid}/{image_id}.jpg` (+ `_thumbs/`). Teose ja õiguse kontroll
  on SAMA mis lehepildil (`_check_image_access`, token). `eid` ja `image_id` on rangelt
  nanoid-kujulised. Lähtefaile, `_sources/` ja `_imports/` pildiserver **ei** serveeri.
  Praegune reegel „alakriipsuga alguses = keelatud" jääb kehtima kõigile muudele
  teedele. `get_first_image` ei näe alamkaustu ka edaspidi (kaanepilt).
- **Valvurid:** teose `_exemplars/` ei tohi sattuda ühtegi lehtede loendisse (Meili sünk,
  `lehekylje_number`, `refresh_work_mentions`, poolitus/järjestus, kaanepilt). Test:
  eksemplaripildiga teose lehtede loend ja Meili dokumendid on samad mis ilma.
  Impordi testid: katkestus enne ja pärast manifesti kirjutust (kordus ei tekita
  topelte), eksemplari kustutus renderdamise ajal, 409 vananenud revisjoniga.

## Klient

- Teose lehel on eksemplari kaardil pildiriba (pisipildid + arv). Klõpsuga avaneb
  **eksemplari vaade**: täisekraani modaal (`z-[1300]`) või alamleht `/work/{id}/exemplar/{eid}`.
  Valib ehitaja; alamleht annab jagatava lingi.
- Eksemplari vaade:
  - pisipiltide rida + suur pilt (zoom/pan sama komponendiga, mida lehepildid kasutavad);
  - allikarida iga pildi all („ADA 10062/14332, lk 3“ lingina; „foto: …“);
  - **kõrvutamine:** nupp „Kõrvuta tekstitunnistajaga“ avab poolitatud vaate. Paremal on
    tekstitunnistaja leht: pildi `page` või käsitsi valitud leht, lehevahetus nooltega
    sõltumatult. Valiku saab salvestada pildi `page`-iks;
  - toimetajale: üleslaadimine (lohistamine), ADA import handle'iga, järjekorra muutmine,
    silt, allikas, kustutamine. Salvestamata muudatustele `useUnsavedChangesGuard`,
    tagasisidele `useNotify`/`useConfirm`.
- i18n: uus võti mõlemasse keelde korraga (ADR 0011).

## MCP

Selles etapis ei muutu. `get_work_exemplars` võib anda piltide arvu. Pildid ise tulevad
vajadusel koos vaatlustega.

## Avatud ehitajale

- Modaal või alamleht (eelistus: alamleht).
- Üleslaadimise suuruspiir ja vaatamiskuju pikima külje lagi (lähtefail säilib niikuinii).
- Kas `images.json` muutus kirjutab ka `_metadata.json`-i `updated_at`-i (ettepanek: ei).

## Pärast

- ADR (eksemplari pildid: asukoht, manifest, nähtavus = teos, töövaatest eraldi)
  enne koodi, ADR 0076 „Tagajärgedesse" viide.
- Järgmine etapp: vaatlused (`locus`, IPH, fotod = viited `image_id`-dele), paber.ut.ee import.
