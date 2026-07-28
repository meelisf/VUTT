# Ühtne salvestamata muudatuste dialoog — implementatsiooniplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Asendada neli erinevat salvestamata muudatuste hoiatust ühe dialoogiga, millel on kolm valikut (Loobu muudatustest / Jää siia / Salvesta ja jätka) ja üks ettearvatav käitumismudel.

**Architecture:** Kolm kihti. `unsavedChangesFlow.ts` on puhas olekumasin (ei Reacti, ei DOM-i) — siin elavad kõik otsused ja seda katavad testid. `useUnsavedChangesGuard.ts` on Reacti kiht — Router `useBlocker`, `beforeunload`, async `onSave` ja ühekordne möödapääs. `UnsavedChangesDialog.tsx` on puhas presentatsioon — renderdab, hoiab fookust, kuulab klahve, ei tea ootel tegevusest midagi.

**Tech Stack:** React 19, TypeScript, react-router-dom `useBlocker`, Tailwind, i18next, Vitest (`environment: 'node'`).

**Spec:** `docs/superpowers/specs/2026-07-28-uhtne-salvestamata-muudatuste-dialoog-design.md`

**Haru:** `feat/uhtne-salvestamata-dialoog` (juba olemas, spec on seal commitis)

## Global Constraints

- **Kommentaarid koodis on eesti keeles.** UI on eesti + inglise.
- **Tõlkevõti tuleb lisada MÕLEMASSE keelde korraga** (`src/locales/et/` ja `src/locales/en/`). `fallbackLng` on välja lülitatud (ADR 0011) — puuduv võti katkestab buildi testis `src/locales/__tests__/localeParity.test.ts`.
- **Väravad enne iga commit'i:** `npm run typecheck` ja `npm run test` peavad mõlemad läbima.
- **ESLint lävi:** `npm run lint` `--max-warnings 56`. Parandades LANGETA arvu, ära tõsta.
- Ei lisata uusi npm-sõltuvusi. Vitest jääb `environment: 'node'`, `include: ['src/**/*.test.ts']`.
- Kollane nupp on **`bg-amber-600 text-white`** (sama mis `MetadataModal.tsx:922`). Ära muuda ühtegi olemasolevat kollast nuppu — kontrasti parandus on eraldi ülesanne.
- Punane nupp on **`bg-red-600 hover:bg-red-700 text-white`** (sama mis `Places.tsx:302`).
- Töö käib lokaalselt. Serverisse midagi ei deploy'ta selle plaani raames.

---

## Failide struktuur

| Fail | Vastutus |
|---|---|
| `src/hooks/unsavedChangesFlow.ts` | **uus.** Puhas olekumasin: ootel tegevus, salvestusolek, ühekordne möödapääs. Ei impordi Reacti. |
| `src/hooks/__tests__/unsavedChangesFlow.test.ts` | **uus.** 13 testi olekumasinale. |
| `src/components/UnsavedChangesDialog.tsx` | **uus.** Kolme-nupu dialoog. Puhas presentatsioon, 6 propi. |
| `src/hooks/useUnsavedChangesGuard.ts` | Ümber kirjutatud. Reacti kiht olekumasina ümber. |
| `src/components/editor/useEditorSave.ts` | `runSave` / `handleSaveWithDrafts` tagastavad `boolean`. |
| `src/pages/Workspace.tsx` | `pendingNavigation` ja `requestAnimationFrame` hack kaovad. |
| `src/prosopography/pages/PersonEditPage.tsx` | `handleSave` jagatud; `skipGuardRef` → `allowNextNavigation()`. |
| `src/pages/admin/PlacesDetail.tsx` | Päris dirty-arvutus; `handleSave` tagastab `boolean`; salvestus `saveRef`-i kaudu üles. |
| `src/pages/admin/Places.tsx` | Guard lisatud; käsitsi modaal kaob. |
| `src/pages/WorkManage.tsx` | `window.confirm` → `ConfirmModal`; guard lisatud. |
| `src/components/ConfirmModal.tsx` | Esc + taustaklõps = tühista. |
| `src/locales/{et,en}/common.json` | `unsavedChanges` plokk laiendatud. |
| `src/locales/{et,en}/workspace.json` | `confirm.*` eemaldatud; `manage.reorder*` täiendatud. |
| `src/locales/{et,en}/admin.json` | `places.unsaved*` eemaldatud. |

---

## Task 1: Puhas olekumasin

**Files:**
- Create: `src/hooks/unsavedChangesFlow.ts`
- Test: `src/hooks/__tests__/unsavedChangesFlow.test.ts`

**Interfaces:**
- Consumes: midagi (esimene ülesanne)
- Produces: `GuardState`, `PendingTransition`, `initialGuardState`, `requestTransition`, `stay`, `discard`, `beginSave`, `finishSave`, `allowNextTransition`, `consumeAllowance`. Kõik järgnevad ülesanded kasutavad neid.

**Taust:** Miks puhas moodul? Vitest on projektis `environment: 'node'` ja `include: ['src/**/*.test.ts']` — komponenditestide infrat (jsdom, testing-library) ei ole ja seda ei lisata. Sama mustrit kasutab juba `src/components/markdownEditorHelpers.ts` + selle test. Kriitiline invariant (ebaõnnestunud salvestus EI navigeeri) saab siin päris katte.

- [ ] **Step 1: Kirjuta ebaõnnestuv test**

