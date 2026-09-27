// Isikurea ja EntityPickeri väärtuse vaheline kaardistus — üks koht kõigile
// isikulisamise vormidele (metaandmed, upload, teose osad #464).
import type { LinkedEntity } from '../../types/LinkedEntity';

export interface CreatorLike {
  name?: string;
  role: string;
  id?: string | null;
  source?: string;
}

/** Lingitud isik (id või Wikidata) → LinkedEntity; lingita nimi → paljas string. */
export function creatorToPickerValue(c: CreatorLike): LinkedEntity | string {
  if (c.id || c.source === 'wikidata') {
    return { id: c.id || null, label: c.name ?? '', source: c.source || 'wikidata', labels: { et: c.name ?? '' } } as LinkedEntity;
  }
  return c.name ?? '';
}

/** Pickeri valik → isikurida. `local` (vabatekst/soovitus) salvestub `manual`-ina. */
export function creatorFromPicker<C extends CreatorLike>(c: C, val: LinkedEntity | null): C {
  return {
    ...c,
    name: val?.label || '',
    id: val?.id || null,
    source: (val?.source === 'local' ? 'manual' : val?.source) || 'manual',
  };
}
