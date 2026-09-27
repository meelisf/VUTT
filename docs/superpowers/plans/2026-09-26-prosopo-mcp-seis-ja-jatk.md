# Prosopo ametite ja hariduse rikastus: seis ja jätk

## Tootmiskatse 2026-09-27

PR #478 liideti (`2cacf1c0`) ja backend ning frontend juurutati koos.
PR #479 (`3201a4cd`) parandas lisaks sisselogimata nähtava adminivormi;
anonüümne tootmisbrauser suunatakse nüüd avalehele. Mõlemad konteinerid
olid pärast juurutust terved. Tootmise andmeid lugenud eraldatud kontroll
valideeris kirjutamata 2416 isikukaarti ja 4257 ameti- või hariduskirjet.

Kasutaja eraldi kinnituse järel lisati kaks autoriteetset registrikirjet:
`academia-gustavo-carolina` (Q138710754, variant `AGC`, `place_key=Dorpat`,
andmerepo commit `235414e1`) ja `professor` (Q121594, commit `25246d3a`).
Avalik kandidaadiotsing tagastab mõlemale ühe vaste; MCP kandidaadiotsing ja
ühe avaliku isiku rikastuskontekst töötavad samuti tootmise API vastu.
Kuivkäivitus leidis 4347 ülevaadatavat viiterida ja 393 rühma; 120 real on
kandidaat (91 AGC, 12 professor, 17 olemasolev koht). Ühtegi isikukaarti ei
muudetud. Andmerepo jäi pärast kahte registri commit'it puhtaks.

Järgmine andmesamm on 393 rühma ülevaatus ja kinnitatud otsuste põhjal
isikukaartide migratsioon. Ühe isiku MCP → vorm → kinnitus läbikäik vajab
toimetaja sisselogitud brauseriseanssi. Allika värske OCR-oleku ja
toimetajamärkuste kuvamine kinnitamisvaates on jätkuvalt tegemata.

## Jätk 2026-09-27

Tootmise `data/` peal kirjutuseta kuivkäivitus leidis 4347 fakti ja 394
ülevaatusrühma. Kasutaja kinnitas, et lühend `AGC` tähistab Academia
Gustavo-Carolinat (Q138710754), mitte Academia Gustavianat (Q28966944).
Nende kahe asutuse registrivõtmed ja nimevariandid peavad jääma lahku.

