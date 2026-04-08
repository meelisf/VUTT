/**
 * Teose metaandmete ja staatuste operatsioonid
 */

import { Work, WorkStatus, PageStatus } from '../types';
import { index, calculateWorkStatus, checkMixedContent } from './meiliService';
import { getThumbUrl, getPageThumbUrl } from './workImageService';

// Pärib mitme teose staatused korraga (efektiivsem kui ühekaupa)
// NB: Kuna indeksil on distinct='work_id', peame tegema eraldi päringud iga teose jaoks
export const getWorkStatuses = async (workIds: string[]): Promise<Map<string, WorkStatus>> => {
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
export const getWorkMetadata = async (workId: string): Promise<Work | undefined> => {
  try {
    // Otsime work_id (nanoid) järgi
    const response = await index.search('', {
      filter: [`work_id = "${workId}"`],
      attributesToRetrieve: [
        // V2 väljad
        'work_id', 'id', 'title', 'year', 'year_display', 'location', 'location_object', 'publisher', 'publisher_object', 'publisher_id',
        'type', 'type_object', 'genre', 'genre_object', 'collections', 'collections_hierarchy',
        'creators', 'authors_text', 'tags', 'tags_object', 'languages',
        'series', 'series_title', 'ester_id', 'external_url', 'archive_refs',
        // Filtrite/sortimise väljad
        'originaal_kataloog', 'year',
        'lehekylje_pilt', 'teose_lehekylgede_arv'
      ],
      limit: 1
    });

    if (response.hits.length === 0) return undefined;
    const hit: any = response.hits[0];

    return {
      // Identifikaatorid
      id: hit.id,
      work_id: hit.work_id,

      // Teose andmed
      title: hit.title || '',
      year: hit.year ?? hit.aasta ?? 0,
      year_display: hit.year_display || null,
      location: hit.location_object ?? null,
      publisher: hit.publisher_object ?? null,

      // V2 taksonoomia
      type: hit.type_object ?? null,
      genre: hit.genre_object ?? null,
      collections: hit.collections || [],
      collections_hierarchy: hit.collections_hierarchy || [],

      // V2 isikud
      creators: hit.creators || [],
      authors_text: hit.authors_text || [],

      // V2 märksõnad
      tags: hit.tags_object ?? [],
      languages: hit.languages || ['lat'],

      // Seosed
      series: hit.series,
      series_title: hit.series_title,

      // Välised lingid ja arhiiviviited
      ester_id: hit.ester_id,
      external_url: hit.external_url,
      archive_refs: hit.archive_refs || null,

      // Lehekülje info
      page_count: hit.teose_lehekylgede_arv || 0,
      thumbnail_url: getThumbUrl(hit.work_id),  // Kasuta thumbnaili URL-i (40x väiksem)

      // Tagasiühilduvus (filtrite väljad)
      catalog_name: hit.originaal_kataloog,
      author: hit.autor || (hit.creators?.[0]?.name) || '',
      respondens: hit.respondens || (hit.creators?.find((c: any) => c.role === 'respondens')?.name),
      aasta: hit.aasta ?? hit.year
    } as Work;
  } catch (e) {
    console.error("Work Metadata Error:", e);
    return undefined;
  }
};

// Kõigi teose lehtede thumbnailide URL-id grid-vaate jaoks
export const getWorkPageImages = async (
  workId: string,
  pageCount: number
): Promise<{ pageNum: number; imageUrl: string }[]> => {
  checkMixedContent();
  const limit = Math.min(Math.ceil(pageCount * 1.1) + 10, 1000);
  try {
    const response = await index.search('', {
      filter: [`work_id = "${workId}"`],
      attributesToRetrieve: ['lehekylje_number', 'lehekylje_pilt'],
      limit,
    });
    const hits = response.hits as any[];
    hits.sort((a, b) => (a.lehekylje_number || 0) - (b.lehekylje_number || 0));
    return hits.map(hit => ({
      pageNum: hit.lehekylje_number,
      imageUrl: getPageThumbUrl(workId, hit.lehekylje_pilt || ''),
    }));
  } catch (e) {
    console.error('getWorkPageImages error:', e);
    return [];
  }
};
