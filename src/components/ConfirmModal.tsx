import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  extraText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onExtra?: () => void;
  variant?: 'warning' | 'danger';
  /** Kas taustaklõps sulgeb. Vaikimisi jah — cancel on ohutu tee. */
  closeOnBackdrop?: boolean;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  extraText,
  onConfirm,
  onCancel,
  onExtra,
  variant = 'warning',
  closeOnBackdrop = true
}) => {
  const { t } = useTranslation('common');

  // Esc = tühista. Ohutu tee, seega alati lubatud.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onCancel]);

  const resolvedTitle = title ?? t('confirmation.title');
  const resolvedConfirmText = confirmText ?? t('buttons.confirm');
  const resolvedCancelText = cancelText ?? t('buttons.deny');

  if (!isOpen) return null;

  const confirmButtonClass = variant === 'danger'
    ? 'bg-red-600 hover:bg-red-700 text-white'
    : 'bg-primary-600 hover:bg-primary-700 text-white';

  const iconBgClass = variant === 'danger' ? 'bg-red-100' : 'bg-amber-100';
  const iconClass = variant === 'danger' ? 'text-red-600' : 'text-amber-600';

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onMouseDown={e => { if (closeOnBackdrop && e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
          <div className={`p-2 ${iconBgClass} rounded-full`}>
            <AlertTriangle className={iconClass} size={24} />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">{resolvedTitle}</h2>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          <p className="text-gray-600">{message}</p>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 font-medium transition-colors"
          >
            {resolvedCancelText}
          </button>
          {onExtra && extraText && (
            <button
              type="button"
              onClick={onExtra}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 font-medium transition-colors"
            >
              {extraText}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${confirmButtonClass}`}
          >
            {resolvedConfirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
