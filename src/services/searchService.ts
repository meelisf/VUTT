/**
 * Otsing, sirvimis- ja facet-päringud Meilisearchist
 */

import { Work, ContentSearchResponse, ContentSearchOptions, ContentSearchHit } from '../types';
import { MEILI_HOST } from '../config';
import { checkMixedContent, normalizeWork, normalizeContentSearchHit } from './meiliService';
import { buildTagFilter, buildPageTagFilter, buildGenreFilter, buildTypeFilter, buildPrinterFilter, buildMultiFilter } from '../utils/filterUtils';
import { buildIdMap } from '../utils/buildObjectIdMap';
import type { MatchingStrategies, Index } from 'meilisearch';
import { HIGHLIGHT_PRE_TAG, HIGHLIGHT_POST_TAG } from '../utils/sanitizeHtml';

// Aastafilter vahemike kattuvusena: teose [year_start, year_end] kattub kasutaja vahemikuga.
// Kattuvus: A.end >= B.start AND A.start <= B.end.
// Aastata teosed (year_start=year_end=0) käituvad nagu varasem year=0.
const pushYearFilter = (filter: string[], yearStart?: number, yearEnd?: number): void => {
  if (yearStart) filter.push(`year_end >= ${yearStart}`);
  if (yearEnd) filter.push(`year_start <= ${yearEnd}`);
};

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
  lang?: string; // Keele filter (et, en) - kasutatakse genre/type/tags väljadega
}

// Facetide vastuse tüüp
export interface FacetDistribution {
  genre_ids?: Record<string, number>; // Q-koodid, keeleneutraalne
  type_ids?: Record<string, number>;  // Q-koodid, keeleneutraalne
  tags_ids?: Record<string, number>;  // Q-koodid, keeleneutraalne
  teose_staatus?: Record<string, number>;
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
  yearEnd?: number
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
    });

    const facetDistribution = response.facetDistribution?.[facetField] || {};

    const result = Object.entries(facetDistribution)
      .map(([tag, count]) => ({ tag, count: count as number }))
      .sort((a, b) => b.count - a.count);

    return result;
  } catch (error) {
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
  yearEnd?: number
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
    });

    const facetDistribution = response.facetDistribution?.[facetField] || {};

    const result = Object.entries(facetDistribution)
      .map(([value, count]) => ({ value, count: count as number }))
      .sort((a, b) => b.count - a.count);

    return result;
  } catch (error) {
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
  yearEnd?: number
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
    });

    const facetDistribution = response.facetDistribution?.[facetField] || {};

    const result = Object.entries(facetDistribution)
      .map(([value, count]) => ({ value, count: count as number }))
      .sort((a, b) => b.count - a.count);

    return result;
  } catch (error) {
    console.error("getTypeFacets error:", error);
    return [];
  }
};

// Laeb žanri labelid (Q-kood → label) genre_object-ist
export const getGenreLabelMap = async (
  index: Index,
  collection?: string,
  lang: string = 'et',
): Promise<Record<string, string>> => {
  checkMixedContent();
  try {
    const filter: string[] = ['lehekylje_number = 1'];
    if (collection) filter.push(`collections_hierarchy = "${collection}"`);

    const response = await index.search('', {
      filter,
      limit: 5000,
      attributesToRetrieve: ['genre_object'],
    });

    return buildIdMap(response.hits, 'genre_object', lang);
  } catch (error) {
    console.error('getGenreLabelMap error:', error);
    return {};
  }
};

// Laeb tag labelid (Q-kood → label) collection esimeste lehekülgede tags_object-ist
// Kasutatakse kui otsingutulemused puuduvad aga collection on valitud
export const getTagsLabelMap = async (
  index: Index,
  collection?: string,
  lang: string = 'et',
  yearStart?: number,
  yearEnd?: number
): Promise<Record<string, string>> => {
  checkMixedContent();
  try {
    const filter: string[] = ['lehekylje_number = 1'];
    if (collection) filter.push(`collections_hierarchy = "${collection}"`);
    pushYearFilter(filter, yearStart, yearEnd);

    const response = await index.search('', {
      filter,
      limit: 200,
      attributesToRetrieve: ['tags_object'],
    });

    const map: Record<string, string> = {};
    const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;
    for (const hit of response.hits) {
      const tags = (hit as any).tags_object;
      if (!Array.isArray(tags)) continue;
      for (const tag of tags) {
        if (!tag?.id) continue;
        const rawLabel = tag.labels?.[lang] || tag.labels?.['et'] || tag.label;
        if (rawLabel) map[tag.id] = cap(rawLabel);
      }
    }
    return map;
  } catch (error) {
    console.error('getTagsLabelMap error:', error);
    return {};
  }
};

