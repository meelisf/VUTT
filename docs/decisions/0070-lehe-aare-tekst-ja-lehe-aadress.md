# ADR 0070 — Lehe ääre tekst on märgendatud; lehe aadress tuletatakse

**Kuupäev:** 2026-10-16
**Staatus:** ettepanek (spekk enne teostust, mitu ülevaatust)
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
     seal, kus midagi kirjas on.
   - *Lehe aadress* — normaliseeritud ja tsiteeritav (`246v`, `A4v`, `12`), ka
     lehtedele, millel endal midagi ei ole. **Tuletatakse**, ei sisestata.
2. **Kolm paaristägi** VUTT-i tägisüsteemis (`<i> <b> <cs> <m> <hi> <ann> <add>`
   kõrval), atribuutideta, sisu täht-tähelt:
   - `<fw>` — lehekülje- või foliatsiooninumber (TEI *forme work*);
   - `<sig>` — poognasignatuur;
   - `<catch>` — kustood.

   Üks täg kolme jaoks ei sobi: `B` ja `246` ei ole sisu järgi eristatavad, ja
   aadressi tuletus vajab teada, kumb on lehe number ja kumb signatuur.
   Nurksulud sisus (`<fw>[247v]</fw>`) = toimetaja lisatud väärtus, mis
   kirjutab tuletuse üle (TEI tava).
3. **Otsingutekst.** `clean_text_for_search` eemaldab kõik kolm tägi **koos
   sisuga** ja **enne** poolituste liitmist. Sisu läheb lehedokumendi eraldi
   väljadesse (ainult `meili_doc.py`, ADR 0006).
4. **Aadressi tuletus** (server, teose tasemel — sõltub naaberlehtedest):
   - Parser: silt = **tüvi + number + valikuline `r`/`v`**. Tüvi on suvaline
     (ka sümbolid), number araabia või rooma (`ij` = 2, `iij` = 3, lõpu-`j` = `i`);
     tüvi ilma numbrita = poogna 1. leht.
   - Ankrute vahel loendatakse edasi skeemi järgi (foliatsioon: `r`/`v`
     vaheldumisi; signatuur: lehed poognas `r`/`v`; paginatsioon: +1). **Iga
     ankur nullib arvestuse** — viga ei kogune.
   - Ilma ankruta lehtedel aadress puudub (mitte oletus teose algusest).
   - Laotuspildil mitu aadressi (`<pb/>` vahel).
   - Ümberarvutus tägimuutusel ja igal lehenumbreid muutval teel — sama päästik
     nagu `refresh_work_mentions` (ADR 0055): järjestus, poolitus, lisamine,
     kustutamine, taaste.
5. **Sisestus — ettepanek pakub järgmist ANKRUT, mitte aadressi.** Kiirklahv
   lisab tägi esimese kandidaadiga (valitud): Enter võtab, Tab vahetab, kirjutamine
   asendab; vihje näitab põhjust („eelmine 246v → foliatsioon"). Kandidaadid
   annab **puhas funktsioon** viimasest 2–3 sildist (eelmised lehed + sama lehe
   varasemad tägid):

   | Viimased | Skeem | Ettepanek |
   |---|---|---|
   | `12`, `13` | paginatsioon | `14` |
   | `246`, `246v` / `246v` | foliatsioon | `247` |
   | `246r`, `246v` | foliatsioon r-iga | `247r` (kirjaviis säilib) |
   | `xi`, `xii` | rooma, sama suurus | `xiii` |
   | `A ij`, `A iij` | signatuur, kirjaviis säilib | `A iiij`, teisena „ei midagi" / `B` |
   | `)(2`, `*3`, `Aa2` | signatuur, tüvi muutmata | `)(3`, `*4`, `Aa3` |
   | `246` üksi | kahemõtteline | `246v` ja `247` |

   Kahemõttelisel juhul järjestab teose tüüp (käsikiri → foliatsioon ees,
   trükis → paginatsioon ees); **ajalugu kaalub tüübi alati üles**. Poogna
   lõppu ja järgmist tüve funktsioon ei tea — inimene kirjutab üle, järgmine
   ettepanek jätkab sealt.
6. **OCR** (hilisem samm): Gemini juhis märgendab ääre teksti kohe. Praegu ta
   kirjutab selle omaette reale (või jätab pliiatsinumbri välja).

## Lahtised küsimused (spekki)

- **Tägide nimed** (`<fw>`/`<sig>`/`<catch>` vs lühemad või eestikeelsed).
- **Kus elab tuletatud aadress:** lehe JSON-i serveripoolne väli (üks tägimuutus
  kirjutab järgmiste lehtede JSON-id kuni järgmise ankruni) vs teose tasemel
  read-model (ADR 0007, taastatav). Kumb on Meili sünkiga lihtsam.
- **Mitu paralleelset numeratsiooni** samal lehel (vana foliatsioon + arhiivi oma;
  paginatsioon + signatuur on juba kaks tägi). Kumb on „lehe aadress"?
- **Verso `r`** — kas normaliseeritud aadress kannab `246r` või `246`.
- **Olemasolev korpus:** ääreread on praegu märgendita (viimased read). Kas
  heuristiline ettepanek (lühike viimane rida signatuuri mustriga) ülevaatusele —
  automaatne migratsioon ei ole tõenäoliselt ohutu.
- **Treeningandmed** (`build_vutt_dataset.py`): kas tägid antakse mudelile edasi.
- **Kasutus:** kuvamine Workspace'is, URL (`/work/{id}/246v`?), osa ulatus
  „l. 246–247v" (#526, TEI `msItem/locus`), kirjaotsingu tulemusrida, MCP
  (`get_pages` päis), IIIF `canvas` label, CMIF.

## Tagajärjed

- Uus täg muudab samu kohti nagu ADR 0067: `VUTT_TAGS` (`VuttMarkupExtension.ts`,
  mark-dekoratsioon + `atomicRanges`, ADR 0044), `renderVuttMarkup.ts`,
  sanitiseerija ja `strip_empty_tags`, `cleanMarkup`, marginaalia normaliseerija
  (täg ei tohi minna `<m>` sisse ega vastupidi — reegel spekis), transkribeerimisjuhendid.
- Server: `clean_text_for_search` (järjekord: ääre tägid enne poolituste
  liitmist), `meili_doc.py` + `meili_settings.py` (filtreeritav väli
  MÕLEMASSE loendisse), serveripoolsed lehe väljad, aadressi tuletaja ja selle
  päästikud.
- Spekk vajab **mitut ülevaatust** enne teostust — puudutab redaktori
  invariante, otsinguteksti ja lehenumbreid muutvaid teid korraga.
