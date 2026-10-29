import { useCallback } from 'react';
import { useConfirm, useNotify } from '../contexts/FeedbackContext';

// Ajaloost taastamise ühine töövoog (#674): lehe tekst, märkus märkmena,
// kommentaar, isikukaart. Kinnitus → toiming → tulemuse teade. Kinnitust
// küsitakse ainult üle kirjutaval taastel; lisav taaste (kustutatud kommentaar,
// märkus märkmena) kinnitust ei vaja.

export interface RestoreOutcome {
  /** Failid on kettal, aga ajaloo commit võis ebaõnnestuda (sama leping mis `/save`). */
  gitCommitted: boolean;
}

export interface RestoreMessages<T> {
  /** Puudub → eduteadet ei näidata (nt vaade märgib taastatu ise). */
  success?: string;
  gitWarning: string | ((outcome: T) => string);
  /** Veateate eesliide; erindi sõnum lisatakse järele. */
  error: string;
}

export interface RestoreSpec<T extends RestoreOutcome> {
  confirm?: string;
  run: () => Promise<T>;
  messages: RestoreMessages<T>;
}

export type RestoreNotice = { text: string; kind: 'success' | 'warning' };

/** Õnnestunud taaste teade. Puuduv commit EI TOHI jääda edu alla peitu. */
export function restoreNotice<T extends RestoreOutcome>(outcome: T, messages: RestoreMessages<T>): RestoreNotice | null {
  if (!outcome.gitCommitted) {
    const warning = typeof messages.gitWarning === 'function' ? messages.gitWarning(outcome) : messages.gitWarning;
    return { text: messages.success ? `${messages.success}\n\n${warning}` : warning, kind: 'warning' };
  }
  return messages.success ? { text: messages.success, kind: 'success' } : null;
}

export function restoreErrorText(prefix: string, e: unknown): string {
  const detail = e instanceof Error ? e.message : '';
  return detail ? `${prefix}: ${detail}` : prefix;
}

/** Tagastab toimingu tulemuse või `null` (katkestatud või ebaõnnestunud). */
export function useRestoreAction() {
  const askConfirm = useConfirm();
  const notify = useNotify();

  return useCallback(async <T extends RestoreOutcome>(spec: RestoreSpec<T>): Promise<T | null> => {
    if (spec.confirm && !(await askConfirm(spec.confirm))) return null;
    try {
      const outcome = await spec.run();
      const notice = restoreNotice(outcome, spec.messages);
      if (notice) notify(notice.text, notice.kind);
      return outcome;
    } catch (e) {
      console.error('Taastamine ebaõnnestus:', e);
      notify(restoreErrorText(spec.messages.error, e));
      return null;
    }
  }, [askConfirm, notify]);
}
