/**
 * Service for interacting with Wikidata API to find and retrieve linked data entities.
 */

import { fetchWithTimeout } from '../utils/fetchWithTimeout';

export interface WikidataSearchResult {
  id: string;
  label: string;
  description?: string;
  url: string;
}

const WIKIDATA_API_URL = 'https://www.wikidata.org/w/api.php';

/**
 * Searches Wikidata for entities matching the query.
 * @param query The search string
 * @param lang Preferred language (e.g., 'et', 'en')
 * @returns Array of search results
 */
export async function searchWikidata(query: string, lang: string = 'et'): Promise<WikidataSearchResult[]> {
  if (!query || query.length < 2) return [];

  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: query,
    language: lang,
    format: 'json',
    type: 'item',
    origin: '*', // Required for CORS
  });

  try {
    const response = await fetchWithTimeout(`${WIKIDATA_API_URL}?${params.toString()}`, { timeout: 15000 });
    if (!response.ok) throw new Error('Wikidata search failed');
    
    const data = await response.json();
    if (!data.search) return [];

    return data.search.map((item: any) => ({
      id: item.id,
      label: item.label,
      description: item.description,
      url: item.concepturi || `https://www.wikidata.org/wiki/${item.id}`
    }));
  } catch (error) {
    console.error('Wikidata search error:', error);
    return [];
  }
}

/**
 * Fetches detailed information for a Wikidata entity, including labels in multiple languages.
 * @param id Wikidata ID (e.g., "Q13972")
 * @returns Object with labels in et, en, la, de
 */
export async function getEntityLabels(id: string): Promise<Record<string, string>> {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: id,
    props: 'labels',
    languages: 'et|en|la|de',
    format: 'json',
    origin: '*',
  });

  try {
    const response = await fetchWithTimeout(`${WIKIDATA_API_URL}?${params.toString()}`, { timeout: 15000 });
    if (!response.ok) throw new Error('Wikidata fetch failed');
    
    const data = await response.json();
    const entity = data.entities?.[id];
    if (!entity || !entity.labels) return {};

    const result: Record<string, string> = {};
    for (const [lang, labelObj] of Object.entries(entity.labels)) {
      result[lang] = (labelObj as any).value;
    }
    return result;
  } catch (error) {
    console.error('Wikidata labels fetch error:', error);
    return {};
  }
}

/**
 * Helper to determine Wikidata search context (e.g., restricted to cities, humans, etc.)
 * Note: wbsearchentities doesn't support complex SPARQL filtering easily, 
 * but we can filter results in the UI or use specific properties if needed.
 */
export const WIKIDATA_TYPES = {
  PLACE: 'place',   // Human settlement, city, town
  PERSON: 'person', // Human
  PRINTER: 'printer', // Printer, publisher
  GENRE: 'genre',   // Literary genre, work type
  TOPIC: 'topic',   // General concepts
};
