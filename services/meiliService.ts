
import { MeiliSearch } from 'meilisearch';
import { Page, Work, PageStatus, ContentSearchResponse, ContentSearchOptions, HistoryEntry } from '../types';
import { MEILI_HOST, MEILI_API_KEY, MEILI_INDEX, IMAGE_BASE_URL, FILE_API_URL } from '../config';

// Key for localStorage
const STORAGE_KEY = 'vutt_meili_master_key';

// Helper to get the best available key
const getApiKey = () => {
  return localStorage.getItem(STORAGE_KEY) || MEILI_API_KEY;
};

// Initialize client with a function to allow re-initialization
let client = new MeiliSearch({
  host: MEILI_HOST,
  apiKey: getApiKey(),
});

let index = client.index(MEILI_INDEX);

// Function to update the API Key at runtime
export const updateApiKey = (newKey: string) => {
  if (newKey) {
    localStorage.setItem(STORAGE_KEY, newKey);
    console.log("API Key uuendatud localStorage-is.");
  } else {
    localStorage.removeItem(STORAGE_KEY);
    console.log("API Key eemaldatud, kasutatakse vaikeväärtust.");
  }
  
  // Re-initialize client
  client = new MeiliSearch({
    host: MEILI_HOST,
    apiKey: getApiKey(),
  });
  index = client.index(MEILI_INDEX);
  
  // Force a connection check
  return index.getStats();
};

export const getCurrentKeyType = () => {
    const key = getApiKey();
    if (key === MEILI_API_KEY) return 'default';
    return 'custom';
};

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
    try {
        currentSettings = await index.getSearchableAttributes();
        sortableSettings = await index.getSortableAttributes();
    } catch (e) {
        // Indeksit ei pruugi veel eksisteerida
    }

    const requiredSearch = ['tags', 'comments.text', 'lehekylje_tekst'];
    const requiredSort = ['last_modified'];
    
    const needsSearchUpdate = !currentSettings || requiredSearch.some(r => !currentSettings.includes(r));
    const needsSortUpdate = !sortableSettings || requiredSort.some(r => !sortableSettings.includes(r));

    if (!needsSearchUpdate && !needsSortUpdate) {
        console.log("Indeksi seadistused on juba korras.");
        return true;
    }

    console.log("Algatan indeksi seadistuste uuendamise...");

    await index.updateFilterableAttributes([
      'aasta', 
      'autor', 
      'teose_id', 
      'lehekylje_number', 
      'originaal_kataloog'
    ]);
    
    await index.updateSortableAttributes([
      'aasta',
      'lehekylje_number',
      'last_modified' // Added for "Recently Modified" sorting
    ]);

    const searchTask = await index.updateSearchableAttributes([
        'pealkiri',
        'autor',
        'aasta',
        'teose_id',
        'originaal_kataloog',
        'lehekylje_tekst',
        'tags',
        'comments.text'
    ]);

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
}

