import { appendTagParams } from './tagParams';

/**
 * Isikuloendi ja kaardi ühised filtrid — kattub serveri `PersonFilters`-iga
 * (`server/prosopography/person_search.py`, #670). Enne oli loend iga päringu
 * juures eraldi ja kaardi haru kaotas `origin_place`-i.
 *
 * Ulatus (`ids`, `collection`, `work_set`, `related_to`) ei ole filter.
 */
export interface PersonFilterParams {
  q?: string;
  gender?: string;
  occupation?: string;
  origin_group?: string;
  origin_place?: string;
  institution?: string;
  status_id?: string;
  source?: string;
  verification_level?: string;
  year_from?: number;
  year_to?: number;
  imm_year_from?: number;
  imm_year_to?: number;
  tag?: string | string[];
}

// Record sunnib tüübikontrolli: uus väli liidesesse ilma siia lisamata on viga.
const KEYS: Record<keyof PersonFilterParams, true> = {
  q: true, gender: true, occupation: true, origin_group: true, origin_place: true,
  institution: true, status_id: true, source: true, verification_level: true,
  year_from: true, year_to: true, imm_year_from: true, imm_year_to: true, tag: true,
};
export const PERSON_FILTER_KEYS = Object.keys(KEYS) as (keyof PersonFilterParams)[];

export function appendPersonFilterParams(params: URLSearchParams, filters?: PersonFilterParams): void {
  if (!filters) return;
  for (const key of PERSON_FILTER_KEYS) {
    if (key === 'tag') continue;
    const value = filters[key];
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  appendTagParams(params, filters.tag);
}
