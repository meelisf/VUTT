import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Venus, Database, CircleDot, X } from 'lucide-react';

export type GenderFilter = '' | 'M' | 'F';
export type SourceFilter = '' | 'wikidata' | 'gnd' | 'aa';
export type LevelFilter = '' | 'draft' | 'reviewed' | 'verified';

interface PersonAdvancedFiltersProps {
  gender: GenderFilter;
  source: SourceFilter;
  level: LevelFilter;
  onGenderChange: (v: GenderFilter) => void;
  onSourceChange: (v: SourceFilter) => void;
  onLevelChange: (v: LevelFilter) => void;
}

const PersonAdvancedFilters: React.FC<PersonAdvancedFiltersProps> = ({
  gender, source, level, onGenderChange, onSourceChange, onLevelChange,
}) => {
  const { t } = useTranslation(['common']);
  const hasActive = gender || source || level;
  const activeCount = [gender, source, level].filter(Boolean).length;
  const [isExpanded, setIsExpanded] = useState(false);

  // Laienda automaatselt kui filter on aktiivne
  useEffect(() => {
    if (hasActive && !isExpanded) setIsExpanded(true);
  }, [hasActive]);

  const clearAll = () => { onGenderChange(''); onSourceChange(''); onLevelChange(''); };

  const levelColors: Record<string, string> = {
    verified: 'bg-green-100 text-green-700 hover:bg-green-200',
    reviewed: 'bg-amber-100 text-amber-700 hover:bg-amber-200',
    draft:    'bg-gray-100 text-gray-700 hover:bg-gray-200',
  };

  const levelLabels: Record<string, string> = {
    draft:    t('prosopography.levelDraft',    'Mustand'),
    reviewed: t('prosopography.levelReviewed', 'Üle vaadatud'),
    verified: t('prosopography.levelVerified', 'Kontrollitud'),
  };

  return (
    <div className="bg-white/50 rounded-lg border border-gray-200">
      {/* Päis */}
      <button
        onClick={() => setIsExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-gray-50 transition-colors rounded-lg"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {t('filters.advanced', 'Täpsemad valikud')}
          {hasActive && (
            <span className="bg-primary-100 text-primary-700 text-xs px-2 py-0.5 rounded-full">
              {activeCount}
            </span>
          )}
        </span>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-3">

          {/* Sugu */}
          <div>
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Venus size={13} className="text-primary-600" />
              {t('prosopography.filterGenderAll', 'Sugu')}
            </h4>
            <div className="flex flex-wrap gap-2">
              {([['M', t('prosopography.filterMale', 'Meessoost')], ['F', t('prosopography.filterFemale', 'Naissoost')]] as const).map(([val, label]) => (
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

          {/* Allikas */}
          <div>
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Database size={13} className="text-primary-600" />
              {t('prosopography.filterSourceAll', 'Allikas')}
            </h4>
            <div className="flex flex-wrap gap-2">
              {(['wikidata', 'gnd', 'aa'] as const).map(val => {
                const label = val === 'aa' ? 'Album Acad.' : val.charAt(0).toUpperCase() + val.slice(1);
                return (
                  <button
                    key={val}
                    onClick={() => onSourceChange(source === val ? '' : val)}
                    className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                      source === val ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Olek */}
          <div>
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <CircleDot size={13} className="text-primary-600" />
              {t('prosopography.filterLevelAll', 'Olek')}
            </h4>
            <div className="flex flex-wrap gap-2">
              {(['draft', 'reviewed', 'verified'] as const).map(val => (
                <button
                  key={val}
                  onClick={() => onLevelChange(level === val ? '' : val)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    level === val ? 'bg-primary-600 text-white' : levelColors[val]
                  }`}
                >
                  {levelLabels[val]}
                </button>
              ))}
            </div>
          </div>

          {/* Aktiivsed filtrid + tühjenda */}
          {hasActive && (
            <div className="pt-2 border-t border-gray-100 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {gender && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200">
                    {gender === 'M' ? t('prosopography.filterMale', 'Meessoost') : t('prosopography.filterFemale', 'Naissoost')}
                    <button onClick={() => onGenderChange('')} className="hover:bg-primary-100 rounded-full p-0.5"><X size={11} /></button>
                  </span>
                )}
                {source && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200">
                    {source === 'aa' ? 'Album Acad.' : source.charAt(0).toUpperCase() + source.slice(1)}
                    <button onClick={() => onSourceChange('')} className="hover:bg-primary-100 rounded-full p-0.5"><X size={11} /></button>
                  </span>
                )}
                {level && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200">
                    {levelLabels[level]}
                    <button onClick={() => onLevelChange('')} className="hover:bg-primary-100 rounded-full p-0.5"><X size={11} /></button>
                  </span>
                )}
              </div>
              <button
                onClick={clearAll}
                className="text-xs text-red-600 hover:text-red-700 font-medium flex items-center gap-1"
              >
                {t('filters.clearAdvanced', 'Tühjenda kõik filtrid')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PersonAdvancedFilters;
