# SearchPage Refactor — Custom Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lagundada SearchPage.tsx (814 rida, 27 state muutujat, 9 useEffect) viieks eraldi custom hookiks — iga hook ühe vastutusega, SearchPage ise jääb ~120 reale.

**Architecture:** Kõik hookid `src/pages/search/hooks/` kaustas. URL on tõe allikas — hookid loevad/kirjutavad `useSearchParams`. Migreeritakse järk-järgult: iga task ekstraktib ühe hooki, SearchPage jääb töökorras pärast igat sammu. Backendis muudatusi pole.

**Tech Stack:** React 19, TypeScript strict, `react-router-dom` `useSearchParams`, `react-i18next`, `meilisearch`

---

## Failikaart

| Fail | Seis | Vastutus |
|------|------|---------|
| `src/pages/search/hooks/useSearchUrlParams.ts` | **Loo** | URL parameetrite lugemine ja tüüpimine |
| `src/pages/search/hooks/useSearchResults.ts` | **Loo** | `searchContent()` kutsumine, tulemused, loading, error |
| `src/pages/search/hooks/useSearchFacets.ts` | **Loo** | Facetite laadimine (4 API + aliased + vocabularies) |
| `src/pages/search/hooks/useQCodeMaps.ts` | **Loo** | 6 Q-kood↔label kaardi arvutamine + enrichedLabels cache |
| `src/pages/search/hooks/useFilterDraft.ts` | **Loo** | Lokaalne filter-draft state + commit() + backbutton sync |
| `src/pages/SearchPage.tsx` | **Muuda** | ~120 rida: hookid + JSX, ilma state/effect loogika korduseta |
| `src/pages/search/SearchFilters.tsx` | **Muuda** | Props: 3 struktureeritud objekti (draft, facets, qCodeMaps) asemel 25 eraldi prop |

---

## Task 1: `useSearchUrlParams`

**Files:**
- Create: `src/pages/search/hooks/useSearchUrlParams.ts`

See on puhtalt URL-lugeja — ühtegi side-effecti pole. Tagastab tüübitud objekti, mitte raw URLSearchParams stringe.

- [ ] **Step 1: Loo hooks kaust ja fail**

```typescript
// src/pages/search/hooks/useSearchUrlParams.ts
import { useSearchParams } from 'react-router-dom';

export interface SearchUrlParams {
    q: string;
    page: number;
    workId: string;
    yearStart: number | undefined;
    yearEnd: number | undefined;
    scope: 'all' | 'original' | 'annotation';
    teoseTags: string[];
    pageTags: string[];
    genres: string[];
    types: string[];
    author: string;
}

export function useSearchUrlParams(): SearchUrlParams {
    const [searchParams] = useSearchParams();
    return {
        q: searchParams.get('q') || '',
        page: parseInt(searchParams.get('p') || '1', 10),
        workId: searchParams.get('work') || '',
        yearStart: searchParams.get('ys') ? parseInt(searchParams.get('ys')!) : undefined,
        yearEnd: searchParams.get('ye') ? parseInt(searchParams.get('ye')!) : undefined,
        scope: (searchParams.get('scope') as 'all' | 'original' | 'annotation') || 'all',
        teoseTags: searchParams.get('teoseTags')?.split(',').filter(Boolean) || [],
        pageTags: searchParams.get('pageTags')?.split(',').filter(Boolean) || [],
        genres: searchParams.get('genre')?.split(',').filter(Boolean) || [],
        types: searchParams.get('type')?.split(',').filter(Boolean) || [],
        author: searchParams.get('author') || '',
    };
}
```

- [ ] **Step 2: Typecheck**
  ```bash
  npm run typecheck
  ```
  Oodatav: 0 viga.

- [ ] **Step 3: Commit**
  ```bash
  git add src/pages/search/hooks/useSearchUrlParams.ts
  git commit -m "refactor: lisa useSearchUrlParams hook"
  ```

---

## Task 2: `useSearchResults`

**Files:**
- Create: `src/pages/search/hooks/useSearchResults.ts`

Ekstraktib `performSearch` + otsingutrigger-effect SearchPage-st. Hook kuulab URL muutusi (`SearchUrlParams`) ja käivitab otsingu automaatselt. `facetDistribution` tagastatakse — facet-hook kasutab seda hiljem.

- [ ] **Step 1: Loo fail**

