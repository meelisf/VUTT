import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitMerge } from 'lucide-react';
import {
  wordDiff,
  type ChunkChoice, type DiffSegment, type PageFields, type TextChunk, type TheirsLast,
} from './pageConflict';

export interface PageConflictDialogProps {
  conflict: {
    fields: string[];
    current: PageFields;
    textChunks?: TextChunk[] | null;
    theirsLast?: TheirsLast | null;
  } | null;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
  /** Tükkide kaupa valik (#612); olemas ainult siis, kui server saatis tükid. */
  onApplyChoices?: (choices: ChunkChoice[]) => void;
  onCancel: () => void;
}

/** Mitu rida konteksti näidatakse põrkuva tüki ümber. */
const KONTEKST_READ = 2;

function viimasedRead(text: string, n: number): string {
  const read = text.replace(/\n$/, '').split('\n');
  return read.slice(-n).join('\n');
}

function esimesedRead(text: string, n: number): string {
  return text.split('\n').slice(0, n).join('\n');
}

const Segmendid: React.FC<{ segments: DiffSegment[]; markClass: string }> = ({ segments, markClass }) => (
  <>
    {segments.map((s, i) => (s.changed
      ? <mark key={i} className={`${markClass} rounded-sm`}>{s.text}</mark>
      : <React.Fragment key={i}>{s.text}</React.Fragment>))}
  </>
);

/**
 * Lehe salvestuse kokkupõrge (#455): keegi muutis vahepeal SAMA üksust.
 * Automaatselt liidetavad juhud (nt eri read, tekst + kommentaarivastus)
 * siia ei jõua — server liidab need ise (#612).
 *
 * Kui server saatis teksti tükid, valib kasutaja iga põrkuva koha juures
 * minu / tema / mõlemad; tulemus läheb redaktorisse salvestamata. Muidu
 * (vana server, mitte-teksti kokkupõrge) jääb tervikvalik.
 *
 * `z-[1300]`: päis on `z-[1200]` (CLAUDE.md, z-index kihid).
 */
