/**
 * Otsing, sirvimis- ja facet-päringud Meilisearchist
 */

import { Work, ContentSearchResponse, ContentSearchOptions, ContentSearchHit } from '../types';
import { MEILI_HOST } from '../config';
import { checkMixedContent, normalizeWork, normalizeContentSearchHit } from './meiliService';
import { buildTagFilter, buildPageTagFilter, buildGenreFilter, buildTypeFilter, buildPrinterFilter, buildMultiFilter } from '../utils/filterUtils';
import { buildIdMap } from '../utils/buildObjectIdMap';
import { getEntityLabelsCache } from './entityLabelsService';
import { pickLabelByLang } from '../utils/labelUtils';
import type { MatchingStrategies, Index } from 'meilisearch';
import { HIGHLIGHT_PRE_TAG, HIGHLIGHT_POST_TAG } from '../utils/sanitizeHtml';

/**
 * ß → ss otsingupäringus (#228).
 *
 * Meilisearch voldib täpitähed ise (`Königsberg` == `Konigsberg`), aga ß-i mitte,
 * sest Unicode NFKD ei lagunda seda. Kirjaveataluvus ei kata auku: `daß` on 4 märki,
 * mille puhul Meili lubab null kirjaviga.
 *
 * Indeksipool teeb sama teisenduse (`normalize_eszett`, `server/meili_doc.py`).
 * MÕLEMAD pooled on kohustuslikud — ainult indeksi normaliseerimine tähendaks,
 * et `Schluß` otsimine ei leiaks enam midagi. Lihtne märgiasendus töötab ka
 * fraasiotsingu jutumärkide sees. Filtreid see EI puuduta.
 */
export const normalizeSearchQuery = (query: string): string =>
  (query || '').replace(/ß/g, 'ss').replace(/ẞ/g, 'SS');

// Aastafilter vahemike kattuvusena: teose [year_start, year_end] kattub kasutaja vahemikuga.
// Kattuvus: A.end >= B.start AND A.start <= B.end.
// Aastata teosed (year_start=year_end=0) käituvad nagu varasem year=0.
const pushYearFilter = (filter: string[], yearStart?: number, yearEnd?: number): void => {
  if (yearStart) filter.push(`year_end >= ${yearStart}`);
  if (yearEnd) filter.push(`year_start <= ${yearEnd}`);
};

