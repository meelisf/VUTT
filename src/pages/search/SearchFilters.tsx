import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Vocabularies } from '../../services/collectionService';
import CollapsibleSection from '../../components/CollapsibleSection';
import SearchableFilterList from './SearchableFilterList';
import { Layers, Calendar, BookOpen, Tag, FileType, User, FileText } from 'lucide-react';

interface WorkInfo {
    title: string;
    year?: string | number;
    author?: string;
}

interface AvailableWork {
    id: string;
    title: string;
    year?: number;
    author?: string;
    count: number;
}

export interface SearchFiltersProps {
    // Filter state (kontrollitud SearchPage-st)
    selectedScope: 'all' | 'original' | 'annotation';
    yearStart: string;
    yearEnd: string;
    selectedGenres: string[];
    selectedTypes: string[];
    selectedTeoseTags: string[];
    selectedAuthor: string;
    authorInput: string;
    showAuthorSuggestions: boolean;
    selectedWork: string;
    selectedWorkInfo: WorkInfo | null;
    showFiltersMobile: boolean;

    // Facetite loendid (otsingutulemustest)
    availableGenres: { value: string; count: number }[];
    availableTypes: { value: string; count: number }[];
    availableTeoseTags: { tag: string; count: number }[];
    availableAuthors: { value: string; count: number }[];
    availableWorks: AvailableWork[];

    // Sõnavara ja aliased
    vocabularies: Vocabularies | null;
    aliasMap: Record<string, string>;
    loading: boolean;

    // Callback-id
    onScopeChange: (scope: 'all' | 'original' | 'annotation') => void;
    onYearStartChange: (year: string) => void;
    onYearEndChange: (year: string) => void;
    onGenreToggle: (value: string) => void;
    onTypeToggle: (value: string) => void;
    onTagToggle: (value: string) => void;
    onAuthorInputChange: (value: string) => void;
    onShowAuthorSuggestions: (show: boolean) => void;
    onAuthorSelect: (author: string) => void;
    onAuthorClear: () => void;
    onWorkSelect: (id: string, info: WorkInfo | null) => void;
    onSetMobileFilters: (show: boolean) => void;
    onSearch: (e?: React.FormEvent) => void;
    onClearFilters: () => void;
}

