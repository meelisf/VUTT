# Isiku seosed — kaart (PR 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isikulehe „Seosed" sektsiooni neljas vahekaart **Kaart** nelja kihiga (Päritolu ·
Päritolu ja trükikoht · Trükikohad · Elukäik). Kaart ehitatakse samast `/network`
vastusest, põhjaks on ühine `PersonsMap` alus. Päise nupp „Seoste kaart" avab selle
vahekaardi.

**Architecture:**
- `PersonsMap`-ist eraldatakse ühine alus `components/map/mapBase.tsx`: `resolveLabel`,
  geneeriline `spreadOverlapping` ja `FitToPoints`. `PersonsMap` kasutab neid ja tema
  käitumine ei muutu.
- Kõik kihtide andmed tulevad puhastest funktsioonidest `utils/relationsMap.ts`.
- `RelationsMap.tsx` on õhuke react-leaflet renderdaja ja laaditakse laisalt (Leaflet on
  raske).
- Elukäigu jaamad tulevad isikukaardilt (`ProsopoRecord`, isikulehel juba laetud).
  Koordinaadid tulevad kohtade registrist (`fetchPlaces`).

**Tech Stack:** React 19, TS, react-leaflet + MapLibre (olemas), vitest.

**Spec:** `docs/superpowers/specs/2026-09-26-isiku-seoste-vaade-design.md`, „Kaart" (sh
„Elukäik" ja „Suhe suure kaardiga").

## Global Constraints

- i18n: uued võtmed `network.*` all **mõlemas** keeles korraga; arvuga sildid `_one/_other`.
- Testides i18n: `src/prosopography/components/relations/__tests__/testI18n.ts`.
  Mockimine `vi.fn`-iga, mis tagastab tagasi lükatud lubaduse, **ei tööta** (vitest 4) —
  kasuta tavafunktsiooni (vt `PersonRelations.test.tsx`).
- Tugevate liikide värvid: `KIND_COLOR` (`relations/kindStyle.ts`). Värv ei ole kunagi
  ainus tunnus.
- Trükikoht ≠ kohtumiskoht: kihi nimed on „Päritolu ja trükikoht" ja „Trükikohad". Joon on
  „kahe koha ühendus", mitte teekond.
- Kaart ei tohi kasvada isikulehe põhichunk'i: `React.lazy`.
- Uusi sõltuvusi ei lisata. Väravad: `npm run typecheck`, `npm test`, `npm run lint:ci`
  (≤ 42 hoiatust).

## Review Focus

1. **Isik ilma ühegi koordinaadita** (keegi pole kaardil, elukäigul 0 jaama): kaarti ei
   sobitata tühjale hulgale (Leaflet `fitBounds([])` viskab). Näidatakse vaikevaadet ja
   loendit. Test Task 1-s (`FitToPoints` tühja hulgaga ei tee midagi — puhas abifunktsioon
   `boundsOf([])` → `null`).
2. **Registris Q-koodita koht, silt kattub** (nt `origin.place = "Lübeck"`, `place_id`
   puudub): leitakse sildi järgi. Test Task 2-s.
3. **Kuupäevata ametid** (`date_from` puudub): jaam jääb alles, järjestatakse keskmiste lõppu,
   enne surma. Test Task 2-s.
4. **Päritolu = sünnikoht:** üks jaam, mitte kaks samas punktis. Test Task 2-s.
5. **Kõik servad filtriga peidetud:** kaardivahekaarti ei näidata (sektsioon on tühjas
   olekus). See on juba kaetud PR 2-ga. Elukäik ei sõltu servadest, kuid on vahekaardi osa —
   aktsepteeritud piirang, märgitud PR-i kirjelduses.

---

## Failide kaart

| Fail | Vastutus |
|---|---|
| `src/prosopography/components/map/mapBase.tsx` (uus) | `resolveLabel`, `spreadOverlapping`, `boundsOf`, `FitToPoints` |
| `src/prosopography/components/map/__tests__/mapBase.test.ts` (uus) | testid |
| `src/prosopography/components/PersonsMap.tsx` (muuda) | kasutab `mapBase`-i |
| `src/prosopography/utils/relationsMap.ts` (uus) | `originGroups`, `printPlaces`, `originPrintLinks`, `lifeStations`, `mapYearOf` |
| `src/prosopography/utils/__tests__/relationsMap.test.ts` (uus) | testid |
| `src/prosopography/components/relations/RelationsMap.tsx` (uus) | Leaflet kaart, 4 kihti |
| `src/prosopography/components/relations/PersonRelations.tsx` (muuda) | vahekaart `map`, `card` prop, `#seosed-kaart` |
| `src/prosopography/pages/PersonDetailPage.tsx` (muuda) | päise nupp → `#seosed-kaart`; `card={person}` |
| `src/locales/{et,en}/prosopography.json` | `network.tabs.map`, `network.layers.*`, `network.stations.*`, `network.reasons.*` |