const isAbortError = (error: unknown): boolean =>
  (error instanceof DOMException && error.name === 'AbortError') ||
  (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError');

// Interface for dashboard search options
export interface DashboardSearchOptions {
  yearStart?: number;
  yearEnd?: number;
  sort?: string;
  author?: string;
  respondens?: string;
  printer?: string; // trükkal
  workStatus?: string; // Teose koondstaatuse filter
  teoseTags?: string[]; // Teose märksõnad (AND loogika)
  pageTags?: string[]; // Lehekülje märksõnad (AND loogika, page_tags_ids)
  onlyFirstPage?: boolean;
  // V2 väljad
  collection?: string; // Kollektsiooni filter (filtreerib collections_hierarchy järgi)
  genre?: string[]; // Žanri filter (OR loogika - mitu valikut lubatud)
  type?: string[]; // Tüübi filter (OR loogika - mitu valikut lubatud)
  languages?: string[]; // Teose keele filter (OR loogika, ISO 639-3: lat, grc, deu…)
  lang?: string; // UI keel (et, en) siltide lahendamiseks — MITTE teose keele filter
  signal?: AbortSignal; // Poolelioleva Meilisearchi päringu katkestamine
  offset?: number; // Serveripoolse lehekülgjaotuse algus
  limit?: number; // Serveripoolse lehekülje suurus
}

// Facetide vastuse tüüp
export interface FacetDistribution {
  genre_ids?: Record<string, number>; // Q-koodid, keeleneutraalne
  type_ids?: Record<string, number>;  // Q-koodid, keeleneutraalne
  tags_ids?: Record<string, number>;  // Q-koodid, keeleneutraalne
  teose_staatus?: Record<string, number>;
  // ISO 639-3 koodid. Loendur on teosepõhine AINULT siis, kui päring filtreeris
  // `lehekylje_number = 1` (searchWorks vaikimisi) — muidu loeb see lehekülgi.
  languages?: Record<string, number>;
}

// Otsingu vastuse tüüp koos facetidega
export interface SearchWorksResult {
  works: Work[];
  facets: FacetDistribution;
  totalHits: number;
}

// Saab kõik teose märksõnad (tags) koos loendiga - facet query
// Valikuline collection parameeter filtreerib kollektsiooni järgi
// yearStart/yearEnd võimaldavad filtrite dünaamilist uuendamist aasta vahemiku järgi
export const getTeoseTagsFacets = async (
  index: Index,
  collection?: string,
  _lang: string = 'et',
  yearStart?: number,
  yearEnd?: number,
  signal?: AbortSignal
): Promise<{ tag: string; count: number }[]> => {
  checkMixedContent();

  // Vali õige väli vastavalt keelele
  // Kasutame tags_ids (Q-koodid) — keeleneutraalne, väldib duplikaate kui sama Q-koodi label erineb teoseti
  const facetField = 'tags_ids';

  try {
    const filter: string[] = ['lehekylje_number = 1'];
    if (collection) {
      filter.push(`collections_hierarchy = "${collection}"`);
    }
    pushYearFilter(filter, yearStart, yearEnd);

    const response = await index.search('', {
      filter,
      limit: 0,
      facets: [facetField]
    }, signal ? { signal } : undefined);

    const facetDistribution = response.facetDistribution?.[facetField] || {};

    const result = Object.entries(facetDistribution)
      .map(([tag, count]) => ({ tag, count: count as number }))
      .sort((a, b) => b.count - a.count);

    return result;
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    console.error("getTeoseTagsFacets error:", error);
    return [];
  }
};

// Saab kõik žanrid (genre) koos loendiga - facet query
// yearStart/yearEnd võimaldavad filtrite dünaamilist uuendamist aasta vahemiku järgi
export const getGenreFacets = async (
  index: Index,
  collection?: string,
  _lang: string = 'et',
  yearStart?: number,
  yearEnd?: number,
  signal?: AbortSignal
): Promise<{ value: string; count: number }[]> => {
  checkMixedContent();

  // Kasutame genre_ids (Q-koodid) — keeleneutraalne, väldib duplikaate kui sama Q-koodi label erineb teoseti
  const facetField = 'genre_ids';

  try {
    const filter: string[] = ['lehekylje_number = 1'];
    if (collection) {
      filter.push(`collections_hierarchy = "${collection}"`);
    }
    pushYearFilter(filter, yearStart, yearEnd);

    const response = await index.search('', {
      filter,
      limit: 0,
      facets: [facetField]
    }, signal ? { signal } : undefined);

    const facetDistribution = response.facetDistribution?.[facetField] || {};

    const result = Object.entries(facetDistribution)
      .map(([value, count]) => ({ value, count: count as number }))
      .sort((a, b) => b.count - a.count);

    return result;
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    console.error("getGenreFacets error:", error);
    return [];
  }
};

// Saab kõik tüübid (type) koos loendiga - facet query
// yearStart/yearEnd võimaldavad filtrite dünaamilist uuendamist aasta vahemiku järgi
export const getTypeFacets = async (
  index: Index,
  collection?: string,
  _lang: string = 'et',
  yearStart?: number,
  yearEnd?: number,
  signal?: AbortSignal
): Promise<{ value: string; count: number }[]> => {
  checkMixedContent();

  // Kasutame type_ids (Q-koodid) — keeleneutraalne, väldib duplikaate kui sama Q-koodi label erineb teoseti
  const facetField = 'type_ids';

  try {
    const filter: string[] = ['lehekylje_number = 1'];
    if (collection) {
      filter.push(`collections_hierarchy = "${collection}"`);
    }
    pushYearFilter(filter, yearStart, yearEnd);

    const response = await index.search('', {
      filter,
      limit: 0,
      facets: [facetField]
    }, signal ? { signal } : undefined);

    const facetDistribution = response.facetDistribution?.[facetField] || {};

    const result = Object.entries(facetDistribution)
      .map(([value, count]) => ({ value, count: count as number }))
      .sort((a, b) => b.count - a.count);

    return result;
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    console.error("getTypeFacets error:", error);
    return [];
  }
};

// Registrist puuduvate Q-koodide lünga-täite ülempiir. Nii palju esilehti piisab, et
// katta üksikud registrist puuduvad koodid; erinevalt vanast limit:5000-st on see
// päring haruldane (normaalolukorras null päringut).
const LABEL_GAPFILL_LIMIT = 200;

/**
 * Q-kood → label ANTUD koodide kohta, kanoonilisest `labels.json` registrist.
 *
 * Register tuleb `/entity-labels`-ist (module-cache ~26 KB, jagatud kõigi lehtedega),
 * seega tavaolukorras EI tehta ühtegi Meili päringut. Varem skaneeriti labelite
 * saamiseks dokumente (`limit: 5000` žanritel, `limit: 200` märksõnadel) — need olid
 * nii aeglasemad kui ka vaikselt kärbitud (#179, #184).
 *
 * Register on tuletatud andmestik ja võib teosest maha jääda (nt teos, mida pole
 * enrichimise lisandumise järel salvestatud), samuti pole seal VUTT isiku-ID-sid.
 * Lüngad täidame ühe piiratud dokumendipäringuga; vea korral kukub UI tagasi
 * Q-koodile nagu varemgi.
 */
const resolveLabelsFromRegistry = async (
  index: Index,
  qcodes: string[],
  lang: string,
  fields: { idsField: string; objectField: string },
  signal?: AbortSignal,
): Promise<Record<string, string>> => {
  if (!qcodes.length) return {};

  const map: Record<string, string> = {};
  const missing: string[] = [];

  const registry = await getEntityLabelsCache();
  for (const q of qcodes) {
    const label = registry[q] ? pickLabelByLang(registry[q], lang) : '';
    if (label) map[q] = label;
    else missing.push(q);
  }
  if (!missing.length) return map;

  checkMixedContent();
  try {
    const values = missing.map(q => `"${q}"`).join(', ');
    const response = await index.search('', {
      filter: ['lehekylje_number = 1', `${fields.idsField} IN [${values}]`],
      limit: LABEL_GAPFILL_LIMIT,
      attributesToRetrieve: [fields.objectField],
    }, signal ? { signal } : undefined);
    const fromDocs = buildIdMap(response.hits, fields.objectField, lang);
    for (const q of missing) {
      if (fromDocs[q]) map[q] = fromDocs[q];
    }
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    console.error(`Labelite lünga-täide ebaõnnestus (${fields.idsField}):`, error);
  }
  return map;
};

/**
 * Žanri labelid. Q-koodid tulevad `getGenreFacets`-ist, seega kollektsiooni-filtrit
 * siin vaja pole: labelid on globaalsed ja kuvatav hulk on juba facetiga piiratud.
 */
export const getGenreLabelMap = (
  index: Index,
  qcodes: string[],
  lang: string = 'et',
): Promise<Record<string, string>> =>
  resolveLabelsFromRegistry(index, qcodes, lang,
    { idsField: 'genre_ids', objectField: 'genre_object' });

/**
 * Märksõna labelid külgriba facetitele. Q-koodid tulevad `getTeoseTagsFacets`-ist.
 *
 * Varem võeti need 200 esilehe `tags_object`-ist (~58 KB): see kattis ainult valimis
 * esinevad märksõnad, seega facetist tulnud harvem esinev märksõna võis jääda ilma
 * labelita. Register katab kõik ja on juba mälus.
 */
export const getTypeLabelMap = (
  index: Index,
  qcodes: string[],
  lang: string = 'et',
  signal?: AbortSignal
): Promise<Record<string, string>> =>
  resolveLabelsFromRegistry(index, qcodes, lang,
    { idsField: 'type_ids', objectField: 'type_object' }, signal);

export const getTagsLabelMap = (
  index: Index,
  qcodes: string[],
  lang: string = 'et',
  signal?: AbortSignal
): Promise<Record<string, string>> =>
  resolveLabelsFromRegistry(index, qcodes, lang,
    { idsField: 'tags_ids', objectField: 'tags_object' }, signal);

// Autorite facetid (author_names väljast)
export const getAuthorFacets = async (
  index: Index,
  collection?: string,
  yearStart?: number,
  yearEnd?: number,
  signal?: AbortSignal
): Promise<{ value: string; count: number }[]> => {
  checkMixedContent();

  try {
    const filter: string[] = ['lehekylje_number = 1'];
    if (collection) {
      filter.push(`collections_hierarchy = "${collection}"`);
    }
    pushYearFilter(filter, yearStart, yearEnd);

    const response = await index.search('', {
      filter,
      limit: 0,
      facets: ['author_names', 'respondens_names']
    }, signal ? { signal } : undefined);

    // Liida author_names ja respondens_names kokku
    const authorFacets = response.facetDistribution?.['author_names'] || {};
    const respondensFacets = response.facetDistribution?.['respondens_names'] || {};
    const merged: Record<string, number> = { ...authorFacets };
    for (const [name, count] of Object.entries(respondensFacets)) {
      merged[name] = (merged[name] || 0) + (count as number);
    }

    return Object.entries(merged)
      .map(([value, count]) => ({ value, count: count as number }))
      .sort((a, b) => b.count - a.count);
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    console.error("getAuthorFacets error:", error);
    return [];
  }
};

// Dashboardi otsing: otsib teoseid
export const searchWorks = async (index: Index, rawQuery: string, options?: DashboardSearchOptions): Promise<SearchWorksResult> => {
  checkMixedContent();
  const query = normalizeSearchQuery(rawQuery);

  try {
    const filter: string[] = [];

    // ALATI filtreeri esimese lehekülje järgi - tagab õige thumbnail ja tagid
    // V.A. kui otsime viimati muudetuid (siis tahame näha mis tahes lehte mis muutus)
    if (options?.onlyFirstPage !== false) {
      filter.push('lehekylje_number = 1');
    }

    // Apply server-side filters if provided
    pushYearFilter(filter, options?.yearStart, options?.yearEnd);
    if (options?.author) {
      filter.push(`(author_names = "${options.author}" OR respondens_names = "${options.author}")`);
    }
    if (options?.respondens) {
      filter.push(`respondens_names = "${options.respondens}"`);
    }
    if (options?.printer) {
      filter.push(buildPrinterFilter(options.printer));
    }
    if (options?.workStatus) {
      filter.push(`teose_staatus = "${options.workStatus}"`);
    }
    // Teose märksõnade filter (AND loogika - teos peab vastama kõigile valitud märksõnadele)
    if (options?.teoseTags && options.teoseTags.length > 0) {
      for (const tag of options.teoseTags) filter.push(buildTagFilter(tag));
    }
    // V2: Kollektsiooni filter (kasutab collections_hierarchy, et kaasata alamkollektsioonid)
    if (options?.collection) {
      filter.push(`collections_hierarchy = "${options.collection}"`);
    }
    // V2: Žanri filter (Q-kood → genre_ids, label → bilinguaalne OR)
    if (options?.genre && options.genre.length > 0) {
      filter.push(buildMultiFilter(options.genre, buildGenreFilter));
    }
    // V2: Tüübi filter (Q-kood → type_ids, label → bilinguaalne OR)
    if (options?.type && options.type.length > 0) {
      filter.push(buildMultiFilter(options.type, buildTypeFilter));
    }
    // Keele filter — languages on massiiv, seega üks väärtus ühtib massiivi liikmega
    if (options?.languages && options.languages.length > 0) {
      filter.push(buildMultiFilter(options.languages, (l) => `languages = "${l}"`));
    }

    // Kasutame ID-põhiseid facet välju (Q-koodid) — keeleneutraalsed, ei tekita duplikaate
    const genreFacetField = 'genre_ids';
    const typeFacetField = 'type_ids';
    const tagsFacetField = 'tags_ids';

    const searchParams: any = {
      attributesToRetrieve: [
        'id', 'work_id', 'title', 'year', 'year_display', 'publisher_id',
        'publisher_object', 'location_object',
        'type_object', 'genre_object', 'collections', 'collections_hierarchy',
        'creators', 'authors_text', 'tags_object', 'languages',
        'series', 'series_title', 'ester_id', 'external_url', 'archive_refs',
        'last_modified', 'teose_lehekylgede_arv', 'teose_staatus'
      ],
      attributesToSearchOn: ['title', 'authors_text', 'tags_search'], // Dashboard otsib pealkirjast, autoritest ja märksõnadest
      matchingStrategy: (query ? 'frequency' : 'last') as unknown as MatchingStrategies,
      filter: filter,
      // Facetid arvutatakse kogu filtrile ka serveripoolse lehekülgjaotuse korral.
      // Küsime facetid dünaamiliseks filtrite uuendamiseks
      // `languages` loendur on siin TEOSEPÕHINE: filter `lehekylje_number = 1`
      // annab ühe dokumendi teose kohta. SearchPage'il oleks sama loendur
      // lehepõhine ja seetõttu eksitav — seal facetteid ei küsita.
      facets: [genreFacetField, typeFacetField, tagsFacetField, 'teose_staatus', 'languages']
    };

    // Lehekülgjaotus: `page`/`hitsPerPage` annab TÄPSE `totalHits`, `offset`/`limit`
    // ainult `estimatedTotalHits`-i (otsingusõnaga võib olla ligikaudne → vale
    // lehtede arv ja tühi viimane leht). Mõõdetud tootmises: page-režiim ei ole
    // aeglasem (7,2 vs 8,6 ms keskmine). Kutsuja API jääb offset/limit peale;
    // joondamata offset (ei tule ühestki praegusest kutsujast) langeb tagasi.
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 12;
    if (offset % limit === 0) {
      searchParams.page = offset / limit + 1;
      searchParams.hitsPerPage = limit;
    } else {
      searchParams.offset = offset;
      searchParams.limit = limit;
    }

    // Esimese lehe filter annab juba täpselt ühe dokumendi teose kohta, seega
    // distinct oleks seal üleliigne. Seda vajab ainult „viimati muudetud“ vaade,
    // mis otsib kõigilt lehekülgedelt.
    const useDistinct = options?.onlyFirstPage === false && options?.sort !== 'relevance';
    if (useDistinct) searchParams.distinct = 'work_id';

    // Sorting logic
    if (options?.sort) {
      switch (options.sort) {
        case 'relevance':
          // Meilisearch kasutab relevantsust kui sort pole määratud
          break;
        case 'year_asc':
          searchParams.sort = ['year:asc'];
          break;
        case 'year_desc':
          searchParams.sort = ['year:desc'];
          break;
        case 'az':
          searchParams.sort = ['title:asc'];
          break;
        case 'recent':
          searchParams.sort = ['last_modified:desc'];
          break;
        default:
          searchParams.sort = ['year:asc'];
          break;
      }
    } else {
      // Vaikimisi sorteeri aasta järgi kasvavalt (kui sort pole määratud)
      searchParams.sort = ['year:asc'];
    }

    const response = await index.search(query, searchParams, options?.signal ? { signal: options.signal } : undefined);

    // Tavavaates tagab lehekylje_number=1 unikaalsuse. Kõigi lehekülgede
    // relevantsusotsingu erijuhul eemaldame võimalikud duplikaadid vastusest.
    let uniqueHits = response.hits;
    if (options?.onlyFirstPage === false && !useDistinct) {
      const seenWorkIds = new Set<string>();
      uniqueHits = response.hits.filter((hit: any) => {
        if (seenWorkIds.has(hit.work_id)) return false;
        seenWorkIds.add(hit.work_id);
        return true;
      });
    }

    // NB: Kuna otsing kasutab 'lehekylje_number = 1' filtrit, tulevad
    // esimese lehe andmed (tags, page_tags) juba kaasa põhipäringuga.
    // Thumbnail tuleb serveripoolsest /_thumb endpointist (genereeritakse vajadusel).

    // Järjestus tuleb TERVIKUNA Meilisearchist. Siin oli varem kliendipoolne
    // works.sort(...) „kuna distinct + sort ei tööta alati õigesti“ — see ei saanud
    // probleemi lahendada, sest sorteeris ainult ühe lehe (12 tulemust) juba
    // serveripoolselt lõigatud aknas.
    //
    // Tootmises verifitseeritud (#183): distinct:'work_id' + sort:['last_modified:desc']
    // annab korrektse järjestuse ja unikaalsed work_id-d ka üle lehepiiride; year:asc
    // ja year:desc samuti. `az` juures oli ümbersort aktiivselt KAHJULIK: Meilisearch
    // taandab diakriitikud (Börk < Bröms), localeCompare('et') paneb ö tähestiku lõppu
    // (Bröms < Börk) — lehe sisu sorteeriti eesti kollatsiooniga, lehepiirid jäid Meili
    // omasse, seega A–Z lehitsemine ei olnud monotoonne.
    const works: Work[] = uniqueHits.map(normalizeWork);

    // Tagasta tulemused koos facetidega
    const facetDistribution = response.facetDistribution || {};
    return {
      works,
      // NB: iga uus facet tuleb lisada NII päringusse (`facets: [...]` ülal) KUI
      // siia tagastusse. `as FacetDistribution` kast ei anna puuduvast väljast
      // tüübiviga, seega mahajäänud väli kaob vaikselt ja UI ei renderda sektsiooni.
      facets: {
        genre_ids: facetDistribution['genre_ids'],
        type_ids: facetDistribution['type_ids'],
        tags_ids: facetDistribution['tags_ids'],
        teose_staatus: facetDistribution['teose_staatus'],
        languages: facetDistribution['languages']
      } as FacetDistribution,
      // page-režiimis täpne totalHits; offset-režiimis (ja vanemate vastuste korral)
      // estimatedTotalHits.
      totalHits: (response as any).totalHits ?? response.estimatedTotalHits ?? works.length
    };

  } catch (error: any) {
    if (options?.signal?.aborted || isAbortError(error)) throw error;
    console.error("Meilisearch error:", error);
    throw new Error(`Ühenduse viga (${MEILI_HOST}): ${error.message}`);
  }
};

// Mitu teost korraga ühte work_id IN [...] filtrisse. Kogu korpus (~1300 teost)
// mahub praegu ühte päringusse; partiideks jagamine hoiab filtri stringi ohjes,
// kui korpus kasvab.
const WORK_FACET_BATCH = 1000;

/**
 * Teosepõhised facet-loendurid: mitu TEOST (mitte lehekülge) vastab igale
 * žanrile/tüübile/märksõnale/autorile.
 *
 * Meilisearchi facetDistribution loendab alati dokumente ega arvesta
 * `distinct`-iga. Kuna indeksis on üks dokument lehekülje kohta ja metaandmed on
 * igale leheküljele denormaliseeritud, saame teosepõhise loenduri, piirates
 * dokumendihulga iga teose esimese leheküljega.
 *
 * Eeldus: igal teosel on indeksis `lehekylje_number = 1` (kontrollitud
 * tootmiskorpusel 1264/1264). Kui mõnel puudub, jääb ta facet-loendurist välja,
 * kuid teoste koguarv (work_id facet) on siiski õige.
 */
async function fetchWorkLevelFacets(
  index: Index,
  workIds: string[],
  facetFields: string[],
  requestConfig?: { signal?: AbortSignal },
): Promise<Record<string, Record<string, number>>> {
  const merged: Record<string, Record<string, number>> = {};
  for (const field of [...facetFields, 'author_names', 'originaal_kataloog']) {
    merged[field] = {};
  }
  if (workIds.length === 0) return merged;

  const batches: string[][] = [];
  for (let i = 0; i < workIds.length; i += WORK_FACET_BATCH) {
    batches.push(workIds.slice(i, i + WORK_FACET_BATCH));
  }

  let responses;
  try {
    responses = await Promise.all(batches.map(batch => index.search('', {
      limit: 0,
      filter: [
        `work_id IN [${batch.map(id => `"${id}"`).join(', ')}]`,
        'lehekylje_number = 1',
      ],
      facets: [...facetFields, 'author_names', 'respondens_names', 'originaal_kataloog'],
    }, requestConfig)));
  } catch (error) {
    // Katkestus peab läbi minema, muidu kirjutaks vana otsing uue tulemused üle.
    if (requestConfig?.signal?.aborted || isAbortError(error)) throw error;
    // Muu tõrge: tulemused ja koguarvud on juba käes — jäta külgriba filtrid tühjaks,
    // ära võta kogu otsingut maha.
    console.error('fetchWorkLevelFacets error:', error);
    return merged;
  }

  for (const response of responses) {
    const dist = (response as any).facetDistribution || {};
    for (const [field, values] of Object.entries(dist)) {
      // Respondendid on otsingu külgribas autorite all, nagu varasemas loogikas.
      const target = field === 'respondens_names' ? 'author_names' : field;
      if (!merged[target]) merged[target] = {};
      for (const [value, count] of Object.entries(values as Record<string, number>)) {
        merged[target][value] = (merged[target][value] || 0) + count;
      }
    }
  }
  return merged;
}

// Täisteksti otsing
// Kui workId on määratud - otsib ainult sellest teosest (kõik vasted, ilma distinct'ita)
// Muidu - tagastab 10 teost (distinct), iga teose kohta 1 esinduslik vaste
export const searchContent = async (index: Index, rawQuery: string, page: number = 1, options: ContentSearchOptions = {}): Promise<ContentSearchResponse> => {
  checkMixedContent();
  const query = normalizeSearchQuery(rawQuery);

  const limit = options.workId ? 20 : 10; // Teose piires rohkem vasteid lehel
  const offset = (page - 1) * limit;
  const filter: string[] = [];

  if (options.workId) filter.push(`work_id = "${options.workId}"`);
  pushYearFilter(filter, options.yearStart, options.yearEnd);
  if (options.catalog && options.catalog !== 'all') filter.push(`originaal_kataloog = "${options.catalog}"`);
  // Teose märksõnade filter (AND loogika)
  if (options.teoseTags && options.teoseTags.length > 0) {
    for (const tag of options.teoseTags) filter.push(buildTagFilter(tag));
  }
  // Lehekülje märksõnade filter (AND loogika)
  if (options.pageTags && options.pageTags.length > 0) {
    for (const tag of options.pageTags) filter.push(buildPageTagFilter(tag));
  }
  // V2: Kollektsiooni filter — kui workId on seatud, on teos juba piiratud, kollektsioon ei rakendu
  if (options.collection && !options.workId) {
    filter.push(`collections_hierarchy = "${options.collection}"`);
  }
  // V2: Žanri filter
  if (options.genre && options.genre.length > 0) {
    filter.push(buildMultiFilter(options.genre, buildGenreFilter));
  }
  // V2: Tüübi filter
  if (options.type && options.type.length > 0) {
    filter.push(buildMultiFilter(options.type, buildTypeFilter));
  }
  // Keele filter — languages on massiiv, seega üks väärtus ühtib massiivi liikmega
  if (options.languages && options.languages.length > 0) {
    filter.push(buildMultiFilter(options.languages, (l) => `languages = "${l}"`));
  }
  // V2: Autori filter (kõik creators: author_names + respondens_names)
  if (options.author) {
    filter.push(`(author_names = "${options.author}" OR respondens_names = "${options.author}")`);
  }
  if (options.subjectPerson) {
    filter.push(`tags_ids = "${options.subjectPerson}"`);
  }

  const tagsField = options.lang ? `page_tags_${options.lang}` : 'page_tags_et';
  const genreFacetField = 'genre_ids';
  const typeFacetField = 'type_ids';
  const tagsFacetField = 'tags_ids';

  // „Terve dokument" katab KÕIK tekstiväljad — sh text_annotations_text.
  // Selle puudumine tegi vaikeulatuse kitsamaks kui tema enda alamvalik
  // „Ainult annotatsioonid", nii et annotatsiooni-vasted olid vaikevaates nähtamatud.
  let attributesToSearchOn: string[] = ['lehekylje_tekst', 'marginaalia_tekst', tagsField, 'comments.text', 'text_annotations_text'];
  if (options.scope === 'original') attributesToSearchOn = ['lehekylje_tekst', 'marginaalia_tekst'];
  else if (options.scope === 'annotation') {
    attributesToSearchOn = [tagsField, 'comments.text', 'text_annotations_text'];
    // Tühi query matchib kõiki dokumente — filtreeri ainult annotatsioonidega leheküljed
    if (!query) filter.push('has_annotations = true');
  }

  const requestConfig = options.signal ? { signal: options.signal } : undefined;

  try {
    // Kui otsime ühe teose piires, näitame kogu lehekülje teksti kõigi highlight'idega
    if (options.workId) {
      const response = await index.search(query, {
        offset,
        limit,
        filter,
        facets: ['originaal_kataloog', 'work_id'],
        attributesToRetrieve: ['id', 'work_id', 'lehekylje_number', 'lehekylje_tekst', 'marginaalia_tekst', 'text_content', 'title', 'year', 'year_display', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'page_tags', 'page_tags_object', tagsField, 'comments', 'text_annotations', 'genre', 'genre_object', 'type', 'type_object', 'creators', 'collections', 'collections_hierarchy'],
        // Ei kasuta croppi - näitame kogu teksti
        attributesToHighlight: ['lehekylje_tekst', 'marginaalia_tekst', tagsField, 'comments.text', 'text_annotations_text', 'text_annotations'],
        highlightPreTag: HIGHLIGHT_PRE_TAG,
        highlightPostTag: HIGHLIGHT_POST_TAG,
        attributesToSearchOn: attributesToSearchOn,
        matchingStrategy: (query ? 'frequency' : 'last') as unknown as MatchingStrategies
      }, requestConfig);

      const totalHits = response.estimatedTotalHits || 0;

      return {
        hits: response.hits.map(normalizeContentSearchHit),
        totalHits: totalHits,
        totalWorks: 1,
        totalPages: Math.ceil(totalHits / limit),
        page,
        processingTimeMs: response.processingTimeMs,
        facetDistribution: response.facetDistribution
      };
    }

    // Erijuhud statistika (facets) arvutamiseks
    // Meilisearch facets loendavad alati dokumente (lehekülgi), mitte unikaalseid teoseid.
    // Seega peame statistika saamiseks tegema eraldi loogika.

    let facetDistribution: Record<string, Record<string, number>> = {};
    let totalWorks = 0;

    // 1. Kui otsingusõna PUUDUB (kasutaja ainult filtreerib/sirvib),
    // siis on kõige kiirem viis saada teoste statistika filtreerides 'lehekylje_number = 1'.
    // Kuna igal teosel on täpselt üks esimene lehekülg, siis dokumentide arv = teoste arv.
    if (!query) {
      const statsFilter = [...filter, 'lehekylje_number = 1'];

      const [statsResponse, distinctResponse] = await Promise.all([
        // Päring 1: Statistika (ainult 1. leheküljed)
        index.search('', {
          filter: statsFilter,
          limit: 0,
          facets: ['originaal_kataloog', genreFacetField, typeFacetField, tagsFacetField, 'author_names', 'respondens_names'],
          attributesToSearchOn: attributesToSearchOn
        }, requestConfig),
        // Päring 2: Sisu (teosed)
        index.search('', {
          offset,
          limit,
          filter,
          distinct: 'work_id',
          attributesToRetrieve: ['id', 'work_id', 'lehekylje_number', 'lehekylje_tekst', 'marginaalia_tekst', 'title', 'year', 'year_display', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'tags_object', 'page_tags', 'page_tags_object', tagsField, 'comments', 'text_annotations', 'genre', 'genre_object', 'type', 'type_object', 'creators', 'collections', 'collections_hierarchy'],
          sort: ['year:asc'], // Vaikimisi sortimine aasta järgi kui otsingut pole
          attributesToSearchOn: attributesToSearchOn
        }, requestConfig)
      ]);

      facetDistribution = statsResponse.facetDistribution || {};
      // Liida respondens_names → author_names kokku
      if (facetDistribution['respondens_names']) {
        const merged = { ...(facetDistribution['author_names'] || {}) };
        for (const [name, count] of Object.entries(facetDistribution['respondens_names'])) {
          merged[name] = (merged[name] || 0) + (count as number);
        }
        facetDistribution['author_names'] = merged;
        delete facetDistribution['respondens_names'];
      }
      totalWorks = statsResponse.estimatedTotalHits || 0; // estimatedTotalHits on täpne kui pole query stringi

      // Hit count on alati lehekülgede arv (aga siin me ei tea seda täpselt ilma lisapäringuta,
      // aga sirvimise puhul pole "x vastet sellest teosest" nii kriitiline, eeldame lehekülgede arvu teose metadata küljest)

      // Kui tahame teada teose lehekülgede arvu, peame seda küsima.
      // Sirvimisel 'hitCount' pole tavaliselt vajalik või on see teose kogulehekülgede arv.
      const hitsWithCounts = distinctResponse.hits.map((hit: any) => ({
        ...normalizeContentSearchHit(hit),
        hitCount: hit.teose_lehekylgede_arv || 1 // Fallback
      }));

      return {
        hits: hitsWithCounts as any,
        totalHits: totalWorks, // Sirvimisel on hits = works
        totalWorks: totalWorks,
        totalPages: Math.ceil(totalWorks / limit),
        page,
        processingTimeMs: distinctResponse.processingTimeMs,
        facetDistribution: facetDistribution
      };
    }

    // 2. Kui otsingusõna ON OLEMAS (sisuotsing)
    // Otsitav sõna võib olla ükskõik millisel leheküljel, seega ei saa vasteid
    // otse 'lehekylje_number = 1' filtriga teose tasandile viia.
    //
    // Kaheastmeline lahendus (#174): work_id facet annab KÕIK vastavad teosed
    // (ei sõltu ühestki limiidist), seejärel küsime nende teoste facetid ühelt
    // dokumendilt teose kohta. Varem tõmmati 5000 vastet ja agregeeriti brauseris —
    // see oli kallutatud (laia päringu 5000 hitti katsid ~135 teost 1154-st),
    // maksis ~1 s ja 5–7 MB (pakkimata) iga otsingu kohta.
    else {
      const [distinctResponse, pageCountResponse] = await Promise.all([
        // Päring 1: Sisu (kuvatavad teosed, distinct)
        index.search(query, {
          offset,
          limit,
          filter,
          distinct: 'work_id',
          attributesToRetrieve: ['id', 'work_id', 'lehekylje_number', 'lehekylje_tekst', 'marginaalia_tekst', 'text_content', 'title', 'year', 'year_display', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'tags_object', 'page_tags', 'page_tags_object', tagsField, 'comments', 'text_annotations', 'genre', 'genre_object', 'type', 'type_object', 'creators', 'collections', 'collections_hierarchy'],
          attributesToCrop: ['lehekylje_tekst', 'comments.text'],
          cropLength: 35,
          attributesToHighlight: ['lehekylje_tekst', 'marginaalia_tekst', tagsField, 'comments.text', 'text_annotations_text', 'text_annotations'],
          highlightPreTag: HIGHLIGHT_PRE_TAG,
          highlightPostTag: HIGHLIGHT_POST_TAG,
          attributesToSearchOn: attributesToSearchOn
        }, requestConfig),
        // Päring 2: Lehekülgede arvud teoste kaupa (work_id facet).
        // Sama päring annab ka kõigi vastavate teoste ID-d ja täpsed koguarvud.
        index.search(query, {
          filter,
          limit: 0,
          facets: ['work_id'],
          attributesToSearchOn: attributesToSearchOn
        }, requestConfig)
      ]);

      const workIdFacet = pageCountResponse.facetDistribution?.['work_id'];
      const workHitCounts = workIdFacet || {};
      const facetWorkIds = Object.keys(workHitCounts);

      // Päring 3: teosepõhised facetid — üks dokument teose kohta (esimene lehekülg).
      // Meilisearchi facetDistribution EI arvesta distinct'iga (mõõdetud), seega
      // ainus viis teosepõhiste loenduriteni on piirata dokumendihulk ühe leheküljega.
      const calculatedFacets = await fetchWorkLevelFacets(
        index, facetWorkIds,
        [genreFacetField, typeFacetField, tagsFacetField],
        requestConfig,
      );

      // Lisa work_id facet (lehekülgede arvud) otse Meilisearchist
      calculatedFacets['work_id'] = workHitCounts;

      // work_id facet loendab KÕIKI vastavaid teoseid, sõltumata maxTotalHits=10000
      // lakkest. Varem võeti see arv distinctResponse.estimatedTotalHits-ist, mis
      // loeb lehekülgi, mitte teoseid: "est" näitas 10 000 teost tegeliku 1074 asemel.
      // Puuduv facet (nt indeksi seadistus katki) langeb tagasi vanale hinnangule —
      // tühi facet tähendab seevastu päriselt nulli vastet.
      totalWorks = workIdFacet ? facetWorkIds.length : (distinctResponse.estimatedTotalHits || 0);
      const hitsWithCounts = distinctResponse.hits.map((hit: any) => ({
        ...normalizeContentSearchHit(hit),
        hitCount: workHitCounts[hit.work_id] || 1
      }));

      // Facet-väärtuste summa on täpne lehekülgede arv; estimatedTotalHits on
      // maxTotalHits=10000 juures kärbitud.
      const facetPageTotal = facetWorkIds.reduce((sum, id) => sum + (workHitCounts[id] || 0), 0);

      return {
        hits: hitsWithCounts as any,
        totalHits: (workIdFacet ? facetPageTotal : pageCountResponse.estimatedTotalHits) || 0, // Lehekülgi kokku
        totalWorks: totalWorks,
        totalPages: Math.ceil(totalWorks / limit),
        page,
        processingTimeMs: distinctResponse.processingTimeMs,
        facetDistribution: calculatedFacets
      };
    }
  } catch (e: any) {
    if (e.message && e.message.includes('not searchable')) {
      throw new Error("Otsinguindeksit alles uuendatakse. Palun oota hetk.");
    }
    throw e;
  }
};

// Laadi ühe teose kõik otsingutulemused (akordioni avamiseks)
export const searchWorkHits = async (index: Index, rawQuery: string, workId: string, options: ContentSearchOptions = {}): Promise<ContentSearchHit[]> => {
  checkMixedContent();
  const query = normalizeSearchQuery(rawQuery);

  const filter: string[] = [`work_id = "${workId}"`];

  pushYearFilter(filter, options.yearStart, options.yearEnd);
  if (options.catalog && options.catalog !== 'all') filter.push(`originaal_kataloog = "${options.catalog}"`);

  const tagsField = options.lang ? `page_tags_${options.lang}` : 'page_tags_et';
  // „Terve dokument" katab KÕIK tekstiväljad — sh text_annotations_text.
  // Selle puudumine tegi vaikeulatuse kitsamaks kui tema enda alamvalik
  // „Ainult annotatsioonid", nii et annotatsiooni-vasted olid vaikevaates nähtamatud.
  let attributesToSearchOn: string[] = ['lehekylje_tekst', 'marginaalia_tekst', tagsField, 'comments.text', 'text_annotations_text'];
  if (options.scope === 'original') attributesToSearchOn = ['lehekylje_tekst', 'marginaalia_tekst'];
  else if (options.scope === 'annotation') {
    attributesToSearchOn = [tagsField, 'comments.text', 'text_annotations_text'];
    if (!query) filter.push('has_annotations = true');
  }

  try {
    const response = await index.search(query, {
      filter,
      limit: 500, // Piisav ühele teosele
      attributesToRetrieve: ['id', 'work_id', 'lehekylje_number', 'lehekylje_tekst', 'marginaalia_tekst', 'text_content', 'title', 'year', 'year_display', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'page_tags', 'page_tags_object', tagsField, 'comments', 'text_annotations', 'genre', 'genre_object', 'type', 'type_object', 'creators'],
      attributesToCrop: ['lehekylje_tekst', 'comments.text'],
      cropLength: 35,
      attributesToHighlight: ['lehekylje_tekst', 'marginaalia_tekst', tagsField, 'comments.text', 'text_annotations_text', 'text_annotations'],
      highlightPreTag: HIGHLIGHT_PRE_TAG,
      highlightPostTag: HIGHLIGHT_POST_TAG,
      sort: ['lehekylje_number:asc'],
      attributesToSearchOn: attributesToSearchOn,
      matchingStrategy: (query ? 'frequency' : 'last') as unknown as MatchingStrategies
    });

    return response.hits.map(normalizeContentSearchHit);
  } catch (e: any) {
    console.error('searchWorkHits error:', e);
    throw e;
  }
};

// Märksõnade autocomplete: saa kõik unikaalsed märksõnad koos ID-dega
export const getAllTags = async (index: Index, lang: string = 'et'): Promise<{ label: string; id: string | null }[]> => {
  checkMixedContent();
  try {
    // Kasuta spetsiaalset suggest välja, mis sisaldab ID-sid (formaat: Label|||ID)
    const facetField = ['et', 'en'].includes(lang) ? `page_tags_suggest_${lang}` : 'page_tags_suggest_et';

    const response = await index.search('', {
      limit: 0,
      facets: [facetField]
    });

    const tagFacets = response.facetDistribution?.[facetField] || {};

    // Parsi stringid objektideks
    const parsedTags = Object.keys(tagFacets).map(raw => {
      const parts = raw.split('|||');
      if (parts.length === 2) {
        return { label: parts[0], id: parts[1] || null };
      }
      return { label: raw, id: null }; // Fallback
    });

    // Eemalda duplikaadid (label+id kombinatsioonid) ja sorteeri
    const uniqueTags = new Map<string, { label: string; id: string | null }>();
    parsedTags.forEach(tag => {
      const key = `${tag.label.toLowerCase()}|${tag.id || ''}`;
      uniqueTags.set(key, tag);
    });

    return Array.from(uniqueTags.values()).sort((a, b) => a.label.localeCompare(b.label, lang));
  } catch (e) {
    console.error("Failed to fetch tags:", e);
    return [];
  }
};
