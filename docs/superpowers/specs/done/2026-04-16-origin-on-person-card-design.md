# Päritolukoht isikukaardil ja PersonsPage filtris

**Kuupäev:** 2026-04-16  
**Seis:** Töös (v6 — puhas `origin.place` mudel, hierarhiline places.json, propagatsioon)

## Eesmärk

Kuvada isiku päritolukoht PersonCard-il ning lisada PersonsPage'ile päritolugrupi filter (asendab olemasoleva ameti filtri). Andmemudel peab toetama tulevast kaardivaadet, olema allikatruu ja vältima eksitavaid legacy-välju nagu `origin.city`.

---

## Allikatruuduse põhimõte

Doktorant sisestab **ühe päritolukoha**: kõige täpsema geograafilise üksuse, mida allikas või uurimistöö usaldusväärselt võimaldab.

Päritolukoht võib olla linn, küla, kogudus, kihelkond, maakond, provints või ajalooline piirkond. Kui teada on ainult Liivimaa, sisestataksegi päritolukohaks Liivimaa. Kui teada on Riga, siis Liivimaad eraldi ei sisestata, sest see tuletatakse `places.json` parent-ahelast.

`origin_group` ja laiem piirkond on alati tuletatud väärtused, mitte käsitsi sisestatavad isikukaardi väljad.

---

## Andmemudeli kihid

| Kiht | Väljad | Eesmärk | Praegune kate |
|------|--------|---------|---------------|
| **Geograafia** | `place_id` (Q-kood) | Koordinaadid, kaardikuva, SPARQL | praegune `city_id`: ~8% |
| **Kuvatav tekst** | `place`, `place_labels` | PersonCard, otsing | praegune `city`/`region`: ~30% |
| **Tuletatud indeks** | `origin_place`, `origin_parent`, `origin_group` | PersonCard lisatekst, PersonsPage filter | tuletatud |

---

## Sisestusreegel doktorandile

> **Päritolukoht** — märgi kõige täpsem geograafiline üksus, mida allikas või uurimistöö võimaldab. See võib olla linn, küla, kogudus, kihelkond, maakond või ajalooline piirkond. Otsi Wikidatast Q-kood, kui võimalik.
>
> Laiemaid piirkondi eraldi ei sisestata. Kui sisestad `Riga`, tuletab süsteem `places.json` hierarhiast, et see kuulub Liivimaa gruppi. Kui teada on ainult `Liivimaa`, sisesta päritolukohaks `Liivimaa`.

Sünnikoht (`birth.place`) ja päritolukoht (`origin.place`) on eri väljad. Päritolukoht ei pruugi olla sünnikoht: see võib olla lähim linn, päritoluküla, kogudus, kihelkond või ainult piirkond.

---

## 1. Konfiguratsioon

### 1a. `data/config/origin_groups.json` — laiendatav grupitaksonoomia

Päritolugrupid ei ole backendis hardcode'itud. Need hoitakse git-tracked JSON failis, mida saab käsitsi muuta ja deploy/restart järel kasutusele võtta.

```json
{
  "Liivimaa": {
    "labels": { "et": "Liivimaa", "en": "Livonia" },
    "sort_order": 10
  },
  "Kuramaa": {
    "labels": { "et": "Kuramaa", "en": "Courland" },
    "sort_order": 20
  },
  "Muud piirkonnad": {
    "labels": { "et": "Muud piirkonnad", "en": "Other regions" },
    "sort_order": 999
  }
}
```

Grupid on kontrollitud taksonoomia: neid lisatakse/muudetakse käsitsi JSON-is, mitte tavakasutaja vormist. See hoiab filtrid stabiilsena, aga jätab taksonoomia laiendatavaks ilma koodimuutuseta.

### 1b. `places.json` — hierarhiline koharegister

Olemasolev `data/config/places.json` (104 kirjet) laiendatakse:

1. **`group`** väli — milline filtrigrupp see koht esindab
2. **`parent_key`** väli juba eksisteerib (nt `"Riga": { "parent_key": "Livland" }`) — kasutatakse grupi transitiivseks tuletamiseks

