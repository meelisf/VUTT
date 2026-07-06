import React, { useState, useEffect, useRef, useMemo } from 'react';
import { isAtLeast } from '../utils/roleUtils';
import { useTranslation } from 'react-i18next';
import { searchWorks, FacetDistribution } from '../services/searchService';
import { isQCode } from '../utils/qcodeUtils';
import { getCollectionColorClasses } from '../services/collectionService';
import { Work, WorkStatus } from '../types';
import WorkCard from '../components/WorkCard';
import Header from '../components/Header';
import LoginModal from '../components/LoginModal';
import AdvancedFilters from '../components/AdvancedFilters';
import { useUser } from '../contexts/UserContext';
import { useCollection } from '../contexts/CollectionContext';
import { useMeiliIndex } from '../contexts/MeilisearchContext';
import { Search, AlertTriangle, ArrowUpDown, X, ChevronLeft, ChevronRight, User, Library, ChevronDown, Lock, LogIn } from 'lucide-react';
import CollectionPicker from '../components/CollectionPicker';
import CollectionInfoBanner from '../components/CollectionInfoBanner';
import SafeHtml from '../components/SafeHtml';
import BulkTagsPicker from '../components/BulkTagsPicker';
import BulkGenrePicker from '../components/BulkGenrePicker';
import { LinkedEntity } from '../types/LinkedEntity';
import { getEntityLabelsCache } from '../services/entityLabelsService';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { bulkAssignCollection, bulkAssignGenre, bulkAssignTags } from '../services/workApi';
import { getLangCode } from '../utils/getLangCode';
import { buildLinkedEntityMaps, collectLinkedEntities } from '../utils/buildLinkedEntityMaps';
import { useCollectionUrlSync } from '../hooks/useCollectionUrlSync';
import DashboardBulkActionBar from '../components/dashboard/DashboardBulkActionBar';
import DashboardResultsHeader from '../components/dashboard/DashboardResultsHeader';

const ITEMS_PER_PAGE = 12;
const SCROLL_STORAGE_KEY = 'vutt_dashboard_scroll';
const RETURN_URL_KEY = 'vutt_return_url';
const DASHBOARD_URL_KEY = 'vutt_dashboard_url';

const SEARCH_DEBOUNCE_MS = 400;

