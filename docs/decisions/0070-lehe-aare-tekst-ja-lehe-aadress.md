# ADR 0070 — Lehe ääre tekst on märgendatud; lehe aadress tuletatakse

**Kuupäev:** 2026-10-16
**Staatus:** ettepanek (spekk enne teostust, mitu ülevaatust; 1. ülevaatus 2026-10-16 sisse viidud)
**Seotud:** #526 (kirjad), ADR 0003/0009 (`<m>`), ADR 0044 (peidetud täg),
ADR 0055 (mainimised tagimuutusel), ADR 0067 (`<add>`), ADR 0030 (`page_map`)

## Kontekst

VUTT-i lehenumber on ainult **positsioon pildijärjestuses**. Viitamiseks on vaja
lehe aadressi: „l. 246v", „A4v", „p. 12". Seda ei ole praegu kusagil — ei lehe
JSON-is (`PAGE_FIELDS`, `SERVERIPOOLSED_LEHE_VALJAD`), Meili lehedokumendis ega
märgenduses. Ainus pretsedent on sekundaarkirjanduse PDF-ide `page_labels`.

Kolm päris juhtumit (kontrollitud 2026-10-16):

- **Foliatsioon segatud järjekorras — `t9zd42`** (Klingeri kirjad). Iga ADA PDF on
  üks kiri ja ADA järjestas need **kuupäeva järgi**; köites olid nad teises
  järjekorras. Kirja sees käib pliiatsifoliatsioon järjest (lk 1–4: `246`, `246v`,
  `247`, `247v`), kirjade vahel hüppab (lk 5: `261`, lk 8: `252`). Mõlemad
  järjekorrad on õiged — kronoloogiline ja köite oma —, seega lehti foliatsiooni
  järgi ümber ei tõsteta. Verso'l number tavaliselt puudub.
- **Poognasignatuurid — `04na2fu4`** (Riga 1644). A1r tiitel ilma signatuurita,
  A2r `A ij`, A3r `A iij`, A4r ilma, versod ilma, B1r `B`. Signatuurid on
  harva, kirjaviis vaba (rooma numbrid lõpu-`j`-ga, tühik tüve järel), tüved võivad
  olla sümbolid (`)(`, `*`, `**`, `¶`).
- **Paginatsioon** — trükistes tavaline, aga ka osa käsikirju on paginatsiooniga.
  Teose tüüp ei määra skeemi.

**Praegune viga otsingutekstis.** Toorfailis on kustood ja signatuur oma ridadel
lehe lõpus (`04na2fu4/00003.txt`: `Ehrwür⸗` ⏎ `A ij`). `clean_text_for_search`
liidab reavahetuse poolituse ja signatuur kleepub kustoodi külge:
`lehekylje_tekst` = `…EhrwürA ij`, lk 9 `…seiB`. See on otsinguindeksis, mitte
ainult MCP kuvas; süsteemne igal poolitatud kustoodil, millele järgneb signatuur.

Laotusena pildistatud lehel (`[2v|1r]`) on ühes pildis kaks füüsilist lehte
(`<pb/>` vahel) — pildipõhine aadressiväli kannaks ainult ühte.

## Otsus (ettepanek)

1. **Kaks kihti.**
   - *Transkriptsioon* — see, mis lehel kirjas on, **täht-tähelt** ja ainult
     seal, kus midagi kirjas on. Tekstis ei ole kunagi toimetaja väärtust.
   - *Lehe aadress* — normaliseeritud ja tsiteeritav (`246v`, `A4v`, `12`), ka
     lehtedele, millel endal midagi ei ole. Tuletatakse; käsitsi määratud
     aadress on **eraldi andmed koos päritoluga** (punkt 5), mitte tekst.
2. **Kolm paaristägi** VUTT-i tägisüsteemis (`<i> <b> <cs> <m> <hi> <ann> <add>`
   kõrval), atribuutideta, sisu täht-tähelt:
   - `<fw>` — lehekülje- või foliatsiooninumber (TEI *forme work*);
   - `<sig>` — poognasignatuur;
   - `<catch>` — kustood.

   Üks täg kolme jaoks ei sobi: `B` ja `246` ei ole sisu järgi eristatavad, ja
   aadressi tuletus vajab teada, kumb on lehe number ja kumb signatuur. Lehel
   päriselt olevad nurksulud jäävad tägi sisse nagu muu tekst.