```json
{
  "Riga": {
    "id": "Q1773",
    "parent_key": "Livland",
    "labels": { "et": "Riia", "en": "Riga", "de": "Riga", "la": "Riga" },
    "historical_names": ["Riga", "Riia"],
    "type": "city"
  },
  "Livland": {
    "id": "Q1757",
    "group": "Liivimaa",
    "parent_key": null,
    "labels": { "et": "Liivimaa", "en": "Livonia", "de": "Livland", "la": "Livonia", "sv": "Livland" },
    "historical_names": ["Livland", "Liivimaa", "Livonia", "Liefland", "Lifland"],
    "type": "historical_region",
    "notes": "Rootsi Liivimaa provints (1629–1710)"
  }
}
```

`group` väärtus peab olema `origin_groups.json` võti. Grupilaabelid ja sorteerimisjärjekord tulevad alati `origin_groups.json` failist.

**Inline lisamine (PlacePicker kaudu):** kui doktorant valib päritolukoha, mida sõnastikus pole, saab selle kohapeal lisada (nimi, Q-kood, tüüp, parent_key, vajadusel grupp). Salvestatakse `PUT /admin/places/{key}` kaudu. Pärast lisamist käivitub sihtotstarbeline propagatsioon (vt jaotis 3f).

**Startup validation:**
- `origin_groups.json` peab olema loetav objekt
- Igal grupil peab olema vähemalt `labels.et`
- `sort_order` peab olema number, kui see on määratud
- Kõigil `places.json` kirjetel millel on `group`, peab see väärtus olema `origin_groups.json` võtmete hulgas
- Kõik `parent_key` viited peavad osutama olemasolevale `places.json` võtmele
- Ringviide parent-ahelas on viga
- Viga → `ValueError` (fail-fast)

---

## 2. Andmemudel — isikukaardi JSON

```json
{
  "origin": {
    "place":        "Riga",
    "place_id":     "Q1773",
    "place_labels": { "et": "Riia", "en": "Riga", "de": "Riga", "la": "Riga" },
    "geonames_id":  null,
    "coordinates":  null
  }
}
```

- `place` on `places.json` võti, mitte vaba kuvatav tekst
- `place_id` ja `place_labels` täidetakse `places.json` kirjest salvestamisel backendis
- Kui vajalikku päritolukohta `places.json`-is pole, tuleb kasutajal see enne salvestamist PlacePickeri inline-lisamisega registrisse lisada
- `origin_group`, laiem piirkond ja parent-labelid **ei salvestu** isikukaardile — need tuletatakse indekseerimisel
- `origin.city`, `origin.city_id`, `origin.city_labels`, `origin.region`, `origin.region_id`, `origin.region_labels` eemaldatakse migratsiooniga

---

## 3. Backend — `server/prosopography/`

### 3a. `_resolve_origin_group(place_id, place_key)` — uus abifunktsioon

Transitiivne tuletamine, max **3 parent-sammu** sügavusele (nt küla → kihelkond → provints → grupp):

```python
MAX_PLACE_PARENT_STEPS = 5

def _walk_to_group(key: Optional[str], places: dict) -> Optional[str]:
    """Järgib parent_key ahelat kuni grupini, max MAX_PLACE_PARENT_STEPS parent-sammu."""
    current = key
    steps = 0
    seen = set()

    while current and steps <= MAX_PLACE_PARENT_STEPS:
        if current in seen:
            return None
        seen.add(current)

        entry = places.get(current)
        if not entry:
            return None
        if entry.get("group"):
            return entry["group"]

        current = entry.get("parent_key")
        steps += 1

    return None

def _resolve_origin_group(
    place_id: Optional[str],
    place_key: Optional[str],
) -> Optional[str]:
    places = _load_places_cache()

    # 1. Q-koodi järgi, kui see on olemas
    if place_id:
        for key, entry in places.items():
            if entry.get("id") == place_id:
                result = _walk_to_group(key, places)
                if result:
                    return result

    # 2. places.json võtme järgi
    if place_key:
        return _walk_to_group(place_key, places)

    return None
```

Cache: `_load_places_cache()` loeb `places.json` mooduli tasemel. Inline lisamise korral cache invaliditakse ja käivitatakse sihtotstarbeline propagatsioon (vt 3f).

### 3b. `_get_parent_place(key)` — abifunktsioon

Tagastab lähima parent-kirje, mida saab PersonCardil kasutada laiema piirkonnana. Kui päritolukoht ise on juba grupiga piirkond (nt `Livland`), parenti ei kuvata.

