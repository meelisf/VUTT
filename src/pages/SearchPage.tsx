
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { searchContent, searchWorkHits, getWorkMetadata, getTeoseTagsFacets, getGenreFacets, getTypeFacets, getAuthorFacets } from '../services/meiliService';
import { getVocabularies, Vocabularies, getCollectionColorClasses } from '../services/collectionService';
import { ContentSearchHit, ContentSearchResponse, ContentSearchOptions, Annotation } from '../types';
import { Search, Loader2, AlertTriangle, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Filter, Calendar, Layers, Tag, MessageSquare, FileText, BookOpen, Library, FileType, User, X, FolderOpen, Bookmark } from 'lucide-react';
import { IMAGE_BASE_URL, FILE_API_URL } from '../config';
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

// Abifunktsioon autori nime leidmiseks
const getAuthorDisplay = (hit: ContentSearchHit, t: any): string => {
    // 1. Proovi leida creators massiivist
    if (hit.creators && hit.creators.length > 0) {
        // Prioriteet: praeses > auctor > esimene
        const praeses = hit.creators.find(c => c.role === 'praeses');
        if (praeses) return praeses.name;
        
        const auctor = hit.creators.find(c => c.role === 'auctor');
        if (auctor) return auctor.name;
        
        return hit.creators[0].name;
    }
    
    // 2. Fallback vana 'autor' väli
    if (hit.autor) {
        return Array.isArray(hit.autor) ? hit.autor[0] : hit.autor;
    }
    
    return t('status.unknown');
};

// Abifunktsioon: lisa valitud väärtused facetite nimekirja (count=0 kui pole tulemusi)
// Merge uued facetid olemasolevate hulka, säilitades kõik valikud
// - Uuendab olemasolevate countid
// - Lisab uued valikud
// - Säilitab vanad valikud (count=0 kui pole uutes)
const mergeFacetsWithExisting = (
    existing: { value: string; count: number }[],
    newFacets: { value: string; count: number }[],
    selected: string[]
): { value: string; count: number }[] => {
    const newMap = new Map(newFacets.map(f => [f.value, f.count]));
    const result: { value: string; count: number }[] = [];
    const seen = new Set<string>();

    // Uuenda olemasolevate countid
    for (const item of existing) {
        if (!item.value) continue;
        const count = newMap.get(item.value) ?? 0;
        result.push({ value: item.value, count });
        seen.add(item.value);
    }

    // Lisa uued valikud mida varem polnud
    for (const item of newFacets) {
        if (item.value && !seen.has(item.value)) {
            result.push(item);
            seen.add(item.value);
        }
    }

    // Lisa valitud valikud kui neid pole
    for (const sel of selected) {
        if (sel && !seen.has(sel)) {
            result.push({ value: sel, count: 0 });
        }
    }

    return result.sort((a, b) => b.count - a.count);
};

// Sama loogika teoseTags jaoks (erinev struktuur: tag vs value)
const mergeTagsWithExisting = (
    existing: { tag: string; count: number }[],
    newTags: { tag: string; count: number }[],
    selected: string[]
): { tag: string; count: number }[] => {
    const newMap = new Map(newTags.map(t => [t.tag, t.count]));
    const result: { tag: string; count: number }[] = [];
    const seen = new Set<string>();

    for (const item of existing) {
        if (!item.tag) continue;
        const count = newMap.get(item.tag) ?? 0;
        result.push({ tag: item.tag, count });
        seen.add(item.tag);
    }

    for (const item of newTags) {
        if (item.tag && !seen.has(item.tag)) {
            result.push(item);
            seen.add(item.tag);
        }
    }

    for (const sel of selected) {
        if (sel && !seen.has(sel)) {
            result.push({ tag: sel, count: 0 });
        }
    }

    return result.sort((a, b) => b.count - a.count);
};

// Lihtne merge valitud väärtuste lisamiseks (initial load jaoks)
const mergeSelectedIntoFacets = (
    facets: { value: string; count: number }[],
    selected: string[]
): { value: string; count: number }[] => {
    const existing = new Set(facets.map(f => f.value));
    const merged = [...facets];
    for (const sel of selected) {
        if (sel && !existing.has(sel)) {
            merged.push({ value: sel, count: 0 });
        }
    }
    return merged;
};

const mergeSelectedIntoTags = (
    tags: { tag: string; count: number }[],
    selected: string[]
): { tag: string; count: number }[] => {
    const existing = new Set(tags.map(t => t.tag));
    const merged = [...tags];
    for (const sel of selected) {
        if (sel && !existing.has(sel)) {
            merged.push({ tag: sel, count: 0 });
        }
    }
    return merged;
};

