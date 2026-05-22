import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import EntityPicker from '../../../components/EntityPicker';
import type { TagDraft } from './types';

const TagsList: React.FC<{
  tags: TagDraft[];
  onChange: (v: TagDraft[]) => void;
}> = ({ tags, onChange }) => {
  const { t } = useTranslation(['prosopography']);
  const [pickerValue, setPickerValue] = useState<any>(null);

  const add = (v: any) => {
    if (!v?.label?.trim()) return;
    const tag: TagDraft = { label: v.label, id: v.id ?? null, labels: v.labels ?? undefined };
    onChange([...tags, tag]);
    setPickerValue(null);
  };

  const remove = (i: number) => onChange(tags.filter((_, j) => j !== i));

  return (
    <div>
      <label className="block text-xs text-gray-500 uppercase tracking-wide mb-2">{t('tagsList.label')}</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map((tag, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-primary-50 text-primary-700 border border-primary-200 rounded"
          >
            {tag.label}
            {tag.id && <span className="text-primary-400 font-mono">{tag.id}</span>}
            <button onClick={() => remove(i)} className="text-primary-400 hover:text-primary-700 transition-colors ml-0.5">
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <EntityPicker
        placeholder={t('tagsList.placeholder')}
        type="topic"
        value={pickerValue}
        onChange={v => { if (v) add(v); else setPickerValue(null); }}
        lang="et"
      />
    </div>
  );
};

export default TagsList;
