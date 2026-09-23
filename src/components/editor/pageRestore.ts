import type { Annotation, TextAnnotation } from '../../types';
import type { EditorSavedState } from './useEditorSave';

/**
 * `/git-restore` vastus kliendi kujul (#375).
 *
 * Taaste on SERVERIS juba salvestatud ja commititud: redaktor ei tohi seda
 * pidada salvestamata muudatuseks ega vajada uut Ctrl+S-i. `null` väli
 * tähendab „server seda ei taastanud" (lehel ei ole JSON-it) — siis jääb
 * kliendi senine väärtus kehtima, mitte ei tühjendata.
 */
export interface RestoreResult {
  content: string;
  textAnnotations: TextAnnotation[] | null;
  comments: Annotation[] | null;
  /** Failid on kettal, aga ajaloo commit ebaõnnestus (sama leping mis `/save`). */
  gitWarning: string | null;
}

export function parseRestoreResponse(data: unknown): RestoreResult | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.status !== 'success' || typeof d.restored_content !== 'string') return null;
  return {
    content: d.restored_content,
    textAnnotations: Array.isArray(d.restored_text_annotations)
      ? (d.restored_text_annotations as TextAnnotation[]) : null,
    comments: Array.isArray(d.restored_comments) ? (d.restored_comments as Annotation[]) : null,
    gitWarning: d.git_committed === false
      ? String(d.git_error || d.warning || 'git commit failed') : null,
  };
}

/**
 * Salvestatud võrdlusseis pärast taastet: tekstikiht ja kommentaarid on
 * kettal serveri kujul; staatus ja märksõnad jäävad puutumata — taaste neid
 * ei muuda, ja nende salvestamata muudatus peab alles jääma.
 */
export function savedStateAfterRestore(prev: EditorSavedState, r: RestoreResult): EditorSavedState {
  return {
    ...prev,
    text_annotations: r.textAnnotations ?? prev.text_annotations,
    comments: r.comments ?? prev.comments,
  };
}
