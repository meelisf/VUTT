import { isQCode } from '../../utils/qcodeUtils';

/** Üks kirje `/prosopography/facets` vastuse `tags` väljast. */
export interface TagFacetItem {
  value: string;
  label: string;
  labels?: Record<string, string> | null;
  count: number;
}

/** Kattub EntityPicker'i SuggestionItem-iga (EntityPicker.tsx:14-18). */
export interface TagSuggestion {
  label: string;
  id: string | null;
  labels?: Record<string, string> | null;
}

/**
 * Teisendab märksõna-facetid EntityPicker'i kohalikeks soovitusteks.
 *
 * Järjestust EI muudeta — facet tuleb juba sageduse järjekorras ja
 * EntityPicker'i sort on stabiilne, seega sagedasemad jäävad ettepoole.
 */
export function mapTagFacetsToSuggestions(
  facetTags: TagFacetItem[] | null | undefined,
  lang: string,
): TagSuggestion[] {
  if (!facetTags?.length) return [];
  const baseLang = (lang || 'et').split('-')[0];
  const result: TagSuggestion[] = [];
  for (const item of facetTags) {
    if (!item) continue;
    const labels = item.labels ?? null;
    const label = (
      labels?.[baseLang] ?? labels?.['et'] ?? labels?.['en'] ?? item.label ?? ''
    ).trim();
    if (!label) continue;
    // Q-koodita märksõnal on facetis `value` = label, mis ei ole identifikaator.
    result.push({ label, id: isQCode(item.value) ? item.value : null, labels });
  }
  return result;
}
