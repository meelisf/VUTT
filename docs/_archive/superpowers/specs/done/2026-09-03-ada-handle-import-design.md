# ADA handle → VUTT: metaandmete ja skaneeringute automaatne import

**Kuupäev:** 2026-09-03
**Seotud:** ADR 0020 (üleslaadimise seisak), ADR 0022 (välise ID kanooniline kuju),
ADR 0026 (ülevaatus on alati nähtav), ADR 0028 (VUTT materialiseerib OCR-i lehed);
uus ADR 0030 (`page_map`)
**Staatus:** disain ülevaatamiseks, teostamata

## Probleem

Väga suur osa VUTT-i materjalist — eelkõige käsikirjalisest — tuleb Tartu Ülikooli
raamatukogu repositooriumist ADA (`dspace.ut.ee`). Täna kordab administraator iga
teose kohta sedasama käsitsi: otsib ADA-st kirje, kopeerib pealkirja, autori, aasta ja
arhiivisignatuuri VUTT-i vormi, laeb PDF-i(d) oma masinasse alla ja laeb siis brauseri
kaudu uuesti üles.

See on kolmekordne kadu:

1. **Metaandmed sisestatakse käsitsi ümber**, kuigi ADA annab need masinloetavana.
2. **Fail käib kaks korda üle võrgu** ja veel läbi administraatori masina — 322 MB-se
   kirjakogu puhul on see kümneid minuteid ja puutub kokku ADR 0020 seisaku-probleemiga.
3. **Seos allikaga kaob.** Pärast importi ei ole VUTT-is midagi, mis ütleks, millisest
   ADA kirjest või millisest lähtefailist konkreetne lehekülg tuli.

Soovitud töökäik: **admin annab ette handle'i, ülejäänu tuleb ise** — metaandmed vormi,
PDF-id serverisse, ja seejärel jätkub tavaline viisard, kus admin vaatab lehed üle
**enne** OCR-i saatmist.

## Mida ADA tegelikult annab

ADA on **DSpace 7.6.6** ja REST API on avatud ilma autentimiseta. Kontrollitud
2026-09-03 elava serveri vastu:

```bash
curl -sSL 'https://dspace.ut.ee/server/api/pid/find?id=hdl:10062/7822'      # item + DC
curl -sSL 'https://dspace.ut.ee/server/api/core/items/{uuid}/bundles'        # kimbud
curl -sSL 'https://dspace.ut.ee/server/api/core/bundles/{uuid}/bitstreams?size=100'
```

Näitekirje `hdl:10062/7822` annab:

```
dc.title              65 kirja Karl Morgensternile, St. Petersburg     [keel: et]
dc.contributor.author Klinger, Friedrich Maximilian von
dc.date.issued        1812
dc.coverage.temporal  31. dets.1812 - 9. jaan.1823; 7 k. s.d.
dc.language           German
dc.identifier.other   F 3,Mrg CCCXLII,kd.8,l.246-362
dc.identifier.uri     http://hdl.handle.net/10062/7822
dc.description.uri    http://tartu.ester.ee/record=b1812728~S1*est
dc.subject            Kiri / Letter / Brief
```

**Ja ORIGINAL-kimbus on 65 eraldi PDF-i, kokku 322 MB** — üks fail kirja kohta. See on
disaini kõige olulisem leid: „handle → PDF" ei ole 1:1, vaid 1:N.

## Otsus 1: üks handle = üks teos

Kirjad esitatakse **koos, ühe teosena**. Põhjus on sisuline, mitte tehniline: sama
kogumi kirjad on sageli kontsept, puhtand, vastus ja kommentaar — eraldi teostena
laiali löödud kaob kontekst, mis nad omavahel seob.

Tehniliselt: 65 PDF-i liidetakse `pdfunite`-ga üheks `source.pdf`-iks ja edasi töötab
viisard täpselt nagu ühe PDF-i puhul.

**Seos lähtefailiga säilitatakse kahel kujul, ühes ja samas lehe JSON-is.**

