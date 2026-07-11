# Person-as-Subject Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SearchPage filter sidebar shows VUTT persons (e.g. Karl XII) as a text-input autocomplete field — not mixed into the concept tags dropdown.

**Architecture:** Concept tags (Wikidata Q-codes) remain in the existing multi-select dropdown. VUTT persons (`vutt:P*` IDs) get a separate text-input with autocomplete suggestions, storing the selected person ID in a new URL param `subjectPerson`. The backend filter maps `subjectPerson` → `tags_ids = "vutt:Pxxxxx"`.

**Tech Stack:** React 19, TypeScript, React Router v6 (useSearchParams), Meilisearch (no schema changes needed — `tags_ids` already indexes both Q-codes and `vutt:P*` IDs)

---

## Background

`tags_ids` in Meilisearch contains both Wikidata Q-codes (concepts) and `vutt:P*` IDs (persons). The existing `AdvancedFilters` dropdown mixes both — showing `vutt:Pxxxxxx` codes alongside readable concept labels. This plan separates them.

Key existing utilities:
- `src/utils/qcodeUtils.ts` — `isVuttId(id)` already detects `vutt:P*` IDs
- `src/pages/search/hooks/useQCodeMaps.ts` — builds `tagsIdMap` (id→label) from search results
- `src/components/AdvancedFilters.tsx` — concept tags dropdown, receives `tagsIdMap`
- `src/pages/search/SearchFilters.tsx` — full filter sidebar; author input is the UX model to follow
- `src/pages/search/hooks/useFilterDraft.ts` — draft state for selected filters
- `src/pages/search/hooks/useSearchUrlParams.ts` — parses URL params
- `src/services/searchService.ts` — builds Meilisearch filter strings

## File Map

| File | Change |
|------|--------|
| `src/pages/search/hooks/useQCodeMaps.ts` | Export `availablePersonTags: {id, label}[]` alongside existing maps |
| `src/pages/search/hooks/useSearchUrlParams.ts` | Add `subjectPerson: string` URL param |
| `src/pages/search/hooks/useFilterDraft.ts` | Add `subjectPerson`, `subjectPersonInput`, `showPersonSuggestions` state + handlers |
| `src/services/searchService.ts` | Add `subjectPerson?: string` to `SearchOptions`; add filter clause |
| `src/components/AdvancedFilters.tsx` | Exclude `vutt:P*` items from concept tags list |
| `src/pages/search/SearchFilters.tsx` | Add person-subject text input with autocomplete |
| `src/pages/SearchPage.tsx` | Wire new props from hooks to SearchFilters |

No backend changes. No Meilisearch schema changes. No new files.

---

## Task 1: Export `availablePersonTags` from `useQCodeMaps`

**Files:**
- Modify: `src/pages/search/hooks/useQCodeMaps.ts`
- Test: `src/pages/search/hooks/__tests__/useQCodeMaps.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/pages/search/hooks/__tests__/useQCodeMaps.test.ts`:

```typescript
import { isVuttId } from '../../../utils/qcodeUtils';

// Testime isVuttId eraldi — see on availablePersonTags alus
describe('isVuttId', () => {
  it('tuvastab vutt:P prefixiga ID', () => {
    expect(isVuttId('vutt:Pabc123')).toBe(true);
    expect(isVuttId('vutt:Pxmnuan')).toBe(true);
  });
  it('ei tunne ära Q-koode', () => {
    expect(isVuttId('Q12345')).toBe(false);
    expect(isVuttId('vutt:Wabc')).toBe(false);
    expect(isVuttId('')).toBe(false);
  });
});

// availablePersonTags filter logic (puhas funktsioon, eraldame testimiseks)
import { filterPersonTags } from '../useQCodeMaps';

describe('filterPersonTags', () => {
  const tagsIdMap = {
    'Q151616': 'Põhjasõda',
    'vutt:Pxmnuan': 'Karl XII',
    'vutt:P1pz2xc': 'Mõni isik',
    'Q413': 'Füüsika',
  };

  it('tagastab ainult vutt:P isikud', () => {
    const result = filterPersonTags(tagsIdMap);
    expect(result).toEqual([
      { id: 'vutt:P1pz2xc', label: 'Mõni isik' },
      { id: 'vutt:Pxmnuan', label: 'Karl XII' },
    ]);
  });

  it('tagastab tühja massiivi kui isikuid pole', () => {
    expect(filterPersonTags({ 'Q413': 'Füüsika' })).toEqual([]);
  });

  it('tagastab tühja massiivi tühja kaardi korral', () => {
    expect(filterPersonTags({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/mf/LLM/VUTT && npx vitest run src/pages/search/hooks/__tests__/useQCodeMaps.test.ts
```

