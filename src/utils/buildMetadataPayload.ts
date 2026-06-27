import { Creator, CreatorRole, ArchiveRef } from '../types';
import { LinkedEntity } from '../types/LinkedEntity';
import { deriveYearFields } from './yearDisplayUtils';

export interface MetadataFormData {
  title: string;
  yearInput: string;          // Üks tekstilahter: puhas aasta, ca., vahemik või sajand (vt deriveYearFields)
  type: string | LinkedEntity | null;
  genre: (string | LinkedEntity)[];
  tags: (string | LinkedEntity)[];
  notes: string;
  location: string | LinkedEntity;
  publisher: string | LinkedEntity;
  creators: Creator[];
  languages: string[];
  ester_id: string;
  external_url: string;
  collections: string[];
  archive_refs: ArchiveRef[];
}

export interface CleanedCreator {
  name: string;
  role: CreatorRole;
  id?: string | null;
  source?: string;
}

export interface MetadataPayload {
  work_id: string;
  metadata: {
    title: string;
    year: number;
    year_display: string | null;
    type: string | LinkedEntity | null;
    genre: (string | LinkedEntity)[] | null;
    creators: CleanedCreator[];
    tags: (string | LinkedEntity)[];
    notes: string | null;
    languages: string[] | null;
    location: string | LinkedEntity;
    publisher: string | LinkedEntity;
    ester_id: string | null;
    external_url: string | null;
    collections: string[];
    archive_refs: ArchiveRef[] | null;
  };
  original_path?: string;
}

// Ekstraktib ESTER ID URL-kujust "record=(b\d+)" → "b\d+"
// Kui juba puhas, tagastab trimitud väärtuse. Tühi string → null.
export function cleanEsterId(raw: string): string | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/record=(b\d+)/);
  if (match) return match[1];
  return trimmed || null;
}

// Puhastab tags massiivi: eemaldab tühjad stringid, trimmib whitespace
export function cleanTags(tags: (string | LinkedEntity)[]): (string | LinkedEntity)[] {
  return tags
    .filter(t => (typeof t === 'string' ? t.trim() !== '' : !!t.label))
    .map(t => (typeof t === 'string' ? t.trim() : t));
}

// Puhastab creators massiivi: eemaldab tühjad nimed, trimmib whitespace
export function cleanCreators(creators: Creator[]): CleanedCreator[] {
  return creators
    .filter(c => c.name.trim() !== '')
    .map(c => ({ name: c.name.trim(), role: c.role, id: c.id, source: c.source }));
}

// Puhastab archive_refs massiivi: eemaldab tühjad kirjed, trimmib stringid
export function cleanArchiveRefs(refs: ArchiveRef[]): ArchiveRef[] | null {
  const clean = refs
    .filter(r => r.archive_id.trim() || r.reference.trim())
    .map(r => {
      const out: ArchiveRef = { archive_id: r.archive_id.trim(), reference: r.reference.trim() };
      const url = (r.url ?? '').trim();
      if (url) out.url = url;
      return out;
    });
  return clean.length > 0 ? clean : null;
}

// Aasta-välja ühendamise invariant (vt aasta-valja-uhendamine-design.md, reegel 4):
// `existing` = vormi avamisel (ja ESTER auto-filli järel) snap-shotitud algne
// { year, year_display }. Kui kasutaja kuvastringi ei muuda, säilitatakse olemasolev
// `year` isegi kui see ei parsi — väldib vaikset andmekao (hea `year` → 0).
export type YearFieldsExisting = { year?: number; year_display?: string };

// Ehitab /update-work-metadata payload-i MetadataForm andmetest.
// `existing` (valikuline): vormi avamisel laetud algne aasta-olek reegli 4 jaoks.
export function buildMetadataPayload(
  form: MetadataFormData,
  workId: string,
  originaalKataloog?: string | null,
  existing?: YearFieldsExisting,
): MetadataPayload {
  const { year, year_display } = deriveYearFields(form.yearInput, existing);
  const payload: MetadataPayload = {
    work_id: workId,
    metadata: {
      title: form.title,
      year,
      year_display: year_display || null,
      type: form.type || null,
      genre: form.genre.length > 0 ? form.genre : null,
      creators: cleanCreators(form.creators),
      tags: cleanTags(form.tags),
      notes: form.notes.trim() || null,
      languages: form.languages.length > 0 ? form.languages : null,
      location: form.location,
      publisher: form.publisher,
      ester_id: cleanEsterId(form.ester_id),
      external_url: form.external_url.trim() || null,
      collections: form.collections,
      archive_refs: cleanArchiveRefs(form.archive_refs),
    },
  };

  if (originaalKataloog) {
    payload.original_path = originaalKataloog;
  }

  return payload;
}
