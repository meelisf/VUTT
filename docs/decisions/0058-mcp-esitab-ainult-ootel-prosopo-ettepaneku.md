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

