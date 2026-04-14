# TextEditor Modularization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `TextEditor.tsx` from 1071 → ~816 lines by extracting three self-contained units, making room for ~190 lines of upcoming text annotations without the file becoming unmanageable.

**Architecture:** Three extractions in dependency order: (1) pure utility functions → `wrapTagUtils.ts`, (2) special chars state + loading → `useSpecialChars.ts`, (3) Re-OCR state + async logic → `useReOcr.ts`. TextEditor imports and uses all three. No behavior changes.

**Tech Stack:** React 19 hooks, TypeScript, CodeMirror 6 (useReOcr needs `viewRef` to dispatch text replacement), `fetchWithTimeout` + `getAuthHeaders`, `FILE_API_URL` from config.

---

## File Map

| Action | File | Lines removed from TextEditor |
|--------|------|-------------------------------|
| Create | `src/components/editor/wrapTagUtils.ts` | 51 (lines 24–74) |
| Create | `src/components/editor/useSpecialChars.ts` | 43 (lines 76–82, 138–142, 301–327) |
| Create | `src/components/editor/useReOcr.ts` | 161 (lines 123–135, 593–762) |
| Modify | `src/components/TextEditor.tsx` | −255 lines, gains 3 imports |

After: TextEditor ≈ 816 lines.

---

### Task 1: Extract `wrapTagUtils.ts`

**Files:**
- Create: `src/components/editor/wrapTagUtils.ts`
- Modify: `src/components/TextEditor.tsx`

- [ ] **Step 1: Create `wrapTagUtils.ts` with the extracted code**

```typescript
// wrapWithTag abifunktsioonid

export interface TagPair {
  open: number; openEnd: number; close: number; closeEnd: number;
}

/**
 * Leiab, kas antud positsioon asub konkreetse tägi vahel.
 * Otsing on piiratud searchFrom ja searchTo vahemikuga (tavaliselt üks rida).
 */
export function findContainer(tag: string, pos: number, docText: string, searchFrom = 0, searchTo = docText.length): TagPair | null {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;

  // Leiame viimase avava tägi ENNE positsiooni, aga vahemiku piires
  const lastOpen = docText.lastIndexOf(openTag, pos);
  if (lastOpen === -1 || lastOpen < searchFrom) return null;

  // Leiame esimese sulgeva tägi PÄRAST seda avavat tägi
  const firstClose = docText.indexOf(closeTag, lastOpen + openTag.length);
  if (firstClose === -1 || firstClose > searchTo) return null;

  const closeEnd = firstClose + closeTag.length;
  // Kontrollime, kas kursor/valik on tõesti selle paari vahel
  if (pos >= lastOpen && pos <= closeEnd) {
    return { open: lastOpen, openEnd: lastOpen + openTag.length, close: firstClose, closeEnd };
  }
  return null;
}

/**
 * Leiab kõik antud tägi paarid vahemikus [from, to].
 */
export function findInnerPairs(tag: string, from: number, to: number, docText: string): TagPair[] {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const pairs: TagPair[] = [];
  let searchFrom = from;
  while (searchFrom < to) {
    const openIdx = docText.indexOf(openTag, searchFrom);
    if (openIdx === -1 || openIdx >= to) break;
    const closeIdx = docText.indexOf(closeTag, openIdx + openTag.length);
    if (closeIdx === -1 || closeIdx > to) break; // Sulgev täg peab ka jääma vahemikku
    const closeEnd = closeIdx + closeTag.length;
    if (openIdx >= from && closeEnd <= to) {
      pairs.push({ open: openIdx, openEnd: openIdx + openTag.length, close: closeIdx, closeEnd });
    }
    searchFrom = closeEnd;
  }
  return pairs;
}
```

- [ ] **Step 2: In `TextEditor.tsx`, replace lines 24–74 with a single import**

Remove this block (lines 24–74):
```typescript
// --- wrapWithTag abifunktsioonid ---

interface TagPair {
  open: number; openEnd: number; close: number; closeEnd: number;
}
// ... findContainer ... findInnerPairs ...
```

Add import after existing imports (e.g., after line 16 `import { FILE_API_URL } from '../config';`):
```typescript
import { TagPair, findContainer, findInnerPairs } from './editor/wrapTagUtils';
```

- [ ] **Step 3: Build to verify no TypeScript errors**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/wrapTagUtils.ts src/components/TextEditor.tsx
git commit -m "refactor: extract wrapTagUtils from TextEditor"
```

---

### Task 2: Extract `useSpecialChars.ts`

**Files:**
- Create: `src/components/editor/useSpecialChars.ts`
- Modify: `src/components/TextEditor.tsx`

- [ ] **Step 1: Create `useSpecialChars.ts`**

```typescript
import { useState, useEffect } from 'react';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';
import { FILE_API_URL } from '../../config';

