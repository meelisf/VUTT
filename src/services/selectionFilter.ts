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

/**
 * Valiku ulatus filtrikutsetes: kas püsikogu id (vana kuju, endiselt lubatud)
 * või täisvalik koos serverilt saadud ID-loendiga.
 *
 * Elab siin, mitte `searchService`-is, sest ka `types.ts` vajab teda ja
 * `searchService` impordib `types`-ist — vastupidine import oleks tsükkel.
 */
export type SelectionScope =
  | string
  | { selection: CollectionSelection; workSetIds: string[] | null };

/**
 * Ulatus → filtriklauslid. ÜKS tee kõigile kutsujatele (otsing, facetid,
 * statistika): kaks eraldi teisendust lahkneksid.
 */
export function scopeClauses(scope?: SelectionScope): string[] {
  if (!scope) return [];
  if (typeof scope === 'string') return [`collections_hierarchy = "${scope}"`];
  // VISKAB laadimata loendi peal — tahtlikult: piiramata päring näitaks
  // teoseid väljaspool valikut.
  return selectionFilterClause(scope.selection, scope.workSetIds);
}
