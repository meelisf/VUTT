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