export interface SpecialCharacter {
  row?: number;
  character: string;
  name?: string;
  keyboard_code?: number | null;
}

interface UseSpecialCharsReturn {
  specialCharacters: SpecialCharacter[];
  isCustomChars: boolean;
  showCharPanel: boolean;
  setShowCharPanel: (v: boolean) => void;
  showCharEditor: boolean;
  setShowCharEditor: (v: boolean) => void;
  setSpecialCharacters: (chars: SpecialCharacter[]) => void;
  setIsCustomChars: (v: boolean) => void;
}

export function useSpecialChars(authToken: string | null): UseSpecialCharsReturn {
  const [specialCharacters, setSpecialCharacters] = useState<SpecialCharacter[]>([]);
  const [isCustomChars, setIsCustomChars] = useState(false);
  const [showCharPanel, setShowCharPanel] = useState(true);
  const [showCharEditor, setShowCharEditor] = useState(false);

  // Laadime erimärgid
  useEffect(() => {
    const loadSpecialCharacters = async () => {
      try {
        if (authToken) {
          const response = await fetchWithTimeout(`${FILE_API_URL}/user-chars`, { headers: getAuthHeaders(authToken), timeout: 5000 });
          if (response.ok) {
            const data = await response.json();
            if (data.is_custom) {
              setSpecialCharacters(data.characters || []);
              setIsCustomChars(true);
              return;
            }
          }
        }
        const response = await fetchWithTimeout('/special_characters.json', { timeout: 5000 });
        if (response.ok) {
          const data = await response.json();
          setSpecialCharacters(data.characters || []);
          setIsCustomChars(false);
        }
      } catch (e) {
        console.warn('Erimärkide laadimine ebaõnnestus:', e);
      }
    };
    loadSpecialCharacters();
  }, [authToken]);

  return {
    specialCharacters,
    isCustomChars,
    showCharPanel,
    setShowCharPanel,
    showCharEditor,
    setShowCharEditor,
    setSpecialCharacters,
    setIsCustomChars,
  };
}
```

- [ ] **Step 2: Update `TextEditor.tsx` to use the hook**

Remove from TextEditor.tsx:
- The `SpecialCharacter` interface (lines 76–82)
- The special chars state declarations (lines 138–142):
  ```typescript
  const [specialCharacters, setSpecialCharacters] = useState<SpecialCharacter[]>([]);
  const [isCustomChars, setIsCustomChars] = useState(false);
  const [showCharPanel, setShowCharPanel] = useState(true);
  const [showCharEditor, setShowCharEditor] = useState(false);
  ```
- The `loadSpecialCharacters` useEffect (lines 301–327)

Add import:
```typescript
import { useSpecialChars, SpecialCharacter } from './editor/useSpecialChars';
```

Add hook call near top of component body (after `useUser()` call):
```typescript
const {
  specialCharacters,
  isCustomChars,
  showCharPanel,
  setShowCharPanel,
  showCharEditor,
  setShowCharEditor,
  setSpecialCharacters,
  setIsCustomChars,
} = useSpecialChars(authToken);
```

The `toggleCharPanel` function at line 765 stays in TextEditor:
```typescript
const toggleCharPanel = () => setShowCharPanel(!showCharPanel);
```

Note: `showTranscriptionGuide` and `transcriptionGuideHtml` state + the guide loading effect stay in TextEditor (they use `lang`, not `authToken`, and are only ~20 lines).

- [ ] **Step 3: Build to verify no TypeScript errors**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/useSpecialChars.ts src/components/TextEditor.tsx
git commit -m "refactor: extract useSpecialChars hook from TextEditor"
```

---

### Task 3: Extract `useReOcr.ts`

**Files:**
- Create: `src/components/editor/useReOcr.ts`
- Modify: `src/components/TextEditor.tsx`

- [ ] **Step 1: Create `useReOcr.ts`**

