# Lehekülgede hulgivalik: liigutamine ja kustutamine

**Kuupäev:** 2026-06-20
**Leht:** `/work/{workId}/manage` → "Leheküljed" tab (`src/pages/WorkManage.tsx`)
**Roll:** ainult admin (sama kui kogu manage-leht)

## Probleem

Manage-lehel saab praegu lehekülgi liigutada ja kustutada ainult **ükshaaval**:

- **Kustutamine** — iga lehe pisipildil on prügikasti-nupp; üks `DELETE /admin/work/{id}/page/{num}` korraga (eraldi git-commit + Meilisearch reindeks iga lehe kohta).
- **Liigutamine** — igal pisipildil on number-väli + üles/alla nooled; muudatused kogunevad `draftPositions`-mustrisse, salvestatakse `POST /admin/work/{id}/reorder-pages`-iga (üks commit).

Suurte dokumentide (kuni ~500 lk) puhul on mõlemad valusalt aeglased. Lisaks on praegune number-välja semantika segadusttekitav: et viia lk 1 kümnest kõige lõppu, tuleb trükkida `10` (mitte loomulik `11`), sest väli tähendab "millisesse pesasse see leht satub".

## Eesmärk

"Leheküljed" tabis:

1. **Vali mitu lehekülge** (märkeruut, shift-vahemik, "Vali kõik").
2. **Liiguta valitud plokk** uude kohta **sama teose sees**, lihtsa ja ettearvatava "lehe N järele" semantikaga.
3. **Kustuta valitud leheküljed** korraga (üks backend-kutse, üks git-commit, kõik-või-mitte-midagi).

**Skoobist väljas:** lehekülgede liigutamine *teise teosesse* (eraldi, suurem projekt); drag-and-drop (ei skaleeru 500 lk peale); rippmenüü-põhine sihtvalik (nimekiri muutuks hiiglaslikuks).

## Nähtav (effective) järjekord — kogu UI alus

**KÕIK valiku- ja liigutamisoperatsioonid kasutavad `visiblePages` (effective) järjekorda**, mitte serveri algset `page_num`-i:
- kui salvestamata draft'i pole → `visiblePages` = serveri järjekord (`page_num`);
- kui kasutaja on teinud salvestamata reorder-muudatusi → `visiblePages` = **draft-järjekord** (`draftPositions` järgi sorditud).

**Ruudustik renderdab `visiblePages` järjekorras (WYSIWYG)** ja annab lehtedele **nähtavad numbrid `1..pageCount`**. Pärast draft-muudatust plokk **liigub ruudustikus füüsiliselt** ja numbrid renummerduvad nähtavalt — see ON ühtlasi eelvaade.

**Terminoloogia (oluline, et util ja UI ei räägiks eri numbritest):**
- `page_num` — serverist tulnud algne number (muutub alles salvestusel);
- `visiblePageNum` — UI-s nähtav number, mis arvestab draft'i (`1..pageCount` effective järjekorras).

Sihtnumber `N` ja shift-vahemik viitavad ALATI `visiblePageNum`-ile (mida kasutaja ekraanil näeb), MITTE `page_num`-ile.

## Liigutamise semantika — "lehe N järele"

Üks reegel, mis kehtib **kõikjal** (üksiku lehe liigutamine = ploki liigutamine, kus plokis on üks leht):

Sihtnumber `N` tähistab **lehekülge tema NÄHTAVA (visible) numbri järgi**, mille **järele** valitud plokk asetatakse. Ankur tuvastatakse füüsilise lehe identiteedi järgi, seega leitakse see ka pärast valitud lehtede väljavõtmist.

**Algoritm (täpne, ühtne preview ja nupu-keelamisega):**
1. Võta `visiblePages` (effective järjekord, vt ülal); anna nähtavad numbrid `1..pageCount`. `pageCount` = lehtede arv.
2. Plokk = valitud lehed nende praeguses nähtavas järjekorras (säilitab valiku suhtelise järjekorra).
3. Ülejäänud = mittevalitud lehed praeguses nähtavas järjekorras.
4. Tõlgenda sihtnumber `N` **rangelt** (ei lange enam "≥ last" maagiat); `N` = nähtav number:

   ```
   if N tühi VÕI N <= 0:
       → algusesse (ülejäänute ette)
   else if N > pageCount:
       → lõppu (ülejäänute järele)
   else:
       anchor = leht, mille NÄHTAV number (visiblePageNum) === N
       if anchor ∈ valitud:
           → KEHTETU siht (anchorInSelection)
       else:
           → vahetult anchor'i järele
   ```
