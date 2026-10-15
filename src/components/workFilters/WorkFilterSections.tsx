/**
 * Teoste filtrite külgriba sisu (#587). Kujundus on ühtne täisteksti otsinguga
 * (`CollapsibleSection` + `SearchableFilterList`). Järjekord: Aasta → Tüüp → Žanr →
 * Märksõnad → Keel → Staatus. Žanril, märksõnadel ja keelel on oma otsingukast,
 * nähtaval viis sagedasemat.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Bookmark, Calendar, CircleDot, FileType, Languages, Tag } from 'lucide-react';
import CollapsibleSection from '../CollapsibleSection';
import SearchableFilterList from '../filters/SearchableFilterList';
import DateRangeInput from '../DateRangeInput';
import type { WorkStatus } from '../../types';
import { workStatusDotClass } from '../../utils/workStatusDot';
import type { WorkFilterModel } from './useWorkFilterModel';

const VISIBLE = 5;
const STATUS_OPTIONS: WorkStatus[] = ['Toores', 'Töös', 'Valmis'];

interface WorkFilterSectionsProps {
  model: WorkFilterModel;
  yearStart: string;
  yearEnd: string;
  onYearStartChange: (v: string) => void;
  onYearEndChange: (v: string) => void;
  /** Staatuse loendurid (`teose_staatus` fassett); puuduv = loendurita. */
  statusCounts?: Record<string, number>;
}

const WorkFilterSections: React.FC<WorkFilterSectionsProps> = ({
  model, yearStart, yearEnd, onYearStartChange, onYearEndChange, statusCounts,
}) => {
  const { t } = useTranslation(['dashboard', 'common']);
  const {
    input, loading, genreItems, tagItems, typeItems, languageItems,
    selectedGenreItemValue, selectedTypeItemValue, effectiveSelectedTags, toggleTag, applyWorkFilter,
  } = model;
  const { selectedStatus, selectedLanguages, onGenreChange, onTypeChange, onStatusChange, onLanguagesChange } = input;

  return (
    <div className="space-y-1">
      <CollapsibleSection
        title={t('common:labels.year')}
        icon={<Calendar size={14} />}
        defaultOpen
        badge={yearStart || yearEnd ? 1 : undefined}
      >
        <DateRangeInput start={yearStart} end={yearEnd} onStartChange={onYearStartChange} onEndChange={onYearEndChange} />
      </CollapsibleSection>

      {loading ? (
        <div className="text-sm text-gray-400 py-2">{t('common:labels.loading')}</div>
      ) : (
        <>
          {typeItems.length > 0 && (
            <CollapsibleSection
              title={t('filters.type')}
              icon={<FileType size={14} />}
              defaultOpen
              badge={selectedTypeItemValue ? 1 : undefined}
            >
              <SearchableFilterList
                items={typeItems}
                selectedValues={selectedTypeItemValue ? [selectedTypeItemValue] : []}
                onToggle={(val) => (selectedTypeItemValue === val ? onTypeChange(null) : applyWorkFilter('type', val))}
                placeholder={t('filters.searchType')}
                collapsedCount={VISIBLE}
              />
            </CollapsibleSection>
          )}

          {genreItems.length > 0 && (
            <CollapsibleSection
              title={t('filters.genre')}
              icon={<Bookmark size={14} />}
              defaultOpen={!!selectedGenreItemValue}
              badge={selectedGenreItemValue ? 1 : undefined}
            >
              <SearchableFilterList
                items={genreItems}
                selectedValues={selectedGenreItemValue ? [selectedGenreItemValue] : []}
                onToggle={(val) => (selectedGenreItemValue === val ? onGenreChange(null) : applyWorkFilter('genre', val))}
                placeholder={t('filters.searchGenre')}
                collapsedCount={VISIBLE}
              />
            </CollapsibleSection>
          )}

          {tagItems.length > 0 && (
            <CollapsibleSection
              title={t('filters.tags')}
              icon={<Tag size={14} />}
              defaultOpen={effectiveSelectedTags.length > 0}
              badge={effectiveSelectedTags.length || undefined}
            >
              <SearchableFilterList
                items={tagItems}
                selectedValues={effectiveSelectedTags}
                onToggle={toggleTag}
                placeholder={t('filters.searchTag')}
                collapsedCount={VISIBLE}
              />
            </CollapsibleSection>
          )}

          {languageItems.length > 0 && (
            <CollapsibleSection
              title={t('filters.languages')}
              icon={<Languages size={14} />}
              defaultOpen={selectedLanguages.length > 0}
              badge={selectedLanguages.length || undefined}
            >
              <SearchableFilterList
                items={languageItems}
                selectedValues={selectedLanguages}
                onToggle={(val) => onLanguagesChange(
                  selectedLanguages.includes(val)
                    ? selectedLanguages.filter(l => l !== val)
                    : [...selectedLanguages, val]
                )}
                placeholder={t('filters.searchLanguage')}
                collapsedCount={VISIBLE}
              />
            </CollapsibleSection>
          )}

          <CollapsibleSection
            title={t('filters.status')}
            icon={<CircleDot size={14} />}
            defaultOpen={!!selectedStatus}
            badge={selectedStatus ? 1 : undefined}
          >
            <div className="space-y-1">
              {STATUS_OPTIONS.map(status => {
                const isSelected = selectedStatus === status;
                const count = statusCounts?.[status];
                return (
                  <label key={status} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded group">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onStatusChange(isSelected ? null : status)}
                      className="text-primary-600 focus:ring-primary-500 rounded"
                    />
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${workStatusDotClass(status)}`} />
                    <span className={`text-sm flex-1 truncate ${isSelected ? 'text-primary-700 font-medium' : 'text-gray-700'}`}>
                      {t(`common:status.${status}`)}
                    </span>
                    {count !== undefined && <span className="text-xs text-gray-400 group-hover:text-gray-600">({count})</span>}
                  </label>
                );
              })}
            </div>
          </CollapsibleSection>
        </>
      )}
    </div>
  );
};

export default WorkFilterSections;
