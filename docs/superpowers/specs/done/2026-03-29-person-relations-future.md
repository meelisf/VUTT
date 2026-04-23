# Isikute seosed — rikastamine ja graaf

**Kuupäev:** 2026-03-29
**Staatus:** Spec valmis, implementatsiooniplaani pole veel kirjutatud

---

## Kolm iseseisvat osa (eelistusjärjekorras)

| # | Osa | Ulatus | Sõltuvused |
|---|-----|--------|------------|
| 1 | Seose tüüp Wikidatast | Väike — ainult frontend | Ei |
| 2 | Teostest tuletatud seosed PersonDetailPage-l | Keskmine — uus backend endpoint + frontend sektsion | Ei |
| 3 | Seosegraaf ja kauguse-põhine otsing | Suur — eraldi spec vajab | Sõltub 1+2-st |

---

## Osa 1: Seose tüüp Wikidatast

### Probleem

Praegu on `relations[].type` vabatekstiline string (nt `"õpetaja"`). PersonEditPage-l on `<input type="text">`. Puuduvad tõlked ja standardiseeritud koodid.

### Andmemudel

Lisatakse kaks valikulist välja — `type` jääb tagasiühilduvuse tagamiseks alles:

```json
{
  "name": "Johann Müller",
  "type": "õpetaja",
  "type_id": "Q37226",
  "type_labels": { "et": "õpetaja", "en": "teacher", "de": "Lehrer", "la": "magister" },
  "target_id": "vutt:Pabc123"
}
```

### Pöördseosed ja type_id koostoime

`reciprocal_auto: true` seosed luuakse tühja `type` ja `type_id`-ga — kasutaja täidab käsitsi. Süsteem **ei tuleta automaatselt vastasseose tüüpi** (nt A on B "õpetaja" → B on A "õpilane"), sest:

- Seose semantika ei ole alati sümmeetriline ega deterministlik
- Wikidata sisaldab küll vastasseose omaduse (`P7087`), kuid selle rakendamine vajaks eraldi Wikidata päringusammu ja jääb tulevikku

**MVP käitumine:** kui A lisab B-le seose `type_id=Q37226` (teacher), saab B automaatselt rea `{ target_id: A.id, type: "", type_id: null, reciprocal_auto: true }`. Kasutaja näeb `↔` ikooni ja täidab tüübi käsitsi. See on teadlik kompromiss — annoteeritud on vähemalt seos, tüübid saab täita hiljem.

### Tuleviku täiendus: Wikidata pöördseoste sõnastik

Wikidata omadus `P7087` (inverse property) seob näiteks "teacher" (Q37226) ↔ "student" (Q48282). Selle asemel et iga pöördseost Wikidatast pärida reaalajas, saab ehitada **lokaalse sõnastiku** `type_id`-de paaridest:

```json
{
  "Q37226": "Q48282",
  "Q7042855": "Q185351",
  ...
}
```

Sõnastik täidetakse Wikidata SPARQL-päringuga (ühekordne skript), salvestatakse staatilise failina serveris. Kui A lisab B-le `type_id=Q37226` (teacher), täidetakse B auto-seose `type_id` automaatselt `Q48282`-ga (student) ja `type` vastava keele labeliga.

**Implementatsioon (tulevikus):**
1. Skript `scripts/build_inverse_relations_dict.py` — SPARQL-päring Wikidatast, salvestab `data/state/inverse_relations.json`
2. `reciprocal_ops.py` laeb sõnastiku ja täidab `type_id`/`type` kui sõnastikus kirje olemas
3. Kui sõnastikus pole → jätab tühjaks (praegune MVP käitumine)

See on isoleeritud täiendus `reciprocal_ops.py`-le, ei mõjuta andmemudelit.

### Validatsioon (frontend)

Enne payload saatmist kontrollitakse `type_id` vastu `isQCode()` (`/^Q\d+$/`). Vigane ID ei lasta läbi — EntityPicker tagastab ainult valideeritud väärtusi, nii et see on pigem kaitsekiht programmaatilise kasutuse vastu.

```typescript
// helpers.ts — draftToPayload
type_id: item.type_id && isQCode(item.type_id) ? item.type_id : null,
```

### Muudatavad failid

**`src/prosopography/components/personForm/types.ts` rida 25:**
```typescript
export interface RelationDraft {
  name: string;
  type: string;
  type_id?: string | null;
  type_labels?: Record<string, string> | null;
  target_id?: string | null;
  reciprocal_auto?: boolean;
}
```