```typescript
import { useState, useEffect, useRef, useCallback, MutableRefObject } from 'react';
import { EditorView } from '@codemirror/view';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';
import { FILE_API_URL } from '../../config';
import { Page } from '../../types';

export type ReocrStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

interface UseReOcrProps {
  page: Page;
  authToken: string | null;
  viewRef: MutableRefObject<EditorView | null>;
  setIsDirty: (v: boolean) => void;
}

interface UseReOcrReturn {
  reocrStatus: ReocrStatus;
  reocrText: string | null;
  reocrError: string | null;
  handleReOcr: () => Promise<void>;
  applyReOcr: () => void;
  deleteOcrFile: () => Promise<void>;
}

export function useReOcr({ page, authToken, viewRef, setIsDirty }: UseReOcrProps): UseReOcrReturn {
  const [reocrStatus, setReocrStatus] = useState<ReocrStatus>('idle');
  const [reocrText, setReocrText] = useState<string | null>(null);
  const [reocrError, setReocrError] = useState<string | null>(null);
  const reocrPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lehekülje failinimi (piltide URL-ist) — kasutatakse .ocr faili ja localStorage võtme jaoks
  const pageFilename = page.image_url ? (page.image_url.split('/').pop() ?? null) : null;
  // localStorage võti poolelioleva re-OCR töö job_id säilitamiseks
  const reocrStorageKey = page.work_id && pageFilename
    ? `reocr_job_${page.work_id}_${pageFilename}`
    : null;
  const didCheckStoredJobRef = useRef(false);

  // Poll cleanup
  useEffect(() => {
    return () => {
      if (reocrPollRef.current) clearTimeout(reocrPollRef.current);
    };
  }, []);

  // Mountimisel: kontrolli esmalt .ocr faili (püsiv), siis localStorage (pooleliolev töö)
  useEffect(() => {
    if (didCheckStoredJobRef.current || !authToken || !page.work_id || !pageFilename) return;
    didCheckStoredJobRef.current = true;

    const startPollingFromSaved = (jobId: string) => {
      setReocrStatus('processing');
      const poll = async () => {
        try {
          const pr = await fetchWithTimeout(
            `${FILE_API_URL}/admin/reocr/${jobId}/status`,
            { headers: getAuthHeaders(authToken), timeout: 10000 }
          );
          if (!pr.ok) throw new Error('Polling ebaõnnestus');
          const pd = await pr.json();
          if (pd.status === 'done') {
            setReocrStatus('done');
            setReocrText(pd.text ?? '');
          } else if (pd.status === 'error') {
            setReocrStatus('error');
            setReocrError(pd.error || 'Tundmatu viga');
            if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
          } else if (pd.status === 'not_found') {
            setReocrStatus('idle');
            if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
          } else {
            reocrPollRef.current = setTimeout(poll, 3000);
          }
        } catch {
          reocrPollRef.current = setTimeout(poll, 4000);
        }
      };
      reocrPollRef.current = setTimeout(poll, 1000);
    };

    const checkAll = async () => {
      // 1. Kontrolli .ocr faili (elab serverirestate üle)
      try {
        const res = await fetchWithTimeout(
          `${FILE_API_URL}/admin/work/${page.work_id}/page-ocr?filename=${encodeURIComponent(pageFilename)}`,
          { headers: getAuthHeaders(authToken), timeout: 5000 }
        );
        if (res.ok) {
          const data = await res.json();
          setReocrStatus('done');
          setReocrText(data.text ?? '');
          if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
          return;
        }
      } catch {
        // Ühenduse viga — proovime localStorage
      }

      // 2. .ocr puudub — kontrolli localStorage (pooleliolev töö)
      const savedJobId = reocrStorageKey ? localStorage.getItem(reocrStorageKey) : null;
      if (!savedJobId) return;

      try {
        const pr = await fetchWithTimeout(
          `${FILE_API_URL}/admin/reocr/${savedJobId}/status`,
          { headers: getAuthHeaders(authToken), timeout: 10000 }
        );
        const pd = await pr.json();
        if (pd.status === 'done') {
          setReocrStatus('done');
          setReocrText(pd.text ?? '');
        } else if (pd.status === 'uploading' || pd.status === 'processing') {
          startPollingFromSaved(savedJobId);
        } else {
          if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
        }
      } catch {
        // Eiramine
      }
    };

    checkAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  const handleReOcr = useCallback(async () => {
    if (!pageFilename || !authToken) return;

    if (reocrPollRef.current) clearTimeout(reocrPollRef.current);
    setReocrStatus('uploading');
    setReocrText(null);
    setReocrError(null);

    try {
      const res = await fetchWithTimeout(`${FILE_API_URL}/admin/work/${page.work_id}/reocr-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
        body: JSON.stringify({ page_filename: pageFilename, page_number: page.page_number }),
        timeout: 30000,
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || 'Re-OCR alustamine ebaõnnestus');
      }
      const { job_id } = await res.json();
      if (reocrStorageKey) localStorage.setItem(reocrStorageKey, job_id);
      setReocrStatus('processing');

      const poll = async () => {
        try {
          const pr = await fetchWithTimeout(
            `${FILE_API_URL}/admin/reocr/${job_id}/status`,
            { headers: getAuthHeaders(authToken), timeout: 10000 }
          );
          if (!pr.ok) throw new Error('Polling ebaõnnestus');
          const pd = await pr.json();
          if (pd.status === 'done') {
            setReocrStatus('done');
            setReocrText(pd.text ?? '');
          } else if (pd.status === 'error') {
            setReocrStatus('error');
            setReocrError(pd.error || 'Tundmatu viga');
            if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
          } else {
            reocrPollRef.current = setTimeout(poll, 3000);
          }
        } catch {
          reocrPollRef.current = setTimeout(poll, 4000);
        }
      };
      reocrPollRef.current = setTimeout(poll, 3000);
    } catch (e: any) {
      setReocrStatus('error');
      setReocrError(e.message || 'Viga');
    }
  }, [pageFilename, page.work_id, page.page_number, authToken, reocrStorageKey]);

  const applyReOcr = useCallback(() => {
    if (reocrText !== null) {
      const view = viewRef.current;
      if (view) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: reocrText },
        });
        setIsDirty(true);
      }
    }
    // Kustuta .ocr fail — tulemus on rakendatud
    if (pageFilename && authToken && page.work_id) {
      fetchWithTimeout(
        `${FILE_API_URL}/admin/work/${page.work_id}/page-ocr?filename=${encodeURIComponent(pageFilename)}`,
        { method: 'DELETE', headers: getAuthHeaders(authToken), timeout: 5000 }
      ).catch(() => {});
    }
    if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
    setReocrStatus('idle');
    setReocrText(null);
  }, [reocrText, reocrStorageKey, pageFilename, authToken, page.work_id, viewRef, setIsDirty]);

  const deleteOcrFile = useCallback(async () => {
    if (!pageFilename || !authToken || !page.work_id) return;
    await fetchWithTimeout(
      `${FILE_API_URL}/admin/work/${page.work_id}/page-ocr?filename=${encodeURIComponent(pageFilename)}`,
      { method: 'DELETE', headers: getAuthHeaders(authToken), timeout: 5000 }
    ).catch(() => {});
    if (reocrStorageKey) localStorage.removeItem(reocrStorageKey);
    setReocrStatus('idle');
    setReocrText(null);
  }, [pageFilename, authToken, page.work_id, reocrStorageKey]);

  return { reocrStatus, reocrText, reocrError, handleReOcr, applyReOcr, deleteOcrFile };
}
```

- [ ] **Step 2: Update `TextEditor.tsx` to use the hook**

Remove from TextEditor.tsx:
- `ReocrStatus` type declaration (line 124)
- Re-OCR state declarations (lines 125–135): `reocrStatus`, `reocrText`, `reocrError`, `reocrPollRef`, `pageFilename`, `reocrStorageKey`, `didCheckStoredJobRef`
- Poll cleanup `useEffect` (lines 593–597)
- `checkAll`/`startPollingFromSaved` `useEffect` (lines 599–677)
- `handleReOcr` `useCallback` (lines 679–729)
- `applyReOcr` `useCallback` (lines 731–751)
- `deleteOcrFile` `useCallback` (lines 753–762)

Add import:
```typescript
import { useReOcr, ReocrStatus } from './editor/useReOcr';
```

Add hook call near top of component body (after `useSpecialChars` call):
```typescript
const { reocrStatus, reocrText, reocrError, handleReOcr, applyReOcr, deleteOcrFile } = useReOcr({
  page,
  authToken,
  viewRef,
  setIsDirty,
});
```

Note: `ReocrStatus` is re-exported from `useReOcr.ts` so HistoryTab prop type still works:
```tsx
// In TextEditor.tsx JSX — no change needed:
handleReOcr={handleReOcr}
reocrStatus={reocrStatus}
```

- [ ] **Step 3: Build to verify no TypeScript errors**

Run: `npm run build`
Expected: Build succeeds with no errors. TextEditor.tsx now ~816 lines.

- [ ] **Step 4: Quick manual smoke test**

Open Workspace, go to any page:
- Editor loads and shows text
- Special characters panel shows
- Re-OCR button in History tab is visible
- No console errors

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/useReOcr.ts src/components/TextEditor.tsx
git commit -m "refactor: extract useReOcr hook from TextEditor"
```

---

## Self-Review

**Spec coverage:**
- ✅ Task 1: `TagPair`, `findContainer`, `findInnerPairs` extracted to `wrapTagUtils.ts`
- ✅ Task 2: `SpecialCharacter` + special chars state + load effect → `useSpecialChars.ts`
- ✅ Task 3: `ReocrStatus` + all Re-OCR state/logic → `useReOcr.ts`
- ✅ No behavior changes — pure refactor
- ✅ `showTranscriptionGuide`/`transcriptionGuideHtml` intentionally left in TextEditor (use `lang`, not `authToken`)
- ✅ `toggleCharPanel` stays in TextEditor (one-liner, depends on `setShowCharPanel` from hook)

**Type consistency:**
- `TagPair` exported from `wrapTagUtils.ts`, imported in `TextEditor.tsx` — consistent
- `SpecialCharacter` exported from `useSpecialChars.ts`, used in `CharSetEditor` call site — consistent
- `ReocrStatus` exported from `useReOcr.ts`, `HistoryTab` receives `reocrStatus: ReocrStatus` — consistent

**No placeholders:** All code blocks contain the complete, exact code to copy.
