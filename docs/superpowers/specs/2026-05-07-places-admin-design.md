# Kohtade haldur — disainispek

**Kuupäev:** 2026-05-07  
**Staatus:** Kinnitatud struktuur, ootab implementatsiooni

## Probleem

Kohtade register (`places.json`) kasvab sihipäratult: puudub visuaalne ülevaade mis kirjed on sees, kuidas need suhestuvad ja kuidas neid parandada. Tulemus: duplikaadid (nt "Smaland" + "Wexionensis" mis on tegelikult sama piirkonna alla kuuluv kihelkond) ja vigased parent_key seosed.

Praegu: kohti saab lisada (PlacePicker + AddPlaceModal), kuid redigeerimiseks, hierarhia muutmiseks ja duplikaatide ühendamiseks puudub igasugune UI.

## Lahendus

Uus admin leht `/admin/places` kolme alaga: otsingubaar, hierarhiapuu (vasak), detailpaneel (parem).

---

## 1. Navigeerimine

**Admin lehel** (`/admin`) lisatakse uus kaart "Seaded" gruppi, kõrvale "Kollektsioonid" ja "Hooldus" kaartidega:
- Ikoon: `MapPin` (lucide-react)
- Tõlkevõti: `admin:cards.places`
- Href: `/admin/places`

**Lehestruktuuri muster** (sama nagu `Collections.tsx`):
- `min-h-screen bg-gray-50`
- `Header` — `showSearchButton={false}`, `pageTitle` tõlkevõtmest
- `max-w-5xl mx-auto px-4 py-8`
- `Link` tagasi `/admin` — ChevronLeft ikoon
- Sisu: `bg-white rounded-xl border border-gray-200` — täislaius

---

## 2. Lehe struktuur

```
┌─────────────────────────────────────────────────────┐
│  [🔍 Otsi kohanimega, ajaloolise nimega…]  [+ Lisa] │  ← otsingubaar
├──────────────┬──────────────────────────────────────┤
│ Hierarhiapuu │ Detailpaneel                         │
│  260px       │ flex:1                               │
│              │                                      │
│  ▼ Grupp 1  │  [koha detailid / editvorm]          │
│    ▼ Koht A │                                      │
│      › B    │                                      │
│  ▼ Grupp 2  │                                      │
└──────────────┴──────────────────────────────────────┘
```

Minimaalne kõrgus: `calc(100vh - header - back-link)`, overflow-y: auto mõlemas alas.

---

## 3. Otsingubaar

- Tavalise app stiiliga input (mitte `type=number`, vt olemasolevad mustrid)
- Otsib: kõik `labels.*` väärtused, `historical_names[]`, võti (`key`)
- Otsingul asendatakse hierarhiapuu **tasase nimekirjaga** (flat list) — kuvab tüüpi + ülempiirkonda
- Tühjal päringul taastub hierarhiapuu
- "+" nupp avab olemasoleva `AddPlaceModal` (PlacePicker.tsx-ist)

---

## 4. Hierarhiapuu

**Grupeerimine:** origin_groups.json järgi — grupi nimi päisena, all selle grupi kohad. Grupita kohad ("määramata") lõpus.

**Hierarhia:** iga grupi sees kuvatakse parent_key ahelana — ülempiirkonnad laiendatavad (▼/›), vaikimisi lahti kuni 2 taset.

**Iga kirje real:**
- Koha nimi (kuvakeeles, `et → en → esimene olemasolev`)
- Tüübi badge (hall tekst, väike)
- Hoiatusikoon (⚠) kui Q-kood puudub

**Valitud kirje** — `bg-primary-50 text-primary-700` highlight, sama muster nagu mujal rakenduses.

---

## 5. Detailpaneel

Kuvatakse kui puu kirje on valitud. Tühjal valikul: placeholder tekst ("Vali vasakult koht").

### 5a. Päis

```
Wexionensis                    [✏️ Redigeeri] [⤵ Ühenda]
[parish] [🌐 Q18657] [📍 57.18°N 14.59°E] [👥 4 isikut]
```

- **Wikidata link** — avab `https://www.wikidata.org/wiki/{id}` uues tabis (ainult kui `id` on olemas)
- **Koordinaatide link** — avab OpenStreetMap punkti uues tabis: `https://www.openstreetmap.org/?mlat={lat}&mlon={lon}&zoom=10` (ainult kui koordinaadid on olemas)
- Nupud: olemasoleva rakenduse `btn-primary` / `btn-secondary` stiil

### 5b. Minikaart

- **Tingimus:** kuvatakse ainult kui `coordinates.lat` + `coordinates.lon` on olemas
- Leaflet `MapContainer` (react-leaflet) — 120px kõrge, täislaiusega paneelis
- Üks marker koordinaadil, kaart ei ole interaktiivne (scrollWheelZoom=false, dragging=false)
- Sama muster nagu `PersonsMap.tsx` — importida sealt vajalikud stiilid

### 5c. Andmetabel

