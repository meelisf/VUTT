# Batch re-OCR manage-lehel + lehe transkriptsiooni-ülevaade

**Kuupäev:** 2026-06-21
**Staatus:** Disain kinnitatud, ootab implementatsiooniplaani

## Probleem

Kui admin laeb manage-lehel sisse uusi lehekülgi, ei saa need kohe transkriptsiooni
(see on OK ja ootuspärane). Aga praegu, et neile transkriptsioon teha, peab admin iga
lehe **ükshaaval** läbi käima: avab Workspace TextEditori ja vajutab "tee uus
transkriptsioon". Kaks probleemi:

1. **Tüütu** — palju käsitsi navigeerimist ja klikke.
2. **Aeglane** — OCR-mudelil on `BATCH_SIZE=3` (kolm lehte korraga GPU-l), aga
   järjest-ükshaaval tehes on korraga puus alati ainult 1 pilt → batch suurus 1.
   Batchi ei kasutata.

Lisaks: manage-lehel **puudub ülevaade**, millistel lehtedel on tekst tehtud ja
millistel mitte.

## Olemasolev arhitektuur (kontekst)

### OCR-teenus (`loss/kataloogi-jalgimine-ja-ocr.py`)

Eraldi masinas jooksev systemd-teenus (`ocr-service`), Qwen3.5-9B peenhäälestatud mudel.
**Kriitiline detail disaini jaoks:**

- Skannib **kogu** `AUTO-OCR/{print|hand}` puud rekursiivselt (`rglob`).
- Kogub KÕIK pildid, millel pole kõrval `.txt` faili.
- Töötleb neid `BATCH_SIZE=3` kaupa — **sõltumata sellest, mis job-kaustas nad on**
  (`main_loop` → `tasks_by_type` → `process_batch`, read 380–407).
- `print` ja `hand` on eraldi alamkaustad ja eraldi mudelid; töödeldakse tüüp-tüübi
  kaupa (minimeerib mudeli vahetusi).

**Järeldus:** batch-kiirusvõit tekib **automaatselt** niipea, kui mitu sama-tüüpi pilti
on korraga puus. Vaja on lihtsalt hulgi-käivitajat, mis paneb N pilti korraga puusse.

### Praegune per-lehe re-OCR

- Frontend: `src/components/editor/useReOcr.ts` — Workspace TextEditori sees, admin-only.
- Endpoint: `POST /admin/work/{id}/reocr-page` (`server/main.py:1473`).
- Backend: `server/reocr_ops.py` — `start_reocr_job()` laeb **ühe** pildi SFTP kaudu
  kausta `AUTO-OCR/{material_type}/{job_id}/{slug}/{slug}_pg_001.jpg`. Taustal
  `_reocr_poll_loop` (daemon-thread, iga 10s) tõmbab valmis `.txt`-d alla.
- Tulemus → kirjutatakse **`.ocr`** failina lehe kausta (`{stem}.ocr`, püsiv,
  elab serveri restardi üle) JA hoitakse mälu-job-registris.
- `GET /admin/work/{id}/page-ocr?filename=` tagastab `.ocr` sisu; `DELETE` kustutab.
- Workspace: `useReOcr` tuvastab mountimisel `.ocr` faili → näitab "rakenda" nuppu;
  rakendamine asendab editori teksti + kustutab `.ocr`.
- Globaalsed konstandid: `REOCR_MAX_CONCURRENT=20`, `REOCR_PROCESSING_TIMEOUT=1800`.
- Admin-ülevaate backend juba olemas: `list_reocr_jobs()`, `get_reocr_log()`.

### Manage-leht (`src/pages/WorkManage.tsx`, 1050 rida)

- Laeb lehed: `GET /admin/work/{id}/pages` (`main.py:411`).
- `PageInfo` sisaldab **juba** `has_text: boolean` (`main.py:446`: `.txt` olemas ja
  suurus > 0) ja `status` (Toores/Valmis/Kontrollitud).
- Olemasolev hulgivaliku-infrastruktuur: `selectedFiles: Set<string>` + valikuriba
  ("Liiguta" / bulk-kustutus).
- `PageCard.tsx` (`src/pages/manage/`) saab `status`, aga **EI saa** `has_text`.
  Kuvab ainult staatuse-värvi lehenumbri taustal.

## Disain

