/**
 * Aktiivsed filtrid kiipidena otsingurea all (#587). Näidatakse ainult siis,
 * kui mõni filter on aktiivne — kutsuja otsustab `hasAny` järgi.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { WorkFilterModel } from './useWorkFilterModel';

export const FilterChip: React.FC<{ kind: string; label: React.ReactNode; onRemove: () => void }> = ({ kind, label, onRemove }) => {
  const { t } = useTranslation('common');
  return (
    <span className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 bg-primary-50 text-primary-800 border border-primary-100 rounded-full text-sm max-w-full">
      <span className="text-primary-500 text-xs shrink-0">{kind}:</span>
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="hover:bg-primary-100 rounded-full p-1 shrink-0"
        title={t('filterPanel.removeFilter')}
        aria-label={`${t('filterPanel.removeFilter')}: ${typeof label === 'string' ? label : kind}`}
      >
        <X size={12} />
      </button>
    </span>
  );
};

interface WorkFilterChipsProps {
  model: WorkFilterModel;
  /** Lehe enda filtrid (aasta, autor, respondens, trükkal), mis ei ole mudelis. */
  children?: React.ReactNode;
  onClearAll: () => void;
}

const WorkFilterChips: React.FC<WorkFilterChipsProps> = ({ model, children, onClearAll }) => {
  const { t } = useTranslation(['dashboard', 'common']);
  const { input, effectiveSelectedGenre, effectiveSelectedType, effectiveSelectedTags, languageLabel, tagLabel, toggleTag } = model;
  const { genreIdMap, typeIdMap, selectedStatus, selectedLanguages, onGenreChange, onTypeChange, onStatusChange, onLanguagesChange } = input;

  return (
    <div className="flex flex-wrap items-center gap-2 mt-3">
      {children}
      {effectiveSelectedType && (
        <FilterChip kind={t('dashboard:filters.type')} label={typeIdMap?.[effectiveSelectedType] || effectiveSelectedType} onRemove={() => onTypeChange(null)} />
      )}
      {effectiveSelectedGenre && (
        <FilterChip kind={t('dashboard:filters.genre')} label={genreIdMap?.[effectiveSelectedGenre] || effectiveSelectedGenre} onRemove={() => onGenreChange(null)} />
      )}
      {effectiveSelectedTags.map(tag => (
        <FilterChip key={tag} kind={t('dashboard:filters.tags')} label={tagLabel(tag)} onRemove={() => toggleTag(tag)} />
      ))}
      {selectedLanguages.map(code => (
        <FilterChip key={code} kind={t('dashboard:filters.languages')} label={languageLabel(code)}
          onRemove={() => onLanguagesChange(selectedLanguages.filter(l => l !== code))} />
      ))}
      {selectedStatus && (
        <FilterChip kind={t('dashboard:filters.status')} label={t(`common:status.${selectedStatus}`)} onRemove={() => onStatusChange(null)} />
      )}
      <button type="button" onClick={onClearAll} className="text-sm text-gray-500 hover:text-red-600 ml-1">
        {t('common:filterPanel.clearAll')}
      </button>
    </div>
  );
};

export default WorkFilterChips;
