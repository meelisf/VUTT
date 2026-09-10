# Upload'i OCR-i katkestamine — disainidokument

**Kuupäev:** 2026-08-08
**Staatus:** kinnitatud (ülevaatuse parandustega), ootab plaani
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
omaette kavatsus.

### Miks ainult mudel, mitte kõik metaandmed

Kaalutud: terve `UploadStepMeta` vormi taaskasutus sammus 3. Lükati tagasi.

Ainus väli, mis **mõjutab jooksu ennast**, on tüüp — see valib mudeli ja kaugtee. Pealkirja,
aastat, kollektsiooni jm saab pärast importi teoselt muuta, nagu iga teise teose puhul.
**Slug ei pea metaandmetega täpselt vastavuses olema** — see genereeritakse algsest
pealkirjast üks kord ja jääb püsivaks ka siis, kui pealkiri hiljem muutub.

## Mida katkestamine puudutab

Upload'i katkestamisel **puudub re-OCR-i lokaalne tulemuste omandiprobleem**: ükski
OCR-tulemus ei ole veel teosesse jõudnud — tekst laaditakse alles impordil
(`import_work.py:153`), pollimine toob ainult pisipilte. Küll aga tuleb eri OCR-katsed
**kaugserveris üksteisest isoleerida**, sest katkestamise hetkel võib kuni üks LOSS-i
batch veel lennus olla (ADR 0018).

| | Re-OCR (A) | Upload (B) |
|---|---|---|
| Tulemuse omand | `.ocr` võib sisaldada varasema töö kehtivat tulemust | teose poolel puudub |
| Jooksude isolatsioon | job ise eristab tööd | **iga apply vajab oma kaug-run-id'd** |

B ei saa seega A protokolli üks-ühele kopeerida.

## Run-isolatsioon: iga apply saab oma kaugtee

**See on correctness-parandus, mitte hardening.**

Praegune tee on deterministlik: `AUTO-OCR/{model}/{upload_id}/{slug}`. Katkestamine kustutab
selle kataloogi ja uus apply loob **täpselt sama kataloogi uuesti**. ADR 0018-st teame, et
kustutamise hetkel võib kuni üks LOSS-i batch olla juba GPU-s. Siis juhtub:

```
LOSS  : lehed 9–12 inferentsis (VANA jooks, VALE mudel)
VUTT  : rm -rf .../{upload_id}/{slug}
VUTT  : → awaiting_split, kasutaja vajutab uuesti Edasi
VUTT  : loob .../{upload_id}/{slug} UUESTI
LOSS  : vana batch lõpetab → kirjutab 9.txt–12.txt UUE jooksu kataloogi
```

Vana jooksu — ja seega **vale mudeli** — tulemus maandub uue jooksu kataloogi täpselt
õigete failinimedega. Import loeb selle uue jooksu korrektseks tulemuseks. Vaikne
andmerike, mille põhjustaks just see funktsioon, mis pidi vale mudeli parandama.

### Kaks eri mõistet

- **Mudel** (`meta.type` → `hand`/`print`) — püsiv upload'i seade, muudetav sammus 3
- **Jooksu tee** — genereeritakse **iga apply juures uuesti**

```
AUTO-OCR/{model}/{upload_id}-{run_id}/{slug}
```

`run_id` on uus nanoid iga `try_begin_applying` õnnestumise kohta. Lame kuju
(`{upload_id}-{run_id}`, mitte pesastatud) on valitud sellepärast, et reaper eemaldab kogu
jooksu ühe `rm -rf`-iga ega jäta tühje vanemkatalooge kogunema — pesastatud kujul jääks
`{upload_id}/` alles ka siis, kui kõik selle jooksud on koristatud.

Vana lennusolev batch võib nüüd teha, mida tahab — ta kirjutab **oma** kataloogi, mida
keegi ei loe.

### Tahtlikult tahaühilduv

Teed **loetakse alati state'ist** (`state["remote_staging_path"]`), mitte ei arvutata
kutsekohas ümber — kontrollitud kõigis kutsekohtades (`prepress_apply.py`,
`import_work.py`, `ocr_client.py`, `upload_ops.py`). Seega:

- juba lennus olevad upload'id säilitavad oma vanad teed ja töötavad edasi;
- migratsiooni ei ole vaja;
- `run_id` puudumine state'is tähendab lihtsalt „vana kujuga jooks".

Teid EI TOHI hakata kutsekohtades tuletama — see invariant teeb ülemineku riskivabaks.

## Backend: `POST /admin/upload/{upload_id}/cancel-ocr`

`require_role("admin")`. Sync `def` — kogu töö on blokeeriv I/O (ADR 0002).