Expected: FAIL — `filterPersonTags` not exported

- [ ] **Step 3: Implement `filterPersonTags` and export `availablePersonTags`**

In `src/pages/search/hooks/useQCodeMaps.ts`, add after the existing imports:

```typescript
import { isVuttId } from '../../../utils/qcodeUtils';
```

Add this exported pure function (before the hook):

```typescript
/** Eraldab tagsIdMap-ist VUTT isikud ({id, label}[], sorditud label järgi). */
export function filterPersonTags(tagsIdMap: Record<string, string>): { id: string; label: string }[] {
    return Object.entries(tagsIdMap)
        .filter(([id]) => isVuttId(id))
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label, 'et'));
}
```

In the `useQCodeMaps` hook return statement, add `availablePersonTags`:

```typescript
// Leia hook return statement (tagastab tagsIdMap, tagsLabelToId jne) ja lisa:
availablePersonTags: useMemo(() => filterPersonTags(tagsIdMap), [tagsIdMap]),
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/pages/search/hooks/__tests__/useQCodeMaps.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/search/hooks/useQCodeMaps.ts src/pages/search/hooks/__tests__/useQCodeMaps.test.ts
git commit -m "feat: filterPersonTags eraldab VUTT isikud tagsIdMap-ist"
```

---

## Task 2: Add `subjectPerson` URL param

**Files:**
- Modify: `src/pages/search/hooks/useSearchUrlParams.ts`

- [ ] **Step 1: Add `subjectPerson` to the return type and parsing**

In `useSearchUrlParams.ts`, the hook returns an object with `author`, `teoseTags` jne. Add `subjectPerson`:

```typescript
// Lisa return type'i:
subjectPerson: string;

// Lisa parsing (koos teiste searchParams.get() kutsutega):
subjectPerson: searchParams.get('subjectPerson') || '',
```

- [ ] **Step 2: Verify TypeScript kompileerub**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -10
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/pages/search/hooks/useSearchUrlParams.ts
git commit -m "feat: lisa subjectPerson URL param isiku-teema filtrile"
```

---

## Task 3: Add `subjectPerson` state to `useFilterDraft`

**Files:**
- Modify: `src/pages/search/hooks/useFilterDraft.ts`

- [ ] **Step 1: Vaata olemasolevat autor-loogika mustrit**

Failis on juba `authorInput`, `selectedAuthor`, `showAuthorSuggestions` state koos handleritega. Kopeeri sama muster isikule.

- [ ] **Step 2: Lisa state ja handlers**

```typescript
// Lisa state (koos teiste useState kutsutega):
const [selectedPersonTag, setSelectedPersonTag] = useState(urlParams.subjectPerson);
const [personTagInput, setPersonTagInput] = useState(urlParams.subjectPerson);
const [showPersonSuggestions, setShowPersonSuggestions] = useState(false);

// Sünkroniseeri URL muutusega (koos teiste urlParams efektidega):
// Leia useEffect kus setSelectedAuthor(urlParams.author) — lisa samasse:
setSelectedPersonTag(urlParams.subjectPerson);
setPersonTagInput(urlParams.subjectPerson);

// Lisa URL kirjutamisse (koos teiste prev.set kutsutega applyFilters sees):
if (selectedPersonTag) prev.set('subjectPerson', selectedPersonTag);
else prev.delete('subjectPerson');

// Lisa ka clearFilters kustutustesse:
prev.delete('subjectPerson');

// Lisa handlerid:
const handlePersonTagSelect = (personId: string, label: string) => {
    setPersonTagInput(label);
    setSelectedPersonTag(personId);
    setShowPersonSuggestions(false);
    setSearchParams(prev => { prev.set('subjectPerson', personId); prev.set('p', '1'); return prev; });
};

const handlePersonTagClear = () => {
    setPersonTagInput('');
    setSelectedPersonTag('');
    setShowPersonSuggestions(false);
    setSearchParams(prev => { prev.delete('subjectPerson'); prev.set('p', '1'); return prev; });
};
```

- [ ] **Step 3: Lisa uued väljad return objekti**

```typescript
// Lisa hook return objekti:
selectedPersonTag,
personTagInput,
showPersonSuggestions,
setPersonTagInput,
setShowPersonSuggestions,
handlePersonTagSelect,
handlePersonTagClear,
```

- [ ] **Step 4: Verify TypeScript kompileerub**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -10
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/pages/search/hooks/useFilterDraft.ts
git commit -m "feat: lisa subjectPerson state ja handlerid useFilterDraft hookis"
```