// Dashboardi otsing: otsib teoseid
export const searchWorks = async (query: string, options?: DashboardSearchOptions): Promise<Work[]> => {
  checkMixedContent();
  await ensureSettings();

  try {
    const filter: string[] = [];
    
    // Apply server-side filters if provided
    if (options?.yearStart) {
        filter.push(`aasta >= ${options.yearStart}`);
    }
    if (options?.yearEnd) {
        filter.push(`aasta <= ${options.yearEnd}`);
    }

    const searchParams: any = {
      limit: 1000,
      attributesToRetrieve: ['teose_id', 'originaal_kataloog', 'pealkiri', 'autor', 'aasta', 'lehekylje_pilt', 'lehekylje_number', 'last_modified'],
      facets: ['teose_id'],
      filter: filter
    };

    // If no text query is provided, sort by last_modified to show recent work
    if (!query.trim()) {
        searchParams.sort = ['last_modified:desc'];
    }

    const response = await index.search(query, searchParams);
    const facets = response.facetDistribution?.['teose_id'] || {};
    const uniqueWorks = new Map<string, Work>();

    for (const hit of response.hits) {
        const h = hit as any;
        
        // Since hits might be sorted by last_modified (newest first), 
        // the first time we see a work ID, it represents the most recent state/hit of that work.
        if (!uniqueWorks.has(h.teose_id)) {
            uniqueWorks.set(h.teose_id, {
                id: h.teose_id,
                catalog_name: h.originaal_kataloog || 'Unknown',
                title: h.pealkiri || 'Pealkiri puudub',
                author: h.autor || 'Teadmata autor',
                year: parseInt(h.aasta) || 0,
                publisher: '',
                page_count: facets[h.teose_id] || 0,
                thumbnail_url: getFullImageUrl(h.lehekylje_pilt)
            });
        } else {
            // Update thumbnail if we found the actual cover page (page 1)
            // unless we are strictly prioritizing the "latest modified" image. 
            // Standard practice: Keep usage of page 1 as thumbnail if found.
            if (parseInt(h.lehekylje_number) === 1) {
                const existing = uniqueWorks.get(h.teose_id)!;
                existing.thumbnail_url = getFullImageUrl(h.lehekylje_pilt);
            }
        }
    }
    
    return Array.from(uniqueWorks.values());

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

// Abifunktsioon failisüsteemi salvestamiseks
const saveToFileSystem = async (page: Page, original_catalog: string, image_url: string): Promise<boolean> => {
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

        const payload = {
            text_content: page.text_content,
            meta_content: metaContent,
            original_path: original_catalog,
            file_name: textFilename, 
            work_id: page.work_id,
            page_number: page.page_number
        };

        const response = await fetch(`${FILE_API_URL}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`File server error: ${response.status}`);
        return true;
    } catch (e) {
        console.error("Failed to save to file system:", e);
        alert("Hoiatus: Muudatused salvestati andmebaasi, aga failisüsteemi kirjutamine ebaõnnestus.");
        return false;
    }
};

// Töölaud: Salvesta muudatused
export const savePage = async (page: Page, actionDescription: string = 'Muutis andmeid'): Promise<Page> => {
  try {
    const newHistoryEntry: HistoryEntry = {
        id: Date.now().toString(),
        user: 'Dr. Mari Maasikas', 
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

    if (page.original_path && page.image_url) {
        await saveToFileSystem(pageToSave, page.original_path, page.image_url);
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
        limit: 1
     });

     if (response.hits.length === 0) return undefined;
     const hit: any = response.hits[0];
     const totalPages = response.estimatedTotalHits || 0;

     return {
        id: hit.teose_id,
        catalog_name: hit.originaal_kataloog,
        title: hit.pealkiri,
        author: hit.autor,
        year: parseInt(hit.aasta),
        publisher: '',
        page_count: totalPages, 
        thumbnail_url: getFullImageUrl(hit.lehekylje_pilt)
     };
   } catch (e) {
     console.error("Work Metadata Error:", e);
     return undefined;
   }
};

// Täisteksti otsing
export const searchContent = async (query: string, page: number = 1, options: ContentSearchOptions = {}): Promise<ContentSearchResponse> => {
    checkMixedContent();
    await ensureSettings();
    
    const limit = 20;
    const offset = (page - 1) * limit;
    const filter: string[] = [];
    
    if (options.yearStart) filter.push(`aasta >= ${options.yearStart}`);
    if (options.yearEnd) filter.push(`aasta <= ${options.yearEnd}`);
    if (options.catalog && options.catalog !== 'all') filter.push(`originaal_kataloog = "${options.catalog}"`);

    let attributesToSearchOn: string[] = ['lehekylje_tekst', 'tags', 'comments.text'];
    if (options.scope === 'original') attributesToSearchOn = ['lehekylje_tekst'];
    else if (options.scope === 'annotation') attributesToSearchOn = ['tags', 'comments.text'];

    try {
        const response = await index.search(query, {
            offset,
            limit,
            filter,
            attributesToRetrieve: ['id', 'teose_id', 'lehekylje_number', 'lehekylje_tekst', 'pealkiri', 'autor', 'aasta', 'originaal_kataloog', 'lehekylje_pilt', 'tags', 'comments'],
            attributesToCrop: ['lehekylje_tekst', 'comments.text'], 
            cropLength: 35, 
            attributesToHighlight: ['lehekylje_tekst', 'tags', 'comments.text'],
            highlightPreTag: '<em class="bg-yellow-200 font-bold not-italic">',
            highlightPostTag: '</em>',
            facets: ['originaal_kataloog', 'teose_id'], 
            attributesToSearchOn: attributesToSearchOn
        });

        return {
            hits: response.hits as any,
            totalHits: response.estimatedTotalHits,
            totalPages: Math.ceil(response.estimatedTotalHits / limit),
            page,
            processingTimeMs: response.processingTimeMs,
            facetDistribution: response.facetDistribution
        };
    } catch (e: any) {
        if (e.message && e.message.includes('not searchable')) {
            throw new Error("Otsinguindeksit alles uuendatakse. Palun oota hetk.");
        }
        throw e;
    }
};
