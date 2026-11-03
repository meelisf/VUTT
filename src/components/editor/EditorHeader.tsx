import React from 'react';
import { Loader2, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Work } from '../../types';
import { formatYearDisplay } from '../../utils/yearDisplayUtils';
import { workDisplayTitle } from '../../utils/workTitle';
import { getLangCode } from '../../utils/getLangCode';
import { manuscriptRefLabel } from '../exemplars/exemplarCardUtils';
import { ErrorBanner } from '../ErrorBanner';
import type { EditorTab } from './types';

interface EditorHeaderProps {
  work?: Work;
  activeTab: EditorTab;
  readOnly: boolean;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  statusDirty: boolean;
  saveError: string | null;
  onTabChange: (tab: EditorTab) => void;
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
  const { t, i18n } = useTranslation(['workspace', 'common']);

  return (
    <div className="bg-white border-b border-gray-200 shrink-0 z-20 shadow-sm">
      {work && (() => {
        const title = workDisplayTitle(work, getLangCode(i18n.language));
        // Pealkiri on rea tugevaim element (#587, makett D); lühendatud pealkiri
        // on hõljumisel tervikuna näha, Info vahekaarti avama ei pea.
        const fullTitle = title.secondary ? `${title.main}\n${title.secondary}` : title.main;
        // Käsikirja arhiiviviide eristab sama nimega dokumente (nt senati protokollid) —
        // rea alguses ja lühendamata; lüheneb pealkiri.
        const msRef = manuscriptRefLabel(work.type, work.archive_refs);
        const author = work.creators?.find(c => c.role === 'praeses' || c.role === 'auctor')?.name || work.creators?.[0]?.name || '';
        const year = formatYearDisplay(work.year_display, work.year, t, work.dating);
        const parts: { key: string; node: React.ReactNode }[] = [];
        if (msRef) parts.push({ key: 'ref', node: <span className="font-semibold text-gray-700 whitespace-nowrap shrink-0" data-testid="header-archive-ref">{msRef}</span> });
        if (author) parts.push({ key: 'author', node: <span className="font-semibold text-gray-600 truncate max-w-[200px]">{author}</span> });
        if (year) parts.push({ key: 'year', node: <span className="text-gray-400 min-w-0 max-w-[50%] leading-snug">{year}</span> });
        parts.push({ key: 'title', node: <span className="italic truncate flex-1 min-w-0 text-[13px] font-medium text-gray-800" title={fullTitle}>{title.main}</span> });
        return (
          <div className="px-4 py-1 border-b border-gray-50 flex items-center gap-2 text-xs text-gray-500 bg-gray-50/50">
            {/* Eraldaja ainult olemasolevate osade vahel — puuduv autor/aasta ei jäta tühja vahet. */}
            {parts.map((p, i) => (
              <React.Fragment key={p.key}>
                {i > 0 && <span className="text-gray-300">•</span>}
                {p.node}
              </React.Fragment>
            ))}
          </div>
        );
      })()}

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
