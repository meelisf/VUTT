# Teose osad — kasutajaliides (PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teose halduses on vahekaart **„Osad"**, mis on esimene ja vaikimisi aktiivne.
Sellel on lehtede ruudustik valiku ja osa märkidega, sisukord ning vorm osade loomiseks
ja muutmiseks. Kasutab PR 1 otspunkte `/works/{id}/parts`.

**Architecture:**
- Puhas mudel on `src/pages/manage/partsModel.ts` (märgid, järjestus, jagatud lehed,
  vormi mustand ↔ osa) ja seda testitakse node-keskkonnas.
- API klient on `src/services/workPartsApi.ts`.
- Komponendid on `src/pages/manage/parts/`: `PartsTab`, `PartsGrid`, `PartsList`,
  `PartForm`.
- `WorkManage` lisab vahekaardi ja teeb selle vaikimisi aktiivseks.
- Uusi sõltuvusi ei lisata. Olemas on `PageThumb`, `EntityPicker`, `WorkDatingInput` ja
  `useUnsavedChangesGuard`.

**Tech Stack:** React 19, TS, Tailwind, react-i18next, vitest (+ jsdom komponenditestis).

**Spec:** `docs/superpowers/specs/2026-09-26-teose-osad-design.md` §1 ja §5.

## Global Constraints

- i18n: võtmed `workspace:manage.parts.*` ja `workspace:metadata.roles.{addressee,participant}`
  **mõlemasse** keelde korraga (`localeParity`, `translationKeysResolve`). Arvuga
  sildid kasutavad vorme `_one/_other`.
- Komponenditest: `/** @vitest-environment jsdom */`. i18n tuleb sünkroonsest
  instantsist (muster `src/prosopography/components/relations/__tests__/testI18n.ts`;
  loo sama muster `src/pages/manage/parts/__tests__/testI18n.ts`, kuhu lähevad
  `workspace` ja `common`). Tagasi lükatud lubadust tagastavat `vi.fn`-i **ei kasutata**
  (vitest 4); mock tehakse tavafunktsiooniga.
- Salvestamata muudatused: ainult `useUnsavedChangesGuard` + `UnsavedChangesDialog`
  (CLAUDE.md). Uut confirm-varianti ei tehta.
- Kerib aken, mitte konteiner. Erand: sisukorra loend võib kerida oma konteineris.
- Number-sisendeid pole. Kuupäev tuleb `WorkDatingInput`-ist.
- Väravad: `npm run typecheck`, `npm test`, `npm run lint:ci` (≤ 42 hoiatust).
- Õigused: server kontrollib `can_write_work`-i. Kasutajaliides näitab 403 korral
  veateadet, mitte valget lehte.

## Review Focus

1. **Osa ilma lehtedeta (`needs_review`) sisukorras:** esile tõstetud, klikiga avatav, lehti
   saab lisada. Test Task 4-s.
2. **Server tagastab 409 (osale viitab lisa) või 400 (validatsioon):** vormis on
   veateade serveri tekstiga ja mustand jääb alles. Test Task 4-s.
3. **Leht mitmes osas:** ruudustikus on mõlema osa märk, vormis hoiatus. Test Task 2-s
   (mudel) ja Task 4-s.
4. **Teos 500 lehega:** ruudustik ei tee lehekaupa päringuid, märgid arvutatakse ühe
   korra (`useMemo`). Test Task 2-s (mudel annab kaardi ühe läbimisega).
5. **Vahekaardi vahetus salvestamata vormiga:** `useUnsavedChangesGuard` hoiatab. Test
   Task 4-s.

---

## Failide kaart

| Fail | Vastutus |
|---|---|
| `src/services/workPartsApi.ts` (uus) | tüübid `WorkPart`, `PartKind`, `PartRole`; `listParts`, `createPart`, `updatePart`, `deletePart`, `changePartPages` |
| `src/pages/manage/partsModel.ts` (uus) + `__tests__/partsModel.test.ts` | `pageBadges`, `sortParts`, `sharedStems`, `emptyDraft`, `draftFromPart`, `partFromDraft` |
| `src/pages/manage/parts/PartsTab.tsx` (uus) | olek, andmete laadimine, valik, toimingud |
| `src/pages/manage/parts/PartsGrid.tsx` (uus) | ruudustik: `PageThumb` + märgid + valik |
| `src/pages/manage/parts/PartsList.tsx` (uus) | sisukord |
| `src/pages/manage/parts/PartForm.tsx` (uus) | vorm |
| `src/pages/manage/parts/__tests__/PartsTab.test.tsx` (uus) | komponenditest |
| `src/pages/WorkManage.tsx` | vahekaart `parts` esimene ja vaikimisi |
| `src/locales/{et,en}/workspace.json` | võtmed |

