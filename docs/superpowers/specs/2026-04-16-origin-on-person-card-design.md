# Päritolu isikukaardil ja PersonsPage filtris

**Kuupäev:** 2026-04-16  
**Seis:** Kinnitatud

## Eesmärk

Kuvada isiku päritolu (linn/piirkond) PersonCard-il ning lisada PersonsPage'ile päritolugrupi filter, mis asendab olemasoleva (vähe kasutatud) ameti filtri.

---

## 1. Konfiguratsioon — `data/config/region_groups.json`

Uus konfifail (git-tracked, serveril `data/config/`), mis defineerib:

1. **Grupid** — kasutatavad päritolugrupid nimedega kahes keeles
2. **Mappimine** — `standardized_region` väärtus → grupinimi

```json
{
  "groups": {
    "Liivimaa":              { "et": "Liivimaa",              "en": "Livonia" },
    "Eesti":                 { "et": "Eesti",                  "en": "Estonia" },
    "Ingerimaa":             { "et": "Ingerimaa",              "en": "Ingria" },
    "Soome":                 { "et": "Soome",                  "en": "Finland" },
    "Karjala":               { "et": "Karjala",                "en": "Karelia" },
    "Põhja-Rootsi":          { "et": "Põhja-Rootsi",           "en": "Northern Sweden" },
    "Lõuna-Rootsi":          { "et": "Lõuna-Rootsi",           "en": "Southern Sweden" },
    "Põhja-Saksamaa":        { "et": "Põhja-Saksamaa",         "en": "Northern Germany" },
    "Kesk- ja Lõuna-Saksamaa": { "et": "Kesk- ja Lõuna-Saksamaa", "en": "Central & Southern Germany" },
    "Muud piirkonnad":       { "et": "Muud piirkonnad",        "en": "Other regions" }
  },
  "mappings": {
    "Livland":       "Liivimaa",
    "Kurland":       "Liivimaa",
    "Estland":       "Eesti",
    "Ösel":          "Eesti",
    "Dagö":          "Eesti",
    "Ingermanland":  "Ingerimaa",
    "Finnland":      "Soome",
    "Nyland":        "Soome",
    "Österbotten":   "Soome",
    "Tavastl.":      "Soome",
    "Savo":          "Soome",
    "Karelien":      "Karjala",
    "Uppland":       "Põhja-Rootsi",
    "Södermanland":  "Põhja-Rootsi",
    "Västmanland":   "Põhja-Rootsi",
    "Värmland":      "Põhja-Rootsi",
    "Närke":         "Põhja-Rootsi",
    "Dalarna":       "Põhja-Rootsi",
    "Schweden":      "Põhja-Rootsi",
    "Småland":       "Lõuna-Rootsi",
    "Västergötland": "Lõuna-Rootsi",
    "Östergötland":  "Lõuna-Rootsi",
    "Pommern":       "Põhja-Saksamaa",
    "Brandenburg":   "Põhja-Saksamaa",
    "Ostpreussen":   "Põhja-Saksamaa",
    "Holstein":      "Põhja-Saksamaa",
    "Mecklenburg":   "Põhja-Saksamaa",
    "Sachsen":       "Kesk- ja Lõuna-Saksamaa",
    "Thüringen":     "Kesk- ja Lõuna-Saksamaa",
    "Siebenbürgen":  "Muud piirkonnad"
  }
}
```

Loetakse `_resolve_origin_group()` esimesel kutsel ja hoitakse mälus mooduli tasemel muutujana (`_region_groups_cache`). Kuna fail muutub ainult deploy'ga, ei ole TTL-i vaja.  
Tuntematu region → `None` (grupp puudub).

---

## 2. Backend — `server/prosopography/ops.py`

### 2a. `_index_entry_from_person()` — lisatakse 3 välja

```python
origin = person.get("origin") or {}
origin_city   = origin.get("city") or None
origin_region = origin.get("standardized_region") or origin.get("region") or None
origin_group  = _resolve_origin_group(origin_region)   # uus abifunktsioon

return {
    ...
    "origin_city":   origin_city,
    "origin_region": origin_region,
    "origin_group":  origin_group,
}
```

### 2b. `_resolve_origin_group(region)` — uus abifunktsioon

Loeb `region_groups.json` mappingut (läbi cache) ja tagastab grupinimi või `None`.

### 2c. `list_persons()` — uus `origin_group` filter parameeter

```python
if origin_group:
    results = [e for e in results if e.get("origin_group") == origin_group]
```

### 2d. `get_person_facets()` — asendab `occupations` → `origin_groups`

Tagastab päritoligrupid koos isikute arvuga:
```json
{
  "origin_groups": [
    { "value": "Liivimaa", "label_et": "Liivimaa", "label_en": "Livonia", "count": 87 },
    { "value": "Eesti",    "label_et": "Eesti",     "label_en": "Estonia", "count": 42 },
    ...
  ]
}
```

Sorteering: arvu järgi kahanev.

---

## 3. Frontend tüübid — `src/prosopography/types.ts`

`ProsopoIndexEntry`-le lisatakse:

```typescript
origin_city:   string | null;
origin_region: string | null;
origin_group:  string | null;
```

---

## 4. PersonCard — `src/prosopography/components/PersonCard.tsx`

Päritolu kuvatakse `CardInner`-is eluaastate alla, väikesel eraldi real:

**Loogika (täpsuse järjekorras):**
1. `city` + `region` teada → `Riga · Livland`
2. Ainult `city` → `Riga`
3. Ainult `region` → `Livland`
4. Ainult `origin_group` → `Liivimaa`
5. Kõik puuduvad → ei kuvata rida

**Stiil:** `text-xs text-gray-400` (nagu praegune biograafia snippeti stiil, aga ilma itaaliku ja jutumärkideta)

---

## 5. PersonsPage — `src/prosopography/pages/PersonsPage.tsx`

- `occupation` URL parameeter → `origin_group`
- `setOccupation` → `setOriginGroup`
- `occupationFacets` state → `originGroupFacets`
- `BulkOccupationModal` nupp jääb (on eraldi funktsionaalsus, ei ole seotud filtriga)

---

## 6. PersonAdvancedFilters — `src/prosopography/components/PersonAdvancedFilters.tsx`

- `occupation` prop + `onOccupationChange` → `originGroup` prop + `onOriginGroupChange`
- `occupations` list prop → `originGroups` list prop  
- Ikoon: `Briefcase` → `MapPin` (lucide-react)
- Märgis: "Amet" → `t('originGroup', 'Päritolu')`

---

## 7. Tõlked

`src/locales/et/prosopography.json` ja `src/locales/en/prosopography.json`:

```json
"originGroup": "Päritolu",         // ET
"originGroup": "Origin",           // EN
"filterByOrigin": "Filtreeri päritolu järgi",   // ET
"filterByOrigin": "Filter by origin",            // EN
```

---

## Tagasiühilduvus

- Indeks ehitatakse uuesti `rebuild_indices()` kutsega (käivitatakse serveril käsitsi pärast deploy't)
- Vana `?occupation=` URL parameeter lakkab töötamast (asendatakse `?origin_group=`-ga) — see on ok, kuna ameti filter oli sisseehitatud admin tööriist, mitte kasutajatele suunatud URL

---

## Välja jäetud (hilisemaks)

- Visuaalne grupeerimine sektsioonireadega (variant B)
- Päritolugrupi kuvamine `PersonDetailPage`-l (hetkel on sealt täisandmed juba nähtavad)
- Kaardivisualisatsioon (`/map` leht)