// Autorite facetid (author_names väljast)
export const getAuthorFacets = async (
  index: Index,
  collection?: string,
  yearStart?: number,
  yearEnd?: number
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
    });

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
    console.error("getAuthorFacets error:", error);
    return [];
  }
};

// Dashboardi otsing: otsib teoseid
export const searchWorks = async (index: Index, query: string, options?: DashboardSearchOptions): Promise<SearchWorksResult> => {
  checkMixedContent();

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
      limit: 5000, // Tõstame limiiti, et kõik teosed jõuaksid dashboardile (client-side pagination)
      // Küsime facetid dünaamiliseks filtrite uuendamiseks
      facets: [genreFacetField, typeFacetField, tagsFacetField, 'teose_staatus']
    };

    // Relevantsuse puhul EI kasuta distinct, et säilitada Meilisearchi relevantsuse järjekord
    // Muul juhul kasutame distinct, et saada üks tulemus teose kohta
    const useDistinct = options?.sort !== 'relevance';
    if (useDistinct) {
      searchParams.distinct = 'work_id';
    }

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

    const response = await index.search(query, searchParams);

    // Kui kasutame distinct, siis iga hit on unikaalne teos
    // Kui EI kasuta distinct (relevance), siis peame grupeerima frontendis, säilitades järjekorra
    let uniqueHits = response.hits;
    if (!useDistinct) {
      // Grupeeri work_id järgi, võttes ainult esimese (kõrgeima relevantsusega) tulemuse
      const seenWorkIds = new Set<string>();
      uniqueHits = response.hits.filter((hit: any) => {
        if (seenWorkIds.has(hit.work_id)) {
          return false;
        }
        seenWorkIds.add(hit.work_id);
        return true;
      });
    }

    // NB: Kuna otsing kasutab 'lehekylje_number = 1' filtrit, tulevad
    // esimese lehe andmed (tags, page_tags) juba kaasa põhipäringuga.
    // Thumbnail tuleb serveripoolsest /_thumb endpointist (genereeritakse vajadusel).

    const works: Work[] = uniqueHits.map(normalizeWork);

    // Meilisearch distinct + sort kombinatsioon ei tööta alati õigesti,
    // seega sorteerime frontendis uuesti (v.a. relevance, kus säilitame Meilisearchi järjekorra)
    const sortKey = options?.sort || 'year_asc';
    if (sortKey !== 'relevance') {
      works.sort((a, b) => {
        switch (sortKey) {
          case 'year_desc':
            return b.year - a.year;
          case 'az':
            return a.title.localeCompare(b.title, 'et');
          case 'recent':
            // Sorteerime last_modified järgi kahanevalt
            return (b as any).last_modified - (a as any).last_modified;
          case 'year_asc':
          default:
            return a.year - b.year;
        }
      });
    }

    // Tagasta tulemused koos facetidega
    const facetDistribution = response.facetDistribution || {};
    return {
      works,
      facets: {
        genre_ids: facetDistribution['genre_ids'],
        type_ids: facetDistribution['type_ids'],
        tags_ids: facetDistribution['tags_ids'],
        teose_staatus: facetDistribution['teose_staatus']
      } as FacetDistribution,
      totalHits: response.estimatedTotalHits || works.length
    };

  } catch (error: any) {
    console.error("Meilisearch error:", error);
    throw new Error(`Ühenduse viga (${MEILI_HOST}): ${error.message}`);
  }
};

