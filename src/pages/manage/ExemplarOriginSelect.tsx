import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Exemplar } from '../../types';

interface Props {
  exemplars: Exemplar[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

/**
 * Uue pildi päritolu (ADR 0076 p 4): eksemplaridega teosel kohustuslik, vaikimisi
 * valikut ei ole — muidu päriks uus pilt vaikselt tekstitunnistaja või vana tüve
 * päritolu. Eksemplarideta teosel komponenti ei kuvata.
 */
const ExemplarOriginSelect: React.FC<Props> = ({ exemplars, value, onChange, disabled, compact }) => {
  const { t } = useTranslation(['workspace']);
  if (exemplars.length === 0) return null;
  const select = (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={t('manage.exemplarOrigin.label')}
      className={`${compact ? 'text-xs py-0.5' : 'text-sm py-1'} border border-gray-300 rounded px-2 focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white max-w-[16rem]`}
    >
      <option value="">{t('manage.exemplarOrigin.choose')}</option>
      <option value="same">{t('manage.exemplarOrigin.same')}</option>
      {exemplars.map((x) => (
        <option key={x.id} value={x.id}>
          {[x.holder, x.shelfmark].filter(Boolean).join(' ')}
          {x.text_witness ? ` (${t('manage.exemplarOrigin.witness')})` : ''}
        </option>
      ))}
      <option value="unknown">{t('manage.exemplarOrigin.unknown')}</option>
    </select>
  );
  if (compact) return select;
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{t('manage.exemplarOrigin.label')}</label>
      {select}
    </div>
  );
};

export default ExemplarOriginSelect;
