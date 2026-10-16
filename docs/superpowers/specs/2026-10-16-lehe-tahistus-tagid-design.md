# Lehe tähistus: tägid, otsingutekst ja märgenduse register (#630, spekk 1)

**Kuupäev:** 2026-10-16 · **Issue:** #630 · **ADR:** 0070 (lehe tähistus ja aadress,
ettepanek), 0071 (uus: märgendus on TEI alamhulga lühisüntaks) · **Seotud:** ADR 0006
(Meili väljad ainult `meili_doc.py`-s), ADR 0044 (peidetud täg), ADR 0067 (`<add>`),
ADR 0003/0009 (`<m>`), #526 (kirjad)

**Ülevaatus:** spekk vajab enne plaani **mitut ülevaatusringi** (kasutaja nõue).
1. ring 2026-10-16 sisse viidud (struktuurireeglid, paaride sidumine, tarbijapõhised
lipud, poolitus üle tähistuse, TEI `header`, ADR 0070 ühtlustus).
2. ring 2026-10-16: vorminduse laiendust ei ole (poolitus), `<pb/>` reegel serveris,
üks `page_mark_spans` kolmele tarbijale.

## Probleem

1. **Otsingutekst on vigane.** Lehe tähistus — siirdeviit, signatuur — on toorfailis oma
   ridadel lehe lõpus, aga `clean_text_for_search` liidab reavahetuse poolituse ja
   signatuur kleepub siirdeviida külge (`04na2fu4` lk 3: `Ehrwür⸗` ⏎ `A ij` →
   `lehekylje_tekst` = `…EhrwürA ij`; lk 9 `…seiB`). Siirdeviit on otsingus ka topelt
   (`lzogr0` lk 4 lõpp + lk 5 algus `derſelben`). Veerutiitel kordub igal lehel
   (`lzogr0` lk 4 `Vorrede`).
2. **Viitamiseks pole alust.** Lehe tähistust ei saa praegu märgendada; aadressi
   tuletus (spekk 2) vajab märgendatud ankruid.