| Väli | Kuvatav |
|------|---------|
| Labelid | Üks rida keele kohta (et, en, de, la, sv) — ainult olemasolevad |
| Ülempiirkond | Koha nimi lingina (klõps valib selle koha puus) |
| Ajaloolised nimed | Pill-badges (nt "cohaesivi", "ex Smolandia") |
| Grupp | origin_group label |
| Märkused | `notes` väli, plain text |

### 5d. Isikute loend

- Päis: "ISIKUD (N)" — count pärit prosopograafia indeksist
- Nimekiri: isiku nimi + immatrikulatsiooni aasta, maksimaalselt 5 rida
- Kui rohkem: "… ja N rohkem" link → `/persons?origin_place=wexionensis`
- Kui 0: "Sellel kohal isikuid ei ole" — ühendamine on ohutu, kuvatakse hall tekst

---

## 6. Redigeerimise töövoog

"Redigeeri" nupp **asendab detailpaneeli sisu** editvormiga (puu jääb vasakul nähtavaks).

**Editvormi väljad:**

| Väli | Tüüp | Märkus |
|------|------|--------|
| Labelid (et, en, de, la, sv) | text input keel-kaupa | Olemasolevad täidetud, tühjad peidetud vaikimisi (laiendatav) |
| Tüüp | select | `ALLOWED_PLACE_TYPES` väärtused |
| Q-kood | text input, monospace | Valideerib `Q\d+` formaati |
| Ülempiirkond | searchable dropdown | Otsib places registrist, sama loogika nagu AddPlaceModal-is |
| Grupp | select | origin_groups.json väärtused |
| Ajaloolised nimed | tag input | Lisa/kustuta pillid |
| Koordinaadid | kaks text input (lat, lon) | Arv, valideerib vahemikku |
| Märkused | textarea | Vabatekst |

**Salvestamine:** `PUT /admin/places/{key}` (endpointit juba on).  
Salvestamisel propageeritakse muudatus taustana (`_propagate_place_change`) — olemasolev loogika.

**Tühista:** taastab detailvaate muudatusteta.

---

## 7. Ühendamise (merge) töövoog

"Ühenda" nupp avab **modaali**:

1. Seletus: "Ühenda [Wexionensis] teise kohaga — kõik isikud suunatakse ümber, praegune kirje kustutatakse"
2. Otsinguväli — leia sihtkohaks (nt "Smaland")
3. Kinnitusteade enne salvestamist: "N isikut suunatakse ümber kohale [Smaland]"
4. Kinnita → backend teeb:
   - Uuendab kõik isikud kelle `origin.place == vana_key` → `sihtvõti`
   - Lisab vana võti sihtkoha `historical_names` listi (jääb otsitavaks)
   - Kustutab vana kirje places.json-st
   - Uuendab prosopograafia indeksi

**Uus backend endpoint:** `POST /admin/places/{source_key}/merge` — body: `{ "target_key": "smaland" }`

---

## 8. Backend muudatused

| Endpoint | Muudatus |
|----------|----------|
| `GET /prosopography/places` | Olemas |
| `GET /prosopography/places/meta` | Olemas |
| `PUT /admin/places/{key}` | Olemas |
| `POST /admin/places/{source_key}/merge` | **Uus** |

Merge loogika `places_ops.py`-s:
1. Laadi source + target kirjed
2. Uuenda kõik prosopograafia `.json` failid: `origin.place == source_key` → `target_key`
3. Lisa source_key sihtkoha `historical_names`-i
4. Kustuta source_key places.json-st
5. Salvesta, taasta cache, uuenda prosopograafia indeks

---

## 9. Frontend failid

| Fail | Sisu |
|------|------|
| `src/pages/admin/Places.tsx` | Uus leht — lehe struktuur + otsingubaar + state; reusib `AddPlaceModal` (ekstraktida `PlacePicker.tsx`-ist eraldi faili) |
| `src/pages/admin/PlacesTree.tsx` | Hierarhiapuu komponent |
| `src/pages/admin/PlacesDetail.tsx` | Detailpaneel + editvorm |
| `src/pages/admin/PlacesMergeModal.tsx` | Merge modaal |
| `src/pages/Admin.tsx` | +1 kaart "Seaded" gruppi |
| `src/App.tsx` | +1 route `/admin/places` |
| `src/prosopography/services/prosopographyService.ts` | `mergePlaces(sourceKey, targetKey)` funktsioon |
| `src/locales/et/admin.json` | Tõlked: `cards.places`, `places.*` |
| `src/locales/en/admin.json` | Sama inglise keeles |

---

## 10. Väljajätud (praegusest scopist)

- Kaardil piirkondade piirid (ajaloolised piirid puuduvad)
- Drag-and-drop hierarhias (parent muudetakse editvormi kaudu)
- Otselingid prosopograafia lehelt kohtade haldusesse
- Koordinaatide automaatne geokodeerimine (olemasolev Wikidata rikastamine piisab)