```python
def _get_parent_place(key: Optional[str]) -> Optional[dict]:
    if not key:
        return None
    places = _load_places_cache()
    entry = places.get(key) or {}
    parent_key = entry.get("parent_key")
    if not parent_key:
        return None
    parent = places.get(parent_key) or {}
    return {
        "key": parent_key,
        "id": parent.get("id"),
        "labels": parent.get("labels"),
        "type": parent.get("type"),
    }
```

### 3c. `_index_entry_from_person()` — lisatakse 5 välja

```python
origin = person.get("origin") or {}
place_key = origin.get("place") or None
place_id = origin.get("place_id") or None
origin_group = _resolve_origin_group(place_id, place_key)
origin_parent = _get_parent_place(place_key)

return {
    ...
    "origin_place":         place_key,
    "origin_place_id":      place_id,
    "origin_place_labels":  _get_place_labels(place_key),
    "origin_parent":        origin_parent,
    "origin_group":         origin_group,
}
```

`origin_parent` on tuletatud indeksiväli, mitte person JSON-i osa. Seda kasutatakse ainult kuvas, nt `Riga · Liivimaa`.

### 3d. `_get_place_labels(key)` — abifunktsioon

```python
def _get_place_labels(key: Optional[str]) -> Optional[dict]:
    if not key:
        return None
    return _load_places_cache().get(key, {}).get("labels")
```

### 3e. Salvestamisel `origin.place*` automaatne normaliseerimine

`update_person()` ja `create_person()` kutsuvad enne salvestamist:

```python
def _enrich_origin_from_places(origin: dict) -> dict:
    place_key = origin.get("place")
    if place_key:
        entry = _load_places_cache().get(place_key)
        if not entry:
            raise ValueError(f"Unknown origin place: {place_key}")
        origin["place_id"] = entry.get("id")
        origin["place_labels"] = entry.get("labels")
    return origin
```

See tagab, et isikukaardi JSON-is olev päritolukoht vastab registrile. Frontend ei pea `place_id` ja `place_labels` välju ise lõplikult usaldusväärseks ehitama.

### 3f. Propagatsioon — reaalajas pärast `places.json` muutmist

`PUT /admin/places/{key}` käivitab pärast salvestamist **sihtotstarbelise propagatsiooni** background task-ina — mitte kogu `rebuild_indices()`, vaid ainult mõjutatud isikud:

```python
async def _propagate_place_change(place_key: str):
    """Uuendab kõigi mõjutatud isikute origin_place*, origin_parent ja origin_group indeksiväljad."""
    places = _load_places_cache(force_reload=True)
    index = _load_prosopo_index()

    affected_keys = _collect_descendants(place_key, places, max_depth=MAX_PLACE_PARENT_STEPS)
    affected_keys.add(place_key)

    for entry in index.get("entries", []):
        if entry.get("origin_place") not in affected_keys:
            continue
        person = _load_person(entry["id"])
        new_entry = _index_entry_from_person(person)
        entry.update(new_entry)

    _save_prosopo_index(index)
```

Kui muutub koha enda `id` või `labels`, tuleb mõjutatud isikufailide `origin.place_id` ja `origin.place_labels` samuti üle kirjutada, sest need väljad on person JSON-is denormaliseeritud mugavusväljad.

Skoop: ~634 isikut, propagatsioon käib ainult muutunud koha perekonnale. Tulemus: doktorant näeb uuendatud gruppi kohe, ilma admini sekkumiseta.

Analoog: `_propagate_name_to_works` teeb sarnast tööd isiku nime muutumisel.

### 3g. `list_persons()` + `get_person_facets()`

```python
# list_persons
if origin_group:
    results = [e for e in results if e.get("origin_group") == origin_group]

# get_person_facets — asendab occupations → origin_groups
{
  "origin_groups": [
    { "value": "Liivimaa", "label_et": "Liivimaa", "label_en": "Livonia", "count": 87 }
  ]
}
```

Sorteering: arvu järgi kahanev. Globaalne (ei arvesta aktiivseid filtreid) — teadlik kompromiss.

### 3h. Uued endpointid

- `GET /places` — **avalik** (nagu `/vocabularies`, `/collections`); tagastab `places.json` kogu sisu PlacePicker'i jaoks
- `GET /places/meta` — **avalik**; tagastab `origin_groups.json` sisu ja lubatud `type` väärtused
- `PUT /admin/places/{key}` — nõuab `editor` rolli; lisab/uuendab kirje + käivitab sihtotstarbelise propagatsiooni; valideerib `type` välja `/places/meta` lubatud väärtuste vastu → `400 Bad Request` kui tundmatu tüüp

