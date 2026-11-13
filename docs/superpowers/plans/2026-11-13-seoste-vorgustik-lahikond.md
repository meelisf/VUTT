# Seoste võrgustik: lähikond esile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isikulehe „Seosed" → „Võrgustik" näitab lähikonda (nimedega, kaugus = ühiste teoste arv) ja kõiki teisi heleda ajajärjestuses servana; klõps lukustab valiku koos praeguse kaardiga, kaart on lohistatav.

**Architecture:** Kogu paigutus- ja lähikonnaloogika on uues puhtas moodulis `utils/closeCircle.ts` (testitav ilma DOM-ita). `RelationsGraph.tsx` kirjutatakse ümber selle peale; valiku ainus tõeallikas on olemasoleva hüpiku olek (`popover.state.pinned`). `RelationPopover.tsx` saab päisest lohistamise. Server ja teised vaated ei muutu.

**Tech Stack:** React 19, TypeScript, SVG käsitsi (teeke ei lisata), vitest + @testing-library/react (jsdom failipäises), react-i18next.

**Spec:** `docs/superpowers/specs/2026-11-13-seoste-vorgustik-lahikond-design.md` — loe enne alustamist tervikuna. **Issue:** #812. **Haru:** `feat/seoste-lahikond`.

## Global Constraints

- Koodikommentaarid eesti keeles. Iga uus fail algab rajakommentaariga nagu naabrid (`// src/…`).
- i18n (ADR 0011): uus võti korraga `src/locales/et/prosopography.json` JA `src/locales/en/prosopography.json`; eemaldatav võti mõlemast. Valvurid: `localeParity.test.ts`, `translationKeysResolve.test.ts`.
- „Samas teoses" = ühine **(teos, osa)** võti `` `${work_id}#${part_id ?? ''}` `` (ADR 0056, #464). Paljas `work_id` on viga.
- SVG `viewBox` on alati `0 0 900 600`. `many`-režiimi (kõrgus 760) ei ole.
- Kaart (hüpik) jääb `z-[1300]`.
- Uusi sõltuvusi ei lisata. Natiivset `alert`/`confirm` ei kasutata.
- Komponenditesti fail algab `/** @vitest-environment jsdom */`.
- Väravad enne iga commit'i: `npm run typecheck`, `npm test -- <muudetud testifailid>`. Lõpus täisväravad (Task 4). `lint:ci` lävi on `--max-warnings 41` — ära tõsta.
- Ajatelge, kaarti, loendit ja serverit EI muudeta.
- Commit'i sõnum lõpeb reaga `Co-Authored-By: Claude <noreply@anthropic.com>` (teostaja mudeli nimega).

## Review Focus

Sisendid, mida spekk eeldab, aga otse ei nimeta; iga rea test on omaniku-taskis.