Viis osa: (A) staatuse-ülevaade UI-s, (B) batch-käivitaja, (C) batch job-arhitektuur,
(D) per-page staatuse poll + progress, (E) skoobist väljas.

**Kolm sõltumatut mõistet** (kogu disain hoiab need lahus — vt eriti A ja D):
1. **`has_text`** — lehe päris `.txt` on olemas (transkriptsioon rakendatud).
2. **`.ocr` ootel** — uus OCR-tulemus on staging'us ülevaatamiseks valmis, AGA pole
   veel rakendatud. **Sõltumatu `has_text`-st** — leht võib olla korraga `has_text=true`
   JA `.ocr` ootel (re-OCR olemasoleva teksti ümbertegemiseks).
3. **OCR töötab** — batch-job tegeleb selle lehega (uploading/processing).

UI ei tohi neid kokku sulatada. Eriti: roheline märk EI tähenda "leht on korras",
vaid **"OCR valmis ülevaatamiseks"** (vt D sõnastust).

### A. Lehe staatuse-ülevaade (eeltingimus, iseseisev väärtus)

`PageCard` saab uue `has_text` propi ja selge visuaalse markeri igale pisipildile:

- **Tekstita** (`has_text === false`) — nähtav märk (nt amber täpp/silt üleval
  paremal), et vahelelaaditud lehed paistaksid kohe välja.
- **Tekst olemas** — olemasolev staatuse-värviloogika (Toores/Valmis/Kontrollitud)
  jääb muutmata.
- **`.ocr` ootel märk on eraldi** (vt D) — leht võib näidata korraga "tekst olemas"
  JA "OCR ootel" (kui re-OCR on tehtud olemasolevale tekstile).

**"Vali tekstita" nupu loogika täpsustus (oluline servajuht):** `has_text === false`
võib olla tõene ka lehel, mille `.ocr` on JUBA ootel (OCR tehtud, aga rakendamata).
Naiivne "vali kõik `has_text === false`" valiks need uuesti → topelt-OCR ootel olevale
lehele. Seetõttu:
- "Vali tekstita" valib lehed, kus `has_text === false` **JA** `.ocr` pole ootel
  **JA** OCR ei tööta — st päriselt töötlemata lehed. Vajab `reocr-status` infot (D),
  et OCR-ootel/töötavad lehed välja jätta.
- Kui `reocr-status` pole veel laetud (esmane render), võib nupp baseeruda ainult
  `has_text`-l ja peeneneda kui status saabub. Täpsustus implementatsiooniplaanis.

`WorkManage.tsx` annab `has_text` edasi `PageCard`-ile. i18n: uued võtmed `et`+`en`.

### B. Batch re-OCR käivitaja (manage — eraldi sektsioon)

**Paigutus (punkt: ära konkureeri olemasolevate nuppudega).** Re-OCR EI lähe samasse
ritta "Liiguta"/"Kustuta" kõrvale — see tekitaks nupu-rohkuse ja segaduse. Selle
asemel **omaette sektsioon** valikuriba sees, visuaalselt eristatud (nt heleroheline
taust `bg-green-50`), paigutatuna lehekülgede-liigutamise/kustutamise osa **alla**.
Pealkiri nt "Transkriptsioon". Nii on selge, et see on eraldi tegevusklass.

Nupp **"Tee transkriptsioon (N)"**:

- Mudeli valik **print / hand** (vaikimisi `print`) — sama `material_type` mis
  per-lehe voos. Toggle/select selles sektsioonis.
- **Kinnitusdialoog** — peab selgelt maandama "kirjutab kohe üle" hirmu:
  > "N lehte saadetakse uuesti OCR-i. Olemasolev tekst **ei muutu** enne, kui rakendad
  > tulemuse Workspace'is."

  Kui valikus on lehti, millel juba on tekst (`has_text === true`), lisa rida:
  > "(M valitud lehel on juba tekst — re-OCR teeb uue versiooni ülevaatuseks, vana jääb
  > alles kuni rakendamiseni.)"
- Päring → uus batch-endpoint (vt C). Vastus: `job_id`.
- Tulemused → **staging `.ocr`** (nagu praegu). Auto-rakendust EI ole — admin vaatab
  iga tulemuse Workspace'is üle ja rakendab käsitsi.
- Nupp keelatud kui `selectedFiles.size === 0` või kui mustand-järjekorra-muudatused
  pooleli (sama loogika mis bulk-kustutusel — `hasReorderChanges`).

