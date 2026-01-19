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
- **Hierarhiline**: kollektsioonidel võivad olla alamkollektsioonid (nt "Academia Gustaviana" → "Facultas Theologica"). 
- **NB! Aeg ei ole kollektsioon:** Ajaline piiritlemine (nt 1630-1640) toimub **filtri**, mitte kaustastruktuuri kaudu. Kollektsioon on institutsionaalne kuuluvus.
- Teos kuulub täpselt ühte kollektsiooni (aga pärib ülemkollektsioonid filtreerimiseks)
- Filtreeri Dashboard ja SearchPage kollektsiooni järgi (globaalne kontekst)
- Igal kollektsioonil võib olla oma maandumisleht või kirjeldus

## Kasutusjuhud

- Piira otsing/sirvimine ühe institutsiooni dokumentidele
- Loo temaatilised alamkorpused teaduseks
- Jaga teadlastega kollektsioonispetsiifilisi URL-e
- Organiseeri suur korpus hallatavate alamgruppideni

## Andmemudel

### Põhimõte: ID vs Slug vs Silt

Andmete terviklikkuse ja püsivuse tagamiseks lahutame identiteedi ja esituse:
1.  **`id` (Püsiv ID):** Genereeritud püsiv lühikood (Short ID, nt `x9r4mk` või `utlib:1234`). See ei sõltu teose sisust ega pealkirjast ja **ei muutu kunagi**. See on "ankur" viitamiseks.
2.  **`slug` (Inimloetav viide):** Tuletatud andmetest (nt `1635-virginius-manipulus`). Kaustanimed on tuletatud ja muudetavad, toimides ainult inimloetavuse ja SEO huvides.
3.  **Metadata väljad (Keys):** Inglise keeles (`title`, `year`, `genre`), et vältida "keeltepaabelit" koodis.
4.  **Konfiguratsioon:** Defineeribe inimloetavad nimed ja hierarhia.

### 1. Konfiguratsioon (`state/collections.json`)

See fail defineerib puu struktuuri. ID-d on ladinakeelsed.
**NB!** Failisüsteem jääb lamedaks (flat), hierarhia on ainult loogiline (selles failis).
Kasutame `order` välja käsitsi sordi tagamiseks (nt traditsiooniline teaduskondade järjekord).

```json
{
  "universitas-dorpatensis-1": {
    "name": { "et": "Rootsi aja ülikool (1632–1710)", "en": "University..." },
    "type": "virtual_group",
    "order": 1,
    "children": ["academia-gustaviana", "academia-gustavo-carolina"]
  },
  "academia-gustaviana": {
    "name": { "et": "Academia Gustaviana", "en": "Academia Gustaviana" },
    "parent": "universitas-dorpatensis-1",
    "order": 1
  }
}
```

### 2. Teose metaandmed (`_metadata.json`) - UUS STANDARD

```json
{
  "id": "u7k9m2",                    // Püsiv lühikood
  "slug": "1635-virginius-manipulus", // Tuletatud, muudetav (SEO)
  
  // Taksonoomia
  "type": "impressum",
  "genre": "disputatio",
  "collection": "academia-gustaviana",
  
  // Sisu
  "title": "Manipulus disputationum...",
  "year": 1635,
  "publisher": "Jacob Becker (Pistorius)",
  "location": "Tartu",
  
  // Isikud ja rollid (Massiiv!)
  "creators": [
    { 
      "name": "Virginius, Andreas", 
      "role": "praeses",
      "identifiers": {          // TULEVIKUKINDLUS: Autoriteetviited
        "gnd": "124619864",     // Frontend genereerib lingi: https://d-nb.info/gnd/124619864
        "viaf": "55085627"      // Frontend genereerib lingi: https://viaf.org/viaf/55085627
      }
    },
    { "name": "Lannerus, Jonas", "role": "respondens" }
  ],
  
  // Sisu detailid
  "languages": ["lat", "grc"],   // ISO 639-3
  
  // Seeria (nt 10-osaline disputatsioonide jada)
  "series": {
    "title": "Disputationes in Evangelium Johannis",
    "number": "1"
  },

  // Seosed teoste vahel (Dialoogid, vastused)
  "relations": [
    {
      "id": "1635-vastus-virginiusele",
      "rel_type": "isReferencedBy",
      "label": "Vastus disputatsioonile"
    }
  ],

  // Märksõnad
  "tags": ["teoloogia"]
}
```

## Andmete migratsioon (Mapping)

### Standard: Dublin Core + Laiendused