1. **Filter muutub, kui kaart on kinnitatud ja valitud isik kaob võrgustikust** (nt „Kaastekst" linnuke maha) → graaf ei kuku, valikut ei joonistata, pilt on algkujul. *(Task 2)*
2. **Lähikonnas on ainult teoseta sugulased** (`workCount = 0` kõigil) → `max = 0`; koordinaadid ja raadiused on lõplikud arvud, mitte `NaN`. *(Task 1)*
3. **Serv on tühi või ühe isikuga; kõik servaisikud aastata** → ei jagata nulliga, üks märk „aeg teadmata" või mitte ühtki. *(Task 1)*
4. **Sugulasi on rohkem kui 15** → kõik sugulased on lähikonnas, teoste järgi kedagi juurde ei võeta, miski ei kuku. *(Task 1)*
5. **Kaart lohistatakse vaateaknast välja** (ka kitsal ekraanil) → jääb 8 px varuga vaateakna sisse; lohistamise lõpu `click` kaarti ei sulge. *(Task 3)*

---

### Task 1: Lähikonna loogika ja paigutus (`closeCircle.ts`)

**Files:**
- Create: `src/prosopography/utils/closeCircle.ts`
- Test: `src/prosopography/utils/__tests__/closeCircle.test.ts`

**Interfaces:**
- Consumes: `VisibleNetwork`, `VisiblePerson`, `KIND_ORDER` failist `src/prosopography/utils/network.ts` (ära muuda).
- Produces (kõik eksporditud):

```ts
export const CLOSE_MIN_WORKS = 2;
export const CLOSE_MAX = 15;
export const RIM_LABEL_MAX = 14;
export const GRAPH_SIZE = { w: 900, h: 600 } as const;

export function isKin(p: VisiblePerson): boolean;                    // on nähtav family-serv
export function scopeKeys(p: VisiblePerson): Set<string>;            // `${work_id}#${part_id ?? ''}`, ainult evidence'iga servad
/** id → (kaasosalise id → ühiste (teos, osa) võtmete arv). Isik ise ei ole oma kaardis. */
export function coParticipants(v: VisibleNetwork): Map<string, Map<string, number>>;
export function splitCloseCircle(v: VisibleNetwork): { close: VisiblePerson[]; rim: VisiblePerson[] };

export interface CloseNode { person: VisiblePerson; x: number; y: number; angle: number; r: number; f: number; }
export interface RimNode { person: VisiblePerson; x: number; y: number; angle: number; r: number; opacity: number; }
export interface RimTick { angle: number; year: number | null; }     // null = „aeg teadmata"
export interface CloseLayout { cx: number; cy: number; maxWorks: number; close: CloseNode[]; rim: RimNode[]; ticks: RimTick[]; }
export function closeCircleLayout(v: VisibleNetwork): CloseLayout;

/** Hoiab järjekorra, tagab naabrite vahel vähemalt `gap`; sisend ei pea olema sorditud.
 *  Tagastab uued y-id sisendi järjekorras. */
export function spreadY(ys: number[], gap: number): number[];
```

Reeglid (spekist, täpsete arvudega):

- `splitCloseCircle`: `v.persons.length <= 15` → kõik `close`, `rim` tühi. Muidu `kin = persons.filter(isKin)`; `others = persons.filter(p => !isKin(p) && p.workCount >= 2)` sorditud `workCount` kahanevalt, siis `label.localeCompare`; `close = [...kin, ...others.slice(0, Math.max(0, 15 - kin.length))]`; ülejäänud `rim`.
- `closeCircleLayout`, lähikond: järjestus `KIND_ORDER.indexOf(kind)` → `firstYear ?? 9999` → `label`. `angle_i = -π/2 + ((i + 0.5) / n)·2π + (n < 5 ? π/4 : 0)`. `maxWorks = max(workCount)` üle lähikonna (tühi → 0).
  - `f`: sugulane ja `workCount < 2` → `0.625`; muidu `workCount <= 1` → `1.0`; muidu `maxWorks <= 2` → `0.75`; muidu `1 − 0.5·(workCount − 2)/(maxWorks − 2)`.
  - `x = 450 + 265·f·cos`, `y = 300 + 180·f·sin`, `r = 5 + √(workCount / max(1, maxWorks))·6`.
- Serv: järjestus `firstYear ?? Infinity` → `KIND_ORDER.indexOf(kind)` → `label`. `angle_i = -π/2 + 0.06 + ((i + 0.5)/n)·(2π − 0.12)`. `k = (n > 110 && i % 2 === 1) ? 0.94 : 1`. `x = 450 + 405·k·cos`, `y = 300 + 266·k·sin`. `workCount >= 2` → `r = 4, opacity = 0.6`, muidu `r = 3, opacity = 0.32`.
- Märgid: käi serv järjest läbi; kui isiku `firstYear` erineb eelmise omast (esimene alati) JA `angle_i − viimaseMärgiNurk >= 0.13` (`viimaseMärgiNurk` = selle ISIKU nurk, kelle juures viimane märk lisati; alguses `-Infinity`), lisa märk nurgaga `-π/2 + 0.06 + (i/n)·(2π − 0.12)` ja `year = firstYear` (aastata → `null`). „Eelmise aasta" uuendatakse igal isikul, ka siis, kui märki ei lisatud.

- [ ] **Step 1: Kirjuta kukkuvad testid** — `closeCircle.test.ts`

```ts
// src/prosopography/utils/__tests__/closeCircle.test.ts
import { describe, it, expect } from 'vitest';
import { applyFilters, DEFAULT_FILTER } from '../network';
import { closeCircleLayout, coParticipants, splitCloseCircle, spreadY, isKin } from '../closeCircle';
import type { PersonNetwork, NetworkEdge } from '../../services/networkService';

const F = 'vutt:Pfocus';
const P = (id: string, label = id) => ({ id, label, birth_year: null, death_year: null, origin: null });
const W = (work_id: string, year: number | null = 1658) => ({ work_id, title: work_id, year, place: null, genres: [], restricted: false });
const E = (kind: NetworkEdge['kind'], other: string, work: string | null, year: number | null = 1658, part?: string): NetworkEdge => ({
  kind, from: other, to: F, directed: false, year: work ? year : null, place: null,
  evidence: work ? { work_id: work, pages: [], ...(part ? { part_id: part } : {}) } : null,
});
/** n isikut p0…; `works(i)` annab isiku teoste id-d. */
function net(n: number, works: (i: number) => string[], extra: NetworkEdge[] = [], year = (w: string) => 1658 as number | null) {
  const edges = Array.from({ length: n }, (_, i) => works(i).map(w => E('cotext', `p${i}`, w, year(w)))).flat().concat(extra);
  const ids = [...new Set(edges.map(e => e.evidence?.work_id).filter((w): w is string => !!w))];
  const raw: PersonNetwork = { focus: P(F), persons: Array.from({ length: n }, (_, i) => P(`p${i}`)), works: ids.map(w => W(w, year(w))), edges };
  return applyFilters(raw, DEFAULT_FILTER);
}
const ids = (xs: { id: string }[]) => xs.map(x => x.id).sort();

describe('splitCloseCircle', () => {
  it('kuni 15 isikut: kõik lähikonnas', () => {
    const { close, rim } = splitCloseCircle(net(15, i => [`w${i}`]));
    expect(close).toHaveLength(15); expect(rim).toHaveLength(0);
  });
  it('üle 15: lähikonnas ≥ 2 teosega isikud ja sugulased', () => {
    const v = net(20, i => (i === 0 ? ['a', 'b', 'c'] : i === 1 ? ['a', 'b'] : [`w${i}`]), [E('family', 'p5', null)]);
    const { close, rim } = splitCloseCircle(v);
    expect(ids(close)).toEqual(['p0', 'p1', 'p5']); expect(rim).toHaveLength(17);
  });
  it('ülempiir 15: sugulane mahub alati, teoste järgi nõrgimad jäävad servale', () => {
    // p0..p19 kahe teosega (p0 kolmega), p20 ainult sugulane
    const v = net(21, i => (i === 20 ? [] : i === 0 ? ['x', 'y', 'z'] : [`a${i}`, `b${i}`]), [E('family', 'p20', null)]);
    const { close, rim } = splitCloseCircle(v);
    expect(close).toHaveLength(15);
    expect(close.map(p => p.id)).toContain('p20'); expect(close.map(p => p.id)).toContain('p0');
    expect(rim).toHaveLength(6);
  });
  it('üle 15 ja keegi ei kvalifitseeru: lähikond tühi', () => {
    expect(splitCloseCircle(net(16, i => [`w${i}`])).close).toHaveLength(0);
  });
  it('üle 15 sugulase: kõik sugulased, teoste järgi kedagi juurde ei tule', () => {
    const fam = Array.from({ length: 17 }, (_, i) => E('family', `p${i}`, null));
    const { close } = splitCloseCircle(net(20, i => (i >= 17 ? ['a', 'b'] : []), fam));
    expect(close).toHaveLength(17); expect(close.every(isKin)).toBe(true);
  });
});

describe('coParticipants', () => {
  it('ühine teos seob, kaal = ühiste võtmete arv', () => {
    const co = coParticipants(net(3, i => (i === 2 ? ['z'] : ['a', 'b'])));
    expect(co.get('p0')?.get('p1')).toBe(2); expect(co.get('p0')?.has('p2')).toBe(false); expect(co.get('p0')?.has('p0')).toBe(false);
  });
  it('sama teose eri osad EI seo (kirjakogu)', () => {
    const v = net(2, () => [], [E('dedicated', 'p0', 'kogu', 1660, 'k1'), E('dedicated', 'p1', 'kogu', 1661, 'k2')]);
    expect(coParticipants(v).get('p0')?.has('p1') ?? false).toBe(false);
  });
});

describe('closeCircleLayout', () => {
  const finite = (l: ReturnType<typeof closeCircleLayout>) =>
    [...l.close, ...l.rim].every(n => Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.r));
  it('rohkem ühiseid teoseid → fookusele lähemal', () => {
    const l = closeCircleLayout(net(20, i => (i === 0 ? ['a', 'b', 'c', 'd'] : i === 1 ? ['a', 'b'] : [`w${i}`])));
    const f = Object.fromEntries(l.close.map(n => [n.person.id, n.f]));
    expect(f.p0).toBeCloseTo(0.5); expect(f.p1).toBeCloseTo(1.0);
    expect(l.cx).toBe(450); expect(l.cy).toBe(300);
  });
  it('kõigil kaks teost → f = 0.75; teoseta sugulane → 0.625', () => {
    const l = closeCircleLayout(net(20, i => (i < 2 ? ['a', 'b'] : i === 2 ? [] : [`w${i}`]), [E('family', 'p2', null)]));
    const f = Object.fromEntries(l.close.map(n => [n.person.id, n.f]));
    expect(f.p0).toBeCloseTo(0.75); expect(f.p2).toBeCloseTo(0.625);
  });
  it('serv on ajajärjestuses, aastata lõpus; märgid aasta vahetusel', () => {
    const year = (w: string) => (w === 'w3' ? null : w === 'w2' ? 1640 : 1650);
    const l = closeCircleLayout(net(16, i => [i === 3 ? 'w3' : i === 2 ? 'w2' : `v${i}`], [], year));
    expect(l.rim[0].person.id).toBe('p2'); expect(l.rim.at(-1)!.person.id).toBe('p3');
    expect(l.ticks.map(t => t.year)).toEqual([1640, 1650, null]);
    for (let i = 1; i < l.rim.length; i++) expect(l.rim[i].angle).toBeGreaterThan(l.rim[i - 1].angle);
  });
  it('üle 110 servaisiku: iga teine täpp sissepoole', () => {
    const l = closeCircleLayout(net(120, i => [`w${i}`]));
    const d = (n: { x: number; y: number }) => Math.hypot((n.x - 450) / 405, (n.y - 300) / 266);
    expect(d(l.rim[0])).toBeCloseTo(1); expect(d(l.rim[1])).toBeCloseTo(0.94);
  });
  it('Review Focus 2: ainult teoseta sugulased → lõplikud arvud', () => {
    const l = closeCircleLayout(net(3, () => [], [0, 1, 2].map(i => E('family', `p${i}`, null))));
    expect(l.close).toHaveLength(3); expect(l.maxWorks).toBe(0); expect(finite(l)).toBe(true);
  });
  it('Review Focus 3: üks isik; kõik servaisikud aastata', () => {
    expect(finite(closeCircleLayout(net(1, () => ['a'])))).toBe(true);
    const l = closeCircleLayout(net(16, i => [`w${i}`], [], () => null));
    expect(finite(l)).toBe(true); expect(l.ticks.map(t => t.year)).toEqual([null]);
  });
});

