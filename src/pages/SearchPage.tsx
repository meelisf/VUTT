
import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { searchContent, searchWorkHits, getWorkMetadata, getTeoseTagsFacets, getGenreFacets, getTypeFacets } from '../services/meiliService';
import { getVocabularies, Vocabularies } from '../services/collectionService';
import { ContentSearchHit, ContentSearchResponse, ContentSearchOptions, Annotation } from '../types';
import { Search, Loader2, AlertTriangle, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Filter, Calendar, Layers, Tag, MessageSquare, FileText, BookOpen, Library, ScrollText } from 'lucide-react';
import { IMAGE_BASE_URL } from '../config';
import Header from '../components/Header';
import CollapsibleSection from '../components/CollapsibleSection';
import { useCollection } from '../contexts/CollectionContext';
import { getLabel } from '../utils/metadataUtils';

// Abifunktsioon pildi URL-i ehitamiseks
const getImageUrl = (imagePath: string): string => {
    if (!imagePath) return '';
    const cleanPath = imagePath.startsWith('/') ? imagePath.slice(1) : imagePath;
    return `${IMAGE_BASE_URL}/${encodeURI(cleanPath)}`;
};

const SearchPage: React.FC = () => {
    const { t, i18n } = useTranslation(['search', 'common']);
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { selectedCollection, getCollectionName } = useCollection();

    // URL params control the actual search
    const queryParam = searchParams.get('q') || '';
    const pageParam = parseInt(searchParams.get('p') || '1', 10);
    const workIdParam = searchParams.get('work') || ''; // Teose piires otsing

    // Filter params from URL
    const yearStartParam = searchParams.get('ys') ? parseInt(searchParams.get('ys')!) : undefined;
    const yearEndParam = searchParams.get('ye') ? parseInt(searchParams.get('ye')!) : undefined;
    const scopeParam = (searchParams.get('scope') as 'all' | 'original' | 'annotation') || 'all';
    const teoseTagsParam = searchParams.get('teoseTags')?.split(',').filter(Boolean) || [];
    const genreParam = searchParams.get('genre') || '';
    const typeParam = searchParams.get('type') || '';

    // Local state for input fields
    const [inputValue, setInputValue] = useState(queryParam);
    const [yearStart, setYearStart] = useState<string>(yearStartParam?.toString() || '1630');
    const [yearEnd, setYearEnd] = useState<string>(yearEndParam?.toString() || '1710');
    const [selectedScope, setSelectedScope] = useState<'all' | 'original' | 'annotation'>(scopeParam);
    const [selectedWork, setSelectedWork] = useState<string>(workIdParam); // Teose filter
    const [selectedWorkInfo, setSelectedWorkInfo] = useState<{ title: string, year?: string | number, author?: string } | null>(null); // Valitud teose info

    // Teose märksõnade filter
    const [availableTeoseTags, setAvailableTeoseTags] = useState<{ tag: string; count: number }[]>([]);
    const [selectedTeoseTags, setSelectedTeoseTags] = useState<string[]>(teoseTagsParam);

    // Žanri filter (genre väli)
    const [availableGenres, setAvailableGenres] = useState<{ value: string; count: number }[]>([]);
    const [selectedGenre, setSelectedGenre] = useState<string>(genreParam);

    // Tüübi filter (type väli)
    const [availableTypes, setAvailableTypes] = useState<{ value: string; count: number }[]>([]);
    const [selectedType, setSelectedType] = useState<string>(typeParam);

    // Sõnavara (tõlgete jaoks)
    const [vocabularies, setVocabularies] = useState<Vocabularies | null>(null);

    const [results, setResults] = useState<ContentSearchResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [showFiltersMobile, setShowFiltersMobile] = useState(false);

    // Lazy-loaded hits for expanded works (max 10 akordioni sees)
    const [workHits, setWorkHits] = useState<Map<string, ContentSearchHit[]>>(new Map());
    const [loadingWorkHits, setLoadingWorkHits] = useState<Set<string>>(new Set());

    const contentRef = useRef<HTMLDivElement>(null);

    // Laadi filtrite andmed alguses
    useEffect(() => {
        const loadFilterData = async () => {
            try {
                const facetLang = i18n.language.split('-')[0];
                const [tags, genres, types, vocabs] = await Promise.all([
                    getTeoseTagsFacets(selectedCollection || undefined, facetLang),
                    getGenreFacets(selectedCollection || undefined, facetLang),
                    getTypeFacets(selectedCollection || undefined, facetLang),
                    getVocabularies()
                ]);
                setAvailableTeoseTags(tags);
                setAvailableGenres(genres);
                setAvailableTypes(types);
                setVocabularies(vocabs);
            } catch (e) {
                console.warn('Filtrite andmete laadimine ebaõnnestus:', e);
            }
        };
        loadFilterData();
    }, [selectedCollection, i18n.language]);

    // Sync local input with URL param when URL changes (e.g. back button)
    useEffect(() => {
        setInputValue(queryParam);
        if (scopeParam) setSelectedScope(scopeParam);
        setSelectedWork(workIdParam);
        setSelectedTeoseTags(teoseTagsParam);
        setSelectedGenre(genreParam);
        setSelectedType(typeParam);
    }, [queryParam, scopeParam, workIdParam, teoseTagsParam.join(','), genreParam, typeParam]);

    // Laadi teose info kui workIdParam on määratud (nt tullakse Workspace'ist)
    useEffect(() => {
                if (workIdParam && !selectedWorkInfo) {
                    getWorkMetadata(workIdParam).then(work => {
                        if (work) {
                            // Get primary author from creators if available
                            let author = work.author || '';
                            if (work.creators && work.creators.length > 0) {
                                const praeses = work.creators.find(c => c.role === 'praeses');
                                if (praeses) author = praeses.name;
                            }
                            
                            setSelectedWorkInfo({
                                title: work.title,
                                year: work.year || undefined,
                                author: author
                            });
                        }
                    });
                }
         else if (!workIdParam) {
            setSelectedWorkInfo(null);
        }
    }, [workIdParam]);

    // Handle Search Submission
    const handleSearch = (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        // Update URL params, which triggers the effect below
        setSearchParams(prev => {
            if (!inputValue.trim()) {
                prev.delete('q');
                prev.delete('p');
                prev.delete('ys');
                prev.delete('ye');
                prev.delete('scope');
                prev.delete('work');
                prev.delete('teoseTags');
                prev.delete('genre');
                prev.delete('type');
            } else {
                prev.set('q', inputValue);
                prev.set('p', '1'); // Reset page

                if (yearStart) prev.set('ys', yearStart); else prev.delete('ys');
                if (yearEnd) prev.set('ye', yearEnd); else prev.delete('ye');
                if (selectedScope && selectedScope !== 'all') prev.set('scope', selectedScope); else prev.delete('scope');
                if (selectedWork) prev.set('work', selectedWork); else prev.delete('work');
                if (selectedTeoseTags.length > 0) prev.set('teoseTags', selectedTeoseTags.join(',')); else prev.delete('teoseTags');
                if (selectedGenre) prev.set('genre', selectedGenre); else prev.delete('genre');
                if (selectedType) prev.set('type', selectedType); else prev.delete('type');
            }
            return prev;
        });

        // On mobile, close filters after search
        setShowFiltersMobile(false);
    };

    // Perform search when URL params change
    useEffect(() => {
        if (queryParam || teoseTagsParam.length > 0) {
            const options: ContentSearchOptions = {
                yearStart: yearStartParam,
                yearEnd: yearEndParam,
                scope: scopeParam,
                workId: workIdParam || undefined,
                teoseTags: teoseTagsParam.length > 0 ? teoseTagsParam : undefined,
                genre: genreParam || undefined,
                type: typeParam || undefined,
                collection: selectedCollection || undefined,
                lang: i18n.language.split('-')[0]  // et-EE -> et
            };

            performSearch(queryParam, pageParam, options);
        } else {
            setResults(null);
        }
    }, [queryParam, pageParam, workIdParam, yearStartParam, yearEndParam, scopeParam, teoseTagsParam.join(','), genreParam, typeParam, selectedCollection, i18n.language]);

    const performSearch = async (searchQuery: string, page: number, options: ContentSearchOptions) => {
        setLoading(true);
        setError(null);
        try {
            const data = await searchContent(searchQuery, page, options);
            setResults(data);
            // Only reset expanded groups if it's a new query (page 1) and not filtering by work
            if (page === 1 && !options.workId) setExpandedGroups(new Set());

            // Scroll to top
            if (contentRef.current) {
                contentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
            }
        } catch (e: any) {
            console.error(e);
            setError(e.message || t('status.connectionError'));
        } finally {
            setLoading(false);
        }
    };

    const handlePageChange = (newPage: number) => {
        setSearchParams(prev => {
            prev.set('p', newPage.toString());
            return prev;
        });
    };

    // Toggle akordion ja laadi vajadusel teose täpsed tulemused
    // Säilitab scroll positsiooni, et akordion ei "hüppaks" sulgemisel
    const toggleGroup = async (workId: string) => {
        // Salvesta scroll positsioon enne muudatust
        const scrollTop = contentRef.current?.scrollTop || 0;

        const newSet = new Set(expandedGroups);
        const isClosing = newSet.has(workId);

        if (isClosing) {
            newSet.delete(workId);
        } else {
            newSet.add(workId);

            // Laadi teose tulemused kui pole veel laetud
            if (!workHits.has(workId) && queryParam) {
                setLoadingWorkHits(prev => new Set(prev).add(workId));
                try {
                    const hits = await searchWorkHits(queryParam, workId, {
                        yearStart: yearStartParam,
                        yearEnd: yearEndParam,
                        scope: scopeParam !== 'all' ? scopeParam : undefined
                    });
                    setWorkHits(prev => new Map(prev).set(workId, hits));
                } catch (e) {
                    console.error('Failed to load work hits:', e);
                } finally {
                    setLoadingWorkHits(prev => {
                        const newSet = new Set(prev);
                        newSet.delete(workId);
                        return newSet;
                    });
                }
            }
        }
        setExpandedGroups(newSet);

        // Taasta scroll positsioon pärast DOM uuendust (sulgemisel)
        if (isClosing) {
            requestAnimationFrame(() => {
                if (contentRef.current) {
                    contentRef.current.scrollTop = scrollTop;
                }
            });
        }
    };

    // Grupeeri tulemused teose kaupa (distinct annab ühe hiti teose kohta)
    const getGroupedResults = () => {
        if (!results) return {};
        // Iga hit on üks teos (distinct: teose_id), hitCount näitab vastete arvu
        return results.hits.reduce((acc, hit) => {
            const key = hit.teose_id;
            if (!acc[key]) acc[key] = [];
            acc[key].push(hit);
            return acc;
        }, {} as Record<string, ContentSearchHit[]>);
    };



    // Extract work facets - järjestatud relevantsi järgi (sama järjekord mis otsingutulemustel)
    // NB: Kui juba ollakse teose piires otsingus VÕI laadib VÕI on ainult 1 teos, ei näita teose filtrit
    const workHitCounts = results?.facetDistribution?.['teose_id'] || {};
    const uniqueWorkIds = new Set(results?.hits?.map(h => h.teose_id) || []);
    const availableWorks = (results?.hits && !workIdParam && !loading && uniqueWorkIds.size > 1)
        ? results.hits.map(hit => ({
            id: hit.teose_id,
            title: hit.pealkiri || hit.teose_id,
            year: hit.aasta,
            author: Array.isArray(hit.autor) ? hit.autor[0] : hit.autor,
            count: workHitCounts[hit.teose_id] || 1
        }))
        : [];

    const renderHit = (hit: ContentSearchHit, isAdditional = false) => {
        const snippet = hit._formatted?.lehekylje_tekst || hit.lehekylje_tekst;
        const lang = i18n.language.split('-')[0];
        const tagsField = `page_tags_${lang}`;

        // Helper to find relevant tags/comments (those containing highlight marks)
        // Check localized field first, then fallback to generic
        const formattedTags = (hit._formatted as any)?.[tagsField] || hit._formatted?.page_tags;
        const hasHighlightedTags = formattedTags?.some((t: string) => t.includes('<em'));
        const highlightedComments = hit._formatted?.comments?.filter(c => c.text.includes('<em'));

        // Navigeeri töölauasse
        const navigateToWorkspace = () => {
            navigate(`/work/${hit.work_id || hit.teose_id}/${hit.lehekylje_number}`);
        };

        return (
            <div key={hit.id} className={`p-3 ${isAdditional ? 'bg-gray-50 border-t border-gray-100' : ''}`}>
                {/* Header rida: lk nr + vastete arv + töölaud link */}
                <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs font-mono text-gray-500">
                        {t('results.page')} {hit.lehekylje_number}
                    </span>
                    <span className="text-gray-300">|</span>
                    <button
                        onClick={navigateToWorkspace}
                        className="text-xs font-bold text-primary-600 hover:text-primary-700 hover:underline"
                    >
                        {t('results.openWorkspace')}
                    </button>
                </div>

                {/* Tekstikast + pilt kõrvuti */}
                <div className="flex gap-3">
                    {/* Main Text Snippet */}
                    <div className="flex-1 min-w-0">
                        {(selectedScope === 'all' || selectedScope === 'original') && snippet && (
                            <div
                                className="text-sm text-gray-800 leading-relaxed font-serif bg-white p-2 rounded border border-gray-100 shadow-sm"
                                dangerouslySetInnerHTML={{
                                    __html: snippet.replace(/\n/g, '<br>')
                                }}
                            />
                        )}

                        {/* Matched Tags */}
                        {hasHighlightedTags && (
                            <div className="flex flex-wrap gap-2 mt-2">
                                {formattedTags?.filter((t: string) => t.includes('<em')).map((tagHtml: string, idx: number) => (
                                    <span
                                        key={idx}
                                        className="inline-flex items-center gap-1 px-2 py-1 bg-primary-50 border border-primary-100 text-primary-800 text-xs rounded-full"
                                    >
                                        <Tag size={10} />
                                        <span dangerouslySetInnerHTML={{ __html: tagHtml }} />
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Matched Comments */}
                        {highlightedComments && highlightedComments.length > 0 && (
                            <div className="space-y-2 mt-2">
                                {highlightedComments.map((comment, idx) => (
                                    <div key={idx} className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs text-gray-800">
                                        <div className="flex items-center gap-1 mb-1 font-bold text-yellow-800">
                                            <MessageSquare size={12} />
                                            <span>{t('results.comment', { author: comment.author })}</span>
                                        </div>
                                        <div dangerouslySetInnerHTML={{ __html: comment.text }} />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Thumbnail paremal - samal tasemel tekstikastiga */}
                    {hit.lehekylje_pilt && (
                        <button
                            onClick={navigateToWorkspace}
                            className="shrink-0 w-20 h-28 bg-gray-100 rounded overflow-hidden hidden sm:block hover:ring-2 hover:ring-primary-300 transition-all cursor-pointer self-start"
                            title={t('results.openWorkspaceTitle')}
                        >
                            <img
                                src={getImageUrl(hit.lehekylje_pilt)}
                                alt=""
                                loading="lazy"
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).parentElement!.style.display = 'none';
                                }}
                            />
                        </button>
                    )}
                </div>
            </div>
        );
    };

    const groupedResults = getGroupedResults();
    const uniqueWorksCount = results?.facetDistribution?.['teose_id']
        ? Object.keys(results.facetDistribution['teose_id']).length
        : Object.keys(groupedResults).length;

    return (
        <div className="h-full bg-gray-50 font-sans flex flex-col overflow-hidden">
            <Header>
                {/* Otsingu vorm */}
                <div className="bg-white border-b border-gray-200 px-6 py-4">
                    <div className="max-w-7xl mx-auto">
                        <form onSubmit={handleSearch} className="flex gap-2 relative">
                            <div className="relative flex-1">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                                <input
                                    type="search"
                                    placeholder={t('form.searchPlaceholder')}
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    className="w-full pl-12 pr-4 py-3 rounded-lg border border-gray-300 shadow-sm focus:ring-2 focus:ring-primary-100 focus:border-primary-500 outline-none text-lg"
                                    autoFocus
                                />
                            </div>
                            <button
                                type="submit"
                                className="bg-primary-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-primary-700 transition-colors shadow-sm"
                            >
                                {t('form.search')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowFiltersMobile(!showFiltersMobile)}
                                className="md:hidden p-3 bg-white border border-gray-300 rounded-lg text-gray-600"
                            >
                                <Filter size={20} />
                            </button>
                        </form>
                    </div>
                </div>
            </Header>

            <div className="flex-1 overflow-hidden flex max-w-7xl mx-auto w-full">

                {/* Sidebar Filters (Desktop) */}
                <aside className={`
            md:w-64 md:flex md:flex-col md:border-r border-gray-200 bg-white p-6 overflow-y-auto shrink-0 z-10
            ${showFiltersMobile ? 'absolute inset-0 z-30 flex flex-col' : 'hidden'}
          `}>
                    <div className="flex justify-between items-center mb-6 md:hidden">
                        <h3 className="font-bold text-lg">{t('filters.title')}</h3>
                        <button onClick={() => setShowFiltersMobile(false)}>{t('filters.close')}</button>
                    </div>

                    <div className="space-y-2">

                        {/* Active Collection Indicator */}
                        {selectedCollection && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                                <h3 className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-1 flex items-center gap-2">
                                    <Library size={14} /> {t('common:collections.activeFilter')}
                                </h3>
                                <p className="text-sm font-medium text-amber-900">
                                    {getCollectionName(selectedCollection)}
                                </p>
                                <p className="text-xs text-amber-600 mt-1">
                                    {t('common:collections.changeInHeader')}
                                </p>
                            </div>
                        )}

                        {/* Search Scope */}
                        <CollapsibleSection
                            title={t('filters.scope')}
                            icon={<Layers size={14} />}
                            defaultOpen={true}
                            badge={selectedScope !== 'all' ? 1 : undefined}
                        >
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                    <input
                                        type="radio"
                                        name="scope"
                                        value="all"
                                        checked={selectedScope === 'all'}
                                        onChange={() => setSelectedScope('all')}
                                        className="text-primary-600 focus:ring-primary-500"
                                    />
                                    <span className="text-sm text-gray-700">{t('filters.scopeAll')}</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                    <input
                                        type="radio"
                                        name="scope"
                                        value="original"
                                        checked={selectedScope === 'original'}
                                        onChange={() => setSelectedScope('original')}
                                        className="text-primary-600 focus:ring-primary-500"
                                    />
                                    <span className="text-sm text-gray-700">{t('filters.scopeOriginal')}</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                    <input
                                        type="radio"
                                        name="scope"
                                        value="annotation"
                                        checked={selectedScope === 'annotation'}
                                        onChange={() => setSelectedScope('annotation')}
                                        className="text-primary-600 focus:ring-primary-500"
                                    />
                                    <span className="text-sm text-gray-700">{t('filters.scopeAnnotation')}</span>
                                </label>
                            </div>
                        </CollapsibleSection>

                        {/* Year Filter */}
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
                                        onChange={(e) => setYearStart(e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded text-sm text-center"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-400 mb-1 block">{t('filters.until')}</label>
                                    <input
                                        type="number"
                                        value={yearEnd}
                                        onChange={(e) => setYearEnd(e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded text-sm text-center"
                                    />
                                </div>
                            </div>
                        </CollapsibleSection>

                        {/* Genre Filter (genre väli - disputatio, oratio jne) */}
                        {availableGenres.length > 0 && (
                            <CollapsibleSection
                                title={t('filters.genre')}
                                icon={<BookOpen size={14} />}
                                defaultOpen={false}
                                badge={selectedGenre ? 1 : undefined}
                            >
                                <div className="space-y-1">
                                    <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                        <input
                                            type="radio"
                                            name="genre"
                                            value=""
                                            checked={!selectedGenre}
                                            onChange={() => setSelectedGenre('')}
                                            className="text-primary-600 focus:ring-primary-500"
                                        />
                                        <span className="text-sm text-gray-700">{t('filters.allGenres')}</span>
                                    </label>
                                    {availableGenres.map(({ value, count }) => {
                                        const lang = (i18n.language as 'et' | 'en') || 'et';
                                        const label = vocabularies?.genres?.[value]?.[lang] || vocabularies?.genres?.[value]?.et || value;
                                        return (
                                            <label key={value} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                                <input
                                                    type="radio"
                                                    name="genre"
                                                    value={value}
                                                    checked={selectedGenre === value}
                                                    onChange={() => setSelectedGenre(value)}
                                                    className="text-primary-600 focus:ring-primary-500"
                                                />
                                                <span className="text-sm text-gray-700 flex-1">{label}</span>
                                                <span className="text-xs text-gray-400">({count})</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </CollapsibleSection>
                        )}

                        {/* Tags Filter (teose_tags - märksõnad) */}
                        {availableTeoseTags.length > 0 && (
                            <CollapsibleSection
                                title={t('filters.tags')}
                                icon={<Tag size={14} />}
                                defaultOpen={false}
                                badge={selectedTeoseTags.length || undefined}
                            >
                                <div className="space-y-1">
                                    {availableTeoseTags.map(({ tag, count }) => {
                                        const isSelected = selectedTeoseTags.includes(tag);
                                        return (
                                            <label key={tag} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => {
                                                        if (isSelected) {
                                                            setSelectedTeoseTags(selectedTeoseTags.filter(t => t !== tag));
                                                        } else {
                                                            setSelectedTeoseTags([...selectedTeoseTags, tag]);
                                                        }
                                                    }}
                                                    className="text-primary-600 focus:ring-primary-500 rounded"
                                                />
                                                <span className="text-sm text-gray-700 flex-1">{tag}</span>
                                                <span className="text-xs text-gray-400">({count})</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </CollapsibleSection>
                        )}

                        {/* Type Filter (impressum/manuscriptum) */}
                        {availableTypes.length > 0 && (
                            <CollapsibleSection
                                title={t('filters.type')}
                                icon={<ScrollText size={14} />}
                                defaultOpen={false}
                                badge={selectedType ? 1 : undefined}
                            >
                                <div className="space-y-1">
                                    <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                        <input
                                            type="radio"
                                            name="type"
                                            value=""
                                            checked={!selectedType}
                                            onChange={() => setSelectedType('')}
                                            className="text-primary-600 focus:ring-primary-500"
                                        />
                                        <span className="text-sm text-gray-700">{t('filters.allTypes')}</span>
                                    </label>
                                    {availableTypes.map(({ value, count }) => {
                                        const lang = (i18n.language as 'et' | 'en') || 'et';
                                        const label = vocabularies?.types?.[value]?.[lang] || vocabularies?.types?.[value]?.et || value;
                                        return (
                                            <label key={value} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                                <input
                                                    type="radio"
                                                    name="type"
                                                    value={value}
                                                    checked={selectedType === value}
                                                    onChange={() => setSelectedType(value)}
                                                    className="text-primary-600 focus:ring-primary-500"
                                                />
                                                <span className="text-sm text-gray-700 flex-1">{label}</span>
                                                <span className="text-xs text-gray-400">({count})</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </CollapsibleSection>
                        )}

                        {/* Work Filter - teose valik */}
                        {(availableWorks.length > 0 || selectedWork) && (
                            <CollapsibleSection
                                title={t('filters.work')}
                                icon={<FileText size={14} />}
                                defaultOpen={false}
                                badge={selectedWork ? 1 : undefined}
                            >
                                <div className="space-y-1 max-h-48 overflow-y-auto">
                                    <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                        <input
                                            type="radio"
                                            name="work"
                                            value=""
                                            checked={!selectedWork}
                                            onChange={() => {
                                                setSelectedWork('');
                                                setSelectedWorkInfo(null);
                                            }}
                                            className="text-primary-600 focus:ring-primary-500"
                                        />
                                        <span className="text-sm text-gray-700">{t('filters.allWorks')}</span>
                                    </label>

                                    {availableWorks.map((work) => (
                                        <label key={work.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                            <input
                                                type="radio"
                                                name="work"
                                                value={work.id}
                                                checked={selectedWork === work.id}
                                                onChange={() => {
                                                    setSelectedWork(work.id);
                                                    setSelectedWorkInfo({ title: work.title, year: work.year, author: work.author });
                                                }}
                                                className="text-primary-600 focus:ring-primary-500 shrink-0"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <span className="text-sm text-gray-700 block truncate" title={work.title}>
                                                    {work.title}
                                                </span>
                                                <span className="text-xs text-gray-400">
                                                    {work.year}{work.author ? ` · ${work.author}` : ''}
                                                </span>
                                            </div>
                                            <span className="text-xs text-gray-400 bg-gray-100 px-1.5 rounded-full shrink-0">{work.count}</span>
                                        </label>
                                    ))}

                                    {/* Näita valitud teost kui seda pole facetis */}
                                    {selectedWork && !availableWorks.find((w) => w.id === selectedWork) && (
                                        <label className="flex items-center gap-2 cursor-pointer bg-primary-50 p-1 rounded">
                                            <input
                                                type="radio"
                                                name="work"
                                                value={selectedWork}
                                                checked
                                                readOnly
                                                className="text-primary-600"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <span className="text-sm text-gray-700 font-medium block truncate" title={selectedWorkInfo?.title || selectedWork}>
                                                    {selectedWorkInfo?.title || selectedWork}
                                                </span>
                                                {selectedWorkInfo && (
                                                    <span className="text-xs text-gray-400">
                                                        {selectedWorkInfo.year}{selectedWorkInfo.author ? ` · ${selectedWorkInfo.author}` : ''}
                                                    </span>
                                                )}
                                            </div>
                                        </label>
                                    )}
                                </div>
                            </CollapsibleSection>
                        )}

                        <div className="pt-4 border-t border-gray-100 space-y-2">
                            <button
                                onClick={(e) => handleSearch(e)}
                                className="w-full py-2 bg-gray-900 text-white rounded text-sm font-bold shadow hover:bg-gray-800 transition-colors"
                            >
                                {t('filters.applyFilters')}
                            </button>
                            {(yearStart || yearEnd || selectedScope !== 'all' || selectedWork || selectedTeoseTags.length > 0 || selectedGenre || selectedType) && (
                                <button
                                    onClick={() => {
                                        setYearStart('');
                                        setYearEnd('');
                                        setSelectedScope('all');
                                        setSelectedWork('');
                                        setSelectedWorkInfo(null);
                                        setSelectedTeoseTags([]);
                                        setSelectedGenre('');
                                        setSelectedType('');
                                        setSearchParams(prev => {
                                            prev.delete('ys');
                                            prev.delete('ye');
                                            prev.delete('scope');
                                            prev.delete('work');
                                            prev.delete('teoseTags');
                                            prev.delete('genre');
                                            prev.delete('type');
                                            prev.set('p', '1');
                                            return prev;
                                        });
                                    }}
                                    className="w-full py-2 bg-white border border-gray-300 text-gray-600 rounded text-sm font-medium hover:bg-gray-50 transition-colors"
                                >
                                    {t('filters.clearFilters')}
                                </button>
                            )}
                        </div>
                    </div>
                </aside>

                {/* Main Results Area */}
                <main
                    ref={contentRef}
                    className="flex-1 px-6 py-8 overflow-y-auto scroll-smooth bg-gray-50 relative"
                >
                    {/* Status Bar */}
                    <div className="min-h-[2rem] mb-6 text-sm text-gray-600" aria-live="polite">
                        {loading ? (
                            <div className="flex items-center gap-2 text-primary-600">
                                <Loader2 className="animate-spin" size={16} /> {t('status.searching')}
                            </div>
                        ) : error ? (
                            <div className="flex items-center gap-2 text-red-600 bg-red-50 p-2 rounded border border-red-200">
                                <AlertTriangle size={16} /> {error}
                            </div>
                        ) : results ? (
                            results.totalHits === 0 ? (
                                <div className="bg-white p-4 rounded-lg border border-gray-200 text-center">
                                    <span className="block text-lg font-medium text-gray-900 mb-1">{t('status.noResults')}</span>
                                    <span className="text-gray-500">{t('status.tryDifferent')}</span>
                                </div>
                            ) : workIdParam && results.hits.length > 0 ? (
                                // Teose piires otsing - näita kogu teose info
                                <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                                    <div className="flex items-start justify-between gap-4 mb-3">
                                        <span className="text-sm" dangerouslySetInnerHTML={{ __html: t('status.foundMatchesInWork', { count: results.totalHits }) }} />
                                        <span className="text-gray-500 font-mono text-xs bg-gray-100 px-2 py-1 rounded shrink-0">
                                            {t('results.pageOf', { current: results.page, total: results.totalPages })}
                                        </span>
                                    </div>
                                    <h2 className="text-base font-bold text-gray-900 leading-snug mb-2">
                                        {results.hits[0]?.pealkiri || t('status.titleMissing')}
                                    </h2>
                                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                                        <span>
                                            <span className="text-gray-400">{t('labels.author')}</span>{' '}
                                            <span className="font-medium">{Array.isArray(results.hits[0]?.autor) ? results.hits[0].autor[0] : (results.hits[0]?.autor || t('status.unknown'))}</span>
                                        </span>
                                        <span>
                                            <span className="text-gray-400">{t('labels.year')}</span>{' '}
                                            <span className="font-medium">{results.hits[0]?.aasta || '...'}</span>
                                        </span>
                                        <span>
                                            <span className="text-gray-400">{t('labels.id')}</span>{' '}
                                            <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{workIdParam}</span>
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                // Tavaline otsing
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                                    <span dangerouslySetInnerHTML={{
                                        __html: queryParam
                                            ? t('status.foundInWorks', { hits: results.totalHits, works: uniqueWorksCount })
                                            : t('status.foundWorks', { count: uniqueWorksCount })
                                    }} />
                                    <span className="text-gray-500 font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                                        {t('results.pageOf', { current: results.page, total: results.totalPages })}
                                    </span>
                                </div>
                            )
                        ) : (
                            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                                <Search size={48} className="mb-4 opacity-20" />
                                <p className="text-lg">{t('status.enterSearchTerm')}</p>
                                <p className="text-sm mt-2 opacity-60">{t('status.searchesContent')}</p>
                            </div>
                        )}
                    </div>

                    {/* Results */}
                    {results && (
                        <div className="space-y-6">
                            {/* Teose piires otsing - näita vasted lihtsalt loeteluna */}
                            {workIdParam ? (
                                <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                                    {results.hits.map(hit => renderHit(hit, false))}
                                </div>
                            ) : (
                                /* Tavaline otsing - grupeeritud teostena */
                                <>
                                    {Object.keys(groupedResults).map(workId => {
                                        const hits = groupedResults[workId];
                                        const firstHit = hits[0];
                                        const hitCount = firstHit.hitCount || 1;
                                        const hasMore = hitCount > 1;
                                        const isExpanded = expandedGroups.has(workId);
                                        const isLoadingHits = loadingWorkHits.has(workId);
                                        const loadedHits = workHits.get(workId);

                                        return (
                                            <article key={workId} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                                                {/* Work Header */}
                                                <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex justify-between items-start gap-4">
                                                    <div className="flex-1 min-w-0">
                                                        <h2 className="text-lg font-bold text-gray-900 mb-1 leading-snug">
                                                            {firstHit.pealkiri || t('status.titleMissing')}
                                                        </h2>
                                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 font-medium">
                                                            <button
                                                                onClick={() => {
                                                                    const authorName = Array.isArray(firstHit.autor) ? firstHit.autor[0] : (firstHit.autor || '');
                                                                    setInputValue(authorName);
                                                                    setSearchParams(prev => {
                                                                        prev.set('q', authorName);
                                                                        prev.set('p', '1');
                                                                        return prev;
                                                                    });
                                                                }}
                                                                className="text-gray-700 flex items-center gap-1 hover:text-primary-600 hover:underline transition-colors text-left"
                                                                title={t('results.searchAuthorWorks')}
                                                            >
                                                                <span className="uppercase text-gray-400 text-[10px]">{t('labels.author')}</span>
                                                                {Array.isArray(firstHit.autor) ? firstHit.autor[0] : (firstHit.autor || t('status.unknown'))}
                                                            </button>
                                                            <span className="text-gray-300">❧</span>
                                                            <button
                                                                onClick={() => {
                                                                    const year = firstHit.aasta?.toString();
                                                                    if (year) {
                                                                        setYearStart(year);
                                                                        setYearEnd(year);
                                                                        setSearchParams(prev => {
                                                                            prev.set('ys', year);
                                                                            prev.set('ye', year);
                                                                            prev.set('p', '1');
                                                                            return prev;
                                                                        });
                                                                    }
                                                                }}
                                                                className="text-gray-700 flex items-center gap-1 hover:text-primary-600 hover:underline transition-colors text-left"
                                                                title={t('results.searchYearWorks')}
                                                            >
                                                                <span className="uppercase text-gray-400 text-[10px]">{t('labels.year')}</span>
                                                                {firstHit.aasta || '...'}
                                                            </button>
                                                            
                                                            {/* Kuvame originaalkataloogi ainult siis, kui see erineb ID-st (ja pole tühi) */}
                                                            {firstHit.originaal_kataloog && firstHit.originaal_kataloog !== (firstHit.work_id || workId) && (
                                                                <>
                                                                    <span className="text-gray-300">❧</span>
                                                                    <span className="text-gray-500">{firstHit.originaal_kataloog}</span>
                                                                </>
                                                            )}
                                                            
                                                            {/* Lisame Žanri ja Tüübi */}
                                                            {(firstHit.genre || firstHit.genre_object) && (
                                                                <>
                                                                    <span className="text-gray-300">❧</span>
                                                                    <span className="text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded text-[10px]">
                                                                        {getLabel(firstHit.genre_object || firstHit.genre, i18n.language)}
                                                                    </span>
                                                                </>
                                                            )}
                                                            {(firstHit.type || firstHit.type_object) && (
                                                                <>
                                                                    <span className="text-gray-300">❧</span>
                                                                    <span className="text-gray-500 italic">
                                                                        {getLabel(firstHit.type_object || firstHit.type, i18n.language)}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="shrink-0 text-right">
                                                        <span className="font-mono bg-gray-200 px-1.5 py-0.5 rounded text-xs text-gray-600" title="Teose ID">
                                                            {firstHit.work_id || workId}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Esimene vaste - alati nähtav */}
                                                <div className="p-1">
                                                    {renderHit(firstHit)}
                                                </div>

                                                {/* Akordion rohkemate vastete jaoks - lazy loaded, max 10 vastet */}
                                                {hasMore && (() => {
                                                    const MAX_ACCORDION_HITS = 10;
                                                    const remainingHits = hitCount - 1; // peale esimest
                                                    const showSearchAllLink = hitCount > MAX_ACCORDION_HITS;

                                                    return (
                                                        <>
                                                            {isExpanded && (
                                                                <div className="border-t border-gray-100 animate-in fade-in slide-in-from-top-1 bg-gray-50/50">
                                                                    {isLoadingHits ? (
                                                                        <div className="flex items-center justify-center gap-2 py-8 text-primary-600">
                                                                            <Loader2 className="animate-spin" size={20} />
                                                                            <span className="text-sm">{t('results.loadingResults')}</span>
                                                                        </div>
                                                                    ) : loadedHits ? (
                                                                        <>
                                                                            {/* Näita max 9 lisavastet (esimene on juba ülal, kokku max 10) */}
                                                                            {loadedHits.slice(1, MAX_ACCORDION_HITS).map(hit => renderHit(hit, true))}

                                                                            {/* Kui on rohkem kui 10 vastet, näita info */}
                                                                            {showSearchAllLink && (
                                                                                <div className="py-3 px-4 text-center border-t border-gray-200">
                                                                                    <span className="text-gray-500 text-sm">
                                                                                        {t('results.foundMatchesInThisWork', { count: hitCount })}
                                                                                    </span>
                                                                                </div>
                                                                            )}
                                                                        </>
                                                                    ) : null}
                                                                </div>
                                                            )}
                                                            <button
                                                                onClick={() => toggleGroup(workId)}
                                                                className="w-full py-2 bg-gray-50 hover:bg-gray-100 text-primary-700 text-xs font-bold uppercase tracking-wide border-t border-gray-200 flex items-center justify-center gap-2 transition-colors"
                                                            >
                                                                {isExpanded ? (
                                                                    <>{t('results.hideMore')} <ChevronUp size={14} /></>
                                                                ) : (
                                                                    <>
                                                                        {remainingHits > MAX_ACCORDION_HITS - 1
                                                                            ? t('results.showMoreTotal', { count: Math.min(remainingHits, MAX_ACCORDION_HITS - 1), total: remainingHits })
                                                                            : t('results.showMore', { count: Math.min(remainingHits, MAX_ACCORDION_HITS - 1) })
                                                                        } <ChevronDown size={14} />
                                                                    </>
                                                                )}
                                                            </button>
                                                        </>
                                                    );
                                                })()}

                                                {/* Otsi sellest teosest link - alati nähtav */}
                                                <div className="py-2 px-3 bg-gray-50 border-t border-gray-200 flex justify-end">
                                                    <button
                                                        onClick={() => {
                                                            const targetId = firstHit.work_id || workId;
                                                            setSelectedWork(targetId);
                                                            setSelectedWorkInfo({
                                                                title: firstHit.pealkiri || targetId,
                                                                year: firstHit.aasta,
                                                                author: Array.isArray(firstHit.autor) ? firstHit.autor[0] : firstHit.autor
                                                            });
                                                            setSearchParams(prev => {
                                                                prev.set('work', targetId);
                                                                prev.set('p', '1');
                                                                return prev;
                                                            });
                                                        }}
                                                        className="inline-flex items-center gap-1.5 text-gray-500 hover:text-primary-700 text-xs font-medium hover:underline"
                                                    >
                                                        <Search size={12} />
                                                        {t('results.searchInWork')}
                                                    </button>
                                                </div>
                                            </article>
                                        );
                                    })}
                                </>
                            )}
                        </div>
                    )}

                    {/* Pagination */}
                    {results && results.totalPages > 1 && (() => {
                        // Generate page numbers to show
                        const getPageNumbers = () => {
                            const pages: (number | string)[] = [];
                            const totalPages = results.totalPages;
                            const currentPage = results.page;

                            if (totalPages <= 7) {
                                for (let i = 1; i <= totalPages; i++) pages.push(i);
                            } else {
                                pages.push(1);
                                if (currentPage > 3) pages.push('...');
                                for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
                                    pages.push(i);
                                }
                                if (currentPage < totalPages - 2) pages.push('...');
                                pages.push(totalPages);
                            }
                            return pages;
                        };

                        return (
                            <div className="flex justify-center items-center gap-2 mt-10 pt-6 border-t border-gray-200">
                                <button
                                    onClick={() => handlePageChange(results.page - 1)}
                                    disabled={results.page === 1}
                                    className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    <ChevronLeft size={18} />
                                    {t('pagination.previous')}
                                </button>

                                <div className="flex items-center gap-1 mx-2">
                                    {getPageNumbers().map((page, idx) => (
                                        page === '...' ? (
                                            <span key={`ellipsis-${idx}`} className="px-2 text-gray-400">...</span>
                                        ) : (
                                            <button
                                                key={page}
                                                onClick={() => handlePageChange(page as number)}
                                                className={`w-10 h-10 rounded-lg font-medium transition-colors ${results.page === page
                                                    ? 'bg-primary-600 text-white'
                                                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                                                    }`}
                                            >
                                                {page}
                                            </button>
                                        )
                                    ))}
                                </div>

                                <button
                                    onClick={() => handlePageChange(results.page + 1)}
                                    disabled={results.page === results.totalPages}
                                    className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {t('pagination.next')}
                                    <ChevronRight size={18} />
                                </button>
                            </div>
                        );
                    })()}
                </main>
            </div>
        </div>
    );
};

export default SearchPage;
