/**
 * Eksemplari lehe suur pilt (spets „Pildimaterjal"): üks jada, üks pilt.
 * Täisekraani modaal `z-[1300]` (halduse pildiredaktori raam), pildivaatur,
 * pisipildiriba, silt, paar ja allikarida — viide originaalile ei tohi kaduda
 * (ADR 0079). Nooled ← → liigutavad jadas, Escape sulgeb.
 */
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Columns2, X } from 'lucide-react';
import ImageViewer from '../ImageViewer';
import CopyLinkButton from './CopyLinkButton';
import type { Sequence } from './exemplarSequences';

interface ExemplarImageModalProps {
  title: string;
  sequence: Sequence;
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onCompare?: () => void;
  sourceLine?: { text: string; href?: string };
  /** Teose lehe tüvi → number (paarimärgi „⇄ lk N" jaoks). */
  pageNumbers: Record<string, number>;
  /** Pildi URL-ile allkiri (`withImageToken`). */
  sign: (url: string) => string;
  /** Püsiv link avatud pildile (nupp „Kopeeri link"). */
  shareUrl?: string;
}

const ExemplarImageModal: React.FC<ExemplarImageModalProps> = ({
  title, sequence, index, onIndex, onClose, onCompare, sourceLine, pageNumbers, sign, shareUrl,
}) => {
  const { t } = useTranslation(['workspace', 'common']);
  const items = sequence.items;
  const item = items[index];
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowLeft' && index > 0) { e.preventDefault(); onIndex(index - 1); }
      else if (e.key === 'ArrowRight' && index < items.length - 1) { e.preventDefault(); onIndex(index + 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onIndex, onClose]);

  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [index]);

  if (!item) return null;
  const label = sequence.kind === 'pages' ? t('exemplarPage.pageLabel', { n: item.label }) : item.label;
  const pairN = item.pairStem ? pageNumbers[item.pairStem] : undefined;

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center overflow-hidden bg-black/70 p-2 sm:p-4"
      role="dialog" aria-modal="true" data-testid="exemplar-image-modal" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-full max-h-[95vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-200">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{title}</p>
            <p className="text-xs text-gray-500">
              {label}
              {pairN !== undefined && <span className="ml-2 text-primary-700">⇄ {t('exemplarPage.pageLabel', { n: pairN })}</span>}
              <span className="ml-2">{index + 1} / {items.length}</span>
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {shareUrl && <CopyLinkButton url={shareUrl} />}
            {onCompare && (
              <button type="button" onClick={onCompare}
                className="text-sm px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50 inline-flex items-center gap-1">
                <Columns2 size={14} />{t('exemplarPage.compare')}
              </button>
            )}
            <button type="button" onClick={onClose} aria-label={t('common:buttons.close')} title={t('common:buttons.close')}
              className="p-1.5 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-100">
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 relative bg-slate-900">
          <ImageViewer src={sign(item.url)} />
          {index > 0 && (
            <button type="button" onClick={() => onIndex(index - 1)} aria-label={t('exemplarImages.compare.prev')}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white hover:bg-black/60">
              <ChevronLeft size={22} />
            </button>
          )}
          {index < items.length - 1 && (
            <button type="button" onClick={() => onIndex(index + 1)} aria-label={t('exemplarImages.compare.next')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white hover:bg-black/60">
              <ChevronRight size={22} />
            </button>
          )}
        </div>
        <div ref={stripRef} className="flex gap-1.5 overflow-x-auto px-4 py-2 border-t border-gray-100">
          {items.map((it, i) => (
            <button key={it.key} type="button" data-index={i} onClick={() => onIndex(i)}
              className={`shrink-0 rounded-sm ${i === index ? 'outline outline-2 outline-offset-1 outline-primary-600' : ''}`}>
              {/* `object-contain`: rõhtne pilt (kaas, köide, topeltleht) jääb tervikuna näha. */}
              <img src={sign(it.thumb)} alt="" loading="lazy" className="h-12 w-9 object-contain rounded-sm bg-gray-200" />
            </button>
          ))}
        </div>
        {sourceLine && (
          <div data-testid="exemplar-source" className="px-4 pb-3 text-sm text-gray-700">
            {sourceLine.href
              ? <a href={sourceLine.href} target="_blank" rel="noopener noreferrer" className="text-primary-700 hover:text-primary-900">{sourceLine.text}</a>
              : <span>{sourceLine.text}</span>}
          </div>
        )}
      </div>
    </div>
  );
};

export default ExemplarImageModal;
