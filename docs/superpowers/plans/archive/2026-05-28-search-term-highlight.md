# Search Term Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kui kasutaja navigeerib `/search` lehelt workspace'i (`/work/{id}/{page}?q=term`), avaneb CM6 otsingupaneel automaatselt otsiterminiga täidetult ja kursor liigub esimesele vastele.

**Architecture:** `?q=` URL-parameeter on juba olemas — `SearchResults.tsx` paneb selle sinna. Workspace.tsx loeb selle `useSearchParams` kaudu ja edastab `TextEditor`-ile propina. TextEditor rakendab pärast teksti laadimist `primeSearch()` + `openSearchPanel()`. `primeSearch` seab moodulitaseme `lastSearchDisplay` muutuja enne paneeli loomist, nii et konstruktor täidab sisendi automaatselt.

**Tech Stack:** React 19, TypeScript, CodeMirror 6 (`@codemirror/search`), React Router v6 (`useSearchParams`), Vitest

---

## Failid

| Fail | Muudatus |
|------|----------|
| `src/components/editor/VuttSearchPanel.ts` | Lisa `primeSearch()` ja `getLastSearchDisplay()` eksport |
| `src/components/TextEditor.tsx` | Lisa `initialSearchTerm` prop + avamisloogika |
| `src/pages/Workspace.tsx` | Loe `?q=` URL-ist, anna edasi TextEditor-ile |
| `src/components/editor/__tests__/VuttSearchPanel.test.ts` | Uus testifail |

---

## Task 1: `primeSearch` funktsioon + unit test

**Failid:**
- Modify: `src/components/editor/VuttSearchPanel.ts:67-68` (moodulitaseme muutujad)
- Create: `src/components/editor/__tests__/VuttSearchPanel.test.ts`

- [ ] **Samm 1: Kirjuta ebaõnnestuv test**

Loo fail `src/components/editor/__tests__/VuttSearchPanel.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { primeSearch, getLastSearchDisplay } from '../VuttSearchPanel';

describe('primeSearch', () => {
  beforeEach(() => {
    primeSearch(''); // reset
  });

  it('seab lastSearchDisplay antud termini peale', () => {
    primeSearch('metaphysica');
    expect(getLastSearchDisplay()).toBe('metaphysica');
  });

  it('tühi string kustutab eelmise väärtuse', () => {
    primeSearch('eelmine');
    primeSearch('');
    expect(getLastSearchDisplay()).toBe('');
  });
});
```

- [ ] **Samm 2: Käivita test, veendu et ebaõnnestub**

```bash
cd /home/mf/LLM/VUTT && npm test -- VuttSearchPanel
```

Oodatav: FAIL — `primeSearch` ja `getLastSearchDisplay` pole eksporditud.

- [ ] **Samm 3: Lisa eksportfunktsioonid `VuttSearchPanel.ts`-i**

Failis `src/components/editor/VuttSearchPanel.ts`, lisa read 68-69 järele (pärast `let lastReplaceDisplay = '';`):

```ts
export function primeSearch(term: string) {
  lastSearchDisplay = term;
}

export function getLastSearchDisplay(): string {
  return lastSearchDisplay;
}
```

- [ ] **Samm 4: Käivita test, veendu et läbib**

```bash
cd /home/mf/LLM/VUTT && npm test -- VuttSearchPanel
```

Oodatav: PASS (2 testi)

- [ ] **Samm 5: Commit**

```bash
git add src/components/editor/VuttSearchPanel.ts src/components/editor/__tests__/VuttSearchPanel.test.ts
git commit -m "feat: ekspordi primeSearch ja getLastSearchDisplay VuttSearchPanel-ist"
```

---

## Task 2: `initialSearchTerm` prop TextEditor-is

**Failid:**
- Modify: `src/components/TextEditor.tsx:23-24` (impordid), `:29-41` (props interface), `:45` (destructuring), `~:220-237` (useEffect([page]))

- [ ] **Samm 1: Lisa import `VuttSearchPanel.ts`-ist**

Failis `src/components/TextEditor.tsx`, rea 24 järele (kus on `import { createVuttSearchPanel }`):

```ts
import { createVuttSearchPanel, primeSearch } from './editor/VuttSearchPanel';
```

(Asenda olemasolev `import { createVuttSearchPanel }` rida.)

- [ ] **Samm 2: Lisa prop `TextEditorProps` interface'i**

Failis `src/components/TextEditor.tsx`, `TextEditorProps` interface'i (rida ~29–41), lisa `triggerSave` järele:

```ts
  initialSearchTerm?: string;
```

- [ ] **Samm 3: Lisa prop destructuring-sse**

Rea ~45 juures, kus on `const TextEditor: React.FC<TextEditorProps> = ({ page, work, onSave, ... triggerSave })`, lisa lõppu:

```ts
const TextEditor: React.FC<TextEditorProps> = ({
  page, work, onSave, onUnsavedChanges, onOpenMetaModal,
  readOnly = false, statusDirty = false, currentStatus, onStatusChange,
  triggerSave, initialSearchTerm = ''
}) => {
```

- [ ] **Samm 4: Lisa `searchAppliedRef` ja kaks useEffect-i**

Leia rida `const { t, i18n } = useTranslation(...)` juures olevad teised ref-deklaratsioonid ja lisa nende lähedale (enne esimest `useEffect`-i):

```ts
const searchAppliedRef = useRef(false);
```

Leia `useEffect` mis algab `useEffect(() => { setStatus(page.status)` (rida ~220). See effect sünkroniseerib lehe andmed. **Lisa selle effect'i sõltuvuste massiivi `initialSearchTerm`** ja lisa lõppu otsingu avamisloogika:

