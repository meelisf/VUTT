# ADR 0042 — Töökollektsiooni liikmesust ei indekseerita; filter kannab ID-loendit

**Kuupäev:** 2026-09-14
**Staatus:** vastu võetud
**Seotud:** ADR 0006 (Meili legacy väljanimed), ADR 0007 (tuletatud indeksid on read-modelid), ADR 0031 (kirjutamisõigus = lugemisõigus JA ulatus), ADR 0038 (kahe peegli vahel peab olema ülimuslikkus), ADR 0040 (jälgitav fail on autoriteetne fail)
**Issue:** #354

## Kontekst

Töökollektsioon on kureeritud teoste valik („Fischeri konverents 2027"), millel
on oma vaatajad ja haldurid ning mida saab päisest valida töökontekstiks. Küsimus
oli, kust otsing teab, millised teosed kogusse kuuluvad.

Ilmne vastus oli uus Meili väli — `work_sets: ["ws_1", "ws_2"]` teose dokumendis,
filter `work_sets = "ws_1"`. See kukub läbi kolmel põhjusel, millest iga üksik
oleks piisav:

**1. Liikmesuse muutus muutuks reindeksiks.** Ühe teose lisamine kogusse
tähendaks teose kõigi lehekülgede dokumentide uuendamist — 1396 teost on
korpuses ~90 000 lehekülge. Kuraator, kes lisab kümme teost, käivitaks kümme
sünkroonimist. Liikmesus on kureerimistoiming, mida tehakse tihti ja väikeste
sammudena; indeks on ehitatud harva muutuva bibliograafia jaoks.

**2. Ligipääs ei mahu indeksisse.** Kogu nähtavus (`visibility`, `access`) ja
teose lugemisõigus (`collections`, tenant-token) on eraldi teljed, mis muutuvad
teineteisest sõltumatult. Kui liikmesus oleks indeksis, kannaks ta kõigile
kutsujatele sama vastust ja ligipääs tuleks ikkagi päringu ajal peale panna.

**3. Liikmesus oleks kahes kohas.** Autoriteetne fail
(`data/config/work_sets/<id>.json`, ADR 0040) ja indeks peaksid kokku langema.
Kaks kohta, mis peavad kokku langema, on ADR 0038 muster: nad lahknevad ja
lahknemine on vaikne — kogu näitaks vale arvu ja keegi ei saaks teada, kumb pool
eksis.

## Otsus

**Liikmesust ei indekseerita Meilisearchi kusagil.** Ei uut välja, ei liitmist
`collections` / `collections_hierarchy` sisse. Teoste `collections`, `is_public`
ja `shareable` jäävad puutumata — töökollektsioon ei ole teose omadus.

Selle asemel:

1. Server tagastab kutsujale `GET /work-sets/{id}/works` → **otsingus nähtavate**
   liikmete `work_id`-de loend.
2. Klient filtreerib `work_id IN [...]`, olemasoleva ligipääsufiltri **kõrval**,
   mitte asemel.

Otsingus-nähtavuse predikaat (`is_search_visible`) kordab tenant-tokeni filtrit
(`is_public = true OR collections_hierarchy IN [allowed]`), MITTE `can_read_work`-i.
Vahe on `shareable`-teoses: ta on lingiga avatav, aga mitte otsitav. Kui ta
loendisse lubada, näitaks kogu arv teost, mille sirvimine jääb tühjaks.

## Tagajärjed

**Mõõdetud, mitte arvatud** (tootmine, 2026-09-14, indeksis 1130 teost):

| Mõõde | 100 liiget | 500 | 1000 |
|---|---|---|---|
| Meili päring `work_id IN [...]` | 6,5 ms | 10,1 ms | 12,4 ms |
| Serveripoolne ID-loend | 4,4 ms | 17,8 ms | 36,2 ms |

Võrdlusalus ilma filtrita on 8,0 ms. Tuhande liikme filter maksab **+4 ms**;
ID-loend on `_metadata.json` lugemine liikme kohta (~36 µs). Kogu ahel püsib
~50 ms juures.

**Lagi:** `WORK_SET_MAX_MEMBERS = 1000`. See ei ole jõudluspiirang, vaid kaitse
ühe filtripäringu suuruse vastu (10 kB filtristring). 1000 on 72% kogu korpusest.

**ID-loend ei ole TTL-vahemälu.** Vastus sõltub kutsujast ja teoste
lugemisõigusest, mis muutuvad kogu `revision`-ist sõltumatult. `server/cache.py`
on selle töö jaoks keelatud — sealsed vahemälud on globaalsed moodulitasandi
muutujad ja kasutajapõhise vastuse hoidmine seal oleks risti-kasutaja leke.
Kliendipoolne loend visatakse ära valiku vahetusel, liikmesuse muutmisel ja
autentimisoleku muutumisel. Aegunud loend EI ava ühtki dokumenti, mida
tenant-token ei lubaks — ta laseb ainult jätkata samade ID-de filtreerimist.

**Tühi ID-loend tähendab NULL TULEMUST, mitte filtri ärajätmist.** Tühi kogu,
ligipääsu tõttu tühjaks filtreeritud kogu ja „kõik teosed" on kolm eri olekut.
Laadimata loend (`null`) VISKAB: vaikne tagasilangus piiramata korpusele
näitaks kasutajale teoseid väljaspool valikut.

**Isikute vaade kasutab sama loendit.** Uut liikmesusindeksit ei tehta —
`_persons_in_work_set` lõikab olemasolevat `person_to_works.json`-i kutsujale
nähtava teoste loendiga. Ligipääsu puudumine annab 404, mitte filtri eiramist:
eiramine tagastaks kogu isikuloendi.

## Alternatiiv ja miks ta tagasi lükati

Varasem spekk („kollektsioonide kaks telge") käsitles töökollektsiooni
kollektsioonina, millel on teine telg. See oleks tähendanud liikmesuse
`collections_hierarchy`-sse liitmist — sama indekseerimise probleem, pluss
ligipääsu segunemine: `collections_hierarchy` KANNAB lugemisõigust
tenant-tokeni kaudu, seega kogusse lisamine oleks vaikselt andnud lugemisõiguse
teosele. Töökollektsioon ei tohi ligipääsu laiendada, ainult piiritleda hulka
teostest, mida kasutaja niikuinii näeb.
