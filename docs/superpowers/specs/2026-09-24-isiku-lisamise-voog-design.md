# Isiku lisamise voog: isikupaneel, automaatrikastus, ülevaatusjärjekord

Kuupäev: 2026-09-24
Staatus: kokku lepitud disain (brainstorm 2026-09-24); teostus neljas PR-is (§8)
Seotud: #240 (prosopograafia kvaliteedi kogumiskoht); PR #415 (Wikidata entity API);
ADR 0007 (read-modelid), 0022 (välise ID kanooniline kuju), 0039 (eluloo väljad)

## 1. Probleem

Kasutaja kirjeldus (2026-09-24), sammud tänases voos:

1. Teose metaandmetes selgub alles valijas otsides, et isikut VUTT-is ei ole.
2. „Loo uus isik ↗" avab **teise tabi**.
3. Wikidata / GND / VIAF tulemused on ebaühtlased (aastaarvud kord on, kord ei ole);
   identiteedi kinnitamiseks peab minema allika enda lehele.
4. Väljad täidetakse käsitsi, salvestatakse.
5. Tagasi algses tabis ei värskenda valija ennast — peab tähe kustutama ja uuesti kirjutama.

Koodist ja tootmisest (mõõdetud 2026-09-24):

- Isik tekib **kolmel teel**, ükski ei rikasta ise: `/persons/new` vorm (eelvaade ainult
  nupust), `EntityPicker` (Wikidata/GND/VIAF valik → `createPerson` nimi + üks ID) ja
  server (`ensure_prosopo_stubs` metaandmete salvestamisel ja impordil).
- Juunist alates loodud 155 kaardist **19 on täiesti tühjad** (sünd, surm, amet, sugu
  puudu); **15-l neist on väline ID** — oleks saanud rikastada.
- Kõik 2117 aktiivset kaarti on `record_status = verification_level = "draft"` —
  olemasolev olekuväli ei erista midagi.
- Wikidata otsing (`wbsearchentities`) on **prefiksiotsing**: „Laurentius Ludenius"
  leiab Q1870103 (aliasena), aga näitab „Lorenz Luden"; **„Ludenius" ei leia midagi**.
  Täistekstiotsing (`list=search` + `haswbstatement:P31=Q5`) leiab mõlemad ja annab
  kirjelduse eluaastatega.