---

### Task 1: API klient

**Files:** Create `src/services/workPartsApi.ts`, test `src/services/__tests__/workPartsApi.test.ts`.

**Interfaces — Produces:**
```ts
export type PartKind = 'letter' | 'poem' | 'speech' | 'session' | 'attachment';
export type PartRole = 'auctor' | 'addressee' | 'praeses' | 'participant' | 'subject';
export const PART_KINDS: PartKind[]; export const PART_ROLES: PartRole[];
export interface PartCreator { id?: string; name?: string; role: PartRole; source?: string; }
export interface WorkPart { id: string; kind: PartKind; pages: string[]; title?: string; incipit?: string;
  dating?: WorkDating; place?: { id: string | null; label: string }; place_to?: { id: string | null; label: string };
  creators: PartCreator[]; attached_to: string | null; languages?: string[]; notes?: string; needs_review: boolean; }
export type PartInput = Omit<WorkPart, 'id' | 'needs_review'>;
export function listParts(workId: string, token: string | null): Promise<WorkPart[]>;
export function createPart(workId: string, part: PartInput, token: string | null): Promise<WorkPart>;
export function updatePart(workId: string, partId: string, part: PartInput, token: string | null): Promise<WorkPart>;
export function deletePart(workId: string, partId: string, token: string | null): Promise<void>;
export function changePartPages(workId: string, partId: string, add: string[], remove: string[], token: string | null): Promise<WorkPart>;
```

- [ ] **Step 1: Failiv test**

```ts
// src/services/__tests__/workPartsApi.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ method: string; path: string; body?: unknown }> = [];
vi.mock('../apiClient', () => ({
  apiGet: (path: string) => { calls.push({ method: 'GET', path }); return Promise.resolve({ parts: [{ id: 'p1' }] }); },
  apiPost: (path: string, body: unknown) => { calls.push({ method: 'POST', path, body }); return Promise.resolve({ id: 'p1' }); },
  apiPut: (path: string, body: unknown) => { calls.push({ method: 'PUT', path, body }); return Promise.resolve({ id: 'p1' }); },
  apiDelete: (path: string) => { calls.push({ method: 'DELETE', path }); return Promise.resolve(null); },
}));

import { changePartPages, createPart, deletePart, listParts, updatePart } from '../workPartsApi';

beforeEach(() => { calls.length = 0; });

describe('workPartsApi', () => {
  it('kasutab /works/{id}/parts otspunkte', async () => {
    expect(await listParts('w1', 't')).toEqual([{ id: 'p1' }]);
    await createPart('w1', { kind: 'letter', pages: ['a'], creators: [], attached_to: null }, 't');
    await updatePart('w1', 'p1', { kind: 'letter', pages: ['a'], creators: [], attached_to: null }, 't');
    await changePartPages('w1', 'p1', ['b'], ['a'], 't');
    await deletePart('w1', 'p1', 't');
    expect(calls.map(c => `${c.method} ${c.path}`)).toEqual([
      'GET /works/w1/parts', 'POST /works/w1/parts', 'PUT /works/w1/parts/p1',
      'POST /works/w1/parts/p1/pages', 'DELETE /works/w1/parts/p1',
    ]);
    expect(calls[3].body).toEqual({ add: ['b'], remove: ['a'] });
  });

  it('kodeerib id-d URL-is', async () => {
    await deletePart('w 1', 'p/1', 't');
    expect(calls[0].path).toBe('/works/w%201/parts/p%2F1');
  });
});
```

- [ ] **Step 2:** `npx vitest run src/services/__tests__/workPartsApi.test.ts` → FAIL
- [ ] **Step 3: Implementeeri**

