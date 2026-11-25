# 0089 — Lehestiku asendus: taastatavus, kirjutuskaitse ja transkriptsiooni aluse vahetus

**Staatus:** vastu võetud 2026-11-25

## Kontekst

Teose kogu lehestiku asendus (`replace_work_content`, upload „Asenda sisu") oli kirjutatud
eeldusega, et see õnnestub ühe hooga. Aluse vahetuse disaini kolm ülevaatust
(`docs/superpowers/specs/2026-11-25-transkriptsiooni-aluse-vahetus-design.md`) leidsid
olemasolevas asenduses vead, mis on tootmises juba praegu:

- asendus võttis sihtteose ID URL-ist ega võrrelnud seda üleslaadimisse salvestatud
  `replace_work_id`-ga;
- rollback (`git checkout old_head -- slug`) jättis alles uued, juba stage'itud failid ning JPG-d
  (gitist väljas, vana ja uus leht sama failinimega) ei olnud taastamises arvestatud;
- `work_lock` kaob koos protsessiga — katkestuse järel võisid `/save` ja lehetoimingud jätkata
  poolikul lehestikul;
- uued lehed saavad samad tüved kui vanad: vana lehe pealt avatud redaktori salvestus liideti
  kolmesuunaliselt (ADR 0054) uue lehe peale; `/save` kontrollis lehe olemasolu enne lehe lukku;
- `sync_work_parts` jättis osadesse kõik tüved, mis esinevad ka uues lehestikus — osad viitasid
  vaikselt teise sisuga lehtedele.

Lisaks vajab eksemplari kiht (ADR 0076, 0079) tööriista, mis teeb teise eksemplari piltidest
teose lehestiku („Tee transkriptsiooni aluseks").

## Otsus

### 1. Asenduse sidumine

`replace-work/{work_id}` nõuab, et URL-i `work_id` == state'i `replace_work_id`; muidu 409.

### 2. Asendusmärk ja kirjutuskaitse

Enne esimest failimuutust kirjutatakse `state/work_replacing/{slug}.json` (`{upload_id, at}`)
ja eemaldatakse pärast edukat avaldamist (uued lehed + `content_generation` kirjas) või
taastamise lõppu. Märgi olemasolul lükkavad `page_lock` ja `work_lock` tagasi kõik peale märgi
omaniku (`WorkReplacingError` → 409). Serveri käivitusel taastatakse/tuvastatakse kõik märgid.

### 3. Taastatav asendus

- Taasteinfo (`replace_progress`: `phase`, `old_head`, `trash_dir`, `old_jpgs`, `new_files`)
  kirjutatakse upload state'i enne esimest failimuutust.
- Asenduse commit kannab treilerit `Upload: <upload_id>`; katkestuse järel otsustab kordus selle
  järgi, kas asendus on tehtud.
- Taastamine eemaldab jälgitavad failid, mida `old_head`-is ei ole, ja teeb `git checkout
  old_head -- slug`. **JPG-d** taastatakse prügikasti oleku järgi: vana fail prügikastis →
  algses asukohas olev samanimeline fail on uus (kustuta, too vana tagasi); vana fail ei jõudnud
  prügikasti → jäta puutumata. JPG kustutatakse ainult siis, kui tema vana vaste on prügikastis.

### 4. Lehe põlvkond

Asendus kirjutab iga uue lehe JSON-i serverivälja `content_generation`
(`SERVERIPOOLSED_LEHE_VALJAD`). `/save` võrdleb leheluku SEES kliendi `meta_content`-i
`content_generation`-it ketta omaga ja kontrollib lehe olemasolu samas lukus; erinev → 409
„lehestik asendati, laadi leht uuesti" (ADR 0077 mustri järgi, mitte kolmesuunaline liitmine).

### 5. Osad asendusel

Kogu lehestiku asendusel: iga osa `pages = []`, `needs_review: true`, serveriväli
`pages_before_replace: {at, page_numbers}`. Lehtede uuesti määramine kustutab välja.

### 6. Transkriptsiooni aluse vahetus

Eksemplari pildid → asendusrežiimis üleslaadimine (`promote`), lõpetamine idempotentselt
(vanad lehed oma päritolu eksemplari alla allikaliigiga `former_pages`, tunnistaja märge, ainult
täielikult commit'itud lähtepiltide eemaldus). Täpsus: disainifail. **Teostatud** (PR 2,
`docs/superpowers/plans/2026-11-26-aluse-vahetus.md`): `server/promote.py` (eelvaade, algus,
lõppkontroll `recheck_locked` lehelukkude all, kohustuslik `finish_locked`), `former_pages` on
serveri sisemine allikaliik (`exemplar_images.add_internal`/`remove_images_internal`, klient ei
saa seda saata). Märk kannab kogu lõpetamise info (`promote`, `old_pages`, `remove_source_ids`);
aluse vahetus ei muuda teose metaandmeid ega töökollektsioone. Lõpetamine teose järgi:
`POST /admin/work/{id}/replace/finish` (`upload_id` peab olema märgi oma, muidu `stale`;
tulemus `replaced`/`restored`/`cleared` eraldi); 409 järel uus kinnitus
`POST /admin/upload/{id}/promote/confirm`.

### Täiendus 2026-11-25 (PR #881 ülevaatus)

- Järjekord: märk → vanade lehtede lukud → paarid → `old_head`. Salvestus, mis hoidis lehelukku,
  jõuab commit'ini enne taastepunkti.
- Vanad lehed eemaldatakse ainult töökaustast; indeks muutub alles lõpliku commit'iga (teised
  kirjutajad commitivad ühist indeksit `repo.index.commit`-iga).
- Commit'i tõrge = taastamine + 500. Asenduse metaandmete uuendus pärast lehestiku commit'i.
- Taastamine puudutab ainult vanu lehefaile (`old_tracked`), mitte `_metadata.json`-i; tõrkel
  `RestoreError` → märk ja taasteinfo jäävad.
- Taasteinfo koopia märgifailis; asenduse ajal üleslaadimise tühistus → 409.
- Võtmeta `/save` (vana kimp) on lubatud ainult lehel, millel kettal põlvkonda pole.
- Asenduse commit on `git commit --only -- slug` (mitte `repo.index.commit`): ainult selle teose
  failid; tõrkel `git reset HEAD -- slug` sama git-luku all.
- Uus asenduskatse (ka sama üleslaadimise oma) taastab/lõpetab enne pooleli asenduse; kui see ei
  õnnestu → 409.
- Git-ajaloo lugemisviga ≠ „commit'i pole": `commit_unknown`, märk ja taasteinfo jäävad.
- Üleslaadimise metaandmed rakendatakse järelsammus (`_after_replace_commit`), mida kordab ka taaste.

### Täiendus 2026-11-25, 3. voor — taastemudel

Kolm parandusvooru näitasid, et vana seisu git'ist tuletamine ei kata kettal olevat seisu
(nt `/save`-i commitimata tekst). Uus mudel:

- **Vana seis on kettal:** KÕIK vanad lehefailid (`.txt`, `.json`, `.jpg`, mitte `_metadata.json`)
  liiguvad prügikasti (`rename`); taastamine toob need tagasi ja kustutab uued. `git checkout`-i
  ei ole.
- **Git on avaldamise samm:** ühist indeksit puudutatakse alles lõplikus commit'is
  (`add -A -- slug` + `commit --only -- slug`); taastamine teeb `git reset HEAD -- slug`.
- **Käivitusaegne taaste jookseb lifespan'is sünkroonselt enne päringuid** (katkestuse järel võib
  indeksis olla asenduse `git add`).
