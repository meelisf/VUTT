# ADR 0070 — Lehe tähistus on märgendatud; lehe aadress tuletatakse

**Termin.** *Lehe tähistus* = TEI `fw` (*forme work*): leheküljenumber,
foliatsioon, signatuur, siirdeviit, veerutiitel — lehe kui füüsilise objekti tähistus, mitte
teksti osa. **Ei ole marginaalia**: `<m>` (ADR 0003/0009) on sisuline tekst veerisel.

**Kuupäev:** 2026-10-16
**Staatus:** ettepanek (spekk enne teostust, mitu ülevaatust; 1. ja 2. ülevaatus 2026-10-16 sisse viidud)
**Seotud:** ADR 0071 (märgenduse register), #526 (kirjad), ADR 0003/0009 (`<m>`), ADR 0044 (peidetud täg),
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

**Praegune viga otsingutekstis.** Toorfailis on siirdeviit ja signatuur oma ridadel
lehe lõpus (`04na2fu4/00003.txt`: `Ehrwür⸗` ⏎ `A ij`). `clean_text_for_search`
liidab reavahetuse poolituse ja signatuur kleepub siirdeviida külge:
`lehekylje_tekst` = `…EhrwürA ij`, lk 9 `…seiB`. See on otsinguindeksis, mitte
ainult MCP kuvas; süsteemne igal poolitatud siirdeviidal, millele järgneb signatuur.

Laotusena pildistatud lehel (`[2v|1r]`) on ühes pildis kaks füüsilist lehte
(`<pb/>` vahel) — pildipõhine aadressiväli kannaks ainult ühte.

**Teostus (spekk 1):** `docs/superpowers/specs/2026-10-16-lehe-tahistus-tagid-design.md`,
plaan `docs/superpowers/plans/2026-10-17-lehe-tahistus-tagid.md` — tägid, otsingutekst,
`page_marks`, paneel. Aadressi tuletus (punktid 4–7) on spekk 2.

## Otsus (ettepanek)

1. **Kaks kihti.**
   - *Transkriptsioon* — see, mis lehel kirjas on, **täht-tähelt** ja ainult
     seal, kus midagi kirjas on. Tekstis ei ole kunagi toimetaja väärtust.
   - *Lehe aadress* — normaliseeritud ja tsiteeritav (`246v`, `A4v`, `12`), ka
     lehtedele, millel endal midagi ei ole. Tuletatakse; käsitsi määratud
     aadress on **eraldi andmed koos päritoluga** (punkt 5), mitte tekst.
2. **Neli paaristägi** VUTT-i tägisüsteemis (`<i> <b> <cs> <m> <hi> <ann> <add>`
   kõrval), atribuutideta, sisu täht-tähelt (terminid raamatukogusõnastikust):
   - `<fw>` — lehenummerdus / leheküljenummerdus (TEI `fw type="pageNum"`);
   - `<sig>` — signatuur (`fw type="sig"`);
   - `<catch>` — siirdeviit, rööptermin kustos (`fw type="catch"`);
   - `<rh>` — veerutiitel (`fw type="header"`; DTA `head`).

   Tähistus võib olla `<m>` sees, mitte vastupidi; tähistus ei sisalda tähistust.
   Detailid: spekk `docs/superpowers/specs/2026-10-16-lehe-tahistus-tagid-design.md`.

   Üks täg kõigi jaoks ei sobi: `B` ja `246` ei ole sisu järgi eristatavad, ja
   aadressi tuletus vajab teada, kumb on lehe number ja kumb signatuur. Lehel
   päriselt olevad nurksulud jäävad tägi sisse nagu muu tekst.
3. **Otsingutekst.** `clean_text_for_search` eemaldab tähistuse paarid **koos
   sisuga** (tühi string, tähistus on teksti voos läbipaistev) ja **enne** poolituste
   liitmist. Sisu läheb lehedokumendi **mitteotsitavasse** välja `page_marks`
   (ainult `meili_doc.py`, ADR 0006); filtreeritav väli tuleb vajadusel spekiga 2.
4. **Füüsiline lehekülg ja ankur.** Tuletuse ühik on füüsiline lehekülg, mitte
   pilt: pilt koos `<pb/>`-ga eraldatud tekstiosadega annab ühe või mitu füüsilist
   lehekülge, igaühel oma aadress. **Ankur** = füüsilise lehekülje `<fw>`/`<sig>`
   (liik + nähtav sisu + asukoht) või käsitsi määratud aadress. Seos tekstiosa ja
   aadressi vahel peab püsima pildi poolitamisel ja `<pb/>` muutmisel. ADR 0030
   `page_map` on ainult eeskuju: ta seob impordi lähtepildi väljundpiltidega, aga ei
   identifitseeri `<pb/>` tekstiosi ega kata hilisemaid poolitusi (lahtine küsimus).
