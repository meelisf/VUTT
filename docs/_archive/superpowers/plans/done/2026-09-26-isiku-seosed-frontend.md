# Isiku seosed — frontend (PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isikulehele sektsioon „Seosed" vahekaartidega Võrgustik · Ajatelg · Loend, mis
tarbib PR 1 endpointi `GET /prosopography/{id}/network`, ja mis asendab `WorkRelationsCard`-i.

**Architecture:** Kogu loogika on puhastes utiliitides (`utils/network.ts`: filtreerimine,
isiku liik ja suurus, kaaslaste servad, paigutused), mida testitakse node-keskkonnas.
Komponendid (`components/relations/`) on õhukesed SVG/HTML renderdajad. Üks
`RelationPopover` on ühine kõigile vaadetele. Sektsioon laaditakse laisalt (`React.lazy`),
et isikulehe põhibundle ei kasvaks. Uusi sõltuvusi ei lisata (käsitsi SVG, d3 ei ole).

**Tech Stack:** React 19, TypeScript, Tailwind, react-i18next, vitest (+ jsdom komponenditestides).

**Spec:** `docs/superpowers/specs/2026-09-26-isiku-seoste-vaade-design.md` („Vaated",
„Palett", „Testimine"). PR 1 on tootmises (#466); reeglite parandus #467 (trükkal enne
mainimist) muudab ainult serveri liigitust.

## Global Constraints

- i18n (ADR 0011): iga uus võti **mõlemasse** `src/locales/{et,en}/prosopography.json`
  korraga; `fallbackLng` on väljas. Valvurid: `localeParity.test.ts`,
  `translationKeysResolve.test.ts`. Kasuta `t('relations.xxx')` **literaalse** võtmega.