// Täisteksti otsing
// Kui workId on määratud - otsib ainult sellest teosest (kõik vasted, ilma distinct'ita)
// Muidu - tagastab 10 teost (distinct), iga teose kohta 1 esinduslik vaste
export const searchContent = async (index: Index, query: string, page: number = 1, options: ContentSearchOptions = {}): Promise<ContentSearchResponse> => {
  checkMixedContent();

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

  let attributesToSearchOn: string[] = ['lehekylje_tekst', tagsField, 'comments.text'];
  if (options.scope === 'original') attributesToSearchOn = ['lehekylje_tekst'];
  else if (options.scope === 'annotation') {
    attributesToSearchOn = [tagsField, 'comments.text', 'text_annotations_text'];
    // Tühi query matchib kõiki dokumente — filtreeri ainult annotatsioonidega leheküljed
    if (!query) filter.push('has_annotations = true');
  }

  try {
    // Kui otsime ühe teose piires, näitame kogu lehekülje teksti kõigi highlight'idega
    if (options.workId) {
      const response = await index.search(query, {
        offset,
        limit,
        filter,
        facets: ['originaal_kataloog', 'work_id'],
        attributesToRetrieve: ['id', 'work_id', 'lehekylje_number', 'lehekylje_tekst', 'text_content', 'title', 'year', 'year_display', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'page_tags', 'page_tags_object', tagsField, 'comments', 'text_annotations', 'genre', 'genre_object', 'type', 'type_object', 'creators', 'collections', 'collections_hierarchy'],
        // Ei kasuta croppi - näitame kogu teksti
        attributesToHighlight: ['lehekylje_tekst', tagsField, 'comments.text'],
        highlightPreTag: HIGHLIGHT_PRE_TAG,
        highlightPostTag: HIGHLIGHT_POST_TAG,
        attributesToSearchOn: attributesToSearchOn,
        matchingStrategy: (query ? 'frequency' : 'last') as unknown as MatchingStrategies
      });

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
        }),
        // Päring 2: Sisu (teosed)
        index.search('', {
          offset,
          limit,
          filter,
          distinct: 'work_id',
          attributesToRetrieve: ['id', 'work_id', 'lehekylje_number', 'lehekylje_tekst', 'title', 'year', 'year_display', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'tags_object', 'page_tags', 'page_tags_object', tagsField, 'comments', 'text_annotations', 'genre', 'genre_object', 'type', 'type_object', 'creators', 'collections', 'collections_hierarchy'],
          sort: ['year:asc'], // Vaikimisi sortimine aasta järgi kui otsingut pole
          attributesToSearchOn: attributesToSearchOn
        })
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
    // Siis me ei saa kasutada 'lehekylje_number = 1' filtrit, sest otsitav sõna võib olla mujal.
    // Lahendus: Tõmbame "statistika päringuga" suure hulga vasteid (ainult ID ja meta) ja agregeerime brauseris.
    else {
      // Optimeerimine: Küsime max 5000 vastet statistika jaoks.
      // See katab 99% tavalistest otsingutest. Väga üldiste otsingute puhul ("a") on see ligikaudne.
      const STATS_LIMIT = 5000;

      const [statsResponse, distinctResponse, pageCountResponse] = await Promise.all([
        // Päring 1: Statistika (kõik vasted, ainult metaandmed)
        index.search(query, {
          filter,
          limit: STATS_LIMIT,
          attributesToRetrieve: ['id', 'work_id', 'title', 'year', 'location', 'publisher', 'creators', 'genre_object', 'type_object', 'collections', 'collections_hierarchy', 'author_names', 'respondens_names', 'tags_object', genreFacetField, typeFacetField, tagsFacetField],
          attributesToSearchOn: attributesToSearchOn
        }),
        // Päring 2: Sisu (kuvatavad teosed, distinct)
        index.search(query, {
          offset,
          limit,
          filter,
          distinct: 'work_id',
          attributesToRetrieve: ['id', 'work_id', 'lehekylje_number', 'lehekylje_tekst', 'text_content', 'title', 'year', 'year_display', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'tags_object', 'page_tags', 'page_tags_object', tagsField, 'comments', 'text_annotations', 'genre', 'genre_object', 'type', 'type_object', 'creators', 'collections', 'collections_hierarchy'],
          attributesToCrop: ['lehekylje_tekst', 'comments.text'],
          cropLength: 35,
          attributesToHighlight: ['lehekylje_tekst', tagsField, 'comments.text'],
          highlightPreTag: HIGHLIGHT_PRE_TAG,
          highlightPostTag: HIGHLIGHT_POST_TAG,
          attributesToSearchOn: attributesToSearchOn
        }),
        // Päring 3: Lehekülgede arvud teoste kaupa (work_id facet)
        index.search(query, {
          filter,
          limit: 0,
          facets: ['work_id'],
          attributesToSearchOn: attributesToSearchOn
        })
      ]);

      // Arvuta unikaalsete teoste statistika käsitsi
      const uniqueWorks = new Set<string>();
      const calculatedFacets: Record<string, Record<string, number>> = {
        [genreFacetField]: {},
        [typeFacetField]: {},
        [tagsFacetField]: {},
        'author_names': {},
        'originaal_kataloog': {} // Seda me stats querys ei küsinud, aga võiks
      };

      statsResponse.hits.forEach((hit: any) => {
        const workId = hit.work_id;
        if (workId && !uniqueWorks.has(workId)) {
          uniqueWorks.add(workId);

          // Helper stats
          const addToStats = (field: string, value: string | string[]) => {
             if (!value) return;
             const values = Array.isArray(value) ? value : [value];
             values.forEach(v => {
               if (!calculatedFacets[field][v]) calculatedFacets[field][v] = 0;
               calculatedFacets[field][v]++;
             });
          };

          addToStats(genreFacetField, hit[genreFacetField]);
          addToStats(typeFacetField, hit[typeFacetField]);
          addToStats(tagsFacetField, hit[tagsFacetField]);
          addToStats('author_names', hit.author_names);
          addToStats('author_names', hit.respondens_names);
        }
      });

      // Lisa work_id facet (lehekülgede arvud) otse Meilisearchist
      calculatedFacets['work_id'] = pageCountResponse.facetDistribution?.['work_id'] || {};

      // Kui stats-päring mahtus limiiti, on uniqueWorks.size täpne ja ühtib facetidega.
      // Kui limiit löödi lõhki, kasutame distinctResponse.estimatedTotalHits (ligikaudne).
      if ((statsResponse.estimatedTotalHits || 0) <= STATS_LIMIT) {
        totalWorks = uniqueWorks.size;
      } else {
        totalWorks = distinctResponse.estimatedTotalHits || uniqueWorks.size;
      }

      const workHitCounts = pageCountResponse.facetDistribution?.['work_id'] || {};
      const hitsWithCounts = distinctResponse.hits.map((hit: any) => ({
        ...normalizeContentSearchHit(hit),
        hitCount: workHitCounts[hit.work_id] || 1
      }));

      return {
        hits: hitsWithCounts as any,
        totalHits: pageCountResponse.estimatedTotalHits || 0, // Lehekülgi kokku
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
export const searchWorkHits = async (index: Index, query: string, workId: string, options: ContentSearchOptions = {}): Promise<ContentSearchHit[]> => {
  checkMixedContent();

  const filter: string[] = [`work_id = "${workId}"`];

  pushYearFilter(filter, options.yearStart, options.yearEnd);
  if (options.catalog && options.catalog !== 'all') filter.push(`originaal_kataloog = "${options.catalog}"`);

  const tagsField = options.lang ? `page_tags_${options.lang}` : 'page_tags_et';
  let attributesToSearchOn: string[] = ['lehekylje_tekst', tagsField, 'comments.text'];
  if (options.scope === 'original') attributesToSearchOn = ['lehekylje_tekst'];
  else if (options.scope === 'annotation') {
    attributesToSearchOn = [tagsField, 'comments.text', 'text_annotations_text'];
    if (!query) filter.push('has_annotations = true');
  }

  try {
    const response = await index.search(query, {
      filter,
      limit: 500, // Piisav ühele teosele
      attributesToRetrieve: ['id', 'work_id', 'lehekylje_number', 'lehekylje_tekst', 'text_content', 'title', 'year', 'year_display', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'page_tags', 'page_tags_object', tagsField, 'comments', 'text_annotations', 'genre', 'genre_object', 'type', 'type_object', 'creators'],
      attributesToCrop: ['lehekylje_tekst', 'comments.text'],
      cropLength: 35,
      attributesToHighlight: ['lehekylje_tekst', tagsField, 'comments.text'],
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
