import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { GitMerge } from 'lucide-react';
import type { PageFields } from './pageConflict';

export interface PageConflictDialogProps {
  conflict: { fields: string[]; current: PageFields } | null;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
  onCancel: () => void;
}

/**
 * Lehe salvestuse kokkupõrge (#455): keegi muutis vahepeal SAMA üksust.
 * Automaatselt liidetavad juhud (nt tekst + vahepealne kommentaarivastus)
 * siia ei jõua — server liidab need ise.
 *
 * `z-[1300]`: päis on `z-[1200]` (CLAUDE.md, z-index kihid).
 */
const PageConflictDialog: React.FC<PageConflictDialogProps> = ({
  conflict, onKeepMine, onTakeTheirs, onCancel,
}) => {
  const { t } = useTranslation(['workspace', 'common']);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const open = conflict !== null;

  // Fookus ohutuimale valikule; Esc = tühista; Tab jääb dialoogi sisse.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
      if (e.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])');
      if (!focusable || focusable.length === 0) { e.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [open, onCancel]);

  if (!conflict) return null;

  const label = (field: string) => {
    if (field.startsWith('comments:')) {
      const id = field.slice('comments:'.length);
      const c = conflict.current.comments.find(x => String(x.id) === id);
      const text = (c?.text || '').trim();
      return t('conflict.field.comment', {
        text: text ? (text.length > 40 ? `${text.slice(0, 40)}…` : text) : id,
      });
    }
    return t(`conflict.field.${field}`, { defaultValue: field });
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1300]"
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="page-conflict-title"
        aria-describedby="page-conflict-message"
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
          <div className="p-2 bg-amber-100 rounded-full">
            <GitMerge className="text-amber-600" size={24} />
          </div>
          <h2 id="page-conflict-title" className="text-lg font-semibold text-gray-900">
            {t('conflict.title')}
          </h2>
        </div>

        <div className="px-6 py-4 space-y-3">
          <p id="page-conflict-message" className="text-gray-600">{t('conflict.message')}</p>
          <ul className="list-disc pl-5 text-sm text-gray-800">
            {conflict.fields.map(f => <li key={f}>{label(f)}</li>)}
          </ul>
          <p className="text-xs text-gray-500">{t('conflict.takeTheirsHint')}</p>
        </div>

        <div className="px-6 py-4 bg-gray-50 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onTakeTheirs}
            className="px-4 py-2 rounded-lg font-medium text-white bg-red-600 hover:bg-red-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-700"
          >
            {t('conflict.takeTheirs')}
          </button>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-500"
          >
            {t('conflict.cancel')}
          </button>
          <button
            type="button"
            onClick={onKeepMine}
            className="px-4 py-2 rounded-lg font-medium text-white bg-amber-600 hover:bg-amber-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-amber-700"
          >
            {t('conflict.keepMine')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PageConflictDialog;
