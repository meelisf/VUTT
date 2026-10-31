import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitFork } from 'lucide-react';
import type { Relation, ResolvedRelation } from '../../types';
import { useUser } from '../../contexts/UserContext';
import { fetchRelations, variantRelations } from '../../services/relationsService';
import RelatedWorksList from './RelatedWorksList';

interface RelationsButtonProps {
  workId: string;
  relations?: Relation[] | null;
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
 * Seoste nupp teosekaardil ja loendireal (#701, ADR 0075). Ülekate jääb lahti,
 * kuni hiir on nupul VÕI ülekattel; klõps lukustab lahti. Pealkirjad laaditakse
 * esimesel avamisel — kaardi andmetes on ainult seoste id-d.
 */
const RelationsButton: React.FC<RelationsButtonProps> = ({
  workId, relations, variant, lang, open, onOpenChange, hidden = false,
}) => {
  const { t } = useTranslation(['common']);
  const { authToken } = useUser();
  const variants = variantRelations(relations);
  const [items, setItems] = useState<ResolvedRelation[] | null>(null);
  const [locked, setLocked] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const requested = useRef(false);

  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const close = () => { clearTimer(); setLocked(false); onOpenChange(false); };

  useEffect(() => {
    if (!open || requested.current) return;
    requested.current = true;
    fetchRelations(workId, authToken || undefined).then(setItems).catch(() => setItems([]));
  }, [open, workId, authToken]);

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

  if (variants.length === 0) return null;

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

  const list = items === null
    ? <p className="text-xs opacity-70">…</p>
    : <RelatedWorksList items={items} lang={lang} dark={variant === 'card'} />;

  const isCard = variant === 'card';
  return (
    <div ref={rootRef} className={isCard ? '' : 'relative inline-block'} onClick={stop}>
      <button
        type="button"
        aria-label={label}
        title={label}
        className={isCard
          ? `absolute top-10 right-2 z-30 h-6 min-w-6 px-1 rounded-full flex items-center justify-center gap-0.5 backdrop-blur-sm transition-all duration-150 hover:scale-110 bg-violet-600/70 hover:bg-violet-600/90 text-white text-[10px] ${hidden ? 'hidden' : ''}`
          : 'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 hover:bg-violet-100 text-xs align-middle'}
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
        <GitFork size={11} />
        <span>{variants.length}</span>
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
          <p className={`text-[10px] uppercase tracking-widest font-semibold mb-2 ${isCard ? 'text-violet-200' : 'text-gray-500'}`}>
            {label}
          </p>
          {list}
        </div>
      )}
    </div>
  );
};

export default RelationsButton;
