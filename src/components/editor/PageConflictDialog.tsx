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
 * Paneel katab AINULT redaktori paani (lähim positsioneeritud esivanem —
 * Workspace'i parem pool), mitte kogu ekraani: pildipaan jääb kõrvale
 * suumitavaks ja liigutatavaks, et toimetaja saaks valikut pildilt kontrollida.
 * Seepärast ei ole ta modaalne: Tab ei ole lõksus ja Esc kehtib ainult paneelis.
 */
const PageConflictDialog: React.FC<PageConflictDialogProps> = ({
  conflict, onKeepMine, onTakeTheirs, onApplyChoices, onCancel,
}) => {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const open = conflict !== null;

  const chunks = onApplyChoices && conflict?.fields.includes('text') ? conflict.textChunks ?? null : null;
  const conflictCount = chunks ? chunks.filter(c => c.kind === 'conflict').length : 0;
  const [choices, setChoices] = useState<(ChunkChoice | null)[]>([]);

  // Uus kokkupõrge → valikud tühjaks: kasutaja otsustab iga koha teadlikult.
  useEffect(() => {
    setChoices(new Array(conflictCount).fill(null));
  }, [conflict, conflictCount]);

  // Fookus ohutuimale valikule; sulgemisel tagasi sinna, kus see oli.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => { previous?.focus?.(); };
  }, [open]);

  // Põrkuvad tükid koos kontekstiga ja sõnatasemel esiletõstuga.
  const kohad = useMemo(() => {
    if (!chunks) return [];
    return chunks.flatMap((c, i) => {
      if (c.kind !== 'conflict') return [];
      const eel = chunks[i - 1];
      const järel = chunks[i + 1];
      // Kahe koha vahele jääv lühike vahe näidatakse ÜKS kord, eelmise koha
      // järelkontekstina — muidu korduksid samad read kahes kastis.
      const lühike = (ok: TextChunk | undefined) =>
        ok?.kind === 'ok' && ok.text.replace(/\n$/, '').split('\n').length <= 2 * KONTEKST_READ;
      const eelJagatud = chunks[i - 2]?.kind === 'conflict' && lühike(eel);
      const järelJagatud = chunks[i + 2]?.kind === 'conflict' && lühike(järel);
      return [{
        chunk: c,
        before: eel?.kind === 'ok' && !eelJagatud ? viimasedRead(eel.text, KONTEKST_READ) : '',
        after: järel?.kind === 'ok'
          ? (järelJagatud ? järel.text.replace(/\n$/, '') : esimesedRead(järel.text, KONTEKST_READ))
          : '',
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

  // Ajaloo diffiga sama keel (HistoryTab): mono read, vasak värviline äär.
  // Värv tähistab KES (sinine = tema, merevaigune = sina), mitte lisatud/eemaldatud —
  // kumbki versioon ei ole veel ära visatud.
  const VARV = {
    theirs: { rida: 'border-sky-400 bg-sky-50 text-sky-950', valitud: 'bg-sky-100', mark: 'bg-sky-200', raadio: 'accent-sky-600' },
    mine: { rida: 'border-amber-400 bg-amber-50 text-amber-950', valitud: 'bg-amber-100', mark: 'bg-amber-200', raadio: 'accent-amber-600' },
  } as const;

  const kontekst = (text: string) => text.split('\n').map((rida, j) => (
    <div key={j} className="pl-4 border-l-4 border-transparent text-gray-500 whitespace-pre-wrap break-words">{rida || '\u00a0'}</div>
  ));

  const versioon = (i: number, kes: 'theirs' | 'mine', silt: string, raw: string, segments: DiffSegment[]) => {
    const v = VARV[kes];
    const valik = choices[i];
    const sees = valik === kes || valik === 'both';
    const tuhm = valik !== null && !sees;
    const read = raw.replace(/\n$/, '');
    return (
      <label className={`block cursor-pointer transition-opacity ${tuhm ? 'opacity-40' : ''}`}>
        <div className={`flex items-center gap-2 pl-3 py-1 border-l-4 font-sans text-xs text-gray-700 ${v.rida} ${sees ? v.valitud : ''}`}>
          <input type="radio" name={`chunk-${i}`} checked={valik === kes}
            onChange={() => setChoice(i, kes)} className={v.raadio} />
          <span className="font-medium">{silt}</span>
        </div>
        <div className={`pl-4 pb-1 border-l-4 whitespace-pre-wrap break-words ${v.rida} ${sees ? v.valitud : ''}`}>
          {raw
            ? <Segmendid segments={segments} markClass={v.mark} />
            : <span className="italic font-sans text-gray-500">{t('conflict.emptyChunk')}</span>}
          {raw && !read && '\u00a0'}
        </div>
      </label>
    );
  };

  return (
    <div className="absolute inset-0 z-40 bg-gray-900/30 flex items-center justify-center p-3 font-sans whitespace-normal text-left">
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby="page-conflict-title"
        aria-describedby="page-conflict-message"
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
        className={`bg-white rounded-xl shadow-2xl w-full overflow-hidden flex flex-col max-h-full ${chunks ? 'h-full' : 'max-w-lg'}`}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3 shrink-0">
          <div className="p-2 bg-amber-100 rounded-full">
            <GitMerge className="text-amber-600" size={24} />
          </div>
          <h2 id="page-conflict-title" className="text-lg font-semibold text-gray-900">
            {t('conflict.title')}
          </h2>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          {chunks ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p id="page-conflict-message" className="text-gray-600">
                  {theirsLast
                    ? t('conflict.chunksIntro', { author: theirsLast.author })
                    : t('conflict.chunksIntroUnknown')}
                </p>
                {conflictCount > 1 && (
                  <div className="flex gap-3 text-xs">
                    <button type="button" onClick={() => setChoices(new Array(conflictCount).fill('theirs'))}
                      className="text-sky-700 hover:underline">
                      {t('conflict.allTheirs')}
                    </button>
                    <button type="button" onClick={() => setChoices(new Array(conflictCount).fill('mine'))}
                      className="text-amber-700 hover:underline">
                      {t('conflict.allMine')}
                    </button>
                  </div>
                )}
              </div>
              {kohad.map((k, i) => (
                <fieldset key={i} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                  <legend className="sr-only">{t('conflict.place', { n: i + 1, total: conflictCount })}</legend>
                  <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-100">
                    <span aria-hidden="true" className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      {t('conflict.place', { n: i + 1, total: conflictCount })}
                    </span>
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                      <input type="radio" name={`chunk-${i}`} checked={choices[i] === 'both'}
                        onChange={() => setChoice(i, 'both')} className="accent-gray-600" />
                      {t('conflict.both')}
                    </label>
                  </div>
                  <div className="py-2 font-mono text-sm space-y-0.5">
                    {k.before && kontekst(k.before)}
                    {versioon(i, 'theirs', theirsLabel, k.chunk.theirs, k.diff.b)}
                    {versioon(i, 'mine', t('conflict.mineLabel'), k.chunk.mine, k.diff.a)}
                    {k.after && kontekst(k.after)}
                  </div>
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
              <p className="text-xs text-gray-500">{t('conflict.applyHint')}</p>
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
          {/* Tükkide dialoogis ei ole: viskaks ära ka minu põrkumata parandused —
              „Kõikjal tema" + Rakenda teeb sama ohutumalt. */}
          {!chunks && (
            <button
              type="button"
              onClick={onTakeTheirs}
              className="px-4 py-2 rounded-lg font-medium text-white bg-red-600 hover:bg-red-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-700"
            >
              {t('conflict.takeTheirs')}
            </button>
          )}
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