```typescript
// src/pages/search/hooks/useSearchResults.ts
import { useState, useEffect } from 'react';
import { searchContent } from '../../../services/searchService';
import { ContentSearchResponse } from '../../../types';
import { SearchUrlParams } from './useSearchUrlParams';
import { getLangCode } from '../../../utils/getLangCode';

export interface SearchResultsState {
    results: ContentSearchResponse | null;
    loading: boolean;
    error: string | null;
}

export function useSearchResults(urlParams: SearchUrlParams, lang: string): SearchResultsState {
    const [results, setResults] = useState<ContentSearchResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const hasActiveSearch = urlParams.q || urlParams.workId || urlParams.author ||
            urlParams.yearStart !== undefined || urlParams.yearEnd !== undefined ||
            urlParams.scope !== 'all' || urlParams.teoseTags.length > 0 ||
            urlParams.pageTags.length > 0 || urlParams.genres.length > 0 || urlParams.types.length > 0;

        if (!hasActiveSearch) {
            setResults(null);
            return;
        }

        let cancelled = false;
        const run = async () => {
            setLoading(true);
            setError(null);
            try {
                const data = await searchContent(urlParams.q, urlParams.page, {
                    yearStart: urlParams.yearStart,
                    yearEnd: urlParams.yearEnd,
                    scope: urlParams.scope,
                    workId: urlParams.workId || undefined,
                    teoseTags: urlParams.teoseTags.length > 0 ? urlParams.teoseTags : undefined,
                    pageTags: urlParams.pageTags.length > 0 ? urlParams.pageTags : undefined,
                    genre: urlParams.genres.length > 0 ? urlParams.genres : undefined,
                    type: urlParams.types.length > 0 ? urlParams.types : undefined,
                    author: urlParams.author || undefined,
                    lang: getLangCode(lang),
                });
                if (!cancelled) setResults(data);
            } catch (e: any) {
                if (!cancelled) setError(e.message || 'Otsinguviga');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        run();
        return () => { cancelled = true; };
    }, [urlParams.q, urlParams.page, urlParams.yearStart, urlParams.yearEnd,
        urlParams.scope, urlParams.workId,
        urlParams.teoseTags.join(','), urlParams.pageTags.join(','),
        urlParams.genres.join(','), urlParams.types.join(','),
        urlParams.author, lang]);

    return { results, loading, error };
}
```

- [ ] **Step 2: Typecheck**
  ```bash
  npm run typecheck
  ```
  Oodatav: 0 viga.

- [ ] **Step 3: Commit**
  ```bash
  git add src/pages/search/hooks/useSearchResults.ts
  git commit -m "refactor: lisa useSearchResults hook"
  ```

---

## Task 3: `useSearchFacets`

**Files:**
- Create: `src/pages/search/hooks/useSearchFacets.ts`

Konsolideerib kaks facet-laadimise kohta SearchPage-st:
1. `loadFilterData` effect (algne laadimine — 4 API kutset + aliased + vocabularies)
2. Facetite uuendamine `performSearch` seest (`facetDistribution` vastusest)

Hook saab `results` parameetrina (et facets uueneksid pärast otsingu vastust) ja tagastab facetid + aliased + vocabularies.

- [ ] **Step 1: Loo fail**

