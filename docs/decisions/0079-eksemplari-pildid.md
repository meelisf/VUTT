# 0079 — Eksemplari pildid: oma kaust, manifest gitis, nähtavus = teos, töövaatest eraldi

**Staatus:** vastu võetud 2026-11-09

## Kontekst

ADR 0076 andis teosele eksemplarid, aga eksemplaril on ainult kirje (hoidja, kohaviit,
link). Ajend: `6mwgby` transkriptsioon on tehtud Uppsala UB eksemplarist, TÜR-i eksemplar
on ADA-s digiteeritud. Uurija tahab näha teise eksemplari lehte tekstitunnistaja lehe
kõrval: vesimärk, köitja kärped, käsitsi parandused, puuduvad lehed. Pilte tuleb mitmest
allikast (ADA, muud digiraamatukogud, uurijate fotod, hiljem paber.ut.ee). Ainult
linkimisest ei piisa, sest välised lingid kaovad ja vesimärgi detail nõuab täislahutust.

Disain ja ülevaatused: `docs/superpowers/specs/2026-11-09-eksemplari-pildid-design.md`.

## Otsus

### 1. Asukoht ja manifest

```
data/{kaust}/_exemplars/{exemplar_id}/
  images.json              ← manifest, gitis (autoriteetne)
  {image_id}.jpg           ← vaatamiskuju, gitist väljas
  {image_id}.orig.{ext}    ← lähtefail muutmata baitidega, kui see ei ole vaatamiskuju ise
  _imports/{import_id}/    ← impordi staging (job.json, PDF, renderdus)
  _thumbs/                 ← laisad pisipildid
```

- Manifest on eraldi failis, mitte `_metadata.json`-is: kümnete lehtedega import ei paisuta
  teose metaandmeid ega puuduta Meili sünki (ADR 0012/0013). `images.json` muutus ei muuda
  `_metadata.json`-i ega käivita reindeksit.
- Järjekord = massiivi järjekord. Väärtuseta võtit ei salvestata (ADR 0076 p 2).
- **Serveri väljad** `revision`, `imports`, `source.import_id`, `source.added_by`,
  `source.at` võetakse kirjutusel alati salvestatud kirjest. Impordiga lisatud pildil on
  `source` peale `license`-i muutumatu: viide originaalile ei tohi kaduda. Pildi kustutus
  jätab `imports`-kirje alles.
- **Lähtefail ja tuletis.** Pööramata JPEG, mille pikim külg on ≤ 4000 px, on ise
  vaatamiskuju (sama reegel mis `can_copy_source_bytes`, ADR 0028). Muu (PNG, TIFF,
  pööratud või suur JPEG) säilitatakse `{id}.orig.{ext}`-ina ja `{id}.jpg` tehakse sellest.
- **ADA import ei hoia PDF-i alles.** Originaal on ADA-s; `source.ref` + `bitstream` +
  `page` (leht SELLES bitstreamis) viitavad sellele üheselt. Konvoluudi PDF dubleeruks
  muidu iga teose alla.

### 2. Nähtavus = teose nähtavus

Pildi tasemel õigusi ei ole. Lugemine `can_read_work`, kirjutus `can_write_work`
(ADR 0031), pildiserveris sama `_check_image_access` + token mis lehepildil. Lähtefaile ja
`_imports/`-i pildiserver ei serveeri; lähtefail tuleb otspunktist `…/original`
lugemisõiguse kontrolliga.

### 3. Töövaatest eraldi

Eksemplari pilt ei ole teose leht. `_exemplars/` ei sattu ühtegi lehtede loendisse (Meili
sünk, `lehekylje_number`, `refresh_work_mentions`, poolitus/järjestus, kaanepilt) ja
Workspace ei näe neid. Vaade on alamleht `/work/{id}/exemplar/{eid}`. Pildi `page` on
ainult kõrvutamise mugavus.

**Täiendus 2026-11-10 (paarid ja lehetoimingud).** Paar kehtib ainult siis, kui tema tüvi
on teose praeguste lehetüvede hulgas. Sellest tuleneb:

