
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
  console.log("Kontrollin Meilisearchi indeksi seadistusi...");
  try {
    let currentSettings: string[] | null = null;
    let sortableSettings: string[] | null = null;
    let filterableSettings: string[] | null = null;
    let currentDistinct: string | null = null;
    try {
      currentSettings = await index.getSearchableAttributes();
      sortableSettings = await index.getSortableAttributes();
      filterableSettings = await index.getFilterableAttributes();
      currentDistinct = await index.getDistinctAttribute();
    } catch (e) {
      // Indeksit ei pruugi veel eksisteerida
    }

    const requiredSearch = ['tags', 'comments.text', 'lehekylje_tekst', 'respondens'];
    const requiredSort = ['last_modified'];
    const requiredFilter = ['teose_staatus']; // Uus filtreeritav väli

    const needsSearchUpdate = !currentSettings || requiredSearch.some(r => !currentSettings.includes(r));
    const needsSortUpdate = !sortableSettings || requiredSort.some(r => !sortableSettings.includes(r));
    const needsFilterUpdate = !filterableSettings || requiredFilter.some(r => !filterableSettings.includes(r));
    const needsDistinctReset = currentDistinct !== null; // Eemaldame globaalse distinct seadistuse

    if (!needsSearchUpdate && !needsSortUpdate && !needsFilterUpdate && !needsDistinctReset) {
      console.log("Indeksi seadistused on juba korras.");
      return true;
    }

    console.log("Algatan indeksi seadistuste uuendamise...");

    await index.updateFilterableAttributes([
      'aasta',
      'autor',
      'teose_id',
      'lehekylje_number',
      'originaal_kataloog',
      'tags',  // Vajalik facet'ide jaoks (märksõnade autocomplete)
      'status', // Lehekülje staatus
      'teose_staatus' // Teose koondstaatus (Toores/Töös/Valmis)
    ]);

    await index.updateSortableAttributes([
      'aasta',
      'lehekylje_number',
      'last_modified',
      'pealkiri'
    ]);

    const searchTask = await index.updateSearchableAttributes([
      'pealkiri',
      'autor',
      'respondens',
      'aasta',
      'teose_id',
      'originaal_kataloog',
      'lehekylje_tekst',
      'tags',
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
      distinctAttribute: null
    });

    console.log("Ootan indekseerimise lõppu (Task ID: " + searchTask.taskUid + ")...");
    await index.waitForTask(searchTask.taskUid);
    console.log("Indeksi seadistused edukalt uuendatud.");
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
  workStatus?: WorkStatus; // Teose koondstaatuse filter
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
        filter: [`teose_id = "${workId}"`],
        attributesToRetrieve: ['teose_id', 'status', 'lehekylje_number'],
        limit: 500  // Piisav ühe teose kõigile lehekülgedele
      });
      
      const statuses = response.hits.map((hit: any) => hit.status || PageStatus.RAW);
      return { workId, statuses };
    });
    
    const results = await Promise.all(promises);
    
    // Debug log
    console.log('getWorkStatuses: processed', results.length, 'works');
    if (results.length > 0) {
      const sample = results[0];
      console.log('Sample work', sample.workId, ':', sample.statuses.length, 'pages, statuses:', sample.statuses);
    }
    
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

