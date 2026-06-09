import React, { useEffect, useMemo } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getWorkMetadata } from '../services/workService';
import { getCollectionColorClasses } from '../services/collectionService';
import { Search, Filter, Library, FileText, User, X, Layers, Tag, Bookmark, FileType, Calendar } from 'lucide-react';
import Header from '../components/Header';
import { useCollection } from '../contexts/CollectionContext';
import { useMeiliIndex } from '../contexts/MeilisearchContext';
import SearchFilters from './search/SearchFilters';
import SearchResults from './search/SearchResults';
import { getLangCode } from '../utils/getLangCode';
import { resolveEntityLabel } from '../utils/labelUtils';
import { useSearchUrlParams } from './search/hooks/useSearchUrlParams';
import { useSearchResults } from './search/hooks/useSearchResults';
import { useSearchFacets } from './search/hooks/useSearchFacets';
import { useQCodeMaps } from './search/hooks/useQCodeMaps';
import { useFilterDraft } from './search/hooks/useFilterDraft';

const RETURN_URL_KEY = 'vutt_return_url';

const SearchPage: React.FC = () => {
    const { t, i18n } = useTranslation(['search', 'common']);
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();
    const { selectedCollection, setSelectedCollection, getCollectionName, collections } = useCollection();
    const index = useMeiliIndex();

    const urlParams = useSearchUrlParams();
    const lang = i18n.language;
    const langCode = getLangCode(lang);

    const { results, loading, error } = useSearchResults(urlParams, lang, selectedCollection);
    const facets = useSearchFacets(urlParams, lang, selectedCollection, results);
    const qCodeMaps = useQCodeMaps(results, lang, (location.state as any)?.pageTagsLabels);

    // Kollektsiooni järgi filtreeritud isikute nimekiri — kasutab availableTeoseTags faceti
    // mis juba filtreerib kollektsiooni järgi tags_ids-i järgi (sisaldab ka vutt:P IDsid)
    const filteredQCodeMaps = useMemo(() => {
        if (!selectedCollection || facets.availableTeoseTags.length === 0) return qCodeMaps;
        const collectionTagIds = new Set(facets.availableTeoseTags.map(t => t.tag));
        const filteredPersons = qCodeMaps.availablePersonTags.filter(p => collectionTagIds.has(p.id));
        if (filteredPersons.length === qCodeMaps.availablePersonTags.length) return qCodeMaps;
        return { ...qCodeMaps, availablePersonTags: filteredPersons };
    }, [qCodeMaps, selectedCollection, facets.availableTeoseTags]);

    const { draft, actions } = useFilterDraft(urlParams, filteredQCodeMaps);

    // Salvesta otsingu URL sessionStorage'isse
    useEffect(() => {
        const url = '/search' + (searchParams.toString() ? '?' + searchParams.toString() : '');
        sessionStorage.setItem(RETURN_URL_KEY, url);
    }, [searchParams]);

    // Laadi teose info kui tullakse work-filter-iga (nt Workspace'ist)
    useEffect(() => {
        if (urlParams.workId && !draft.selectedWorkInfo && index) {
            getWorkMetadata(index, urlParams.workId).then(work => {
                if (work) {
                    let author = (work as any).author || '';
                    if (work.creators?.length > 0) {
                        const praeses = work.creators.find((c: any) => c.role === 'praeses');
                        if (praeses) author = praeses.name;
                    }
                    actions.setSelectedWorkInfo({ title: work.title, year: work.year || undefined, author });
                }
            });
        } else if (!urlParams.workId) {
            actions.setSelectedWorkInfo(null);
        }
    }, [urlParams.workId, index]);

    const { genreLabelToId, typeLabelToId, tagsLabelToId } = qCodeMaps;

    const workHitCounts = results?.facetDistribution?.['work_id'] || {};
    const uniqueWorkIds = new Set(results?.hits?.map(h => h.work_id) || []);
    const availableWorks = (results?.hits && !urlParams.workId && !loading && uniqueWorkIds.size > 1)
        ? (() => {
            const seenIds = new Set<string>();
            return results.hits.reduce<Array<{id: string; title: string; year?: number; author?: string; count: number}>>(
                (acc, hit) => {
                    if (!seenIds.has(hit.work_id)) {
                        seenIds.add(hit.work_id);
                        acc.push({
                            id: hit.work_id,
                            title: hit.title || hit.work_id,
                            year: typeof hit.year === 'number' ? hit.year : undefined,
                            author: (() => { const a = (hit as any).autor; return Array.isArray(a) ? a[0] : a; })(),
                            count: workHitCounts[hit.work_id] || 1
                        });
                    }
                    return acc;
                },
                []
            );
        })()
        : [];

    const resolveLabel = (qCode: string, fallbackMap?: Record<string, string>) =>
        resolveEntityLabel(qCode, qCodeMaps.enrichedLabels, langCode, fallbackMap);

    return (
        <div className="h-full bg-gray-50 font-sans flex flex-col overflow-hidden">
            <Header>
                {/* Otsingu vorm */}
                <div className="bg-white border-b border-gray-200 px-6 py-4">
                    <div className="max-w-7xl mx-auto">
                        <form onSubmit={actions.commit} className="flex gap-2 relative">
                            <div className="relative flex-1">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                                <input
                                    type="text"
                                    placeholder={t('form.searchPlaceholder')}
                                    value={draft.inputValue}
                                    onChange={(e) => actions.setInputValue(e.target.value)}
                                    className={`w-full pl-12 py-3 rounded-lg border border-gray-300 shadow-sm focus:ring-2 focus:ring-primary-100 focus:border-primary-500 outline-none text-lg ${draft.inputValue ? 'pr-10' : 'pr-4'}`}
                                    autoFocus
                                />
                                {draft.inputValue && (
                                    <button
                                        type="button"
                                        onClick={() => actions.setInputValue('')}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                                        tabIndex={-1}
                                        aria-label={t('common:form.clearSearch')}
                                    >
                                        <X size={18} />
                                    </button>
                                )}
                            </div>
                            <button type="submit" className="bg-primary-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-primary-700 transition-colors shadow-sm">
                                {t('form.search')}
                            </button>
                            <button
                                type="button"
                                onClick={() => actions.setShowFiltersMobile(!draft.showFiltersMobile)}
                                className="md:hidden p-3 bg-white border border-gray-300 rounded-lg text-gray-600"
                            >
                                <Filter size={20} />
                            </button>
                        </form>

                        {/* Aktiivsed filtrid otsinguriba all */}
                        {(draft.selectedAuthor || draft.selectedPersonTag || draft.selectedWork || selectedCollection || urlParams.scope !== 'all' ||
                            urlParams.pageTags.length > 0 || urlParams.genres.length > 0 || urlParams.types.length > 0 ||
                            urlParams.teoseTags.length > 0 || urlParams.yearStart !== undefined || urlParams.yearEnd !== undefined) && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-3">
                                {/* Ajavahemik */}
                                {(urlParams.yearStart !== undefined || urlParams.yearEnd !== undefined) && (
                                    <div className="flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs font-medium border border-slate-200">
                                        <Calendar size={11} />
                                        <span>{urlParams.yearStart ?? ''}–{urlParams.yearEnd ?? ''}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                actions.setYearStart(''); actions.setYearEnd('');
                                                setSearchParams(prev => { prev.delete('ys'); prev.delete('ye'); prev.set('p', '1'); return prev; });
                                            }}
                                            className="ml-0.5 hover:bg-slate-200 rounded-full p-0.5"
                                            title={t('filters.removeFilter')}
                                        >
                                            <X size={11} />
                                        </button>
                                    </div>
                                )}
                                {/* Scope chip */}
                                {urlParams.scope !== 'all' && (
                                    <div className="flex items-center gap-1 px-2 py-0.5 bg-orange-50 text-orange-700 rounded-full text-xs font-medium border border-orange-200">
                                        <Layers size={11} />
                                        <span>{t(`filters.scope${urlParams.scope.charAt(0).toUpperCase() + urlParams.scope.slice(1)}`)}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                actions.setSelectedScope('all');
                                                setSearchParams(prev => { prev.delete('scope'); prev.set('p', '1'); return prev; });
                                            }}
                                            className="ml-0.5 hover:bg-orange-100 rounded-full p-0.5"
                                            title={t('filters.removeFilter')}
                                        >
                                            <X size={11} />
                                        </button>
                                    </div>
                                )}
                                {/* Žanrid */}
                                {urlParams.genres.map(g => (
                                    <div key={g} className="flex items-center gap-1 px-2 py-0.5 bg-violet-50 text-violet-700 rounded-full text-xs font-medium border border-violet-200">
                                        <Bookmark size={11} />
                                        <span>{resolveLabel(g, qCodeMaps.genreIdMap)}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const next = urlParams.genres.filter(x => x !== g);
                                                actions.setSelectedGenres(next);
                                                setSearchParams(prev => { if (next.length > 0) prev.set('genre', next.join(',')); else prev.delete('genre'); prev.set('p', '1'); return prev; });
                                            }}
                                            className="ml-0.5 hover:bg-violet-100 rounded-full p-0.5"
                                            title={t('filters.removeFilter')}
                                        >
                                            <X size={11} />
                                        </button>
                                    </div>
                                ))}
                                {/* Tüübid */}
                                {urlParams.types.map(tp => (
                                    <div key={tp} className="flex items-center gap-1 px-2 py-0.5 bg-sky-50 text-sky-700 rounded-full text-xs font-medium border border-sky-200">
                                        <FileType size={11} />
                                        <span>{resolveLabel(tp, qCodeMaps.typeIdMap)}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const next = urlParams.types.filter(x => x !== tp);
                                                actions.setSelectedTypes(next);
                                                setSearchParams(prev => { if (next.length > 0) prev.set('type', next.join(',')); else prev.delete('type'); prev.set('p', '1'); return prev; });
                                            }}
                                            className="ml-0.5 hover:bg-sky-100 rounded-full p-0.5"
                                            title={t('filters.removeFilter')}
                                        >
                                            <X size={11} />
                                        </button>
                                    </div>
                                ))}
                                {/* Teose märksõnad */}
                                {urlParams.teoseTags.map(tag => (
                                    <div key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium border border-emerald-200">
                                        <Tag size={11} />
                                        <span>{resolveLabel(tag, qCodeMaps.tagsIdMap)}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const next = urlParams.teoseTags.filter(t => t !== tag);
                                                actions.setSelectedTeoseTags(next);
                                                setSearchParams(prev => { if (next.length > 0) prev.set('teoseTags', next.join(',')); else prev.delete('teoseTags'); prev.set('p', '1'); return prev; });
                                            }}
                                            className="ml-0.5 hover:bg-emerald-100 rounded-full p-0.5"
                                            title={t('filters.removeFilter')}
                                        >
                                            <X size={11} />
                                        </button>
                                    </div>
                                ))}
                                {/* Lehekülje märksõnad */}
                                {urlParams.pageTags.map(tag => (
                                    <div key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-teal-50 text-teal-700 rounded-full text-xs font-medium border border-teal-200">
                                        <Tag size={11} />
                                        <span>{qCodeMaps.knownPageTagsLabels[tag] || qCodeMaps.pageTagsIdMap[tag] || tag}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const next = urlParams.pageTags.filter(t => t !== tag);
                                                actions.setSelectedPageTags(next);
                                                setSearchParams(prev => {
                                                    if (next.length > 0) prev.set('pageTags', next.join(','));
                                                    else prev.delete('pageTags');
                                                    prev.set('p', '1');
                                                    return prev;
                                                });
                                            }}
                                            className="ml-0.5 hover:bg-teal-100 rounded-full p-0.5"
                                            title={t('filters.removeFilter')}
                                        >
                                            <X size={11} />
                                        </button>
                                    </div>
                                ))}
                                {/* Teos */}
                                {draft.selectedWork && (
                                    <div className="flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full text-xs font-medium border border-amber-200">
                                        <FileText size={11} />
                                        <span className="truncate max-w-xs">{draft.selectedWorkInfo?.title || draft.selectedWork}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                actions.setSelectedWork(''); actions.setSelectedWorkInfo(null);
                                                setSearchParams(prev => { prev.delete('work'); prev.set('p', '1'); return prev; });
                                            }}
                                            className="ml-0.5 hover:bg-amber-100 rounded-full p-0.5"
                                            title={t('filters.removeFilter')}
                                        >
                                            <X size={11} />
                                        </button>
                                    </div>
                                )}
                                {/* Autor */}
                                {draft.selectedAuthor && (
                                    <div className="flex items-center gap-1 px-2 py-0.5 bg-primary-50 text-primary-700 rounded-full text-xs font-medium border border-primary-200">
                                        <User size={11} />
                                        <span className="truncate max-w-xs">{draft.selectedAuthor}</span>
                                        <button
                                            type="button"
                                            onClick={actions.handleAuthorClear}
                                            className="ml-0.5 hover:bg-primary-100 rounded-full p-0.5"
                                            title={t('filters.removeAuthorFilter')}
                                        >
                                            <X size={11} />
                                        </button>
                                    </div>
                                )}
                                {/* Isik teemana */}
                                {draft.selectedPersonTag && (
                                    <div className="flex items-center gap-1 px-2 py-0.5 bg-rose-50 text-rose-700 rounded-full text-xs font-medium border border-rose-200">
                                        <User size={11} />
                                        <span className="truncate max-w-xs">
                                            {qCodeMaps.availablePersonTags?.find(p => p.id === draft.selectedPersonTag)?.label || draft.selectedPersonTag}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={actions.handlePersonTagClear}
                                            className="ml-0.5 hover:bg-rose-100 rounded-full p-0.5"
                                            title={t('filters.removeFilter')}
                                        >
                                            <X size={11} />
                                        </button>
                                    </div>
                                )}
                                {/* Kollektsioon */}
                                {selectedCollection && (() => {
                                    const colorClasses = getCollectionColorClasses(collections[selectedCollection]);
                                    return (
                                        <div className={`ml-auto flex items-center gap-1 px-2 py-0.5 ${colorClasses.bg} ${colorClasses.text} rounded-full text-xs font-medium border ${colorClasses.border}`}>
                                            <Library size={11} />
                                            <span className="truncate max-w-xs">{getCollectionName(selectedCollection, getLangCode(i18n.language))}</span>
                                            <button
                                                type="button"
                                                onClick={() => setSelectedCollection(null)}
                                                className="ml-0.5 hover:opacity-70 rounded-full p-0.5"
                                                title={t('filters.removeFilter')}
                                            >
                                                <X size={11} />
                                            </button>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                </div>
            </Header>

            <div className="flex-1 overflow-hidden flex max-w-7xl mx-auto w-full">
                <SearchFilters
                    draft={draft}
                    facets={{ ...facets, availableWorks, loading }}
                    qCodeMaps={filteredQCodeMaps}
                    onScopeChange={actions.setSelectedScope}
                    onYearStartChange={actions.setYearStart}
                    onYearEndChange={actions.setYearEnd}
                    onGenreToggle={(v) => {
                        const key = /^Q\d+$/.test(v) ? v : (genreLabelToId[v] || genreLabelToId[v[0]?.toUpperCase() + v.slice(1)] || v);
                        actions.setSelectedGenres(prev => prev.includes(key) ? prev.filter(g => g !== key) : [...prev, key]);
                    }}
                    onTypeToggle={(v) => {
                        const key = /^Q\d+$/.test(v) ? v : (typeLabelToId[v] || typeLabelToId[v[0]?.toUpperCase() + v.slice(1)] || v);
                        actions.setSelectedTypes(prev => prev.includes(key) ? prev.filter(t => t !== key) : [...prev, key]);
                    }}
                    onTagToggle={(v) => {
                        const key = /^Q\d+$/.test(v) ? v : (tagsLabelToId[v] || tagsLabelToId[v[0]?.toUpperCase() + v.slice(1)] || v);
                        actions.setSelectedTeoseTags(prev => prev.includes(key) ? prev.filter(t => t !== key) : [...prev, key]);
                    }}
                    onAuthorInputChange={actions.setAuthorInput}
                    onShowAuthorSuggestions={actions.setShowAuthorSuggestions}
                    onAuthorSelect={actions.handleAuthorSelect}
                    onAuthorClear={actions.handleAuthorClear}
                    onPersonTagInputChange={actions.setPersonTagInput}
                    onShowPersonSuggestions={actions.setShowPersonSuggestions}
                    onPersonTagSelect={actions.handlePersonTagSelect}
                    onPersonTagClear={actions.handlePersonTagClear}
                    onWorkSelect={actions.handleWorkSelect}
                    onSetMobileFilters={actions.setShowFiltersMobile}
                    onSearch={actions.commit}
                    onClearFilters={actions.clearFilters}
                />
                <SearchResults
                    results={results}
                    loading={loading}
                    error={error}
                    queryParam={urlParams.q}
                    workIdParam={urlParams.workId}
                    yearStartParam={urlParams.yearStart}
                    yearEndParam={urlParams.yearEnd}
                    scopeParam={urlParams.scope}
                    vocabularies={facets.vocabularies}
                    onAuthorFilter={(authorName) => {
                        actions.setSelectedAuthor(authorName);
                        actions.setAuthorInput(authorName);
                        setSearchParams(prev => { prev.set('author', authorName); prev.set('p', '1'); return prev; });
                    }}
                    onYearFilter={(start, end) => {
                        actions.setYearStart(start);
                        actions.setYearEnd(end);
                        setSearchParams(prev => { prev.set('ys', start); prev.set('ye', end); prev.set('p', '1'); return prev; });
                    }}
                    onSearchInWork={(workId, info) => {
                        actions.setSelectedWork(workId);
                        actions.setSelectedWorkInfo(info);
                        setSearchParams(prev => { prev.set('work', workId); prev.set('p', '1'); return prev; });
                    }}
                    onPageChange={(newPage) => {
                        setSearchParams(prev => { prev.set('p', newPage.toString()); return prev; });
                    }}
                />
            </div>
        </div>
    );
};

export default SearchPage;
