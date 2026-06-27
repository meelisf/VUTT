# Kontekstist /manage-isse deep-link — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin saab ImageVieweris vajutada nuppu, mis viib `/manage`-isse täpselt sellele lehele (keri + esiletõst), ja sealt tagasi samale lehele; `/manage` grid saab veeru-reguleerija ja reset-ikoon muudetakse arusaadavaks.

**Architecture:** Puhas navigatsiooni-/parsimisloogika eraldatakse testitavasse util-moodulisse (`manageDeeplink.ts`, vitest). Komponentide ühendus (nupp, scroll, highlight, slider) tehakse olemasolevatesse failidesse ja verifitseeritakse käsitsi jooksvas rakenduses, sest projektis pole React-komponentide testimise infrat (vitest `environment: 'node'`, ei `@testing-library/react`).

**Tech Stack:** React 19 + TypeScript, Vite, Tailwind, react-router-dom, react-i18next, lucide-react ikoonid, vitest (node-keskkond).

## Global Constraints

- **Ainult frontend.** Backend muudatusi EI tehta — kõik `/manage` operatsioonid on juba olemas.
- **Privileegid:** "Halda lehte" nupp ainult `user?.role === 'admin'`. `/manage` ise jääb olemasoleva admin-kaitse alla (`WorkManage.tsx:117-123`). Workspace jääb anonüümselt vaadatavaks.
- **`focus` param:** ainult positiivne täisarv; muu (`abc`, `-1`, `12.5`, puuduv) → tavavaade, ei crash.
- **Fookus rakendub AINULT esmasel laadimisel** (`handledFocusRef` guard; talub React StrictMode topelt-effecti). Hilisem salvestamata reorder EI käivita uut scroll'i.
- **Tagasitee = parima-püüde** `/work/:workId/<focus>`; puuduva `focus` korral senine käitumine (leht 1).
- **Veerud:** `MIN_COLS = 3`, `MAX_COLS = 10` (sama nagu `ThumbnailGrid.tsx`); dünaamiline grid inline-stiiliga `gridTemplateColumns: repeat(${cols}, 1fr)` (Tailwind JIT ei purgeks `grid-cols-${n}`).
- **A11y:** highlight kasutab `motion-safe:` varianti (`prefers-reduced-motion` korral animatsioonita).
- **Ikoonid:** "Halda lehte" = `Scissors` (sama ikoon mida `PageCard` juba edit-nupul kasutab); reset-nupp `RotateCcw` → `Maximize2`.
- **ImageVieweri tooltipid on hardkodeeritud eesti keeles** (olemasolev muster, vt `title="Suumi sisse"`). Uus nupp järgib seda: `title="Halda lehte"`. i18n lisatakse ainult `WorkManage` tagasinupule (kasutab juba `t()`).

---

### Task 1: Puhtad deep-link / focus helperid (TDD)

**Files:**
- Create: `src/utils/manageDeeplink.ts`
- Test: `src/utils/__tests__/manageDeeplink.test.ts`

**Interfaces:**
- Consumes: midagi varasemast taskist ei tarbi.
- Produces:
  - `buildManageLink(workId: string, pageNum: number): string` → `/work/${workId}/manage?focus=${pageNum}`
  - `parseFocusParam(raw: string | null): number | null` → positiivne täisarv või `null`
  - `buildBackToEditorPath(workId: string, focus: number | null): string` → `/work/${workId}/${focus ?? 1}`

- [ ] **Step 1: Kirjuta kukkuv test**

```ts
// src/utils/__tests__/manageDeeplink.test.ts
import { describe, it, expect } from 'vitest';
import { buildManageLink, parseFocusParam, buildBackToEditorPath } from '../manageDeeplink';

describe('buildManageLink', () => {
  it('ehitab focus-lingi', () => {
    expect(buildManageLink('abc123', 12)).toBe('/work/abc123/manage?focus=12');
  });
});

describe('parseFocusParam', () => {
  it('võtab vastu positiivse täisarvu', () => {
    expect(parseFocusParam('12')).toBe(12);
    expect(parseFocusParam('1')).toBe(1);
  });
  it('lükkab tagasi vigase sisendi', () => {
    expect(parseFocusParam(null)).toBeNull();
    expect(parseFocusParam('')).toBeNull();
    expect(parseFocusParam('abc')).toBeNull();
    expect(parseFocusParam('-1')).toBeNull();
    expect(parseFocusParam('0')).toBeNull();
    expect(parseFocusParam('12.5')).toBeNull();
    expect(parseFocusParam('12abc')).toBeNull();
  });
});

describe('buildBackToEditorPath', () => {
  it('kasutab focus-i kui olemas', () => {
    expect(buildBackToEditorPath('abc123', 12)).toBe('/work/abc123/12');
  });
  it('langeb tagasi lehele 1 kui focus puudub', () => {
    expect(buildBackToEditorPath('abc123', null)).toBe('/work/abc123/1');
  });
});
```