**`src/prosopography/components/personForm/helpers.ts` — `recordToDraft`:**
- Lisa `type_id: r.type_id ?? null` ja `type_labels: r.type_labels ?? null`

**`src/prosopography/components/personForm/helpers.ts` — `draftToPayload`:**
- Lisa `type_id` (valideeritud) ja `type_labels` relations payload-i

**`src/prosopography/pages/PersonEditPage.tsx` — relations `renderItem` (~rida 642):**

Asenda `<input type="text">` `EntityPicker`-iga:

```tsx
<EntityPicker
  value={item.type_id ? { id: item.type_id, label: item.type, labels: item.type_labels ?? {} } : null}
  onChange={entity => onChange({
    ...item,
    type: entity?.label ?? '',
    type_id: entity?.id ?? null,
    type_labels: entity?.labels ?? null,
  })}
  placeholder={t('form.relationPlaceholder')}
  className="w-36 shrink-0"
/>
```

**`src/prosopography/pages/PersonDetailPage.tsx` — `StructuredInfoCard` relations rida (~rida 122):**

Kasuta `r.type_labels?.[lang] ?? r.type` tüübi kuvamiseks (tõlge kui olemas).

**Backend:** muudatusi pole — JSON on schemavaba.

---

## Osa 2: Teostest tuletatud seosed PersonDetailPage-l

### Probleem

Praegu kuvatakse `PersonDetailPage`-l ainult käsitsi lisatud `person.relations[]`. Kaasautorlused, pühendused jm teoste kaudu tuletatavad seosed teiste isikutega pole nähtavad.

### Loogika

Isik A on seotud isikuga B läbi teoste kui mõlemad esinevad sama teose `creators[]` hulgas. Nt A on `praeses` ja B on `respondens` teosel X.

### Jõudluse strateegia — globaalne indeks

Naiivselt loeb backend iga teose `_metadata.json`-st `creators[]` — 50 teosega isiku puhul 50 failisüsteemi lugemist cache miss-il. See on liiga aeglane.

**Lahendus: `works_creators_index.json`** — globaalne indeks, mida uuendatakse iga `/save` ja `/update-work-metadata` kutsumise järel (background task, analoogselt `person_to_works.json` uuendamisega).

Struktuur:
```json
{
  "abc123": [
    { "person_id": "vutt:Paaa", "roles": ["praeses"] },
    { "person_id": "vutt:Pbbb", "roles": ["respondens"] }
  ]
}
```

Endpoint loeb ainult seda indeksit + `person_to_works.json` — **nulli failisüsteemi lugemist** päringul. Indeks ehitatakse serveris uuesti ka `rebuild_indices` käsus.

Indeks salvestatakse: `data/state/works_creators_index.json`

### API endpoint

```
GET /prosopography/{person_id}/work-relations?limit=10&offset=0
```

Tagastab:
```json
[
  {
    "person_id": "vutt:Pbbbbb",
    "person_name": "Johann Müller",
    "shared_works_count": 3,
    "shared_works": [
      {
        "work_id": "abc123",
        "work_title": "Disputatio de ...",
        "work_year": 1687,
        "a_roles": ["praeses"],
        "b_roles": ["respondens", "autor"]
      }
    ]
  }
]
```

**Rollide mudel on massiivipõhine** (`a_roles`, `b_roles`) — isik võib olla samas teoses mitmes rollis.

**Implementatsioon — uus fail `server/prosopography/work_relations_ops.py`** (ei lisata `router.py`-sse ega `ops.py`-sse inline):
1. Loe `person_to_works.json` → A kõik `work_id`-d
2. Loe `works_creators_index.json` → iga teose osalised
3. Grupeeri teiste isikute kaupa, kogu `a_roles` ja `b_roles` hulkadesse
4. Filtreeri: ainult `vutt:P` prefixiga isikud, välistada `person_id` ise
5. Sorteeri `shared_works_count` järgi kahanevalt
6. Rakenda `limit`/`offset`
7. Cache: 5 min TTL

`router.py` lisab ainult endpoint definitsiooni (~5 rida), loogika on `work_relations_ops.py`-s.

Endpoint on avalik (autentimist ei nõua).

### Frontend — uus sektsion PersonDetailPage-l

Uus `WorkRelationsCard` komponent lisatakse eraldi faili `src/prosopography/components/WorkRelationsCard.tsx` ja imporditakse `PersonDetailPage`-sse. `PersonDetailPage.tsx` ise ei kasva — ainult üks `<WorkRelationsCard personId={id} />` rida.