// Dashboardi otsing: otsib teoseid
export const searchWorks = async (query: string, options?: DashboardSearchOptions): Promise<Work[]> => {
  checkMixedContent();
  await ensureSettings();

  try {
    const filter: string[] = [];

    // ALATI filtreeri esimese lehekülje järgi - tagab õige thumbnail ja tagid
    filter.push('lehekylje_number = 1');

    // Apply server-side filters if provided
    if (options?.yearStart) {
      filter.push(`aasta >= ${options.yearStart}`);
    }
    if (options?.yearEnd) {
      filter.push(`aasta <= ${options.yearEnd}`);
    }
    if (options?.author) {
      filter.push(`autor = "${options.author}"`);
    }
    if (options?.workStatus) {
      filter.push(`teose_staatus = "${options.workStatus}"`);
    }

    const searchParams: any = {
      limit: 2000, // Enough for all works (~1200)
      attributesToRetrieve: ['teose_id', 'originaal_kataloog', 'pealkiri', 'autor', 'respondens', 'aasta', 'lehekylje_number', 'last_modified', 'teose_lehekylgede_arv', 'teose_staatus'],
      attributesToSearchOn: ['pealkiri', 'autor', 'respondens'], // Dashboard otsib ainult pealkirjast ja autoritest
      filter: filter,
      distinct: 'teose_id' // Return only one hit per work
    };

    // Sorting logic
    if (options?.sort) {
      switch (options.sort) {
        case 'year_asc':
        default:
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
      }
    } else if (!query.trim()) {
      searchParams.sort = ['aasta:asc'];
    }

    console.log('searchWorks params:', { query, filter, searchParams });
    const response = await index.search(query, searchParams);
    console.log('searchWorks response hits:', response.hits.length);
    
    // With distinct='teose_id', each hit represents a unique work
    // But distinct might not return the first page, so we need to fetch first pages separately
    const workIds = response.hits.map((hit: any) => hit.teose_id);
    
    // Fetch first page data (thumbnail, tags) for all works
    const firstPagesMap = new Map<string, { thumbnail_url: string; tags: string[] }>();
    
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
              tags: hit.tags || []
            });
          }
        }
      }
    }
    
    const works: Work[] = response.hits.map((hit: any) => {
      const firstPageData = firstPagesMap.get(hit.teose_id);
      return {
        id: hit.teose_id,
        catalog_name: hit.originaal_kataloog || 'Unknown',
        title: hit.pealkiri || 'Pealkiri puudub',
        author: hit.autor || 'Teadmata autor',
        respondens: hit.respondens || undefined,
        year: parseInt(hit.aasta) || 0,
        publisher: '',
        page_count: hit.teose_lehekylgede_arv || 0,
        // Use first page data if available, otherwise fall back to the hit's data
        thumbnail_url: firstPageData?.thumbnail_url || getFullImageUrl(hit.lehekylje_pilt),
        work_status: hit.teose_staatus || undefined,
        tags: firstPageData?.tags || hit.tags || []
      };
    });

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
    const response = await index.search('', {
      filter: [`teose_id = "${workId}"`, `lehekylje_number = ${pageNum}`],
      limit: 1
    });

    if (response.hits.length === 0) return null;
    const hit: any = response.hits[0];

    return {
      id: hit.id,
      work_id: hit.teose_id,
      page_number: parseInt(hit.lehekylje_number),
      text_content: hit.lehekylje_tekst || '',
      image_url: getFullImageUrl(hit.lehekylje_pilt),
      status: hit.status || PageStatus.RAW,
      comments: hit.comments || [],
      tags: hit.tags || [],
      history: hit.history || [],
      original_path: hit.originaal_kataloog
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
      tags: page.tags,
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

    console.log(`Updated teose_staatus to '${newWorkStatus}' for ${updates.length} pages of work ${workId}`);
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

    const meiliPayload = {
      id: page.id,
      lehekylje_tekst: page.text_content,
      status: page.status,
      comments: page.comments,
      tags: page.tags,
      history: updatedHistory,
      last_modified: nowTimestamp // Added timestamp for sorting
    };

    const task = await index.updateDocuments([meiliPayload]);
    await index.waitForTask(task.taskUid);

    // Uuenda teose_staatus kõigil teose lehekülgedel (denormaliseeritud väli)
    await updateWorkStatusOnAllPages(page.work_id);

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
    const response = await index.search('', {
      filter: [`teose_id = "${workId}"`],
      attributesToRetrieve: ['teose_id', 'originaal_kataloog', 'pealkiri', 'autor', 'respondens', 'aasta', 'lehekylje_pilt', 'teose_lehekylgede_arv'],
      limit: 1
    });

    if (response.hits.length === 0) return undefined;
    const hit: any = response.hits[0];

    return {
      id: hit.teose_id,
      catalog_name: hit.originaal_kataloog,
      title: hit.pealkiri,
      author: hit.autor,
      respondens: hit.respondens || undefined,
      year: parseInt(hit.aasta),
      publisher: '',
      page_count: hit.teose_lehekylgede_arv || 0,
      thumbnail_url: getFullImageUrl(hit.lehekylje_pilt)
    };
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

  if (options.workId) filter.push(`teose_id = "${options.workId}"`);
  if (options.yearStart) filter.push(`aasta >= ${options.yearStart}`);
  if (options.yearEnd) filter.push(`aasta <= ${options.yearEnd}`);
  if (options.catalog && options.catalog !== 'all') filter.push(`originaal_kataloog = "${options.catalog}"`);

  let attributesToSearchOn: string[] = ['lehekylje_tekst', 'tags', 'comments.text'];
  if (options.scope === 'original') attributesToSearchOn = ['lehekylje_tekst'];
  else if (options.scope === 'annotation') attributesToSearchOn = ['tags', 'comments.text'];

  try {
    // Kui otsime ühe teose piires, ei vaja distinct'i
    if (options.workId) {
      const response = await index.search(query, {
        offset,
        limit,
        filter,
        facets: ['originaal_kataloog', 'teose_id'],
        attributesToRetrieve: ['id', 'teose_id', 'lehekylje_number', 'lehekylje_tekst', 'pealkiri', 'autor', 'aasta', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'comments'],
        attributesToCrop: ['lehekylje_tekst', 'comments.text'],
        cropLength: 35,
        attributesToHighlight: ['lehekylje_tekst', 'tags', 'comments.text'],
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

    // Tavaline otsing: kaks päringut paralleelselt
    // 1. Ilma distinct'ita - saame facet'id õigete vastete arvudega
    // 2. Distinct'iga - saame 10 erinevat teost
    const [facetResponse, distinctResponse] = await Promise.all([
      // Päring 1: ainult facet'ide jaoks (limit=0)
      index.search(query, {
        filter,
        limit: 0,
        facets: ['originaal_kataloog', 'teose_id'],
        attributesToSearchOn: attributesToSearchOn
      }),
      // Päring 2: distinct teosed
      index.search(query, {
        offset,
        limit,
        filter,
        distinct: 'teose_id',
        attributesToRetrieve: ['id', 'teose_id', 'lehekylje_number', 'lehekylje_tekst', 'pealkiri', 'autor', 'aasta', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'comments'],
        attributesToCrop: ['lehekylje_tekst', 'comments.text'],
        cropLength: 35,
        attributesToHighlight: ['lehekylje_tekst', 'tags', 'comments.text'],
        highlightPreTag: '<em class="bg-yellow-200 font-bold not-italic">',
        highlightPostTag: '</em>',
        attributesToSearchOn: attributesToSearchOn
      })
    ]);

    // Loe facetDistribution'ist iga teose vastete arv (ilma distinct'ita päringust)
    const workHitCounts = facetResponse.facetDistribution?.['teose_id'] || {};
    
    // Lisa igale hitile vastete arv
    const hitsWithCounts = distinctResponse.hits.map((hit: any) => ({
      ...hit,
      hitCount: workHitCounts[hit.teose_id] || 1
    }));

    // Koguvastete arv ja teoste arv
    const totalHits = facetResponse.estimatedTotalHits || 0;
    const totalWorks = distinctResponse.estimatedTotalHits || 0;

    return {
      hits: hitsWithCounts as any,
      totalHits: totalHits,
      totalWorks: totalWorks,
      totalPages: Math.ceil(totalWorks / limit),
      page,
      processingTimeMs: distinctResponse.processingTimeMs,
      facetDistribution: facetResponse.facetDistribution
    };
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

  const filter: string[] = [`teose_id = "${workId}"`];

  if (options.yearStart) filter.push(`aasta >= ${options.yearStart}`);
  if (options.yearEnd) filter.push(`aasta <= ${options.yearEnd}`);
  if (options.catalog && options.catalog !== 'all') filter.push(`originaal_kataloog = "${options.catalog}"`);

  let attributesToSearchOn: string[] = ['lehekylje_tekst', 'tags', 'comments.text'];
  if (options.scope === 'original') attributesToSearchOn = ['lehekylje_tekst'];
  else if (options.scope === 'annotation') attributesToSearchOn = ['tags', 'comments.text'];

  try {
    const response = await index.search(query, {
      filter,
      limit: 500, // Piisav ühele teosele
      attributesToRetrieve: ['id', 'teose_id', 'lehekylje_number', 'lehekylje_tekst', 'pealkiri', 'autor', 'aasta', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'comments'],
      attributesToCrop: ['lehekylje_tekst', 'comments.text'],
      cropLength: 35,
      attributesToHighlight: ['lehekylje_tekst', 'tags', 'comments.text'],
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
      facets: ['tags']
    });

    const tagFacets = response.facetDistribution?.['tags'] || {};
    return Object.keys(tagFacets).sort((a, b) => a.localeCompare(b, 'et'));
  } catch (e) {
    console.error("Failed to fetch tags:", e);
    return [];
  }
};
