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
ainult kõrvutamise mugavus; lehetoimingutega seda ei sünkroniseerita.

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
  `_init_repo_locked`-ist; serveri olemasolev fail uuendatakse käsitsi enne deploy'd.
- Eksemplari kustutus eemaldab `images.json`-i gitist kohe järgmise commit'iga sama luku
  all (`bulk_update_works` ei oska samas commit'is eemaldada). Gitist väljas olevad
  failid lähevad `._trash/{work_id}/_exemplars/{eid}/`-i.
- `admin_work_delete` ja `restore_deleted_work` kannavad `_exemplars/` gitist väljas
  olevad failid prügikasti ja tagasi.
- Uus lehtede loendi lugeja ei tohi kausta rekursiivselt läbida.
- Vaatlused (`locus`, IPH, vesimärgivormid) viitavad järgmises etapis `image_id`-dele.
