# Kollektsioonide süsteem (Collections)

> **Staatus:** Planeerimisel  
> **Prioriteet:** Järgmine suurem arendus  
> **Viimati uuendatud:** 2026-01-19

## Ülevaade

Praegu on meil teose-tasemel märksõnad (`teose_tags`) žanri klassifitseerimiseks. Kollektsioonid oleksid kõrgema taseme organisatsiooniline üksus teoste hierarhiliseks grupeerimiseks.

**Põhiline eristus:**
- **Kollektsioon** = "Kust see pärit on?" (provenance/institution) — kaustalaadne, üksteist välistav
- **Tag** = "Millest see räägib?" (topic/genre) — võivad kattuda, many-to-many

See eristus hoiab süsteemi selgena: teosel on täpselt üks päritolu, aga võib katta mitut teemat.

## Kontseptsioon

- Kollektsioon = nimega teoste grupp (nt "Tartu akadeemia", "Pärnu gümnaasium")
- **Hierarhiline**: kollektsioonidel võivad olla alamkollektsioonid (nt "Tartu akadeemia" → "Disputatsioonid" → "1630-1640")
- Teos kuulub täpselt ühte kollektsiooni (aga pärib ülemkollektsioonid filtreerimiseks)
- Filtreeri Dashboard ja SearchPage kollektsiooni järgi (globaalne kontekst)
- Igal kollektsioonil võib olla oma maandumisleht või kirjeldus

## Kasutusjuhud

- Piira otsing/sirvimine ühe institutsiooni dokumentidele
- Loo temaatilised alamkorpused teaduseks
- Jaga teadlastega kollektsioonispetsiifilisi URL-e
- Organiseeri suur korpus hallatavate alamgruppideni

## Andmemudel

```json
// state/collections.json - hierarhia definitsioon
// NB: ID-d on stabiilsed slugid - ära kunagi muuda ID-sid admin UI-s (nõuaks massilist re-indekseerimist)
{
  "tartu-akadeemia": {
    "name": "Tartu akadeemia",
    "parent": null,
    "description": "Academia Gustaviana / Gustavo-Carolina"
  },
  "tartu-disputatsioonid": {
    "name": "Disputatsioonid",
    "parent": "tartu-akadeemia",
    "description": null
  },
  "tartu-disp-1630-1640": {
    "name": "1630–1640",
    "parent": "tartu-disputatsioonid",
    "description": null
  }
}

// _metadata.json per teos - ainult otsene (leht) kollektsioon
{
  "teose_id": "...",
  "kollektsioon": "tartu-disp-1630-1640"
}

// Meilisearch dokument - denormaliseeritud täis hierarhiaga filtreerimiseks
{
  "teose_id": "...",
  "kollektsioon": "tartu-disp-1630-1640",
  "kollektsioonid": ["tartu-akadeemia", "tartu-disputatsioonid", "tartu-disp-1630-1640"]
}
```

## UI - Modaalne kollektsiooni valija (Headeris)

- Nupp Headeris näitab praegust kollektsiooni (või "Kõik tööd")
- **Visuaalne esiletõst**: kui filter on aktiivne, nupul erinev taustavärv/ikoon
- Klikk avab modaali:
  - Otsingukast ülaosas (filtreerib puud reaalajas)
  - Puuvaade laiendamise/kokkutõmbamisega
  - Teoste arv iga kollektsiooni juures (sh alamad)
  - Tühjad kollektsioonid hallid (disabled) või peidetud toggle'iga
  - "Kõik tööd" valik filtri tühistamiseks
  - Eriline "Määramata" (Unassigned) virtuaalne kollektsioon teoste jaoks ilma kollektsioonita
- Valik uuendab URL-i (`?collection=tartu-akadeemia`) ja filtreerib kõiki vaateid
- Töötab "globaalse kontekstina" - mõjutab Dashboard, SearchPage, Statistics

## Breadcrumbs Workspace'is

Teose vaatamisel näita selle kollektsiooni hierarhiat klikkitavate breadcrumb'idena:
`Tartu akadeemia > Disputatsioonid > 1630-1640`