```ts
// src/services/workPartsApi.ts
/** Teose osade API (#464, ADR 0057): /works/{id}/parts. */
import { ApiRequestOptions, apiDelete, apiGet, apiPost, apiPut } from './apiClient';
import type { WorkDating } from '../types';

export type PartKind = 'letter' | 'poem' | 'speech' | 'session' | 'attachment';
export type PartRole = 'auctor' | 'addressee' | 'praeses' | 'participant' | 'subject';
export const PART_KINDS: PartKind[] = ['letter', 'poem', 'speech', 'session', 'attachment'];
export const PART_ROLES: PartRole[] = ['auctor', 'addressee', 'praeses', 'participant', 'subject'];

export interface PartCreator { id?: string; name?: string; role: PartRole; source?: string; }
export interface PartPlace { id: string | null; label: string; }
export interface WorkPart {
  id: string; kind: PartKind; pages: string[]; title?: string; incipit?: string;
  dating?: WorkDating; place?: PartPlace; place_to?: PartPlace; creators: PartCreator[];
  attached_to: string | null; languages?: string[]; notes?: string; needs_review: boolean;
}
export type PartInput = Omit<WorkPart, 'id' | 'needs_review'>;

const opts = (token: string | null): ApiRequestOptions => ({ token, timeout: 20000 });
const base = (workId: string) => `/works/${encodeURIComponent(workId)}/parts`;
const one = (workId: string, partId: string) => `${base(workId)}/${encodeURIComponent(partId)}`;

export async function listParts(workId: string, token: string | null): Promise<WorkPart[]> {
  const r = await apiGet<{ parts: WorkPart[] }>(base(workId), opts(token));
  return r.parts ?? [];
}
export const createPart = (workId: string, part: PartInput, token: string | null) =>
  apiPost<WorkPart>(base(workId), part, opts(token));
export const updatePart = (workId: string, partId: string, part: PartInput, token: string | null) =>
  apiPut<WorkPart>(one(workId, partId), part, opts(token));
export async function deletePart(workId: string, partId: string, token: string | null): Promise<void> {
  await apiDelete<unknown>(one(workId, partId), opts(token));
}
export const changePartPages = (workId: string, partId: string, add: string[], remove: string[], token: string | null) =>
  apiPost<WorkPart>(`${one(workId, partId)}/pages`, { add, remove }, opts(token));
```

`WorkDating` tüüp: kontrolli, kust seda eksporditakse (`grep -rn "export interface WorkDating" src`),
ja kohanda importi. `ApiRequestOptions.token` nimi: kontrolli `apiClient.ts:16`. Kui
workApi kasutab `auth(token, …)` abilist, kasuta sama.

- [ ] **Step 4:** PASS; `npm run typecheck` puhas
- [ ] **Step 5: Commit** `feat(works): teose osade API klient (#464)`

---

### Task 2: Puhas mudel

**Files:** Create `src/pages/manage/partsModel.ts`, test `src/pages/manage/__tests__/partsModel.test.ts`.

**Interfaces — Produces:**
```ts
export interface Badge { partId: string; index: number; kind: PartKind; }
export function sortParts(parts: WorkPart[], stems: string[]): WorkPart[];            // esimese lehe järgi; lehtedeta lõpus
export function pageBadges(parts: WorkPart[], stems: string[]): Map<string, Badge[]>;   // üks läbimine
export function sharedStems(part: WorkPart, parts: WorkPart[]): Map<string, string[]>; // tüvi → teiste osade id-d
export interface PartDraft { kind: PartKind; title: string; incipit: string; datingText: string; dating: WorkDating | null;
  place: PartPlace | null; place_to: PartPlace | null; creators: PartCreator[]; attached_to: string | null; notes: string; }
export function emptyDraft(kind?: PartKind): PartDraft;
export function draftFromPart(p: WorkPart): PartDraft;
export function partFromDraft(d: PartDraft, pages: string[]): PartInput;  // tühjad väljad välja; place_to ainult kirjal
```

- [ ] **Step 1: Failivad testid**