**Tekstiga lehed valikus on LUBATUD** — re-OCR on legitiimne ümbertegemiseks. Vana
tekst (`.txt`) jääb puutumata kuni admin rakendab `.ocr` tulemuse Workspace'is.

### C. Job-arhitektuur — üks multi-image batch job

**Otsus:** üks job mitme pildiga (mitte N eraldi `start_reocr_job` kutset).
Põhjus: batch-suurused on "mõlemad" (väikesed vahelelaaditud + terved teosed
50–300 lk), ja terve teos ületaks `REOCR_MAX_CONCURRENT=20` piiri. Üks job N lehega
ei söö seda piiri.

Uus `start_reocr_batch(work_id, slug, pages, material_type, username) -> job_id`
failis `reocr_ops.py`:

- `pages`: list `(page_filename, page_number)` tuple'eid.
- Üks `job_id`, üks staging-kaust `AUTO-OCR/{mt}/{job_id}/{slug}/`.
- Laeb **kõik N pilti** SFTP kaudu (`{slug}_pg_001.jpg .. _pg_NNN.jpg`), hoides
  per-pilt mapping'ut: `remote_img` / `remote_txt` ↔ algne `page_filename` + `stem`.

**KRIITILINE — mapping peab olema job-registris autoriteetne, MITTE tuletatav
failinime-järjekorrast.** `_pg_001/002/003` on ainult remote'i nimekonventsioon, et OCR-
teenus failid üles leiaks. Tulemuse `.txt` → õige lehe `.ocr` seos tuleb lugeda **ainult**
`pages[]` kirje `remote_txt` ↔ `page_filename` väljadest. EI tohi sortida remote `.txt`
faile nime järgi ja eeldada, et N-s vastab N-ndale valitud lehele — üks väike
sorteerimisviga kirjutaks OCR-i valele lehele. Igal pildil on registris oma eksplitsiitne
`remote_txt` tee, mille kaudu tulemus alla laetakse ja mille kirje `page_filename`
määrab sihtkoha.
- Job-kirje struktuur (mälus, `_reocr_jobs`-i kõrval või sama registris `kind: "batch"`):
  ```python
  {
    "kind": "batch",
    "work_id", "slug", "username", "material_type",
    "status": "uploading" | "processing" | "done" | "error",
    "started_at", "finished_at",
    "last_progress_at",   # uueneb iga kord kui mõni leht → ready (inactivity-timeout alus)
    "pages": [
      { "page_filename", "page_number", "stem",
        "remote_img", "remote_txt",
        "status": "uploading" | "processing" | "ready" | "error",
        "error": None }
    ]
  }
  ```
- Taustal poll (laienda olemasolevat `_reocr_poll_loop`-i või eraldi batch-poll) laeb
  iga pildi `.txt`-i alla **niipea kui valmis** → kirjutab vastava lehe `.ocr` faili
  (jagatud helper, vt allpool) → märgib selle lehe per-page `status="ready"`.
- Job `status="done"` kui kõik lehed `ready`/`error`; `error` kui upload täielikult
  ebaõnnestus.
- OCR-teenus batchib **ise 3-kaupa** (BATCH_SIZE) — tuleb tasuta, sest kõik N pilti
  on korraga puus.

**Timeout — inactivity-põhine, MITTE üks fikseeritud limiit kogu batchile.** 300-lehe
job kestab loomulikult palju kauem kui üks leht; `REOCR_PROCESSING_TIMEOUT=1800` kogu
batchile saadaks suure töö asjatult errorisse, kuigi see edeneb normaalselt. Selle asemel:
- **Inactivity-timeout:** job on probleemne ainult siis, kui **X aja jooksul (nt
  `REOCR_BATCH_INACTIVITY_TIMEOUT`, vaikimisi sama 1800s) pole ühegi veel ootel oleva lehe
  kohta uut `.txt`-d tekkinud**. St "viimase edu" ajatempel uueneb iga kord, kui mõni
  leht läheb `ready`-ks; timeout mõõdetakse sellest, mitte job-i algusest.
- Kui inactivity-timeout lööb, märgitakse **ainult veel lahendamata lehed** `error`-iks
  (juba `ready` lehed jäävad alles), job `status="error"` (osaline). Admin näeb, millised
  said valmis ja millised mitte.
- Per-lehe upload-timeout (SFTP edastus) jääb eraldi, lühike.

