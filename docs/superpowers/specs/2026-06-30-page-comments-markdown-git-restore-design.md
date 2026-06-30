# Lehekülje kommentaaride markdown-tugi + git-versiooniajaloo taaste

**Kuupäev:** 2026-06-30
**Staatus:** Disain (heaks kiidetud, ootab plaani)

## Probleem ja motivatsioon

Lehekülje kommentaarid (`comments` väli lehe `.json`-is) sisaldavad sageli
väärtuslikku sisu — kasutajate kirjutatud tõlkeid jms. Praegu:

- **Andmed on juba git'is:** iga lehe-`/save` commitib lehe `.json` faili, mis
  sisaldab `comments`-massiivi (koos vastustega). Vana seis on git-ajaloos alati
  olemas ja `get_file_at_commit`-iga loetav.
- **Aga taastamise teed kommentaaridele ei ole.** `/git-restore`
  (`server/routers/editing.py`) taastab teadlikult ainult `.txt` teksti +
  `text_annotations`; `comments` jäetakse puutumata. Kui keegi kustutab või
  kirjutab tõlke üle, ei too ükski UI-nupp seda tagasi (peale käsitsi git-arheoloogia).

Kustutamise üle pole keegi kaevanud — see on **ennetav** töö, kuna kommentaaridesse
on tihti palju tööd sisse pandud.

Lisaks: prosopograafia eluloo/märkmete väljadel on juba markdown-tugi
(`MarkdownEditor` + `MarkdownView`, vt
[2026-06-29-markdown-notes-editor-design.md](2026-06-29-markdown-notes-editor-design.md)).
**Pariteedi pärast** peaks sama tugi olema ka lehekülje kommentaaridel.

## Ulatuse otsused

| Teema | Otsus |
|-------|-------|
| Taaste katvus | Kustutatud kommentaarid **ja** muudetud (ülekirjutatud) kommentaari **põhiteksti** versiooniajalugu |
| Markdown ulatus | Kommentaari põhitekst (`Annotation.text`) **+** vastused (`AnnotationReply.text`). EI puuduta `text_annotations` (lühikesed inline-märkused). |
| Taaste-UI asukoht | Inline "Ajalugu" nupp/kella-ikoon kommentaari juures + eraldi klapitav kaart "Kustutatud kommentaarid" all |
| Backend-mehhanism | On-demand git-walk (ainus tõeallikas git; 0 uut salvestust ega indeksit) |
| Õigus | Taaste ja markdown-muutmine: `editor`+ (sama kui kommentaaride praegune muutmine) |

### Kasutaja-nähtavad regressiooniriskid (eksplitsiitsed eesmärgid)

Need EI ole "nice to have", vaid disaini eesmärgid — algne motivatsioon (väärtuslik
sisu, pikad URL-id) tähendab, et need peavad olema lahendatud:

1. **Vanade plain-text kommentaaride reavahetused.** `MarkdownView` ei kasuta
   praegu `remark-breaks`-i (kontrollitud) → standardne markdown tõmbab üksikud
   reavahetused kokku. Vanad plain-text kommentaarid, kus kasutaja vajutas Enter,
   muutuksid visuaalselt. **Lahendus:** `MarkdownView` saab valikulise prop'i
   `softBreaks?: boolean` (lisab `remark-breaks` plugina **ainult kui `true`**);
   kommentaaride vaade kasutab `softBreaks`, prosopo jääb muutmata. Single newline
   → `<br>` (`br` on juba allow-listis). **Uus sõltuvus:** `npm install remark-breaks`
   (pole veel installitud; `rehype-raw` on package.json-is, aga `MarkdownView` ei
   kasuta seda — turvalisus, ära too sisse).
2. **Pikad URL-id.** Markdown lubab ilusamaid linke, aga palja pika lingi kleepimine
   võib endiselt layout'i lõhkuda. **Lahendus:** kommentaaride markdown-vaate
   konteinerile CSS `overflow-wrap: anywhere; word-break: break-word` (Tailwind
   `break-words` + vajadusel `[overflow-wrap:anywhere]`, või `.vutt-md` kõrval eraldi
   kommentaari-klass).