| Staatus | Vastus |
|---|---|
| `applying`, `processing`, `reviewing`, `error` | 200 — katkestamine algab |
| `cancelling` | 200 — **jätkab pooleli katkestamist** (vt allpool) |
| `imported` | 409 — teos on olemas, see ei ole enam upload |
| `awaiting_split`, `prepping`, `pending`, `uploading` | 409 — OCR ei käi |
| tundmatu id | 404 |

### Katkestamine on jätkatav, mitte ühekordne

Kui `join` aegub, tagastatakse 503 ja upload jääb `cancelling` olekusse. Kui `cancelling`
annaks 409, oleks endpoint pärast omaenda ebaõnnestumist kasutajale **viieks minutiks
lukus** — kuni taastamise ajapiirini. Seepärast: `cancelling` → jätka protokolli algusest
(signaal, join, koristus). Upload'i-põhine lukk välistab kahe koristuse samaaegse jooksu.

### Protokoll

```
lukk: CAS applying|processing|reviewing|error → cancelling
      persist cancelling_since
        ↓
kui apply-worker on olemas JA elus:  signaali Event, join(timeout)
kui workerit ei ole (processing/reviewing puhul tavaline):  jätka kohe
        ↓
kui worker ikka elab:  503, jää `cancelling`
        ↓
kaugkoristus: kustuta FAILID selle jooksu teel, kataloog jääb (vt #225)
        ↓
lokaalne koristus: reset_ocr_run_state()
        ↓
lukk: CAS cancelling → awaiting_split
        ↓
(hiljem) reaper eemaldab tühja run-kataloogi
```

`applying` ajal on apply-lõim (`prepress-apply-{upload_id}`) elus ja teeb 300 DPI renderdust
+ SFTP-d. `processing`/`reviewing` ajal on ta **tavaliselt juba lõpetanud** — ülekanne sai
valmis ja staatus liikus edasi. Seepärast on worker'i olemasolu kontroll tingimuslik, mitte
eeldus.

### `reset_ocr_run_state()` — kanooniline lähtestus

Väljade käsitsi nullimine mitmes kohas lahkneb. Üks abifunktsioon lähtestab kõik
jooksu-ulatusega väljad: `files: []`, `expected_pages: None`, `last_progress_at`,
`error_message`, `prepress.applied_done: 0`, lokaalne `thumbs/`. `work_id` jääb alles —
see on teose tulevane identiteet, mitte jooksu oma.

**Invariant, mida test kontrollib:** pärast katkestamist peab state kuju poolest vastama
tavalisele `awaiting_split` upload'ile, välja arvatud katkestamise auditinfo
(`cancelling_since`).

**Jääb puutumata:** `source.pdf` / `source/`, `preview/`, kogu `prepress` plaan, `meta`.

Lõppolek `awaiting_split` on täpselt see, kus upload oli enne „Edasi" vajutamist;
olemasolev `try_begin_applying` CAS (`APPLY_START_STATUSES = ("awaiting_split", "error")`)
aktsepteerib seda muutmata.

## Kinni jäänud `cancelling` taastamine

Kui protsess suri koristuse ajal või `join` aegus ja keegi ei proovinud uuesti, jääks upload
`cancelling` olekusse.

**Ajapiir üksi EI OLE piisav tingimus.** Üks põhjus, miks upload `cancelling`-usse jäi, on
just see, et `join` aegus — mis tähendab definitsiooni järgi, et apply-lõim võib **veel elus
olla**. Ainult aja peale normaliseerimine avaks `awaiting_split`-i elava kirjutaja alt ja
muudaks `CANCEL_STUCK_TIMEOUT`-i võistlusolukorra taimeriks:

```
00:00  cancel
00:30  join timeout → 503, lõim on ikka SFTP-s kinni
05:01  normaliseerimine → awaiting_split          ← VALE
05:05  kasutaja vajutab Edasi → uus apply
05:20  vana lõim ärkab ja jätkab kirjutamist
```

Tingimus on seega **kaheosaline**:

```
cancelling_since > CANCEL_STUCK_TIMEOUT (300 s)
  JA  apply-worker puudub või ei ela
        ↓
  best-effort kaugkoristus SELLE jooksu tee järgi (failid, mitte kataloog — #225)
        ↓
  reset_ocr_run_state() → awaiting_split
```