*Masinloetav* — struktureeritud väli lehe JSON-i juurtasandil:

```json
"source": {
  "provider": "ada",
  "handle": "10062/7822",
  "bitstream_uuid": "d950abcc-105f-47ef-97a7-bcc535c7ea38",
  "name": "07.03.1813.pdf"
}
```

*Inimloetav* — sama info kommentaarina `comments` massiivis, autoriga `ada-import`:

```
ADA: 07.03.1813.pdf
https://dspace.ut.ee/server/api/core/bitstreams/{uuid}/content
```

Mõlemad kirjutatakse **ainult ADA-tüki esimesele säilinud leheküljele** ja lähevad samasse
git-commit'i, mille import niikuinii teeb. Kuna mõlemad elavad lehe enda JSON-is, liiguvad
nad `reorder-pages` kasutamisel koos lehega kaasa.

Import teab provenance'i täpselt ja struktureeritult — sellest ainult stringi alles jätta
oleks info vaikne äraviskamine.

### `source` väli PEAB olema salvestustee säilitusloendis

Ilma selleta on struktureeritud väli **vähem vastupidav kui kommentaar**. Lehe salvestustee
(`editing.py:98-111`) kirjutab `meta_content`-i kliendilt **tervikuna üle** ja säilitab
eraldi ainult ühe võtme:

```python
existing_seq = existing.get('sequence') or existing.get('meta_content', {}).get('sequence')
if existing_seq is not None and meta_content.get('sequence') is None:
    meta_content['sequence'] = existing_seq
```

Frontend ei tea `source` väljast midagi ega saada seda tagasi, seega **esimene Ctrl+S
redaktoris pühiks provenance'i vaikselt ära**. `comments` jääb alles ainult sellepärast, et
klient laeb ja saadab selle.

Seega: `source` lisatakse samasse säilitusloogikasse nagu `sequence`. Test peab seda katma —
see on täpselt selline viga, mida keegi kunagi ei märka.

### Järjekord

