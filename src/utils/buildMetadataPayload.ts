import { Creator, CreatorRole } from '../types';
import { LinkedEntity } from '../types/LinkedEntity';

export interface MetadataFormData {
  title: string;
  year: number;
  year_display: string;
  type: string | LinkedEntity | null;
  genre: (string | LinkedEntity)[];
  tags: (string | LinkedEntity)[];
  location: string | LinkedEntity;
  publisher: string | LinkedEntity;
  creators: Creator[];
  languages: string[];
  ester_id: string;
  external_url: string;
  collections: string[];
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
    languages: string[] | null;
    location: string | LinkedEntity;
    publisher: string | LinkedEntity;
    ester_id: string | null;
    external_url: string | null;
    collections: string[];
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

// Ehitab /update-work-metadata payload-i MetadataForm andmetest
export function buildMetadataPayload(
  form: MetadataFormData,
  workId: string,
  originaalKataloog?: string | null,
): MetadataPayload {
  const payload: MetadataPayload = {
    work_id: workId,
    metadata: {
      title: form.title,
      year: form.year,
      year_display: form.year_display.trim() || null,
      type: form.type || null,
      genre: form.genre.length > 0 ? form.genre : null,
      creators: cleanCreators(form.creators),
      tags: cleanTags(form.tags),
      languages: form.languages.length > 0 ? form.languages : null,
      location: form.location,
      publisher: form.publisher,
      ester_id: cleanEsterId(form.ester_id),
      external_url: form.external_url.trim() || null,
      collections: form.collections,
    },
  };

  if (originaalKataloog) {
    payload.original_path = originaalKataloog;
  }

  return payload;
}
