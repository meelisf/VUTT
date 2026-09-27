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