```typescript
// src/pages/search/hooks/useSearchFacets.ts
import { useState, useEffect } from 'react';
import { getTeoseTagsFacets, getGenreFacets, getTypeFacets, getAuthorFacets } from '../../../services/searchService';
import { getVocabularies, Vocabularies } from '../../../services/collectionService';
import { ContentSearchResponse } from '../../../types';
import { SearchUrlParams } from './useSearchUrlParams';
import { getLangCode } from '../../../utils/getLangCode';
import { FILE_API_URL } from '../../../config';
import {
    mergeFacetsWithExisting, mergeTagsWithExisting,
    mergeSelectedIntoFacets, mergeSelectedIntoTags
} from '../searchUtils';

export interface FacetsState {
    availableTeoseTags: { tag: string; count: number }[];
    availableGenres: { value: string; count: number }[];
    availableTypes: { value: string; count: number }[];
    availableAuthors: { value: string; count: number }[];
    vocabularies: Vocabularies | null;
    aliasMap: Record<string, string>;
}

export function useSearchFacets(
    urlParams: SearchUrlParams,
    lang: string,
    selectedCollection: string | null,
    results: ContentSearchResponse | null
): FacetsState {
    const [availableTeoseTags, setAvailableTeoseTags] = useState<{ tag: string; count: number }[]>([]);
    const [availableGenres, setAvailableGenres] = useState<{ value: string; count: number }[]>([]);
    const [availableTypes, setAvailableTypes] = useState<{ value: string; count: number }[]>([]);
    const [availableAuthors, setAvailableAuthors] = useState<{ value: string; count: number }[]>([]);
    const [vocabularies, setVocabularies] = useState<Vocabularies | null>(null);
    const [aliasMap, setAliasMap] = useState<Record<string, string>>({});

    // Alglaadimine: vocabularies + aliased + (kui pole aktiivset filtrit) facetid
    useEffect(() => {
        const load = async () => {
            try {
                const [vocabs, aliasRes] = await Promise.all([
                    getVocabularies(),
                    fetch(`${FILE_API_URL}/people-aliases`).then(r => r.ok ? r.json() : null).catch(() => null)
                ]);
                setVocabularies(vocabs);
                if (aliasRes?.status === 'success' && aliasRes.aliases) setAliasMap(aliasRes.aliases);

                const hasActiveContentFilters = !!urlParams.q || !!urlParams.workId || !!urlParams.author ||
                    urlParams.teoseTags.length > 0 || urlParams.genres.length > 0 || urlParams.types.length > 0;
                if (hasActiveContentFilters) return;

                const facetLang = getLangCode(lang);
                const [tags, genres, types, authors] = await Promise.all([
                    getTeoseTagsFacets(selectedCollection || undefined, facetLang, urlParams.yearStart, urlParams.yearEnd),
                    getGenreFacets(selectedCollection || undefined, facetLang, urlParams.yearStart, urlParams.yearEnd),
                    getTypeFacets(selectedCollection || undefined, facetLang, urlParams.yearStart, urlParams.yearEnd),
                    getAuthorFacets(selectedCollection || undefined, urlParams.yearStart, urlParams.yearEnd)
                ]);
                setAvailableTeoseTags(mergeSelectedIntoTags(tags, urlParams.teoseTags));
                setAvailableGenres(mergeSelectedIntoFacets(genres, urlParams.genres));
                setAvailableTypes(mergeSelectedIntoFacets(types, urlParams.types));
                setAvailableAuthors(authors);
            } catch (e) {
                console.warn('Filtrite andmete laadimine ebaõnnestus:', e);
            }
        };
        load();
    }, [selectedCollection, lang, urlParams.yearStart, urlParams.yearEnd,
        urlParams.q, urlParams.workId, urlParams.author,
        urlParams.teoseTags.length, urlParams.genres.length, urlParams.types.length]);

    // Uuenda facets otsinguvastusest
    useEffect(() => {
        if (!results?.facetDistribution) return;
        const facetLang = getLangCode(lang);
        const processFacets = (field: string) => {
            let dist = results.facetDistribution?.[field];
            if (!dist && field.includes('_')) dist = results.facetDistribution?.[field.split('_')[0]];
            return Object.entries(dist || {})
                .map(([value, count]) => ({ value, count: count as number }))
                .sort((a, b) => b.count - a.count);
        };
        const newGenres = processFacets(`genre_${facetLang}`);
        const newTypes = processFacets(`type_${facetLang}`);
        const newTags = processFacets(`tags_${facetLang}`).map(t => ({ tag: t.value, count: t.count }));
        const newAuthors = processFacets('author_names');
        setAvailableTeoseTags(prev => mergeTagsWithExisting(prev, newTags, urlParams.teoseTags));
        setAvailableGenres(prev => mergeFacetsWithExisting(prev, newGenres, urlParams.genres));
        setAvailableTypes(prev => mergeFacetsWithExisting(prev, newTypes, urlParams.types));
        setAvailableAuthors(newAuthors);
    }, [results, lang]);

    return { availableTeoseTags, availableGenres, availableTypes, availableAuthors, vocabularies, aliasMap };
}
```

- [ ] **Step 2: Typecheck**
  ```bash
  npm run typecheck
  ```
  Oodatav: 0 viga.

- [ ] **Step 3: Commit**
  ```bash
  git add src/pages/search/hooks/useSearchFacets.ts
  git commit -m "refactor: lisa useSearchFacets hook"
  ```

---

## Task 4: `useQCodeMaps`

**Files:**
- Create: `src/pages/search/hooks/useQCodeMaps.ts`

Konsolideerib 6 `useMemo` kaardi + `enrichedLabels` cache + `knownPageTagsLabels` state + 3 Q-kood normaliseerimise effect. Kõik need sõltuvad `results` ja `lang` muutumisest.

- [ ] **Step 1: Loo fail**