```ts
// src/pages/manage/__tests__/partsModel.test.ts
import { describe, it, expect } from 'vitest';
import { draftFromPart, emptyDraft, pageBadges, partFromDraft, sharedStems, sortParts } from '../partsModel';
import type { WorkPart } from '../../../services/workPartsApi';

const STEMS = ['s1', 's2', 's3', 's4'];
const P = (id: string, pages: string[], extra: Partial<WorkPart> = {}): WorkPart =>
  ({ id, kind: 'letter', pages, creators: [], attached_to: null, needs_review: false, ...extra });

describe('partsModel', () => {
  it('sortParts: esimese lehe järgi, lehtedeta lõpus', () => {
    const out = sortParts([P('b', ['s3']), P('x', [], { needs_review: true }), P('a', ['s2', 's4'])], STEMS);
    expect(out.map(p => p.id)).toEqual(['a', 'b', 'x']);
  });

  it('pageBadges: jagatud lehel mitu märki, number = sisukorra järjekord', () => {
    const m = pageBadges([P('b', ['s3']), P('a', ['s2', 's3'])], STEMS);
    expect(m.get('s3')!.map(b => [b.partId, b.index])).toEqual([['a', 1], ['b', 2]]);
    expect(m.get('s1')).toBeUndefined();
  });

  it('sharedStems: teiste osadega jagatud tüved', () => {
    const a = P('a', ['s2', 's3']);
    expect([...sharedStems(a, [a, P('b', ['s3'])])]).toEqual([['s3', ['b']]]);
  });

  it('draft ↔ osa: tühjad väljad välja, place_to ainult kirjal', () => {
    const d = { ...emptyDraft('poem'), title: ' ', place_to: { id: 'Q1', label: 'X' } };
    const input = partFromDraft(d, ['s1']);
    expect(input).toEqual({ kind: 'poem', pages: ['s1'], creators: [], attached_to: null });
    const back = draftFromPart(P('a', ['s1'], { title: 'T', kind: 'letter', place_to: { id: 'Q1', label: 'X' } }));
    expect(partFromDraft(back, ['s1'])).toMatchObject({ title: 'T', place_to: { id: 'Q1', label: 'X' } });
  });
});
```

- [ ] **Step 2:** FAIL
- [ ] **Step 3: Implementeeri**

```ts
// src/pages/manage/partsModel.ts
/** Teose osade kasutajaliidese puhas mudel (#464). */
import type { PartCreator, PartInput, PartKind, PartPlace, WorkPart } from '../../services/workPartsApi';
import type { WorkDating } from '../../types';

export interface Badge { partId: string; index: number; kind: PartKind; }

export function sortParts(parts: WorkPart[], stems: string[]): WorkPart[] {
  const pos = new Map(stems.map((s, i) => [s, i]));
  const first = (p: WorkPart) => Math.min(...p.pages.map(s => pos.get(s) ?? Infinity), Infinity);
  return [...parts].sort((a, b) => first(a) - first(b) || a.id.localeCompare(b.id));
}

export function pageBadges(parts: WorkPart[], stems: string[]): Map<string, Badge[]> {
  const out = new Map<string, Badge[]>();
  sortParts(parts, stems).forEach((p, i) => {
    for (const s of p.pages) {
      if (!out.has(s)) out.set(s, []);
      out.get(s)!.push({ partId: p.id, index: i + 1, kind: p.kind });
    }
  });
  return out;
}

export function sharedStems(part: WorkPart, parts: WorkPart[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of part.pages) {
    const others = parts.filter(o => o.id !== part.id && o.pages.includes(s)).map(o => o.id);
    if (others.length) out.set(s, others);
  }
  return out;
}

export interface PartDraft {
  kind: PartKind; title: string; incipit: string; datingText: string; dating: WorkDating | null;
  place: PartPlace | null; place_to: PartPlace | null; creators: PartCreator[]; attached_to: string | null; notes: string;
}

export const emptyDraft = (kind: PartKind = 'letter'): PartDraft => ({
  kind, title: '', incipit: '', datingText: '', dating: null, place: null, place_to: null,
  creators: [], attached_to: null, notes: '',
});

export function draftFromPart(p: WorkPart): PartDraft {
  return {
    kind: p.kind, title: p.title ?? '', incipit: p.incipit ?? '',
    datingText: p.dating?.source_text ?? p.dating?.start ?? '', dating: p.dating ?? null,
    place: p.place ?? null, place_to: p.place_to ?? null, creators: p.creators ?? [],
    attached_to: p.attached_to ?? null, notes: p.notes ?? '',
  };
}

export function partFromDraft(d: PartDraft, pages: string[]): PartInput {
  const out: PartInput = { kind: d.kind, pages, creators: d.creators.filter(c => c.id || c.name), attached_to: d.kind === 'attachment' ? d.attached_to : null };
  if (d.title.trim()) out.title = d.title.trim();
  if (d.incipit.trim()) out.incipit = d.incipit.trim();
  if (d.notes.trim()) out.notes = d.notes.trim();
  if (d.dating) out.dating = d.dating;
  if (d.place) out.place = d.place;
  if (d.place_to && d.kind === 'letter') out.place_to = d.place_to;
  return out;
}
```

