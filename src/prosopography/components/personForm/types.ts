import type { LinkedEntity } from '../../../types/LinkedEntity';

export interface DateDraft {
  year: string;       // '1650' vm tühi
  month: string;      // '1'–'12' vm tühi
  day: string;        // '1'–'31' vm tühi
  circa: boolean;
  bound: '' | 'before' | 'after';
  calendar: '' | 'julian' | 'gregorian';
  place: LinkedEntity | null;
}

export interface OccupationDraft {
  label: string; id?: string | null; labels?: Record<string, string>;
  institution?: string; institution_id?: string | null; institution_labels?: Record<string, string>;
  year_from?: string; year_to?: string;
}

export interface EducationDraft {
  institution: string; institution_id?: string | null; institution_labels?: Record<string, string>;
  year_from?: string; year_to?: string;
}

export interface TagDraft { label: string; id?: string | null; labels?: Record<string, string> }
export interface RelationDraft { name: string; type: string; target_id?: string | null }
export interface SourceDraft { text: string; note: string }

export interface FormDraft {
  name_label: string;
  name_family: string;
  name_first: string;
  name_qualifier: string;
  name_aliases: string[];
  gender: '' | 'M' | 'F';
  birth: DateDraft;
  death: DateDraft;
  floruit_from: string;
  floruit_to: string;
  status: LinkedEntity | null;
  confession: LinkedEntity | null;
  occupations: OccupationDraft[];
  education: EducationDraft[];
  tags: TagDraft[];
  relations: RelationDraft[];
  sources: SourceDraft[];
  biography: string;
  notes: string;
  wikidata_id: string;
  gnd_id: string;
  viaf_id: string;
  aa_id: string;
}

export const emptyDraft = (): FormDraft => ({
  name_label: '',
  name_family: '',
  name_first: '',
  name_qualifier: '',
  name_aliases: [],
  gender: '',
  birth: { year: '', month: '', day: '', circa: false, bound: '', calendar: '', place: null },
  death: { year: '', month: '', day: '', circa: false, bound: '', calendar: '', place: null },
  floruit_from: '',
  floruit_to: '',
  status: null,
  confession: null,
  occupations: [],
  education: [],
  tags: [],
  relations: [],
  sources: [],
  biography: '',
  notes: '',
  wikidata_id: '',
  gnd_id: '',
  viaf_id: '',
  aa_id: '',
});
