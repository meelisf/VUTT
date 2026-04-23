# Konfessioon massiivväljaks + isiku märksõnad

**Kuupäev:** 2026-04-22  
**Olek:** Mustand

## Eesmärk

1. **`confession` → `confessions[]`** — mõnel isikul on mitu konfessiooni (nt katoliiklane → luterlane). Sama muster nagu `statuses[]`.
2. **Isiku `tags[]` kuvamine** — tags on juba vormi olemas (`TagsList`), aga neid ei kuvata detailvaates ega ole indekseeritud. Teoloogilised voolud (pietism, luterlik ortodoksia jne) lähevad siia.

---

## Osa 1: confessions[]

### Kontrollitud sõnavara

Fikseeritud loend, talletatud `vocabularies.json` sektsioonis `konfessioonid`:

| id (Q-kood) | et | en | Märkus |
|-------------|----|----|--------|
| Q1841 | Katoliiklane | Catholic | Catholicism |
| Q75809 | Luterlane | Lutheran | Lutheranism |
| Q101849 | Reformeeritud | Reformed | Wikidata label on "kalvinism/Calvinismus" — meie label on "reformeeritud" |
| Q60995 | Õigeusklik | Orthodox | Russian Orthodox Church — laiendatav kui tekib kreeka õigeusu isikuid |

Westfaali rahuga (1648) tunnistatud kolm konfessiooni: katoliiklane, luterlane, reformeeritud. Õigeusk lisatud Vene Õigeusu Kiriku kontekstis. Loend on esialgu suletud — uusi väärtusi saab lisada `vocabularies.json`-i muutmisega.

### Andmemudel

```diff
# ProsopoRecord:
- confession: { id: string; label: string } | null
+ confessions: { id: string; label: string }[]

# ProsopoIndexEntry:
- confession_id: string | null
+ confession_ids: string[]
```

### Komponendid ja muudatused

**`vocabularies.json`** — lisa `konfessioonid` sektsioon (sama struktuur nagu `seisused`).

**`scripts/migrate_confession_to_confessions.py`** — sama loogika nagu `migrate_status_to_statuses.py`:
- `confession: {...}` → `confessions: [{...}]`
- `confession: null` / puudub → `confessions: []`
- `confessions` juba olemas → jäta puutumata

**`server/prosopography/ops.py`** (`_index_entry_from_person`):
```python
# vana:
"confession_id": confession_obj.get("id"),
# uus:
"confession_ids": [c["id"] for c in _confessions_list if c.get("id")],
```

**`src/prosopography/types.ts`**:
```typescript
// ProsopoRecord:
confessions: { id: string; label: string }[];
// ProsopoIndexEntry:
confession_ids: string[];
```

**`src/services/collectionService.ts`** — `Vocabularies.konfessioonid?: VocabularySeisusItem[]`

**`src/prosopography/components/personForm/types.ts`** — `FormDraft.confessions: string[]`

**`src/prosopography/components/personForm/helpers.ts`** — sama muster nagu `statuses`.

**`PersonEditPage.tsx`** — asenda `EntityPicker` konfessiooni jaoks checkbox-reaga (sama nagu seisus).

**`PersonDetailPage.tsx`** — kuva `confessions[]` komaga eraldatult.

---

## Osa 2: Isiku tags kuvamine

Tags on juba:
- ✅ `ProsopoRecord.tags?: any[]`
- ✅ `FormDraft.tags: TagDraft[]`
- ✅ `TagsList` komponent PersonEditPage-s (EntityPicker Wikidata-otsinguga)

Puudu:
- ❌ Kuvatakse PersonDetailPage-s
- ❌ Indekseeritud (`ProsopoIndexEntry`-s pole `tags` väljas)
- ❌ Filtreeritav PersonsPage-s (pole prioriteet praegu)

### Vajalikud muudatused

**`PersonDetailPage.tsx`** — kuva tags pärast konfessiooni/seisuse sektsiooni:
```tsx
{(person.tags?.length ?? 0) > 0 && (
  <div>
    <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">
      {t('tags', 'Märksõnad')}
    </span>
    <div className="flex flex-wrap gap-1">
      {person.tags!.map((tag, i) => (
        <span key={i} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
          {getLabel(tag) || tag.label}
        </span>
      ))}
    </div>
  </div>
)}
```

**`server/prosopography/ops.py`** (`_index_entry_from_person`) — lisa tags indeksisse:
```python
tags = person.get("tags") or []
"tag_ids": [t["id"] for t in tags if t.get("id")],
"tag_labels": [t.get("label", "") for t in tags if t.get("label")],
```

**`src/prosopography/types.ts`** (`ProsopoIndexEntry`) — lisa:
```typescript
tag_ids: string[];
tag_labels: string[];
```

> Filtreerimine PersonsPage-s (facetid tags järgi) on tuleviku töö — praegu piisab kuvamisest ja indekseerimisest.

---

## Lahtised küsimused

1. **Kreeka-katoliiklased / uniaat** — lisatakse vajadusel, praegu pole isikuid.
2. **Konfessiooni kuupäev** — läheb elulookirjelduse vabatekstiväljale, struktureeritud salvestamine pole vajalik.
4. **Tags PersonCard-l** — kas kuvada kaardil, või ainult detailvaates? (Soovitus: ainult detailvaates — kaart on juba tihe.)
5. **`ProsopoIndexEntry.tags` tüüp** — praegu pole indeksis, lisamine tähendab indeksi rebuild serveristardil.
