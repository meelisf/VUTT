/**
 * Kõrvutus (spets „Kõrvutus"): kahe JADA kiire läbilappamine täisekraani
 * modaalis (`z-[1300]`). Jada on „Teose lehed" (kõik teose lehed teose
 * järjekorras) või ühe eksemplari oma pildid — jadasid ei ühendata.
 *
 * Lukus (vaikimisi) liigutab üks samm mõlemat poolt; kui kumbki jõuaks
 * piirist välja, ei liigu kumbki (`stepLocked`). Lahtise lukuga liigub ainult
 * see pool (nupud) või pool, mille kohal on hiir (klaviatuur, vaikimisi vasak).
 * „Suurendus koos" annab mõlemale `ImageViewer`-ile ühe suhtelise vaate.
 * Paar on salvestatud joonduspunkt — lahkuminek näidatakse märgina, ei hüpata.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Lock, LockOpen, X } from 'lucide-react';
import ImageViewer, { type ViewState } from '../ImageViewer';
import { PAGES_KEY, stepLocked, type SeqItem, type Sequence } from './exemplarSequences';
import CopyLinkButton from './CopyLinkButton';

export interface CompareSide { seq: string; index: number }

interface ExemplarCompareModalProps {
  title: string;
  /** Kõik jadad; tühi jada = menüüs hall. */
  sequences: Sequence[];
  seqLabel: (key: string) => { main: string; sub?: string };
  left: CompareSide;
  right: CompareSide;
  /** Leht kirjutab URL-i. */
  onChange: (l: CompareSide, r: CompareSide) => void;
  canEdit: boolean;
  onSavePair?: (exemplarId: string, imageKey: string, stem: string) => Promise<void>;
  onClose: () => void;
  /** Pildi URL-ile allkiri (`withImageToken`); vaikimisi muutmata. */
  sign?: (url: string) => string;
  /** Püsiv link sellele kõrvutusele (nupp „Kopeeri link"). */
  shareUrl?: string;
}

type SideName = 'left' | 'right';
const DEFAULT_VIEW: ViewState = { scale: 1, x: 0, y: 0 };

