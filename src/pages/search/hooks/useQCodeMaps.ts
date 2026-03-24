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
    }, [genreLabelToId, searchParams, setSearchParams]);

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
    }, [typeLabelToId, searchParams, setSearchParams]);

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
    }, [tagsLabelToId, searchParams, setSearchParams]);

    return {
        genreIdMap, genreLabelToId, typeIdMap, typeLabelToId,
        tagsIdMap, tagsLabelToId, pageTagsIdMap, knownPageTagsLabels, enrichedLabels
    };
}