- [ ] **Step 4:** PASS; typecheck
- [ ] **Step 5: Commit** `feat(works): teose osade kasutajaliidese mudel (#464)`

---

### Task 3: i18n

**Files:** `src/locales/{et,en}/workspace.json`.

- [ ] Lisa `metadata.roles` alla `"addressee": "Adressaat"` / `"Addressee"` ja
  `"participant": "Osaleja"` / `"Participant"`.
- [ ] Lisa `manage` alla `"tabParts"` (et „Osad", en „Parts") ja objekt `"parts"`:

et:
```json
"parts": {
  "kinds": { "letter": "Kiri", "poem": "Luuletus", "speech": "Kõne", "session": "Istung", "attachment": "Lisa" },
  "create": "Loo osa valitud lehtedest",
  "addToPart": "Lisa valitud lehed osale",
  "removeFromPart": "Eemalda valitud lehed osast",
  "selected_one": "{{count}} leht valitud",
  "selected_other": "{{count}} lehte valitud",
  "empty": "Osi pole veel märgitud. Vali ruudustikust lehed ja loo osa.",
  "needsReview": "Lehed puuduvad — vaata üle",
  "pages_one": "{{count}} leht",
  "pages_other": "{{count}} lehte",
  "kind": "Liik",
  "title": "Pealkiri",
  "incipit": "Algus",
  "dating": "Aeg",
  "place": "Koht",
  "placeLetter": "Kirjutamiskoht",
  "placeTo": "Sihtkoht",
  "persons": "Isikud",
  "addPerson": "Lisa isik",
  "role": "Roll",
  "attachedTo": "Lisa osale",
  "notes": "Märkused",
  "save": "Salvesta osa",
  "delete": "Kustuta osa",
  "openPage": "Ava leht töölaual",
  "sharedWarning": "Leht {{stem}} kuulub ka teise osasse; sellel lehel mainitud isikud seotakse mõlemaga.",
  "error": "Salvestamine ebaõnnestus: {{message}}"
}
```
en: samad võtmed („Letter", „Poem", „Speech", „Session", „Attachment", „Create a part from
the selected pages", „Add selected pages to part", „Remove selected pages from part",
„{{count}} page selected/pages selected", „No parts yet. Select pages in the grid and
create a part.", „No pages — review", „{{count}} page/pages", „Kind", „Title", „Incipit",
„Date", „Place", „Place of writing", „Destination", „Persons", „Add person", „Role",
„Attachment to", „Notes", „Save part", „Delete part", „Open page in workspace",
„Page {{stem}} also belongs to another part; persons mentioned on this page are linked
to both.", „Saving failed: {{message}}").

- [ ] `npx vitest run src/locales` → PASS
- [ ] **Commit** `feat(works): osade vahekaardi tõlked (#464)`

---

### Task 4: Komponendid ja vahekaart

**Files:** Create `src/pages/manage/parts/{PartsTab,PartsGrid,PartsList,PartForm}.tsx`,
`src/pages/manage/parts/__tests__/{PartsTab.test.tsx,testI18n.ts}`; Modify `src/pages/WorkManage.tsx`.

**Interfaces:**
- `PartsTab({ workId, pages, token, imageToken, thumbCacheBust, onDirtyChange })`, kus
  `pages: WorkPageInfo[]` on `WorkManage`-i olemasolev olek. `onDirtyChange(dirty: boolean)`
  annab `WorkManage`-i `useUnsavedChangesGuard`-ile teada, et vormis on salvestamata
  muudatusi.
- `PartsGrid({ pages, badges, selected, activePartPages, onToggle(filename, shift), workId, imageToken, thumbCacheBust })`
- `PartsList({ parts, stems, activeId, onSelect })`
- `PartForm({ part | null, draft, onDraft, onSave, onDelete, parts, sharedWarning, error, busy })`

- [ ] **Step 1: Failivad testid** (`PartsTab.test.tsx`; mockid `workPartsApi` tavafunktsioonidega,
  `PageThumb` → `<div data-testid="thumb-{filename}"/>`, `EntityPicker` → lihtne sisend).