5. Renummerda 1..n.

**Mida see lahendab:** `N === pageCount` (nt 10) ja nähtav leht 10 EI ole valitud → läheb lõppu (anchor on viimane leht). Aga kui nähtav leht 10 ON valitud, on `10` vasturääkiv → kehtetu. **Lõppu viimiseks alati garanteeritult kasuta `pageCount + 1` (nt 11)** — see > pageCount ja läheb alati lõppu, sõltumata valikust. Nii jääb "lehe N järele" semantika puhtaks, ilma erijuhtude maagiata.

**Sihtnumbri parsimine (lukustatud):** tühi väli VÕI ≤0 → algusesse; muidu täisarvuks (kümnendkohad lõigatakse); mittearv (`NaN`, nt "abc") → **kehtetu** (nupp keelatud, eelvaadet ei kuvata) — MITTE vaikne algusesse.

**Elav eelvaade:** trükkimise ajal kuvatakse välja all täpne sihtkoht, sama loogika alusel mis nupu-keelamine:
- `→ lehtede 9 ja 10 vahele`
- `→ algusesse`
- `→ lõppu`
- (kehtetu) → vihje, eelvaadet pole

**Servajuht — ankur on valikus:** kui `N` osutab valitud lehele, on "Liiguta" keelatud + vihje, mis ütleb lõppu-viimise alternatiivi, nt: *"Sihtleht on valikus; ploki lõppu viimiseks kasuta {pageCount + 1}."*

**Mittejärjestikune valik:** ka hajutatud valik (nt 2, 5, 7) liigub **ühe kompaktse plokina**; valitud lehtede omavaheline järjekord säilib (tulemus `[2,5,7]` ühes tükis). See on tahtlik ja peab eelvaates selge olema.

**Näide (kasutaja oma):** 10 lehte, vali 1–5, trüki 9.
Plokk `[1,2,3,4,5]` välja → ülejäänud `[6,7,8,9,10]` → aseta lehe 9 järele → `[6,7,8,9,1,2,3,4,5,10]` → renummerda. Tulemus: 6,7,8,9 jäävad, valik tuleb nende järele, vana lk 10 jääb lõppu.

## Liides (Leheküljed tab)

**Pisipildi muutused:**
- Lisa **märkeruut** igale pisipildile. Klõps lülitab; **shift-klõps = vahemik** viimasest "ankur-klõpsust" praeguseni. Valitud = rõngas/ring-esiletõst.
- **Eemalda** segadusttekitav pisipildi number-väli + ↵-rakenda-nupp.
- **Säilita** üles/alla nooled (üksammuline nügimine, ühemõtteline).

**Shift-vahemiku valik (ruudustikus):** ruudustik renderdab **`visiblePages`** (effective) järjekorras, seega **massiivi-indeks = visuaalne järjekord** (vasakult-paremalt, ülalt-alla), arvestades juba tehtud draft-muudatusi. Shift-vahemik = `visiblePages` indeksid `min(anchorIdx, currentIdx)..max(...)`, MITTE serveri `page_num` ega renderdus-juhuslik järjekord. Hoia `lastSelectedIndexRef` (viimase tava-klõpsu `visiblePages`-indeks) shift-ankruks; tühjenda valiku-tühjendusel.

**Valiku-riba** (ilmub kui ≥1 valitud, lehtede ruudustiku kohale):
- `Valitud: N`
- "Vali kõik" / "Tühista valik"
- sihtnumbri väli — silt *"lehe ___ järele"*
- elav eelvaade-tekst (vt ülal)
- **Liiguta** nupp
- **Kustuta valitud** nupp