const PageConflictDialog: React.FC<PageConflictDialogProps> = ({
  conflict, onKeepMine, onTakeTheirs, onApplyChoices, onCancel,
}) => {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const open = conflict !== null;

  const chunks = onApplyChoices && conflict?.fields.includes('text') ? conflict.textChunks ?? null : null;
  const conflictCount = chunks ? chunks.filter(c => c.kind === 'conflict').length : 0;
  const [choices, setChoices] = useState<(ChunkChoice | null)[]>([]);

  // Uus kokkupõrge → valikud tühjaks: kasutaja otsustab iga koha teadlikult.
  useEffect(() => {
    setChoices(new Array(conflictCount).fill(null));
  }, [conflict, conflictCount]);

  // Fookus ohutuimale valikule; Esc = tühista; Tab jääb dialoogi sisse.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
      if (e.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])');
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

  // Põrkuvad tükid koos kontekstiga ja sõnatasemel esiletõstuga.
  const kohad = useMemo(() => {
    if (!chunks) return [];
    return chunks.flatMap((c, i) => {
      if (c.kind !== 'conflict') return [];
      const eel = chunks[i - 1];
      const järel = chunks[i + 1];
      return [{
        chunk: c,
        before: eel?.kind === 'ok' ? viimasedRead(eel.text, KONTEKST_READ) : '',
        after: järel?.kind === 'ok' ? esimesedRead(järel.text, KONTEKST_READ) : '',
        diff: wordDiff(c.mine, c.theirs),
      }];
    });
  }, [chunks]);

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
    if (field.startsWith('annotations:')) {
      const id = field.slice('annotations:'.length);
      const a = conflict.current.text_annotations.find(x => String(x.id) === id);
      const text = (a?.comment || '').trim();
      return t('conflict.field.annotation', {
        text: text ? (text.length > 40 ? `${text.slice(0, 40)}…` : text) : id,
      });
    }
    return t(`conflict.field.${field}`, { defaultValue: field });
  };

  const theirsLast = conflict.theirsLast;
  const theirsTime = (() => {
    if (!theirsLast) return '';
    const d = new Date(theirsLast.date);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(d);
  })();
  const theirsLabel = theirsLast
    ? t('conflict.theirsBy', { author: theirsLast.author, time: theirsTime })
    : t('conflict.theirsUnknown');

  const otherFields = conflict.fields.filter(f => f !== 'text');
  const allChosen = choices.length === conflictCount && choices.every(c => c !== null);
  const setChoice = (i: number, v: ChunkChoice) => setChoices(prev => prev.map((c, j) => (j === i ? v : c)));

  const valikuKast = (checked: boolean) => (
    `block cursor-pointer rounded-lg border-2 p-3 transition-colors ${
      checked ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-gray-300'}`
  );

  const tekstiplokk = (segments: DiffSegment[], markClass: string, raw: string) => (
    <pre className="mt-2 font-mono text-sm whitespace-pre-wrap break-words text-gray-900">
      {raw ? <Segmendid segments={segments} markClass={markClass} /> : <span className="italic text-gray-500">{t('conflict.emptyChunk')}</span>}
    </pre>
  );

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
        className={`bg-white rounded-xl shadow-2xl w-full mx-4 overflow-hidden flex flex-col max-h-[90vh] ${chunks ? 'max-w-5xl' : 'max-w-lg'}`}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3 shrink-0">
          <div className="p-2 bg-amber-100 rounded-full">
            <GitMerge className="text-amber-600" size={24} />
          </div>
          <h2 id="page-conflict-title" className="text-lg font-semibold text-gray-900">
            {t('conflict.title')}
          </h2>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto">
          {chunks ? (
            <>
              <p id="page-conflict-message" className="text-gray-600">
                {theirsLast
                  ? t('conflict.chunksIntro', { author: theirsLast.author })
                  : t('conflict.chunksIntroUnknown')}
              </p>
              {conflictCount > 1 && (
                <div className="flex flex-wrap gap-2 text-sm">
                  <button type="button" onClick={() => setChoices(new Array(conflictCount).fill('mine'))}
                    className="px-3 py-1 rounded-md border border-gray-300 hover:bg-gray-100">
                    {t('conflict.allMine')}
                  </button>
                  <button type="button" onClick={() => setChoices(new Array(conflictCount).fill('theirs'))}
                    className="px-3 py-1 rounded-md border border-gray-300 hover:bg-gray-100">
                    {t('conflict.allTheirs')}
                  </button>
                </div>
              )}
              {kohad.map((k, i) => (
                <fieldset key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
                  <legend className="px-1 text-sm font-medium text-gray-700">
                    {t('conflict.place', { n: i + 1, total: conflictCount })}
                  </legend>
                  {k.before && (
                    <pre className="font-mono text-xs whitespace-pre-wrap break-words text-gray-400">{k.before}</pre>
                  )}
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className={valikuKast(choices[i] === 'mine')}>
                      <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
                        <input type="radio" name={`chunk-${i}`} checked={choices[i] === 'mine'}
                          onChange={() => setChoice(i, 'mine')} className="accent-amber-600" />
                        {t('conflict.mineLabel')}
                      </span>
                      {tekstiplokk(k.diff.a, 'bg-amber-200', k.chunk.mine)}
                    </label>
                    <label className={valikuKast(choices[i] === 'theirs')}>
                      <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
                        <input type="radio" name={`chunk-${i}`} checked={choices[i] === 'theirs'}
                          onChange={() => setChoice(i, 'theirs')} className="accent-amber-600" />
                        {theirsLabel}
                      </span>
                      {tekstiplokk(k.diff.b, 'bg-sky-200', k.chunk.theirs)}
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="radio" name={`chunk-${i}`} checked={choices[i] === 'both'}
                      onChange={() => setChoice(i, 'both')} className="accent-amber-600" />
                    {t('conflict.both')}
                  </label>
                  {k.after && (
                    <pre className="font-mono text-xs whitespace-pre-wrap break-words text-gray-400">{k.after}</pre>
                  )}
                </fieldset>
              ))}
              {otherFields.length > 0 && (
                <div className="text-sm text-gray-700">
                  <p>{t('conflict.otherFieldsMine')}</p>
                  <ul className="list-disc pl-5">
                    {otherFields.map(f => <li key={f}>{label(f)}</li>)}
                  </ul>
                </div>
              )}
              <p className="text-xs text-gray-500">{t('conflict.applyHint')} {t('conflict.takeTheirsHint')}</p>
            </>
          ) : (
            <>
              <p id="page-conflict-message" className="text-gray-600">{t('conflict.message')}</p>
              <ul className="list-disc pl-5 text-sm text-gray-800">
                {conflict.fields.map(f => <li key={f}>{label(f)}</li>)}
              </ul>
              <p className="text-xs text-gray-500">{t('conflict.takeTheirsHint')}</p>
            </>
          )}
        </div>

        <div className="px-6 py-4 bg-gray-50 flex flex-wrap justify-end gap-3 shrink-0 border-t border-gray-200">
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
          {chunks && onApplyChoices ? (
            <button
              type="button"
              disabled={!allChosen}
              onClick={() => onApplyChoices(choices as ChunkChoice[])}
              className="px-4 py-2 rounded-lg font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-amber-700"
            >
              {t('conflict.apply')}
            </button>
          ) : (
            <button
              type="button"
              onClick={onKeepMine}
              className="px-4 py-2 rounded-lg font-medium text-white bg-amber-600 hover:bg-amber-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-amber-700"
            >
              {t('conflict.keepMine')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PageConflictDialog;
