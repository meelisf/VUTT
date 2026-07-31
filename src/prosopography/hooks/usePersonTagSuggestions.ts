import { useEffect, useMemo, useState } from 'react';
import { getPersonFacets } from '../services/prosopographyService';
import { mapTagFacetsToSuggestions, type TagFacetItem, type TagSuggestion } from '../utils/tagSuggestions';

const CACHE_TTL_MS = 300_000; // 5 min

// Mooduli-tasemel vahemälu: isikult isikule liikudes ei päri uuesti.
// get_person_facets skaneerib serveris ~2000 indeksikirjet iga kutse peale.
// Hoiame TOORE facet-vastuse — see on keelest sõltumatu, teisendus käib eraldi.
let cachedFacetTags: TagFacetItem[] | null = null;
let cachedAt = 0;

/**
 * Isikutel juba kasutusel olevad märksõnad EntityPicker'i kohalike
 * soovitustena, sagedasemad eespool.
 *
 * @param lang   aktiivne UI keel (nt "et", "en-GB")
 * @param enabled kas päring üldse teha — anna `canEdit`, muidu käivitaks
 *                iga anonüümne külastaja serveris täisskaneeringu
 * @param token  autentimistoken (valikuline, endpoint lubab ka anonüümset)
 */
export function usePersonTagSuggestions(lang: string, enabled: boolean, token?: string): TagSuggestion[] {
  const [facetTags, setFacetTags] = useState<TagFacetItem[]>(() =>
    cachedFacetTags && Date.now() - cachedAt < CACHE_TTL_MS ? cachedFacetTags : [],
  );

  useEffect(() => {
    if (!enabled) return;
    if (cachedFacetTags && Date.now() - cachedAt < CACHE_TTL_MS) {
      setFacetTags(cachedFacetTags);
      return;
    }
    let cancelled = false;
    getPersonFacets(undefined, token)
      .then(data => {
        const items = (data.tags || []) as TagFacetItem[];
        cachedFacetTags = items;
        cachedAt = Date.now();
        if (!cancelled) setFacetTags(items);
      })
      // Soovitused on abivahend, mitte blokeerija — vea korral jääb loend tühjaks.
      .catch(() => { if (!cancelled) setFacetTags([]); });
    return () => { cancelled = true; };
  }, [enabled, token]);

  return useMemo(() => mapTagFacetsToSuggestions(facetTags, lang), [facetTags, lang]);
}
