# ADR 0058 — MCP tohib esitada ainult ootel prosopo ettepaneku

Kuupäev: 2026-09-26
Staatus: vastu võetud
Seotud: ADR 0001, 0023, 0040, 0046, 0048; #462, #471

## Kontekst

MCP on seni olnud teadusandmete suhtes ainult lugemiseks (ADR 0023). Ametite
ja hariduse rikastamisel peab agent saama ettepaneku VUTT-i isikuvormi üle
anda, kuid MCP-le antud püsiv editori sessioonitoken võimaldaks tal muuta kogu
prosopograafiat. Vestluses tehtud üldine `apply` peidaks keerulisi Q-koodide,
asutuste, kohtade ja daatumite valikuid.

## Otsus

1. Toimetaja loob VUTT-i sessioonis ühe isiku jaoks ühekordse üleandmiskoodi.
   Kood kehtib 15 minutit ja kannab isiku ID-d ning lähtekaardi `updated_at`-i.
   Server hoiab ainult koodi räsi ja seob üleandmise toimetaja sessiooni
   sõrmejäljega; toortokenit MCP ega ajutine andmebaas ei saa.
2. MCP `submit_person_enrichment_proposal` võib selle koodiga talletada kuni
   20 ameti- või haridusrida koos piiratud mahus allikaviidetega. Sisend on
   lubatud väljade loendi järgi valideeritud. Isikukaarti, `review`-välja ja
   autoriteetseid registreid see tee ei kirjuta. Kood kulub ühe esitusega.
3. Ootel ettepanek on ajutine tööolek `state/` SQLite-failis, väljaspool
   teadusandmete git-repot. See aegub seitsme päevaga. Ülevaatuse API nõuab
   sama toimetajasessiooni; ettepaneku ID ega üleandmiskood ei anna lugemis-
   ega salvestamisõigust.
4. Kaardi salvestamiseks on eraldi VUTT-i vormi kinnitamistoiming, mis
   kontrollib uuesti kaardiversiooni, registrivastet ja iga valitud rida.
   MCP-l ei ole selle toimingu tööriista. Kinnitusloogika ei kasuta üldist
   `/{id}/enrich` väljaradade kirjutust.
5. Ühekordse koodi esitust ei korrata automaatselt võrguvea järel. Server
   võis ettepaneku vastu võtta ja koodi kulutada; klient suunab toimetaja
   vormi vaatama.

## Tagajärjed

ADR 0023 read-only piir kehtib jätkuvalt autoriteetsete andmete kohta, kuid
MCP-le lisandub kitsas ajutise ettepaneku kirjutus. Uus kasutajale nähtav
kinnitusvaade näitab kõiki
kirjeid koos algse sõnastuse ja allikaviitega. Ajutise faili kadumine kaotab
ainult kinnitamata ettepanekud; isikukaardid ja registrid jäävad terveks.

## Täiendus 2026-09-27 (#492): ulatusega üleandmine

Ühekordne 15-minutiline isikukood muutis mahuka töö (kümned isikud) tseremooniaks ja
seansiga sidumine peitis ootel ettepaneku pärast uut sisselogimist. Muudetud:

- Kood kehtib **8 tundi** ja lubab **mitu esitust** kuni laeni (`uses < max_uses`,
  tingimuslik UPDATE). Ulatus: üks isik (20 esitust) või **kõik isikud** (200 esitust,
  `POST /prosopography/enrichment-handoff` ilma isikuta).
- Ettepanek on seotud **kasutajaga**, mitte seansiga: näeb ja kinnitab sama kasutaja igas
  oma seansis. See ei nõrgenda piiri — kinnitamine nõuab endiselt selle kasutaja sessiooni
  (ADR 0046) ja kood annab ainult ootel ettepaneku esitamise õiguse.
- Kaardiversiooni kontroll liikus koodilt esitusele: `base_updated_at` peab võrduma elava
  kaardi `updated_at`-iga (`stale_person`), enne kui kasutuskord kulub. Kinnitamine
  kontrollib versiooni uuesti.

Piir jääb: MCP ei kirjuta isikukaarti ega registreid.

## Täiendus 2026-09-27 (#492 samm 2): teose osade ettepanekud