- [ ] **Step 2: Käivita test, veendu et kukub**

Run: `npm run test -- src/utils/__tests__/manageDeeplink.test.ts`
Expected: FAIL — "Failed to resolve import '../manageDeeplink'".

- [ ] **Step 3: Kirjuta minimaalne implementatsioon**

```ts
// src/utils/manageDeeplink.ts

/** Workspace → /manage deep-link konkreetsele lehele. */
export function buildManageLink(workId: string, pageNum: number): string {
  return `/work/${workId}/manage?focus=${pageNum}`;
}

/** Parsib ?focus= väärtuse. Lubatud ainult positiivne täisarv, muidu null. */
export function parseFocusParam(raw: string | null): number | null {
  if (raw == null) return null;
  // Range: ainult puhas positiivne täisarv (mitte "12.5", "12abc", "-1", "0")
  if (!/^[1-9][0-9]*$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** /manage → Workspace tagasitee. Parima-püüde: focus või leht 1. */
export function buildBackToEditorPath(workId: string, focus: number | null): string {
  return `/work/${workId}/${focus ?? 1}`;
}
```

- [ ] **Step 4: Käivita test, veendu et läbib**

Run: `npm run test -- src/utils/__tests__/manageDeeplink.test.ts`
Expected: PASS (kõik 6 `it`-bloki rohelised).

- [ ] **Step 5: Commit**

```bash
git add src/utils/manageDeeplink.ts src/utils/__tests__/manageDeeplink.test.ts
git commit -m "feat: deep-link/focus helperid (manageDeeplink)"
```

---

### Task 2: ImageViewer — "Halda lehte" nupp + reset-ikoon

**Files:**
- Modify: `src/components/ImageViewer.tsx` (import rida 2; props interface rida 5-10; reset-nupp rida 181-187; uus nupp ribasse)

