/**
 * Teose metaandmete ja staatuste operatsioonid
 */

import { Work, WorkStatus, PageStatus } from '../types';
import { calculateWorkStatus, checkMixedContent, normalizeWork } from './meiliService';
import { getPageThumbUrl } from './workImageService';
import type { Index } from 'meilisearch';

// Pärib mitme teose staatused korraga (efektiivsem kui ühekaupa)
// NB: Kuna indeksil on distinct='work_id', peame tegema eraldi päringud iga teose jaoks
export const getWorkStatuses = async (index: Index, workIds: string[]): Promise<Map<string, WorkStatus>> => {
  const statusMap = new Map<string, WorkStatus>();

  if (workIds.length === 0) return statusMap;

  try {
    // Teeme paralleelsed päringud iga teose jaoks
    // See on vajalik, kuna indeksi distinct seadistus ei lase meil
    // ühes päringus saada kõiki lehekülgi erinevatest teostest
    const promises = workIds.map(async (workId) => {
      const response = await index.search('', {
        filter: [`work_id = "${workId}"`],
        attributesToRetrieve: ['work_id', 'status', 'lehekylje_number'],
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

// Töölaud: Saa teose metaandmed
/**
 * `getWorkMetadata` tagastus: `Work` + workspace tagasiühilduvuse legacy väljad,
 * mis lisatakse runtime'is (inglisekeelsed compat-nimed, ei kuulu rangesse `Work`-i).
 * @deprecated legacy väljad — uues koodis kasuta `creators`/`year`/`work_id`.
 */
export type WorkMetadataResult = Work & {
  catalog_name?: string;
  author?: string;
  respondens?: string;
  aasta?: number | null;
};

export const getWorkMetadata = async (index: Index, workId: string): Promise<WorkMetadataResult | undefined> => {
  try {
    // Otsime work_id (nanoid) järgi
    const response = await index.search('', {
      filter: [`work_id = "${workId}"`],
      attributesToRetrieve: [
        // V2 väljad
        'work_id', 'id', 'title', 'year', 'year_display', 'location', 'location_object', 'publisher', 'publisher_object', 'publisher_id',
        'type', 'type_object', 'genre', 'genre_object', 'collections', 'collections_hierarchy',
        'creators', 'authors_text', 'tags', 'tags_object', 'notes', 'languages',
        'series', 'series_title', 'ester_id', 'external_url', 'archive_refs',
        // Filtrite/sortimise väljad
        'originaal_kataloog', 'year',
        'lehekylje_pilt', 'teose_lehekylgede_arv'
      ],
      limit: 1
    });

    if (response.hits.length === 0) return undefined;
    const hit: any = response.hits[0];

    const base = normalizeWork(hit);
    return {
      ...base,
      // Legacy deprecated fields — workspace tagasiühilduvus
      catalog_name: hit.originaal_kataloog,
      author: hit.autor || (hit.creators?.[0]?.name) || '',
      respondens: hit.respondens || (hit.creators?.find((c: any) => c.role === 'respondens')?.name),
      aasta: hit.aasta ?? hit.year,
    } as WorkMetadataResult;
  } catch (e) {
    console.error("Work Metadata Error:", e);
    return undefined;
  }
};

// Kõigi teose lehtede thumbnailide URL-id grid-vaate jaoks
export const getWorkPageImages = async (
  index: Index,
  workId: string,
  pageCount: number
): Promise<{ pageNum: number; imageUrl: string; hasAnnotations: boolean }[]> => {
  checkMixedContent();
  const limit = Math.min(Math.ceil(pageCount * 1.1) + 10, 1000);
  try {
    const response = await index.search('', {
      filter: [`work_id = "${workId}"`],
      attributesToRetrieve: ['lehekylje_number', 'lehekylje_pilt', 'has_annotations'],
      limit,
    });
    const hits = response.hits as any[];
    hits.sort((a, b) => (a.lehekylje_number || 0) - (b.lehekylje_number || 0));
    return hits.map(hit => ({
      pageNum: hit.lehekylje_number,
      imageUrl: getPageThumbUrl(workId, hit.lehekylje_pilt || ''),
      hasAnnotations: !!hit.has_annotations,
    }));
  } catch (e) {
    console.error('getWorkPageImages error:', e);
    return [];
  }
};
