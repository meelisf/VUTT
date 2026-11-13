// src/prosopography/utils/closeCircle.ts
/**
 * Võrgustikuvaate lähikond ja serv (#812). Puhas loogika, DOM-ita testitav.
 * Lähikond = sugulased + vähemalt kahe ühise teosega isikud (kuni 15 isikut: kõik);
 * kaugus fookusest kahaneb ühiste teoste arvuga. Serv = ülejäänud ajajärjestuses.
 * „Samas teoses" = ühine (teos, osa) võti (ADR 0056, #464).
 */
import { KIND_ORDER, type VisibleNetwork, type VisiblePerson } from './network';

export const CLOSE_MIN_WORKS = 2;
export const CLOSE_MAX = 15;
export const RIM_LABEL_MAX = 14;
export const GRAPH_SIZE = { w: 900, h: 600 } as const;

const CX = GRAPH_SIZE.w / 2;
const CY = GRAPH_SIZE.h / 2;
// Lähikonna ovaal (f = 1) ja serva ovaal
const CLOSE_RX = 265;
const CLOSE_RY = 180;
const RIM_RX = 405;
const RIM_RY = 266;
// Serva vahe üleval (ring algab ja lõpeb), aastamärkide miinimumvahe
const RIM_GAP = 0.12;
const TICK_MIN_GAP = 0.13;
// Üle selle arvu servatäppe → kaks rida
const RIM_TWO_ROWS = 110;

const rank = (p: VisiblePerson) => KIND_ORDER.indexOf(p.kind);

/** Isikul on nähtav pereserv. */
export function isKin(p: VisiblePerson): boolean {
  return p.edges.some(e => e.kind === 'family');
}

/** Isiku (teos, osa) võtmed; teoseta servad (pere) ei loo kaasosalust. */
export function scopeKeys(p: VisiblePerson): Set<string> {
  const keys = new Set<string>();
  for (const e of p.edges) {
    if (e.evidence?.work_id) keys.add(`${e.evidence.work_id}#${e.evidence.part_id ?? ''}`);
  }
  return keys;
}

/** id → (kaasosalise id → ühiste (teos, osa) võtmete arv). Isik ise ei ole oma kaardis. */
export function coParticipants(v: VisibleNetwork): Map<string, Map<string, number>> {
  const byScope = new Map<string, string[]>();
  for (const p of v.persons) {
    for (const k of scopeKeys(p)) {
      if (!byScope.has(k)) byScope.set(k, []);
      byScope.get(k)!.push(p.id);
    }
  }
  const out = new Map<string, Map<string, number>>(v.persons.map(p => [p.id, new Map()]));
  for (const members of byScope.values()) {
    for (const a of members) {
      const m = out.get(a)!;
      for (const b of members) if (a !== b) m.set(b, (m.get(b) ?? 0) + 1);
    }
  }
  return out;
}

export function splitCloseCircle(v: VisibleNetwork): { close: VisiblePerson[]; rim: VisiblePerson[] } {
  if (v.persons.length <= CLOSE_MAX) return { close: [...v.persons], rim: [] };
  const kin = v.persons.filter(isKin);
  const others = v.persons
    .filter(p => !isKin(p) && p.workCount >= CLOSE_MIN_WORKS)
    .sort((a, b) => b.workCount - a.workCount || a.label.localeCompare(b.label));
  const close = [...kin, ...others.slice(0, Math.max(0, CLOSE_MAX - kin.length))];
  const inClose = new Set(close.map(p => p.id));
  return { close, rim: v.persons.filter(p => !inClose.has(p.id)) };
}

export interface CloseNode { person: VisiblePerson; x: number; y: number; angle: number; r: number; f: number; }
export interface RimNode { person: VisiblePerson; x: number; y: number; angle: number; r: number; opacity: number; }
export interface RimTick { angle: number; year: number | null; }     // null = „aeg teadmata"
export interface CloseLayout { cx: number; cy: number; maxWorks: number; close: CloseNode[]; rim: RimNode[]; ticks: RimTick[]; }

/** Kaugustegur: 0,5 (kõige lähemal) … 1,0. */
function distanceFactor(p: VisiblePerson, maxWorks: number): number {
  if (isKin(p) && p.workCount < CLOSE_MIN_WORKS) return 0.625;
  if (p.workCount <= 1) return 1.0;
  if (maxWorks <= CLOSE_MIN_WORKS) return 0.75;
  return 1 - 0.5 * (p.workCount - CLOSE_MIN_WORKS) / (maxWorks - CLOSE_MIN_WORKS);
}

