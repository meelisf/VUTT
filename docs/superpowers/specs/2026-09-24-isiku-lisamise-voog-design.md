# Isiku lisamise voog: isikupaneel, automaatrikastus, ülevaatusjärjekord

Kuupäev: 2026-09-24
Staatus: kokku lepitud disain (brainstorm 2026-09-24; rev 3 pärast kahte ülevaatust — §10);
teostus neljas PR-is (§8)
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
  "auto_filled": ["birth.date", "occupations"],
  "source_conflicts": [
    {"field": "birth.date", "values": [{"scheme": "wikidata", "value": "1592"},
                                       {"scheme": "gnd", "value": "1593"}]}
  ],
  "failed_sources": ["gnd"],
  "done_by": null,
  "done_at": null
}
```

- `state`: `pending` | `done`.
- `reasons` (mitu korraga): `enrich_pending` | `auto_enriched` | `nothing_to_fill` |
  `enrich_failed` | `no_source` | `possible_duplicate` (lõppolekud §4.3).
- `created_via`: `picker` | `form` | `server_stub` | `backfill`.
- `auto_filled` loetleb **tegelikke kaardivälju** (`occupations`, `identifiers`), mitte
  rikastaja tehnilisi võtmeid (`_occupations`, `_linked_gnd`) — vt §4.3 teisendus.
- `source_conflicts`: väljad, mida allikad pakkusid omavahel vastuolus — jäid täitmata.
- `failed_sources`: allikad, mille päring ebaõnnestus (osaline õnnestumine, §4.3).
- `context` on valikuline (puudub vormist loomisel ilma teoseta).
- **Kõik uued kaardid** saavad märke — ka admini loodud (tema stub'id tekivad samuti
  kontrollimata). Kinnitab ainult admin.

**Invariant:** `review` on serveri väli nagu `ANCHOR_FIELDS` — **kõigis kliendi
kirjutusteedes**, mitte ainult ühes:

- `update_person` teeb `person.update(data)` ja vorm saadab terve kaardi tagasi — ilma
  popita saaks toimetaja märke kustutada ja vana avatud vorm kirjutaks selle üle;
- `apply_enrichment` (`POST /{id}/enrich`) kirjutab kliendi antud **väljaradu** otse
  (`_deep_set`) — sealt läheks läbi nii `review` kui `review.state`.

Mõlemad visavad ära võtme `review` JA iga välja­raja, mis algab `review.`-ga. Kaitse on
ühes abifunktsioonis (`strip_server_fields`), mida kõik kliendi kirjutusteed kutsuvad —
ka tulevased. `review`-i muudavad ainult loomine (§4.2), taustarikastus (§4.3) ja admini
kinnitus (§4.5), kõik serveri sisefunktsioonide kaudu. Valvurtestid: `update_person`
ning `/enrich` nii `review` kui `review.state` kujul.

**Kinnitust uuesti ei avata.** Hilisem käsitsi muudatus (ka toimetaja oma) ei vii kaarti
tagasi järjekorda; muudatused on git-ajaloos.

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
note?: str, created_via: "picker"|"form", card?: {…}}`.

**Kaardi sisul on täpselt üks allikas** — kas `card` VÕI tipuväljad, mitte mõlemad:

- **Vorm** saadab `card`-i (sama kuju mis `draftToPayload`, sisaldab ka `identifiers`,
  `name.label`, `name.aliases`, `notes`). Tipuväljad `name`, `identifiers`, `aliases`,
  `note` on siis **keelatud → 400**.
- **Paneel** saadab tipuväljad, `card`-i ei ole.

Prioriteedireeglit (kumb võidab) ei ole, sest kahte allikat ei lubata. Server
**moodustab esmalt lõpliku salvestatava kaardi**, siis `strip_server_fields`, siis
normaliseerib selle kaardi `identifiers`-i — ja duplikaadikontroll (samm 2) käib
**just nende salvestatavate ID-de** peal. Muud teed ei ole: kontroll ja salvestus ei
saa lahkneda.

