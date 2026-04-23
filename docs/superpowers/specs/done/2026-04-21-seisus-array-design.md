# Seisus — massiivväli prosopograafias

**Kuupäev:** 2026-04-21  
**Olek:** Kinnitatud

## Eesmärk

Praegu saab isikule märkida ühe seisuse (`status: { id, label } | null`). Tegelikkuses võib isikul olla mitu seisust (nt vaimulik + aadel). Muudame `status` → `statuses[]` ja lisame kõigi võimalike väärtuste kontrollitud sõnavara Q-koodidega.

## Kontrollitud sõnavara

Fikseeritud loend, talletatud `vocabularies.json` sektsioonis `seisused`:

| id (Q-kood) | et | en |
|-------------|----|----|
| Q134737 | Aadel | Nobility |
| Q2259532 | Vaimulik | Clergy |
| Q1020994 | Kodanik | Burgher |
| Q152182 | Literaat | Literatus |
| Q47064 | Sõjaväelane | Military personnel |
| Q39631 | Arst | Physician |
| Q838811 | Talupoeg | Peasant |

Loend on esialgu suletud — uusi väärtusi saab lisada `vocabularies.json`-i muutmisega.

## Andmemudel

### ProsopoRecord (isikukaart JSON)

```diff
- status: { id: string; label: string } | null
+ statuses: { id: string; label: string }[]
```

### ProsopoIndexEntry (mälus olev indeks)

```diff
- status_id: string | null
- status_label: string | null
+ status_ids: string[]
```

## Komponendid ja muudatused

### vocabularies.json (serveril `data/config/`)

Lisa uus sektsioon:
```json
"seisused": [
  { "id": "Q134737", "label": { "et": "Aadel", "en": "Nobility" } },
  { "id": "Q2259532", "label": { "et": "Vaimulik", "en": "Clergy" } },
  { "id": "Q1020994", "label": { "et": "Kodanik", "en": "Burgher" } },
  { "id": "Q152182", "label": { "et": "Literaat", "en": "Literatus" } },
  { "id": "Q47064", "label": { "et": "Sõjaväelane", "en": "Military personnel" } },
  { "id": "Q39631", "label": { "et": "Arst", "en": "Physician" } },
  { "id": "Q838811", "label": { "et": "Talupoeg", "en": "Peasant" } }
]
```

### Backend: `server/prosopography/ops.py`

**Indeksi ehitamine** (`_build_index_entry`):
```python
# vana: status_id + status_label
# uus:
statuses = person.get("statuses") or []
entry["status_ids"] = [s["id"] for s in statuses if s.get("id")]
```

**Filter** (`list_persons`):
```python
# status_id parameeter jääb — loogika muutub:
if status_id:
    results = [e for e in results if status_id in (e.get("status_ids") or [])]
```

**Router** — `status_id` query param jääb muutumatuks.

### Backend: migratsiooniskript

Ühekordselt jooksev skript `scripts/migrate_status_to_statuses.py`:
- Loeb kõik `state/prosopography/*.json` failid
- Kui `"status": {...}` olemas ja `"statuses"` puudub: konverteerib `statuses: [status_obj]`
  - Q134737 → `{ "id": "Q134737", "label": "Aadel" }`
  - Muu Q-kood → jäetakse sellisena
- Kirjutab muudetud failid tagasi
- Logib muudetud failide arvu

### Frontend: `src/prosopography/types.ts`

```typescript
// ProsopoRecord:
statuses: { id: string; label: string }[];  // asendab status

// ProsopoIndexEntry:
status_ids: string[];  // asendab status_id + status_label
```

### Frontend: `src/prosopography/components/personForm/helpers.ts`

- `recordToFormDraft`: `p.statuses ?? []` → `draft.statuses: string[]` (Q-koodide massiiv)
- `buildPayload`: `draft.statuses` → `statuses: [{ id: qCode, label: vocabLabel }]`

### Frontend: `src/prosopography/pages/PersonEditPage.tsx`

Asenda `EntityPicker` (seisuse jaoks) checkbox-reaga:
- Loeb `vocabularies.seisused`
- Iga kirje on checkbox
- Mitu saab korraga valida

### Frontend: `src/prosopography/components/PersonCard.tsx`

```typescript
// vana:
person.status_id === 'Q134737'
person.status_label

// uus:
(person.status_ids ?? []).includes('Q134737')   // ShieldPlus ikoon
(person.status_ids ?? []).join(', ')             // tekst (kuvada sildid, mitte Q-koodid)
```

Siltide kuvamiseks tuleb `ProsopoIndexEntry`-sse lisada ka `status_labels: string[]` (et-keelsed sildid), mida indeksi ehitaja täidab vocabulary põhjal.

### Frontend: `src/prosopography/components/PersonAdvancedFilters.tsx`

Asenda aadli toggle button-grupiga — üks nupp iga seisuse jaoks. Üks korraga aktiivne (radio-stiil). Tühi = filter puudub.

### Frontend: `src/prosopography/pages/PersonsPage.tsx`

`statusId` loogika jääb, kuid facet-loend tuleb vocabulary-st.

## Tagasiühilduvus

- Olemasolevad `status: {...}` väljad konverteeritakse migratsiooni käigus
- `rebuild_indices()` serveristardil ehitab indeksi juba uue skeemiga
- Frontend loeb ainult `statuses[]` / `status_ids[]` — vana `status` välja enam ei loe

## Lahtised küsimused

- Kas `PersonDetailPage` seisuse kuvamine vajab disainimuudatust (praegu üks rida, nüüd võib olla mitu)?
- Kas aadeldamise aasta/kuupäev läheb eluloo vabatekstiväljale (nagu kokku lepitud)?
