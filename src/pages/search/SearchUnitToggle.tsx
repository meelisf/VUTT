import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, Mail } from 'lucide-react';
import { SearchUnit, switchUnitParams } from './searchUnit';

/**
 * Täistekst | Kirjad (#526) sakkidena otsinguvälja kohal: valik juhib kogu vaadet
 * (väli, filtrid, tulemused), mitte üht filtrit — seepärast filtripaneelist väljas.
 * Vahetus säilitab ainult päringu ja kogu (vt switchUnitParams).
 */
const SearchUnitToggle: React.FC<{ unit: SearchUnit }> = ({ unit }) => {
  const { t } = useTranslation('search');
  const [, setSearchParams] = useSearchParams();
  const options: { value: SearchUnit; label: string; icon: React.ReactNode }[] = [
    { value: 'text', label: t('unit.text'), icon: <FileText size={15} /> },
    { value: 'letters', label: t('unit.letters'), icon: <Mail size={15} /> },
  ];
  return (
    <div role="tablist" aria-label={t('unit.label')} className="flex gap-6 mb-3">
      {options.map(o => {
        const active = unit === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => { if (!active) setSearchParams(prev => switchUnitParams(prev, o.value)); }}
            className={`flex items-center gap-1.5 h-9 border-b-[3px] text-sm transition-colors ${
              active
                ? 'border-primary-600 text-primary-700 font-semibold'
                : 'border-transparent text-gray-500 font-medium hover:text-gray-800 hover:border-gray-300'
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
};

export default SearchUnitToggle;