```typescript
// src/pages/search/hooks/useQCodeMaps.ts
import { useState, useEffect, useMemo } from 'react';
import { ContentSearchResponse } from '../../../types';
import { getEntityLabelsCache } from '../../../services/entityLabelsService';
import { getLangCode } from '../../../utils/getLangCode';
import { useSearchParams } from 'react-router-dom';

export interface QCodeMaps {
    genreIdMap: Record<string, string>;
    genreLabelToId: Record<string, string>;
    typeIdMap: Record<string, string>;
    typeLabelToId: Record<string, string>;
    tagsIdMap: Record<string, string>;
    tagsLabelToId: Record<string, string>;
    pageTagsIdMap: Record<string, string>;
    knownPageTagsLabels: Record<string, string>;
    enrichedLabels: Record<string, Record<string, string>>;
}

const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : '';

export function useQCodeMaps(
    results: ContentSearchResponse | null,
    lang: string,
    initialPageTagsLabels?: Record<string, string>
): QCodeMaps {
    const [enrichedLabels, setEnrichedLabels] = useState<Record<string, Record<string, string>>>({});
    const [knownPageTagsLabels, setKnownPageTagsLabels] = useState<Record<string, string>>(
        initialPageTagsLabels || {}
    );
    const [searchParams, setSearchParams] = useSearchParams();

    // Lae entity labels cache serverist (üks kord sessiooni jooksul)
    useEffect(() => {
        getEntityLabelsCache().then(labels => {
            if (Object.keys(labels).length > 0) setEnrichedLabels(labels);
        });
    }, []);

    const langCode = getLangCode(lang);

    const genreIdMap = useMemo(() => {
        const map: Record<string, string> = {};
        if (!results?.hits) return map;
        for (const hit of results.hits) {
            const obj = (hit as any).genre_object ?? hit.genre;
            if (!obj) continue;
            const items = Array.isArray(obj) ? obj : [obj];
            for (const item of items) {
                if (!item?.labels) continue;
                const currentLabel = cap((item.id && enrichedLabels[item.id]?.[langCode]) || item.labels[langCode] || item.labels['et'] || item.label);
                if (item.id) map[item.id] = currentLabel;
                for (const labelVal of Object.values(item.labels)) {
                    if (labelVal) { map[labelVal as string] = currentLabel; map[cap(labelVal as string)] = currentLabel; }
                }
                if (item.label) { map[item.label] = currentLabel; map[cap(item.label)] = currentLabel; }
            }
        }
        return map;
    }, [results, langCode, enrichedLabels]);

    const genreLabelToId = useMemo(() => {
        const map: Record<string, string> = {};
        if (!results?.hits) return map;
        for (const hit of results.hits) {
            const obj = (hit as any).genre_object ?? hit.genre;
            if (!obj) continue;
            const items = Array.isArray(obj) ? obj : [obj];
            for (const item of items) {
                if (item?.id && item?.labels) {
                    const rawLabel = item.labels[langCode] || item.labels['et'] || item.label;
                    map[rawLabel] = item.id; map[cap(rawLabel)] = item.id;
                }
            }
        }
        return map;
    }, [results, langCode]);

    const typeIdMap = useMemo(() => {
        const map: Record<string, string> = {};
        if (!results?.hits) return map;
        for (const hit of results.hits) {
            const obj = (hit as any).type_object ?? hit.type;
            if (!obj) continue;
            const items = Array.isArray(obj) ? obj : [obj];
            for (const item of items) {
                if (!item?.labels) continue;
                const currentLabel = cap((item.id && enrichedLabels[item.id]?.[langCode]) || item.labels[langCode] || item.labels['et'] || item.label);
                if (item.id) map[item.id] = currentLabel;
                for (const labelVal of Object.values(item.labels)) {
                    if (labelVal) { map[labelVal as string] = currentLabel; map[cap(labelVal as string)] = currentLabel; }
                }
                if (item.label) { map[item.label] = currentLabel; map[cap(item.label)] = currentLabel; }
            }
        }
        return map;
    }, [results, langCode, enrichedLabels]);

    const typeLabelToId = useMemo(() => {
        const map: Record<string, string> = {};
        if (!results?.hits) return map;
        for (const hit of results.hits) {
            const obj = (hit as any).type_object ?? hit.type;
            if (!obj) continue;
            const items = Array.isArray(obj) ? obj : [obj];
            for (const item of items) {
                if (item?.id && item?.labels) {
                    const rawLabel = item.labels[langCode] || item.labels['et'] || item.label;
                    map[rawLabel] = item.id; map[cap(rawLabel)] = item.id;
                }
            }
        }
        return map;
    }, [results, langCode]);

    const tagsIdMap = useMemo(() => {
        const map: Record<string, string> = {};
        if (!results?.hits) return map;
        for (const hit of results.hits) {
            const objs = (hit as any).tags_object ?? hit.tags;
            if (!objs || !Array.isArray(objs)) continue;
            for (const item of objs) {
                if (!item?.labels) continue;
                const currentLabel = cap(item.labels[langCode] || item.labels['et'] || item.label);
                if (item.id) map[item.id] = currentLabel;
                for (const labelVal of Object.values(item.labels)) {
                    if (labelVal) { map[labelVal as string] = currentLabel; map[cap(labelVal as string)] = currentLabel; }
                }
                if (item.label) { map[item.label] = currentLabel; map[cap(item.label)] = currentLabel; }
            }
        }
        return map;
    }, [results, langCode]);

    const tagsLabelToId = useMemo(() => {
        const map: Record<string, string> = {};
        if (!results?.hits) return map;
        for (const hit of results.hits) {
            const objs = (hit as any).tags_object ?? hit.tags;
            if (!objs || !Array.isArray(objs)) continue;
            for (const item of objs) {
                if (item?.id && item?.labels) {
                    const rawLabel = item.labels[langCode] || item.labels['et'] || item.label;
                    map[rawLabel] = item.id; map[cap(rawLabel)] = item.id;
                }
            }
        }
        return map;
    }, [results, langCode]);

    const pageTagsIdMap = useMemo(() => {
        const map: Record<string, string> = {};
        if (!results?.hits) return map;
        for (const hit of results.hits) {
            const objs = (hit as any).page_tags_object;
            if (!objs || !Array.isArray(objs)) continue;
            for (const item of objs) {
                if (!item?.id || !item?.labels) continue;
                const label = item.labels[langCode] || item.labels['et'] || item.label || item.id;
                map[item.id] = cap(label);
            }
        }
        return map;
    }, [results, langCode]);

    // Salvesta teadaolevad pageTags labelid — säilivad ka tühjade tulemuste korral
    useEffect(() => {
        if (Object.keys(pageTagsIdMap).length > 0) {
            setKnownPageTagsLabels(prev => ({ ...prev, ...pageTagsIdMap }));
        }
    }, [pageTagsIdMap]);

    // Normaliseeri žanrid URL-is Q-koodideks (label → Q-kood)
    useEffect(() => {
        const genres = searchParams.get('genre')?.split(',').filter(Boolean) || [];
        if (genres.length === 0) return;
        const isQ = (s: string) => /^Q\d+$/.test(s);
        let changed = false;
        const resolved = genres.map(g => {
            if (isQ(g)) return g;
            const qCode = genreLabelToId[g] || genreLabelToId[cap(g)];
            if (qCode) { changed = true; return qCode; }
            return g;
        });
        if (changed) {
            setSearchParams(prev => { prev.set('genre', resolved.join(',')); return prev; }, { replace: true });
        }
    }, [genreLabelToId, searchParams]);

    // Normaliseeri tüübid URL-is Q-koodideks
    useEffect(() => {
        const types = searchParams.get('type')?.split(',').filter(Boolean) || [];
        if (types.length === 0) return;
        const isQ = (s: string) => /^Q\d+$/.test(s);
        let changed = false;
        const resolved = types.map(t => {
            if (isQ(t)) return t;
            const qCode = typeLabelToId[t] || typeLabelToId[cap(t)];
            if (qCode) { changed = true; return qCode; }
            return t;
        });
        if (changed) {
            setSearchParams(prev => { prev.set('type', resolved.join(',')); return prev; }, { replace: true });
        }
    }, [typeLabelToId, searchParams]);

    // Normaliseeri märksõnad URL-is Q-koodideks
    useEffect(() => {
        const teoseTags = searchParams.get('teoseTags')?.split(',').filter(Boolean) || [];
        if (teoseTags.length === 0) return;
        const isQ = (s: string) => /^Q\d+$/.test(s);
        let changed = false;
        const resolved = teoseTags.map(tag => {
            if (isQ(tag)) return tag;
            const qCode = tagsLabelToId[tag] || tagsLabelToId[cap(tag)];
            if (qCode) { changed = true; return qCode; }
            return tag;
        });
        if (changed) {
            setSearchParams(prev => { prev.set('teoseTags', resolved.join(',')); return prev; }, { replace: true });
        }
    }, [tagsLabelToId, searchParams]);

    return {
        genreIdMap, genreLabelToId, typeIdMap, typeLabelToId,
        tagsIdMap, tagsLabelToId, pageTagsIdMap, knownPageTagsLabels, enrichedLabels
    };
}
```

