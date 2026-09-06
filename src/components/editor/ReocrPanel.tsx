import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReocrStatus } from './useReOcr';
import { ocrErrorText } from '../../utils/ocrErrorText';

interface ReocrPanelProps {
  status: ReocrStatus;
  text: string | null;
  error: string | null;
  onApply: () => void;
  onDelete: () => void | Promise<void>;
  variant: 'banner' | 'overlay';
}

// Re-OCR oleku banner ja tulemuse/vea ülekate tekstiredaktoris.
export default function ReocrPanel({ status, text, error, onApply, onDelete, variant }: ReocrPanelProps) {
  const { t } = useTranslation(['workspace', 'common']);

  if (variant === 'banner') {
    if (status !== 'uploading' && status !== 'processing') return null;
    return (
      <div className="shrink-0 bg-emerald-50 border-b border-emerald-200 px-4 py-2 flex items-center gap-2 text-xs text-emerald-800">
        <Loader2 className="animate-spin shrink-0" size={12} />
        {t('editor.reocr.inProgress')}
      </div>
    );
  }

  if (status !== 'done' && status !== 'error') return null;

  return (
        <div className="absolute inset-0 z-20 bg-white/95 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-200 shrink-0">
            <span className="text-sm font-semibold text-gray-800">
              {status === 'error' ? t('editor.reocr.error') : t('editor.reocr.modalTitle')}
            </span>
          </div>
          {status === 'error' ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
              {/* Pakkuja veakood → lause lugeja keeles (ADR 0033); tundmatu koodi
                  puhul jääb serveri sõnum alles. */}
              <div className="text-sm text-red-600">{ocrErrorText(error, t)}</div>
              <button
                onClick={onDelete}
                className="px-4 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded transition-colors"
              >
                {t('editor.reocr.deleteFile')}
              </button>
            </div>
          ) : (
            <>
              <p className="px-4 pt-3 pb-2 text-xs text-gray-500 shrink-0">{t('editor.reocr.modalHint')}</p>
              <div className="flex-1 overflow-auto px-4 pb-2">
                <pre className="font-serif text-[15px] leading-[1.7] text-gray-800 whitespace-pre-wrap">{text}</pre>
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 shrink-0">
                <button
                  onClick={() => {
                    if (window.confirm(t('editor.reocr.deleteConfirm'))) onDelete();
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded transition-colors"
                >
                  {t('editor.reocr.deleteFile')}
                </button>
                <button
                  onClick={onApply}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded shadow-sm transition-colors"
                >
                  {t('editor.reocr.apply')}
                </button>
              </div>
            </>
          )}
        </div>
  );
}