```tsx
/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import './testI18n';

const { api } = vi.hoisted(() => ({ api: {
  parts: [] as any[], calls: [] as string[], fail: null as null | { status: number; message: string },
} }));
vi.mock('../../../../services/workPartsApi', async (orig) => ({
  ...(await orig<typeof import('../../../../services/workPartsApi')>()),
  listParts: async () => api.parts,
  createPart: async (_w: string, p: any) => {
    api.calls.push('create');
    if (api.fail) { const e: any = new Error(api.fail.message); e.status = api.fail.status; throw e; }
    const np = { ...p, id: 'n1', needs_review: false }; api.parts = [...api.parts, np]; return np;
  },
  updatePart: async (_w: string, id: string, p: any) => { api.calls.push('update'); return { ...p, id, needs_review: false }; },
  deletePart: async () => {
    api.calls.push('delete');
    if (api.fail) { const e: any = new Error(api.fail.message); e.status = api.fail.status; throw e; }
  },
  changePartPages: async (_w: string, id: string, add: string[]) => { api.calls.push(`pages:${add.join(',')}`); return { ...api.parts[0], pages: [...api.parts[0].pages, ...add] }; },
}));
vi.mock('../../PageThumb', () => ({ default: ({ src }: { src: string }) => <div data-testid={`thumb-${src}`} /> }));
vi.mock('../../../../components/EntityPicker', () => ({ default: () => <input aria-label="entity" /> }));

import PartsTab from '../PartsTab';

const PAGES = ['s1', 's2', 's3'].map((s, i) => ({ page_num: i + 1, sequence: i, base_name: s, filename: `${s}.jpg`,
  lehekylje_pilt: `/x/${s}.jpg`, status: 'Toores', has_text: true }));
const renderTab = () => render(<MemoryRouter><PartsTab workId="w1" pages={PAGES} token="t" imageToken="" thumbCacheBust={0} onDirtyChange={() => {}} /></MemoryRouter>);

beforeEach(() => { api.parts = []; api.calls = []; api.fail = null; });

describe('PartsTab', () => {
  it('tühi olek + osa loomine valitud lehtedest', async () => {
    renderTab();
    expect(await screen.findByText(/Osi pole veel märgitud/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('page-s1'));
    fireEvent.click(screen.getByTestId('page-s3'), { shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Loo osa valitud lehtedest' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Salvesta osa' }));
    await waitFor(() => expect(api.calls).toContain('create'));
  });

  it('needs_review osa on esile tõstetud ja avatav', async () => {
    api.parts = [{ id: 'x', kind: 'letter', pages: [], creators: [], attached_to: null, needs_review: true }];
    renderTab();
    expect(await screen.findByText('Lehed puuduvad — vaata üle')).toBeTruthy();
  });

  it('jagatud leht: kaks märki ja hoiatus vormis', async () => {
    api.parts = [
      { id: 'a', kind: 'letter', pages: ['s1', 's2'], creators: [], attached_to: null, needs_review: false },
      { id: 'b', kind: 'letter', pages: ['s2', 's3'], creators: [], attached_to: null, needs_review: false },
    ];
    renderTab();
    await screen.findAllByTestId('badge-s2-a');
    expect(screen.getByTestId('badge-s2-b')).toBeTruthy();
    fireEvent.click(screen.getByTestId('part-a'));
    expect(await screen.findByText(/kuulub ka teise osasse/)).toBeTruthy();
  });

  it('serveri viga: teade serveri tekstiga, mustand jääb', async () => {
    api.fail = { status: 409, message: 'Osale viitavad lisad' };
    api.parts = [{ id: 'a', kind: 'session', pages: ['s1'], creators: [], attached_to: null, needs_review: false }];
    renderTab();
    fireEvent.click(await screen.findByTestId('part-a'));
    fireEvent.click(screen.getByRole('button', { name: 'Kustuta osa' }));
    expect(await screen.findByText(/Osale viitavad lisad/)).toBeTruthy();
  });
});
```

Test `WorkManage` jaoks (lisa olemasolevasse `src/pages/__tests__/WorkManage*.test.tsx`, kui
see on olemas; muidu kontrolli seda käsitsi, sest `WorkManage`-il on palju sõltuvusi):
avamisel on vaikimisi aktiivne vahekaart „Osad".

