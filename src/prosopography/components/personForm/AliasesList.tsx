import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';

const AliasesList: React.FC<{
  aliases: string[];
  onChange: (v: string[]) => void;
}> = ({ aliases, onChange }) => {
  const { t } = useTranslation(['prosopography']);
  const [input, setInput] = useState('');

  const add = () => {
    const v = input.trim();
    if (v && !aliases.includes(v)) onChange([...aliases, v]);
    setInput('');
  };

  const remove = (i: number) => onChange(aliases.filter((_, j) => j !== i));

  return (
    <div>
      <label className="block text-xs text-gray-500 uppercase tracking-wide mb-2">{t('aliasesList.label')}</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {aliases.map((a, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-gray-100 text-gray-700 border border-gray-200 rounded"
          >
            {a}
            <button onClick={() => remove(i)} className="text-gray-400 hover:text-gray-700 transition-colors">
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={t('aliasesList.placeholder')}
          className="flex-1 text-sm px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
        />
        <button
          type="button"
          onClick={add}
          disabled={!input.trim()}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          <Plus size={12} /> {t('aliasesList.add')}
        </button>
      </div>
    </div>
  );
};

export default AliasesList;