3. **Märgendus kasvab ilma reeglita.** 9 tägi, ühtki kirjapandud reeglit, mis tägiks
   kõlbab; tägide loend on ≥ 6 kohas koodis (`<add>` puudutas 19 faili, #579). Iga
   uus täg võib vaikselt mõnest kohast välja jääda.

## Terminid

Raamatukogusõnastiku (Sõnaveeb, `rara`) eelistermin; UI, juhend ja dokumendid kasutavad
seda.

| Täg | TEI | Eelistermin (et) | Rööptermin | en |
|---|---|---|---|---|
| `fw` | `fw type="pageNum"` | lehenummerdus / leheküljenummerdus | foliatsioon, paginatsioon | foliation / pagination |
| `sig` | `fw type="sig"` | signatuur | — | signature |
| `catch` | `fw type="catch"` | siirdeviit | kustos | catchword |
| `rh` | `fw type="header"` | veerutiitel | (jooksev pealkiri — sõnastikus pole) | running head |

**Lehe tähistus** = TEI `fw` (*forme work*): lehe kui füüsilise objekti tähistus, mitte
teksti osa. **Ei ole marginaalia** — `<m>` on sisuline tekst veerisel.

## Otsused arutelust

1. **Neli paaristägi** `<fw>` `<sig>` `<catch>` `<rh>`, atribuutideta, sisu täht-tähelt
   (`A iij`, `Vor⸗`, `Vorrede`). Üks täg ei sobi: `B` ja `246` ei ole sisu järgi
   eristatavad. `<rh>`, mitte `<head>` — TEI `head` on päris pealkiri.
2. **Täg funktsiooni, mitte sõna järgi.** `Vorrede.` jaotise alguses (`lzogr0` lk 3) on
   pealkiri; järgmiste lehtede ülaservas sama sõna on `<rh>`.
3. **Märgendus on TEI alamhulga lühisüntaks** (ADR 0071): uus täg ainult otsese TEI
   vastega; atribuute ei ole — TEI atribuudi info kannab nimi; iga täg on registris koos
   TEI vaste ja käitumisega. VUTT ei leiuta tähendust, mida TEI-s pole.
4. **`cs` jääb suhteliseks** (koodivahetus teose põhikirja suhtes). TEI teeb sama:
   põhikiri deklareeritakse kord (`<text rendition=…>`), kõrvalekalle märgitakse. Puudu on
   ainult põhikirja väli — eraldi issue. ADR 0071 märgib `cs`-i erandina, mille TEI
   teisendus vajab seda välja.
5. **Tähistus otsingutekstist välja, Meilis nähtav.** Eraldi mitteotsitav väli
   `page_marks`; MCP näitab seda lehe päises.
6. **Sisestus: lohistatav alati nähtav paneel** + kiirklahv. Katse (`spike/lehe-tahistus-
   kiirklahv`, `repro/pagemarks.html`, 2026-10-16): rippmenüüs „peab valikut jahtima";
   paneel nelja nupuga on „selgelt palju mugavam, eriti kui seda nihutada saab".
7. **Ankru ettepanekut ei tehta** (ADR 0070 p. 8).

## Disain

### 1. Register ja ADR 0071

**ADR 0071 — VUTT-i märgendus on TEI alamhulga lühisüntaks.** Kolm reeglit (otsus 3) ja
tabel kõigi 13 tägi kohta. Kirjutamisel kontrollitakse iga vaste; kus vaste ei ole
puhas, märgitakse see ausalt erandina.

| Täg | TEI | Paaris | Sisu otsingusse |
|---|---|---|---|
| `i` `b` | `hi rend="italic\|bold"` | jah | jah |
| `cs` | `hi`, kiri vastupidine põhikirjale (erand, vt otsus 4) | jah | jah |
| `hi` | `hi` | jah | jah |
| `m` | `note place="margin"` | jah | eraldi väli `marginaalia_tekst` |
| `add` | `add` | jah | jah |
| `annN` | ankur toimetaja märkusele (kontrollida: `anchor`/`span`) | jah | jah |
| `fn` | viide joonealusele (kontrollida: `ref`/`note`) | jah | ei |
| `pb` | `pb` | ise suletud | ei |
| `fw` `sig` `catch` `rh` | `fw type="pageNum\|sig\|catch\|header"` | jah | **ei → `page_marks`** |

`header` on TEI soovitatud väärtus ülaserva jooksvale pealkirjale; DTA kasutab `head`-i —
mõlemad teisenduvad `<rh>`-ks.

**Registrid.** Kaks, sama sisuga:

- `src/markup/vuttTags.ts` — `export const VUTT_TAG_REGISTRY`
- `server/vutt_tags.py` — `VUTT_TAG_REGISTRY`

Kirje: `name`, `tei`, `paired` (bool), `search` (`keep` | `drop` | `marginalia`),
`pageMark` (bool; `pageMarkLabel` i18n-võti) ning **tarbijapõhised lipud**, mis teevad
praegused erandid nähtavaks:

| Lipp | Tarbija | Praegused erandid |
|---|---|---|
| `marginaliaInline` | `marginalia_normalize._INLINE` | `m` ei ole (ta on ise välimine) |
| `stripEmpty` | `marginalia_normalize._EMPTY_RE` | `annN`, `fn`, `pb` ei ole |
| `cleanMarkup` (`remove` \| `keep`) | `cleanMarkup` regex | `annN` = `keep` (annotatsioon säilib) |
| `wrapBlock` | `wrapTagUtils` plokitägid | ainult `m hi add fn` (+ neli uut) |

Python ei loe frontendi puud: backendi image ei kanna `src/`-i.

**Kes tarbib registrit otse (uus kood):** `clean_text_for_search` tähistuse samm,
`page_marks`, `renderVuttMarkup` lubatud tägid, paneel/menüü. **Kordusloendid jäävad
paigale** (`VUTT_TAGS` redaktoris, `marginalia_normalize._INLINE` ja `_EMPTY_RE`,
`cleanMarkup` regex `useEditorFormattingActions.ts`, `wrapTagUtils` plokitägid) — neid
valvab paarsustest (osa 4): iga loend **võrdub** registrist tuletatud tarbija
alamhulgaga, mitte „kõik nimed kõikjal". Koondamine registrisse on eraldi koristus, kui
lihtne, ka siin.

### 2. Server

**`clean_text_for_search`** (`server/meili_doc.py`). Uus alamsamm **sammu 1 algusesse**,
enne `<fn>`/`<pb/>` asendust, üldist tägieemaldust ja poolituste liitmist:
**tähistuse paarid eemaldatakse koos sisuga, asendus = tühi string**.

- **Üks parser** `parse_page_marks(text)` (`server/vutt_tags.py`), mida kasutavad **kõik
  kolm tarbijat** — otsingupuhastus, `page_marks` ja normaliseerija —, et sama teksti ei
  tõlgendataks kaheti. Tagastab **kõik** tähistuse paarid koos tägide asukohtadega ning
  lippudega `valid` (ei sisalda `<pb/>`) ja `outer` (ei ole teise paari sees); paarita
  tägid eraldi. Otsingupuhastus ja `page_marks` valivad kehtivad välimised paarid
  (`page_mark_spans` = `valid and outer`); normaliseerija vajab ka kehtetuid ja sisemisi,
  et nende ümbristägid eemaldada. Reeglid:
  - tägid seotakse paarideks pinuga (nagu `findOrphanTags`), mitte regexiga;
  - **välimine** paar loeb, sisemised tähistused on tema sisu
    (`<sig>A <sig>ij</sig> muu</sig>` → üks paar, kaob tervikuna);
  - **paarita** täg ei ole tähistus: täg kaob nagu tavaline täg, sisu jääb otsingusse —
    muidu kaotaks üks orv `<sig>` lehe ülejäänud teksti;
  - **paar, mille sees on `<pb/>`, ei ole kehtiv tähistus** (`<fw>12<pb/>13</fw>`): tägid
    kaovad nagu tavalised, sisu ja `<pb/>` jäävad, `page_marks`-i kirjet ei teki. Muidu
    saaks kahe tekstiosa kohta ühe kirje.
  - **paar, mille sees on `<m>` või `</m>`, ei ole kehtiv tähistus** (lõppülevaatus
    2026-10-17): tähistus võib olla `<m>` sees, mitte vastupidi ega `<m>` piiriga ristuvalt.
    Muidu loeks `page_marks` põhiteksti või marginaalia leheküljenumbriks, kuigi otsing
    tõlgendab teisiti. Normaliseerija eemaldab sellise paari tägid PÄRAST `<m>` välimiseks
    tõstmist (`<fw><m>246</m></fw>` → `<m><fw>246</fw></m>`).
- Puhastus eemaldab `page_mark_spans` vahemikud koos sisuga.
  (Ülevaatus 2026-10-17: parser tagastab kõik paarid, mitte ainult kehtivad välimised.)
- **Tühi string, mitte reavahetus:** ümbritsev tühik/reavahetus jääb nagu originaalis.
  Tähistus on teksti voos **läbipaistev** — poolitus liitub üle eemaldatud tähistuse
  täpselt siis, kui originaalis oli poolituse järel reavahetus. See on õige: tähistus ei ole
  tekst, sõna jätkub temast edasi. Kontrollitud 2026-10-16 praeguse funktsiooniga:

  | Sisend | Tulemus |
  |---|---|
  | `1. Cor. 1.` ⏎ `<catch>Ehrwür⸗</catch>` ⏎ `<sig>A ij</sig>` | `1. Cor. 1.` |
  | `Ehrwür⸗` ⏎ `<sig>A ij</sig>` (siirdeviit märgendamata) | `Ehrwür` (ripub, ei kleepu) |
  | `dem⸗` ⏎ `<sig>A ij</sig>` ⏎ `Wort` | `demWort` (sõna jätkub) |
  | `dem⸗<sig>A ij</sig> Wort` (ühel real) | `dem⸗ Wort` (reavahetust pole → ei liitu) |

  (Asendus reavahetusega oleks viimase muutnud `demWort`-iks — uus liitmine, mida
  originaalis ei olnud.)
- Tähistuse sees võivad olla tavalised tägid (`<catch><i>Vor⸗</i></catch>`) — sisu kaob
  tervikuna.
- Kehtib kõigile tarbijatele: `lehekylje_tekst`, `lehekylje_tekst_ann` (`keep_ann`),
  `marginaalia_tekst` (tähistus `<m>` sees), kirjaindeksi `letter_text` (ehitatakse
  lehedokumentidest).

**`page_marks`** — uus väli lehedokumendis, **ainult `meili_doc.py`** (ADR 0006).
Ehitatakse **toorest** lehe tekstist (enne `split_marginalia`), et leida ka `<m>` sees
olev:

```json
"page_marks": [{"kind": "rh", "text": "Vorrede", "seg": 0},
               {"kind": "catch", "text": "habe", "seg": 0}]
```

- Kirjed tulevad **samast `page_mark_spans`-ist**: üks kirje välimise kehtiva paari kohta;
  pesastatud sisendist üks kirje, paarita tägist ja üle `<pb/>` ulatuvast paarist kirjet ei
  teki.
- Järjekord = tekstis. `text` = sisu sisemiste tägideta, tühikud ahendatud, muidu
  täht-tähelt; tühi sisu jäetakse välja.
- `seg` = `<pb/>`-de arv enne tägi (laotuse tekstiosa; spekk 2 vajab).
- **Alati olemas** (tühja listina). Ei ole `SEARCHABLE_ATTRIBUTES`-is ega filtreeritav;
  `meili_settings.py` ei muutu. Meili tagastab vaikimisi.
- Kirjaindeks (`kirjad`) `page_marks`-i ei saa (spekk 2 otsustab osa ulatuse).

**Normaliseerija** (`server/marginalia_normalize.py`, kutsutakse KÕIGIS kirjutusteedes):

- `strip_empty_tags` komplekt + `fw sig catch rh` → tühi `<sig></sig>` kaob salvestusel.
- `_INLINE` + needsamad: `<m>` jääb välimiseks, tähistus võib olla `<m>` sees (OCR võib
  veerise ploki sisse panna ka nurga foliatsiooninumbri), **mitte vastupidi**.
- **Uus: tähistuse struktuur** (`parse_page_marks` põhjal), igale kirjutatavale tekstile —
  ka kleebitud, imporditud ja OCR-ist tulnud:
  - välimise paari sees olevad tähistuse tägid (mis tahes liik) eemaldatakse, sisu jääb;
  - üle `<pb/>` ulatuva paari ümbristägid eemaldatakse, sisu ja `<pb/>` jäävad.

  Kontrollitavad invariandid (test): normaliseeritud tekstis ei ole tähistust tähistuse
  sees ega tähistust, mis sisaldab `<pb/>`. Indekseerija ei sõltu normaliseerimisest —
  normaliseerimata tekst annab `page_mark_spans` kaudu sama tulemuse.

**Olemasolev korpus:** migratsiooni ja täisreindeksit ei ole. Märgendamata lehtedel jääb
tähistus põhiteksti nagu praegu; `page_marks` tekib iga lehe järgmisel sünkil (tühjana).

### 3. Redaktor ja lugemisvaade

**Tegevus `wrapPageMark(kind)`** (uus, `components/editor/`):

- **Sihtvahemik:** valik; valikuta kursori rida, äärmised tühikud välja jäetud. Kui kursor
  on `<m>` ploki sees, piirdub rida ploki sisuga.
- **Olemasolev tähistus:** kui kursor või vahemik puudutab tähistuse paari, tegutseb käsk
  **terve paari** peal — sama liik → eemalda, teine liik → vaheta. Vahemik, mis puudutab
  **mitut** tähistust → keeldu.
- **Keeldumine** (tekst ei muutu, paneelis/menüüs lühike vihje): vahemik sisaldab
  `<pb/>`-d (tähistus ei ületa lehevahetust; muidu saaks `page_marks` kahe lehekülje kohta
  ühe kirje); vahemik ületab `<m>` ploki piiri või sisaldab peidetud marginaaliaplokki.
- **Vormindus: valitud nähtav ulatus säilib, laiendust ei ole.** Tähistus ei tohi
  kunagi haarata põhiteksti, mida kasutaja ei valinud (`<i>põhitekst 12</i>`, valitud `12`
  — `balancedCut` laiendaks kogu kursiivile ja põhitekst kaoks otsingust):
  - vahemik on ühe vormindustägi (`i b cs hi add`) sisu sees → tähistus läheb **selle
    sisse**: `<i>põhitekst <fw>12</fw></i>`;
  - vahemik lõikab vormindustägi piiri → vormindustäg **poolitatakse** vahemiku piiril
    (sulge + ava uuesti), tähistus katab täpselt valitud nähtava teksti:
    `<i>ab</i>|cd|e` valik `b…d` → `<i>a</i><fw><i>b</i>cd</fw>e`;
  - piir läbiks muud kui vormindustägi (`m`, `annN`, `fn`, `pb`) → **keeldu**.
- Kõik kontrollid (`<pb/>`, marginaalia, olemasolevad tähistused) käivad **lõpliku**
  vahemiku kohta, pärast poolitust.
- Tühi rida → lisa `<kind></kind>`, kursor sisse.
- Tehing `userEvent: 'input.format'` (filtrid lasevad läbi, `wrapWithTag` muster).

**Paneel** (uus komponent, Workspace'i redaktori konteineris):

- Alati nähtav, vaikimisi teksti ala paremas ülanurgas; neli nuppu (silt + kiirklahvi
  täht) ja `×`.
- **Lohistatav sildist** (`⠿ Lehe tähistus`); jääb redaktori kasti piiresse.
- Lahti/kinni ja asukoht = **brauseri mugavusseade** (`localStorage`,
  `vutt_pagemark_palette`, `…_pos`; try/catch, puudumisel vaikimisi lahti ja nurgas).
- Tööriistaribal üks nupp **„Lehe tähistus"** — näitab/peidab paneeli.
- Nupu `mousedown` ei võta redaktorilt fookust ega valikut (`preventDefault`).
- z-index redaktori sees (`z-10`), päise (`z-[1200]`) ja modaalide all.
- Paneel katab pika rea otsa ja võib katta marginaaliaveergu — selleks lohistamine.
- Ainult redaktoris (lugemisvaates ei ole). Mobiilivaadet ei kontrollita (redaktor ei ole
  mobiilis).

**Kiirklahv** `Ctrl/⌘+Shift+F` → menüü kursori juures; valik tähega `f` `s` `c` `r` või
nooled + Enter, Esc sulgeb. (`Ctrl+Shift+S/C` on brauseri omad; Alt+täht annab Macis
märgi.)

**Kuvamine.**

- Redaktor: `VUTT_TAGS` + neli kirjet, mark-dekoratsioon + `atomicRanges` (ADR 0044),
  klass `vutt-pm vutt-pm-<kind>`: väiksem hall kiri, kerge taust, liigi silt väikese
  ülaindeksina (`::before`). Silt on **tägi nimi** (`fw` `sig` `catch` `rh`) —
  keeleneutraalne, sama mis toortekstis, CSS-i sisu ei vaja i18n-i. Täisnimi (eelistermin)
  on paneeli nupul ja menüüs.
- Lugemisvaade (`renderVuttMarkup`): samad klassid; lubatud tägid registrist.

**Teised tegevused.** „Eemalda vormindus" (`cleanMarkup`) eemaldab ka need tägid (sisu
jääb). `wrapTagUtils` plokitägide loend + neli. Orvud koristab `vuttAutoSanitizer` nagu
teisi (`findOrphanTags` kasutab `VUTT_TAGS`-i).

**i18n** (ADR 0011): kõik sildid mõlemasse keelde korraga (`workspace` nimeruum).

### 4. MCP, eksport, testid, dokumendid

**MCP** (`mcp/vutt_mcp/`):

- `queries.py` lisab `page_marks` `attributesToRetrieve`-sse.
- `get_pages` päis: `── lk 5 · seisund=Toores · signatuur A iij · siirdeviit Vor⸗`;
  puuduv/tühi väli → päis nagu praegu.
- `search_pages` tähistust ei leia — tööriista kirjeldus ja `mcp/README.md` ütlevad seda.
- Reeglid: `server`-it ei impordita; kuju valvab `test_meili_contract`.

**Eksport.** VUTT-i poolelt muutust pole: toortekst koos tägidega, nagu `<add>`. ADR 0071
kirjutab lepingu lahti. LOSSi ehitajad (`build_vutt_dataset.py`, DTA `fw`, PAGE
`TextRegion @type`) ja Gemini juhis = **eraldi rada** (uus issue).

**Testid.**

pytest:

- `clean_text_for_search`: `Ehrwür⸗` ⏎ `<sig>A ij</sig>` ei kleepu; mõlemad märgendatud;
  `<i>` tähistuse sees; tähistus `<m>` sees (`marginaalia_tekst`); `keep_ann`; laotus
  `<pb/>`-ga.
- `page_marks`: järjekord, `seg`, tühi list, tühi sisu välja, tühikud, täht-täheline
  sisu, `<m>` sees.
- `strip_empty_tags` ja `normalize_marginalia_tags` uute tägidega.
- `clean_text_for_search` lisaks: tähistusele järgnev põhitekst (tabeli neli juhtu);
  pesastatud tähistus (välimine kaob tervikuna); paarita tähistus (sisu jääb).
- Normaliseerija: tähistus tähistuse sees → sisemine täg eemaldatud; `<fw>12<pb/>13</fw>`
  → `12<pb/>13`; idempotentne.
- `parse_page_marks` / `page_mark_spans` ühine tabel kolmele tarbijale: pesastus, orv, üle `<pb/>`, `<m>` sees —
  puhastus, `page_marks` ja normaliseerija annavad samale sisendile kooskõlalise tulemuse
  (`<fw>12<pb/>13</fw>`: otsingus `12 13`, `page_marks` tühi).
- **Paarsustest:** TS- ja Pythoni register samad (nimi, TEI, kõik lipud); iga
  tarbijaloend (`VUTT_TAGS`, `_INLINE`, `_EMPTY_RE`, `cleanMarkup` regex, `wrapTagUtils`
  plokitägid, `renderVuttMarkup` lubatud nimekiri) **võrdub** registrist lipu järgi
  tuletatud alamhulgaga — erandid on registris, mitte testis.

vitest:

- `wrapPageMark`: rida ilma valikuta, valik, eemaldamine, vahetus, tühi rida, tehingu
  `userEvent`; kursor tähistuse sees → terve paar; mitu tähistust → keeldumine; `<pb/>`
  vahemikus → keeldumine; valik kursiivi sees → tähistus kursiivi sees, põhitekst
  puutumata; ristuv `<i>` → poolitus, nähtav ulatus sama; ristuv `annN` → keeldumine;
  kursor avatud `<m>` plokis → ainult
  ploki sisu; peidetud marginaaliaplokk vahemikus → keeldumine (`marginaliaProtectionFilter`
  ei tohi poolikut muudatust jätta).
- Redaktori dekoratsioonid + `atomicRanges` uutel tägidel (`vuttMarkupAdd.test.ts`
  muster).
- `renderVuttMarkup`.
- Paneel (`/** @vitest-environment jsdom */`): klikk mähib, `×` peidab, olek ja asukoht
  taastuvad, `localStorage` puudumine ei murra.
- i18n paarsus (olemasolev valvur).

**Dokumendid.**

- ADR 0071 (uus) + register `docs/decisions/README.md`.
- ADR 0070 sisuline ühtlustamine: neli tägi (+`rh`), tähistus võib olla `<m>` sees
  (mitte vastupidi), spekk 1 väli on mitteotsitav `page_marks` (filtreeritav väli kuulub
  vajadusel spekki 2), sisestus = rea mähkimine + paneel, TEI `header`, terminid; viide
  spekile.
- Transkribeerimisjuhend `public/transcription_guide.html` + `_en.html`: jaotis
  „Lehe tähistus", näited `lzogr0` lk 3–5 ja `04na2fu4` lk 3, reegel „funktsiooni järgi",
  siirdeviida poolitusmärk jääb tägi sisse.
- #630: spekk 1 / spekk 2 jaotus; uus issue OCR-rajale; uus issue põhikirja väljale.

## Väljaspool skoopi

- Lehe aadressi tuletus, skeem, käsitsi aadress, `conflict` (spekk 2, ADR 0070).
- Olemasoleva korpuse märgendamine (ka heuristiline ettepanek).
- OCR: Gemini juhis, Qwen treeningandmed (eraldi rada).
- Põhikirja väli ja `cs`-i TEI teisendus.
- TEI eksport (reeglid tagavad, et see on hiljem mehaaniline).
- Kordusloendite täielik koondamine registrisse (paarsustest katab).

## Riskid

- **Otsingutekst muutub märgendatud lehtedel** — oodatud ja soovitud; märgendamata
  lehed ei muutu. Kuivkäivitus: `clean_text_for_search` vana vs uus kogu korpuse peal
  peab andma **null erinevust** (keegi pole veel märgendanud) — kinnitab, et samm ei
  puuduta midagi muud (vt `feedback_salvestusreegel_kuivkaivitus`).
- **Sama nimega tekst:** `<fw>` jne on ainult VUTT-i märgendus; toores `<` on muu
  tekstina escape'itud (`renderVuttMarkup`). Pesastus ja orvud on käsitletud paaride
  sidumisega (osa 2), mitte eeldusega.
- **Paneel varjab teksti** — lohistatav ja suletav; vaikimisi asukoht valitakse nii, et
  esimene rida jääb nähtavaks.
