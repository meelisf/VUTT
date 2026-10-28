import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, AlertTriangle, CheckCircle2, X } from 'lucide-react';

export type BannerVariant = 'error' | 'warning' | 'success';

interface ErrorBannerProps {
  message: string;
  onClose?: () => void;
  className?: string;
  /** Vaikimisi viga; hoiatus nt salvestatud-aga-commit-puudu (#418), edu taastamise järel. */
  variant?: BannerVariant;
}

const STYLES: Record<BannerVariant, { box: string; icon: string; close: string; Icon: typeof AlertCircle }> = {
  error: { box: 'bg-red-50 border-red-200 text-red-800', icon: 'text-red-500', close: 'text-red-400 hover:text-red-600', Icon: AlertCircle },
  warning: { box: 'bg-amber-50 border-amber-200 text-amber-900', icon: 'text-amber-500', close: 'text-amber-400 hover:text-amber-600', Icon: AlertTriangle },
  success: { box: 'bg-green-50 border-green-200 text-green-800', icon: 'text-green-500', close: 'text-green-400 hover:text-green-600', Icon: CheckCircle2 },
};

/**
 * Inline veabänner — asendab alert() kõnesid (globaalselt `useNotify`, #672).
 * Ei blokeeri UI-d, toetab sulgemist.
 */
export const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onClose, className = '', variant = 'error' }) => {
  const { t } = useTranslation('common');
  const s = STYLES[variant];
  return (
    <div className={`flex items-start gap-3 px-4 py-3 border rounded-lg text-sm ${s.box} ${className}`}>
      <s.Icon size={16} className={`${s.icon} flex-shrink-0 mt-0.5`} />
      <span className="flex-1 whitespace-pre-line">{message}</span>
      {onClose && (
        <button
          onClick={onClose}
          className={`${s.close} flex-shrink-0`}
          aria-label={t('buttons.close')}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};
