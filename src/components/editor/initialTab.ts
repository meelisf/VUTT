import type { EditorTab } from './types';

/**
 * Redaktori algvahekaart. `?part=` (kirjaotsingu link, #526) avab märgenduse
 * vahekaardi, sest osade sisukord elab seal — kasutaja vaikevalik ei kirjuta
 * seda üle, muidu jõuaks lingi saaja tekstiredaktorisse ja kiri jääks peitu.
 */
export function initialEditorTab(partParam: string | null, defaultTab?: string): EditorTab {
  if (partParam) return 'annotate';
  return defaultTab === 'annotate' ? 'annotate' : 'edit';
}
