/**
 * Otsingu ühik URL-is (#526): `unit=letters` = kirjaotsing, puudub = täistekst.
 *
 * Režiimi vahetus säilitab AINULT päringu ja kogu tokeni — valge nimekiri, mitte
 * must: uus filter ei jää kogemata teise režiimi nähtamatult ellu.
 */
import { COLLECTION_PARAM, WORK_SET_PARAM } from '../../contexts/collectionUrl';
import { emptyLetterFilters, LetterFilters, LetterSort } from '../../services/letterSearch';

export type SearchUnit = 'text' | 'letters';

export const UNIT_PARAM = 'unit';

const KEEP_ON_SWITCH = ['q', COLLECTION_PARAM, WORK_SET_PARAM];

export function readUnit(params: URLSearchParams): SearchUnit {
  return params.get(UNIT_PARAM) === 'letters' ? 'letters' : 'text';
}

export function switchUnitParams(prev: URLSearchParams, unit: SearchUnit): URLSearchParams {
  const next = new URLSearchParams();
  for (const key of KEEP_ON_SWITCH) {
    const value = prev.get(key);
    if (value) next.set(key, value);
  }
  if (unit === 'letters') next.set(UNIT_PARAM, 'letters');
  return next;
}

// Kirjade filtrid: loendid korduva parameetrina (nimes võib olla koma).
const LIST_PARAMS = {
  authors: 'la',
  addressees: 'lad',
  placeFrom: 'lpf',
  placeTo: 'lpt',
  languages: 'llang',
} as const;
const SORTS: LetterSort[] = ['relevance', 'date_asc', 'date_desc'];

const readYear = (value: string | null): number | undefined =>
  value && /^\d{3,4}$/.test(value) ? Number(value) : undefined;

export function readLetterFilters(params: URLSearchParams): LetterFilters {
  const f = emptyLetterFilters();
  for (const [field, key] of Object.entries(LIST_PARAMS) as [keyof typeof LIST_PARAMS, string][]) {
    f[field] = params.getAll(key).filter(Boolean);
  }
  const yearStart = readYear(params.get('lys'));
  const yearEnd = readYear(params.get('lye'));
  if (yearStart !== undefined) f.yearStart = yearStart;
  if (yearEnd !== undefined) f.yearEnd = yearEnd;
  const sort = params.get('lsort') as LetterSort | null;
  f.sort = sort && SORTS.includes(sort) ? sort : 'relevance';
  return f;
}

/** Kirjutab filtrid `params`-i (muteerib), teisi parameetreid ei puuduta. */
export function writeLetterFilters(params: URLSearchParams, f: LetterFilters): void {
  for (const [field, key] of Object.entries(LIST_PARAMS) as [keyof typeof LIST_PARAMS, string][]) {
    params.delete(key);
    for (const value of f[field]) params.append(key, value);
  }
  if (f.yearStart !== undefined) params.set('lys', String(f.yearStart)); else params.delete('lys');
  if (f.yearEnd !== undefined) params.set('lye', String(f.yearEnd)); else params.delete('lye');
  if (f.sort !== 'relevance') params.set('lsort', f.sort); else params.delete('lsort');
}