- [ ] **Step 2: Typecheck**
  ```bash
  npm run typecheck
  ```
  Oodatav: 0 viga.

- [ ] **Step 3: Commit**
  ```bash
  git add src/pages/search/hooks/useQCodeMaps.ts
  git commit -m "refactor: lisa useQCodeMaps hook"
  ```

---

## Task 5: `useFilterDraft`

**Files:**
- Create: `src/pages/search/hooks/useFilterDraft.ts`

Haldab lokaalset filter-draft state-i (muutub enne "Otsi" vajutust), sünkroniseerib tagasinupust, ja pakub `commit()` funktsiooni mis kirjutab draftist URL-i.

- [ ] **Step 1: Loo fail**

```typescript
// src/pages/search/hooks/useFilterDraft.ts
import { useState, useEffect, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SearchUrlParams } from './useSearchUrlParams';

export interface FilterDraft {
    inputValue: string;
    yearStart: string;
    yearEnd: string;
    selectedScope: 'all' | 'original' | 'annotation';
    selectedWork: string;
    selectedWorkInfo: { title: string; year?: string | number; author?: string } | null;
    selectedTeoseTags: string[];
    selectedPageTags: string[];
    selectedGenres: string[];
    selectedTypes: string[];
    selectedAuthor: string;
    authorInput: string;
    showAuthorSuggestions: boolean;
    showFiltersMobile: boolean;
}

export interface FilterDraftActions {
    setInputValue: (v: string) => void;
    setYearStart: (v: string) => void;
    setYearEnd: (v: string) => void;
    setSelectedScope: (v: 'all' | 'original' | 'annotation') => void;
    setSelectedWork: (v: string) => void;
    setSelectedWorkInfo: (v: { title: string; year?: string | number; author?: string } | null) => void;
    setSelectedTeoseTags: (v: string[] | ((prev: string[]) => string[])) => void;
    setSelectedPageTags: (v: string[] | ((prev: string[]) => string[])) => void;
    setSelectedGenres: (v: string[] | ((prev: string[]) => string[])) => void;
    setSelectedTypes: (v: string[] | ((prev: string[]) => string[])) => void;
    setSelectedAuthor: (v: string) => void;
    setAuthorInput: (v: string) => void;
    setShowAuthorSuggestions: (v: boolean) => void;
    setShowFiltersMobile: (v: boolean) => void;
    commit: (e?: FormEvent) => void;
    clearFilters: () => void;
    handleAuthorSelect: (author: string) => void;
    handleAuthorClear: () => void;
    handleWorkSelect: (id: string, info: { title: string; year?: string | number; author?: string } | null) => void;
}

export function useFilterDraft(
    urlParams: SearchUrlParams,
    qCodeMaps: { genreLabelToId: Record<string, string>; typeLabelToId: Record<string, string>; tagsLabelToId: Record<string, string> }
): { draft: FilterDraft; actions: FilterDraftActions } {
    const [, setSearchParams] = useSearchParams();

    const [inputValue, setInputValue] = useState(urlParams.q);
    const [yearStart, setYearStart] = useState(urlParams.yearStart?.toString() || '');
    const [yearEnd, setYearEnd] = useState(urlParams.yearEnd?.toString() || '');
    const [selectedScope, setSelectedScope] = useState<'all' | 'original' | 'annotation'>(urlParams.scope);
    const [selectedWork, setSelectedWork] = useState(urlParams.workId);
    const [selectedWorkInfo, setSelectedWorkInfo] = useState<{ title: string; year?: string | number; author?: string } | null>(null);
    const [selectedTeoseTags, setSelectedTeoseTags] = useState<string[]>(urlParams.teoseTags);
    const [selectedPageTags, setSelectedPageTags] = useState<string[]>(urlParams.pageTags);
    const [selectedGenres, setSelectedGenres] = useState<string[]>(urlParams.genres);
    const [selectedTypes, setSelectedTypes] = useState<string[]>(urlParams.types);
    const [selectedAuthor, setSelectedAuthor] = useState(urlParams.author);
    const [authorInput, setAuthorInput] = useState(urlParams.author);
    const [showAuthorSuggestions, setShowAuthorSuggestions] = useState(false);
    const [showFiltersMobile, setShowFiltersMobile] = useState(false);

    // Sünkroniseeri lokaalset state-i kui URL muutub (nt tagasinupp)
    useEffect(() => {
        setInputValue(urlParams.q);
        setSelectedScope(urlParams.scope);
        setSelectedWork(urlParams.workId);
        setSelectedTeoseTags(urlParams.teoseTags);
        setSelectedPageTags(urlParams.pageTags);
        setSelectedGenres(urlParams.genres);
        setSelectedTypes(urlParams.types);
        setSelectedAuthor(urlParams.author);
        setAuthorInput(urlParams.author);
    }, [urlParams.q, urlParams.scope, urlParams.workId,
        urlParams.teoseTags.join(','), urlParams.pageTags.join(','),
        urlParams.genres.join(','), urlParams.types.join(','), urlParams.author]);

    const { genreLabelToId, typeLabelToId, tagsLabelToId } = qCodeMaps;
    const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : '';

    const commit = (e?: FormEvent) => {
        if (e) e.preventDefault();
        const hasFilters = yearStart || yearEnd || selectedScope !== 'all' || selectedWork ||
            selectedTeoseTags.length > 0 || selectedPageTags.length > 0 ||
            selectedGenres.length > 0 || selectedTypes.length > 0 || selectedAuthor;

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

    const clearFilters = () => {
        setYearStart(''); setYearEnd(''); setSelectedScope('all');
        setSelectedWork(''); setSelectedWorkInfo(null);
        setSelectedTeoseTags([]); setSelectedPageTags([]);
        setSelectedGenres([]); setSelectedTypes([]);
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

    return {
        draft: {
            inputValue, yearStart, yearEnd, selectedScope, selectedWork, selectedWorkInfo,
            selectedTeoseTags, selectedPageTags, selectedGenres, selectedTypes,
            selectedAuthor, authorInput, showAuthorSuggestions, showFiltersMobile
        },
        actions: {
            setInputValue, setYearStart, setYearEnd, setSelectedScope,
            setSelectedWork, setSelectedWorkInfo, setSelectedTeoseTags,
            setSelectedPageTags, setSelectedGenres, setSelectedTypes,
            setSelectedAuthor, setAuthorInput, setShowAuthorSuggestions, setShowFiltersMobile,
            commit, clearFilters, handleAuthorSelect, handleAuthorClear, handleWorkSelect
        }
    };
}
```