Isikute (autorite, respondentide jt) puhul läheme üle **struktureeritud massiivile `creators`**. See võimaldab paindlikult lisada erinevaid rolle (gratulant, dedikant) ilma andmebaasi skeemi muutmata.

| Vana väli (ET) | Uus väli (EN) | DC vaste / Selgitus |
| :--- | :--- | :--- |
| `teose_id` | **`slug`** | Inimloetav viide (nt `1759-diarium`). |
| *puudub* | **`id`** | Genereeritud lühikood (Short ID, nt `x9r4mk`). |
| `pealkiri` | **`title`** | `dc:title` |
| `autor` | **`creators`** | `role: "author"` (või `praeses` disputatsioonidel). |
| `respondens` | **`creators`** | `role: "respondens"`. |
| `aasta` | **`year`** | `dc:date` |
| `trükkal` | **`publisher`** | `dc:publisher` |
| `koht` | **`location`** | `dc:coverage` |
| `ester_id` | **`ester_id`** | `dc:identifier` |
| `teose_tags` | **`type`**, **`genre`**, **`tags`** | Vt selgitust ülal. |
| *puudub* | **`languages`** | `dc:language`. Vaikimisi `["lat"]`. |
| *puudub* | **`series`** | `dc:relation` (isPartOf). Seeria info. |
| *puudub* | **`relations`** | `dc:relation`. Viited teistele teostele. |
| *puudub* | **`collection`** | `dc:source` |

### 3. Otsingu indeks (Meilisearch)

Meilisearch'i jaoks denormaliseerime `creators` massiivi, et võimaldada lihtsat otsingut.

```json
{
  "id": "1635-virginius-manipulus",
  "collection": "academia-gustaviana",
  "type": "impressum",
  "genre": "disputatio",
  "title": "Manipulus...",
  "year": 1635,
  "languages": ["lat", "grc"],
  "series_title": "Disputationes...", // Lihtsustatud otsinguks
  // Lihtsustatud väljad otsingu/filtreerimise jaoks:
  "authors_text": ["Virginius, Andreas", "Lannerus, Jonas"], // Kõik nimed otsinguks
  "creators": [ ... ] // Täielik struktuur kuva jaoks
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

### URL ja Navigatsioon

Kasutame **route-põhist** lähenemist, kus ID on primaarne:
- `/works/u7k9m2` -> Teose vaade.
- `/works/u7k9m2/1635-virginius-manipulus` -> SEO-sõbralik URL.
- **Dekoratiivne slug ja 301 redirect:** Süsteem lahendab päringu alati `id` järgi. Kui URL-is olev slug on vana või vigane, teeb server automaatse **301 redirecti** hetkel korrektsele URL-ile (põhinedes `_metadata.json` faili `slug` väljal). See hoiab lingid püsivana ka andmete muutumisel.
- **SEO Canonical URL:** Frontend renderdab alati `<link rel="canonical" ... />` viitega korrektsele slugile.

Kollektsioonide puhul:
- `/collections/academia-gustaviana` - Kollektsiooni avaleht + otsing selles kontekstis.
- `/collections/academia-gustaviana?genre=disputatio` - Otsing kollektsiooni sees.

Valik modaalis **navigeerib** kasutaja vastavale URL-ile. Töötab "globaalse kontekstina" - mõjutab Dashboard, SearchPage, Statistics vaateid.

## Breadcrumbs Workspace'is

Teose vaatamisel näita selle kollektsiooni hierarhiat klikkitavate breadcrumb'idena:
`Rootsi aja ülikool > Academia Gustaviana`

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
│  ▼ Rootsi aja ülikool (1,523)               │
│      ○ Academia Gustaviana (892)            │
│      ○ Academia Gustavo-Carolina (631)      │
│  ▼ Vennastekogudus (1,324)                  │
│      ○ Rudolf Põldmäe arhiiv (432)   ← sel. │
│      ○ Herrnhuti arhiiv (892)               │
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
  "academia-gustaviana": {
    "name": { "et": "Academia Gustaviana", "en": "Academia Gustaviana" },
    "parent": "universitas-dorpatensis-1",
    "description": { "et": "Tartu ülikooli esimene periood...", "en": "..." },
    "description_long": { "et": "## Tartu ülikooli trükised...", "en": "..." }
  }
}
```

See on teadlastele väga väärtuslik - annab konteksti kollektsiooni kohta.

## Admin - Kollektsioonide haldus

