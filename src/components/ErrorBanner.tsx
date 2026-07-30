import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, X } from 'lucide-react';

interface ErrorBannerProps {
  message: string;
  onClose?: () => void;
  className?: string;
}

/**
 * Inline veabänner — asendab alert() kõnesid.
 * Ei blokeeri UI-d, toetab sulgemist.
 */
export const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onClose, className = '' }) => {
  const { t } = useTranslation('common');
  return (
    <div className={`flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 ${className}`}>
      <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
      <span className="flex-1">{message}</span>
      {onClose && (
        <button
          onClick={onClose}
          className="text-red-400 hover:text-red-600 flex-shrink-0"
          aria-label={t('buttons.close')}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};