Loo `src/hooks/__tests__/unsavedChangesFlow.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  initialGuardState,
  requestTransition,
  stay,
  discard,
  beginSave,
  finishSave,
  allowNextTransition,
  consumeAllowance,
} from '../unsavedChangesFlow';

describe('requestTransition', () => {
  it('lubab ülemineku kohe, kui muudatusi ei ole', () => {
    const run = vi.fn();
    const r = requestTransition(initialGuardState, false, { run });
    expect(r.runNow).toBe(true);
    expect(r.state.pending).toBeNull();
  });

  it('paneb ülemineku ootele, kui on salvestamata muudatusi', () => {
    const run = vi.fn();
    const r = requestTransition(initialGuardState, true, { run });
    expect(r.runNow).toBe(false);
    expect(r.state.pending?.run).toBe(run);
  });

  it('esimene ootel tegevus võidab — uus ei asenda seda', () => {
    const first = vi.fn();
    const second = vi.fn();
    const a = requestTransition(initialGuardState, true, { run: first });
    const b = requestTransition(a.state, true, { run: second });
    expect(b.runNow).toBe(false);
    expect(b.state.pending?.run).toBe(first);
  });

  it('salvestamise ajal saabuv uus soov ei muuda ootel tegevust', () => {
    const first = vi.fn();
    const second = vi.fn();
    const a = requestTransition(initialGuardState, true, { run: first });
    const saving = beginSave(a.state);
    const b = requestTransition(saving.state, true, { run: second });
    expect(b.runNow).toBe(false);
    expect(b.state.pending?.run).toBe(first);
    expect(b.state.saving).toBe(true);
  });
});

describe('stay', () => {
  it('eemaldab ootel tegevuse täielikult', () => {
    const run = vi.fn();
    const a = requestTransition(initialGuardState, true, { run });
    const s = stay(a.state);
    expect(s.pending).toBeNull();
    expect(s.saveFailed).toBe(false);
    expect(s.allowNext).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('kustutab ka eelmise salvestusvea', () => {
    const a = requestTransition(initialGuardState, true, { run: vi.fn() });
    const failed = finishSave(beginSave(a.state).state, false);
    expect(failed.state.saveFailed).toBe(true);
    expect(stay(failed.state).saveFailed).toBe(false);
  });
});

describe('discard', () => {
  it('vabastab ootel tegevuse salvestamata ja annab ühekordse loa', () => {
    const run = vi.fn();
    const a = requestTransition(initialGuardState, true, { run });
    const d = discard(a.state);
    expect(d.action).toBe(run);
    expect(d.state.pending).toBeNull();
    expect(d.state.allowNext).toBe(true);
  });

  it('ei jäta möödapääsu aktiivseks pärast tarbimist', () => {
    const a = requestTransition(initialGuardState, true, { run: vi.fn() });
    const d = discard(a.state);
    const c = consumeAllowance(d.state);
    expect(c.allowed).toBe(true);
    expect(c.state.allowNext).toBe(false);
    expect(consumeAllowance(c.state).allowed).toBe(false);
  });
});

describe('beginSave', () => {
  it('alustab salvestamist, kui see veel ei käi', () => {
    const a = requestTransition(initialGuardState, true, { run: vi.fn() });
    const b = beginSave(a.state);
    expect(b.start).toBe(true);
    expect(b.state.saving).toBe(true);
    expect(b.state.saveFailed).toBe(false);
  });

  it('topeltklikk ei alusta teist salvestust', () => {
    const a = requestTransition(initialGuardState, true, { run: vi.fn() });
    const first = beginSave(a.state);
    const second = beginSave(first.state);
    expect(second.start).toBe(false);
    expect(second.state).toBe(first.state);
  });
});

describe('finishSave', () => {
  it('käivitab ootel tegevuse, kui salvestamine õnnestus', () => {
    const run = vi.fn();
    const a = requestTransition(initialGuardState, true, { run });
    const f = finishSave(beginSave(a.state).state, true);
    expect(f.action).toBe(run);
    expect(f.state.pending).toBeNull();
    expect(f.state.saving).toBe(false);
    expect(f.state.allowNext).toBe(true);
  });

  it('EI käivita ootel tegevust, kui salvestamine ebaõnnestus', () => {
    const run = vi.fn();
    const a = requestTransition(initialGuardState, true, { run });
    const f = finishSave(beginSave(a.state).state, false);
    expect(f.action).toBeNull();
    expect(f.state.pending?.run).toBe(run);
    expect(f.state.saving).toBe(false);
    expect(f.state.saveFailed).toBe(true);
    expect(f.state.allowNext).toBe(false);
  });

  it('pärast ebaõnnestunud salvestust saab uuesti salvestada', () => {
    const run = vi.fn();
    const a = requestTransition(initialGuardState, true, { run });
    const failed = finishSave(beginSave(a.state).state, false);
    const retry = beginSave(failed.state);
    expect(retry.start).toBe(true);
    expect(retry.state.saveFailed).toBe(false);
    const ok = finishSave(retry.state, true);
    expect(ok.action).toBe(run);
  });

  it('nullib oleku enne tegevuse tagastamist — tegevuse erind ei jäta guardi rippu', () => {
    const run = vi.fn(() => { throw new Error('navigate failed'); });
    const a = requestTransition(initialGuardState, true, { run });
    const f = finishSave(beginSave(a.state).state, true);
    expect(f.state.saving).toBe(false);
    expect(f.state.pending).toBeNull();
    expect(() => f.action?.()).toThrow('navigate failed');
    expect(f.state.saving).toBe(false);
    expect(f.state.pending).toBeNull();
  });
});

describe('allowNextTransition', () => {
  it('märgib järgmise ülemineku lubatuks ja luba on ühekordne', () => {
    const s = allowNextTransition(initialGuardState);
    const first = consumeAllowance(s);
    expect(first.allowed).toBe(true);
    expect(consumeAllowance(first.state).allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub läbi**

Run: `npm run test -- src/hooks/__tests__/unsavedChangesFlow.test.ts`
Expected: FAIL — `Failed to resolve import "../unsavedChangesFlow"`

- [ ] **Step 3: Kirjuta olekumasin**

Loo `src/hooks/unsavedChangesFlow.ts`:

```ts
/**
 * Salvestamata muudatuste dialoogi olekumasin.
 *
 * Puhas moodul: ei impordi Reacti ega puutu DOM-i. Kõik otsused elavad siin,
 * `useUnsavedChangesGuard` on ainult Reacti kiht selle ümber. Nii saab kriitilise
 * invariandi (ebaõnnestunud salvestus EI käivita ootel tegevust) katta testidega
 * ilma jsdom/testing-library sõltuvusteta.
 */

/** Ootel üleminek — navigeerimine, lehepööre või koha vahetus. */
export interface PendingTransition {
  run: () => void;
}

export interface GuardState {
  /** Ootel üleminek, mida dialoog kinnitama ootab. `null` = dialoog on kinni. */
  pending: PendingTransition | null;
  /** Salvestamine käib — nupud, Esc ja taustaklõps on blokeeritud. */
  saving: boolean;
  /** Viimane salvestuskatse ebaõnnestus — dialoogis on vearida. */
  saveFailed: boolean;
  /** Ühekordne möödapääs: järgmine üleminek lastakse guardist läbi. */
  allowNext: boolean;
}

export const initialGuardState: GuardState = {
  pending: null,
  saving: false,
  saveFailed: false,
  allowNext: false,
};

export interface RequestResult {
  state: GuardState;
  /** Kas kutsuja peab tegevuse kohe käivitama (puhas olek). */
  runNow: boolean;
}

/** Tulemus, mille juures kutsuja käivitab `action`-i, kui see ei ole `null`. */
export interface ResolveResult {
  state: GuardState;
  action: (() => void) | null;
}

/**
 * Üleminekusoov. Puhta oleku korral lubatakse kohe, muidu läheb ootele.
 *
 * Esimene ootel tegevus võidab: kui midagi juba ootab, uut ei võeta vastu. Vastasel
 * juhul muutuks "Salvesta ja jätka" sihtkoht kasutaja jaoks ettearvamatuks.
 */
export function requestTransition(
  state: GuardState,
  isDirty: boolean,
  pending: PendingTransition,
): RequestResult {
  if (state.pending !== null) return { state, runNow: false };
  if (!isDirty) return { state, runNow: true };
  return { state: { ...state, pending, saveFailed: false }, runNow: false };
}

/** "Jää siia" — ootel tegevus visatakse ära, dialoog sulgub. */
export function stay(state: GuardState): GuardState {
  return { ...state, pending: null, saveFailed: false };
}

/**
 * "Loobu muudatustest" — ootel tegevus vabastatakse salvestamata.
 *
 * Möödapääs seatakse, sest tegevus tavaliselt navigeerib ja `isDirty` on Reacti
 * järgmise renderduseni veel `true` — ilma selleta avaneks dialoog kohe uuesti.
 */
export function discard(state: GuardState): ResolveResult {
  const action = state.pending?.run ?? null;
  return {
    state: { ...state, pending: null, saveFailed: false, allowNext: action !== null },
    action,
  };
}

/** "Salvesta ja jätka" algus. `start: false` = salvestamine juba käib (topeltklikk). */
export function beginSave(state: GuardState): { state: GuardState; start: boolean } {
  if (state.saving || state.pending === null) return { state, start: false };
  return { state: { ...state, saving: true, saveFailed: false }, start: true };
}

/**
 * Salvestuse tulemus.
 *
 * `saved === false` (ka erindi korral, mille kutsuja teisendab `false`-ks): ootel
 * tegevus jääb alles, dialoog jääb avatuks, midagi ei kao.
 */
export function finishSave(state: GuardState, saved: boolean): ResolveResult {
  if (!saved) {
    return { state: { ...state, saving: false, saveFailed: true }, action: null };
  }
  const action = state.pending?.run ?? null;
  return {
    state: { ...state, pending: null, saving: false, saveFailed: false, allowNext: action !== null },
    action,
  };
}

/** Märgib järgmise ülemineku lubatuks. Kasutab `allowNextNavigation()` avalik API. */
export function allowNextTransition(state: GuardState): GuardState {
  return { ...state, allowNext: true };
}