**Jagatud loogika faktoreerimine:** `.ocr` faili kirjutamine ja SFTP-helperid
(`_sftp_open`, `close_ssh`, kausta-cleanup) on praegu `start_reocr_job` /
`poll_reocr_job` sees. Ekstrakti:
- `_write_ocr_file(slug, page_filename, text)` — kirjutab `{stem}.ocr`.
- `_download_txt_if_ready(sftp, remote_txt) -> str | None`.
Per-lehe Workspace-voog (`start_reocr_job`, `useReOcr`) jääb **muutmata** — kasutab
samu helpereid.

**Uued endpointid (`main.py`, `require_role("admin")`):**
- `POST /admin/work/{id}/reocr-batch` — body `{ page_filenames: string[],
  material_type: "print"|"hand" }` → `start_reocr_batch` → `{ job_id }`.
  Valideeri: lehed kuuluvad teosesse, list pole tühi.

### D. Per-page staatus + progress manage-lehel

Uus `GET /admin/work/{id}/reocr-status` → hoiab kolm mõistet (vt ülal) lahus:
```json
{
  "active":   { "<filename>": "uploading" | "processing" },
  "ocr_ready": ["<filename>", ...],
  "errors":   { "<filename>": "<msg>" },
  "progress": { "total": 212, "ready": 37, "errors": 3, "active": true }
}
```
- `active` ← batch-job registrist (per-page sub-staatus, filtreeri `work_id` järgi).
  Ka per-lehe jooksvad jobid võib kaasata (sama `work_id`).
- `ocr_ready` ← skanni teose kaust `.ocr` failide järgi (odav `os.listdir` + suffix).
  **NB:** see on `.ocr` ootel, sõltumatu lehe `has_text`-st — leht võib olla korraga
  `has_text=true` JA siin nimekirjas.
- `errors` ← batch-job per-page error-väljad.
- `progress` ← aktiivse batch-jobi kokkuvõte (kui mõni `work_id`-le aktiivne).

**Frontend (`WorkManage.tsx`):**
- Pollib seda **ainult kui batch aktiivne** (`progress.active === true` VÕI just
  käivitatud), intervall 3–5s, kuni `active` tühjeneb. Lõpetab polli kui midagi
  aktiivset pole — ei pingi serverit jõude.
- **Lokaalne progress-kokkuvõte** (punkt 6) — re-OCR sektsioonis / lehe ülaosas väike
  rida, nt **"OCR: 37/212 valmis, 3 veaga"** (`progress`-st). Annab adminile tunde, et
  süsteem edeneb, ilma eraldi monitorita. Kuvatakse ainult kui batch aktiivne või just
  lõppes.
- `PageCard` saab kaks sõltumatut sisendit (mitte üks kokkusulatatud staatus):
  - `has_text` (A-st) — "tekst olemas" / "tekstita" baasmärk.
  - `reocrState`: `'processing' | 'ocr_ready' | 'error' | undefined`.
- Pisipildil (märgid kuvatakse **koos**, mitte üksteist asendades):
  - **processing** → spinner-märk
  - **ocr_ready** → roheline märk tekstiga **"OCR valmis ülevaatamiseks"** (MITTE lihtsalt
    "valmis" — see ei tähenda "leht on korras"). Kuvatakse ka siis kui `has_text=true`.
  - **error** → punane märk + tooltip sõnumiga
- Klõps lehel → Workspace, kus **olemasolev `useReOcr`** tuvastab `.ocr` ja näitab
  "rakenda" nuppu (juba ehitatud, muutmata).

### E. Skoobist väljas (eraldi hilisem etapp)

`/admin/reocr` keskne monitor (kõik jobid + logi üle teoste). Backend
(`list_reocr_jobs`, `get_reocr_log`) on olemas, UI lisame eraldi kui vaja. **Ei
blokeeri seda tööd.**

## Andmevoog (kokkuvõte)

```
Manage: vali lehed (või "Vali tekstita") → "Tee transkriptsioon (N)" + print/hand
  → POST /admin/work/{id}/reocr-batch
  → start_reocr_batch: 1 job_id, N pilti → AUTO-OCR/{mt}/{job_id}/{slug}/
  → OCR-teenus skannib puu, batchib 3-kaupa, kirjutab .txt iga pildi kõrvale
  → backend poll: iga .txt valmis → .ocr fail lehe kausta + per-page status=ready
       (mapping AUTORITEETNE registrist, last_progress_at uueneb; inactivity-timeout)
Manage: pollib /reocr-status (ainult aktiivse batchi ajal) → pisipildi märgid
       + progress-kokkuvõte "OCR: 37/212 valmis, 3 veaga"
  → klõps lehel → Workspace → useReOcr näeb .ocr → "rakenda" (olemasolev voog)
```