---

### Task 1: Ühine kaardi alus

**Files:** Create `src/prosopography/components/map/mapBase.tsx`, test
`src/prosopography/components/map/__tests__/mapBase.test.ts`; Modify `PersonsMap.tsx`.

**Interfaces — Produces:**
```ts
export interface LatLon { lat: number; lon: number; }
export function resolveLabel(labels: Record<string, string> | null | undefined, lang: string): string | null;
export function spreadOverlapping<T>(items: T[], coordsOf: (t: T) => LatLon): Array<T & { display: LatLon; overlapped: boolean }>;
export function boundsOf(points: LatLon[]): [[number, number], [number, number]] | null;
export const FitToPoints: React.FC<{ points: LatLon[]; focus?: LatLon | null }>;
```

- [ ] **Step 1: Failiv test**

```ts
// src/prosopography/components/map/__tests__/mapBase.test.ts
import { describe, it, expect } from 'vitest';
import { boundsOf, resolveLabel, spreadOverlapping } from '../mapBase';

describe('mapBase', () => {
  it('resolveLabel: keel → et → en → esimene', () => {
    expect(resolveLabel({ et: 'Riia', en: 'Riga' }, 'en')).toBe('Riga');
    expect(resolveLabel({ en: 'Riga' }, 'et')).toBe('Riga');
    expect(resolveLabel(null, 'et')).toBeNull();
  });

  it('spreadOverlapping nihutab ainult kattuvaid', () => {
    const items = [{ id: 'a', c: { lat: 1, lon: 1 } }, { id: 'b', c: { lat: 1, lon: 1 } }, { id: 'c', c: { lat: 2, lon: 2 } }];
    const out = spreadOverlapping(items, i => i.c);
    expect(out.find(o => o.id === 'c')!.overlapped).toBe(false);
    expect(out.find(o => o.id === 'c')!.display).toEqual({ lat: 2, lon: 2 });
    const a = out.find(o => o.id === 'a')!;
    const b = out.find(o => o.id === 'b')!;
    expect(a.overlapped && b.overlapped).toBe(true);
    expect(a.display).not.toEqual(b.display);
  });

  it('boundsOf: tühi hulk → null (Leaflet fitBounds([]) viskab)', () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([{ lat: 1, lon: 2 }, { lat: 3, lon: -1 }])).toEqual([[1, -1], [3, 2]]);
  });
});
```

- [ ] **Step 2:** `npx vitest run src/prosopography/components/map` → FAIL (moodul puudub)

- [ ] **Step 3: Implementeeri**

```tsx
// src/prosopography/components/map/mapBase.tsx
/**
 * Isikute kaartide ühine alus (#461): suur kaart (PersonsMap) ja isikulehe seoste kaart
 * (RelationsMap) kasutavad samu abilisi, et välimus ja käitumine ei lahkneks.
 */
import React, { useEffect } from 'react';
import { useMap } from 'react-leaflet';

export interface LatLon { lat: number; lon: number; }

export function resolveLabel(labels: Record<string, string> | null | undefined, lang: string): string | null {
  if (!labels) return null;
  return labels[lang] ?? labels.et ?? labels.en ?? Object.values(labels)[0] ?? null;
}

const keyOf = (c: LatLon) => `${c.lat.toFixed(6)},${c.lon.toFixed(6)}`;

/** Täpselt kattuvad punktid laotakse väikesesse ringi, et kõik oleksid klõpsatavad. */
export function spreadOverlapping<T>(items: T[], coordsOf: (t: T) => LatLon) {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(coordsOf(it));
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  return items.map(it => {
    const c = coordsOf(it);
    const group = groups.get(keyOf(c)) ?? [it];
    if (group.length <= 1) return { ...it, display: c, overlapped: false };
    const angle = (Math.PI * 2 * group.indexOf(it)) / group.length;
    const radius = 0.04 + Math.min(group.length, 8) * 0.003;
    return { ...it, display: { lat: c.lat + Math.sin(angle) * radius, lon: c.lon + Math.cos(angle) * radius }, overlapped: true };
  });
}

export function boundsOf(points: LatLon[]): [[number, number], [number, number]] | null {
  if (points.length === 0) return null;
  const lats = points.map(p => p.lat);
  const lons = points.map(p => p.lon);
  return [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]];
}

export const FitToPoints: React.FC<{ points: LatLon[]; focus?: LatLon | null }> = ({ points, focus }) => {
  const map = useMap();
  useEffect(() => {
    if (focus) { map.setView([focus.lat, focus.lon], 8, { animate: false }); return; }
    const b = boundsOf(points);
    if (b) map.fitBounds(b, { padding: [28, 28], maxZoom: 8, animate: false });
  }, [focus, map, points]);
  return null;
};
```