60 faili 65-st on kujul `dd.mm.yyyy.pdf`. Viis ei ole: `9999.pdf`, `9998.pdf`,
`9997.pdf` (dateerimata — metaandmetes „7 k. s.d."), `1813.pdf` (ainult aasta),
`11.1815.pdf` (kuu + aasta).

**ADA enda bitstream-järjekord ei ole kronoloogiline** — neli 1816. aasta kirja
(`10.11`, `12.11`, `30.11`, `28.12`) on loendi lõpus, ilmselt hiljem juurde lisatud.

Seega sordib import ise, **failinimest parsitud kuupäeva järgi**:

| Kuju | Sortimisvõti | Näide |
|---|---|---|
| `dd.mm.yyyy.pdf` | täiskuupäev | `07.03.1813.pdf` |
| `mm.yyyy.pdf` | kuu 1. päev | `11.1815.pdf` → 1815-11-01 |
| `yyyy.pdf` | aasta 1. jaanuar | `1813.pdf` → 1813-01-01 |
| parsimatu | lõppu, nime järgi | `9997.pdf`, `9998.pdf`, `9999.pdf` |

**Sortimisvõti hoiab täpsust eraldi, mitte ei võltsi puuduvat päeva:**

```python
(aasta, kuu_või_0, päev_või_0, täpsus, algne_järjekord)
```

`11.1815.pdf` ei ole `1815-11-01` — ta on „1815, november, päev teadmata". Praktiline
tulemus on sama (osaliselt dateeritud fail satub oma perioodi algusesse, sest 0 < 1), aga
kood **ei väida** teadmist, mida tal ei ole. Parsimatud (`9997.pdf`) saavad `aasta = ∞` ja
lähevad lõppu, omavahel algses järjekorras.

Import ei paku lohistamist — admin saab lehed hiljem halduses ümber tõsta
(`POST /admin/work/{work_id}/reorder-pages`, `pages.py:374`).

## Otsus 2: metaandmete leping

| ADA (Dublin Core) | VUTT väli | Märkus |
|---|---|---|
| `dc.title` | `title` | vt „Kakskeelne pealkiri" |
| `dc.date.issued` | `year` | |
| `dc.coverage.temporal` | `year_display` | vabatekst, sobib otse |
| `dc.contributor.author` | `creators[]` | **paljas tekst, ilma Q-koodita** |
| `dc.language` | `languages[]` | sõna → ISO kood (`German` → `deu`) |
| `dc.description.uri` | `ester_id` | `b1812728` parsitakse ESTER-URL-ist |
| `dc.identifier.other` | `archive_refs[]` | `{archive_id: "TÜR", reference: "…"}` |
| `dc.identifier.uri` | `external_url` | handle-URL |
| `dc.subject` | — | **ei impordita** |
| — | `type` | ADA ei ütle → jääb admini lülitiks |

Kolm teadlikku valikut:

- **`creators` läheb sisse paljas tekstina.** Nimekuju „Klinger, Friedrich Maximilian
  von" automaatne sobitamine 2350 prosopograafia-kaardi vastu on täpselt see mehhanism,
  mis tekitas duplikaat-välised-ID-d (#240). Isiku seob admin käsitsi `EntityPicker`-iga
  pärast importi; nimekuju vajab niikuinii kohendamist.
- **`archive_id: "TÜR"` on vaikeväärtus, mitte tõde.** ADA on TÜ raamatukogu
  repositoorium, aga `dc.identifier.other` võib osutada mujale. Admin saab muuta.
- **`dc.subject` jäetakse välja.** `Kiri`/`Letter`/`Brief` on sama mõiste kolmes keeles;
  VUTT-i `tags` on Q-koodiga `LinkedEntity` ja Q-koodi ADA ei anna.

`type` vaikevalik on **käsikiri** (peamine kasutus), aga lüliti on nähtav ja admini
muuta — `meta.type` on bibliograafiline väide ja seda ei seata vaikselt (ADR 0028 §3).

### Mitmeväärtuselisus

Dublin Core väljad on **põhimõtteliselt kordused**. Näitekirje annab neist ainult
`dc.subject`-i mitmena, aga leping ei tohi sõltuda sellest, mida üks kirje juhtub sisaldama:

| Väli | Reegel mitme väärtuse korral |
|---|---|
| `dc.contributor.author` | **kõik** → `creators[]`, ADA järjekorras |
| `dc.language` | **kõik tuntud** → `languages[]`; tundmatud jäetakse vahele vaikselt logides |
| `dc.identifier.other` | **kõik** → eraldi `archive_refs[]` kanded, sama `archive_id` |
| `dc.description.uri` | ainult **ESTER-URL** → `ester_id`; ülejäänud eiratakse |
| `dc.identifier.uri` | ainult **handle-URL** → `external_url`; muu eiratakse |
| `dc.title` | eelistus `[et]` → keeleta → esimene; ülejäänud eiratakse |
| `dc.date.issued` | **esimene**; ülejäänu eiratakse |

`languages` semantika on ADR 0019 järgi „teoses sisuliselt esinevad keeled" — see ühtib
`dc.language` korduste tähendusega, seega kõigi võtmine on õige, mitte laisk.

### `year` on ADA `dc.date.issued`, mitte ajavahemiku algus

Näitekirje: `dc.date.issued = 1812`, aga materjal ulatub 1823-ni. Ühe teosena satub see
VUTT-i aastafiltris **1812. aasta alla**, kuigi sisaldab kirju 11 aasta ulatuses.

See on **teadlik otsus, mitte kogemata**: `year` peegeldab ADA väidet, seda ei tuletata
koosseisu kronoloogilisest ulatusest. Ulatus on nähtav `year_display`-s
(`31. dets.1812 – 9. jaan.1823`). Kui aastafiltri käitumine hakkab praktikas segama, on see
eraldi otsus `year_start`/`year_end` kohta, mitte selle impordi vaikne kõrvalmõju.

### Kakskeelne pealkiri

ADA pealkirjad on eestikeelsed, ingliskeelset vastet ei ole. VUTT-il on **üksainus**
`title` väli — keelest sõltuvat pealkirja ei ole kusagil (`grep title_en` → tühi) ja
seda ei hakata ka tekitama. Lahendus on sama, mida korpuses juba kohati kasutatakse:
mõlemad keeled ühes lahtris, kaldkriipsuga.

```
65 kirja Karl Morgensternile, St. Petersburg / 65 letters to Karl Morgenstern, St. Petersburg
```

Ingliskeelse poole **pakub Gemini, kinnitab admin**. Vorm eeltäidetakse ja pakkumine on
UI-s **märgistatud** (õrn taust + „masintõlge, kontrolli") kuni admin lahtrit puudutab.
Ebaõnnestunud või välja lülitatud Gemini korral jääb pealkiri eestikeelseks — see ei
blokeeri importi.

Tehniliselt: `server/ocr_providers/gemini.py` on täna pildikeskne
(`build_payload(image_bytes, …)`, `transcribe(image_bytes, …)`). Vaja on **tekstipoolset
lisandust** (~20 rida), mis taaskasutab sama `_api_key()`, `API_URL`, `_extract_text()`
ja `_error_summary()` — mitte uut klienti ega uut võtit.

Juhis peab pärisnimed rahule jätma: `Karl Morgenstern` ja `St. Petersburg` ei ole
tõlgitavad.

## Voog ja UI

**Muutuvad viisardi sammud 1–2. Sammud 3 (poolitamine) ja 4 (ülevaatus) jäävad
puutumata** — lehtede ülevaatamine enne OCR-i on juba olemas ja seda ei paranda.

### Samm 1 — metaandmed

Vormi kohale uus riba:

```
┌─ Impordi ADA-st ────────────────────────────────────┐
│  [ 10062/7822                    ]  [ Tõmba ]       │
│  Handle, hdl:-viide või dspace.ut.ee URL            │
└─────────────────────────────────────────────────────┘
```

Aktsepteeritavad sisendkujud (normaliseeritakse `10062/7822`-ks):
`10062/7822`, `hdl:10062/7822`, `http://hdl.handle.net/10062/7822`,
`https://dspace.ut.ee/handle/10062/7822`, `https://dspace.ut.ee/items/{uuid}`.

Vajutus → `POST /admin/ada/lookup` → vorm täitub. Alla ilmub kokkuvõte:

```
✓ 65 kirja Karl Morgensternile, St. Petersburg
  Klinger, Friedrich Maximilian von · 1812 · saksa · TÜR F 3,Mrg CCCXLII
  65 faili, 322 MB          [ näita loendit ▾ ]
     1. 31.12.1812.pdf
    …
    61. 1813.pdf         ⚠ ainult aasta
    62. 11.1815.pdf      ⚠ ainult kuu
    63. 9997.pdf         ⚠ dateerimata
```

Loend on **ainult vaatamiseks**. Hoiatusmärgid näitavad faile, mille kuupäeva ei
õnnestunud täielikult parsida — need on ka ainsad, mille asukoht võib olla vale.

**Juba täidetud vorm.** Lookup ei tohi admini käsitsi tehtud parandust vaikselt maha
kirjutada:

- **tühjad väljad** täidetakse ADA väärtusega;
- **mittetühjad väljad**, mille ADA väärtus erineb, jäävad puutumata ja märgitakse
  („ADA pakub: …" + ühekordne „võta ADA oma" nupp välja kõrval).

**Duplikaadi hoiatus.** Kuna handle läheb `external_url`-i, saab `lookup` kontrollida, kas
see ADA kirje on juba imporditud: *„See ADA kirje on VUTT-is olemas: <pealkiri>"* koos
lingiga. **Hoiatus, mitte blokeering** — kordusimport võib olla tahtlik (parem skaneering).

Maksumus ei ole päris null: `external_url` **ei ole** täna `FILTERABLE_ATTRIBUTES`-is
(`meili_settings.py:31`) ega otsitav. Vaja on lisada see filtrisse ja uuendada
`mcp/tests/test_meili_contract.py`-d. **Reindeksit ei nõua** — väli on `meili_doc.py:471`
järgi dokumentides juba olemas, muutub ainult indeksi seadistus. Kui see osutub plaani
kirjutamisel kalliks, on hoiatus ainus asi, mis siit välja langeb.

### Samm 2 — fail

ADA-voos asendub failivalija progressiribaga:

```
Laen ADA-st        ████████░░░░░░  27/65 faili · 134/322 MB
```

Fail tuleb **serverist serverisse**. Admini brauser ei näe baiti — see tähendab, et
nginx'i `client_max_body_size`, ADR 0020 seisakuloogika ja lahtine chunked-upload (#235)
ei puuduta ADA-importi üldse.

Kui allalaadimine ja liitmine on tehtud → `status: awaiting_split` ja viisard läheb ise
sammu 3. Tavaline failivalik jääb muutmata, kui ADA-riba ei kasutata.

**Katkestamine ja taastumine:** allalaadimine on taustatöö, tabi võib kinni panna.
Pooleliolev ADA-import on `/upload` nimekirjas nagu iga teine upload ja olemasolev
`Katkesta` kustutab staging'u.

## Backend-mehaanika

### Uus alampakett `server/ada/`

Eraldi moodul nagu `prosopography/`, mitte `upload_ops.py`-sse laiali:

| Fail | Sisu |
|---|---|
| `client.py` | ADA REST kutsed, handle'i normaliseerimine, vigade kaardistus |
| `mapping.py` | **Puhas** DC → VUTT väljad + failinime kuupäeva parsimine + sortimine |
| `fetch.py` | Taustalõim: allalaadimine, `pdfunite`, lähtekaardi kirjutamine |

`mapping.py` ei tee ühtki I/O-d — kogu loogika, mis võib valesti minna, on testitav ilma
võrguta.

### Endpointid (`routers/upload.py`, mõlemad `require_role("admin")`)

| Endpoint | Teeb |
|---|---|
| `POST /admin/ada/lookup` | Handle → 2–3 ADA päringut → metaandmed + sorditud failiplaan. **Ei kirjuta midagi.** |
| `POST /admin/upload/{id}/ada-fetch` | Käivitab taustalõimes allalaadimise + liitmise |

Mõlemad on `/admin/` all — nginx `/api/files/` proksib kõik backend-teed avalikult, seega
`require_role("admin")` on kohustuslik, mitte täiendav.

Blokeeriv I/O ei tohi olla `async def` sees (ADR 0002): `lookup` on sünkroonne `def` või
`run_in_threadpool`.

### Allalaadimine ja liitmine

1. 65 faili järjest → `uploads/{id}/ada/001.pdf` … (järjekorranumber = sorditud kord)
2. Progress → `upload_state.upload_progress` (olemasolev mälupõhine mehhanism)
3. `pdfunite ada/*.pdf source.pdf`
4. `pdfinfo` iga tüki kohta → lehtede arv → lähtekaart
5. `set_upload_state(expected_pages=pages, status="awaiting_split")` +
   `init_prepress(upload_id, pages)` — `pages` on **liidetud `source.pdf` lehtede
   arv**, mitte 65. ADR 0028: kuni `applying`-uni tähendab `expected_pages`
   lähte-lehtede arvu, mitte väljundit
6. `uploads/{id}/ada/` kustutatakse

`pdfunite` on backend-konteineris **juba olemas** (sama poppler-utils pakett, mis annab
`pdfinfo` ja `pdftoppm`). `qpdf`, `pdftk` ja `pypdf` ei ole — neid ei tohi kasutada.
Ainus uus väline sõltuvus on ADA HTTP.

### Taustatöö leping

Kolm invarianti. Iga rikkumine annab vea, mida on hiljem raske seletada.

**F1 — `ada-fetch` on idempotentne, CAS-iga nagu apply.** Topeltklõps, brauseri retry või
kaks avatud tabi ei tohi käivitada kahte lõime, mis mõlemad kirjutavad samasse
`uploads/{id}/`-i. Sama muster nagu `try_begin_applying` (`state.py:215`):

```
pending | ada_error  →  ada_fetching  →  awaiting_split
```

Kui seis on juba `ada_fetching`, tagastab endpoint 409 ega käivita teist worker'it.

**F2 — iga tükk laaditakse `.part`-i ja nimetatakse ümber alles pärast suuruse kontrolli.**

```
017.pdf.part  →  (saadud baidid == bitstream'i sizeBytes)  →  017.pdf
```

Ilma selleta jätab ühenduse katkemine 80 MB peal kettale poolik `017.pdf`, mis näeb retry
jaoks välja nagu valmis fail — ja `pdfunite` saaks katkise sisendi. **Fail kettal on tõde:**
`017.pdf` olemasolu tähendab „see tükk on terve", ja jätkamine laadib ainult puuduvad.

**F3 — worker kontrollib tükkide vahel, kas upload on veel olemas.** `Katkesta` kustutab
staging-kausta; parasjagu faili kirjutav lõim tekitaks kustutatud kataloogi uuesti või
kirjutaks state'i tagasi. Kontroll käib **iga tüki alguses**, sama muster nagu
`preview_cancel` (ADR 0028).

### Restart

`upload_progress` on mälupõhine — backendi restart 200 MB peal kaotab progressi. Töö ei tohi
jääda igaveseks `ada_fetching`-usse.

Durable job queue'd ei ehitata. Piisab kahest asjast:

1. käivitusel märgitakse iga `ada_fetching` upload ümber `ada_error`-iks („katkes, jätka") —
   sama koht, kus `reocr_recovery` juba täna rippuvaid töid koristab;
2. „Laen uuesti" jätkab sealt, kus `.part`-loogika pooleli jäi — juba tervikuna
   allalaaditud tükke ei tõmmata uuesti.

Worker on restartitav, sest tõde on failides, mitte mälus.

### Lähtekaart `state.json`-is

Uus **ülemise taseme** võti (`set_upload_state` kaudu, mitte `prepress` sisse):

```json
"ada": {
  "handle": "10062/7822",
  "item_uuid": "5a495195-44c1-463b-a425-643dc4dcf13f",
  "sources": [
    {"name": "31.12.1812.pdf",
     "bitstream_uuid": "a18e4167-…",
     "first_src_page": 1,
     "page_count": 4}
  ]
}
```

### `page_map` — miks seda vaja on

`_transfer_pages` (`prepress_apply.py:134`, silmus real 159) käib lähtelehti `n = 1..count`, jätab
väljajäetud vahele ja annab avaldatud lehtedele järjestikuse `out_index`-i:

```python
for n in range(1, count + 1):
    if prepress_plan.is_excluded(plan, n):
        continue
    ...
    out_index += 1
```

**Kusagile ei salvestata, milline lähteleht sai millise väljundnumbri.** Kui admin jätab
sammus 3 ühe lehe välja, nihkub kogu ülejäänu ja ADA-kommentaarid maanduksid vaikselt
valedele lehtedele. Vaikselt — see on halvim liik viga.

Lahendus: `_transfer_pages` kirjutab iga avaldatud lähtelehe kohta kaardi
**kõigist** temast tekkinud väljundlehtedest, järjekorras:

```json
"page_map": {"1": [1], "2": [2, 3], "3": [4]}
```

**Miks list, mitte üks number.** Sammu 4 `deleted` käib **väljundlehe** kohta —
`mark_page_deleted` sobitab `filename` järgi (`upload_ops.py:282`). Poolitatud lähtelehest
tekib kaks väljundit ja admin võib kustutada neist ainult ühe:

```
src 10 poolitatakse → out 17 (ülemine), out 18 (alumine)
admin kustutab sammus 4 out 17, jätab out 18
```

Üheainsa `int`-iga oleks ankur `17` — kustutatud leht — kuigi ADA tükk ise on VUTT-is
täiesti olemas. Listiga leiab algoritm `18` ja kommentaar maandub õigesti.

Semantiliselt on list ka õigem üldine mudel: üks lähteleht annab **0, 1 või N**
väljundlehte.

**`out_index` kasvab kahes kohas** — baithaaval kiirteel (rida 167) ja poolituse
lõikesilmuses (rida 191) — ja `mutate_prepress(applied_done=n)` kutsutakse samuti kahest
kohast (171 ja 205). Kaart tuleb kirjutada **mõlemas**, muidu jääb pool teosest
kaardistamata täpselt sel teel, mida muutmata pilt läbib. Poolitatud lehel salvestatakse
esimese lõike `out_index`, mitte viimase.

Kirjutus läheb sinna, kus juba niikuinii `applied_done` uuendatakse — täiendav võti, mitte
täiendav kirjutus. `mutate_prepress` on ADR 0028 järgi **ainus** lubatud tee `prepress`
alamväljade muutmiseks.

**Kaart tuleb apply alguses nullida.** `try_begin_applying` lubab CAS-i ka olekust `error`
(`state.py:215`, `APPLY_START_STATUSES`) ja loeb kordusi `apply_attempts`-i — kordus-apply
on päris ja võib joosta **teise plaaniga**. Vana kaardi võtmed ei tohi ellu jääda, muidu
osutab ankur eelmise katse nummerdusele.

`prepress` ei tea ADA-st midagi. Kaart on üldine ja kasutatav ka mujal.

### Ankru resolutsioon impordil

Import loeb `ada.sources` ja `prepress.page_map` ning iga tüki kohta:

```
tüki jaoks:
  iga lähteleht vahemikus [first_src_page, first_src_page + page_count - 1]:
      iga out_index listis page_map[lähteleht]:
          kui see väljundleht elas sammu 4 `deleted` üle:
              ankur = tema lõplik ümbernummerdatud leheküljenumber
              lõpeta
```

Lõplik number tuleb samast kohast, kus `import_work.py` niikuinii `importable` lehti ümber
nummerdab (`import_work.py:148`).

See üks silmus katab korraga viis juhtu: sammu 3 `excluded`, poolituse, poolituse esimese
poole kustutamise, mõlema poole kustutamise ja terve tüki kadumise.

**Kui ükski tüki leht ei elanud üle, ei teki kommentaari üldse** — mitte vale kohta.

## Väljajätmise semantika (olemasolev, kinnitatud)

Selle disaini jaoks oluline taust, kontrollitud koodist:

- **Samm 3, `excluded`** — leht ei renderdata, ei jõua OCR-serverisse, pilti ei teki
  kusagil. Kõige täielikum väljajätmine ja ainus, mis säästab OCR-i aega.
- **Samm 4, `deleted`** — leht on juba OCR-itud, aga `import_as_work` ei kopeeri teda
  `data/{slug}/`-i (`import_work.py:148`). VUTT-i ta ei jõua, küll aga kulus OCR.

Mõlemal juhul nihkuvad järgnevad lehed kokku, auke ei jää.

## Vigade käsitlus

| Olukord | Käitumine |
|---|---|
| ADA kättesaamatu / aegumine | `lookup` annab kõneka vea; vorm jääb käsitsi täidetavaks — import ei ole ainus tee |
| Handle olematu (404) | „Sellist handle'it ADA-s ei ole" |
| ORIGINAL-kimbus pole ühtki PDF-i | Teade, uploadi **ei looda** |
| ORIGINAL sisaldab muid vorminguid | PDF-id võetakse, muud loetletakse ja jäetakse vahele, teatega |
| Allalaadimine katkeb | `status: error` + „Laen uuesti"; allalaaditud tükid jäävad alles ja jätkatakse |
| `pdfunite` kukub | `status: error`, tükid jäävad alles diagnostikaks |
| Gemini tõlge kukub | Pealkiri jääb eestikeelseks, import jätkub |
| Tundmatu `dc.language` | Väli jääb tühjaks; valet koodi ei pakuta |

`LICENSE`, `TEXT` ja `THUMBNAIL` kimbud jäetakse alati vahele.

## Testimine

**Fixture'id päris ADA vastustest, mitte käsitsi kirjutatud.** `tests/fixtures/ada/`
alla salvestatakse `item.json`, `bundles.json`, `bitstreams.json`, tõmmatud ülal
kirjeldatud curl-käskudega. See on teadlik õppetund: Gemini-integratsioon ehitati
mockitud lepingu peale ja leping osutus fiktiivseks — **mockitud leping ei ole leping**.

Lisaks üks käsitsi jooksutatav test elava ADA vastu (CI-s vahele jäetud, `-m network`),
mis kontrollib, et fixture'id vastavad endiselt tegelikkusele.

| Test | Kontrollib |
|---|---|
| `mapping.py` puhas | DC → VUTT väljad; ESTER-ID parsimine; `TÜR` + `reference` |
| failinime kuupäev | neli kuju (`dd.mm.yyyy`, `mm.yyyy`, `yyyy`, parsimatu), sortimine, dateerimata lõppu |
| handle'i normaliseerimine | viis sisendkuju → `10062/7822` |
| `page_map` | `_transfer_pages` väljajätmistega → kaart õige, `out_index` ei nihku |
| ankru-resolutsioon | tükk + `page_map` + `deleted` → kommentaar õigel lehel; **terve tükk välja → kommentaari ei teki** |
| `deu`-kaardistus | sõnalised `dc.language` väärtused → ISO; tundmatu → tühi |
| **split + esimene pool kustutatud** | `src 10 → [17, 18]`, `out 17` kustutatud → ankur on `18`, mitte `17` |
| **mõlemad pooled kustutatud** | ankur libiseb tüki järgmisele lähtelehele |
| **`page_map` nullimine** | apply A → plaani muutus → apply B → kaardis ainult B kaardistus |
| **`source` üle Ctrl+S** | lehe salvestus redaktorist EI pühi `source` välja |
| **retry pärast poolikut allalaadimist** | `.part` ei loeta valmis tükiks; terved tükke ei tõmmata uuesti |
| **`ada-fetch` topeltkutse** | teine POST annab 409, teist worker'it ei teki |
| **mitu DC väärtust** | mitu autorit, mitu keelt, mitu `identifier.other`; `dc.title` `[et]` eelistus |
| **restart `ada_fetching` ajal** | käivitusel → `ada_error`, mitte igavene `ada_fetching` |

**Väravad enne PR-i:** `npm run typecheck`, `npm test`, `npm run lint:ci`,
`.venv/bin/pytest tests/`. Uued i18n-võtmed **mõlemasse keelde korraga** (`fallbackLng`
on väljas). 

**Uus ADR 0030 — `page_map` kaardistab lähtelehe kõigile temast tekkinud väljundlehtedele.**

> `_transfer_pages` kirjutab iga avaldatud lähtelehe kohta **järjestatud listi** temast
> materialiseeritud väljundlehtedest. Kirjutus toimub mõlemas kohas, kus `out_index`
> kasvab (baithaaval kiirtee ja poolituse lõikesilmus), ja kaart nullitakse iga apply
> alguses. Lähteleht, mis ei andnud ühtki väljundit, kaardis ei esine.

Ilma selleta maanduvad ADA-kommentaarid vaikselt valel leheküljel — ja vaikne on siin
kõige olulisem sõna: midagi ei kuku, tulemus on lihtsalt vale.

## Skoobist väljas

Öeldud selgelt, et hiljem ei tekiks ootust:

- **Ei impordi tervet ADA kollektsiooni partiina.** Üks handle korraga.
- **Ei seo `creators`-it prosopograafiaga automaatselt.**
- **Ei tee `dc.subject` → `tags`** — vajab Q-koode.
- **Ei sünkroniseeri hiljem, kui ADA kirje muutub.** Import on ühekordne hetktõmmis.
- **Ei paku impordil lehtede lohistamist** — halduses on `reorder-pages` olemas.
- **Ei tekita keelest sõltuvaid pealkirjaväljasid.** Kakskeelsus elab ühes lahtris.
