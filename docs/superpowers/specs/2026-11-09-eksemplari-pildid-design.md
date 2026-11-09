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
  images.json          ← manifest, gitis (autoriteetne)
  {image_id}.jpg       ← gitist väljas (data/.gitignore *.jpg), nagu lehepildid
  _thumbs/             ← laisad pisipildid, nagu teose _thumbs
```

`images.json`:

```jsonc
{
  "images": [
    {
      "id": "k3j9qa",                  // nanoid, püsiv; failinimi = {id}.jpg
      "label": "a2 r",                 // valikuline vabatekst: asukoht, „tiitelleht", „köide"
      "page": "…-003",                 // valikuline: tekstitunnistaja lehe tüvi kõrvutamiseks (käsitsi)
      "source": {                      // kohustuslik
        "kind": "ada",                 // ada | url | photo | paber_ut (järgmine etapp) | other
        "ref": "10062/14332",          // handle / URL / vabatekst („M. F. foto, TÜR lugemissaal")
        "page": 3,                     // valikuline: lehekülg allikas
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
- Eksemplari kustutamisel liigub tema `_exemplars/{id}/` `._trash`-i (nagu
  `replaced_images`). Kui pildid on olemas, nõuab kustutamine kinnitust.
- `page` on ainult kõrvutamise mugavus. Kui tüve enam pole (lehtede ümberjärjestus,
  kustutus), kuvatakse pilt ilma paarita. Serveri sünki lehetoimingutega **ei tehta**.

## Server

- Uus moodul `server/exemplar_images.py`: manifesti lugemine/kirjutamine `work_lock` või
  `metadata_lock` all, iga muudatus = üks git-commit (`images.json`), autor toimingust.
- Otspunktid (router: sama, kus `work_exemplars`):
  - `GET  /works/{id}/exemplars/{eid}/images`: lugemisõigus (`can_read_work`).
  - `POST /works/{id}/exemplars/{eid}/images`: failide üleslaadimine (JPEG/PNG/TIFF,
    tuvastus magic byte'idest, teisendus JPEG-iks, EXIF-orientatsioon rakendatakse), `source` kaasas.
  - `PATCH …/images`: järjekord + `label`/`page`/`source` muutmine ühe kirjutusena.
  - `DELETE …/images/{image_id}`: fail `._trash`-i, kirje manifestist.
  - `POST …/images/import-ada`: `{handle}` → taustatöö (vt allpool), olek pollitav.
  - Kirjutusõigus: `can_write_work` (ADR 0031). Uut rolli ei tule.
- **ADA import:** kasutab olemasolevat `server/ada/client` + `fetch`-i (handle → bitstreamid
  → PDF), renderdab lehed JPEG-iks sama renderdajaga, millega teeb seda upload
  (`upload/page_source.py`, `RENDER_SEMAPHORE`), ja lisab need manifesti lõppu kujul
  `source.kind = "ada"`, `ref = handle`, `page = n`. Kui eksemplari `url` on tühi, seab
  import selle handle'iks. Taustatöö on restartitav ja failipõhine nagu `ada/fetch`.
  **Lehevahemik** (`from`–`to`, valikuline; minu otsus): ADA kirje võib olla terve
  konvoluut (nt TÜR R Est.A-5085), millest selle teose alla kuulub ainult osa.
- Teose olemasolevate lehepiltide viimine eksemplari alla (nt `7zot7j` vana Uppsala
  kseroks prügikastis) **ei kuulu** sellesse etappi (minu otsus). Vajaduse korral käib see
  üleslaadimisena `source.kind = "other"`, või hiljem #705 lehtede liigutamise kaudu.
- **Pildiserver** (`server/image_server.py`): uus tee
  `/{kaust}/_exemplars/{eid}/{image_id}.jpg` (+ `_thumbs/`). Teose ja õiguse kontroll
  on SAMA mis lehepildil (`_check_image_access`, token). `eid` ja `image_id` on rangelt
  nanoid-kujulised. Praegune reegel „alakriipsuga alguses = keelatud" jääb kehtima kõigile
  muudele teedele. `get_first_image` ei näe alamkaustu ka edaspidi (kaanepilt).
- **Valvurid:** teose `_exemplars/` ei tohi sattuda ühtegi lehtede loendisse (Meili sünk,
  `lehekylje_number`, `refresh_work_mentions`, poolitus/järjestus, kaanepilt). Test:
  eksemplaripildiga teose lehtede loend ja Meili dokumendid on samad mis ilma.

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
- Üleslaadimise suuruspiir ja pikima külje lagi (ettepanek: originaali hoida, eelvaade
  pildiserverist nagu lehtedel).
- Kas `images.json` muutus kirjutab ka `_metadata.json`-i `updated_at`-i (ettepanek: ei).

## Pärast

- ADR (eksemplari pildid: asukoht, manifest, nähtavus = teos, töövaatest eraldi)
  enne koodi, ADR 0076 „Tagajärgedesse" viide.
- Järgmine etapp: vaatlused (`locus`, IPH, fotod = viited `image_id`-dele), paber.ut.ee import.