---

## Task 4: Add `subjectPerson` to `searchService.ts` filter

**Files:**
- Modify: `src/services/searchService.ts`
- Test: kontrolli käsitsi järgmises taskes

- [ ] **Step 1: Lisa `subjectPerson` `SearchOptions` tüüpi**

```typescript
// Leia SearchOptions interface (faili alguses) ja lisa:
subjectPerson?: string;  // VUTT isiku ID (vutt:Pxxxxxx) teema-filtrina
```

- [ ] **Step 2: Lisa filter klausel**

Failis on mitu kohta kus filter-massiiv ehitatakse üles. Otsi `options.author` kasutusi — iga filter.push koos authoriga on filter-ehituskoht. Lisa samasse blokki:

```typescript
if (options.subjectPerson) {
    filter.push(`tags_ids = "${options.subjectPerson}"`);
}
```

NB: `tags_ids` on filtreeritav väli Meilisearchi skeemis — sama mida `teoseTags` filter kasutab.

- [ ] **Step 3: Verify TypeScript kompileerub**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -10
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/services/searchService.ts
git commit -m "feat: lisa subjectPerson filter searchService'i (tags_ids filter)"
```

---

## Task 5: Exclude person tags from `AdvancedFilters` concept list

**Files:**
- Modify: `src/components/AdvancedFilters.tsx`

- [ ] **Step 1: Lisa import**

```typescript
import { isVuttId } from '../utils/qcodeUtils';
```

- [ ] **Step 2: Filtreeri person tagid concept listist välja**

Leia `tagItems` useMemo (otsib `facets?.['tags_ids']` ja ehitab `raw` massiivi). Lisa filter:

```typescript
// Kood mis ehitab raw massiivi (praegu umbes):
const raw = Object.entries(tagsData).map(([tag, count]) => ({
    value: tag,
    label: tagsIdMap?.[tag] || tag,
    count,
}));

// Muuda: filtreeri välja vutt: prefiksiga ID-d
const raw = Object.entries(tagsData)
    .filter(([tag]) => !isVuttId(tag))
    .map(([tag, count]) => ({
        value: tag,
        label: tagsIdMap?.[tag] || tag,
        count,
    }));
```

- [ ] **Step 3: Verify TypeScript kompileerub**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -10
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/components/AdvancedFilters.tsx
git commit -m "feat: eemalda VUTT isikud concept-tagide dropdownist"
```

---

## Task 6: Wire `availablePersonTags` through `SearchPage` to `SearchFilters`

**Files:**
- Modify: `src/pages/SearchPage.tsx`
- Modify: `src/pages/search/SearchFilters.tsx`

- [ ] **Step 1: Leia kus `useQCodeMaps` tagastus lahutatakse SearchPage-is**

```typescript
// SearchPage.tsx-is on umbes:
const { tagsIdMap, tagsLabelToId, ... } = useQCodeMaps(...);
// Lisa destruktureerimine:
const { tagsIdMap, tagsLabelToId, availablePersonTags, ... } = useQCodeMaps(...);
```

- [ ] **Step 2: Lisa `availablePersonTags` SearchFilters props tüüpi**

`SearchFilters.tsx`-is leia props tüüp (interface SearchFiltersProps vms) ja lisa:

```typescript
availablePersonTags: { id: string; label: string }[];
selectedPersonTag: string;
personTagInput: string;
showPersonSuggestions: boolean;
onPersonTagInputChange: (value: string) => void;
onPersonTagSelect: (id: string, label: string) => void;
onPersonTagClear: () => void;
onShowPersonSuggestions: (show: boolean) => void;
```

- [ ] **Step 3: Edasta props SearchPage → SearchFilters**

```typescript
// SearchPage.tsx render (kus <SearchFilters .../> on):
<SearchFilters
  ...olemasolevad props...
  availablePersonTags={availablePersonTags}
  selectedPersonTag={draft.selectedPersonTag}
  personTagInput={draft.personTagInput}
  showPersonSuggestions={draft.showPersonSuggestions}
  onPersonTagInputChange={actions.setPersonTagInput}
  onPersonTagSelect={actions.handlePersonTagSelect}
  onPersonTagClear={actions.handlePersonTagClear}
  onShowPersonSuggestions={actions.setShowPersonSuggestions}
/>
```

