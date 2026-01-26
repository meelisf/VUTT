
import { MeiliSearch } from 'meilisearch';
import { Page, Work, PageStatus, WorkStatus, ContentSearchResponse, ContentSearchOptions, ContentSearchHit, HistoryEntry } from '../types';
import { MEILI_HOST, MEILI_API_KEY, MEILI_INDEX, IMAGE_BASE_URL, FILE_API_URL } from '../config';

// Initialize Meilisearch client
const client = new MeiliSearch({
  host: MEILI_HOST,
  apiKey: MEILI_API_KEY,
});

const index = client.index(MEILI_INDEX);

// Abifunktsioon pildi URL-i ehitamiseks
const getFullImageUrl = (imagePath: string): string => {
  if (!imagePath) return '';
  const cleanPath = imagePath.startsWith('/') ? imagePath.slice(1) : imagePath;
  return `${IMAGE_BASE_URL}/${encodeURI(cleanPath)}`;
};

// Check for Mixed Content (HTTPS vs HTTP)
const checkMixedContent = () => {
  if (window.location.protocol === 'https:' && MEILI_HOST.startsWith('http:')) {
    throw new Error(
      `Turvaprobleem: Rakendus töötab HTTPS-is, aga andmebaas on HTTP-s (${MEILI_HOST}). Brauser blokeerib selle ühenduse (Mixed Content). Palun avage rakendus HTTP kaudu või seadistage andmebaas HTTPS-ile.`
    );
  }
};

// Promise to ensure we only run settings update once per session (lazily)
let settingsPromise: Promise<any> | null = null;

// Funktsioon indeksi seadistuste parandamiseks
const fixIndexSettings = async () => {
  try {
    let currentSettings: string[] | null = null;
    let sortableSettings: string[] | null = null;
    let filterableSettings: string[] | null = null;
    let currentDistinct: string | null = null;
    let currentRankingRules: string[] | null = null;
    try {
      currentSettings = await index.getSearchableAttributes();
      sortableSettings = await index.getSortableAttributes();
      filterableSettings = await index.getFilterableAttributes();
      currentDistinct = await index.getDistinctAttribute();
      currentRankingRules = await index.getRankingRules();
    } catch (e) {
      // Indeksit ei pruugi veel eksisteerida
    }

    const requiredSearch = ['page_tags', 'comments.text', 'lehekylje_tekst', 'respondens'];
    const requiredSort = ['last_modified'];
    const requiredFilter = ['work_id', 'teose_staatus', 'tags', 'creators', 'publisher', 'author_names', 'respondens_names']; // Filtreeritavad väljad
    // Kontrollime, kas exactness on esimesel kohal (meie soovitud järjekord)
    const needsRankingUpdate = !currentRankingRules || currentRankingRules[0] !== 'exactness';

    const needsSearchUpdate = !currentSettings || requiredSearch.some(r => !currentSettings.includes(r));
    const needsSortUpdate = !sortableSettings || requiredSort.some(r => !sortableSettings.includes(r));
    const needsFilterUpdate = !filterableSettings || requiredFilter.some(r => !filterableSettings.includes(r));
    const needsDistinctReset = currentDistinct !== null; // Eemaldame globaalse distinct seadistuse

    if (!needsSearchUpdate && !needsSortUpdate && !needsFilterUpdate && !needsDistinctReset && !needsRankingUpdate) {
      return true;
    }

    await index.updateFilterableAttributes([
      // V2/V3 väljad
      'work_id',  // nanoid - eelistatud routing jaoks
      'year',
      'title',
      'location_id',
      'publisher_id',
      'publisher',
      'genre_ids',
      'tags_ids',
      'creator_ids',
      'creators',
      'author_names',      // Mitte-respondens loojate nimed filtreerimiseks
      'respondens_names',  // Respondens loojate nimed filtreerimiseks
      'type',
      'type_et', 'type_en',
      'genre',
      'genre_et', 'genre_en',
      'collection',
      'collections_hierarchy',
      'authors_text',
      'languages',
      // Tagasiühilduvus
      'aasta',
      'autor',
      'respondens',
      'trükkal',
      'teose_id',
      'lehekylje_number',
      'originaal_kataloog',
      'page_tags',
      'status',
      'teose_staatus',
      'tags',
      'tags_et', 'tags_en'
    ]);

    await index.updateSortableAttributes([
      'aasta',
      'lehekylje_number',
      'last_modified',
      'pealkiri'
    ]);

    const searchTask = await index.updateSearchableAttributes([
      // V2/V3 väljad
      'title',
      'authors_text',
      'year',
      'location_search',
      'publisher_search',
      'genre_search',
      'tags_search',
      'series_title',
      // Tagasiühilduvus
      'pealkiri',
      'autor',
      'respondens',
      'aasta',
      'teose_id',
      'originaal_kataloog',
      'lehekylje_tekst',
      'page_tags',
      'comments.text'
    ]);

    // Increase max values per facet to ensure we get page counts for all works
    await index.updateSettings({
      faceting: {
        maxValuesPerFacet: 5000
      },
      pagination: {
        maxTotalHits: 10000
      },
      // Eemaldame globaalse distinct seadistuse (kasutame ainult päringutes kus vaja)
      distinctAttribute: null,
      // Ranking rules: exactness kõrgemal, et täpsed vasted tuleksid enne
      // Vaikimisi: ["words", "typo", "proximity", "attribute", "sort", "exactness"]
      // Muudame: exactness enne words, et "Oratio de liberatione urbis Rigae" 
      // tuleks enne teksti, kus on "Riga" mitu korda mainitud
      rankingRules: [
        "exactness",  // Täpne vaste kõige olulisem
        "words",      // Mitu otsingusõna vastab
        "typo",       // Kirjavead
        "proximity",  // Sõnade lähedus
        "attribute",  // Välja prioriteet (pealkiri > autor > respondens)
        "sort"        // Kasutaja sorteerimine
      ]
    });

    await index.waitForTask(searchTask.taskUid);
    return true;
  } catch (e) {
    console.warn("Ei suutnud indeksi seadistusi automaatselt parandada:", e);
    return false;
  }
};