```
┌─────────────────────────────────────────────────────┐
│ ↔  Seosed teoste kaudu                         (12) │
├─────────────────────────────────────────────────────┤
│  Johann Müller     praeses ↔ respondens    3 teost  │
│  Andreas Berg      praeses ↔ opponens      2 teost  │
│  ...                                                │
│                           [Lae veel]                │
└─────────────────────────────────────────────────────┘
```

- Vaikimisi 10 isikut, "Lae veel" laeb järgmised (`offset` päring)
- Klõps real → inline accordion: loetleb jagatud teosed aastaarvu ja rollipaaridega
- Klõps teosel → `/work/{work_id}/1`
- Klõps isiku nimel → `/persons/{person_id}`

**Olemasolevad käsitsi seosed (`person.relations[]`) jäävad `StructuredInfoCard`-i** — kuvamist võib parendada eraldi.

---

## Osa 3: Seosegraaf ja kauguse-põhine otsing

### Disainiotsused (langetatud)

**Graafi UI asukoht:** eraldi leht (`/persons/{id}/graph`) või täisekraani modaal. PersonDetailPage-l on väike nupp "Ava seosegraaf" — kitsas kastis oleks UX kehv (suumimine, panoraamimine).

**Raamatukogu:** `cytoscape.js` + `react-cytoscapejs` — digitaalhumanitaaria standard, toetab paljusid layout-algoritme (`dagre`, `cola`, `fCoSE`), DH teadlased tunnevad Cytoscape'i ning andmeid saab eksportida Gephi-sse. `react-force-graph` alternatiivina kui jõudlus muutub probleemiks (WebGL, suurte graafide jaoks).

**Kauguse-põhine otsing — kaks kohta:**
- **PersonsPage filter:** "Näita isikuid kes on seotud X-ga max N astme kaudu" — tagastab tavalise tabeli/listi
- **Graafi UI:** depth slider, mis kontrollib laetava graafi sügavust (`?depth=1` vaikimisi, suurendatav)

### Serva andmemudel

```json
{
  "source_id": "vutt:Pabc",
  "target_id": "vutt:Pxyz",
  "type": "juhendaja",
  "type_id": "Q37226",
  "edge_source": "manual | work",
  "work_id": "nanoid (kui edge_source=work)",
  "work_role": "eessõna autor (kui edge_source=work)"
}
```

### Moodulite kaart — uued failid, olemasolevad ei suurene

**Backend:**

| Fail | Sisu |
|------|------|
| `server/prosopography/graph_ops.py` | **Uus** — BFS graafi ehitamine, `GET /prosopography/graph` loogika |
| `server/prosopography/router.py` | +2 endpoint definitsiooni (~10 rida), loogika on eraldi failides |

**Frontend:**

| Fail | Sisu |
|------|------|
| `src/prosopography/pages/PersonNetworkPage.tsx` | **Uus** — `/persons/network` leht, Cytoscape graaf + isikute nimekiri |
| `src/prosopography/components/PersonNetworkGraph.tsx` | **Uus** — Cytoscape wrapper komponent |
| `src/prosopography/services/prosopographyService.ts` | +1 funktsioon `fetchPersonGraph()` |

`PersonsPage.tsx`, `PersonDetailPage.tsx` jt olemasolevad failid **ei suurene** — PersonDetailPage-le lisatakse ainult "Ava seosegraaf" nupp (link `/persons/{id}/graph`).

### Backend graph endpoint

```
GET /prosopography/graph?root={person_id}&depth=2
```

Tagastab `{ nodes: [...], edges: [...] }` Cytoscape-ühilduvas formaadis. Loogika `graph_ops.py`-s: BFS üle `relations[]` (käsitsi seosed) + `works_creators_index.json` (teostest tuletatud) kombinatsiooni.

### Langetatud otsused

**Kauguse-põhine otsing:** eraldi "Võrgustiku otsing" vaade (mitte AdvancedFilters filter). Tõenäoliselt `/persons/network` — kasutaja valib algsõlme ja depth, näeb graafi + selle põhjal filtreeritud isikute nimekirja.

**Layout:** `fCoSE` vaikimisi — 17. saj akadeemilised võrgustikud on non-hierarhilised, klastrite loomulik teke annab historiograafiliselt huvitavat infot. Analoogselt Gephi vaikimisega, DH kasutajatele tuttav. `dagre` võib jätta valikuks UI layout-nupus.

**Sõlmede kujundus:** portreepilte ei kuvata — enamusel isikutel puudub. Algsõlm (otsingu lähtepunkt) on visuaalselt esile toodud (suurem ring, tumedam värv). Teised sõlmed ühtse stiiliga.