3. **Otsingutekst.** `clean_text_for_search` eemaldab kõik kolm tägi **koos
   sisuga** ja **enne** poolituste liitmist. Sisu läheb lehedokumendi eraldi
   väljadesse (ainult `meili_doc.py`, ADR 0006).
4. **Füüsiline lehekülg ja ankur.** Tuletuse ühik on füüsiline lehekülg, mitte
   pilt: pilt koos `<pb/>`-ga eraldatud tekstiosadega annab ühe või mitu füüsilist
   lehekülge, igaühel oma aadress. **Ankur** = füüsilise lehekülje `<fw>`/`<sig>`
   (liik + nähtav sisu + asukoht) või käsitsi määratud aadress. Seos tekstiosa ja
   aadressi vahel peab püsima ka pildi poolitamisel (ADR 0030 `page_map`).
5. **Käsitsi aadress** (lehel ei ole midagi, aga toimetaja teab, nt `[247v]`):
   eraldi kirje füüsilise lehekülje kohta, päritoluga `manual` ja autoriga.
   Kirjutatakse sama sisestusabi kaudu (punkt 8), aga tekst ei muutu.
6. **Skeem on määratud, mitte arvatud.** Tsiteeritav aadress arvutatakse ainult
   **teose (vajadusel osa) tasemel määratud skeemi** järgi: `foliation`,
   `pagination`, `signatures` (+ esmane, kui paralleelseid on mitu). Ilma skeemita
   tuletust ei tehta — on ainult nähtavad ja käsitsi ankrud. Automaatne tuvastus
   (punkt 8) annab skeemi kohta **ettepaneku**, mille toimetaja kinnitab.
7. **Tuletus ja selle piirid** (server, teose tasemel):
   - Parser: silt = **tüvi + number + valikuline `r`/`v`**. Tüvi on suvaline
     (ka sümbolid), number araabia või rooma (`ij` = 2, `iij` = 3, lõpu-`j` = `i`);
     tüvi ilma numbrita = poogna 1. leht. Parsimatu ankur on nähtav silt ilma
     normaliseeritud aadressita.
   - Loendus algab ankrust ja kehtib **edasi järgmise ankruni, osa piirini või
     skeemi muutuseni**, kumb enne tuleb. Enne teose/osa esimest ankrut ja katkestuse
     järel on aadress **määramata**. Tagasi (ankrust eespool) ei loendata.
   - **Vastuolu:** kui järgmine ankur ei vasta loendusele (nt puuduv skaneering,
     hüpe kirjade vahel ilma osapiirita), saavad kõik vahepealsed tuletatud aadressid
     lipu `conflict` — neid ei kustutata ega parandata vaikselt, vaade näitab neid
     ebakindlana ja toimetaja lahendab käsitsi ankruga või osapiiriga. Poogna
     pikkust ei eeldata: signatuuriskeemis on järgmise poogna algus alati ankur.
   - Laotus: pildi tekstiosade järjekord ei pruugi olla loenduse järjekord
     (`[2v|1r]`). Laotuspildil ei loendata ühelt tekstiosalt teisele — iga osa
     vajab oma ankrut või loendust naaberpildist; reegel spekis.
   - **Salvestuskoht: teose tasemel taastatav read-model** (ADR 0007), mitte lehe
     JSON — üks ankru parandus ei kirjuta ümber järgnevate lehtede JSON-e ega
     git-ajalugu. Kirje füüsilise lehekülje kohta: nähtav silt (liik), normaliseeritud
     aadress, päritolu (`visible` | `derived` | `manual`), `conflict`-lipp.
     Paralleelsed numeratsioonid säilivad kõik; kuvamiseks esmane skeemi järgi.
     Autoriteetsed on ainult tekst (nähtavad ankrud), käsitsi aadressid ja skeem.
   - **Päästik** võrdleb ankrute **sisu ja asukohti** (mitte ainult hulka):
     `<fw>246</fw>` → `<fw>248</fw>` muudab aadresse. Lisaks kõik lehenumbreid
     muutvad teed (sama hulk nagu `refresh_work_mentions`, ADR 0055), skeemi ja
     käsitsi aadressi muutus. Arvutus **eelneb** Meili sünkile — praegu paneb
     `/save` sünki järjekorda enne mainimiste skanni (`editing.py` ~rida 237),
     aadressiga nii ei tohi.