const SearchFilters: React.FC<SearchFiltersProps> = ({
    selectedScope, yearStart, yearEnd,
    selectedGenres, selectedTypes, selectedTeoseTags,
    selectedAuthor, authorInput, showAuthorSuggestions,
    selectedWork, selectedWorkInfo, showFiltersMobile,
    availableGenres, availableTypes, availableTeoseTags, availableAuthors, availableWorks,
    vocabularies, aliasMap, loading,
    onScopeChange, onYearStartChange, onYearEndChange,
    onGenreToggle, onTypeToggle, onTagToggle,
    onAuthorInputChange, onShowAuthorSuggestions, onAuthorSelect, onAuthorClear,
    onWorkSelect, onSetMobileFilters, onSearch, onClearFilters,
}) => {
    const { t, i18n } = useTranslation(['search', 'common']);
    const authorInputRef = useRef<HTMLInputElement>(null);
    const lang = i18n.language.split('-')[0] as 'et' | 'en';

    const hasActiveFilters = (yearStart && yearStart !== '1630') || (yearEnd && yearEnd !== '1710') ||
        selectedScope !== 'all' || selectedWork || selectedTeoseTags.length > 0 ||
        selectedGenres.length > 0 || selectedTypes.length > 0 || selectedAuthor;

    return (
        <aside className={`
            md:w-64 md:flex md:flex-col md:border-r border-gray-200 bg-white p-6 overflow-y-auto shrink-0 z-10
            ${showFiltersMobile ? 'absolute inset-0 z-30 flex flex-col' : 'hidden'}
        `}>
            <div className="flex justify-between items-center mb-6 md:hidden">
                <h3 className="font-bold text-lg">{t('filters.title')}</h3>
                <button onClick={() => onSetMobileFilters(false)}>{t('filters.close')}</button>
            </div>

            <div className="space-y-2">

                {/* Otsingu ulatus */}
                <CollapsibleSection
                    title={t('filters.scope')}
                    icon={<Layers size={14} />}
                    defaultOpen={true}
                    badge={selectedScope !== 'all' ? 1 : undefined}
                >
                    <div className="space-y-2">
                        {(['all', 'original', 'annotation'] as const).map(scope => (
                            <label key={scope} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                <input
                                    type="radio"
                                    name="scope"
                                    value={scope}
                                    checked={selectedScope === scope}
                                    onChange={() => onScopeChange(scope)}
                                    className="text-primary-600 focus:ring-primary-500"
                                />
                                <span className="text-sm text-gray-700">{t(`filters.scope${scope.charAt(0).toUpperCase() + scope.slice(1)}`)}</span>
                            </label>
                        ))}
                    </div>
                </CollapsibleSection>

                {/* Aasta filter */}
                <CollapsibleSection
                    title={t('filters.timeRange')}
                    icon={<Calendar size={14} />}
                    defaultOpen={true}
                    badge={(yearStart && yearStart !== '1630') || (yearEnd && yearEnd !== '1710') ? 1 : undefined}
                >
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-xs text-gray-400 mb-1 block">{t('filters.from')}</label>
                            <input
                                type="number"
                                value={yearStart}
                                onChange={(e) => onYearStartChange(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded text-sm text-center"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-400 mb-1 block">{t('filters.until')}</label>
                            <input
                                type="number"
                                value={yearEnd}
                                onChange={(e) => onYearEndChange(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded text-sm text-center"
                            />
                        </div>
                    </div>
                </CollapsibleSection>

                {/* Žanri filter */}
                {availableGenres.length > 0 && (
                    <CollapsibleSection
                        title={t('filters.genre')}
                        icon={<BookOpen size={14} />}
                        defaultOpen={selectedGenres.length > 0}
                        badge={selectedGenres.length || undefined}
                    >
                        <SearchableFilterList
                            items={availableGenres.map(({ value, count }) => ({
                                value,
                                count,
                                label: vocabularies?.genres?.[value]?.[lang] || vocabularies?.genres?.[value]?.et || value
                            }))}
                            selectedValues={selectedGenres}
                            onToggle={onGenreToggle}
                            placeholder={t('filters.searchGenre', 'Otsi žanrit...')}
                        />
                    </CollapsibleSection>
                )}

                {/* Märksõnade filter */}
                {availableTeoseTags.length > 0 && (
                    <CollapsibleSection
                        title={t('filters.tags')}
                        icon={<Tag size={14} />}
                        defaultOpen={selectedTeoseTags.length > 0}
                        badge={selectedTeoseTags.length || undefined}
                    >
                        <SearchableFilterList
                            items={availableTeoseTags.map(({ tag, count }) => ({ value: tag, label: tag, count }))}
                            selectedValues={selectedTeoseTags}
                            onToggle={onTagToggle}
                            placeholder={t('filters.searchTag', 'Otsi märksõna...')}
                        />
                    </CollapsibleSection>
                )}

                {/* Tüübi filter */}
                {availableTypes.length > 0 && (
                    <CollapsibleSection
                        title={t('filters.type')}
                        icon={<FileType size={14} />}
                        defaultOpen={selectedTypes.length > 0}
                        badge={selectedTypes.length || undefined}
                    >
                        <SearchableFilterList
                            items={availableTypes.filter(({ value }) => value && value.trim()).map(({ value, count }) => ({
                                value,
                                count,
                                label: vocabularies?.types?.[value]?.[lang] || vocabularies?.types?.[value]?.et || value
                            }))}
                            selectedValues={selectedTypes}
                            onToggle={onTypeToggle}
                            placeholder={t('filters.searchType', 'Otsi tüüpi...')}
                        />
                    </CollapsibleSection>
                )}

                {/* Autori filter autocomplete'iga */}
                <CollapsibleSection
                    title={t('filters.author')}
                    icon={<User size={14} />}
                    defaultOpen={!!selectedAuthor}
                    badge={selectedAuthor ? 1 : undefined}
                >
                    <div className="relative">
                        <input
                            ref={authorInputRef}
                            type="text"
                            value={authorInput}
                            onChange={(e) => {
                                onAuthorInputChange(e.target.value);
                                onShowAuthorSuggestions(true);
                            }}
                            onFocus={() => onShowAuthorSuggestions(true)}
                            onBlur={() => setTimeout(() => onShowAuthorSuggestions(false), 200)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (authorInput.trim()) {
                                        const resolved = aliasMap[authorInput.trim()] || authorInput.trim();
                                        onAuthorSelect(resolved);
                                    }
                                } else if (e.key === 'Escape') {
                                    onShowAuthorSuggestions(false);
                                }
                            }}
                            placeholder={t('filters.authorPlaceholder')}
                            className="w-full p-2 border border-gray-300 rounded text-sm focus:border-primary-500 outline-none"
                        />
                        {/* Autocomplete soovitused */}
                        {showAuthorSuggestions && authorInput.length >= 2 && (() => {
                            const input = authorInput.toLowerCase();
                            const directMatches = availableAuthors.filter(({ value }) => value.toLowerCase().includes(input));
                            const aliasMatches: { value: string; count: number; matchedAlias: string }[] = [];
                            const directNames = new Set(directMatches.map(m => m.value));
                            for (const [alias, canonical] of Object.entries(aliasMap)) {
                                if (alias.toLowerCase().includes(input) && !directNames.has(canonical)) {
                                    const authorEntry = availableAuthors.find(a => a.value === canonical);
                                    if (authorEntry && !aliasMatches.some(m => m.value === canonical)) {
                                        aliasMatches.push({ value: canonical, count: authorEntry.count, matchedAlias: alias });
                                        directNames.add(canonical);
                                    }
                                }
                            }
                            const allMatches = [
                                ...directMatches.map(m => ({ ...m, matchedAlias: '' })),
                                ...aliasMatches
                            ].slice(0, 10);

                            return (
                                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                    {allMatches.map(({ value, count, matchedAlias }) => (
                                        <button
                                            key={value}
                                            type="button"
                                            onMouseDown={(e) => { e.preventDefault(); onAuthorSelect(value); }}
                                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex justify-between items-center"
                                        >
                                            <span className="truncate">
                                                {value}
                                                {matchedAlias && (
                                                    <span className="text-gray-400 text-xs ml-1">← {matchedAlias}</span>
                                                )}
                                            </span>
                                            <span className="text-xs text-gray-400 ml-2">({count})</span>
                                        </button>
                                    ))}
                                    {allMatches.length === 0 && (
                                        <div className="px-3 py-2 text-sm text-gray-400">{t('status.noResults')}</div>
                                    )}
                                </div>
                            );
                        })()}
                        {selectedAuthor && (
                            <button
                                type="button"
                                onClick={onAuthorClear}
                                className="mt-2 text-xs text-red-600 hover:text-red-700"
                            >
                                {t('filters.removeAuthorFilter')}
                            </button>
                        )}
                    </div>
                </CollapsibleSection>

                {/* Teose filter */}
                {(availableWorks.length > 0 || selectedWork) && (
                    <CollapsibleSection
                        title={t('filters.work')}
                        icon={<FileText size={14} />}
                        defaultOpen={!!selectedWork}
                        badge={selectedWork ? 1 : undefined}
                    >
                        <SearchableFilterList
                            items={[
                                { value: '', label: t('filters.allWorks'), count: 0 },
                                ...availableWorks.map(w => ({ value: w.id, label: w.title, count: w.count, year: w.year, author: w.author }))
                            ]}
                            selectedValues={[selectedWork]}
                            isRadio={true}
                            onToggle={(value) => {
                                if (value === '') {
                                    onWorkSelect('', null);
                                } else {
                                    const work = availableWorks.find(w => w.id === value);
                                    if (work) onWorkSelect(work.id, { title: work.title, year: work.year, author: work.author });
                                }
                            }}
                            placeholder={t('filters.searchWork', 'Otsi teost...')}
                            renderItem={(item, isSelected) => {
                                if (item.value === '') {
                                    return (
                                        <label key="all" className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded group">
                                            <input
                                                type="radio"
                                                name="work"
                                                checked={!selectedWork}
                                                onChange={() => onWorkSelect('', null)}
                                                className="text-primary-600 focus:ring-primary-500"
                                            />
                                            <span className={`text-sm flex-1 ${!selectedWork ? 'text-primary-700 font-medium' : 'text-gray-700'}`}>
                                                {item.label}
                                            </span>
                                        </label>
                                    );
                                }
                                return (
                                    <label key={item.value} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded group">
                                        <input
                                            type="radio"
                                            name="work"
                                            checked={isSelected}
                                            onChange={() => {
                                                const work = availableWorks.find(w => w.id === item.value);
                                                if (work) onWorkSelect(work.id, { title: work.title, year: work.year, author: work.author });
                                            }}
                                            className="text-primary-600 focus:ring-primary-500 shrink-0"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <span className={`text-sm block truncate ${isSelected ? 'text-primary-700 font-medium' : 'text-gray-700'}`} title={item.label}>
                                                {item.label}
                                            </span>
                                            <span className="text-xs text-gray-400 group-hover:text-gray-500">
                                                {(item as any).year}{(item as any).author ? ` · ${(item as any).author}` : ''}
                                            </span>
                                        </div>
                                        <span className="text-xs text-gray-400 bg-gray-100 px-1.5 rounded-full shrink-0 group-hover:bg-gray-200">
                                            {item.count}
                                        </span>
                                    </label>
                                );
                            }}
                        />
                        {/* Näita valitud teost kui seda pole facetis (nt otselingiga tullakse) */}
                        {selectedWork && !availableWorks.find(w => w.id === selectedWork) && (
                            <div className="mt-2 pt-2 border-t border-gray-100">
                                <label className="flex items-center gap-2 cursor-pointer bg-primary-50 p-1 rounded">
                                    <input type="radio" name="work" checked readOnly className="text-primary-600" />
                                    <div className="flex-1 min-w-0">
                                        <span className="text-sm text-primary-700 font-medium block truncate" title={selectedWorkInfo?.title || selectedWork}>
                                            {selectedWorkInfo?.title || selectedWork}
                                        </span>
                                        {selectedWorkInfo && (
                                            <span className="text-xs text-primary-600 opacity-70">
                                                {selectedWorkInfo.year}{selectedWorkInfo.author ? ` · ${selectedWorkInfo.author}` : ''}
                                            </span>
                                        )}
                                    </div>
                                </label>
                            </div>
                        )}
                    </CollapsibleSection>
                )}

                <div className="pt-4 border-t border-gray-100 space-y-2">
                    <button
                        onClick={(e) => onSearch(e)}
                        disabled={loading}
                        className="w-full py-2 bg-gray-900 text-white rounded text-sm font-bold shadow hover:bg-gray-800 transition-colors disabled:opacity-60"
                    >
                        {t('filters.applyFilters')}
                    </button>
                    {hasActiveFilters && (
                        <button
                            onClick={onClearFilters}
                            className="w-full py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm font-medium hover:bg-red-100 transition-colors"
                        >
                            {t('filters.clearFilters')}
                        </button>
                    )}
                </div>
            </div>
        </aside>
    );
};

export default SearchFilters;