> **"Vali kõik" skoop:** kuna Leheküljed-tabis EI ole praegu filtrit ega paginatsiooni, on kõik teose lehed korraga nähtavad ja "Vali kõik" valib kõik. Kui tulevikus lisandub filter/lazy-load, tuleb otsustada, kas "Vali kõik" = kõik teose lehed VÕI ainult nähtavad — siis muuda silt vastavalt ("Vali kõik nähtavad").

**Liigutamise voog:** "Liiguta" arvutab uue täisjärjekorra (vt algoritm), kirjutab selle olemasolevasse **`draftPositions`** olekusse → **ruudustik järjestub ümber (WYSIWYG)**, amber-esiletõst näitab muudetud lehti → kasutaja vaatab tulemuse üle ja vajutab olemasolevat **"Salvesta järjekord"** nuppu, mis POST-ib `/reorder-pages`-i. **Liigutamine ei vaja uut backend-endpointi.** Salvestamise eel on muudatus täielikult ülevaadatav ja tühistatav.

**Review + tühista enne kinnitamist (oluline ~100 lk puhul):** suure ploki liigutamisel on ülevaadet raske saada, seega:
- ruudustiku WYSIWYG-järjekord ON eelvaade — kasutaja kerib ja kontrollib visuaalselt;
- salvestus-nupu kõrval **summaarne indikaator** — mõõdik on **diff serveri- vs draft-järjekorra vahel**, MITTE valitud ploki suurus (ploki liigutamine nihutab ka vahepealsete lehtede positsioone, nt 1–5 → 9 järele muudab ka 6–9 nähtavat asukohta). Tekst: *"{count} lehe asukoht erineb salvestatud järjekorrast."* (Kui tahaks näidata ploki suurust, oleks see eraldi mõõdik *"Liigutatud plokk: {count} lehte"* — ÄRA aja segamini.);
- uus **"Tühista muudatused"** nupp (kuvatakse kui `hasReorderChanges`) — **lähtestab kogu salvestamata reorder-draft'i**: `draftPositions` → serveri-järjekord, `visiblePages` → serveri-järjekord, `hasReorderChanges` → false, amber-seis + summary kaovad, sihtnumbri eelvaade arvutatakse uuesti taastatud järjekorra põhjal. Valikut **ei pea** tühjendama (failid on samad) — võib alles jääda. Ei puuduta serverit;
- alles **"Salvesta järjekord"** kinnitab. Salvestus-nupu juures tugev tekst, nt *"Järjekord on eelvaates. Kinnitamiseks vajuta Salvesta järjekord."*

**Valik pärast "Liiguta":** valik **jääb alles** (samad lehed, uues asukohas), et kasutaja näeks liigutatud plokki ja saaks kohe parandada. Eeldab, et amber-eelvaade ja valiku-rõngas on selgelt eristatavad.

**Üles/alla nooled:** töötavad alati **nähtaval (draft) järjekorral**, mitte algsel serveri-järjekorral — kui bulk-liigutus on tehtud, nügib nool lehte juba uues eelvaates. Nool liigutab **ainult seda üht lehte** (mitte kogu valikut), olenemata sellest, kas leht on valitud — ploki liigutamine käib ainult valiku-riba kaudu. Nii ei teki teist semantilist kihti.

### Jõudlus (kuni ~500 lk ruudustik)

- **Memoiseeritud kaart:** ekstrakti pisipilt-kaart eraldi `React.memo` komponendiks, mille propsid on **primitiivid** (`isSelected`, `isChanged`, `pageNum`, `src`). `React.memo` aitab **vältida nende kaartide uuesti renderdamist, mille primitiivsed propsid ei muutunud** — nt valiku-toggle renderdab uuesti ainult lülitatud kaardi. Reorder-draft'i puhul renderduvad uuesti eelkõige kaardid, mille `pageNum`/`isChanged`/asukoht tegelikult muutus (suure ploki liigutamisel võib neid olla palju — 500 puhul siiski OK). NB: number-välja eemaldamine **vähendab** juba praegust re-render survet (praegu renderdab iga klahvivajutus `inputValues`-i kaudu kogu ruudustiku).
- **Stabiilsed callbackid:** anna kaardile **ühed stabiilsed** `useCallback`-id (`onToggle`, `onNudge` jms), MITTE iga kaardi jaoks inline-closure'it iga renderiga (see lõhuks `React.memo`). Kaart kutsub `onToggle(filename)` ise, kus `filename` on tema enda primitiivne prop. Nii püsivad callback-viited renderite vahel muutumatuna.
- **Valiku olek:** `Set<string>` (filename); kaardile anna `isSelected={selected.has(filename)}` boolean, mitte kogu Set'i. Shift-vahemiku puhul üks `setState` (ehita uus Set), mitte 100 eraldi uuendust.
- **Minimaalsed päringud:** bulk-kustutuse järel uuenda nimekiri ühe `loadPages()`-iga (nagu olemasolevad teed); ära tee päringut lehe kohta.

