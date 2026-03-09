/**
 * Otsing, sirvimis- ja facet-päringud Meilisearchist
 */

import { Work, ContentSearchResponse, ContentSearchOptions, ContentSearchHit } from '../types';
import { MEILI_HOST } from '../config';
import { index, isQCode, checkMixedContent, normalizeWork, normalizeContentSearchHit } from './meiliService';

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
  genre_et?: Record<string, number>;
  genre_en?: Record<string, number>;
  tags_et?: Record<string, number>;
  tags_en?: Record<string, number>;
  type_et?: Record<string, number>;
  type_en?: Record<string, number>;
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
  collection?: string,
  lang: string = 'et',
  yearStart?: number,
  yearEnd?: number
): Promise<{ tag: string; count: number }[]> => {
  checkMixedContent();

  // Vali õige väli vastavalt keelele
  // Kasutame alati keelespetsiifilisi välju (tags_et, tags_en)
  // sest põhiväli 'tags' võib sisaldada segamini keeli (Wikidata default label)
  const facetField = `tags_${lang}`;

  try {
    const filter: string[] = ['lehekylje_number = 1'];
    if (collection) {
      filter.push(`(collections_hierarchy = "${collection}" OR collections = "${collection}")`);
    }
    if (yearStart) {
      filter.push(`year >= ${yearStart}`);
    }
    if (yearEnd) {
      filter.push(`year <= ${yearEnd}`);
    }

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
    // Fallback eesti keelele kui keelepõhist välja ei leidu
    if (lang !== 'et') return getTeoseTagsFacets(collection, 'et', yearStart, yearEnd);
    return [];
  }
};

// Saab kõik žanrid (genre) koos loendiga - facet query
// yearStart/yearEnd võimaldavad filtrite dünaamilist uuendamist aasta vahemiku järgi
export const getGenreFacets = async (
  collection?: string,
  lang: string = 'et',
  yearStart?: number,
  yearEnd?: number
): Promise<{ value: string; count: number }[]> => {
  checkMixedContent();

  // Kasutame alati keelespetsiifilisi välju (genre_et, genre_en)
  const facetField = `genre_${lang}`;

  try {
    const filter: string[] = ['lehekylje_number = 1'];
    if (collection) {
      filter.push(`(collections_hierarchy = "${collection}" OR collections = "${collection}")`);
    }
    if (yearStart) {
      filter.push(`year >= ${yearStart}`);
    }
    if (yearEnd) {
      filter.push(`year <= ${yearEnd}`);
    }

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
    // Fallback eesti keelele kui keelepõhist välja ei leidu
    if (lang !== 'et') return getGenreFacets(collection, 'et', yearStart, yearEnd);
    return [];
  }
};

// Saab kõik tüübid (type) koos loendiga - facet query
// yearStart/yearEnd võimaldavad filtrite dünaamilist uuendamist aasta vahemiku järgi
export const getTypeFacets = async (
  collection?: string,
  lang: string = 'et',
  yearStart?: number,
  yearEnd?: number
): Promise<{ value: string; count: number }[]> => {
  checkMixedContent();

  // Kasutame alati keelespetsiifilisi välju (type_et, type_en)
  const facetField = `type_${lang}`;

  try {
    const filter: string[] = ['lehekylje_number = 1'];
    if (collection) {
      filter.push(`(collections_hierarchy = "${collection}" OR collections = "${collection}")`);
    }
    if (yearStart) {
      filter.push(`year >= ${yearStart}`);
    }
    if (yearEnd) {
      filter.push(`year <= ${yearEnd}`);
    }

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
    // Fallback eesti keelele kui keelepõhist välja ei leidu
    if (lang !== 'et') return getTypeFacets(collection, 'et', yearStart, yearEnd);
    return [];
  }
};

