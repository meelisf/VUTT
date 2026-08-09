import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ContentSearchHit, ContentSearchResponse } from '../../types';
import { Vocabularies, getCollectionColorClasses } from '../../services/collectionService';
import { searchWorkHits } from '../../services/searchService';
import { useCollection } from '../../contexts/CollectionContext';
import { useMeiliIndex } from '../../contexts/MeilisearchContext';
import { useUser } from '../../contexts/UserContext';
import { getLabel } from '../../utils/metadataUtils';
import { getLangCode } from '../../utils/getLangCode';
import { getPageThumbUrl, getAuthorDisplay } from './searchUtils';
import { FILE_API_URL } from '../../config';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';
import { parseYearDisplayRange, formatYearDisplay } from '../../utils/yearDisplayUtils';
import SafeHtml from '../../components/SafeHtml';
import {
    Search, Loader2, AlertTriangle, ChevronDown, ChevronUp,
    ChevronLeft, ChevronRight, User, Calendar, Tag, MessageSquare,
    Bookmark, FolderOpen, SquarePen
} from 'lucide-react';

const PageThumbnail: React.FC<{ workId: string; src: string; className: string }> = ({ workId, src, className }) => {
    const { authToken } = useUser();
    const [imgSrc, setImgSrc] = useState(src);
    const [needsToken, setNeedsToken] = useState(false);
    const triedRef = useRef(false);

    useEffect(() => {
        setImgSrc(src);
        setNeedsToken(false);
        triedRef.current = false;
    }, [src]);

    const requestImageToken = React.useCallback(async () => {
        if (triedRef.current || !workId) return;

        // AuthContext taastub lehe laadimisel asünkroonselt; protected pildi 403 võib
        // jõuda enne authToken state'i. Kasuta localStorage fallback'i ja ära märgi
        // katset tehtuks enne, kui token on tegelikult olemas.
        const token = authToken || localStorage.getItem('vutt_token');
        if (!token) return;

        triedRef.current = true;
        try {
            const response = await fetchWithTimeout(`${FILE_API_URL}/work/${workId}/viewer-token`, {
                headers: getAuthHeaders(token),
                timeout: 10000,
            });
            if (!response.ok) return;
            const data = await response.json();
            if (data.image_exp && data.image_sig) {
                const sep = src.includes('?') ? '&' : '?';
                setImgSrc(`${src}${sep}exp=${data.image_exp}&sig=${data.image_sig}`);
                setNeedsToken(false);
            }
        } catch { /* thumbnail jääb tühjaks */ }
    }, [authToken, src, workId]);

    useEffect(() => {
        if (needsToken) void requestImageToken();
    }, [needsToken, requestImageToken]);

    const handleError = () => {
        setNeedsToken(true);
        void requestImageToken();
    };

    return <img src={imgSrc} alt="" loading="lazy" className={className} onError={handleError} />;
};

interface WorkInfo {
    title: string;
    year?: string | number;
    author?: string;
}

export interface SearchResultsProps {
    results: ContentSearchResponse | null;
    loading: boolean;
    error: string | null;
    queryParam: string;
    workIdParam: string;
    yearStartParam?: number;
    yearEndParam?: number;
    scopeParam: 'all' | 'original' | 'annotation';
    vocabularies: Vocabularies | null;
    onAuthorFilter: (authorName: string) => void;
    onYearFilter: (start: string, end: string) => void;
    onSearchInWork: (workId: string, info: WorkInfo) => void;
    onPageChange: (page: number) => void;
}