Sama piir kehtib teose osadele (ADR 0057). Toimetaja annab teose halduses koodi
(`POST /works/{id}/parts/handoff`, `can_write_work`; 8 h, 20 esitust, ainult sellele
teosele). MCP `submit_work_parts_proposal` talletab osad `state/work_part_proposals.sqlite3`-s:
agent annab lehed **numbritena**, server teisendab need esitusel **tüvedeks** ja nõuab
`pages_version` (tüvede järjekorra räsi) kokkulangevust (`stale_pages`). Toimetaja otsustab
osa kaupa; vastuvõtt käib `work_parts.create_part` kaudu, nii et valideerimine, lukk, git ja
indeksid on samad mis käsitsi lisamisel. Lisa `attached_to` võib viidata sama ettepaneku
osale (indeks) — see lahendub alles siis, kui sihtosa on vastu võetud.

Esialgu (2026-09-27) on teose osade ettepanekute kood, loetelu ja otsused ainult
**superadminil** (`require_role("superadmin")` + UI) — teised toimetajad seda ei kasuta.
Laiendamine = rolli langetamine kolmes otspunktis ja `PartsTab`-is.

**Agendi pakutud isikud (#492):** osade ettepanek võib kanda `persons` loendit (nimi,
nimekujud, eluaastad, kontrollitud GND/Wikidata/VIAF, märkus, tõend); osa isik viitab sellele
`person_ref`-iga ja on kuni lahendamiseni NIMI. Toimetaja: loo (`create_person_checked`,
`created_via: agent` → isikute ülevaatusjärjekord, ADR 0048), seo olemasolevaga või jäta
nimeks. Juba kasutusel väline ID → `person_exists:<id>` (409) ja sidumise pakkumine.
MCP ei loo isikut ise.

**Hulgikinnitus (2026-10-05):** „Lisa kõik" on üks päring
`POST /works/{id}/parts/proposals/accept` (`items: [{proposal_id, index}]`) →
`work_part_proposals.decide_many` → `work_parts.apply_parts`: sama `_write` (lukk,
`validate_parts` iga osa järel, git), aga ÜKS commit ja ÜKS Meili sünk. Enne tegi klient
rea kaupa päringu: 16 osa = 18 s, sest iga rida indekseeris kogu teose uuesti (~0,7 s 57
lehe juures). Klient saadab NÄHTUD read — vahepeal saabunud ettepanekut ei võeta nägemata
vastu. Kogum on atomaarne: vigane rida → midagi ei kirjutata, viga nimetab rea
(`items[i]`). Lisa võib viidata samas kogumis loodavale kirjale; server järjestab lisad
viimaseks. Osade otspunktid annavad `background_tasks`-i, seega Meili sünk ja
`person_to_works` käivad taustal (ADR 0013 koondab ja kordab).


## Täiendus 2026-09-28: tõend ainult VUTT-ist

Agent esitas tõendina veebiallikaid (`literature` + vabateksti pealkiri + PDF-URL),
mida toimetaja ei saa VUTT-is kontrollida. Muudetud:

- Tõendi liik on ainult `vutt_page` või `literature`; `external` ja `url` on
  eemaldatud. `vutt_page` kontrollib server esitusel: teos on olemas ja leht jääb
  teose lehtede arvu piiresse (`unknown_work`, `page_out_of_range`).
- `literature.source_id` peab olema kirjanduskogu `doc_id`. Kogu elab agendi
  masinas (ADR 0023) ja server teda ei näe, seega kontrollib seda **MCP** enne
  saatmist; kogu puudumisel lükatakse `literature`-tõend tagasi.
- Veebist leitud (ka akadeemilise) allika peale agent ettepanekut ei tee, vaid
  ütleb vestluses, et allikas on väärt lisamist; inimene lisab selle
  kirjanduskogusse. Eraldi „allika lisamise" ettepanekutüüpi ei tehta.
- `raw_occupation`/`raw_institution` on allika sõnastus sõnasõnalt, allika
  keeles; normaliseerimine on registrivõtme töö (ADR 0059).
- Valideerimisviga nimetab kirje (`items[i]`) ja välja; MCP annab FastAPI
  `detail`-i agendile terviklikult edasi.

## Täiendus 2026-09-29: ülevaatus on otsus, vananemine rea tasemel