const Dashboard: React.FC = () => {
  const { t, i18n } = useTranslation(['dashboard', 'common', 'auth']);
  const { user } = useUser();
  const { selectedCollection, setSelectedCollection, getCollectionName, collections } = useCollection();
  const index = useMeiliIndex();
  const lang = getLangCode(i18n.language);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const scrollContainerRef = useRef<HTMLElement>(null);
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
  const [yearStart, setYearStart] = useState<string>(yearStartParam || '');
  const [yearEnd, setYearEnd] = useState<string>(yearEndParam || '');
  const [sort, setSort] = useState<string>(sortParam);

  // Täpsemad filtrid (AdvancedFilters komponent)
  const [selectedTags, setSelectedTags] = useState<string[]>(teoseTagsParam);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(genreParam);
  const [selectedType, setSelectedType] = useState<string | null>(typeParam);
  const [selectedStatus, setSelectedStatus] = useState<WorkStatus | null>(statusParam);

  // Wikidata rikastatud labelid — Q-koodid millel puudub praeguse keele label
  const [enrichedLabels, setEnrichedLabels] = useState<Record<string, Record<string, string>>>({});

  // Multi-select režiim (ainult admin)
  const [selectMode, setSelectMode] = useState(false);
  const [selectedWorkIds, setSelectedWorkIds] = useState<Set<string>>(new Set());
  // Viimati klikitud teose indeks nähtaval lehel — shift-valiku ankur (nagu manage-lehel)
  const lastSelectedIndexRef = useRef<number | null>(null);
  const [showBulkCollectionPicker, setShowBulkCollectionPicker] = useState(false);
  const [showMobileCollectionPicker, setShowMobileCollectionPicker] = useState(false);
  const [showBulkTagsPicker, setShowBulkTagsPicker] = useState(false);
  const [showBulkGenrePicker, setShowBulkGenrePicker] = useState(false);
  const [bulkAssignLoading, setBulkAssignLoading] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);  // Triggers re-fetch
  const [showLoginModal, setShowLoginModal] = useState(false);

  const isAdmin = isAtLeast(user?.role, 'admin');

  // Kas valitud kollektsioon on kaitstud — tühja tulemuse korral on põhjus
  // tõenäoliselt ligipääsupuudus (mitte andmete/filtrite probleem).
  const selectedCollectionObj = selectedCollection ? collections[selectedCollection] : null;
  const isRestrictedCollection = selectedCollectionObj?.visibility === 'restricted';
  // Kaitstud-kogu tühja tulemuse eriteadet näita ainult siis, kui kasutajal pole ligipääsu.
  // Adminidel on Meilisearchis piiranguta token; tavakasutajal piisab allowed_collections kirjest.
  const hasRestrictedCollectionAccess = !isRestrictedCollection || isAdmin || (
    !!selectedCollection && !!user?.allowed_collections?.includes(selectedCollection)
  );

  // Sünkroonib selectedCollection → URL ?collection= param (Context → URL suund)
  useCollectionUrlSync(selectedCollection, setSearchParams);

  // Salvesta dashboardi URL sessionStorage'isse, et logo saaks siia tagasi tuua
  useEffect(() => {
    const url = '/' + (searchParams.toString() ? '?' + searchParams.toString() : '');
    sessionStorage.setItem(RETURN_URL_KEY, url);
    sessionStorage.setItem(DASHBOARD_URL_KEY, url);
  }, [searchParams]);

  // Laadime "Projektist" HTML faili alles modaali avamisel (lazy load)
  useEffect(() => {
    if (!showAboutModal || aboutHtml) return;
    const loadAbout = async () => {
      try {
        const lang = getLangCode(i18n.language);
        const fileSuffix = lang === 'en' ? '_en' : '';
        const response = await fetchWithTimeout(`/about${fileSuffix}.html`, { timeout: 5000 });
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
  }, [showAboutModal]);

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
  // NB: pageParam on eraldi efektis, et lehevahetuse puhul ei käivituks fetchWorks uuesti
  useEffect(() => {
    setInputValue(queryParam);
    if (yearStartParam) setYearStart(yearStartParam);
    if (yearEndParam) setYearEnd(yearEndParam);
    if (sortParam) setSort(sortParam);
    setSelectedTags(teoseTagsParam);
    setSelectedGenre(genreParam);
    setSelectedType(typeParam);
    setSelectedStatus(statusParam);
  }, [queryParam, yearStartParam, yearEndParam, sortParam, teoseTagsParam.join(','), genreParam, typeParam, statusParam]);

  // Sünkroniseeri lehekülje number URL parameetrist (nt tagasi-navigatsioon, otselink)
  useEffect(() => {
    setCurrentPage(pageParam);
  }, [pageParam]);

  // Genre kaardid: Q-kood/label → praeguse keele label + label → Q-kood
  const { idToLabel: genreIdMap, labelToId: genreLabelToId } = useMemo(() => {
    const items = collectLinkedEntities(works, w => w.genre);
    return buildLinkedEntityMaps(items, getLangCode(i18n.language), enrichedLabels);
  }, [works, i18n.language, enrichedLabels]);

  // Tags kaardid: Q-kood/label → praeguse keele label + label → Q-kood
  const { idToLabel: tagsIdMap, labelToId: tagsLabelToId } = useMemo(() => {
    const items = collectLinkedEntities(works, w => w.tags);
    return buildLinkedEntityMaps(items, getLangCode(i18n.language), enrichedLabels);
  }, [works, i18n.language, enrichedLabels]);

  // Type kaardid: Q-kood/label → praeguse keele label + label → Q-kood
  const { idToLabel: typeIdMap, labelToId: typeLabelToId } = useMemo(() => {
    const items = collectLinkedEntities(works, w => w.type);
    return buildLinkedEntityMaps(items, getLangCode(i18n.language), enrichedLabels);
  }, [works, i18n.language, enrichedLabels]);

  // Lae entity labels cache serverist (üks kord sessiooni jooksul)
  useEffect(() => {
    getEntityLabelsCache().then(labels => {
      if (Object.keys(labels).length > 0) setEnrichedLabels(labels);
    });
  }, []);

  // Q-kood → trükkali nimi (publisher_id → publisher label)
  const publisherIdMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const work of works) {
      const id = work.publisher_id;
      const label = work.publisher?.label;
      if (id && label) map[id] = label;
    }
    return map;
  }, [works]);

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

      // Aastafiltrit rakendatakse ainult kui kasutaja on midagi sisestanud
      const prevYearStart = yearStartParam || '';
      const prevYearEnd = yearEndParam || '';
      if (yearStart !== prevYearStart || yearEnd !== prevYearEnd) {
        changed = true;
        resetPage = true;
      }
      if (yearStart) newParams.set('ys', yearStart); else newParams.delete('ys');
      if (yearEnd) newParams.set('ye', yearEnd); else newParams.delete('ye');

      if (sort !== sortParam) {
        newParams.set('sort', sort);
        changed = true;
      }

      // Teose märksõnad (kasuta Q-koode URL-is kui olemas)
      const currentTagsParam = searchParams.get('tags') || '';
      const newTagsUrl = selectedTags.map(t => tagsLabelToId[t] || t).join(',');
      if (newTagsUrl !== currentTagsParam) {
        if (newTagsUrl) {
          newParams.set('tags', newTagsUrl);
        } else {
          newParams.delete('tags');
        }
        changed = true;
        resetPage = true;
      }

      // Žanr (kasuta Q-koodi URL-is kui olemas)
      const genreUrlValue = selectedGenre ? (genreLabelToId[selectedGenre] || selectedGenre) : null;
      const currentGenreUrl = genreParam;
      if (genreUrlValue !== currentGenreUrl) {
        if (genreUrlValue) {
          newParams.set('genre', genreUrlValue);
        } else {
          newParams.delete('genre');
        }
        changed = true;
        resetPage = true;
      }

      // Tüüp (kasuta Q-koodi URL-is kui olemas)
      const typeUrlValue = selectedType ? (typeLabelToId[selectedType] || selectedType) : null;
      const currentTypeUrl = typeParam;
      if (typeUrlValue !== currentTypeUrl) {
        if (typeUrlValue) {
          newParams.set('type', typeUrlValue);
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
  }, [inputValue, yearStart, yearEnd, sort, selectedTags, selectedGenre, selectedType, selectedStatus, setSearchParams, queryParam, yearStartParam, yearEndParam, sortParam, genreParam, typeParam, statusParam, genreLabelToId, tagsLabelToId, typeLabelToId]);

  // Perform search when params change
  useEffect(() => {
    if (!index) return;
    const controller = new AbortController();
    let cancelled = false;
    const fetchWorks = async () => {
      setLoading(true);
      setError(null);
      try {
        const start = parseInt(yearStart) || undefined;
        const end = parseInt(yearEnd) || undefined;

        // Pass filter options to the API (including status filter - server-side)
        const result = await searchWorks(index, queryParam, {
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
          lang: getLangCode(i18n.language),
          signal: controller.signal
        });
        if (cancelled) return;
        setWorks(result.works);
        setFacets(result.facets);

        // Reset to page 1 when filters change (but not when page param changes)
        if (currentPage !== 1 && !searchParams.get('page')) {
          setCurrentPage(1);
        }
        // Uue otsingutulemuse korral on shift-valiku ankur (lehekohalik) aegunud
        lastSelectedIndexRef.current = null;
      } catch (e: any) {
        if (!cancelled && !controller.signal.aborted) {
          console.error("Search failed", e);
          setError(e.message || "Tundmatu viga ühendamisel.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const timer = setTimeout(() => {
      fetchWorks();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [index, queryParam, yearStart, yearEnd, sort, authorParam, respondensParam, printerParam, statusParam, selectedTags, selectedGenre, selectedType, selectedCollection, refreshCounter, i18n.language]);

  // Multi-select helper funktsioonid
  // shift+klõps valib vahemiku viimasest ankrust nähtaval leheküljel (nagu manage-lehel)
  const handleToggleSelect = (workId: string, shiftKey: boolean) => {
    const visibleWorks = works.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
    const idx = visibleWorks.findIndex(w => w.work_id === workId);
    if (idx === -1) return;
    // Loe ankur ENNE setState'i (ref kirjutatakse allpool üle)
    const anchor = lastSelectedIndexRef.current;
    setSelectedWorkIds(prev => {
      const next = new Set(prev);
      if (shiftKey && anchor !== null) {
        const [lo, hi] = [anchor, idx].sort((a, b) => a - b);
        for (let i = lo; i <= hi; i++) next.add(visibleWorks[i].work_id);
      } else {
        if (next.has(workId)) next.delete(workId); else next.add(workId);
      }
      return next;
    });
    lastSelectedIndexRef.current = idx;
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
    lastSelectedIndexRef.current = null;
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedWorkIds(new Set());
    lastSelectedIndexRef.current = null;
  };

  // Massilise kollektsiooni määramine
  const handleBulkAssignCollection = async (collectionId: string | null) => {
    if (selectedWorkIds.size === 0) return;

    setBulkAssignLoading(true);
    try {
      const token = localStorage.getItem('vutt_token');
      const result = await bulkAssignCollection(token, Array.from(selectedWorkIds), collectionId);
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

  // Massiline märksõnade määramine
  const handleBulkAssignTags = async (tags: LinkedEntity[], mode: 'add' | 'replace' | 'remove') => {
    if (selectedWorkIds.size === 0) return;

    setBulkAssignLoading(true);
    try {
      const token = localStorage.getItem('vutt_token');
      const result = await bulkAssignTags(token, Array.from(selectedWorkIds), tags, mode);
      if (result.status === 'success') {
        setSelectedWorkIds(new Set());
        setSelectMode(false);
        setRefreshCounter(prev => prev + 1);
      } else {
        alert(result.message || t('dashboard:bulkAssign.tagsError'));
      }
    } catch (e) {
      console.error('Bulk tags assign failed:', e);
      alert(t('dashboard:bulkAssign.tagsError'));
    } finally {
      setBulkAssignLoading(false);
      setShowBulkTagsPicker(false);
    }
  };

  // Massiline žanri määramine
  const handleBulkAssignGenre = async (genre: LinkedEntity | null) => {
    if (selectedWorkIds.size === 0) return;

    setBulkAssignLoading(true);
    try {
      const token = localStorage.getItem('vutt_token');
      const result = await bulkAssignGenre(token, Array.from(selectedWorkIds), genre);
      if (result.status === 'success') {
        setSelectedWorkIds(new Set());
        setSelectMode(false);
        setRefreshCounter(prev => prev + 1);
      } else {
        alert(result.message || t('dashboard:bulkAssign.genreError'));
      }
    } catch (e) {
      console.error('Bulk genre assign failed:', e);
      alert(t('dashboard:bulkAssign.genreError'));
    } finally {
      setBulkAssignLoading(false);
      setShowBulkGenrePicker(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 font-sans">
      <Header />

      <main ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {/* pb reserveerib ruumi hõljuvale action bar'ile select-mode'is (ühtlustatud manage-lehega) */}
        <div className={`max-w-7xl mx-auto px-4 py-4 sm:px-8 sm:py-8 ${selectMode && selectedWorkIds.size > 0 ? 'pb-32 sm:pb-36' : ''}`}>

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
                  className={`w-full pl-12 py-3 rounded-lg border border-gray-300 shadow-sm focus:ring-2 focus:ring-primary-100 focus:border-primary-500 outline-none transition-shadow text-lg ${inputValue ? 'pr-10' : 'pr-4'}`}
                />
                {inputValue && (
                  <button
                    type="button"
                    onClick={() => setInputValue('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    tabIndex={-1}
                    aria-label="Tühjenda otsing"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>

              {/* Mobiili kollektsiooni valija */}
              {(() => {
                const colorClasses = selectedCollection ? getCollectionColorClasses(collections[selectedCollection]) : null;
                return (
                  <button
                    className={`sm:hidden flex items-center gap-2 w-full px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      selectedCollection && colorClasses
                        ? `${colorClasses.bg} ${colorClasses.border} ${colorClasses.text} ${colorClasses.hoverBg}`
                        : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
                    }`}
                    onClick={() => setShowMobileCollectionPicker(true)}
                  >
                    <Library size={16} className={selectedCollection && colorClasses ? colorClasses.text : 'text-primary-600'} />
                    <span className="flex-1 text-left truncate">
                      {selectedCollection ? getCollectionName(selectedCollection, lang) : t('common:collections.all', 'Kõik tööd')}
                    </span>
                    <ChevronDown size={14} className="shrink-0 opacity-50" />
                  </button>
                );
              })()}

              {/* Controls Row */}
              <div className="flex flex-row flex-wrap items-center gap-2 sm:gap-4 sm:justify-between bg-white p-2 sm:p-3 rounded-lg border border-gray-200 shadow-sm">
                {/* Year Filter */}
                <div className="flex items-center gap-3">
                  <span className="hidden sm:inline text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">{t('search.timeRange')}</span>
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
                    <span className="truncate max-w-32">{isQCode(printerParam) ? (publisherIdMap[printerParam] || printerParam) : printerParam}</span>
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
                {(inputValue || yearStart || yearEnd || authorParam || respondensParam || printerParam || statusParam || selectedTags.length > 0) && (
                  <button
                    onClick={() => {
                      setInputValue('');
                      setYearStart('');
                      setYearEnd('');
                      setSort('year_asc');
                      setSelectedTags([]);
                      setSearchParams({});
                    }}
                    className="flex items-center justify-center sm:justify-start gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors font-medium order-last sm:order-none w-full sm:w-auto"
                    title={t('search.clearAll')}
                  >
                    <X size={14} />
                    {t('common:buttons.cancel')}
                  </button>
                )}

                <div className="h-6 w-px bg-gray-200 hidden sm:block"></div>

                {/* Sort Control */}
                <div className="flex items-center gap-2 ml-auto sm:ml-0">
                  <ArrowUpDown size={16} className="text-gray-400" />
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                    aria-label={t('sort.label')}
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
                facets={facets}
                genreIdMap={genreIdMap}
                genreLabelToId={genreLabelToId}
                tagsIdMap={tagsIdMap}
                tagsLabelToId={tagsLabelToId}
                typeIdMap={typeIdMap}
                typeLabelToId={typeLabelToId}
                lang={getLangCode(i18n.language)}
                enrichedLabels={enrichedLabels}
              />
            </div>
          </div>

          {/* Kollektsiooni infobänner */}
          <CollectionInfoBanner />

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
                // Lehe vahetamisel on shift-valiku ankur (lehekohalik) aegunud
                lastSelectedIndexRef.current = null;
                const newParams = new URLSearchParams(searchParams);
                if (newPage === 1) {
                  newParams.delete('page');
                } else {
                  newParams.set('page', newPage.toString());
                }
                setSearchParams(newParams, { replace: true });
                // Dashboard kerib läbi window (body: min-height 100vh, overflow-y auto)
                window.scrollTo(0, 0);
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
                  <DashboardResultsHeader
                    isAdmin={isAdmin}
                    hasWorks={works.length > 0}
                    selectMode={selectMode}
                    selectedCount={selectedWorkIds.size}
                    statusFiltered={Boolean(statusParam)}
                    totalPages={totalPages}
                    labels={{
                      bookshelf: t('results.bookshelf'),
                      enterSelect: t('bulkAssign.enterSelect'),
                      exitSelect: t('bulkAssign.exitSelect'),
                      select: t('bulkAssign.select'),
                      selectAllVisible: t('bulkAssign.selectAllVisible'),
                      clearSelection: t('bulkAssign.clearSelection'),
                      worksCount: t('results.worksCount', { count: works.length }),
                      filtered: t('results.filtered'),
                      pageOf: t('results.pageOf', { current: currentPage, total: totalPages }),
                    }}
                    onToggleSelectMode={() => selectMode ? exitSelectMode() : setSelectMode(true)}
                    onSelectAllVisible={selectAllVisible}
                    onClearSelection={clearSelection}
                  />

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
                        {currentWorks.map((work, index) => (
                            <WorkCard
                              key={work.work_id}
                              work={work}
                              selectMode={selectMode}
                              isSelected={selectedWorkIds.has(work.work_id)}
                              onToggleSelect={(shiftKey) => handleToggleSelect(work.work_id, shiftKey)}
                              isPriority={index === 0}
                            />
                          ))}
                      </div>

                      {/* Pagination */}
                      {totalPages > 1 && (
                        <div className="flex justify-center items-center gap-2 mt-10 pt-6 border-t border-gray-200">
                          <button
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1}
                            aria-label={t('common:buttons.previous')}
                            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            <ChevronLeft size={18} />
                            <span className="hidden sm:inline">{t('common:buttons.previous')}</span>
                          </button>

                          {/* Mobiilne lehekülje indikaator */}
                          <span className="sm:hidden text-sm font-medium text-gray-600">{currentPage}/{totalPages}</span>

                          <div className="hidden sm:flex items-center gap-1 mx-2">
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
                            aria-label={t('common:buttons.next')}
                            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            <span className="hidden sm:inline">{t('common:buttons.next')}</span>
                            <ChevronRight size={18} />
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-16 bg-white rounded-xl border border-gray-200 border-dashed">
                      {isRestrictedCollection && !hasRestrictedCollectionAccess ? (
                        <>
                          <div className="text-primary-500 mb-3 flex justify-center"><Lock size={32} /></div>
                          <p className="text-gray-600 text-lg max-w-md mx-auto px-4">
                            {!user ? t('results.protectedLoggedOut') : t('results.protectedNoAccess')}
                          </p>
                          <div className="mt-4 flex flex-wrap gap-3 justify-center">
                            {!user && (
                              <button
                                onClick={() => setShowLoginModal(true)}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                              >
                                <LogIn size={16} />
                                {t('auth:login.title')}
                              </button>
                            )}
                            <button
                              onClick={() => setSelectedCollection(null)}
                              className="px-4 py-2 text-primary-600 font-medium hover:underline"
                            >
                              {t('results.viewAllWorks')}
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-gray-400 text-lg">{t('results.noResults')}</p>
                          {!error && (
                            <div className="mt-2 text-sm text-gray-400">
                              {t('results.checkData')}
                            </div>
                          )}
                          <button
                            onClick={() => {
                              setInputValue('');
                              setYearStart('');
                              setYearEnd('');
                              setSort('recent');
                              setSearchParams({});
                            }}
                            className="mt-4 text-primary-600 font-medium hover:underline"
                          >
                            {t('results.restoreDefaults')}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-gray-50 py-4 px-4 sm:px-8 shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center sm:justify-between gap-2 text-sm text-gray-500">
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
            <SafeHtml
              kind="trusted"
              html={aboutHtml || `<p>${t('common:labels.loading')}</p>`}
              className="p-6 overflow-y-auto max-h-[calc(80vh-60px)]"
            />
          </div>
        </div>
      )}

      {/* Floating Action Bar - ilmub kui teosed on valitud (ühtlustatud PageActionBar stiiliga manage-lehelt) */}
      {selectMode && !showBulkCollectionPicker && !showBulkTagsPicker && !showBulkGenrePicker && (
        <DashboardBulkActionBar
          selectedCount={selectedWorkIds.size}
          loading={bulkAssignLoading}
          labels={{
            selectedCount: t('bulkAssign.selectedCount', { count: selectedWorkIds.size }),
            assignCollection: t('bulkAssign.assignCollection'),
            assignTags: t('bulkAssign.assignTags'),
            assignGenre: t('bulkAssign.assignGenre'),
            clearSelection: t('bulkAssign.clearSelection'),
            exitSelect: t('bulkAssign.exitSelect'),
          }}
          onOpenCollection={() => setShowBulkCollectionPicker(true)}
          onOpenTags={() => setShowBulkTagsPicker(true)}
          onOpenGenre={() => setShowBulkGenrePicker(true)}
          onExitSelectMode={exitSelectMode}
        />
      )}

      {/* Mobiili kollektsiooni filter picker */}
      <CollectionPicker
        isOpen={showMobileCollectionPicker}
        onClose={() => setShowMobileCollectionPicker(false)}
      />

      {/* Bulk Collection Picker Modal */}
      {showBulkCollectionPicker && (
        <CollectionPicker
          onSelect={handleBulkAssignCollection}
          onClose={() => setShowBulkCollectionPicker(false)}
          showUnassigned={true}
          title={t('bulkAssign.selectCollection')}
        />
      )}

      {/* Bulk Tags Picker Modal */}
      {showBulkTagsPicker && (
        <BulkTagsPicker
          isOpen={showBulkTagsPicker}
          onClose={() => setShowBulkTagsPicker(false)}
          onSave={handleBulkAssignTags}
          selectedCount={selectedWorkIds.size}
        />
      )}

      {/* Bulk Genre Picker Modal */}
      {showBulkGenrePicker && (
        <BulkGenrePicker
          isOpen={showBulkGenrePicker}
          onClose={() => setShowBulkGenrePicker(false)}
          onSave={handleBulkAssignGenre}
          selectedCount={selectedWorkIds.size}
        />
      )}

      {/* Login modaal (kaitstud kollektsiooni tühi tulemus) */}
      <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
    </div>
  );
};

export default Dashboard;