// Abikomponent otsitava ja keritava filtri loendi jaoks
const SearchableFilterList: React.FC<{
    items: { value: string; label: string; count: number }[];
    selectedValues: string[];
    onToggle: (value: string) => void;
    placeholder: string;
    maxHeight?: string;
    isRadio?: boolean;
    renderItem?: (item: { value: string; label: string; count: number }, isSelected: boolean) => React.ReactNode;
}> = ({ items, selectedValues, onToggle, placeholder, maxHeight = 'max-h-60', isRadio = false, renderItem }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const showSearch = items.length > 10;

    const filteredItems = useMemo(() => {
        if (!searchQuery) return items;
        const lowerQuery = searchQuery.toLowerCase();
        return items.filter(item => 
            item.label.toLowerCase().includes(lowerQuery)
        );
    }, [items, searchQuery]);

    return (
        <div className="space-y-2">
            {showSearch && (
                <div className="relative mb-2">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={placeholder}
                        className="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 bg-gray-50/50"
                    />
                </div>
            )}
            <div className={`space-y-1 overflow-y-scroll custom-scrollbar pr-1 ${showSearch ? 'h-60' : ''}`}>
                {filteredItems.length === 0 ? (
                    <div className="text-xs text-gray-400 italic py-2 px-1">Ei leitud vasteid</div>
                ) : (
                    filteredItems.map((item) => {
                        const isSelected = selectedValues.includes(item.value);
                        
                        if (renderItem) return renderItem(item, isSelected);

                        return (
                            <label key={item.value} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded group">
                                <input
                                    type={isRadio ? "radio" : "checkbox"}
                                    checked={isSelected}
                                    onChange={() => onToggle(item.value)}
                                    className="text-primary-600 focus:ring-primary-500 rounded"
                                />
                                <span className={`text-sm flex-1 truncate ${isSelected ? 'text-primary-700 font-medium' : 'text-gray-700'}`}>
                                    {item.label}
                                </span>
                                <span className="text-xs text-gray-400 group-hover:text-gray-600">({item.count})</span>
                            </label>
                        );
                    })
                )}
            </div>
        </div>
    );
};

