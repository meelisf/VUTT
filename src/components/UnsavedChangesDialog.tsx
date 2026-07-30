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
