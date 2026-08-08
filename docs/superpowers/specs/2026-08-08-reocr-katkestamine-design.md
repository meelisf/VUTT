# Re-OCR töö katkestamine — disainidokument

**Kuupäev:** 2026-08-08
**Issue:** #217
**Staatus:** kinnitatud (ülevaatuse parandustega), ootab plaani

## Probleem

Käimasolevat re-OCR tööd ei saa katkestada — ei UI-st ega API-st. `server/routers/reocr.py`
pakub käivitamist, staatust, logi, tulemuste rakendamist ja äraviskamist, aga **mitte
katkestamist**. Ainus katkestatav OCR-töö on upload-viisardi oma
(`DELETE /admin/upload/{upload_id}` → `cancel_upload()`).

Valesti käivitatud töö puhul ei ole muud võimalust kui oodata `REOCR_ABSOLUTE_TIMEOUT` = 12 h
täitumist. Vahepeal pärib poll-loop iga 10 s SFTP-ga `.txt`-faile, mida ei tule, ja
`get_active_batch_for_work()` annab uuele batch'ile samal teosel **409** — teos on 12 tunniks
lukus.

**Intsident 2026-08-07:** batch `h72qr9` (teos `aekis7`, 25 lk) käivitati käsikirja-mudelil
topeltlehtedega. Katkestamiseks kustutati pildid käsitsi OCR-serverist. LOSSi pool peatus
korrektselt, VUTT-i pool jäi rippuma (9 lehte `ready`, 16 `processing`). Puhastus nõudis
backendi seiskamist, käsitsi `state/reocr_active.json` muutmist ja restarti — ehk tootmise
katkestust.

## Otsus

`DELETE /admin/reocr/{job_id}` — üks endpoint nii üksik- kui batch-tööle.

**Semantika: tööd ei olnud.** Pärast katkestamist peab seis olema võimalikult lähedal
seisule enne selle töö käivitamist. Teose tegelikku teksti ei puudutata kunagi — re-OCR
kirjutab ainult `.ocr` vahefaile, kuni admin need eraldi rakendab.

### Miks selle töö osalised tulemused kustutatakse

Kaalutud alternatiiv oli osalised `.ocr` failid alles jätta. Lükati tagasi:

OCR jookseb **taustal** — katkestamine ei ole aktiivsest ootamisest pääsemine ega võida
midagi peale suvalise algusprefiksi valmis lehtedest. Kui soovitakse väiksemat mahtu, tuleb
kohe vähem lehti OCR-i saata ja hiljem juurde lisada. Poolikute tulemuste alleshoidmine
soodustaks „katkestan ja vaatan, mis kätte jäi" mustrit, mis annab juhusliku lehekomplekti
ilma selge tähenduseta.

## `.ocr` failide omand — kelle tulemus on kelle

See on disaini kõige libedam koht ja esimene versioon sisaldas siin **andmekao viga**.

Vale eeldus oli: „sama lehe uus töö kirjutas vana `.ocr` niikuinii üle, lisakadu ei teki".
Vastunäide:

1. lehel 17 on varasemast tööst `17.ocr`, mis on veel rakendamata;
2. käivitatakse uus batch lehtedele 1–25;
3. uus töö jõuab valmis teha ainult lehed 1–8;
4. admin katkestab;
5. `load_batch_mapping(job_id).pages` annab **plaanitud** lehed 1–25;
6. kustutamine hävitaks `17.ocr`, mida katkestatud töö EI PUUTUNUD.

Plaanitud lehtede nimekiri ei ole omandi tõend.

### Otsus: tulemuse omand on jälgitav ja ülekirjutamine varundatakse

**1. `produced_pages`** — töö kirje peab loendit lehtedest, mille `.ocr` see töö **päriselt
kirjutas** (lisatakse siis, kui `_write_ocr_file` õnnestub, mitte tööd käivitades).
Katkestamine kustutab ainult need.

**2. Ülekirjutamise varundus** — kui `_write_ocr_file` leiab olemasoleva `.ocr` faili, siis
see nihutatakse enne ülekirjutamist kohta

```
state/reocr_backups/{job_id}/{stem}.ocr
```

- katkestamine **taastab** varukoopiad tagasi teose kausta;
- töö normaalne lõpp (`done`), `apply` või `discard` kustutab varukoopiad;
- asukoht on `state/`, mitte teose kaust: `data/.gitignore` ignoreerib `*.ocr`, aga
  `*.ocr.bak.{job_id}` EI vastaks sellele mustrile ja ilmuks `git status`-isse. Varukoopiad
  on runtime-andmed ja kuuluvad `state/` alla (CLAUDE.md).

Need kaks koos annavad „tööd ei olnud" semantika päriselt: puutumata lehed jäävad
puutumata, ülekirjutatud lehed saavad oma eelmise sisu tagasi.

