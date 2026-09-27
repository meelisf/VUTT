# Prosopo ametite ja hariduse rikastus: seis ja jätk

## Seis (2026-09-27)

Kogu töövoog on `main`-is ja tootmises juurutatud, mitte tööharus:
`2cacf1c0` (#478, MCP → vorm → kinnitus), `3201a4cd` (#479, registriadmini
kaitse), `9ab345f5` (#481, olemasoleva rea sidumise parandus), `e8cf4e49`
(#462 #471 registrite alus, ADR 0059), `ba7bca04`/`8748cd81` (#482 #483, osade
indeksid ja seosed), `b75cb117` (#484, elukäigu kaardid), `d8803ba3` (#485,
testiparandus), kuni `dbb68d57` (#486, selle läbikäigu dokumenteerimine).

- **MCP-rikastus töötab tootmises** (ADR 0058): `get_person_enrichment_context`,
  `submit_person_enrichment_proposal`, isikuvormi „Agendi ettepanekud" paneel
  kinnitamiseks. Peamised failid: `server/prosopography/enrichment_proposals.py`,
  `server/prosopography/registry_candidates.py`, `mcp/vutt_mcp/persons.py`,
  `src/prosopography/components/personForm/AgentEnrichmentPanel.tsx`.
- **#462/#471 registrite alus on olemas**, mitte enam puudu: `server/prosopography/registries.py`,
  admin UI `src/pages/admin/ProsopoRegistries.tsx`, kuivkäivitatav
  `scripts/prosopo_registry_dry_run.py`, otsus ADR 0059 (amet/asutus =
  VUTT-i registrivõti, `occupation_key`/`institution_key`, valikuline Q-kood).
  Kaks kinnitatud kirjet on tootmise registris: `academia-gustavo-carolina`
  (Q138710754, `place_key=Dorpat`, commit `235414e1`) ja `professor`
  (Q121594, commit `25246d3a`).
- **Elukäigu kohalahendus on registripõhine.** `src/prosopography/utils/relationsMap.ts`
  (`resolveFactPlace`) võtab koha `place_key`-st otse või `institution_key` kaudu
  registrist; ainult vanadel, veel migreerimata kaartidel jääb kehtima
  Q-koodi ühilduvusvõrdlus. Asutuse sildist kohta ei arvata.
- **#462 ja #471 on jätkuvalt OPEN.** 2026-09-27 kommentaarid lepivad kokku
  ühise andmelepingu (allika toores sõnastus vs kinnitatud registrivaste peavad
  jääma eristatavaks; ametil ja haridusel ühine kirjetaseme tõendi kuju), aga
  see leping on veel rakendamata — registrid on alles algfaasis, korpuse
  migratsiooni ei ole tehtud.
- **Ühe päris isiku täielik tootmisläbikäik on tehtud.** Isacus Börk
  (`vutt:Pru2k0dt`): MCP ettepanek sidus olemasoleva haridusrea võtmega
  `academia-gustavo-carolina`, toimetaja kinnitas, andmerepo commit `53210b799`.
- **Kuivkäivitus tootmise `data/` peal (2026-09-27):** 4347 fakti, 393 rühma.
  CSV-d on serveris `~/prosopo-review/` (sh `facts_years.csv` aastatega), mitte
  `/tmp`-is. Eelsortimine (soovitused, mitte otsused) käib.
- **Leid:** „Academia Gustaviana" nimekujuga 1720 faktist ~568 on dateeritud
  ≥1690 → tõenäoliselt tegelikult Academia Gustavo-Carolina. Reegel ootab
  toimetaja otsust, ei ole automaatselt rakendatud.

Kuivkäivituse käsk (kirjutab ainult CSV väljundi, ei muuda ühtki kaarti):

```bash
python3 scripts/prosopo_registry_dry_run.py --data-dir /path/to/data \
  --output /path/to/review.csv \
  --details /path/to/facts.csv
```

`candidate` = olemasoleva registri soovitus, `suggested_new_key` = ülevaatust
vajav uue võtme ettepanek, `alternatives` = mitme vaste loend. `decision`
jääb tühjaks, kuni inimene otsustab.

## Lahtine

1. **393 rühma ülevaatus tegemata.** Serveri `~/prosopo-review/` CSV-d
   ootavad toimetaja läbivaatust rühmade kaupa; enne seda ei tohi ühtki
   isikukaarti migreerida.
2. **Academia Gustaviana / Academia Gustavo-Carolina piir.** ~568 1690+
   dateeritud „Academia Gustaviana" faktist vajab reeglit või käsitsi otsust
   enne migratsiooni; kahe asutuse registrivõtmed peavad jääma lahku.
3. **Börki 1691 „Academia Gustaviana" kirje** vajab eraldi allikakontrolli
   (võimalik ajalooline väärseos) — ei ole lahendatud.
4. **Migratsiooniskript (kuivkäivitus enne kirjutust) on kirjutamata.** Tuleb
   teha alles pärast rühmade otsuseid.
5. **UX: kinnitamata MCP ettepanek kaob vormist uue sisselogimise järel.**
   Ettepanek jääb ajutisse SQLite olekusse ja aegub 7 päevaga, aga uus
   üleandmiskood tuleb genereerida käsitsi. Parandamata.
6. **Kinnitamisvaates puudub allika värske OCR-oleku ja toimetajamärkuste
   kuvamine.** Vaadata üle, millal ja mis õigustega näidata kaitstud teose
   katket.
7. **#462/#471 ühine andmeleping on kokku lepitud, aga rakendamata:** allika
   toores sõnastus (nt `Pfarrer`, `AGC`) ja kinnitatud registrivaste peavad
   jääma eraldi väljadeks; ametil ja haridusel peab olema sama kirjetaseme
   tõendi kuju (allikas, lehekülg/kirjenumber, tekstikatke).

8. **Isikuvormi asutuse ja ameti väli on kaheks jagatud.** Ülemine `EntityPicker`
   (Wikidata + vaba tekst) ja alumine `RegistryCandidatePicker` (nupuga
   registriotsing). Ülemises valimine nullib `institution_key`-i, Q-koodi kirjutavad
   mõlemad. Plaan: üks liitväli — trükkides esmalt registri vasted (nimevariantide
   järgi), siis Wikidata/vaba tekst; registrikirje valik salvestab võtme ja Q-koodi,
   trükitud tekst jääb allika kujuks (ADR 0059). Kolm kohta: ameti nimetus, ameti
   asutus, hariduse asutus (`PersonEditPage.tsx`).

## Järgmine samm

Vaadata serveri `~/prosopo-review/` CSV-d üle, otsustada Academia Gustaviana /
Gustavo-Carolina piiri reegel ja teha rühmade kaupa kinnitus/tagasilükkamine.
Alles siis kirjutada migratsiooniskript (kuivkäivitus enne kirjutust) ja
rakendada kinnitatud otsused isikukaartidele.