## Olemasolev kontekst (koodi-leiud)

- **Andmemudel** (`src/types.ts`):
  - `Annotation { id, text, author, author_username?, created_at, replies?: AnnotationReply[] }`
  - `AnnotationReply { id, text, author, author_username, created_at }`
  - `text_annotations: TextAnnotation[]` — eraldi inline-highlightide kommentaarid (ei kuulu skoopi).
- **Kommentaaride operatsioonid** (`src/components/editor/AnnotationsTab.tsx`):
  lisa (`addComment`), muuda `text` (`saveEditComment` — kirjutab üle), kustuta
  (`removeComment`), vasta (`saveReply` → `/page-comments/reply` endpoint).
- **Püsivus:** kommentaarid salvestuvad läbi tavalise lehe-`/save`
  (`handleSaveAnnotations` → `onSave` → meta_content sisaldab `comments`).
  Seega kommentaaride iga seis on lehe `.json` git-commitis.
- **Git-helperid** (`server/git_ops.py`): `get_file_git_history(paths, max_count)`
  → commitide nimekiri; `get_file_at_commit(path, hash)` → faili sisu commitis;
  `save_with_git(...)` → salvestus + commit.
- **Meilisearch** (`server/meili_doc.py`): `comments` läheb indeksisse objektidena
  (`has_annotations` + otsing). Markdown-süntaks jääb objektidesse (vt allpool).
