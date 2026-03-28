// Jagatud utiliit: ehitab Q-kood → label kaardi Meilisearch hits-idest.
// Kasutatakse nii useQCodeMaps hookis kui getGenreLabelMap/getGenreTypeMap teenustes.

const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;

/**
 * Ehitab id → label kaardi kõigi hits-ide antud välja (nt genre_object / type_object) põhjal.
 * Lisab ka kõik label-variandid (raw + capitalized) otse kaardile, et label→label lookup toimiks.
 */
export function buildIdMap(
    hits: any[],
    field: string,
    langCode: string,
    enrichedLabels: Record<string, Record<string, string>> = {}
): Record<string, string> {
    const map: Record<string, string> = {};
    for (const hit of hits) {
        const obj = hit[field];
        if (!obj) continue;
        const items = Array.isArray(obj) ? obj : [obj];
        for (const item of items) {
            if (!item?.id) continue;
            const currentLabel = cap(
                (enrichedLabels[item.id]?.[langCode]) ||
                item.labels?.[langCode] ||
                item.labels?.['et'] ||
                item.label
            );
            if (!currentLabel) continue;
            map[item.id] = currentLabel;
            if (item.labels) {
                for (const labelVal of Object.values(item.labels)) {
                    if (labelVal) {
                        map[labelVal as string] = currentLabel;
                        map[cap(labelVal as string)] = currentLabel;
                    }
                }
            }
            if (item.label) {
                map[item.label] = currentLabel;
                map[cap(item.label)] = currentLabel;
            }
        }
    }
    return map;
}

/**
 * Ehitab label → id pöördkaardi kõigi hits-ide antud välja põhjal.
 */
export function buildLabelToIdMap(
    hits: any[],
    field: string,
    langCode: string
): Record<string, string> {
    const map: Record<string, string> = {};
    for (const hit of hits) {
        const obj = hit[field];
        if (!obj) continue;
        const items = Array.isArray(obj) ? obj : [obj];
        for (const item of items) {
            if (item?.id && item?.labels) {
                const rawLabel = item.labels[langCode] || item.labels['et'] || item.label;
                if (rawLabel) {
                    map[rawLabel] = item.id;
                    map[cap(rawLabel)] = item.id;
                }
            }
        }
    }
    return map;
}
