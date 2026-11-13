// src/prosopography/utils/network.ts
/**
 * Seoste vaadete puhas loogika (#461). Järjekord (spekk): filtreeri servad →
 * eemalda seosteta isikud → arvuta NÄHTAVATEST servadest liik, suurus, loendurid.
 */
import { formatRelationTypeLabel } from './estonianName';
import type { NetworkEdge, NetworkPart, NetworkPerson, NetworkWork, PersonNetwork, RelationKind } from '../services/networkService';

// Isiku liik (sõlm) = tugevaim liik selles järjekorras. Perekond on teostest tulenevate
// seoste järel: sugulus, millel on kõrval teoseseos, on lisatunnus (joon, tekst), mitte sõlm.
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
  parts: Map<string, NetworkPart>;
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
    const person: VisiblePerson = { ...p, kind, workCount: workIds.size, edges: pe, firstYear: years.length ? Math.min(...years) : null };
    persons.push(person);
    // Loendur = mitmel isikul see seos on; sugulane-respondens loetakse mõlemasse.
    for (const k of personKinds(person)) counts[k] += 1;
  }
  return { focus: net.focus, persons, edges, works: new Map(net.works.map(w => [w.work_id, w])),
           parts: new Map((net.parts ?? []).map(p => [p.part_id, p])), counts };
}

/** Isiku kõik nähtavad tugevad liigid KIND_ORDER-i järjekorras, nõrga isiku puhul tema liik.
 *  Sugulane, kes on ühtlasi respondens → ringvaates kaks paralleeljoont, tabelis mõlemad liigid. */
export function personKinds(p: VisiblePerson): RelationKind[] {
  const strong = KIND_ORDER.filter(k => STRONG.has(k) && p.edges.some(e => e.kind === k));
  return strong.length ? strong : [p.kind];
}

/** Tõendi lingi sihtleht: esimene tõendileht, osa korral osa esimene leht, muidu 1. */
export function evidenceTarget(e: NetworkEdge, v: VisibleNetwork): { page: number; part: NetworkPart | undefined } {
  const part = e.evidence?.part_id ? v.parts.get(e.evidence.part_id) : undefined;
  return { page: e.evidence?.pages[0] ?? part?.first_page ?? 1, part };
}

/**
 * Pereserva seos lausena kuvamiseks: `subject` on `owner`-i `type` (kirje kannab tüüpi
 * sihtisiku kohta: source = kaardi omanik, target = see, kes on „isa" jne).
 * Fookuse kaardi kirje eelistatud, muidu teise kaardi kirje. Suunda EI pöörata —
 * pöördtüüp sõltub soost ja liinist (isa → poeg/tütar), vt `reciprocal_ops`.
 */
export function familyRelation(
  edge: NetworkEdge, focusId: string, labelOf: (id: string) => string, lang = 'et',
): { subject: string; subjectId: string; owner: string; type: string } | null {
  const recs = edge.records ?? [];
  const rec = recs.find(r => r.source_id === focusId && r.type) ?? recs.find(r => r.type);
  if (!rec) return null;
  return {
    subject: labelOf(rec.target_id),
    subjectId: rec.target_id,
    owner: labelOf(rec.source_id),
    // Tüüp UI keeles: keelesilt → en → toorväärtus (sama ahel nagu isikulehe seostes)
    type: formatRelationTypeLabel(rec.type!, rec.type_labels, lang),
  };
}
export interface TimelineMark { year: number | null; works: string[]; kind: RelationKind; }
export interface TimelineRow { person: VisiblePerson; marks: TimelineMark[]; }

export function timelineRows(v: VisibleNetwork) {
  let minYear: number | null = null;
  let maxYear: number | null = null;
  let hasUndated = false;
  const rows: TimelineRow[] = v.persons.map(person => {
    const byYear = new Map<number | null, { works: Set<string>; kind: RelationKind }>();
    for (const e of person.edges) {
      const y = typeof e.year === 'number' ? e.year : null;
      if (y === null) hasUndated = true;
      else {
        minYear = minYear === null ? y : Math.min(minYear, y);
        maxYear = maxYear === null ? y : Math.max(maxYear, y);
      }
      const slot = byYear.get(y) ?? { works: new Set<string>(), kind: e.kind };
      if (e.evidence?.work_id) slot.works.add(e.evidence.work_id);
      if (rank(e.kind) < rank(slot.kind)) slot.kind = e.kind;
      byYear.set(y, slot);
    }
    const marks = [...byYear].map(([year, s]) => ({ year, works: [...s.works], kind: s.kind }))
      .sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity));
    return { person, marks };
  });
  rows.sort((a, b) => (a.person.firstYear ?? Infinity) - (b.person.firstYear ?? Infinity)
    || b.person.workCount - a.person.workCount || a.person.label.localeCompare(b.person.label));
  return { rows, minYear, maxYear, hasUndated };
}