- Ülevaatus = **Kinnita** või **Lükka tagasi** (rea kaupa või „Kinnita kõik");
  paranduste mehhanism (`corrections`) on eemaldatud. Toimetamine käib pärast
  kinnitamist tavalises isikuvormis.
- Kogu töövoog (kaks koodi, loetelu, apply, reject) on `require_role("superadmin")`
  ja paneel nähtav ainult superadminile, kuni töövoog on silutud.
- Ettepaneku tasemel `base_updated_at` kontroll kinnitamisel kaob. Iga rida hinnatakse
  kinnitamise hetkel elava kaardi vastu (`_merge_row`): uus fakt, mis on kaardil →
  `duplicate_entry`; „juba kaardil" sihtkirje leitakse SISU järgi (`existing_index`
  on vihje). Registrivõtmeta või `ambiguous` rida on blokeeritud — registriseose
  lahendab agent, mitte ülevaataja. Esitamisel jääb `stale_person` alles. Server
  arvutab loetelus iga rea `review_state`-i; klient olekut ise ei arvuta.
- Kinnitus: eelkontroll (ei kirjuta) → registrikirjed (`registries.ensure`) → kaart üks
  kord. Kõik-või-mitte-midagi kaardi suhtes, mitte registri suhtes: pärast kirjete
  loomist kukkunud kinnitus tagastab `created_registry_entries` ja kordus seob nendega.
- `literature`-tõend kannab loetavat `citation`-i; selle kirjutab MCP kirjanduskogu
  reast (agendi oma asendatakse). Tõendid on isikulehel joonealuste viidetena näha.

## Täiendus 2026-10-19 (#641): lehe teksti ettepanek

Sama piir kehtib lehe tekstile. Spekk:
`docs/superpowers/specs/2026-10-19-mcp-lehe-teksti-ettepanek-design.md`.

- MCP kirjutab ka lehe teksti AINULT ootel ettepanekuna
  (`state/page_text_proposals.sqlite3`). Agendikood on ÜKS: teose halduses
  („Osad" → „Kood agendile", `POST /works/{id}/parts/handoff`, `scope` = `work` |
  `all`), ja see kehtib nii osade kui ka lehe teksti ettepanekutele (8 h, 20 esitust
  kummagi kohta). Kõik otsused ja koodid on ainult superadminil. Iga
  superadmin näeb kõiki ettepanekuid. Piiratud teos on lubatud. Toortekst
  (`/works/text-proposals/source`) väljastatakse AINULT kehtiva koodiga, sest
  `/api/files/` on avalik.
- Agent loeb toorteksti KETTALT (mitte Meilist, mis jääb maha). Esitusel kannab ta
  lehe tüve ja toorbaitide räsi. Asendused (`old` → `new`, `old` täpselt üks kord)
  rakenduvad toortekstile, normaliseerimine tuleb alles nende järel.
- Muudatus ei tohi tekitada UUSI märgendusvigu (`vutt_tags.new_markup_errors`; vana
  viga kettal ei blokeeri). `ann`-tokeneid asendus ei puuduta (`anchor_touched`).
- Ülevaatus liidab ettepaneku ketta praeguse tekstiga ÜHE `page_lock`-i all ja
  kontrollib märgendust uuesti, sest `merge_text` võib konfliktita jätta üksiku `</i>`.
  Kokkupõrge → `stale`. Kinnitus käib `/save` + `proposal`-viite kaudu või paki
  taustatööna ÜHE commit'iga. Git-vea korral taastatakse ketas lukke vabastamata.
- Lukkude järjekord: ettepanekulukk (id) → `page_lock` (tüvi) → `_git_write_lock`.
- Kinnitus ei muuda lehe seisundit ega JSON-välju.

## Täiendus 2026-10-20: üks agendikood, ülevaade `/review`-l

Spekk: `docs/superpowers/specs/2026-10-20-uhtne-agendikood-design.md`. Asendab
2026-10-19 täienduse koodi asukoha („Osad" → „Kood agendile") ja #492 isikuvormi
koodinupud.

- **Üks kood kolmele hoidlale.** `POST /agent-handoff` (superadmin, rate-limit
  kasutaja kaupa) genereerib koodi ja registreerib selle SAMA räsiga lehe teksti,
  teose osade ja isikukaartide hoidlas, ulatus alati „kõik teosed + kõik isikud".
  Iga hoidla hoiab oma lage (tekst 20, osad 20, isikud `ANY_MAX_USES`) ja TTL-i (8 h).
  Hoidlad jäävad eraldi SQLite-failideks (`server/agent_proposals.py` koondab).
