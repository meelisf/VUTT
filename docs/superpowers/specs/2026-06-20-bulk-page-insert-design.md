# Bulk-lehtede lisamine teosele

**Kuupäev:** 2026-06-20
**Staatus:** Disain kinnitatud (sh review-leiud sisse viidud), ootab implementatsiooniplaani

## Probleem

`/work/{id}/manage` lehel ("Lisa leht" vorm) saab praegu lisada korraga ainult **ühe**
pildifaili teose lehekülgede vahele. Kasutajal on vaja lisada korraga mitu lehte (nt
20 või 200 skannitud pilti) valitud positsioonile. Praegu peaks selleks tegema kümneid
käsitsi-lisamisi.

## Eesmärk

Sama `/manage` "Lisa leht" vorm võtab vastu mitu pildifaili korraga ja lisab need
**kanoonilise loomuliku järjekorra** järgi valitud positsioonile. UI jääb samasse
kohta; uut lehte ega uut nuppu ei teki. Lahendus peab töötama ka suurte partiide
korral (200+ faili) ja olema robustne I/O- ja paralleelsuse-vigade suhtes.

**Skoobist väljas:** OCR. Iga lisatud leht saab tühja `.txt` ja staatuse `Toores`,
täpselt nagu praegune ühe-lehe lisamine. OCR on eraldi, hilisem samm.

## Olemasolev seis (lähtekoht)

- **Frontend:** `src/pages/WorkManage.tsx` — `showAddForm` vorm, `handleAddPage()`
  (~rida 371). Üks `<input type="file">` (`addFile`), positsiooni-`<select>`
  (`addAfterPage`: `0`=algusesse, lehe `page_num`=selle järele, `-1`=lõppu). POST
  `multipart` → `FILE_API_URL/admin/work/{workId}/add-page`, väljad `file` +
  `after_page_num`. Eduka vastuse järel `loadPages()`.
- **Backend:** `server/main.py` `admin_add_page` (~rida 564). Loeb ühe faili mällu
  (`await file.read()`), tuvastab tüübi magic-byte'idega (JPG; PNG → teisendab JPEG-iks
  `Image.convert('RGB')` + quality=95; PDF keeld), arvutab `new_seq` (`seq_of` +
  midpoint, vajadusel `rebalance_sequences`), kirjutab pildi + tühja `.txt` +
  minimaalse `.json` (`{sequence, status:"Toores"}`), git-commit, `sync_work_to_meilisearch`.
- **Abifunktsioonid:** `server/admin_page_ops.py` — `get_sorted_images`,
  `get_page_sequence`, `rebalance_sequences` (nummerdab kõik ümber sammuga 100;
  **loeb olemasoleva `.json`-i sisse ja muudab ainult `sequence`-i, ülejäänu säilib**),
  `reorder_pages`, `split_page`, `transform_page_image`.
- **Mutleerivad lehe-endpointid** (kõik `require_role("admin")`): `add-page`,
  `delete /page/{n}`, `replace-image`, `split`, `transform`, `reorder-pages`.
- **Lukud koodibaasis:** `threading.Lock`/`RLock` muster (cache, auth, people_ops).
  Asyncio-lukke ei kasutata. Uvicorn single-worker.
- **Nginx:** `nginx.host.conf` `client_max_body_size 600M` `/api/files/admin/` all.
- `Image.MAX_IMAGE_PIXELS` kaitset pole praegu kuskil seatud.

## Disain

### 1. Kanooniline loomulik sorteerimine (mõlemas otsas identne)

Frontend ja backend peavad sorteerima **täpselt sama võtmega**. JS `localeCompare`
ja Python vaikesort EI anna sama tulemust. Defineeri üks algoritm ja implementeeri
mõlemas otsas; **backend on lõplik autoriteet** (sorteerib enne kirjutamist uuesti).

