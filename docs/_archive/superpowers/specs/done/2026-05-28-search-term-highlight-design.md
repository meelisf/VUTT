# Design: Otsisõna automaatne esiletõst Workspace'is

**Kuupäev:** 2026-05-28  
**Staatus:** Kinnitatud

## Probleem

Kasutaja otsib `/search` lehel sõna (nt "metaphysica"), klõpsab tulemuse lehele — navigeerib `/work/{id}/{page}?q=metaphysica`. Workspace avaneb, aga otsisõna ei ole esile tõstetud. Kasutaja peab sõna käsitsi üles leidma, mis on aeganõudev eriti kui sõna asub ainult marginaalias.

`?q=` parameeter on juba praegu URL-is olemas (`SearchResults.tsx:140` paneb selle sinna), aga Workspace ei tarbi seda.

## Lahendus

Kolme faili muudatus: `VuttSearchPanel.ts` + `Workspace.tsx` + `TextEditor.tsx`.

### Andmevoog

```
SearchResults → navigate(`/work/{id}/{page}?q=term`)
  → Workspace.tsx (useSearchParams → q)
    → TextEditor (prop: initialSearchTerm)
      → primeSearch(term) + openSearchPanel(view)
        → VuttSearchPanel.mount() → commit() → setSearchQuery + findNext
```

## Muudatused

### 1. `src/components/editor/VuttSearchPanel.ts`

Lisa üks eksportfunktsioon, mis seab `lastSearchDisplay` enne paneeli avamist:

```ts
export function primeSearch(term: string) {
  lastSearchDisplay = term;
}
```

**Miks see toimib:** `VuttSearchPanel` konstruktor täidab `searchInput.value = lastSearchDisplay`. `mount()` näeb mittetühja väärtuse ja kutsub `Promise.resolve().then(() => this.commit())` — mikrotaskina, pärast CM6 update'i lõppu. `commit()` dispatchib `setSearchQuery` diakriitikatolerantse regexp-musteriga ja CM6 highlight'ib kõik vastemad ning kerib esimesele.

### 2. `src/pages/Workspace.tsx`

```ts
import { useSearchParams } from 'react-router-dom'; // juba imporditud useParams kõrval

const [searchParams] = useSearchParams();
const initialSearchTerm = searchParams.get('q') ?? '';
```

Anna `TextEditor`-ile edasi:
```tsx
<TextEditor
  ...
  initialSearchTerm={initialSearchTerm}
/>
```

### 3. `src/components/TextEditor.tsx`

**Prop lisamine:**
```ts
interface TextEditorProps {
  // ... olemasolevad ...
  initialSearchTerm?: string;
}
```

**Kaks useEffect-i:**

```ts
// Reset flag kui otsisõna muutub (uus navigatsioon)
const searchAppliedRef = useRef(false);
useEffect(() => {
  searchAppliedRef.current = false;
}, [initialSearchTerm]);

// Rakenda otsing pärast teksti laadimist — olemasoleva useEffect([page]) LÕPUS
useEffect(() => {
  // ... olemasolev page sync kood ...

  // Otsisõna esiletõst (pärast doc update'i)
  const view = viewRef.current;
  if (initialSearchTerm && !searchAppliedRef.current && view && view.state.doc.length > 0) {
    searchAppliedRef.current = true;
    primeSearch(initialSearchTerm);
    openSearchPanel(view);
  }
}, [page, initialSearchTerm]);
```

**Import lisada:**
```ts
import { primeSearch } from './editor/VuttSearchPanel';
```

## Miks varasem katse ebaõnnestus

`primeSearch` puudus — `lastSearchDisplay` oli tühi string. Konstruktor täitis `searchInput.value = ''`. `mount()` kontrollib `if (this.searchInput.value)` — tühi string on falsy, seega `commit()` ei käivitunud. Paneel avanes tühjalt.

## Kitsendused ja eeldused

- **Ainult üks avamine per navigatsioon:** `searchAppliedRef` takistab paneeli kordusavamist lehevahetus- või leheuuendusoperatsioonidel samas workspace'i sessioonis.
- **Diakriitikatolerants:** `primeSearch` + `openSearchPanel` kasutab olemasolevat `buildDiacriticPattern` loogikat — "auditorio" leiab "Auctooriô" jne.
- **Marginaalia otsitav:** `text_content` sisaldab `<m>` teksti, seega marginaalias olev sõna (nt "metaphysica") tõstetakse esile nagu muu tekst.
- **Kasutaja saab paneeli sulgeda** tavaliselt (Escape või ✕) ja uuesti avada Ctrl+F.
- **Mobiilivaade:** `WorkspaceMobileView` kasutab `renderVuttMarkup`, mitte CM6 — seal otsisõna esiletõst ei rakendu. See on väljaspool käesoleva disaini skoopi.

## Väljaspool skoopi

- Marginaalia kuvamise muutmine (inline → kõrval/all) — arutati, jäeti praeguse kujuga
- Mobiilivaate otsisõna esiletõst
- Otsitulemuste snippet-i formaadi muutmine (reavahetused, fragmentide pikkus)
