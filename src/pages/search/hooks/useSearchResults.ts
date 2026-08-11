import { useState, useEffect } from 'react';
import { searchContent } from '../../../services/searchService';
import { ContentSearchResponse } from '../../../types';
import { SearchUrlParams } from './useSearchUrlParams';
import { getLangCode } from '../../../utils/getLangCode';
import { useMeiliIndex } from '../../../contexts/MeilisearchContext';

export interface SearchResultsState {
    results: ContentSearchResponse | null;
    loading: boolean;
    error: string | null;
}

const SEARCH_DEBOUNCE_MS = 400;

export function useSearchResults(urlParams: SearchUrlParams, lang: string, selectedCollection: string | null): SearchResultsState {
    const index = useMeiliIndex();
    const [results, setResults] = useState<ContentSearchResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const hasActiveSearch = urlParams.q || urlParams.workId || urlParams.author || urlParams.subjectPerson ||
            urlParams.yearStart !== undefined || urlParams.yearEnd !== undefined ||
            urlParams.scope !== 'all' || urlParams.teoseTags.length > 0 ||
            urlParams.pageTags.length > 0 || urlParams.genres.length > 0 || urlParams.types.length > 0;

        if (!hasActiveSearch) {
            setResults(null);
            return;
        }

        if (!index) return;

        const controller = new AbortController();
        let cancelled = false;
        const timer = window.setTimeout(async () => {
            setLoading(true);
            setError(null);
            try {
                const data = await searchContent(index, urlParams.q, urlParams.page, {
                    yearStart: urlParams.yearStart,
                    yearEnd: urlParams.yearEnd,
                    scope: urlParams.scope,
                    workId: urlParams.workId || undefined,
                    teoseTags: urlParams.teoseTags.length > 0 ? urlParams.teoseTags : undefined,
                    pageTags: urlParams.pageTags.length > 0 ? urlParams.pageTags : undefined,
                    genre: urlParams.genres.length > 0 ? urlParams.genres : undefined,
                    type: urlParams.types.length > 0 ? urlParams.types : undefined,
                    languages: urlParams.languages.length > 0 ? urlParams.languages : undefined,
                    author: urlParams.author || undefined,
                    subjectPerson: urlParams.subjectPerson || undefined,
                    collection: selectedCollection || undefined,
                    lang: getLangCode(lang),
                    signal: controller.signal,
                });
                if (!cancelled) setResults(data);
            } catch (e: any) {
                if (!cancelled && !controller.signal.aborted) setError(e.message || 'Otsinguviga');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [urlParams.q, urlParams.page, urlParams.yearStart, urlParams.yearEnd,
        urlParams.scope, urlParams.workId,
        urlParams.teoseTags.join(','), urlParams.pageTags.join(','),
        urlParams.genres.join(','), urlParams.types.join(','),
        urlParams.author, urlParams.subjectPerson, selectedCollection, lang, index]);

    return { results, loading, error };
}