---

## 4. PersonEditPage — `src/prosopography/pages/PersonEditPage.tsx`

### Sünnikoht (`birth.place`) jääb eraldi väljaks

- `DateField` sees olev `EntityPicker` jääb sünni- ja surmakoha jaoks
- `birth.place` ei täida enam `origin.place` välja
- Sünnikoha hoiatused puudutavad ainult sünnikohta, mitte päritolu

### Päritolukoht (`origin.place`) — **UUS: `PlacePicker` komponent**

Eraldi komponent `src/prosopography/components/personForm/PlacePicker.tsx` (~140 rida):

- Loeb `GET /places` (avalik — töötab kõigil rollidel)
- Filtreerib `labels` + `historical_names` järgi
- Näitab kõiki geograafilisi tüüpe, mis võivad olla päritolukohad: `city`, `village`, `parish`, `county`, `province`, `territory`, `historical_region`
- Valik tagastab `places.json` võtme; `onChange(key: string | null)`
- Valitud koha tuletatud grupp kuvatakse hall vihjekiri: `"Grupp: Liivimaa"`
- Kui sisestus ei leidu → **"Lisa uus koht"** dropdown-valik → minimaalne inlinemodal:
  - Väljad: nimi (kohustuslik), tüüp (dropdown), grupp (`origin_groups.json` põhine dropdown, valikuline kui on `parent_key`), Wikidata Q-kood (valikuline), parent_key (valikuline)
  - Nõuab `editor` rolli (modal peidetud `contributor`-ile)
  - Kui Q-kood jäetakse tühjaks, kuvatakse kohe allpool sisestusvälja `noQCode` tekst: "Q-kood puudub — kaardil ei kuvata"
  - Salvestatakse `PUT /admin/places/{key}`

---

## 5. PersonCard — `src/prosopography/components/PersonCard.tsx`

Päritolu eluaastate all, `text-xs text-gray-400`:

| Saadaval | Kuvatakse |
|----------|-----------|
| place + parent | `Riga · Liivimaa` (mõlemad aktiivse keele labelitest) |
| ainult place | `Liivimaa` |
| ainult origin_group | `Liivimaa` (group label `origin_groups.json`-ist) |
| puudub | rida ei kuvata |

Kui `origin.place` ise on ajalooline piirkond, ei kuvata sama väärtust dubleeritult parentina.

**Keele fallback `place_labels` ja `origin_parent.labels` kuvamisel:**
`activeLanguage → et → en → esimene kättesaadav väärtus`. Kui ükski ei leidu, kuvatakse `places.json` võti (nt `Riga`).

---

## 6. PersonsPage + PersonAdvancedFilters

- `occupation` URL parameeter → `origin_group`
- `listPersons()` service interface: `occupation?: string` → `origin_group?: string`
- `BulkOccupationModal` jääb (eraldiseisev funktsionaalsus, ei ole filtriga seotud)
- Ikoon: `Briefcase` → `MapPin`; märgis: "Amet" → `t('originGroup')`

---

## 7. Frontend tüübid — `src/prosopography/types.ts`

```typescript
// ProsopoIndexEntry — lisatakse:
origin_place:         string | null;   // places.json võti
origin_place_id:      string | null;
origin_place_labels:  Record<string, string> | null;
origin_parent:        {
  key: string;
  id: string | null;
  labels: Record<string, string> | null;
  type?: string | null;
} | null;
origin_group:         string | null;

// ProsopoRecord.origin — city/region väljade asemel:
origin: {
  place: string | null;
  place_id?: string | null;
  place_labels?: Record<string, string> | null;
  geonames_id: string | null;
  coordinates: string | null;
};

// PlaceEntry (places.json kirje tüüp)
interface PlaceEntry {
  id:               string | null;
  group?:           string | null;
  parent_key?:      string | null;
  labels:           Record<string, string>;
  historical_names?: string[];
  type?:            string;
  notes?:           string;
}
```

---

## 8. Tõlked

```json
"originGroup":    "Päritolu"  /  "Origin"
"originPlace":    "Päritolukoht"  /  "Origin place"
"filterByOrigin": "Filtreeri päritolu järgi"  /  "Filter by origin"
"noQCode":        "Q-kood puudub — kaardil ei kuvata"  /  "No Q-code — won't appear on map"
"addPlace":       "Lisa uus koht"  /  "Add new place"
"placeGroup":     "Grupp: {{group}}"  /  "Group: {{group}}"
```

