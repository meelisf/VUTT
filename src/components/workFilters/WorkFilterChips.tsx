/**
 * Aktiivsed filtrid kiipidena otsingurea all (#587). Näidatakse ainult siis,
 * kui mõni filter on aktiivne — kutsuja otsustab `hasAny` järgi.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { WorkFilterModel } from './useWorkFilterModel';

export const FilterChip: React.FC<{ kind: string; label: React.ReactNode; onRemove: () => void; highlight?: boolean }> = ({ kind, label, onRemove, highlight }) => {
  const { t } = useTranslation('common');
  return (
    <span className={`inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 bg-primary-50 text-primary-800 border border-primary-100 rounded-full text-sm max-w-full${highlight ? ' animate-hint-flash' : ''}`}>
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

/**
 * Filtrivihje (#605): PAKUTUD, veel rakendamata filter. Kollane punktiir =
 * VUTT-is „muutus / tähelepanu"; vastuvõtu järel asendub tavalise sinise
 * FilterChip-iga samas kohas.
 */
export const FilterHintChip: React.FC<{ kind: string; label: string; count: number; onAccept: () => void }> = ({ kind, label, count, onAccept }) => {
  const { t } = useTranslation('dashboard');
  return (
    <button
      type="button"
      onClick={onAccept}
      aria-label={`${t('dashboard:filterHints.addFilter')}: ${kind} ${label}`}
      title={t('dashboard:filterHints.addFilter')}
      className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-white text-amber-800 border-[1.5px] border-dashed border-amber-400 rounded-full text-sm hover:bg-amber-50 max-w-full"
    >
      <span aria-hidden="true">+</span>
      <span className="text-amber-700 text-xs shrink-0">{kind}:</span>
      <span className="truncate">{label}</span>
      <span className="text-gray-400 text-xs shrink-0">({count})</span>
    </button>
  );
};

type HighlightKind = 'genre' | 'tag' | 'type' | 'language' | 'status';

interface WorkFilterChipsProps {
  model: WorkFilterModel;
  /** Lehe enda filtrid (aasta, autor, respondens, trükkal), mis ei ole mudelis. */
  children?: React.ReactNode;
  onClearAll: () => void;
  /** Filtrivihjed (#605) — renderdatakse PÄRAST rakendatud kiipe. */
  hints?: React.ReactNode;
  /** Kas on rakendatud filtreid (eraldaja + „Tühjenda"). Vaikimisi tõene. */
  hasApplied?: boolean;
  /** Äsja vastuvõetud vihje → selle kiip sähvatab korra. */
  highlight?: { kind: HighlightKind; value: string; label: string } | null;
}

const WorkFilterChips: React.FC<WorkFilterChipsProps> = ({ model, children, onClearAll, hints, hasApplied = true, highlight }) => {
  const { t } = useTranslation(['dashboard', 'common']);
  const { input, effectiveSelectedGenre, effectiveSelectedType, effectiveSelectedTags, selectedGenreItemValue, selectedTypeItemValue, languageLabel, tagLabel, toggleTag } = model;
  const { genreIdMap, typeIdMap, selectedStatus, selectedLanguages, onGenreChange, onTypeChange, onStatusChange, onLanguagesChange } = input;
  // Valitud väärtus võib olla Q-kood VÕI silt (keelevahetuse iseparandus) — võrdle mõlemat
  const isHi = (kind: HighlightKind, ...vals: (string | null | undefined)[]) =>
    !!highlight && highlight.kind === kind && vals.some(v => v === highlight.value || v === highlight.label);

  return (
    <div className="flex flex-wrap items-center gap-2 mt-3">
      {children}
      {effectiveSelectedType && (
        <FilterChip kind={t('dashboard:filters.type')} label={typeIdMap?.[effectiveSelectedType] || effectiveSelectedType}
          onRemove={() => onTypeChange(null)} highlight={isHi('type', effectiveSelectedType, selectedTypeItemValue, typeIdMap?.[effectiveSelectedType])} />
      )}
      {effectiveSelectedGenre && (
        <FilterChip kind={t('dashboard:filters.genre')} label={genreIdMap?.[effectiveSelectedGenre] || effectiveSelectedGenre}
          onRemove={() => onGenreChange(null)} highlight={isHi('genre', effectiveSelectedGenre, selectedGenreItemValue, genreIdMap?.[effectiveSelectedGenre])} />
      )}
      {effectiveSelectedTags.map(tag => (
        <FilterChip key={tag} kind={t('dashboard:filters.tags')} label={tagLabel(tag)} onRemove={() => toggleTag(tag)}
          highlight={isHi('tag', tag, tagLabel(tag))} />
      ))}
      {selectedLanguages.map(code => (
        <FilterChip key={code} kind={t('dashboard:filters.languages')} label={languageLabel(code)}
          onRemove={() => onLanguagesChange(selectedLanguages.filter(l => l !== code))} highlight={isHi('language', code)} />
      ))}
      {selectedStatus && (
        <FilterChip kind={t('dashboard:filters.status')} label={t(`common:status.${selectedStatus}`)} onRemove={() => onStatusChange(null)}
          highlight={isHi('status', selectedStatus)} />
      )}
      {hasApplied && hints && <span className="w-px h-[18px] bg-gray-200" aria-hidden="true" />}
      {hints}
      {hasApplied && (
        <button type="button" onClick={onClearAll} className="text-sm text-gray-500 hover:text-red-600 ml-auto">
          {t('common:filterPanel.clearAll')}
        </button>
      )}
    </div>
  );
};

export default WorkFilterChips;
