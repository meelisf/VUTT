# Upload'i OCR-i katkestamine — disainidokument

**Kuupäev:** 2026-08-08
**Staatus:** kinnitatud, ootab plaani
**Eelnev:** `2026-08-08-reocr-katkestamine-design.md` (A-osa, #217) · ADR 0017, ADR 0018

## Probleem

Kasutaja valib sammus 1 materjali tüübi, mis määrab OCR-mudeli (`AUTO-OCR/hand` vs
`AUTO-OCR/print`), teeb sammus 3 poolitamise ja vajutab „Edasi". Alles sammus 4 selgub,
et käsikirjaline materjal läks trükimudelile.

Tänane ainus väljapääs on `DELETE /admin/upload/{id}` → `cancel_upload()`, mis on
**hävitav**: `rmtree` lokaalsele kaustale ja `rm -rf` kaugserverisse. Koos kõige muuga kaob
**poolitusplaan** — lehekülgede kaupa tehtud käsitsi otsused, mis 300-leheliselt teoselt on
tundide töö. Kasutaja peab alustama nullist, sest valis rippmenüüst vale rea.

## Otsus

Uus tee: **katkesta OCR ja tule tagasi poolitamise juurde.** Plaan säilib, mudelit saab
vahetada, seejärel saadetakse uuesti.

Hävitav `cancel_upload()` jääb alles — „loobun sellest üleslaadimisest tervikuna" on
omaette kavatsus. Kaks nuppu, kaks tähendust; sildid ei tohi olla segiaetavad.

### Miks ainult mudel, mitte kõik metaandmed

Kaalutud: terve `UploadStepMeta` vormi taaskasutus sammus 3. Lükati tagasi.

Ainus väli, mis **mõjutab jooksu ennast**, on tüüp — see valib mudeli ja kaugtee. Pealkirja,
aastat, kollektsiooni jm saab pärast importi teoselt muuta, nagu iga teise teose puhul.
**Slug ei pea metaandmetega täpselt vastavuses olema** — see genereeritakse algsest
pealkirjast üks kord ja jääb püsivaks ka siis, kui pealkiri hiljem muutub. Seega ei võida
täisvormi lisamine sammu 3 midagi, mida hilisem tavaline redigeerimine ei anna.

## Mida katkestamine puudutab — ja mida mitte

Upload'i katkestamine on **oluliselt lihtsam kui re-OCR-i oma** (A-osa), sest teost veel ei
ole olemas:

| | Re-OCR (A) | Upload (B) |
|---|---|---|
| Tulemus jõuab kohale | `.ocr` failid teose kausta poll-ajal | tekst laaditakse alles **impordil** (`import_work.py:153`) |
| Omandiküsimus | vajas `produced_pages` + varundust | **puudub** — miski pole teosesse jõudnud |
| „Osalised tulemused" | kehtivad ootel tulemused | kaugserveri `.txt`, mida keegi pole lugenud |

Pollimine laeb alla ainult **pisipilte**. Seega ei ole B-s midagi omada, varundada ega
taastada — see disain ei vaja `produced_pages` ekvivalenti.

## Backend: `POST /admin/upload/{upload_id}/cancel-ocr`

`require_role("admin")`. Sync `def` — kogu töö on blokeeriv I/O (ADR 0002).

| Staatus | Vastus |
|---|---|
| `applying`, `processing`, `reviewing`, `error` | 200 |
| `imported` | 409 — teos on olemas, see ei ole enam upload |
| `awaiting_split`, `prepping`, `pending`, `uploading` | 409 — OCR ei käi |
| tundmatu id | 404 |

### Protokoll — sama nagu A-s, sest sama võistlus

Prepress `apply` jookseb taustalõimes (`prepress-apply-{upload_id}`): 300 DPI renderdus +
SFTP. Katkestamine `applying` ajal on **täpselt see hetk**, mil vale mudel pika teose puhul
märgatakse — ja täpselt see hetk, mil pooleliolev üleslaadimine kirjutaks pildid tagasi
kataloogi, mille me kustutame.

```
CAS: applying|processing|reviewing|error → cancelling   (persisteeritud)
        ↓
apply-lõim näeb Event'i ja väljub  →  join(timeout)
poll ei puutu `cancelling` upload'i (varajane väljumine)
        ↓
kaugkoristus: _ssh_rm_rf(remote_staging_path)
        ↓
lokaalne koristus + CAS: cancelling → awaiting_split
```

`join` aegumisel koristust EI TEHTA: upload jääb `cancelling` olekusse ja tagastatakse 503.
Jääk kaugserveris on parem kui võistlus koristusega.

**`thumbs.poll_and_sync_thumbs` peab `cancelling` puhul varakult väljuma**, nagu ta juba
teeb `PREPRESS_IDLE_STATUSES` jaoks. Muidu SFTP-b poller kataloogi, mida parajasti
kustutatakse.

### Mis kaob ja mis jääb

**Kaob:** kaugserveri staging-kataloog (`_ssh_rm_rf`, olemas), lokaalne `thumbs/`,
`files: []`, `expected_pages: None`, `prepress.applied_done: 0`.

**Jääb:** `source.pdf` / `source/`, `preview/`, kogu `prepress` plaan, `meta`.

Lõppolek on `awaiting_split` — **täpselt see, kus upload oli enne „Edasi" vajutamist.**
Olemasolev `try_begin_applying` CAS (`APPLY_START_STATUSES = ("awaiting_split", "error")`)
aktsepteerib seda muutmata; uut apply-teed ei ole vaja.

## Backend: `POST /admin/upload/{upload_id}/model`

Keha: `{"material_type": "hand" | "print"}`. Uuendab `meta.type` ja arvutab ümber
`remote_staging_path` ning `remote_work_path`.

**Liigub ainult mudeli-segment.** Tee on `AUTO-OCR/{model}/{upload_id}/{slug}` ja slug on
püsiv identifikaator, mitte tuletis — seega ei muutu ta pealkirja muutmisest ega siin.

Lubatud **ainult `awaiting_split`** olekus; muidu 409. Nii ei saa teed nihkuda töötava
ülekande alt.

### Kinni jäänud `cancelling` normaliseeritakse

Kui protsess sureb koristuse ajal (või `join` aegus ja keegi ei proovi uuesti), jääks upload
`cancelling` olekusse, kus ta ei ole ei katkestatud ega töös.

Olemasolev taustasünk-lõim (`upload-sync`, iga 60 s) normaliseerib sellise upload'i
**`awaiting_split`**-iks, kui `cancelling` on kestnud üle `CANCEL_STUCK_TIMEOUT = 300 s`.
Ajapiir on vajalik, sest käimasolev katkestamine ON `cancelling` olekus — piirita
normaliseerimine võistleks päris katkestamisega.

`awaiting_split` on ohutu vaikeseis: plaan ja lähtefail on alles, kasutaja saab uuesti
saata. Kaugserverisse võib jääda koristamata kataloog — see logitakse hoiatusena ja järgmine
`apply` kirjutab samad failid niikuinii üle.

## Frontend

- **Samm 3:** mudelivalik (Trükis / Käsikiri) koos reaga, mis ütleb, millisesse OCR-mudelisse
  see saadab. Muutmine kutsub `/model` endpointi.
- **Samm 4:** nupp „Katkesta OCR ja muuda seadeid" → `/cancel-ocr`, kinnitusdialoog, mis
  ütleb otse, et seni valminud OCR-tulemused visatakse ära, aga **poolitus säilib**.
- Olemasolev hävitav „Katkesta" jääb, sildid selgelt eristatavad.
- i18n **mõlemas keeles** (`fallbackLng` väljas, ADR 0011).

## Testid

| Test | Mida kaitseb |
|---|---|
| Katkestamine igast lubatud staatusest → `awaiting_split` | Põhivoog |
| Plaan ja lähtefail säilivad; `thumbs/`, `files`, `expected_pages` puhastatakse | „Plaan säilib" on kogu mõte |
| Apply-lõim peatub ENNE kaugkoristust | Võistlus, mis A-s samuti oli |
| `join` aegub → 503, upload jääb `cancelling`, koristust ei tehta | Jääk > võistlus |
| Poller ei puutu `cancelling` upload'i | Ghost-SFTP kustutatavasse kataloogi |
| Üle 300 s `cancelling` normaliseeritakse `awaiting_split`-iks | Kinni jäänud katkestamine ei blokeeri upload'i |
| Alla 300 s `cancelling` jäetakse rahule | Normaliseerimine ei tohi võistelda käimasoleva katkestamisega |
| `imported` → 409 | Ei lõhu imporditud teost |
| Mudeli vahetus kirjutab MÕLEMAD teed ümber ja **säilitab slug'i** | Slug on püsiv identifikaator |
| Mudeli vahetus `applying` ajal → 409 | Tee ei nihku ülekande alt |
| Terve ring: apply → cancel → mudeli vahetus → apply | Pildid maandavad UUE mudeli tee alla |

## Riskid

| Risk | Leevendus |
|---|---|
| Kasutaja segab kaks „Katkesta" nuppu | Selged sildid + kinnitusdialoog, mis ütleb, mis säilib ja mis kaob |
| Vana mudeli kaugkataloog jääb alles | `_ssh_rm_rf` enne teede ümberarvutust; koristuse tõrge logitakse |
| Kuni 4 lehte jõuab LOSSis lõpuni | Sama teadlik piir nagu ADR 0018-s; nende `.txt` kaob koos kataloogiga |
| `cancelling` upload jääb rippuma (protsess suri) | Taustasünk normaliseerib, vt allpool |