- [ ] **Step 2:** FAIL
- [ ] **Step 3: Implementeeri**

  - **`PartsTab`:**
    - Oleks: `parts`, `selected` (Set failinimedest), `anchor`, `activeId`, `draft`,
      `dirty`, `error`, `busy`.
    - `listParts` laetakse mountimisel.
    - `stems = pages.map(p => p.base_name)` teose järjekorras;
      `badges = useMemo(() => pageBadges(parts, stems))`.
    - Toiminguriba on nähtav, kui `selected.size > 0`:
      - „Loo osa valitud lehtedest" avab vormi tühja mustandiga, lehtedeks valitud tüved;
      - kui `activeId` on valitud, siis „Lisa valitud lehed osale" / „Eemalda valitud
        lehed osast" (`changePartPages`).
    - Salvestus: kui `activeId` on olemas → `updatePart`, muidu `createPart`; pärast seda
      laaditakse loend uuesti.
    - Vead (`e.status` / `e.message`) kuvatakse `t('manage.parts.error', { message })` kujul
      ja mustand jääb alles.
    - `onDirtyChange(dirty)` kutsutakse iga `dirty` muutuse peale.
  - **`PartsGrid`:**
    - Sama veergude arv ja kuju mis lehtede ruudustikul (`grid-template-columns`).
    - Iga lehe kaart: `data-testid="page-{base_name}"`, klikk (ja Shift-vahemik) valib.
    - `PageThumb` (`src` nagu `PageCard`-il).
    - Märgid: `data-testid="badge-{stem}-{partId}"`, osa järjekorranumber ja liigi
      esitäht (K/L/Kõ/I/Li) värviga liigi järgi.
    - Aktiivse osa lehed on esile tõstetud (`ring-2`).
    - Link „Ava leht töölaual": `/work/{workId}/{page_num}`, `target="_blank"`.
  - **`PartsList`:** `sortParts`-i järgi, kirje nupuna `data-testid="part-{id}"`. Kirjel on
    liik, pealkiri (või esimene isik), aasta ja lehtede arv (`pages_one/_other`).
    `needs_review` osal on amber-märk tekstiga `manage.parts.needsReview`.
  - **`PartForm`:**
    - Liigi valik (`PART_KINDS`, sildid `manage.parts.kinds.*`), pealkiri, algus.
    - Aeg: `WorkDatingInput` (`value={draft.datingText}`, `dating={draft.dating}`).
    - Koht: `EntityPicker type="place"`. Kirja puhul on silt `placeLetter` ja lisaks
      väli sihtkoht (`place_to`).
    - Isikud: rida = `EntityPicker type="person" showPersonToggle token={token}` + rolli
      valik (`PART_ROLES`, sildid `metadata.roles.*`) + eemalda.
    - Lisa korral valik „Lisa osale": teised osad, v.a lisad.
    - Märkused.
    - Jagatud lehtede hoiatus (`sharedStems`, `manage.parts.sharedWarning`).
    - Nupud „Salvesta osa" ja „Kustuta osa" (kustuta ainult olemasoleval osal).
  - **`WorkManage`:**
    - `type ActiveTab = 'parts' | 'pages' | 'trash' | 'replace'`, algväärtus `'parts'`.
    - Vahekaardi nupp „Osad" on esimesena. Sisu:
      `{activeTab === 'parts' && <PartsTab workId={workId!} pages={pages} token={authToken} imageToken={imageToken} thumbCacheBust={thumbCacheBust} onDirtyChange={setPartsDirty} />}`.
    - `useUnsavedChangesGuard({ isDirty: partsDirty, onSave: async () => false })` +
      `<UnsavedChangesDialog {...dialogProps} />`. `onSave` tagastab `false`: dialoogis
      pakutakse ainult loobumist ja tagasipöördumist. Salvestus käib vormis. Kontrolli
      `UnsavedChangesDialog`-i propse; kui dialoog vajab salvestusnuppu, anna `onSave`
      kaudu vormi salvestus (`PartsTab` eksponeerib selle `ref`-iga).

- [ ] **Step 4:** `npx vitest run src/pages src/services src/locales` → PASS; typecheck
- [ ] **Step 5: Commit** `feat(works): „Osad" vahekaart teose halduses (#464)`

---

### Task 5: Väravad ja bundle

- [ ] `npm run typecheck && npm test && npm run lint:ci`: typecheck ja testid puhtad, lint ≤ 42
- [ ] `npm run build`: `WorkManage` chunk'i gzip-muutus PR-i kirjeldusse
- [ ] Käsitsi pärast deploy'd: `o17ekb` → „Osad". Loo kiri lk 7–8 ja lisa selle juurde
  vahelehed eraldi lisana; kontrolli märke, sisukorda ja „Ava leht töölaual".