- **Kompensatsioon, mitte tehing.** Kolm faili ühist tehingut ei anna: kui mõni
  registreerimine viskab, tühistatakse kood (`revoke_code`, räsi järgi) juba
  õnnestunud hoidlatest ja otspunkt annab 503 `agent_handoff_failed`. Osaliselt
  kehtivat koodi kasutajale ei näidata.
- **Ühtne loend.** `GET /agent-proposals` (superadmin) annab read kujul
  `{kind, proposal_id, target_id, target_label, target_url, pending, stale, created_at}`.
  **`target_url` koostab server** — klient ei tuleta sihtlehte. Tekst →
  `/work/{id}/{lk}?proposal={id}` (lk = paki esimese ülevaatust vajava ja teoses
  alles oleva tüve PRAEGUNE positsioon, muidu 1; redaktor eelistab `proposal`-
  parameetri pakki), osad → `/work/{id}/manage?tab=parts`, isik →
  `/persons/{id}/edit?agent=1`. `stale`: tekst = lehtede loendus, osad = `pending`
  kui `pages_version` muutus, isik = `null` (vananemine hinnatakse vormis).
- **Nähtavus järgib sihtvaadet**, et klikk ei viiks tühja vaatesse: tekstipakke
  näevad kõik superadminid, osi ja isikuid ainult koodi loonud kasutaja.
- **Vanad otspunktid eemaldatud** (`/works/{id}/parts/handoff`,
  `/prosopography/enrichment-handoff[/{id}]`). Hoidlate skeem ei muutunud, seega juba
  antud kitsa ulatusega koodid kehtivad oma 8 h lõpuni (ulatuse kontrollid `submit`-is
  jäävad). MCP tööriistade signatuurid ei muutunud.
- `/review`-l ei otsustata — otsus jääb redaktorisse, „Osad" vahekaardile ja isikuvormi.

## Täiendus 2026-10-29 (#675): üks koodihoidla

Asendab 2026-10-20 täienduse punktid „Hoidlad jäävad eraldi SQLite-failideks" (koodi
osas) ja „Kompensatsioon, mitte tehing".

- **Kood elab ühes hoidlas** `state/agent_handoff.sqlite3` (`server/agent_handoff.py`).
  Rida = kood × liik (`text`, `parts`, `person`), ulatus = liik + `target_id`
  (`NULL` = kõik). Iga liik hoiab oma lage (`max_uses`/`uses`: tekst 20, osad 20,
  isikud `ANY_MAX_USES`); TTL (8 h) ja `session_fingerprint` on koodi omad.
  Ettepanekud jäävad liigiti eraldi failidesse.
- **Väljaandmine on üks tehing**: kõik liigiread ühe INSERT-iga, kompensatsiooni
  (`revoke_code`) ei ole. Ebaõnnestumine → 503 `agent_handoff_failed`, ridu ei jää.
- **Kulutus ja ettepanek on üks tehing.** Ettepanekute hoidla ühendab koodihoidla
  `ATTACH`-iga (`agent_handoff.attach`) ja kulutab koodi (`consume`) samas tehingus,
  kus ta ettepaneku INSERT-ib. Mitme faili tehing on atomaarne ainult
  rollback-journal režiimis — **WAL-i ei tohi kummalegi failile lülitada.**