Mis tahes taseme klikkimine navigeerib Dashboard'ile, mis on filtreeritud selle kollektsiooni järgi.

## Modaali mockup

```
┌─────────────────────────────────────────────┐
│  Vali kollektsioon                      ✕  │
├─────────────────────────────────────────────┤
│  🔍 Otsi kollektsioone...                   │
├─────────────────────────────────────────────┤
│  ○ Kõik tööd (2,847)                        │
│  ○ Määramata (124)                          │
│  ▼ Tartu akadeemia (1,523)                  │
│      ▼ Disputatsioonid (892)                │
│          ○ 1630–1640 (156)                  │
│          ○ 1640–1650 (203)                  │
│          ○ 1650–1660 (245)  ← selected      │
│      ▶ Oratsioonid (431)                    │
│  ▶ Pärnu gümnaasium (1,324)                 │
└─────────────────────────────────────────────┘
```

**UX detail: "Kõik tööd" vs "Määramata"**

Need kaks valikut on olemuselt erinevad ja peavad olema visuaalselt eristatavad:

| Valik | Filter | Käitumine |
|-------|--------|-----------|
| **Kõik tööd** | MAAS | Näitab kõiki teoseid, sõltumata kollektsioonist |
| **Määramata** | PEAL | Näitab AINULT teoseid, kus `kollektsioon` puudub |

"Määramata" on adminile kõige olulisem tööriist andmete korrastamiseks algfaasis.

## Dashboard kollektsiooni maandumisleht

Kui kasutaja valib kollektsiooni, näidatakse Dashboard'il enne otsinguriba:
- Kollektsiooni nimi (pealkiri)
- Lühikirjeldus (description)
- Pikk kirjeldus (description_long) Markdown formaadis, kui on olemas
- Võimalik link pikema kirjelduse juurde

**Andmemudeli laiendus:**
```json
{
  "tartu-akadeemia": {
    "name": "Tartu akadeemia",
    "parent": null,
    "description": "Academia Gustaviana / Gustavo-Carolina",
    "description_long": "## Tartu ülikooli trükised\n\nTartu ülikool asutati 1632. aastal...",
    // VÕI viide eraldi failile:
    "description_file": "collections/tartu-akadeemia.md"
  }
}
```

See on teadlastele väga väärtuslik - annab konteksti kollektsiooni kohta.

## Admin - Kollektsioonide haldus

- Uus sektsioon `/admin` lehel: "Kollektsioonid"
- Loo/muuda/kustuta kollektsioone (saab muuta nime/kirjeldust, MITTE ID-d)
- Parent dropdown hierarhia jaoks (drag-and-drop valikuline)
- Ainult admin'id saavad kollektsioone hallata

### Ohutu kustutamine (Safe Delete)

Kollektsiooni kustutamisel tuleb järgida ohutusreegleid:

1. **Kui kollektsioonil on alamkollektsioone:**
   - ❌ Keela kustutamine
   - Nõua enne alamate liigutamist/kustutamist teise vanema alla

2. **Kui kollektsioonil on teoseid:**
   - Küsi adminilt: "Selles kollektsioonis on 50 teost. Kuhu need liigutada?"
   - Valikud:
     - a) Ülemkategooriasse (parent collection)
     - b) Määramata (Unassigned)
   - Teosta liigutamine ENNE kustutamist

3. **Ära kunagi kustuta teoseid endid kollektsiooni kustutamisel**

## Admin - Massiline määramine (KOHUSTUSLIK)

Massiline määramine on oluline andmete esialgseks organiseerimiseks:
- Dashboard: multi-select checkboxid teoste kaartidel
- Ilmub tegevusriba: "Liiguta kollektsiooni" nupp
- Avab kollektsiooni puu valija → vali sihtkoht
- Uuendab kõigi valitud teoste `_metadata.json` ja re-indekseerib Meilisearch'is

## Implementatsiooni sammud

