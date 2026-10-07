import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Languages, MapPin, User, Users, ArrowUpDown } from 'lucide-react';
import CollapsibleSection from '../../../components/CollapsibleSection';
import SearchableFilterList from '../SearchableFilterList';
import { getVocabularies, Vocabularies } from '../../../services/collectionService';
import { getLangCode } from '../../../utils/getLangCode';
import type { LetterFilters as Filters, LetterSort } from '../../../services/letterSearch';

type ListField = 'authors' | 'addressees' | 'placeFrom' | 'placeTo' | 'languages';

interface Props {
  filters: Filters;
  facets: Record<string, Record<string, number>>;
  hasQuery: boolean;
  onChange: (next: Filters) => void;
}

// Tahk (Meili väli) ↔ filtriväli
const SECTIONS: { field: ListField; facet: string; titleKey: string; icon: React.ReactNode }[] = [
  { field: 'authors', facet: 'authors', titleKey: 'letters.author', icon: <User size={14} /> },
  { field: 'addressees', facet: 'addressees', titleKey: 'letters.addressee', icon: <Users size={14} /> },
  { field: 'placeFrom', facet: 'place_from', titleKey: 'letters.placeFrom', icon: <MapPin size={14} /> },
  { field: 'placeTo', facet: 'place_to', titleKey: 'letters.placeTo', icon: <MapPin size={14} /> },
];

const yearValue = (s: string): number | undefined => (/^\d{3,4}$/.test(s) ? Number(s) : undefined);

const LetterFilters: React.FC<Props> = ({ filters, facets, hasQuery, onChange }) => {
  const { t, i18n } = useTranslation('search');
  const lang = getLangCode(i18n.language);
  const [vocabularies, setVocabularies] = useState<Vocabularies | null>(null);
  const [yearStart, setYearStart] = useState(filters.yearStart?.toString() ?? '');
  const [yearEnd, setYearEnd] = useState(filters.yearEnd?.toString() ?? '');

  useEffect(() => { getVocabularies().then(setVocabularies).catch(() => setVocabularies(null)); }, []);
  // URL → mustand (nt tagasi-nupp või filtri eemaldamine mujalt)
  useEffect(() => { setYearStart(filters.yearStart?.toString() ?? ''); }, [filters.yearStart]);
  useEffect(() => { setYearEnd(filters.yearEnd?.toString() ?? ''); }, [filters.yearEnd]);

  const toggle = (field: ListField, value: string) => {
    const current = filters[field];
    onChange({ ...filters, [field]: current.includes(value) ? current.filter(v => v !== value) : [...current, value] });
  };

  const items = (facet: string, selected: string[]) => {
    const dist = facets[facet] || {};
    // Valitud väärtus jääb nähtavaks ka siis, kui tal parasjagu vasteid pole.
    const values = new Set([...Object.keys(dist), ...selected]);
    return [...values]
      .map(value => ({ value, label: value, count: dist[value] || 0 }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };

  const applyYears = () => {
    onChange({ ...filters, yearStart: yearValue(yearStart), yearEnd: yearValue(yearEnd) });
  };

  const languageLabel = (code: string) => vocabularies?.languages?.[code]?.[lang] || vocabularies?.languages?.[code]?.et || code;

  return (
    <div className="divide-y divide-gray-100">
      <CollapsibleSection title={t('letters.sort')} icon={<ArrowUpDown size={14} />} defaultOpen>
        <select
          value={filters.sort === 'relevance' && !hasQuery ? 'date_asc' : filters.sort}
          onChange={e => onChange({ ...filters, sort: e.target.value as LetterSort })}
          className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm"
        >
          {hasQuery && <option value="relevance">{t('letters.sortRelevance')}</option>}
          <option value="date_asc">{t('letters.sortDateAsc')}</option>
          <option value="date_desc">{t('letters.sortDateDesc')}</option>
        </select>
      </CollapsibleSection>

      <CollapsibleSection
        title={t('letters.years')}
        icon={<Calendar size={14} />}
        defaultOpen={filters.yearStart !== undefined || filters.yearEnd !== undefined}
      >
        <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); applyYears(); }}>
          <input type="text" inputMode="numeric" value={yearStart} onChange={e => setYearStart(e.target.value)}
            onBlur={applyYears} placeholder={t('letters.yearFrom')} aria-label={t('letters.yearFrom')}
            className="w-20 rounded border border-gray-200 px-2 py-1 text-sm" />
          <span className="text-gray-400">–</span>
          <input type="text" inputMode="numeric" value={yearEnd} onChange={e => setYearEnd(e.target.value)}
            onBlur={applyYears} placeholder={t('letters.yearTo')} aria-label={t('letters.yearTo')}
            className="w-20 rounded border border-gray-200 px-2 py-1 text-sm" />
        </form>
      </CollapsibleSection>

      {SECTIONS.map(s => {
        const list = items(s.facet, filters[s.field]);
        if (list.length === 0) return null;
        return (
          <CollapsibleSection key={s.field} title={t(s.titleKey)} icon={s.icon}
            defaultOpen={filters[s.field].length > 0} badge={filters[s.field].length || undefined}>
            <SearchableFilterList items={list} selectedValues={filters[s.field]}
              onToggle={v => toggle(s.field, v)} placeholder={t('letters.filterSearch')} />
          </CollapsibleSection>
        );
      })}

      {items('languages', filters.languages).length > 0 && (
        <CollapsibleSection title={t('letters.language')} icon={<Languages size={14} />}
          defaultOpen={filters.languages.length > 0} badge={filters.languages.length || undefined}>
          <SearchableFilterList
            items={items('languages', filters.languages).map(i => ({ ...i, label: languageLabel(i.value) }))}
            selectedValues={filters.languages} onToggle={v => toggle('languages', v)}
            placeholder={t('letters.filterSearch')} />
        </CollapsibleSection>
      )}
    </div>
  );
};

export default LetterFilters;
