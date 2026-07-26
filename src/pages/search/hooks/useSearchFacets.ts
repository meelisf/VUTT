// src/pages/search/hooks/useSearchFacets.ts
import { useState, useEffect } from 'react';
import { getTeoseTagsFacets, getGenreFacets, getTypeFacets, getAuthorFacets, getTagsLabelMap } from '../../../services/searchService';
import { getVocabularies, Vocabularies } from '../../../services/collectionService';
import { ContentSearchResponse } from '../../../types';
import { SearchUrlParams } from './useSearchUrlParams';
import { getLangCode } from '../../../utils/getLangCode';
import { FILE_API_URL } from '../../../config';
import { useMeiliIndex } from '../../../contexts/MeilisearchContext';
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
    tagLabels: Record<string, string>; // Q-kood → label (laetud tags_object-ist)
}

const FACET_DEBOUNCE_MS = 400;

const isAbortError = (error: unknown) =>
    (error instanceof DOMException && error.name === 'AbortError') ||
    (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError');

export function useSearchFacets(
    urlParams: SearchUrlParams,
    lang: string,
    selectedCollection: string | null,
    results: ContentSearchResponse | null
): FacetsState {
    const index = useMeiliIndex();
    const [availableTeoseTags, setAvailableTeoseTags] = useState<{ tag: string; count: number }[]>([]);
    const [availableGenres, setAvailableGenres] = useState<{ value: string; count: number }[]>([]);
    const [availableTypes, setAvailableTypes] = useState<{ value: string; count: number }[]>([]);
    const [availableAuthors, setAvailableAuthors] = useState<{ value: string; count: number }[]>([]);
    const [vocabularies, setVocabularies] = useState<Vocabularies | null>(null);
    const [aliasMap, setAliasMap] = useState<Record<string, string>>({});
    const [tagLabels, setTagLabels] = useState<Record<string, string>>({});

    // Alglaadimine: vocabularies + aliased + (kui pole aktiivset filtrit) facetid
    useEffect(() => {
        const controller = new AbortController();
        let cancelled = false;
        const timer = window.setTimeout(async () => {
            try {
                const [vocabs, aliasRes] = await Promise.all([
                    getVocabularies(),
                    fetch(`${FILE_API_URL}/people-aliases`, { signal: controller.signal }).then(r => r.ok ? r.json() : null).catch(e => isAbortError(e) ? null : Promise.reject(e))
                ]);
                if (cancelled) return;
                setVocabularies(vocabs);
                if (aliasRes?.status === 'success' && aliasRes.aliases) setAliasMap(aliasRes.aliases);

                const hasActiveContentFilters = !!urlParams.q || !!urlParams.workId || !!urlParams.author ||
                    urlParams.teoseTags.length > 0 || urlParams.genres.length > 0 || urlParams.types.length > 0;
                if (hasActiveContentFilters || !index) return;

                const facetLang = getLangCode(lang);
                const [tags, genres, types, authors] = await Promise.all([
                    getTeoseTagsFacets(index, selectedCollection || undefined, facetLang, urlParams.yearStart, urlParams.yearEnd, controller.signal),
                    getGenreFacets(index, selectedCollection || undefined, facetLang, urlParams.yearStart, urlParams.yearEnd, controller.signal),
                    getTypeFacets(index, selectedCollection || undefined, facetLang, urlParams.yearStart, urlParams.yearEnd, controller.signal),
                    getAuthorFacets(index, selectedCollection || undefined, urlParams.yearStart, urlParams.yearEnd, controller.signal),
                ]);
                if (cancelled) return;
                // Labelid lahendatakse facetist saadud Q-koodidele; register on juba
                // mälus (useQCodeMaps laeb selle), seega tavaliselt lisapäringut pole (#179).
                const labels = await getTagsLabelMap(index, tags.map(t => t.tag), facetLang, controller.signal);
                if (cancelled) return;
                setTagLabels(labels);
                setAvailableTeoseTags(mergeSelectedIntoTags(tags, urlParams.teoseTags));
                setAvailableGenres(mergeSelectedIntoFacets(genres, urlParams.genres));
                setAvailableTypes(mergeSelectedIntoFacets(types, urlParams.types));
                setAvailableAuthors(authors);
            } catch (e) {
                if (!cancelled && !controller.signal.aborted && !isAbortError(e)) console.warn('Filtrite andmete laadimine ebaõnnestus:', e);
            }
        }, FACET_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [selectedCollection, lang, urlParams.yearStart, urlParams.yearEnd,
        urlParams.q, urlParams.workId, urlParams.author,
        urlParams.teoseTags.length, urlParams.genres.length, urlParams.types.length, index]);

    // Uuenda facets otsinguvastusest
    useEffect(() => {
        if (!results?.facetDistribution) return;
        const processFacets = (field: string) => {
            let dist = results.facetDistribution?.[field];
            if (!dist && field.includes('_')) dist = results.facetDistribution?.[field.split('_')[0]];
            return Object.entries(dist || {})
                .map(([value, count]) => ({ value, count: count as number }))
                .sort((a, b) => b.count - a.count);
        };
        const newGenres = processFacets('genre_ids');
        const newTypes = processFacets('type_ids');
        const newTags = processFacets('tags_ids').map(t => ({ tag: t.value, count: t.count }));
        const newAuthors = processFacets('author_names');
        setAvailableTeoseTags(prev => mergeTagsWithExisting(prev, newTags, urlParams.teoseTags));
        setAvailableGenres(prev => mergeFacetsWithExisting(prev, newGenres, urlParams.genres));
        setAvailableTypes(prev => mergeFacetsWithExisting(prev, newTypes, urlParams.types));
        setAvailableAuthors(newAuthors);
    }, [results, lang, urlParams.teoseTags.join(','), urlParams.genres.join(','), urlParams.types.join(',')]);

    return { availableTeoseTags, availableGenres, availableTypes, availableAuthors, vocabularies, aliasMap, tagLabels };
}
