import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react';

/**
 * Jaluse vasak serv: „Tagasi ülevaatesse". Väljapääs on SÕNADEGA — päise X ja
 * Escape üksi ei ütle, KUHU nad viivad. ÜHINE halduse ja upload'i redaktorile.
 */
export const BackToOverview: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { t } = useTranslation('common');
  return (
    <button type="button" data-testid="back-to-overview" onClick={onBack}
      className="flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-100">
      <LayoutGrid size={15} />{t('pagePrep.backToOverview')}
    </button>
  );
};

interface NavProps {
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  /** 1-põhine praegune leht ja lehtede arv. */
  current: number;
  total: number;
}

const arrow = 'flex h-9 w-11 items-center justify-center rounded border border-gray-400 bg-white text-gray-800 shadow-sm hover:bg-gray-100 disabled:opacity-35 disabled:shadow-none';

/**
 * Lehtede vahel liikumine: ‹ N / M ›, jaluse PAREMAS servas (ADR 0085). Kõik on kohe
 * ootel, seega liikumine ei rakenda ega kaota midagi — eraldi „Järgmine" nuppu pole.
 * Paigal püsiv koht: kutsuja paneb muutuvad nupud (nt „Kärbi ja järgmine") VASAKULE,
 * et nooled ei nihkuks. ÜHINE halduse ja upload'i redaktorile.
 */
export const PageNav: React.FC<NavProps> = ({ onPrev, onNext, hasPrev, hasNext, current, total }) => {
  const { t } = useTranslation('common');
  return (
    <nav aria-label={t('pagePrep.pageNav')} className="flex flex-shrink-0 items-center gap-2">
      <button type="button" data-testid="page-prev" onClick={onPrev} disabled={!hasPrev}
        title={`${t('pagePrep.prev')} (←)`} aria-label={t('pagePrep.prev')} className={arrow}>
        <ChevronLeft size={20} />
      </button>
      <span data-testid="page-nav-position" className="min-w-[4.5rem] text-center text-sm tabular-nums text-gray-700">
        {current} / {total}
      </span>
      <button type="button" data-testid="page-next" onClick={onNext} disabled={!hasNext}
        title={`${t('pagePrep.next')} (→)`} aria-label={t('pagePrep.next')} className={arrow}>
        <ChevronRight size={20} />
      </button>
    </nav>
  );
};