- Tühistus kasutaja järgi (`revoke_user`, #619) käib ühest kohast.
- **Üleminek:** hoidlate vanad `handoff` tabelid kustutatakse (`DROP TABLE`). Enne
  deploy'd antud koodid kaotavad kehtivuse — agent küsib uue koodi.
- Uus ettepanekuliik = uus `kind` väärtus `agent_handoff.KINDS`-is + piir
  `issue_agent_handoff`-is; uut koodihoidlat ei tehta.

## Täiendus 2026-11-01 (#703): eksemplari ettepanek

Kavand: `docs/superpowers/specs/2026-11-01-eksemplari-ettepanekud-design.md`; mudel ADR 0076 §7.

- **Tõendi liik `ester` on lubatud AINULT eksemplari-ettepanekul** — erand täiendusest
  2026-09-28 („tõend ainult VUTT-ist"). ESTERi kirje on püsiv, numbriga kontrollitav
  kataloog, mitte suvaline veebileht. Server kontrollib numbri kuju (`^b\d{7,8}$`) ja
  tsitaadi pikkust (≤ 500 märki); lingi (`https://www.ester.ee/record=<ref>*est`)
  koostab klient, agent URL-i ei anna. Üks rida = üks allikas. Muu veebiallika peale
  agent endiselt ettepanekut ei tee.
- **Uus liik `exemplars`** `agent_handoff.KINDS`-is (lagi 20 esitust), hoidla
  `state/exemplar_proposals.sqlite3` (`server/exemplar_proposals.py`), kulutus + INSERT
  üks `ATTACH`-tehing nagu teistel liikidel. Otspunktid `POST /works/exemplar-proposals/submit`
  (autentimata, kood), `GET /works/{id}/exemplar-proposals`, `POST /works/{id}/exemplar-proposals/decide`
  (superadmin). `/review` loendis `target_url = /work/{id}/manage?tab=exemplars`,
  `stale` = ootel read, mida praegu kinnitada ei saa. Nähtavus: koodi loonud kasutaja.
- Ülevaatus = Kinnita / Lükka tagasi (täiendus 2026-09-29). Valitud read = üks
  `work_exemplars.apply_proposal_ops` kirjutus = üks commit, atomaarne.
- Otsustatud ridadega ettepanekut aegumine ei kustuta: hilisem süstemaatiline läbikäik
  toetub „töödeldud" märkele. Ootel read aegunud ettepanekus on `expired`.


## Täiendus 2026-11-18 (#834): isikukaardi kõik sisuväljad, 1. osa

Disain: `docs/superpowers/specs/2026-11-18-isikuettepanek-koik-valjad-design.md`.
Agent tuvastas isiku allikast (Johannes Horn, Levitski I lk 106), aga sai esitada ainult
ameti ja hariduse; sünd, surm ja elulugu jäid käsitsi tööks. Muudetud:

- **Uued realiigid** samas isikuettepanekus (sama kood, hoidla, paneel, `/review`):
  `birth` (kuupäev), `death` (kuupäev + valikuline `place_key`), `origin` (`place_key`),
  `gender` (`M`/`F`), `biography` (`lang` et/en, terve uus tekst, `base_hash`,
  valikuline `sources_add`). Liigiloogika `server/prosopography/enrichment_kinds.py`.
  Igat skalaarliiki ja eluloo keelt kuni üks rida ettepanekus (`duplicate_kind`).
  Sünnikoht ei ole `birth` osa: kanooniline koht on `origin.place` (ADR 0084).
- **Olekud** (server arvutab): `applicable` (väli tühi), `already_present` (sama väärtus —
  lisandub ainult tõend; kuupäeval = sama `date` ja täpsus), `conflict` (kaardil teine
  väärtus — kinnitus ASENDAB, vana tõend kaob; vaikset ülekirjutust ei ole, otsus on
  toimetaja nupuvajutus), elulool `replace` (olemasolev tekst, räsi klapib).
  `blocked`: `stale_biography` (tekst muutus pärast esitust), `unknown_place_key`.
- **Tõendi koht (segamudel):** skalaarväljal oma `evidence` (`birth.evidence`,
  `death.evidence`, `origin.evidence`) → isikulehel joonealune viide. Isikuvorm kannab
  selle läbi (`birth_evidence` jne mustandis) ja jätab maha, kui toimetaja väärtust
  muudab. `gender`-i tõend on esitusel kohustuslik, kaardile ei salvestata.
  Elulool viited tekstis (VUTT-i lehe link või lühiviide), täiskirjed `sources_add` →
  `sources[]` (ADR 0078) duplikaatideta; VUTT-i lingid ja `sources_add` teosed
  kontrollitakse esitusel nagu `vutt_page`.
- **Elulugu:** asendus `base_hash` = `text_hash` (ADR 0039) vastu; tõlkeankrut kinnitus ei
  kirjuta (teise keele ankur vananeb ise). Markdown ilma HTML-ita, kuni 40 000 märki.
- **Vene keel** (#833): kirillitsa keelatud eluloos ja kaardiväljadel; lubatud ainult
  viites (`citation`, `locator`, `sources_add[].text`). MCP teeb `sources_add`
  kirjanduskogu viitest loetava teksti.
- Mahud: ettepanek ≤ 128 000 baiti, MCP kontekst ≤ 150 000 märki (pikad elulood).
- 2. osa (nimevariandid, staatused, konfessioon, matmine, `floruit`, seosed,
  identifikaatorid) on eraldi töö.

## Täiendus 2026-11-18 (#834): 2. osa — loendiväljad, tegutsemisaeg, identifikaator

Disain: sama fail, jaotis „2. osa".

- **Uued realiigid:** `alias`, `name` (ADR 0083 liik), `status`/`confession` (Q-kood
  `vocabularies.json` suletud sõnastikust; vale koodi viga loetleb lubatud), `floruit`
  (skalaar, tõend kaardil nagu sünnil — vorm `floruit_evidence`), `relation`
  (`target_id` = elav VUTT-i isik või nimepõhine), `identifier` (`wikidata|gnd|viaf|album_academicum`).
- **Loendiväljad on lisavad:** agent ei eemalda ega muuda olemasolevat rida. „Juba kaardil":
  alias ka kanoonilise nime/nimeajaloo kujuna; seos sama `target_id` (selleta nimi).
  Loendirea tõend on esitusel kohustuslik, kaardile ei salvestata.
- **Identifikaator salvestatakse AINULT ID-na** (kasutaja otsus): Wikidata/GND päringut ega
  automaatrikastust kinnitus ei tee. ID teisel kaardil → `blocked: duplicate_person_id`;
  sama skeem teise ID-ga → `conflict` (asendab).
- **Vastastikune seos:** PUT-i järelsammud (`sync_reciprocals`, siltide rikastus) on
  `router._after_person_save`-is ja kinnituse otspunkt kutsub sama — B kaart saab
  `reciprocal_auto` rea nagu käsitsi salvestusel.
- **Matmine (`burial`) jääb välja**, kuni isikuvormis on väli.

## Täiendus 2026-11-22 (#869): agendi ligipääs adminile

Seni oli kogu töövoog (kood, loend, ülevaatus, kinnitus) ainult superadminil.
Nüüd saab superadmin anda ligipääsu **üksikule adminile**.

- **Õigus on kasutajapõhine lipp**, mitte grupp: `users.json` → `agent_access: true`.
  Kehtib AINULT rollil `admin` (`auth.has_agent_access`; superadmin alati). Lippu
  kirjutab ainult superadmin (`POST /admin/users/agent-access`, `set_agent_access`).
  Kasutajate tabil (`UserDetail`) on lüliti ainult superadminile ja ainult admini kirjel.
- **Lipp elab sessioonis** (ADR 0046): `verify_user` paneb ta hetktõmmisesse, kirjutus
  katkestab sihtkasutaja sessioonid (valvur `test_oigusvalja_kirjutus_katkestab_sessiooni`
  loeb `agent_access`-i õigusväljaks). Äravõtmine tühistab ka tema agendikoodid
  (`agent_handoff.revoke_user`). Rollimuutus mitte-adminiks pühib lipu — hilisem
  tagasiedutamine ei taasta unustatud õigust.
- **Üks sõltuvus:** kõik ettepanekuteed (`/agent-handoff`, `/agent-proposals`, lehe tekst,
  osad, eksemplarid, isiku rikastus) kasutavad `deps.require_agent_access`. Liputa admin
  saab 403 (mitte 401 — klient loeb 401 sessiooni surmaks). `/save` `proposal`-viide
  kontrollib sama `has_agent_access`-iga.
- **Nähtavus:** admin näeb ja otsustab AINULT oma koodiga tulnud ettepanekuid, superadmin
  kõiki (`deps.proposal_scope` → hoidlate `see_all`). See muudab kahte varasemat reeglit:
  tekstipakid ei ole enam kõigile ülevaatajatele nähtavad, ja osi/eksemplare/isikuid näeb
  superadmin ka teiste kasutajate omi. Võõras ettepanek on adminile „tundmatu" (sama viga
  nagu puuduval, olemasolu ei leki); `/save` käsitleb võõrast pakki nagu otsustatut.
  Loendi read kannavad `username`-i (superadmini filter).
- **Üks koht:** kood ja ettepanekute loend kolisid `/review` lehelt uude „Agendid"
  kaarti (`/admin/agents`). Otsus käib endiselt sihtvaates.
