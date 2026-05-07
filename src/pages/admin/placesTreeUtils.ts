import type { PlaceEntry } from '../../prosopography/types';

export interface PlaceTreeNode {
  key: string;
  entry: PlaceEntry;
  children: PlaceTreeNode[];
}

export interface PlaceTreeGroup {
  groupKey: string | null;
  groupLabels: Record<string, string> | null;
  sortOrder: number;
  nodes: PlaceTreeNode[];       // direct places in this group
  subGroups: PlaceTreeGroup[];  // child groups (only at top level)
}

function resolveGroupKey(
  placeKey: string,
  places: Record<string, PlaceEntry>,
  depth = 0,
): string | null {
  if (depth > 5) return null;
  const entry = places[placeKey];
  if (!entry) return null;
  if (entry.group) return entry.group;
  if (!entry.parent_key) return null;
  return resolveGroupKey(entry.parent_key, places, depth + 1);
}

function buildSubtree(
  rootKey: string,
  places: Record<string, PlaceEntry>,
  groupKey: string | null,
  placeGroupMap: Map<string, string | null>,
): PlaceTreeNode {
  const children = Object.entries(places)
    .filter(([k, e]) => e.parent_key === rootKey && placeGroupMap.get(k) === groupKey)
    .map(([k]) => buildSubtree(k, places, groupKey, placeGroupMap));
  return { key: rootKey, entry: places[rootKey], children };
}

export function buildPlacesTree(
  places: Record<string, PlaceEntry>,
  groups: Record<string, { labels?: Record<string, string>; sort_order?: number; parent?: string | null }>,
): PlaceTreeGroup[] {
  const placeGroupMap = new Map<string, string | null>();
  for (const key of Object.keys(places)) {
    placeGroupMap.set(key, resolveGroupKey(key, places));
  }

  const groupRoots = new Map<string | null, string[]>();
  for (const [key, entry] of Object.entries(places)) {
    const myGroup = placeGroupMap.get(key) ?? null;
    const parentGroup = entry.parent_key ? (placeGroupMap.get(entry.parent_key) ?? null) : null;
    if (!entry.parent_key || parentGroup !== myGroup) {
      const roots = groupRoots.get(myGroup) ?? [];
      roots.push(key);
      groupRoots.set(myGroup, roots);
    }
  }

  const sortedGroups = Object.entries(groups).sort(
    ([, a], [, b]) => (a.sort_order ?? 50) - (b.sort_order ?? 50),
  );

  const groupMap = new Map<string, PlaceTreeGroup>();
  for (const [groupKey, groupMeta] of sortedGroups) {
    const roots = groupRoots.get(groupKey) ?? [];
    groupMap.set(groupKey, {
      groupKey,
      groupLabels: groupMeta.labels ?? null,
      sortOrder: groupMeta.sort_order ?? 50,
      nodes: roots.map(k => buildSubtree(k, places, groupKey, placeGroupMap)),
      subGroups: [],
    });
  }

  const ungroupedRoots = groupRoots.get(null) ?? [];

  const result: PlaceTreeGroup[] = [];

  for (const [groupKey, groupMeta] of sortedGroups) {
    const parent = groupMeta.parent;
    if (parent && groups[parent]) continue; // on alamgrupp, jätame vahele
    const group = groupMap.get(groupKey)!;
    const children = sortedGroups
      .filter(([, m]) => m.parent === groupKey)
      .map(([k]) => groupMap.get(k)!)
      .filter(Boolean);
    if (group.nodes.length === 0 && children.length === 0) continue;
    result.push({ ...group, subGroups: children });
  }

  if (ungroupedRoots.length > 0) {
    result.push({
      groupKey: null,
      groupLabels: null,
      sortOrder: 999,
      nodes: ungroupedRoots.map(k => buildSubtree(k, places, null, placeGroupMap)),
      subGroups: [],
    });
  }

  return result;
}
