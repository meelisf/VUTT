import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, MapPin, Search, Venus, X } from 'lucide-react';

export type GenderFilter = '' | 'M' | 'F';

interface FacetItem {
  value: string;
  label: string;
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
  originGroups: FacetItem[];
  onGenderChange: (v: GenderFilter) => void;
  onOriginGroupChange: (v: string) => void;
  onClearAll: () => void;
}

const FilterSection: React.FC<FilterSectionProps> = ({
  title,
  icon,
  items,
  selectedValue,
  onSelect,
  searchPlaceholder,
  emptyLabel,
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
                    isSelected
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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
  gender,
  originGroup,
  originGroups,
  onGenderChange,
  onOriginGroupChange,
  onClearAll,
}) => {
  const { t } = useTranslation('prosopography');
  const hasActive = !!(originGroup || gender);
  const activeCount = [originGroup, gender].filter(Boolean).length;
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (hasActive && !isExpanded) setIsExpanded(true);
  }, [hasActive, isExpanded]);

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

          {hasActive && (
            <div className="pt-2 border-t border-gray-100 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {originGroup && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200">
                    {originGroup}
                    <button onClick={() => onOriginGroupChange('')} className="hover:bg-primary-100 rounded-full p-0.5">
                      <X size={11} />
                    </button>
                  </span>
                )}
                {gender && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200">
                    {gender === 'M' ? t('filterMale', 'Meessoost') : t('filterFemale', 'Naissoost')}
                    <button onClick={() => onGenderChange('')} className="hover:bg-primary-100 rounded-full p-0.5">
                      <X size={11} />
                    </button>
                  </span>
                )}
              </div>
              <button
                onClick={onClearAll}
                className="text-xs text-red-600 hover:text-red-700 font-medium flex items-center gap-1"
              >
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
