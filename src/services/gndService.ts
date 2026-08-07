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
const DNB_SRU_URL = 'https://services.dnb.de/sru/authorities';

// lobid on üksik veapunkt — 2026-08-07 oli päev otsa kättesaamatu ja hoidis
// kogu välisotsingu (Promise.allSettled) 15 s kinni. Lühike timeout + DNB
// varutee: lobidi parem asetus säilib, aga tema seisak ei blokeeri otsingut.
const LOBID_TIMEOUT_MS = 4000;

/** "Kühlstaedt, Karl" → "Karl Kühlstaedt" */
function normalizeName(preferredName: string): string {
  if (!preferredName.includes(',')) return preferredName;
  const [surname, firstname] = preferredName.split(',', 2);
  return firstname ? `${firstname.trim()} ${surname.trim()}` : preferredName;
}

/**
 * Searches GND for persons matching the query.
 * Esmalt lobid.org, tõrke või tühja tulemuse korral DNB enda SRU-liides.
 */
export async function searchGnd(query: string): Promise<GndSearchResult[]> {
  if (!query || query.length < 2) return [];

  const viaLobid = await searchGndLobid(query);
  if (viaLobid.length > 0) return viaLobid;
  return searchGndSru(query);
}

async function searchGndLobid(query: string): Promise<GndSearchResult[]> {
  try {
    // Filtreeri ainult isikud (Person)
    const params = new URLSearchParams({
      q: query,
      filter: 'type:Person',
      format: 'json',
      size: '5'
    });

    const response = await fetchWithTimeout(`${GND_SEARCH_URL}?${params.toString()}`, { timeout: LOBID_TIMEOUT_MS });
    if (!response.ok) throw new Error('GND search failed');

    const data = await response.json();
    const results: GndSearchResult[] = [];

    for (const item of (data.member || []).slice(0, 5)) {
      const gndId = item.gndIdentifier;
      if (!gndId) continue;

      const preferredName = item.preferredName || '';
      if (!preferredName) continue;

      // Normaliseeri nimi: "Megalinus, Johannes" -> "Johannes Megalinus"
      const label = normalizeName(preferredName);

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
        url: `https://explore.gnd.network/gnd/${gndId}`,
        wikidataId
      });
    }

    return results;
  } catch (error) {
    console.error('GND search error (lobid):', error);
    return [];
  }
}

const SRW_NS = 'http://www.loc.gov/zing/srw/';
const GNDO_NS = 'https://d-nb.info/standards/elementset/gnd#';

/**
 * Varutee: Saksa rahvusraamatukogu enda SRU-liides.
 * CORS on lubatud (`access-control-allow-origin: *`), seega käib otse brauserist.
 * NB: CSP `connect-src` peab lubama services.dnb.de (nginx.host.conf, KAKS rida).
 */
async function searchGndSru(query: string): Promise<GndSearchResult[]> {
  try {
    // SRU ei otsi mitmesõnalist fraasi — iga sõna eraldi tingimusena.
    // BBG=Tp* piirab isikukirjetega (Tp = Person).
    const words = query.trim().split(/\s+/).filter(w => w.length > 1);
    if (words.length === 0) return [];
    const cql = [...words.map(w => `WOE=${w}`), 'BBG=Tp*'].join(' and ');

    const params = new URLSearchParams({
      operation: 'searchRetrieve',
      version: '1.1',
      query: cql,
      recordSchema: 'RDFxml',
      maximumRecords: '5',
    });

    const response = await fetchWithTimeout(`${DNB_SRU_URL}?${params.toString()}`, { timeout: 8000 });
    if (!response.ok) throw new Error('DNB SRU search failed');

    const doc = new DOMParser().parseFromString(await response.text(), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('DNB SRU: vigane XML');

    const results: GndSearchResult[] = [];
    const records = Array.from(doc.getElementsByTagNameNS(SRW_NS, 'recordData'));

    for (const record of records.slice(0, 5)) {
      const text = (tag: string): string | undefined =>
        record.getElementsByTagNameNS(GNDO_NS, tag)[0]?.textContent?.trim() || undefined;

      const gndId = text('gndIdentifier');
      const preferredName = text('preferredNameForThePerson');
      if (!gndId || !preferredName) continue;

      // Wikidata link owl:sameAs seostest
      let wikidataId: string | undefined;
      for (const el of Array.from(record.getElementsByTagName('*'))) {
        if (el.localName !== 'sameAs') continue;
        const ref = el.getAttribute('rdf:resource') ?? el.getAttributeNS('http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'resource') ?? '';
        const match = ref.match(/wikidata\.org\/entity\/(Q\d+)/);
        if (match) { wikidataId = match[1]; break; }
      }

      const birth = text('dateOfBirth');
      const death = text('dateOfDeath');
      const dates = birth || death ? `${birth ?? ''}–${death ?? ''}` : undefined;
      const info = text('biographicalOrHistoricalInformation');
      const description = [dates, info].filter(Boolean).join(' - ') || 'GND';

      results.push({
        id: `GND:${gndId}`,
        gndId,
        label: normalizeName(preferredName),
        description,
        url: `https://explore.gnd.network/gnd/${gndId}`,
        wikidataId,
      });
    }

    return results;
  } catch (error) {
    console.error('GND search error (DNB SRU):', error);
    return [];
  }
}