- [ ] **Step 4: Refaktori `PersonsMap.tsx`**. Eemalda sealt `resolveLabel`,
  `coordinateKey`, `spreadOverlappingMarkers`, `FitMapToMarkers` ja `DisplayMarker` ning
  impordi `resolveLabel, spreadOverlapping, FitToPoints` `./map/mapBase`-ist.
  - `displayMarkers = useMemo(() => data ? spreadOverlapping(data.markers, m => m.coordinates) : [], [data])`
  - Renderduses: `marker.displayCoordinates` → `marker.display`, `marker.hasCoordinateOverlap` → `marker.overlapped`.
  - `<FitMapToMarkers markers={data.markers} focusPlace={focusPlace} />` → `<FitToPoints points={points} focus={focusCoords} />`, kus
    `const points = useMemo(() => (data?.markers ?? []).map(m => m.coordinates), [data]);` ja
    `const focusCoords = focusedMarker?.coordinates ?? null;`. (Enne oli `focusedMarker` arvutus sama tingimusega; hook'id peavad olema enne varajasi `return`-e.)
  - Eemalda ka `useMap` ja `LatLngBoundsExpression` importidest, kui neid enam ei kasutata.

- [ ] **Step 5:** `npx vitest run src/prosopography/components && npm run typecheck` → PASS / puhas
- [ ] **Step 6: Commit** `refactor(prosopo): isikute kaartide ühine alus mapBase (#461)`

---

### Task 2: Kihtide andmed (puhtad funktsioonid)

**Files:** Create `src/prosopography/utils/relationsMap.ts`, test `src/prosopography/utils/__tests__/relationsMap.test.ts`.

**Interfaces — Produces:**
```ts
export interface OriginGroup { key: string; label: string; coords: LatLon; persons: VisiblePerson[]; kinds: Partial<Record<RelationKind, number>>; }
export function originGroups(v: VisibleNetwork): { groups: OriginGroup[]; unmapped: VisiblePerson[] };
export interface PrintPlace { key: string; label: string; coords: LatLon; works: NetworkWork[]; academic: number; personIds: string[]; }
export function printPlaces(v: VisibleNetwork): PrintPlace[];
export interface OriginPrintLink { personId: string; from: LatLon; to: LatLon; workId: string; }
export function originPrintLinks(v: VisibleNetwork): OriginPrintLink[];
export type StationKind = 'origin' | 'birth' | 'education' | 'occupation' | 'death' | 'burial';
export type StationReason = 'no_place' | 'not_in_registry' | 'no_coordinates';
export interface LifeStation { kind: StationKind; label: string | null; year: number | null; placeLabel: string | null; coords: LatLon | null; reason: StationReason | null; n?: number; }
export function lifeStations(card: ProsopoRecord, registry: Record<string, PlaceEntry>): { mapped: LifeStation[]; unmapped: LifeStation[] };
export function mapYearOf(v: VisibleNetwork, fallback?: number): number;
```

- [ ] **Step 1: Failivad testid**

```ts
// src/prosopography/utils/__tests__/relationsMap.test.ts
import { describe, it, expect } from 'vitest';
import { applyFilters, DEFAULT_FILTER } from '../network';
import { lifeStations, mapYearOf, originGroups, originPrintLinks, printPlaces } from '../relationsMap';
import type { PersonNetwork } from '../../services/networkService';
import type { PlaceEntry, ProsopoRecord } from '../../types';

const F = 'vutt:Pfocus';
const RIGA = { lat: 56.95, lon: 24.1 };
const ALTDORF = { lat: 49.39, lon: 11.36 };
const NET: PersonNetwork = {
  focus: { id: F, label: 'Fischer', birth_year: 1636, death_year: 1705, origin: null },
  persons: [
    { id: 'a', label: 'A', birth_year: null, death_year: null, origin: { place: 'Riga', place_id: 'Q1773', coordinates: RIGA } },
    { id: 'b', label: 'B', birth_year: null, death_year: null, origin: { place: 'Riga', place_id: 'Q1773', coordinates: RIGA } },
    { id: 'c', label: 'C', birth_year: null, death_year: null, origin: null },
  ],
  works: [
    { work_id: 'w1', title: 'Disp', year: 1658, place: { id: 'Q435295', label: 'Altdorf', coordinates: ALTDORF }, genres: [], restricted: false },
    { work_id: 'w2', title: 'Funus', year: 1697, place: { id: null, label: 'Berliin', coordinates: null }, genres: [], restricted: false },
  ],
  edges: [
    { kind: 'academic', from: 'a', to: F, directed: true, year: 1658, place: null, roles: {}, evidence: { work_id: 'w1', pages: [] } },
    { kind: 'cotext', from: 'b', to: F, directed: false, year: 1697, place: null, roles: {}, evidence: { work_id: 'w2', pages: [] } },
    { kind: 'cotext', from: 'c', to: F, directed: false, year: 1697, place: null, roles: {}, evidence: { work_id: 'w2', pages: [] } },
  ],
};
const v = applyFilters(NET, DEFAULT_FILTER);

describe('originGroups', () => {
  it('rühmitab päritolu järgi, liikide jaotusega; päritoluta eraldi', () => {
    const { groups, unmapped } = originGroups(v);
    expect(groups).toHaveLength(1);
    expect(groups[0].persons.map(p => p.id).sort()).toEqual(['a', 'b']);
    expect(groups[0].kinds).toEqual({ academic: 1, cotext: 1 });
    expect(unmapped.map(p => p.id)).toEqual(['c']);
  });
});

describe('printPlaces ja originPrintLinks', () => {
  it('trükikohad ainult koordinaadiga; academic loendus', () => {
    const pp = printPlaces(v);
    expect(pp.map(p => p.label)).toEqual(['Altdorf']);
    expect(pp[0].academic).toBe(1);
  });

  it('jooned ainult academic servadele, mõlemal otsal koordinaat', () => {
    expect(originPrintLinks(v)).toEqual([{ personId: 'a', from: RIGA, to: ALTDORF, workId: 'w1' }]);
  });
});

describe('mapYearOf', () => {
  it('servade aastate mediaan; aastateta varuväärtus', () => {
    expect(mapYearOf(v)).toBe(1697);
    expect(mapYearOf({ ...v, edges: [] }, 1650)).toBe(1650);
  });
});

const REG: Record<string, PlaceEntry> = {
  'Lübeck': { id: 'Q2843', labels: { et: 'Lübeck' }, coordinates: { lat: 53.87, lon: 10.69 } },
  'Magdeburg': { id: 'Q1733', labels: { et: 'Magdeburg' }, coordinates: { lat: 52.13, lon: 11.62 } },
  'Liivimaa': { id: 'Q183464', labels: { et: 'Liivimaa' }, coordinates: null },
};
const date = (d: string | null, place: { id: string | null; label: string } | null = null) =>
  ({ original_text: null, date: d, date_to: null, bound: null, precision: 'year', calendar: null, is_circa: false, place, notes: null });
const CARD = {
  id: F,
  birth: date('1636-01-01', { id: 'Q2843', label: 'Lübeck' }),
  death: date('1705-05-17', { id: 'Q1733', label: 'Magdeburg' }),
  origin: { place: 'Lübeck', place_id: 'Q2843', geonames_id: null, coordinates: null },
  occupations: [
    { label: 'Superintendent', institution: 'Pfalz-Sulzbach', institution_id: 'Q454436', date_from: date('1667-01-01') },
    { label: 'Superintendent', institution: 'Liivimaa', institution_id: 'Q183464', date_from: date('1673-01-01') },
    { label: 'Superintendent', institution: 'Magdeburg', institution_id: 'Q1733', date_from: date('1700-01-01') },
    { label: 'Pastor', institution: null, institution_id: null },
  ],
  education: [],
  burial: null,
} as unknown as ProsopoRecord;

describe('lifeStations (Fischer)', () => {
  const { mapped, unmapped } = lifeStations(CARD, REG);

  it('päritolu = sünnikoht → üks jaam; järjekord sünd → ametid → surm; numbrid', () => {
    expect(mapped.map(s => [s.kind, s.year, s.placeLabel, s.n])).toEqual([
      ['birth', 1636, 'Lübeck', 1],
      ['occupation', 1700, 'Magdeburg', 2],
      ['death', 1705, 'Magdeburg', 3],
    ]);
  });

  it('kaardita jaamad põhjusega; kuupäevata amet alles', () => {
    expect(unmapped.map(s => [s.placeLabel, s.reason])).toEqual([
      ['Pfalz-Sulzbach', 'not_in_registry'],
      ['Liivimaa', 'no_coordinates'],
      [null, 'no_place'],
    ]);
  });

  it('Q-koodita koht leitakse sildi järgi', () => {
    const card = { ...CARD, birth: date('1636', { id: null, label: 'Lübeck' }), origin: { ...CARD.origin, place_id: null } } as ProsopoRecord;
    expect(lifeStations(card, REG).mapped[0]).toMatchObject({ kind: 'birth', placeLabel: 'Lübeck' });
  });
});
```

- [ ] **Step 2:** `npx vitest run src/prosopography/utils/__tests__/relationsMap.test.ts` → FAIL
- [ ] **Step 3: Implementeeri**

```ts
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
    middle.push({ kind: 'education', label: e?.institution ?? null, year: yearOf(e?.date_start),
      ...resolve({ id: e?.institution_id ?? null, label: e?.institution ?? null }, registry) });
  }
  for (const o of card.occupations ?? []) {
    middle.push({ kind: 'occupation', label: o?.label ?? null, year: yearOf(o?.date_from?.date),
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
```

- [ ] **Step 4:** testid → PASS; `npm run typecheck` puhas
- [ ] **Step 5: Commit** `feat(prosopo): seoste kaardi kihtide andmed ja elukäigu jaamad (#461)`

---

### Task 3: RelationsMap komponent ja i18n

**Files:** Create `src/prosopography/components/relations/RelationsMap.tsx`; Modify
`src/locales/{et,en}/prosopography.json`.

**Interfaces:** Consumes Task 1–2, `KIND_COLOR`, `usePopover`, `fetchPlaces`. Produces
`default RelationsMap(props: { net: VisibleNetwork; card: ProsopoRecord | null; popover: ReturnType<typeof usePopover>; onHighlight(id: string | null): void })`.

- [ ] **Step 1: i18n** — lisa `network` objekti mõlemas keeles:

et:
```json
"layers": { "origin": "Päritolu", "originPrint": "Päritolu ja trükikoht", "print": "Trükikohad", "life": "Elukäik" },
"layerHelp": {
  "origin": "Seotud isikud päritolukoha järgi; ringi värv näitab seose liike.",
  "originPrint": "Joon ühendab akadeemilise akti osalise päritolukoha teose trükikohaga. See on kahe koha ühendus, mitte teekond: trükikoht ei ole tingimata toimumiskoht.",
  "print": "Ühiste teoste trükikohad. Täis ring: akadeemiline akt; õõnes: muu trükis. Trükikoht ei tõenda kohtumist.",
  "life": "Isiku enda elukäik isikukaardilt: sünd või päritolu, haridus, ametid, surm."
},
"unmappedPersons_one": "{{count}} seotud isikul puudub päritolu koordinaat",
"unmappedPersons_other": "{{count}} seotud isikul puudub päritolu koordinaat",
"unmappedStations": "Kaardita jaamad",
"noStations": "Isikukaardil pole kohaga jaamu.",
"stations": { "origin": "Päritolu", "birth": "Sünd", "education": "Haridus", "occupation": "Amet", "death": "Surm", "burial": "Matus" },
"reasons": { "no_place": "koht märkimata", "not_in_registry": "koht registris puudub", "no_coordinates": "kohal pole koordinaate" }
```
ja `"tabs"` objekti `"map": "Kaart"`.

en:
```json
"layers": { "origin": "Origin", "originPrint": "Origin and place of printing", "print": "Places of printing", "life": "Life course" },
"layerHelp": {
  "origin": "Related persons by place of origin; the circle colour shows the kinds of relations.",
  "originPrint": "A line joins the place of origin of a participant in an academic act with the work's place of printing. It connects two places; it is not a journey, and the place of printing is not necessarily where the act took place.",
  "print": "Places of printing of shared works. Filled: academic act; hollow: other print. The place of printing does not prove a meeting.",
  "life": "The person's own life course from the person record: birth or origin, education, offices, death."
},
"unmappedPersons_one": "{{count}} related person has no origin coordinates",
"unmappedPersons_other": "{{count}} related persons have no origin coordinates",
"unmappedStations": "Stations not on the map",
"noStations": "The person record has no stations with a place.",
"stations": { "origin": "Origin", "birth": "Birth", "education": "Education", "occupation": "Office", "death": "Death", "burial": "Burial" },
"reasons": { "no_place": "place not recorded", "not_in_registry": "place missing from the register", "no_coordinates": "place has no coordinates" }
```
ja `"tabs"` objekti `"map": "Map"`.

- [ ] **Step 2: Implementeeri** `RelationsMap.tsx`

```tsx
// src/prosopography/components/relations/RelationsMap.tsx
/**
 * Isikulehe seoste kaart (#461): samad andmed mis teistel vahekaartidel + fookusisiku
 * elukäik. Alus ühine PersonsMap-iga (mapBase, HistoricalMapLayer).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { divIcon } from 'leaflet';
import { MapContainer, Marker, Polyline, Popup } from 'react-leaflet';
import HistoricalMapLayer from '../HistoricalMapLayer';
import { FitToPoints, spreadOverlapping, type LatLon } from '../map/mapBase';
import { fetchPlaces } from '../../services/prosopographyService';
import type { PlaceEntry, ProsopoRecord } from '../../types';
import type { VisibleNetwork } from '../../utils/network';
import { KIND_ORDER } from '../../utils/network';
import { lifeStations, mapYearOf, originGroups, originPrintLinks, printPlaces } from '../../utils/relationsMap';
import { KIND_COLOR } from './kindStyle';
import type { usePopover } from './RelationPopover';

type Layer = 'origin' | 'originPrint' | 'print' | 'life';
const LAYERS: Layer[] = ['origin', 'originPrint', 'print', 'life'];

let placesPromise: Promise<Record<string, PlaceEntry>> | null = null;
const loadPlaces = () => (placesPromise ??= fetchPlaces().catch(() => { placesPromise = null; return {}; }));

function pieIcon(kinds: Partial<Record<string, number>>, count: number) {
  const total = Object.values(kinds).reduce((a, b) => a + (b ?? 0), 0) || 1;
  let acc = 0;
  const stops = KIND_ORDER.filter(k => kinds[k]).map(k => {
    const from = (acc / total) * 100; acc += kinds[k] ?? 0; const to = (acc / total) * 100;
    return `${KIND_COLOR[k]} ${from}% ${to}%`;
  }).join(', ');
  const size = count >= 20 ? 40 : count >= 10 ? 34 : count >= 3 ? 29 : 24;
  return divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);background:conic-gradient(${stops});display:flex;align-items:center;justify-content:center;color:#fff;font:600 11px system-ui;text-shadow:0 0 2px #000">${count}</div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
  });
}

function dotIcon(label: string | number, fill: string, hollow = false, size = 22) {
  return divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;border:2px solid ${hollow ? fill : '#fff'};background:${hollow ? '#fff' : fill};box-shadow:0 1px 3px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:${hollow ? fill : '#fff'};font:600 11px system-ui">${label}</div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
  });
}

const RelationsMap: React.FC<{
  net: VisibleNetwork; card: ProsopoRecord | null;
  popover: ReturnType<typeof usePopover>; onHighlight: (id: string | null) => void;
}> = ({ net, card, popover, onHighlight }) => {
  const { t, i18n } = useTranslation(['prosopography']);
  const lang = i18n.language?.slice(0, 2) ?? 'et';
  const [layer, setLayer] = useState<Layer>('origin');
  const [registry, setRegistry] = useState<Record<string, PlaceEntry> | null>(null);
  useEffect(() => { let alive = true; loadPlaces().then(r => { if (alive) setRegistry(r); }); return () => { alive = false; }; }, []);

  const origin = useMemo(() => originGroups(net), [net]);
  const prints = useMemo(() => printPlaces(net), [net]);
  const links = useMemo(() => originPrintLinks(net), [net]);
  const life = useMemo(() => (card && registry ? lifeStations(card, registry) : { mapped: [], unmapped: [] }), [card, registry]);
  const year = useMemo(() => mapYearOf(net, card?.birth?.date ? Number(card.birth.date.slice(0, 4)) + 30 : 1650), [net, card]);
  const focusCoords = net.focus.origin?.coordinates ?? null;

  const points: LatLon[] = useMemo(() => {
    if (layer === 'origin') return [...origin.groups.map(g => g.coords), ...(focusCoords ? [focusCoords] : [])];
    if (layer === 'originPrint') return [...links.flatMap(l => [l.from, l.to]), ...(focusCoords ? [focusCoords] : [])];
    if (layer === 'print') return prints.map(p => p.coords);
    return life.mapped.map(s => s.coords!) ;
  }, [layer, origin, links, prints, life, focusCoords]);

  const pinFromLeaflet = (id: string, ev: { originalEvent: MouseEvent }) =>
    popover.pin(id, ev.originalEvent as unknown as React.MouseEvent);
  const originMarkers = spreadOverlapping(origin.groups, g => g.coords);

  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label={t('network.tabs.map')} className="inline-flex flex-wrap overflow-hidden rounded border border-gray-200 text-xs">
        {LAYERS.map((l, i) => (
          <button key={l} type="button" role="radio" aria-checked={layer === l} onClick={() => setLayer(l)}
            className={`px-2.5 py-1 ${i ? 'border-l border-gray-200' : ''} ${layer === l ? 'bg-gray-800 text-white' : 'bg-white text-gray-600'}`}>
            {t(`network.layers.${l}`)}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-600">{t(`network.layerHelp.${layer}`)}</p>
      <div className="h-[520px] overflow-hidden rounded-lg border border-gray-200">
        <MapContainer center={[57.5, 24.5]} zoom={5} minZoom={1} scrollWheelZoom className="h-full w-full">
          <HistoricalMapLayer year={year} lang={lang} />
          <FitToPoints points={points} />
          {(layer === 'origin' || layer === 'originPrint') && focusCoords && (
            <Marker position={[focusCoords.lat, focusCoords.lon]} icon={dotIcon('★', '#1d2126', false, 26)}>
              <Popup>{net.focus.label} · {net.focus.origin?.place}</Popup>
            </Marker>
          )}
          {layer === 'origin' && originMarkers.map(g => (
            <Marker key={g.key} position={[g.display.lat, g.display.lon]} icon={pieIcon(g.kinds, g.persons.length)}>
              <Popup>
                <div className="min-w-48 max-w-72">
                  <div className="font-semibold text-gray-900">{g.label}</div>
                  <div className="max-h-56 space-y-0.5 overflow-y-auto">
                    {g.persons.map(p => (
                      <div key={p.id}>
                        <Link to={`/persons/${p.id}`} className="text-primary-700 hover:underline">{p.label}</Link>
                        <span className="ml-1 text-xs text-gray-500">{t(`network.kinds.${p.kind}`)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
          {layer === 'originPrint' && links.map(l => (
            <Polyline key={`${l.personId}-${l.workId}`} positions={[[l.from.lat, l.from.lon], [l.to.lat, l.to.lon]]}
              pathOptions={{ color: KIND_COLOR.academic, weight: 2, opacity: 0.7 }}
              eventHandlers={{
                mouseover: () => onHighlight(l.personId),
                mouseout: () => onHighlight(null),
                click: e => pinFromLeaflet(l.personId, e as unknown as { originalEvent: MouseEvent }),
              }} />
          ))}
          {(layer === 'originPrint' || layer === 'print') && prints.map(p => (
            <Marker key={p.key} position={[p.coords.lat, p.coords.lon]}
              icon={dotIcon(layer === 'print' ? p.works.length : '', '#1d2126', layer === 'print' && p.academic === 0, layer === 'print' ? 26 : 14)}>
              <Popup>
                <div className="min-w-48 max-w-72">
                  <div className="font-semibold text-gray-900">{p.label}</div>
                  <ul className="max-h-56 space-y-0.5 overflow-y-auto">
                    {p.works.map(w => (
                      <li key={w.work_id}>
                        {w.restricted
                          ? <span className="text-gray-500">{w.title} ({t('network.restricted')})</span>
                          : <Link to={`/work/${w.work_id}/1`} className="text-primary-700 hover:underline">{w.title.length > 70 ? `${w.title.slice(0, 69)}…` : w.title}</Link>}
                        {w.year ? <span className="ml-1 text-xs text-gray-400">{w.year}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </Popup>
            </Marker>
          ))}
          {layer === 'life' && life.mapped.length > 1 && (
            <Polyline positions={life.mapped.map(s => [s.coords!.lat, s.coords!.lon] as [number, number])}
              pathOptions={{ color: '#1d2126', weight: 2, opacity: 0.6, dashArray: '6 4' }} />
          )}
          {layer === 'life' && spreadOverlapping(life.mapped, s => s.coords!).map(s => (
            <Marker key={s.n} position={[s.display.lat, s.display.lon]} icon={dotIcon(s.n!, '#1d2126')}>
              <Popup>
                <b>{s.n}. {t(`network.stations.${s.kind}`)}</b>{s.label ? ` · ${s.label}` : ''}
                <div className="text-xs text-gray-600">{s.placeLabel}{s.year ? ` · ${s.year}` : ''}</div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      {layer !== 'life' && layer !== 'print' && origin.unmapped.length > 0 && (
        <p className="text-xs text-gray-600">
          {t('network.unmappedPersons', { count: origin.unmapped.length })}: {origin.unmapped.slice(0, 14).map(p => p.label).join(', ')}
          {origin.unmapped.length > 14 ? ` …` : ''}
        </p>
      )}
      {layer === 'life' && (
        <div className="text-xs text-gray-600">
          {life.mapped.length === 0 && life.unmapped.length === 0 && <p>{t('network.noStations')}</p>}
          {life.mapped.length > 0 && (
            <ol className="list-decimal pl-5">
              {life.mapped.map(s => (
                <li key={s.n}>{t(`network.stations.${s.kind}`)}{s.label ? ` · ${s.label}` : ''} — {s.placeLabel}{s.year ? `, ${s.year}` : ''}</li>
              ))}
            </ol>
          )}
          {life.unmapped.length > 0 && (
            <div className="mt-2">
              <div className="font-semibold text-gray-700">{t('network.unmappedStations')}</div>
              <ul className="list-disc pl-5">
                {life.unmapped.map((s, i) => (
                  <li key={i}>
                    {t(`network.stations.${s.kind}`)}{s.label ? ` · ${s.label}` : ''}{s.placeLabel ? ` — ${s.placeLabel}` : ''}{s.year ? `, ${s.year}` : ''}
                    <span className="ml-1 text-gray-400">({t(`network.reasons.${s.reason}`)})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RelationsMap;
```

Kaardi komponenti jsdom-is ei renderdata (Leaflet vajab päris DOM-i mõõte). Loogika on
Task 2 testides ja integratsioon Task 4 testis (mockitud `RelationsMap`).

- [ ] **Step 3:** `npm run typecheck` puhas; `npx vitest run src/locales` PASS
- [ ] **Step 4: Commit** `feat(prosopo): seoste kaart — päritolu, trükikohad, elukäik (#461)`

---

### Task 4: Vahekaart, päise nupp ja `#seosed-kaart`

**Files:** Modify `PersonRelations.tsx`, `PersonDetailPage.tsx`; test
`src/prosopography/components/relations/__tests__/PersonRelations.test.tsx`.

- [ ] **Step 1: Failivad testid** (lisa describe'i sisse; faili päisesse mock)

```tsx
vi.mock('../RelationsMap', () => ({ default: () => <div>KAART-MOCK</div> }));
```
```tsx
  it('Kaart vahekaart näitab kaarti (laisk)', async () => {
    impl.fn = async () => net([acad], [A]);
    renderIt();
    fireEvent.click(await screen.findByRole('tab', { name: 'Kaart' }));
    expect(await screen.findByText('KAART-MOCK')).toBeTruthy();
  });

  it('#seosed-kaart avab kaardi vahekaardi', async () => {
    impl.fn = async () => net([acad], [A]);
    render(<MemoryRouter initialEntries={['/persons/x#seosed-kaart']}><PersonRelations personId={F} /></MemoryRouter>);
    expect(await screen.findByText('KAART-MOCK')).toBeTruthy();
  });
```

- [ ] **Step 2:** FAIL (vahekaarti pole)
- [ ] **Step 3: Implementeeri** `PersonRelations.tsx`:
  - `import { useLocation } from 'react-router-dom'`, `lazy`, `Suspense`; `const RelationsMap = lazy(() => import('./RelationsMap'));`
  - prop `card?: ProsopoRecord | null` (import tüüp `../../types`)
  - `type Tab = 'graph' | 'timeline' | 'map' | 'table'`; `TABS = ['graph','timeline','map','table']`
  - `const location = useLocation(); useEffect(() => { if (location.hash === '#seosed-kaart') setTab('map'); }, [location.hash]);`
  - vahekaardi sisu: `{tab === 'map' && <Suspense fallback={null}><RelationsMap net={net} card={card ?? null} popover={popover} onHighlight={setHighlight} /></Suspense>}`
  - `Section`-i juurelemendile `id="seosed-kaart"` (brauser kerib hash'iga ise kohale)
- [ ] **Step 4:** `PersonDetailPage.tsx`: `<PersonRelations personId={id} card={person} />`. Päise
  nupp `relationMapUrl` asemel: `to="#seosed-kaart"` (`Link`). Kui `relationMapUrl` jääb
  kasutamata, eemalda see.
- [ ] **Step 5:** `npx vitest run src/prosopography src/locales` PASS; `npm run typecheck` puhas
- [ ] **Step 6: Commit** `feat(prosopo): Kaart vahekaart ja päise nupp avab selle (#461)`

---

### Task 5: Väravad ja bundle

- [ ] `npm run typecheck && npm test && npm run lint:ci` → puhas / kõik läbivad / ≤ 42
- [ ] `npm run build`: `RelationsMap-*.js` eraldi chunk; `PersonRelations` ja `PersonDetailPage`
  gzip ei kasva üle mõnesaja baidi (kaart on laisk). Numbrid PR-i kirjeldusse.
- [ ] Käsitsi pärast deploy'd: Fischer — Elukäik: 1 Lübeck 1636, 2 Magdeburg 1700,
  3 Magdeburg 1705; kaardita: Pfalz-Sulzbach (registris puudub), Liivimaa (koordinaadid puuduvad).