**Interfaces:**
- Consumes: midagi puhast util-i siin ei kutsuta (link ehitatakse Workspace'is, Task 3).
- Produces: `ImageViewerProps` saab kaks uut välja:
  - `isAdmin?: boolean`
  - `onManage?: () => void`

- [ ] **Step 1: Uuenda importe (rida 2)**

Vana:
```ts
import { ZoomIn, ZoomOut, RotateCcw, Download, LayoutGrid } from 'lucide-react';
```
Uus (eemalda `RotateCcw`, lisa `Maximize2` ja `Scissors`):
```ts
import { ZoomIn, ZoomOut, Maximize2, Download, LayoutGrid, Scissors } from 'lucide-react';
```

- [ ] **Step 2: Lisa propsid interface'i**

Vana:
```ts
interface ImageViewerProps {
  src: string;
  pageNum?: number;
  onGridView?: () => void;
  onNavigate?: (direction: 'prev' | 'next') => void;
}
```
Uus:
```ts
interface ImageViewerProps {
  src: string;
  pageNum?: number;
  onGridView?: () => void;
  onNavigate?: (direction: 'prev' | 'next') => void;
  isAdmin?: boolean;
  onManage?: () => void;
}
```
Ja destructuring-rida (rida 11):
```ts
const ImageViewer: React.FC<ImageViewerProps> = ({ src, pageNum, onGridView, onNavigate, isAdmin, onManage }) => {
```

- [ ] **Step 3: Vaheta reset-nupu ikoon (rida 181-187)**

Vana:
```tsx
          <button
            onClick={handleReset}
            ...
            title="Taasta vaade"
          >
            <RotateCcw size={20} />
          </button>
```
Uus (ainult ikoon muutub `RotateCcw` → `Maximize2`; `title` jääb "Taasta vaade", `onClick`/className samaks):
```tsx
          <button
            onClick={handleReset}
            ...
            title="Taasta vaade"
          >
            <Maximize2 size={20} />
          </button>
```
> NB: säilita olemasolev `className` täpselt nagu failis on; muutub AINULT ikooni-komponent.

- [ ] **Step 4: Lisa "Halda lehte" nupp (admin-only) grid-nupu kõrvale**

Olemasolev grid-nupp on tingimuslik (`onGridView &&`, rida ~190-198). Lisa selle järele,
sama className-mustriga nagu teised ribanupud (kopeeri täpne className naabernuppult):
```tsx
          {isAdmin && onManage && (
            <button
              onClick={onManage}
              className="<SAMA className nagu naaberribanupul>"
              title="Halda lehte"
            >
              <Scissors size={20} />
            </button>
          )}
```
> Kopeeri `className` täpselt ühelt olemasolevalt ribanupult (nt download-nupp), et stiil ühtiks.

- [ ] **Step 5: Verifitseeri build + lint**

Run: `npm run build`
Expected: õnnestub ilma TS-vigadeta (eriti: `RotateCcw` enam ei impordita, uued propsid tüübitud).

- [ ] **Step 6: Commit**

```bash
git add src/components/ImageViewer.tsx
git commit -m "feat: ImageViewer 'Halda lehte' nupp + reset-ikoon Maximize2"
```

---

### Task 3: Workspace — anna ImageViewerile admin + onManage

**Files:**
- Modify: `src/pages/Workspace.tsx` (import; `isAdmin` arvutus; `<ImageViewer ...>` rida ~554)

**Interfaces:**
- Consumes: `buildManageLink` (Task 1); `ImageViewerProps.isAdmin/onManage` (Task 2).
- Produces: midagi hilisemale taskile ei ekspordi.

- [ ] **Step 1: Impordi helper**

Lisa importide juurde:
```ts
import { buildManageLink } from '../utils/manageDeeplink';
```

- [ ] **Step 2: Arvuta isAdmin**

`useUser()` annab juba `user` (rida 29). Lisa komponendi sees (nt teiste tuletatud
väärtuste juurde):
```ts
const isAdmin = user?.role === 'admin';
```

- [ ] **Step 3: Anna propsid ImageViewerile (rida ~554)**

Vana:
```tsx
<ImageViewer src={currentImageSrc} pageNum={page.page_number} onGridView={handleOpenGridView} onNavigate={(dir) => navigatePage(dir === 'next' ? 1 : -1)} />
```
Uus:
```tsx
<ImageViewer
  src={currentImageSrc}
  pageNum={page.page_number}
  onGridView={handleOpenGridView}
  onNavigate={(dir) => navigatePage(dir === 'next' ? 1 : -1)}
  isAdmin={isAdmin}
  onManage={() => navigate(buildManageLink(workId!, page.page_number))}
/>
```
> `workId` ja `navigate` on failis juba olemas (rida 38-39); `page.page_number` on
> kanooniline leheküljenumber, mille järgi Workspace laeb (vt `currentPageNum` sünk
> rida 195-196).

- [ ] **Step 4: Verifitseeri build**

Run: `npm run build`
Expected: õnnestub ilma TS-vigadeta.

- [ ] **Step 5: Manuaalne kontroll (jooksev rakendus)**

Run: `npm run dev`, ava admin-kasutajana mõne teose leht (nt `/work/<id>/12`).
Expected:
- ImageVieweri ribas on käärid-nupp ("Halda lehte"); reset-nupp on nüüd "mahuta"-ikoon, mitte pööramisnool.
- Käärid-nupule vajutus viib `/work/<id>/manage?focus=12`.
- Logi välja (anonüümne) → käärid-nuppu EI ole.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Workspace.tsx
git commit -m "feat: Workspace annab ImageViewerile admin + manage-lingi"
```

---

### Task 4: PageCard — forwardRef + isFocused highlight

**Files:**
- Modify: `src/pages/manage/PageCard.tsx` (komponendi signatuur; välimine `<div>`; props interface)

**Interfaces:**
- Consumes: midagi.
- Produces: `PageCard` on nüüd `forwardRef<HTMLDivElement, PageCardProps>`; `PageCardProps` saab `isFocused?: boolean`.

- [ ] **Step 1: Lisa `isFocused` propsi interface'i**

`PageCardProps`-i lõppu (pärast `onEdit`):
```ts
  onEdit: (visiblePageNum: number) => void;
  isFocused?: boolean;
```

- [ ] **Step 2: Tee komponent forwardRef-iks ja kinnita ref + highlight välimisele div-ile**

Vana:
```tsx
const PageCard: React.FC<PageCardProps> = (p) => {
  const { t } = useTranslation(['workspace', 'common']);
  return (
    <div
      className={`relative flex flex-col rounded-lg border overflow-hidden bg-white ${
        p.isSelected ? 'border-primary-500 ring-2 ring-primary-400'
          : p.isChanged ? 'border-amber-400 ring-1 ring-amber-300' : 'border-gray-200'
      }`}
    >
```
Uus:
```tsx
const PageCard = React.forwardRef<HTMLDivElement, PageCardProps>((p, ref) => {
  const { t } = useTranslation(['workspace', 'common']);
  return (
    <div
      ref={ref}
      className={`relative flex flex-col rounded-lg border overflow-hidden bg-white ${
        p.isFocused ? 'ring-2 ring-blue-500 motion-safe:animate-pulse'
          : p.isSelected ? 'border-primary-500 ring-2 ring-primary-400'
          : p.isChanged ? 'border-amber-400 ring-1 ring-amber-300' : 'border-gray-200'
      }`}
    >
```

- [ ] **Step 3: Sulge forwardRef ja lisa displayName**

Faili lõpus, komponendi sulgemisel: vana `};` (mis lõpetab `const PageCard = ... => { ... };`)
asenda nii, et `forwardRef` callback ja komponent oleksid korrektselt suletud:
```tsx
});

PageCard.displayName = 'PageCard';

export default PageCard;
```
> NB: kontrolli olemasolevat eksporti — kui failis on `export default PageCard;` juba
> olemas, ära dubleeri, lisa ainult `displayName` rida enne seda. Asenda komponendi
> keha lõpetav `};` → `});`.

- [ ] **Step 4: Verifitseeri build**

Run: `npm run build`
Expected: õnnestub; `forwardRef` tüübid korras.

- [ ] **Step 5: Commit**

```bash
git add src/pages/manage/PageCard.tsx
git commit -m "feat: PageCard forwardRef + isFocused highlight"
```

---

### Task 5: WorkManage — focus scroll/highlight + fookus-teadlik tagasinupp

**Files:**
- Modify: `src/pages/WorkManage.tsx` (importid; `useSearchParams`; refid + highlight-olek; effect; tagasinupp rida 578; `PageCard` render rida ~698-714)
- Modify: `src/locales/et/workspace.json` (manage blokk, rida ~69)
- Modify: `src/locales/en/workspace.json` (manage blokk, rida ~69)

**Interfaces:**
- Consumes: `parseFocusParam`, `buildBackToEditorPath` (Task 1); `PageCard` `ref` + `isFocused` (Task 4); `visibleNumByFile` (olemas, rida ~256).
- Produces: midagi hilisemale taskile ei ekspordi.

- [ ] **Step 1: Lisa i18n võti (et)**

`src/locales/et/workspace.json` `manage` blokki, `backToWork` järele:
```json
    "backToWork": "Tagasi teosele",
    "backToPage": "Tagasi lehele {{n}}",
