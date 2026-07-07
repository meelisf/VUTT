import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Väline paigutus (nt "mt-10 pt-6 border-t border-gray-200") */
  className?: string;
}

// Nummerdatud lehed ellipsis'ega: alati esimene+viimane, praeguse ümber ±1
const getPageNumbers = (currentPage: number, totalPages: number): (number | string)[] => {
  const pages: (number | string)[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('...');
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
      pages.push(i);
    }
    if (currentPage < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }
  return pages;
};

/**
 * Jagatud pagineerimiskomponent (Dashboard + PersonsPage). Nummerdatud lehed
 * ellipsis'ega desktopil, "x/y" indikaator mobiilil. Tõlked: common:buttons.
 */
const Pagination: React.FC<PaginationProps> = ({ currentPage, totalPages, onPageChange, className = '' }) => {
  const { t } = useTranslation('common');
  if (totalPages <= 1) return null;

  return (
    <div className={`flex justify-center items-center gap-2 ${className}`}>
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        aria-label={t('common:buttons.previous')}
        className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft size={18} />
        <span className="hidden sm:inline">{t('common:buttons.previous')}</span>
      </button>

      {/* Mobiilne lehekülje indikaator */}
      <span className="sm:hidden text-sm font-medium text-gray-600">{currentPage}/{totalPages}</span>

      <div className="hidden sm:flex items-center gap-1 mx-2">
        {getPageNumbers(currentPage, totalPages).map((page, idx) => (
          page === '...' ? (
            <span key={`ellipsis-${idx}`} className="px-2 text-gray-400">...</span>
          ) : (
            <button
              key={page}
              onClick={() => onPageChange(page as number)}
              className={`w-10 h-10 rounded-lg font-medium transition-colors ${currentPage === page
                ? 'bg-primary-600 text-white'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
            >
              {page}
            </button>
          )
        ))}
      </div>

      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        aria-label={t('common:buttons.next')}
        className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <span className="hidden sm:inline">{t('common:buttons.next')}</span>
        <ChevronRight size={18} />
      </button>
    </div>
  );
};

export default Pagination;