`card` on vormi **kogu algne sisu**: loomine on ÜKS samm. Praegu teeb `PersonEditPage` `createPerson` + `updatePerson`; kui taustarikastus
satub nende vahele, saab teine samm versioonikonflikti ja kasutaja voog katkeb.
Kogu vormisisu salvestub enne, kui taustatöö üldse järjekorda läheb; rikastus täidab
seejärel ainult seda, mis vormis tühjaks jäi. `card`-ist visatakse serveriväljad ära
(`strip_server_fields`, §3.1).

1. Normaliseeri ID-d (ADR 0022).
2. **ID-lukk** (§4.6) all kontrolli iga lõpliku kaardi ID-d `ext_id_index`-ist:
   - kõik leitud ID-d on ÜHEL kaardil → **409** `{conflict: "exists", existing_person_id}`;
   - ID-d on **eri kaartidel** → **409** `{conflict: "split", existing_person_ids: [...]}` —
     allikad väidavad, et kaks VUTT-i kaarti on üks isik. Paneel ei loo midagi, näitab
     mõlemat kaarti ja soovitab liitmist (admin). Kaks kasutajat samal ajal → üks kaart.
   Lukk katab kontrolli, kirjutuse JA `ext_id_index`-i uuenduse (§4.6).
3. Loo kaart (`create_person`), `review = {state: pending, reasons: [...], context,
   created_via}`: ID-dega → `enrich_pending`; ID-ta → `no_source`. Server teeb ise
   nimepõhise sarnasusotsingu (sama mis `similar_persons` §4.1) — vaste korral lisandub
   `possible_duplicate`. Kliendi väidet selle kohta ei usaldata.
4. Salvesta kaart (koos `card` sisuga) ühe git-commitiga, **siis** pane taustarikastus
   järjekorda (§4.3), vasta kohe kaardiga.

Brauseri `createPerson` (`EntityPicker`, vorm) asendub selle otspunktiga.

### 4.3 Taustarikastus

Protsessisisene piiratud executor (2 lõime). Üks töö = üks kaart, kõik tema ID-d.

**Järjekord (lukk ainult kirjutuse ümber):**

1. **Väljaspool lukku:** küsi iga ID skeemi kohta allika andmed (`_fetch_*`). Aeglane
   välisallikas ei hoia kaardi muutmist kinni.
2. **Koonda kõigi allikate ettepanekud väljade kaupa** enne ühtegi kirjutust (vt reeglid).
3. **Lukkude all** (ID-lukk, siis `person_lock` — §4.6): loe kaart uuesti (vahepeal
   võis keegi muuta) ja **kontrolli, et ettepanekud kehtivad veel**:
   - kaart puudub või on tombstone (`merged_into`, `record_status = tombstone`) →
     **ei kirjutata midagi**, töö lõpeb;
   - iga ettepanek kannab oma allikat `(scheme, id)`; rakendatakse ainult nende allikate
     ettepanekud, mille **normaliseeritud ID on kaardil endiselt olemas**. Kui kasutaja
     päringu ajal eksliku Wikidata ID eemaldas või muutis, selle andmed kaardile ei jõua;
   - arvuta rakendatav hulk värske kaardi pealt, rakenda, uuenda `review`, salvesta
     **ühe** kirjutuse + commitiga, uuenda `ext_id_index`.

`person_lock` on tavaline `threading.Lock` ja `apply_enrichment` võtab selle ise —
taustatöö EI kutsu `apply_enrichment`-i luku seest (ummikseis). Mõlemad kasutavad ühist
**lukuta sisefunktsiooni** (`_apply_fields(person, fields)`), mis eeldab, et kutsuja
lukku hoiab; `apply_enrichment` = lukk + `strip_server_fields` + `_apply_fields` + salvestus.

