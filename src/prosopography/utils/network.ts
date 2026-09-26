// src/prosopography/utils/network.ts
/**
 * Seoste vaadete puhas loogika (#461). Järjekord (spekk): filtreeri servad →
 * eemalda seosteta isikud → arvuta NÄHTAVATEST servadest liik, suurus, loendurid.
 */
import type { NetworkEdge, NetworkPerson, NetworkWork, PersonNetwork, RelationKind } from '../services/networkService';

export const KIND_ORDER: RelationKind[] = ['academic', 'dedicated', 'family', 'cotext', 'mention', 'printer'];
export const STRONG: ReadonlySet<RelationKind> = new Set<RelationKind>(['academic', 'dedicated', 'family']);

export type KindFilter = Record<'cotext' | 'mention' | 'printer', boolean>;
export const DEFAULT_FILTER: KindFilter = { cotext: true, mention: true, printer: false };

export interface VisiblePerson extends NetworkPerson {
  kind: RelationKind;
  workCount: number;
  edges: NetworkEdge[];
  firstYear: number | null;
}

export interface VisibleNetwork {
  focus: NetworkPerson;
  persons: VisiblePerson[];
  edges: NetworkEdge[];
  works: Map<string, NetworkWork>;
  counts: Record<RelationKind, number>;
}

const rank = (k: RelationKind) => KIND_ORDER.indexOf(k);

export function otherEnd(edge: NetworkEdge, focusId: string): string {
  return edge.from === focusId ? edge.to : edge.from;
}

function visible(kind: RelationKind, filter: KindFilter): boolean {
  return STRONG.has(kind) || filter[kind as keyof KindFilter];
}

export function applyFilters(net: PersonNetwork, filter: KindFilter): VisibleNetwork {
  const focusId = net.focus.id;
  const edges = net.edges.filter(e => visible(e.kind, filter));
  const byPerson = new Map<string, NetworkEdge[]>();
  for (const e of edges) {
    const o = otherEnd(e, focusId);
    if (!byPerson.has(o)) byPerson.set(o, []);
    byPerson.get(o)!.push(e);
  }
  const counts = Object.fromEntries(KIND_ORDER.map(k => [k, 0])) as Record<RelationKind, number>;
  const persons: VisiblePerson[] = [];
  for (const p of net.persons) {
    const pe = byPerson.get(p.id);
    if (!pe || pe.length === 0) continue;
    const kind = pe.reduce<RelationKind>((k, e) => (rank(e.kind) < rank(k) ? e.kind : k), 'printer');
    const workIds = new Set(pe.map(e => e.evidence?.work_id).filter((w): w is string => !!w));
    const years = pe.map(e => e.year).filter((y): y is number => typeof y === 'number');
    persons.push({ ...p, kind, workCount: workIds.size, edges: pe, firstYear: years.length ? Math.min(...years) : null });
    counts[kind] += 1;
  }
  return { focus: net.focus, persons, edges, works: new Map(net.works.map(w => [w.work_id, w])), counts };
}

/** Kaaslaste servad: seotud isikud, kes esinevad OMAVAHEL samas teoses. */
export function coEdges(v: VisibleNetwork): Array<{ a: string; b: string; weight: number }> {
  const byWork = new Map<string, Set<string>>();
  for (const p of v.persons) {
    for (const e of p.edges) {
      const w = e.evidence?.work_id;
      if (!w) continue;
      if (!byWork.has(w)) byWork.set(w, new Set());
      byWork.get(w)!.add(p.id);
    }
  }
  const pairs = new Map<string, number>();
  for (const ids of byWork.values()) {
    const list = [...ids].sort();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const key = `${list[i]}|${list[j]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }
  return [...pairs].map(([key, weight]) => {
    const [a, b] = key.split('|');
    return { a, b, weight };
  });
}

/** Pereserva kuvatekst: fookuse kaardi kirje eelistatud, muidu teise kaardi kirje allikaga. */
export function familyLabel(edge: NetworkEdge, focusId: string, labelOf: (id: string) => string): string | null {
  const recs = edge.records ?? [];
  const own = recs.find(r => r.source_id === focusId && r.type);
  if (own) return own.type;
  const other = recs.find(r => r.type);
  return other ? `${labelOf(other.source_id)}: ${other.type}` : null;
}
