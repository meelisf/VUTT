# Tekst-annotatsioonid (highlight + kommentaar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Võimalda toimetajatel märkida (highlight) konkreetseid tekstilõike ja kirjutada neile kommentaare, mis on visuaalselt nähtavad CodeMirrori editoris ja otsitavad `scope=annotation` otsingus.

**Architecture:** Teksti ankurdamine `<ann1>tekst</ann1>` inline-tägidega (number-sufiks = ankru ID). Kommentaar elab lehekülje `.json`-is `text_annotations: [{id, comment, author, created_at}]` massiivis — see on **kommentaari metaandmete source of truth**. `<annN>` tägid tekstis on **ainult ankrud**, mitte andmete kandja. Meilisearchi lisatakse `text_annotations_text` otsinguväli ja `has_annotations` laajeneb `text_annotations`-i arvestama. Hover tooltip tekib React state-ga (`mouseover`/`mouseout`), mitte CM6 tooltip-paketiga. Kustutamisel eemaldatakse nii ankur tekstist kui kirje massiivist ühes operatsioonis.

**MVP kompromissid (teadlikud):**
- Inline-ankurdamine seob annotatsiooni teksti konkreetse stringikujuga. Sama paradigma kehtib kogu ülejäänud VUTT märgendusele (`<i>`, `<m>`, jne). Tuleviku sidebar-vaade töötab sama andmemudeli peal.
- `nextAnnId()` (max+1) eeldab ühe kasutaja korraga toimetamist — sama eeldus mis ülejäänud salvestussüsteemil.
- Annotatsioonid **ei tohi kattuda ega pesastuda** — insert-loogika blokeerib kattumise, aga ristumist teiste VUTT-tägidega ei valideerita.

**Konsistentsi mudel:** salvestamisel logitakse hoiatus kui teksti `<annN>` tägid ja `text_annotations` massiivi ID-d ei klapi.

**Tech Stack:** FastAPI (Python 3.9), React 19 + TypeScript, CodeMirror 6 (`@codemirror/view`, `@codemirror/state`), Tailwind, Vitest, Meilisearch

---

## Koodibaasi seisu kontrollitud faktid (järgmise sessiooni jaoks)

Enne implementeerimist verifitseeritud — ära korda neid kontrollid:

**`src/types.ts`** — `text_annotations` välja POLE `Page` interface'is. Lisa Task 2-s.