**Kustutamine + salvestamata reorder-draft (lukustatud):** kui `hasReorderChanges === true`, on **"Kustuta valitud" keelatud** + vihje *"Enne kustutamist salvesta või tühista järjekorra muudatused."* Reorder on staged/eelvaates (frontend-draft), kustutus aga **kohe serverisse committitav** — neid ei tohi samas UI-seisus segada (muidu jääks `draftPositions` viitama kustutatud failidele). Kasutaja salvestab või tühistab järjekorra enne kustutamist.

**Kustutamise voog:** "Kustuta valitud" → kinnitusdialoog (N lehega) → uus `POST /admin/work/{id}/delete-pages`. Õnnestumisel värskenda + tühjenda valik. **409 Conflict** (stale UI / paralleelmuudatus) → midagi pole kustutatud; kuva teade ja **värskenda lehtede nimekiri** (kasutaja saab uuesti valida). Pehme kustutus → taastatav "Prügikast" tabist (käitumine ei muutu).

## Backend

### Liigutamine — muudatusi pole

Taaskasutab täielikult olemasolevat `POST /admin/work/{work_id}/reorder-pages`-i (`server/admin_page_ops.py::reorder_pages`). Frontend arvutab uue failinimede järjekorra ja saadab selle. Backend valideerib (samad failid, sama arv) ja kirjutab `sequence` väärtused + üks git-commit.

### Kustutamine — uus batch-endpoint

Olemasoleva `DELETE .../page/{page_num}`-i **tsüklis kutsumine on vigane**: pärast lehe `3` kustutamist saab lehest `4` leht `3`, seega positsiooni-põhine tsükkel kustutaks valed lehed. Lisaks teeks see N git-commit'i + N reindeksit.

