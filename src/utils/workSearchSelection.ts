import type { CollectionSelection } from '../services/selectionFilter';

/**
 * Teoselt „Otsi": kas valik tuleb vahetada teose koguks, et `?work=` otsing ei
 * oleks tühi? Tagastab vahetatava kogu id või null (valik jääb).
 *
 * Valik, mis teost juba sisaldab, jääb — ka töökollektsioon. Varem vaadati ainult
 * `selectedCollection`-it, mis töökollektsiooni puhul on null, ja valik vahetati
 * alati teose esimese kogu vastu (Fischeri konverents → Academia Gustavo-Carolina).
 * Teadmata liikmesus (`workSetIds` null) ei vaheta: parem tühi tulemus kui vaikselt
 * teine valik.
 */
export function collectionForWorkSearch(
  selection: CollectionSelection,
  workCollections: string[],
  workId: string,
  workSetIds: string[] | null,
): string | null {
  const first = workCollections[0] ?? null;
  if (!first) return null;
  if (selection.kind === 'work_set') {
    if (workSetIds === null || workSetIds.includes(workId)) return null;
    return first;
  }
  if (selection.kind === 'collection' && workCollections.includes(selection.id)) return null;
  return first;
}
