export interface FilterItem {
  value: string;
  label: string;
  count: number;
}

/**
 * Ühendab facet-itemid sama Q-koodi all.
 * Lahendab Wikidatas muutunud labelid: "Oratsioon" + "Kõne" → Q861911 (üks item).
 * Kasutatakse nii AdvancedFilters kui SearchFilters komponentides.
 */
export const mergeFacetItems = (
  items: FilterItem[],
  labelToId?: Record<string, string>,
  idToLabel?: Record<string, string>
): FilterItem[] => {
  const merged = new Map<string, FilterItem>();
  for (const item of items) {
    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    const qCode = labelToId?.[item.value] || labelToId?.[capitalize(item.value)];
    const groupKey = qCode || item.value;
    const displayLabel = (qCode && idToLabel?.[qCode]) || idToLabel?.[item.value] || item.label;
    const existing = merged.get(groupKey);
    if (existing) {
      existing.count += item.count;
    } else {
      merged.set(groupKey, { value: qCode || item.value, label: displayLabel, count: item.count });
    }
  }
  return Array.from(merged.values());
};
