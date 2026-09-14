/**
 * Valiku → Meili filtriklausel (#354).
 *
 * Kaks reeglit, mille rikkumine on vaikne ja ohtlik:
 * 1. TÜHI ID-loend tähendab NULL TULEMUST, mitte filtri ärajätmist. Tühi kogu,
 *    ligipääsu tõttu tühjaks filtreeritud kogu ja „kõik teosed" on kolm eri olekut.
 * 2. Laadimata loend (null) VISKAB. Kutsuja peab ootama loendi ära; vaikne
 *    tagasilangus piiramata korpusele näitaks kasutajale teoseid väljaspool valikut.
 */
export type CollectionSelection =
  | { kind: 'all' }
  | { kind: 'collection'; id: string }
  | { kind: 'work_set'; id: string };

export function selectionFilterClause(
  selection: CollectionSelection,
  workIds: string[] | null,
): string[] {
  if (selection.kind === 'all') return [];
  if (selection.kind === 'collection') {
    return [`collections_hierarchy = "${selection.id}"`];
  }
  if (workIds === null) {
    throw new Error(`Töökollektsiooni ${selection.id} ID-loend ei ole veel laetud`);
  }
  return [`work_id IN [${workIds.map(id => `"${id}"`).join(', ')}]`];
}