- [ ] **Step 2: Typecheck**
  ```bash
  npm run typecheck
  ```
  Oodatav: 0 viga.

- [ ] **Step 3: Commit**
  ```bash
  git add src/pages/search/hooks/useFilterDraft.ts
  git commit -m "refactor: lisa useFilterDraft hook"
  ```

---

## Task 6: Integreeri hookid SearchPage + uuenda SearchFilters props

**Files:**
- Modify: `src/pages/SearchPage.tsx`
- Modify: `src/pages/search/SearchFilters.tsx`

SearchPage läheb ~814 realt ~120 reale. SearchFilters props läheb 25 eraldiseisvalt propilt 3 struktureeritud objektile.

**NB:** `selectedWorkInfo` laadimine (`getWorkMetadata` effect) ja `sessionStorage` effect jäävad SearchPage-sse — need on liiga väiksed eraldi hookiks ja seotud UI-spetsiifiliste asjadega.

- [ ] **Step 1: Uuenda SearchFilters props**

Asenda praegune `SearchFiltersProps` interface järgmisega ja uuenda destruktureerimine:

```typescript
// Uued struktureeritud tüübid
export interface FilterDraftProps {
    inputValue: string;
    yearStart: string;
    yearEnd: string;
    selectedScope: 'all' | 'original' | 'annotation';
    selectedWork: string;
    selectedWorkInfo: WorkInfo | null;
    selectedTeoseTags: string[];
    selectedPageTags: string[];
    selectedGenres: string[];
    selectedTypes: string[];
    selectedAuthor: string;
    authorInput: string;
    showAuthorSuggestions: boolean;
    showFiltersMobile: boolean;
}

export interface FacetsProps {
    availableGenres: { value: string; count: number }[];
    availableTypes: { value: string; count: number }[];
    availableTeoseTags: { tag: string; count: number }[];
    availableAuthors: { value: string; count: number }[];
    availableWorks: AvailableWork[];
    vocabularies: Vocabularies | null;
    aliasMap: Record<string, string>;
    loading: boolean;
}

export interface QCodeMapsProps {
    enrichedLabels?: Record<string, Record<string, string>>;
    genreIdMap?: Record<string, string>;
    genreLabelToId?: Record<string, string>;
    typeIdMap?: Record<string, string>;
    typeLabelToId?: Record<string, string>;
    tagsIdMap?: Record<string, string>;
    tagsLabelToId?: Record<string, string>;
}

export interface SearchFiltersProps {
    draft: FilterDraftProps;
    facets: FacetsProps;
    qCodeMaps: QCodeMapsProps;
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
    onSearch: (e?: FormEvent) => void;
    onClearFilters: () => void;
}
```

