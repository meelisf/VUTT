/**
 * Service for interacting with GND (Gemeinsame Normdatei) via lobid.org API.
 * Saksa rahvusraamatukogu autoriteedifail - hea ajalooliste isikute jaoks.
 *
 * Eelised VIAF ees:
 * - Stabiilsed ID-d
 * - Puhas JSON API
 * - Sisaldab Wikidata linke
 */

import { fetchWithTimeout } from '../utils/fetchWithTimeout';

export interface GndSearchResult {
  id: string;        // "GND:1202439284" formaadis
  gndId: string;     // Ainult number "1202439284"
  label: string;     // Nimi (preferredName)
  description?: string;
  url: string;
  wikidataId?: string;  // Kui on seotud Wikidataga
}

const GND_SEARCH_URL = 'https://lobid.org/gnd/search';

/**
 * Searches GND for persons matching the query.
 */
export async function searchGnd(query: string): Promise<GndSearchResult[]> {
  if (!query || query.length < 2) return [];

  try {
    // Filtreeri ainult isikud (Person)
    const params = new URLSearchParams({
      q: query,
      filter: 'type:Person',
      format: 'json',
      size: '5'
    });

    const response = await fetchWithTimeout(`${GND_SEARCH_URL}?${params.toString()}`, { timeout: 15000 });
    if (!response.ok) throw new Error('GND search failed');

    const data = await response.json();
    const results: GndSearchResult[] = [];

    for (const item of (data.member || []).slice(0, 5)) {
      const gndId = item.gndIdentifier;
      if (!gndId) continue;

      const preferredName = item.preferredName || '';
      if (!preferredName) continue;

      // Normaliseeri nimi: "Megalinus, Johannes" -> "Johannes Megalinus"
      let label = preferredName;
      if (preferredName.includes(',')) {
        const [surname, firstname] = preferredName.split(',', 2);
        if (firstname) {
          label = `${firstname.trim()} ${surname.trim()}`;
        }
      }

      // Leia Wikidata link sameAs seostest
      let wikidataId: string | undefined;
      for (const sameAs of (item.sameAs || [])) {
        const sameAsId = sameAs.id || '';
        if (sameAsId.includes('wikidata.org/entity/Q')) {
          const match = sameAsId.match(/Q\d+/);
          if (match) {
            wikidataId = match[0];
            break;
          }
        }
      }

      // Lisa kirjeldus (eluaastad, koht jne)
      let description = 'GND';
      const dates = item.dateOfBirthAndDeath?.[0] || item.periodOfActivity?.[0];
      const info = item.biographicalOrHistoricalInformation?.[0];
      if (dates || info) {
        const parts = [dates, info].filter(Boolean);
        description = parts.join(' - ');
      }

      results.push({
        id: `GND:${gndId}`,
        gndId,
        label,
        description,
        url: `https://d-nb.info/gnd/${gndId}`,
        wikidataId
      });
    }

    return results;
  } catch (error) {
    console.error('GND search error:', error);
    return [];
  }
}
