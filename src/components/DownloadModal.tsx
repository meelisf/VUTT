import React from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileText, Image, Package, X } from 'lucide-react';
import { FILE_API_URL } from '../config';

interface DownloadModalProps {
  isOpen: boolean;
  workId: string;
  onClose: () => void;
}

const OPTIONS = [
  { key: 'text',   icon: FileText, labelKey: 'download.optionText',   descKey: 'download.optionTextDesc' },
  { key: 'images', icon: Image,    labelKey: 'download.optionImages', descKey: 'download.optionImagesDesc' },
  { key: 'both',   icon: Package,  labelKey: 'download.optionBoth',   descKey: 'download.optionBothDesc' },
] as const;

const DownloadModal: React.FC<DownloadModalProps> = ({ isOpen, workId, onClose }) => {
  const { t } = useTranslation('workspace');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>

        <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-full">
            <Download className="text-primary-600" size={20} />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">{t('download.title')}</h2>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-2">
          {OPTIONS.map(({ key, icon: Icon, labelKey, descKey }) => (
            <a
              key={key}
              href={`${FILE_API_URL}/download/${workId}?content=${key}`}
              download
              onClick={onClose}
              className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 hover:border-primary-300 hover:bg-primary-50 transition-colors group"
            >
              <Icon size={18} className="text-gray-400 group-hover:text-primary-600 transition-colors shrink-0" />
              <div>
                <div className="text-sm font-medium text-gray-800">{t(labelKey)}</div>
                <div className="text-xs text-gray-500">{t(descKey)}</div>
              </div>
            </a>
          ))}
        </div>

      </div>
    </div>
  );
};

export default DownloadModal;
