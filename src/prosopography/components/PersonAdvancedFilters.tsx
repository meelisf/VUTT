import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, CalendarDays, ChevronDown, ChevronRight, Crown, Database, MapPin, Search, Tag, Venus, X } from 'lucide-react';

export type GenderFilter = '' | 'M' | 'F';

interface FacetItem {
  value: string;
  label: string;
  count: number;
}

interface InstitutionItem {
  value: string;
  count: number;
}

interface FilterSectionProps {
  title: string;
  icon: React.ReactNode;
  items: FacetItem[];
  selectedValue: string;
  onSelect: (value: string) => void;
  searchPlaceholder: string;
  emptyLabel: string;
}

interface PersonAdvancedFiltersProps {
  gender: GenderFilter;
  originGroup: string;
  originPlace: string;
  institution: string;
  source: string;
  yearFrom: string;
  yearTo: string;
  statusId: string;
  tag: string;
  originGroups: FacetItem[];
  institutions: InstitutionItem[];
  tagFacets: FacetItem[];
  seisused: { id: string; label: { et: string; en: string } }[];
  onGenderChange: (v: GenderFilter) => void;
  onOriginGroupChange: (v: string) => void;
  onOriginPlaceChange: (v: string) => void;
  onInstitutionChange: (v: string) => void;
  onSourceChange: (v: string) => void;
  onYearFromChange: (v: string) => void;
  onYearToChange: (v: string) => void;
  onStatusIdChange: (v: string) => void;
  onTagChange: (v: string) => void;
  onClearAll: () => void;
}