1. Loo `state/collections.json` algse hierarhiaga
2. Lisa `kollektsioon` (string) ja `kollektsioonid` (array) Meilisearch skeemasse
3. Uuenda `1-1_consolidate_data.py` hierarhia laiendamiseks indekseerimisel:
   - Loe leht-kollektsioon `_metadata.json`-ist
   - Otsi vanemad `state/collections.json`-ist (traverse up to root)
   - Ehita massiiv: `["tartu-akadeemia", "tartu-disputatsioonid", "tartu-disp-1630-1640"]`
   - Salvesta `kollektsioonid` välja Meilisearch filtreerimiseks
4. Loo `CollectionPicker.tsx` modaalne komponent
5. Lisa kollektsiooni state Header'isse visuaalse esiletõstuga kui aktiivne
6. Uuenda `searchWorks()` ja `searchContent()` filtreerimaks `kollektsioonid` järgi
7. Lisa kollektsioonide halduse UI Admin lehele
8. Lisa kollektsiooni väli metadata modaali Workspace'is
   - Salvestamisel: uuenda `_metadata.json` JA käivita Meilisearch re-indeks selle teose jaoks
9. Lisa massilise määramise UI Dashboard'ile (ainult admin)
10. Lisa breadcrumbs Workspace header'isse

## "Määramata" (Unassigned) käsitlus

- Virtuaalne kollektsioon teoste jaoks, kus `kollektsioon` on null/tühi
- Kriitiline andmete korrastamise faasis - leia teosed, mis pole veel kategoriseeritud
- Filter: `kollektsioon NOT EXISTS` või tühja stringi kontroll
- Näidatud valijas, aga ei saa "määrata" (ainult eemaldada)

## Lahendatud küsimused

- ✅ Kes saab kollektsioone luua/muuta? → Ainult admin
- ✅ Juurdepääsukontroll? → Ei, kõik kollektsioonid nähtavad kõigile kasutajatele
- ✅ Eelmääratletud nimekiri vs vaba loomine? → Admin'i hallatav nimekiri `state/collections.json`-is
- ✅ Üks kollektsioon vs mitu? → Üks (päritolu), kasuta tag'e teemade jaoks
- ✅ Kas ID-d saavad muutuda? → Ei, ID-d on stabiilsed slugid (ainult nimi/kirjeldus muudetav)
- ✅ Massiline määramine? → Kohustuslik, Dashboard multi-select kaudu
- ✅ Kas kollektsioonil peaks olema "omanik" (curator)? → **MVP faasis EI.** Lisab keerukust. Adminid haldavad kõike. Kui tulevikus tekib vajadus anda konkreetsele teadlasele õigus hallata ainult ühte haru, siis lisatakse.
- ✅ Kas kollektsiooni maandumislehel peaks olema sissejuhatav tekst? → **JAH.** Teadlastele väga väärtuslik. Lisada `description_long` (Markdown) või `description_file` viide.
- ✅ Kas statistika peaks näitama kollektsioonipõhist progressi? → **JAH.** Kuna kollektsioon on "globaalne kontekst", siis `/statistics` lehel graafikud automaatselt peegeldavad valitud kollektsiooni.
- ✅ Kuidas käsitleda kollektsiooni kustutamist? → **Ohutu kustutamine:** keela kui on alamaid; küsi kuhu teosed liigutada; ära kunagi kustuta teoseid automaatselt.

## Avatud küsimused

- ✅ Kas kollektsiooni kirjeldused peaksid olema mitmekeelsed (et/en)? → **JAH.** Default on ET nagu igal pool. Struktuur:
  ```json
  {
    "description": { "et": "Eestikeelne...", "en": "English..." },
    "description_long": { "et": "## Pikk tekst...", "en": "## Long text..." }
  }
  ```
- ✅ Kas Dashboard'il peaks olema "vaikimisi kollektsioon" seadistus kasutaja jaoks? → **JAH, aga etapiviisiliselt:**
  - **MVP:** Viimane valik salvestub `localStorage`'i (nagu keelevalik). Järgmisel külastusel taastatakse.
  - **Hiljem:** Kasutaja profiili seadistus serveris (kui tekib vajadus).

*Kõik põhiküsimused lahendatud. Plaan on valmis implementeerimiseks.*