const ExemplarCompareModal: React.FC<ExemplarCompareModalProps> = ({
  title, sequences, seqLabel, left, right, onChange, canEdit, onSavePair, onClose, sign = u => u, shareUrl,
}) => {
  const { t } = useTranslation(['workspace', 'common']);
  const [locked, setLocked] = useState(true);
  const [zoomTogether, setZoomTogether] = useState(true);
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
  const [saving, setSaving] = useState(false);
  const hovered = useRef<SideName>('left');

  const seqOf = (s: CompareSide) => sequences.find(q => q.key === s.seq);
  const lSeq = seqOf(left);
  const rSeq = seqOf(right);
  const lLen = lSeq?.items.length ?? 0;
  const rLen = rSeq?.items.length ?? 0;
  const lItem = lSeq?.items[left.index];
  const rItem = rSeq?.items[right.index];
  const pagesSeq = sequences.find(q => q.key === PAGES_KEY);
  const pageNo = (stem?: string) => {
    const i = stem && pagesSeq ? pagesSeq.items.findIndex(it => it.stem === stem) : -1;
    return i >= 0 ? i + 1 : undefined;
  };

  const clamp = (i: number, len: number) => Math.max(0, Math.min(len - 1, i));

  const step = (delta: 1 | -1, side?: SideName) => {
    if (locked) {
      const [l, r] = stepLocked(left.index, right.index, delta, lLen, rLen);
      if (l !== left.index || r !== right.index) onChange({ ...left, index: l }, { ...right, index: r });
      return;
    }
    const which = side ?? hovered.current;
    if (which === 'left') {
      const l = clamp(left.index + delta, lLen);
      if (l !== left.index) onChange({ ...left, index: l }, right);
    } else {
      const r = clamp(right.index + delta, rLen);
      if (r !== right.index) onChange(left, { ...right, index: r });
    }
  };

  // Viimane `step` refis: klahvikuular ei pea iga renderdusega uuesti registreeruma.
  const stepRef = useRef(step);
  stepRef.current = step;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return; }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); stepRef.current(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepRef.current(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const itemLabel = (seq: Sequence | undefined, it: SeqItem | undefined) => {
    if (!seq || !it) return '';
    return seq.kind === 'pages' ? t('exemplarPage.pageLabel', { n: it.label }) : it.label;
  };

  // Paar: üks pool on teose lehed, teine pildijada (paar on alati pilt ↔ teose leht).
  const pair = (() => {
    const imgSide = lSeq?.kind === 'images' && rSeq?.kind === 'pages' ? { seq: lSeq, item: lItem, page: rItem }
      : rSeq?.kind === 'images' && lSeq?.kind === 'pages' ? { seq: rSeq, item: rItem, page: lItem } : null;
    if (!imgSide || !imgSide.item || !imgSide.page?.stem || !imgSide.seq.exemplarId) return null;
    return {
      exemplarId: imgSide.seq.exemplarId, imageKey: imgSide.item.key, imageLabel: imgSide.item.label,
      stem: imgSide.page.stem, n: imgSide.page.label, saved: imgSide.item.pairStem === imgSide.page.stem,
    };
  })();

  const savePair = async () => {
    if (!pair || !onSavePair) return;
    setSaving(true);
    try { await onSavePair(pair.exemplarId, pair.imageKey, pair.stem); } finally { setSaving(false); }
  };

  const renderSide = (name: SideName, side: CompareSide, seq: Sequence | undefined, item: SeqItem | undefined,
    other: SeqItem | undefined) => {
    const len = seq?.items.length ?? 0;
    const pairN = item?.pairStem ? pageNo(item.pairStem) : undefined;
    const pairHere = item?.pairStem && other?.stem === item.pairStem;
    const change = (seqKey: string) => onChange(
      name === 'left' ? { seq: seqKey, index: 0 } : left,
      name === 'right' ? { seq: seqKey, index: 0 } : right,
    );
    const go = (i: number) => onChange(
      name === 'left' ? { ...left, index: i } : left,
      name === 'right' ? { ...right, index: i } : right,
    );
    return (
      <div className="flex flex-col min-h-0 min-w-0" data-testid={`compare-side-${name}`}
        onMouseEnter={() => { hovered.current = name; }}>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-gray-200 text-sm">
          <select value={side.seq} onChange={e => change(e.target.value)}
            className="text-sm border border-gray-300 rounded px-1.5 py-1 bg-white max-w-[14rem]">
            {sequences.map(q => {
              const l = seqLabel(q.key);
              return (
                <option key={q.key} value={q.key} disabled={q.items.length === 0}>
                  {l.sub ? `${l.main} · ${l.sub}` : l.main}
                </option>
              );
            })}
          </select>
          <span className="font-medium text-gray-800">{itemLabel(seq, item)}</span>
          {pairN !== undefined && (pairHere ? (
            <span className="text-[11px] px-1.5 rounded-full border border-primary-300 text-primary-800">
              ⇄ {t('exemplarPage.pageLabel', { n: pairN })}
            </span>
          ) : (
            <span className="text-[11px] px-1.5 rounded-full border border-amber-300 bg-amber-50 text-amber-800">
              {t('compare.pairElsewhere', { n: pairN })}
            </span>
          ))}
          {item?.ownerNote && (
            <span className="text-[11px] px-1.5 rounded-full border border-gray-300 text-gray-600">
              {item.ownerNote === 'unknown' ? t('compare.unknownOrigin') : item.ownerNote}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 text-gray-600">
            <button type="button" onClick={() => step(-1, name)} aria-label={t('exemplarImages.compare.prev')}
              className="p-1 rounded hover:bg-gray-100"><ChevronLeft size={16} /></button>
            <span className="tabular-nums">{len ? side.index + 1 : 0} / {len}</span>
            <button type="button" onClick={() => step(1, name)} aria-label={t('exemplarImages.compare.next')}
              className="p-1 rounded hover:bg-gray-100"><ChevronRight size={16} /></button>
          </span>
        </div>
        <div className="flex-1 min-h-0 relative bg-slate-900">
          {item && (zoomTogether
            ? <ImageViewer src={sign(item.url)} view={view} onViewChange={setView} />
            : <ImageViewer key={`free-${name}`} src={sign(item.url)} />)}
        </div>
        <Strip seq={seq} index={side.index} onPick={go} sign={sign} />
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center overflow-hidden bg-black/70 p-2 sm:p-4"
      role="dialog" aria-modal="true" data-testid="exemplar-compare-modal">
      <div className="bg-white rounded-xl shadow-2xl w-full h-full flex flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-gray-200">
          <p className="text-sm font-semibold text-gray-900">⇄ {t('compare.title')}</p>
          <p className="text-sm text-gray-500 truncate min-w-0 max-w-md">{title}</p>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
            <button type="button" data-testid="compare-lock" aria-pressed={locked} onClick={() => setLocked(v => !v)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border ${locked
                ? 'border-primary-300 bg-primary-50 text-primary-800' : 'border-gray-300 bg-white text-gray-700'}`}>
              {locked ? <Lock size={14} /> : <LockOpen size={14} />}
              {locked ? t('compare.locked') : t('compare.unlocked')}
            </button>
            <label className="inline-flex items-center gap-1.5 text-gray-700">
              <input type="checkbox" checked={zoomTogether} aria-label={t('compare.zoomTogether')}
                onChange={e => setZoomTogether(e.target.checked)} />
              {t('compare.zoomTogether')}
            </label>
            <input type="range" min={1} max={8} step={0.1} value={view.scale} disabled={!zoomTogether}
              aria-label={t('compare.zoomLevel')} className="w-28 disabled:opacity-40"
              onChange={e => setView(v => ({ ...v, scale: Number(e.target.value) }))} />
            {shareUrl && <CopyLinkButton url={shareUrl} />}
            <button type="button" onClick={onClose} aria-label={t('common:buttons.close')} title={t('common:buttons.close')}
              className="p-1.5 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-100">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 md:divide-x divide-gray-200">
          {renderSide('left', left, lSeq, lItem, rItem)}
          {renderSide('right', right, rSeq, rItem, lItem)}
        </div>

        <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-t border-gray-200 text-sm text-gray-600">
          {locked
            ? <span>← → · {t('compare.now', { left: itemLabel(lSeq, lItem), right: itemLabel(rSeq, rItem) })}</span>
            : <span>{t('compare.alignHint')}</span>}
          {canEdit && onSavePair && pair && (pair.saved ? (
            <span className="ml-auto text-primary-700">{t('compare.pairSaved')}</span>
          ) : (
            <button type="button" onClick={() => void savePair()} disabled={saving}
              className="ml-auto px-3 py-1 rounded bg-primary-600 text-white text-sm hover:bg-primary-700 disabled:opacity-50">
              {t('compare.savePair', { image: pair.imageLabel, n: pair.n })}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

/** Poole pisipildiriba; valitud üksus keritakse nähtavale. */
const Strip: React.FC<{ seq?: Sequence; index: number; onPick: (i: number) => void; sign: (u: string) => string }> = ({
  seq, index, onPick, sign,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [index, seq?.key]);
  if (!seq) return null;
  return (
    <div ref={ref} className="flex gap-1.5 overflow-x-auto px-3 py-2 border-t border-gray-100">
      {seq.items.map((it, i) => (
        <button key={it.key} type="button" data-index={i} onClick={() => onPick(i)}
          className={`shrink-0 rounded-sm ${i === index ? 'outline outline-2 outline-offset-1 outline-primary-600' : ''}`}>
          {/* `object-contain`: rõhtne pilt jääb tervikuna näha (nagu halduse PageCard). */}
          <img src={sign(it.thumb)} alt="" loading="lazy" className="h-12 w-9 object-contain rounded-sm bg-gray-200" />
        </button>
      ))}
    </div>
  );
};

export default ExemplarCompareModal;