**`src/components/TextEditor.tsx` (1071 rida):**
- `savedState` on `{status, comments, page_tags}` (rida 146). `textAnnotations` EI pea sinna lisama — tekst-annotatsiooni muutused salvestatakse alati kohe (immediate save), teksti muutused (insert/delete `<annN>` tägid) käivitavad `isDirty` läbi CM6 `update.docChanged`.
- Page-vahetus `useEffect` on rida 265. Lisa sinna `setTextAnnotations(page.text_annotations || [])`.
- CM6 on loodud `useEffect`-is mis kasutab `editorContainerRef.current` (rida 191+). Hover listeners tuleb lisada `editorContainerRef.current` peale (mitte `viewRef.current?.dom` — CM6 DOM saab kättesaadavaks pärast mount'i ja ref ei triggeri re-rendrit). Samas `useEffect`-is või eraldi effect-is mis ei sõltu `viewRef.current`-ist.
- `AnnotationsTab` renderdatakse rida 1029. Props loetelus: `work, page, page_tags, setPageTags, comments, setComments, onSaveAnnotations, readOnly, user, authToken, onOpenMetaModal, lang`.

**`handleDeleteAndSaveTextAnnotation` disain:**
`removeAnnotationFromEditor(annId)` dispatch on CM6-s sünkroonne → `viewRef.current?.state.doc.toString()` tagastab KOHE uuendatud teksti (ilma `<annN>` tägideta). `removeAnnTags()` kutsumine on REDUNDANTNE ja `await import(...)` plaanis on viga — kasuta state import + `removeAnnotationFromEditor` järel saadud teksti otse.

**`src/locales/et/workspace.json`:**
- Rida 13: `"annotations": "Annotatsioonid"` on `tabs` objekti SEES (`tabs.annotations`), ei konflikteeru uue root-tasandi `annotations` objektiga.
- `editor.tooltips` sektsioon algab rida 247 — `annotate` võti puudub, lisa sinna.
- `common:buttons.edit` = "Muuda" ✓ ja `common:buttons.remove` = "Eemalda" ✓ — olemas.

**`server/meilisearch_ops.py`:**
- `page_meta` dict on rida ~403 — `'text_annotations': []` peab olema `'comments': []` kõrval.
- `source.get('text_annotations', [])` lugemine tuleb `source.get('comments', [])` kõrvale (~rida 418).
- `"has_annotations"` on rida ~487.
- Järjekord oluline: `page_meta.get('text_annotations')` tuleb kasutada PÄRAST `page_meta` lugemist (rida 418+), mitte metadata.get()-st.

---

## Fail-struktuur

| Fail | Muutus |
|------|--------|
| `src/types.ts` | Lisa `TextAnnotation` interface, `text_annotations` → `Page` |
| `src/services/pageService.ts` | Lisa `text_annotations` save/load + konsistentsikontroll |
| `src/utils/annUtils.ts` | **Uus** — `nextAnnId()`, `extractHighlightedText()`, `removeAnnTags()`, `containsAnnTag()`, `findAnnIdsInText()` |
| `src/utils/__tests__/annUtils.test.ts` | **Uus** — TDD testid |
| `src/components/editor/VuttMarkupExtension.ts` | Lisa `ann` täg + `withId` tugi (`data-ann-id` atribuut) |
| `src/components/editor/VuttTheme.ts` | Lisa `.vutt-ann` CSS (kollane highlight) |
| `src/components/TextEditor.tsx` | `text_annotations` state, toolbar nupp, inline dialog, hover tooltip, `handleSave` update, ühtne `handleDeleteAndSaveTextAnnotation` |
| `src/components/editor/AnnotationsTab.tsx` | Lisa tekst-annotatsioonide sektsioon (kuvamine, muutmine, kustutamine) |
| `src/locales/et/workspace.json` | Lisa tõlked |
| `src/locales/en/workspace.json` | Lisa tõlked |
| `server/meilisearch_ops.py` | Lisa `build_text_annotations_text()` helper + indekseerimine + `has_annotations` uuendus |
| `scripts/2-1_upload_to_meili.py` | Lisa `text_annotations_text` → searchableAttributes |
| `src/services/searchService.ts` | Lisa `text_annotations_text` → annotation scope otsinguväljad |
| `tests/test_backend_smoke.py` | Regressioonitestid + uued `text_annotations` testid |

---

## Task 1: Backend regressioonitestid — olemasolev `has_annotations` loogika

**Files:**
- Modify: `tests/test_backend_smoke.py`

- [ ] **Samm 1: Kirjuta kolm läbivat testi `tests/test_backend_smoke.py` lõppu**

```python
# ============================================================
# has_annotations regressioonitestid
# ============================================================

def _make_page_doc(page_tags=None, comments=None, text_annotations=None):
    """Abifunktsioon minimaalne Meilisearch dokument testimiseks."""
    return {
        "has_annotations": bool(
            (page_tags or []) or (comments or []) or (text_annotations or [])
        ),
        "comments": comments or [],
        "page_tags_object": page_tags or [],
        "text_annotations": text_annotations or [],
    }


def test_has_annotations_true_when_comments():
    """has_annotations peab olema True kui on kommentaarid."""
    doc = _make_page_doc(comments=[{"id": "c1", "text": "Huvitav", "author": "a", "created_at": "2026-01-01"}])
    assert doc["has_annotations"] is True


def test_has_annotations_true_when_page_tags():
    """has_annotations peab olema True kui on page_tags."""
    doc = _make_page_doc(page_tags=[{"label": "Teoloogia", "id": "Q34178"}])
    assert doc["has_annotations"] is True


def test_has_annotations_false_when_both_empty():
    """has_annotations peab olema False kui pole kommentaare ega tage ega text_annotations."""
    doc = _make_page_doc()
    assert doc["has_annotations"] is False
```

- [ ] **Samm 2: Käivita testid — veendu et kõik 3 läbivad**

```bash
cd /home/mf/LLM/VUTT
python -m pytest tests/test_backend_smoke.py::test_has_annotations_true_when_comments tests/test_backend_smoke.py::test_has_annotations_true_when_page_tags tests/test_backend_smoke.py::test_has_annotations_false_when_both_empty -v
```

Oodatav: 3 PASS

- [ ] **Samm 3: Commit**

```bash
git add tests/test_backend_smoke.py
git commit -m "test: regressioonitestid has_annotations loogika jaoks"
```

---

## Task 2: TypeScript tüübid + annUtils (TDD)

**Files:**
- Modify: `src/types.ts`
- Modify: `src/services/pageService.ts`
- Create: `src/utils/annUtils.ts`
- Create: `src/utils/__tests__/annUtils.test.ts`

- [ ] **Samm 1: Kirjuta läbikukkuvad testid (`src/utils/__tests__/annUtils.test.ts`)**

```typescript
import { describe, it, expect } from 'vitest';
import { nextAnnId, extractHighlightedText, removeAnnTags, containsAnnTag, findAnnIdsInText } from '../annUtils';
import type { TextAnnotation } from '../../types';

describe('nextAnnId', () => {
  it('tühi massiiv → 1', () => {
    expect(nextAnnId([])).toBe(1);
  });

  it('annid [1, 3] → 4 (max + 1)', () => {
    const anns: TextAnnotation[] = [
      { id: 1, comment: 'a', author: 'u', created_at: '2026-01-01' },
      { id: 3, comment: 'b', author: 'u', created_at: '2026-01-01' },
    ];
    expect(nextAnnId(anns)).toBe(4);
  });
});

describe('extractHighlightedText', () => {
  it('leiab annoteeritud teksti', () => {
    expect(extractHighlightedText('enne <ann2>märgitud sõnad</ann2> järel', 2)).toBe('märgitud sõnad');
  });

  it('puuduv id → tühi string', () => {
    expect(extractHighlightedText('mingi tekst', 5)).toBe('');
  });

  it('ei sega ann1 ja ann12 omavahel', () => {
    const text = '<ann12>pikk tekst</ann12> ja <ann1>lühike</ann1>';
    expect(extractHighlightedText(text, 1)).toBe('lühike');
    expect(extractHighlightedText(text, 12)).toBe('pikk tekst');
  });
});

describe('removeAnnTags', () => {
  it('eemaldab avava ja sulgeva tägi, jätab sisu', () => {
    expect(removeAnnTags('enne <ann2>märgitud sõnad</ann2> järel', 2)).toBe('enne märgitud sõnad järel');
  });

  it('puuduv id → tekst muutumata', () => {
    expect(removeAnnTags('mingi tekst', 99)).toBe('mingi tekst');
  });

  it('ei eemalda teist id-d (ann1 ei mõjuta ann12)', () => {
    const text = '<ann1>tekst</ann1> ja <ann12>pikk</ann12>';
    expect(removeAnnTags(text, 1)).toBe('tekst ja <ann12>pikk</ann12>');
  });
});

describe('containsAnnTag', () => {
  it('tagastab false tühja valiku korral', () => {
    expect(containsAnnTag('mingi tekst', 5, 5)).toBe(false);
  });

  it('tagastab true kui valikus on avav ann-täg', () => {
    expect(containsAnnTag('enne <ann3>tekst</ann3> järel', 4, 20)).toBe(true);
  });

  it('tagastab false kui ann-tägid on valikust väljas', () => {
    expect(containsAnnTag('<ann3>tekst</ann3> järel', 17, 23)).toBe(false);
  });
});

describe('findAnnIdsInText', () => {
  it('leiab kõik ann ID-d tekstist', () => {
    const text = '<ann1>a</ann1> tekst <ann3>b</ann3>';
    expect(findAnnIdsInText(text).sort()).toEqual([1, 3]);
  });

  it('tühi tekst → tühi massiiv', () => {
    expect(findAnnIdsInText('')).toEqual([]);
  });
});
```

- [ ] **Samm 2: Käivita testid — veendu et kukuvad läbi**

```bash
npm test -- --run src/utils/__tests__/annUtils.test.ts
```

Oodatav: FAIL — moodul `annUtils` puudub

- [ ] **Samm 3: Lisa `TextAnnotation` → `src/types.ts`**

Lisa pärast `Annotation` interface'i (umbes rida 151):

```typescript
// Tekst-annotatsioon (highlight + kommentaar)
// MVP: <annN> inline-ankur, text_annotations on kommentaari source of truth.
// Annotatsioonid ei tohi kattuda ega pesastuda — insert-loogika kontrollib seda.
export interface TextAnnotation {
  id: number;           // <ann{id}> tägi numbriline sufiks, kasvav integer
  comment: string;      // Toimetaja kommentaar
  author: string;       // Kasutajanimi
  created_at: string;   // ISO 8601 timestamp
}
```

Lisa `Page` interface'ile `comments` järele:

```typescript
text_annotations: TextAnnotation[];
```

- [ ] **Samm 4: Loo `src/utils/annUtils.ts`**

```typescript
import type { TextAnnotation } from '../types';

/** Järgmine vaba annotatsioon-ID (max olemasolevast + 1, miinimum 1).
 *  MVP: eeldab ühe kasutaja korraga toimetamist. */
export function nextAnnId(annotations: TextAnnotation[]): number {
  if (annotations.length === 0) return 1;
  return Math.max(...annotations.map(a => a.id)) + 1;
}

/** Ekstrakib highlightitud teksti <annN>...</annN> tägide vahelt. */
export function extractHighlightedText(text: string, id: number): string {
  const m = text.match(new RegExp(`<ann${id}>([\\s\\S]*?)<\\/ann${id}>`));
  return m ? m[1] : '';
}

/** Eemaldab <annN> ja </annN> tägid, jätab sisu alles. */
export function removeAnnTags(text: string, id: number): string {
  return text
    .replace(new RegExp(`<ann${id}>`, 'g'), '')
    .replace(new RegExp(`<\\/ann${id}>`, 'g'), '');
}

/** Kontrollib, kas tekstilõigus [from, to) esineb mõni ann-täg (avav või sulgev).
 *  Kasutatakse kattumisvältimisel enne uue annotatsiooni lisamist. */
export function containsAnnTag(text: string, from: number, to: number): boolean {
  const slice = text.slice(from, to);
  return /<\/?ann\d+>/.test(slice);
}

/** Leiab kõik ann-ID-d tekstis. Kasutatakse konsistentsikontrollis. */
export function findAnnIdsInText(text: string): number[] {
  const ids = new Set<number>();
  const re = /<ann(\d+)>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    ids.add(parseInt(m[1], 10));
  }
  return Array.from(ids);
}
```

- [ ] **Samm 5: Käivita testid — veendu et kõik läbivad**

```bash
npm test -- --run src/utils/__tests__/annUtils.test.ts
```

Oodatav: 10 PASS

- [ ] **Samm 6: Uuenda `src/services/pageService.ts`**

Leia `getPage` funktsioonis `history: hit.history || [],` rida (~rida 101). Lisa järele:

```typescript
text_annotations: hit.text_annotations || [],
```

Leia `saveToFileSystem` funktsioonis `metaContent` objekt (~rida 22). Lisa `comments` järele:

```typescript
text_annotations: page.text_annotations,
```

Lisa konsistentsikontroll `saveToFileSystem` funktsiooni lõppu (`return true;` ette):

```typescript
// Konsistentsikontroll: logi hoiatus kui ann-ID-d tekstis ja text_annotations massiiv ei klapi
if (page.text_annotations && page.text_annotations.length > 0) {
  const { findAnnIdsInText } = await import('../utils/annUtils');
  const textIds = new Set(findAnnIdsInText(page.text_content || ''));
  const metaIds = new Set(page.text_annotations.map(a => a.id));
  const onlyInText = [...textIds].filter(id => !metaIds.has(id));
  const onlyInMeta = [...metaIds].filter(id => !textIds.has(id));
  if (onlyInText.length > 0 || onlyInMeta.length > 0) {
    console.warn('[annUtils] Konsistentsiprobleem:', { onlyInText, onlyInMeta });
  }
}
```

- [ ] **Samm 7: Veendu et TypeScript kompileerub**

```bash
npm run build 2>&1 | head -10
```

Oodatav: `✓ built in ...`

- [ ] **Samm 8: Commit**

```bash
git add src/types.ts src/utils/annUtils.ts src/utils/__tests__/annUtils.test.ts src/services/pageService.ts
git commit -m "feat: text-annotations — TypeScript tüübid, annUtils (TDD), pageService"
```

---

## Task 3: VuttMarkupExtension — `ann` täg + CSS

**Files:**
- Modify: `src/components/editor/VuttMarkupExtension.ts`
- Modify: `src/components/editor/VuttTheme.ts`

- [ ] **Samm 1: Lisa `withId` → `TagDef` + `num` → stack item**

Leia `interface TagDef` (~rida 38). Lisa väli:

```typescript
interface TagDef {
  tag: string;
  cls?: string;
  selfClose?: boolean;
  useWidget?: boolean;
  withId?: boolean;  // lisab data-ann-id atribuudi numbrilise sufiksi järgi
}
```

Leia `const stack: { tag: string; from: number; openEnd: number }[] = [];` (~rida 120). Muuda:

```typescript
const stack: { tag: string; from: number; openEnd: number; num: string }[] = [];
```

Leia kõik `stack.push(...)` kutsed (rida ~180). Muuda:

```typescript
stack.push({ tag: cleanTagName, from, openEnd: to, num: m[2] });
```

- [ ] **Samm 2: Lisa `ann` → `VUTT_TAGS` + `data-ann-id` atribuut content mark-is**

Leia `const VUTT_TAGS: TagDef[] = [` (~rida 45). Lisa massiivi lõppu (enne `];`):

```typescript
  { tag: 'ann', cls: 'vutt-ann', withId: true },
```

Leia sisu stiilmarki lisamise koht (umbes rida 152):

```typescript
if (tagDef.cls && open.openEnd < from) {
  decoRanges.push({
    from: open.openEnd,
    to: from,
    deco: Decoration.mark({ class: tagDef.cls }),
    isReplace: false,
  });
}
```

Muuda järgmiseks:

```typescript
if (tagDef.cls && open.openEnd < from) {
  const attrs = tagDef.withId && open.num
    ? { 'data-ann-id': open.num }
    : undefined;
  decoRanges.push({
    from: open.openEnd,
    to: from,
    deco: Decoration.mark({ class: tagDef.cls, attributes: attrs }),
    isReplace: false,
  });
}
```

- [ ] **Samm 3: Lisa `.vutt-ann` CSS → `VuttTheme.ts`**

Lisa `.vutt-hidden-tag` bloki järele:

```typescript
  '.vutt-ann': {
    backgroundColor: '#fef9c3',
    borderBottom: '2px solid #eab308',
    borderRadius: '2px',
    cursor: 'help',
  },
```

- [ ] **Samm 4: Veendu et build töötab**

```bash
npm run build 2>&1 | tail -5
```

Oodatav: `✓ built in ...`

- [ ] **Samm 5: Commit**

```bash
git add src/components/editor/VuttMarkupExtension.ts src/components/editor/VuttTheme.ts
git commit -m "feat: text-annotations — ann täg CM6-s + kollane highlight CSS"
```

---

## Task 4: TextEditor — `text_annotations` state + toolbar nupp + insert dialog

**Files:**
- Modify: `src/components/TextEditor.tsx`

- [ ] **Samm 1: Lisa impordid ja `text_annotations` state**

Lisa impordidele:

```typescript
import type { TextAnnotation } from '../types';
import { nextAnnId, containsAnnTag } from '../utils/annUtils';
```

Leia `const [comments, setComments] = useState<Annotation[]>(page.comments);` (~rida 118). Lisa järele:

```typescript
const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>(page.text_annotations || []);
```

- [ ] **Samm 2: Lisa annotatsioon-dialoogi state**

```typescript
const [annDialogOpen, setAnnDialogOpen] = useState(false);
const [annDialogComment, setAnnDialogComment] = useState('');
const [annDialogError, setAnnDialogError] = useState('');
const [pendingAnnSelection, setPendingAnnSelection] = useState<{ from: number; to: number; text: string } | null>(null);
```

- [ ] **Samm 3: Lisa `insertAnnotation` funktsioon**

Lisa `wrapWithTag` funktsiooni järele:

```typescript
const insertAnnotation = useCallback((comment: string) => {
  const view = viewRef.current;
  if (!view || !pendingAnnSelection || readOnly) return;
  const annId = nextAnnId(textAnnotations);
  const { from, to, text } = pendingAnnSelection;
  const openTag = `<ann${annId}>`;
  const closeTag = `</ann${annId}>`;

  view.dispatch({
    changes: { from, to, insert: openTag + text + closeTag },
    annotations: [Transaction.userEvent.of('input.format')],
  });

  const newAnnotation: TextAnnotation = {
    id: annId,
    comment,
    author: user?.name || 'Anonüümne',
    created_at: new Date().toISOString(),
  };
  const updated = [...textAnnotations, newAnnotation];
  setTextAnnotations(updated);
  setPendingAnnSelection(null);
  setAnnDialogOpen(false);
  setAnnDialogComment('');
  setAnnDialogError('');
}, [pendingAnnSelection, textAnnotations, user, readOnly]);
```

- [ ] **Samm 4: Lisa `removeAnnotationFromEditor` funktsioon**

```typescript
const removeAnnotationFromEditor = useCallback((annId: number) => {
  const view = viewRef.current;
  if (!view) return;
  const text = view.state.doc.toString();
  const openTag = `<ann${annId}>`;
  const closeTag = `</ann${annId}>`;
  const openIdx = text.indexOf(openTag);
  const closeIdx = text.indexOf(closeTag);
  if (openIdx === -1 || closeIdx === -1) return;
  // Eemalda sulgev täg enne avavat (positsioonid ei nihku)
  const changes = [
    { from: closeIdx, to: closeIdx + closeTag.length, insert: '' },
    { from: openIdx, to: openIdx + openTag.length, insert: '' },
  ].sort((a, b) => b.from - a.from);
  view.dispatch({ changes, annotations: [Transaction.userEvent.of('input.format')] });
}, []);
```

- [ ] **Samm 5: Lisa `handleDeleteAndSaveTextAnnotation` — ühtne kustutamise callback**

```typescript
const handleDeleteAndSaveTextAnnotation = useCallback(async (annId: number) => {
  // removeAnnotationFromEditor dispatch on CM6-s sünkroonne —
  // pärast seda on viewRef.current.state.doc juba uuendatud (tägid eemaldatud).
  removeAnnotationFromEditor(annId);
  const updated = textAnnotations.filter(a => a.id !== annId);
  setTextAnnotations(updated);
  if (isSavingRef.current) return;
  isSavingRef.current = true;
  setIsSaving(true);
  // Loe tekst PÄRAST dispatch'i — CM6 on juba tägid eemaldanud
  const text = viewRef.current?.state.doc.toString() ?? '';
  const updatedPage: Page = { ...page, text_content: text, status, comments, page_tags, text_annotations: updated };
  try {
    await onSave(updatedPage);
    setSavedState({ status, comments, page_tags });
    setIsDirty(false);
  } catch (e: any) {
    setSaveError(t('editor.saveErrorWithMessage', { message: e.message || t('common:errors.unknownError') }));
  } finally {
    isSavingRef.current = false;
    setIsSaving(false);
  }
}, [textAnnotations, removeAnnotationFromEditor, page, status, comments, page_tags, onSave]);
```

- [ ] **Samm 6: Lisa `handleSaveTextAnnotations` callback (kommentaari muutmiseks)**

```typescript
const handleSaveTextAnnotations = useCallback(async (updatedTextAnnotations: TextAnnotation[]) => {
  if (isSavingRef.current) return;
  isSavingRef.current = true;
  setIsSaving(true);
  const text = viewRef.current?.state.doc.toString() ?? '';
  const updatedPage: Page = { ...page, text_content: text, status, comments, page_tags, text_annotations: updatedTextAnnotations };
  try {
    await onSave(updatedPage);
    setTextAnnotations(updatedTextAnnotations);
    setSavedState({ status, comments, page_tags });
    setIsDirty(false);
  } catch (e: any) {
    setSaveError(t('editor.saveErrorWithMessage', { message: e.message || t('common:errors.unknownError') }));
  } finally {
    isSavingRef.current = false;
    setIsSaving(false);
  }
}, [page, status, comments, page_tags, onSave]);
```

- [ ] **Samm 7: Uuenda `handleSave` et sisaldaks `text_annotations`**

Leia `handleSave` funktsioonis `updatedPage` koostamine. Lisa `comments` järele:

```typescript
text_annotations: textAnnotations,
```

`savedState`-i EI pea muutma — `{status, comments, page_tags}` jääb samaks. Tekst-annotatsiooni muutused kas: (a) muudavad CM6 teksti → `isDirty=true` → `handleSave` haarab, (b) salvestatakse kohe `handleSaveTextAnnotations`/`handleDeleteAndSaveTextAnnotation` kaudu.

Lisa page-vahetus `useEffect`-ile (rida ~265) `setTextAnnotations` reset:

```typescript
// Leia olemasolevate setComments, setPageTags kõrvale — lisa sinna:
setTextAnnotations(page.text_annotations || []);
```

- [ ] **Samm 8: Lisa toolbar nupp (koos kattumiskontrolliga)**

Leia toolbarist marginalia nupp. Lisa järele:

```tsx
{!readOnly && (
  <button
    type="button"
    onClick={() => {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      if (from === to) return;
      const docText = view.state.doc.toString();
      if (containsAnnTag(docText, from, to)) {
        setAnnDialogError(t('editor.annotateOverlapError', 'Valitud tekst sisaldab juba annotatsiooni'));
        setAnnDialogOpen(true);
        setPendingAnnSelection(null);
        return;
      }
      const text = docText.slice(from, to);
      setPendingAnnSelection({ from, to, text });
      setAnnDialogComment('');
      setAnnDialogError('');
      setAnnDialogOpen(true);
    }}
    className="px-2 h-7 flex items-center justify-center rounded hover:bg-yellow-100 text-[11px] text-yellow-700 border border-transparent hover:border-yellow-200"
    title={t('editor.tooltips.annotate', 'Märgi ja kommenteeri (vali tekst enne)')}
  >
    ✎ Ann
  </button>
)}
```

- [ ] **Samm 9: Lisa annotatsioon-dialoog JSX**

```tsx
{annDialogOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
    <div className="bg-white rounded-lg shadow-xl p-5 w-96 max-w-full">
      <h3 className="font-bold text-gray-800 mb-1">{t('editor.annotateTitle', 'Lisa kommentaar')}</h3>
      {annDialogError ? (
        <p className="text-sm text-red-600 mb-3">{annDialogError}</p>
      ) : pendingAnnSelection ? (
        <p className="text-xs text-gray-500 mb-3 italic truncate">„{pendingAnnSelection.text}"</p>
      ) : null}
      {!annDialogError && (
        <>
          <textarea
            autoFocus
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-yellow-400 outline-none resize-none"
            rows={3}
            placeholder={t('editor.annotateCommentPlaceholder', 'Kommentaar...')}
            value={annDialogComment}
            onChange={e => setAnnDialogComment(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && annDialogComment.trim()) {
                insertAnnotation(annDialogComment.trim());
              }
              if (e.key === 'Escape') {
                setAnnDialogOpen(false);
                setPendingAnnSelection(null);
              }
            }}
          />
          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={() => { setAnnDialogOpen(false); setPendingAnnSelection(null); }}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
            >{t('common:buttons.cancel', 'Tühista')}</button>
            <button
              type="button"
              disabled={!annDialogComment.trim()}
              onClick={() => { if (annDialogComment.trim()) insertAnnotation(annDialogComment.trim()); }}
              className="px-3 py-1.5 text-sm bg-yellow-500 hover:bg-yellow-600 text-white rounded disabled:opacity-50"
            >{t('common:buttons.save', 'Salvesta')}</button>
          </div>
        </>
      )}
      {annDialogError && (
        <div className="flex justify-end mt-3">
          <button
            type="button"
            onClick={() => { setAnnDialogOpen(false); setAnnDialogError(''); }}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >{t('common:buttons.close', 'Sulge')}</button>
        </div>
      )}
    </div>
  </div>
)}
```

- [ ] **Samm 10: Veendu et TypeScript kompileerub**

```bash
npm run build 2>&1 | head -20
```

- [ ] **Samm 11: Commit**

```bash
git add src/components/TextEditor.tsx
git commit -m "feat: text-annotations — TextEditor state, toolbar nupp, insert dialog koos kattumiskontrolliga"
```

---

## Task 5: TextEditor — hover tooltip (`mouseover`/`mouseout`)

**Files:**
- Modify: `src/components/TextEditor.tsx`

- [ ] **Samm 1: Lisa hover tooltip state**

```typescript
const [annTooltip, setAnnTooltip] = useState<{ comment: string; x: number; y: number } | null>(null);
const annTooltipAnnotationsRef = useRef(textAnnotations);
useEffect(() => { annTooltipAnnotationsRef.current = textAnnotations; }, [textAnnotations]);
```

NB: `annTooltipAnnotationsRef` väldib `stale closure`-i — event listener loetakse annotatsioone ref-ist, mitte state-st.

- [ ] **Samm 2: Lisa `useEffect` hover event listener-iga**

NB: Kasuta `editorContainerRef.current`, mitte `viewRef.current?.dom` — CM6 DOM on `editorContainerRef` laps ja container on mount-il alati saadaval (ref ei triggeri re-rendrit, aga container on olemas).

```typescript
useEffect(() => {
  const container = editorContainerRef.current;
  if (!container) return;

  const handleMouseOver = (e: MouseEvent) => {
    const target = (e.target as Element).closest('[data-ann-id]') as HTMLElement | null;
    if (!target) return;
    const annId = parseInt(target.getAttribute('data-ann-id') || '', 10);
    if (isNaN(annId)) return;
    const ann = annTooltipAnnotationsRef.current.find(a => a.id === annId);
    if (!ann) return;
    const rect = target.getBoundingClientRect();
    setAnnTooltip({ comment: ann.comment, x: rect.left + rect.width / 2, y: rect.top });
  };

  const handleMouseOut = (e: MouseEvent) => {
    const related = e.relatedTarget as Element | null;
    if (related?.closest('[data-ann-id]')) return;
    setAnnTooltip(null);
  };

  container.addEventListener('mouseover', handleMouseOver);
  container.addEventListener('mouseout', handleMouseOut);
  return () => {
    container.removeEventListener('mouseover', handleMouseOver);
    container.removeEventListener('mouseout', handleMouseOut);
  };
}, []); // mount kord — annTooltipAnnotationsRef hoiab annotations ajakohasena
```

- [ ] **Samm 3: Lisa tooltip JSX annotatsioon-dialoogi kõrvale**

```tsx
{annTooltip && (
  <div
    className="fixed z-40 bg-gray-900 text-white text-xs rounded px-2 py-1.5 max-w-xs shadow-lg pointer-events-none"
    style={{ left: annTooltip.x, top: annTooltip.y - 36, transform: 'translateX(-50%)' }}
  >
    {annTooltip.comment}
  </div>
)}
```

- [ ] **Samm 4: Uuenda `AnnotationsTab` kasutamist TextEditoris**

Leia `<AnnotationsTab` renderdamise koht (~rida 1036). Lisa uued props:

```tsx
textAnnotations={textAnnotations}
textContent={viewRef.current?.state.doc.toString() ?? page.text_content}
onSaveTextAnnotations={handleSaveTextAnnotations}
onDeleteTextAnnotation={handleDeleteAndSaveTextAnnotation}
```

- [ ] **Samm 5: Veendu et TypeScript kompileerub**

```bash
npm run build 2>&1 | head -10
```

- [ ] **Samm 6: Commit**

```bash
git add src/components/TextEditor.tsx
git commit -m "feat: text-annotations — hover tooltip mouseover/mouseout + stale-closure fix"
```

---

## Task 6: AnnotationsTab — tekst-annotatsioonide sektsioon

**Files:**
- Modify: `src/components/editor/AnnotationsTab.tsx`

- [ ] **Samm 1: Lisa impordid + props**

Lisa impordid:

```typescript
import type { TextAnnotation } from '../../types';
import { extractHighlightedText } from '../../utils/annUtils';
```

Lisa `interface AnnotationsTabProps`:

```typescript
textAnnotations: TextAnnotation[];
textContent: string;
onSaveTextAnnotations: (updated: TextAnnotation[]) => Promise<void>;
onDeleteTextAnnotation: (annId: number) => Promise<void>;
```

Lisa props destruktureerimine.

- [ ] **Samm 2: Lisa editing state**

```typescript
const [editingAnnId, setEditingAnnId] = useState<number | null>(null);
const [editingAnnText, setEditingAnnText] = useState('');
```

- [ ] **Samm 3: Lisa tekst-annotatsioonide sektsioon JSX**

Otsi `{/* Lehekülje märksõnad */}` blokk. Lisa selle ette:

```tsx
{/* Tekst-annotatsioonid */}
{textAnnotations.length > 0 && (
  <div className="bg-white p-5 rounded-lg border border-yellow-200 shadow-sm mb-6">
    <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
      <span className="text-yellow-500 text-base">✎</span>
      <h4 className="font-bold">{t('annotations.textAnnotations', 'Tekst-annotatsioonid')}</h4>
    </div>
    <div className="space-y-3">
      {textAnnotations.map(ann => {
        const highlightedText = extractHighlightedText(textContent, ann.id);
        return (
          <div key={ann.id} className="border border-yellow-100 rounded p-3 bg-yellow-50/50">
            {highlightedText ? (
              <p className="text-xs text-gray-500 italic mb-1.5 line-clamp-2">„{highlightedText}"</p>
            ) : (
              <p className="text-xs text-amber-600 italic mb-1.5">
                {t('annotations.anchorMissing', 'Seotud tekstilõiku ei leitud')}
              </p>
            )}
            {editingAnnId === ann.id ? (
              <div className="space-y-2">
                <textarea
                  autoFocus
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-yellow-400 outline-none resize-none"
                  rows={2}
                  value={editingAnnText}
                  onChange={e => setEditingAnnText(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const updated = textAnnotations.map(a =>
                        a.id === ann.id ? { ...a, comment: editingAnnText } : a
                      );
                      await onSaveTextAnnotations(updated);
                      setEditingAnnId(null);
                    }}
                    className="text-xs bg-yellow-500 hover:bg-yellow-600 text-white px-2 py-1 rounded"
                  >{t('common:buttons.save', 'Salvesta')}</button>
                  <button
                    type="button"
                    onClick={() => setEditingAnnId(null)}
                    className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
                  >{t('common:buttons.cancel', 'Tühista')}</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <p className="text-sm text-gray-800 flex-1">{ann.comment}</p>
                {!readOnly && (
                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => { setEditingAnnId(ann.id); setEditingAnnText(ann.comment); }}
                      className="text-gray-400 hover:text-gray-700 text-xs px-1"
                      title={t('common:buttons.edit', 'Muuda')}
                    >✎</button>
                    <button
                      type="button"
                      onClick={() => onDeleteTextAnnotation(ann.id)}
                      className="text-gray-400 hover:text-red-500 text-xs px-1"
                      title={t('common:buttons.remove', 'Kustuta')}
                    >×</button>
                  </div>
                )}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-1">
              {ann.author} · {new Date(ann.created_at).toLocaleDateString()}
            </p>
          </div>
        );
      })}
    </div>
  </div>
)}
```

- [ ] **Samm 4: Veendu et TypeScript kompileerub**

```bash
npm run build 2>&1 | head -20
```

Oodatav: ei mingeid TS vigu

- [ ] **Samm 5: Commit**

```bash
git add src/components/editor/AnnotationsTab.tsx
git commit -m "feat: text-annotations — AnnotationsTab kuvamine, muutmine, kustutamine + katkise ankru märge"
```

---

## Task 7: Tõlked

**Files:**
- Modify: `src/locales/et/workspace.json`
- Modify: `src/locales/en/workspace.json`

- [ ] **Samm 1: Lisa eestikeelsed tõlked**

`src/locales/et/workspace.json` — lisa `editor` sektsiooni:

```json
"annotateTitle": "Lisa kommentaar",
"annotateCommentPlaceholder": "Kommentaar...",
"annotateOverlapError": "Valitud tekst sisaldab juba annotatsiooni — vali kattumatult"
```

Lisa `editor.tooltips` sektsiooni:

```json
"annotate": "Märgi ja kommenteeri (vali tekst enne)"
```

Lisa `annotations` sektsiooni (loo kui pole):

```json
"annotations": {
  "textAnnotations": "Tekst-annotatsioonid",
  "anchorMissing": "Seotud tekstilõiku ei leitud"
}
```

- [ ] **Samm 2: Lisa ingliskeelsed tõlked**

`src/locales/en/workspace.json`:

```json
"annotateTitle": "Add comment",
"annotateCommentPlaceholder": "Comment...",
"annotateOverlapError": "Selection contains an existing annotation — choose non-overlapping text"
```

```json
"annotate": "Highlight and comment (select text first)"
```

```json
"annotations": {
  "textAnnotations": "Text annotations",
  "anchorMissing": "Linked text span not found"
}
```

- [ ] **Samm 3: Commit**

```bash
git add src/locales/et/workspace.json src/locales/en/workspace.json
git commit -m "feat: text-annotations — tõlked"
```

---

## Task 8: Backend Meilisearch — `build_text_annotations_text` helper (TDD)

**Files:**
- Modify: `server/meilisearch_ops.py`
- Modify: `scripts/2-1_upload_to_meili.py`
- Modify: `tests/test_backend_smoke.py`

- [ ] **Samm 1: Kirjuta läbikukkuvad testid**

Lisa `tests/test_backend_smoke.py` lõppu:

```python
# ============================================================
# text_annotations Meilisearch indekseerimise testid
# ============================================================

def test_build_text_annotations_text_joined():
    """build_text_annotations_text peab liitma kõigi annotatsioonide kommentaarid."""
    from server.meilisearch_ops import build_text_annotations_text
    anns = [
        {"id": 1, "comment": "Viide Cicero kirjale", "author": "u", "created_at": "2026-01-01"},
        {"id": 2, "comment": "Kreekakeelne tsitaat", "author": "u", "created_at": "2026-01-01"},
    ]
    result = build_text_annotations_text(anns)
    assert result is not None
    assert "Viide Cicero kirjale" in result
    assert "Kreekakeelne tsitaat" in result


def test_build_text_annotations_text_empty():
    """Tühi massiiv → None (väli jäetakse dokumendist välja)."""
    from server.meilisearch_ops import build_text_annotations_text
    assert build_text_annotations_text([]) is None


def test_has_annotations_true_when_text_annotations():
    """has_annotations peab olema True kui on text_annotations."""
    doc = _make_page_doc(text_annotations=[
        {"id": 1, "comment": "Huvitav koht", "author": "u", "created_at": "2026-01-01"}
    ])
    assert doc["has_annotations"] is True
```

- [ ] **Samm 2: Käivita testid — veendu et kaks esimest kukuvad (kolmas läbib)**

```bash
python -m pytest tests/test_backend_smoke.py::test_build_text_annotations_text_joined tests/test_backend_smoke.py::test_build_text_annotations_text_empty tests/test_backend_smoke.py::test_has_annotations_true_when_text_annotations -v
```

Oodatav: esimene ja teine FAIL (`ImportError`), kolmas PASS

- [ ] **Samm 3: Lisa `build_text_annotations_text` helper → `server/meilisearch_ops.py`**

Lisa faili algusesse (koos teiste helper funktsioonidega, otsi `def get_label` vm lihtsat helper-i):

```python
def build_text_annotations_text(text_annotations):
    """Koostab otsitava teksti text_annotations kommentaaridest.
    
    Tagastab None kui annotatsioonid puuduvad (väli jäetakse dokumendist välja).
    """
    if not text_annotations:
        return None
    parts = [
        a["comment"]
        for a in text_annotations
        if isinstance(a, dict) and a.get("comment")
    ]
    return " ".join(parts) if parts else None
```

- [ ] **Samm 4: Käivita testid — veendu et kõik 3 läbivad**

```bash
python -m pytest tests/test_backend_smoke.py::test_build_text_annotations_text_joined tests/test_backend_smoke.py::test_build_text_annotations_text_empty tests/test_backend_smoke.py::test_has_annotations_true_when_text_annotations -v
```

Oodatav: 3 PASS

- [ ] **Samm 5: Lisa `text_annotations` indekseerimise loogika → `server/meilisearch_ops.py`**

Leia `page_meta = { 'status': ..., 'comments': [], ... }` (~rida 403). Lisa `'comments': []` järele:

```python
'text_annotations': [],
```

Leia `page_meta['comments'] = source.get('comments', [])` (~rida 418). Lisa järele:

```python
page_meta['text_annotations'] = source.get('text_annotations', [])
```

Leia `"comments": page_meta['comments']` (~rida 488). Lisa järele:

```python
"text_annotations": page_meta['text_annotations'],
```

Leia `"has_annotations": bool(page_tags_data or page_meta['comments'])` (~rida 487). Muuda:

```python
"has_annotations": bool(page_tags_data or page_meta['comments'] or page_meta['text_annotations']),
```

Leia `archive_refs` dokumendi kokkupaneku koht (~rida 540). Lisa sarnaselt selle järele:

```python
text_anns = page_meta.get('text_annotations') or []
ann_text = build_text_annotations_text(text_anns)
if ann_text is not None:
    doc['text_annotations_text'] = ann_text
```

- [ ] **Samm 6: Lisa `text_annotations_text` → `scripts/2-1_upload_to_meili.py`**

Leia `'archive_refs_text',` rida. Lisa järele:

```python
'text_annotations_text',
```

- [ ] **Samm 7: Käivita kõik backend testid**

```bash
python -m pytest tests/ -v --tb=short
```

Oodatav: kõik PASS

- [ ] **Samm 8: Commit**

```bash
git add server/meilisearch_ops.py scripts/2-1_upload_to_meili.py tests/test_backend_smoke.py
git commit -m "feat: text-annotations — Meilisearch build_text_annotations_text helper + indekseerimine (TDD)"
```

---

## Task 9: searchService — `text_annotations_text` annotation scope'is

**Files:**
- Modify: `src/services/searchService.ts`

- [ ] **Samm 1: Lisa `text_annotations_text` → annotation scope**

Leia kaks kohta kus `scope === 'annotation'` käsitletakse (~rida 498 ja ~rida 719):

```typescript
else if (options.scope === 'annotation') {
  attributesToSearchOn = [tagsField, 'comments.text'];
  if (!query) filter.push('has_annotations = true');
}
```

Muuda MÕLEMAS:

```typescript
else if (options.scope === 'annotation') {
  attributesToSearchOn = [tagsField, 'comments.text', 'text_annotations_text'];
  if (!query) filter.push('has_annotations = true');
}
```

- [ ] **Samm 2: Käivita kõik testid**

```bash
npm test -- --run
python -m pytest tests/ -v --tb=short
```

Oodatav: kõik PASS

- [ ] **Samm 3: Commit**

```bash
git add src/services/searchService.ts
git commit -m "feat: text-annotations — scope=annotation otsib ka text_annotations_text"
```

---

## Deploy märkused

**Backend deploy** (meilisearch_ops.py muutused):

```bash
ssh vutt
cd ~/VUTT && git pull
docker compose build --no-cache backend && docker compose up -d backend
```

**Frontend deploy**:

```bash
npm run build
rsync -avz dist/ vutt:~/VUTT/dist/
```

**Smoke-check pärast deployd:**

1. Ava teos → lehekülje editori
2. Vali tekstilõik → kliki "✎ Ann" → kirjuta kommentaar → Salvesta
3. Kontrolli `.json` faili serveril: `ssh vutt cat ~/VUTT/data/{slug}/{page}.json | python3 -m json.tool | grep text_annotations`
4. Kontrolli Meilisearch dokumenti: `ssh vutt curl "localhost:7700/indexes/teosed/documents/{id}" | python3 -m json.tool | grep text_annotations`
5. Otsing: `scope=annotation` + teose filter → kontroll et uus annotatsioon leitakse

**Meilisearch reindeks** — `text_annotations_text` lisatakse automaatselt järgmistel salvestustel. Täis reindeks ainult siis kui soovitakse otsingut vanadele annoteerimata lehtedele:

```bash
ssh vutt
cd ~/VUTT && python scripts/2-1_upload_to_meili.py
```

---

## Teadaolevad piirangud

- **Kattuvad annotatsioonid:** insert-loogika blokeerib kattumise, aga ristumist teiste VUTT-tägidega (`<m>`, `<i>`, jne) ei valideerita
- **Konkurentsirisk:** `nextAnnId()` (max+1) eeldab ühe kasutaja korraga toimetamist — sama eeldus kogu salvestussüsteemil
- **Tuleviku sidebar:** andmemudel on sidebar-vaadet arvestades üles ehitatud; `text_annotations` ID → `<annN>` ankur töötab ka teises renderdusrežiimis