Uuenda SearchFilters komponendi sees kõik `selectedScope`, `yearStart` jne viited `draft.selectedScope`, `draft.yearStart` jne; `availableGenres` → `facets.availableGenres`; `genreIdMap` → `qCodeMaps.genreIdMap` jne.

- [ ] **Step 2: Kirjuta SearchPage ümber hookide peale**

```typescript
// src/pages/SearchPage.tsx (~120 rida)
import React, { useState, useEffect } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getWorkMetadata } from '../services/workService';
import { getCollectionColorClasses } from '../services/collectionService';
import { Search, Filter, Library, FileText, User, X, Layers, Tag, Bookmark, FileType, Calendar } from 'lucide-react';
import Header from '../components/Header';
import { useCollection } from '../contexts/CollectionContext';
import SearchFilters from './search/SearchFilters';
import SearchResults from './search/SearchResults';
import { getLangCode } from '../utils/getLangCode';
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

    const urlParams = useSearchUrlParams();
    const lang = i18n.language;
    const langCode = getLangCode(lang);

    const { results, loading, error } = useSearchResults(urlParams, lang);
    const facets = useSearchFacets(urlParams, lang, selectedCollection, results);
    const qCodeMaps = useQCodeMaps(results, lang, (location.state as any)?.pageTagsLabels);
    const { draft, actions } = useFilterDraft(urlParams, qCodeMaps);

    // Salvesta otsingu URL sessionStorage'isse
    useEffect(() => {
        const url = '/search' + (searchParams.toString() ? '?' + searchParams.toString() : '');
        sessionStorage.setItem(RETURN_URL_KEY, url);
    }, [searchParams]);

    // Laadi teose info kui tullakse work-filter-iga (nt Workspace'ist)
    useEffect(() => {
        if (urlParams.workId && !draft.selectedWorkInfo) {
            getWorkMetadata(urlParams.workId).then(work => {
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
    }, [urlParams.workId]);

    const { genreLabelToId, typeLabelToId, tagsLabelToId } = qCodeMaps;

    const workHitCounts = results?.facetDistribution?.['work_id'] || {};
    const uniqueWorkIds = new Set(results?.hits?.map(h => h.work_id) || []);
    const availableWorks = (results?.hits && !urlParams.workId && !loading && uniqueWorkIds.size > 1)
        ? results.hits.map(hit => ({
            id: hit.work_id,
            title: hit.title || hit.work_id,
            year: typeof hit.year === 'number' ? hit.year : undefined,
            author: (() => { const a = (hit as any).autor; return Array.isArray(a) ? a[0] : a; })(),
            count: workHitCounts[hit.work_id] || 1
        }))
        : [];

    const resolveLabel = (qCode: string, fallbackMap?: Record<string, string>) => {
        if (qCodeMaps.enrichedLabels[qCode]) {
            return (s => s ? s[0].toUpperCase() + s.slice(1) : '')(qCodeMaps.enrichedLabels[qCode][langCode] || qCodeMaps.enrichedLabels[qCode]['et'] || qCode);
        }
        return fallbackMap?.[qCode] || qCode;
    };

    return (
        // ... JSX jääb samaks, asendades vaid prop-nimed struktureerituks
        // Näide: searchParams params jäävad chip-idesse, SearchFilters saab draft/facets/qCodeMaps
        // SearchResults saab endiselt same props (results, loading, error, urlParams, etc.)
    );
};

export default SearchPage;
```