// Autorite facetid (author_names väljast)
export const getAuthorFacets = async (
  collection?: string,
  yearStart?: number,
  yearEnd?: number
): Promise<{ value: string; count: number }[]> => {
  checkMixedContent();

  try {
    const filter: string[] = ['lehekylje_number = 1'];
    if (collection) {
      filter.push(`(collections_hierarchy = "${collection}" OR collections = "${collection}")`);
    }
    if (yearStart) {
      filter.push(`year >= ${yearStart}`);
    }
    if (yearEnd) {
      filter.push(`year <= ${yearEnd}`);
    }

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
export const searchWorks = async (query: string, options?: DashboardSearchOptions): Promise<SearchWorksResult> => {
  checkMixedContent();

  try {
    const filter: string[] = [];

    // ALATI filtreeri esimese lehekülje järgi - tagab õige thumbnail ja tagid
    // V.A. kui otsime viimati muudetuid (siis tahame näha mis tahes lehte mis muutus)
    if (options?.onlyFirstPage !== false) {
      filter.push('lehekylje_number = 1');
    }

    // Apply server-side filters if provided
    if (options?.yearStart) {
      filter.push(`year >= ${options.yearStart}`);
    }
    if (options?.yearEnd) {
      filter.push(`year <= ${options.yearEnd}`);
    }
    if (options?.author) {
      filter.push(`(author_names = "${options.author}" OR respondens_names = "${options.author}")`);
    }
    if (options?.respondens) {
      filter.push(`respondens_names = "${options.respondens}"`);
    }
    if (options?.printer) {
      // Q-kood → publisher_id filter, muidu label täpne vaste
      if (isQCode(options.printer)) {
        filter.push(`publisher_id = "${options.printer}"`);
      } else {
        filter.push(`publisher = "${options.printer}"`);
      }
    }
    if (options?.workStatus) {
      filter.push(`teose_staatus = "${options.workStatus}"`);
    }
    // Teose märksõnade filter (AND loogika - teos peab vastama kõigile valitud märksõnadele)
    // Q-kood → tags_ids, label → keelespetsiifiline väli
    if (options?.teoseTags && options.teoseTags.length > 0) {
      for (const tag of options.teoseTags) {
        if (isQCode(tag)) {
          filter.push(`tags_ids = "${tag}"`);
        } else {
          filter.push(`(tags_et = "${tag}" OR tags_en = "${tag}")`);
        }
      }
    }
    // V2: Kollektsiooni filter (kasutab collections_hierarchy, et kaasata alamkollektsioonid)
    if (options?.collection) {
      filter.push(`(collections_hierarchy = "${options.collection}" OR collections = "${options.collection}")`);
    }
    // V2: Žanri filter (Q-kood → genre_ids, label → bilinguaalne OR)
    if (options?.genre && options.genre.length > 0) {
      const genreConditions = options.genre.map(g => {
        if (isQCode(g)) return `genre_ids = "${g}"`;
        return `(genre_et = "${g}" OR genre_en = "${g}")`;
      }).join(' OR ');
      filter.push(options.genre.length === 1 ? genreConditions : `(${genreConditions})`);
    }
    // V2: Tüübi filter (Q-kood → type_ids, label → bilinguaalne OR)
    if (options?.type && options.type.length > 0) {
      const typeConditions = options.type.map(t => {
        if (isQCode(t)) return `type_ids = "${t}"`;
        return `(type_et = "${t}" OR type_en = "${t}")`;
      }).join(' OR ');
      filter.push(options.type.length === 1 ? typeConditions : `(${typeConditions})`);
    }

    // Vali facet väljad vastavalt keelele
    const facetLang = options?.lang || 'et';
    const genreFacetField = `genre_${facetLang}`;
    const typeFacetField = `type_${facetLang}`;
    const tagsFacetField = `tags_${facetLang}`;

    const searchParams: any = {
      attributesToRetrieve: [
        'id', 'work_id', 'title', 'year', 'year_display', 'location', 'publisher', 'publisher_id',
        'type', 'type_object', 'genre', 'genre_object', 'collections', 'collections_hierarchy',
        'creators', 'authors_text', 'tags', 'tags_object', 'languages',
        'series', 'series_title', 'ester_id', 'external_url',
        'originaal_kataloog', 'lehekylje_number', 'last_modified', 'teose_lehekylgede_arv', 'teose_staatus'
      ],
      attributesToSearchOn: ['title', 'authors_text'], // Dashboard otsib pealkirjast ja autoritest
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
        [`genre_${facetLang}`]: facetDistribution[genreFacetField],
        [`type_${facetLang}`]: facetDistribution[typeFacetField],
        [`tags_${facetLang}`]: facetDistribution[tagsFacetField],
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
export const searchContent = async (query: string, page: number = 1, options: ContentSearchOptions = {}): Promise<ContentSearchResponse> => {
  checkMixedContent();

  const limit = options.workId ? 20 : 10; // Teose piires rohkem vasteid lehel
  const offset = (page - 1) * limit;
  const filter: string[] = [];

  if (options.workId) filter.push(`work_id = "${options.workId}"`);
  if (options.yearStart) filter.push(`year >= ${options.yearStart}`);
  if (options.yearEnd) filter.push(`year <= ${options.yearEnd}`);
  if (options.catalog && options.catalog !== 'all') filter.push(`originaal_kataloog = "${options.catalog}"`);
  // Teose märksõnade filter (AND loogika)
  // Q-kood → tags_ids, label → bilinguaalne OR
  if (options.teoseTags && options.teoseTags.length > 0) {
    for (const tag of options.teoseTags) {
      if (isQCode(tag)) {
        filter.push(`tags_ids = "${tag}"`);
      } else {
        filter.push(`(tags_et = "${tag}" OR tags_en = "${tag}")`);
      }
    }
  }
  // Lehekülje märksõnade filter (AND loogika)
  // Q-kood → page_tags_ids, label → bilinguaalne OR
  if (options.pageTags && options.pageTags.length > 0) {
    for (const tag of options.pageTags) {
      if (isQCode(tag)) {
        filter.push(`page_tags_ids = "${tag}"`);
      } else {
        filter.push(`(page_tags_et = "${tag}" OR page_tags_en = "${tag}")`);
      }
    }
  }
  // V2: Kollektsiooni filter
  if (options.collection) {
    filter.push(`(collections_hierarchy = "${options.collection}" OR collections = "${options.collection}")`);
  }
  // V2: Žanri filter (Q-kood → genre_ids, label → bilinguaalne OR)
  if (options.genre && options.genre.length > 0) {
    const genreConditions = options.genre.map(g => {
      if (isQCode(g)) return `genre_ids = "${g}"`;
      return `(genre_et = "${g}" OR genre_en = "${g}")`;
    }).join(' OR ');
    filter.push(options.genre.length === 1 ? genreConditions : `(${genreConditions})`);
  }
  // V2: Tüübi filter (Q-kood → type_ids, label → bilinguaalne OR)
  if (options.type && options.type.length > 0) {
    const typeConditions = options.type.map(t => {
      if (isQCode(t)) return `type_ids = "${t}"`;
      return `(type_et = "${t}" OR type_en = "${t}")`;
    }).join(' OR ');
    filter.push(options.type.length === 1 ? typeConditions : `(${typeConditions})`);
  }
  // V2: Autori filter (kõik creators: author_names + respondens_names)
  if (options.author) {
    filter.push(`(author_names = "${options.author}" OR respondens_names = "${options.author}")`);
  }

  const tagsField = options.lang ? `page_tags_${options.lang}` : 'page_tags_et';
  const facetLang = options.lang || 'et';
  const genreFacetField = `genre_${facetLang}`;
  const typeFacetField = `type_${facetLang}`;
  const tagsFacetField = `tags_${facetLang}`;

  let attributesToSearchOn: string[] = ['lehekylje_tekst', tagsField, 'comments.text'];
  if (options.scope === 'original') attributesToSearchOn = ['lehekylje_tekst'];
  else if (options.scope === 'annotation') attributesToSearchOn = [tagsField, 'comments.text'];

  try {
    // Kui otsime ühe teose piires, näitame kogu lehekülje teksti kõigi highlight'idega
    if (options.workId) {
      const response = await index.search(query, {
        offset,
        limit,
        filter,
        facets: ['originaal_kataloog', 'work_id'],
        attributesToRetrieve: ['id', 'work_id', 'lehekylje_number', 'lehekylje_tekst', 'text_content', 'title', 'year', 'year_display', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'page_tags', 'page_tags_object', tagsField, 'comments', 'genre', 'genre_object', 'type', 'type_object', 'creators', 'collections', 'collections_hierarchy'],
        // Ei kasuta croppi - näitame kogu teksti
        attributesToHighlight: ['lehekylje_tekst', tagsField, 'comments.text'],
        highlightPreTag: '<em class="bg-yellow-200 font-bold not-italic">',
        highlightPostTag: '</em>',
        attributesToSearchOn: attributesToSearchOn
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
          attributesToRetrieve: ['id', 'work_id', 'lehekylje_number', 'lehekylje_tekst', 'title', 'year', 'year_display', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'tags_object', 'page_tags', 'page_tags_object', tagsField, 'comments', 'genre', 'genre_object', 'type', 'type_object', 'creators', 'collections', 'collections_hierarchy'],
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
          attributesToRetrieve: ['id', 'work_id', 'lehekylje_number', 'lehekylje_tekst', 'text_content', 'title', 'year', 'year_display', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'tags_object', 'page_tags', 'page_tags_object', tagsField, 'comments', 'genre', 'genre_object', 'type', 'type_object', 'creators', 'collections', 'collections_hierarchy'],
          attributesToCrop: ['lehekylje_tekst', 'comments.text'],
          cropLength: 35,
          attributesToHighlight: ['lehekylje_tekst', tagsField, 'comments.text'],
          highlightPreTag: '<em class="bg-yellow-200 font-bold not-italic">',
          highlightPostTag: '</em>',
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
export const searchWorkHits = async (query: string, workId: string, options: ContentSearchOptions = {}): Promise<ContentSearchHit[]> => {
  checkMixedContent();

  const filter: string[] = [`work_id = "${workId}"`];

  if (options.yearStart) filter.push(`year >= ${options.yearStart}`);
  if (options.yearEnd) filter.push(`year <= ${options.yearEnd}`);
  if (options.catalog && options.catalog !== 'all') filter.push(`originaal_kataloog = "${options.catalog}"`);

  const tagsField = options.lang ? `page_tags_${options.lang}` : 'page_tags_et';
  let attributesToSearchOn: string[] = ['lehekylje_tekst', tagsField, 'comments.text'];
  if (options.scope === 'original') attributesToSearchOn = ['lehekylje_tekst'];
  else if (options.scope === 'annotation') attributesToSearchOn = [tagsField, 'comments.text'];

  try {
    const response = await index.search(query, {
      filter,
      limit: 500, // Piisav ühele teosele
      attributesToRetrieve: ['id', 'work_id', 'lehekylje_number', 'lehekylje_tekst', 'text_content', 'title', 'year', 'year_display', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'page_tags', 'page_tags_object', tagsField, 'comments', 'genre', 'genre_object', 'type', 'type_object', 'creators'],
      attributesToCrop: ['lehekylje_tekst', 'comments.text'],
      cropLength: 35,
      attributesToHighlight: ['lehekylje_tekst', tagsField, 'comments.text'],
      highlightPreTag: '<em class="bg-yellow-200 font-bold not-italic">',
      highlightPostTag: '</em>',
      sort: ['lehekylje_number:asc'],
      attributesToSearchOn: attributesToSearchOn
    });

    return response.hits.map(normalizeContentSearchHit);
  } catch (e: any) {
    console.error('searchWorkHits error:', e);
    throw e;
  }
};

// Märksõnade autocomplete: saa kõik unikaalsed märksõnad koos ID-dega
export const getAllTags = async (lang: string = 'et'): Promise<{ label: string; id: string | null }[]> => {
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

// Lae alla kogu teose tekst ühes failis
export const getWorkFullText = async (teoseId: string): Promise<{ text: string; title: string; author: string; year: number }> => {
  checkMixedContent();
  try {
    // Pärime kõik teose leheküljed, sorteeritud lehekülje numbri järgi
    const response = await index.search('', {
      filter: `work_id = "${teoseId}"`,
      sort: ['lehekylje_number:asc'],
      limit: 1000, // Piisavalt suur, et kõik leheküljed mahuks
      attributesToRetrieve: ['lehekylje_tekst', 'text_content', 'lehekylje_number', 'title', 'year']
    });

    if (response.hits.length === 0) {
      throw new Error('Teost ei leitud');
    }

    const firstHit = response.hits[0] as any;
    const title = firstHit.title || 'Tundmatu';
    const author = firstHit.creators?.[0]?.name || 'Tundmatu';
    const year = firstHit.year || 0;

    // Liidame kõik leheküljed kokku, eraldades need "--- lk ---" märgendiga
    const fullText = response.hits
      .map((hit: any) => hit.text_content || hit.lehekylje_tekst || '')
      .join('\n\n--- lk ---\n\n');

    return { text: fullText, title, author, year };
  } catch (e) {
    console.error('getWorkFullText error:', e);
    throw e;
  }
};
