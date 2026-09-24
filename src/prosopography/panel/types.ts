/**
 * Isikupaneeli tüübid: kandidaatide otsingu ja grupeerimise andmemudel.
 * Vastab spekile §5-§6 (vt task-3/4 brief).
 */

export type SourceScheme = 'wikidata' | 'gnd' | 'viaf';

export interface CandidateName {
  text: string;
  lang: string | null;
  kind: 'label' | 'alias';
}

export interface CandidatePlace {
  id: string | null;
  label: string;
}

export interface CandidateDate {
  date: string | null;
  precision: string | null;
  place: CandidatePlace | null;
}

export interface CandidateSummary {
  label: string;
  names: CandidateName[];
  description: string | null;
  birth: CandidateDate;
  death: CandidateDate;
  occupations: { id: string | null; label: string }[];
  url: string;
  links: Partial<Record<SourceScheme, string>>;
}

export interface CandidateResult {
  scheme: SourceScheme;
  id: string;
  ok: boolean;
  summary: CandidateSummary | null;
  error: 'source_unavailable' | 'timeout' | null;
  existing_person_id: string | null;
}

export interface SourceRef {
  scheme: SourceScheme;
  id: string;
  label: string;
  description?: string;
}

export interface CandidateGroup {
  key: string; // stabiilne: esimese liikme `${scheme}:${id}`
  members: CandidateResult[]; // otsingu järjekorras
  ids: Partial<Record<SourceScheme, string>>;
  existingPersonIds: string[]; // kordusteta
}
