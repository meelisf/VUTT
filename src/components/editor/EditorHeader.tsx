import { Loader2, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Work } from '../../types';
import { formatYearDisplay } from '../../utils/yearDisplayUtils';
import { ErrorBanner } from '../ErrorBanner';

type TabType = 'edit' | 'annotate' | 'history';

interface EditorHeaderProps {
  work?: Work;
  activeTab: TabType;
  readOnly: boolean;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  statusDirty: boolean;
  saveError: string | null;
  onTabChange: (tab: TabType) => void;
  onSave: () => void;
  onClearSaveError: () => void;
}

// Tekstiredaktori ülemine päis: teose info, vahekaardid ja salvestusnupp.
export default function EditorHeader({
  work,
  activeTab,
  readOnly,
  isSaving,
  hasUnsavedChanges,
  statusDirty,
  saveError,
  onTabChange,
  onSave,
  onClearSaveError,
}: EditorHeaderProps) {
  const { t } = useTranslation(['workspace', 'common']);

  return (
    <div className="bg-white border-b border-gray-200 shrink-0 z-20 shadow-sm">
      {work && (
        <div className="px-4 py-1.5 border-b border-gray-50 flex items-center gap-2 text-[11px] text-gray-500 bg-gray-50/50">
          <span className="font-bold text-gray-700 truncate max-w-[200px]">{work.creators?.find(c => c.role === 'praeses' || c.role === 'auctor')?.name || work.creators?.[0]?.name || ''}</span>
          <span className="text-gray-300">•</span>
          <span className="text-gray-400">{formatYearDisplay(work.year_display, work.year, t)}</span>
          <span className="text-gray-300">•</span>
          <span className="italic truncate flex-1">{work.title}</span>
        </div>
      )}

      <div className="px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex bg-gray-100 p-0.5 rounded-lg shadow-inner">
          <button
            onClick={() => onTabChange('edit')}
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'edit' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {(readOnly ? t('tabs.view') : t('tabs.edit')).toUpperCase()}
          </button>
          <button
            onClick={() => onTabChange('annotate')}
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'annotate' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {t('tabs.info').toUpperCase()}
          </button>
          <button
            onClick={() => onTabChange('history')}
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'history' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {t('tabs.history').toUpperCase()}
          </button>
        </div>

        {!readOnly && (
          <div className="flex items-center gap-2">
            <button
              onClick={onSave}
              disabled={isSaving}
              className={`flex items-center gap-2 px-5 py-1.5 text-xs font-bold uppercase tracking-wider text-white rounded shadow-sm transition-all active:scale-95 disabled:opacity-50 ${(hasUnsavedChanges || statusDirty)
                ? 'bg-amber-500 hover:bg-amber-600'
                : 'bg-primary-600 hover:bg-primary-700'
                }`}
            >
              {isSaving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
              {isSaving ? t('editor.saving') : t('editor.save').toUpperCase()}
            </button>
          </div>
        )}
      </div>
      {saveError && (
        <ErrorBanner
          message={saveError}
          onClose={onClearSaveError}
          className="mx-4 mb-2"
        />
      )}
    </div>
  );
}
