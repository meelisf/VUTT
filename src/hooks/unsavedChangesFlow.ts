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
    state: {
      ...state,
      pending: null,
      saving: false,
      saveFailed: false,
      allowNext: action !== null,
    },
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