8. **Sisestus v1: ilma ettepanekuta.** Kiirklahv/nupp lisab tühja tägi (`<fw></fw>`,
   `<sig></sig>`, `<catch></catch>`) ja paneb kursori sisse, nagu `wrapWithTag`;
   valitud teksti ümber mähib. Ettepanekut ei tehta (kasutaja 2026-10-16):
   - vaev on niigi väike — foliatsioonis ankur ainult rectol, verso tuletab server;
     signatuurid on harvad;
   - ettepanekufunktsioon on kõige erijuhurohkem osa (vajab ankrute liiki,
     asukohta ja kaugust; `12`, `13` võib olla paginatsioon või foliatsioon
     rectodel) ja vale pakkumise ülekirjutamine on suurem töö kui numbri sisestus;
   - automaatika õige koht on OCR (punkt 9): uus materjal tuleb märgendatuna,
     inimene ainult kontrollib.

   Skeemi ettepanek (punkt 6) võib siiski tulla lihtsast loendusest (kas
   ankrud on igal lehel või üle ühe, kas `v`-ga), sest see tehakse kord teose kohta
   ja toimetaja kinnitab. Ankru ettepanekut kaalutakse uuesti alles päris kasutuse
   järel.
9. **OCR** (hilisem samm): Gemini juhis märgendab ääre teksti kohe. Praegu ta
   kirjutab selle omaette reale (või jätab pliiatsinumbri välja).

## Lahtised küsimused (spekki)

- **Tägide nimed** (`<fw>`/`<sig>`/`<catch>` vs lühemad või eestikeelsed).
- **Käsitsi aadressi autoriteetne asukoht** (lehe JSON-i väli vs teose tasemel
  fail) — read-model teda kanda ei saa, sest see on taastatav.
- **Füüsilise lehekülje identiteet** laotuse ja poolituse üle: pilditüvi +
  tekstiosa indeks? Mis juhtub tekstiga, kui laotuspilt poolitatakse.
- **Laotuse loendusreegel** (punkt 7) — kas lubada `[2v|1r]` mustrit kirjeldada
  (bifoolium), või nõuda ankrut igale poolele.
- **Ankru ettepanek** — v1-s ei ole (punkt 8); uuesti, kui päris kasutus näitab vajadust.
- **Skeemi kinnitamise UI** ja skeemi muutus teose sees (eelmäng rooma, edasi araabia).
- **Recto `r`** — kas normaliseeritud aadress kannab `246r` või `246`.
- **Olemasolev korpus:** ääreread on praegu märgendita (viimased read). Kas
  heuristiline ettepanek (lühike viimane rida signatuuri mustriga) ülevaatusele —
  automaatne migratsioon ei ole tõenäoliselt ohutu.
- **Treeningandmed** (`build_vutt_dataset.py`): kas tägid antakse mudelile edasi.
- **Kasutus:** kuvamine Workspace'is (sh `conflict`), URL (`/work/{id}/246v`?),
  osa ulatus „l. 246–247v" (#526, TEI `msItem/locus`), kirjaotsingu tulemusrida,
  MCP (`get_pages` päis), IIIF `canvas` label, CMIF.

## Tagajärjed

- Uus täg muudab samu kohti nagu ADR 0067: `VUTT_TAGS` (`VuttMarkupExtension.ts`,
  mark-dekoratsioon + `atomicRanges`, ADR 0044), `renderVuttMarkup.ts`,
  sanitiseerija ja `strip_empty_tags`, `cleanMarkup`, marginaalia normaliseerija
  (täg ei tohi minna `<m>` sisse ega vastupidi — reegel spekis), transkribeerimisjuhendid.
- Server: `clean_text_for_search` (järjekord: ääre tägid enne poolituste
  liitmist), `meili_doc.py` + `meili_settings.py` (filtreeritav väli
  MÕLEMASSE loendisse), aadressi read-model + `rebuild`, tuletaja ja selle
  päästikud (enne Meili sünki), skeemi väli teose/osa metaandmetes.
- Spekk vajab **mitut ülevaatust** enne teostust — puudutab redaktori
  invariante, otsinguteksti ja lehenumbreid muutvaid teid korraga.
