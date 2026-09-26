# ADR 0057 — MCP tohib esitada ainult ootel prosopo ettepaneku

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
