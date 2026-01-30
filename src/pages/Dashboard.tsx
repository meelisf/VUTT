import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { searchWorks, FacetDistribution } from '../services/meiliService';
import { Work, WorkStatus } from '../types';
import WorkCard from '../components/WorkCard';
import Header from '../components/Header';
import AdvancedFilters from '../components/AdvancedFilters';
import { useUser } from '../contexts/UserContext';
import { useCollection } from '../contexts/CollectionContext';
import { Search, AlertTriangle, ArrowUpDown, X, ChevronLeft, ChevronRight, User, CheckSquare, Square, FolderInput } from 'lucide-react';
import CollectionPicker from '../components/CollectionPicker';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FILE_API_URL } from '../config';

const ITEMS_PER_PAGE = 12;
const SCROLL_STORAGE_KEY = 'vutt_dashboard_scroll';

const Dashboard: React.FC = () => {
  const { t, i18n } = useTranslation(['dashboard', 'common', 'auth']);
  const { user, isLoading: userLoading } = useUser();
  const { selectedCollection, setSelectedCollection, collections } = useCollection();
  const [showAboutModal, setShowAboutModal] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [aboutHtml, setAboutHtml] = useState<string>('');
  const [searchParams, setSearchParams] = useSearchParams();
  const queryParam = searchParams.get('q') || '';
  const yearStartParam = searchParams.get('ys');
  const yearEndParam = searchParams.get('ye');
  const defaultSort = searchParams.get('q') ? 'relevance' : 'year_asc';
  const sortParam = searchParams.get('sort') || defaultSort;
  const authorParam = searchParams.get('author') || '';
  const respondensParam = searchParams.get('respondens') || '';
  const printerParam = searchParams.get('printer') || '';
  const statusParam = searchParams.get('status') as WorkStatus | null;
  const teoseTagsParam = searchParams.get('tags')?.split(',').filter(Boolean) || [];
  const genreParam = searchParams.get('genre') || null;
  const typeParam = searchParams.get('type') || null;
  const collectionParam = searchParams.get('collection') || null;
  const pageParam = parseInt(searchParams.get('page') || '1', 10);

  const [inputValue, setInputValue] = useState(queryParam);
  const [works, setWorks] = useState<Work[]>([]);
  const [facets, setFacets] = useState<FacetDistribution>({});
  const [currentPage, setCurrentPage] = useState(pageParam);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Year filter state
  const [yearStart, setYearStart] = useState<string>(yearStartParam || '1630');
  const [yearEnd, setYearEnd] = useState<string>(yearEndParam || '1710');
  const [sort, setSort] = useState<string>(sortParam);

  // Täpsemad filtrid (AdvancedFilters komponent)
  const [selectedTags, setSelectedTags] = useState<string[]>(teoseTagsParam);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(genreParam);
  const [selectedType, setSelectedType] = useState<string | null>(typeParam);
  const [selectedStatus, setSelectedStatus] = useState<WorkStatus | null>(statusParam);

  // Multi-select režiim (ainult admin)
  const [selectMode, setSelectMode] = useState(false);
  const [selectedWorkIds, setSelectedWorkIds] = useState<Set<string>>(new Set());
  const [showBulkCollectionPicker, setShowBulkCollectionPicker] = useState(false);
  const [bulkAssignLoading, setBulkAssignLoading] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);  // Triggers re-fetch

  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  // Laadime "Projektist" HTML faili
  useEffect(() => {
    const loadAbout = async () => {
      try {
        const lang = i18n.language.split('-')[0];
        const fileSuffix = lang === 'en' ? '_en' : '';
        const response = await fetch(`/about${fileSuffix}.html`);
        if (response.ok) {
          const html = await response.text();
          const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
          const styleTag = styleMatch ? `<style>${styleMatch[1]}</style>` : '';
          const bodyContent = bodyMatch ? bodyMatch[1] : html;
          setAboutHtml(styleTag + bodyContent);
        }
      } catch (e) {
        console.warn('About laadimine ebaõnnestus:', e);
      }
    };
    loadAbout();
  }, [i18n.language]);

  // Sünkroniseeri kollektsiooni URL parameeter kontekstiga
  useEffect(() => {
    // Kui URL-is on kollektsioon ja see on kehtiv, sea see kontekstis
    if (collectionParam && collections[collectionParam] && collectionParam !== selectedCollection) {
      setSelectedCollection(collectionParam);
    }
    // Kui URL-is pole kollektsiooni, aga kontekstis on, tühjenda URL param (ära eemalda valikut)
    // Seda ei tee, et säiliks kollektsiooni valik headeris
  }, [collectionParam, collections]);

  // Taasta scroll positsioon pärast teoste laadimist
  useEffect(() => {
    if (!loading && works.length > 0 && scrollContainerRef.current) {
      const savedScroll = sessionStorage.getItem(SCROLL_STORAGE_KEY);
      if (savedScroll) {
        const scrollY = parseInt(savedScroll, 10);
        // Kasuta setTimeout, et DOM jõuaks uuenduda
        setTimeout(() => {
          scrollContainerRef.current?.scrollTo(0, scrollY);
        }, 50);
      }
    }
  }, [loading, works]);

  // Salvesta scroll positsioon jooksvalt scrollimise ajal
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      sessionStorage.setItem(SCROLL_STORAGE_KEY, container.scrollTop.toString());
    };

    // Kasuta throttle'it, et mitte liiga tihti salvestada
    let timeout: ReturnType<typeof setTimeout>;
    const throttledScroll = () => {
      clearTimeout(timeout);
      timeout = setTimeout(handleScroll, 100);
    };

    container.addEventListener('scroll', throttledScroll);
    return () => {
      container.removeEventListener('scroll', throttledScroll);
      clearTimeout(timeout);
    };
  }, []);

  // Sync state with URL params (e.g. back button, or navigation from WorkCard)
  useEffect(() => {
    setInputValue(queryParam);
    if (yearStartParam) setYearStart(yearStartParam);
    if (yearEndParam) setYearEnd(yearEndParam);
    if (sortParam) setSort(sortParam);
    setSelectedTags(teoseTagsParam);
    setSelectedGenre(genreParam);
    setSelectedType(typeParam);
    setSelectedStatus(statusParam);
    setCurrentPage(pageParam);
  }, [queryParam, yearStartParam, yearEndParam, sortParam, teoseTagsParam.join(','), genreParam, typeParam, statusParam, pageParam]);

  // Debounce input updates to URL
  useEffect(() => {
    const timer = setTimeout(() => {
      const newParams = new URLSearchParams(searchParams);
      let changed = false;
      let resetPage = false;

      if (inputValue !== queryParam) {
        if (inputValue) newParams.set('q', inputValue);
        else {
          newParams.delete('q');
          // Kui otsing tühjendatakse ja sort on relevantsus, muuda aasta järgi
          if (sort === 'relevance') {
            setSort('year_asc');
            newParams.set('sort', 'year_asc');
          }
        }
        changed = true;
        resetPage = true; // Otsingu muutmisel lähtesta leht
      }

      // Only sync year if it's different from default OR if it was already in params
      // This prevents cluttering URL with defaults on initial load unless user explicitly set them
      const defaultStart = '1630';
      const defaultEnd = '1710';

      if (yearStart !== (yearStartParam || defaultStart)) {
        newParams.set('ys', yearStart);
        changed = true;
        resetPage = true; // Aasta muutmisel lähtesta leht
      } else if (yearStart !== defaultStart || yearStartParam) {
        newParams.set('ys', yearStart);
      }

      if (yearEnd !== (yearEndParam || defaultEnd)) {
        newParams.set('ye', yearEnd);
        changed = true;
        resetPage = true; // Aasta muutmisel lähtesta leht
      } else if (yearEnd !== defaultEnd || yearEndParam) {
        newParams.set('ye', yearEnd);
      }

      if (sort !== sortParam) {
        newParams.set('sort', sort);
        changed = true;
      }

      // Teose märksõnad
      const currentTagsParam = searchParams.get('tags') || '';
      const newTagsParam = selectedTags.join(',');
      if (newTagsParam !== currentTagsParam) {
        if (newTagsParam) {
          newParams.set('tags', newTagsParam);
        } else {
          newParams.delete('tags');
        }
        changed = true;
        resetPage = true;
      }

      // Žanr
      if (selectedGenre !== genreParam) {
        if (selectedGenre) {
          newParams.set('genre', selectedGenre);
        } else {
          newParams.delete('genre');
        }
        changed = true;
        resetPage = true;
      }

      // Tüüp
      if (selectedType !== typeParam) {
        if (selectedType) {
          newParams.set('type', selectedType);
        } else {
          newParams.delete('type');
        }
        changed = true;
        resetPage = true;
      }

      // Staatus
      if (selectedStatus !== statusParam) {
        if (selectedStatus) {
          newParams.set('status', selectedStatus);
        } else {
          newParams.delete('status');
        }
        changed = true;
        resetPage = true;
      }

      // Lähtesta leht 1-le kui filtrid muutusid
      if (resetPage && pageParam > 1) {
        newParams.delete('page');
        setCurrentPage(1);
      }

      if (changed) {
        setSearchParams(newParams, { replace: true });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [inputValue, yearStart, yearEnd, sort, selectedTags, selectedGenre, selectedType, selectedStatus, setSearchParams, queryParam, yearStartParam, yearEndParam, sortParam, genreParam, typeParam, statusParam]);

  // Perform search when params change
  useEffect(() => {
    const fetchWorks = async () => {
      setLoading(true);
      setError(null);
      try {
        const start = parseInt(yearStart) || undefined;
        const end = parseInt(yearEnd) || undefined;

        // Pass filter options to the API (including status filter - server-side)
        const result = await searchWorks(queryParam, {
          yearStart: start,
          yearEnd: end,
          sort: sort,
          author: authorParam || undefined,
          respondens: respondensParam || undefined,
          printer: printerParam || undefined,
          workStatus: statusParam || undefined,
          teoseTags: selectedTags.length > 0 ? selectedTags : undefined,
          genre: selectedGenre ? [selectedGenre] : undefined,
          type: selectedType ? [selectedType] : undefined,
          collection: selectedCollection || undefined,
          onlyFirstPage: sort !== 'recent',
          lang: i18n.language.split('-')[0]  // et-EE -> et
        });
        setWorks(result.works);
        setFacets(result.facets);

        // Reset to page 1 when filters change (but not when page param changes)
        if (currentPage !== 1 && !searchParams.get('page')) {
          setCurrentPage(1);
        }
      } catch (e: any) {
        console.error("Search failed", e);
        setError(e.message || "Tundmatu viga ühendamisel.");
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(() => {
      fetchWorks();
    }, 400);

    return () => clearTimeout(timer);
  }, [queryParam, yearStart, yearEnd, sort, authorParam, respondensParam, printerParam, statusParam, selectedTags, selectedGenre, selectedType, selectedCollection, refreshCounter, i18n.language]);

  // Multi-select helper funktsioonid
  const toggleWorkSelection = (workId: string) => {
    setSelectedWorkIds(prev => {
      const next = new Set(prev);
      if (next.has(workId)) {
        next.delete(workId);
      } else {
        next.add(workId);
      }
      return next;
    });
  };

  const selectAllVisible = () => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const currentWorks = works.slice(startIndex, endIndex);
    setSelectedWorkIds(prev => {
      const next = new Set(prev);
      currentWorks.forEach(w => next.add(w.work_id));
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedWorkIds(new Set());
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedWorkIds(new Set());
  };

  // Massilise kollektsiooni määramine
  const handleBulkAssignCollection = async (collectionId: string | null) => {
    if (selectedWorkIds.size === 0) return;

    setBulkAssignLoading(true);
    try {
      const token = localStorage.getItem('vutt_token');
      const response = await fetch(`${FILE_API_URL}/works/bulk-collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: token,
          work_ids: Array.from(selectedWorkIds),
          collection: collectionId
        })
      });

      const result = await response.json();
      if (result.status === 'success') {
        // Tühjenda valik ja uuenda otsing
        setSelectedWorkIds(new Set());
        setSelectMode(false);
        // Trigger re-fetch by incrementing refresh counter
        setRefreshCounter(prev => prev + 1);
      } else {
        alert(result.message || t('dashboard:bulkAssign.error'));
      }
    } catch (e) {
      console.error('Bulk assign failed:', e);
      alert(t('dashboard:bulkAssign.error'));
    } finally {
      setBulkAssignLoading(false);
      setShowBulkCollectionPicker(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 font-sans">
      <Header />

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-8 py-8">

          {/* Error Banner */}
          {error && (
            <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-r shadow-sm flex items-start gap-3">
              <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={20} />
              <div>
                <h3 className="font-bold text-red-800">{t('error.connectionError')}</h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
                <p className="text-xs text-red-600 mt-2">
                  {t('error.httpsWarning')}
                </p>
              </div>
            </div>
          )}

          {/* Search & Filter Section */}
          <div className="mb-10 max-w-4xl mx-auto">
            <div className="flex flex-col gap-4">
              {/* Search Bar */}
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input
                  type="text"
                  placeholder={t('search.placeholder')}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 rounded-lg border border-gray-300 shadow-sm focus:ring-2 focus:ring-primary-100 focus:border-primary-500 outline-none transition-shadow text-lg"
                />
              </div>

              {/* Controls Row */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                {/* Year Filter */}
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">{t('search.timeRange')}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={yearStart}
                      onChange={(e) => setYearStart(e.target.value)}
                      className="w-20 p-1.5 border border-gray-300 rounded text-sm focus:border-primary-500 outline-none text-center"
                      placeholder="1630"
                    />
                    <span className="text-gray-300 font-bold">-</span>
                    <input
                      type="number"
                      value={yearEnd}
                      onChange={(e) => setYearEnd(e.target.value)}
                      className="w-20 p-1.5 border border-gray-300 rounded text-sm focus:border-primary-500 outline-none text-center"
                      placeholder="1710"
                    />
                  </div>
                </div>

                <div className="h-6 w-px bg-gray-200 hidden sm:block"></div>

                {/* Author Filter Badge */}
                {authorParam && (
                  <div className="flex items-center gap-1 px-3 py-1.5 bg-primary-50 text-primary-700 rounded-md text-sm font-medium">
                    <User size={14} />
                    <span className="truncate max-w-32">{authorParam}</span>
                    <button
                      onClick={() => {
                        const newParams = new URLSearchParams(searchParams);
                        newParams.delete('author');
                        setSearchParams(newParams);
                      }}
                      className="ml-1 hover:bg-primary-100 rounded p-0.5"
                      title={t('search.removeAuthorFilter')}
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}

                {/* Respondens Filter Badge */}
                {respondensParam && (
                  <div className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-md text-sm font-medium">
                    <User size={14} />
                    <span className="text-xs text-indigo-500 mr-0.5">resp:</span>
                    <span className="truncate max-w-32">{respondensParam}</span>
                    <button
                      onClick={() => {
                        const newParams = new URLSearchParams(searchParams);
                        newParams.delete('respondens');
                        setSearchParams(newParams);
                      }}
                      className="ml-1 hover:bg-indigo-100 rounded p-0.5"
                      title={t('search.removeRespondensFilter')}
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}

                {/* Printer Filter Badge */}
                {printerParam && (
                  <div className="flex items-center gap-1 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-md text-sm font-medium">
                    <span className="font-serif">¶</span>
                    <span className="truncate max-w-32">{printerParam}</span>
                    <button
                      onClick={() => {
                        const newParams = new URLSearchParams(searchParams);
                        newParams.delete('printer');
                        setSearchParams(newParams);
                      }}
                      className="ml-1 hover:bg-amber-100 rounded p-0.5"
                      title={t('search.removePrinterFilter')}
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}

                {/* Status Filter Badge */}
                {statusParam && (
                  <div className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium ${statusParam === 'Valmis' ? 'bg-green-50 text-green-700' :
                    statusParam === 'Töös' ? 'bg-amber-50 text-amber-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                    <span>{t(`common:status.${statusParam}`)}</span>
                    <button
                      onClick={() => {
                        const newParams = new URLSearchParams(searchParams);
                        newParams.delete('status');
                        setSearchParams(newParams);
                      }}
                      className="ml-1 hover:bg-white/50 rounded p-0.5"
                      title={t('search.removeStatusFilter')}
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}

                {/* Reset Filters Button */}
                {(inputValue || yearStart !== '1630' || yearEnd !== '1710' || authorParam || respondensParam || printerParam || statusParam || selectedTags.length > 0) && (
                  <button
                    onClick={() => {
                      setInputValue('');
                      setYearStart('1630');
                      setYearEnd('1710');
                      setSort('recent');
                      setSelectedTags([]);
                      setSearchParams({});
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors font-medium"
                    title={t('search.clearAll')}
                  >
                    <X size={14} />
                    {t('common:buttons.cancel')}
                  </button>
                )}

                <div className="h-6 w-px bg-gray-200 hidden sm:block"></div>

                {/* Sort Control */}
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <ArrowUpDown size={16} className="text-gray-400" />
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                    className="p-1.5 border border-gray-300 rounded text-sm focus:border-primary-500 outline-none bg-transparent cursor-pointer hover:bg-gray-50"
                  >
                    {queryParam && <option value="relevance">{t('sort.relevance')}</option>}
                    <option value="year_asc">{t('sort.yearAsc')}</option>
                    <option value="year_desc">{t('sort.yearDesc')}</option>
                    <option value="az">{t('sort.az')}</option>
                    <option value="recent">{t('sort.recent')}</option>
                  </select>
                </div>
              </div>

              {/* Täpsemad filtrid (žanr, märksõnad, tüüp) */}
              <AdvancedFilters
                selectedGenre={selectedGenre}
                selectedTags={selectedTags}
                selectedType={selectedType}
                selectedStatus={selectedStatus}
                onGenreChange={setSelectedGenre}
                onTagsChange={setSelectedTags}
                onTypeChange={setSelectedType}
                onStatusChange={setSelectedStatus}
                collection={selectedCollection}
                yearStart={parseInt(yearStart) || undefined}
                yearEnd={parseInt(yearEnd) || undefined}
                facets={facets}
                lang={i18n.language.split('-')[0] as 'et' | 'en'}
              />
            </div>
          </div>

          {/* Results Grid */}
          <div className="max-w-7xl mx-auto">
            {(() => {
              // Server-side filtreerimine - works on juba filtreeritud teose_staatus järgi
              const totalPages = Math.ceil(works.length / ITEMS_PER_PAGE);
              const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
              const endIndex = startIndex + ITEMS_PER_PAGE;
              const currentWorks = works.slice(startIndex, endIndex);

              const handlePageChange = (newPage: number) => {
                setCurrentPage(newPage);
                const newParams = new URLSearchParams(searchParams);
                if (newPage === 1) {
                  newParams.delete('page');
                } else {
                  newParams.set('page', newPage.toString());
                }
                setSearchParams(newParams, { replace: true });
                // Scroll to top
                window.scrollTo({ top: 0, behavior: 'smooth' });
              };

              // Generate page numbers to show
              const getPageNumbers = () => {
                const pages: (number | string)[] = [];
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
                <>
                  <div className="flex justify-between items-center mb-6 border-b border-gray-200 pb-3">
                    <div className="flex items-center gap-4">
                      <h2 className="text-xl font-bold text-gray-800">{t('results.bookshelf')}</h2>
                      {/* Admin: Select mode toggle */}
                      {isAdmin && works.length > 0 && (
                        <button
                          onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                            selectMode
                              ? 'bg-primary-100 text-primary-700 font-medium'
                              : 'text-gray-500 hover:bg-gray-100'
                          }`}
                          title={selectMode ? t('bulkAssign.exitSelect') : t('bulkAssign.enterSelect')}
                        >
                          {selectMode ? <CheckSquare size={16} /> : <Square size={16} />}
                          {selectMode ? t('bulkAssign.exitSelect') : t('bulkAssign.select')}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      {/* Select all / clear selection */}
                      {selectMode && (
                        <div className="flex items-center gap-2 text-sm">
                          <button
                            onClick={selectAllVisible}
                            className="text-primary-600 hover:text-primary-800 font-medium"
                          >
                            {t('bulkAssign.selectAllVisible')}
                          </button>
                          {selectedWorkIds.size > 0 && (
                            <>
                              <span className="text-gray-300">|</span>
                              <button
                                onClick={clearSelection}
                                className="text-gray-500 hover:text-gray-700"
                              >
                                {t('bulkAssign.clearSelection')}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      <span className="text-sm text-gray-500">
                        {t('results.worksCount', { count: works.length })} {statusParam && t('results.filtered')} {totalPages > 1 && `• ${t('results.pageOf', { current: currentPage, total: totalPages })}`}
                      </span>
                    </div>
                  </div>

                  {loading ? (
                    <div className="flex justify-center py-20">
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
                        <span className="text-gray-400 text-sm">{t('results.loadingShelf')}</span>
                      </div>
                    </div>
                  ) : works.length > 0 ? (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {currentWorks.map(work => (
                            <WorkCard
                              key={work.work_id}
                              work={work}
                              selectMode={selectMode}
                              isSelected={selectedWorkIds.has(work.work_id)}
                              onToggleSelect={() => toggleWorkSelection(work.work_id)}
                            />
                          ))}
                      </div>

                      {/* Pagination */}
                      {totalPages > 1 && (
                        <div className="flex justify-center items-center gap-2 mt-10 pt-6 border-t border-gray-200">
                          <button
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1}
                            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            <ChevronLeft size={18} />
                            {t('common:buttons.previous')}
                          </button>

                          <div className="flex items-center gap-1 mx-2">
                            {getPageNumbers().map((page, idx) => (
                              page === '...' ? (
                                <span key={`ellipsis-${idx}`} className="px-2 text-gray-400">...</span>
                              ) : (
                                <button
                                  key={page}
                                  onClick={() => handlePageChange(page as number)}
                                  className={`w-10 h-10 rounded-lg font-medium transition-colors ${currentPage === page
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
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage === totalPages}
                            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {t('common:buttons.next')}
                            <ChevronRight size={18} />
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-16 bg-white rounded-xl border border-gray-200 border-dashed">
                      <p className="text-gray-400 text-lg">{t('results.noResults')}</p>
                      {!error && (
                        <div className="mt-2 text-sm text-gray-400">
                          {t('results.checkData')}
                        </div>
                      )}
                      <button
                        onClick={() => {
                          setInputValue('');
                          setYearStart('1630');
                          setYearEnd('1710');
                          setSort('recent');
                          setSearchParams({});
                        }}
                        className="mt-4 text-primary-600 font-medium hover:underline"
                      >
                        {t('results.restoreDefaults')}
                      </button>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-gray-50 py-4 px-8 shrink-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-sm text-gray-500">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowAboutModal(true)}
              className="hover:text-primary-600 transition-colors"
            >
              {t('footer.aboutProject')}
            </button>
            <span className="text-gray-300">|</span>
            <Link
              to="/stats"
              className="hover:text-primary-600 transition-colors"
            >
              {t('footer.statistics')}
            </Link>
            <span className="text-gray-300">|</span>
            <a
              href="https://utlib.ut.ee/et"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary-600 transition-colors"
            >
              {t('footer.library')}
            </a>
          </div>
          <div className="text-gray-400 text-xs">
            {t('footer.copyright')}
          </div>
        </div>
      </footer>

      {/* About Modal */}
      {showAboutModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAboutModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <img src="/logo.png" alt="VUTT" className="h-8 w-auto" />
              <button onClick={() => setShowAboutModal(false)} className="text-gray-500 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            <div
              className="p-6 overflow-y-auto max-h-[calc(80vh-60px)]"
              dangerouslySetInnerHTML={{ __html: aboutHtml || `<p>${t('common:labels.loading')}</p>` }}
            />
          </div>
        </div>
      )}

      {/* Floating Action Bar - ilmub kui teosed on valitud */}
      {selectMode && selectedWorkIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-4 z-40">
          <span className="font-medium">
            {t('bulkAssign.selectedCount', { count: selectedWorkIds.size })}
          </span>
          <div className="h-5 w-px bg-gray-600" />
          <button
            onClick={() => setShowBulkCollectionPicker(true)}
            disabled={bulkAssignLoading}
            className="flex items-center gap-2 px-4 py-1.5 bg-primary-600 hover:bg-primary-700 rounded-full font-medium transition-colors disabled:opacity-50"
          >
            <FolderInput size={18} />
            {bulkAssignLoading ? t('common:labels.loading') : t('bulkAssign.assignCollection')}
          </button>
          <button
            onClick={exitSelectMode}
            className="text-gray-400 hover:text-white transition-colors p-1"
            title={t('bulkAssign.exitSelect')}
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* Bulk Collection Picker Modal */}
      {showBulkCollectionPicker && (
        <CollectionPicker
          onSelect={handleBulkAssignCollection}
          onClose={() => setShowBulkCollectionPicker(false)}
          showUnassigned={true}
          title={t('bulkAssign.selectCollection')}
        />
      )}
    </div>
  );
};

export default Dashboard;