const SearchPage: React.FC = () => {
    const { t, i18n } = useTranslation(['search', 'common']);
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { selectedCollection, getCollectionName, collections } = useCollection();

    // URL params control the actual search
    const queryParam = searchParams.get('q') || '';
    const pageParam = parseInt(searchParams.get('p') || '1', 10);
    const workIdParam = searchParams.get('work') || ''; // Teose piires otsing

    // Filter params from URL
    const yearStartParam = searchParams.get('ys') ? parseInt(searchParams.get('ys')!) : undefined;
    const yearEndParam = searchParams.get('ye') ? parseInt(searchParams.get('ye')!) : undefined;
    const scopeParam = (searchParams.get('scope') as 'all' | 'original' | 'annotation') || 'all';
    const teoseTagsParam = searchParams.get('teoseTags')?.split(',').filter(Boolean) || [];
    const genreParam = searchParams.get('genre')?.split(',').filter(Boolean) || [];
    const typeParam = searchParams.get('type')?.split(',').filter(Boolean) || [];
    const authorParam = searchParams.get('author') || '';

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

    // Žanri filter (genre väli) - mitu valikut lubatud
    const [availableGenres, setAvailableGenres] = useState<{ value: string; count: number }[]>([]);
    const [selectedGenres, setSelectedGenres] = useState<string[]>(genreParam);

    // Tüübi filter (type väli) - mitu valikut lubatud
    const [availableTypes, setAvailableTypes] = useState<{ value: string; count: number }[]>([]);
    const [selectedTypes, setSelectedTypes] = useState<string[]>(typeParam);

    // Autori filter
    const [selectedAuthor, setSelectedAuthor] = useState<string>(authorParam);
    const [authorInput, setAuthorInput] = useState<string>(authorParam);
    const [availableAuthors, setAvailableAuthors] = useState<{ value: string; count: number }[]>([]);
    const [showAuthorSuggestions, setShowAuthorSuggestions] = useState(false);
    const authorInputRef = useRef<HTMLInputElement>(null);
    const [aliasMap, setAliasMap] = useState<Record<string, string>>({});

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

    // Laadi filtrite andmed alguses ja uuenda kui aasta vahemik muutub
    useEffect(() => {
        const loadFilterData = async () => {
            try {
                // Sõnavarad ja aliased laeme alati
                const [vocabs, aliasRes] = await Promise.all([
                    getVocabularies(),
                    fetch(`${FILE_API_URL}/people-aliases`).then(r => r.ok ? r.json() : null).catch(() => null)
                ]);
                setVocabularies(vocabs);
                if (aliasRes?.status === 'success' && aliasRes.aliases) {
                    setAliasMap(aliasRes.aliases);
                }

                // Kontrolli, kas on aktiivseid sisufiltreid (v.a. aasta ja kollektsioon)
                // Kui on filtrid, siis performSearch hoolitseb facetite eest ja me ei taha neid üle kirjutada
                const hasActiveContentFilters = !!queryParam || !!workIdParam || !!authorParam || 
                                              teoseTagsParam.length > 0 || genreParam.length > 0 || typeParam.length > 0;

                if (hasActiveContentFilters) {
                    return;
                }

                const facetLang = i18n.language.split('-')[0];
                const [tags, genres, types, authors] = await Promise.all([
                    getTeoseTagsFacets(selectedCollection || undefined, facetLang, yearStartParam, yearEndParam),
                    getGenreFacets(selectedCollection || undefined, facetLang, yearStartParam, yearEndParam),
                    getTypeFacets(selectedCollection || undefined, facetLang, yearStartParam, yearEndParam),
                    getAuthorFacets(selectedCollection || undefined, yearStartParam, yearEndParam)
                ]);
                
                // Lisa valitud filtrid nimekirja isegi kui count=0 (UX)
                const tagsWithSelected = mergeSelectedIntoTags(tags, teoseTagsParam);
                const genresWithSelected = mergeSelectedIntoFacets(genres, genreParam);
                const typesWithSelected = mergeSelectedIntoFacets(types, typeParam);
                
                setAvailableTeoseTags(tagsWithSelected);
                setAvailableGenres(genresWithSelected);
                setAvailableTypes(typesWithSelected);
                setAvailableAuthors(authors);
            } catch (e) {
                console.warn('Filtrite andmete laadimine ebaõnnestus:', e);
            }
        };
        loadFilterData();
    }, [selectedCollection, i18n.language, yearStartParam, yearEndParam, queryParam, workIdParam, authorParam, teoseTagsParam.length, genreParam.length, typeParam.length]);

    // Sync local input with URL param when URL changes (e.g. back button)
    useEffect(() => {
        setInputValue(queryParam);
        if (scopeParam) setSelectedScope(scopeParam);
        setSelectedWork(workIdParam);
        setSelectedTeoseTags(teoseTagsParam);
        setSelectedGenres(genreParam);
        setSelectedTypes(typeParam);
        setSelectedAuthor(authorParam);
        setAuthorInput(authorParam);
    }, [queryParam, scopeParam, workIdParam, teoseTagsParam.join(','), genreParam.join(','), typeParam.join(','), authorParam]);

    // Abifunktsioon: esimene täht suureks (ühtib Meilisearchi facet labelitega)
    const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : '';

    // Lahenduskaart: Q-kood VÕI teise keele label → praeguse keele label (žanrid)
    const genreIdMap = useMemo(() => {
      const map: Record<string, string> = {};
      const lang = i18n.language.split('-')[0];
      if (results?.hits) {
        for (const hit of results.hits) {
          const obj = (hit as any).genre_object;
          if (!obj) continue;
          const items = Array.isArray(obj) ? obj : [obj];
          for (const item of items) {
            if (!item?.labels) continue;
            const rawLabel = item.labels[lang] || item.labels['et'] || item.label;
            const currentLabel = cap(rawLabel);
            if (item.id) map[item.id] = currentLabel;
            for (const labelVal of Object.values(item.labels)) {
              if (labelVal) {
                map[labelVal as string] = currentLabel;
                map[cap(labelVal as string)] = currentLabel;
              }
            }
            if (item.label) {
              map[item.label] = currentLabel;
              map[cap(item.label)] = currentLabel;
            }
          }
        }
      }
      return map;
    }, [results, i18n.language]);

    // Pöördkaart: praeguse keele label → Q-kood (URL-i jaoks)
    const genreLabelToId = useMemo(() => {
      const map: Record<string, string> = {};
      const lang = i18n.language.split('-')[0];
      if (results?.hits) {
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
      }
      return map;
    }, [results, i18n.language]);

    // Q-koodi lahendamine: kui URL-is on Q-kood, teisenda see labeliks (filtrite kuvamiseks)
    useEffect(() => {
      if (selectedGenres.length === 0 || Object.keys(genreIdMap).length === 0) return;
      const availableValues = new Set(availableGenres.map(g => g.value));
      let changed = false;
      const resolved = selectedGenres.map(g => {
        if (availableValues.has(g)) return g;
        // Q-kood → label
        if (genreIdMap[g]) { changed = true; return genreIdMap[g]; }
        // Vocabulary-põhine tõlge
        if (vocabularies?.genres) {
          const lang = i18n.language.split('-')[0];
          const altLang = lang === 'et' ? 'en' : 'et';
          for (const [, labels] of Object.entries(vocabularies.genres)) {
            if (labels[altLang] === g) {
              const curLabel = labels[lang] || labels['et'];
              if (curLabel) { changed = true; return curLabel; }
            }
          }
        }
        return g;
      });
      if (changed) {
        setSelectedGenres(resolved);
        // URL-i uuendame Q-koodidega (mitte labelitega)
        const urlGenres = resolved.map(g => genreLabelToId[g] || g);
        const newParams = new URLSearchParams(searchParams);
        newParams.set('genre', urlGenres.join(','));
        setSearchParams(newParams, { replace: true });
      }
    }, [selectedGenres, availableGenres, genreIdMap, vocabularies, i18n.language]);

    // Lahenduskaart: Q-kood VÕI teise keele label → praeguse keele label (tüüp)
    const typeIdMap = useMemo(() => {
      const map: Record<string, string> = {};
      const lang = i18n.language.split('-')[0];
      if (results?.hits) {
        for (const hit of results.hits) {
          const obj = (hit as any).type_object;
          if (!obj) continue;
          const items = Array.isArray(obj) ? obj : [obj];
          for (const item of items) {
            if (!item?.labels) continue;
            const rawLabel = item.labels[lang] || item.labels['et'] || item.label;
            const currentLabel = cap(rawLabel);
            if (item.id) map[item.id] = currentLabel;
            for (const labelVal of Object.values(item.labels)) {
              if (labelVal) {
                map[labelVal as string] = currentLabel;
                map[cap(labelVal as string)] = currentLabel;
              }
            }
            if (item.label) {
              map[item.label] = currentLabel;
              map[cap(item.label)] = currentLabel;
            }
          }
        }
      }
      return map;
    }, [results, i18n.language]);

    // Pöördkaart: praeguse keele label → Q-kood (URL-i jaoks, tüüp)
    const typeLabelToId = useMemo(() => {
      const map: Record<string, string> = {};
      const lang = i18n.language.split('-')[0];
      if (results?.hits) {
        for (const hit of results.hits) {
          const obj = (hit as any).type_object;
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
      }
      return map;
    }, [results, i18n.language]);

    // Tüübi keelteülene tõlge (Q-koodi-põhine, nagu žanril)
    useEffect(() => {
      if (selectedTypes.length === 0 || Object.keys(typeIdMap).length === 0) return;
      const availableValues = new Set(availableTypes.map(t => t.value));
      let changed = false;
      const resolved = selectedTypes.map(t => {
        if (availableValues.has(t)) return t;
        // Q-kood → label
        if (typeIdMap[t]) { changed = true; return typeIdMap[t]; }
        // Vocabulary-põhine fallback
        if (vocabularies?.types) {
          const lang = i18n.language.split('-')[0];
          const altLang = lang === 'et' ? 'en' : 'et';
          for (const [, labels] of Object.entries(vocabularies.types)) {
            if (labels[altLang] === t) {
              const curLabel = labels[lang] || labels['et'];
              if (curLabel) { changed = true; return curLabel; }
            }
          }
        }
        return t;
      });
      if (changed) {
        setSelectedTypes(resolved);
        // URL-i uuendame Q-koodidega (mitte labelitega)
        const urlTypes = resolved.map(t => typeLabelToId[t] || t);
        const newParams = new URLSearchParams(searchParams);
        newParams.set('type', urlTypes.join(','));
        setSearchParams(newParams, { replace: true });
      }
    }, [selectedTypes, availableTypes, typeIdMap, vocabularies, i18n.language]);

    // Lahenduskaart: Q-kood VÕI teise keele label → praeguse keele label (märksõnad)
    const tagsIdMap = useMemo(() => {
      const map: Record<string, string> = {};
      const lang = i18n.language.split('-')[0];
      if (results?.hits) {
        for (const hit of results.hits) {
          const objs = (hit as any).tags_object;
          if (!objs || !Array.isArray(objs)) continue;
          for (const item of objs) {
            if (!item?.labels) continue;
            const rawLabel = item.labels[lang] || item.labels['et'] || item.label;
            const currentLabel = cap(rawLabel);
            if (item.id) map[item.id] = currentLabel;
            for (const labelVal of Object.values(item.labels)) {
              if (labelVal) {
                map[labelVal as string] = currentLabel;
                map[cap(labelVal as string)] = currentLabel;
              }
            }
            if (item.label) {
              map[item.label] = currentLabel;
              map[cap(item.label)] = currentLabel;
            }
          }
        }
      }
      return map;
    }, [results, i18n.language]);

    // Pöördkaart: praeguse keele label → Q-kood (URL-i jaoks)
    const tagsLabelToId = useMemo(() => {
      const map: Record<string, string> = {};
      const lang = i18n.language.split('-')[0];
      if (results?.hits) {
        for (const hit of results.hits) {
          const objs = (hit as any).tags_object;
          if (!objs || !Array.isArray(objs)) continue;
          for (const item of objs) {
            if (item?.id && item?.labels) {
              const rawLabel = item.labels[lang] || item.labels['et'] || item.label;
              map[rawLabel] = item.id;
              map[cap(rawLabel)] = item.id;
            }
          }
        }
      }
      return map;
    }, [results, i18n.language]);

    // Q-koodi lahendamine märksõnade jaoks
    useEffect(() => {
      if (selectedTeoseTags.length === 0 || Object.keys(tagsIdMap).length === 0) return;
      const availableValues = new Set(availableTeoseTags.map(t => t.tag));
      let changed = false;
      const resolved = selectedTeoseTags.map(tag => {
        if (availableValues.has(tag)) return tag;
        if (tagsIdMap[tag]) { changed = true; return tagsIdMap[tag]; }
        return tag;
      });
      if (changed) {
        setSelectedTeoseTags(resolved);
        const urlTags = resolved.map(t => tagsLabelToId[t] || t);
        const newParams = new URLSearchParams(searchParams);
        newParams.set('teoseTags', urlTags.join(','));
        setSearchParams(newParams, { replace: true });
      }
    }, [selectedTeoseTags, availableTeoseTags, tagsIdMap, i18n.language]);

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

        // Kontrolli kas on filtreid (peale vaikeväärtuste)
        const hasFilters = (yearStart && yearStart !== '1630') ||
                          (yearEnd && yearEnd !== '1710') ||
                          selectedScope !== 'all' ||
                          selectedWork ||
                          selectedTeoseTags.length > 0 ||
                          selectedGenres.length > 0 ||
                          selectedTypes.length > 0 ||
                          selectedAuthor;

        // Update URL params, which triggers the effect below
        setSearchParams(prev => {
            // Kui pole otsingusõna EGA filtreid, tühjenda kõik
            if (!inputValue.trim() && !hasFilters) {
                prev.delete('q');
                prev.delete('p');
                prev.delete('ys');
                prev.delete('ye');
                prev.delete('scope');
                prev.delete('work');
                prev.delete('teoseTags');
                prev.delete('genre');
                prev.delete('type');
                prev.delete('author');
            } else {
                // Seadista otsingusõna (või eemalda kui tühi)
                if (inputValue.trim()) {
                    prev.set('q', inputValue);
                } else {
                    prev.delete('q');
                }
                prev.set('p', '1'); // Reset page

                // Seadista filtrid
                if (yearStart) prev.set('ys', yearStart); else prev.delete('ys');
                if (yearEnd) prev.set('ye', yearEnd); else prev.delete('ye');
                if (selectedScope && selectedScope !== 'all') prev.set('scope', selectedScope); else prev.delete('scope');
                if (selectedWork) prev.set('work', selectedWork); else prev.delete('work');
                if (selectedTeoseTags.length > 0) {
                    const urlTags = selectedTeoseTags.map(t => tagsLabelToId[t] || t);
                    prev.set('teoseTags', urlTags.join(','));
                } else prev.delete('teoseTags');
                if (selectedGenres.length > 0) {
                    // Kasuta Q-koode URL-is kui olemas
                    const urlGenres = selectedGenres.map(g => genreLabelToId[g] || g);
                    prev.set('genre', urlGenres.join(','));
                } else prev.delete('genre');
                if (selectedTypes.length > 0) {
                    const urlTypes = selectedTypes.map(t => typeLabelToId[t] || t);
                    prev.set('type', urlTypes.join(','));
                } else prev.delete('type');
                if (selectedAuthor) prev.set('author', selectedAuthor); else prev.delete('author');
            }
            return prev;
        });

        // On mobile, close filters after search
        setShowFiltersMobile(false);
    };

    // Perform search when URL params change
    useEffect(() => {
        // Kontrolli, kas URL-is on mõni otsinguga seotud parameeter
        // See on töökindlam kui väärtuste kontrollimine
        const relevantParams = ['q', 'ys', 'ye', 'scope', 'work', 'teoseTags', 'genre', 'type', 'author'];
        const hasActiveFilter = relevantParams.some(key => searchParams.has(key));

        if (hasActiveFilter) {
            const options: ContentSearchOptions = {
                yearStart: yearStartParam,
                yearEnd: yearEndParam,
                scope: scopeParam,
                workId: workIdParam || undefined,
                teoseTags: teoseTagsParam.length > 0 ? teoseTagsParam : undefined,
                genre: genreParam.length > 0 ? genreParam : undefined,
                type: typeParam.length > 0 ? typeParam : undefined,
                author: authorParam || undefined,
                collection: selectedCollection || undefined,
                lang: i18n.language.split('-')[0]  // et-EE -> et
            };

            performSearch(queryParam, pageParam, options);
        } else {
            setResults(null);
        }
    }, [searchParams, queryParam, pageParam, workIdParam, yearStartParam, yearEndParam, scopeParam, teoseTagsParam.join(','), genreParam.join(','), typeParam.join(','), authorParam, selectedCollection, i18n.language]);

    const performSearch = async (searchQuery: string, page: number, options: ContentSearchOptions) => {
        setLoading(true);
        setError(null);
        try {
            const data = await searchContent(searchQuery, page, options);
            setResults(data);
            
            // Uuenda filtrite loendeid vastavalt saadud tulemustele (dünaamilised numbrid)
            if (data.facetDistribution) {
                const lang = options.lang || 'et';
                
                // Helper: teisenda jaotus massiiviks
                const processFacets = (field: string) => {
                    let dist = data.facetDistribution?.[field];
                    // Fallback põhiväljale (nt 'genre_et' puudumisel proovi 'genre')
                    if (!dist && field.includes('_')) {
                        const baseField = field.split('_')[0];
                        dist = data.facetDistribution?.[baseField];
                    }
                    dist = dist || {};
                    
                    return Object.entries(dist)
                        .map(([value, count]) => ({ value, count: count as number }))
                        .sort((a, b) => b.count - a.count);
                };

                // Uuenda facette otsingutulemustest, AGA säilita KÕIK varasemad valikud
                const newGenres = processFacets(`genre_${lang}`);
                const newTypes = processFacets(`type_${lang}`);
                const newTags = processFacets(`tags_${lang}`).map(t => ({ tag: t.value, count: t.count }));
                const newAuthors = processFacets('author_names');

                // Merge: säilita olemasolevad valikud + uuenda countid + lisa valitud
                setAvailableTeoseTags(prev => mergeTagsWithExisting(prev, newTags, selectedTeoseTags));
                setAvailableGenres(prev => mergeFacetsWithExisting(prev, newGenres, selectedGenres));
                setAvailableTypes(prev => mergeFacetsWithExisting(prev, newTypes, selectedTypes));
                setAvailableAuthors(newAuthors);
            }

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
        // Iga hit on üks teos (distinct: work_id), hitCount näitab vastete arvu
        return results.hits.reduce((acc, hit) => {
            const key = hit.work_id;
            if (!acc[key]) acc[key] = [];
            acc[key].push(hit);
            return acc;
        }, {} as Record<string, ContentSearchHit[]>);
    };



    // Extract work facets - järjestatud relevantsi järgi (sama järjekord mis otsingutulemustel)
    // NB: Kui juba ollakse teose piires otsingus VÕI laadib VÕI on ainult 1 teos, ei näita teose filtrit
    const workHitCounts = results?.facetDistribution?.['work_id'] || {};
    const uniqueWorkIds = new Set(results?.hits?.map(h => h.work_id) || []);
    const availableWorks = (results?.hits && !workIdParam && !loading && uniqueWorkIds.size > 1)
        ? results.hits.map(hit => ({
            id: hit.work_id,
            title: hit.title || hit.work_id,
            year: hit.year ?? hit.aasta,
            author: Array.isArray(hit.autor) ? hit.autor[0] : hit.autor,
            count: workHitCounts[hit.work_id] || 1
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
            navigate(`/work/${hit.work_id}/${hit.lehekylje_number}`);
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
    const uniqueWorksCount = results?.totalWorks ?? (
        results?.facetDistribution?.['work_id']
        ? Object.keys(results.facetDistribution['work_id']).length
        : Object.keys(groupedResults).length
    );

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

                        {/* Autori filter badge */}
                        {selectedAuthor && (
                            <div className="flex items-center gap-2 mt-3">
                                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-50 text-primary-700 rounded-full text-sm font-medium border border-primary-200">
                                    <User size={14} />
                                    <span className="truncate max-w-xs">{selectedAuthor}</span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedAuthor('');
                                            setAuthorInput('');
                                            setInputValue('');
                                            setSearchParams(prev => {
                                                prev.delete('author');
                                                prev.delete('q');
                                                prev.set('p', '1');
                                                return prev;
                                            });
                                        }}
                                        className="ml-1 hover:bg-primary-100 rounded-full p-0.5"
                                        title={t('filters.removeAuthorFilter')}
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            </div>
                        )}
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
                        {selectedCollection && (() => {
                            const colorClasses = getCollectionColorClasses(collections[selectedCollection]);
                            return (
                                <div className={`${colorClasses.bg} border ${colorClasses.border} rounded-lg p-3 mb-4`}>
                                    <h3 className={`text-xs font-bold ${colorClasses.text} uppercase tracking-wide mb-1 flex items-center gap-2`}>
                                        <Library size={14} /> {t('common:collections.activeFilter')}
                                    </h3>
                                    <p className={`text-sm font-medium ${colorClasses.text}`}>
                                        {getCollectionName(selectedCollection)}
                                    </p>
                                    <p className={`text-xs ${colorClasses.text} opacity-70 mt-1`}>
                                        {t('common:collections.changeInHeader')}
                                    </p>
                                </div>
                            );
                        })()}

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

                        {/* Genre Filter (genre väli - disputatio, oratio jne) - mitu valikut lubatud */}
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
                                        label: vocabularies?.genres?.[value]?.[i18n.language.split('-')[0] as 'et' | 'en'] || vocabularies?.genres?.[value]?.et || value
                                    }))}
                                    selectedValues={selectedGenres}
                                    onToggle={(value) => {
                                        if (selectedGenres.includes(value)) {
                                            setSelectedGenres(selectedGenres.filter(g => g !== value));
                                        } else {
                                            setSelectedGenres([...selectedGenres, value]);
                                        }
                                    }}
                                    placeholder={t('filters.searchGenre', 'Otsi žanrit...')}
                                />
                            </CollapsibleSection>
                        )}

                        {/* Tags Filter (teose_tags - märksõnad) */}
                        {availableTeoseTags.length > 0 && (
                            <CollapsibleSection
                                title={t('filters.tags')}
                                icon={<Tag size={14} />}
                                defaultOpen={selectedTeoseTags.length > 0}
                                badge={selectedTeoseTags.length || undefined}
                            >
                                <SearchableFilterList
                                    items={availableTeoseTags.map(({ tag, count }) => ({
                                        value: tag,
                                        label: tag,
                                        count
                                    }))}
                                    selectedValues={selectedTeoseTags}
                                    onToggle={(value) => {
                                        if (selectedTeoseTags.includes(value)) {
                                            setSelectedTeoseTags(selectedTeoseTags.filter(t => t !== value));
                                        } else {
                                            setSelectedTeoseTags([...selectedTeoseTags, value]);
                                        }
                                    }}
                                    placeholder={t('filters.searchTag', 'Otsi märksõna...')}
                                />
                            </CollapsibleSection>
                        )}

                        {/* Type Filter (impressum/manuscriptum) - mitu valikut lubatud */}
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
                                        label: vocabularies?.types?.[value]?.[i18n.language.split('-')[0] as 'et' | 'en'] || vocabularies?.types?.[value]?.et || value
                                    }))}
                                    selectedValues={selectedTypes}
                                    onToggle={(value) => {
                                        if (selectedTypes.includes(value)) {
                                            setSelectedTypes(selectedTypes.filter(t => t !== value));
                                        } else {
                                            setSelectedTypes([...selectedTypes, value]);
                                        }
                                    }}
                                    placeholder={t('filters.searchType', 'Otsi tüüpi...')}
                                />
                            </CollapsibleSection>
                        )}

                        {/* Author Filter - autori valik autocomplete'iga */}
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
                                        setAuthorInput(e.target.value);
                                        setShowAuthorSuggestions(true);
                                    }}
                                    onFocus={() => setShowAuthorSuggestions(true)}
                                    onBlur={() => {
                                        // Viivitusega sulgemine, et klõps jõuaks registreeruda
                                        setTimeout(() => setShowAuthorSuggestions(false), 200);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            if (authorInput.trim()) {
                                                // Kui input vastab aliasele, kasuta kanoonilist nime
                                                const resolved = aliasMap[authorInput.trim()] || authorInput.trim();
                                                setAuthorInput(resolved);
                                                setSelectedAuthor(resolved);
                                                setShowAuthorSuggestions(false);
                                                setSearchParams(prev => {
                                                    prev.set('author', resolved);
                                                    prev.set('p', '1');
                                                    return prev;
                                                });
                                            }
                                        } else if (e.key === 'Escape') {
                                            setShowAuthorSuggestions(false);
                                        }
                                    }}
                                    placeholder={t('filters.authorPlaceholder')}
                                    className="w-full p-2 border border-gray-300 rounded text-sm focus:border-primary-500 outline-none"
                                />
                                {/* Autocomplete soovitused */}
                                {showAuthorSuggestions && authorInput.length >= 2 && (() => {
                                    const input = authorInput.toLowerCase();
                                    // 1. Kanonilised nimed mis vastavad otse
                                    const directMatches = availableAuthors.filter(({ value }) =>
                                        value.toLowerCase().includes(input)
                                    );
                                    // 2. Aliase kaudu leitud kanonilised nimed (koos vastanud aliasega)
                                    const aliasMatches: { value: string; count: number; matchedAlias: string }[] = [];
                                    const directNames = new Set(directMatches.map(m => m.value));
                                    for (const [alias, canonical] of Object.entries(aliasMap)) {
                                        if (alias.toLowerCase().includes(input) && !directNames.has(canonical)) {
                                            // Leia count kanoniliste autorite hulgast
                                            const authorEntry = availableAuthors.find(a => a.value === canonical);
                                            if (authorEntry && !aliasMatches.some(m => m.value === canonical)) {
                                                aliasMatches.push({ value: canonical, count: authorEntry.count, matchedAlias: alias });
                                                directNames.add(canonical); // Väldi duplikaate
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
                                                    onMouseDown={(e) => {
                                                        e.preventDefault();
                                                        setAuthorInput(value);
                                                        setSelectedAuthor(value);
                                                        setShowAuthorSuggestions(false);
                                                        setSearchParams(prev => {
                                                            prev.set('author', value);
                                                            prev.set('p', '1');
                                                            return prev;
                                                        });
                                                    }}
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
                                            <div className="px-3 py-2 text-sm text-gray-400">
                                                {t('status.noResults')}
                                            </div>
                                        )}
                                    </div>
                                    );
                                })()}
                                {/* Kustuta nupp kui on valitud */}
                                {selectedAuthor && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedAuthor('');
                                            setAuthorInput('');
                                            setInputValue('');
                                            setSearchParams(prev => {
                                                prev.delete('author');
                                                prev.delete('q');
                                                prev.set('p', '1');
                                                return prev;
                                            });
                                        }}
                                        className="mt-2 text-xs text-red-600 hover:text-red-700"
                                    >
                                        {t('filters.removeAuthorFilter')}
                                    </button>
                                )}
                            </div>
                        </CollapsibleSection>

                        {/* Work Filter - teose valik */}
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
                                        ...availableWorks.map(w => ({
                                            value: w.id,
                                            label: w.title,
                                            count: w.count,
                                            year: w.year,
                                            author: w.author
                                        }))
                                    ]}
                                    selectedValues={[selectedWork]}
                                    isRadio={true}
                                    onToggle={(value) => {
                                        if (value === '') {
                                            setSelectedWork('');
                                            setSelectedWorkInfo(null);
                                        } else {
                                            const work = availableWorks.find(w => w.id === value);
                                            if (work) {
                                                setSelectedWork(work.id);
                                                setSelectedWorkInfo({ title: work.title, year: work.year, author: work.author });
                                            }
                                        }
                                    }}
                                    placeholder={t('filters.searchWork', 'Otsi teost...')}
                                    renderItem={(item, isSelected) => {
                                        // Erijuht: "Kõik teosed"
                                        if (item.value === '') {
                                            return (
                                                <label key="all" className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded group">
                                                    <input
                                                        type="radio"
                                                        name="work"
                                                        checked={!selectedWork}
                                                        onChange={() => {
                                                            setSelectedWork('');
                                                            setSelectedWorkInfo(null);
                                                        }}
                                                        className="text-primary-600 focus:ring-primary-500"
                                                    />
                                                    <span className={`text-sm flex-1 ${!selectedWork ? 'text-primary-700 font-medium' : 'text-gray-700'}`}>
                                                        {item.label}
                                                    </span>
                                                </label>
                                            );
                                        }

                                        // Tavaline teos
                                        return (
                                            <label key={item.value} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded group">
                                                <input
                                                    type="radio"
                                                    name="work"
                                                    checked={isSelected}
                                                    onChange={() => {
                                                        const work = availableWorks.find(w => w.id === item.value);
                                                        if (work) {
                                                            setSelectedWork(work.id);
                                                            setSelectedWorkInfo({ title: work.title, year: work.year, author: work.author });
                                                        }
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

                                {/* Näita valitud teost kui seda pole facetis (nt tullakse otselingiga) */}
                                {selectedWork && !availableWorks.find((w) => w.id === selectedWork) && (
                                    <div className="mt-2 pt-2 border-t border-gray-100">
                                        <label className="flex items-center gap-2 cursor-pointer bg-primary-50 p-1 rounded">
                                            <input
                                                type="radio"
                                                name="work"
                                                checked
                                                readOnly
                                                className="text-primary-600"
                                            />
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
                                onClick={(e) => handleSearch(e)}
                                className="w-full py-2 bg-gray-900 text-white rounded text-sm font-bold shadow hover:bg-gray-800 transition-colors"
                            >
                                {t('filters.applyFilters')}
                            </button>
                            {(yearStart || yearEnd || selectedScope !== 'all' || selectedWork || selectedTeoseTags.length > 0 || selectedGenres.length > 0 || selectedTypes.length > 0 || selectedAuthor) && (
                                <button
                                    onClick={() => {
                                        // Taasta vaikeväärtused
                                        setYearStart('1630');
                                        setYearEnd('1710');
                                        setSelectedScope('all');
                                        setSelectedWork('');
                                        setSelectedWorkInfo(null);
                                        setSelectedTeoseTags([]);
                                        setSelectedGenres([]);
                                        setSelectedTypes([]);
                                        setSelectedAuthor('');
                                        setAuthorInput('');
                                        setSearchParams(prev => {
                                            prev.delete('ys');
                                            prev.delete('ye');
                                            prev.delete('scope');
                                            prev.delete('work');
                                            prev.delete('teoseTags');
                                            prev.delete('genre');
                                            prev.delete('type');
                                            prev.delete('author');
                                            prev.set('p', '1');
                                            return prev;
                                        });
                                    }}
                                    className="w-full py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm font-medium hover:bg-red-100 transition-colors"
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
                                        {results.hits[0]?.title || t('status.titleMissing')}
                                    </h2>
                                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                                        <span>
                                            <span className="text-gray-400">{t('labels.author')}</span>{' '}
                                            <span className="font-medium">{getAuthorDisplay(results.hits[0], t)}</span>
                                        </span>
                                        <span>
                                            <span className="text-gray-400">{t('labels.year')}</span>{' '}
                                            <span className="font-medium">{results.hits[0]?.year ?? results.hits[0]?.aasta ?? '...'}</span>
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
                                                            {firstHit.title || t('status.titleMissing')}
                                                        </h2>
                                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 font-medium">
                                                            {/* Autor */}
                                                            <button
                                                                onClick={() => {
                                                                    const authorName = getAuthorDisplay(firstHit, t);
                                                                    if (authorName && authorName !== t('status.unknown')) {
                                                                        setSelectedAuthor(authorName);
                                                                        setAuthorInput(authorName);
                                                                        setSearchParams(prev => {
                                                                            prev.set('author', authorName);
                                                                            prev.set('p', '1');
                                                                            return prev;
                                                                        });
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
                                                                    const year = (firstHit.year ?? firstHit.aasta)?.toString();
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
                                                                className="text-gray-700 flex items-center gap-1 hover:text-primary-600 transition-colors text-left"
                                                                title={t('results.searchYearWorks')}
                                                            >
                                                                <Calendar size={12} className="text-gray-400" />
                                                                <span className="hover:underline">{firstHit.year ?? firstHit.aasta ?? '...'}</span>
                                                            </button>

                                                            {/* Žanr */}
                                                            {(() => {
                                                                const lang = i18n.language.split('-')[0];
                                                                let label = getLabel(firstHit.genre_object, i18n.language);

                                                                // Fallback: proovi leida stringist või sõnavarast
                                                                if (!label && firstHit.genre && typeof firstHit.genre === 'string') {
                                                                    const val = firstHit.genre.toLowerCase();
                                                                    label = vocabularies?.genres?.[val]?.[lang] || firstHit.genre;
                                                                }

                                                                if (!label) return null;

                                                                return (
                                                                    <span className="flex items-center gap-1 text-primary-700 bg-primary-50 px-1.5 py-0.5 rounded">
                                                                        <Bookmark size={10} className="fill-primary-200" />
                                                                        {label}
                                                                    </span>
                                                                );
                                                            })()}

                                                            {/* Kollektsioon (tüübi asemel) */}
                                                            {firstHit.collection && collections[firstHit.collection] && (() => {
                                                                const colorClasses = getCollectionColorClasses(collections[firstHit.collection]);
                                                                return (
                                                                    <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${colorClasses.bg} ${colorClasses.text}`}>
                                                                        <FolderOpen size={10} />
                                                                        {getCollectionName(firstHit.collection, i18n.language.split('-')[0] as 'et' | 'en')}
                                                                    </span>
                                                                );
                                                            })()}
                                                        </div>
                                                    </div>
                                                    <div className="shrink-0 text-right">
                                                        <span className="font-mono bg-gray-200 px-1.5 py-0.5 rounded text-xs text-gray-600" title={t('labels.workId')}>
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
                                                                title: firstHit.title || targetId,
                                                                year: firstHit.year ?? firstHit.aasta,
                                                                author: getAuthorDisplay(firstHit, t)
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
