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