- **Märgi kontroll ja uus katse sama teoseluku all** (`recover_locked`).
- **Osade nullimine on kohustuslik järelsamm** (`AfterStepError`): tõrkel jääb märk (faas
  `replaced`) ja taaste kordab; muud järelsammud on parimal katsel.
- (4. voor) Taaste tegutseb AINULT selle asenduse aktiivse märgi olemasolul (hilinenud taaste ei
  pööra tagasi pärast lõpetamist tehtud muudatusi). `replacing`-faasis viiakse teose kausta indeks
  esimesena HEAD-ile — ka siis, kui commit'i olemasolu jääb ebaselgeks. Igal katsel oma tühi
  prügikasti kaust (`{ts}-{upload_id}-{juhuslik}`). Vanad pildid sama reegliga mis leheloend
  (.jpg/.jpeg/.png, suurtähtedega ja ilma).
- (5. voor) Lõplik commit käib **ajutise indeksiga** (`GIT_INDEX_FILE`: read-tree HEAD → add slug →
  write-tree → commit-tree → update-ref CAS-iga); ühine indeks ei näe asenduse ettevalmistust
  kunagi. Pärast update-ref'i sünkroonitakse ühise indeksi teose kaust HEAD-iga; selle akna
  katab käivitusaegne taaste. Kui käivitusaegne taaste ei saa indeksit sünkroonida
  (`index_failed`), **server ei käivitu**. Teose kustutus võtab teose luku enne `metadata_lock`-i
  (pooleli asendus → 409).
- (järelparandus) HEAD-i uuendus on avaldamise piir. Enne `update-ref`-i märgitakse teose indeksi sünk
  ootele (`state/git_index_sync_pending.json`); `git_write_lock` proovib välimisel võtmisel ootel
  sünki ja keeldub (`GitIndexSyncError`), kui see ei õnnestu — vananenud indeksit ei commiti keegi.
  Käivitusaegne taaste teeb sama (tõrkel server ei käivitu). Ajutise indeksi eemalduse tõrge
  pärast avaldamist on ainult hoiatus.

## Tagajärjed

- Asendus on aeglasem ja keerukam, aga katkestus ei jäta enam teost poolikusse seisu.
- Pärast asendust saavad avatud redaktorid 409 ja peavad lehe uuesti laadima.
- Asendusega teose osad vajavad toimetaja ülevaatust (lehed tuleb uuesti määrata).
- Uus serveri lehe-väli `content_generation` ja osa väli `pages_before_replace`.
