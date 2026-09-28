# Agendi ameti- ja haridusettepanekute ülevaatus — lihtsustus

Kuupäev: 2026-09-28
Staatus: disain kinnitatud vestluses, ootab speki ülevaatust
Seotud: ADR 0058, 0059; #492; PR #517–#519

## Probleem

Friedrich Meniuse (`vutt:P6yllay`) kirjete sisestamine näitas, et agendi ettepanekute
ülevaatus on kohmakam kui käsitsi otsimine ja sisestamine:

- Iga `new_registry_candidate` rida jääb lukku, kuni toimetaja valib registrivõtme või
  loob registrikirje. Selleks on reas registriotsing, registrikirje vorm, kokkuvolditud
  „Paranda aeg või tõend" ja linnuke, mis aktiveerub alles pärast võtme valimist.
- Registrikirje loomine on eraldi samm eraldi vormis.
- Ameti ja hariduse tõend salvestatakse kaardile, aga ükski vaade ei näita seda.
  Vormis on ainult arv („2 tõendit"), isikulehel pole midagi.
- Kui kaart muutub, vananeb kogu ettepanek. Töövoog „kinnita, siis paranda kaardil"
  blokeerib seega pärast esimest käsitsi parandust kõik ülejäänud read.

## Eesmärk

Ülevaatus tähendab ainult otsust: **Kinnita** või **Lükka tagasi**, rea kaupa või
„Kinnita kõik". Toimetamine käib pärast kinnitamist tavalises isikuvormis. Agent
lahendab registriseose ise, ka uue registrikirje korral. Tõendid on isikulehel näha.

Õnnestumise kriteerium: Meniuse-suguse isiku 4–6 rida saab üle vaadata ja kaardile
kanda paari klikiga, ilma ühtegi välja täitmata.

## Ulatusest väljas

- **Registri hierarhia** (`broader`: `kaplan` → `vaimulik`) ja rühmitatud otsing.
  See on järgmine eraldi spekk ja ADR, koos olemasoleva 36 ametikirje rühmitamisega.
- Tõendi käsitsi toimetamine vormis (lisamine, muutmine). Eemaldamine on lubatud.
- Rikastuse töövoo avamine toimetajatele. Kuni töövoog on silutud, on see ainult superadminil.

## Disain

### 1. Ülevaatuspaneel (`AgentEnrichmentPanel`)

Mockup: `.superpowers/brainstorm/…/ulevaatuspaneel.html` (kinnitatud).

- Iga rida on kompaktne ja ainult loetav: liik, registri nimi ja Q-kood, olekumärk,
  aeg ja koht, tõend (loetav viide koos katkendiga).
- Olekumärgid:
  - **registris**: rida seob olemasoleva registrikirjega;
  - **uus registrisse**: real on näha, milline registrikirje tekib (võti, nimed, variandid);
  - **juba kaardil**: nupp on „Lisa tõend".
- Nupud real: **Kinnita** (või „Lisa tõend") ja **Lükka tagasi**. Ettepaneku päises
  on **Kinnita kõik (n)**, kus n on kinnitatavate ridade arv.
- Blokeeritud rida: Kinnita on hall ja põhjus on real ühe lausena kirjas
  (registrikonflikt, kaardil mitmeselt olemas vms).
- Paneelist kaovad: `RegistryCandidatePicker`, `RegistryEntryForm`, „Paranda aeg või
  tõend", linnukesed, „Kinnita valitud (n)" ja paranduste (`corrections`) mehhanism.
  Registrikirjete toimetamine jääb admini registrilehele `/admin/prosopo-registries`.
  Kui neid komponente mujal ei kasutata, eemaldatakse need.

### 2. Registrikirje ettepanek (andmeleping)

Ettepaneku rida võib kanda uut registrikirjet:

```json
{
  "kind": "occupation",
  "match_status": "new_registry_candidate",
  "raw_occupation": "Feldprediger",
  "occupation_entry": {
    "key": "valipreester",
    "labels": {"et": "välipreester", "en": "military chaplain"},
    "id": "Q…",
    "variants": ["Feldprediger"]
  },
  "evidence": [...]
}
```

- `occupation_entry` (ametiregister) ja `institution_entry` (asutuste register;
  lisaks `type`, valikuline `place_key`) on mõlemad valikulised. Ühel real võivad
  olla mõlemad, näiteks uus amet uues asutuses.
- Kui rida kannab `*_entry`-t, peab `match_status` olema `new_registry_candidate` ja
  vastav `*_key` kas puudub või võrdub `entry.key`-ga. Server täidab `*_key` ise.
- **Esitamisel** valideerib server kirje `registries.validate_entry`-ga (sama, mida
  kasutab registrileht). Rida lükatakse tagasi, kui:
  - võti on registris juba olemas: `registry_key_exists: <võti> — kasuta seda`;
  - Q-kood on registris teisel võtmel: `registry_id_exists: <Q> on kirjel <võti>`.
  Teade suunab agenti olemasolevat kirjet kasutama.

### 3. Agendi juhis (MCP tööriistade kirjeldused)

`submit_person_enrichment_proposal` ja `search_enrichment_registry` kirjeldused ütlevad:

1. Otsi kõigepealt registrist.
2. **Vali lähim olemasolev kirje**, st kõige täpsem, mis veel sobib: „Feldprediger" →
   `kaplan`. Kui täpsemat pole, sobib laiem kirje (`vaimulik`). Detail jääb `raw_*`
   väljale allika sõnastuses.
3. Uus registrikirje on erand, ainult kui ükski olemasolev ei sobi ka laiemalt.
   Tal peavad olema nimed et ja en ning Q-kood, kui Wikidatas vaste leidub. Liiga
   detailne amet (Wikipedia tasemel) ei ole registrikirje põhjus.

### 4. Kinnitamine ja tagasilükkamine (server)

**Õigus:** kood, loetelu, kinnitamine ja tagasilükkamine on `require_role("superadmin")`
ja paneel on nähtav ainult superadminile. Rolli langetamine hiljem = viis otspunkti
(kaks koodi, loetelu, apply, reject) ja paneeli nähtavus (nagu teose osade ettepanekutel, ADR 0058).

**Vananemine rea tasemel.** Ettepaneku tasemel `base_updated_at` kontroll kinnitamisel
kaob. Iga valitud rida hinnatakse kinnitamise hetkel elava kaardi vastu:

- uus fakt: kui kaardil on sama fakt (`_same_fact` või `_same_legacy_fact`), on rida
  `duplicate_entry`;
- „juba kaardil": sihtkirje leitakse **sisu järgi** (`_same_fact` või pärandsobitus),
  mitte `existing_index`-i järgi. Indeks on ainult vihje, sest see nihkub, kui kaardilt
  midagi kustutada. Kui vastet pole või neid on mitu, on rida blokeeritud:
  `unresolved_existing_entry`.

`update_person` saab kinnitamise hetkel loetud elava `updated_at`-i; selle teine
versioonikontroll katab lugemise ja kirjutamise vahelise akna. Esitamisel jääb
`base_updated_at` kontroll alles (`stale_person`): agent peab nägema värsket kaarti.

**Registrikirje loomine kinnitamisel:**

- kirjet pole: `registries.put(kind, key, entry, username)`, commit `save_config_with_git`-iga;
- sama võti ja sama Q-kood on vahepeal tekkinud (näiteks teise isiku ettepanekust):
  rida seotakse olemasoleva kirjega ja uut kirjet ei looda;
- sama võti ja erinev Q-kood (või üks on Q-koodita ja teine mitte): rida on blokeeritud,
  `registry_conflict: <võti>`.

Registrikirje luuakse enne kaardi salvestamist. Kui kaardi salvestus ebaõnnestub, jääb
registrikirje alles. See on ohutu, sest registrikirje on iseseisev ja järgmine
kinnitus seob sellega.

**„Kinnita kõik"** saadab kinnitatavate ridade indeksid. Kinnitus on kõik-või-mitte-midagi
ühe kaardisalvestusega. Kui üks rida kukub, ei salvestata midagi ja viga nimetab rea
(`items[i]: …`).

**Tagasilükkamine:** uus `POST /prosopography/enrichment-proposals/{person_id}/reject`
kehaga `{proposal_id, indices: [...]}` (sama kuju mis `…/apply`) eemaldab read ettepanekust. Kui ridu ei jää, suletakse
ettepanek (`applied_at`).

**Serveri arvutatud olek loetelus:** `list_pending` lisab igale reale `review_state`
(`applicable` | `already_present` | `blocked` + `reason`). Paneel ei arvuta olekut ise.

### 5. Loetav kirjanduse viide

`literature`-tõendi `source_id` on kirjanduskogu `doc_id` (Zotero võti), mis on
inimesele loetamatu. MCP lisab kontrolli käigus (`_check_literature_evidence`) igale
`literature`-tõendile välja `citation`, näiteks „Donecker 2012, *An Itinerant Sheep…*".
Selle teeb kogu `documents` rea põhjal olemasolev `format_citation`. Agendi enda
`citation` kirjutatakse üle. Server lubab tõendil võtit `citation` (≤ 500 märki).

### 6. Tõendite näitamine

**Isikuleht** (`PersonDetailPage`, plokk „Ametid ja haridus"): variant **B**, joonealused
viited (mockup `toendid-isikulehel.html`).

- Tõendiga rea lõpus on ülaindeks (üks number tõendi kohta). Ploki all on nummerdatud
  viited: VUTT-i leht on link `/work/{id}/{lk}` teose pealkirjaga; kirjanduse viide on
  `citation` + `locator`. Järel on katkend (`quote`) kursiivis ja lühendatuna.
- Vanadel tõenditel ilma `citation`-ita näidatakse `source_id` + `locator`
  (mitte tühja rida).
- Allikata rida jääb ilma numbrita.

**Isikuvorm:** „N tõendit" asemel kokkuvolditud nimekiri samade viidetega. Iga viite
juures on eemaldamise nupp. Viiteid vormis toimetada ei saa.

## Mõjutatud kohad

| Kiht | Fail |
|---|---|
| Server | `server/prosopography/enrichment_proposals.py` (leping, esitus, kinnitus, reject, review_state), `router.py` (rollid, reject-otspunkt), `registries.py` (vajadusel abi „leia Q-koodi järgi") |
| MCP | `mcp/vutt_mcp/server.py` (juhis, `citation`), `library/tools.py` (citation päring) |
| Frontend | `AgentEnrichmentPanel.tsx` (ümber kirjutatud), `prosopographyService.ts` (tüübid, reject), `PersonDetailPage.tsx` (joonealused viited), `PersonEditPage.tsx` (tõendite nimekiri, paneeli nähtavus), locale'id et+en |
| Eemaldatav | `RegistryCandidatePicker.tsx`, `RegistryEntryForm.tsx` (kui mujal kasutust pole) |
| ADR | 0058 täiendus (rea tasemel vananemine, superadmin, registrikirje ettepanekus, `citation`), 0059 täiendus (registrikirje tekib kinnitusel, admini toiming) |

## Testid

- Server: `*_entry` valideerimine esitamisel (olemasolev võti, dubleeriv Q, puuduv `type`);
  kinnitus loob registrikirje ja fakti; sama võti + sama Q → seob; erinev Q → blokeeritud;
  kaardi käsitsi muudatus vahepeal ei blokeeri teisi ridu; „juba kaardil" leitakse pärast
  kaardilt kustutamist (indeks nihkunud) sisu järgi; reject eemaldab rea ja sulgeb tühja
  ettepaneku; rollikaitse (editor → 403) kõigil viiel otspunktil.
- MCP: `citation` lisatakse kogust ja agendi oma kirjutatakse üle.
- Terviklik: `tests/test_prosopo_mcp_workflow.py` laieneb: uus registrikirje MCP-st
  kinnituseni.
- Frontend: paneel näitab kolme olekut ja blokeeritud rea põhjust; Kinnita / Lükka tagasi /
  Kinnita kõik kutsuvad õigeid otspunkte; isikulehe joonealused viited (link, citation,
  varukuju ilma citation-ita).

## Olemasolevad ootel ettepanekud

Vanad ettepanekud (ilma `review_state`-i ja `*_entry`-ta) jäävad loetavaks. Nende read,
mille võti puudub, on `blocked` põhjusega „registrivõti puudub". Need aeguvad seitsme
päevaga. Migratsiooni ei tehta.
