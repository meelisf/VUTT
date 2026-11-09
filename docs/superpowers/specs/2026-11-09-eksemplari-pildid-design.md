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
  _imports/{import_id}/    ← impordi staging: job.json, allalaaditud PDF, renderdus
  _thumbs/                 ← laisad pisipildid, nagu teose _thumbs
```

`data/.gitignore` laiendus: `_imports/`, `_thumbs/`, `*.pdf`, `*.tif`, `*.tiff`, `*.orig.*`,
`*.part`, `*.tmp*`. Praegu on ignoreeritud ainult `jpg/jpeg/png`. `replace_work_content`
teeb `repo.git.add(slug)` ja commit'iks muidu ka poolelioleva `_imports/*/job.json`-i.
Sama loend läheb `git_ops._init_repo_locked`-i (uue repo `.gitignore`). Serveri
olemasolev `data/.gitignore` uuendatakse käsitsi + commit konteinerist enne deploy'd.

`images.json`:

```jsonc
{
  "revision": 7,                       // serveri väli: kasvab iga kirjutusega (optimistlik lukk)
  "imports": {                         // serveri väli: avaldatud impordid, piltidest sõltumatu
    "q8x2mz": {"kind": "ada", "ref": "10062/14332", "count": 12, "by": "meelisf", "at": "2026-11-09"}
  },
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
        "import_id": "q8x2mz",         // serveri väli, ainult importidel
        "license": null,               // valikuline vabatekst
        "added_by": "meelisf",
        "at": "2026-11-09"
      }
    }
  ]
}
```

- Järjekord = massiivi järjekord. Väärtuseta võtit ei salvestata (ADR 0076 p 2).
- **Serveri väljad:** `revision`, `imports`, `source.import_id`, `source.added_by`,
  `source.at`. `PATCH` võtab need alati salvestatud kirjest, kliendi väärtus jäetakse
  arvestamata (nagu `strip_server_fields` isikukaardil). Impordiga lisatud pildil on
  kogu `source` peale `license`-i muutumatu, sest viide originaalile ei tohi kaduda.
  Kustutamine on lubatud, aga `imports`-kirje jääb alles.
- Manifest on eraldi failis, mitte `_metadata.json`-is. Kümnete lehtedega ADA import ei
  paisuta teose metaandmeid ega puuduta Meili sünki (ADR 0012/0013).
- **Lähtefail ja tuletis.** Vesimärgi ja paberistruktuuri detail ei tohi kaduda kadudega
  teisenduses. JPEG, mille EXIF-orientatsioon on 1 või puudub, hoitakse muutmata
  baitidega ja see on ise vaatamiskuju (`original` puudub). Sama reegel kehtib
  `can_copy_source_bytes`-is, ADR 0028. Muu (PNG, TIFF, pööratud JPEG) säilitatakse kujul
  `{id}.orig.{ext}` ja `{id}.jpg` on sellest tehtud vaatamiskuju. Sama kehtib JPEG-i
  kohta, mille pikim külg ületab vaatamiskuju lae (vt Üleslaadimine).
- **ADA import ei hoia PDF-i alles.** Originaal on ADA-s ja `source.ref` + `bitstream` +
  `page` viitavad sellele üheselt. Konvoluudi PDF (sadu MB) dubleeruks muidu iga teose alla,
  kuhu sellest vahemik imporditakse. PDF elab ainult staging'us ja kustub koos sellega.
  Lehe JPEG (300 DPI, sama renderdus mis uploadil) on ADA pildi vaatamiskuju ja `original`
  puudub.
- **Eksemplari kustutamine** (`delete_exemplar`): kui pildid on olemas, nõuab kinnitust.
  Sama luku all ja **samas commit'is** `_metadata.json`-i muudatusega eemaldatakse
  `_exemplars/{id}/images.json` git-indeksist. Gitist väljas olevad failid liiguvad
  `._trash/{work_id}/_exemplars/{id}/`-i. Pooleli import sellel eksemplaril katkeb
  protokolli 1. sammus.
- **Teose kustutamine ja taastamine:** `admin_work_delete` viib praegu prügikasti ainult
  juurkausta pildid ja teeb siis `rmtree`. Sellest lähtuvalt:
  - `admin_work_delete` liigutab ka `_exemplars/` gitist väljas olevad failid
    `._trash/{work_id}/_exemplars/`-i;
  - `restore_deleted_work` toob need tagasi (manifest tuleb gitist);
  - pooleli impordid katkevad.

  Test: kustuta → taasta annab samad eksemplaripildid.
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
  - `POST /works/{id}/exemplars/{eid}/images`: failide üleslaadimine, `source` kaasas.
    Lähtefaili käsitlus: vt Andmemudel.
- **Üleslaadimine.** Olemasolev `detect_and_convert_image` toetab ainult JPG/PNG-d ega
  pööra EXIF-i, seega tuleb oma töötlus:
  - magic byte'id: JPEG, PNG, TIFF (`II*\0`, `MM\0*`);
  - piirid: fail ≤ 100 MB, pikim külg ≤ 12 000 px (pildipommi kaitse,
    `Image.MAX_IMAGE_PIXELS` vastavalt);
  - vaatamiskuju `{id}.jpg`: `ImageOps.exif_transpose`, 16-bit halltoon / CMYK / palett →
    RGB või L, pikim külg ≤ 4000 px, JPEG kvaliteet 92;
  - pööramata JPEG, mille pikim külg on ≤ 4000 px, jääb baitkoopiaks ilma `original`-ita.
  - `PATCH …/images` `{revision, images: [...]}`: järjekord + `label`/`page`/`source`.
    Loend peab sisaldama täpselt praegused ID-d (lisamine/kustutus siit ei käi), muidu 409.
  - `DELETE …/images/{image_id}?revision=N`: failid `._trash`-i, kirje manifestist.
  - `GET  …/images/{image_id}/original`: lähtefail (`{id}.orig.{ext}` või `{id}.jpg`),
    õigus `can_read_work` (nähtavus = teos). ADA pildi puhul 302 aadressile
    `https://hdl.handle.net/{ref}`.
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
  - **Püsiv impordi ID ja leheplaan.**
    - `POST` loob `import_id` ja kirjutab `_imports/{import_id}/job.json`: impordi
      parameetrid (handle, vahemik, eksemplar, kasutaja, `set_url`) ja `lookup`-i
      bitstreamide loendi (nimi, UUID, suurus).
    - Lehtede arv ei ole enne allalaadimist teada. Pärast allalaadimist ja `pdfinfo`
      lehearvude lugemist, **enne renderdamist**, arvutatakse leheplaan
      `[{image_id, pdf_page, bitstream, bitstream_page}]` ja salvestatakse `job.json`-i.
    - Kui leheplaan on juba olemas, kasutavad kordus ja taastaja samu `image_id`-sid.
      Vahemik väljaspool lehtede arvu → impordi viga.
  - **Ühel eksemplaril on korraga üks aktiivne import.** Teine `POST` samale
    eksemplarile saab 409.
  - **Renderdus staging-kausta** `_imports/{import_id}/` sama renderdajaga, millega teeb
    seda upload (`upload/page_source.py`, `FULL_DPI`/`JPEG_QUALITY`, `RENDER_SEMAPHORE`).
    Valmis leht = `{image_id}.jpg` olemas (`.tmp` + rename). Manifest selle aja jooksul
    ei muutu.
  - **Avaldamine on taastatav protokoll.** Iga samm kontrollib oma tehtust eraldi ja on
    korratav. Kogu protokoll jookseb ühe `work_lock` → `metadata_lock` all:
    1. **Teos ja eksemplar olemas?** Enne luku võtmist `os.path.isdir(work_dir)`, sest
       `work_lock` avab `{work_dir}/.vutt-lock`. Luku all eksemplari olemasolu. Kui
       kumbki puudub, märgi `job.json` olekuks `aborted`, staging `._trash`-i, lõpp.
       Teose kustutamisel ei ole stagingut enam alles. Taastaja käsitleb kadunud
       `job.json`-i kui katkestatud importi.
    2. **Failid ja manifest koos, imporditunnuse järgi.** Kõigepealt kontrolli
       `imports[import_id]`:
       - **olemas** → impordi pildid on manifestis juba kord olnud. Jäta failide
         liigutamine ja pildikirjete lisamine vahele, jätka 3. sammuga. Puuduvat faili ei
         otsita: kasutaja võis pildi vahepeal kustutada, ja staging'us seda enam pole;
       - **puudub** → iga `image_id` kohta, mida eksemplari kaustas veel pole, nimeta fail
         staging'ust ümber (sama failisüsteem, aatomiline; kaustas olev fail = tehtud).
         Seejärel lisa impordi pildid manifesti lõppu ja `imports[import_id]` kirje SAMA
         kirjutusega (`atomic_write_json`), ning tõsta `revision`.
    3. **Manifesti commit:** kui `images.json` erineb `HEAD`-ist, tee commit. Commit'i tõrkel
       jääb `job.json` olekuks `publishing` ja olekupäring näitab viga. Järgmine katse
       (taastaja või korduspäring) alustab 1. sammust ja jõuab siia.
    4. **URL:** kui `url_done` on juba märgitud, jäta samm vahele. Muidu:
       - kui `set_url` ja eksemplari `url` on tühi, kirjuta täislink
         `https://hdl.handle.net/{handle}` (`source.ref` jääb paljaks handle'iks).
         Kirjutus käib `work_exemplars`-i **lukustatud variandi** kaudu
         (`update_exemplar(..., locked=True)` → `_write_locked`, nagu
         `set_page_origin(..., locked=True)`). `work_lock` on tavaline `threading.Lock`,
         ja tavaline `update_exemplar` → `_write` jääks iseennast ootama.
         `_metadata.json`-i otse ei kirjutata;
       - **seejärel, igal juhul:** kui `_metadata.json` erineb `HEAD`-ist, tee commit. See
         lõpetab ka eelmise katse commit'imata URL-i kirjutuse: kordusel on URL kettal juba
         olemas ja kirjutus jääb vahele, aga commit mitte. Luku all teised kirjutajad
         commit'ivad alati, nii et lahknevus tähendab ainult ebaõnnestunud commit'i.
         Lukustatud variant tagastab commit'i tulemuse ja **`git_committed: false` on selle
         tee jaoks viga**, erinevalt `_bulk`-ist, mis seda veana ei käsitle. Tõrke korral
         jääb olekuks `publishing`;
       - `url_done: true` märgitakse alles pärast seda, kui `_metadata.json` ei erine
         `HEAD`-ist. See kehtib ka siis, kui `set_url` on false või `url` oli juba
         olemas.
    5. **Lõpp:** `job.json` olekuks `published`, seejärel staging'u kustutus. Kustutuse
       tõrge ei ole viga, sest olek on juba `published` ja `imports`-kirje olemas.
  - **Taastaja** (serveri stardil, mustriks `ada/fetch.taasta_rippuvad_fetchid`) vaatab iga
    `_imports/*/job.json`-i:
    - `published` → ainult koristus;
    - `aborted` → koristus;
    - renderdus pooleli → renderda puuduvad lehed;
    - muidu → käivita avaldamisprotokoll algusest.

    Lõpetatuse tunnus on `imports[import_id]` + commit'itud manifest + `url_done`, igaüks
    eraldi kontrollitud. Pildikirjete olemasolu tunnusena **ei kasutata**.
- Teose olemasolevate lehepiltide viimine eksemplari alla (nt `7zot7j` vana Uppsala
  kseroks prügikastis) **ei kuulu** sellesse etappi (minu otsus). Vajaduse korral käib see
  üleslaadimisena `source.kind = "other"`, või hiljem #705 lehtede liigutamise kaudu.
- **Pildiserver** (`server/image_server.py`): uued teed
  `/{kaust}/_exemplars/{eid}/{image_id}.jpg` (4 osa) ja
  `/{kaust}/_exemplars/{eid}/_thumbs/_thumb_{image_id}.jpg` (5 osa). Praegune
  `len(parts) > 3` keeld jääb kõigile teistele teedele. Pisipilt kasutab
  `get_or_create_page_thumbnail`-i eksemplari kausta peal. Teose ja õiguse kontroll
  on SAMA mis lehepildil (`_check_image_access`, token). `eid` ja `image_id` on rangelt
  nanoid-kujulised. Lähtefaile ja `_imports/`-i pildiserver **ei** serveeri.
  Praegune reegel „alakriipsuga alguses = keelatud" jääb kehtima kõigile muudele
  teedele. `get_first_image` ei näe alamkaustu ka edaspidi (kaanepilt).
- **Valvurid:** teose `_exemplars/` ei tohi sattuda ühtegi lehtede loendisse (Meili sünk,
  `lehekylje_number`, `refresh_work_mentions`, poolitus/järjestus, kaanepilt). Test:
  eksemplaripildiga teose lehtede loend ja Meili dokumendid on samad mis ilma.
  Impordi testid:
  - katkestus iga protokolli sammu järel: pärast failide liigutamist, pärast manifesti
    kirjutust enne commit'i, pärast commit'i enne URL-i, pärast URL-i enne koristust.
    Igal juhul annab kordus täpselt ühe impordi ja ühe URL-i uuenduse;
  - manifesti commit'i tõrge; URL-i commit'i tõrge (`url_done` jääb märkimata, kordus
    commit'ib);
  - manifest commit'itud, URL-i uuendus ebaõnnestub, kasutaja kustutab impordipildi →
    kordus ei otsi kadunud faili ja lõpetab URL-iga;
  - impordi pildid kustutatud enne taastajat: taastaja ei impordi uuesti;
  - `PATCH` katse muuta `import_id`-d või impordipildi `source`-i: väärtus jääb;
  - eksemplari kustutus renderdamise ajal; teose kustutus renderdamise ajal;
  - teine samaaegne import samale eksemplarile → 409;
  - eksemplari kustutus: `images.json` lahkub git-indeksist samas commit'is;
  - `_imports/` ei satu `replace_work_content`-i commit'i;
  - tühja URL-iga eksemplari import ei jää ummikusse (lukustatud variant);
  - 409 vananenud revisjoniga.

## Klient

- Teose lehel on eksemplari kaardil pildiriba (pisipildid + arv). Klõpsuga avaneb
  **eksemplari vaade**: alamleht `/work/{id}/exemplar/{eid}`, valikuliste parameetritega
  `?image={image_id}&compare={tüvi}`. See annab jagatava lingi, millele saavad järgmises
  etapis viidata ka vaatlused.
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

## Lahendatud lahtised küsimused

- Eksemplari vaade on alamleht (vt Klient).
- Piirid ja vaatamiskuju: vt Üleslaadimine.
- `images.json` muutus **ei** puuduta `_metadata.json`-i `updated_at`-i ega Meili sünki.

## Pärast

- ADR (eksemplari pildid: asukoht, manifest, nähtavus = teos, töövaatest eraldi)
  enne koodi, ADR 0076 „Tagajärgedesse" viide.
- Järgmine etapp: vaatlused (`locus`, IPH, fotod = viited `image_id`-dele), paber.ut.ee import.
