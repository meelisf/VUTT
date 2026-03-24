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