1. **Koristus on olekupõhine.** `refresh_work_mentions` kutsub
   `exemplar_images.prune_dangling_pairs`-i, mis eemaldab igast manifestist paarid, mille
   tüve teosel enam ei ole. Idempotentne; võtab AINULT `metadata_lock`-i, sest
   `work_lock` ei ole taassisenetav ja kutsuja võib seda hoida.
2. **Poolitus ei jaota paare pooltele** — paar eemaldatakse (kaks sama lehega seotud
   pilti võivad olla üldvaade ja detail). Lehetoimingu vastus kannab `pairs_removed`-i ja
   haldus näitab seda teatena.
3. **Lugemine ei usalda manifesti.** Paar, mille tüve täielikus leheloendis
   (`GET /works/{id}/exemplars` → `page_numbers`, kettalt) ei ole, on paari puudumine.
4. **Kirjutus kontrollib sihtlehte** sama luku all: muudetud `page`, mida teose lehtede
   hulgas ei ole → 409 koos praeguse manifestiga. Muutmata `page`-i ei kontrollita.
5. **Lehestiku asendus** kasutab tüved uuesti, seega eemaldab `clear_all_pairs` kõik
   paarid ENNE sisu asendamist; ebaõnnestumisel asendus katkeb.
6. **Ebaõnnestumine on nähtav:** ühenduskoht neelab koristuse vea, aga kirjutab selle
   `record_server_error`-iga kliendivigade ringi (#133).

Detailid: `docs/superpowers/specs/2026-11-10-eksemplari-leht-design.md`, jaotis „Paarid ja
lehetoimingud".

### 4. Lukustus ja revisjon

Iga manifesti kirjutus ja eksemplari kustutus hoiab `work_lock` → `metadata_lock` (sama
järjekord mis eksemplaride kirjutusteel) ja kontrollib luku all, et eksemplar on olemas.
Üks muudatus = üks commit. `revision` on optimistlik lukk: `PATCH`/`DELETE` vananenud
revisjoniga saab 409 koos praeguse manifestiga. `POST` ainult lisab lõppu.

### 5. ADA import on taastatav protokoll

Failipõhine taustatöö (`_imports/{import_id}/job.json`), leheplaan salvestatakse enne
renderdust, ühel eksemplaril üks aktiivne import. Avaldamine ühe luku all: olemasolu →
failid + manifest koos imporditunnuse järgi → manifesti commit → URL (lukustatud
`update_exemplar`, `git_committed: false` on viga) → `published` + koristus. Iga samm
kontrollib oma tehtust eraldi ja on korratav; serveri stardil jätkab taastaja. Lõpetatuse
tunnus on `imports[import_id]` + commit'itud manifest + `url_done`, mitte pildikirjete
olemasolu. Detailid: spetsi jaotis „Avaldamine on taastatav protokoll".

## Tagajärjed

- `data/.gitignore` peab ignoreerima `_imports/`, `_thumbs/`, `*.pdf`, `*.tif`, `*.tiff`,
  `*.orig.*`, `*.part`, `*.tmp*` (`git_ops.DATA_GITIGNORE_EXTRA`). Muidu commit'iks
  `replace_work_content` (`git add <kaust>`) poolelioleva impordi. Uus repo saab read
  `_init_repo_locked`-ist; olemasoleva repo faili täiendab serveri start
  (`ensure_data_gitignore`, autor „Automaatne", üks commit), sest unustatud käsitsi samm
  oleks tagasivõtmatu.
- Eksemplari kustutus eemaldab `images.json`-i gitist kohe järgmise commit'iga sama luku
  all (`bulk_update_works` ei oska samas commit'is eemaldada). Gitist väljas olevad
  failid lähevad `._trash/{work_id}/_exemplars/{eid}/`-i.
- `admin_work_delete` ja `restore_deleted_work` kannavad `_exemplars/` gitist väljas
  olevad failid prügikasti ja tagasi.
- Uus lehtede loendi lugeja ei tohi kausta rekursiivselt läbida.
- Vaatlused (`locus`, IPH, vesimärgivormid) viitavad järgmises etapis `image_id`-dele.