Haru on nüüd ühendatud 2026-09-26 lõpu `main`-iga (#464 osade UI). ADR-i
numbrikonflikt lahenes: MCP ettepanek on ADR 0058, teose osad ADR 0057.

#462/#471 registrite alus on lisatud: serveri eraldi registri lugemis- ja
admini salvestus-API, isikufakti võtmete ja Q-koodi kooskõlastus, käsitsi vormi
registriotsing, admini registrivaade, elukäigu koha lahendamine `place_key`
kaudu ning kuivkäivitatav ülevaatustabel. Otsus on ADR 0059.

Kuivkäivitus päris `data/` koopial (kirjutab ainult CSV väljundi):

```bash
python3 scripts/prosopo_registry_dry_run.py --data-dir /path/to/data \
  --output /tmp/prosopo-registry-review.csv \
  --details /tmp/prosopo-registry-facts.csv
```

Koondtabelis `candidate` on olemasoleva registri soovitus,
`suggested_new_key` on ülevaatust vajav uue võtme ettepanek ja `alternatives`
on mitme vaste loend;
detailtabelis on iga isikufakt omaette real.
`decision` jääb tühjaks: ühtegi isikukaarti ei muudeta enne käsitsi ülevaatust.
Kohalikus töökataloogis ei ole päris `data/config/prosopography/` ega
`places.json`-i. Tegeliku korpuse kuivkäivitus tehti seetõttu tootmisserveris;
CSV-d jäid sealsesse `/tmp` kausta. Testid kasutavad väikseid näidisregistreid.

**Järgmine andmesamm:** vaadata tootmisserveri kuivkäivituse rühmad üle,
lisada kinnitatud ameti- ja asutusekirjed ning alles siis seostada
isikukaarte. Kaks proovikirjet on registris, kuid ülejäänud korpus ootab
otsuseid. Ühe päris isiku MCP → vorm → kinnitus → kaart läbikäik ootab
toimetaja brauseriseanssi.

Seis: 2026-09-26. See on töö üleandmismärge 2026-09-27 jätkamiseks, mitte uus lahendusplaan.

## Kust jätkata

- Tööharu: `feat/prosopo-mcp-enrichment`; eraldi töökataloog: `/tmp/vutt-prosopo-mcp`.
- Haru viimane commit: `d4c23527 Let editors resolve and correct enrichment proposal rows`. Haru oli selle märkme kirjutamise eel puhas. PR-i, liitmist ega juurutust ei ole tehtud.
- Põhikaust on `/home/mf/LLM/VUTT` (`main`). Teine agent tegeles #464-ga; enne ühendamist vaata üle tema töö ning võrdle haru värske `main`-iga. Ära tee rikastuse muudatusi põhikaustas kogemata.
- Üldplaan koos §10-ga on põhikaustas: `docs/superpowers/plans/2026-09-26-prosopo-ametite-hariduse-rikastus.md`. See fail ei ole praeguses tööharus. Seotud teemad: #462 asutused, #471 ametid, #461 seoste vaade, #463 elukäigu kiht, #464 paralleelne töö.

## Valmis tööharus

1. MCP `get_person_enrichment_context` loeb ühe isiku ameti- ja hariduskirjete struktureeritud konteksti ning kaardi `updated_at`-i (`0f8ee7af`).
2. Isikuvorm annab ühe isiku ja sessiooni külge seotud ühekordse 15 minuti üleandmiskoodi. MCP `submit_person_enrichment_proposal` talletab kuni 20 reaga ettepaneku ajutisse SQLite-olekusse; ootel kirje aegub seitsme päevaga. MCP ei salvesta autoriteetset isikukaarti. Otsus: `docs/decisions/0058-mcp-esitab-ainult-ootel-prosopo-ettepaneku.md` (`3b3c0758`).
3. Isikuvormi „Agendi ettepanekud” vaates saab toimetaja ridu ja tõendeid vaadata ning valitud ridu kinnitada. Server kontrollib sama sessiooni, kaardi versiooni, registriviiteid ja iga rea sisu; tõendid liiguvad koos kinnitatud kirjega (`5612b462`, `163a4bbc`).
4. MCP saab otsida asutuse- ja ametiregistri kandidaate võtme, Q-koodi, sildi ning nimevariantide alusel. Vastus eristab registri puudumist tulemusteta otsingust; kandidaatidel on vajaduse korral `place_key`. Server kontrollib kinnitamisel ka nimevariantidega põhjendatud vastet (`4a8022e3`).
5. Toimetaja saab enne kinnitamist valida teise registrikandidaadi ning parandada ajavahemikku, haridussündmuse liiki ja tõendi lehe-/tsitaadivälju. Server lubab parandada ainult konkreetse reatüübi välju ja valideerib parandused uuesti (`d4c23527`).

Peamised failid: `server/prosopography/enrichment_proposals.py`, `server/prosopography/registry_candidates.py`, `server/prosopography/router.py`, `mcp/vutt_mcp/persons.py`, `mcp/vutt_mcp/server.py`, `src/prosopography/components/personForm/AgentEnrichmentPanel.tsx`, `RegistryCandidatePicker.tsx` ja `src/prosopography/services/prosopographyService.ts`.

## Tegemata ja teadaolevad piirid

1. **#462 ja #471 registrid puuduvad päriselt.** Selle haru andmetes ei ole veel autoriteetseid asutuse- ega ametiregistreid. Kandidaadiotsing annab siis `registry_available=false` ning olematu võtmega seotud kirjet ei saa kinnitada. Testid kasutavad ajutisi näidisregistreid. Vaja on registrite skeem, algandmed, mitmetähenduslike variantide ülevaatus ja migratsiooni kuivkäivitus. Mõlemas registris on püsiv VUTT-i võti ning valikuline Q-kood; kirjete algne sõnastus säilib. Ametil võib olla asutus *või* territoorium (`place_key`), haridusel asutus; asutus viitab kaardikoha jaoks `place_key`-le.
2. **Allika värskuse ja õiguste kontroll kinnitamisvaates vajab viimistlust.** Vaates on allikaviide ja tõendi väljad, kuid tegeliku VUTT-i lehe värsket OCR-olekut ja toimetajamärkusi ei kuvata. Vaadata üle, millal ning mis õigustega näidata kaitstud teose katket. Järgida üldplaani allikate osa.
3. **Elukäigu ja kaardi projektsioon on eraldi töö.** `lifeStations` peab võtma asutuse koha `place_key` kaudu ja ametikirje territooriumi otse `place_key`-st, ilma asutuse sildi põhjal kohanime äraarvamiseta. Üldplaani §10 näited: Fischer, AGC/Academia Gustavo-Carolina, puuduva `place_key`-ga asutus ja otsese territooriumiga amet.
4. Puuduva registrikirje jaoks ei ole veel toimetaja ettepaneku või registri ülevaatuse voogu. Samuti pole tehtud päris andmetega brauseri läbikäiku, PR-i ega juurutust.

## Kontrollitud

- MCP testikomplektis oli pärast registriotsingu lisamist `313 passed, 6 deselected`; see jooks toimus enne viimast vormi parandamise commit'i.
- Asjakohased serveri, MCP ja vormi testid jooksid pärast parandusi edukalt; vormi testikomplektis `24 passed` ning hilisem sihitud paneelitest `4 passed`.
- `npm run typecheck`, `npm run lint:ci` (0 viga, 42 varasemat hoiatust) ja `npm run build` läbisid. Täielikku pärisandmetega UI-katset pole tehtud.
- Python-testidele määra `PYTHONPATH=/tmp/vutt-prosopo-mcp/mcp:/tmp/vutt-prosopo-mcp`, et ei laaditaks `.venv`-i vanemat `vutt_mcp` paketti. Kohalik `TestClient` võib liivakastis sokli tõttu takerduda; vajaduse korral käivita pytest tööruumi eskalatsiooniga.

## Soovitatud esimene käik 2026-09-27

1. `cd /tmp/vutt-prosopo-mcp && git status --short --branch && git log -6 --oneline`.
2. Vaata üle `main`-i ja #464 hetkeseis, seejärel sobita haru nendega, kui paralleelne töö on valmis.
3. Tee #462/#471 registrite tegelik skeem ja algandmed koos ülevaatuse/migratsiooni kuivkäivitusega. See avab praeguse MCP → vorm → kinnitamine töövoo pärisandmetega kontrollimise. Hoia ametite ja hariduse kinnitamise loogika ning tõendite nõuded võrdsed.
4. Proovi ühe päris isiku puhul kogu voog läbi: kontekst → registrikandidaadid → MCP ettepanek → isikuvormi parandused → kinnitamine → kaardi ja kaardikoha tulemus. Seejärel tee PR.