describe('spreadY', () => {
  it('lükkab kattuvad lahku, järjekord ja sisendi indeksid säilivad', () => {
    const out = spreadY([10, 12, 40, 11], 10);
    const sorted = [...out].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(10 - 1e-9);
    expect(out[0]).toBeLessThan(out[3]); expect(out[3]).toBeLessThan(out[1]); expect(out[2]).toBeGreaterThanOrEqual(40);
  });
  it('piisava vahega sisend ei muutu', () => { expect(spreadY([0, 20, 40], 10)).toEqual([0, 20, 40]); });
});
```

- [ ] **Step 2: Veendu, et kukub** — `npm test -- src/prosopography/utils/__tests__/closeCircle.test.ts` → FAIL (moodulit ei ole).

- [ ] **Step 3: Kirjuta `closeCircle.ts`** ülaltoodud signatuuride ja reeglite järgi. `spreadY`: sordi indeksid y järgi, käi ülevalt alla ja tõsta iga järgmine vähemalt `eelmine + gap` peale (ainult allapoole lükkamine; piire ei rakenda).

- [ ] **Step 4: Veendu, et läbib** — sama käsk → PASS; `npm run typecheck` → vigadeta.

- [ ] **Step 5: Commit** — `git add src/prosopography/utils/closeCircle.ts src/prosopography/utils/__tests__/closeCircle.test.ts && git commit -m "feat(seosed): lähikonna loogika ja paigutus (#812)"`

---

### Task 2: `RelationsGraph` ümberkirjutus

**Files:**
- Modify: `src/prosopography/components/relations/RelationsGraph.tsx` (terve fail)
- Modify: `src/prosopography/utils/network.ts` — eemalda `radialLayout`, `RadialNode`, `LABEL_ALL_MAX`, `LABEL_SHARE`, `LABEL_MIN`, `coEdges`
- Modify: `src/prosopography/utils/__tests__/network.test.ts` — eemalda `describe('radialLayout')`, `describe('radialLayout sildid (arvustuse M1)')`, `describe('coEdges')` ja osade-ploki test „kaaslaste serv ainult sama osa…" (asendus on Task 1 `coParticipants` test); paranda import
- Modify: `src/locales/et/prosopography.json`, `src/locales/en/prosopography.json`
- Test: `src/prosopography/components/relations/__tests__/RelationsViews.test.tsx` (asenda `describe('RelationsGraph')`)

**Interfaces:**
- Consumes: Task 1 eksport (`closeCircleLayout`, `coParticipants`, `spreadY`, `RIM_LABEL_MAX`, `GRAPH_SIZE`, `isKin`); `usePopover` tagastus (`state`, `hover`, `leave`, `pin`, `close`) ja `PopoverState { personId, x, y, pinned }` failist `RelationPopover.tsx`; `personKinds`, `STRONG`, `familyRelation` failist `network.ts`; `KIND_COLOR`, `KindMark` failist `kindStyle.ts`.
- Produces: komponendi props EI muutu (`net`, `popover`, `highlight`, `onHighlight`) — `PersonRelations.tsx` jääb puutumata. DOM-leping testidele:
  - iga isiku `<g>`: `data-testid="node-<id>"`, `data-ring="close" | "rim"`, `data-lit="true" | "false"`;
  - valiku rõngas: `data-testid="selected-ring"`;
  - servanimi (valiku ajal): `data-testid="rim-label-<id>"`;
  - lähikonna kaasosaliste kaar: `data-testid="co-arc"`.

Käitumine (spekk „Vaade" ja „Käitumine"; siin ainult otsused, mida spekk lahti jätab):

- `selected = popover.state?.pinned && net.persons.some(p => p.id === popover.state.personId) ? popover.state.personId : null`. `active = selected ?? highlight`. Graafis eraldi valiku-`useState`-i EI OLE.
- `lit(id) = active === null || id === active || coParticipants.get(active)?.has(id)`. Mitte-lit: rühma `opacity 0.15`, joon `0.1`. Lit servatäpp: `fill-opacity 0.95`.
- Sündmused isiku `<g>`-l: `onMouseEnter` → kui `!selected`: `onHighlight(id)`; alati `popover.hover(id, e)` (hook ise ignoreerib seda kinnitatud olekus); kui `selected`: sea lokaalne `hoverId`. `onMouseMove` → `popover.hover`. `onMouseLeave` → kui `!selected`: `onHighlight(null)`; `popover.leave()`; `hoverId = null`. `onClick` → `popover.pin(id, e)` (EI kutsu `onHighlight`-i — valik tuleb hüpiku olekust).
- Valiku ajal: servanimed kuni `RIM_LABEL_MAX` kaasosalisele, kahanevalt `coParticipants.get(selected).get(id)` järgi; tekst täpist ringi sisepoole (ankur `cos > 0.25` → `end`, `< −0.25` → `start`, muidu `middle`), y-d `spreadY`-ga vahega 12 eraldi vasaku ja parema poole kohta. Lisaks `hoverId` servatäpi nimi, kui see pole juba nähtav.
- Lähikonna silt: nimi (`fontWeight 600`, 24 märki + „…"), teine rida: suguluse liik (`familyRelation(...)?.type`, kui on) ja/või `t('network.sharedWorks', { count })` (kui `workCount > 0`), eraldajaga „ · ". Siltide y-d lahku `spreadY`-ga (vahe 28) eraldi vasaku ja parema ankru rühmas; keskankruga sildid jäävad paika.
- Joon fookusest lähikonna isikuni: nagu praegune kood (`personKinds`, paralleelnihe), jämedus `1.5 + (workCount / max(1, maxWorks))·5`, pereserv `2.5` ja `strokeDasharray '4 3'`.
- Aastamärk: kriips servaovaalilt 7 px sisse ja 9 px välja, tekst teguril `(422, 282)`; `year === null` → `t('network.undated')`.
- SVG all: `<p className="text-xs text-gray-500">` tekstiga `t('network.closeHint')`; kui `layout.close.length === 0`, selle asemel `t('network.noCloseCircle')`.
- `aria-label` jääb praegusel kujul.

i18n (mõlemas failis `network` all): eemalda `coLines`, `focusOnly`, `labelsHint`. Lisa:

| võti | et | en |
|---|---|---|
| `closeHint` | Nimega on lähikond: vähemalt kaks ühist teost või sugulane. Serval on kõik teised ajajärjestuses. Klõps näitab, kellega isik koos esines. | Named persons are the close circle: at least two shared works, or kin. Everyone else is on the rim in time order. Click to see who appeared together with a person. |
| `noCloseCircle` | Lähikond ei eristu: kõigil on fookusega üks ühine teos. Nimed tulevad hõljutusel. | No close circle stands out: everyone shares a single work with the focus. Hover to see names. |

- [ ] **Step 1: Asenda `describe('RelationsGraph')` kukkuvate testidega**

```tsx
// RelationsViews.test.tsx — faili ülaossa lisa import ja abilised
import type { PopoverState } from '../RelationPopover';
const G = (n: number, works: (i: number) => string[]): PersonNetwork => ({
  focus: NET.focus,
  persons: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, label: `Isik ${i}`, birth_year: null, death_year: null, origin: null })),
  works: [...new Set(Array.from({ length: n }, (_, i) => works(i)).flat())].map(w => ({ work_id: w, title: w, year: 1658, place: null, genres: [], restricted: false })),
  edges: Array.from({ length: n }, (_, i) => works(i).map(w => ({ kind: 'cotext' as const, from: `p${i}`, to: F, directed: false, year: 1658, place: null, evidence: { work_id: w, pages: [] } }))).flat(),
});
// p0: a,b,c · p1: a,b · p2: a · ülejäänud oma teos
const big = applyFilters(G(20, i => (i === 0 ? ['a', 'b', 'c'] : i === 1 ? ['a', 'b'] : i === 2 ? ['a'] : [`w${i}`])), DEFAULT_FILTER);
const fakePopover = (state: PopoverState | null) =>
  ({ state, hover: vi.fn(), leave: vi.fn(), pin: vi.fn(), close: vi.fn() }) as unknown as ReturnType<typeof usePopover>;
