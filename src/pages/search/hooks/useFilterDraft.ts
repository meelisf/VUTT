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
    selectedPersonTag: string;
    personTagInput: string;
    showPersonSuggestions: boolean;
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
    setPersonTagInput: (v: string) => void;
    setShowPersonSuggestions: (v: boolean) => void;
    commit: (e?: FormEvent) => void;
    clearFilters: () => void;
    handleAuthorSelect: (author: string) => void;
    handleAuthorClear: () => void;
    handleWorkSelect: (id: string, info: { title: string; year?: string | number; author?: string } | null) => void;
    handlePersonTagSelect: (personId: string, label: string) => void;
    handlePersonTagClear: () => void;
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
    const [selectedPersonTag, setSelectedPersonTag] = useState(urlParams.subjectPerson);
    const [personTagInput, setPersonTagInput] = useState(urlParams.subjectPerson);
    const [showPersonSuggestions, setShowPersonSuggestions] = useState(false);
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
        setSelectedPersonTag(urlParams.subjectPerson);
        setPersonTagInput(urlParams.subjectPerson);
    }, [urlParams.q, urlParams.scope, urlParams.workId,
        urlParams.teoseTags.join(','), urlParams.pageTags.join(','),
        urlParams.genres.join(','), urlParams.types.join(','), urlParams.author, urlParams.subjectPerson]);

    const { genreLabelToId, typeLabelToId, tagsLabelToId } = qCodeMaps;

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
                if (selectedPersonTag) prev.set('subjectPerson', selectedPersonTag); else prev.delete('subjectPerson');
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
        setSelectedPersonTag(''); setPersonTagInput('');
        setSearchParams(prev => {
            ['ys', 'ye', 'scope', 'work', 'teoseTags', 'pageTags', 'genre', 'type', 'author', 'subjectPerson'].forEach(k => prev.delete(k));
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

    const handlePersonTagSelect = (personId: string, label: string) => {
        setPersonTagInput(label);
        setSelectedPersonTag(personId);
        setShowPersonSuggestions(false);
        setSearchParams(prev => { prev.set('subjectPerson', personId); prev.set('p', '1'); return prev; });
    };

    const handlePersonTagClear = () => {
        setPersonTagInput('');
        setSelectedPersonTag('');
        setShowPersonSuggestions(false);
        setSearchParams(prev => { prev.delete('subjectPerson'); prev.set('p', '1'); return prev; });
    };

    const handleWorkSelect = (id: string, info: { title: string; year?: string | number; author?: string } | null) => {
        setSelectedWork(id);
        setSelectedWorkInfo(info);
    };

    return {
        draft: {
            inputValue, yearStart, yearEnd, selectedScope, selectedWork, selectedWorkInfo,
            selectedTeoseTags, selectedPageTags, selectedGenres, selectedTypes,
            selectedAuthor, authorInput, showAuthorSuggestions,
            selectedPersonTag, personTagInput, showPersonSuggestions,
            showFiltersMobile
        },
        actions: {
            setInputValue, setYearStart, setYearEnd, setSelectedScope,
            setSelectedWork, setSelectedWorkInfo, setSelectedTeoseTags,
            setSelectedPageTags, setSelectedGenres, setSelectedTypes,
            setSelectedAuthor, setAuthorInput, setShowAuthorSuggestions, setShowFiltersMobile,
            setPersonTagInput, setShowPersonSuggestions,
            commit, clearFilters, handleAuthorSelect, handleAuthorClear, handleWorkSelect,
            handlePersonTagSelect, handlePersonTagClear,
        }
    };
}
