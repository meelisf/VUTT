import type { Annotation, PageStatus, TextAnnotation } from '../../types';
import type { LinkedEntity } from '../../types/LinkedEntity';
import type { EditorSavedState } from './useEditorSave';

/**
 * Lehe salvestuse kolmesuunaline liitmine (#455, ADR 0054) — kliendi pool.
 *
 * Klient saadab `/save`-iga baasseisu: lehe väljad nii, nagu ta need laadis
 * või viimati salvestas. Server liidab selle vastu kettal olevaga; päris
 * kokkupõrke korral vastab 409 ja kaasa tuleb serveri praegune seis.
 */
export interface PageFields {
  text_content: string;
  status: PageStatus;
  page_tags: (string | LinkedEntity)[];
  comments: Annotation[];
  text_annotations: TextAnnotation[];
}

/** Salvestuse tulemus redaktorile: `merged` = server liitis ketta seisu, redaktor võtab üle. */
export interface SaveOutcome {
  merged: PageFields | null;
}

/** Kokkupõrge: midagi ei salvestatud. `fields`: `text`, `status`, `page_tags`, `comments:<id>`. */
export class PageConflictError extends Error {
  constructor(public fields: string[], public current: PageFields) {
    super(`Lehe salvestus põrkus: ${fields.join(', ')}`);
    this.name = 'PageConflictError';
  }
}

export function baseFromSavedState(saved: EditorSavedState): PageFields {
  return {
    text_content: saved.text,
    status: saved.status,
    page_tags: saved.page_tags,
    comments: saved.comments,
    text_annotations: saved.text_annotations,
  };
}

/** 409 vastuse keha → `PageConflictError`; muu → null (tavaline viga). */
export function conflictFromResponse(status: number, body: unknown): PageConflictError | null {
  if (status !== 409 || !body || typeof body !== 'object') return null;
  const detail = (body as { detail?: unknown }).detail;
  if (!detail || typeof detail !== 'object') return null;
  const d = detail as { conflict?: unknown; fields?: unknown; current?: unknown };
  if (d.conflict !== true || !Array.isArray(d.fields) || !d.current || typeof d.current !== 'object') return null;
  return new PageConflictError(d.fields.map(String), d.current as PageFields);
}

/**
 * „Salvesta minu versioon": uus baas = vana baas, kus KONFLIKTIS üksused on
 * serveri praegused. Korduval salvestusel näeb server neis „nemad ei muutnud"
 * → võidab minu seis; teiste konfliktita muudatused (nt staatus) jäävad alles,
 * sest nende baas on endiselt vana.
 */
export function retryBase(base: PageFields, current: PageFields, fields: string[]): PageFields {
  const uus: PageFields = { ...base, comments: [...base.comments] };
  for (const field of fields) {
    if (field === 'text') {
      uus.text_content = current.text_content;
      uus.text_annotations = current.text_annotations;
    } else if (field === 'status') {
      uus.status = current.status;
    } else if (field === 'page_tags') {
      uus.page_tags = current.page_tags;
    } else if (field.startsWith('comments:')) {
      const id = field.slice('comments:'.length);
      const serveris = current.comments.find(c => String(c.id) === id);
      const i = uus.comments.findIndex(c => String(c.id) === id);
      if (serveris && i >= 0) uus.comments[i] = serveris;
      else if (serveris) uus.comments.push(serveris);
      else if (i >= 0) uus.comments.splice(i, 1);
    }
  }
  return uus;
}