5. **Käsitsi aadress** (lehel ei ole midagi, aga toimetaja teab, nt `[247v]`):
   eraldi kirje füüsilise lehekülje kohta, päritoluga `manual` ja autoriga.
   Sisestatakse **eraldi käsuga** (nt lehe aadressi väli Workspace'is), mitte
   tägi-nuppudega — need muudavad ainult teksti.
6. **Skeem on määratud, mitte arvatud.** Tsiteeritav aadress arvutatakse ainult
   **teose (vajadusel osa) tasemel määratud skeemi** järgi: `foliation`,
   `pagination`, `signatures`. Ilma skeemita
   tuletust ei tehta — on ainult nähtavad ja käsitsi ankrud. Automaatne tuvastus
   (punkt 8) annab skeemi kohta **ettepaneku**, mille toimetaja kinnitab.
7. **Tuletus ja selle piirid** (server, teose tasemel):
   - **Parser sõltub tägi liigist ja skeemist**, mitte ainult sisust:
     - `<fw>` + `pagination`: araabia või rooma number (eelmäng `xii`);
     - `<fw>` + `foliation`: number + valikuline `r`/`v`;
     - `<sig>`: **tüvi + valikuline poognasisene number**. Tüvi on suvaline
       (ka sümbolid), number araabia või rooma (`ij` = 2, `iij` = 3, lõpu-`j` = `i`);
       tüvi ilma numbrita = poogna 1. leht. `<sig>C</sig>` on poogen C, **mitte**
       rooma 100 — rooma tõlgendus kehtib ainult tüve järel olevale osale.
   - **Parsimatu ankur katkestab loenduse:** ta jääb nähtavaks sildiks ilma
     normaliseeritud aadressita ja **sellest edasi aadressi ei tuletata kuni
     järgmise kehtiva ankruni**. Loendus ei jätka varasemast ankrust üle
     tundmatu numeratsioonimuutuse.
   - Loendus algab ankrust ja kehtib **edasi järgmise ankruni, osa piirini või
     skeemi muutuseni**, kumb enne tuleb. Enne teose/osa esimest ankrut ja katkestuse
     järel on aadress **määramata**. Tagasi (ankrust eespool) ei loendata.
   - **Vastuolu vs uus jada.** Eristatakse kahte juhtu:
     - *lubatud uus algus* — vahepealsed aadressid jäävad kehtima: signatuuris uus
       tüvi poogna 1. lehena (loendur ootas `A5r`, ankur on `B`; poogna pikkus pole
       teada), samuti osa piir ja skeemi muutus;
     - *vastuolu sama jada sees* — ankur on sama jada (sama tüvi / sama
       numeratsioon), aga väärtus ei vasta loendusele (nt puuduv skaneering,
       foliatsiooni hüpe kirjade vahel ilma osapiirita): kõik vahepealsed tuletatud
       aadressid saavad lipu `conflict`. Neid ei kustutata ega parandata vaikselt;
       vaade näitab ebakindlana, toimetaja lahendab käsitsi ankruga või osapiiriga.
     Kas foliatsiooni/paginatsiooni tagasihüpe või suur edasihüpe on alati vastuolu
     või võib olla uus jada, otsustab spekk (praegu: vastuolu).
   - Laotus: pildi tekstiosade järjekord ei pruugi olla loenduse järjekord
     (`[2v|1r]`). Laotuspildil ei loendata ühelt tekstiosalt teisele — iga osa
     vajab oma ankrut või loendust naaberpildist; reegel spekis.
   - **Salvestuskoht: teose tasemel taastatav read-model** (ADR 0007), mitte lehe
     JSON — üks ankru parandus ei kirjuta ümber järgnevate lehtede JSON-e ega
     git-ajalugu. Kirje füüsilise lehekülje kohta: nähtav silt (liik), normaliseeritud
     aadress, päritolu (`visible` | `derived` | `manual`), `conflict`-lipp.
     **Paralleelsed sama liiki numeratsioonid** (vana foliatsioon + arhiivi oma —
     mõlemad `<fw>`) on **v1 piirang**: lehe kohta loetakse üks `<fw>`-jada;
     teine `<fw>` samal füüsilisel leheküljel on nähtav silt, aga loendusse ei lähe.
     Jada identiteet (kuidas ankur seotakse konkreetse numeratsiooniga) on lahtine
     küsimus. `<fw>` ja `<sig>` on eri jadad ja säilivad mõlemad.
     Autoriteetsed on ainult tekst (nähtavad ankrud), käsitsi aadressid ja skeem.
   - **Päästik** võrdleb ankrute **sisu ja asukohti** (mitte ainult hulka):
     `<fw>246</fw>` → `<fw>248</fw>` muudab aadresse. Lisaks kõik lehenumbreid
     muutvad teed (sama hulk nagu `refresh_work_mentions`, ADR 0055), skeemi ja
     käsitsi aadressi muutus. Arvutus **eelneb** Meili sünkile — praegu paneb
     `/save` sünki järjekorda enne mainimiste skanni (`editing.py` ~rida 237),
     aadressiga nii ei tohi.
8. **Sisestus v1: ilma ettepanekuta.** Lohistatav alati nähtav paneel nelja nupuga
   + kiirklahv `Ctrl/⌘+Shift+F` (menüü). Valikuta mähitakse kursori rida, valikuga
   valik; tühjal real lisatakse tühi täg (spekk 1, katse 2026-10-16). Ankru
   ettepanekut ei tehta (kasutaja 2026-10-16):
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
9. **OCR** (eraldi rada): lehe tähistust märgendavad nii Gemini juhis kui ka oma
   peenhäälestatud mudel (Qwen 3.5 9B, LOSS). Mudeli siht on VUTT-i ekspordi
   (`build_vutt_dataset.py`) kuju, seega peab ekspordileping olema paigas koos
   tägidega. Võimalikud olemasolevad allikad (kontrollida LOSSis): DTA TEI
   `<fw type="pageNum|sig|catch">`, PAGE XML `TextRegion @type`
   (`page-number`, `signature-mark`, `catch-word`). Praegu kirjutab OCR tähistuse
   omaette reale või jätab pliiatsinumbri välja.

## Lahtised küsimused (spekki)

- **Tägide nimed** (`<fw>`/`<sig>`/`<catch>` vs lühemad või eestikeelsed).
- **Käsitsi aadressi autoriteetne asukoht** (lehe JSON-i väli vs teose tasemel
  fail) — read-model teda kanda ei saa, sest see on taastatav.
- **Paralleelsete sama liiki numeratsioonide identiteet** (v1 piirang, p. 7):
  kuidas `<fw>` seotakse jadaga (järjekord lehel? eraldi täg? jada nimi?).
- **Füüsilise lehekülje identiteet** laotuse, poolituse ja `<pb/>` lisamise,
  kustutamise ja nihutamise üle — viimased võivad käsitsi aadressi vale
  tekstiosaga siduda ka ilma pilditoiminguta: pilditüvi +
  tekstiosa indeks? Mis juhtub tekstiga, kui laotuspilt poolitatakse.
- **Laotuse loendusreegel** (punkt 7) — kas lubada `[2v|1r]` mustrit kirjeldada
  (bifoolium), või nõuda ankrut igale poolele.
- **Ankru ettepanek** — v1-s ei ole (punkt 8); uuesti, kui päris kasutus näitab vajadust.
- **Skeemi kinnitamise UI** ja skeemi muutus teose sees (eelmäng rooma, edasi araabia).
- **Recto `r`** — kas normaliseeritud aadress kannab `246r` või `246`.
- **Topeltnumber lehel** — `o17ekb` lk 171 ja 173 kannavad mõlemad `<fw>86</fw>`
  (koodeksi foliatsiooniviga, täiendus 2026-10-18). Nähtav ankur jääb täht-tähelt;
  teine leht vajab eristavat käsitsi aadressi (`86a`/`86bis`, p. 5), millest loendus
  jätkub. Kas lahendamata duplikaat on `conflict` (p. 7 „tagasihüpe") või oma juht?
  Igal juhul **ei ole aadress unikaalne**: URL `/work/{id}/86v` võib viidata kahele
  lehele ja peab siis andma valiku, mitte valima vaikselt esimese.
- **Katsejuhtum:** `o17ekb` (Fischeri kirjad) — foliatsioon ainult rectol, osadega
  kirjakogu, topeltnumber. Esimene kasutus on kirjade sisukord (aadress lk-numbri
  kõrval, lk jääb navigeerimislingiks).
- **Olemasolev korpus:** lehe tähistuse read on praegu märgendita (viimased read). Kas
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
  (tähistus võib olla `<m>` sees, mitte vastupidi), transkribeerimisjuhendid,
  tägide register (ADR 0071).
- Server: `clean_text_for_search` (järjekord: tähistuse tägid enne poolituste
  liitmist), `meili_doc.py` (`page_marks`; filtreeritav väli spekis 2 — siis
  `meili_settings.py` MÕLEMASSE loendisse), aadressi read-model + `rebuild`, tuletaja ja selle
  päästikud (enne Meili sünki), skeemi väli teose/osa metaandmetes.
- Spekk vajab **mitut ülevaatust** enne teostust — puudutab redaktori
  invariante, otsinguteksti ja lehenumbreid muutvaid teid korraga.
