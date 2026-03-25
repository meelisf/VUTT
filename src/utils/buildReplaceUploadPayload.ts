/**
 * Ehitab create-upload POST payload teose asendamise jaoks.
 * Kasutatakse Upload.tsx-is kui kasutaja tuleb /work/{id}/manage lehelt.
 */

export interface WorkMeta {
  title?: string;
  year?: number | string | null;
  slug?: string;
  collections?: string[];
  creators?: unknown[];
  genre?: unknown;
  type?: unknown;
  tags?: unknown[];
  location?: unknown;
  publisher?: unknown;
  languages?: string[];
}

export interface ReplaceUploadPayload {
  title: string;
  year: string;
  slug: string;
  collections: string[];
  replace_work_id: string;
  creators: unknown[];
  genre: unknown;
  type: unknown;
  tags: unknown[];
  location: unknown;
  publisher: unknown;
  languages: string[];
}

export function sanitizeSlugForReplace(text: string, maxLen = 60): string {
  return (
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, maxLen)
      .replace(/-+$/g, '') || 'teos'
  );
}

export function buildReplaceUploadPayload(
  meta: WorkMeta,
  replaceWorkId: string
): ReplaceUploadPayload {
  const title = meta.title || '';
  const year = meta.year ? String(meta.year) : '';
  const slug = meta.slug || sanitizeSlugForReplace((year ? year + '-' : '') + title);
  const collections =
    Array.isArray(meta.collections) && meta.collections.length > 0
      ? [meta.collections[0]]
      : [];

  return {
    title,
    year,
    slug,
    collections,
    replace_work_id: replaceWorkId,
    creators: meta.creators || [],
    genre: meta.genre || null,
    type: meta.type || null,
    tags: meta.tags || [],
    location: meta.location || null,
    publisher: meta.publisher || null,
    languages: meta.languages || [],
  };
}