const graph = (pop: ReturnType<typeof usePopover>, highlight: string | null = null, onHighlight = vi.fn(), net = big) =>
  render(<MemoryRouter><RelationsGraph net={net} popover={pop} highlight={highlight} onHighlight={onHighlight} /></MemoryRouter>);
const pinnedAt = (personId: string): PopoverState => ({ personId, x: 0, y: 0, pinned: true });

describe('RelationsGraph', () => {
  it('lähikond nimedega, serv nimedeta; viewBox 900×600', () => {
    const { container } = graph(fakePopover(null));
    expect(screen.getByText('Fookus Isik')).toBeTruthy();
    expect(screen.getByText('Isik 0')).toBeTruthy();
    expect(screen.queryByText('Isik 7')).toBeNull();
    expect(container.querySelectorAll('[data-ring="close"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-ring="rim"]')).toHaveLength(18);
    expect(container.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 900 600');
    expect(container.querySelector('[data-testid="co-arc"]')).toBeNull();
  });
  it('hõljutus teatab esiletõstu; esiletõst jätab heledaks kaasosalised', () => {
    const onHighlight = vi.fn();
    graph(fakePopover(null), null, onHighlight);
    fireEvent.mouseEnter(screen.getByTestId('node-p0'));
    expect(onHighlight).toHaveBeenCalledWith('p0');
    const { container } = graph(fakePopover(null), 'p0');
    const lit = (id: string) => container.querySelector(`[data-testid="node-${id}"]`)!.getAttribute('data-lit');
    expect(lit('p0')).toBe('true'); expect(lit('p1')).toBe('true'); expect(lit('p2')).toBe('true'); expect(lit('p7')).toBe('false');
    expect(container.querySelectorAll('[data-testid="co-arc"]')).toHaveLength(1);   // p0–p1
  });
  it('klõps kinnitab kaardi, esiletõstu otse ei sea', () => {
    const pop = fakePopover(null); const onHighlight = vi.fn();
    graph(pop, null, onHighlight);
    fireEvent.click(screen.getByTestId('node-p1'));
    expect(pop.pin).toHaveBeenCalledWith('p1', expect.anything());
    expect(onHighlight).not.toHaveBeenCalled();
  });
  it('kinnitatud kaart = valik: rõngas, servanimed; hõljutus ei muuda esiletõstu', () => {
    const onHighlight = vi.fn();
    graph(fakePopover(pinnedAt('p0')), null, onHighlight);
    expect(screen.getByTestId('selected-ring')).toBeTruthy();
    expect(screen.getByTestId('rim-label-p2').textContent).toContain('Isik 2');
    expect(screen.queryByTestId('rim-label-p7')).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId('node-p7'));
    expect(onHighlight).not.toHaveBeenCalled();
    expect(screen.getByTestId('rim-label-p7')).toBeTruthy();          // hõljutatud täpi nimi
    expect(screen.getByTestId('node-p9').getAttribute('data-lit')).toBe('false');
  });
  it('kaardi sulgemine taastab algkuju', () => {
    const { rerender } = graph(fakePopover(pinnedAt('p0')));
    rerender(<MemoryRouter><RelationsGraph net={big} popover={fakePopover(null)} highlight={null} onHighlight={() => {}} /></MemoryRouter>);
    expect(screen.queryByTestId('selected-ring')).toBeNull();
    expect(screen.getByTestId('node-p9').getAttribute('data-lit')).toBe('true');
  });
  it('Review Focus 1: valitud isik ei ole enam võrgustikus → ei kuku, valikut ei ole', () => {
    graph(fakePopover(pinnedAt('kadunud')));
    expect(screen.queryByTestId('selected-ring')).toBeNull();
    expect(screen.getByTestId('node-p9').getAttribute('data-lit')).toBe('true');
  });
  it('tühi lähikond: selgitav rida', () => {
    graph(fakePopover(null), null, vi.fn(), applyFilters(G(16, i => [`w${i}`]), DEFAULT_FILTER));
    expect(screen.getByText(/Lähikond ei eristu/)).toBeTruthy();
  });
  it('väike võrgustik: kõik nimedega (olemasolev fikstuur)', () => {
    graph(fakePopover(null), null, vi.fn(), v);
    expect(screen.getByText('Anna Praeses')).toBeTruthy(); expect(screen.getByText('Undated Isik')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Veendu, et kukub** — `npm test -- src/prosopography/components/relations/__tests__/RelationsViews.test.tsx` → `RelationsGraph` testid FAIL, teised PASS.

- [ ] **Step 3: Kirjuta `RelationsGraph.tsx` ümber** ülaltoodud lepingu järgi; uuenda faili päisekommentaar (uus kirjeldus, viide #812). Lisa tõlkevõtmed, eemalda vanad.

- [ ] **Step 4: Eemalda surnud kood** `network.ts`-ist ja vastavad testid `network.test.ts`-ist. Kontroll: `grep -rn "radialLayout\|coEdges\|coLines\|focusOnly\|labelsHint" src` → tühi.

- [ ] **Step 5: Veendu, et läbib** — `npm run typecheck && npm test -- src/prosopography localeParity translationKeysResolve` → PASS.

- [ ] **Step 6: Commit** — `git add -A src/prosopography src/locales && git commit -m "feat(seosed): võrgustik näitab lähikonda, serv ajajärjestuses (#812)"`

---

### Task 3: Lohistatav kaart

**Files:**
- Modify: `src/prosopography/components/relations/RelationPopover.tsx`
- Modify: `src/locales/et/prosopography.json`, `src/locales/en/prosopography.json`
- Test: `src/prosopography/components/relations/__tests__/RelationPopover.test.tsx`

**Interfaces:**
- Consumes: olemasolev `PopoverState`, `usePopover` (hook'i EI muudeta).
- Produces: `RelationPopover` props ei muutu. Kinnitatud kaardi nimerida on lohistuskäepide: `data-testid="popover-drag"`, `title={t('network.dragHint')}`, `cursor: move`, `touch-action: none`.

Otsused:

- Lohistamise nihe on komponendi lokaalne olek `{ dx, dy }`; lähtestub `{0, 0}`-ks iga kord, kui `state` prop muutub (uus kinnitus või hõljutus). Lõppasukoht = praegune `pos` + nihe, piiratud: `8 <= left <= innerWidth − laius − 8`, `8 <= top <= innerHeight − kõrgus − 8` (kui kaart on vaateaknast suurem, võidab alumine piir 8).
- `pointerdown` käepidemel alustab (ainult `state.pinned`, ainult primaarne nupp); `pointermove` ja `pointerup` kuulatakse `window`-il lohistamise ajaks ja eemaldatakse lõpus ning unmount'il. `pointerdown`-il `preventDefault()` (teksti valik ei alga). Ära kasuta `setPointerCapture`-it ega kontrolli `isPrimary`/`pointerId`-d — jsdom neid ei kanna ja testid saadavad `MouseEvent`-i pointer-tüübiga; kontroll on `button === 0`.
- Käepide ei sisalda linke; kaardi sisu kerimine ja lingid jäävad puutumata. Olemasolev „klõps mujale sulgeb" jääb: lohistuse lõpu `click` sünnib kaardi sees ega sulge.
- Hõljukvihje (`!state.pinned`) ei ole lohistatav ja käepideme atribuute ei kanna.

i18n: `network.dragHint` — et „Lohista, et liigutada", en „Drag to move".

- [ ] **Step 1: Lisa kukkuvad testid** faili `RelationPopover.test.tsx`

```tsx
// jsdom-is ei pruugi PointerEvent koordinaate kanda → MouseEvent pointer-tüübiga
const ptr = (el: Element | Window, type: string, x: number, y: number) =>
  act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })); });
const box = () => document.querySelector('[data-relation-popover]') as HTMLElement;
const at = () => ({ left: parseFloat(box().style.left), top: parseFloat(box().style.top) });

describe('RelationPopover lohistamine', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 300, height: 200, left: 0, top: 0, right: 300, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
  });
  afterEach(() => vi.restoreAllMocks());

  it('käepidemest lohistamine nihutab kaarti', () => {
    renderPopover(true);
    const before = at();
    ptr(screen.getByTestId('popover-drag'), 'pointerdown', 100, 100);
    ptr(window, 'pointermove', 160, 140);
    ptr(window, 'pointerup', 160, 140);
    expect(at()).toEqual({ left: before.left + 60, top: before.top + 40 });
  });
  it('Review Focus 5: jääb vaateaknasse 8 px varuga', () => {
    renderPopover(true);
    ptr(screen.getByTestId('popover-drag'), 'pointerdown', 100, 100);
    ptr(window, 'pointermove', 5000, 5000);
    expect(at()).toEqual({ left: 1000 - 300 - 8, top: 800 - 200 - 8 });
    ptr(window, 'pointermove', -5000, -5000);
    expect(at()).toEqual({ left: 8, top: 8 });
    ptr(window, 'pointerup', -5000, -5000);
  });
  it('pärast pointerup-i liikumine ei mõju', () => {
    renderPopover(true);
    ptr(screen.getByTestId('popover-drag'), 'pointerdown', 100, 100);
    ptr(window, 'pointerup', 100, 100);
    const a = at(); ptr(window, 'pointermove', 400, 400);
    expect(at()).toEqual(a);
  });
  it('hõljukvihjel käepidet ei ole', () => {
    renderPopover(false);
    expect(screen.queryByTestId('popover-drag')).toBeNull();
  });
  it('uus kinnitus lähtestab nihke; lohistus ei sulge kaarti', () => {
    const net = applyFilters(NET, DEFAULT_FILTER);
    const onClose = vi.fn();
    const ui = (x: number) => <MemoryRouter><RelationPopover state={{ personId: 'vutt:Ps', x, y: 10, pinned: true }} net={net} onClose={onClose} /></MemoryRouter>;
    const { rerender } = render(ui(10));
    ptr(screen.getByTestId('popover-drag'), 'pointerdown', 100, 100);
    ptr(window, 'pointermove', 300, 300); ptr(window, 'pointerup', 300, 300);
    fireEvent.click(screen.getByTestId('popover-drag'));
    expect(onClose).not.toHaveBeenCalled();
    rerender(ui(50));
    expect(at()).toEqual({ left: 50 + 14, top: 10 + 14 });
  });
});
```

Impordi juurde: `vi, beforeEach, afterEach` paketist `vitest`.

- [ ] **Step 2: Veendu, et kukub** — `npm test -- src/prosopography/components/relations/__tests__/RelationPopover.test.tsx` → uued FAIL, vanad PASS.

- [ ] **Step 3: Teosta lohistamine** `RelationPopover.tsx`-is ülaltoodud otsuste järgi; uuenda faili päisekommentaar (kinnitatud kaart on lohistatav, #812). Lisa `dragHint` mõlemasse keelde.

- [ ] **Step 4: Veendu, et läbib** — sama käsk → PASS; `npm run typecheck`; `npm test -- localeParity translationKeysResolve` → PASS.

- [ ] **Step 5: Commit** — `git add -A src/prosopography src/locales && git commit -m "feat(seosed): kinnitatud kaart on lohistatav (#812)"`

---

### Task 4: Väravad, käsitsi kontroll, dokumendid

**Files:**
- Modify: `docs/README.md` (lahtiste disainide rida, kui vaja)
- Move (pärast merge'i, mitte selles PR-is): spekk ja plaan `_archive/` alla

- [ ] **Step 1: Täisväravad** — `npm run typecheck && npm test && npm run lint:ci && npm run build` → kõik rohelised; `lint:ci` hoiatuste arv ≤ 41 (kui langes, langeta läve `package.json`-is ja `ci.yml`-is).

- [ ] **Step 2: Käsitsi kontroll päris andmetega** (CLAUDE.md „UI kontroll tootmisandmetega": tunnel eraldi aknas + `npm run dev`; ära logi sisse, ära salvesta). Ava ja kontrolli spekist „Vaade"/„Käitumine" iga punkti kolmel isikul:
  - `/persons/vutt:Pz5yvqo` (Uppendorf): 4 nimega (Dau, Hein lähemal; Sjöberg, Glück kaugemal), 19 serval.
  - `/persons/vutt:Pu837uz` (Fischer): 7 nimega, sh abikaasa ja tütar rohelise rombiga ja suguluse liigiga; klõps kirjakogu korrespondendil süttib ainult sama kirja osalised.
  - `/persons/vutt:Pfxxxsc` (Luden): 15 nimega, ükski silt ei kattu; klõps „Daniel Gruuf" → kaasosalised koonduvad serval aastatesse 1647–1651, nimed loetavad; kaardi lohistamine ja sulgemine (nupp, Esc, klõps mujale) töötavad, pilt taastub.
  - Lisaks: linnukesed „Kaastekst"/„Trükkal" kinnitatud kaardiga ei kukuta vaadet; vahekaardid Ajatelg/Kaart/Loend käituvad nagu enne, kaart on ka seal lohistatav.
  Kui tunnelit ei saa, kirjuta PR-i selgelt, et käsitsi kontroll jäi tegemata — ära väida, et tehtud.

- [ ] **Step 3: PR** harust `feat/seoste-lahikond` → `main`, kirjelduses „Closes #812", ekraanipildid kolmest isikust, käsitsi kontrolli tulemus. Merge-stiil on merge-commit; merge'ib kasutaja.

## Self-review märkmed (plaani autorilt)

- Speki iga jaotis on kaetud: „Kes on lähikonnas" ja paigutus → Task 1; „Vaade", „Mis kaob", „Hõljutus", „Valik" → Task 2; „Lohistatav kaart" → Task 3; „Piirangud" → Global Constraints; „Testid" → Taskide Step 1.
- Siltide kokkupõrge (speki „Ehitaja otsustada") on plaanis otsustatud: `spreadY` vasaku ja parema ankru rühmas. Kui Ludeni 15 nime ikka kattuvad (Task 4 Step 2), on lubatud lisada juhtjoon või vähendada vahet — nõue on loetavus, mitte see algoritm.
- `PersonRelations.tsx` jääb puutumata: tema `highlight` lähtestub `mouseleave`-ga ja valik elab hüpiku olekus.
