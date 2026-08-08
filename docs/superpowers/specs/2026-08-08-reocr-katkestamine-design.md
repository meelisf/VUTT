# Re-OCR töö katkestamine — disainidokument

**Kuupäev:** 2026-08-08
**Issue:** #217
**Staatus:** kinnitatud, ootab plaani

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

**Semantika: tööd ei olnud.** Katkestamine eemaldab lokaalse olekutega, koristab OCR-serveri,
kustutab **selle töö** `.ocr` vahefailid ja kirjutab `reocr_log.json`-i kirje staatusega
`cancelled`. Teose tegelikku teksti ei puudutata kunagi — re-OCR kirjutab ainult `.ocr`
vahefaile, kuni admin need eraldi rakendab.

### Miks osalised tulemused kustutatakse

Kaalutud alternatiiv oli osalised `.ocr` failid alles jätta (olemasolev ülevaatuse voog
oskaks neid juba käsitleda). Lükati tagasi:

OCR jookseb **taustal** — katkestamine ei ole aktiivsest ootamisest pääsemine ega võida
midagi peale suvalise algusprefiksi valmis lehtedest. Kui soovitakse väiksemat mahtu, tuleb
kohe vähem lehti OCR-i saata ja hiljem juurde lisada. Poolikute tulemuste alleshoidmine
soodustaks „katkestan ja vaatan, mis kätte jäi" mustrit, mis annab juhusliku lehekomplekti
ilma selge tähenduseta.

Seetõttu: katkestatud töö ei jäta jälge peale logikirje.

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

**Kõva piir: `BATCH_SIZE = 4`.** `main_loop` teeb `rglob` **üks kord tsükli kohta** ja
itereerib seejärel selle külmutatud nimekirja üle. Kustutamine ei eemalda juba planeeritud
kirjeid, vaid teeb nad avanematuks. Seega jõuab pärast katkestamist lõpuni **kuni üks
lennusolev batch ehk 4 lehte** — need pildid olid mällu loetud enne kustutamist. Intsident
kinnitab: lk 9 oli batchis 9–12 ja jooksis lõpuni.

**OCR-serverit ei muudeta** (ADR 0017 põhimõte). Kaalutud ja tagasi lükatud: töö-põhine
katkestusmärgend (`.cancelled` fail, mida valvur kontrolliks) annaks 0-lehelise peatumise,
aga nõuaks teist deploy-teed marginaalse võidu eest.

### Sünkroniseerimismudel — mida VUTT LOSSist teab

Aus kirjeldus, sest see määrab, mida katkestamine lubada saab:

- **VUTT → LOSS** on ühesuunaline ja failipõhine. Katkestamine = piltide eemaldamine;
  valvuri järgmine `rglob` (iga 5 s) ei leia enam midagi.
- **LOSS → VUTT staatust ei ole.** VUTT tuletab edenemist AINULT `.txt` failide pollimisest.
  Ta ei suuda eristada „pole veel alustanud" olukorrast „on parajasti batchi keskel".
- **Jääk koristab ennast ise:** lennusoleva batchi `.txt` üritatakse kirjutada kataloogi,
  mille me eemaldasime — kirjutamine ebaõnnestub ja logitakse LOSSis. VUTT-i see ei jõua,
  sest pollimine on lõpetatud.

VUTT ei oota katkestamisel LOSSilt kinnitust. Kinnitust ei ole kellelt küsida.

## API

`DELETE /admin/reocr/{job_id}`, `require_role("admin")`. Endpoint valib registri job_id järgi
(`_reocr_jobs` vs `_reocr_batch_jobs`).

| Töö staatus | Vastus |
|---|---|
| `uploading`, `processing`, `slow` | 200, töö katkestatakse |
| `done`, `error` | 409 — ei ole aktiivne |
| tundmatu id | 404 |

### Tegevuste järjekord ja miks just see

1. Märgi töö lokaalselt `cancelled` (koostööline lipp)
2. Lase üleslaadimislõimel see märgata ja väljuda
3. Koristada OCR-server (pildid + `.txt`, seejärel `rmdir` work ja staging)
4. Kustuta selle töö `.ocr` failid. **Lehtede nimekiri tuleb töö enda kirjest**, mitte
   kausta skaneerimisest: batch'il `reocr_state.load_batch_mapping(job_id)` `pages`, üksiktööl
   job-kirje `remote_img`/`remote_txt`. Kaustapõhine kustutamine hävitaks teiste tööde
   ootel tulemused.
5. Eemalda `reocr_active.json` kirje ja `reocr_state.remove_batch_mapping(job_id)`
6. Kirjuta `reocr_log.json`-i kirje `cancelled`

Järjekord ei ole vaba: kui koristada enne lõime peatamist, kirjutab pooleliolev
`for entry in page_entries` tsükkel pildid tagasi kataloogi, mille just eemaldasime.

**Issue's kirjeldatud lahendus ei kata seda punkti** — „märgi töö lõpetatuks → poll lõpetab"
peatab poll-lõime, aga mitte üleslaadimislõime. Vaja on koostöölist lippu, mida
üleslaadimistsükkel lehtede vahel kontrollib.

### Lokaalne katkestamine ei sõltu kaugserverist

SFTP tõrge logitakse hoiatusena, aga lokaalne katkestamine viiakse **ikka lõpuni**.
Intsident oli täpselt selline: VUTT rippus, LOSS oli juba edasi läinud. Katkestamine, mis
nõuab tervet kaugserverit, ebaõnnestub just siis, kui teda vaja on.

## Frontend

- Nupp OCR-tööde paneelis (`src/pages/Review.tsx`, `/admin/ocr/jobs` loend) ja teose
  Manage-vaate batch-ribal
- Kinnitusdialoog, mis ütleb otse, et osalised tulemused visatakse ära
- `cancelled` staatus vajab kuvamist (Review + Manage) ja i18n võtmeid **mõlemas keeles**
  korraga (`fallbackLng` on väljas, ADR 0011)

## Testid

| Test | Mida kaitseb |
|---|---|
| Katkestamine eemaldab töö `reocr_active.json`-ist | Teos ei jää 12 h lukku |
| Selle töö `.ocr` failid kustutatakse | „Tööd ei olnud" semantika |
| **Teiste teoste `.ocr` failid jäävad puutumata** | Kustutamise ulatus tuleb batch-mapping'ust, mitte kaustast |
| Üleslaadimislõim peatub partii keskel | Koostööline lipp toimib |
| SFTP tõrge → lokaalne katkestamine ikka õnnestub | Intsidendi kuju |
| `done` → 409 | Ei kustuta valmis töö tulemusi |
| Töö, mille kaugfailid on juba kadunud, on katkestatav | Intsidendi kuju |

## Riskid

| Risk | Leevendus |
|---|---|
| Kuni 4 lehte jõuab pärast katkestamist lõpuni | Teadlik ja dokumenteeritud; nende `.txt` kaob koos kataloogiga |
| Katkestamine kustutab kehtiva töö tulemused | Kinnitusdialoog ütleb selle otse välja; `done` tööd ei ole katkestatavad |
| Kustutamine haarab kaasa varasema re-OCR ootel tulemuse | Sama lehe uus töö kirjutas vana `.ocr` niikuinii üle — lisakadu ei teki |
| Lennusolev batch kirjutab `.txt` kustutatud kataloogi | Kirjutamine ebaõnnestub LOSSis, VUTT ei polli enam |

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
