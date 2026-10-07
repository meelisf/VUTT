import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, Mail } from 'lucide-react';
import { SearchUnit, switchUnitParams } from './searchUnit';

/** Täistekst | Kirjad (#526). Vahetus säilitab ainult päringu ja kogu (vt switchUnitParams). */
const SearchUnitToggle: React.FC<{ unit: SearchUnit }> = ({ unit }) => {
  const { t } = useTranslation('search');
  const [, setSearchParams] = useSearchParams();
  const options: { value: SearchUnit; label: string; icon: React.ReactNode }[] = [
    { value: 'text', label: t('unit.text'), icon: <FileText size={14} /> },
    { value: 'letters', label: t('unit.letters'), icon: <Mail size={14} /> },
  ];
  return (
    <div role="group" aria-label={t('unit.label')} className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          aria-pressed={unit === o.value}
          onClick={() => { if (unit !== o.value) setSearchParams(prev => switchUnitParams(prev, o.value)); }}
          className={`flex items-center gap-1.5 rounded px-3 py-1 text-xs font-semibold transition-colors ${
            unit === o.value ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
};

export default SearchUnitToggle;
