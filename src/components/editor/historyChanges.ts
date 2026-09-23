/**
 * Lehe ajaloo kirje `changes` (#375 punkt 1) — server võrdleb lehe JSON-i
 * versiooni tema vanemaga (`server/page_history.py`). Tühjad grupid
 * puuduvad; `text` on alati olemas.
 */
export interface ItemChange { id: string | number; text: string }
export interface ItemModified { id: string | number; before: string; after: string }
export interface ItemGroupChange {
  added?: ItemChange[];
  modified?: ItemModified[];
  removed?: ItemChange[];
}
export interface PageChanges {
  text: boolean;
  text_annotations?: ItemGroupChange;
  comments?: ItemGroupChange;
  page_tags?: { added?: string[]; removed?: string[] };
  status?: { before: string | null; after: string | null };
  other_fields?: string[];
}

/**
 * Kas „Taasta" on selle versiooni juures tähenduslik. Taaste taastab teksti
 * koos tekst-annotatsioonidega (#375 punkt 2) — märkmete, märksõnade või
 * staatuse muutusega versiooni juures pakuks nupp midagi, mida ta ei tee.
 * `undefined` (vana server) → nagu varem, nupp on alati.
 */
export function canRestoreVersion(changes: PageChanges | undefined): boolean {
  if (!changes) return true;
  return changes.text || !!changes.text_annotations;
}

/** Kas tekstidiffi tasub laadida. `undefined` (vana server) → nagu varem. */
export function hasTextChange(changes: PageChanges | undefined): boolean {
  return changes ? changes.text : true;
}

export function groupCounts(g: ItemGroupChange | undefined) {
  return {
    added: g?.added?.length ?? 0,
    modified: g?.modified?.length ?? 0,
    removed: g?.removed?.length ?? 0,
  };
}
