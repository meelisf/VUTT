/**
 * „Nimed ja nimekujud” (ADR 0083): üks plokk nii liigiga nimedele (aadlinimi,
 * abielunimi…) kui kirjaviisi variantidele. Uut lahtrit kasutaja otsima ei pea —
 * nimed on seal, kus aliased alati olid.
 *
 * Variant, mis näib teise nimena (`looksLikeOtherName`), saab märgi „Teine nimi?”
 * ja ühe klikiga tõstetakse ta liigiga nimeks. Masin ei otsusta — toimetaja valib liigi.
 * Tõsta saab iga kuju (nool), vihje ainult juhib tähelepanu.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Plus, X } from 'lucide-react';
import { NAME_TYPES, looksLikeOtherName, type NameType, type PersonNameDraft } from '../../utils/personNames';

interface Props {
  label: string;
  aliases: string[];
  names: PersonNameDraft[];
  onChange: (patch: { name_aliases?: string[]; name_names?: PersonNameDraft[] }) => void;
}

const inputCls = 'text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none';

const NamesEditor: React.FC<Props> = ({ label, aliases, names, onChange }) => {
  const { t } = useTranslation(['prosopography']);
  const [input, setInput] = useState('');

  const addVariant = () => {
    const v = input.trim();
    if (v && !aliases.includes(v) && !names.some(n => n.label === v)) onChange({ name_aliases: [...aliases, v] });
    setInput('');
  };

  const promote = (i: number) => {
    const a = aliases[i];
    onChange({
      name_aliases: aliases.filter((_, j) => j !== i),
      name_names: [...names, { label: a, type: 'other', from: '', to: '', source: '', notes: '' }],
    });
  };

  const demote = (i: number) => {
    const n = names[i];
    onChange({
      name_names: names.filter((_, j) => j !== i),
      name_aliases: aliases.includes(n.label) ? aliases : [...aliases, n.label],
    });
  };

  const setName = (i: number, patch: Partial<PersonNameDraft>) =>
    onChange({ name_names: names.map((n, j) => (j === i ? { ...n, ...patch } : n)) });

  return (
    <div>
      <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">{t('names.title')}</label>
      <p className="mb-2 text-xs text-gray-400">{t('names.hint')}</p>

      {/* Liigiga nimed */}
      {names.length > 0 && (
        <ul className="mb-3 space-y-2">
          {names.map((n, i) => (
            <li key={i} className="rounded border border-gray-200 bg-gray-50 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <input aria-label={t('names.form')} value={n.label} onChange={e => setName(i, { label: e.target.value })}
                  className={`${inputCls} min-w-0 flex-1`} />
                <select aria-label={t('names.type')} value={n.type} onChange={e => setName(i, { type: e.target.value as NameType })}
                  className={inputCls}>
                  {NAME_TYPES.map(tp => <option key={tp} value={tp}>{t(`names.types.${tp}`)}</option>)}
                </select>
                <button type="button" onClick={() => demote(i)} title={t('names.demote')}
                  className="text-xs text-gray-500 hover:text-gray-800">{t('names.demoteShort')}</button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                <span>{t('names.from')}</span>
                <input type="text" inputMode="numeric" value={n.from} onChange={e => setName(i, { from: e.target.value })}
                  placeholder="1650" className={`${inputCls} w-20`} />
                <span>{t('names.to')}</span>
                <input type="text" inputMode="numeric" value={n.to} onChange={e => setName(i, { to: e.target.value })}
                  className={`${inputCls} w-20`} />
                <input value={n.source} onChange={e => setName(i, { source: e.target.value })}
                  placeholder={t('names.source')} className={`${inputCls} min-w-0 flex-1`} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Kirjaviisi variandid */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {aliases.map((a, i) => {
          const other = looksLikeOtherName(a, label);
          return (
            <span key={i}
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border ${other ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-gray-100 border-gray-200 text-gray-700'}`}>
              {a}
              {/* Iga kuju saab liigi (ladinastatud kuju sarnaneb, aga on ikkagi liigiga nimi);
                  vihje näitab ainult neid, mis kirjaviisi variandiks ei sobi. */}
              {other ? (
                <button type="button" onClick={() => promote(i)} title={t('names.promoteTitle')}
                  className="inline-flex items-center gap-0.5 font-medium text-amber-800 hover:text-amber-950">
                  <ArrowUp size={10} />{t('names.promote')}
                </button>
              ) : (
                <button type="button" onClick={() => promote(i)} title={t('names.setType')}
                  aria-label={t('names.setType')} className="text-gray-400 hover:text-gray-700">
                  <ArrowUp size={10} />
                </button>
              )}
              <button type="button" onClick={() => onChange({ name_aliases: aliases.filter((_, j) => j !== i) })}
                className="text-gray-400 hover:text-gray-700" aria-label={t('names.remove')}>
                <X size={10} />
              </button>
            </span>
          );
        })}
      </div>
      <div className="flex gap-2">
        <input type="text" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addVariant(); } }}
          placeholder={t('aliasesList.placeholder')} className={`${inputCls} flex-1 py-1.5`} />
        <button type="button" onClick={addVariant} disabled={!input.trim()}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
          <Plus size={12} /> {t('aliasesList.add')}
        </button>
      </div>
    </div>
  );
};

export default NamesEditor;
