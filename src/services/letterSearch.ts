/**
 * Kirjaotsing (#526, ADR 0065): päringud `kirjad`-indeksisse.
 *
 * Kiri pärib ligipääsu ja kogu teoselt: `collections_hierarchy` ja `work_id`
 * on dokumendis olemas, seega kogu/töökollektsiooni piirang käib SAMA
 * `scopeClauses`-i kaudu nagu teoste otsingus (laadimata loend viskab).
 */
import type { Index } from 'meilisearch';
import { scopeClauses, SelectionScope } from './selectionFilter';
import { normalizeSearchQuery } from './searchService';
import { dateBound } from '../utils/workDating';
import type { WorkDating } from '../utils/workDating';

export const LETTERS_PER_PAGE = 20;

export type LetterSort = 'relevance' | 'date_asc' | 'date_desc';

export interface LetterFilters {
  authors: string[];
  addressees: string[];
  placeFrom: string[];
  placeTo: string[];
  languages: string[];
  yearStart?: number;
  yearEnd?: number;
  sort: LetterSort;
}

export const emptyLetterFilters = (): LetterFilters => ({
  authors: [], addressees: [], placeFrom: [], placeTo: [], languages: [], sort: 'relevance',
});

/** Kirjadokument indeksist (vt `server/meili_doc.build_letter_documents`). */
export interface LetterHit {
  id: string;
  work_id: string;
  part_id: string;
  title: string;
  incipit: string;
  abstract: string;
  authors: string[];
  addressees: string[];
  place_from: string;
  place_to: string;
  dating?: WorkDating;
  languages?: string[];
  first_page: number;
  page_count: number;
  work_title: string;
  _formatted?: Partial<Record<'letter_text' | 'abstract' | 'title' | 'incipit', string>>;
}

export interface LetterSearchResult {
  hits: LetterHit[];
  totalHits: number;
  totalPages: number;
  facetDistribution: Record<string, Record<string, number>>;
}

export const LETTER_FACETS = ['authors', 'addressees', 'place_from', 'place_to', 'languages'] as const;

const quote = (v: string) => JSON.stringify(v);

function pushIn(filter: string[], field: string, values: string[]): void {
  if (values.length) filter.push(`${field} IN [${values.map(quote).join(', ')}]`);
}

export function buildLetterFilter(f: LetterFilters, scope: SelectionScope | undefined): string[] {
  const filter = [...scopeClauses(scope)];
  pushIn(filter, 'authors', f.authors);
  pushIn(filter, 'addressees', f.addressees);
  pushIn(filter, 'place_from', f.placeFrom);
  pushIn(filter, 'place_to', f.placeTo);
  pushIn(filter, 'languages', f.languages);
  // Kattuvus nagu teosed-is: kiri [date_start, date_end] lõikub vahemikuga.
  const start = dateBound(f.yearStart), end = dateBound(f.yearEnd, true);
  if (start) filter.push(`date_end >= ${start}`);
  if (end) filter.push(`date_start <= ${end}`);
  return filter;
}

export async function searchLetters(
  index: Index,
  query: string,
  f: LetterFilters,
  scope: SelectionScope | undefined,
  page: number,
): Promise<LetterSearchResult> {
  const q = normalizeSearchQuery(query.trim());
  // Ilma päringuta pole asjakohasust: vaikimisi kronoloogiline.
  const sort = f.sort === 'relevance' && !q ? 'date_asc' : f.sort;
  const res = await index.search<LetterHit>(q, {
    filter: buildLetterFilter(f, scope),
    page,
    hitsPerPage: LETTERS_PER_PAGE,
    facets: [...LETTER_FACETS],
    sort: sort === 'relevance' ? undefined : [`date_sort:${sort === 'date_asc' ? 'asc' : 'desc'}`],
    attributesToRetrieve: [
      'id', 'work_id', 'part_id', 'title', 'incipit', 'abstract', 'authors', 'addressees',
      'place_from', 'place_to', 'dating', 'languages', 'first_page', 'page_count', 'work_title',
      // _formatted sisaldab ainult tagastatavaid välju — katke vajab teksti.
      'letter_text',
    ],
    attributesToHighlight: ['letter_text', 'abstract', 'title', 'incipit'],
    attributesToCrop: ['letter_text', 'abstract'],
    cropLength: 30,
    highlightPreTag: '<mark>',
    highlightPostTag: '</mark>',
  });
  // page/hitsPerPage → vastuses totalHits/totalPages (SDK tüüp ei kitsenda seda).
  const paged = res as unknown as { totalHits?: number; totalPages?: number };
  return {
    hits: res.hits as LetterHit[],
    totalHits: paged.totalHits ?? 0,
    totalPages: paged.totalPages ?? 0,
    facetDistribution: (res.facetDistribution ?? {}) as Record<string, Record<string, number>>,
  };
}