**NB implementeerijale:** JSX osa (aktiivsete filtrite chipid, otsinguriba, tulemuste veerg) tuleb **kopeerida originaalsest SearchPage.tsx-ist (read 520–812)** ja teha ainult järgmised viiteasendused (muid muudatusi pole):
- `queryParam` → `urlParams.q`
- `yearStartParam` → `urlParams.yearStart`
- `yearEndParam` → `urlParams.yearEnd`
- `scopeParam` → `urlParams.scope`
- `teoseTagsParam` → `urlParams.teoseTags`
- `pageTagsParam` → `urlParams.pageTags`
- `genreParam` → `urlParams.genres`
- `typeParam` → `urlParams.types`
- `authorParam` → `urlParams.author`
- `selectedWork` → `draft.selectedWork`
- `selectedWorkInfo` → `draft.selectedWorkInfo`
- `selectedAuthor` → `draft.selectedAuthor`
- `knownPageTagsLabels` → `qCodeMaps.knownPageTagsLabels`

SearchFilters-ile antakse:
```tsx
<SearchFilters
    draft={draft}
    facets={{ ...facets, availableWorks, loading }}
    qCodeMaps={qCodeMaps}
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
    onWorkSelect={actions.handleWorkSelect}
    onSetMobileFilters={actions.setShowFiltersMobile}
    onSearch={actions.commit}
    onClearFilters={actions.clearFilters}
/>
```

- [ ] **Step 3: Typecheck**
  ```bash
  npm run typecheck
  ```
  Oodatav: 0 viga.

- [ ] **Step 4: Build**
  ```bash
  npm run build
  ```
  Oodatav: 0 viga.

- [ ] **Step 5: Commit**
  ```bash
  git add src/pages/SearchPage.tsx src/pages/search/SearchFilters.tsx
  git commit -m "refactor: SearchPage hookide integreerimine, SearchFilters props struktureerimine"
  ```

---

## Manuaalne testimine (pärast Task 6)

1. Avage `/search` — leht laeb
2. Sisestage otsing — tulemused ilmuvad
3. Filteeri žanri järgi — filter töötab, URL muutub
4. Tagasinupp — URL naaseb, filtrid uuenevad
5. Keel vahetamine — labelid uuenevad
6. Tühjenda filtrid — kõik filtrid kaovad
7. Autor-filter klõpsamine tulemustel — filtreerib

---

## Järjekord

Tasks 1–4 on puhtad lisandused (uued failid) — neid võib teha suvalises järjekorras. Task 5 sõltub Task 4-st (vajab `qCodeMaps` tüüpi). Task 6 sõltub kõigist eelmistest.