**Teisendus kaardiväljadeks (serveris, ühes kohas).** Rikastaja tagastab tehnilisi
võtmeid; `apply_enrichment` kirjutaks need praegu samanimeliste väljadena kaardile.
Uus `enrichment_to_card_fields(proposals)`:

- `_occupations` / `_occupation_label` → `occupations` kirjed (sama kuju, mida kliendi
  `applyEnrichmentToDraft` praegu teeb, `helpers.ts`);
- `_linked_wikidata` / `_linked_gnd` → `identifiers` lisandused, **normaliseeritud** (ADR 0022)
  ja duplikaadikontrolliga: kui seotud ID on juba **teisel** kaardil, seda ei lisata,
  `review.reasons += possible_duplicate` ja kaart märgitakse konteksti;
- ülejäänud võtmed (`birth.date` jne) on juba kaardiradu.

Kliendi `applyEnrichmentToDraft` jääb käsitsi rikastuse vaatesse; ühe teisenduse
viimine serverisse ka seal on hilisem koristus (märgitud #240 alla), mitte selle töö osa.

**Reeglid:**

- **Täidab ainult tühja.** Välja, millel on kaardil väärtus, ei muudeta.
- **Erandid — ainult lisamise suunas, olemasolevat ei eemaldata kunagi:**
  - hulgaväljad (`name.aliases`, `_HULGA_VÄLJAD`) — ühendatakse (NFC-võrdlusega dedup);
  - `identifiers` — seotud ID-d (`_linked_*`) lisatakse, kui seda skeemi kaardil veel
    ei ole ja ID ei ole teisel kaardil (§4.6).
- **Allikatevaheline vastuolu:** kui tühja välja jaoks pakuvad kaks allikat erinevat
  väärtust, jääb väli **täitmata** ja mõlemad väärtused koos allikatega lähevad
  `review.source_conflicts`-i. Nii ei otsusta järjekord (kumb allikas enne vastas).
- **Kokkusobivad kuupäevad ei ole vastuolu:** kui vähem täpne on täpsema eesliide
  (`1592` vs `1592-02-10`), täidetakse täpsemaga koos tema `precision`-iga ja mõlemad
  väärtused jäävad `source_conflicts`-i alla märkega `compatible: true` (admin näeb).
- **Konflikti kaardiga (kaardil on väärtus, allikas pakub muud) ei rakendata kunagi**;
  need on käsitsi rikastuse vaates nagu praegu.
**Lõppolek.** Iga lõppenud katse **eemaldab `enrich_pending`-i** ja säilitab muud
põhjused (`no_source`, `possible_duplicate`). Muidu jääks kaart kinnitamatuks (§4.5) ja
läheks igal käivitusel uuesti rikastusse. Tulemus lisab täpselt ühe kombinatsiooni:

| Olukord | Lisatavad põhjused |
|---|---|
| vähemalt üks allikas vastas, rakendati ≥ 1 väli | `auto_enriched` |
| … ja mõni allikas ei vastanud | `auto_enriched` + `enrich_failed` (`failed_sources`) |
| allikad vastasid, rakendatavaid välju ei olnud | `nothing_to_fill` |
| … ja mõni allikas ei vastanud | `nothing_to_fill` + `enrich_failed` |
| ükski allikas ei vastanud | `enrich_failed` |
| ükski ID ei ole kaardil enam alles | — (ainult `enrich_pending` eemaldub) |
| kaart puudub / tombstone | midagi ei kirjutata |

`source_conflicts` lisandub igal juhul, kui vastuolusid oli. Automaatset kordust
ebaõnnestunud allikale ei ole — admin saab käsitsi rikastuse vaatest uuesti proovida.

**Taaste:** kuna iga lõppenud katse eemaldab `enrich_pending`-i, tähendab see märge
ainult „katse ei jõudnud lõpule". Käivitusel otsib taustalõim üles kaardid `review.reasons ∋ enrich_pending`
ja kordab. Märge on töö püsiv jälg; mälusisest järjekorda ei usaldata.

Git-commit nagu tavalisel rikastusel (autor = looja, sõnum „Automaatne rikastus").

### 4.4 Serveri stub'id

`ensure_prosopo_for_entity` (metaandmete salvestamine, import) kutsub sama loomisfunktsiooni
`created_via: "server_stub"` — saab märke ja taustarikastuse.

### 4.5 Admin

- `GET /prosopography/admin/review?reason=…` — `review.state == pending` kaardid,
  uuemad ees, teose konteksti pealkirjaga.
- `POST /prosopography/{id}/review/done` — `require_role("admin")`; keha
  `{updated_at}` — **admin kinnitab kindla kaardiversiooni**:
  - `updated_at` ei vasta → **409** (kaarti on vahepeal muudetud, nt taustarikastus lisas
    andmeid, mida admin ei näinud); UI laeb kaardi uuesti;
  - `review.reasons ∋ enrich_pending` → **409** `enrich_pending` (rikastus pooleli —
    kinnitus pärast seda);
  - muidu `state = done`, `done_by`, `done_at`; git-commit. Kinnitust uuesti ei avata (§3.1).

### 4.6 ID-lukk ja lukkude järjekord

Ühe isiku lukk ei kaitse **teist** kaarti: kaks taustatööd võivad korraga leida sama
GND ID vabana ja lisada selle eri kaartidele — sama võidujooks nagu kahe loomise vahel.

- Uus moodulitasandi **`_ext_id_claim_lock`**. Iga tee, mis **lisab kaardile välise ID**,
  võtab selle ja hoiab üle **kontrolli, salvestuse ja `ext_id_index`-i uuenduse**:
  `persons/create`, taustarikastuse `_linked_*` lisandus, `add_identifier`
  (`POST /{id}/identifiers`) ja `update_person`, kui `identifiers` muutub.
- **Järjekord on alati: `_ext_id_claim_lock` → `person_lock`**, mitte kunagi vastupidi.
  Teed, mis ID-sid ei lisa, võtavad ainult `person_lock`-i (ja ei tohi seejärel
  `_ext_id_claim_lock`-i küsida).
- `ext_id_index` uuendatakse praegu `_update_index_entry`-s pärast salvestust ja väljaspool
  isiku lukku (`apply_enrichment`). ID-lisavates teedes peab see jääma
  `_ext_id_claim_lock`-i sisse — muidu näeb järgmine kontroll vana indeksit.
- Välisallika päringut ei tehta kunagi ühegi luku all.
- Protsessilokaalne — sama hoiatus mis `_work_sets_lock`-il ja `RENDER_SEMAPHORE`-il
  (mitme workeri korral vaja protsessideülest lukku).

## 5. Otsing ja nimevalik

### 5.1 Wikidata otsing: kaks päringut

Paneel kasutab mõlemat, ühendab ja eemaldab kordused Q-koodi järgi:

- `wbsearchentities` — täpne täisnime/prefiksi korral;
- `list=search`, `srsearch = "<päring> haswbstatement:P31=Q5"` — nimeosa (perekonnanimi)
  suvalisest kohast aliasest; ainult inimesed.

GND (lobid `variantName`) ja VIAF otsivad variantidest niikuinii. Otsing jääb
brauserisse (lobid serverist kättesaamatu).

### 5.2 Kaardi nimi (`name.label`) vaikimisi

**Allika täisnimi (label või alias), mis sobib kõigi otsitud sõnadega.** Mitte kunagi
otsitud nimeosa ise.

**Sobivus = sõna-eesliide:** iga otsitud sõna peab olema täisnime MÕNE sõna algus.
„Luden" sobib nii „Luden"-i kui „Ludenius"-ega; „denius" ei sobi millegagi (mitte
alamsõne). Sõnad eraldatakse tühikute ja kirjavahemärkide järgi. Sama loogika mis
Meili prefiksotsingul, nii et kasutaja kogemus on mõlemas ühesugune.

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
- **409 `exists`** → „See isik on juba VUTT-is" + „Vali see".
- **409 `split`** → „Allikad viitavad kahele eri VUTT-i kaardile" + mõlemad kaardid
  „Ava" lingina; midagi ei looda ega valita. Toimetajale tekst „teata adminile",
  adminile „Liida…".
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
| üks allikas vastas, teine mitte | vastanu rakendatud; `auto_enriched` + `enrich_failed`, `failed_sources` |
| allikad vastuolus tühja välja osas | väli täitmata, `source_conflicts` järjekorras nähtav |
| samaaegne loomine | luku all kontroll → 409 + olemasolev id |
| server taaskäivitub rikastuse ajal | käivitusel `enrich_pending` kordus |

### 7.3 Testid

pytest:
- loomine: märge + kontekst + `created_via`; `card` salvestub ühe sammuga;
  409 `exists` (ka normaliseerimata ID); 409 `split` (ID-d eri kaartidel);
- **`review` ei ole kliendilt kirjutatav**: `update_person` (`review`) JA `/enrich`
  (`review` ning `review.state` väljarajana);
- taustarikastus: täidab ainult tühjad; aliased ühendatakse; kaardiga konflikt puutumata;
  allikatevaheline vastuolu → täitmata + `source_conflicts`; kokkusobiv kuupäev → täpsem;
  osaline õnnestumine → `auto_enriched` + `enrich_failed` + `failed_sources`;
  `auto_filled` = kaardiväljad (`occupations`, mitte `_occupations`);
- `enrichment_to_card_fields`: `_linked_gnd` teisel kaardil → ei lisata + `possible_duplicate`;
- taustatöö ei võta lukku välisallika päringu ajaks; kaart loetakse luku all uuesti
  (vahepealne käsitsi muudatus jääb alles);
- **päringu ajal eemaldatud/muudetud ID** → selle allika ettepanekuid ei rakendata;
  **kaart kustutati/liideti** päringu ajal → midagi ei kirjutata;
- **lõppolekud** (§4.3 tabel): iga rida; `enrich_pending` eemaldub alati,
  `possible_duplicate` / `no_source` säilivad;
- **ID-lukk:** kaks samaaegset taustatööd sama `_linked_gnd`-iga eri kaartidel → ID ühel
  kaardil, teine saab `possible_duplicate`; `update_person` identifiers-muudatus ja
  `create` sama ID-ga korraga → üks kaart;
- `persons/create`: `card` + tipuväli korraga → 400; duplikaadikontroll käib `card.identifiers`
  peal (ID ainult `card`-is → ikkagi 409);
- kinnitus: vale `updated_at` → 409; `enrich_pending` ajal → 409;
- käivitusel `enrich_pending` kordus;
- tuletatud floruit: ainult tegevusrollid; käsitsi võidab;
- teose salvestamine värskendab mõjutatud isikute indeksikirjeid (`work_count`);
- `/candidates`: osaline tõrge, eelarve, `existing_person_id`;
- stub-tee saab märke;
- admin-otspunktid: `require_role("admin")`.

vitest:
- kandidaatide grupeerimine seotud ID-de järgi;
- kahe Wikidata otsingu ühendamine + dedup;
- nimevalik (§5.2 tabel + sõna-eesliite reegel („denius" ei sobi) + keelejärjestus + NFC).

jsdom (`/** @vitest-environment jsdom */`):
- paneel: olemasolev isik ees; „Loo ja vali" kutsub `onChange`-i; 409 → valik.

## 8. Teostus: neli PR-i

Iga PR on tootmises eraldi testitav (kasutaja töövoog: merge → deploy → test tootmises).

1. **Serveri alus** — `review` märge + `strip_server_fields` kõigis kirjutusteedes +
   ADR 0048; `persons/create` (ühesammuline, `card`); `_apply_fields` lukuta
   sisefunktsioon; `_ext_id_claim_lock` + lukkude järjekord; `enrichment_to_card_fields`;
   taustarikastus (koondamine, vastuolud, ID kehtivuse kontroll, lõppolekud) + taaste; stub-teed; `EntityPicker` ja `PersonEditPage` kutsuvad
   uut otspunkti (vorm ühe sammuga). *Kasu kohe:* ID-ga loodud kaartidele proovitakse
   automaatrikastust ja kõik uued kaardid saavad ülevaatusmärke. (Allikata loomine ja
   allikate tõrked võivad endiselt anda tühja kaardi — aga see on järjekorras nähtav.)
2. **Tuletatud floruit** + indeksikirjete värskendus teose salvestamisel.
3. **Isikupaneel** — `/candidates`, kahe otsingu ühendamine, nimevalik, paneel valijas ja
   `/persons/new`.
4. **Admini ülevaatusjärjekord** + §7.1 skript.

## 9. ADR

**0048 — Ülevaatusmärge on serveri väli** (PR 1 koosseisus): `review` kirjutavad ainult
loomine, taustarikastus ja admini kinnitus. KÕIK kliendi kirjutusteed (`update_person`,
`apply_enrichment` väljarajad, `persons/create` `card`) läbivad `strip_server_fields`-i.
Automaatrikastus täidab ainult tühja (hulgaväljad ühendatakse), ei rakenda kunagi
konflikti kaardiga ega allikatevahelist vastuolu. Taustatöö ei hoia kaardi lukku
välisallika päringu ajal. Tuletatud floruit on read-model ega kasuta
`subject`/`mentioned` rolle.

## 10. Muudatuste logi

**Rev 2 (2026-09-24, ülevaatuse järel):**

1. `review` kaitse katab kõik kliendi kirjutusteed, sh `apply_enrichment`-i väljarajad
   (`review.*`) — ühine `strip_server_fields` (§3.1).
2. Taustarikastus ei kutsu `apply_enrichment`-i luku seest (`threading.Lock` →
   ummikseis): allikad väljaspool lukku, luku all uuesti lugemine + ühine lukuta
   `_apply_fields` (§4.3).
3. Serveripoolne `enrichment_to_card_fields` (`_occupations` → `occupations`,
   `_linked_*` → `identifiers` duplikaadikontrolliga); `auto_filled` = kaardiväljad;
   hulgaväljade ühendamine on sõnastatud erandina (§4.3).
4. Allikatevaheline vastuolu: ettepanekud koondatakse enne kirjutust, vastuoluline väli
   jääb täitmata (`source_conflicts`); osalise õnnestumise olek (`failed_sources`) (§4.3).
5. Kinnitus käib kaardiversiooni kohta (`updated_at`), keelatud `enrich_pending` ajal;
   kinnitust uuesti ei avata (kasutaja otsus) (§3.1, §4.5).
6. Vormi loomine ühe sammuga (`card`), enne taustatööd (§4.2).
7. Väiksemad: sõna-eesliite sobivusreegel (§5.2); 409 `split` mitme kaardi korral (§4.2);
   PR 1 lubadus täpsustatud (§8).

**Rev 3 (2026-09-24, teise ülevaatuse järel):**

1. Kaardi sisul üks allikas: `card` VÕI tipuväljad (mõlemad → 400); duplikaadikontroll
   käib lõpliku salvestatava kaardi normaliseeritud ID-de peal (§4.2).
2. Taustatöö rakendab ainult nende allikate ettepanekud, mille ID on kaardil alles;
   kustutatud/tombstone-kaardile ei kirjutata (§4.3).
3. `_ext_id_claim_lock` kõigile ID-lisavatele teedele, katab kontrolli + salvestuse +
   `ext_id_index`-i; järjekord ID-lukk → `person_lock` (§4.6).
4. Iga lõppenud katse eemaldab `enrich_pending`-i; lõppolekute tabel, sh `nothing_to_fill` (§4.3).
5. `identifiers` lisandus on nimetatud „ainult tühja" erandina; §6 eristab 409 `exists`/`split`.