- Uus sektsioon `/admin` lehel: "Kollektsioonid"
- Loo/muuda/kustuta kollektsioone (saab muuta nime/kirjeldust, MITTE ID-d)
- Parent dropdown hierarhia jaoks (drag-and-drop valikuline)
- Ainult admin'id saavad kollektsioone hallata
- **Andmete sünkroonimine (Re-sync):** Admin paneelil peab olema nupp "Re-sync Index", mis käivitab massilise re-indekseerimise failidest, kui failisüsteem ja Meilisearch on sünkroonist väljas.
- **Tühjade kollektsioonide kuvamine:**
  - Avalik vaade: Peida tühjad kollektsioonid.
  - Admin vaade: Näita alati kõiki (ka tühje), et võimaldada teoste liigutamist neisse.

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

## Kontrollitud sõnavara (`state/vocabularies.json`)

Et tagada andmete kvaliteet ja ühtsus, kasutame Admin UI-s (dropdown menüüdes) kontrollitud sõnavara faili. See defineerib lubatud väärtused taksonoomia väljadele.

**Põhimõte:**
- **Types/Roles:** Rangelt piiratud (Admin valib nimekirjast).
- **Genres:** Soovituslik nimekiri. Kui teos ei sobitu (nt *Streitbrief*), jäetakse `genre: null` ja lisatakse spetsiifiline termin `tags` alla.

```json
{
  "types": {
    "impressum": { "et": "Trükis", "en": "Printed Matter" },
    "manuscriptum": { "et": "Käsikiri", "en": "Manuscript" }
  },
  "genres": {
    "disputatio": { "et": "Väitekiri (Disputatsioon)", "en": "Disputation" },
    "oratio": { "et": "Kõne (Oratsioon)", "en": "Oration" },
    "carmen": { "et": "Luuletus", "en": "Poem" },
    "diarium": { "et": "Päevik", "en": "Diary" },
    "epistola": { "et": "Kiri", "en": "Letter" },
    "programma": { "et": "Programm", "en": "Program" },
    "sermo": { "et": "Jutlus", "en": "Sermon" },
    "placatum": { "et": "Plakat/Määrus", "en": "Placard" },
    "meditatio": { "et": "Meditatsioon", "en": "Meditation" }
  },
  "roles": {
    "praeses": { "et": "Eesistuja (Praeses)", "en": "Praeses" },
    "respondens": { "et": "Vastaja (Respondens)", "en": "Respondent" },
    "auctor": { "et": "Autor", "en": "Author" },
    "gratulator": { "et": "Õnnitleja", "en": "Gratulator" },
    "dedicator": { "et": "Pühendaja", "en": "Dedicator" },
    "editor": { "et": "Koostaja/Toimetaja", "en": "Editor" }
  },
  "languages": {
    "lat": { "et": "Ladina", "en": "Latin" },
    "deu": { "et": "Saksa", "en": "German" },
    "est": { "et": "Eesti", "en": "Estonian" },
    "grc": { "et": "Vanakreeka", "en": "Ancient Greek" },
    "heb": { "et": "Heebrea", "en": "Hebrew" },
    "swe": { "et": "Rootsi", "en": "Swedish" },
    "fra": { "et": "Prantsuse", "en": "French" },
    "rus": { "et": "Vene", "en": "Russian" }
  },
  "relation_types": {
    "isPartOf": { "et": "On osa teosest/sarjast", "en": "Is Part Of" },
    "hasPart": { "et": "Sisaldab osa", "en": "Has Part" },
    "isVersionOf": { "et": "On versioon/kordustrükk teosest", "en": "Is Version Of" },
    "isReferencedBy": { "et": "Viidatud teoses (Vastus/Vastuväide)", "en": "Is Referenced By" },
    "references": { "et": "Viitab teosele", "en": "References" }
  }
}
```

## Haldusprotsessid

### Sõnastiku muutmine (Refactoring)

Kuna teadmine ja terminoloogia arenevad, on sõnastiku muutmine paratamatu. Eristame kahte olukorda:

1.  **Sildi muutmine (Label change):**
    *   Soovime muuta kuvatavat nime (nt "Plakat" -> "Määrus"), aga sisu jääb samaks.
    *   **Tegevus:** Muuda ainult `state/vocabularies.json` faili `et/en` väärtusi.
    *   **Mõju:** Andmefailid ei muutu. Muudatus rakendub koheselt UI-s.

