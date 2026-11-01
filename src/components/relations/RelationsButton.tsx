import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitFork, Library } from 'lucide-react';
import type { ConvoluteBlock, Relation, ResolvedRelation } from '../../types';
import { useUser } from '../../contexts/UserContext';
import { fetchRelations, variantRelations } from '../../services/relationsService';
import RelatedWorksList from './RelatedWorksList';
import { getWorkExemplars } from '../../services/workApi';
import ConvoluteBlocks from '../convolutes/ConvoluteBlocks';

interface RelationsButtonProps {
  workId: string;
  relations?: Relation[] | null;
  /** Meili `convolute_count` (#702): >0 → ülekattes ka plokk „Samas köites". */
  convoluteCount?: number;
  /** `card` — kaane nurgas, ülekate katab kaardi; `row` — loendirea popover. */
  variant: 'card' | 'row';
  lang: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Kaardil peidetakse nupp, kui info-ülekate on lahti (mõlemad nupud z-30). */
  hidden?: boolean;
}

const OPEN_DELAY_MS = 200;
const CLOSE_DELAY_MS = 150;

/**
 * Seoste nupp teosekaardil ja loendireal (#701, ADR 0075; konvoluut #702). Ülekate jääb lahti,
 * kuni hiir on nupul VÕI ülekattel; klõps lukustab lahti. Pealkirjad laaditakse
 * esimesel avamisel — kaardi andmetes on ainult seoste id-d.
 */
const RelationsButton: React.FC<RelationsButtonProps> = ({
  workId, relations, convoluteCount = 0, variant, lang, open, onOpenChange, hidden = false,
}) => {
  const { t } = useTranslation(['common']);
  const { authToken } = useUser();
  const variants = variantRelations(relations);
  const [items, setItems] = useState<ResolvedRelation[] | null>(null);
  const [convolutes, setConvolutes] = useState<ConvoluteBlock[] | null>(null);
  const [locked, setLocked] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const requested = useRef(false);

  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const close = () => { clearTimer(); setLocked(false); onOpenChange(false); };

  useEffect(() => {
    if (!open || requested.current) return;
    requested.current = true;
    // Kumbki päring ainult siis, kui kaardi andmed ütlevad, et tal on midagi näidata.
    if (variants.length > 0) {
      fetchRelations(workId, authToken || undefined).then(setItems).catch(() => setItems([]));
    }
    if (convoluteCount > 0) {
      getWorkExemplars(workId, authToken).then(r => setConvolutes(r.convolutes || [])).catch(() => setConvolutes([]));
    }
  }, [open, workId, authToken, variants.length, convoluteCount]);

  // Esc ja väljaspool klõps sulgevad.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: MouseEvent) => {
      if (locked && rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  });

  useEffect(() => clearTimer, []);

  if (variants.length === 0 && convoluteCount === 0) return null;

  const enter = () => {
    clearTimer();
    if (!open) timer.current = setTimeout(() => onOpenChange(true), OPEN_DELAY_MS);
  };
  const leave = () => {
    clearTimer();
    if (!locked) timer.current = setTimeout(() => onOpenChange(false), CLOSE_DELAY_MS);
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const label = t('common:workRelations.button', 'Seotud teosed');
  // Ainult konvoluudiga teosel ütleb nupp, mis seal on; mõlema korral jääb üldnimi.
  const buttonLabel = variants.length === 0 ? t('common:convolute.title') : label;

  const isCard = variant === 'card';
  const loading = <p className="text-xs opacity-70">…</p>;
  const heading = `text-[10px] uppercase tracking-widest font-semibold mb-2 ${isCard ? 'text-emerald-200' : 'text-gray-500'}`;
  return (
    <div ref={rootRef} className={isCard ? '' : 'relative inline-block'} onClick={stop}>
      <button
        type="button"
        aria-label={buttonLabel}
        title={buttonLabel}
        className={isCard
          ? `absolute top-10 right-2 z-30 h-6 min-w-6 px-1 rounded-full flex items-center justify-center gap-0.5 backdrop-blur-sm transition-all duration-150 hover:scale-110 bg-emerald-600/70 hover:bg-emerald-600/90 text-white text-[10px] ${hidden ? 'hidden' : ''}`
          : 'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs align-middle'}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          clearTimer();
          if (open && locked) { close(); return; }
          setLocked(true);
          onOpenChange(true);
        }}
        onTouchStart={(e) => { e.stopPropagation(); }}
      >
        {variants.length > 0 && (<><GitFork size={11} /><span>{variants.length}</span></>)}
        {convoluteCount > 0 && (
          <span className="inline-flex items-center gap-0.5" data-testid="convolute-indicator">
            <Library size={11} />{variants.length > 0 && <span className="sr-only">{t('common:convolute.title')}</span>}
          </span>
        )}
      </button>

      {open && (
        <div
          data-testid="relations-overlay"
          onMouseEnter={() => clearTimer()}
          onMouseLeave={leave}
          onClick={stop}
          onTouchStart={stop}
          className={isCard
            ? 'absolute inset-0 z-20 bg-black/75 backdrop-blur-sm rounded-lg p-4 pr-10 overflow-y-auto'
            : 'absolute left-0 top-full mt-1 z-30 w-80 max-w-[80vw] bg-white border border-gray-200 rounded-lg shadow-lg p-3'}
        >
          {variants.length > 0 && (
            <>
              <p className={heading}>{label}</p>
              {items === null ? loading : <RelatedWorksList items={items} lang={lang} dark={isCard} />}
            </>
          )}
          {convoluteCount > 0 && (
            <div className={variants.length > 0 ? 'mt-3' : ''}>
              <p className={heading}>{t('common:convolute.title')}</p>
              {convolutes === null ? loading : <ConvoluteBlocks blocks={convolutes} lang={lang} dark={isCard} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RelationsButton;
