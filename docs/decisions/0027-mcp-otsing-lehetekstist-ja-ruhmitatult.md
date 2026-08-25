# ADR 0027 — MCP `search_pages` otsib ainult lehetekstist ja vastus on rühmitatud teose kaupa

**Kuupäev:** 2026-08-25
**Staatus:** vastu võetud
**Seotud:** ADR 0006 (Meili legacy väljanimed), ADR 0023 (MCP lokaalne olek)

## Kontekst

Agent teeb ühe uurimisküsimuse peale kümneid MCP-päringuid. Mõõtmine 2026-08-25
näitas kolme eraldi probleemi, millest kaks on korrektsus, mitte maht.

**1. Otsinguulatus.** `search_pages` ei seadnud `attributesToSearchOn`-i, nii et
Meili otsis kõigist 17 searchable-väljast. Teose metaandmed (`title`,
`authors_text`, `notes`) on dubleeritud **igale lehe-dokumendile** — üks
pealkirjavaste andis seega kõik teose leheküljed „vasteks". „Buchdrucker": 469
vastet, millest 380 ei sisaldanud sõna üldse; top-10 tuli ühest teosest.

Konstant `queries.SEARCH_FIELDS` oli olemas ja lepingutestiga valvatud, aga
**mitte kunagi päringusse pandud**. Test kontrollis, et deklareeritud väljad on
searchable — mitte seda, et päring neid kasutaks. Vale turvatunne.

**2. Vastuse kordus.** 26 % `search_pages` vastuse mahust oli märk-märgilt
korduv päis: sama teose leheküljed järjest, igaüks täispäisega. Seisundite
legend (~100 tokenit) ja rollilegend (~92) kordusid igas vastuses, ehkki
serveri `instructions` jõuab kliendini niikuinii üks kord seansi kohta.

**3. `get_work` lehe-loend.** Rida iga lehekülje kohta koos täis-URL-iga.
Korpuses on mediaanteoses 9 lehte, aga suurimas 706 — see maksis ~18 000
tokenit. 89 % teostest kannab kõigil lehtedel sama seisundit ja lehenumbrid on
katkematud, nii et loend oli peaaegu täielikult tuletatav.

## Otsus

**`search_pages` otsib ainult lehetekstist** (`PAGE_SEARCH_FIELDS` =
`lehekylje_tekst`, `marginaalia_tekst`) — sama ulatus, mis töölaua otsingu
`scope='original'`. `search_works` otsib ka pealkirjast ja autoritest
(`WORK_SEARCH_FIELDS`), sest „millised teosed" on teisel tasandil küsimus.
Tööriistade tööjaotus on sellega tegelik, mitte ainult docstringis.

**Vastused on rühmitatud teose kaupa:** päis üks kord, leheküljed selle all.
Teoseülene otsing **laotatakse teoste peale**: Meilist tõmmatakse
`limit × OVERFETCH` vastet ja iga teose osakaal kärbitakse `PAGES_PER_WORK`
(3) lehele. Kapp EI rakendu, kui `work_id` on antud — siis ongi küsimus „kus
SELLES teoses". Kärpimine käib enne offsetit, muidu ei oleks lehekülgede
järjestus lehelt lehele sama.

**Legendid ei kordu vastustes.** Seisundite skaala elab `instructions.py`-s;
rollilegend väljastatakse ainult siis, kui teosel on mõni roll peale `auctor`-i.

**`get_work` loetleb leheküljed vahemikena** (`format_page_index`),
kodeerituna tegelike lehenumbrite peale, nii et auk annab eraldi vahemiku.

## Tagajärjed

Mõõdetud enne → pärast (10 päringut, `limit=10`):

| | Enne | Pärast |
|---|---|---|
| Eri teoseid top-10-s | 1–2 | 6–10 |
| `search_pages` latents | ~300–400 ms | ~76–132 ms |
| Vastuse maht (6 päringut) | ~36 000 märki | ~34 800 märki, 6× rohkem teoseid |
| `get_work`, 706 lk teos | ~48 500 märki | ~90 märki |
| Kogu korpuse lehe-loendid | 1 641 838 märki | 121 143 (−93 %) |

`Vasteid kokku` on nüüd **väiksem, aga tõene** — varasem number sisaldas
lehekülgi, kus otsitavat sõna ei olnud. See on tahtlik regressioon numbris.

Ületõmbeaken on väike (`OVERFETCH = 3`, lagi 60), sest üleujutuse juur oli
otsinguulatuses: pärast selle parandust ei lisa aken 60 ega 200 ühtki teost,
küll aga 250–360 ms latentsi.

Lepingutestid: `test_meili_contract.py` valvab, et otsitavad väljad on
searchable JA et serveri juhend nimetab kõiki `types.ts` `PageStatus`
väärtusi (seisundite legend on nüüd ainult seal).