2.  **ID muutmine või liitmine (ID rename/merge):**
    *   Soovime asendada termini tehniliselt (nt `placatum` -> `edictum`) või liita kaks žanri kokku.
    *   **Risk:** Vanad failid jäävad viitama olematule ID-le.
    *   **Tegevus:**
        1. Uuenda `vocabularies.json` (lisa uus ID, eemalda vana).
        2. Käivita migratsiooniskript (nt `python scripts/migrate_vocab.py --rename placatum edictum`).
        3. Skript teeb massilise asenduse kõigis `_metadata.json` failides.
        4. Kontrolli muudatused `git diff`-iga ja kinnita.

### Andmete kvaliteedikontroll (Validation)

Et vältida vigaseid andmeid (nt trükivead žanri nimes), rakendame **Schema Validation** protsessi.

*   **Tööriist:** `scripts/validate_metadata.py`
*   **Mida kontrollib:**
    *   Kas `collection` ID on `state/collections.json` failis?
    *   Kas `genre`, `role`, `language` on `state/vocabularies.json` nimekirjas?
    *   **Seoste terviklikkus (Referential integrity):** Kas `relations` väljal viidatud ID-d on süsteemis olemas? Kui ei, anna hoiatus.
    *   Kas andmetüübid on õiged (nt `year` on number)?
*   **Millal jookseb:**
    *   Arendaja masinas: `npm run validate`
    *   CI/CD (Build): Build ebaõnnestub, kui leitakse vigu.

## Implementatsiooni sammud

1. Loo `state/collections.json` algse hierarhiaga
2. Loo `state/vocabularies.json` sõnavaraga (koos `description` väljaga selgitavate tooltip'ide jaoks Admin UI-s)
3. Lisa `collection` (string) ja `collections_hierarchy` (array) Meilisearch skeemasse
4. Uuenda `1-1_consolidate_data.py` hierarhia laiendamiseks indekseerimisel:
   - Loe leht-kollektsioon `_metadata.json`-ist
   - Otsi vanemad `state/collections.json`-ist (traverse up to root)
   - Ehita massiiv: `["universitas-dorpatensis-1", "academia-gustaviana"]`
   - Salvesta `collections_hierarchy` välja Meilisearch filtreerimiseks
5. **Loo `scripts/validate_metadata.py` ja integreeri build-protsessi (pre-commit või CI).**
6. **Loo `scripts/build_id_map.py`:** Skript, mis genereerib `cache/id_map.json` (Map: `id` -> `file_path`) kiireks otsinguks. Süsteem peab suutma seda mälus uuendada (runtime) ka ilma build-sammuta.
7. Loo `CollectionPicker.tsx` modaalne komponent
8. Lisa kollektsiooni state Header'isse ja konfigureeri Router (`/collections/:slug`)
9. Uuenda `searchWorks()` ja `searchContent()` filtreerimaks `collections_hierarchy` järgi
10. Lisa kollektsioonide halduse UI Admin lehele
11. Lisa kollektsiooni väli metadata modaali Workspace'is
   - Salvestamisel: uuenda `_metadata.json` JA käivita Meilisearch re-indeks selle teose jaoks (veatöötlusega!)
12. Lisa massilise määramise UI Dashboard'ile (ainult admin)
13. Lisa breadcrumbs Workspace header'isse

## Täiendavad märkused (Meeldetuletuseks)

### 1. Slugi unikaalsus (Slug Uniqueness)
Kuigi süsteem töötab püsiva ID põhiselt, on SEO ja Canonical URL-i huvides oluline, et slugid oleksid unikaalsed.
- **Stsenaarium:** Kaks teost samal aastal sama pealkirjaga "Disputatio...".
- **Lahendus:** Admin UI slug-generaator peab kontrollima olemasolevaid sluge ja lisama vajadusel sufiksi (nt `1635-disputatio-2`).

### 2. ID genereerimise strateegia
Kasutada püsivate lühikoodide (`id`) jaoks piisava entroopiaga meetodit (nt `nanoid`), et vältida kokkupõrkeid, eriti kui mitu adminni lisavad sisu samaaegselt. Git merge conflict on viimane turvavõrk, aga algne genereerimine peaks olema unikaalne.

### 3. Admin UI - "Väsinud silma" kaitse
Kuna "Collection" ja "Tags" võivad visuaalselt sarnaneda (mõlemad on sildilaadsed elemendid), peab Admin UI need selgelt eristama:
- **Kollektsioon:** Paigutada eraldi plokki "Päritolu/Asukoht".
- **Tagid:** Paigutada plokki "Sisuline kirjeldus".
See väldib vigu andmete sisestamisel pika tööpäeva lõpus.

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