- **Markdown-komponendid** (`src/components/`): `MarkdownEditor`
  (`{ value, onChange, placeholder?, minRows?, id?, disabled? }`) ja `MarkdownView`
  (`{ content, className? }`, allow-list, XSS-kindel, ei kasuta `rehype-raw`-i;
  **ega `remark-breaks`-i** → lisame valikulise `softBreaks` prop'i, vt risk 1).

## Lahendus

### 1. Markdown-pool

**`AnnotationsTab.tsx`:**

- **Sisestus:** kommentaari lisamise/muutmise `<textarea>` ja vastuse `<textarea>`
  asenduvad `MarkdownEditor`-iga.
- **Renderdus:** kommentaari `text`-kuva (`<p>{comment.text}</p>`) ja vastuse
  tekstikuva → `MarkdownView` `softBreaks`-iga + kommentaari-klassiga (URL-wrap).
  - **DOM-detail:** `MarkdownView` renderdab ise `<div>` + plokk-elemente
    (`<p>`, `<ul>`, `<h3>` jms). **EI tohi** asendada `<p>{comment.text}</p>` nii,
    et `MarkdownView` jääks olemasoleva `<p>` sisse (invalid HTML / CSS-anomaalia).
    Wrapper peab olema `<div>` (või eemalda ümbritsev `<p>`).
- **Tekst-annotatsioonid jäävad muutmata** (plain `<textarea>` + plain kuva).
- **Kontrollpunkt (manuaalne + smoke-test):** veendu, et vanade plain-text
  kommentaaride reavahetused renderduvad ootuspäraselt (`softBreaks`); pikk palja
  URL ei lõhu layout'i; loend/link/paks renderduvad korrektselt.

**Muutumatu:**

- `text` jääb markdown-stringiks lehe `.json`-is. Backend, andmemudel,
  Meilisearch-skeem ega migratsioon ei muutu (vanad plain-text kommentaarid
  renderduvad markdown'ina korrektselt — tavaline tekst on kehtiv markdown).
- **Otsingu-mõju:** Meilisearchi `comments`-objektidesse jääb markdown-süntaks
  (`**`, `[..](..)`) — sama olukord nagu prosopo `notes`/`biography` puhul,
  aktsepteeritav. Reindeksit ei vaja; uued salvestused sünkivad niikuinii.

**i18n:** olemasolevad kommentaaride võtmed; vajadusel `common` namespace
markdown-redaktori jagatud nuppudele (juba olemas prosopost).

### 2. Backend — kaks uut endpointi

Lisatakse `server/routers/editing.py`-sse, kõrvuti `/git-history`, `/git-restore`.

#### `POST /page-comments/history` (require_role `editor`)

**Sisend:** `{ original_path, file_name }`

**Terminoloogia:** `file_name` on API-väli (request body); backendis `filename`
muutuja. Lehe `.json` tee: `os.path.splitext(filename)[0] + ".json"`.

**Loogika:**

1. **Turvavalideerimine** (vt allpool "Turvalisus"): `file_name` peab olema
   basename; JSON-tee peab jääma teose kataloogi piiresse.
2. `get_file_git_history(json_path, max_count=100)` → commitide nimekiri
   **uusimast vanimani**. Kui ajalugu jõuab `max_count`-ni → `truncated = true`.
3. Loe **praegune** `comments` (kettalt) → praeguste id-de ja `text`-ide hulk.
4. Käi commitid läbi **uusimast vanimani**; iga commiti kohta
   `get_file_at_commit(json_path, hash)` → parsi `comments`.
   - Toeta nii uut (`comments` juurtasandil) kui `meta_content.comments`
     struktuuri (`source = d.get("meta_content", d)` muster).
   - Vigane JSON / puuduv `comments` selles commitis → **skip see commit**, ära
     katkesta kogu päringut.
5. Ehita kaks struktuuri:
   - **`versions`**: `{ commentId: [{ commit_hash, timestamp, author, text }] }`.
     Semantika (UI jaoks puhas): **sisaldab AINULT ajaloolisi versioone, mis
     erinevad praegusest `text`-ist.** Dedup: käies uusimast vanimani, lisa
     versioon ainult kui selle `text` erineb eelmisest **lisatud** versioonist;
     praegust (kettal olevat) `text`-i versiooni hulka EI lisata. Nii ei teki
     segadust, kas `versions[id]` sisaldab praegust teksti — ei sisalda.
   - **`deleted`**: `[{ id, text, author, created_at, replies, last_seen_commit }]` —
     id-d, mis esinevad ajaloos, aga **puuduvad praegusest seisust** (praegune seis
     on tõe-alus: kui praegu puudub, aga ajaloos esineb → `deleted`). Käies uusimast
     vanimani, esimene commit kus id taas ilmub = **viimane seis enne kustutamist**;
     säilita see (sisu + `replies`).

**Väljund:** `{ status: "success", versions, deleted, truncated }`

**Jõudlus:** lehe-ajalood on tavaliselt lühikesed; `max_count=100` katab äärmusjuhud.
Laetakse laisalt (alles UI avamisel), mitte lehe laadimisel. `truncated` annab
kasutajale ausa signaali, et vanemat ajalugu pole skännitud (vt UI).

#### `POST /page-comments/restore` (require_role `editor`)

**Sisend:** `{ original_path, file_name, mode, comment_id, commit_hash }`
kus `mode ∈ {"version", "deleted"}`.

**Loogika:**

1. **Turvavalideerimine** (vt allpool): basename-kontroll, tee teose piires,
   `commit_hash` peab kuuluma **selle faili** git-ajalukku.
2. Tuleta `catalog`/path **sama helperiga, mida olemasolev `/save` ja kommentaaride
   salvestus kasutavad** (`os.path.basename(original_path)` + `BASE_DIR`, nagu
   `editing.py` `/save`). Ära dubleeri path-parsimist — vähendab riski, et restore
   salvestab faili, aga reindekseerib vale töö.
3. Loe praegune lehe `.json`.
4. Loe `comment_id`-le vastav kommentaar `commit_hash`-i seisust
   (`get_file_at_commit` + parse).
   - Kui `comment_id` selles commitis puudub → **400/404** (`version` mode'is
     tähendab see, et valitud commit ei sisalda seda kommentaari).
5. - **`version`**: leia praeguses `comments`-massiivis `comment_id`, kirjuta
     selle `text` üle commitist loetuga. **Replies jäävad praeguseks** (ei kao).
     Kui `comment_id` praegu puudub (vahepeal kustutatud) → suuna `deleted`-loogikale
     või tagasta viga (täpsusta plaanis; default: viga, kasuta `deleted` mode'i).
   - **`deleted`**: lisa terve kommentaari-objekt (koos `replies`-iga) praegusesse
     `comments`-massiivi tagasi. **Id-kollisioon** (id on vahepeal uuesti tekkinud) →
     **409 konflikt** (ära kirjuta olemasolevat üle).
6. Salvesta `save_with_git`-iga: lehe `.txt` (muutmata, praegune tekst) +
   uuendatud `.json` `additional_files`-ina, commit-sõnum
   `Restore comment {comment_id}: {commit_hash[:8]}`.
7. `background_tasks.add_task(sync_work_to_meilisearch_async, catalog)`.

**Väljund:** `{ status: "success", comments }` (uuendatud massiiv, et frontend
saaks oleku värskendada).

#### Turvalisus (mõlemad endpointid)

Git-lugemise endpointid tehakse konservatiivseks isegi `editor`+ nõude juures:

- **`file_name` peab olema basename** — ei tohi sisaldada `/`, `..` vms
  (`os.path.basename` + valideeri, et tulemus võrdub sisendiga; muidu 400).
- **JSON-tee peab jääma teose/`BASE_DIR` kataloogi piiresse** (path traversal kaitse,
  nt `os.path.realpath` kontroll).
- **`commit_hash` peab kuuluma selle faili git-ajaloo commitide hulka**, mitte suvaline
  git-objekt — kontrolli `get_file_git_history` tulemuse vastu (muidu 400/403).
- **Vigane / puuduv JSON või `comments` commitis** → skip (history) või 400 (restore),
  vastavalt olukorrale.
- **`comment_id` otsitakse ainult selle faili kommentaaridest** (mitte globaalselt).

### 3. UI

**Laadimise semantika (oluline):** `/page-comments/history` laetakse **laisalt** —
alles siis kui kasutaja avab kella-ikooni VÕI klapitava kaardi esimest korda.
Üks päring katab nii `versions` kui `deleted` (need tulevad samast vastusest).
**Mitte** lehe avamisel automaatselt. Kuni laadimiseni ei tea frontend, kas
kustutatuid on — seega kaart on alati nähtav (kokkuklapitud nupuna), mitte tingitud
`deleted.length`-ist.

**`AnnotationsTab.tsx`:**

- **Inline "Ajalugu" nupp / kella-ikoon** iga olemasoleva kommentaari juures
  (nähtav `editor`+): klikk → laeb (esmakordsel) `/page-comments/history`, näitab
  selle kommentaari `versions[commentId]` laienduses/popoveris. Iga versioon:
  autor + kuupäev + `MarkdownView` eelvaade + nupp **"Taasta see tekst"** → `restore`
  `mode: "version"`. Kui `versions[commentId]` on tühi (pole ajaloolisi erinevaid
  versioone), näita "Varasemaid versioone ei ole" / inaktiivne ikoon.
- **Eraldi klapitav kaart all** (`editor`+), pealkiri **"Kustutatud kommentaarid"**:
  esimene avamine laeb (kui veel laadimata) `/page-comments/history`. Sisu:
  - kui `deleted.length > 0`: loend (autor, kuupäev, `MarkdownView` sisu) + nupp
    **"Taasta kommentaar"** → `restore` `mode: "deleted"`;
  - kui `deleted` tühi: **"Kustutatud kommentaare ei leitud"**;
  - kui `truncated`: väike abitekst **"Näidatakse viimase 100 commiti ajalugu."**
- Pärast taastet: värskenda kohalik `comments`-olek serveri-vastusest
  (tõeallikas server, nagu user-collections-inline-edit mustris).

**Nuppude sõnastus (teadlik):** `version` mode taastab **ainult põhiteksti**, mitte
vastuseid → "Taasta see tekst" / "Taasta kommentaari tekst". `deleted` mode toob
terve kommentaari tagasi → "Taasta kommentaar". See teeb vahe kasutajale selgeks.

**i18n:** `workspace`/`common` namespace, et/en võtmed
(nt `annotations.commentHistory`, `annotations.deletedComments`,
`annotations.restoreText`, `annotations.restoreComment`, `annotations.noDeleted`,
`annotations.historyTruncated`).

**Õigus:** "Ajalugu"-nupp + taaste-kaart ainult `editor`+ (sama kui kommentaaride
muutmine). `MarkdownView` renderdus on kõigile (avalik vaade renderdab
kommentaare niikuinii).

## Komponentide piirid

| Üksus | Mida teeb | Sõltuvused |
|-------|-----------|------------|
| `MarkdownEditor` | Olemasolev, taaskasutatakse muutmata | — |
| `MarkdownView` | Olemasolev; lisandub valikuline `softBreaks` prop (opt-in `remark-breaks`) | `remark-breaks` |
| `/page-comments/history` | Arvutab git-ajaloost kommentaari-versioonid + kustutatud | `git_ops` helperid |
| `/page-comments/restore` | Taastab valitud versiooni/kustutatud kommentaari | `git_ops.save_with_git`, meili sync |
| `AnnotationsTab.tsx` | Markdown-sisestus/-kuva + taaste-UI | uued endpointid, markdown-komponendid |

Backend-endpointid on puhtad funktsioonid git-ajaloo üle — testitavad ilma UI-ta
(anna tee + commitid, kontrolli `versions`/`deleted` struktuuri).

## Mida EI tehta (YAGNI)

- **Eraldi tuletatud ajaloo-indeksit ei looda** — git on ainus tõeallikas.
- **`text_annotations` markdown-tuge ega taastet** ei lisata (lühikesed märkused).
- **Vastuste (`replies`) eraldi taaste/versioonimine.** Markdown-tugi laieneb küll
  `AnnotationReply.text` peale (renderdus + sisestus), AGA: kui olemasoleva vastuse
  tekst kirjutatakse üle või vastus kustutatakse, **v1 ei paku selle eraldi
  taastamist**. Vastused tulevad tagasi **ainult koos tervenisti kustutatud
  põhikommentaariga** (`deleted` mode). "Kommentaaride ajalugu" ≠ reply-ajalugu.
- **Meilisearch reindeks** pole vajalik (skeem ei muutu).

## Testid

- **Backend (pytest):**
  - `/page-comments/history`:
    - dedup: järjestikused identsed `text`-id ei tekita topeltkirjeid;
    - `versions[id]` sisaldab AINULT praegusest erinevaid ajaloolisi versioone
      (mitte praegust `text`-i);
    - **mitu muudatust + siis kustutamine**: `deleted` võtab **viimase seisu enne
      kustutamist**, mitte esimest ajaloolist versiooni;
    - **kommentaar puudub vahepealses commitis, aga esineb veel vanemas**: praeguse
      seisu suhtes — kui praegu puudub, aga ajaloos esineb → `deleted` (praegune seis
      on tõe-alus);
    - `meta_content`-mähitud ja juur-`comments` struktuurid mõlemad parsitakse;
    - **vigane JSON vanas commitis ei tapa kogu päringut** (skip, ülejäänu töötab);
    - `max_count` cap + `truncated` lipp.
  - `/page-comments/restore`:
    - `version` kirjutab `text` üle, **säilitab replies**;
    - `deleted` lisab terve objekti (koos replies) tagasi;
    - **`version` commitist, kus `comment_id` puudub → 400/404**;
    - **`deleted`, kui id on vahepeal uuesti tekkinud → 409 konflikt**;
    - `commit_hash` ei kuulu selle faili ajalukku → 400/403;
    - `file_name` ei ole basename / path traversal → 400;
    - git-commit tekib; õiguse kontroll (`editor`+).
- **Frontend (typecheck + smoke):** `npm run typecheck` peab läbima.
  - markdown-renderdus kommentaarides + vastustes; `softBreaks` säilitab vanade
    plain-text kommentaaride üksikud reavahetused;
  - pikk palja URL ei lõhu layout'i (URL-wrap klass);
  - vähemalt üks list / link / paks smoke-test renderdub korrektselt;
  - taaste-UI värskendab oleku serveri-vastusest; laisk laadimine (ei laadita lehe
    avamisel).

## Riskid

- **Pika ajalooga leht:** `/page-comments/history` parsib N JSON-faili. Leevendus:
  `max_count` cap + laisk laadimine. Kui osutub aeglaseks, saab hiljem cache'ida.
- **Markdown otsingus:** süntaks jääb Meilisearchi `comments`-objektidesse —
  teadlik aktsepteeritud kompromiss (sama kui prosopo).