## Mõjutatud failid

**Backend:**
- `server/reocr_ops.py` — `start_reocr_batch()` (autoriteetne per-page mapping),
  batch-poll **inactivity-timeout'iga** (uus konstant `REOCR_BATCH_INACTIVITY_TIMEOUT`,
  vaikimisi 1800s, mõõdetud `last_progress_at`-st), jagatud helperid
  (`_write_ocr_file`, `_download_txt_if_ready`), reocr-status + progress agregeerimine.
- `server/main.py` — `POST /admin/work/{id}/reocr-batch`,
  `GET /admin/work/{id}/reocr-status` (sis. `progress`).

**Frontend:**
- `src/pages/WorkManage.tsx` — eraldi re-OCR sektsioon (heleroheline), "Vali tekstita"
  nupp (**täpsustatud loogika:** jätab OCR-ootel/töötavad välja), "Tee transkriptsioon"
  nupp + print/hand valik + kinnitusdialoog (üle-kirjutamise hoiatus), reocr-status poll,
  progress-kokkuvõte, `has_text` + `reocrState` (kaks sõltumatut propi) edasiandmine.
- `src/pages/manage/PageCard.tsx` — `has_text` "tekstita" marker + sõltumatud
  `reocrState` märgid ("OCR valmis ülevaatamiseks" kuvatav ka `has_text=true` korral).
- `src/locales/{et,en}/*.json` — uued i18n võtmed (sektsiooni pealkiri, nupud, kinnitus,
  progress, märgid).

## Riskid / tähelepanekud

- **GPU on jagatud üks** — 300-lehe batch hoiab OCR-teenust kaua hõivatud, blokeerib
  ajutiselt per-lehe re-OCR-i ja uue üleslaadimise OCR-i. Inherentne (üks GPU);
  vastuvõetav — see on loomult järjekord.
- **Materjalitüüp on per-batch** — segatud teos (osa print, osa hand) vajab kahte
  eraldi batchi. Vastuvõetav; tüüp on harva segatud.
- **Olemasolev `.ocr` lehel** — kui lehel on juba `.ocr` ootel ja saadetakse uus
  batch, uus tulemus kirjutab `.ocr` üle. Ootuspärane (uusim OCR võidab).
- **`async def` + blokeeriv SFTP õppetund** (vt intsident `a89e905`): batch-upload
  ja poll PEAVAD jooksma taustal threadis, MITTE `async def` endpointi sees, et mitte
  külmutada single-worker event-loopi.

## Testimine

- Backend: `start_reocr_batch` job-registri struktuur; reocr-status + progress
  agregeerimine (active/ocr_ready/errors); jagatud `_write_ocr_file` ühildub per-lehe
  vooga.
- **Mapping autoriteetsuse test (kriitiline):** simuleeri olukord, kus remote `.txt`-d
  saabuvad **eri järjekorras** kui nad üles laeti (nt `_pg_003` valmib enne `_pg_001`)
  → kinnita, et iga tulemus läheb registri kirje järgi õigele `page_filename`-ile, MITTE
  saabumis-/nimejärjekorra järgi.
- **Inactivity-timeout test:** `last_progress_at` uueneb iga `ready` korral; timeout lööb
  ainult kui X aega ilma eduta; löömisel märgitakse ainult lahendamata lehed `error`-iks,
  juba `ready` lehed jäävad alles.
- Mockida SFTP (nagu olemasolevad reocr-testid, kui on) — ära tee päris OCR-serveri
  päringuid testides.
- Frontend: "Vali tekstita" jätab OCR-ootel/töötavad lehed välja; poll käivitub/peatub
  õigesti; pisipildi märgid (incl. "OCR valmis ülevaatamiseks" `has_text=true` korral)
  vastavad reocr-status vastusele; progress-kokkuvõte näitab õigeid numbreid.
- Manuaalne server-test: päris batch väikese teosega (vt deploy mälu — `docker exec`,
  `server_update.sh`, frontend `rsync`).
