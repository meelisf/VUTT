/**
 * Service for interacting with VIAF (Virtual International Authority File) API.
 * Kasutab SRU otsingut, mis leiab isikuid kõikide nimekujude järgi.
 */

export interface ViafSearchResult {
  id: string;        // "VIAF:12345" formaadis
  viafId: string;    // Ainult number "12345"
  label: string;     // Normaliseeritud nimi
  rawLabel: string;  // VIAF originaalnimi
  description?: string;
  url: string;
}

const VIAF_SEARCH_URL = 'https://viaf.org/viaf/search';

/**
 * Normaliseerib VIAF nimekuju.
 * 'Turdinus, Petrus' -> 'Petrus Turdinus'
 * 'Gezelius, Johannes, 1615-1690' -> 'Johannes Gezelius'
 */
function normalizeViafName(name: string): string {
  if (!name) return name;

  // Eemalda lõpust punkt
  name = name.replace(/\.+$/, '');

  // Eemalda daatumid ja sajandid
  name = name.replace(/,?\s*\d{4}\s*-\s*\d{4}\.?\s*$/, '');  // "1615-1690"
  name = name.replace(/,?\s*\d{4}\s*-\s*$/, '');  // "1615-"
  name = name.replace(/,?\s*-\s*\d{4}\s*$/, '');  // "-1690"
  name = name.replace(/,?\s*d\.\s*\d{4}\s*$/, '');  // "d. 1682"
  name = name.replace(/,?\s*b\.\s*\d{4}\s*$/, '');  // "b. 1615"
  name = name.replace(/,?\s*fl\.\s*\d{4}\s*$/, '');  // "fl. 1650"
  name = name.replace(/,?\s*ca\.?\s*\d{4}\s*-\s*ca\.?\s*\d{4}\s*$/, '');  // "ca. 1600-ca. 1650"
  name = name.replace(/,?\s*ca\.?\s*\d{1,2}\.\s*Jh\.?\s*$/i, '');  // "ca. 17. Jh"
  name = name.replace(/,?\s*\d{1,2}\.\s*Jh\.?\s*$/i, '');  // "17. Jh"
  name = name.replace(/,?\s*\d{1,2}th\s+cent\.?\s*$/i, '');  // "17th cent."

  // Kui on koma, pööra ümber: "Perenimi, Eesnimi" -> "Eesnimi Perenimi"
  if (name.includes(',')) {
    const parts = name.split(',', 2);
    if (parts.length === 2) {
      const surname = parts[0].trim();
      let firstname = parts[1].trim();
      // Eemalda võimalikud lisad eesnimest
      firstname = firstname.replace(/\s+(Jr\.?|Sr\.?|I+V?|V?I*)$/, '');
      name = `${firstname} ${surname}`;
    }
  }

  return name.trim();
}

/**
 * Searches VIAF for persons matching the query.
 * Kasutab SRU API-t, mis otsib kõikidest nimekujudest.
 */
export async function searchViaf(query: string): Promise<ViafSearchResult[]> {
  if (!query || query.length < 2) return [];

  try {
    const response = await fetch(`${VIAF_SEARCH_URL}?query=${encodeURIComponent(query)}`, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) throw new Error('VIAF search failed');

    // NB: VIAF ID-d võivad olla väga suured (>2^53), mis kaotavad täpsuse JSON.parse-is
    // Seepärast asendame numbrilised viafID-d stringidega enne parsimist
    let rawText = await response.text();
    rawText = rawText.replace(/"ns2:viafID":(\d+)/g, '"ns2:viafID":"$1"');

    const data = JSON.parse(rawText);
    const results: ViafSearchResult[] = [];

    // SRU vastuse struktuur
    const srw = data?.searchRetrieveResponse || {};
    const records = srw?.records || {};
    let recordList = records?.record || [];

    // Võib olla üks kirje (dict) või mitu (list)
    if (!Array.isArray(recordList)) {
      recordList = [recordList];
    }

    for (const record of recordList.slice(0, 5)) {
      const recordData = record?.recordData || {};
      const cluster = recordData?.['ns2:VIAFCluster'] || {};

      if (!cluster) continue;

      const viafId = cluster?.['ns2:viafID'];
      if (!viafId) continue;

      // Nimed on mainHeadings all
      const mainHeadings = cluster?.['ns2:mainHeadings'] || {};
      let headingData = mainHeadings?.['ns2:data'] || [];

      if (!Array.isArray(headingData)) {
        headingData = [headingData];
      }

      // Võta esimene nimi
      let rawLabel = '';
      for (const hd of headingData) {
        const text = hd?.['ns2:text'] || '';
        if (text) {
          rawLabel = text;
          break;
        }
      }

      if (!rawLabel) continue;

      const label = normalizeViafName(rawLabel);
      const viafIdStr = String(viafId);

      results.push({
        id: `VIAF:${viafIdStr}`,
        viafId: viafIdStr,
        label,
        rawLabel,
        description: rawLabel !== label ? `VIAF: ${rawLabel}` : 'VIAF',
        url: `https://viaf.org/viaf/${viafIdStr}`
      });
    }

    return results;
  } catch (error) {
    console.error('VIAF search error:', error);
    return [];
  }
}