const SearchResults: React.FC<SearchResultsProps> = ({
    results, loading, error, queryParam, workIdParam,
    yearStartParam, yearEndParam, scopeParam, vocabularies,
    onAuthorFilter, onYearFilter, onSearchInWork, onPageChange,
}) => {
    const { t, i18n } = useTranslation(['search', 'common']);
    const navigate = useNavigate();
    const { getCollectionName, collections } = useCollection();
    const index = useMeiliIndex();
    const containerRef = useRef<HTMLDivElement>(null);

    // Accordion state — ainult SearchResults vajab neid
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [workHits, setWorkHits] = useState<Map<string, ContentSearchHit[]>>(new Map());
    const [loadingWorkHits, setLoadingWorkHits] = useState<Set<string>>(new Set());

    // Uue otsingu puhul (lehekülg 1, mitte teose piires) taasta accordion
    useEffect(() => {
        if (results?.page === 1 && !workIdParam) {
            setExpandedGroups(new Set());
        }
    }, [results]);

    // Scroll lehe ülaossa kui tulemused muutuvad
    useEffect(() => {
        if (results && containerRef.current) {
            containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, [results]);

    const toggleGroup = async (workId: string) => {
        const scrollTop = containerRef.current?.scrollTop || 0;
        const newSet = new Set(expandedGroups);
        const isClosing = newSet.has(workId);

        if (isClosing) {
            newSet.delete(workId);
        } else {
            newSet.add(workId);
            if (!workHits.has(workId) && queryParam && index) {
                setLoadingWorkHits(prev => new Set(prev).add(workId));
                try {
                    const hits = await searchWorkHits(index, queryParam, workId, {
                        yearStart: yearStartParam,
                        yearEnd: yearEndParam,
                        scope: scopeParam !== 'all' ? scopeParam : undefined
                    });
                    setWorkHits(prev => new Map(prev).set(workId, hits));
                } catch (e) {
                    console.error('Teose vastete laadimine ebaõnnestus:', e);
                } finally {
                    setLoadingWorkHits(prev => {
                        const s = new Set(prev);
                        s.delete(workId);
                        return s;
                    });
                }
            }
        }
        setExpandedGroups(newSet);

        // Taasta scroll positsioon pärast akordioni sulgemist
        if (isClosing) {
            requestAnimationFrame(() => {
                if (containerRef.current) containerRef.current.scrollTop = scrollTop;
            });
        }
    };

    const getGroupedResults = () => {
        if (!results) return {} as Record<string, ContentSearchHit[]>;
        return results.hits.reduce((acc, hit) => {
            const key = hit.work_id;
            if (!acc[key]) acc[key] = [];
            acc[key].push(hit);
            return acc;
        }, {} as Record<string, ContentSearchHit[]>);
    };

    const renderHit = (hit: ContentSearchHit, isAdditional = false) => {
        const snippet = hit._formatted?.lehekylje_tekst || hit.lehekylje_tekst;
        const marginaliaSnippet = hit._formatted?.marginaalia_tekst;
        const showMarginalia = marginaliaSnippet?.includes('<em');
        const lang = getLangCode(i18n.language);
        const tagsField = `page_tags_${lang}`;
        const formattedTags = (hit._formatted as any)?.[tagsField] || hit._formatted?.page_tags;
        const hasHighlightedTags = formattedTags?.some((tag: string) => tag.includes('<em'));
        const highlightedComments = hit._formatted?.comments?.filter(c => c.text.includes('<em'));

        // Tühja query puhul annotation scope's näitame kõiki annotatsioonid ilma highlight-filtrita
        const isAnnotationBrowse = scopeParam === 'annotation' && !queryParam;
        const rawTags: string[] = isAnnotationBrowse ? ((hit as any)[tagsField] || hit.page_tags || []) : [];
        const showRawTags = isAnnotationBrowse && !hasHighlightedTags && rawTags.length > 0;
        const showRawComments = isAnnotationBrowse && (!highlightedComments || highlightedComments.length === 0);
        // Annotatsiooniplokk ka vaikeulatuses, kui vaste TULI annotatsioonist — muidu
        // näitab kaart lehekülje põhiteksti katkendit, kus vastet ei olegi.
        const hasHighlightedAnnotations = ((hit._formatted as any)?.text_annotations_text || '').includes('<em');
        const showTextAnnotations = (scopeParam === 'annotation' || hasHighlightedAnnotations)
            && (hit.text_annotations?.length ?? 0) > 0;

        return (
            <div key={hit.id} className={`p-3 ${isAdditional ? 'bg-gray-50 border-t border-gray-100' : ''}`}>
                <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs font-mono text-gray-500">
                        {t('results.page')} {hit.lehekylje_number}
                    </span>
                    <span className="text-gray-300">|</span>
                    <button
                        onClick={() => navigate(`/work/${hit.work_id}/${hit.lehekylje_number}${queryParam ? `?q=${encodeURIComponent(queryParam)}` : ''}`)}
                        className="text-xs font-bold text-primary-600 hover:text-primary-700 hover:underline"
                    >
                        {t('results.openWorkspace')}
                    </button>
                </div>

                <div className="flex gap-3">
                    <div className="flex-1 min-w-0">
                        {(scopeParam === 'all' || scopeParam === 'original') && snippet && (
                            <SafeHtml
                                kind="highlight"
                                html={snippet}
                                allowBr
                                className="text-sm text-gray-800 leading-relaxed font-serif bg-white p-2 rounded border border-gray-100 shadow-sm"
                            />
                        )}
                        {(scopeParam === 'all' || scopeParam === 'original') && showMarginalia && (
                            <SafeHtml
                                kind="highlight"
                                html={marginaliaSnippet!}
                                allowBr
                                className="text-xs text-stone-600 leading-relaxed font-serif bg-stone-50 border-l-2 border-stone-300 p-2 mt-1 rounded-r"
                            />
                        )}
                        {(hasHighlightedTags || showRawTags) && (
                            <div className="flex flex-wrap gap-2 mt-2">
                                {showRawTags
                                    ? rawTags.map((tag: string, idx: number) => (
                                        <span key={idx} className="inline-flex items-center gap-1 px-2 py-1 bg-primary-50 border border-primary-100 text-primary-800 text-xs rounded-full">
                                            <Tag size={10} />
                                            <span>{tag}</span>
                                        </span>
                                    ))
                                    : formattedTags?.filter((tag: string) => tag.includes('<em')).map((tagHtml: string, idx: number) => (
                                        <span key={idx} className="inline-flex items-center gap-1 px-2 py-1 bg-primary-50 border border-primary-100 text-primary-800 text-xs rounded-full">
                                            <Tag size={10} />
                                            <SafeHtml as="span" kind="highlight" html={tagHtml} />
                                        </span>
                                    ))
                                }
                            </div>
                        )}
                        {((highlightedComments && highlightedComments.length > 0) || showRawComments) && (
                            <div className="space-y-2 mt-2">
                                {(showRawComments ? hit.comments : highlightedComments)?.map((comment, idx) => (
                                    <div key={idx} className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs text-gray-800">
                                        <div className="flex items-center gap-1 mb-1 font-bold text-yellow-800">
                                            <MessageSquare size={12} />
                                            <span>{t('results.comment', { author: comment.author })}</span>
                                        </div>
                                        {showRawComments
                                            ? <div>{comment.text}</div>
                                            : <SafeHtml kind="highlight" html={comment.text} />
                                        }
                                    </div>
                                ))}
                            </div>
                        )}
                        {showTextAnnotations && (
                            <div className="space-y-2 mt-2">
                                {hit.text_annotations!.map((ann, idx) => (
                                    <div key={idx} className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-gray-800">
                                        <div className="flex items-center gap-1 mb-1 font-bold text-amber-800">
                                            <SquarePen size={12} />
                                            <span>{t('results.textAnnotation', { author: ann.author })}</span>
                                        </div>
                                        <div>{ann.comment}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    {hit.lehekylje_pilt && (
                        <button
                            onClick={() => navigate(`/work/${hit.work_id}/${hit.lehekylje_number}${queryParam ? `?q=${encodeURIComponent(queryParam)}` : ''}`)}
                            className="shrink-0 w-20 h-28 bg-gray-100 rounded overflow-hidden hidden sm:block hover:ring-2 hover:ring-primary-300 transition-all cursor-pointer self-start"
                            title={t('results.openWorkspaceTitle')}
                        >
                            <PageThumbnail
                                workId={hit.work_id}
                                src={getPageThumbUrl(hit.work_id, hit.lehekylje_pilt)}
                                className="w-full h-full object-cover"
                            />
                        </button>
                    )}
                </div>
            </div>
        );
    };

    const groupedResults = getGroupedResults();
    const uniqueWorksCount = results?.totalWorks ?? (
        results?.facetDistribution?.['work_id']
            ? Object.keys(results.facetDistribution['work_id']).length
            : Object.keys(groupedResults).length
    );

    const getPageNumbers = () => {
        if (!results) return [];
        const pages: (number | string)[] = [];
        const { totalPages, page: currentPage } = results;
        if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
        } else {
            pages.push(1);
            if (currentPage > 3) pages.push('...');
            for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
            if (currentPage < totalPages - 2) pages.push('...');
            pages.push(totalPages);
        }
        return pages;
    };

    return (
        <main ref={containerRef} className="flex-1 px-6 py-8 overflow-y-auto scroll-smooth bg-gray-50 relative">

            {/* Staatusriba */}
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
                        // Teose piires otsing
                        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                            <div className="flex items-start justify-between gap-4 mb-3">
                                <SafeHtml as="span" kind="translation" className="text-sm" html={t('status.foundMatchesInWork', { count: results.totalHits })} />
                                <span className="text-gray-500 font-mono text-xs bg-gray-100 px-2 py-1 rounded shrink-0">
                                    {t('results.pageOf', { current: results.page, total: results.totalPages })}
                                </span>
                            </div>
                            <h2 className="text-base font-bold text-gray-900 leading-snug mb-2">
                                {results.hits[0]?.title || t('status.titleMissing')}
                            </h2>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                                <span>
                                    <span className="text-gray-400">{t('labels.author')}</span>{' '}
                                    <span className="font-medium">{getAuthorDisplay(results.hits[0], t)}</span>
                                </span>
                                <span>
                                    <span className="text-gray-400">{t('labels.year')}</span>{' '}
                                    <span className="font-medium">{results.hits[0]?.year ?? '...'}</span>
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
                            <SafeHtml
                                as="span"
                                kind="translation"
                                html={queryParam
                                    ? t('status.foundInWorks', { hits: results.totalHits, works: uniqueWorksCount })
                                    : t('status.foundWorks', { count: uniqueWorksCount })
                                }
                            />
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

            {/* Tulemused */}
            {results && (
                <div className="space-y-6">
                    {workIdParam ? (
                        // Teose piires otsing — lihtne loetelu
                        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                            {results.hits.map(hit => renderHit(hit, false))}
                        </div>
                    ) : (
                        // Tavaline otsing — grupeeritud teostena
                        <>
                            {Object.keys(groupedResults).map(workId => {
                                const hits = groupedResults[workId];
                                const firstHit = hits[0];
                                const hitCount = firstHit.hitCount || 1;
                                const hasMore = hitCount > 1;
                                const isExpanded = expandedGroups.has(workId);
                                const isLoadingHits = loadingWorkHits.has(workId);
                                const loadedHits = workHits.get(workId);
                                const lang = getLangCode(i18n.language);

                                return (
                                    <article key={workId} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                                        {/* Teose päis */}
                                        <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex justify-between items-start gap-4">
                                            <div className="flex-1 min-w-0">
                                                <h2 className="text-lg font-bold text-gray-900 mb-1 leading-snug">
                                                    {firstHit.title || t('status.titleMissing')}
                                                </h2>
                                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 font-medium">
                                                    {/* Autor */}
                                                    <button
                                                        onClick={() => {
                                                            const authorName = getAuthorDisplay(firstHit, t);
                                                            if (authorName && authorName !== t('status.unknown')) {
                                                                onAuthorFilter(authorName);
                                                            }
                                                        }}
                                                        className="text-gray-700 flex items-center gap-1 hover:text-primary-600 transition-colors text-left"
                                                        title={t('results.searchAuthorWorks')}
                                                    >
                                                        <User size={12} className="text-gray-400" />
                                                        <span className="hover:underline">{getAuthorDisplay(firstHit, t)}</span>
                                                    </button>

                                                    {/* Aasta */}
                                                    <button
                                                        onClick={() => {
                                                            const range = parseYearDisplayRange(firstHit.year, (firstHit as any).year_display);
                                                            if (range) onYearFilter(range.start.toString(), range.end.toString());
                                                        }}
                                                        className="text-gray-700 flex items-center gap-1 hover:text-primary-600 transition-colors text-left"
                                                        title={t('results.searchYearWorks')}
                                                    >
                                                        <Calendar size={12} className="text-gray-400" />
                                                        <span className="hover:underline">{formatYearDisplay((firstHit as any).year_display, firstHit.year ?? (firstHit as any).aasta, t) || '...'}</span>
                                                    </button>

                                                    {/* Žanr */}
                                                    {(() => {
                                                        let label = getLabel((firstHit as any).genre_object ?? firstHit.genre, i18n.language);
                                                        if (!label && firstHit.genre && typeof firstHit.genre === 'string') {
                                                            const val = (firstHit.genre as string).toLowerCase();
                                                            label = vocabularies?.genres?.[val]?.[lang as 'et' | 'en'] || firstHit.genre;
                                                        }
                                                        if (!label) return null;
                                                        return (
                                                            <span className="flex items-center gap-1 text-primary-700 bg-primary-50 px-1.5 py-0.5 rounded">
                                                                <Bookmark size={10} className="fill-primary-200" />
                                                                {label}
                                                            </span>
                                                        );
                                                    })()}

                                                    {/* Kollektsioonid */}
                                                    {(firstHit.collections || []).filter(cid => collections[cid]).map(cid => {
                                                        const colorClasses = getCollectionColorClasses(collections[cid]);
                                                        return (
                                                            <span key={cid} className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${colorClasses.bg} ${colorClasses.text}`}>
                                                                <FolderOpen size={10} />
                                                                {getCollectionName(cid, lang as 'et' | 'en')}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                            <div className="shrink-0 text-right">
                                                <span className="font-mono bg-gray-200 px-1.5 py-0.5 rounded text-xs text-gray-600" title={t('labels.workId')}>
                                                    {firstHit.work_id || workId}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Esimene vaste — alati nähtav */}
                                        <div className="p-1">{renderHit(firstHit)}</div>

                                        {/* Akordion rohkemate vastete jaoks — lazy loaded, max 10 */}
                                        {hasMore && (() => {
                                            const MAX_ACCORDION_HITS = 10;
                                            const remainingHits = hitCount - 1;
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
                                                                    {loadedHits.slice(1, MAX_ACCORDION_HITS).map(hit => renderHit(hit, true))}
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

                                        {/* Otsi sellest teosest */}
                                        <div className="py-2 px-3 bg-gray-50 border-t border-gray-200 flex justify-end">
                                            <button
                                                onClick={() => {
                                                    const targetId = firstHit.work_id || workId;
                                                    onSearchInWork(targetId, {
                                                        title: firstHit.title || targetId,
                                                        year: firstHit.year ?? (firstHit as any).aasta,
                                                        author: getAuthorDisplay(firstHit, t)
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

            {/* Pagineerimine */}
            {results && results.totalPages > 1 && (
                <div className="flex justify-center items-center gap-2 mt-10 pt-6 border-t border-gray-200">
                    <button
                        onClick={() => onPageChange(results.page - 1)}
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
                                    onClick={() => onPageChange(page as number)}
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
                        onClick={() => onPageChange(results.page + 1)}
                        disabled={results.page === results.totalPages}
                        className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {t('pagination.next')}
                        <ChevronRight size={18} />
                    </button>
                </div>
            )}
        </main>
    );
};

export default SearchResults;