const FilterSection: React.FC<FilterSectionProps> = ({
  title, icon, items, selectedValue, onSelect, searchPlaceholder, emptyLabel,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const showSearch = items.length > 8;

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const lowerQuery = searchQuery.trim().toLowerCase();
    return items.filter(item => item.label.toLowerCase().includes(lowerQuery));
  }, [items, searchQuery]);

  return (
    <div>
      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
        <span className="text-primary-600">{icon}</span>
        {title}
      </h4>
      {showSearch && (
        <div className="relative mb-1.5">
          <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
            <Search size={14} className="text-gray-400" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-8 pr-3 py-1 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white/50"
          />
        </div>
      )}
      <div className="max-h-32 overflow-y-auto custom-scrollbar pr-1">
        <div className="flex flex-wrap gap-2">
          {filteredItems.length === 0 ? (
            <span className="text-sm text-gray-400 italic py-1">{emptyLabel}</span>
          ) : (
            filteredItems.map(({ value, label, count }) => {
              const isSelected = selectedValue === value;
              return (
                <button
                  key={value}
                  onClick={() => onSelect(isSelected ? '' : value)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors text-left ${
                    isSelected ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {label} <span className="opacity-60 text-xs">({count})</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

const PersonAdvancedFilters: React.FC<PersonAdvancedFiltersProps> = ({
  gender, originGroup, originPlace, institution, source, yearFrom, yearTo, statusId, tag,
  originGroups, institutions, tagFacets, seisused,
  onGenderChange, onOriginGroupChange, onOriginPlaceChange, onInstitutionChange, onSourceChange,
  onYearFromChange, onYearToChange, onStatusIdChange, onTagChange,
  onClearAll,
}) => {
  const { t, i18n } = useTranslation('prosopography');
  const hasYearRange = !!(yearFrom || yearTo);
  const hasActive = !!(originGroup || originPlace || institution || source || gender || hasYearRange || statusId || tag);
  const activeCount = [originGroup, originPlace, institution, source, gender, hasYearRange ? '1' : '', statusId, tag].filter(Boolean).length;
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (hasActive && !isExpanded) setIsExpanded(true);
  }, [hasActive, isExpanded]);

  const institutionFacetItems: FacetItem[] = institutions.map(i => ({
    value: i.value,
    label: i.value,
    count: i.count,
  }));

  return (
    <div className="bg-white/50 rounded-lg border border-gray-200">
      <button
        onClick={() => setIsExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-gray-50 transition-colors rounded-lg"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {t('advancedTitle', 'Täpsemad valikud')}
          {hasActive && (
            <span className="bg-primary-100 text-primary-700 text-xs px-2 py-0.5 rounded-full">
              {activeCount}
            </span>
          )}
        </span>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-3">
          <FilterSection
            title={t('originGroup', 'Päritolu')}
            icon={<MapPin size={13} />}
            items={originGroups}
            selectedValue={originGroup}
            onSelect={onOriginGroupChange}
            searchPlaceholder={t('filterOriginSearch', 'Otsi piirkonda…')}
            emptyLabel={t('filterNoMatches', 'Ei leitud vasteid')}
          />

          <FilterSection
            title={t('filterInstitutionAll', 'Haridusasutus')}
            icon={<BookOpen size={13} />}
            items={institutionFacetItems}
            selectedValue={institution}
            onSelect={onInstitutionChange}
            searchPlaceholder={t('filterInstitutionSearch', 'Otsi asutust…')}
            emptyLabel={t('filterNoMatches', 'Ei leitud vasteid')}
          />

          <FilterSection
            title={t('filterTags')}
            icon={<Tag size={13} />}
            items={tagFacets}
            selectedValue={tag}
            onSelect={onTagChange}
            searchPlaceholder={t('filterTagsSearch')}
            emptyLabel={t('filterNoMatches', 'Ei leitud vasteid')}
          />

          <div>
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
              <Database size={13} className="text-primary-600" />
              {t('filterSourceAll', 'Allikas')}
            </h4>
            <div className="flex flex-wrap gap-2">
              {[['aa', t('filterSourceAA', 'Album Academicum')]].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => onSourceChange(source === val ? '' : val)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    source === val ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
              <CalendarDays size={13} className="text-primary-600" />
              {t('filterYearRange', 'Aastavahemik')}
            </h4>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={yearFrom}
                onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); onYearFromChange(v); }}
                placeholder="1632"
                className="w-24 px-2 py-1 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white/50"
              />
              <span className="text-xs text-gray-400">–</span>
              <input
                type="text"
                inputMode="numeric"
                value={yearTo}
                onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); onYearToChange(v); }}
                placeholder="1710"
                className="w-24 px-2 py-1 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white/50"
              />
            </div>
          </div>

          <div>
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Venus size={13} className="text-primary-600" />
              {t('filterGenderAll', 'Sugu')}
            </h4>
            <div className="flex flex-wrap gap-2">
              {([['M', t('filterMale', 'Meessoost')], ['F', t('filterFemale', 'Naissoost')]] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => onGenderChange(gender === val ? '' : val)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    gender === val ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Crown size={13} className="text-primary-600" />
              {t('filterStatus', 'Seisus')}
            </h4>
            <div className="flex flex-wrap gap-2">
              {seisused.map(item => {
                const label = i18n.language?.startsWith('en') ? item.label.en : item.label.et;
                return (
                  <button
                    key={item.id}
                    onClick={() => onStatusIdChange(statusId === item.id ? '' : item.id)}
                    className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                      statusId === item.id ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {hasActive && (
            <div className="pt-2 border-t border-gray-100 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {originPlace && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200">
                    <MapPin size={11} className="shrink-0" />
                    {originPlace}
                    <button onClick={() => onOriginPlaceChange('')} className="hover:bg-primary-100 rounded-full p-0.5"><X size={11} /></button>
                  </span>
                )}
                {originGroup && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200">
                    {originGroups.find(g => g.value === originGroup)?.label ?? originGroup}
                    <button onClick={() => onOriginGroupChange('')} className="hover:bg-primary-100 rounded-full p-0.5"><X size={11} /></button>
                  </span>
                )}
                {institution && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200">
                    {institution}
                    <button onClick={() => onInstitutionChange('')} className="hover:bg-primary-100 rounded-full p-0.5"><X size={11} /></button>
                  </span>
                )}
                {source && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200">
                    {source === 'aa' ? t('filterSourceAA', 'Album Academicum') : source}
                    <button onClick={() => onSourceChange('')} className="hover:bg-primary-100 rounded-full p-0.5"><X size={11} /></button>
                  </span>
                )}
                {gender && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200">
                    {gender === 'M' ? t('filterMale', 'Meessoost') : t('filterFemale', 'Naissoost')}
                    <button onClick={() => onGenderChange('')} className="hover:bg-primary-100 rounded-full p-0.5"><X size={11} /></button>
                  </span>
                )}
                {hasYearRange && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200">
                    {t('filterYearRangeShort', 'Aeg')} {yearFrom || '…'}–{yearTo || '…'}
                    <button onClick={() => { onYearFromChange(''); onYearToChange(''); }} className="hover:bg-primary-100 rounded-full p-0.5"><X size={11} /></button>
                  </span>
                )}
                {statusId && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200">
                    {(() => {
                      const item = seisused.find(s => s.id === statusId);
                      return item ? (i18n.language?.startsWith('en') ? item.label.en : item.label.et) : statusId;
                    })()}
                    <button onClick={() => onStatusIdChange('')} className="hover:bg-primary-100 rounded-full p-0.5"><X size={11} /></button>
                  </span>
                )}
              </div>
              <button onClick={onClearAll} className="text-xs text-red-600 hover:text-red-700 font-medium flex items-center gap-1">
                {t('clearAllFilters', 'Tühjenda kõik filtrid')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PersonAdvancedFilters;