- Koodikommentaarid eesti keeles.
- Väravad: `npm run typecheck` (Vite ei typecheck'i), `npm test`, `npm run lint:ci`
  (`--max-warnings 42`; arv EI TOHI kasvada).
- Komponenditest valib jsdom-i failipäisega `/** @vitest-environment jsdom */`.
- Kolm tugevat liiki on värviga, **ainult** need hexid (valideeritud, spekk „Palett"):
  `academic #2a78d6`, `dedicated #eb6834`, `family #1baf7a`. Nõrgad (`cotext`, `mention`,
  `printer`) on hallid `#8a939d` ja eristuvad kujuga. Värv ei ole kunagi ainus tunnus.
  Rakendusel dark mode'i ei ole.
- Filtreerimise järjekord (spekk): filtreeri servad → eemalda seosteta isikud →
  arvuta nähtavate servade põhjal isiku liik, suurus ja loendurid.
  „Ühiseid teoseid" = **unikaalsed** `evidence.work_id`-d.
- Vaikimisi filtrid: `cotext` ja `mention` sees, `printer` väljas.
- Täisekraani/hüpik z-index: hüpikaken on `position: fixed` ja `z-[1300]` (CLAUDE.md:
  päis on `z-[1200]`).
- Kerib AKEN; ajatelje pikk loend on oma konteineris (spekk lubab erandi).
- Piiratud teos (`restricted`): pealkiri ilma lingita, märkega „kaitstud".
- Lingid: isik `/persons/{id}`, teos `/work/{id}/{lk}` (mainimisel esimene lehekülg,
  muidu 1). Sisemised lingid `react-router` `Link`-iga.

## Review Focus

1. **Tühi võrgustik** (isik ilma seosteta, nt `vutt:Plonely`): sektsioon ei renderda
   tühje vahekaarte. Kuvatakse üks rida „Seoseid ei leitud". Test Task 5-s.
2. **Kõik servad filtriga peidetud** (nt ainult trükkalid, `printer` väljas): sama tühi
   olek, mitte 0-sõlmega graaf. Test Task 1-s (`applyFilters` → 0 isikut) ja Task 5-s.
3. **Endpointi viga / 404 / aeglane vastus:** sektsioon näitab veateadet ega kukuta
   isikulehte. Vana vastus ei tohi pärast isiku vahetust üle kirjutada uut (race).
   Test Task 5-s.
4. **Väga pikk nimi ja üle 40 seotud isiku** (Vogel 241): graafis on sildid ainult
   suurima seosega isikutel, teised on hõljutusel nähtavad. Test Task 2-s
   (`radialLayout` `labelled`).
5. **Aastata teos ja pereserv samal isikul:** ajateljel „Aeg teadmata" veerus, rida ei
   kao. Test Task 2-s.

---

## Failide kaart

| Fail | Vastutus |
|---|---|
| `src/prosopography/services/networkService.ts` (uus) | tüübid + `fetchPersonNetwork` |
| `src/prosopography/utils/network.ts` (uus) | puhas loogika: filtrid, liik, suurus, kaaslased, pereseose silt, paigutused |
| `src/prosopography/utils/__tests__/network.test.ts` (uus) | utiliitide testid |
| `src/prosopography/components/relations/kindStyle.ts` (uus) | värv + kuju liigi kohta, SVG-märk |
| `src/prosopography/components/relations/RelationPopover.tsx` (uus) | hõljutus/kinnitus, lingid |
| `src/prosopography/components/relations/RelationsGraph.tsx` (uus) | radiaalne võrgustik |
| `src/prosopography/components/relations/RelationsTimeline.tsx` (uus) | ajatelg |
| `src/prosopography/components/relations/RelationsTable.tsx` (uus) | loend/tabel |
| `src/prosopography/components/relations/PersonRelations.tsx` (uus) | sektsioon: fetch, filtrid, vahekaardid, kogu lüliti |
| `src/prosopography/components/relations/__tests__/PersonRelations.test.tsx` (uus) | komponenditest |
| `src/prosopography/pages/PersonDetailPage.tsx` (muuda) | `WorkRelationsCard` → laisk `PersonRelations` |
| `src/prosopography/components/WorkRelationsCard.tsx` (kustuta), `prosopographyService.ts` (eemalda `fetchWorkRelations` + tüübid) | vana kaart |
| `src/locales/{et,en}/prosopography.json` (muuda) | `relations.*` võtmed |

---

### Task 1: Teenus, tüübid ja filtreerimise loogika

**Files:**
- Create: `src/prosopography/services/networkService.ts`
- Create: `src/prosopography/utils/network.ts`
- Test: `src/prosopography/utils/__tests__/network.test.ts`

**Interfaces:**
- Produces (TS):
  ```ts
  export type RelationKind = 'academic' | 'dedicated' | 'family' | 'cotext' | 'mention' | 'printer';
  export interface NetworkPerson { id: string; label: string; birth_year: number | null; death_year: number | null;
    origin: { place: string | null; place_id: string | null; coordinates: { lat: number; lon: number } | null } | null; }
  export interface NetworkWork { work_id: string; title: string; year: number | null;
    place: { id: string | null; label: string; coordinates: { lat: number; lon: number } | null } | null;
    genres: string[]; restricted: boolean; }
  export interface FamilyRecord { source_id: string; target_id: string; type: string | null; }
  export interface NetworkEdge { kind: RelationKind; from: string; to: string; directed: boolean;
    roles?: Record<string, string[]>; records?: FamilyRecord[]; year: number | null;
    place: { id: string | null; kind: 'print' | 'event' | 'sent_from' } | null;
    evidence: { work_id: string; pages: number[]; part_id?: string } | null; }
  export interface PersonNetwork { focus: NetworkPerson; persons: NetworkPerson[]; works: NetworkWork[]; edges: NetworkEdge[]; }
  export function fetchPersonNetwork(personId: string, collection?: string | null): Promise<PersonNetwork>;
  ```
  `utils/network.ts`:
  ```ts
  export const KIND_ORDER: RelationKind[];            // academic, dedicated, family, cotext, mention, printer
  export const STRONG: ReadonlySet<RelationKind>;     // academic, dedicated, family
  export type KindFilter = Record<'cotext' | 'mention' | 'printer', boolean>;
  export const DEFAULT_FILTER: KindFilter;            // { cotext: true, mention: true, printer: false }
  export interface VisiblePerson extends NetworkPerson { kind: RelationKind; workCount: number; edges: NetworkEdge[]; firstYear: number | null; }
  export interface VisibleNetwork { focus: NetworkPerson; persons: VisiblePerson[]; edges: NetworkEdge[];
    works: Map<string, NetworkWork>; counts: Record<RelationKind, number>; }
  export function otherEnd(edge: NetworkEdge, focusId: string): string;
  export function applyFilters(net: PersonNetwork, filter: KindFilter): VisibleNetwork;
  export function coEdges(v: VisibleNetwork): Array<{ a: string; b: string; weight: number }>;
  export function familyLabel(edge: NetworkEdge, focusId: string, labelOf: (id: string) => string): string | null;
  ```

- [ ] **Step 1: Kirjuta failivad testid**

```ts
// src/prosopography/utils/__tests__/network.test.ts
import { describe, it, expect } from 'vitest';
import { applyFilters, coEdges, familyLabel, otherEnd, DEFAULT_FILTER } from '../network';
import type { PersonNetwork, NetworkEdge } from '../../services/networkService';

const F = 'vutt:Pfocus';
const P = (id: string, label = id) => ({ id, label, birth_year: null, death_year: null, origin: null });
const W = (work_id: string, year: number | null = 1658) =>
  ({ work_id, title: `T ${work_id}`, year, place: null, genres: [], restricted: false });
const E = (kind: NetworkEdge['kind'], other: string, work: string | null, year: number | null = 1658): NetworkEdge => ({
  kind, from: other, to: F, directed: kind === 'academic', year, place: null,
  evidence: work ? { work_id: work, pages: [] } : null,
  roles: work ? { [F]: ['respondens'], [other]: ['praeses'] } : undefined,
});

const NET: PersonNetwork = {
  focus: P(F, 'Fookus'),
  persons: [P('a'), P('b'), P('c'), P('t')],
  works: [W('w1'), W('w2', 1660), W('w3', null)],
  edges: [
    E('academic', 'a', 'w1'),
    E('cotext', 'a', 'w2', 1660),        // sama isik, nõrgem serv
    E('mention', 'b', 'w1'),
    E('cotext', 'b', 'w2', 1660),
    E('cotext', 'c', 'w2', 1660),
    E('cotext', 'c', 'w2', 1660),        // kaks serva samast teosest (mitu rolli) → 1 teos
    E('printer', 't', 'w1'),
  ],
};

describe('applyFilters', () => {
  it('vaikimisi peidab trükkalid ja eemaldab seosteta isikud', () => {
    const v = applyFilters(NET, DEFAULT_FILTER);
    expect(v.persons.map(p => p.id).sort()).toEqual(['a', 'b', 'c']);
    expect(v.edges.some(e => e.kind === 'printer')).toBe(false);
  });

  it('isiku liik = tugevaim NÄHTAV serv', () => {
    const v = applyFilters(NET, DEFAULT_FILTER);
    expect(v.persons.find(p => p.id === 'a')!.kind).toBe('academic');
    // b: mention (w1) + cotext (w2); KIND_ORDER-is on cotext tugevam kui mention
    expect(v.persons.find(p => p.id === 'b')!.kind).toBe('cotext');
  });

  it('peidetud tugevaim serv → liik järgmisest nähtavast', () => {
    const v = applyFilters(NET, { cotext: false, mention: true, printer: false });
    expect(v.persons.find(p => p.id === 'b')!.kind).toBe('mention');
  });

  it('ühiseid teoseid = unikaalsed work_id-d, mitte servad', () => {
    const v = applyFilters(NET, DEFAULT_FILTER);
    expect(v.persons.find(p => p.id === 'c')!.workCount).toBe(1);
    expect(v.persons.find(p => p.id === 'a')!.workCount).toBe(2);
  });

  it('loendurid on nähtavate isikute liikide järgi', () => {
    const v = applyFilters(NET, DEFAULT_FILTER);
    expect(v.counts.academic).toBe(1);
    expect(v.counts.printer).toBe(0);
  });

  it('kõik servad peidetud → 0 isikut', () => {
    const onlyPrinter: PersonNetwork = { ...NET, persons: [P('t')], edges: [E('printer', 't', 'w1')] };
    expect(applyFilters(onlyPrinter, DEFAULT_FILTER).persons).toEqual([]);
  });

  it('firstYear on väikseim aasta, aastata servad ei loe', () => {
    const v = applyFilters(NET, DEFAULT_FILTER);
    expect(v.persons.find(p => p.id === 'a')!.firstYear).toBe(1658);
  });
});

describe('coEdges', () => {
  it('seob isikud, kes esinevad samas teoses, kaaluga = ühiste teoste arv', () => {
    const v = applyFilters(NET, DEFAULT_FILTER);
    const byPair = Object.fromEntries(coEdges(v).map(c => [`${c.a}|${c.b}`, c.weight]));
    expect(byPair['a|b']).toBe(2);        // w1 ja w2
    expect(byPair['a|c']).toBe(1);
    expect(byPair['b|c']).toBe(1);
  });
});

describe('otherEnd', () => {
  it('annab serva teise otsa sõltumata suunast', () => {
    expect(otherEnd({ ...E('academic', 'a', 'w1') }, F)).toBe('a');
    expect(otherEnd({ ...E('academic', 'a', 'w1'), from: F, to: 'a' }, F)).toBe('a');
  });
});

describe('familyLabel', () => {
  const edge: NetworkEdge = {
    kind: 'family', from: 'a', to: F, directed: false, year: null, place: null, evidence: null,
    records: [{ source_id: F, target_id: 'a', type: 'isa' }, { source_id: 'a', target_id: F, type: 'poeg' }],
  };
  const labelOf = (id: string) => ({ a: 'Hackspan', [F]: 'Fischer' } as Record<string, string>)[id] ?? id;

  it('eelistab fookuse kaardi kirjet', () => {
    expect(familyLabel(edge, F, labelOf)).toBe('isa');
  });

  it('teise kaardi kirje koos allikaga', () => {
    const e2 = { ...edge, records: [edge.records![1]] };
    expect(familyLabel(e2, F, labelOf)).toBe('Hackspan: poeg');
  });

  it('tüübita kirje → null', () => {
    const e3 = { ...edge, records: [{ source_id: F, target_id: 'a', type: null }] };
    expect(familyLabel(e3, F, labelOf)).toBeNull();
  });
});
```

- [ ] **Step 2: Käivita, veendu et kukub**

Run: `npx vitest run src/prosopography/utils/__tests__/network.test.ts`
Expected: FAIL (`Cannot find module '../network'`)

- [ ] **Step 3: Implementeeri teenus**

```ts
// src/prosopography/services/networkService.ts
/**
 * Isiku seoste võrgustik (#461): GET /prosopography/{id}/network.
 * Andmeleping: docs/superpowers/specs/2026-09-26-isiku-seoste-vaade-design.md.
 */
import { FILE_API_URL } from '../../config';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout';

export type RelationKind = 'academic' | 'dedicated' | 'family' | 'cotext' | 'mention' | 'printer';

export interface NetworkPerson {
  id: string;
  label: string;
  birth_year: number | null;
  death_year: number | null;
  origin: { place: string | null; place_id: string | null; coordinates: { lat: number; lon: number } | null } | null;
}

export interface NetworkWork {
  work_id: string;
  title: string;
  year: number | null;
  place: { id: string | null; label: string; coordinates: { lat: number; lon: number } | null } | null;
  genres: string[];
  restricted: boolean;
}

export interface FamilyRecord { source_id: string; target_id: string; type: string | null; }

export interface NetworkEdge {
  kind: RelationKind;
  from: string;
  to: string;
  directed: boolean;
  roles?: Record<string, string[]>;
  records?: FamilyRecord[];
  year: number | null;
  place: { id: string | null; kind: 'print' | 'event' | 'sent_from' } | null;
  evidence: { work_id: string; pages: number[]; part_id?: string } | null;
}

export interface PersonNetwork {
  focus: NetworkPerson;
  persons: NetworkPerson[];
  works: NetworkWork[];
  edges: NetworkEdge[];
}

export async function fetchPersonNetwork(personId: string, collection?: string | null): Promise<PersonNetwork> {
  const url = new URL(`${FILE_API_URL}/prosopography/${personId}/network`, window.location.origin);
  if (collection) url.searchParams.set('collection', collection);
  const resp = await fetchWithTimeout(url.toString(), { timeout: 15000 });
  if (!resp.ok) throw new Error(`fetchPersonNetwork: ${resp.status}`);
  return resp.json();
}
```

- [ ] **Step 4: Implementeeri utiliidid**

```ts
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
```

- [ ] **Step 5: Käivita**

Run: `npx vitest run src/prosopography/utils/__tests__/network.test.ts`
Expected: kõik läbivad

- [ ] **Step 6: Commit**

```bash
git add src/prosopography/services/networkService.ts src/prosopography/utils/network.ts src/prosopography/utils/__tests__/network.test.ts
git commit -m "feat(prosopo): seoste võrgustiku teenus ja filtreerimise loogika (#461)"
```

---

### Task 2: Paigutused (radiaalne võrgustik, ajatelg)

**Files:**
- Modify: `src/prosopography/utils/network.ts`
- Test: `src/prosopography/utils/__tests__/network.test.ts`

**Interfaces:**
- Consumes: `VisibleNetwork`, `VisiblePerson`, `KIND_ORDER` (Task 1)
- Produces:
  ```ts
  export interface RadialNode { person: VisiblePerson; x: number; y: number; angle: number; r: number; labelled: boolean; }
  export function radialLayout(v: VisibleNetwork, size: { w: number; h: number }): { cx: number; cy: number; radius: number; nodes: RadialNode[] };
  export interface TimelineMark { year: number | null; works: string[]; kind: RelationKind; }
  export interface TimelineRow { person: VisiblePerson; marks: TimelineMark[]; }
  export function timelineRows(v: VisibleNetwork): { rows: TimelineRow[]; minYear: number | null; maxYear: number | null; hasUndated: boolean };
  ```
  `TimelineMark.year === null` tähistab „Aeg teadmata" veergu. Sama aasta teosed on üks märk
  (`works.length > 1` → liitmärk arvuga), `kind` = selle aasta tugevaim serv.

- [ ] **Step 1: Kirjuta failivad testid** (lisa faili lõppu; importi ka `radialLayout, timelineRows`)

```ts
describe('radialLayout', () => {
  it('rühmitab liigi järgi, siis esimese aasta järgi, ringil', () => {
    const v = applyFilters(NET, DEFAULT_FILTER);
    const { nodes, cx, cy, radius } = radialLayout(v, { w: 600, h: 600 });
    expect(nodes.map(n => n.person.id)).toEqual(['a', 'b', 'c']);   // academic, siis cotext (b 1658 enne c 1660)
    for (const n of nodes) {
      expect(Math.hypot(n.x - cx, n.y - cy)).toBeCloseTo(radius, 5);
    }
  });

  it('üle 40 isiku: sildid ainult suurima seosega isikutel', () => {
    const many: PersonNetwork = {
      ...NET,
      persons: Array.from({ length: 60 }, (_, i) => P(`p${i}`)),
      edges: Array.from({ length: 60 }, (_, i) => E('cotext', `p${i}`, i < 5 ? 'w1' : `x${i}`)),
      works: [W('w1'), ...Array.from({ length: 60 }, (_, i) => W(`x${i}`))],
    };
    // p0..p4 saavad lisaks teise teose → workCount 2
    many.edges.push(...Array.from({ length: 5 }, (_, i) => E('cotext', `p${i}`, 'w2')));
    many.works.push(W('w2'));
    const { nodes } = radialLayout(applyFilters(many, DEFAULT_FILTER), { w: 800, h: 800 });
    const labelled = nodes.filter(n => n.labelled).map(n => n.person.id).sort();
    expect(labelled).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
  });

  it('kuni 40 isikut: kõik sildiga', () => {
    const { nodes } = radialLayout(applyFilters(NET, DEFAULT_FILTER), { w: 600, h: 600 });
    expect(nodes.every(n => n.labelled)).toBe(true);
  });
});

describe('timelineRows', () => {
  it('sama aasta teosed = üks liitmärk, tugevaim liik', () => {
    const v = applyFilters(NET, DEFAULT_FILTER);
    const a = timelineRows(v).rows.find(r => r.person.id === 'a')!;
    const y1658 = a.marks.find(m => m.year === 1658)!;
    expect(y1658.works).toEqual(['w1']);
    expect(y1658.kind).toBe('academic');
  });

  it('aastata teos ja pereserv → „Aeg teadmata" (year null), rida ei kao', () => {
    const net: PersonNetwork = {
      ...NET,
      persons: [P('d'), P('fam')],
      works: [W('w3', null)],
      edges: [E('cotext', 'd', 'w3', null),
              { kind: 'family', from: 'fam', to: F, directed: false, year: null, place: null, evidence: null,
                records: [{ source_id: F, target_id: 'fam', type: 'isa' }] }],
    };
    const t = timelineRows(applyFilters(net, DEFAULT_FILTER));
    expect(t.hasUndated).toBe(true);
    expect(t.rows.map(r => r.person.id).sort()).toEqual(['d', 'fam']);
    expect(t.rows.every(r => r.marks.every(m => m.year === null))).toBe(true);
    expect(t.minYear).toBeNull();
  });

  it('read järjestatud esimese aasta järgi, aastata read lõpus', () => {
    const net: PersonNetwork = { ...NET, persons: [...NET.persons, P('d')], works: [...NET.works],
      edges: [...NET.edges, E('cotext', 'd', 'w3', null)] };
    const ids = timelineRows(applyFilters(net, DEFAULT_FILTER)).rows.map(r => r.person.id);
    expect(ids[ids.length - 1]).toBe('d');
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('c'));
  });
});
```

- [ ] **Step 2: Käivita, veendu et kukub**

Run: `npx vitest run src/prosopography/utils/__tests__/network.test.ts`
Expected: FAIL (`radialLayout is not a function` / import error)

- [ ] **Step 3: Implementeeri** (lisa `utils/network.ts` lõppu)

```ts
export interface RadialNode { person: VisiblePerson; x: number; y: number; angle: number; r: number; labelled: boolean; }

const LABEL_ALL_MAX = 40;
const LABEL_TOP = 0.93;   // üle 40 isiku: sildid ülemisele ~7%-le (workCount järgi)

export function radialLayout(v: VisibleNetwork, size: { w: number; h: number }) {
  const cx = size.w / 2;
  const cy = size.h / 2;
  const many = v.persons.length > LABEL_ALL_MAX;
  const radius = Math.min(size.w, size.h) / 2 - (many ? 110 : 130);
  const sorted = [...v.persons].sort((a, b) =>
    rank(a.kind) - rank(b.kind)
    || (a.firstYear ?? 9999) - (b.firstYear ?? 9999)
    || a.label.localeCompare(b.label));
  const kinds = new Set(sorted.map(p => p.kind));
  const gap = 0.1;
  const span = 2 * Math.PI - gap * kinds.size;
  const step = span / Math.max(1, sorted.length);
  const maxCount = Math.max(1, ...sorted.map(p => p.workCount));
  const counts = sorted.map(p => p.workCount).sort((a, b) => a - b);
  const threshold = many ? Math.max(2, counts[Math.floor(LABEL_TOP * (counts.length - 1))]) : 0;
  let angle = -Math.PI / 2 + gap / 2;
  let prev: RelationKind | null = null;
  const nodes: RadialNode[] = sorted.map(person => {
    if (prev && person.kind !== prev) angle += gap;
    const a = angle + step / 2;
    angle += step;
    prev = person.kind;
    const r = 3.5 + Math.sqrt(person.workCount / maxCount) * (many ? 5.5 : 9.5);
    return { person, angle: a, r, x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a),
             labelled: !many || person.workCount >= threshold };
  });
  return { cx, cy, radius, nodes };
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
```

- [ ] **Step 4: Käivita**

Run: `npx vitest run src/prosopography/utils/__tests__/network.test.ts`
Expected: kõik läbivad

- [ ] **Step 5: Commit**

```bash
git add src/prosopography/utils/network.ts src/prosopography/utils/__tests__/network.test.ts
git commit -m "feat(prosopo): seoste võrgustiku ja ajatelje paigutus (#461)"
```

---

### Task 3: Liigi stiil, märgid ja hüpikaken

**Files:**
- Create: `src/prosopography/components/relations/kindStyle.ts`
- Create: `src/prosopography/components/relations/RelationPopover.tsx`
- Modify: `src/locales/et/prosopography.json`, `src/locales/en/prosopography.json`
- Test: `src/prosopography/components/relations/__tests__/RelationPopover.test.tsx`

**Interfaces:**
- Consumes: `VisibleNetwork`, `VisiblePerson`, `familyLabel`, `otherEnd` (Task 1)
- Produces:
  ```ts
  // kindStyle.ts
  export const KIND_COLOR: Record<RelationKind, string>;
  export function KindMark(props: { kind: RelationKind; r: number; x?: number; y?: number }): JSX.Element; // SVG <g>
  // RelationPopover.tsx
  export interface PopoverState { personId: string; x: number; y: number; pinned: boolean; }
  export function usePopover(): { state: PopoverState | null; hover(id: string, ev: React.MouseEvent): void;
    leave(): void; pin(id: string, ev: React.MouseEvent): void; close(): void };
  export default function RelationPopover(props: { state: PopoverState | null; net: VisibleNetwork; onClose(): void }): JSX.Element | null;
  ```

- [ ] **Step 1: Lisa i18n võtmed** mõlemasse faili, ülemise taseme objektina `"relations"`
  (paiguta `"map"` objekti järele):

`src/locales/et/prosopography.json`:
```json
  "relations": {
    "title": "Seosed",
    "tabs": { "graph": "Võrgustik", "timeline": "Ajatelg", "table": "Loend" },
    "kinds": {
      "academic": "Akadeemiline akt",
      "dedicated": "Teos isikule / isikust",
      "family": "Perekond / muu",
      "cotext": "Kaastekst",
      "mention": "Mainimine",
      "printer": "Trükkal"
    },
    "weak": "Nõrgad seosed",
    "onlyInCollection": "Ainult kogus: {{name}}",
    "empty": "Seoseid ei leitud.",
    "error": "Seoste laadimine ebaõnnestus.",
    "persons": "{{count}} seotud isikut",
    "sharedWorks": "{{count}} ühist teost",
    "pinHint": "Klõpsa, et kinnitada ja avada lingid",
    "openPerson": "Ava isikuleht",
    "close": "Sulge",
    "restricted": "kaitstud",
    "pages": "lk {{pages}}",
    "unknownPlace": "trükikoht teadmata",
    "originUnknown": "päritolu teadmata",
    "origin": "päritolu {{place}}",
    "undated": "Aeg teadmata",
    "coLines": "Kaaslaste jooned",
    "focusOnly": "Ainult fookus",
    "focus": "Fookus",
    "moreWorks": "… veel {{count}} teost",
    "labelsHint": "Nimed kuvatakse {{count}}-st ainult suurima seosega isikutele; hõljuta, et näha teisi.",
    "openMap": "Ava suurel kaardil",
    "table": { "person": "Isik", "years": "Eluaastad", "origin": "Päritolu", "kind": "Seos", "works": "Ühiseid teoseid", "span": "Aastad" }
  },
```

`src/locales/en/prosopography.json` (samad võtmed):
```json
  "relations": {
    "title": "Relations",
    "tabs": { "graph": "Network", "timeline": "Timeline", "table": "List" },
    "kinds": {
      "academic": "Academic act",
      "dedicated": "Work for / about the person",
      "family": "Family / other",
      "cotext": "Co-contribution",
      "mention": "Mention",
      "printer": "Printer"
    },
    "weak": "Weak relations",
    "onlyInCollection": "Only in: {{name}}",
    "empty": "No relations found.",
    "error": "Could not load relations.",
    "persons": "{{count}} related persons",
    "sharedWorks": "{{count}} shared works",
    "pinHint": "Click to pin and open links",
    "openPerson": "Open person page",
    "close": "Close",
    "restricted": "restricted",
    "pages": "p. {{pages}}",
    "unknownPlace": "place of printing unknown",
    "originUnknown": "origin unknown",
    "origin": "origin {{place}}",
    "undated": "Date unknown",
    "coLines": "Co-occurrence lines",
    "focusOnly": "Focus only",
    "focus": "Focus",
    "moreWorks": "… {{count}} more works",
    "labelsHint": "Of {{count}} persons, only the most connected are labelled; hover to see others.",
    "openMap": "Open on the large map",
    "table": { "person": "Person", "years": "Lifespan", "origin": "Origin", "kind": "Relation", "works": "Shared works", "span": "Years" }
  },
```

Rollide sildid tulevad olemasolevast `workspace:metadata.roles.*`-st (nagu vanas
`WorkRelationsCard`-is). Rollide `subject`, `mentioned` ja `publisher` jaoks kontrolli, kas
võti on olemas (`grep '"subject"\|"mentioned"\|"publisher"' src/locales/et/workspace.json`).
Kui mõni puudub, kasuta `t(\`workspace:metadata.roles.${r}\`, { defaultValue: r })`:
see töötab ilma uue võtmeta ega käivita `translationKeysResolve` valvurit, sest võti
on dünaamiline.

- [ ] **Step 2: Kirjuta failiv komponenditest**

```tsx
// src/prosopography/components/relations/__tests__/RelationPopover.test.tsx
/** @vitest-environment jsdom */
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import '../../../../i18n';
import RelationPopover, { usePopover } from '../RelationPopover';
import { applyFilters, DEFAULT_FILTER } from '../../../utils/network';
import type { PersonNetwork } from '../../../services/networkService';

const F = 'vutt:Pfocus';
const NET: PersonNetwork = {
  focus: { id: F, label: 'Johann Fischer', birth_year: 1636, death_year: 1705, origin: null },
  persons: [{ id: 'vutt:Ps', label: 'Johann Leonhard Schwäger', birth_year: null, death_year: null, origin: null }],
  works: [
    { work_id: 'jy30do', title: 'Legitimum Certamen', year: 1659, place: { id: 'Q1', label: 'Altdorf', coordinates: null }, genres: [], restricted: false },
    { work_id: 'sal', title: 'Salajane teos', year: 1660, place: null, genres: [], restricted: true },
  ],
  edges: [
    { kind: 'dedicated', from: 'vutt:Ps', to: F, directed: true, year: 1659, place: null,
      roles: { 'vutt:Ps': ['auctor'], [F]: ['subject'] }, evidence: { work_id: 'jy30do', pages: [] } },
    { kind: 'mention', from: 'vutt:Ps', to: F, directed: false, year: 1660, place: null,
      roles: { 'vutt:Ps': ['praeses'], [F]: ['mentioned'] }, evidence: { work_id: 'sal', pages: [2] } },
  ],
};

function renderPopover(pinned: boolean) {
  const net = applyFilters(NET, DEFAULT_FILTER);
  return render(
    <MemoryRouter>
      <RelationPopover state={{ personId: 'vutt:Ps', x: 10, y: 10, pinned }} net={net} onClose={() => {}} />
    </MemoryRouter>,
  );
}

describe('RelationPopover', () => {
  it('rollid nimedega, mitte „tema/fookus"', () => {
    renderPopover(false);
    expect(screen.getAllByText(/Schwäger/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Fischer:/)).toBeTruthy();
  });

  it('hõljutusel linke ei ole, kinnitatult on isikuleht ja teos', () => {
    const { unmount } = renderPopover(false);
    expect(screen.queryByRole('link')).toBeNull();
    unmount();
    renderPopover(true);
    const hrefs = screen.getAllByRole('link').map(a => a.getAttribute('href'));
    expect(hrefs).toContain('/persons/vutt:Ps');
    expect(hrefs).toContain('/work/jy30do/1');
  });

  it('piiratud teos: lingita, märkega kaitstud; lehekülg näidatud', () => {
    renderPopover(true);
    const hrefs = screen.getAllByRole('link').map(a => a.getAttribute('href'));
    expect(hrefs.some(h => h?.includes('/work/sal'))).toBe(false);
    expect(screen.getByText(/kaitstud/)).toBeTruthy();
    expect(screen.getByText(/lk 2/)).toBeTruthy();
  });
});

describe('usePopover', () => {
  const ev = { clientX: 5, clientY: 6, stopPropagation() {} } as unknown as React.MouseEvent;

  it('kinnitatud hüpik ei muutu hõljutusel ega kao lahkumisel; Esc sulgeb', () => {
    const { result } = renderHook(() => usePopover());
    act(() => result.current.pin('a', ev));
    act(() => result.current.hover('b', ev));
    act(() => result.current.leave());
    expect(result.current.state).toMatchObject({ personId: 'a', pinned: true });
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(result.current.state).toBeNull();
  });
});
```

Kui `import '../../../../i18n'` ei initsialiseeri teste (vaata, kuidas teised
komponenditestid i18n-i laevad, nt `PersonAddPanel.test.tsx`), kasuta sama mustrit. Ära
mocki `useTranslation`-it, sest test kontrollib tegelikke silte.

- [ ] **Step 3: Käivita, veendu et kukub**

Run: `npx vitest run src/prosopography/components/relations`
Expected: FAIL (moodul puudub)

- [ ] **Step 4: Implementeeri** `kindStyle.ts`

```tsx
// src/prosopography/components/relations/kindStyle.ts
/**
 * Seose liigi värv ja kuju (#461, spekk „Palett"). Kolm tugevat liiki on valideeritud
 * paletist (3 slotti „all-pairs" vormidele); nõrgad on hallid ja eristuvad kujuga.
 * Värv ei ole kunagi ainus tunnus.
 */
import { createElement } from 'react';
import type { RelationKind } from '../../services/networkService';

export const KIND_COLOR: Record<RelationKind, string> = {
  academic: '#2a78d6',
  dedicated: '#eb6834',
  family: '#1baf7a',
  cotext: '#8a939d',
  mention: '#8a939d',
  printer: '#8a939d',
};

export function KindMark({ kind, r, x = 0, y = 0 }: { kind: RelationKind; r: number; x?: number; y?: number }) {
  const fill = KIND_COLOR[kind];
  const t = `translate(${x},${y})`;
  switch (kind) {
    case 'academic':
      return createElement('circle', { transform: t, r, fill, stroke: '#fff', strokeWidth: 1.5 });
    case 'dedicated':
      return createElement('rect', { transform: t, x: -r * 0.9, y: -r * 0.9, width: r * 1.8, height: r * 1.8, rx: 1.5, fill, stroke: '#fff', strokeWidth: 1.5 });
    case 'family':
      return createElement('path', { transform: t, d: `M0 ${-r * 1.2} ${r * 1.2} 0 0 ${r * 1.2} ${-r * 1.2} 0Z`, fill, stroke: '#fff', strokeWidth: 1.5 });
    case 'cotext':
      return createElement('circle', { transform: t, r: r * 0.8, fill });
    case 'mention':
      return createElement('circle', { transform: t, r: r * 0.75, fill: '#fff', stroke: fill, strokeWidth: 1.8 });
    default:
      return createElement('path', { transform: t, d: `M0 ${-r} ${r * 0.95} ${r * 0.75} ${-r * 0.95} ${r * 0.75}Z`, fill });
  }
}
```

(Fail on `.ts`, sest JSX-i asemel kasutatakse `createElement`-i. Kui eelistad JSX-i, nimeta
fail `kindStyle.tsx` ja uuenda impordid. Vali üks ja pea sellest kinni.)

- [ ] **Step 5: Implementeeri** `RelationPopover.tsx`

```tsx
// src/prosopography/components/relations/RelationPopover.tsx
/**
 * Ühine hüpikaken seoste vaadetele (#461): hõljutus näitab lühivaadet, klikk kinnitab
 * (lingid isiku- ja teoselehele). Sulgub nupuga, klikiga mujale või Esc-iga.
 * z-[1300]: päis on z-[1200] (CLAUDE.md).
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { VisibleNetwork } from '../../utils/network';
import { familyLabel } from '../../utils/network';

export interface PopoverState { personId: string; x: number; y: number; pinned: boolean; }

export function usePopover() {
  const [state, setState] = useState<PopoverState | null>(null);
  const pinnedRef = useRef(false);
  const hover = useCallback((personId: string, ev: React.MouseEvent) => {
    if (pinnedRef.current) return;
    setState({ personId, x: ev.clientX, y: ev.clientY, pinned: false });
  }, []);
  const leave = useCallback(() => { if (!pinnedRef.current) setState(null); }, []);
  const pin = useCallback((personId: string, ev: React.MouseEvent) => {
    ev.stopPropagation();
    pinnedRef.current = true;
    setState({ personId, x: ev.clientX, y: ev.clientY, pinned: true });
  }, []);
  const close = useCallback(() => { pinnedRef.current = false; setState(null); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onClick = (e: MouseEvent) => {
      if (pinnedRef.current && !(e.target as Element | null)?.closest?.('[data-relation-popover]')) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('click', onClick); };
  }, [close]);
  return { state, hover, leave, pin, close };
}

const surname = (n: string) => n.trim().split(/\s+/).pop() ?? n;
const MAX_HOVER_WORKS = 4;

const RelationPopover: React.FC<{ state: PopoverState | null; net: VisibleNetwork; onClose: () => void }> = ({ state, net, onClose }) => {
  const { t } = useTranslation(['prosopography', 'workspace']);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!state || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let left = state.x + 14;
    let top = state.y + 14;
    if (left + r.width > window.innerWidth - 8) left = state.x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = state.y - r.height - 14;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [state]);

  if (!state) return null;
  const p = net.persons.find(x => x.id === state.personId);
  if (!p) return null;
  const labelOf = (id: string) => (id === net.focus.id ? net.focus.label : net.persons.find(x => x.id === id)?.label ?? id);
  const roles = (rs?: string[]) => (rs ?? []).map(r => t(`workspace:metadata.roles.${r}`, { defaultValue: r })).join(', ');
  const workEdges = p.edges.filter(e => e.evidence).sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
  const shown = state.pinned ? workEdges : workEdges.slice(0, MAX_HOVER_WORKS);
  const fam = p.edges.find(e => e.kind === 'family');
  const years = p.birth_year || p.death_year ? `${p.birth_year ?? '?'}–${p.death_year ?? '?'}` : '';

  return (
    <div
      ref={ref}
      data-relation-popover
      role={state.pinned ? 'dialog' : 'tooltip'}
      className={`fixed z-[1300] max-w-sm rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg ${state.pinned ? 'max-h-[70vh] overflow-auto' : 'pointer-events-none'}`}
      style={pos}
    >
      <div className="text-sm font-semibold text-gray-900">{p.label}</div>
      <div className="text-gray-500">
        {years}{years ? ' · ' : ''}
        {p.origin?.place ? t('relations.origin', { place: p.origin.place }) : t('relations.originUnknown')}
      </div>
      <div className="text-gray-500">
        {t(`relations.kinds.${p.kind}`)} · {t('relations.sharedWorks', { count: p.workCount })}
      </div>
      {fam && familyLabel(fam, net.focus.id, labelOf) && (
        <div className="mt-1 text-gray-700">{familyLabel(fam, net.focus.id, labelOf)}</div>
      )}
      {shown.length > 0 && (
        <ul className="mt-2 space-y-1.5 pl-3 list-disc">
          {shown.map((e, i) => {
            const w = net.works.get(e.evidence!.work_id);
            const page = e.evidence!.pages[0] ?? 1;
            const title = w?.title ? (w.title.length > 90 ? `${w.title.slice(0, 89)}…` : w.title) : e.evidence!.work_id;
            return (
              <li key={`${e.evidence!.work_id}-${i}`}>
                <span className="text-gray-500">
                  {w?.year ?? '?'} · {w?.place?.label ?? t('relations.unknownPlace')} · {t(`relations.kinds.${e.kind}`)}
                </span>
                <div className="text-gray-700">
                  <b>{surname(p.label)}:</b> {roles(e.roles?.[p.id])} · <b>{surname(net.focus.label)}:</b> {roles(e.roles?.[net.focus.id])}
                </div>
                <div>
                  {state.pinned && w && !w.restricted
                    ? <Link to={`/work/${w.work_id}/${page}`} className="text-primary-700 hover:underline">{title}</Link>
                    : <span className="text-gray-500">{title}</span>}
                  {w?.restricted && <span className="ml-1 text-gray-400">({t('relations.restricted')})</span>}
                  {e.evidence!.pages.length > 0 && (
                    <span className="ml-1 text-gray-400">({t('relations.pages', { pages: e.evidence!.pages.join(', ') })})</span>
                  )}
                </div>
              </li>
            );
          })}
          {!state.pinned && workEdges.length > MAX_HOVER_WORKS && (
            <li className="list-none text-gray-400">{t('relations.moreWorks', { count: workEdges.length - MAX_HOVER_WORKS })}</li>
          )}
        </ul>
      )}
      {state.pinned ? (
        <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
          <Link to={`/persons/${p.id}`} className="text-primary-700 hover:underline">{t('relations.openPerson')} ↗</Link>
          <button type="button" onClick={onClose} className="flex items-center gap-1 text-gray-500 hover:text-gray-800">
            <X size={12} /> {t('relations.close')}
          </button>
        </div>
      ) : (
        <div className="mt-2 text-gray-400">{t('relations.pinHint')}</div>
      )}
    </div>
  );
};

export default RelationPopover;
```

- [ ] **Step 6: Käivita**

Run: `npx vitest run src/prosopography/components/relations src/locales`
Expected: kõik läbivad (sh `localeParity`, `translationKeysResolve`)

- [ ] **Step 7: Commit**

```bash
git add src/prosopography/components/relations src/locales
git commit -m "feat(prosopo): seoste liigi märgid ja kinnitatav hüpikaken (#461)"
```

---

### Task 4: Võrgustik, ajatelg ja loend

**Files:**
- Create: `src/prosopography/components/relations/RelationsGraph.tsx`
- Create: `src/prosopography/components/relations/RelationsTimeline.tsx`
- Create: `src/prosopography/components/relations/RelationsTable.tsx`
- Test: `src/prosopography/components/relations/__tests__/RelationsViews.test.tsx`

**Interfaces:**
- Consumes: `radialLayout`, `timelineRows`, `coEdges` (Task 1-2); `KindMark`, `KIND_COLOR`, `usePopover` (Task 3)
- Produces: kolm komponenti, igaüks props'idega
  `{ net: VisibleNetwork; popover: ReturnType<typeof usePopover>; highlight: string | null; onHighlight(id: string | null): void }`.
  `RelationsTable` võtab ainult `{ net }`.

- [ ] **Step 1: Kirjuta failivad testid**

```tsx
// src/prosopography/components/relations/__tests__/RelationsViews.test.tsx
/** @vitest-environment jsdom */
import { render, screen, fireEvent, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import '../../../../i18n';
import RelationsGraph from '../RelationsGraph';
import RelationsTimeline from '../RelationsTimeline';
import RelationsTable from '../RelationsTable';
import { usePopover } from '../RelationPopover';
import { applyFilters, DEFAULT_FILTER } from '../../../utils/network';
import type { PersonNetwork } from '../../../services/networkService';

const F = 'vutt:Pfocus';
const NET: PersonNetwork = {
  focus: { id: F, label: 'Fookus Isik', birth_year: 1636, death_year: 1705, origin: null },
  persons: [
    { id: 'a', label: 'Anna Praeses', birth_year: 1600, death_year: 1660, origin: { place: 'Riga', place_id: null, coordinates: null } },
    { id: 'u', label: 'Undated Isik', birth_year: null, death_year: null, origin: null },
  ],
  works: [{ work_id: 'w1', title: 'Disputatio', year: 1658, place: null, genres: [], restricted: false },
          { work_id: 'w2', title: 'Aastata', year: null, place: null, genres: [], restricted: false }],
  edges: [
    { kind: 'academic', from: 'a', to: F, directed: true, year: 1658, place: null, roles: { a: ['praeses'], [F]: ['respondens'] }, evidence: { work_id: 'w1', pages: [] } },
    { kind: 'cotext', from: 'u', to: F, directed: false, year: null, place: null, roles: { u: ['gratulator'], [F]: ['gratulator'] }, evidence: { work_id: 'w2', pages: [] } },
  ],
};
const v = applyFilters(NET, DEFAULT_FILTER);

function withPopover(ui: (p: ReturnType<typeof usePopover>) => React.ReactElement) {
  const { result } = renderHook(() => usePopover());
  return render(<MemoryRouter>{ui(result.current)}</MemoryRouter>);
}

describe('RelationsGraph', () => {
  it('fookus keskel sildiga, seotud isikud nimedega', () => {
    withPopover(p => <RelationsGraph net={v} popover={p} highlight={null} onHighlight={() => {}} />);
    expect(screen.getByText('Fookus Isik')).toBeTruthy();
    expect(screen.getByText('Anna Praeses')).toBeTruthy();
  });

  it('hõljutus teatab esiletõstu', () => {
    const onHighlight = vi.fn();
    withPopover(p => <RelationsGraph net={v} popover={p} highlight={null} onHighlight={onHighlight} />);
    fireEvent.mouseEnter(screen.getByTestId('node-a'));
    expect(onHighlight).toHaveBeenCalledWith('a');
  });
});

describe('RelationsTimeline', () => {
  it('aastata isik on „Aeg teadmata" veerus', () => {
    withPopover(p => <RelationsTimeline net={v} popover={p} highlight={null} onHighlight={() => {}} />);
    expect(screen.getByText('Aeg teadmata')).toBeTruthy();
    expect(screen.getByText('Undated Isik')).toBeTruthy();
  });
});

describe('RelationsTable', () => {
  it('rida isiku kohta, liik sõnaga, lingiga isikulehele', () => {
    render(<MemoryRouter><RelationsTable net={v} /></MemoryRouter>);
    expect(screen.getByText('Akadeemiline akt')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Anna Praeses' }).getAttribute('href')).toBe('/persons/a');
  });
});
```

- [ ] **Step 2: Käivita, veendu et kukub**

Run: `npx vitest run src/prosopography/components/relations/__tests__/RelationsViews.test.tsx`
Expected: FAIL (moodulid puuduvad)

- [ ] **Step 3: Implementeeri** `RelationsGraph.tsx`

```tsx
// src/prosopography/components/relations/RelationsGraph.tsx
/**
 * Radiaalne ego-võrgustik (#461, „Kes kellega"): fookus keskel, seotud isikud ringil
 * liigi ja esimese aasta järgi. Joone jämedus ja sõlme suurus = unikaalsed ühised teosed.
 * Hallid kaared = isikud, kes esinevad omavahel samas teoses (lülitatav).
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VisibleNetwork } from '../../utils/network';
import { coEdges, radialLayout, STRONG } from '../../utils/network';
import { KIND_COLOR, KindMark } from './kindStyle';
import type { usePopover } from './RelationPopover';

interface Props {
  net: VisibleNetwork;
  popover: ReturnType<typeof usePopover>;
  highlight: string | null;
  onHighlight: (id: string | null) => void;
}

const RelationsGraph: React.FC<Props> = ({ net, popover, highlight, onHighlight }) => {
  const { t } = useTranslation(['prosopography']);
  const [showCo, setShowCo] = useState(true);
  const many = net.persons.length > 40;
  const size = { w: 900, h: many ? 760 : 600 };
  const layout = useMemo(() => radialLayout(net, size), [net, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const pos = useMemo(() => new Map(layout.nodes.map(n => [n.person.id, n])), [layout]);
  const co = useMemo(() => (showCo ? coEdges(net) : []), [net, showCo]);
  const maxW = Math.max(1, ...net.persons.map(p => p.workCount));
  const dim = (ids: string[]) => (highlight && !ids.includes(highlight) ? 0.12 : 1);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <div className="inline-flex overflow-hidden rounded border border-gray-200 text-xs">
          <button type="button" onClick={() => setShowCo(true)} aria-pressed={showCo}
            className={`px-2.5 py-1 ${showCo ? 'bg-gray-800 text-white' : 'bg-white text-gray-600'}`}>{t('relations.coLines')}</button>
          <button type="button" onClick={() => setShowCo(false)} aria-pressed={!showCo}
            className={`border-l border-gray-200 px-2.5 py-1 ${!showCo ? 'bg-gray-800 text-white' : 'bg-white text-gray-600'}`}>{t('relations.focusOnly')}</button>
        </div>
      </div>
      <svg viewBox={`0 0 ${size.w} ${size.h}`} className="h-auto w-full" role="img"
        aria-label={`${net.focus.label}: ${t('relations.persons', { count: net.persons.length })}`}>
        <g fill="none">
          {co.map(c => {
            const a = pos.get(c.a); const b = pos.get(c.b);
            if (!a || !b) return null;
            const mx = layout.cx + (a.x + b.x - 2 * layout.cx) * 0.25;
            const my = layout.cy + (a.y + b.y - 2 * layout.cy) * 0.25;
            return <path key={`${c.a}|${c.b}`} d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`}
              stroke="#9aa3ad" strokeOpacity={(many ? 0.22 : 0.45) * dim([c.a, c.b])} strokeWidth={Math.min(3, 0.8 + c.weight * 0.4)} />;
          })}
        </g>
        <g>
          {layout.nodes.map(n => (
            <line key={n.person.id} x1={layout.cx} y1={layout.cy} x2={n.x} y2={n.y}
              stroke={KIND_COLOR[n.person.kind]} strokeOpacity={(STRONG.has(n.person.kind) ? 0.55 : 0.3) * dim([n.person.id])}
              strokeWidth={1 + (n.person.workCount / maxW) * 4}
              strokeDasharray={n.person.kind === 'family' ? '4 3' : n.person.kind === 'mention' ? '2 3' : undefined} />
          ))}
        </g>
        <g>
          {layout.nodes.map(n => {
            const flip = Math.cos(n.angle) < 0;
            const deg = (n.angle * 180) / Math.PI;
            return (
              <g key={n.person.id} data-testid={`node-${n.person.id}`} style={{ cursor: 'pointer', opacity: dim([n.person.id]) }}
                onMouseEnter={e => { onHighlight(n.person.id); popover.hover(n.person.id, e); }}
                onMouseMove={e => popover.hover(n.person.id, e)}
                onMouseLeave={() => { onHighlight(null); popover.leave(); }}
                onClick={e => { onHighlight(n.person.id); popover.pin(n.person.id, e); }}>
                <circle cx={n.x} cy={n.y} r={14} fill="transparent" />
                <KindMark kind={n.person.kind} r={n.r} x={n.x} y={n.y} />
                {n.labelled && (
                  <text x={n.x} y={n.y} dy="0.32em" fontSize={many ? 10 : 11.5} fill="#4f5761"
                    textAnchor={flip ? 'end' : 'start'}
                    transform={`rotate(${flip ? deg + 180 : deg} ${n.x} ${n.y}) translate(${flip ? -(n.r + 6) : n.r + 6},0)`}>
                    {n.person.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
        <g transform={`translate(${layout.cx},${layout.cy})`}>
          <circle r={15} fill="#fff" stroke="#1d2126" strokeWidth={2} />
          <circle r={9} fill="#1d2126" />
          <text y={-24} textAnchor="middle" fontSize={14} fontWeight={600} fill="#1d2126"
            stroke="#fff" strokeWidth={5} paintOrder="stroke">{net.focus.label}</text>
          <text y={30} textAnchor="middle" fontSize={9.5} letterSpacing="0.1em" fill="#7a838e"
            stroke="#fff" strokeWidth={4} paintOrder="stroke">{t('relations.focus').toUpperCase()}</text>
        </g>
      </svg>
      {many && <p className="text-xs text-gray-500">{t('relations.labelsHint', { count: net.persons.length })}</p>}
    </div>
  );
};

export default RelationsGraph;
```

- [ ] **Step 4: Implementeeri** `RelationsTimeline.tsx`

```tsx
// src/prosopography/components/relations/RelationsTimeline.tsx
/**
 * Ajatelg (#461, „Millal ja mis rollis"): rida isiku kohta, märk aasta kohal.
 * Sama aasta teosed = üks liitmärk arvuga; aastata servad „Aeg teadmata" veerus.
 * Pikk loend keritakse oma konteineris (spekk lubab erandi „kerib aken" reeglist).
 */
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { VisibleNetwork } from '../../utils/network';
import { timelineRows } from '../../utils/network';
import { KindMark } from './kindStyle';
import type { usePopover } from './RelationPopover';

interface Props {
  net: VisibleNetwork;
  popover: ReturnType<typeof usePopover>;
  highlight: string | null;
  onHighlight: (id: string | null) => void;
}

const W = 900;
const LEFT = 190;
const UNDATED_W = 90;
const ROW = 18;

const RelationsTimeline: React.FC<Props> = ({ net, popover, highlight, onHighlight }) => {
  const { t } = useTranslation(['prosopography']);
  const { rows, minYear, maxYear, hasUndated } = useMemo(() => timelineRows(net), [net]);
  const right = W - 16 - (hasUndated ? UNDATED_W : 0);
  const y0 = (minYear ?? 0) - 1;
  const y1 = (maxYear ?? 0) + 1;
  const x = (y: number) => LEFT + ((y - y0) / Math.max(1, y1 - y0)) * (right - LEFT);
  const step = Math.max(1, Math.ceil((y1 - y0) / 10));
  const ticks = minYear === null ? [] : Array.from({ length: Math.floor((y1 - y0) / step) + 1 }, (_, i) => y0 + i * step);
  const undatedX = right + UNDATED_W / 2;
  const H = rows.length * ROW + 8;

  return (
    <div>
      <svg viewBox={`0 0 ${W} 26`} className="h-auto w-full" aria-hidden="true">
        {ticks.map(tk => <text key={tk} x={x(tk)} y={16} textAnchor="middle" fontSize={11} fill="#4f5761">{tk}</text>)}
        {hasUndated && <text x={undatedX} y={16} textAnchor="middle" fontSize={11} fill="#4f5761">{t('relations.undated')}</text>}
      </svg>
      <div className="max-h-[540px] overflow-auto border-t border-gray-100">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t('relations.tabs.timeline')}>
          {ticks.map(tk => <line key={tk} x1={x(tk)} x2={x(tk)} y1={0} y2={H} stroke="#eceef1" />)}
          {hasUndated && <line x1={right + 4} x2={right + 4} y1={0} y2={H} stroke="#dde1e5" strokeDasharray="3 3" />}
          {rows.map((row, i) => {
            const y = i * ROW + ROW / 2 + 4;
            const id = row.person.id;
            const dated = row.marks.filter(m => m.year !== null).map(m => m.year as number);
            return (
              <g key={id} style={{ cursor: 'pointer', opacity: highlight && highlight !== id ? 0.15 : 1 }}
                onMouseEnter={e => { onHighlight(id); popover.hover(id, e); }}
                onMouseMove={e => popover.hover(id, e)}
                onMouseLeave={() => { onHighlight(null); popover.leave(); }}
                onClick={e => { onHighlight(id); popover.pin(id, e); }}>
                <rect x={0} y={y - ROW / 2} width={W} height={ROW} fill="transparent" />
                <text x={LEFT - 12} y={y} dy="0.32em" textAnchor="end" fontSize={11} fill="#4f5761">
                  {row.person.label.length > 28 ? `${row.person.label.slice(0, 27)}…` : row.person.label}
                </text>
                {dated.length > 1 && (
                  <line x1={x(Math.min(...dated))} x2={x(Math.max(...dated))} y1={y} y2={y} stroke="#dde1e5" strokeWidth={2} />
                )}
                {row.marks.map(m => {
                  const mx = m.year === null ? undatedX : x(m.year);
                  return (
                    <g key={String(m.year)}>
                      <KindMark kind={m.kind} r={m.works.length > 1 ? 5.5 : 4.2} x={mx} y={y} />
                      {m.works.length > 1 && (
                        <text x={mx + 8} y={y} dy="0.32em" fontSize={9.5} fill="#4f5761">{m.works.length}</text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

export default RelationsTimeline;
```

- [ ] **Step 5: Implementeeri** `RelationsTable.tsx`

```tsx
// src/prosopography/components/relations/RelationsTable.tsx
/** Seosed tabelina (#461): tekstivaade diagrammidele, ühtlasi ligipääsetav alternatiiv. */
import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { VisibleNetwork } from '../../utils/network';

const RelationsTable: React.FC<{ net: VisibleNetwork }> = ({ net }) => {
  const { t } = useTranslation(['prosopography']);
  const rows = [...net.persons].sort((a, b) => (a.firstYear ?? 9999) - (b.firstYear ?? 9999) || a.label.localeCompare(b.label));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="py-1.5 pr-3 font-semibold">{t('relations.table.person')}</th>
            <th className="py-1.5 pr-3 font-semibold">{t('relations.table.years')}</th>
            <th className="py-1.5 pr-3 font-semibold">{t('relations.table.origin')}</th>
            <th className="py-1.5 pr-3 font-semibold">{t('relations.table.kind')}</th>
            <th className="py-1.5 pr-3 font-semibold">{t('relations.table.works')}</th>
            <th className="py-1.5 font-semibold">{t('relations.table.span')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const ys = p.edges.map(e => e.year).filter((y): y is number => typeof y === 'number');
            const span = ys.length ? (Math.min(...ys) === Math.max(...ys) ? `${ys[0]}` : `${Math.min(...ys)}–${Math.max(...ys)}`) : '—';
            return (
              <tr key={p.id} className="border-b border-gray-100 align-top">
                <td className="py-1.5 pr-3"><Link to={`/persons/${p.id}`} className="text-primary-700 hover:underline">{p.label}</Link></td>
                <td className="py-1.5 pr-3 tabular-nums">{p.birth_year || p.death_year ? `${p.birth_year ?? '?'}–${p.death_year ?? '?'}` : '—'}</td>
                <td className="py-1.5 pr-3">{p.origin?.place ?? '—'}</td>
                <td className="py-1.5 pr-3">{t(`relations.kinds.${p.kind}`)}</td>
                <td className="py-1.5 pr-3 tabular-nums">{p.workCount}</td>
                <td className="py-1.5 tabular-nums">{span}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default RelationsTable;
```

- [ ] **Step 6: Käivita**

Run: `npx vitest run src/prosopography/components/relations`
Expected: kõik läbivad

- [ ] **Step 7: Commit**

```bash
git add src/prosopography/components/relations
git commit -m "feat(prosopo): seoste võrgustik, ajatelg ja loend (#461)"
```

---

### Task 5: Sektsioon isikulehel

**Files:**
- Create: `src/prosopography/components/relations/PersonRelations.tsx`
- Modify: `src/prosopography/pages/PersonDetailPage.tsx` (import rida 25, kasutus rida ~796, `relationMapUrl` rida ~445)
- Delete: `src/prosopography/components/WorkRelationsCard.tsx`; eemalda `fetchWorkRelations`, `WorkRelation`, `WorkRelationWork` failist `prosopographyService.ts` (kontrolli enne `grep -rn "fetchWorkRelations\|WorkRelation\b" src`)
- Test: `src/prosopography/components/relations/__tests__/PersonRelations.test.tsx`

**Interfaces:**
- Consumes: kõik eelnev
- Produces: `export default function PersonRelations(props: { personId: string }): JSX.Element | null`

- [ ] **Step 1: Kirjuta failivad testid**

```tsx
// src/prosopography/components/relations/__tests__/PersonRelations.test.tsx
/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../../../../i18n';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('../../../services/networkService', async (orig) => ({
  ...(await orig<typeof import('../../../services/networkService')>()),
  fetchPersonNetwork: fetchMock,
}));
vi.mock('../../../../contexts/CollectionContext', () => ({
  useCollection: () => ({ selectedCollection: 'agc', getCollectionName: () => 'Rootsi aja ülikool' }),
}));

import PersonRelations from '../PersonRelations';

const F = 'vutt:Pfocus';
const net = (edges: unknown[], persons: unknown[]) => ({
  focus: { id: F, label: 'Fookus', birth_year: null, death_year: null, origin: null },
  persons, works: [{ work_id: 'w1', title: 'Disp', year: 1658, place: null, genres: [], restricted: false }], edges,
});
const A = { id: 'a', label: 'Anna', birth_year: null, death_year: null, origin: null };
const T = { id: 't', label: 'Trükkal', birth_year: null, death_year: null, origin: null };
const acad = { kind: 'academic', from: 'a', to: F, directed: true, year: 1658, place: null, roles: {}, evidence: { work_id: 'w1', pages: [] } };
const prn = { kind: 'printer', from: 't', to: F, directed: false, year: 1658, place: null, roles: {}, evidence: { work_id: 'w1', pages: [] } };

const renderIt = (id = F) => render(<MemoryRouter><PersonRelations personId={id} /></MemoryRouter>);

beforeEach(() => fetchMock.mockReset());

describe('PersonRelations', () => {
  it('näitab vahekaarte ja võrgustikku', async () => {
    fetchMock.mockResolvedValue(net([acad], [A]));
    renderIt();
    expect(await screen.findByRole('tab', { name: 'Võrgustik' })).toBeTruthy();
    expect(screen.getByText('Anna')).toBeTruthy();
  });

  it('seosteta isik: üks rida, vahekaarte ei ole', async () => {
    fetchMock.mockResolvedValue(net([], []));
    renderIt();
    expect(await screen.findByText('Seoseid ei leitud.')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('ainult trükkalid (vaikimisi peidus): tühi olek, trükkalifilter toob tagasi', async () => {
    fetchMock.mockResolvedValue(net([prn], [T]));
    renderIt();
    expect(await screen.findByText('Seoseid ei leitud.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Trükkal'));
    expect(await screen.findByText('Trükkal', { selector: 'text' })).toBeTruthy();
  });

  it('viga: teade, leht ei kuku', async () => {
    fetchMock.mockRejectedValue(new Error('500'));
    renderIt();
    expect(await screen.findByText('Seoste laadimine ebaõnnestus.')).toBeTruthy();
  });

  it('vana vastus ei kirjuta uut isikut üle', async () => {
    let resolveOld: (v: unknown) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise(r => { resolveOld = r; }))
             .mockResolvedValueOnce(net([acad], [A]));
    const { rerender } = renderIt('vutt:Pold');
    rerender(<MemoryRouter><PersonRelations personId={F} /></MemoryRouter>);
    expect(await screen.findByText('Anna')).toBeTruthy();
    resolveOld(net([], []));
    await waitFor(() => expect(screen.getByText('Anna')).toBeTruthy());
  });

  it('kogu lüliti küsib uuesti collection-parameetriga', async () => {
    fetchMock.mockResolvedValue(net([acad], [A]));
    renderIt();
    await screen.findByText('Anna');
    fireEvent.click(screen.getByLabelText('Ainult kogus: Rootsi aja ülikool'));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(F, 'agc'));
  });
});
```

Kontrolli `useCollection` tagastatavaid nimesid (`src/contexts/CollectionContext.tsx`) ja
`getCollectionName` signatuuri (`(id, lang)`). Mock peab tagastama sama kuju.

- [ ] **Step 2: Käivita, veendu et kukub**

Run: `npx vitest run src/prosopography/components/relations/__tests__/PersonRelations.test.tsx`
Expected: FAIL (moodul puudub)

- [ ] **Step 3: Implementeeri** `PersonRelations.tsx`

```tsx
// src/prosopography/components/relations/PersonRelations.tsx
/**
 * Isikulehe „Seosed" sektsioon (#461): üks päring GET /prosopography/{id}/network,
 * kolm vaadet (Võrgustik · Ajatelg · Loend), ühised filtrid, esiletõst ja hüpikaken.
 * Kogu lüliti: vaikimisi kogu ei piira (sama mis #460 seoste kaart).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Waypoints, Map as MapIcon } from 'lucide-react';
import { useCollection } from '../../../contexts/CollectionContext';
import { fetchPersonNetwork, type PersonNetwork } from '../../services/networkService';
import { applyFilters, DEFAULT_FILTER, KIND_ORDER, type KindFilter } from '../../utils/network';
import { KindMark } from './kindStyle';
import RelationPopover, { usePopover } from './RelationPopover';
import RelationsGraph from './RelationsGraph';
import RelationsTimeline from './RelationsTimeline';
import RelationsTable from './RelationsTable';

type Tab = 'graph' | 'timeline' | 'table';
const TABS: Tab[] = ['graph', 'timeline', 'table'];

const PersonRelations: React.FC<{ personId: string }> = ({ personId }) => {
  const { t, i18n } = useTranslation(['prosopography']);
  const { selectedCollection, getCollectionName } = useCollection();
  const [data, setData] = useState<PersonNetwork | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<KindFilter>(DEFAULT_FILTER);
  const [scoped, setScoped] = useState(false);
  const [tab, setTab] = useState<Tab>('graph');
  const [highlight, setHighlight] = useState<string | null>(null);
  const popover = usePopover();
  const collection = scoped ? selectedCollection : null;

  useEffect(() => {
    let cancelled = false;          // vana vastus ei kirjuta uue isiku oma üle
    setError(false);
    setData(null);
    fetchPersonNetwork(personId, collection)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [personId, collection]);

  // Isiku vahetus: hüpik ja esiletõst ei tohi üle kanduda (remount ei lähtesta — sama komponent).
  useEffect(() => { popover.close(); setHighlight(null); }, [personId]); // eslint-disable-line react-hooks/exhaustive-deps

  const net = useMemo(() => (data ? applyFilters(data, filter) : null), [data, filter]);

  if (error) return <Section><p className="text-sm text-red-600">{t('relations.error')}</p></Section>;
  if (!net) return null;

  const lang = i18n.language === 'en' ? 'en' : 'et';
  const mapUrl = `/persons?view=map&related_to=${encodeURIComponent(personId)}`
    + (scoped && selectedCollection ? '&related_scope=collection' : '');

  const filters = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
      {KIND_ORDER.map(k => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <svg width={14} height={14} aria-hidden="true"><KindMark kind={k} r={5} x={7} y={7} /></svg>
          {k === 'cotext' || k === 'mention' || k === 'printer' ? (
            <label className="inline-flex cursor-pointer items-center gap-1">
              <input type="checkbox" checked={filter[k]} onChange={e => setFilter(f => ({ ...f, [k]: e.target.checked }))}
                aria-label={t(`relations.kinds.${k}`)} />
              {t(`relations.kinds.${k}`)}
            </label>
          ) : t(`relations.kinds.${k}`)}
        </span>
      ))}
      {selectedCollection && (
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={scoped} onChange={() => setScoped(s => !s)}
            aria-label={t('relations.onlyInCollection', { name: getCollectionName(selectedCollection, lang) })} />
          {t('relations.onlyInCollection', { name: getCollectionName(selectedCollection, lang) })}
        </label>
      )}
    </div>
  );

  if (net.persons.length === 0) {
    return <Section mapUrl={mapUrl}>{filters}<p className="mt-3 text-sm text-gray-500">{t('relations.empty')}</p></Section>;
  }

  return (
    <Section mapUrl={mapUrl} count={net.persons.length}>
      {filters}
      <div role="tablist" className="mt-3 flex gap-1 border-b border-gray-100">
        {TABS.map(k => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === k ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {t(`relations.tabs.${k}`)}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {tab === 'graph' && <RelationsGraph net={net} popover={popover} highlight={highlight} onHighlight={setHighlight} />}
        {tab === 'timeline' && <RelationsTimeline net={net} popover={popover} highlight={highlight} onHighlight={setHighlight} />}
        {tab === 'table' && <RelationsTable net={net} />}
      </div>
      <RelationPopover state={popover.state} net={net} onClose={popover.close} />
    </Section>
  );
};

const Section: React.FC<{ children: React.ReactNode; mapUrl?: string; count?: number }> = ({ children, mapUrl, count }) => {
  const { t } = useTranslation(['prosopography']);
  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2 border-b border-gray-100 pb-2 text-gray-800">
        <span className="text-primary-600"><Waypoints size={18} /></span>
        <h4 className="font-bold">{t('relations.title')}</h4>
        {count !== undefined && <span className="text-xs font-normal text-gray-400">({count})</span>}
        {mapUrl && (
          <Link to={mapUrl} className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-primary-700">
            <MapIcon size={12} /> {t('relations.openMap')}
          </Link>
        )}
      </div>
      {children}
    </div>
  );
};

export default PersonRelations;
```

Kogu nime päringu signatuuri kontrolli `CollectionContext`-ist; kui see erineb
`getCollectionName(id, lang)`-st, kohanda. Kui päises olev „Seoste kaart" link
(`relationMapUrl`) jääb alles, ei ole sektsiooni kaardilink sellega vastuolus. Ruling:
päise nupp jääb (kiire otsetee), sektsiooni link kannab ulatuse.

- [ ] **Step 4: Ühenda isikulehele**

`src/prosopography/pages/PersonDetailPage.tsx`:
```tsx
// import rida 25 asemele:
const PersonRelations = React.lazy(() => import('../components/relations/PersonRelations'));
```
(kui `React` ei ole default-imporditud, lisa `import React, { … } from 'react'` või kasuta `lazy` + `Suspense` nimeimporti)

Rida ~796:
```tsx
        {/* ── Seosed (#461) ── */}
        {id && (
          <React.Suspense fallback={null}>
            <PersonRelations personId={id} />
          </React.Suspense>
        )}
```

Kustuta `WorkRelationsCard.tsx` ja selle import. Seejärel
`grep -rn "fetchWorkRelations\|WorkRelation\b\|WorkRelationWork" src`: kui ainus kasutaja oli
kustutatud komponent, eemalda need `prosopographyService.ts`-ist. Kontrolli, kas vanad
i18n võtmed `workRelations`, `sharedWorks` on veel kasutuses
(`grep -rn "'workRelations'\|'sharedWorks'" src`). Kasutamata võtmed eemalda **mõlemast**
keelefailist korraga.

- [ ] **Step 5: Käivita**

Run: `npx vitest run src/prosopography src/locales`
Expected: kõik läbivad

- [ ] **Step 6: Commit**

```bash
git add -A src/prosopography src/locales
git commit -m "feat(prosopo): isikulehe „Seosed" sektsioon — võrgustik, ajatelg, loend (#461)"
```

---

### Task 6: Väravad, bundle ja käsitsi kontroll

**Files:** muudatusi ei ole (kui väravad on rohelised)

- [ ] **Step 1: Väravad**

Run: `npm run typecheck && npm test && npm run lint:ci`
Expected: typecheck puhas; kõik testid läbivad; lint ≤ 42 hoiatust (arv ei kasva).

Kui lint annab uue `react-hooks/exhaustive-deps` hoiatuse, paranda see sõltuvuste
loendiga. Kui see ei ole võimalik ilma käitumist muutmata, kasuta rea-kommentaari
`// eslint-disable-line react-hooks/exhaustive-deps` koos põhjusega, nagu `PersonsPage.tsx:67`.

- [ ] **Step 2: Build ja chunk'i suurus (gzip)**

Run: `npm run build 2>&1 | tail -15`
Leia väljundist `PersonRelations-*.js` ja selle gzip-suurus. Sihtmärk on alla ~12 KB gzip.
Isikulehe põhichunk ei tohi kasvada rohkem kui mõnisada baiti (laisk import). Pane
mõlemad numbrid PR-i kirjeldusse (CLAUDE.md: mõõda gzip'iga).

- [ ] **Step 3: Käsitsi kontroll** `npm run dev` ei ole tootmisandmetega (lokaalne `data/`
  ei peegelda tootmist). Pärast deploy'd kontrolli kasutajaga tootmises:
  - Fischer `vutt:Pu837uz`: Schwäger „Teos isikule"; mainimise link viib `/work/3ix06q/2`.
  - Luden `vutt:Pfxxxsc`: 159 isikut, sildid ainult suurimatel, ajatelg keritav.
  - Vogel `vutt:P82rja6`: trükkalifilter väljas → sektsioon kitsas; sisse → 241.

- [ ] **Step 4: Commit** (ainult siis, kui Step 1 nõudis parandusi)

```bash
git add -A src
git commit -m "chore(prosopo): #461 frontend väravad"
```