- `lobid.org` ei ole serverist kättesaadav (#240) — välisotsing peab jääma brauserisse.

## 2. Eesmärk ja piir

**Eesmärk:** isiku lisamine teose kontekstist ilma tabivahetuseta, identiteedi otsus
ühes vaates, andmed täituvad allikast ise, iga uus kaart on ühes kohas kontrollitav.
Otsus jääb inimesele: automaatika täidab ainult tühja.

**Ei ole skoobis:**
- vanade kaartide ülevaatusmärge (järjekord algab puhtalt, v.a §7.1 ühekordne skript);
- vabatekstilise creatori automaatne kaart (jääb nagu praegu; paneelis on selleks tee);
- kanoonilise nime reegel olemasolevatele kaartidele, AA-duplikaadid, GND pööratud
  variandid — #240 alla edasi;
- `places_ops.py` kohaotsingu SPARQL-sõltuvus (sama nõrkus kui PR #415 parandas).

## 3. Andmemudel

### 3.1 Ülevaatusmärge `review`

Serveripoolne väli kaardil:

```json
"review": {
  "state": "pending",
  "reasons": ["auto_enriched"],
  "context": {"work_id": "jqsc3i", "role": "respondens"},
  "created_via": "picker",
  "auto_filled": ["birth.date", "_occupations"],
  "done_by": null,
  "done_at": null
}
```

- `state`: `pending` | `done`.
- `reasons` (mitu korraga): `enrich_pending` | `auto_enriched` | `enrich_failed` |
  `no_source` | `possible_duplicate`.
- `created_via`: `picker` | `form` | `server_stub` | `backfill`.
- `context` on valikuline (puudub vormist loomisel ilma teoseta).
- **Kõik uued kaardid** saavad märke — ka admini loodud (tema stub'id tekivad samuti
  kontrollimata). Kinnitab ainult admin.

**Invariant:** `review` on serveri väli nagu `ANCHOR_FIELDS`. `update_person` teeb
`person.update(data)` ja vorm saadab terve kaardi tagasi — ilma popita saaks toimetaja
märke vormi kaudu kustutada ja vana avatud vorm kirjutaks selle üle. `update_person`
**viskab kliendi `review`-i alati ära**; muuta saab ainult §4.5 otspunktidest ja
taustarikastusest. Valvurtest kohustuslik.

Liitmisel (merge) läheb märge koos tombstone'iga ajalukku; järjekord näitab ainult
aktiivseid kaarte.

### 3.2 Tuletatud floruit

Kaardile **ei salvestata** — read-model (ADR 0007).

- Allikas: `person_to_works.json` (isiku teosed ja rollid) + `works_creators_index.json`
  (teose `year`, kaetus 1091/1105).
- **Ainult tegevusrollid.** `subject` ja `mentioned` EI lähe arvesse: isikust
  räägitakse ka palju hiljem (nt matusekõne, hilisem viide).
- Tulemus: min–max aasta → indeksikirjesse `floruit_derived_from` / `floruit_derived_to`.
- **Käsitsi `floruit` võidab.** Tuletatu kuvatakse ainult selle puudumisel, eristatava
  märkega („fl. 1640–1652 (teostest)").

**Kõrvalparandus:** teose salvestamine uuendab praegu `person_to_works`-i, aga mitte
mõjutatud isikute indeksikirjeid — `work_count` on kuni järgmise stardini vana.
`update_person_to_works` hakkab mõjutatud isikute kirjeid värskendama (vanad JA uued
isikud selle teose juures); sellega paraneb ka `work_count`.

## 4. Server

### 4.1 `POST /prosopography/candidates` (editor+)

Keha: `{name: str, refs: [{scheme, id}, …]}` — kuni 15 viidet.

Vastus viite kohta:

```json
{
  "scheme": "wikidata", "id": "Q1870103",
  "ok": true,
  "summary": {
    "label": "Lorenz Luden",
    "names": [{"text": "Lorenz Luden", "lang": "et", "kind": "label"},
              {"text": "Laurentius Ludenius", "lang": "mul", "kind": "alias"}],
    "description": "German scientist and author (1592–1654)",
    "birth": {"date": "1592", "precision": "year", "place": {"id": "Q…", "label": "Greifswald"}},
    "death": {…},
    "occupations": [{"id": "Q…", "label": "õigusteadlane"}],
    "url": "https://www.wikidata.org/wiki/Q1870103",
    "links": {"gnd": "…", "viaf": "…"}
  },
  "existing_person_id": null
}
```

Lisaks vastuses `similar_persons`: nimepõhine VUTT-i vaste (sama loogika mis
`SimilarPersonsWarning`).

- Kokkuvõtted tulevad **sama koodiga kui rikastus** (`_fetch_wikidata`, `_fetch_gnd`,
  `_fetch_viaf`) + nimede/kirjelduse/seotud ID-de lisaväljad — paneel näitab täpselt
  seda, mis kaardile hiljem kirjutatakse.
- Seotud ID-d: Wikidata `P227` (GND), `P214` (VIAF); VIAF `_linked_wikidata`/`_linked_gnd`;
  GND `sameAs`.
- `existing_person_id` tuleb `ext_id_index`-ist (normaliseeritud ID, ADR 0022).
- Paralleelselt, allikapõhine timeout, **koguaja eelarve ~8 s**; ühe viite tõrge →
  `ok: false, error: "…"` sellel viitel, teised tulevad.
- Blokeeriv I/O → sync `def` route või `run_in_threadpool` (ADR 0002).

### 4.2 `POST /prosopography/persons/create` (editor+)

Keha: `{name, identifiers: [{scheme, id}, …], aliases?: [str], context?: {work_id, role},
note?: str, created_via: "picker"|"form"}`.

1. Normaliseeri ID-d (ADR 0022).
2. **Loomise luku all** kontrolli iga ID `ext_id_index`-ist. Kui mõni on kaardil →
   **409** `{existing_person_id}`. (Kaks kasutajat samal ajal → üks kaart.) Lukk on uus
   moodulitasandi `_create_lock`, mis katab kontrolli JA kirjutuse; protsessilokaalne —
   sama hoiatus mis `_work_sets_lock`-il (mitme workeri korral vaja protsessideülest).
3. Loo kaart (`create_person`), `review = {state: pending, reasons: [...], context,
   created_via}`: ID-dega → `enrich_pending`; ID-ta → `no_source`. Server teeb ise
   nimepõhise sarnasusotsingu (sama mis `similar_persons` §4.1) — vaste korral lisandub
   `possible_duplicate`. Kliendi väidet selle kohta ei usaldata.
4. Pane taustarikastus järjekorda (§4.3), vasta **kohe** kaardiga.

Brauseri `createPerson` (`EntityPicker`, vorm) asendub selle otspunktiga.

### 4.3 Taustarikastus

- Protsessisisene piiratud executor (2 lõime).
- Töö: `person_lock` → `fetch_and_diff` iga ID skeemi kohta → rakenda **ainult
  `auto_filled`** (tühjad väljad, valik C) sama funktsiooniga, mida käsitsi „Rakenda"
  kasutab (`apply_enrichment`) → `review.auto_filled` += väljad; `enrich_pending` →
  `auto_enriched` (või `enrich_failed`).
- **Konflikte ei rakendata kunagi.**
- **Taaste:** käivitusel otsib taustalõim üles kaardid `review.reasons ∋ enrich_pending`
  ja kordab. Märge on töö püsiv jälg; mälusisest järjekorda ei usaldata.
- Git-commit nagu tavalisel rikastusel (autor = looja, sõnum „Automaatne rikastus").

### 4.4 Serveri stub'id

`ensure_prosopo_for_entity` (metaandmete salvestamine, import) kutsub sama loomisfunktsiooni
`created_via: "server_stub"` — saab märke ja taustarikastuse.

### 4.5 Admin

- `GET /prosopography/admin/review?reason=…` — `review.state == pending` kaardid,
  uuemad ees, teose konteksti pealkirjaga.
- `POST /prosopography/{id}/review/done` — `require_role("admin")`; `state = done`,
  `done_by`, `done_at`; git-commit.

## 5. Otsing ja nimevalik

### 5.1 Wikidata otsing: kaks päringut

Paneel kasutab mõlemat, ühendab ja eemaldab kordused Q-koodi järgi:

- `wbsearchentities` — täpne täisnime/prefiksi korral;
- `list=search`, `srsearch = "<päring> haswbstatement:P31=Q5"` — nimeosa (perekonnanimi)
  suvalisest kohast aliasest; ainult inimesed.

GND (lobid `variantName`) ja VIAF otsivad variantidest niikuinii. Otsing jääb
brauserisse (lobid serverist kättesaamatu).

### 5.2 Kaardi nimi (`name.label`) vaikimisi

**Allika täisnimi (label või alias), mis sisaldab kõiki otsitud sõnu.** Mitte kunagi
otsitud nimeosa ise.

| Otsing | Allika nimed | Vaikimisi |
|---|---|---|
| „Laurentius Ludenius" | *Lorenz Luden*; alias *Laurentius Ludenius* | *Laurentius Ludenius* |
| „Ludenius" | alias *Laurentius Ludenius* | *Laurentius Ludenius* |
| „Luden" | *Lorenz Luden*, *Laurentius Ludenius* | keelejärjestus (allpool) |
| „Lorenz" | ainult label sobib | *Lorenz Luden* |

- Mitu sobivat → keelejärjestus **la → mul → de → en → et** (korpus ladina/saksa;
  Wikidata ladina kuju on sageli `mul`/`la`).
- Ükski ei sobi (vaste kirjeldusest) → allika põhinimi.
- Sõnavõrdlus: suur- ja väiketähte eristamata, NFC-normaliseeritud, `ß` = `ss`
  (sama reegel mis Meili otsingus). Diakriitikud jäävad eristavaks.
- Puhas funktsioon kliendis (`/candidates` annab kõik nimed keeltega); paneelis
  rippmenüü: sobinud variandid ees, ülejäänud allikanimed järel.
- **Valimata nimed → kaardi `name.aliases`** (loomisel `aliases` kehas).

## 6. Isikupaneel (UI)

Avaneb `EntityPicker`-ist isikurežiimis:

- „Loo uus isik ↗" → **„Lisa isik…"** (paneel, sisestatud tekst kaasas);
- „Otsi Wikidatast / GND / VIAF-ist" tulemusel klikk **ei loo enam kaarti** — avab paneeli
  selle kandidaadiga lahti. Iga loomine läbib paneeli.

Paneel paremal, `z-[1300]` (päise kohal, vt CLAUDE.md z-index), Esc sulgeb, fookuslõks,
teose vorm jääb nähtavaks.

```
┌─ Lisa isik ─────────────────────────────── ✕ ┐
│ [ Ludenius                              🔍 ] │
│ Teos: Disputatio … (1645) · roll: respondens │
│ VUTT-IS JUBA OLEMAS                          │
│  ○ Laurentius Ludenius  1592–1654  12 teost  │
│                                   [Vali see] │
│ ALLIKATEST                                   │
│  ▼ Lorenz Luden              1592–1654       │
│    sobis: Laurentius Ludenius (nimevariant)  │
│    [WD ↗] [GND ↗] [VIAF ↗]                   │
│    * 1592 Greifswald (WD) / 1592 (GND)       │
│    Ametid: …                                 │
│    Nimi kaardil: [Laurentius Ludenius    ▾]  │
│                          [ Loo ja vali ]     │
│ EI LEIA ALLIKATEST                           │
│  Loo allikata: [Laurentius Ludenius]         │
│  Märkus: [ … ]                               │
│  fl. 1645 (sellest teosest)  [ Loo ja vali ] │
└──────────────────────────────────────────────┘
```

- **„VUTT-is juba olemas"** alati ees: sama ID-ga kaardid + nimepõhised sarnased.
  „Vali see" → lahtrisse, paneel sulgub.
- **Kandidaat = identiteet**: seotud ID-de järgi grupeeritud (WD + GND + VIAF üks rida).
  Grupeerimine on puhas funktsioon. Kokkuklapitud rida: nimi, eluaastad/fl., allikamärgid,
  „sobis: …". Lahti: detailid `/candidates`-ist; **allikate vastuolu kuvatakse mõlemana
  koos allikaga** — sellest tehakse identiteedi otsus.
- **„Loo ja vali"** → `POST persons/create` → valija `onChange` → paneel sulgub → teade
  „Isik loodud. Andmed täituvad allikast taustal; kaart ootab ülevaatust."
- **409** → „See isik on juba VUTT-is" + „Vali see".
- **Allikata loomine**: nimi (eeltäidetud), märkus (`notes`). Paneel näitab infona
  „fl. 1645 (sellest teosest)". Kaardile floruit'i ei kirjutata: seos teosega tekib, kui
  kasutaja teose metaandmed salvestab (`person_to_works`), ja tuletatud floruit (§3.2)
  tuleb sealt.
- **`/persons/new`** kasutab sama paneeli esimese sammuna → loomise järel kaardi
  muutmisleht. Vana `EnrichmentSearch` vormist kaob; `EnrichExistingSection` jääb
  olemasolevate kaartide käsitsi värskenduseks.
- i18n: uued võtmed et + en korraga (ADR 0011).

### 6.1 Admini ülevaatusjärjekord

`/persons` lehel eraldi vaade (ainult admin):

- rida: nimi, põhjuste sildid (`automaatselt rikastatud`, `allikata`, `võimalik duplikaat`,
  `rikastus ebaõnnestus`), teose kontekst lingina, looja, aeg;
- automaatselt täidetud väljad esile tõstetud (`review.auto_filled`);
- „Kinnita", „Ava", „Liida…" (olemasolev liitmine).

## 7. Olemasolevad andmed, vead, testid

### 7.1 Olemasolevad kaardid

- Vanad kaardid märget ei saa.
- Ühekordne skript (`scripts/`, **vaikimisi kuivkäivitus**, host-venv): 15 tühja ID-ga
  kaarti → `review` `created_via: "backfill"`, `enrich_pending` → taustarikastus;
  4 ID-ta tühja → `no_source`.

### 7.2 Vead

| Olukord | Käitumine |
|---|---|
| välisallikas ei vasta | kandidaadil „GND ei vastanud"; teised + loomine töötavad |
| `/candidates` üle eelarve | tagastatakse jõudnu, puuduv märgitud |
| rikastus ebaõnnestub | kaart olemas, `enrich_failed` järjekorras nähtav |
| samaaegne loomine | luku all kontroll → 409 + olemasolev id |
| server taaskäivitub rikastuse ajal | käivitusel `enrich_pending` kordus |

### 7.3 Testid

pytest:
- loomine: märge + kontekst + `created_via`; 409 duplikaadil (ka normaliseerimata ID);
- **`review` ei ole kliendilt kirjutatav** (`update_person` valvur);
- taustarikastus täidab ainult tühjad, konfliktid puutumata, `auto_filled` salvestub;
- käivitusel `enrich_pending` kordus;
- tuletatud floruit: ainult tegevusrollid; käsitsi võidab;
- teose salvestamine värskendab mõjutatud isikute indeksikirjeid (`work_count`);
- `/candidates`: osaline tõrge, eelarve, `existing_person_id`;
- stub-tee saab märke;
- admin-otspunktid: `require_role("admin")`.

vitest:
- kandidaatide grupeerimine seotud ID-de järgi;
- kahe Wikidata otsingu ühendamine + dedup;
- nimevalik (§5.2 tabel + keelejärjestus + NFC).

jsdom (`/** @vitest-environment jsdom */`):
- paneel: olemasolev isik ees; „Loo ja vali" kutsub `onChange`-i; 409 → valik.

## 8. Teostus: neli PR-i

Iga PR on tootmises eraldi testitav (kasutaja töövoog: merge → deploy → test tootmises).

1. **Serveri alus** — `review` märge + invariant + ADR 0048; `persons/create`;
   taustarikastus + taaste; stub-teed; `EntityPicker`/vorm kutsuvad uut otspunkti.
   *Kasu kohe:* uusi tühje kaarte ei teki, ka praeguse valija kaudu.
2. **Tuletatud floruit** + indeksikirjete värskendus teose salvestamisel.
3. **Isikupaneel** — `/candidates`, kahe otsingu ühendamine, nimevalik, paneel valijas ja
   `/persons/new`.
4. **Admini ülevaatusjärjekord** + §7.1 skript.

## 9. ADR

**0048 — Ülevaatusmärge on serveri väli** (PR 1 koosseisus): `review` kirjutavad ainult
loomine, taustarikastus ja admini kinnitus; `update_person` viskab kliendi väärtuse
ära. Automaatrikastus täidab ainult tühja, konflikte ei rakenda kunagi. Tuletatud
floruit on read-model ega kasuta `subject`/`mentioned` rolle.