/** Kontrollib ja tarbib ühekordse loa. Luba kehtib täpselt ühe ülemineku kohta. */
export function consumeAllowance(state: GuardState): { state: GuardState; allowed: boolean } {
  if (!state.allowNext) return { state, allowed: false };
  return { state: { ...state, allowNext: false }, allowed: true };
}
```

- [ ] **Step 4: Käivita testid ja veendu, et need läbivad**

Run: `npm run test -- src/hooks/__tests__/unsavedChangesFlow.test.ts`
Expected: PASS, 15 testi

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: vigadeta

- [ ] **Step 6: Commit**

```bash
git add src/hooks/unsavedChangesFlow.ts src/hooks/__tests__/unsavedChangesFlow.test.ts
git commit -m "feat: salvestamata muudatuste olekumasin (puhas moodul + testid)"
```

---

## Task 2: Dialoogikomponent ja tõlked

**Files:**
- Create: `src/components/UnsavedChangesDialog.tsx`
- Modify: `src/locales/et/common.json:199-204`, `src/locales/en/common.json:199-204`

**Interfaces:**
- Consumes: midagi Task 1-st (dialoog on puhas presentatsioon, ei tunne olekumasinat)
- Produces: `UnsavedChangesDialog` komponent ja `UnsavedChangesDialogProps` tüüp:
  ```ts
  { open: boolean; saving: boolean; saveFailed: boolean;
    onDiscard: () => void; onStay: () => void; onSaveAndContinue: () => void }
  ```

**Taust:** Dialoog EI oma async-voogu — see kuulub hook'ile (Task 3). Siin on ainult renderdus, fookus ja klahvid.

- [ ] **Step 1: Lisa tõlkevõtmed mõlemasse keelde**

`src/locales/et/common.json` — asenda olemasolev `unsavedChanges` plokk (rida 199):

```json
  "unsavedChanges": {
    "title": "Salvestamata muudatused",
    "message": "Sul on salvestamata muudatusi.",
    "discard": "Loobu muudatustest",
    "stay": "Jää siia",
    "saveAndContinue": "Salvesta ja jätka",
    "saving": "Salvestan…",
    "saveFailed": "Salvestamine ebaõnnestus — muudatused on alles."
  },
```

`src/locales/en/common.json` — asenda olemasolev `unsavedChanges` plokk (rida 199):

```json
  "unsavedChanges": {
    "title": "Unsaved changes",
    "message": "You have unsaved changes.",
    "discard": "Discard changes",
    "stay": "Stay here",
    "saveAndContinue": "Save and continue",
    "saving": "Saving…",
    "saveFailed": "Save failed — your changes are still here."
  },
```

- [ ] **Step 2: Kontrolli, et keelepaarsus on korras**

Run: `npm run test -- src/locales/__tests__/localeParity.test.ts`
Expected: PASS

- [ ] **Step 3: Kirjuta dialoogikomponent**

Loo `src/components/UnsavedChangesDialog.tsx`:

```tsx
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2 } from 'lucide-react';

export interface UnsavedChangesDialogProps {
  open: boolean;
  /** Salvestamine käib — kõik nupud, Esc ja taustaklõps on blokeeritud. */
  saving: boolean;
  /** Viimane salvestuskatse ebaõnnestus — näita vearida. */
  saveFailed: boolean;
  onDiscard: () => void;
  onStay: () => void;
  onSaveAndContinue: () => void;
}

/**
 * Ühtne salvestamata muudatuste dialoog. Puhas presentatsioon: ootel tegevusest,
 * salvestusfunktsioonist ega navigeerimisest ei tea siin miski midagi — see kõik
 * elab `useUnsavedChangesGuard`-is ja `unsavedChangesFlow`-s.
 *
 * Nupud on KÕIKJAL identsed (järjekord, värv, tekst), ka siis kui dialoog tuli
 * lehepöördest, mitte lahkumisest. Sihtkohta nupusildid ei nimeta.
 */
