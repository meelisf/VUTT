import { useSearchParams } from 'react-router-dom';

/** Komadega eraldatud URL-parameeter → massiiv. Tühjad osad kukuvad välja. */
export function parseListParam(value: string | null): string[] {
    return value?.split(',').filter(Boolean) || [];
}

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
        yearStart: searchParams.get('ys') ? parseInt(searchParams.get('ys')!) : undefined,
        yearEnd: searchParams.get('ye') ? parseInt(searchParams.get('ye')!) : undefined,
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