/** Pööre (5° sammuga ühe nurgavahe piires), mis viib lähima isiku püsttelgedest
 *  kõige kaugemale; viigi korral väikseim pööre. */
function turnAwayFromVertical(n: number): number {
  const step = Math.PI / 36;
  let best = 0;
  let bestScore = -1;
  for (let turn = 0; turn < (2 * Math.PI) / n - 1e-9; turn += step) {
    let score = Infinity;
    for (let i = 0; i < n; i++) {
      score = Math.min(score, Math.abs(Math.cos(-Math.PI / 2 + ((i + 0.5) / n) * 2 * Math.PI + turn)));
    }
    if (score > bestScore + 1e-9) { bestScore = score; best = turn; }
  }
  return best;
}

export function closeCircleLayout(v: VisibleNetwork): CloseLayout {
  const split = splitCloseCircle(v);

  // Lähikond: liik → esimene aasta → nimi
  const closeSorted = [...split.close].sort((a, b) =>
    rank(a) - rank(b) || (a.firstYear ?? 9999) - (b.firstYear ?? 9999) || a.label.localeCompare(b.label));
  const n = closeSorted.length;
  const maxWorks = closeSorted.reduce((m, p) => Math.max(m, p.workCount), 0);
  // Alla 5 isiku: pööra algnurka nii, et keegi ei satuks fookuse nime kohale/alla.
  // Kindel 45° ei sobi: koos poolsammuga viis see 4 isikut täpselt telgedele.
  const turn = n > 0 && n < 5 ? turnAwayFromVertical(n) : 0;
  const close: CloseNode[] = closeSorted.map((person, i) => {
    const angle = -Math.PI / 2 + ((i + 0.5) / n) * 2 * Math.PI + turn;
    const f = distanceFactor(person, maxWorks);
    return {
      person, angle, f,
      x: CX + CLOSE_RX * f * Math.cos(angle),
      y: CY + CLOSE_RY * f * Math.sin(angle),
      r: 5 + Math.sqrt(person.workCount / Math.max(1, maxWorks)) * 6,
    };
  });

  // Serv: esimene aasta (aastata lõpus) → liik → nimi; nurgad ühtlased (järjekord, mitte mõõtkava)
  const rimSorted = [...split.rim].sort((a, b) =>
    (a.firstYear ?? Infinity) - (b.firstYear ?? Infinity) || rank(a) - rank(b) || a.label.localeCompare(b.label));
  const m = rimSorted.length;
  const start = -Math.PI / 2 + RIM_GAP / 2;
  const span = 2 * Math.PI - RIM_GAP;
  const rim: RimNode[] = rimSorted.map((person, i) => {
    const angle = start + ((i + 0.5) / m) * span;
    const k = m > RIM_TWO_ROWS && i % 2 === 1 ? 0.94 : 1;
    const strong = person.workCount >= CLOSE_MIN_WORKS;
    return {
      person, angle,
      x: CX + RIM_RX * k * Math.cos(angle),
      y: CY + RIM_RY * k * Math.sin(angle),
      r: strong ? 4 : 3,
      opacity: strong ? 0.6 : 0.32,
    };
  });

  // Aastamärgid uue aasta algusesse, kui eelmisest märgist on piisav vahe
  const ticks: RimTick[] = [];
  let prevYear: number | null | undefined;
  let lastTickAngle = -Infinity;
  rim.forEach((node, i) => {
    const year = node.person.firstYear;
    if ((i === 0 || year !== prevYear) && node.angle - lastTickAngle >= TICK_MIN_GAP) {
      ticks.push({ angle: start + (i / m) * span, year });
      lastTickAngle = node.angle;
    }
    prevYear = year;
  });

  return { cx: CX, cy: CY, maxWorks, close, rim, ticks };
}

/** Hoiab järjekorra, tagab naabrite vahel vähemalt `gap`; sisend ei pea olema sorditud.
 *  Tagastab uued y-id sisendi järjekorras. */
export function spreadY(ys: number[], gap: number): number[] {
  const order = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b] || a - b);
  const out = [...ys];
  let prev = -Infinity;
  for (const i of order) {
    out[i] = Math.max(ys[i], prev + gap);
    prev = out[i];
  }
  return out;
}
