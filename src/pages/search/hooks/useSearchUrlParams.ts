import { useSearchParams } from 'react-router-dom';

/** Komadega eraldatud URL-parameeter → massiiv. Tühjad osad kukuvad välja. */
export function parseListParam(value: string | null): string[] {
    return value?.split(',').filter(Boolean) || [];
}

export interface SearchUrlParams {
    q: string;
    page: number;
    workId: string;
    yearStart: number | string | undefined;
    yearEnd: number | string | undefined;
    scope: 'all' | 'original' | 'annotation';
    teoseTags: string[];
    pageTags: string[];
    genres: string[];
    types: string[];
    languages: string[];
    author: string;
    subjectPerson: string;
}

export function useSearchUrlParams(): SearchUrlParams {
    const [searchParams] = useSearchParams();
    return {
        q: searchParams.get('q') || '',
        page: parseInt(searchParams.get('p') || '1', 10),
        workId: searchParams.get('work') || '',
        yearStart: searchParams.get('ys') ? parseDateParam(searchParams.get('ys')!) : undefined,
        yearEnd: searchParams.get('ye') ? parseDateParam(searchParams.get('ye')!) : undefined,
        scope: (searchParams.get('scope') as 'all' | 'original' | 'annotation') || 'all',
        teoseTags: parseListParam(searchParams.get('teoseTags')),
        pageTags: parseListParam(searchParams.get('pageTags')),
        genres: parseListParam(searchParams.get('genre')),
        types: parseListParam(searchParams.get('type')),
        languages: parseListParam(searchParams.get('langs')),
        author: searchParams.get('author') || '',
        subjectPerson: searchParams.get('subjectPerson') || '',
    };
}

// Preserve partial dates in URLs; keep legacy year-only callers numeric.
export function parseDateParam(value: string): number | string {
    return /^\d{3,4}$/.test(value) ? Number(value) : value;
}
