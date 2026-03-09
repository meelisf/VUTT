import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { searchContent, getTeoseTagsFacets, getGenreFacets, getTypeFacets, getAuthorFacets } from '../services/searchService';
import { getWorkMetadata } from '../services/workService';
import { getVocabularies, Vocabularies, getCollectionColorClasses } from '../services/collectionService';
import { ContentSearchResponse, ContentSearchOptions } from '../types';
import { Search, Loader2, Filter, Library, FileText, User, X, Layers, Tag, BookOpen, FileType, Calendar } from 'lucide-react';
import { getEntityLabelsCache } from '../services/entityLabelsService';
import { FILE_API_URL } from '../config';
import Header from '../components/Header';
import { useCollection } from '../contexts/CollectionContext';
import SearchFilters from './search/SearchFilters';
import SearchResults from './search/SearchResults';
import { mergeFacetsWithExisting, mergeTagsWithExisting, mergeSelectedIntoFacets, mergeSelectedIntoTags } from './search/searchUtils';
import { getLangCode } from '../utils/getLangCode';

const SearchPage: React.FC = () => {
    const { t, i18n } = useTranslation(['search', 'common']);
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();
    const { selectedCollection, setSelectedCollection, getCollectionName, collections } = useCollection();

    // URL parameetrid — need on tõe allikas
    const queryParam = searchParams.get('q') || '';
    const pageParam = parseInt(searchParams.get('p') || '1', 10);
    const workIdParam = searchParams.get('work') || '';
    const yearStartParam = searchParams.get('ys') ? parseInt(searchParams.get('ys')!) : undefined;
    const yearEndParam = searchParams.get('ye') ? parseInt(searchParams.get('ye')!) : undefined;
    const scopeParam = (searchParams.get('scope') as 'all' | 'original' | 'annotation') || 'all';
    const teoseTagsParam = searchParams.get('teoseTags')?.split(',').filter(Boolean) || [];
    const pageTagsParam = searchParams.get('pageTags')?.split(',').filter(Boolean) || [];
    const genreParam = searchParams.get('genre')?.split(',').filter(Boolean) || [];
    const typeParam = searchParams.get('type')?.split(',').filter(Boolean) || [];
    const authorParam = searchParams.get('author') || '';

    // Filter state — lokaalkoopiad URL parameetritest (muutuvad enne "Otsi" vajutust)
    const [inputValue, setInputValue] = useState(queryParam);
    const [yearStart, setYearStart] = useState<string>(yearStartParam?.toString() || '');
    const [yearEnd, setYearEnd] = useState<string>(yearEndParam?.toString() || '');
    const [selectedScope, setSelectedScope] = useState<'all' | 'original' | 'annotation'>(scopeParam);
    const [selectedWork, setSelectedWork] = useState<string>(workIdParam);
    const [selectedWorkInfo, setSelectedWorkInfo] = useState<{ title: string; year?: string | number; author?: string } | null>(null);
    const [availableTeoseTags, setAvailableTeoseTags] = useState<{ tag: string; count: number }[]>([]);
    const [selectedTeoseTags, setSelectedTeoseTags] = useState<string[]>(teoseTagsParam);
    const [selectedPageTags, setSelectedPageTags] = useState<string[]>(pageTagsParam);
    // Q-kood → label kaardistus, mis säilib ka kui tulemused on tühjad
    const [knownPageTagsLabels, setKnownPageTagsLabels] = useState<Record<string, string>>(
        (location.state as any)?.pageTagsLabels || {}
    );
    const [availableGenres, setAvailableGenres] = useState<{ value: string; count: number }[]>([]);
    const [selectedGenres, setSelectedGenres] = useState<string[]>(genreParam);
    const [availableTypes, setAvailableTypes] = useState<{ value: string; count: number }[]>([]);
    const [selectedTypes, setSelectedTypes] = useState<string[]>(typeParam);
    const [selectedAuthor, setSelectedAuthor] = useState<string>(authorParam);
    const [authorInput, setAuthorInput] = useState<string>(authorParam);
    const [availableAuthors, setAvailableAuthors] = useState<{ value: string; count: number }[]>([]);
    const [showAuthorSuggestions, setShowAuthorSuggestions] = useState(false);
    const [aliasMap, setAliasMap] = useState<Record<string, string>>({});
    const [vocabularies, setVocabularies] = useState<Vocabularies | null>(null);
    const [showFiltersMobile, setShowFiltersMobile] = useState(false);

    // Wikidata rikastatud labelid — Q-koodid millel puudub praeguse keele label
    const [enrichedLabels, setEnrichedLabels] = useState<Record<string, Record<string, string>>>({});

    // Otsingututemused
    const [results, setResults] = useState<ContentSearchResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Laadi filtrite andmed alguses
    useEffect(() => {
        const loadFilterData = async () => {
            try {
                const [vocabs, aliasRes] = await Promise.all([
                    getVocabularies(),
                    fetch(`${FILE_API_URL}/people-aliases`).then(r => r.ok ? r.json() : null).catch(() => null)
                ]);
                setVocabularies(vocabs);
                if (aliasRes?.status === 'success' && aliasRes.aliases) setAliasMap(aliasRes.aliases);

                const hasActiveContentFilters = !!queryParam || !!workIdParam || !!authorParam ||
                    teoseTagsParam.length > 0 || genreParam.length > 0 || typeParam.length > 0;
                if (hasActiveContentFilters) return;

                const facetLang = getLangCode(i18n.language);
                const [tags, genres, types, authors] = await Promise.all([
                    getTeoseTagsFacets(selectedCollection || undefined, facetLang, yearStartParam, yearEndParam),
                    getGenreFacets(selectedCollection || undefined, facetLang, yearStartParam, yearEndParam),
                    getTypeFacets(selectedCollection || undefined, facetLang, yearStartParam, yearEndParam),
                    getAuthorFacets(selectedCollection || undefined, yearStartParam, yearEndParam)
                ]);
                setAvailableTeoseTags(mergeSelectedIntoTags(tags, teoseTagsParam));
                setAvailableGenres(mergeSelectedIntoFacets(genres, genreParam));
                setAvailableTypes(mergeSelectedIntoFacets(types, typeParam));
                setAvailableAuthors(authors);
            } catch (e) {
                console.warn('Filtrite andmete laadimine ebaõnnestus:', e);
            }
        };
        loadFilterData();
    }, [selectedCollection, i18n.language, yearStartParam, yearEndParam, queryParam, workIdParam, authorParam, teoseTagsParam.length, genreParam.length, typeParam.length]);

    // Sünkroniseeri lokaalset state-i kui URL muutub (nt tagasinupp)
    useEffect(() => {
        setInputValue(queryParam);
        if (scopeParam) setSelectedScope(scopeParam);
        setSelectedWork(workIdParam);
        setSelectedTeoseTags(teoseTagsParam);
        setSelectedPageTags(pageTagsParam);
        setSelectedGenres(genreParam);
        setSelectedTypes(typeParam);
        setSelectedAuthor(authorParam);
        setAuthorInput(authorParam);
    }, [queryParam, scopeParam, workIdParam, teoseTagsParam.join(','), pageTagsParam.join(','), genreParam.join(','), typeParam.join(','), authorParam]);

    // Abifunktsioon: esimene täht suureks (ühtib Meilisearchi facet labelitega)
    const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : '';

    // Q-kood → label pillide jaoks: enrichedLabels (labels.json) on primaarne allikas
    const resolveLabel = (qCode: string, fallbackMap?: Record<string, string>) => {
        const lang = getLangCode(i18n.language);
        if (enrichedLabels[qCode]) {
            return cap(enrichedLabels[qCode][lang] || enrichedLabels[qCode]['et'] || qCode);
        }
        return fallbackMap?.[qCode] || qCode;
    };

    // Q-kood → praeguse keele label (žanrid)
    const genreIdMap = useMemo(() => {
        const map: Record<string, string> = {};
        const lang = getLangCode(i18n.language);
        if (!results?.hits) return map;
        for (const hit of results.hits) {
            const obj = (hit as any).genre_object;
            if (!obj) continue;
            const items = Array.isArray(obj) ? obj : [obj];
            for (const item of items) {
                if (!item?.labels) continue;
                const currentLabel = cap((item.id && enrichedLabels[item.id]?.[lang]) || item.labels[lang] || item.labels['et'] || item.label);
                if (item.id) map[item.id] = currentLabel;
                for (const labelVal of Object.values(item.labels)) {
                    if (labelVal) { map[labelVal as string] = currentLabel; map[cap(labelVal as string)] = currentLabel; }
                }
                if (item.label) { map[item.label] = currentLabel; map[cap(item.label)] = currentLabel; }
            }
        }
        return map;
    }, [results, i18n.language, enrichedLabels]);

    // Label → Q-kood (URL-i jaoks, žanrid)
    const genreLabelToId = useMemo(() => {
        const map: Record<string, string> = {};
        const lang = getLangCode(i18n.language);
        if (!results?.hits) return map;
        for (const hit of results.hits) {
            const obj = (hit as any).genre_object;
            if (!obj) continue;
            const items = Array.isArray(obj) ? obj : [obj];
            for (const item of items) {
                if (item?.id && item?.labels) {
                    const rawLabel = item.labels[lang] || item.labels['et'] || item.label;
                    map[rawLabel] = item.id;
                    map[cap(rawLabel)] = item.id;
                }
            }
        }
        return map;
    }, [results, i18n.language]);

    // Normaliseeri žanrid Q-koodideks — label URL-ist → Q-kood, Q-kood jääb
    useEffect(() => {
        if (selectedGenres.length === 0) return;
        const isQ = (s: string) => /^Q\d+$/.test(s);
        let changed = false;
        const resolved = selectedGenres.map(g => {
            if (isQ(g)) return g;
            const qCode = genreLabelToId[g] || genreLabelToId[cap(g)];
            if (qCode) { changed = true; return qCode; }
            return g;
        });
        if (changed) {
            setSelectedGenres(resolved);
            const newParams = new URLSearchParams(searchParams);
            newParams.set('genre', resolved.join(','));
            setSearchParams(newParams, { replace: true });
        }
    }, [selectedGenres, genreLabelToId]);

    // Q-kood → praeguse keele label (tüüp)
    const typeIdMap = useMemo(() => {
        const map: Record<string, string> = {};
        const lang = getLangCode(i18n.language);
        if (!results?.hits) return map;
        for (const hit of results.hits) {
            const obj = (hit as any).type_object;
            if (!obj) continue;
            const items = Array.isArray(obj) ? obj : [obj];
            for (const item of items) {
                if (!item?.labels) continue;
                const currentLabel = cap((item.id && enrichedLabels[item.id]?.[lang]) || item.labels[lang] || item.labels['et'] || item.label);
                if (item.id) map[item.id] = currentLabel;
                for (const labelVal of Object.values(item.labels)) {
                    if (labelVal) { map[labelVal as string] = currentLabel; map[cap(labelVal as string)] = currentLabel; }
                }
                if (item.label) { map[item.label] = currentLabel; map[cap(item.label)] = currentLabel; }
            }
        }
        return map;
    }, [results, i18n.language, enrichedLabels]);

    // Label → Q-kood (URL-i jaoks, tüüp)
    const typeLabelToId = useMemo(() => {
        const map: Record<string, string> = {};
        const lang = getLangCode(i18n.language);
        if (!results?.hits) return map;
        for (const hit of results.hits) {
            const obj = (hit as any).type_object;
            if (!obj) continue;
            const items = Array.isArray(obj) ? obj : [obj];
            for (const item of items) {
                if (item?.id && item?.labels) {
                    const rawLabel = item.labels[lang] || item.labels['et'] || item.label;
                    map[rawLabel] = item.id; map[cap(rawLabel)] = item.id;
                }
            }
        }
        return map;
    }, [results, i18n.language]);

    // Lae entity labels cache serverist (üks kord sessiooni jooksul)
    useEffect(() => {
        getEntityLabelsCache().then(labels => {
            if (Object.keys(labels).length > 0) setEnrichedLabels(labels);
        });
    }, []);

    // Normaliseeri tüübid Q-koodideks — label URL-ist → Q-kood, Q-kood jääb
    useEffect(() => {
        if (selectedTypes.length === 0) return;
        const isQ = (s: string) => /^Q\d+$/.test(s);
        let changed = false;
        const resolved = selectedTypes.map(t => {
            if (isQ(t)) return t;
            const qCode = typeLabelToId[t] || typeLabelToId[cap(t)];
            if (qCode) { changed = true; return qCode; }
            return t;
        });
        if (changed) {
            setSelectedTypes(resolved);
            const newParams = new URLSearchParams(searchParams);
            newParams.set('type', resolved.join(','));
            setSearchParams(newParams, { replace: true });
        }
    }, [selectedTypes, typeLabelToId]);

    // Q-kood → praeguse keele label (märksõnad)
    const tagsIdMap = useMemo(() => {
        const map: Record<string, string> = {};
        const lang = getLangCode(i18n.language);
        if (!results?.hits) return map;
        for (const hit of results.hits) {
            const objs = (hit as any).tags_object;
            if (!objs || !Array.isArray(objs)) continue;
            for (const item of objs) {
                if (!item?.labels) continue;
                const currentLabel = cap(item.labels[lang] || item.labels['et'] || item.label);
                if (item.id) map[item.id] = currentLabel;
                for (const labelVal of Object.values(item.labels)) {
                    if (labelVal) { map[labelVal as string] = currentLabel; map[cap(labelVal as string)] = currentLabel; }
                }
                if (item.label) { map[item.label] = currentLabel; map[cap(item.label)] = currentLabel; }
            }
        }
        return map;
    }, [results, i18n.language]);

    // Q-kood → praeguse keele label (lehekülje märksõnad, page_tags_object põhjal)
    const pageTagsIdMap = useMemo(() => {
        const map: Record<string, string> = {};
        const lang = getLangCode(i18n.language);
        if (!results?.hits) return map;
        for (const hit of results.hits) {
            const objs = (hit as any).page_tags_object;
            if (!objs || !Array.isArray(objs)) continue;
            for (const item of objs) {
                if (!item?.id || !item?.labels) continue;
                const label = item.labels[lang] || item.labels['et'] || item.label || item.id;
                map[item.id] = cap(label);
            }
        }
        return map;
    }, [results, i18n.language]);

    // Kogu teadaolevaid labeleid — säilib ka tühjade tulemuste korral
    useEffect(() => {
        if (Object.keys(pageTagsIdMap).length > 0) {
            setKnownPageTagsLabels(prev => ({ ...prev, ...pageTagsIdMap }));
        }
    }, [pageTagsIdMap]);

    // Label → Q-kood (URL-i jaoks, märksõnad)
    const tagsLabelToId = useMemo(() => {
        const map: Record<string, string> = {};
        const lang = getLangCode(i18n.language);
        if (!results?.hits) return map;
        for (const hit of results.hits) {
            const objs = (hit as any).tags_object;
            if (!objs || !Array.isArray(objs)) continue;
            for (const item of objs) {
                if (item?.id && item?.labels) {
                    const rawLabel = item.labels[lang] || item.labels['et'] || item.label;
                    map[rawLabel] = item.id; map[cap(rawLabel)] = item.id;
                }
            }
        }
        return map;
    }, [results, i18n.language]);

    // Normaliseeri märksõnad Q-koodideks — label URL-ist → Q-kood, Q-kood jääb
    useEffect(() => {
        if (selectedTeoseTags.length === 0) return;
        const isQ = (s: string) => /^Q\d+$/.test(s);
        let changed = false;
        const resolved = selectedTeoseTags.map(tag => {
            if (isQ(tag)) return tag;
            const qCode = tagsLabelToId[tag] || tagsLabelToId[cap(tag)];
            if (qCode) { changed = true; return qCode; }
            return tag;
        });
        if (changed) {
            setSelectedTeoseTags(resolved);
            const newParams = new URLSearchParams(searchParams);
            newParams.set('teoseTags', resolved.join(','));
            setSearchParams(newParams, { replace: true });
        }
    }, [selectedTeoseTags, tagsLabelToId]);

    // Laadi teose info kui tullakse work-filter-iga (nt Workspace'ist)
    useEffect(() => {
        if (workIdParam && !selectedWorkInfo) {
            getWorkMetadata(workIdParam).then(work => {
                if (work) {
                    let author = (work as any).author || '';
                    if (work.creators?.length > 0) {
                        const praeses = work.creators.find((c: any) => c.role === 'praeses');
                        if (praeses) author = praeses.name;
                    }
                    setSelectedWorkInfo({ title: work.title, year: work.year || undefined, author });
                }
            });
        } else if (!workIdParam) {
            setSelectedWorkInfo(null);
        }
    }, [workIdParam]);

    // Otsimine URL parameetrite muutumisel
    useEffect(() => {
        const relevantParams = ['q', 'ys', 'ye', 'scope', 'work', 'teoseTags', 'pageTags', 'genre', 'type', 'author'];
        if (relevantParams.some(key => searchParams.has(key))) {
            const options: ContentSearchOptions = {
                yearStart: yearStartParam,
                yearEnd: yearEndParam,
                scope: scopeParam,
                workId: workIdParam || undefined,
                teoseTags: teoseTagsParam.length > 0 ? teoseTagsParam : undefined,
                pageTags: pageTagsParam.length > 0 ? pageTagsParam : undefined,
                genre: genreParam.length > 0 ? genreParam : undefined,
                type: typeParam.length > 0 ? typeParam : undefined,
                author: authorParam || undefined,
                collection: selectedCollection || undefined,
                lang: getLangCode(i18n.language)
            };
            performSearch(queryParam, pageParam, options);
        } else {
            setResults(null);
        }
    }, [searchParams, queryParam, pageParam, workIdParam, yearStartParam, yearEndParam, scopeParam,
        teoseTagsParam.join(','), pageTagsParam.join(','), genreParam.join(','), typeParam.join(','), authorParam, selectedCollection, i18n.language]);

    const performSearch = async (searchQuery: string, page: number, options: ContentSearchOptions) => {
        setLoading(true);
        setError(null);
        try {
            const data = await searchContent(searchQuery, page, options);
            setResults(data);
            if (data.facetDistribution) {
                const lang = options.lang || 'et';
                const processFacets = (field: string) => {
                    let dist = data.facetDistribution?.[field];
                    if (!dist && field.includes('_')) dist = data.facetDistribution?.[field.split('_')[0]];
                    return Object.entries(dist || {})
                        .map(([value, count]) => ({ value, count: count as number }))
                        .sort((a, b) => b.count - a.count);
                };
                const newGenres = processFacets(`genre_${lang}`);
                const newTypes = processFacets(`type_${lang}`);
                const newTags = processFacets(`tags_${lang}`).map(t => ({ tag: t.value, count: t.count }));
                const newAuthors = processFacets('author_names');
                setAvailableTeoseTags(prev => mergeTagsWithExisting(prev, newTags, selectedTeoseTags));
                setAvailableGenres(prev => mergeFacetsWithExisting(prev, newGenres, selectedGenres));
                setAvailableTypes(prev => mergeFacetsWithExisting(prev, newTypes, selectedTypes));
                setAvailableAuthors(newAuthors);
            }
        } catch (e: any) {
            console.error(e);
            setError(e.message || t('status.connectionError'));
        } finally {
            setLoading(false);
        }
    };

    // =========================================================
    // CALLBACK-ID SearchFilters-ile
    // =========================================================

    const handleSearch = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const hasFilters = yearStart || yearEnd ||
            selectedScope !== 'all' || selectedWork || selectedTeoseTags.length > 0 ||
            selectedPageTags.length > 0 || selectedGenres.length > 0 || selectedTypes.length > 0 || selectedAuthor;

        setSearchParams(prev => {
            if (!inputValue.trim() && !hasFilters) {
                ['q', 'p', 'ys', 'ye', 'scope', 'work', 'teoseTags', 'pageTags', 'genre', 'type', 'author'].forEach(k => prev.delete(k));
            } else {
                if (inputValue.trim()) prev.set('q', inputValue); else prev.delete('q');
                prev.set('p', '1');
                if (yearStart) prev.set('ys', yearStart); else prev.delete('ys');
                if (yearEnd) prev.set('ye', yearEnd); else prev.delete('ye');
                if (selectedScope !== 'all') prev.set('scope', selectedScope); else prev.delete('scope');
                if (selectedWork) prev.set('work', selectedWork); else prev.delete('work');
                if (selectedTeoseTags.length > 0) prev.set('teoseTags', selectedTeoseTags.map(t => tagsLabelToId[t] || t).join(',')); else prev.delete('teoseTags');
                if (selectedPageTags.length > 0) prev.set('pageTags', selectedPageTags.join(',')); else prev.delete('pageTags');
                if (selectedGenres.length > 0) prev.set('genre', selectedGenres.map(g => genreLabelToId[g] || g).join(',')); else prev.delete('genre');
                if (selectedTypes.length > 0) prev.set('type', selectedTypes.map(t => typeLabelToId[t] || t).join(',')); else prev.delete('type');
                if (selectedAuthor) prev.set('author', selectedAuthor); else prev.delete('author');
            }
            return prev;
        });
        setShowFiltersMobile(false);
    };

    const handleClearFilters = () => {
        setYearStart(''); setYearEnd(''); setSelectedScope('all');
        setSelectedWork(''); setSelectedWorkInfo(null);
        setSelectedTeoseTags([]); setSelectedPageTags([]); setSelectedGenres([]); setSelectedTypes([]);
        setSelectedAuthor(''); setAuthorInput('');
        setSearchParams(prev => {
            ['ys', 'ye', 'scope', 'work', 'teoseTags', 'pageTags', 'genre', 'type', 'author'].forEach(k => prev.delete(k));
            prev.set('p', '1');
            return prev;
        });
    };

    const handleAuthorSelect = (author: string) => {
        setAuthorInput(author);
        setSelectedAuthor(author);
        setShowAuthorSuggestions(false);
        setSearchParams(prev => { prev.set('author', author); prev.set('p', '1'); return prev; });
    };

    const handleAuthorClear = () => {
        setSelectedAuthor(''); setAuthorInput(''); setInputValue('');
        setSearchParams(prev => { prev.delete('author'); prev.delete('q'); prev.set('p', '1'); return prev; });
    };

    const handleWorkSelect = (id: string, info: { title: string; year?: string | number; author?: string } | null) => {
        setSelectedWork(id);
        setSelectedWorkInfo(info);
    };

    // =========================================================
    // CALLBACK-ID SearchResults-ile
    // =========================================================

    const handleAuthorFilter = (authorName: string) => {
        setSelectedAuthor(authorName);
        setAuthorInput(authorName);
        setSearchParams(prev => { prev.set('author', authorName); prev.set('p', '1'); return prev; });
    };

    const handleYearFilter = (year: string) => {
        setYearStart(year);
        setYearEnd(year);
        setSearchParams(prev => { prev.set('ys', year); prev.set('ye', year); prev.set('p', '1'); return prev; });
    };

    const handleSearchInWork = (workId: string, info: { title: string; year?: string | number; author?: string }) => {
        setSelectedWork(workId);
        setSelectedWorkInfo(info);
        setSearchParams(prev => { prev.set('work', workId); prev.set('p', '1'); return prev; });
    };

    const handlePageChange = (newPage: number) => {
        setSearchParams(prev => { prev.set('p', newPage.toString()); return prev; });
    };

    // Arvuta availableWorks (kasutab SearchFilters)
    const workHitCounts = results?.facetDistribution?.['work_id'] || {};
    const uniqueWorkIds = new Set(results?.hits?.map(h => h.work_id) || []);
    const availableWorks = (results?.hits && !workIdParam && !loading && uniqueWorkIds.size > 1)
        ? results.hits.map(hit => ({
            id: hit.work_id,
            title: hit.title || hit.work_id,
            year: typeof hit.year === 'number' ? hit.year : undefined,
            author: (() => { const a = (hit as any).autor; return Array.isArray(a) ? a[0] : a; })(),
            count: workHitCounts[hit.work_id] || 1
        }))
        : [];

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
                                    type="text"
                                    placeholder={t('form.searchPlaceholder')}
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    className={`w-full pl-12 py-3 rounded-lg border border-gray-300 shadow-sm focus:ring-2 focus:ring-primary-100 focus:border-primary-500 outline-none text-lg ${inputValue ? 'pr-10' : 'pr-4'}`}
                                    autoFocus
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
                            <button type="submit" className="bg-primary-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-primary-700 transition-colors shadow-sm">
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

                        {/* Aktiivsed filtrid otsinguriba all */}
                        {(selectedAuthor || selectedWork || selectedCollection || scopeParam !== 'all' ||
                            pageTagsParam.length > 0 || genreParam.length > 0 || typeParam.length > 0 ||
                            teoseTagsParam.length > 0 || yearStartParam !== undefined || yearEndParam !== undefined) && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-3">
                                {/* Ajavahemik */}
                                {(yearStartParam !== undefined || yearEndParam !== undefined) && (
                                    <div className="flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs font-medium border border-slate-200">
                                        <Calendar size={11} />
                                        <span>{yearStartParam ?? ''}–{yearEndParam ?? ''}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setYearStart(''); setYearEnd('');
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
                                {scopeParam !== 'all' && (
                                    <div className="flex items-center gap-1 px-2 py-0.5 bg-orange-50 text-orange-700 rounded-full text-xs font-medium border border-orange-200">
                                        <Layers size={11} />
                                        <span>{t(`filters.scope${scopeParam.charAt(0).toUpperCase() + scopeParam.slice(1)}`)}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedScope('all');
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
                                {genreParam.map(g => (
                                    <div key={g} className="flex items-center gap-1 px-2 py-0.5 bg-violet-50 text-violet-700 rounded-full text-xs font-medium border border-violet-200">
                                        <BookOpen size={11} />
                                        <span>{resolveLabel(g, genreIdMap)}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const next = genreParam.filter(x => x !== g);
                                                setSelectedGenres(next);
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
                                {typeParam.map(tp => (
                                    <div key={tp} className="flex items-center gap-1 px-2 py-0.5 bg-sky-50 text-sky-700 rounded-full text-xs font-medium border border-sky-200">
                                        <FileType size={11} />
                                        <span>{resolveLabel(tp, typeIdMap)}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const next = typeParam.filter(x => x !== tp);
                                                setSelectedTypes(next);
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
                                {teoseTagsParam.map(tag => (
                                    <div key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium border border-emerald-200">
                                        <Tag size={11} />
                                        <span>{resolveLabel(tag, tagsIdMap)}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const next = teoseTagsParam.filter(t => t !== tag);
                                                setSelectedTeoseTags(next);
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
                                {pageTagsParam.map(tag => (
                                    <div key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-teal-50 text-teal-700 rounded-full text-xs font-medium border border-teal-200">
                                        <Tag size={11} />
                                        <span>{knownPageTagsLabels[tag] || pageTagsIdMap[tag] || tag}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const next = pageTagsParam.filter(t => t !== tag);
                                                setSelectedPageTags(next);
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
                                {selectedWork && (
                                    <div className="flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full text-xs font-medium border border-amber-200">
                                        <FileText size={11} />
                                        <span className="truncate max-w-xs">{selectedWorkInfo?.title || selectedWork}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedWork(''); setSelectedWorkInfo(null);
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
                                {selectedAuthor && (
                                    <div className="flex items-center gap-1 px-2 py-0.5 bg-primary-50 text-primary-700 rounded-full text-xs font-medium border border-primary-200">
                                        <User size={11} />
                                        <span className="truncate max-w-xs">{selectedAuthor}</span>
                                        <button
                                            type="button"
                                            onClick={handleAuthorClear}
                                            className="ml-0.5 hover:bg-primary-100 rounded-full p-0.5"
                                            title={t('filters.removeAuthorFilter')}
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
                                            <span className="truncate max-w-xs">{getCollectionName(selectedCollection)}</span>
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
                    selectedScope={selectedScope}
                    yearStart={yearStart}
                    yearEnd={yearEnd}
                    selectedGenres={selectedGenres}
                    selectedTypes={selectedTypes}
                    selectedTeoseTags={selectedTeoseTags}
                    selectedAuthor={selectedAuthor}
                    authorInput={authorInput}
                    showAuthorSuggestions={showAuthorSuggestions}
                    selectedWork={selectedWork}
                    selectedWorkInfo={selectedWorkInfo}
                    showFiltersMobile={showFiltersMobile}
                    availableGenres={availableGenres}
                    availableTypes={availableTypes}
                    availableTeoseTags={availableTeoseTags}
                    availableAuthors={availableAuthors}
                    availableWorks={availableWorks}
                    vocabularies={vocabularies}
                    aliasMap={aliasMap}
                    enrichedLabels={enrichedLabels}
                    genreIdMap={genreIdMap}
                    genreLabelToId={genreLabelToId}
                    typeIdMap={typeIdMap}
                    typeLabelToId={typeLabelToId}
                    tagsIdMap={tagsIdMap}
                    tagsLabelToId={tagsLabelToId}
                    loading={loading}
                    onScopeChange={setSelectedScope}
                    onYearStartChange={setYearStart}
                    onYearEndChange={setYearEnd}
                    onGenreToggle={(v) => {
                        // Normaliseri Q-koodiks kohe — hoiab ära Q-kood+label topelt lisamise
                        const key = /^Q\d+$/.test(v) ? v : (genreLabelToId[v] || genreLabelToId[v[0]?.toUpperCase() + v.slice(1)] || v);
                        setSelectedGenres(prev => prev.includes(key) ? prev.filter(g => g !== key) : [...prev, key]);
                    }}
                    onTypeToggle={(v) => {
                        const key = /^Q\d+$/.test(v) ? v : (typeLabelToId[v] || typeLabelToId[v[0]?.toUpperCase() + v.slice(1)] || v);
                        setSelectedTypes(prev => prev.includes(key) ? prev.filter(t => t !== key) : [...prev, key]);
                    }}
                    onTagToggle={(v) => {
                        const key = /^Q\d+$/.test(v) ? v : (tagsLabelToId[v] || tagsLabelToId[v[0]?.toUpperCase() + v.slice(1)] || v);
                        setSelectedTeoseTags(prev => prev.includes(key) ? prev.filter(t => t !== key) : [...prev, key]);
                    }}
                    onAuthorInputChange={setAuthorInput}
                    onShowAuthorSuggestions={setShowAuthorSuggestions}
                    onAuthorSelect={handleAuthorSelect}
                    onAuthorClear={handleAuthorClear}
                    onWorkSelect={handleWorkSelect}
                    onSetMobileFilters={setShowFiltersMobile}
                    onSearch={handleSearch}
                    onClearFilters={handleClearFilters}
                />
                <SearchResults
                    results={results}
                    loading={loading}
                    error={error}
                    queryParam={queryParam}
                    workIdParam={workIdParam}
                    yearStartParam={yearStartParam}
                    yearEndParam={yearEndParam}
                    scopeParam={scopeParam}
                    vocabularies={vocabularies}
                    onAuthorFilter={handleAuthorFilter}
                    onYearFilter={handleYearFilter}
                    onSearchInWork={handleSearchInWork}
                    onPageChange={handlePageChange}
                />
            </div>
        </div>
    );
};

export default SearchPage;
