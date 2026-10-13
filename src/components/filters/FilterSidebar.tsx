import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, SlidersHorizontal, X } from 'lucide-react';

/**
 * Kokkupandav filtrite külgriba (#587): teoste ja isikute lehe ühine kest.
 *
 * - Desktop: lahtiselt `sticky` veerg, kinniselt kitsas riba „Filtrid" + aktiivsete arv.
 * - Mobiil: väljalibisev paneel (`z-[1300]`, päise kohal), avab `MobileFiltersButton`.
 *
 * Sisu (`children`) on ÜKS eksemplar mõlemas režiimis — klassid otsustavad, kus ta on.
 * Kerib AKEN; külgriba ise kerib ainult siis, kui ta on aknast pikem.
 */
interface FilterSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  activeCount: number;
  children: React.ReactNode;
}

const CountBadge: React.FC<{ count: number; className?: string }> = ({ count, className = '' }) =>
  count > 0 ? (
    <span className={`min-w-[1.25rem] h-5 px-1 rounded-full bg-primary-600 text-white text-xs grid place-items-center tabular-nums ${className}`}>
      {count}
    </span>
  ) : null;

export const MobileFiltersButton: React.FC<{ activeCount: number; onClick: () => void }> = ({ activeCount, onClick }) => {
  const { t } = useTranslation('common');
  return (
    <button
      type="button"
      onClick={onClick}
      className="md:hidden flex items-center gap-1.5 px-3 py-2.5 text-sm text-primary-700 bg-primary-50 border border-primary-200 rounded-lg shrink-0"
    >
      <SlidersHorizontal size={16} />
      {t('filterPanel.title')}
      <CountBadge count={activeCount} className="ml-1" />
    </button>
  );
};

const FilterSidebar: React.FC<FilterSidebarProps> = ({
  open, onOpenChange, drawerOpen, onDrawerOpenChange, activeCount, children,
}) => {
  const { t } = useTranslation('common');

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDrawerOpenChange(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, onDrawerOpenChange]);

  return (
    <>
      {/* Kinnine riba: kerge primary-toon, et filtrite olemasolu oleks märgatav */}
      {!open && (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className="hidden md:flex flex-col items-center gap-2.5 w-11 shrink-0 py-4 self-start sticky top-20 bg-primary-50 border border-primary-200 rounded-lg text-primary-700 hover:bg-primary-100 hover:border-primary-300 transition-colors"
          title={t('filterPanel.show')}
          aria-label={t('filterPanel.show')}
        >
          <SlidersHorizontal size={16} />
          <CountBadge count={activeCount} />
          <span className="text-sm font-medium [writing-mode:vertical-rl] rotate-180 tracking-wide">{t('filterPanel.title')}</span>
        </button>
      )}

      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-[1300] bg-black/30" onClick={() => onDrawerOpenChange(false)} aria-hidden />
      )}

      <aside
        className={`bg-white ${
          drawerOpen ? 'fixed inset-y-0 left-0 z-[1300] w-72 max-w-[85vw] h-full overflow-y-auto shadow-xl px-4 py-4' : 'hidden'
        } ${open ? 'md:block' : 'md:hidden'} md:static md:z-auto md:w-60 md:max-w-none md:h-auto md:shrink-0 md:self-start md:sticky md:top-20 md:max-h-[calc(100vh-6rem)] md:overflow-y-auto md:border md:border-gray-200 md:rounded-lg md:shadow-sm md:px-4 md:py-3`}
        aria-label={t('filterPanel.title')}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-semibold text-gray-800">{t('filterPanel.title')}</span>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="hidden md:flex p-1 text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100"
            title={t('filterPanel.hide')}
            aria-label={t('filterPanel.hide')}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => onDrawerOpenChange(false)}
            className="md:hidden p-1 text-gray-500"
            aria-label={t('buttons.close')}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </aside>
    </>
  );
};

export default FilterSidebar;