const UnsavedChangesDialog: React.FC<UnsavedChangesDialogProps> = ({
  open, saving, saveFailed, onDiscard, onStay, onSaveAndContinue,
}) => {
  const { t } = useTranslation('common');
  const dialogRef = useRef<HTMLDivElement>(null);
  const stayButtonRef = useRef<HTMLButtonElement>(null);
  // Element, millelt fookus tuli — sinna see sulgemisel tagastatakse.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Fookus avanemisel kõige ohutumale valikule ("Jää siia"), et Enter ei teeks
  // midagi hävitavat.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    stayButtonRef.current?.focus();
    return () => { previouslyFocusedRef.current?.focus?.(); };
  }, [open]);

  // Esc = "Jää siia", AGA mitte salvestamise ajal: muidu sulguks dialoog, salvestus
  // jätkuks taustal ja hiljem saabuv vastus käivitaks navigeerimise ajal, mil
  // kasutaja juba jätkab redigeerimist.
  //
  // Sama effect hoiab fookuse dialoogi sees (Tab ei vii välja).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!saving) { e.preventDefault(); onStay(); }
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled])',
      );
      if (!focusable || focusable.length === 0) { e.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, saving, onStay]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onMouseDown={e => { if (e.target === e.currentTarget && !saving) onStay(); }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        aria-describedby="unsaved-changes-message"
        aria-busy={saving}
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
          <div className="p-2 bg-amber-100 rounded-full">
            <AlertTriangle className="text-amber-600" size={24} />
          </div>
          <h2 id="unsaved-changes-title" className="text-lg font-semibold text-gray-900">
            {t('unsavedChanges.title')}
          </h2>
        </div>

        <div className="px-6 py-4">
          <p id="unsaved-changes-message" className="text-gray-600">
            {t('unsavedChanges.message')}
          </p>
          {saveFailed && (
            <p role="status" aria-live="polite" className="mt-3 text-sm text-red-700">
              {t('unsavedChanges.saveFailed')}
            </p>
          )}
        </div>

        <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="px-4 py-2 rounded-lg font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-700"
          >
            {t('unsavedChanges.discard')}
          </button>
          <button
            ref={stayButtonRef}
            type="button"
            onClick={onStay}
            disabled={saving}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 font-medium disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-500"
          >
            {t('unsavedChanges.stay')}
          </button>
          <button
            type="button"
            onClick={onSaveAndContinue}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-amber-700"
          >
            {saving && <Loader2 className="animate-spin" size={16} />}
            {saving ? t('unsavedChanges.saving') : t('unsavedChanges.saveAndContinue')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UnsavedChangesDialog;
```

- [ ] **Step 4: Typecheck ja testid**

Run: `npm run typecheck && npm run test`
Expected: mõlemad vigadeta

- [ ] **Step 5: Commit**

```bash
git add src/components/UnsavedChangesDialog.tsx src/locales/et/common.json src/locales/en/common.json
git commit -m "feat: UnsavedChangesDialog komponent + tõlked"
```

---

## Task 3: Guard-hook ümber kirjutatud

**Files:**
- Modify: `src/hooks/useUnsavedChangesGuard.ts` (kogu fail asendub)

**Interfaces:**
- Consumes: Task 1 kõik eksportfunktsioonid; Task 2 `UnsavedChangesDialogProps`
- Produces:
  ```ts
  useUnsavedChangesGuard(opts: {
    isDirty: boolean;
    onSave: () => Promise<boolean>;
  }): {
    dialogProps: UnsavedChangesDialogProps;
    runGuarded: (fn: () => void) => void;
    allowNextNavigation: () => void;
  }
  ```
  Kõik ülejäänud ülesanded (5–8) kasutavad täpselt seda kuju.

**Taust:** Vana API oli `useUnsavedChangesGuard(isDirty, skipRef)` ja tagastas `{ isBlocked, blockedLocation, proceed, reset }`. Kasutuskohad `Workspace.tsx:139` ja `PersonEditPage.tsx:188` lähevad üle Task 5 ja 6 raames — **pärast seda ülesannet on projekt ajutiselt katki**, see on ootuspärane. Typecheck läbib alles Task 6 lõpus.

- [ ] **Step 1: Asenda faili sisu**

Kirjuta `src/hooks/useUnsavedChangesGuard.ts` täies mahus ümber:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import type { UnsavedChangesDialogProps } from '../components/UnsavedChangesDialog';
import {
  initialGuardState,
  requestTransition,
  stay,
  discard,
  beginSave,
  finishSave,
  allowNextTransition,
  consumeAllowance,
  type GuardState,
} from './unsavedChangesFlow';

interface UnsavedChangesGuardOptions {
  /** Kas on salvestamata muudatusi. */
  isDirty: boolean;
  /**
   * Salvestab ja tagastab `true` AINULT siis, kui kõik on püsivalt salvestatud ja
   * kohalikud dirty-lipud on uuendatud. `false` = ebaõnnestus. Visatud erindit
   * käsitleb hook kaitseks samamoodi nagu `false`.
   */
  onSave: () => Promise<boolean>;
}

interface UnsavedChangesGuardResult {
  dialogProps: UnsavedChangesDialogProps;
  /**
   * Lehesisene üleminek (lehepööre, koha vahetus). Puhta oleku korral käivitub
   * `fn` kohe, dialoogi avamata; muidu läheb ootele.
   */
  runGuarded: (fn: () => void) => void;
  /**
   * Märgib järgmise navigatsiooni lubatuks. Mõeldud lehtedele, mis salvestavad OMA
   * nupuga ja navigeerivad ise (nt PersonEditPage → /persons/{id}) — see on
   * dialoogivoost sõltumatu. Luba on ühekordne.
   */
  allowNextNavigation: () => void;
}

/**
 * Blokeerib lehelt lahkumise ja lehesisesed üleminekud salvestamata muudatuste korral.
 *
 * Kolm sisendit, üks dialoog:
 *   - React Routeri `useBlocker` — lahkumine
 *   - `beforeunload` — tab-i sulgemine (brauseri oma dialoog, seda me ei kontrolli)
 *   - `runGuarded` — lehesisene üleminek
 *
 * Otsused elavad `unsavedChangesFlow`-s, siin on ainult Reacti ja Routeri ühendus.
 */
export function useUnsavedChangesGuard(
  { isDirty, onSave }: UnsavedChangesGuardOptions,
): UnsavedChangesGuardResult {
  const [state, setState] = useState<GuardState>(initialGuardState);

  // Blocker-callback ja async salvestus vajavad värsket olekut väljaspool renderdust.
  const stateRef = useRef(state);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  const apply = useCallback((next: GuardState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (currentLocation.pathname === nextLocation.pathname) return false;
    // Ühekordne möödapääs tarbitakse siin: pärast edukat salvestust või loobumist
    // on `isDirty` Reacti järgmise renderduseni veel `true`, seega ilma selleta
    // avaneks dialoog kohe uuesti.
    const { state: next, allowed } = consumeAllowance(stateRef.current);
    if (allowed) { apply(next); return false; }
    return isDirtyRef.current;
  });

  // `useBlocker` tagastab igal renderdusel uue objekti — effect ja callback'id
  // tohivad sõltuda ainult `blocker.state`-ist, muidu tekib lõputu tsükkel.
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;

  // Router blokeeris navigatsiooni → pane see ootele samasse dialoogi.
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const r = requestTransition(
      stateRef.current,
      true,
      { run: () => blockerRef.current.proceed() },
    );
    if (r.runNow) { blockerRef.current.proceed(); return; }
    apply(r.state);
  }, [blocker.state, apply]);

  const runGuarded = useCallback((fn: () => void) => {
    const r = requestTransition(stateRef.current, isDirtyRef.current, { run: fn });
    if (r.runNow) { fn(); return; }
    apply(r.state);
  }, [apply]);

  const allowNextNavigation = useCallback(() => {
    apply(allowNextTransition(stateRef.current));
  }, [apply]);

  const onStay = useCallback(() => {
    if (stateRef.current.saving) return;
    // Blokeeritud navigatsioon tuleb Routerile tagasi öelda, muidu jääb blocker
    // "blocked" olekusse ja järgmine sama navigatsioon ei käivitu.
    if (blockerRef.current.state === 'blocked') blockerRef.current.reset();
    apply(stay(stateRef.current));
  }, [apply]);

  const onDiscard = useCallback(() => {
    if (stateRef.current.saving) return;
    const r = discard(stateRef.current);
    apply(r.state);
    r.action?.();
  }, [apply]);

  const onSaveAndContinue = useCallback(async () => {
    const begun = beginSave(stateRef.current);
    if (!begun.start) return;
    apply(begun.state);

    let saved = false;
    try {
      saved = await onSave();
    } catch {
      // Ükski praegune kasutuskoht ei viska, aga tulevane refaktor ei tohi jätta
      // dialoogi igaveseks `saving`-olekusse ega tekitada käsitlemata rejection'it.
      saved = false;
    }

    const r = finishSave(stateRef.current, saved);
    // Olek uuendatakse ENNE tegevust: kui tegevus viskab, ei jää guard rippu.
    apply(r.state);
    r.action?.();
  }, [apply, onSave]);

  return {
    dialogProps: {
      open: state.pending !== null,
      saving: state.saving,
      saveFailed: state.saveFailed,
      onDiscard,
      onStay,
      onSaveAndContinue,
    },
    runGuarded,
    allowNextNavigation,
  };
}
```

- [ ] **Step 2: Kontrolli, et olekumasina testid endiselt läbivad**

Run: `npm run test -- src/hooks/__tests__/unsavedChangesFlow.test.ts`
Expected: PASS, 13 testi (hook ei muutnud puhast moodulit)

- [ ] **Step 3: Commit**

Typecheck on siin veel katki (`Workspace.tsx` ja `PersonEditPage.tsx` kasutavad vana API-t) — see on ootuspärane ja laheneb Task 6 lõpuks.

```bash
git add src/hooks/useUnsavedChangesGuard.ts
git commit -m "refactor: useUnsavedChangesGuard olekumasina peale (runGuarded + ühekordne bypass)"
```

---

## Task 4: Redaktori salvestus tagastab boolean'i

**Files:**
- Modify: `src/components/editor/useEditorSave.ts:63-102`

**Interfaces:**
- Consumes: midagi
- Produces: `runSave(...): Promise<boolean>`, `handleSave(): Promise<boolean>`, `handleSaveWithDrafts(): Promise<boolean>`. Task 5 kasutab `handleSaveWithDrafts` tagastusväärtust.

**Taust — see on üks kolmest varjatud veast:** praegu püüab `runSave` erindi kinni, seab `setSaveError` ja **resolvib**. Seetõttu `Workspace.tsx:518` `await editorSaveRef.current()` õnnestub alati ja navigeerib ära; veabanner renderdub komponendis, mis on kohe lahkumas. Tekst kaob.

- [ ] **Step 1: Muuda `runSave` tagastama boolean'i**

`src/components/editor/useEditorSave.ts`, asenda read 63-83:

```ts
  /**
   * Tagastab `true` AINULT siis, kui salvestus õnnestus ja `savedState`/`isDirty`
   * on uuendatud. Salvestamata muudatuste dialoog sõltub sellest: `false` korral
   * ei tohi navigeerida, muidu kaob tekst (vt UnsavedChangesDialog).
   */
  const runSave = useCallback(async (
    updatedPage: Page,
    savedState: EditorSavedState,
    afterSave?: () => void,
  ): Promise<boolean> => {
    if (isSavingRef.current) return false;
    isSavingRef.current = true;
    setIsSaving(true);
    try {
      await onSave(updatedPage);
      afterSave?.();
      setSavedState(savedState);
      setIsDirty(false);
      return true;
    } catch (e: any) {
      console.error('Save error:', e);
      setSaveError(formatSaveError(e));
      return false;
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [formatSaveError, onSave, setIsDirty, setIsSaving, setSaveError, setSavedState]);
```

- [ ] **Step 2: Muuda `handleSave` ja `handleSaveWithDrafts` tagastama sama**

Asenda read 85-102:

```ts
  const handleSave = useCallback(async (): Promise<boolean> => {
    const updatedPage = makePage(comments, textAnnotations);
    return runSave(updatedPage, { status, comments, page_tags, text_annotations: textAnnotations });
  }, [comments, makePage, page_tags, runSave, status, textAnnotations]);

  // Salvestus "Salvesta ja jätka" jaoks: enne salvestust liidab kommentaari-mustandi
  // kommentaaride hulka, et see ei läheks kaduma.
  const handleSaveWithDrafts = useCallback(async (): Promise<boolean> => {
    if (isSavingRef.current) return false;
    const flushed = commentFlushRef.current?.() ?? null;
    const effectiveComments = flushed ?? comments;
    const updatedPage = makePage(effectiveComments, textAnnotations);
    return runSave(
      updatedPage,
      { status, comments: effectiveComments, page_tags, text_annotations: textAnnotations },
      flushed ? () => setComments(flushed) : undefined,
    );
  }, [commentFlushRef, comments, makePage, page_tags, runSave, setComments, status, textAnnotations]);
```

- [ ] **Step 3: Uuenda `triggerSave` ref-i tüüpi**

`src/components/TextEditor.tsx:37` — muuda propi tüüp:

```ts
  triggerSave?: React.MutableRefObject<(() => Promise<boolean>) | null>;
```

- [ ] **Step 4: Otsi üles kõik `runSave` kutsujad ja veendu, et ükski ei katke**

Run: `grep -n "runSave\|handleSaveWithDrafts\|handleSave\b" src/components/editor/useEditorSave.ts src/components/TextEditor.tsx`

Kontrolli, et need kutsujad, kes tagastusväärtust ei kasuta (nt nupuhandlerid), on endiselt korrektsed — `Promise<boolean>` ignoreerimine on TypeScriptis lubatud.

- [ ] **Step 5: Commit**

Typecheck on endiselt katki (Task 3 pärast). See on ootuspärane.

```bash
git add src/components/editor/useEditorSave.ts src/components/TextEditor.tsx
git commit -m "fix: redaktori salvestus signaliseerib ebaõnnestumist (boolean)"
```

---

## Task 5: Workspace üle viidud

**Files:**
- Modify: `src/pages/Workspace.tsx` — read 89-90, 135-140, 151-155, 374-379, 393-397, 478-483, 493-498, 500-531, 781-791

**Interfaces:**
- Consumes: Task 2 `UnsavedChangesDialog`, Task 3 `useUnsavedChangesGuard`, Task 4 `handleSaveWithDrafts` boolean
- Produces: midagi järgnevatele

**Taust:** Workspace'is on praegu KAKS paralleelset mehhanismi: Routeri blocker (lahkumine) ja käsitsi `pendingNavigation` (lehepööre viies kohas). Mõlemad kaovad `runGuarded` kasuks. Lisaks kaob `requestAnimationFrame` bypass-hack — hook teeb selle nüüd ise ühekordselt.

**Loobumise leping:** Workspace'i lehepöördel taastab baasseisu `useEditorState.ts:71-83` (`isSwap` haru lähtestab `isDirty`, `savedState`, `annotationDraftDirty`, `saveError` ja dokumendi sisu). See on ADR 0010 / #194 sisu ja on juba olemas — eraldi `onDiscard`-i ei lisata. Lahkumisel monteeritakse komponent nagunii maha.

- [ ] **Step 1: Vaheta importi ja eemalda `pendingNavigation` olek**

`src/pages/Workspace.tsx:6` — asenda import:

```ts
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import UnsavedChangesDialog from '../components/UnsavedChangesDialog';
```

Eemalda rida 89 (`const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);`).

Muuda rida 90:

```ts
  const editorSaveRef = useRef<(() => Promise<boolean>) | null>(null);
```

- [ ] **Step 2: Asenda guard-kutse**

Eemalda `skipBlockerRef` deklaratsioon (rida ~135-138) ja asenda rida 139-140:

```ts
  // Salvestus dialoogi jaoks: flush-variant, mis liidab ka kommentaari-mustandi.
  // Tagastab `false`, kui salvestamine ebaõnnestus — dialoog jääb siis avatuks.
  //
  // Registreerimata ref (redaktorit pole monteeritud) tagastab `true`: siis ei ole
  // ka midagi salvestada ja kasutajat ei tohi dialoogi lõksu jätta.
  const handleGuardSave = useCallback(async (): Promise<boolean> => {
    if (!editorSaveRef.current) return true;
    return editorSaveRef.current();
  }, []);

  const { dialogProps, runGuarded } = useUnsavedChangesGuard({
    isDirty: hasUnsavedChanges,
    onSave: handleGuardSave,
  });
```

- [ ] **Step 3: Vii viis navigeerimiskohta `runGuarded` peale**

Rida 149-157 (`handlePageInputSubmit`):

```ts
      if (newPage !== currentPageNum) {
        runGuarded(() => navigate(`/work/${workId}/${newPage}`, { replace: true }));
      }
```

Rida 371-379 (`handleSelectFromGrid`):

```ts
  const handleSelectFromGrid = useCallback((pageNum: number) => {
    setIsGridView(false);
    setGridSelectedPage(pageNum);
    runGuarded(() => navigate(`/work/${workId}/${pageNum}`, { replace: true }));
  }, [runGuarded, navigate, workId]);
```

Rida 393-400 (`navigatePage`) — asenda `hasUnsavedChanges` plokk ja sellele järgnev `navigate`:

```ts
    // ?q= jäetakse URL-ist välja — eesmärk: otsisõna paneel avaneb ainult esimesel
    // lehel, mitte iga lehevahetusel
    runGuarded(() => navigate(`/work/${workId}/${newPage}`, { replace: true }));
  }, [workId, currentPageNum, work?.page_count, runGuarded, navigate]);
```

Rida 477-483 (tagasi-navigeerimine) — asenda `hasUnsavedChanges` plokk:

```ts
    runGuarded(() => navigate(returnUrl));
```

Rida 486-498 (`handleNavigateToSearch`) — asenda lõpp:

```ts
    runGuarded(() => navigate(`/search?work=${workId}`));
```

- [ ] **Step 4: Kustuta vana dialoogiloogika**

Eemalda read 500-531 tervikuna: `handleConfirmLeave`, `handleSaveAndLeave` ja `showLeaveConfirm`. Kogu see loogika (sh `requestAnimationFrame` bypass-hack) elab nüüd hook'is.

Eemalda ka rida 140 `const isBlockerActive = isBlocked;`, kui see on veel alles.

- [ ] **Step 5: Asenda dialoog**

Asenda read 781-791:

```tsx
      {/* Salvestamata muudatuste dialoog */}
      <UnsavedChangesDialog {...dialogProps} />
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: `Workspace.tsx` vigadeta. `PersonEditPage.tsx` võib veel vigu anda (Task 6).

- [ ] **Step 7: Commit**

```bash
git add src/pages/Workspace.tsx
git commit -m "refactor: Workspace ühtsele salvestamata muudatuste dialoogile"
```

---

## Task 6: PersonEditPage üle viidud

**Files:**
- Modify: `src/prosopography/pages/PersonEditPage.tsx` — read 28, 187-224, 280, 892, 949-958

**Interfaces:**
- Consumes: Task 2 `UnsavedChangesDialog`, Task 3 `useUnsavedChangesGuard`
- Produces: midagi järgnevatele

**Taust:** `handleSave` teeb praegu kahte asja korraga: salvestab JA navigeerib `/persons/{id}`-le (read 208, 213). Dialoogi `onSave` ei tohi navigeerida — sihtkoha valib dialoog. Jagame kaheks.

**Loobumise leping:** komponent monteeritakse lahkumisel maha; lehesiseseid üleminekuid siin ei ole.

- [ ] **Step 1: Vaheta import**

Rida 28:

```ts
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import UnsavedChangesDialog from '../../components/UnsavedChangesDialog';
```

- [ ] **Step 2: Jaga `handleSave` kaheks ja vaheta guard**

Asenda read 187-224:

```ts
  /**
   * Salvestab isiku. EI navigeeri — sihtkoha valib kutsuja (nupp läheb profiilile,
   * salvestamata muudatuste dialoog jätkab kasutaja algatatud üleminekut).
   * Tagastab `true` ainult siis, kui kõik on püsivalt salvestatud.
   */
  const savePerson = async (): Promise<boolean> => {
    if (!draft.name_label.trim()) { setError(t('form.nameRequired')); return false; }
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const created = await createPerson(
          {
            name: draft.name_label.trim(),
            birth_year: draft.birth.year ? parseInt(draft.birth.year) : undefined,
            death_year: draft.death.year ? parseInt(draft.death.year) : undefined,
            notes: draft.notes.trim() || undefined,
          },
          token,
        );
        const payload = draftToPayload(draft, created, seisused, konfessioonid);
        await updatePerson(created.id, { ...payload, updated_at: created.updated_at }, token);
        createdIdRef.current = created.id;
      } else {
        const payload = draftToPayload(draft, original ?? undefined, seisused, konfessioonid);
        await updatePerson(id!, payload, token);
      }
      setIsDirty(false);
      return true;
    } catch (e: any) {
      if (e?.conflict) {
        setError(t('form.conflictError'));
      } else {
        setError(t('form.saveError'));
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  const { dialogProps, allowNextNavigation } = useUnsavedChangesGuard({
    isDirty,
    onSave: savePerson,
  });

  /** Lehe oma SALVESTA nupp: salvestab ja läheb profiilile. */
  const handleSave = async () => {
    const ok = await savePerson();
    if (!ok) return;
    // Guard ei tohi seda navigatsiooni blokeerida: `isDirty` on Reacti järgmise
    // renderduseni tõenäoliselt veel `true`.
    allowNextNavigation();
    navigate(`/persons/${createdIdRef.current ?? id!}`);
  };
```

Lisa `createdIdRef` deklaratsioon `skipGuardRef`-i asemele (rida 187 kandis):

```ts
  // Uue isiku ID tekib alles salvestamisel — hoiame selle navigeerimiseks alles.
  const createdIdRef = useRef<string | null>(null);
```

- [ ] **Step 3: Asenda dialoog**

Asenda read 949-958:

```tsx
    <UnsavedChangesDialog {...dialogProps} />
```

- [ ] **Step 4: Kontrolli, et `skipGuardRef` on failist täielikult kadunud**

Run: `grep -n "skipGuardRef\|isBlocked\|ConfirmModal" src/prosopography/pages/PersonEditPage.tsx`
Expected: tühi väljund. Kui `ConfirmModal` import on veel alles, eemalda see.

- [ ] **Step 5: Typecheck ja testid**

Run: `npm run typecheck && npm run test`
Expected: mõlemad vigadeta — siit alates on projekt jälle terve

- [ ] **Step 6: Commit**

```bash
git add src/prosopography/pages/PersonEditPage.tsx
git commit -m "refactor: PersonEditPage ühtsele dialoogile; salvestus eraldi navigeerimisest"
```

---

## Task 7: Kohtade register — päris dirty-lipp ja guard

**Files:**
- Modify: `src/pages/admin/PlacesDetail.tsx:37-51, 100-131, 145-175`
- Modify: `src/pages/admin/Places.tsx:1-16, 40-41, 131-137, 247-261, 288-309`

**Interfaces:**
- Consumes: Task 2 `UnsavedChangesDialog`, Task 3 `useUnsavedChangesGuard`
- Produces: midagi järgnevatele

**Taust — kaks varjatud viga korraga:**
1. Kohtade registris **puudub lahkumiskaitse täielikult** — `useUnsavedChangesGuard` ega `beforeunload` ei ole ühendatud. Lehelt lahkudes või tab-i sulgedes kaovad muudatused vaikselt.
2. **Dirty-lipp on vale**: `PlacesDetail.tsx:111` teeb `onDirtyChange?.(editing)` — lipp on püsti alati, kui redigeerimisrežiim on lahti, ka siis kui midagi pole muudetud. Ilma paranduseta hüppaks uus dialoog ette iga kord, kui kasutaja on koha andmeid lihtsalt vaadanud.

**Loobumise leping:** koha vahetusel taastab baasseisu `PlacesDetail.tsx:106-108` (`useEffect(() => setEditing(false), [placeKey])`), mis lähtestab mustandi. Lahkumisel monteeritakse komponent maha.

- [ ] **Step 1: `PlacesDetail` — lisa mustandi tüüp ja normaliseerimine**

**NB:** olemasolevad üksikud `useState`-id vormiväljadele (read 66-76, 100) JÄÄVAD
puutumata — neid kasutab kogu vormi JSX. Lisandub ainult nende koondamine üheks
objektiks võrdluse jaoks.

Lisa faili tippu, väljaspool komponenti:

```ts
/** Vormi mustand — üks objekt, et baasseisuga võrdlemine oleks üks võrdlus. */
interface PlaceFormDraft {
  labels: Record<string, string>;
  placeType: string;
  qCode: string;
  parentKey: string;
  group: string;
  historicalNames: string[];
  lat: string;
  lon: string;
  notes: string;
}

/**
 * Normaliseerib mustandi võrdluseks. Ilma selleta annaks `undefined` vs tühi string,
 * puuduv võti vs tühi objekt ja trimmimata sisestus valepositiivse dirty-lipu.
 */
function normalizeDraft(d: PlaceFormDraft): string {
  const labels = Object.fromEntries(
    Object.entries(d.labels)
      .map(([k, v]) => [k, v.trim()])
      .filter(([, v]) => v !== '')
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify({
    labels,
    placeType: d.placeType.trim(),
    qCode: d.qCode.trim(),
    parentKey: d.parentKey.trim(),
    group: d.group.trim(),
    historicalNames: d.historicalNames.map(n => n.trim()).filter(n => n !== ''),
    lat: d.lat.trim(),
    lon: d.lon.trim(),
    notes: d.notes.trim(),
  });
}

/** Baasseis kirjest: sama kuju, mis vorm avamisel saab. */
function draftFromEntry(entry: PlaceEntry): PlaceFormDraft {
  return {
    labels: { ...(entry.labels ?? {}) },
    placeType: entry.type ?? '',
    qCode: entry.id ?? '',
    parentKey: entry.parent_key ?? '',
    group: entry.group ?? '',
    historicalNames: [...(entry.historical_names ?? [])],
    lat: entry.coordinates?.lat != null ? String(entry.coordinates.lat) : '',
    lon: entry.coordinates?.lon != null ? String(entry.coordinates.lon) : '',
    notes: entry.notes ?? '',
  };
}
```

- [ ] **Step 2: `PlacesDetail` — asenda dirty-effect päris võrdlusega**

Asenda read 110-112:

```ts
  // Baasseis: viimati laaditud või edukalt salvestatud väärtused. Dirty = mustand
  // erineb sellest. `editing` ise EI tee vormi dirty'ks — muidu hüppaks salvestamata
  // muudatuste dialoog ette iga kord, kui kasutaja on koha andmeid lihtsalt vaadanud.
  const [baseline, setBaseline] = useState<string>('');

  const currentDraft: PlaceFormDraft = {
    labels, placeType, qCode, parentKey, group, historicalNames, lat, lon, notes,
  };
  const isDirty = editing && normalizeDraft(currentDraft) !== baseline;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);
```

Read 114-131 (`useEffect` mustandi täitmiseks) — lisa sinna baasseisu seadmine, effecti lõppu enne `setSaveError(null)`:

```ts
      setBaseline(normalizeDraft(draftFromEntry(entry)));
      setSaveError(null);
```

- [ ] **Step 3: `PlacesDetail` — `handleSave` tagastab boolean'i ja uuendab baasseisu**

Asenda read 145-175 (`handleSave`):

```ts
  /**
   * Tagastab `true` ainult siis, kui salvestus õnnestus. Salvestamata muudatuste
   * dialoog sõltub sellest: `false` korral ei tohi kohta vahetada ega lahkuda.
   */
  const handleSave = async (): Promise<boolean> => {
    setSaving(true);
    setSaveError(null);
    try {
      const latNum = lat.trim() ? parseFloat(lat) : undefined;
      const lonNum = lon.trim() ? parseFloat(lon) : undefined;
      const coordinates =
        latNum != null && lonNum != null && !isNaN(latNum) && !isNaN(lonNum)
          ? { lat: latNum, lon: lonNum }
          : null;

      const data: any = {
        labels: Object.fromEntries(Object.entries(labels).filter(([, v]) => v.trim())),
        type: placeType || undefined,
        id: qCode.trim() || null,
        parent_key: parentKey || undefined,
        group: group || undefined,
        historical_names: historicalNames,
        notes: notes || undefined,
      };
      if (coordinates !== undefined) data.coordinates = coordinates;

      const result = await updatePlace(placeKey, data, token);
      onUpdated(result.key, result.entry);
      // Edukas salvestamine teeb praegustest väärtustest uue baasseisu.
      setBaseline(normalizeDraft(currentDraft));
      setEditing(false);
      return true;
    } catch (e: any) {
      setSaveError(e.message ?? t('places.saveError'));
      return false;
    } finally {
      setSaving(false);
    }
  };
```

- [ ] **Step 4: `PlacesDetail` — anna salvestus vanemale**

Lisa propide liidesesse (rida 37-51):

```ts
  /** Vanem paneb siia salvestusfunktsiooni, et dialoog saaks seda kutsuda. */
  saveRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
```

Lisa destruktureerimisse (rida 53-56) `saveRef` ja komponendi sisse, pärast `handleSave` definitsiooni:

```ts
  useEffect(() => {
    if (saveRef) saveRef.current = handleSave;
  });
```

- [ ] **Step 5: `Places` — ühenda guard**

`src/pages/admin/Places.tsx`, lisa importidesse:

```ts
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import UnsavedChangesDialog from '../../components/UnsavedChangesDialog';
```

Asenda read 40-41:

```ts
  const [isDirty, setIsDirty] = useState(false);
  const placeSaveRef = useRef<(() => Promise<boolean>) | null>(null);

  const handleGuardSave = useCallback(async (): Promise<boolean> => {
    if (!placeSaveRef.current) return true;
    return placeSaveRef.current();
  }, []);

  const { dialogProps, runGuarded } = useUnsavedChangesGuard({
    isDirty,
    onSave: handleGuardSave,
  });
```

Lisa `useRef` importi reale 1: `import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';`

- [ ] **Step 6: `Places` — koha vahetus `runGuarded` peale**

Asenda read 131-137:

```ts
  const handleSelectKey = useCallback((key: string | null) => {
    if (key === selectedKey) return;
    runGuarded(() => setSelectedKey(key));
  }, [runGuarded, selectedKey]);
```

Eemalda `pendingKey` olek (rida 41) ja käsitsi kirjutatud modaal (read 288-309) tervikuna.

- [ ] **Step 7: `Places` — anna `saveRef` alla ja renderda dialoog**

Rida 247-261, lisa `PlacesDetail`-ile prop:

```tsx
                    onDirtyChange={setIsDirty}
                    saveRef={placeSaveRef}
```

Muuda ka `onSelectKey={setSelectedKey}` → `onSelectKey={handleSelectKey}`, et ka detailpaneelist tulev koha vahetus oleks kaitstud.

Lisa enne komponendi sulgevat `</div>`-i (kustutatud modaali asemele):

```tsx
      <UnsavedChangesDialog {...dialogProps} />
```

- [ ] **Step 8: Typecheck ja testid**

Run: `npm run typecheck && npm run test`
Expected: mõlemad vigadeta

- [ ] **Step 9: Käsitsi kontroll**

Run: `npm run dev`, ava `/admin/places`.

Kontrolli:
1. Ava koht → vajuta muuda → **ära muuda midagi** → vali nimekirjast teine koht → dialoogi EI tule
2. Muuda üht välja → vali teine koht → dialoog tuleb
3. Taasta väärtus käsitsi algseks → vali teine koht → dialoogi EI tule
4. Muuda välja → proovi lehelt lahkuda (Admin link) → dialoog tuleb
5. Muuda välja → sulge tab → brauseri oma hoiatus tuleb

- [ ] **Step 10: Commit**

```bash
git add src/pages/admin/Places.tsx src/pages/admin/PlacesDetail.tsx
git commit -m "fix: kohtade registri lahkumiskaitse + päris dirty-lipp"
```

---

## Task 8: WorkManage ja ConfirmModal

**Files:**
- Modify: `src/components/ConfirmModal.tsx:17-44`
- Modify: `src/pages/WorkManage.tsx:367-400` ja komponendi lõpp

**Interfaces:**
- Consumes: Task 2 `UnsavedChangesDialog`, Task 3 `useUnsavedChangesGuard`
- Produces: `ConfirmModal` saab uue valikulise propi `closeOnBackdrop?: boolean` (vaikimisi `true`)

**Taust:** `WorkManage.tsx:369` ja `:377` kasutavad natiivset `window.confirm`-i. Lisaks puudub lehel lahkumiskaitse, kuigi `changedCount` (rida 287) hoiab salvestamata järjekorra mustandit.

**Tähelepanu — pesastatud kinnitus:** `handleReorderSave` küsib ise kinnitust. Kui kasutaja valib lahkumisdialoogist "Salvesta ja jätka", ei tohi järjekorra kinnitus uuesti ette hüpata. Salvestus jagatakse kaheks.

**ConfirmModal tarbijate audit:** enne Esc/taustaklõpsu lisamist kontrolli, kes `ConfirmModal`-i veel kasutab.

- [ ] **Step 1: Auditeeri ConfirmModal tarbijad**

Run: `grep -rn "ConfirmModal" src --include=*.tsx`

Pärast Task 5 ja 6 peaks alles olema ainult `src/components/ConfirmModal.tsx` ise. Kui mõni muu kasutuskoht on lisandunud, kontrolli, et selle `onCancel` on idempotentne ja et taustaklõpsuga sulgemine ei jäta pooleliolevat kohalikku olekut.

- [ ] **Step 2: Lisa `ConfirmModal`-ile Esc ja taustaklõps**

`src/components/ConfirmModal.tsx` — lisa importidesse `useEffect`:

```tsx
import React, { useEffect } from 'react';
```

Lisa propi liidesesse:

```ts
  /** Kas taustaklõps sulgeb. Vaikimisi jah — cancel on ohutu tee. */
  closeOnBackdrop?: boolean;
```

Lisa destruktureerimisse `closeOnBackdrop = true`, ja komponendi sisse enne `if (!isOpen) return null;`:

```tsx
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onCancel]);
```

Muuda overlay-div:

```tsx
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onMouseDown={e => { if (closeOnBackdrop && e.target === e.currentTarget) onCancel(); }}
    >
```

- [ ] **Step 3: Lisa tõlkevõtmed WorkManage'i kinnitustele**

`src/locales/et/workspace.json`, `manage` ploki sisse (rida 114 kandis, `reorderConfirm` kõrvale):

```json
    "reorderConfirmTitle": "Kinnita järjekorra muutmine",
```

`src/locales/et/workspace.json`, `manage.reorder` plokk (rida 142):

```json
    "reorder": {
      "discard": "Tühista muudatused",
      "discardTitle": "Tühista järjekorra muudatused",
      "discardConfirm": "Tühistada kõik salvestamata järjekorra muudatused?",
      "changedSummary": "{{count}} lehe asukoht erineb salvestatud järjekorrast"
    },
```

`src/locales/en/workspace.json` — samad kohad:

```json
    "reorderConfirmTitle": "Confirm reorder",
```

```json
    "reorder": {
      "discard": "Discard changes",
      "discardTitle": "Discard order changes",
      "discardConfirm": "Discard all unsaved order changes?",
      "changedSummary": "{{count}} page(s) differ from the saved order"
    },
```

- [ ] **Step 4: Kontrolli keelepaarsust**

Run: `npm run test -- src/locales/__tests__/localeParity.test.ts`
Expected: PASS

- [ ] **Step 5: `WorkManage` — jaga salvestus ja asenda `window.confirm`**

Lisa importidesse:

```ts
import ConfirmModal from '../components/ConfirmModal';
import UnsavedChangesDialog from '../components/UnsavedChangesDialog';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
```

Lisa olek (teiste `useState`-ide juurde):

```ts
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [reorderConfirmOpen, setReorderConfirmOpen] = useState(false);
```

Asenda read 367-373 (`handleDiscardReorder`):

```ts
  // Tühista kõik salvestamata järjekorra muudatused
  const applyDiscardReorder = () => {
    const init: Record<string, number> = {};
    pages.forEach((p) => { init[p.filename] = p.page_num; });
    setDraftPositions(init);
    setDiscardConfirmOpen(false);
  };

  const handleDiscardReorder = () => {
    if (changedCount > 2) { setDiscardConfirmOpen(true); return; }
    applyDiscardReorder();
  };
```

Asenda `handleReorderSave` (rida 375-401) nii, et kinnitus on eraldi. Kinnituseta variant:

```ts
  /**
   * Salvestab järjekorra ILMA kinnituseta. Kasutab nii nupu-handler (mis küsib
   * kinnituse enne) kui ka salvestamata muudatuste dialoog — muidu hüppaks
   * dialoogi "Salvesta ja jätka" peale teine kinnitus ette.
   *
   * Tagastab `true` ainult siis, kui salvestus õnnestus.
   */
  const saveReorder = async (): Promise<boolean> => {
    if (!workId || !authToken) return false;
    setReorderConfirmOpen(false);

    const sorted = [...pages].sort((a, b) => {
      const pa = draftPositions[a.filename] ?? a.page_num;
      const pb = draftPositions[b.filename] ?? b.page_num;
      return pa - pb;
    });
    const order = sorted.map(p => p.filename);

    setReorderSaving(true);
    setReorderError(null);
    try {
      await reorderWorkPages(workId, authToken, order);
      await loadPages();
      // Salvestus = commit → tühjenda valik (uue protsessi eeldus). NB: Liiguta
      // (mustand) EI tühjenda, et saaks sama plokki uuesti liigutada.
      handleClearSelection();
      return true;
    } catch (e: any) {
      setReorderError(e.message || t('manage.reorderError'));
      return false;
    } finally {
      setReorderSaving(false);
    }
  };

  const handleReorderSave = () => { setReorderConfirmOpen(true); };
```

- [ ] **Step 6: `WorkManage` — lisa guard**

Lisa `changedCount` (rida 287) järele:

```ts
  const { dialogProps } = useUnsavedChangesGuard({
    isDirty: changedCount > 0,
    onSave: saveReorder,
  });
```

- [ ] **Step 7: `WorkManage` — renderda kolm dialoogi**

Lisa komponendi lõppu, enne sulgevat `</div>`-i:

```tsx
      <ConfirmModal
        isOpen={discardConfirmOpen}
        title={t('manage.reorder.discardTitle')}
        message={t('manage.reorder.discardConfirm')}
        onConfirm={applyDiscardReorder}
        onCancel={() => setDiscardConfirmOpen(false)}
        variant="danger"
      />

      <ConfirmModal
        isOpen={reorderConfirmOpen}
        title={t('manage.reorderConfirmTitle')}
        message={t('manage.reorderConfirm')}
        onConfirm={() => { void saveReorder(); }}
        onCancel={() => setReorderConfirmOpen(false)}
      />

      <UnsavedChangesDialog {...dialogProps} />
```

- [ ] **Step 8: Veendu, et `window.confirm` on failist kadunud**

Run: `grep -n "window.confirm" src/pages/WorkManage.tsx`
Expected: tühi väljund

- [ ] **Step 9: Typecheck ja testid**

Run: `npm run typecheck && npm run test`
Expected: mõlemad vigadeta

- [ ] **Step 10: Commit**

```bash
git add src/pages/WorkManage.tsx src/components/ConfirmModal.tsx src/locales/et/workspace.json src/locales/en/workspace.json
git commit -m "refactor: WorkManage natiivsed confirm'id ConfirmModal'iks + lahkumiskaitse"
```

---

## Task 9: Surnud tõlgete koristus ja lõppkontroll

**Files:**
- Modify: `src/locales/et/workspace.json:332-337`, `src/locales/en/workspace.json:332-337`
- Modify: `src/locales/et/admin.json:166-169`, `src/locales/en/admin.json:166-169`

**Interfaces:**
- Consumes: kõik eelnev
- Produces: midagi

- [ ] **Step 1: Kontrolli, et vanad võtmed on tõesti kasutuseta**

Run:
```bash
grep -rn "confirm.unsavedChanges\|confirm.saveAndLeave\|confirm.leaveWithoutSaving" src --include=*.tsx --include=*.ts
grep -rn "places.unsavedTitle\|places.unsavedBody\|places.unsavedStay\|places.unsavedLeave" src --include=*.tsx --include=*.ts
```
Expected: mõlemad tühjad

- [ ] **Step 2: Eemalda `workspace.json` `confirm` plokk mõlemast keelest**

`src/locales/et/workspace.json` — kustuta tervikuna:

```json
  "confirm": {
    "unsavedChanges": "Sul on salvestamata muudatusi. Kas oled kindel, et soovid lahkuda?",
    "unsavedChangesPrompt": "Sul on salvestamata muudatusi. Kas soovid salvestada?",
    "saveAndLeave": "Jah, salvesta",
    "leaveWithoutSaving": "Ei, lahku"
  },
```

`src/locales/en/workspace.json` — kustuta vastav plokk.

**NB:** `workspace.editor.unsavedChanges` ("Salvestamata muudatused") JÄÄB — seda kasutab `EditorHeader`, mitte dialoog.

- [ ] **Step 3: Eemalda `admin.json` `places.unsaved*` võtmed mõlemast keelest**

Kustuta neli rida mõlemast (`unsavedTitle`, `unsavedBody`, `unsavedStay`, `unsavedLeave`).

- [ ] **Step 4: Kontrolli keelepaarsust ja tervikut**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: typecheck ja test vigadeta; lint `--max-warnings 56` piires (kui hoiatusi vähenes, langeta lävi `package.json`-is)

- [ ] **Step 5: Käsitsi kontroll — täielik maatriks**

Run: `npm run dev`

Läbi iga kasutuskoht: **Workspace** (`/work/{id}/1`), **PersonEditPage** (`/persons/{id}/edit`), **Places** (`/admin/places`), **WorkManage** (`/work/{id}/manage`).

| # | Stsenaarium | Ootus |
|---|---|---|
| 1 | Brauseri Back-nupp | dialoog tuleb |
| 2 | Rakendusesisene link | dialoog tuleb |
| 3 | Lehesisene vaheldus (Workspace lehepööre, Places koha vahetus) | dialoog tuleb |
| 4 | "Salvesta ja jätka" õnnestub | salvestab JA jätkab sihtkohta |
| 5 | "Salvesta ja jätka" ebaõnnestub (võta võrk maha) | **jääb kohale**, vearida dialoogis, midagi ei kao |
| 6 | "Loobu muudatustest" | jätkab sihtkohta salvestamata |
| 7 | "Jää siia" | jääb kohale, dialoog sulgub |
| 8 | Topeltklikk "Salvesta ja jätka" | täpselt üks salvestus |
| 9 | Back kaks korda järjest | teine kord käitub sama moodi |
| 10 | **Pärast ühe dialoogi kasutamist tee uus muudatus ja lahku uuesti** | dialoog tuleb jälle — möödapääs EI jäänud aktiivseks |
| 11 | Esc ja taustaklõps salvestamise ajal | dialoog EI sulgu |
| 12 | Esc ja taustaklõps muul ajal | sama mis "Jää siia" |
| 13 | Tab-i sulgemine salvestamata muudatustega | brauseri oma hoiatus |

Stsenaarium 10 on kõige olulisem — just see paljastaks lekkiva möödapääsu.

- [ ] **Step 6: Commit**

```bash
git add src/locales/
git commit -m "chore: eemalda kasutuseta salvestamata muudatuste tõlkevõtmed"
```

---

## Lõpetamine

Kui kõik üheksa ülesannet on tehtud ja käsitsi maatriks läbitud, kasuta
`superpowers:finishing-a-development-branch` skilli, et otsustada, kuidas
`feat/uhtne-salvestamata-dialoog` `main`-i viia.

**Deploy:** frontend-only muudatus. `npm run build` lokaalselt ja
`rsync -avz --delete dist/ vutt:~/VUTT/dist/`. Backend'i ega Meilisearchi ei puuduta.