### Tulevikusuund (mitte selles projektis)

Arhitektuuriliselt puhtam oleks **töö-põhine tulemuste ala**:

```
state/reocr/{job_id}/{stem}.ocr     → apply promoveerib lehe tekstiks
```

Siis oleks katkestamine triviaalne (`rm -rf` töö kaust) ja omandiküsimust ei tekiks üldse.
Sellest loobuti siin, sest see muudaks ka ülevaatuse voogu: praegu muutuvad lehed
ülevaadatavaks **saabumise järjekorras** (`ocr_ready` stem'id), promoveerimismudel näitaks
tulemusi alles töö lõpus. See on omaette projekt, mitte #217 kõrvalsaadus.

## LOSSi töö peatamine

**Per-töö peatamise mehhanismi OCR-serveris EI OLE.** Ainus tõeline peatussignaal on
SIGTERM/SIGINT → `shutdown_requested`, mida `main_loop` kontrollib batchide vahel — see
peatab **terve teenuse**, sh teiste tööd. Katkestamiseks kõlbmatu.

**Piltide kustutamine ON tegelik peatamismehhanism** ja see peatab ka GPU-töö.
`process_batch` avab pildid enne mudeli kutsumist:

```python
for img_path, txt_path in batch_items:
    try:
        img = PILImage.open(img_path).convert("RGB")
        ...
    except Exception as e:
        logger.error(f"Viga pildi avamisel {img_path}: {e}")
if not images_pil:
    return          # mudelit EI kutsuta
```

Kui ükski batchi pilt ei avane, väljutakse enne mudelit. Kustutamise järel maksab iga
järelejäänud batch neli ebaõnnestunud `open()` kutset — mikrosekundid, GPU-d ei puudutata.
Just seetõttu jõudis 2026-08-07 intsidendi töö kiiresti lõpuni, mitte ei jahvatanud 25 lehte
inferentsi.

Kõva piir on `BATCH_SIZE = 4`. `main_loop` teeb `rglob` **üks kord tsükli kohta** ja
itereerib seejärel selle külmutatud nimekirja üle. Kustutamine ei eemalda juba planeeritud
kirjeid, vaid teeb nad avanematuks. Seega jõuab pärast katkestamist lõpuni **kuni üks
lennusolev batch ehk 4 lehte** — need pildid olid mällu loetud enne kustutamist. Intsident
kinnitab: lk 9 oli batchis 9–12 ja jooksis lõpuni.

**OCR-serverit ei muudeta** (ADR 0017 põhimõte). Kaalutud ja tagasi lükatud: töö-põhine
katkestusmärgend (`.cancelled` fail, mida valvur kontrolliks) annaks 0-lehelise peatumise,
aga nõuaks teist deploy-teed marginaalse võidu eest.

### Sünkroniseerimismudel — mida VUTT LOSSist teab

- **VUTT → LOSS** on ühesuunaline ja failipõhine. Katkestamine = piltide eemaldamine;
  valvuri järgmine `rglob` (iga 5 s) ei leia enam midagi.
- **LOSS → VUTT staatust ei ole.** VUTT tuletab edenemist AINULT `.txt` failide pollimisest.
  Ta ei suuda eristada „pole veel alustanud" olukorrast „on parajasti batchi keskel".
- **Jääk koristab ennast ise:** lennusoleva batchi `.txt` üritatakse kirjutada kataloogi,
  mille me eemaldasime — kirjutamine ebaõnnestub ja logitakse LOSSis. VUTT-i see ei jõua,
  sest pollimine on lõpetatud.

VUTT ei oota katkestamisel LOSSilt kinnitust. Kinnitust ei ole kellelt küsida.

## Olekumasin: `cancelling` on vaheolek

Katkestamine ei ole üks omistamine, vaid **kaheastmeline üleminek**:

```
uploading | processing | slow  →  cancelling  →  cancelled
```

`cancelling` ei pea UI-s nähtav olema; ta on olemas selleks, et vastata küsimusele „kes
võitis".

### Terminalüleminekud on vastastikku välistavad

Ilma selleta on võistlus:

```
DELETE                              poller
------                              ------
kontrollib: processing
                                    leiab viimase .txt
                                    kirjutab .ocr
                                    märgib done
märgib cancelled
kustutab .ocr
```

Nõue: `processing → done` ja `processing → cancelling` on **CAS-üleminekud sama luku all**
(`_reocr_jobs_lock` / `_reocr_batch_jobs_lock`). Kumbki õnnestub ainult siis, kui olek on
endiselt see, mida ta eeldas. Kui katkestamine võitis, EI TOHI ükski worker pärast seda
minna `ready`/`done`/`error` olekusse ega kirjutada uut `.ocr` tulemust.

## Workerite vaigistamine enne koristust

Koostööline lipp üksi EI OLE piisav: lipu seadmine ei tähenda, et worker on lõpetanud.
`sftp.put()` võib olla parajasti pooleli ja lõpetada kirjutamise pärast kaugkoristust —
täpselt see olukord, mida see disain vältida tahab.

Kaks workerit vajavad **erinevat** mehhanismi, sest nende elutsükkel on erinev:

| Worker | Kuju | Vaigistamine |
|---|---|---|
| Üleslaadimine (`reocr-batch-{job_id}`, `reocr-{job_id}`) | **töö-põhine lõim** | `threading.Event` + endpoint teeb `join(timeout)` enne koristust |
| Pollimine (`reocr-poll`, `reocr-batch-poll`) | **jagatud singleton-lõim**, üks iteratsioon iga 10 s kõigi tööde üle | EI SAA join'ida — see peataks kõik teised tööd. Selle asemel: `.ocr` kirjutamine ja olekuüleminek toimuvad **luku all koos oleku ülekontrolliga**; kui töö on `cancelling`, visatakse allalaaditud tekst ära |

Poll-lõime osas teeb CAS seega topelttööd: ta ei lahenda ainult „kes võitis", vaid on ka
ainus viis, kuidas jagatud loop saab olla katkestamise suhtes ohutu.

Protokoll tervikuna:

```
CAS: aktiivne → cancelling  (persisteeritud)
        ↓
üleslaadimislõim näeb Event'i ja väljub  →  join(timeout)
poll-lõim ei kirjuta enam midagi (CAS blokeerib)
        ↓
selle töö jaoks ei ole ühtki kirjutajat — ei lokaalselt ega kaugserveris
        ↓
koristus: kaugserver → .ocr (produced_pages) → varukoopiate taastamine
        ↓
CAS: cancelling → cancelled, registrist eemaldamine, logikirje
```

Kui `join` aegub, katkestamine EI JÄTKA kaugkoristusega: logitakse viga ja töö jääb
`cancelling` olekusse, kust taasteloogika (allpool) selle üles korjab. Parem jätta jääk
kaugserverisse kui kirjutada kataloogi, kuhu keegi veel kirjutab.

## Krahhikindlus

`cancelling` **persisteeritakse enne koristust** (`reocr_active.json`). Kui protsess sureb
koristuse ajal, teab stardi-taaste (`_startup_recovery_and_reaper`):

> `cancelling` olekus töö ei ole aktiivne töö. Lõpeta selle koristus best-effort ja kirjuta
> `cancelled`.

Ilma selleta jääks pooleli katkestatud töö pärast restarti taas aktiivseks — täpselt see
probleem, mille vastu kogu see feature tehakse. See muudab katkestamise idempotentseks ja
taastatavaks operatsiooniks.

## API

`DELETE /admin/reocr/{job_id}`, `require_role("admin")`. Endpoint valib registri job_id järgi
(`_reocr_jobs` vs `_reocr_batch_jobs`).

**Invariant: job_id nimeruum on nende kahe registri vahel globaalne.** Mõlemad kasutavad
sama `generate_nanoid()` generaatorit, seega kokkulangevus on teoreetiliselt võimalik. Kui
sama id esineb mõlemas registris, on see invariandi rikkumine — logi viga ja tagasta 409,
ära arva.

| Töö staatus | Vastus |
|---|---|
| `uploading`, `processing`, `slow` | 200, töö katkestatakse |
| `cancelling` | 409 — katkestamine juba käib |
| `done`, `error` | 409 — ei ole aktiivne |
| tundmatu id | 404 |

**Korduv DELETE annab 404**, sest töö on aktiivregistrist eemaldatud. Katkestamine EI OLE
idempotentne HTTP mõttes; see on teadlik valik, sest idempotentsus nõuaks logi-lookup'i
väärtuse eest, mida siin ei ole. Ajalugu elab `reocr_log.json`-is.

### Lokaalne katkestamine ei sõltu kaugserverist

SFTP tõrge logitakse hoiatusena, aga lokaalne katkestamine viiakse **ikka lõpuni**.
Intsident oli täpselt selline: VUTT rippus, LOSS oli juba edasi läinud. Katkestamine, mis
nõuab tervet kaugserverit, ebaõnnestub just siis, kui teda vaja on.

**Mida 200 seega tähendab.** `200 cancelled` garanteerib VUTT-i poole katkestamise:
pollimist ei ole, teose lukk on vaba, tulemust ei rakendata, lokaalne töö on kadunud. Kui
LOSSi koristus ebaõnnestus, võib kaugserveris töö või failijääk **edasi eksisteerida**.
Logikirje ütleb selle välja:

```json
{ "status": "cancelled", "remote_cleanup": "failed" }
```

Nii on hilisem diagnostika võimalik ilma logi ridu kokku otsimata.

## Frontend

- Nupp OCR-tööde paneelis (`src/pages/Review.tsx`, `/admin/ocr/jobs` loend) ja teose
  Manage-vaate batch-ribal
- Kinnitusdialoog, mis ütleb otse, et osalised tulemused visatakse ära
- i18n võtmed **mõlemas keeles** korraga (`fallbackLng` on väljas, ADR 0011)

**Kust `cancelled` pärast värskendust tuleb.** Andmemudel määrab siin vastuse:
`cancelled` on **logi tasandi staatus, mitte elava töö oma** — töö on aktiivregistrist
kadunud.

- **Review** loeb `reocr_log.json`-i ja näitab `cancelled` kirjet ajaloos — püsiv.
- **Manage batch-riba** põhineb aktiivsel tööl. Pärast katkestamist ei ole aktiivset tööd,
  seega riba lihtsalt kaob. Kasutaja tagasiside on **transient toast**, mitte püsiv
  „cancelled" silt.

Nii ei luba UI rohkem, kui andmemudel kannab.

## Testid

| Test | Mida kaitseb |
|---|---|
| Katkestamine eemaldab töö `reocr_active.json`-ist | Teos ei jää 12 h lukku |
| Ainult `produced_pages` `.ocr` failid kustutatakse | **Omand** — plaanitud ≠ toodetud |
| **Varasem `.ocr` sihtlehel säilib, kui katkestatud töö seda ei tootnud** | Ülalkirjeldatud andmekao viga |
| Ülekirjutatud `.ocr` taastatakse varukoopiast | „Tööd ei olnud" semantika täies ulatuses |
| Teiste teoste `.ocr` failid jäävad puutumata | Kustutamise ulatus tuleb töö kirjest, mitte kaustast |
| **Katkestamine samal ajal, kui poller saab viimase tulemuse** | `done`/`cancelled` võistlus — täpselt üks terminalolek võidab |
| **Poller ei kirjuta `.ocr` pärast `cancelling` algust** | Ghost-tulemus pärast koristust |
| **Üleslaadimislõim ei kirjuta kaugfaili pärast kaugkoristust** | Koristuse/üleslaadimise võistlus |
| `cancelling` töö lõpetatakse pärast restarti | Krahhikindlus; teos ei jää lukku |
| SFTP tõrge → lokaalne katkestamine ikka õnnestub | Intsidendi kuju |
| `done` → 409, tundmatu → 404 | Ei kustuta valmis töö tulemusi |
| Töö, mille kaugfailid on juba kadunud, on katkestatav | Intsidendi kuju |

## Riskid

| Risk | Leevendus |
|---|---|
| Kuni 4 lehte jõuab pärast katkestamist lõpuni | Teadlik ja dokumenteeritud; nende `.txt` kaob koos kataloogiga |
| Katkestamine kustutab kehtiva töö tulemused | Kinnitusdialoog ütleb selle otse välja; `done` tööd ei ole katkestatavad |
| Kaugkoristus ebaõnnestub → jääk LOSSis | `200` semantika on dokumenteeritud; logis `remote_cleanup: failed` |
| `join` aegub → koristust ei tehta | Töö jääb `cancelling`, taaste korjab üles; jääk on parem kui võistlus |
| Varukoopiad kogunevad | Kustutatakse `done`/`apply`/`discard` juures; taaste koristab orvud |

## Järgnev projekt (eraldi spekk)

**Upload'i „vale mudel" taastetee.** Kasutaja saadab käsikirjalise teksti trükimudelile ja
tahab uuesti alustada ilma poolitamist kordamata. Tänane `cancel_upload()` on hävitav
(`rmtree` + kaug-`rm -rf`), seega poolitusplaan kaob koos kõige muuga.

Nõuded, mis on juba kokku lepitud:

- **Poolitusplaan säilib.** Plaan on JSON `uploads/{id}/state.json`-is ja lähtefail püsib
  VUTT-i poolel kuni impordini (`cleanup_prepress_artifacts` kutsutakse ainult
  `import_work.py`-st). Uuesti maksab ainult masinaaeg (300 DPI + SFTP), mitte inimtöö.
- **Metaandmeid peab saama muuta enne uut jooksu.** See on sisuline nõue, mitte mugavus:
  mudel valitakse sammus 1 ja küpsetatakse `remote_staging_path = AUTO-OCR/{ocr_model}/{id}`
  sisse (`upload_ops.py:214`). Ainult plaani säilitamine ei lahendaks vale mudeli juhtumit.
- Osalised tulemused kustutatakse (vale mudeli oma ei ole kehtiv töötulemus).
- `apply` ühekordne CAS (`awaiting_split → applying`, ADR 0017) tuleb teadlikult uuesti avada.
