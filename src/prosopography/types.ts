// Prosopograafia tüübid — eraldiseisvad src/types.ts-ist

export interface PlaceEntry {
  id: string | null;
  group?: string | null;
  parent_key?: string | null;
  labels: Record<string, string>;
  coordinates?: PlaceCoordinates | null;
  historical_names?: string[];
  type?: string;
  notes?: string;
}

export interface PlaceCoordinates {
  lat: number;
  lon: number;
  source?: string;
  wikidata_property?: string;
  geonames_id?: string;
}

export interface OriginParent {
  key: string;
  id: string | null;
  labels: Record<string, string> | null;
  type?: string | null;
}

export interface ProsopoIndexEntry {
  id: string;               // vutt:Pxxx
  label: string;            // kanooniline nimi
  sort_name: string;        // perekond, eesnimi (sortimiseks)
  birth_year: number | null;
  death_year: number | null;
  gender: 'M' | 'F' | null;
  status_ids: string[];
  status_labels: string[];
  confession_ids: string[];
  has_wikidata: boolean;
  has_gnd: boolean;
  has_aa: boolean;
  record_status: 'draft' | 'reviewed' | 'verified' | 'tombstone';
  verification_level: 'draft' | 'reviewed' | 'verified';
  work_count: number;
  biography_snippet: string;
  image_url: string | null;
  aliases: string[];
  occupations?: { id: string | null; label: string; labels?: Record<string, string> | null }[];
  education_institutions: string[];
  // Album Academicum
  aa_number: number | null;
  imm_year: number | null;
  imm_date: string | null;
  floruit_year_from?: number | null;
  floruit_year_to?: number | null;
  // Päritolu (uued väljad)
  origin_place: string | null;
  origin_place_id: string | null;
  origin_place_labels: Record<string, string> | null;
  origin_coordinates: PlaceCoordinates | null;
  origin_parent: OriginParent | null;
  origin_group: string | null;
  origin_group_labels: Record<string, string> | null;
  tags: { label: string; id?: string | null; labels?: Record<string, string> }[];
}

export interface ProsopoMapPerson {
  id: string;
  label: string;
  birth_year: number | null;
  death_year: number | null;
  imm_year: number | null;
  image_url: string | null;
  work_count: number;
}

export interface ProsopoMapMarker {
  place_key: string | null;
  place_id: string | null;
  place_labels: Record<string, string> | null;
  parent: OriginParent | null;
  origin_group: string | null;
  origin_group_labels: Record<string, string> | null;
  coordinates: PlaceCoordinates;
  count: number;
  persons: ProsopoMapPerson[];
}

export interface ProsopoMapResponse {
  markers: ProsopoMapMarker[];
  total_persons: number;
  mapped_persons: number;
  without_coordinates: number;
  // Ainult related_to päringul: fookus-isiku nimi + kollektsioonid, kuhu ta kuulub.
  // Kasutatakse tühja-teate vihjes, kui valitud kollektsioon võrgustiku välja filtreeris.
  focus?: {
    id: string;
    label: string | null;
    collections: string[];
  };
}

export interface HistoricalDate {
  original_text: string | null;
  date: string | null;
  date_to: string | null;
  bound: 'before' | 'after' | null;
  precision: 'day' | 'month' | 'year' | null;
  calendar: 'julian' | 'gregorian' | null;
  is_circa: boolean;
  place?: { id: string | null; label: string; labels?: Record<string, string> | null } | null;
  notes: string | null;
}

export interface ProsopoRecord {
  id: string;
  identifiers: { scheme: string; id: string; checked_at: string | null }[];
  merged_into: string | null;
  import_batch_ids: string[];
  schema_version: number;
  record_status: string;
  verification_level: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  name: {
    label: string;
    family_name: string | null;
    first_name: string | null;
    qualifier: string | null;
    qualifier_type: string | null;
    noble_status: string | null;
    maiden_name: string | null;
    aliases: string[];
    family_name_variants: string[];
    first_name_variants: string[];
  };
  gender: 'M' | 'F' | null;
  birth: HistoricalDate;
  death: HistoricalDate;
  origin: {
    place: string | null;
    place_id?: string | null;
    place_labels?: Record<string, string> | null;
    geonames_id: string | null;
    coordinates: string | null;
  };
  floruit?: { year_from?: number | null; year_to?: number | null } | null;
  statuses: { id: string; label: string; labels?: { et?: string; en?: string } }[];
  confessions: { id: string; label: string; labels?: { et?: string; en?: string } }[];
  occupations: any[];
  education: any[];
  burial: any | null;
  relations: { name: string; type?: string; target_id?: string | null }[];
  tags?: any[];
  sources: { text: string; note?: string | null }[];
  biography: string | null;
  notes: string | null;
  image_url: string | null;
  source_data: Record<string, any>;
  // lisatakse GET /prosopography/{id} vastuses
  works?: { work_id: string; role: string }[];
}