```

- [ ] **Step 2: Lisa i18n võti (en)**

`src/locales/en/workspace.json` `manage` blokki:
```json
    "backToWork": "Back to work",
    "backToPage": "Back to page {{n}}",
```

- [ ] **Step 3: Uuenda importe WorkManage.tsx-s**

```ts
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { parseFocusParam, buildBackToEditorPath } from '../utils/manageDeeplink';
```
(lisa `useSearchParams` olemasolevasse react-router-dom importi; lisa util-import.)

- [ ] **Step 4: Loe focus + lisa refid/olek (komponendi sees, teiste hookide juurde)**

```ts
const [searchParams] = useSearchParams();
const focus = parseFocusParam(searchParams.get('focus'));
const focusedCardRef = useRef<HTMLDivElement | null>(null);
const [highlightedNum, setHighlightedNum] = useState<number | null>(null);
const handledFocusRef = useRef<number | null>(null);
```
> `useRef`/`useState` on failis tõenäoliselt juba imporditud; kui ei, lisa `react` importi.

- [ ] **Step 5: Lisa fookus-effect (rakendub AINULT esmasel laadimisel)**

Pärast seda kui `visibleSorted` / `visibleNumByFile` on arvutatud ja lehed laetud
(`!loading` seisus). Lisa effect:
```ts
useEffect(() => {
  if (focus == null) return;
  if (loading) return;                       // oota kuni lehed laetud
  if (handledFocusRef.current === focus) return; // ainult kord (sh StrictMode)
  // Kontrolli, et fookus-leht on nähtavas listis
  const exists = Object.values(visibleNumByFile).includes(focus);
  if (!exists) { handledFocusRef.current = focus; return; }
  handledFocusRef.current = focus;
  // Keri pärast renderit (aspect-[3/4] → kõrgused stabiilsed, üks rAF piisab)
  requestAnimationFrame(() => {
    focusedCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  setHighlightedNum(focus);
  const tid = setTimeout(() => setHighlightedNum(null), 2000);
  return () => clearTimeout(tid);
}, [focus, loading, visibleNumByFile]);
```
> Kohenda `loading` muutuja nimi olemasoleva laadimisoleku järgi failis (otsi `setLoading`/`loading`).

- [ ] **Step 6: Tee tagasinupp fookus-teadlikuks (rida 578)**

Vana:
```tsx
          <button
            onClick={() => navigate(`/work/${workId}/1`)}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft size={16} />
            {t('manage.backToWork')}
          </button>
```
Uus:
```tsx
          <button
            onClick={() => navigate(buildBackToEditorPath(workId!, focus))}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft size={16} />
            {focus != null ? t('manage.backToPage', { n: focus }) : t('manage.backToWork')}
          </button>
```

- [ ] **Step 7: Anna ref + isFocused fookus-kaardile (PageCard render, rida ~698-714)**

`visibleSorted.map((page) => { ... })` sees, kus `vNum = visibleNumByFile[page.filename]`:
```tsx
                    const vNum = visibleNumByFile[page.filename];
                    const isFocused = focus != null && vNum === focus;
                    return (
                      <PageCard
                        key={page.filename}
                        ref={isFocused ? focusedCardRef : undefined}
                        isFocused={isFocused && highlightedNum === focus}
                        workId={workId!}
                        filename={page.filename}
                        ...ülejäänud propsid muutumata...
                      />
                    );
```
> Säilita kõik olemasolevad propsid; lisa AINULT `ref` ja `isFocused`.

- [ ] **Step 8: Verifitseeri build**

Run: `npm run build`
Expected: õnnestub ilma TS-vigadeta.

- [ ] **Step 9: Manuaalne kontroll**

Run: `npm run dev` (admin). Workspace lehel `/work/<id>/12` → vajuta käärid-nuppu.
Expected:
- `/manage?focus=12` avaneb, kerib lehele 12, kaart vilgub ~2s (reduced-motion korral staatiline ring).
- Ülaserva tagasinupp ütleb "Tagasi lehele 12" → viib `/work/<id>/12`.
- Ava `/work/<id>/manage` ilma `?focus` → ei keri/vilgu; nupp "Tagasi teosele" → leht 1.
- `/work/<id>/manage?focus=abc` → tavavaade, ei crash, nupp "Tagasi teosele".

- [ ] **Step 10: Commit**

```bash
git add src/pages/WorkManage.tsx src/locales/et/workspace.json src/locales/en/workspace.json
git commit -m "feat: WorkManage focus scroll/highlight + fookus-teadlik tagasinupp"
```

---

### Task 6: WorkManage — grid veeru-reguleerija

**Files:**
- Modify: `src/pages/WorkManage.tsx` (veergude olek; slider UI; grid `<div>` rida ~697)

**Interfaces:**
- Consumes: midagi.
- Produces: midagi.

- [ ] **Step 1: Lisa veergude olek + konstandid**

Komponendi sees:
```ts
const MIN_COLS = 3;
const MAX_COLS = 10;
const [gridCols, setGridCols] = useState(5);
```

- [ ] **Step 2: Lisa slider UI grid-i kohale**

Grid-ploki (rida ~697 `<div className="grid ...">`) ette lisa reguleerija (muster
`ThumbnailGrid.tsx:93-113` järgi, +/- nupud + range):
```tsx
                <div className="flex items-center gap-2 px-4 pt-2 text-sm text-gray-600">
                  <button
                    onClick={() => setGridCols((c) => Math.max(c - 1, MIN_COLS))}
                    disabled={gridCols <= MIN_COLS}
                    className="px-2 py-0.5 border rounded disabled:opacity-40"
                    title="Suuremad pisipildid"
                  >−</button>
                  <input
                    type="range"
                    min={MIN_COLS}
                    max={MAX_COLS}
                    value={MAX_COLS + MIN_COLS - gridCols}
                    onChange={(e) => setGridCols(MAX_COLS + MIN_COLS - Number(e.target.value))}
                  />
                  <button
                    onClick={() => setGridCols((c) => Math.min(c + 1, MAX_COLS))}
                    disabled={gridCols >= MAX_COLS}
                    className="px-2 py-0.5 border rounded disabled:opacity-40"
                    title="Väiksemad pisipildid"
                  >+</button>
                </div>
```
> Slider on "tagurpidi" (vasak = vähem veerge = suuremad pildid), nagu `ThumbnailGrid`.

- [ ] **Step 3: Tee grid dünaamiliseks (rida ~697)**

Vana:
```tsx
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 p-4">
```
Uus (eemalda fikseeritud `grid-cols-*`, kasuta inline-stiili):
```tsx
                <div
                  className="grid gap-3 p-4"
                  style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}
                >
```

- [ ] **Step 4: Verifitseeri build**

Run: `npm run build`
Expected: õnnestub.

- [ ] **Step 5: Manuaalne kontroll**

Run: `npm run dev` (admin) → `/work/<id>/manage`.
Expected: slideriga/nuppudega muutub veergude arv 3–10 vahel; −/+ nupud lukustuvad
piiridel; pisipildid suurenevad/vähenevad vastavalt.

- [ ] **Step 6: Commit**

```bash
git add src/pages/WorkManage.tsx
git commit -m "feat: WorkManage grid veeru-reguleerija (3-10)"
```

---

## Self-Review

**Spec coverage:**
- Deep-link Workspace→/manage (spec §1) → Task 2 + 3. ✓
- Focus scroll + highlight, parser, StrictMode guard, reduced-motion, init-only (spec §2) → Task 5 (+ helper Task 1, PageCard Task 4). ✓
- Tagasitee, olemasolev nupp fookus-teadlikuks, parima-püüde (spec §3) → Task 5 + helper Task 1. ✓
- Grid ergonoomika 3–10 (spec §4) → Task 6. ✓
- ImageViewer Scissors + reset-ikoon Maximize2 (spec §1 ikoonid) → Task 2. ✓
- Admin-gate (spec privileegid) → Task 2 (`isAdmin && onManage`) + Task 3 (`isAdmin`); /manage oma kaitse muutumatu. ✓
- Backend muutmata → ükski task ei puuduta serverit. ✓

**Test-infra märkus:** projektis pole React-komponentide testimist (vitest `node`),
seega puhas loogika (`manageDeeplink.ts`) on TDD-ga kaetud (Task 1), komponendi-ühendus
verifitseeritakse käsitsi (Task 3/5/6 manuaalsed sammud). See vastab olemasolevale
muster — `src/utils/__tests__/` testib puhast loogikat, mitte komponente.

**Placeholder scan:** ei "TBD"/"TODO"; igas koodisammus täielik kood. ImageVieweri uue
nupu `className` on tahtlik "kopeeri naaberribanupult" (faili stiil pole konstandina
eraldatud) — verifitseeritav buildiga + manuaalselt.

**Type consistency:** `buildManageLink/parseFocusParam/buildBackToEditorPath` signatuurid
identsed Task 1 definitsiooni ja Task 3/5 kasutuse vahel. `ImageViewerProps.isAdmin/onManage`
(Task 2) = Workspace kasutus (Task 3). `PageCardProps.isFocused` + `forwardRef<HTMLDivElement>`
(Task 4) = WorkManage `ref`/`isFocused` kasutus (Task 5). `MIN_COLS/MAX_COLS` = 3/10 nii
Global Constraints kui Task 6.