- [ ] **Step 4: Edasta `subjectPerson` searchService kutsesse**

SearchPage-is on koht kus kutsutakse searchService funktsioone — leia kus `author` edistatakse options objektis:

```typescript
// Lisa subjectPerson:
subjectPerson: urlParams.subjectPerson || undefined,
```

- [ ] **Step 5: Verify TypeScript kompileerub**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -10
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/pages/SearchPage.tsx src/pages/search/SearchFilters.tsx
git commit -m "feat: edasta availablePersonTags ja subjectPerson SearchFilters-ni"
```

---

## Task 7: Add person subject input UI to `SearchFilters`

**Files:**
- Modify: `src/pages/search/SearchFilters.tsx`

- [ ] **Step 1: Lisa person-teema sisestusväli**

Leia failis autori sisestusvälja blokk (otsida `filters.author` või `authorInputRef`). Lisa sarnane blokk vahetult pärast autorite blokki:

```tsx
{/* Isik teemana */}
<div className="mb-4">
  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
    {t('filters.personSubject', 'Isik teemana')}
  </h4>
  <div className="relative">
    <input
      type="text"
      value={personTagInput}
      onChange={e => {
        onPersonTagInputChange(e.target.value);
        onShowPersonSuggestions(true);
      }}
      onFocus={() => onShowPersonSuggestions(true)}
      onBlur={() => setTimeout(() => onShowPersonSuggestions(false), 150)}
      onKeyDown={e => {
        if (e.key === 'Escape') { onShowPersonSuggestions(false); }
        if (e.key === 'Enter' && personTagInput.trim()) {
          const match = availablePersonTags.find(p =>
            p.label.toLowerCase() === personTagInput.toLowerCase()
          );
          if (match) onPersonTagSelect(match.id, match.label);
        }
      }}
      placeholder={t('filters.personSubjectPlaceholder', 'Otsi isikut...')}
      className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-500"
    />
    {selectedPersonTag && (
      <button
        onClick={onPersonTagClear}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        title={t('filters.clear', 'Tühista')}
      >
        ×
      </button>
    )}
    {showPersonSuggestions && personTagInput.length >= 2 && (() => {
      const matches = availablePersonTags.filter(p =>
        p.label.toLowerCase().includes(personTagInput.toLowerCase())
      );
      if (matches.length === 0) return null;
      return (
        <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-y-auto">
          {matches.map(({ id, label }) => (
            <button
              key={id}
              onMouseDown={() => onPersonTagSelect(id, label)}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-primary-50 hover:text-primary-700"
            >
              {label}
            </button>
          ))}
        </div>
      );
    })()}
  </div>
</div>
```

- [ ] **Step 2: Verify TypeScript kompileerub**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -10
```

Expected: no errors

- [ ] **Step 3: Lisa tõlkevõtmed**

`src/locales/et/search.json` (või vastav namespace):
```json
"personSubject": "Isik teemana",
"personSubjectPlaceholder": "Otsi isikut..."
```

`src/locales/en/search.json`:
```json
"personSubject": "Person as subject",
"personSubjectPlaceholder": "Search person..."
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/search/SearchFilters.tsx src/locales/et/*.json src/locales/en/*.json
git commit -m "feat: lisa isiku-teema otsingusisestus SearchFilters sidebarisse"
```

---

## Task 8: Final build and deploy

- [ ] **Step 1: Full build**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in X.Xs` ilma TypeScript vigadeta

- [ ] **Step 2: Käsitsi test**

1. Ava SearchPage inglise keeles
2. Sisesta "Karl" isiku-teema välja — peaks pakkuma "Karl XII"
3. Vali "Karl XII" — URL peab sisaldama `subjectPerson=vutt%3APxmnuan`
4. Tulemused peavad filtreerima ainult teosed kus Karl XII on tag
5. Concept-tagide dropdown EI TOHI näidata `vutt:P*` ID-sid
6. Filtri tühjendamine eemaldab `subjectPerson` URL-ist

- [ ] **Step 3: Deploy**

```bash
rsync -avz dist/ vutt:~/VUTT/dist/
```

- [ ] **Step 4: Final commit (kui midagi parandati)**

```bash
git add -A && git commit -m "fix: parandused pärast käsitsi testimist"
```
