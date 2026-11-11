import React from 'react';
import { useTranslation } from 'react-i18next';
import { Columns2, Crop } from 'lucide-react';

export type EditorTab = 'edit' | 'split';

interface Props {
  tab: EditorTab;
  onChange: (tab: EditorTab) => void;
}

const tabBtn = (active: boolean) =>
  `flex items-center gap-1.5 rounded-md px-3 py-1 text-sm transition-colors ${
    active ? 'bg-white font-medium text-indigo-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`;

/**
 * Päise vahekaardid „Pööra ja kärbi" / „Poolita". ÜHINE teose halduse
 * pildiredaktorile ja upload'i ülevaatusele (vt `EditToolbar` märkust).
 */
const EditorTabs: React.FC<Props> = ({ tab, onChange }) => {
  const { t } = useTranslation('common');
  return (
    <div role="tablist" className="flex flex-shrink-0 rounded-lg bg-gray-100 p-0.5">
      <button type="button" role="tab" aria-selected={tab === 'edit'} data-testid="editor-tab-edit"
        onClick={() => onChange('edit')} className={tabBtn(tab === 'edit')}>
        <Crop size={14} />{t('pagePrep.tabEdit')}
      </button>
      <button type="button" role="tab" aria-selected={tab === 'split'} data-testid="editor-tab-split"
        onClick={() => onChange('split')} className={tabBtn(tab === 'split')}>
        <Columns2 size={14} />{t('pagePrep.tabSplit')}
      </button>
    </div>
  );
};

export default EditorTabs;