Kui lõim on endiselt elus, jäetakse `cancelling` alles ja logitakse hoiatus („stuck
worker"). Pärast protsessi restarti on tingimus triviaalselt täidetud — vana lõime ei saa
enam olemas olla.

**Koristust proovitakse enne normaliseerimist uuesti.** Varasem põhjendus „järgmine apply
kirjutab samad failid niikuinii üle" **ei kehti**: run-id tõttu läheb järgmine apply alati
teise kataloogi, ja mudeli vahetuse korral isegi teise mudeli alla. Kui koristus ikka
ebaõnnestub, minnakse lokaalselt edasi, aga siis kehtib aus sõnastus: **LOSS võib vana
jooksu lõpuni töödelda; VUTT ei kasuta selle tulemusi** — nad on orvuks jäänud run-id
kataloogis. ADR 0018 „kuni 4 lehte" piir kehtib ainult siis, kui `rm -rf` õnnestus.

Taastamine elab olemasolevas `upload-sync` taustalõimes (iga 60 s). `cancelling_since` on
**persisteeritud väli** state'is.

## Kaugkoristus: failid kohe, kataloog hiljem (#225)

`rm -rf` kataloogile **kukutab OCR-teenuse**, kui katkestamise hetkel on batch juba GPU-s.
Mõõdetud tootmises 2026-08-08: `process_batch` kirjutab tulemuse ilma veakäsitluseta, viga
propageerub `main_loop`-ist mooduli tasemele, kus on `sys.exit(1)`. `Restart=on-failure`
taastab ~1 min pärast, aga katkestab kõigi teiste kasutajate järjekorra.

Seepärast on koristus **kaheastmeline**:

1. **Kohe:** kustuta run-kataloogi *failid* (pildid + `.txt`). Piltide kustutamine peatab
   GPU-töö endiselt — `process_batch` väljub enne mudeli kutsumist, kui ükski pilt ei avane.
   Lennusoleva batchi `.txt` maandub olemasolevasse kataloogi ega kukuta midagi.
2. **Hiljem:** reaper eemaldab tühja run-kataloogi, kui ükski batch ei saa enam lennus olla.

**Armuaeg `RUN_DIR_REAP_GRACE = 600 s`.** Pärast piltide kustutamist on ainus võimalik
kirjutaja see üks batch, mis oli juba mällu loetud; mõõdetud 4 lehte ≈ 100 s. Kümme minutit
annab varu ka aeglasema mudeli ja suuremate lehtede jaoks.

**Orbu ei jäeta.** Reaper elab `upload-sync` lõimes (iga 60 s) ja eemaldab run-kataloogid,
mis on märgitud koristatuks ja mille armuaeg on täis. Kataloogid on jooksu kaupa eraldi
(`{upload_id}-{run_id}`), seega on eemaldamine üheselt määratud ega puuduta ühtki elavat
jooksu.

Sama viga on `reocr_ops._cleanup_remote_job`-is ja `upload_ops.cancel_upload`-is, mõlemad
tootmises — parandus tehakse issue #225 all ja B kasutab sama abifunktsiooni.

## Backend: `POST /admin/upload/{upload_id}/model`

Keha: `{"material_type": "hand" | "print"}`. Uuendab `meta.type`.

**Peab kasutama SAMA upload'i-lukku, mida `try_begin_applying`.** Naiivne „kontrolli
staatust, siis kirjuta" annab TOCTOU-akna:

```
/model                          apply
------                          -----
näeb awaiting_split
                                CAS → applying, käivitab töö
kirjutab meta.type
```

— mudel muutuks töötava ülekande alt. Kontroll ja kirjutus peavad olema ühe luku all,
sama, mida CAS kasutab. Lubatud ainult `awaiting_split`; muidu 409.

**Mudeli vahetus EI kirjuta kaugteid ümber** — need genereeritakse alles järgmisel apply'l
mudelist + upload_id-st + uuest `run_id`-st + slug'ist. See on run-isolatsiooni otsene
tagajärg: „praegust jooksu teed" ei ole `awaiting_split` olekus olemaski.

## Poller ja katkestamine

`thumbs.poll_and_sync_thumbs` peab `cancelling` puhul varakult väljuma, nagu ta juba teeb
`PREPRESS_IDLE_STATUSES` jaoks. **Varajane väljumine üksi ei piisa:** poller võib
katkestamise hetkel olla juba funktsiooni sees, keset pisipildi allalaadimist, ja kirjutada
faili valmis pärast seda, kui koristus `thumbs/` kustutas — mille järel ilmub kataloog
uuesti.

Poller kirjutab pisipildi juba `tmp` faili kaudu (`_create_thumbnail`). Lisandub
**staatuse ülekontroll luku all vahetult enne lõplikku kirjutust**; `cancelling` korral
visatakse allalaaditu ära. Kaugserveri poolel poller ainult loeb, seega seal riski ei ole.

## Frontend

Kaks nuppu, kaks tähendust — sildid ei tohi olla terminoloogilised konkurendid:

| Tegevus | Silt | Tulemus |
|---|---|---|
| Hävitav (olemas) | **„Loobu üleslaadimisest"** | kõik kaob, sh poolitusplaan |
| Uus | **„Katkesta OCR ja naase poolitamise juurde"** | jooks kaob, plaan jääb |

Kinnitusdialoog ütleb konkreetselt: *„OCR-i praegune jooks ja selle tulemused kustutatakse.
Poolitusplaan ja lähtefail säilivad ning saad valida teise OCR-mudeli."*

**Samm 3:** mudelivalik (Trükis / Käsikiri) koos reaga, mis ütleb, millisesse OCR-mudelisse
see saadab.

i18n **mõlemas keeles** (`fallbackLng` väljas, ADR 0011).

## Testid

| Test | Mida kaitseb |
|---|---|
| **Iga apply saab uue `run_id`; kaks järjestikust apply't ei jaga kaugteed** | Vana lennusolev batch ei saastaks uut jooksu |
| **Vana jooksu tee ≠ uue jooksu tee ka siis, kui mudel ei muutunud** | Just see juhtum, kus tee oli varem identne |
| Legacy upload ilma `run_id`-ta töötab edasi (teed loetakse state'ist) | Tahaühilduvus |
| Katkestamine igast lubatud staatusest → `awaiting_split` | Põhivoog |
| Plaan ja lähtefail säilivad | Kogu funktsiooni mõte |
| `reset_ocr_run_state` järel vastab state tavalisele `awaiting_split` kujule | Kanooniline lähtestus, mitte käsitsi nullimine |
| Apply-lõim peatub ENNE kaugkoristust | Võistlus |
| Worker puudub (`processing`) → koristus algab kohe, join'i ei oodata | Worker lifecycle ≠ olekumasin |
| `join` aegub → 503, jääb `cancelling`, koristust ei tehta | Jääk > võistlus |
| **`cancelling` + korduv kutse → jätkab, mitte 409** | Endpoint ei lukustu omaenda 503 järel |
| **Taastamine EI normaliseeri, kui worker elab** | 300 s ei tohi olla võistluse taimer |
| Taastamine normaliseerib, kui worker on surnud ja aeg täis | Kinni jäänud katkestamine ei blokeeri |
| **Taastamine proovib kaugkoristust enne normaliseerimist** | Järgmine apply EI kirjuta vana üle (run-id) |
| Poller ei kirjuta pisipilti pärast `cancelling` algust | Thumbs ilmuvad koristuse järel tagasi |
| **Koristus kustutab failid, AGA MITTE kataloogi** | #225: `rm -rf` kataloogile kukutab OCR-teenuse |
| Reaper eemaldab tühja run-kataloogi alles armuaja järel | Orbu ei jäeta, aga lennusolev batch saab kirjutada |
| Reaper EI eemalda kataloogi enne armuaega | Sama krahh teist teed pidi |
| **Paralleelne `/model` ja apply → täpselt üks võidab** | TOCTOU: mudel ei muutu töötava ülekande alt |
| `/model` `applying` ajal → 409 | Sama |
| `imported` → 409 | Ei lõhu imporditud teost |
| Terve ring: apply → cancel → mudeli vahetus → apply | Pildid maandavad UUE mudeli ja UUE run-id tee alla |

## Riskid

| Risk | Leevendus |
|---|---|
| Kasutaja segab kaks nuppu | Eristuvad sildid + kinnitus, mis ütleb, mis säilib ja mis kaob |
| Orvuks jäänud run-kataloogid kogunevad LOSSis | Reaper eemaldab tühjad run-kataloogid armuaja järel; lame `{upload_id}-{run_id}` kuju on üheselt määratud |
| Kataloogi kustutamine kukutab OCR-teenuse | #225: kustutatakse ainult failid; kataloog eemaldatakse alles siis, kui ükski batch ei saa enam lennus olla |
| Kaugkoristus ebaõnnestub | Vana jooks võib LOSSis lõpuni joosta, aga tema väljund on eraldi run-kataloogis, mida VUTT ei loe |
| Kuni 4 lehte jõuab LOSSis lõpuni | ADR 0018 piir — kehtib ainult õnnestunud failide kustutamise korral, muidu võivad lõpuni jõuda kõik. Nende `.txt` maandub orvuks jäänud run-kataloogi, mida VUTT ei loe |
| `cancelling` upload jääb rippuma | Kaheosaline taastamistingimus (aeg JA surnud worker) |
