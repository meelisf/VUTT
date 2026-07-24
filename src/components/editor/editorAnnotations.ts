import { Annotation, type Transaction } from '@codemirror/state';

/**
 * Märgistab tehingu, mis vahetab editori sisu lehe vahetusel (programmaatiline
 * dokumendi asendus), mitte kasutaja muudatuse.
 *
 * **Miks vaja:** `useCodeMirrorLifecycle` updateListener seab iga `docChanged`
 * peale `isDirty = true`. Lehe vahetusel asendab `useEditorState` kogu
 * dokumendi ühe dispatch'iga — see on samuti `docChanged` ja märgiks lehe
 * ekslikult muudetuks, mille peale küsitakse lahkumisel salvestamist, kuigi
 * kasutaja pole midagi teinud.
 *
 * Varem seda ei juhtunud ainult seetõttu, et lehe vahetus monteeris terve
 * editori maha. Alates #185-st jääb editor püsima, seega peab programmaatiline
 * asendus olema selgelt eristatav.
 *
 * NB: see ei ole `Transaction.userEvent`. `marginaliaProtectionFilter`
 * (MarginaliaExtension.ts) ja `vuttAutoSanitizer` (VuttMarkupExtension.ts)
 * mõlemad tegutsevad ainult userEvent-tehingutel, seega jäävad nad lehe
 * vahetuse asendusest puutumata — nagu peabki.
 */
export const pageSwapAnnotation = Annotation.define<boolean>();

/**
 * Kas see update pärineb lehe vahetusest? Kasutab `useCodeMirrorLifecycle`
 * updateListener, et mitte märkida lehte muudetuks.
 */
export function isPageSwapUpdate(transactions: readonly Transaction[]): boolean {
  return transactions.some(tr => tr.annotation(pageSwapAnnotation) === true);
}
