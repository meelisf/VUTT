// src/prosopography/utils/relationsMap.ts
/**
 * Isikulehe seoste kaardi kihtide andmed (#461). Puhtad funktsioonid; renderdus on
 * RelationsMap.tsx-is. Trükikoht EI OLE kohtumiskoht (ADR 0056).
 */
import type { NetworkWork, RelationKind } from '../services/networkService';
import type { PlaceEntry, ProsopoRecord } from '../types';
import type { LatLon } from '../components/map/mapBase';
import type { VisibleNetwork, VisiblePerson } from './network';

export interface OriginGroup { key: string; label: string; coords: LatLon; persons: VisiblePerson[]; kinds: Partial<Record<RelationKind, number>>; }

export function originGroups(v: VisibleNetwork) {
  const byKey = new Map<string, OriginGroup>();
  const unmapped: VisiblePerson[] = [];
  for (const p of v.persons) {
    const c = p.origin?.coordinates;
    if (!c) { unmapped.push(p); continue; }
    const key = p.origin?.place_id ?? p.origin?.place ?? `${c.lat},${c.lon}`;
    const g = byKey.get(key) ?? { key, label: p.origin?.place ?? key, coords: c, persons: [], kinds: {} };
    g.persons.push(p);
    g.kinds[p.kind] = (g.kinds[p.kind] ?? 0) + 1;
    byKey.set(key, g);
  }
  return { groups: [...byKey.values()], unmapped };
}

export interface PrintPlace { key: string; label: string; coords: LatLon; works: NetworkWork[]; academic: number; personIds: string[]; }

export function printPlaces(v: VisibleNetwork): PrintPlace[] {
  const academicWorks = new Set(v.edges.filter(e => e.kind === 'academic').map(e => e.evidence?.work_id));
  const byKey = new Map<string, PrintPlace>();
  const used = new Set(v.edges.map(e => e.evidence?.work_id).filter(Boolean) as string[]);
  for (const w of v.works.values()) {
    const c = w.place?.coordinates;
    if (!c || !used.has(w.work_id)) continue;
    const key = w.place!.id ?? w.place!.label;
    const pp = byKey.get(key) ?? { key, label: w.place!.label, coords: c, works: [], academic: 0, personIds: [] };
    pp.works.push(w);
    if (academicWorks.has(w.work_id)) pp.academic += 1;
    byKey.set(key, pp);
  }
  for (const p of v.persons) {
    for (const e of p.edges) {
      const w = e.evidence ? v.works.get(e.evidence.work_id) : undefined;
      const key = w?.place ? (w.place.id ?? w.place.label) : null;
      const pp = key ? byKey.get(key) : undefined;
      if (pp && !pp.personIds.includes(p.id)) pp.personIds.push(p.id);
    }
  }
  return [...byKey.values()];
}

export interface OriginPrintLink { personId: string; from: LatLon; to: LatLon; workId: string; }