**Sort-key algoritm** (`naturalSortKey(filename)`):
1. Unicode normaliseerimine **NFC**.
2. Tähed väikesteks (`casefold` / `toLowerCase`).
3. Tükelda regexiga numbri- ja mittenumbri-plokkideks (`\d+` vs muu).
4. Võrdle: numbriplokk **arvuna** (juhtnullid ignoreeritakse: `02` == `2`),
   mittenumbriline plokk normaliseeritud **stringina**.
5. **Viigi-katkestaja:** originaalne (normaliseerimata) failinimi, et tagada stabiilne
   determinism (nt `02` vs `2`).

**Tokeniseerimise pariteet (kriitiline):** Python `re.split(r'(\d+)', s)` tagastab
listi, kus numbrist algav/lõppev string annab **tühje elemente** (nt `"2.jpg"` →
`['', '2', '.jpg']`). JS-pool peab tokeniseerima **identselt** (sama tühjade-stringide
ja alguse/lõpu-numbrite käitumine), et võrdlusindeksid ei nihku. Fikseeri tühjade
elementide käsitlus ühtmoodi mõlemas otsas (nt jäta alles ja kohtle tühja stringi
"väikseimana"). Testi eraldi: `2.jpg`, `.2`, `2`, `a2b`, `2a`.

Frontend'i eelvaade ütleb "lisatakse selles järjekorras" ja kasutab sama võtit, mitte
brauseri lokaali. Backend ei usalda frontend'i järjekorda — sorteerib ise.

### 2. UI — `WorkManage.tsx` "Lisa leht" vorm

- Failiväli saab `multiple` (`accept="image/jpeg,image/png"`).
- Valitud failid sorteeritakse `naturalSortKey` järgi.
- **Eelvaade (kärbitud):** kui faile on >1, näita arvu + esimesed ~10 ja viimased ~5
  nime, vahel "näita kõiki" link. 200 nime ei renderdata vaikimisi.
- Positsiooni-`<select>` jääb muutmata.
- Submit käivitab tükeldatud üleslaadimise (vt 3) ja näitab **progressi** ("Laetud X / N").
- **Üleslaadimise ajal:** Submit-nupp keelatud; failivalik, positsioon ja eelvaade
  lukus. Tühistus-nupp peatab **järgmise** chunk'i (käimasolevat request'i ei katkesta).
- Üks valitud fail käitub täpselt nagu praegu (üks partii, N=1).
- Lõpetamisel: `loadPages()`, vorm lähtestatakse.

**i18n:** uued võtmed `et` + `en` (nt `manage.addPagesPreview`, `manage.addPagesShowAll`,
`manage.addPagesProgress`, `manage.addPagesPartialError`, `manage.addPagesCancel`).
Olemasolevad ühe-lehe võtmed säilivad.

### 3. Frontend — tükeldamine (kasutajale nähtamatu)

- Failid sorditakse `naturalSortKey` järgi.
- Tükelda **arvu JA mahu järgi:** kuni `CHUNK_MAX_FILES = 20` JA kuni
  `CHUNK_MAX_BYTES ≈ 200 MB` partii kohta (kumb enne täis). Üksik liiga suur fail
  läheb omaette partiina (frontend ei tükelda faili sees).
- Positsiooni-aritmeetika on deterministlik, **re-fetchi pole vaja**:
  - Lähte-`after_page_num` tuleb select'ist (`0`, lehe `page_num`, või `-1`).
  - Kui partii lisab K lehte positsiooni P järele → lehed positsioonidel P+1…P+K →
    järgmine partii `after_page_num = P + K`.
  - "Algusesse" (`0`): esimene partii P=0 → lehed 1…K → järgmine `after_page_num = K`.
  - "Lõppu" (`-1`): iga partii jääb `-1`.
- Iga partii: POST `multipart` → `/admin/work/{workId}/add-pages` (mitu `file`-välja +
  `after_page_num`); progress uueneb partii õnnestumisel.
- **Veakäsitlus (osaline):** partii viga → peatu; näita **mitu lehte jõudis lisatud**,
  millise partii juures peatus, serveri veateade; `loadPages()` peegeldab osalist
  tulemust. Juba lisatud lehed jäävad alles.