---

## 9. Testid

### Backend

- `_resolve_origin_group(place_id="Q1773", place_key="Riga")` → `"Liivimaa"` (Riga → Livland parent → Liivimaa)
- `_resolve_origin_group(place_id=None, place_key="Livland")` → `"Liivimaa"` (koht ise on gruppi kandev piirkond)
- `_resolve_origin_group(place_id=None, place_key="TundmatuKoht")` → `None`
- `_resolve_origin_group(place_id=None, place_key=None)` → `None`
- `_enrich_origin_from_places()` täidab `place_id` + `place_labels` `places.json`-ist
- `_enrich_origin_from_places()` kukub läbi, kui `origin.place` ei ole `places.json` võti
- Startup validation kukub läbi kui `group` viitab tundmatule grupile
- Startup validation kukub läbi kui `parent_key` viitab puuduvale võtmele
- Startup validation kukub läbi parent-ahela ringviite korral
- `_index_entry_from_person()` kasutab transiitiivset tuletamist
- `_index_entry_from_person()` lisab `origin_place_labels` ja `origin_parent` indeksisse
- `list_persons(origin_group="Liivimaa")` filtreerib õigesti
- `get_person_facets()` tagastab `origin_groups`, sorteeritud kahanevalt
- `PUT /admin/places/NewKey` lisab kirje + käivitab `_propagate_place_change()`
- `_propagate_place_change("Livland")` uuendab kõik isikud, kelle `origin_place` on `Livland` või Livlandi järeltulija
- `_propagate_place_change("Riga")` uuendab ainult Riga-ga isikuid, mitte kogu indeksit
- `_walk_to_group` peatub pärast `MAX_PLACE_PARENT_STEPS=3` parent-sammu
- `GET /places` ja `GET /places/meta` on avalikud (ei nõua autentimist)

### Frontend

- PersonCard: place + parent → keelestatud labelid `origin_place_labels` ja `origin_parent.labels` väljadest
- PersonCard: ainult place / ainult group / mitte midagi
- PlacePicker näitab linna, küla, koguduse, maakonna ja ajaloolise piirkonna tüüpe
- PlacePicker otsib `labels` + `historical_names` järgi
- "Lisa uus koht" modal peidetud `contributor` rolliga kasutajale
- `birth.place` muutmine ei muuda `origin.place` väärtust
- PersonsPage loeb/kirjutab `origin_group` URL parameetrit
- `listPersons` service kasutab `origin_group` (mitte `occupation`)

---

## Migratsioon

Kuna andmemaht on väike, tehakse mudel puhtaks ja legacy-välju ei jäeta uude skeemi.

0. **Dry-run eelkontroll:** käivita `scripts/migrate_origin_dry_run.py` — prindib kõik `origin.city` ja `origin.region` väärtused, mis pole `places.json` võtmed. Täienda `places.json` ja loo vajalik mapping enne reaalset migratsiooni.
1. Lisa `places.json` kirjetele vajalikud `group`, `parent_key`, `labels`, `type` väärtused.
2. Migreeri isikufailides:
   - kui `origin.city` olemas → `origin.place = origin.city`, `origin.place_id = origin.city_id`, `origin.place_labels = origin.city_labels`
   - kui `origin.city` puudub ja `origin.region` olemas → `origin.place = origin.region`, `origin.place_id = origin.region_id`, `origin.place_labels = origin.region_labels`
   - eemalda `origin.city*` ja `origin.region*` väljad
3. Kui migreeritud `origin.place` ei ole `places.json` võti, lisa vastav koht registrisse või paranda väärtus registrivõtmeks.
4. Uuenda frontend tüübid ja vormiloogika nii, et `birth.place` ja `origin.place` on eraldi.
5. Tee indeks rebuild pärast deploy'd.
6. `?occupation=` URL parameeter asendub `?origin_group=` parameetriga.

---

## Välja jäetud (hilisemaks)

- Kaardivisualisatsioon (`/map`) — `place_id` Q-koodid → koordinaadid Wikidatast
- "Kaardistamata" facet (puuduva `place_id`-ga isikud) — andmekvaliteedi jälgimiseks
- Retrospektiivne rikastamine: päritolukoha tekst → Wikidata Q-kood otsing
- Koordinaatide automaatne rikastamine `places.json` põhjal
