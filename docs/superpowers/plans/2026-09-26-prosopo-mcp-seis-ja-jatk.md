# Prosopo ametite ja hariduse rikastus: seis ja jätk

Seis: 2026-09-26. See on töö üleandmismärge 2026-09-27 jätkamiseks, mitte uus lahendusplaan.

## Kust jätkata

- Tööharu: `feat/prosopo-mcp-enrichment`; eraldi töökataloog: `/tmp/vutt-prosopo-mcp`.
- Haru viimane commit: `d4c23527 Let editors resolve and correct enrichment proposal rows`. Haru oli selle märkme kirjutamise eel puhas. PR-i, liitmist ega juurutust ei ole tehtud.
- Põhikaust on `/home/mf/LLM/VUTT` (`main`). Teine agent tegeles #464-ga; enne ühendamist vaata üle tema töö ning võrdle haru värske `main`-iga. Ära tee rikastuse muudatusi põhikaustas kogemata.
- Üldplaan koos §10-ga on põhikaustas: `docs/superpowers/plans/2026-09-26-prosopo-ametite-hariduse-rikastus.md`. See fail ei ole praeguses tööharus. Seotud teemad: #462 asutused, #471 ametid, #461 seoste vaade, #463 elukäigu kiht, #464 paralleelne töö.

## Valmis tööharus

1. MCP `get_person_enrichment_context` loeb ühe isiku ameti- ja hariduskirjete struktureeritud konteksti ning kaardi `updated_at`-i (`0f8ee7af`).
2. Isikuvorm annab ühe isiku ja sessiooni külge seotud ühekordse 15 minuti üleandmiskoodi. MCP `submit_person_enrichment_proposal` talletab kuni 20 reaga ettepaneku ajutisse SQLite-olekusse; ootel kirje aegub seitsme päevaga. MCP ei salvesta autoriteetset isikukaarti. Otsus: `docs/decisions/0057-mcp-esitab-ainult-ootel-prosopo-ettepaneku.md` (`3b3c0758`).
3. Isikuvormi „Agendi ettepanekud” vaates saab toimetaja ridu ja tõendeid vaadata ning valitud ridu kinnitada. Server kontrollib sama sessiooni, kaardi versiooni, registriviiteid ja iga rea sisu; tõendid liiguvad koos kinnitatud kirjega (`5612b462`, `163a4bbc`).
4. MCP saab otsida asutuse- ja ametiregistri kandidaate võtme, Q-koodi, sildi ning nimevariantide alusel. Vastus eristab registri puudumist tulemusteta otsingust; kandidaatidel on vajaduse korral `place_key`. Server kontrollib kinnitamisel ka nimevariantidega põhjendatud vastet (`4a8022e3`).
5. Toimetaja saab enne kinnitamist valida teise registrikandidaadi ning parandada ajavahemikku, haridussündmuse liiki ja tõendi lehe-/tsitaadivälju. Server lubab parandada ainult konkreetse reatüübi välju ja valideerib parandused uuesti (`d4c23527`).

Peamised failid: `server/prosopography/enrichment_proposals.py`, `server/prosopography/registry_candidates.py`, `server/prosopography/router.py`, `mcp/vutt_mcp/persons.py`, `mcp/vutt_mcp/server.py`, `src/prosopography/components/personForm/AgentEnrichmentPanel.tsx`, `RegistryCandidatePicker.tsx` ja `src/prosopography/services/prosopographyService.ts`.

## Tegemata ja teadaolevad piirid

1. **#462 ja #471 registrid puuduvad päriselt.** Selle haru andmetes ei ole veel autoriteetseid asutuse- ega ametiregistreid. Kandidaadiotsing annab siis `registry_available=false` ning olematu võtmega seotud kirjet ei saa kinnitada. Testid kasutavad ajutisi näidisregistreid. Vaja on registrite skeem, algandmed, mitmetähenduslike variantide ülevaatus ja migratsiooni kuivkäivitus. Mõlemas registris on püsiv VUTT-i võti ning valikuline Q-kood; kirjete algne sõnastus säilib. Ametil võib olla asutus *või* territoorium (`place_key`), haridusel asutus; asutus viitab kaardikoha jaoks `place_key`-le.
2. **Allika värskuse ja õiguste kontroll kinnitamisvaates vajab viimistlust.** Vaates on allikaviide ja tõendi väljad, kuid tegeliku VUTT-i lehe värsket OCR-olekut ja toimetajamärkusi ei kuvata. Vaadata üle, millal ning mis õigustega näidata kaitstud teose katket. Järgida üldplaani allikate osa.
3. **Elukäigu ja kaardi projektsioon on eraldi töö.** `lifeStations` peab võtma asutuse koha `place_key` kaudu ja ametikirje territooriumi otse `place_key`-st, ilma asutuse sildi põhjal kohanime äraarvamiseta. Üldplaani §10 näited: Fischer, AGC/Academia Gustaviana, puuduva `place_key`-ga asutus ja otsese territooriumiga amet.
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