**Märkus (teadlik lihtsustus):** iga chunk on backend'i mõttes **iseseisev partii**.
200 lehte = ~10 request'i = ~10 commiti = ~10 Meili-synci. Kahe lehe vahele lisades
võib mõni chunk sundida ümbernummerdamist ja järgmine mitte — funktsionaalselt
korrektne, kuid mitte optimaalne. Kui jõudlus hiljem häirib, saab lisada `total_count`
vihje, et esimene chunk reserveeriks ruumi korraga. **Praegu skoobist väljas.**

### 4. Backend — uus endpoint `POST /admin/work/{work_id}/add-pages`

`require_role("admin")`. Multipart body: mitu `file`-välja (`form.getlist('file')`,
väljanimi säilib vana endpoint'iga ühilduvuse mõttes) + `after_page_num` (int).

Töötab **work-level lukus** (vt 7).

0. **`after_page_num` vahemikukontroll:** lubatud `-1` (lõppu), `0` (algusesse) või
   `1 ≤ after_page_num ≤ page_count`. **Väljaspool vahemikku → 400** (mitte vaikne
   "lõppu"). Põhjus: bulk on chunk'itud; `after_page_num > page_count` viitab, et keegi
   kustutas vahepeal lehti — automaatne lõppu-lisamine annaks vale paigutuse. (Vana
   single `add-page` jääb leebeks — vt 9, teadlik lahknevus.)
1. **Limiidi-kontroll:** failide arv ≤ `MAX_FILES_PER_REQUEST` (nt 20); kogumaht ≤
   `MAX_REQUEST_BYTES`; üksikfail ≤ `MAX_SINGLE_FILE_BYTES`. Ületus → 400.
2. **Valideeri kõik failid enne kirjutamist** (valideerimis-atomaarsus), AGA
   **mälusäästlikult sekventsiaalselt** (vt allpool). Iga faili kohta: loe sisu (hoia
   ainult **tihendatud baidid** mälus, ≤ `CHUNK_MAX_BYTES`), tuvasta tüüp magic-byte'idega;
   kontrolli mõõtmed/piksliarv Pillow'ga (`Image.verify`/`Image.open` + `.size`), siis
   **`img.close()`**; JPG → ok; PNG → märgista teisendamiseks (tegelik teisendus 4. sammus,
   ühe faili kaupa). Muu/PDF → viga. **Mõni** fail toetamata → `HTTPException(400)`
   vigase faili nimega; **midagi ei kirjutata**.
   - Pillow `MAX_IMAGE_PIXELS` + `MAX_DIMENSION` (nt laius/kõrgus ≤ 10000 px) kaitse
     decompression-bomb'i ja liiga suurte piltide vastu (vt 6).
3. Sorteeri valideeritud failid `natural_sort_key` järgi (backend autoriteetne).
4. **Jaota N järjekorranumbrit** (`allocate_sequences`, vt 5).
5. Kirjuta iga leht **kirjutus-atomaarselt** (vt 7 temp-staging + cleanup), **ühe faili
   kaupa**: dekodeeri/teisenda → kirjuta → `img.close()` + vabasta viited (GC saab mälu
   kohe vabastada), alles siis järgmine. Esimene sorditud fail → väikseim sequence.
6. **Üks git-commit** kogu partiile (`save_with_git` + `additional_files`: kõik `.txt`
   + `.json`, sh renumberdamisel muudetud olemasolevad `.json`-id).
7. **Meili sync** (vt 8 — viga ei tühista juba salvestatut).
8. Tagasta `{status, new_page_count, inserted:[{filename, sequence}], meili_warning?}`.

**Mälu-eelarve (oluline):** `CHUNK_MAX_BYTES ≈ 200 MB` piirab **tihendatud** mahtu, mitte
lahtipakitut. Üks 10 MB / 6000×8000 px JPEG võtab dekodeerituna ~144 MB RGB-pikseleid;
20 sellist korraga = 2–3 GB. Seetõttu **ei tohi** kõiki faile korraga dekodeerida —
nii valideerimine (mõõtmete kontroll) kui kirjutamine käivad **ühe faili kaupa**, iga
`Image` objekt suletakse kohe. Mälus korraga: kogu partii tihendatud baidid (≤200 MB) +
**üks** dekodeeritud pilt.

### 5. Järjekorranumbrite jaotamine — `allocate_sequences(...)`

Uus abifunktsioon `admin_page_ops.py`-s. Sisend: teose tee, `after_page_num`, N.
Väljund: N **rangelt kasvavat** täisarvu õigesse pessa + (vajadusel) info, et tehti
täielik ümbernummerdamine.

Arvuta `seq_before` / `seq_after` valitud positsiooni kohta (sama `seq_of`-loogika:
algusesse / lõppu / vahele).

- **Pesa mahutab N** (st `gap = seq_after - seq_before > N`): jaota **täisarvulise
  jagamisega** (mitte `round()`, mis annab duplikaate):
  ```
  seq_k = seq_before + (gap * k) // (N + 1)   # k = 1..N
  ```
  Tingimusel `gap > N` on tulemused rangelt kasvavad ja jäävad `(seq_before, seq_after)`
  vahele.
- **Pesa EI mahuta N** (suur partii): **nummerda kogu teos koos uute lehtedega ümber**
  sammuga 100. Ehita ühendatud järjestus (olemasolevad lehed + N uut splaisitud
  positsioonile P), anna kõigile `sequence = (i+1)·100`. Töötab suvalise N korral.
  **Olemasolevate lehtede `.json`-id loetakse sisse ja muudetakse ainult `sequence`
  (ülejäänud metadata säilib — sama muster nagu `rebalance_sequences`).**

**Servajuhud (kõik testitud):**
- Tühi teos + mitu faili.
- `after_page_num = 0` (algusesse).
- `after_page_num = -1` (lõppu), sh suur partii.
- `after_page_num > lehtede arv` (või < -1) → **400** (vahemikukontroll endpoint'is,
  enne `allocate_sequences`; vt 4 samm 0). `allocate_sequences` ise eeldab kehtivat sisendit.
- Puuduv/vigane `sequence` mõnes vanas `.json`-is → fallback positsioonile (nagu praegu).
- Olemasolev `.json` muude väljadega → säilita kõik peale `sequence`.

### 6. Per-lehe kirjutamine + pilditeisendus — jagatud helperid

Tõsta `main.py` `admin_add_page`-st välja `admin_page_ops.py`-sse:

```
detect_and_convert_image(content) -> (jpeg_bytes, ext)   # magic bytes + PNG→JPG
write_new_page(path, folder_name, work_id, content, ext, seq) -> {filename, txt_path, json_path, page_meta}
```

- `detect_and_convert_image`: JPG → tagasta nagu on; PNG → teisenda. **Säilita praegune
  käitumine** (üks helper, kasutab nii single kui bulk), v.a teadlik parandus:
  - **Läbipaistvus → valge taust.** `convert('RGB')` üksi annab RGBA puhul **musta**
    tausta. Korrektne flatten nõuab RGBA-režiimi mõlemal pildil ja katab ka `LA` ning
    `P`+transparency juhud:
    ```python
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        alpha = img.convert('RGBA')
        background = Image.new('RGBA', alpha.size, (255, 255, 255, 255))
        img = Image.alpha_composite(background, alpha).convert('RGB')
    else:
        img = img.convert('RGB')
    ```
    **See parandus rakendub MÕLEMALE teele** (single + bulk), et käitumine jääks ühtseks.
  - `Image.MAX_IMAGE_PIXELS` + `MAX_DIMENSION` (laius/kõrgus ≤ 10000 px) kontroll
    (decompression-bomb + liiga suure pildi kaitse) — ületus → viga.
  - **Mälu:** sulge `Image` objekt (`img.close()`) ja vabasta viited kohe pärast
    teisendust; ära hoia dekodeeritud pikseleid kauem kui vaja.
  - EXIF-orientatsioon / ICC / quality: säilita praegune (quality=95, EXIF/ICC praegu
    ei käsitleta — **ei muuda käitumist selles töös**, dokumenteeri kui teadlik valik).
- `write_new_page`: genereeri ainulaadne nimi `{folder_name}-{work_id}-{nanoid}{ext}`
  (kollisioonikontroll); kirjuta pilt (`0o644`), tühi `.txt` (`0o644`), minimaalne
  `.json` `{sequence, status:"Toores"}` (`0o644`). **Ei** committi ega synci — kutsuja
  koondab. Tagasta failiteed.

### 7. Atomaarsus ja work-level lukk

**Kaks taset:**

- **Valideerimis-atomaarsus:** mõni fail vale → 400, kettale midagi ei kirjutata
  (kõik valideeritakse enne kirjutamist).
- **Kirjutus-atomaarsus (temp-staging + cleanup):** kirjutamise/teisendamise ajal tekkiv
  viga (sh ketas täis, õigused) ei tohi jätta poolikut seisu:
  1. Genereeri kõik sihtnimed ette.
  2. **Staging:** kirjuta uued failid esmalt **temp-alamkausta teose kataloogi sees**
     (nt `{workdir}/.tmp-bulk-{nanoid}/`), MITTE `/tmp`-sse. Põhjus: `os.replace`/`os.rename`
     on atomaarne ainult **sama failisüsteemi** piires; teose kaust ja `/tmp` võivad olla
     eri mountidel.
  3. Hoia **mälus backup** igast muudetavast olemasolevast `.json`-ist (renumberdamine).
  4. Pärast kõigi failide edukat staging'ut: `os.replace` igaüks lõplikku asukohta;
     uuenda olemasolevad `.json`-id.
  5. **Vea (exception) korral:** kustuta temp-kaust + juba lõppasukohta liigutatud uued
     failid + **taasta** muudetud `.json`-id mälu-backup'ist. Seejärel re-raise → 500.
  6. **Cleanup ise peab olema robustne:** mähi `try/except`-i; kui kustutus/taastamine
     ebaõnnestub (nt ketas täis), logi `logger.critical(...)` (failinimed + work_id), et
     admin saaks käsitsi sekkuda. Cleanup-viga EI varjuta algset viga.

**Work-level lukk** (eraldi alamülesanne, oma testidega):
- **Failipõhine lukk** (`fcntl.flock` per-teose lukufailil, nt `{workdir}/.vutt-lock`) +
  in-process `threading.Lock` sõnastik (sama muster nagu `cache.py`/`auth.py`).
  - *Põhjus faililukule:* `threading.Lock` serialiseerib ainult **ühe protsessi** lõimi.
    CLAUDE.md TODO näeb ette tuleviku üleminekut **gunicorn mitme workerini** — siis ei
    kaitseks mälupõhine lukk eri protsesside vahel (failisüsteemi race). `fcntl.flock`
    (POSIX advisory lock, server on Linux) töötab ka mitme workeri/konteineri puhul.
  - In-process `threading.Lock` on kiire eeskiht, mis serialiseerib lõimed selle workeri
    sees; `flock` katab protsessidevahelise.
- **Rakendub KÕIGILE mutleerivatele lehe-operatsioonidele:** `add-page`, `add-pages`,
  `delete /page/{n}`, `replace-image`, `split`, `transform`, `reorder-pages`.
- Põhjendus: chunk-aritmeetika (`P+K`) on korrektne ainult siis, kui keegi teine ei
  muuda sama teose lehti samal ajal. Lukk ainult `add-pages`-il ei kaitseks paralleelse
  delete/reorder eest.

### 8. Git ja Meilisearch

- "Partii" = **üks endpoint-request** (mitte kogu kasutaja valitud komplekt). Üks
  commit + üks sync request'i kohta.
- **Meili-sync ebaõnnestumine PÄRAST edukat git-commiti:** ÄRA tagasta 500 (kasutaja
  vajutaks uuesti → duplikaadid). Püüa erind kinni, tagasta
  `{status:"success", meili_warning: "..."}`. Failid + metadata + commit on alles;
  Meili saab hiljem re-sync'ida (nt järgmisel salvestusel või `server_seed_data.sh`).
  Frontend kuvab hoiatuse, AGA loeb partii õnnestunuks (ei korda).

### 9. Vana `add-page` — teadlik lahknevus

Refaktori kontrollpunkt (samm 4) nõuab, et ühe-lehe `add-page` käituks **täpselt nagu
enne**. Seetõttu:
- `add-page` säilitab **leebe** `after_page_num` käitumise (`>= page_count` → lõppu),
  nagu praegu.
- Uus `add-pages` on **range** (vahemikust väljas → 400, vt 4 samm 0).

See lahknevus on teadlik: bulk on chunk'itud ja paralleelsuse suhtes tundlikum, seega
vajab ranget kontrolli; single jääb tagasiühilduvuse mõttes muutmata.

## Konstandid (fikseeri implementatsioonis)

| Konstant | Asukoht | Soovituslik väärtus |
|----------|---------|---------------------|
| `MAX_FILES_PER_REQUEST` | backend | 20 |
| `MAX_REQUEST_BYTES` | backend | ~200 MB |
| `MAX_SINGLE_FILE_BYTES` | backend | nt 50 MB |
| `MAX_DIMENSION` (laius/kõrgus) | backend | 10000 px |
| `Image.MAX_IMAGE_PIXELS` | backend | nt 1.5× (10000×10000) või Pillow default |
| `CHUNK_MAX_FILES` | frontend | 20 (= backend limiit) |
| `CHUNK_MAX_BYTES` | frontend | ~200 MB (≤ backend `MAX_REQUEST_BYTES`) |

Frontend'i ja backend'i limiidid peavad **kokku langema** (frontend tükeldab nii, et iga
partii jääb backend'i limiidi sisse; backend on viimane kaitseliin).

## Veakäsitluse kokkuvõte

| Olukord | Käitumine |
|---------|-----------|
| `after_page_num` vahemikust väljas (> lehtede arv või < -1) | 400 |
| Toetamata failitüüp partiis | 400, vigase faili nimi; midagi ei kirjutata |
| Limiit ületatud (arv/maht/pikslid/mõõtmed) | 400 |
| Pesa ei mahuta N | Kogu teose ümbernummerdamine (mitte viga) |
| I/O-viga kirjutamise ajal | Temp-staging cleanup: kustuta uued, taasta `.json`-id; 500 |
| Cleanup ise ebaõnnestub | `logger.critical` (failid + work_id); algne viga edasi |
| Git-commit ebaõnnestub | Cleanup nagu I/O-viga; 500 |
| Meili-sync ebaõnnestub (post-commit) | `success` + `meili_warning`; ei tühista |
| Partii ebaõnnestub keskel (frontend) | Peatu; näita lisatud arv + chunk + serveri viga; `loadPages()` |
| Teost ei leitud | 404 |
| Paralleelne sama-teose mutatsioon | Serialiseeritud work-lukuga (flock + threading) |

## Testimine

**Backend (`tests/`):**
- `natural_sort_key`: `scan_2/scan_10/scan_02`, suured/väikesed tähed, täpitähed (NFC),
  juhtnullid, viigi-determinism; **tokeniseerimise servajuhud** (`2.jpg`→`['','2','.jpg']`,
  `.2`, `2`, `a2b`, `2a`) — peavad JS-poolega kokku langema.
- `allocate_sequences`: keskele / algusesse / lõppu — õiged rangelt kasvavad väärtused
  (täisarvuline jagamine, mitte round).
- Ümbernummerdamise tee: suur N (nt 200) → kõik kasvavad, olemasolevad lehed õiges
  järjekorras, **olemasoleva `.json` muud väljad säilivad**.
- `after_page_num = -1` suure partiiga; tühi teos + mitu faili; vigane/puuduv `sequence`
  vanas `.json`-is.
- **Vahemikukontroll:** `after_page_num` > lehtede arv (või < -1) → 400.
- Partii tagasilükkamine: üks toetamata fail → 400, kettale midagi ei kirjutata.
- **Limiidid:** failide arv / kogumaht / üksikfaili maht / `MAX_IMAGE_PIXELS` /
  `MAX_DIMENSION` ületus → 400.
- `detect_and_convert_image`: läbipaistev PNG (`RGBA`), `LA`, `P`+transparency →
  **valge** taust (mitte must); `MAX_IMAGE_PIXELS`/`MAX_DIMENSION` ületus → viga.
- `write_new_page`: loob pildi + `.txt` + `.json` õigete õigustega, ei committi.
- Kirjutus-atomaarsus: simuleeri viga keskel → temp-kaust + poolikud failid koristatud,
  `.json`-id taastatud; **cleanup-vea simulatsioon → `logger.critical` kutsutakse**.
- **Mälu/sekventsiaalsus:** veendu, et korraga on dekodeeritud ≤1 pilt (nt mock'i
  `Image.open`, loenda samaaegseid avatud objekte) — ei dekodeeri kõiki korraga.
- Work-lukk: paralleelne add-pages + delete sama teosesse serialiseerub korrektselt.

**Frontend:**
- Chunk-aritmeetika (`P+K`): algusesse / keskele / lõppu, mitu chunk'i.
- Maht-põhine tükeldamine (suured failid).
- Osalise vea kuva.

## Failid

| Fail | Muudatus |
|------|----------|
| `src/pages/WorkManage.tsx` | `multiple` väli, kärbitud sorditud eelvaade, tükeldav handler (arv+maht), progress, lukustus, osaline viga |
| `src/utils/` (uus, nt `naturalSort.ts`) | `naturalSortKey` (jagatud, testitud) |
| `src/locales/{et,en}/*.json` | uued i18n võtmed |
| `server/main.py` | uus `add-pages` endpoint; `add-page` ümber jagatud helperitele; work-lukk kõigil mutleerivatel endpointidel |
| `server/admin_page_ops.py` | `detect_and_convert_image`, `write_new_page`, `allocate_sequences`, ümbernummerdamise tee, `natural_sort_key`, work-lukk dict |
| `tests/` | backend testid (vt eespool) |

## Implementatsiooni järjekord (refaktor enne laiendust)

1. **Refaktor (käitumist EI muuda):** tõsta olemasoleva ühe-lehe lisamise
   valideerimine + teisendus + kirjutamine helperitesse (`detect_and_convert_image`,
   `write_new_page`).
2. `write_new_page` + `detect_and_convert_image` testidega (sh PNG/LA/P valge-taust,
   `MAX_IMAGE_PIXELS` + `MAX_DIMENSION`, `img.close()` mälukäitumine).
3. `allocate_sequences` (ilma bulk-endpointita) + servajuhu-testid.
4. Kirjuta vana `add-page` ümber uutele helperitele. **Kontrollpunkt:** ühe-lehe
   lisamine töötab täpselt nagu enne (sh leebe `after_page_num`, vt 9).
5. `natural_sort_key` mõlemas otsas (`src/utils/naturalSort.ts` + Python) + tokeniseerimise
   pariteedi-testid.
6. Uus `add-pages` endpoint (vahemikukontroll, limiidid, sekventsiaalne valideerimine,
   sort, allocate, temp-staging + cleanup, üks commit, meili-warning semantika).
7. Frontend: `multiple`, kärbitud eelvaade, chunk-upload (arv+maht), positsiooni-aritmeetika.
8. Work-level lukk (`fcntl.flock` + `threading.Lock`) kõigil mutleerivatel endpointidel
   + testid.
9. UX-lihv: progress, osaline viga, tühistus, lukustus, i18n.

## Deploy

Backend (Docker, `--no-cache`) + frontend (`npm run build` + `rsync`). Meili-skeem ei
muutu. Vt CLAUDE.md / MEMORY.md deploy-samme. Nginx `client_max_body_size 600M` jääb;
frontend hoiab partiid sellest tublisti allpool (`CHUNK_MAX_BYTES ≈ 200 MB`).
