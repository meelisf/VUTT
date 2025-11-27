
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { searchContent } from '../services/meiliService';
import { ContentSearchHit, ContentSearchResponse, ContentSearchOptions, Annotation } from '../types';
import { ArrowLeft, Search, Loader2, AlertTriangle, ExternalLink, ChevronDown, ChevronUp, Filter, Calendar, FolderOpen, Layers, Tag, MessageSquare } from 'lucide-react';
import { IMAGE_BASE_URL } from '../config';

const SearchPage: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    // URL params control the actual search
    const queryParam = searchParams.get('q') || '';
    const pageParam = parseInt(searchParams.get('p') || '1', 10);

    // Filter params from URL
    const yearStartParam = searchParams.get('ys') ? parseInt(searchParams.get('ys')!) : undefined;
    const yearEndParam = searchParams.get('ye') ? parseInt(searchParams.get('ye')!) : undefined;
    const catalogParam = searchParams.get('cat') || 'all';
    const scopeParam = (searchParams.get('scope') as 'all' | 'original' | 'annotation') || 'all';

    // Local state for input fields
    const [inputValue, setInputValue] = useState(queryParam);
    const [yearStart, setYearStart] = useState<string>(yearStartParam?.toString() || '1630');
    const [yearEnd, setYearEnd] = useState<string>(yearEndParam?.toString() || '1710');
    const [selectedCatalog, setSelectedCatalog] = useState<string>(catalogParam);
    const [selectedScope, setSelectedScope] = useState<'all' | 'original' | 'annotation'>(scopeParam);

    const [results, setResults] = useState<ContentSearchResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [showFiltersMobile, setShowFiltersMobile] = useState(false);

    const contentRef = useRef<HTMLDivElement>(null);

    // Sync local input with URL param when URL changes (e.g. back button)
    useEffect(() => {
        setInputValue(queryParam);
        if (scopeParam) setSelectedScope(scopeParam);
    }, [queryParam, scopeParam]);

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
                prev.delete('cat');
                prev.delete('scope');
            } else {
                prev.set('q', inputValue);
                prev.set('p', '1'); // Reset page

                if (yearStart) prev.set('ys', yearStart); else prev.delete('ys');
                if (yearEnd) prev.set('ye', yearEnd); else prev.delete('ye');
                if (selectedCatalog && selectedCatalog !== 'all') prev.set('cat', selectedCatalog); else prev.delete('cat');
                if (selectedScope && selectedScope !== 'all') prev.set('scope', selectedScope); else prev.delete('scope');
            }
            return prev;
        });

        // On mobile, close filters after search
        setShowFiltersMobile(false);
    };

    // Perform search when URL params change
    useEffect(() => {
        if (queryParam) {
            const options: ContentSearchOptions = {
                yearStart: yearStartParam,
                yearEnd: yearEndParam,
                catalog: catalogParam,
                scope: scopeParam
            };
            performSearch(queryParam, pageParam, options);
        } else {
            setResults(null);
        }
    }, [queryParam, pageParam, yearStartParam, yearEndParam, catalogParam, scopeParam]);

    const performSearch = async (searchQuery: string, page: number, options: ContentSearchOptions) => {
        setLoading(true);
        setError(null);
        try {
            const data = await searchContent(searchQuery, page, options);
            setResults(data);
            // Only reset expanded groups if it's a new query (page 1)
            if (page === 1) setExpandedGroups(new Set());

            // Scroll to top
            if (contentRef.current) {
                contentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
            }
        } catch (e: any) {
            console.error(e);
            setError(e.message || "Viga andmebaasiga ühendamisel.");
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

    const toggleGroup = (workId: string) => {
        const newSet = new Set(expandedGroups);
        if (newSet.has(workId)) {
            newSet.delete(workId);
        } else {
            newSet.add(workId);
        }
        setExpandedGroups(newSet);
    };

    const getGroupedResults = () => {
        if (!results) return {};
        return results.hits.reduce((acc, hit) => {
            const key = hit.teose_id;
            if (!acc[key]) acc[key] = [];
            acc[key].push(hit);
            return acc;
        }, {} as Record<string, ContentSearchHit[]>);
    };

    // Extract catalog facets if available
    const availableCatalogs = results?.facetDistribution?.['originaal_kataloog']
        ? Object.entries(results.facetDistribution['originaal_kataloog'])
        : [];

    const renderHit = (hit: ContentSearchHit, isAdditional = false) => {
        const snippet = hit._formatted?.lehekylje_tekst || hit.lehekylje_tekst;
        const filename = hit.lehekylje_pilt
            ? hit.lehekylje_pilt.split('/').pop()
            : `Lk ${hit.lehekylje_number}`;
        const fullImageUrl = hit.lehekylje_pilt ? `${IMAGE_BASE_URL}/${encodeURI(hit.lehekylje_pilt)}` : '#';

        // Helper to find relevant tags/comments (those containing highlight marks)
        const hasHighlightedTags = hit._formatted?.tags?.some(t => t.includes('<em'));
        const highlightedComments = hit._formatted?.comments?.filter(c => c.text.includes('<em'));

        return (
            <div key={hit.id} className={`flex flex-col gap-2 p-3 ${isAdditional ? 'bg-gray-50 border-t border-gray-100' : ''}`}>
                <div className="flex items-center gap-3">
                    <a
                        href={fullImageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono text-primary-600 hover:underline flex items-center gap-1"
                        title="Ava originaalpilt uues aknas"
                    >
                        {filename} <ExternalLink size={10} />
                    </a>
                    <span className="text-gray-300">|</span>
                    <button
                        onClick={() => navigate(`/work/${hit.teose_id}/${hit.lehekylje_number}`)}
                        className="text-xs font-bold text-gray-700 hover:text-primary-700 hover:underline"
                    >
                        Ava töölaud (Lk {hit.lehekylje_number})
                    </button>
                </div>

                {/* Main Text Snippet */}
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
                    <div className="flex flex-wrap gap-2 mt-1">
                        {hit._formatted?.tags?.filter(t => t.includes('<em')).map((tagHtml, idx) => (
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
                    <div className="space-y-2 mt-1">
                        {highlightedComments.map((comment, idx) => (
                            <div key={idx} className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs text-gray-800">
                                <div className="flex items-center gap-1 mb-1 font-bold text-yellow-800">
                                    <MessageSquare size={12} />
                                    <span>Kommentaar ({comment.author})</span>
                                </div>
                                <div dangerouslySetInnerHTML={{ __html: comment.text }} />
                            </div>
                        ))}
                    </div>
                )}

            </div>
        );
    };

    const groupedResults = getGroupedResults();
    const uniqueWorksCount = results?.facetDistribution?.['teose_id']
        ? Object.keys(results.facetDistribution['teose_id']).length
        : Object.keys(groupedResults).length;

    return (
        <div className="h-full bg-gray-50 font-sans flex flex-col overflow-hidden">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm z-20 shrink-0">
                <div className="max-w-7xl mx-auto flex flex-col gap-4">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate('/')}
                            className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
                            title="Tagasi avalehele"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <div>
                            <h1 className="text-xl font-bold text-primary-900 leading-none">VUTT Otsing</h1>
                            <p className="text-xs text-gray-500 uppercase tracking-wider mt-1">Täisteksti otsingumootor</p>
                        </div>
                    </div>

                    <form onSubmit={handleSearch} className="flex gap-2 relative">
                        <div className="relative flex-1">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                            <input
                                type="search"
                                placeholder="Sisesta otsisõna (otsib tekstist, kommentaaridest ja märksõnadest)..."
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
                            Otsi
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
            </header>

            <div className="flex-1 overflow-hidden flex max-w-7xl mx-auto w-full">

                {/* Sidebar Filters (Desktop) */}
                <aside className={`
            md:w-64 md:flex md:flex-col md:border-r border-gray-200 bg-white p-6 overflow-y-auto shrink-0 z-10
            ${showFiltersMobile ? 'absolute inset-0 z-30 flex flex-col' : 'hidden'}
          `}>
                    <div className="flex justify-between items-center mb-6 md:hidden">
                        <h3 className="font-bold text-lg">Filtrid</h3>
                        <button onClick={() => setShowFiltersMobile(false)}>Sulge</button>
                    </div>

                    <div className="space-y-6">

                        {/* Search Scope */}
                        <div>
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                                <Layers size={14} /> Otsingu ulatus
                            </h3>
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
                                    <span className="text-sm text-gray-700">Terve dokument</span>
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
                                    <span className="text-sm text-gray-700">Ainult originaaltekst</span>
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
                                    <span className="text-sm text-gray-700">Ainult annotatsioonid</span>
                                </label>
                            </div>
                        </div>

                        {/* Year Filter */}
                        <div>
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                                <Calendar size={14} /> Ajavahemik
                            </h3>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-xs text-gray-400 mb-1 block">Alates</label>
                                    <input
                                        type="number"
                                        value={yearStart}
                                        onChange={(e) => setYearStart(e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded text-sm text-center"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-400 mb-1 block">Kuni</label>
                                    <input
                                        type="number"
                                        value={yearEnd}
                                        onChange={(e) => setYearEnd(e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded text-sm text-center"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Catalog Filter */}
                        <div>
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                                <FolderOpen size={14} /> Kataloog / Kogu
                            </h3>
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                    <input
                                        type="radio"
                                        name="catalog"
                                        value="all"
                                        checked={selectedCatalog === 'all'}
                                        onChange={() => setSelectedCatalog('all')}
                                        className="text-primary-600 focus:ring-primary-500"
                                    />
                                    <span className="text-sm text-gray-700">Kõik kogud</span>
                                </label>

                                {availableCatalogs.map(([catName, count]) => (
                                    <label key={catName} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                        <input
                                            type="radio"
                                            name="catalog"
                                            value={catName}
                                            checked={selectedCatalog === catName}
                                            onChange={() => setSelectedCatalog(catName)}
                                            className="text-primary-600 focus:ring-primary-500"
                                        />
                                        <span className="text-sm text-gray-700 flex-1 truncate" title={catName}>
                                            {catName}
                                        </span>
                                        <span className="text-xs text-gray-400 bg-gray-100 px-1.5 rounded-full">{count}</span>
                                    </label>
                                ))}

                                {availableCatalogs.length === 0 && !loading && selectedCatalog === 'all' && (
                                    <p className="text-xs text-gray-400 italic pl-1">Tee otsing, et näha katalooge.</p>
                                )}
                                {selectedCatalog !== 'all' && !availableCatalogs.find(([c]) => c === selectedCatalog) && (
                                    <label className="flex items-center gap-2 cursor-pointer bg-primary-50 p-1 rounded">
                                        <input
                                            type="radio"
                                            name="catalog"
                                            value={selectedCatalog}
                                            checked
                                            readOnly
                                            className="text-primary-600"
                                        />
                                        <span className="text-sm text-gray-700 font-medium">{selectedCatalog}</span>
                                    </label>
                                )}
                            </div>
                        </div>

                        <div className="pt-4 border-t border-gray-100">
                            <button
                                onClick={(e) => handleSearch(e)}
                                className="w-full py-2 bg-gray-900 text-white rounded text-sm font-bold shadow hover:bg-gray-800 transition-colors"
                            >
                                Rakenda filtrid
                            </button>
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
                                <Loader2 className="animate-spin" size={16} /> Otsin vastuseid...
                            </div>
                        ) : error ? (
                            <div className="flex items-center gap-2 text-red-600 bg-red-50 p-2 rounded border border-red-200">
                                <AlertTriangle size={16} /> {error}
                            </div>
                        ) : results ? (
                            results.totalHits === 0 ? (
                                <div className="bg-white p-4 rounded-lg border border-gray-200 text-center">
                                    <span className="block text-lg font-medium text-gray-900 mb-1">Otsingule ei leitud ühtegi vastet.</span>
                                    <span className="text-gray-500">Proovi teisi märksõnu või laienda filtreid.</span>
                                </div>
                            ) : (
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                                    <span>
                                        Leiti <strong className="text-gray-900 text-base">{results.totalHits}</strong> vastet{' '}
                                        <strong className="text-gray-900">{uniqueWorksCount}</strong> erinevast teosest.
                                    </span>
                                    <span className="text-gray-500 font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                                        Lk {results.page} / {results.totalPages}
                                    </span>
                                </div>
                            )
                        ) : (
                            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                                <Search size={48} className="mb-4 opacity-20" />
                                <p className="text-lg">Sisesta otsisõna.</p>
                                <p className="text-sm mt-2 opacity-60">Otsib teksti sisust, kommentaaridest ja märksõnadest.</p>
                            </div>
                        )}
                    </div>

                    {/* Results */}
                    {results && (
                        <div className="space-y-6">
                            {Object.keys(groupedResults).map(workId => {
                                const hits = groupedResults[workId];
                                const firstHit = hits[0];
                                const hasMore = hits.length > 1;
                                const isExpanded = expandedGroups.has(workId);

                                return (
                                    <article key={workId} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                                        {/* Work Header */}
                                        <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex justify-between items-start gap-4">
                                            <div>
                                                <h2 className="text-lg font-bold text-gray-900 mb-1 leading-snug">
                                                    {firstHit.pealkiri || 'Pealkiri puudub'}
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
                                                        title="Otsi selle autori teoseid"
                                                    >
                                                        <span className="uppercase text-gray-400 text-[10px]">Autor:</span>
                                                        {Array.isArray(firstHit.autor) ? firstHit.autor[0] : (firstHit.autor || 'Teadmata')}
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
                                                        title="Otsi selle aasta teoseid"
                                                    >
                                                        <span className="uppercase text-gray-400 text-[10px]">Aasta:</span>
                                                        {firstHit.aasta || '...'}
                                                    </button>
                                                    <span className="text-gray-300">❧</span>
                                                    <span className="text-gray-500">{firstHit.originaal_kataloog}</span>
                                                </div>
                                            </div>
                                            <div className="shrink-0">
                                                <span className="font-mono bg-gray-200 px-1.5 py-0.5 rounded text-xs text-gray-600">
                                                    {workId}
                                                </span>
                                            </div>
                                        </div>

                                        {/* First Hit */}
                                        <div className="p-1">
                                            {renderHit(firstHit)}
                                        </div>

                                        {/* Collapsible Hits */}
                                        {hasMore && (
                                            <>
                                                {isExpanded && (
                                                    <div className="border-t border-gray-100 animate-in fade-in slide-in-from-top-1 bg-gray-50/50">
                                                        {hits.slice(1).map(hit => renderHit(hit, true))}
                                                    </div>
                                                )}
                                                <button
                                                    onClick={() => toggleGroup(workId)}
                                                    className="w-full py-2 bg-gray-50 hover:bg-gray-100 text-primary-700 text-xs font-bold uppercase tracking-wide border-t border-gray-200 flex items-center justify-center gap-2 transition-colors"
                                                >
                                                    {isExpanded ? (
                                                        <>Peida lisavasted <ChevronUp size={14} /></>
                                                    ) : (
                                                        <>Näita veel {hits.length - 1} vastet samast teosest <ChevronDown size={14} /></>
                                                    )}
                                                </button>
                                            </>
                                        )}
                                    </article>
                                );
                            })}
                        </div>
                    )}

                    {/* Pagination */}
                    {results && results.totalPages > 1 && (
                        <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mt-10 mb-8 pt-8 border-t border-gray-200">
                            <button
                                onClick={() => handlePageChange(results.page - 1)}
                                disabled={results.page === 1}
                                className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 font-bold hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95"
                            >
                                ← Eelmine
                            </button>

                            <span className="text-base font-bold text-gray-600 italic px-4">
                                {results.page} / {results.totalPages}
                            </span>

                            <button
                                onClick={() => handlePageChange(results.page + 1)}
                                disabled={results.page === results.totalPages}
                                className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 font-bold hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95"
                            >
                                Järgmine →
                            </button>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default SearchPage;
