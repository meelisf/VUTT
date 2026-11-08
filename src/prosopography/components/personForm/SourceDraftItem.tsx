// src/prosopography/components/personForm/SourceDraftItem.tsx
/**
 * „Allikad ja bibliograafia" vormirida (ADR 0078): vabatekst või VUTT-i teose/osa
 * viide. Teose pealkirja ei salvestata — vorm näitab seda ainult kontrolliks.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookMarked, X } from 'lucide-react';
import RelatedWorkPicker from '../../../components/relations/RelatedWorkPicker';
import { getPartsToc, type WorkPart } from '../../../services/workPartsApi';
import type { SourceDraft } from './types';

const inputCls = 'px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none';

interface Props {
  item: SourceDraft;
  onChange: (item: SourceDraft) => void;
  onRemove: () => void;
  /** work_id → pealkiri (vormi kontrolliks). */
  titleOf: (workId: string) => string | undefined;
  lang: string;
  token: string | null;
}

const SourceDraftItem: React.FC<Props> = ({ item, onChange, onRemove, titleOf, lang, token }) => {
  const { t } = useTranslation(['prosopography', 'workspace']);
  const [picking, setPicking] = useState(false);
  const [parts, setParts] = useState<WorkPart[]>([]);
  const workId = item.work_id || null;

  useEffect(() => {
    if (!workId) { setParts([]); return; }
    let alive = true;
    getPartsToc(workId, token).then(r => { if (alive) setParts(r.parts); }).catch(() => { if (alive) setParts([]); });
    return () => { alive = false; };
  }, [workId, token]);

  const unlink = () => onChange({ text: item.text, note: item.note });
  const pick = (id: string) => {
    setPicking(false);
    onChange({ ...item, work_id: id, part_id: null, page: '', printed_page: '' });
  };

  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
      {workId && (
        <div className="flex items-center gap-2 text-sm">
          <BookMarked size={14} className="text-primary-600 shrink-0" />
          <span className="flex-1 min-w-0 truncate text-gray-800" title={workId}>{titleOf(workId) || workId}</span>
          <button type="button" onClick={unlink} className="text-xs text-gray-500 hover:text-red-600 shrink-0">
            {t('form.sourceUnlinkWork')}
          </button>
        </div>
      )}
      {workId && (
        <div className="flex flex-wrap gap-2">
          {parts.length > 0 && (
            <select
              value={item.part_id ?? ''}
              onChange={e => onChange({ ...item, part_id: e.target.value || null })}
              className={`flex-1 min-w-[12rem] ${inputCls} bg-white`}
              aria-label={t('form.sourcePart')}
            >
              <option value="">{t('form.sourceWholeWork')}</option>
              {parts.map(part => (
                <option key={part.id} value={part.id}>
                  {[t(`workspace:manage.parts.kinds.${part.kind}`, { defaultValue: part.kind }), part.title]
                    .filter(Boolean).join(' · ')}
                </option>
              ))}
            </select>
          )}
          <input
            type="text"
            inputMode="numeric"
            value={item.page ?? ''}
            onChange={e => onChange({ ...item, page: e.target.value.replace(/\D/g, '') })}
            placeholder={t('form.sourcePage')}
            title={t('form.sourcePageHint')}
            className={`w-28 ${inputCls} bg-white`}
          />
          <input
            type="text"
            value={item.printed_page ?? ''}
            onChange={e => onChange({ ...item, printed_page: e.target.value })}
            placeholder={t('form.sourcePrintedPage')}
            className={`w-32 ${inputCls} bg-white`}
          />
        </div>
      )}
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <input
            type="text"
            value={item.text}
            onChange={e => onChange({ ...item, text: e.target.value })}
            placeholder={t(workId ? 'form.sourceWorkTextPlaceholder' : 'form.sourcePlaceholder')}
            className={`w-full ${inputCls}`}
          />
        </div>
        <button type="button" onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0 mt-0.5">
          <X size={14} />
        </button>
      </div>
      <input
        type="text"
        value={item.note}
        onChange={e => onChange({ ...item, note: e.target.value })}
        placeholder={t('form.sourceNote')}
        className={`w-full ${inputCls} bg-white text-gray-600 italic`}
      />
      {!workId && (picking
        ? <RelatedWorkPicker excludeIds={[]} lang={lang} onPick={pick} />
        : (
          <button type="button" onClick={() => setPicking(true)}
                  className="inline-flex items-center gap-1 text-xs text-primary-700 hover:text-primary-900">
            <BookMarked size={12} /> {t('form.sourceLinkWork')}
          </button>
        ))}
    </div>
  );
};

export default SourceDraftItem;