const ensureSettings = () => {
  if (!settingsPromise) {
    settingsPromise = fixIndexSettings();
  }
  return settingsPromise;
};

// Interface for dashboard search options
interface DashboardSearchOptions {
  yearStart?: number;
  yearEnd?: number;
  sort?: string;
  author?: string;
  respondens?: string;
  printer?: string; // trükkal
  workStatus?: WorkStatus; // Teose koondstaatuse filter
  teoseTags?: string[]; // Teose märksõnad (AND loogika)
  onlyFirstPage?: boolean;
  // V2 väljad
  collection?: string; // Kollektsiooni filter (filtreerib collections_hierarchy järgi)
  genre?: string; // Žanri filter
  type?: string; // Tüübi filter (impressum, manuscript, jne)
  lang?: string; // Keele filter (et, en) - kasutatakse genre/type/tags väljadega
}

// Arvutab teose koondstaatuse lehekülgede staatuste põhjal
// Loogika: Kõik Valmis → Valmis, Kõik Toores → Toores, muidu → Töös
const calculateWorkStatus = (statuses: string[]): WorkStatus => {
  if (statuses.length === 0) return 'Toores';

  const allDone = statuses.every(s => s === PageStatus.DONE);
  if (allDone) return 'Valmis';

  const allRaw = statuses.every(s => s === PageStatus.RAW || !s);
  if (allRaw) return 'Toores';

  return 'Töös';
};

