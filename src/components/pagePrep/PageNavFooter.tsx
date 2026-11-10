import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react';

interface Props {
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}

const btn = 'rounded border border-gray-300 bg-white p-2 hover:bg-gray-100 disabled:opacity-40';

/**
 * Jaluse vasak serv: „Tagasi ülevaatesse" + ‹ ›. Väljapääs on SÕNADEGA — päise X
 * ja Escape üksi ei ütle, KUHU nad viivad. ÜHINE halduse ja upload'i redaktorile.
 */
const PageNavFooter: React.FC<Props> = ({ onBack, onPrev, onNext, hasPrev, hasNext }) => {
  const { t } = useTranslation('common');
  return (
    <>
      <button type="button" data-testid="back-to-overview" onClick={onBack}
        className="mr-2 flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-100">
        <LayoutGrid size={15} />{t('pagePrep.backToOverview')}
      </button>
      <button type="button" data-testid="page-prev" onClick={onPrev} disabled={!hasPrev}
        title={t('pagePrep.prev')} className={btn}>
        <ChevronLeft size={16} />
      </button>
      <button type="button" data-testid="page-next" onClick={onNext} disabled={!hasNext}
        title={t('pagePrep.next')} className={btn}>
        <ChevronRight size={16} />
      </button>
    </>
  );
};

export default PageNavFooter;
