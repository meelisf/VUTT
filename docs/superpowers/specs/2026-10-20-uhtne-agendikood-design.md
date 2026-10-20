# Ühtne agendikood + ettepanekute nimekiri `/review`-l — disain

Kuupäev: 2026-10-20
Seotud: ADR 0058 (kõik täiendused), #492, #641

## Miks

Agendi tööpäev puudutab sageli mitut kihti korraga: kõigepealt teose tekst ja osad,
siis sama teose isikute kaardid. Praegu tähendab see kahte koodi kahes eri kohas
(teose haldus „Osad" → „Kood agendile"; isikuvormi agendipaneel) ja pärast tööd ei
ole ühtki kohta, kust näha, **mis kõik on ülevaatust ootel**. Lehe teksti pakid on
`/review`-l näha, osade ettepanekud ainult teose „Osad" vahekaardil, isiku
ettepanekud ainult isikulehel — isikute kohta pole serveris isegi loetelu-otspunkti
(`GET /enrichment-proposals/{person_id}` on isiku kaupa). Kasutaja: „isikute koha
pealt ei ole selge, kus ma ülevaate saan muudatustest".

## Eesmärgid

1. **Üks kood** kehtib kõigile kolmele ettepanekuliigile (lehe tekst, teose osad,
   isikukaardi rikastus), ulatus alati „kõik teosed + kõik isikud".
2. **`/review`-l üks jaotis „Agendi ettepanekud"**: kõik ootel ettepanekud ühes
   nimekirjas; rida viib sinna, kus otsustatakse.

## Mitte-eesmärgid

- `/review`-l **ei kinnitata ega lükata tagasi**. Otsustamine jääb olemasolevatesse
  vaadetesse (redaktor, „Osad", isikuvorm), sest need näitavad konteksti ja teevad
  versioonikontrolli.
- Kitsa ulatusega koode (üks teos / üks isik) ei säilitata (kasutaja kinnitas, et
  „kõik" ulatus piisab).
- Rolli ei langetata: kõik jääb `superadmin`-iks (ADR 0058, 2026-09-29).
- Ettepanekute hoidlaid ei liideta üheks andmebaasiks.

## Anti-eesmärgid

- Nimekiri, milles ettepanek on olemas, aga klikk viib kohta, kus seda ei näe
  (vale kasutaja filter, vale leht) — see on täpselt praegune segadus.
- Kood, mis ühes hoidlas on kehtiv ja teises mitte (osaline registreerimine).

## Kuidas (otsustatud)

### Kood

Pretsedent on olemas: `POST /works/{id}/parts/handoff` loob ühe koodi ja registreerib
selle **samana** kahes hoidlas (`work_part_proposals.issue_handoff` + 
`page_text_proposals.issue_handoff(code=…)`). Uus kood laiendab sama mustrit
kolmandale hoidlale (`prosopography/enrichment_proposals.issue_handoff`, scope `any`).

- Uus otspunkt **`POST /agent-handoff`** (`require_role("superadmin")`, rate-limit nagu
  praegustel): genereerib koodi, registreerib selle kolmes hoidlas ulatusega „kõik"
  ja tagastab `{code, expires_at, max_uses: {text, parts, persons}}`.
- Iga hoidla hoiab oma kasutuskordade lage nagu praegu (tekst 20, osad 20, isikud
  `ANY_MAX_USES` = 200). TTL 8 h kõigis.
- Kolm SQLite-faili ei anna ühist tehingut. Kui registreerimine mõnes hoidlas
  ebaõnnestub, kustutatakse sama räsi juba registreeritud hoidlatest ja otspunkt
  annab vea — osaliselt kehtivat koodi kasutajale ei näidata. *(Claude'i otsus.)*
- `enrichment_proposals.issue_handoff` peab vastu võtma ette antud `code`-i (nagu
  kaks teist juba võtavad).
- **MCP tööriistu ei muudeta** — iga submit kontrollib koodi räsi oma hoidlas, sama
  kood läbib kõik kolm. MCP tööriistade kirjeldustes viide „kood teose halduses" /
  „kood isikuvormis" → „kood `/review` lehelt".
- Vanad koodinupud kaovad UI-st (`PartsTab` „Kood agendile", `AgentEnrichmentPanel`
  koodi loomine). Vanad otspunktid (`/works/{id}/parts/handoff`,
  `/prosopography/enrichment-handoff[/{id}]`) eemaldatakse; juba antud koodid
  kehtivad oma 8 h lõpuni, sest hoidlate skeem ei muutu.

### Nimekiri

- Uus otspunkt **`GET /agent-proposals`** (`require_role("superadmin")`) tagastab
  ühtse loendi:
  `{kind: "text"|"parts"|"person", target_id, target_label, pending, stale, created_at, proposal_id}`.
  `target_label` = teose pealkiri (metaandmetest) või isiku kanooniline nimi.
- Iga hoidla saab funktsiooni, mis loetleb ootel ettepanekud **ilma sihtmärgita**:
  tekstil on see olemas (`page_text_proposals.list_pending()`); osadele ja isikutele
  tuleb lisada (praegune `list_pending` võtab `work_id` / `person_id`). Loend ei
  arvuta rea `review_state`-i täies mahus kaardi vastu, kui see on kallis — piisab
  ridade arvust; täpne olek on sihtvaates.
- **Nähtavus järgib hoidla praegust reeglit**, et klikk ei viiks tühja vaatesse:
  tekst — kõik superadminid näevad kõiki; osad ja isikud — ainult koodi loonud
  kasutaja omad (`username`), sest sihtvaated filtreerivad samamoodi.
- `/review`: `AgentProposalsSection` asendub ühe jaotisega (sama koht lehel, sama
  „ootel ettepanekuteta jaotist ei näidata" reegel, aga **koodinupp on alati näha**).
  Rida: liigi märk, `target_label`, ootel/vananenud arv, kuupäev. Klikk:
  - tekst → `/work/{work_id}/{esimene ootel lehekülg}` (nagu praegu);
  - osad → teose halduse „Osad" vahekaart;
  - isik → isiku muutmisvaade, agendipaneel lahti.
- Koodi näitamine/kopeerimine kolib praegusest `PartsTab`-ist / `AgentEnrichmentPanel`-ist
  sellesse jaotisse (sama kopeerimisnupp, aegumisaeg).

### Dokumentatsioon

- ADR 0058 uus täiendus „2026-10-20: üks agendikood, ülevaade `/review`-l".
- CLAUDE.md MCP-ettepanekute lõik: „Agendikood on ÜKS (`/review`)".
- `mcp/README.md` koodi asukoht.

## Ehitaja otsustada

- Täpne komponendi- ja failijaotus, ikoonid, i18n võtmed (mõlemasse keelde, ADR 0011).
- Kas `GET /agent-proposals` koondab ühes threadpool-kutses või kolmes.
- Sihtvaate URL-id osade vahekaardile ja isiku agendipaneelile (kasuta olemasolevaid
  marsruute; kui paneeli avamiseks pole URL-parameetrit, lisa see).

## Eraldi (mitte selle töö osa)

Isiku ettepanekus lubab `submit()` ametireale korraga `institution_key` JA `place_key`;
reegel (ADR 0059) kontrollitakse alles kinnitamisel (`_check_links`), nii et rida
jõuab ülevaatusse kinnitamatuna (`institution_and_place_are_exclusive`). Parandus:
sama kontroll `submit()`-is agendile suunava sõnumiga. Väike eraldi PR.