// Pärib mitme teose staatused korraga (efektiivsem kui ühekaupa)
// NB: Kuna indeksil on distinct='teose_id', peame tegema eraldi päringud iga teose jaoks
export const getWorkStatuses = async (workIds: string[]): Promise<Map<string, WorkStatus>> => {
  const statusMap = new Map<string, WorkStatus>();

  if (workIds.length === 0) return statusMap;

  try {
    // Teeme paralleelsed päringud iga teose jaoks
    // See on vajalik, kuna indeksi distinct seadistus ei lase meil
    // ühes päringus saada kõiki lehekülgi erinevatest teostest
    const promises = workIds.map(async (workId) => {
      const response = await index.search('', {
        filter: [`(work_id = "${workId}" OR teose_id = "${workId}")`],
        attributesToRetrieve: ['teose_id', 'status', 'lehekylje_number'],
        limit: 500  // Piisav ühe teose kõigile lehekülgedele
      });

      const statuses = response.hits.map((hit: any) => hit.status || PageStatus.RAW);
      return { workId, statuses };
    });

    const results = await Promise.all(promises);


    // Arvutame koondstaatuse igale teosele
    for (const { workId, statuses } of results) {
      statusMap.set(workId, calculateWorkStatus(statuses));
    }

    return statusMap;
  } catch (error) {
    console.error("getWorkStatuses error:", error);
    return statusMap;
  }
};

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
  await ensureSettings();

  // Vali õige väli vastavalt keelele
  // Kasutame alati keelespetsiifilisi välju (tags_et, tags_en)
  // sest põhiväli 'tags' võib sisaldada segamini keeli (Wikidata default label)
  const facetField = `tags_${lang}`;

  try {
    const filter: string[] = ['lehekylje_number = 1'];
    if (collection) {
      filter.push(`collections_hierarchy = "${collection}"`);
    }
    if (yearStart) {
      filter.push(`aasta >= ${yearStart}`);
    }
    if (yearEnd) {
      filter.push(`aasta <= ${yearEnd}`);
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
  await ensureSettings();

  // Kasutame alati keelespetsiifilisi välju (genre_et, genre_en)
  const facetField = `genre_${lang}`;

  try {
    const filter: string[] = ['lehekylje_number = 1'];
    if (collection) {
      filter.push(`collections_hierarchy = "${collection}"`);
    }
    if (yearStart) {
      filter.push(`aasta >= ${yearStart}`);
    }
    if (yearEnd) {
      filter.push(`aasta <= ${yearEnd}`);
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
  await ensureSettings();

  // Kasutame alati keelespetsiifilisi välju (type_et, type_en)
  const facetField = `type_${lang}`;

  try {
    const filter: string[] = ['lehekylje_number = 1'];
    if (collection) {
      filter.push(`collections_hierarchy = "${collection}"`);
    }
    if (yearStart) {
      filter.push(`aasta >= ${yearStart}`);
    }
    if (yearEnd) {
      filter.push(`aasta <= ${yearEnd}`);
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

// Dashboardi otsing: otsib teoseid
export const searchWorks = async (query: string, options?: DashboardSearchOptions): Promise<Work[]> => {
  checkMixedContent();
  await ensureSettings();

  try {
    const filter: string[] = [];

    // ALATI filtreeri esimese lehekülje järgi - tagab õige thumbnail ja tagid
    // V.A. kui otsime viimati muudetuid (siis tahame näha mis tahes lehte mis muutus)
    if (options?.onlyFirstPage !== false) {
      filter.push('lehekylje_number = 1');
    }

    // Apply server-side filters if provided
    if (options?.yearStart) {
      filter.push(`aasta >= ${options.yearStart}`);
    }
    if (options?.yearEnd) {
      filter.push(`aasta <= ${options.yearEnd}`);
    }
    if (options?.author) {
      // V2: Otsi author_names väljalt (mitte-respondens loojad)
      filter.push(`author_names = "${options.author}"`);
    }
    if (options?.respondens) {
      // V2: Otsi respondens_names väljalt
      filter.push(`respondens_names = "${options.respondens}"`);
    }
    if (options?.printer) {
      // V2: Otsi publisher väljalt
      filter.push(`publisher = "${options.printer}"`);
    }
    if (options?.workStatus) {
      filter.push(`teose_staatus = "${options.workStatus}"`);
    }
    // Teose märksõnade filter (AND loogika - teos peab vastama kõigile valitud märksõnadele)
    // Kasutab keelespetsiifilist välja (tags_et, tags_en)
    if (options?.teoseTags && options.teoseTags.length > 0) {
      const tagsField = options.lang ? `tags_${options.lang}` : 'tags_et';
      for (const tag of options.teoseTags) {
        filter.push(`${tagsField} = "${tag}"`);
      }
    }
    // V2: Kollektsiooni filter (kasutab collections_hierarchy, et kaasata alamkollektsioonid)
    if (options?.collection) {
      filter.push(`collections_hierarchy = "${options.collection}"`);
    }
    // V2: Žanri filter (kasutab keelespetsiifilist välja)
    if (options?.genre) {
      const genreField = options.lang ? `genre_${options.lang}` : 'genre_et';
      filter.push(`${genreField} = "${options.genre}"`);
    }
    // V2: Tüübi filter (kasutab keelespetsiifilist välja)
    if (options?.type) {
      const typeField = options.lang ? `type_${options.lang}` : 'type_et';
      filter.push(`${typeField} = "${options.type}"`);
    }

    const searchParams: any = {
      attributesToRetrieve: [
        // V2 väljad
        'work_id', 'teose_id', 'title', 'year', 'location', 'location_object', 'publisher', 'publisher_object',
        'type', 'type_object', 'genre', 'genre_object', 'collection', 'collections_hierarchy',
        'creators', 'authors_text', 'tags', 'tags_object', 'languages',
        'series', 'series_title', 'ester_id', 'external_url',
        // Tagasiühilduvus
        'originaal_kataloog', 'pealkiri', 'autor', 'respondens', 'aasta', 'koht', 'trükkal',
        'lehekylje_number', 'last_modified', 'teose_lehekylgede_arv', 'teose_staatus'
      ],
      attributesToSearchOn: ['title', 'authors_text', 'pealkiri', 'autor', 'respondens'], // Dashboard otsib pealkirjast ja autoritest
      filter: filter,
      limit: 5000 // Tõstame limiiti, et kõik teosed jõuaksid dashboardile (client-side pagination)
    };

    // Relevantsuse puhul EI kasuta distinct, et säilitada Meilisearchi relevantsuse järjekord
    // Muul juhul kasutame distinct, et saada üks tulemus teose kohta
    const useDistinct = options?.sort !== 'relevance';
    if (useDistinct) {
      searchParams.distinct = 'teose_id';
    }

    // Sorting logic
    if (options?.sort) {
      switch (options.sort) {
        case 'relevance':
          // Meilisearch kasutab relevantsust kui sort pole määratud
          break;
        case 'year_asc':
          searchParams.sort = ['aasta:asc'];
          break;
        case 'year_desc':
          searchParams.sort = ['aasta:desc'];
          break;
        case 'az':
          searchParams.sort = ['pealkiri:asc'];
          break;
        case 'recent':
          searchParams.sort = ['last_modified:desc'];
          break;
        default:
          searchParams.sort = ['aasta:asc'];
          break;
      }
    } else {
      // Vaikimisi sorteeri aasta järgi kasvavalt (kui sort pole määratud)
      searchParams.sort = ['aasta:asc'];
    }

    const response = await index.search(query, searchParams);

    // Kui kasutame distinct, siis iga hit on unikaalne teos
    // Kui EI kasuta distinct (relevance), siis peame grupeerima frontendis, säilitades järjekorra
    let uniqueHits = response.hits;
    if (!useDistinct) {
      // Grupeeri teose_id järgi, võttes ainult esimese (kõrgeima relevantsusega) tulemuse
      const seenWorkIds = new Set<string>();
      uniqueHits = response.hits.filter((hit: any) => {
        if (seenWorkIds.has(hit.teose_id)) {
          return false;
        }
        seenWorkIds.add(hit.teose_id);
        return true;
      });
    }

    const workIds = uniqueHits.map((hit: any) => hit.teose_id);

    // Fetch first page data (thumbnail, tags) for all works
    const firstPagesMap = new Map<string, { thumbnail_url: string; tags: string[]; page_tags?: string[] }>();

    if (workIds.length > 0) {
      // Batch the requests to avoid too-long filters (max ~100 IDs per batch)
      const BATCH_SIZE = 100;
      const batches: string[][] = [];
      for (let i = 0; i < workIds.length; i += BATCH_SIZE) {
        batches.push(workIds.slice(i, i + BATCH_SIZE));
      }

      // Execute batch queries in parallel
      const batchPromises = batches.map(async (batchIds) => {
        const batchResponse = await index.search('', {
          filter: batchIds.map(id => `teose_id = "${id}"`).join(' OR '),
          limit: batchIds.length * 20, // Max 20 pages per work
          sort: ['lehekylje_number:asc'],
          attributesToRetrieve: ['teose_id', 'lehekylje_pilt', 'lehekylje_number', 'tags']
        });
        return batchResponse.hits;
      });

      const batchResults = await Promise.all(batchPromises);

      // Process all results - take first (lowest page number) for each work
      for (const hits of batchResults) {
        for (const hit of hits as any[]) {
          if (!firstPagesMap.has(hit.teose_id)) {
            firstPagesMap.set(hit.teose_id, {
              thumbnail_url: getFullImageUrl(hit.lehekylje_pilt),
              tags: hit.tags || [],
              page_tags: hit.page_tags || []
            });
          }
        }
      }
    }

    const works: Work[] = uniqueHits.map((hit: any) => {
      const firstPageData = firstPagesMap.get(hit.teose_id);
      return {
        // V2 identifikaatorid - EELISTA NANOID!
        id: hit.work_id || hit.id || hit.teose_id,
        work_id: hit.work_id,
        teose_id: hit.teose_id,

        // V2 teose andmed (kasuta uusi välju, fallback vanadele)
        title: hit.title || hit.pealkiri || 'Pealkiri puudub',
        year: hit.year ?? parseInt(hit.aasta) ?? 0,
        location: hit.location_object || hit.location || hit.koht || '',
        publisher: hit.publisher_object || hit.publisher || hit.trükkal || '',

        // V2 taksonoomia
        type: hit.type,
        type_object: hit.type_object,
        genre: hit.genre_object || hit.genre,
        collection: hit.collection,
        collections_hierarchy: hit.collections_hierarchy || [],

        // V2 isikud
        creators: hit.creators || [],
        authors_text: hit.authors_text || [],

        // V2 märksõnad
        tags: hit.tags || [],
        tags_object: hit.tags_object || [],
        languages: hit.languages || ['lat'],

        // Seosed
        series: hit.series,
        series_title: hit.series_title,

        // Välised lingid
        ester_id: hit.ester_id,
        external_url: hit.external_url,

        // Lehekülje info
        page_count: hit.teose_lehekylgede_arv || 0,
        thumbnail_url: firstPageData?.thumbnail_url || getFullImageUrl(hit.lehekylje_pilt),
        work_status: hit.teose_staatus,
        page_tags: firstPageData?.page_tags || hit.page_tags || [],

        // Tagasiühilduvus
        catalog_name: hit.originaal_kataloog || 'Unknown',
        author: hit.autor || (hit.creators?.[0]?.name) || 'Teadmata autor',
        respondens: hit.respondens || (hit.creators?.find((c: any) => c.role === 'respondens')?.name),
        koht: hit.koht || hit.location,
        trükkal: hit.trükkal || hit.publisher,
        pealkiri: hit.pealkiri || hit.title,
        aasta: hit.aasta ?? hit.year,

        // Ajutine väli sorteerimiseks
        last_modified: hit.last_modified
      } as Work;
    });

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

    return works;

  } catch (error: any) {
    console.error("Meilisearch error:", error);
    throw new Error(`Ühenduse viga (${MEILI_HOST}): ${error.message}`);
  }
};

// Töölaud: Saa ühe lehekülje andmed
export const getPage = async (workId: string, pageNum: number): Promise<Page | null> => {
  checkMixedContent();
  try {
    // Otsime nii work_id (v2 nanoid) kui teose_id (slug) järgi
    // See võimaldab mõlemat tüüpi URL-e: /work/r20x08/1 ja /work/1640-4/1
    const response = await index.search('', {
      filter: [`(work_id = "${workId}" OR teose_id = "${workId}")`, `lehekylje_number = ${pageNum}`],
      limit: 1
    });

    if (response.hits.length === 0) return null;
    const hit: any = response.hits[0];

    return {
      // Identifikaatorid
      id: hit.id,
      work_id: hit.work_id,
      teose_id: hit.teose_id,

      // Lehekülje andmed
      page_number: parseInt(hit.lehekylje_number),
      text_content: hit.lehekylje_tekst || '',
      image_url: getFullImageUrl(hit.lehekylje_pilt),
      status: hit.status || PageStatus.RAW,
      comments: hit.comments || [],
      // Eelistame page_tags_object (objektid), fallback page_tags (stringid)
      page_tags: hit.page_tags_object || Array.from(new Set((hit.page_tags || []).map((t: any) => 
        typeof t === 'string' ? t.toLowerCase() : t
      ))),
      history: hit.history || [],

      // V2 teose andmed
      title: hit.title || hit.pealkiri,
      year: hit.year ?? hit.aasta,
      location: hit.location_object || hit.location || hit.koht,
      publisher: hit.publisher_object || hit.publisher || hit.trükkal,
      type: hit.type,
      type_object: hit.type_object,
      genre: hit.genre_object || hit.genre,
      collection: hit.collection,
      collections_hierarchy: hit.collections_hierarchy || [],
      creators: hit.creators || [],
      authors_text: hit.authors_text || [],
      tags: hit.tags || [],
      tags_object: hit.tags_object || [],
      languages: hit.languages || ['lat'],

      // Tagasiühilduvus
      original_path: hit.originaal_kataloog,
      originaal_kataloog: hit.originaal_kataloog,
      pealkiri: hit.pealkiri || hit.title,
      autor: hit.autor,
      respondens: hit.respondens,
      aasta: hit.aasta ?? hit.year,
      koht: hit.koht || hit.location,
      trükkal: hit.trükkal || hit.publisher,
    };
  } catch (error) {
    console.error("Get Page Error:", error);
    throw error;
  }
};

// Autentimisandmete tüüp API päringute jaoks (tõendipõhine)
interface AuthToken {
  token: string;
}

// Abifunktsioon failisüsteemi salvestamiseks
const saveToFileSystem = async (page: Page, original_catalog: string, image_url: string, auth?: AuthToken): Promise<boolean> => {
  try {
    const imageFilename = image_url.split('/').pop() || '';
    const textFilename = imageFilename.replace(/\.[^/.]+$/, "") + ".txt";

    if (!textFilename) {
      console.error("Ei suutnud tuletada failinime pildi URL-ist:", image_url);
      return false;
    }

    const metaContent = {
      status: page.status,
      page_tags: page.page_tags, // Use explicit naming for page-level tags
      comments: page.comments,
      history: page.history,
      work_id: page.work_id,
      page_number: page.page_number,
      updated_at: new Date().toISOString()
    };

    const payload: any = {
      text_content: page.text_content,
      meta_content: metaContent,
      original_path: original_catalog,
      file_name: textFilename,
      work_id: page.work_id,
      page_number: page.page_number
    };

    // Lisa autentimistõend kui olemas
    if (auth) {
      payload.auth_token = auth.token;
    }

    const response = await fetch(`${FILE_API_URL}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (errorData.message?.includes('Autentimine') || response.status === 401) {
        throw new Error('Autentimine ebaõnnestus. Palun logi välja ja uuesti sisse.');
      }
      throw new Error(`File server error: ${response.status}`);
    }
    return true;
  } catch (e: any) {
    console.error("Failed to save to file system:", e);
    alert(`Hoiatus: ${e.message || 'Failisüsteemi kirjutamine ebaõnnestus.'}`);
    return false;
  }
};

// =========================================================
// PENDING-EDITS FUNKTSIOONID (kaastööliste muudatused)
// =========================================================

export interface PendingEditInfo {
  has_own_pending: boolean;
  own_pending_edit: {
    id: string;
    submitted_at: string;
    new_text: string;
  } | null;
  other_pending_count: number;
}

// Kontrollib, kas lehel on ootel muudatusi
export const checkPendingEdits = async (
  teoseId: string,
  lehekyljeNumber: number,
  authToken: string
): Promise<PendingEditInfo> => {
  try {
    const response = await fetch(`${FILE_API_URL}/pending-edits/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        teose_id: teoseId,
        lehekylje_number: lehekyljeNumber
      })
    });

    const data = await response.json();

    if (data.status === 'success') {
      return {
        has_own_pending: data.has_own_pending,
        own_pending_edit: data.own_pending_edit,
        other_pending_count: data.other_pending_count
      };
    }

    return { has_own_pending: false, own_pending_edit: null, other_pending_count: 0 };
  } catch (e) {
    console.error('Check pending edits error:', e);
    return { has_own_pending: false, own_pending_edit: null, other_pending_count: 0 };
  }
};

// Salvestab muudatuse pending-olekusse (kaastöölise jaoks)
export const savePageAsPending = async (
  teoseId: string,
  lehekyljeNumber: number,
  originalText: string,
  newText: string,
  authToken: string
): Promise<{ success: boolean; editId?: string; hasOtherPending?: boolean; error?: string }> => {
  try {
    const response = await fetch(`${FILE_API_URL}/save-pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        teose_id: teoseId,
        lehekylje_number: lehekyljeNumber,
        original_text: originalText,
        new_text: newText
      })
    });

    const data = await response.json();

    if (data.status === 'success') {
      return {
        success: true,
        editId: data.edit_id,
        hasOtherPending: data.has_other_pending
      };
    }

    return { success: false, error: data.message };
  } catch (e: any) {
    console.error('Save pending edit error:', e);
    return { success: false, error: e.message || 'Salvestamine ebaõnnestus' };
  }
};

// Abifunktsioon: Arvutab teose staatuse ja uuendab selle kõigil lehekülgedel
// (denormaliseeritud väli kiireks filtreerimiseks)
const updateWorkStatusOnAllPages = async (workId: string): Promise<void> => {
  try {
    // 1. Päri kõik teose leheküljed
    const response = await index.search('', {
      filter: [`teose_id = "${workId}"`],
      attributesToRetrieve: ['id', 'status'],
      limit: 500 // Piisav kõigile lehekülgedele
    });

    if (response.hits.length === 0) return;

    // 2. Arvuta teose koondstaatus
    const statuses = response.hits.map((hit: any) => hit.status || PageStatus.RAW);
    const newWorkStatus = calculateWorkStatus(statuses);

    // 3. Uuenda teose_staatus kõigil lehekülgedel
    const updates = response.hits.map((hit: any) => ({
      id: hit.id,
      teose_staatus: newWorkStatus
    }));

    const task = await index.updateDocuments(updates);
    await index.waitForTask(task.taskUid);
  } catch (error) {
    console.error(`Failed to update teose_staatus for work ${workId}:`, error);
    // Ei viska viga edasi, sest see on sekundaarne operatsioon
  }
};

// Töölaud: Salvesta muudatused
export const savePage = async (
  page: Page,
  actionDescription: string = 'Muutis andmeid',
  userName: string = 'Anonüümne',
  auth?: AuthToken
): Promise<Page> => {
  try {
    const newHistoryEntry: HistoryEntry = {
      id: Date.now().toString(),
      user: userName,
      action: actionDescription.includes('staatus') ? 'status_change' : 'text_edit',
      timestamp: new Date().toISOString(),
      description: actionDescription
    };

    const updatedHistory = [newHistoryEntry, ...(page.history || [])];
    const nowTimestamp = Date.now();

    const pageToSave = {
      ...page,
      history: updatedHistory
    };

    // Meilisearchi uuendamine toimub backendis (file_server.py kutsub sync_work_to_meilisearch)
    // Frontend kasutab ainult otsinguvõtit, millel pole kirjutamisõigust

    if (page.original_path && page.image_url) {
      await saveToFileSystem(pageToSave, page.original_path, page.image_url, auth);
    } else {
      console.warn("Ei saa faili salvestada: puudub original_path või image_url");
    }

    return pageToSave;
  } catch (error) {
    console.error("Save Page Error:", error);
    throw error;
  }
};

// Töölaud: Saa teose metaandmed
export const getWorkMetadata = async (workId: string): Promise<Work | undefined> => {
  try {
    // Otsime nii work_id (v2 nanoid) kui teose_id (slug) järgi
    const response = await index.search('', {
      filter: [`(work_id = "${workId}" OR teose_id = "${workId}")`],
      attributesToRetrieve: [
        // V2 väljad
        'work_id', 'teose_id', 'title', 'year', 'location', 'location_object', 'publisher', 'publisher_object',
        'type', 'type_object', 'genre', 'genre_object', 'collection', 'collections_hierarchy',
        'creators', 'authors_text', 'tags', 'tags_object', 'languages',
        'series', 'series_title', 'ester_id', 'external_url',
        // Tagasiühilduvus
        'originaal_kataloog', 'pealkiri', 'autor', 'respondens', 'aasta',
        'lehekylje_pilt', 'teose_lehekylgede_arv', 'koht', 'trükkal'
      ],
      limit: 1
    });

    if (response.hits.length === 0) return undefined;
    const hit: any = response.hits[0];

    return {
      // V2 identifikaatorid
      id: hit.id || hit.teose_id,
      work_id: hit.work_id,
      teose_id: hit.teose_id,

      // V2 teose andmed
      title: hit.title || hit.pealkiri || '',
      year: hit.year ?? parseInt(hit.aasta) ?? 0,
      location: hit.location_object || hit.location || hit.koht || '',
      publisher: hit.publisher_object || hit.publisher || hit.trükkal || '',

      // V2 taksonoomia
      type: hit.type,
      type_object: hit.type_object,
      genre: hit.genre_object || hit.genre,
      collection: hit.collection,
      collections_hierarchy: hit.collections_hierarchy || [],

      // V2 isikud
      creators: hit.creators || [],
      authors_text: hit.authors_text || [],

      // V2 märksõnad
      tags: hit.tags || [],
      tags_object: hit.tags_object || [],
      languages: hit.languages || ['lat'],

      // Seosed
      series: hit.series,
      series_title: hit.series_title,

      // Välised lingid
      ester_id: hit.ester_id,
      external_url: hit.external_url,

      // Lehekülje info
      page_count: hit.teose_lehekylgede_arv || 0,
      thumbnail_url: getFullImageUrl(hit.lehekylje_pilt),

      // Tagasiühilduvus
      catalog_name: hit.originaal_kataloog,
      author: hit.autor || (hit.creators?.[0]?.name) || '',
      respondens: hit.respondens || (hit.creators?.find((c: any) => c.role === 'respondens')?.name),
      koht: hit.koht || hit.location,
      trükkal: hit.trükkal || hit.publisher,
      pealkiri: hit.pealkiri || hit.title,
      aasta: hit.aasta ?? hit.year
    } as Work;
  } catch (e) {
    console.error("Work Metadata Error:", e);
    return undefined;
  }
};

// Täisteksti otsing
// Kui workId on määratud - otsib ainult sellest teosest (kõik vasted, ilma distinct'ita)
// Muidu - tagastab 10 teost (distinct), iga teose kohta 1 esinduslik vaste
export const searchContent = async (query: string, page: number = 1, options: ContentSearchOptions = {}): Promise<ContentSearchResponse> => {
  checkMixedContent();
  await ensureSettings();

  const limit = options.workId ? 20 : 10; // Teose piires rohkem vasteid lehel
  const offset = (page - 1) * limit;
  const filter: string[] = [];

  if (options.workId) filter.push(`(work_id = "${options.workId}" OR teose_id = "${options.workId}")`);
  if (options.yearStart) filter.push(`aasta >= ${options.yearStart}`);
  if (options.yearEnd) filter.push(`aasta <= ${options.yearEnd}`);
  if (options.catalog && options.catalog !== 'all') filter.push(`originaal_kataloog = "${options.catalog}"`);
  // Teose märksõnade filter (AND loogika, kasutab keelespetsiifilist välja)
  if (options.teoseTags && options.teoseTags.length > 0) {
    const tagsField = options.lang ? `tags_${options.lang}` : 'tags_et';
    for (const tag of options.teoseTags) {
      filter.push(`${tagsField} = "${tag}"`);
    }
  }
  // V2: Kollektsiooni filter
  if (options.collection) {
    filter.push(`collections_hierarchy = "${options.collection}"`);
  }
  // V2: Žanri filter (kasutab keelespetsiifilist välja)
  if (options.genre) {
    const genreField = options.lang ? `genre_${options.lang}` : 'genre_et';
    filter.push(`${genreField} = "${options.genre}"`);
  }
  // V2: Tüübi filter (kasutab keelespetsiifilist välja)
  if (options.type) {
    const typeField = options.lang ? `type_${options.lang}` : 'type_et';
    filter.push(`${typeField} = "${options.type}"`);
  }

  const tagsField = options.lang ? `page_tags_${options.lang}` : 'page_tags_et';
  const genreFacetField = options.lang ? `genre_${options.lang}` : 'genre_et';
  const typeFacetField = options.lang ? `type_${options.lang}` : 'type_et';
  const tagsFacetField = options.lang ? `tags_${options.lang}` : 'tags_et';

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
        facets: ['originaal_kataloog', 'teose_id'],
        attributesToRetrieve: ['id', 'work_id', 'teose_id', 'lehekylje_number', 'lehekylje_tekst', 'pealkiri', 'autor', 'aasta', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'page_tags', tagsField, 'comments', 'genre', 'genre_object', 'type', 'type_object', 'creators'],
        // Ei kasuta croppi - näitame kogu teksti
        attributesToHighlight: ['lehekylje_tekst', tagsField, 'comments.text'],
        highlightPreTag: '<em class="bg-yellow-200 font-bold not-italic">',
        highlightPostTag: '</em>',
        attributesToSearchOn: attributesToSearchOn
      });

      const totalHits = response.estimatedTotalHits || 0;

      return {
        hits: response.hits as any,
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
          facets: ['originaal_kataloog', genreFacetField, typeFacetField, tagsFacetField],
          attributesToSearchOn: attributesToSearchOn
        }),
        // Päring 2: Sisu (teosed)
        index.search('', {
          offset,
          limit,
          filter,
          distinct: 'teose_id',
          attributesToRetrieve: ['id', 'work_id', 'teose_id', 'lehekylje_number', 'lehekylje_tekst', 'pealkiri', 'autor', 'aasta', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'page_tags', tagsField, 'comments', 'genre', 'genre_object', 'type', 'type_object', 'creators'],
          sort: ['aasta:asc'], // Vaikimisi sortimine aasta järgi kui otsingut pole
          attributesToSearchOn: attributesToSearchOn
        })
      ]);

      facetDistribution = statsResponse.facetDistribution || {};
      totalWorks = statsResponse.estimatedTotalHits || 0; // estimatedTotalHits on täpne kui pole query stringi

      // Hit count on alati lehekülgede arv (aga siin me ei tea seda täpselt ilma lisapäringuta,
      // aga sirvimise puhul pole "x vastet sellest teosest" nii kriitiline, eeldame lehekülgede arvu teose metadata küljest)
      
      // Kui tahame teada teose lehekülgede arvu, peame seda küsima.
      // Sirvimisel 'hitCount' pole tavaliselt vajalik või on see teose kogulehekülgede arv.
      const hitsWithCounts = distinctResponse.hits.map((hit: any) => ({
        ...hit,
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
          attributesToRetrieve: ['teose_id', genreFacetField, typeFacetField, tagsFacetField],
          attributesToSearchOn: attributesToSearchOn
        }),
        // Päring 2: Sisu (kuvatavad teosed, distinct)
        index.search(query, {
          offset,
          limit,
          filter,
          distinct: 'teose_id',
          attributesToRetrieve: ['id', 'work_id', 'teose_id', 'lehekylje_number', 'lehekylje_tekst', 'pealkiri', 'autor', 'aasta', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'page_tags', tagsField, 'comments', 'genre', 'genre_object', 'type', 'type_object', 'creators'],
          attributesToCrop: ['lehekylje_tekst', 'comments.text'],
          cropLength: 35,
          attributesToHighlight: ['lehekylje_tekst', tagsField, 'comments.text'],
          highlightPreTag: '<em class="bg-yellow-200 font-bold not-italic">',
          highlightPostTag: '</em>',
          attributesToSearchOn: attributesToSearchOn
        }),
        // Päring 3: Lehekülgede arvud teoste kaupa (teose_id facet)
        index.search(query, {
          filter,
          limit: 0,
          facets: ['teose_id'],
          attributesToSearchOn: attributesToSearchOn
        })
      ]);

      // Arvuta unikaalsete teoste statistika käsitsi
      const uniqueWorks = new Set<string>();
      const calculatedFacets: Record<string, Record<string, number>> = {
        [genreFacetField]: {},
        [typeFacetField]: {},
        [tagsFacetField]: {},
        'originaal_kataloog': {} // Seda me stats querys ei küsinud, aga võiks
      };

      statsResponse.hits.forEach((hit: any) => {
        if (!uniqueWorks.has(hit.teose_id)) {
          uniqueWorks.add(hit.teose_id);
          
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
        }
      });
      
      // Lisa teose_id facet (lehekülgede arvud) otse Meilisearchist
      calculatedFacets['teose_id'] = pageCountResponse.facetDistribution?.['teose_id'] || {};

      totalWorks = distinctResponse.estimatedTotalHits || uniqueWorks.size; // estimatedTotalHits on distinct query puhul ebatäpne vanemates versioonides
      // Kasutame usaldusväärsemat numbrit: distinct response estimated hits peaks olema teoste arv
      
      // Workaround: Kui stats limit oli piisav, on uniqueWorks.size täpne. 
      // Kui stats limit löödi lõhki, on distinctResponse.estimatedTotalHits parem (kuigi see võib olla page count).
      // Meilisearchi käitumine estimatedTotalHits + distinct osas on versiooniti erinev.
      // Eeldame praegu, et uniqueWorks.size on "vähemalt nii palju".

      const workHitCounts = pageCountResponse.facetDistribution?.['teose_id'] || {};
      const hitsWithCounts = distinctResponse.hits.map((hit: any) => ({
        ...hit,
        hitCount: workHitCounts[hit.teose_id] || 1
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
  await ensureSettings();

  const filter: string[] = [`(work_id = "${workId}" OR teose_id = "${workId}")`];

  if (options.yearStart) filter.push(`aasta >= ${options.yearStart}`);
  if (options.yearEnd) filter.push(`aasta <= ${options.yearEnd}`);
  if (options.catalog && options.catalog !== 'all') filter.push(`originaal_kataloog = "${options.catalog}"`);

  const tagsField = options.lang ? `page_tags_${options.lang}` : 'page_tags_et';
  let attributesToSearchOn: string[] = ['lehekylje_tekst', tagsField, 'comments.text'];
  if (options.scope === 'original') attributesToSearchOn = ['lehekylje_tekst'];
  else if (options.scope === 'annotation') attributesToSearchOn = [tagsField, 'comments.text'];

  try {
    const response = await index.search(query, {
      filter,
      limit: 500, // Piisav ühele teosele
      attributesToRetrieve: ['id', 'work_id', 'teose_id', 'lehekylje_number', 'lehekylje_tekst', 'pealkiri', 'autor', 'aasta', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'page_tags', tagsField, 'comments', 'genre', 'genre_object', 'type', 'type_object', 'creators'],
      attributesToCrop: ['lehekylje_tekst', 'comments.text'],
      cropLength: 35,
      attributesToHighlight: ['lehekylje_tekst', tagsField, 'comments.text'],
      highlightPreTag: '<em class="bg-yellow-200 font-bold not-italic">',
      highlightPostTag: '</em>',
      sort: ['lehekylje_number:asc'],
      attributesToSearchOn: attributesToSearchOn
    });

    return response.hits as ContentSearchHit[];
  } catch (e: any) {
    console.error('searchWorkHits error:', e);
    throw e;
  }
};

// Märksõnade autocomplete: saa kõik unikaalsed märksõnad kasutades facet'e
export const getAllTags = async (): Promise<string[]> => {
  checkMixedContent();
  try {
    // Kasutame facet'e, et saada kõik unikaalsed märksõnad
    // See on palju efektiivsem kui kõikide dokumentide läbivaatamine
    const response = await index.search('', {
      limit: 0, // Me ei vaja tulemusi, ainult facet'e
      facets: ['page_tags']
    });

    const tagFacets = response.facetDistribution?.['page_tags'] || {};
    const normalizedTags = Array.from(new Set(Object.keys(tagFacets).map(t => t.toLowerCase())));
    return normalizedTags.sort((a, b) => a.localeCompare(b, 'et'));
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
      filter: `(work_id = "${teoseId}" OR teose_id = "${teoseId}")`,
      sort: ['lehekylje_number:asc'],
      limit: 1000, // Piisavalt suur, et kõik leheküljed mahuks
      attributesToRetrieve: ['lehekylje_tekst', 'lehekylje_number', 'pealkiri', 'autor', 'aasta']
    });

    if (response.hits.length === 0) {
      throw new Error('Teost ei leitud');
    }

    const firstHit = response.hits[0] as any;
    const title = firstHit.pealkiri || 'Tundmatu';
    const author = firstHit.autor || 'Tundmatu';
    const year = firstHit.aasta || 0;

    // Liidame kõik leheküljed kokku, eraldades need "--- lk ---" märgendiga
    const fullText = response.hits
      .map((hit: any) => hit.lehekylje_tekst || '')
      .join('\n\n--- lk ---\n\n');

    return { text: fullText, title, author, year };
  } catch (e) {
    console.error('getWorkFullText error:', e);
    throw e;
  }
};