/** Päritolu ja trükikoha ühendus academic servadele — kahe koha ühendus, mitte teekond. */
export function originPrintLinks(v: VisibleNetwork): OriginPrintLink[] {
  const out: OriginPrintLink[] = [];
  for (const p of v.persons) {
    const from = p.origin?.coordinates;
    if (!from) continue;
    const seen = new Set<string>();
    for (const e of p.edges) {
      if (e.kind !== 'academic' || !e.evidence) continue;
      const to = v.works.get(e.evidence.work_id)?.place?.coordinates;
      if (!to) continue;
      const k = `${to.lat},${to.lon}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ personId: p.id, from, to, workId: e.evidence.work_id });
    }
  }
  return out;
}

export function mapYearOf(v: VisibleNetwork, fallback = 1650): number {
  const ys = v.edges.map(e => e.year).filter((y): y is number => typeof y === 'number').sort((a, b) => a - b);
  return ys.length ? ys[Math.floor(ys.length / 2)] : fallback;
}

export type StationKind = 'origin' | 'birth' | 'education' | 'occupation' | 'death' | 'burial';
export type StationReason = 'no_place' | 'not_in_registry' | 'no_coordinates';
export interface LifeStation {
  kind: StationKind; label: string | null; year: number | null; placeLabel: string | null;
  coords: LatLon | null; reason: StationReason | null; n?: number;
}

const yearOf = (d?: string | null): number | null => {
  const m = typeof d === 'string' ? /^-?(\d{3,4})/.exec(d) : null;
  return m ? Number(m[1]) : null;
};

type PlaceRef = { id?: string | null; label?: string | null } | null | undefined;

/** Kirje aasta: kanooniline `date_from.date`, siis vanad `date_start` / `year_from` / `year`. */
function entryYear(e: { date_from?: { date?: string | null } | null; date_start?: string | null; year_from?: number | null; year?: number | null } | null | undefined): number | null {
  if (!e) return null;
  return yearOf(e.date_from?.date) ?? yearOf(e.date_start)
    ?? (typeof e.year_from === 'number' ? e.year_from : null)
    ?? (typeof e.year === 'number' ? e.year : null);
}

function resolve(place: PlaceRef, registry: Record<string, PlaceEntry>) {
  if (!place || (!place.id && !place.label)) return { placeLabel: null, coords: null, reason: 'no_place' as const };
  const entry = (place.id && Object.values(registry).find(e => e.id === place.id))
    || (place.label && (registry[place.label]
      || Object.values(registry).find(e => Object.values(e.labels ?? {}).includes(place.label as string))));
  if (!entry) return { placeLabel: place.label ?? place.id ?? null, coords: null, reason: 'not_in_registry' as const };
  const c = entry.coordinates;
  if (!c) return { placeLabel: place.label ?? place.id ?? null, coords: null, reason: 'no_coordinates' as const };
  return { placeLabel: place.label ?? place.id ?? null, coords: { lat: c.lat, lon: c.lon }, reason: null };
}

/**
 * Fookusisiku elukäigu jaamad isikukaardilt (#461, osa #463-st). Järjekord: päritolu/sünd,
 * siis haridus ja ametid aasta järgi (kuupäevata keskmiste lõpus), siis surm ja matus.
 * Päritolu = sünnikoht → üks jaam.
 */
export function lifeStations(card: ProsopoRecord, registry: Record<string, PlaceEntry>) {
  const first: LifeStation[] = [];
  const middle: LifeStation[] = [];
  const last: LifeStation[] = [];
  const birthPlace = card.birth?.place;
  if (birthPlace && (birthPlace.id || birthPlace.label)) {
    first.push({ kind: 'birth', label: null, year: yearOf(card.birth?.date), ...resolve(birthPlace, registry) });
  }
  const originRef = { id: card.origin?.place_id ?? null, label: card.origin?.place ?? null };
  const sameAsBirth = !!birthPlace && ((originRef.id && originRef.id === birthPlace.id) || (!originRef.id && originRef.label === birthPlace.label));
  if ((originRef.id || originRef.label) && !sameAsBirth) {
    first.unshift({ kind: 'origin', label: null, year: null, ...resolve(originRef, registry) });
  }
  for (const e of card.education ?? []) {
    middle.push({ kind: 'education', label: e?.institution ?? null, year: entryYear(e),
      ...resolve({ id: e?.institution_id ?? null, label: e?.institution ?? null }, registry) });
  }
  for (const o of card.occupations ?? []) {
    middle.push({ kind: 'occupation', label: o?.label ?? null, year: entryYear(o),
      ...resolve({ id: o?.institution_id ?? null, label: o?.institution ?? null }, registry) });
  }
  middle.sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity));
  const deathPlace = card.death?.place;
  if (deathPlace && (deathPlace.id || deathPlace.label)) {
    last.push({ kind: 'death', label: null, year: yearOf(card.death?.date), ...resolve(deathPlace, registry) });
  }
  const burial = card.burial as { date?: string | null; place?: PlaceRef } | null;
  if (burial?.place && (burial.place.id || burial.place.label)) {
    last.push({ kind: 'burial', label: null, year: yearOf(burial.date), ...resolve(burial.place, registry) });
  }
  const all = [...first, ...middle, ...last];
  const mapped = all.filter(s => s.coords).map((s, i) => ({ ...s, n: i + 1 }));
  const unmapped = all.filter(s => !s.coords);
  return { mapped, unmapped };
}

export type RegistryState = Record<string, PlaceEntry> | 'loading' | 'error';

/**
 * Elukäigu vaade koos registri olekuga: laadimisel ja vea korral EI väideta, et koht
 * registris puudub (see oleks vale väide andmete kohta).
 */
export function lifeView(card: ProsopoRecord | null, registry: RegistryState) {
  if (registry === 'loading') return { status: 'loading' as const, mapped: [] as LifeStation[], unmapped: [] as LifeStation[] };
  if (registry === 'error') return { status: 'error' as const, mapped: [] as LifeStation[], unmapped: [] as LifeStation[] };
  if (!card) return { status: 'ready' as const, mapped: [] as LifeStation[], unmapped: [] as LifeStation[] };
  return { status: 'ready' as const, ...lifeStations(card, registry) };
}
