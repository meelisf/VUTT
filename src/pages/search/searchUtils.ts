// Otsingulehe abifunktsioonid — eraldatud SearchPage.tsx-st

import { ContentSearchHit } from '../../types';
import { IMAGE_BASE_URL } from '../../config';

export const getImageUrl = (imagePath: string): string => {
    if (!imagePath) return '';
    const cleanPath = imagePath.startsWith('/') ? imagePath.slice(1) : imagePath;
    return `${IMAGE_BASE_URL}/${encodeURI(cleanPath)}`;
};

export const getPageThumbUrl = (workId: string, imagePath: string): string => {
    if (!workId || !imagePath) return '';
    const filename = imagePath.split('/').pop() || '';
    return `${IMAGE_BASE_URL}/${workId}/_thumbs/_thumb_${filename}`;
};

export const getAuthorDisplay = (hit: ContentSearchHit, t: (key: string) => string): string => {
    if (hit.creators && hit.creators.length > 0) {
        // Prioriteet: praeses > auctor > esimene
        const praeses = hit.creators.find(c => c.role === 'praeses');
        if (praeses) return praeses.name;
        const auctor = hit.creators.find(c => c.role === 'auctor');
        if (auctor) return auctor.name;
        return hit.creators[0].name;
    }
    const autor = (hit as any).autor;
    if (autor) {
        return Array.isArray(autor) ? autor[0] : autor;
    }
    return t('status.unknown');
};

// Merge uued facetid olemasolevate hulka, säilitades kõik valikud
// - Uuendab olemasolevate countid
// - Lisab uued valikud
// - Säilitab valitud valikud (count=0 kui pole uutes)
export const mergeFacetsWithExisting = (
    existing: { value: string; count: number }[],
    newFacets: { value: string; count: number }[],
    selected: string[]
): { value: string; count: number }[] => {
    const newMap = new Map(newFacets.map(f => [f.value, f.count]));
    const result: { value: string; count: number }[] = [];
    const seen = new Set<string>();

    for (const item of existing) {
        if (!item.value) continue;
        result.push({ value: item.value, count: newMap.get(item.value) ?? 0 });
        seen.add(item.value);
    }
    for (const item of newFacets) {
        if (item.value && !seen.has(item.value)) {
            result.push(item);
            seen.add(item.value);
        }
    }
    for (const sel of selected) {
        if (sel && !seen.has(sel)) result.push({ value: sel, count: 0 });
    }
    return result.sort((a, b) => b.count - a.count);
};

// Sama loogika teoseTags jaoks (erinev struktuur: tag vs value)
export const mergeTagsWithExisting = (
    existing: { tag: string; count: number }[],
    newTags: { tag: string; count: number }[],
    selected: string[]
): { tag: string; count: number }[] => {
    const newMap = new Map(newTags.map(t => [t.tag, t.count]));
    const result: { tag: string; count: number }[] = [];
    const seen = new Set<string>();

    for (const item of existing) {
        if (!item.tag) continue;
        result.push({ tag: item.tag, count: newMap.get(item.tag) ?? 0 });
        seen.add(item.tag);
    }
    for (const item of newTags) {
        if (item.tag && !seen.has(item.tag)) {
            result.push(item);
            seen.add(item.tag);
        }
    }
    for (const sel of selected) {
        if (sel && !seen.has(sel)) result.push({ tag: sel, count: 0 });
    }
    return result.sort((a, b) => b.count - a.count);
};

// Lihtne merge valitud väärtuste lisamiseks (initial load jaoks)
export const mergeSelectedIntoFacets = (
    facets: { value: string; count: number }[],
    selected: string[]
): { value: string; count: number }[] => {
    const existing = new Set(facets.map(f => f.value));
    const merged = [...facets];
    for (const sel of selected) {
        if (sel && !existing.has(sel)) merged.push({ value: sel, count: 0 });
    }
    return merged;
};

export const mergeSelectedIntoTags = (
    tags: { tag: string; count: number }[],
    selected: string[]
): { tag: string; count: number }[] => {
    const existing = new Set(tags.map(t => t.tag));
    const merged = [...tags];
    for (const sel of selected) {
        if (sel && !existing.has(sel)) merged.push({ tag: sel, count: 0 });
    }
    return merged;
};