**Uus endpoint:** `POST /admin/work/{work_id}/delete-pages`
- Body: `{ "base_names": ["slug_pg_001", "slug_pg_002", ...] }` (lahendatud failinime-tüvi, mitte positsioon — nihke-immuunne).
- Roll: `require_role("admin")`.
- Loogika (`work_lock` all) — **kõik-või-mitte-midagi (validate-first):**
  1. **Sisendvalidatsioon (path-traversal kaitse):** de-dupe `base_names` (kuigi UI valik on `Set`, backend ei usalda klienti). Keela `/`, `\`, `..`, null-byte. **Tõeline kaitse on samm 2 — täpne kuuluvus `get_sorted_images()` hulgas** (operatsioon puudutab AINULT lahendatud, olemasolevaid faile, kunagi mitte kliendi antud teed). Lisamuster (nt `^[A-Za-z0-9._-]+$`) on lubatud *belt-and-suspenders*, AGA peab vastama süsteemi **tegelikule failinimekonventsioonile** — kui failinimed sisaldavad täpitähti/tühikuid vms, ära blokeeri neid valesti. Vigane sisend → 400.
  2. **Lahenda kõik enne ühtegi mutatsiooni:** nõua, et iga `base_name` vastaks **täpselt** `get_sorted_images()` tagastatud failinimele. Kui **ükski** ei sobi → **404**. Kui **osa** ei sobi → **409 Conflict**, `{ not_found: [...] }`, **ei kustuta midagi** (tähistab stale UI-d / paralleelmuudatust; UI värskendab ja proovib uuesti). Alles kui **kõik** klapivad, jätka.
  3. **Pildifaili tee:** iga lehe puhul kasuta **lahendatud page-record'i tegelikku failinime/laiendit** (`.jpg`/`.jpeg`/`.png` — mitte kõvakodeeritud `.jpg`).
  4. Liiguta kõik pildid prügikasti (`BASE_DIR/._trash/{work_id}/pages/`). **Nimekonfliktid prügikastis lahenda samamoodi nagu olemasolev üksik-kustutus** (`admin_delete_page`) — taaskasuta sama mehhanismi, ära dubleeri erinevat käitumist.
  5. Kustuta kõigi lehtede `.txt` + `.json` gitist **ühe commit'iga** (`repo.index.remove([...])` + üks `commit`).
  6. **Üks** `sync_work_to_meilisearch(folder_name)` kõigi järel. Sünki-tõrge **järgib olemasolevat üksik-kustutuse (`admin_delete_page`) käitumist** — ära leiuta uut normatiivset loogikat. Kustutus on git-is juba committitud (samm 5), seega tõrge ei tee kustutust olematuks; logitakse, ei katkesta 200-vastust. (Kui üksik-kustutus midagi UI-le ei signaliseeri, ei tee ka batch — jää konsistentseks.)
  7. Tagasta `{ status, deleted: [...], new_page_count }`.
- **Rollback / taastatavus:** kuna kõik lahendatakse ja valideeritakse **enne** ühtegi faililiigutust, on tavaline vea-aken kitsas (pildi prügikasti liigutamine samal kettal = sisuliselt rename, väga kiire ja madala tõrketõenäosusega). Kui git-samm (5) ebaõnnestub pärast piltide prügikasti liigutamist (4), kompenseeri **mõlemad poolikud seisud**:
  - **failisüsteem:** liiguta pildid prügikastist tagasi;
  - **git:** kui `repo.index.remove([...])` on juba tehtud, aga `commit` kukub läbi, on index/staging dirty → **lähtesta index** (`repo.index.reset(...)` / olemasolev git-abstraktsioon), et repo ei jääks poolikusse staged seisu.

  Seejärel tagasta 500 — seis jääb operatsiooni-eelseks. Lukustatud valik: **kompenseeriv tagasiliigutus** (mitte idempotentsus-eeldus). **Logi** liigutatavate failide nimed/teed vahetult ENNE mutatsiooni (samm 4) — kui protsess krahhib keset operatsiooni (enne kompensatsiooni), on logist administraatorile käsitsi taastamine lihtne.
- Uus op-funktsioon `server/admin_page_ops.py::delete_pages(work_id, base_names, username)` — batch-versioon olemasolevast loogikast (taaskasutab `admin_delete_page` prügikasti- ja git-loogika osi, aga ühe commit'i ja ühe reindeksiga).

## Testitavus

**Frontend — puhas funktsioon:** ekstrakti ploki-liigutamise loogika eraldi utiliiti `src/utils/blockReorder.ts` (sama muster mis `src/utils/bulkAddChunks.ts`):

**Üks ühine utiliit (mitte ainult `string[]`):** eelvaade, nupu-keelamine JA järjekorra-arvutus PEAVAD kasutama sama loogikat, et UI ei lubaks midagi, mida reorder tõlgendaks teisiti. Seega tagastab funktsioon tulemus-uniooni, mitte paljast massiivi:

```ts
// before/after on NÄHTAVAD numbrid (visiblePageNum), mitte serveri page_num
type MovePreview =
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'between'; before: number; after: number };

type BlockMoveResult =
  | { ok: true; order: string[]; preview: MovePreview }
  | { ok: false; reason: 'emptySelection' | 'anchorInSelection' | 'invalidTarget' };

