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