```ts
useEffect(() => {
  setStatus(page.status);
  setComments(page.comments);
  setTextAnnotations(page.text_annotations || []);
  setPageTags(page.page_tags || []);
  setSavedState({ status: page.status, comments: page.comments, page_tags: page.page_tags });
  setIsDirty(false);

  const view = viewRef.current;
  if (view) {
    const currentText = view.state.doc.toString();
    if (currentText !== page.text_content) {
      view.dispatch({
        changes: { from: 0, to: currentText.length, insert: page.text_content || '' },
      });
    }
  }

  // Otsisõna esiletõst: avab otsingu paneeli kui navigeeriti otsingust
  if (initialSearchTerm && !searchAppliedRef.current) {
    const view = viewRef.current;
    const docLength = view?.state.doc.length ?? 0;
    if (view && docLength > 0) {
      searchAppliedRef.current = true;
      primeSearch(initialSearchTerm);
      openSearchPanel(view);
    }
  }
}, [page, initialSearchTerm]);
```

Leia rida kus on `useEffect(() => { searchAppliedRef.current = false; }, [initialSearchTerm])` — seda veel ei ole. Lisa see **enne** eelnevat `useEffect([page, initialSearchTerm])` blokki:

```ts
useEffect(() => {
  searchAppliedRef.current = false;
}, [initialSearchTerm]);
```

- [ ] **Samm 5: Kontrolli TypeScript kompilatsiooni**

```bash
cd /home/mf/LLM/VUTT && npx tsc --noEmit 2>&1 | head -20
```

Oodatav: 0 viga (või ainult pre-existing vead, mitte uued).

- [ ] **Samm 6: Commit**

```bash
git add src/components/TextEditor.tsx
git commit -m "feat: TextEditor aktsepteerib initialSearchTerm propi — avab otsingu automaatselt"
```

---

## Task 3: `Workspace.tsx` loeb `?q=` ja edastab TextEditor-ile

**Failid:**
- Modify: `src/pages/Workspace.tsx:2` (impordid), `~:28-29` (params), `~:TextEditor JSX`

- [ ] **Samm 1: Kontrolli import — `useSearchParams` on juba olemas**

Failis `src/pages/Workspace.tsx` real 2 on juba:

```ts
import { useSearchParams, useLocation } from 'react-router-dom';
```

Midagi muuta pole vaja. Jätka järgmise sammuga.

- [ ] **Samm 2: Loe `?q=` parameeter**

Lisa rea `const { workId, pageNum } = useParams...` järele:

```ts
const [searchParams] = useSearchParams();
const initialSearchTerm = searchParams.get('q') ?? '';
```

- [ ] **Samm 3: Anna `initialSearchTerm` TextEditor-ile**

Leia `<TextEditor` JSX element ja lisa prop:

```tsx
<TextEditor
  page={page}
  work={work}
  onSave={handleSave}
  onUnsavedChanges={setEditorChanges}
  onOpenMetaModal={() => setShowMetaModal(true)}
  readOnly={!user || user.role === 'contributor'}
  statusDirty={statusDirty}
  currentStatus={currentStatus}
  onStatusChange={setCurrentStatus}
  triggerSave={triggerSave}
  initialSearchTerm={initialSearchTerm}
/>
```

(Lisa `initialSearchTerm={initialSearchTerm}` olemasolevate proppide lõppu.)

- [ ] **Samm 4: Kontrolli TypeScript kompilatsiooni**

```bash
cd /home/mf/LLM/VUTT && npx tsc --noEmit 2>&1 | head -20
```

Oodatav: 0 uut viga.

- [ ] **Samm 5: Käivita kõik testid**

```bash
cd /home/mf/LLM/VUTT && npm test
```

Oodatav: kõik testid läbivad, sh `VuttSearchPanel` 2 testi.

- [ ] **Samm 6: Commit**

```bash
git add src/pages/Workspace.tsx
git commit -m "feat: workspace loeb ?q= URL-ist ja edastab TextEditor-ile otsisõna"
```

---

## Task 4: Käsitsi testimine brauseris

- [ ] **Samm 1: Käivita arendusserver**

```bash
cd /home/mf/LLM/VUTT && npm run dev
```

- [ ] **Samm 2: Testi põhivoog**

1. Ava `http://localhost:5173/search`
2. Otsi sõna mis esineb mõnes teoses (nt "auditorio")
3. Klõpsa tulemuse lehele
4. **Oodatav:** CM6 otsingupaneel avaneb automaatselt, väli on täidetud otsisõnaga, kursor on esimesel vastel

- [ ] **Samm 3: Testi diakriitikatolerantsi**

1. Otsi `auditorio` (ilma diakriitikata)
2. Navigeeri lehele kus on `Auctooriô` vms variant
3. **Oodatav:** paneel avaneb "auditorio" terminiga, leiab diakriitilise variandi

- [ ] **Samm 4: Testi et paneel EI avane ilma `?q=`**

1. Ava otse URL `/work/{workId}/{pageNum}` ilma `?q=` parameetrita
2. **Oodatav:** otsingupaneel ei avane

- [ ] **Samm 5: Testi et paneel avaneb ainult üks kord**

1. Navigeeri otsingust lehele `?q=test`
2. Sulge paneel (Escape)
3. Liigu eelmisele/järgmisele lehele tööruum-navigatsiooniga
4. **Oodatav:** paneel ei avane uuesti automaatselt

- [ ] **Samm 6: Testi marginaalias oleva sõna leidmist**

1. Kui teada on teos kus otsisõna on ainult `<m>` tägis, otsi seda
2. **Oodatav:** otsing leiab sõna marginaaliatekstist (kollane taustaga)