// visiblePages = effective järjekord (draft kui olemas, muidu server)
computeBlockMoveOrder(visiblePages, selectedFilenames, targetRaw): BlockMoveResult
```

UI: `ok:false` → nupp keelatud + vihje (`reason` järgi); `ok:true` → kuva `preview` (nähtavate numbritega), "Liiguta" kirjutab `order` draftPositions-i. Sisend `visiblePages` on effective järjekord, seega "lehe N järele" viitab alati sellele, mida kasutaja ekraanil näeb.

Üksuse testid (`*.test.ts`):
- plokk algusesse (`N=0`, `N` negatiivne, `N` tühi → kõik `start`);
- plokk lõppu (`N > last` → `end`, lubatud);
- `N === last`, viimane leht EI ole valitud → `end` (anchor = viimane);
- `N === last`, viimane leht ON valitud → `anchorInSelection`;
- plokk keskele (kasutaja näide: 1–5 → lehe 9 järele → `between 9,10`);
- üks leht (plokk pikkusega 1);
- mittejärjestikune valik (2,5,7 → kompaktne plokk, suhteline järjekord säilib);
- `N` osutab valitud lehele → `anchorInSelection` (mitte vigane järjekord);
- `N` mittearv / kümnendmurd ("abc" → `invalidTarget`; "9.5" → trunkeeritud 9);
- valitud failinimi, mida `visiblePages` hulgas pole → `invalidTarget` (mitte vaikne ignoreerimine);
- tühi valik → `emptySelection`;
- **kõik lehed valitud:** `N=0` või `N>pageCount` → `ok` aga `order` === praegune (no-op, sama järjekord); `N` 1..pageCount → `anchorInSelection` (anchor on paratamatult valikus). UI võib no-op'i puhul "Liiguta" keelata vihjega *"Kõik lehed on valitud; liigutamine ei muudaks järjekorda"* (pole hädavajalik);
- **effective järjekord:** kui sisendiks antakse juba draft-järjekord (nt eelnev liigutus), siis "lehe N järele" viitab NÄHTAVALE numbrile N selles draft-järjekorras (ahel-liigutus annab ootuspärase tulemuse).

**Backend — `tests/test_*`:**
- bulk-delete mitu lehte (kõik olemas) → üks commit, üks reindeks (mock `sync_work_to_meilisearch`, kontrolli kutsete arvu = 1);
- kustutatud pildid on prügikastis, `.txt`/`.json` gitist eemaldatud, `new_page_count` korrektne;
- **ükski `base_name` ei vasta → 404, midagi ei kustutata;**
- **osa `base_names` ei vasta → 409, midagi ei kustutata** (kõik-või-mitte-midagi);
- duplikaat `base_names` bodys → de-dupe (ei kustuta kaks korda, ei kuku läbi);
- **path-traversal katse** (`"../../foo"`, `"a/b"`) → 400, midagi ei kustutata;
- git-commit ebaõnnestumine (mock) → kompenseeriv tagasiliigutus (pildid taas kohal) **JA git index lähtestatud** (staging puhas, repo ei jää poolikusse seisu), 500;
- Meilisearch sync ebaõnnestumine → kustutus jääb kehtima (git on juba commit'itud), viga logitakse, ei katkesta vastust (sama muster mis olemasolev async sync).

## i18n

Uued võtmed `src/locales/{et,en}/workspace.json` alla `manage`-sse, nt:
- `manage.select.all`, `manage.select.clear`, `manage.select.count`
- `manage.move.label` ("lehe ___ järele"), `manage.move.button`
- `manage.move.previewBetween`, `manage.move.previewStart`, `manage.move.previewEnd`
- `manage.move.anchorInSelection` (vihje, sisaldab `{end}` = pageCount+1 lõppu-alternatiivi)
- `manage.move.invalidTarget`, `manage.move.notSavedHint` ("Järjekord on eelvaates…")
- `manage.reorder.discard` ("Tühista muudatused"), `manage.reorder.changedSummary` (count = **diff** server vs draft, "{count} lehe asukoht erineb salvestatud järjekorrast")
- `manage.bulkDelete.button`, `manage.bulkDelete.confirm` (count)
- `manage.bulkDelete.conflict` (409 — stale UI, värskenda ja proovi uuesti)

## Maht

| Osa | Hinnang |
|-----|---------|
| Backend `delete-pages` op + endpoint + testid | ~0.5 päeva |
| Frontend: valiku-UI, `blockReorder.ts` + testid, riba, eelvaade, kustutus-juhtmestik | ~0.5–1 päeva |
| i18n + manuaaltest serveris | väike |
| **Kokku** | **≈ 1–1.5 päeva**, madal risk |

Madal risk, sest liigutamine sõidab täielikult tõestatud reorder-draft/save-voo peal, kustutamine on olemasoleva koodi batch-versioon, ja ainus tõeliselt uus loogika on väike puhas (testitav) ploki-paigutuse matemaatika + valiku-liides.
