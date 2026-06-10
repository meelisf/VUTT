# Sajandi-dateering ja kattuvusfilter — implementatsiooniplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teose dateering toetab sajandi-täpsust ("19. saj") — parsimine, kattuvuspõhine filtreerimine Meilisearchis ja tõlgitud kuvamine (et/en).

**Architecture:** `_metadata.json` ei muutu; `year_start`/`year_end` tuletatakse indekseerimisel jagatud parseriga (TS + Python port). Filter muutub vahemike kattuvuseks. Kuvamisel tõlgitakse ainult sajandimuster; "ca." ja vahemikud jäävad tooreks.

**Tech Stack:** React/TypeScript (vitest), FastAPI/Python 3.9 (pytest), Meilisearch.

**Spek:** `docs/superpowers/specs/2026-06-10-century-dating-design.md`

**NB (Python):** käivita testid alati `.venv/bin/python -m pytest` (host venv). Python 3.9 ühilduvus: `Optional`/`Tuple` typing-moodulist, MITTE `int | None`.

---

### Task 1: Frontend parser — sajandimuster `parseYearDisplayRange`-is

**Files:**
- Test: `src/utils/__tests__/yearDisplayUtils.test.ts` (uus)
- Modify: `src/utils/yearDisplayUtils.ts`

- [ ] **Step 1: Kirjuta failing testid**

Loo `src/utils/__tests__/yearDisplayUtils.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseYearDisplayRange } from '../yearDisplayUtils';

describe('parseYearDisplayRange', () => {
  // Olemasolev käitumine (regressioonikaitse)
  it('täpne aasta', () => {
    expect(parseYearDisplayRange(1750, null)).toEqual({ start: 1750, end: 1750 });
  });
  it('ca. aasta → ±10', () => {
    expect(parseYearDisplayRange(1750, 'ca. 1750')).toEqual({ start: 1740, end: 1760 });
  });
  it('vahemik', () => {
    expect(parseYearDisplayRange(null, '1670–1690')).toEqual({ start: 1670, end: 1690 });
  });
  it('vahemik sidekriipsuga', () => {
    expect(parseYearDisplayRange(null, '1686-1696')).toEqual({ start: 1686, end: 1696 });
  });
  it('tühi → null', () => {
    expect(parseYearDisplayRange(null, null)).toBeNull();
    expect(parseYearDisplayRange(0, '')).toBeNull();
  });

  // Uus: sajand
  it('sajand "19. saj"', () => {
    expect(parseYearDisplayRange(null, '19. saj')).toEqual({ start: 1801, end: 1900 });
  });
  it('sajand "19. sajand"', () => {
    expect(parseYearDisplayRange(null, '19. sajand')).toEqual({ start: 1801, end: 1900 });
  });
  it('sajand punktita "19 saj"', () => {
    expect(parseYearDisplayRange(null, '19 saj')).toEqual({ start: 1801, end: 1900 });
  });
  it('sajand tühikutega ja suurtähega', () => {
    expect(parseYearDisplayRange(null, '  17. Saj  ')).toEqual({ start: 1601, end: 1700 });
  });
  it('1-kohaline sajand "9. saj"', () => {
    expect(parseYearDisplayRange(null, '9. saj')).toEqual({ start: 801, end: 900 });
  });
  it('sajand võidab numeric-fallbacki', () => {
    expect(parseYearDisplayRange(1850, '19. saj')).toEqual({ start: 1801, end: 1900 });
  });
});
```

- [ ] **Step 2: Käivita testid — sajanditestid peavad FAILima**

Run: `npx vitest run src/utils/__tests__/yearDisplayUtils.test.ts`
Expected: olemasoleva käitumise testid PASS, sajanditestid FAIL (parseYearDisplayRange tagastab `{start: …numeric…}` või null).

- [ ] **Step 3: Implementeeri sajandimuster**

`src/utils/yearDisplayUtils.ts` — lisa eksporditud regex faili algusesse ja sajandikontroll funktsiooni algusesse (ENNE `\d{4}` otsimist):

```ts
// Parsib year_display stringi filtri aastaajavahemikuks.
// "19. saj"  → { start: 1801, end: 1900 }
// "ca. 1750" → { start: 1740, end: 1760 }
// "1686-1696" → { start: 1686, end: 1696 }
// "1750"      → { start: 1750, end: 1750 }
// Tagastab null kui sobivat aastat ei leita.
// NB: peegelloogika Pythonis: server/utils.py parse_year_range

// Sajandimuster: "19. saj", "19. sajand", "19 saj" (stringi algusest, trimmituna)
export const CENTURY_RE = /^(\d{1,2})\.?\s*saj/i;

export function parseYearDisplayRange(
  numericYear: number | string | null | undefined,
  yearDisplay: string | null | undefined
): { start: number; end: number } | null {
  const numeric = Number(numericYear) || 0;

  if (yearDisplay) {
    const cm = yearDisplay.trim().match(CENTURY_RE);
    if (cm) {
      // N. sajand = (N-1)*100+1 … N*100 (ajaloolaste konventsioon: 19. saj = 1801–1900)
      const c = Number(cm[1]);
      return { start: (c - 1) * 100 + 1, end: c * 100 };
    }

    const isApprox = /\bca\.?\b/i.test(yearDisplay);
    const years = [...yearDisplay.matchAll(/\d{4}/g)].map(m => Number(m[0]));

    if (years.length >= 2) {
      return { start: years[0], end: years[years.length - 1] };
    }
    if (years.length === 1) {
      const y = years[0];
      return isApprox ? { start: y - 10, end: y + 10 } : { start: y, end: y };
    }
  }

  if (numeric) return { start: numeric, end: numeric };
  return null;
}
```

- [ ] **Step 4: Käivita testid — kõik PASS**

Run: `npx vitest run src/utils/__tests__/yearDisplayUtils.test.ts`
Expected: kõik PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/yearDisplayUtils.ts src/utils/__tests__/yearDisplayUtils.test.ts
git commit -m "feat: sajandimuster parseYearDisplayRange-is (19. saj → 1801–1900)"
```

---

### Task 2: `formatYearDisplay` util + i18n võtmed

**Files:**
- Test: `src/utils/__tests__/yearDisplayUtils.test.ts` (täiendus)
- Modify: `src/utils/yearDisplayUtils.ts`
- Modify: `src/locales/et/common.json`
- Modify: `src/locales/en/common.json`

- [ ] **Step 1: Kirjuta failing testid**

Lisa `src/utils/__tests__/yearDisplayUtils.test.ts` lõppu:

```ts
import { formatYearDisplay } from '../yearDisplayUtils';
import type { TFunction } from 'i18next';

// Mock-t: tagastab võtme ja parameetrid kontrollitaval kujul
const tMock = ((key: string, opts?: Record<string, unknown>) =>
  `${key}|n=${opts?.n}|ord=${opts?.ord}`) as unknown as TFunction;

describe('formatYearDisplay', () => {
  it('sajand → tõlkevõti n ja ord parameetritega', () => {
    expect(formatYearDisplay('19. saj', null, tMock)).toBe('common:year.century|n=19|ord=19th');
  });
  it('ordinaalid: 21st, 2nd, 3rd, 11th', () => {
    expect(formatYearDisplay('21. saj', null, tMock)).toContain('ord=21st');
    expect(formatYearDisplay('2. saj', null, tMock)).toContain('ord=2nd');
    expect(formatYearDisplay('3. saj', null, tMock)).toContain('ord=3rd');
    expect(formatYearDisplay('11. saj', null, tMock)).toContain('ord=11th');
  });
  it('muu year_display kuvatakse toorelt', () => {
    expect(formatYearDisplay('ca. 1680', 1680, tMock)).toBe('ca. 1680');
    expect(formatYearDisplay('1670–1690', null, tMock)).toBe('1670–1690');
  });
  it('year_display puudub → year number', () => {
    expect(formatYearDisplay(null, 1750, tMock)).toBe('1750');
    expect(formatYearDisplay('', 1750, tMock)).toBe('1750');
  });
  it('kõik puudub → tühi string', () => {
    expect(formatYearDisplay(null, null, tMock)).toBe('');
    expect(formatYearDisplay(null, 0, tMock)).toBe('');
  });
});
```

- [ ] **Step 2: Käivita testid — formatYearDisplay testid FAILivad**

Run: `npx vitest run src/utils/__tests__/yearDisplayUtils.test.ts`
Expected: FAIL — `formatYearDisplay` pole eksporditud.

- [ ] **Step 3: Implementeeri**

Lisa `src/utils/yearDisplayUtils.ts` lõppu:

```ts
import type { TFunction } from 'i18next';

// Inglise järgarvu sufiks: 1st, 2nd, 3rd, 4th … 11th–13th erandid, 21st jne
function enOrdinal(n: number): string {
  const r10 = n % 10;
  const r100 = n % 100;
  if (r10 === 1 && r100 !== 11) return `${n}st`;
  if (r10 === 2 && r100 !== 12) return `${n}nd`;
  if (r10 === 3 && r100 !== 13) return `${n}rd`;
  return `${n}th`;
}

// Kuvatav aasta: sajandimuster tõlgitakse ("19. saj" / "19th century"),
// muu year_display (ca., vahemikud) on keele-neutraalne ja kuvatakse toorelt.
export function formatYearDisplay(
  yearDisplay: string | null | undefined,
  year: number | string | null | undefined,
  t: TFunction
): string {
  if (yearDisplay) {
    const cm = yearDisplay.trim().match(CENTURY_RE);
    if (cm) {
      const n = Number(cm[1]);
      return t('common:year.century', { n, ord: enOrdinal(n) });
    }
    return yearDisplay;
  }
  if (year) return String(year);
  return '';
}
```

NB: `import type` tõsta faili algusesse (importid enne muud koodi).

- [ ] **Step 4: Lisa tõlkevõtmed**

`src/locales/et/common.json` — lisa juurtasandile (nt `"buttons"` ploki järele):

```json
  "year": {
    "century": "{{n}}. saj"
  },
```

`src/locales/en/common.json` — samasse kohta:

```json
  "year": {
    "century": "{{ord}} century"
  },
```

- [ ] **Step 5: Käivita testid — kõik PASS**

Run: `npx vitest run src/utils/__tests__/yearDisplayUtils.test.ts`
Expected: kõik PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/yearDisplayUtils.ts src/utils/__tests__/yearDisplayUtils.test.ts src/locales/et/common.json src/locales/en/common.json
git commit -m "feat: formatYearDisplay — sajandi tõlgitud kuvamine (et/en)"
```

---

### Task 3: Python `parse_year_range` (`server/utils.py`)

**Files:**
- Test: `tests/test_year_range.py` (uus)
- Modify: `server/utils.py`

- [ ] **Step 1: Kirjuta failing testid**

Loo `tests/test_year_range.py`:

```python
"""parse_year_range — aastavahemiku tuletamine year + year_display paarist.

Peegelloogika frontendis: src/utils/yearDisplayUtils.ts parseYearDisplayRange
"""
from server.utils import parse_year_range


def test_exact_year():
    assert parse_year_range(1750, None) == (1750, 1750)


def test_ca_year_pm10():
    assert parse_year_range(1750, "ca. 1750") == (1740, 1760)


def test_range_endash():
    assert parse_year_range(None, "1670–1690") == (1670, 1690)


def test_range_hyphen():
    assert parse_year_range(None, "1686-1696") == (1686, 1696)


def test_century():
    assert parse_year_range(None, "19. saj") == (1801, 1900)


def test_century_long_form():
    assert parse_year_range(None, "19. sajand") == (1801, 1900)


def test_century_no_dot():
    assert parse_year_range(None, "19 saj") == (1801, 1900)


def test_century_whitespace_case():
    assert parse_year_range(None, "  17. Saj  ") == (1601, 1700)


def test_century_single_digit():
    assert parse_year_range(None, "9. saj") == (801, 900)


def test_century_beats_numeric_year():
    assert parse_year_range(1850, "19. saj") == (1801, 1900)


def test_empty_returns_none():
    assert parse_year_range(None, None) is None
    assert parse_year_range(0, "") is None


def test_year_as_string():
    assert parse_year_range("1750", None) == (1750, 1750)


def test_garbage_year():
    assert parse_year_range("pole aasta", None) is None
```

- [ ] **Step 2: Käivita — FAIL**

Run: `.venv/bin/python -m pytest tests/test_year_range.py -v`
Expected: FAIL — `ImportError: cannot import name 'parse_year_range'`.

- [ ] **Step 3: Implementeeri**

Lisa `server/utils.py` (faili algusesse importide juurde `from typing import Optional, Tuple`; funktsioon nt `pick_best_label` järele):

```python
# Sajandimuster: "19. saj", "19. sajand", "19 saj" (stringi algusest, trimmituna)
_CENTURY_RE = re.compile(r'^(\d{1,2})\.?\s*saj', re.IGNORECASE)
_YEAR4_RE = re.compile(r'\d{4}')
_APPROX_RE = re.compile(r'\bca\.?\b', re.IGNORECASE)


def parse_year_range(year, year_display) -> Optional[Tuple[int, int]]:
    """Tuletab teose aastavahemiku (year_start, year_end) filtreerimise jaoks.

    "19. saj"   -> (1801, 1900)   N. sajand = (N-1)*100+1 ... N*100
    "ca. 1750"  -> (1740, 1760)
    "1670-1690" -> (1670, 1690)
    "1750"      -> (1750, 1750)
    Tagastab None kui aastat ei tuvastata.
    NB: peegelloogika frontendis: src/utils/yearDisplayUtils.ts parseYearDisplayRange
    """
    if year_display:
        s = str(year_display).strip()
        m = _CENTURY_RE.match(s)
        if m:
            c = int(m.group(1))
            return ((c - 1) * 100 + 1, c * 100)
        years = [int(y) for y in _YEAR4_RE.findall(s)]
        if len(years) >= 2:
            return (years[0], years[-1])
        if len(years) == 1:
            y = years[0]
            if _APPROX_RE.search(s):
                return (y - 10, y + 10)
            return (y, y)
    try:
        numeric = int(year) if year else 0
    except (TypeError, ValueError):
        numeric = 0
    if numeric:
        return (numeric, numeric)
    return None
```

- [ ] **Step 4: Käivita — PASS**

Run: `.venv/bin/python -m pytest tests/test_year_range.py -v`
Expected: kõik PASS.

- [ ] **Step 5: Commit**

```bash
git add server/utils.py tests/test_year_range.py
git commit -m "feat: parse_year_range — aastavahemiku tuletamine (sajand, ca., vahemik)"
```

---

### Task 4: Live-indekseerimine (`server/meilisearch_ops.py`)

**Files:**
- Modify: `server/meilisearch_ops.py:327-333` (year fallback), `~490-492` (doc väljad), `714-735` (`_ensure_filterable_attributes`), `39` (import)

- [ ] **Step 1: Lisa import**

`server/meilisearch_ops.py:39` — `from .utils import (...)` loendisse lisa `parse_year_range`.

- [ ] **Step 2: Asenda year-fallback vahemiku tuletusega**

`sync_work_to_meilisearch` sees, praegune kood (read ~327–333):

```python
    year = metadata.get('year', 0)
    year_display = metadata.get('year_display') or None
    # Kui year puudub aga year_display sisaldab aastat (nt "ca. 1750"), kasuta seda filtri jaoks
    if not year and year_display:
        _m = re.search(r'\d{4}', year_display)
        if _m:
            year = int(_m.group())
```

asenda:

```python
    year = metadata.get('year', 0)
    year_display = metadata.get('year_display') or None
    year_range = parse_year_range(year, year_display)
    # Kui year puudub aga year_display annab vahemiku (nt "ca. 1750", "19. saj"),
    # kasuta sortimisväärtusena vahemiku keskpaika
    if not year and year_range:
        year = (year_range[0] + year_range[1]) // 2
    year_start = year_range[0] if year_range else 0
    year_end = year_range[1] if year_range else 0
```

- [ ] **Step 3: Lisa doc väljad**

Dokumendi koostamisel (read ~485–492), `"year_display": year_display,` järele:

```python
            "year_start": year_start,  # Filtreerimiseks (vahemike kattuvus)
            "year_end": year_end,
```

- [ ] **Step 4: Täienda `_ensure_filterable_attributes`**

`server/meilisearch_ops.py:722` — `needed` hulk:

```python
        needed = {"is_public", "shareable", "collections_hierarchy", "collections", "year_start", "year_end"}
```

(Logiteade real ~733 uuenda: `"filterableAttributes uuendatud"` — täpne loetelu pole oluline.)

- [ ] **Step 5: Käivita olemasolevad testid**

Run: `.venv/bin/python -m pytest tests/test_meilisearch_ops.py tests/test_year_range.py -v`
Expected: kõik PASS.

- [ ] **Step 6: Commit**

```bash
git add server/meilisearch_ops.py
git commit -m "feat: year_start/year_end väljad live-indekseerimisel"
```

---

### Task 5: Seed-indekseerimine (`1-1_consolidate_data.py` + `2-1_upload_to_meili.py`)

NB: kaks indekseerimisteed peavad olema sünkroonis — see task peegeldab Task 4 loogikat seed-teele.

**Files:**
- Modify: `scripts/1-1_consolidate_data.py:46-49` (import), `~303-310` (year fallback), `~493-494` (doc väljad)
- Modify: `scripts/2-1_upload_to_meili.py:62+` (filterableAttributes)

- [ ] **Step 1: Lisa import**

`scripts/1-1_consolidate_data.py:46` — `from server.utils import (...)` loendisse lisa `parse_year_range` (sys.path fake-package muster on failis juba olemas, midagi muud lisada pole vaja).

- [ ] **Step 2: Asenda year-fallback**

Praegune kood (read ~303–310):

```python
                result['year'] = meta.get('year') or meta.get('aasta')
                result['year_display'] = meta.get('year_display') or None
                # Kui year puudub aga year_display sisaldab aastat (nt "ca. 1750"),
                # kasuta seda numbrilise year-filtri jaoks (sama loogika nagu meilisearch_ops.py)
                if not result['year'] and result['year_display']:
                    _ym = re.search(r'\d{4}', result['year_display'])
                    if _ym:
                        result['year'] = int(_ym.group())
```

asenda:

```python
                result['year'] = meta.get('year') or meta.get('aasta')
                result['year_display'] = meta.get('year_display') or None
                _yr = parse_year_range(result['year'], result['year_display'])
                # Kui year puudub aga year_display annab vahemiku (nt "ca. 1750", "19. saj"),
                # kasuta sortimisväärtusena keskpaika (sama loogika nagu meilisearch_ops.py)
                if not result['year'] and _yr:
                    result['year'] = (_yr[0] + _yr[1]) // 2
                result['year_start'] = _yr[0] if _yr else 0
                result['year_end'] = _yr[1] if _yr else 0
```

- [ ] **Step 3: Lisa doc väljad**

`meili_doc` koostamisel (read ~493–494), `'year_display': doc_metadata.get('year_display'),` järele:

```python
                'year_start': doc_metadata.get('year_start', 0),  # Filtreerimiseks (vahemike kattuvus)
                'year_end': doc_metadata.get('year_end', 0),
```

- [ ] **Step 4: Täienda seed filterableAttributes**

`scripts/2-1_upload_to_meili.py` — `'filterableAttributes'` loendis `'year',` järele:

```python
            'year_start',
            'year_end',
```

- [ ] **Step 5: Käivita testid**

Run: `.venv/bin/python -m pytest tests/test_consolidate_data.py tests/test_year_range.py -v`
Expected: kõik PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/1-1_consolidate_data.py scripts/2-1_upload_to_meili.py
git commit -m "feat: year_start/year_end väljad seed-indekseerimisel"
```

---

### Task 6: Kattuvusfilter (`src/services/searchService.ts`)

**Files:**
- Modify: `src/services/searchService.ts` — 8 kohta (read ~70/73, 115/118, 160/163, 222/223, 264/267, 308/311, 471/472, 724/725)

- [ ] **Step 1: Lisa abifunktsioon**

`src/services/searchService.ts` faili algusesse (importide järele):

```ts
// Aastafilter vahemike kattuvusena: teose [year_start, year_end] kattub kasutaja vahemikuga.
// Kattuvus: A.end >= B.start AND A.start <= B.end.
// Aastata teosed (year_start=year_end=0) käituvad nagu varasem year=0.
const pushYearFilter = (filter: string[], yearStart?: number, yearEnd?: number): void => {
  if (yearStart) filter.push(`year_end >= ${yearStart}`);
  if (yearEnd) filter.push(`year_start <= ${yearEnd}`);
};
```

- [ ] **Step 2: Asenda kõik 8 kohta**

Leia KÕIK esinemised: `grep -n "year >= \|year <= " src/services/searchService.ts`

Iga paar kujul:

```ts
    if (yearStart) {
      filter.push(`year >= ${yearStart}`);
    }
    if (yearEnd) {
      filter.push(`year <= ${yearEnd}`);
    }
```

või kompaktne variant (`if (options.yearStart) filter.push(...)` jne) asenda ühe reaga:

```ts
    pushYearFilter(filter, yearStart, yearEnd);
```

(vastavalt kontekstile `pushYearFilter(filter, options.yearStart, options.yearEnd);`).

- [ ] **Step 3: Veendu, et ühtegi vana mustrit ei jäänud**

Run: `grep -n "year >= \|year <= " src/services/searchService.ts`
Expected: tühi väljund.

Run: `grep -rn "year >= \|year <= " src/services/ src/pages/ src/components/`
Expected: tühi väljund (kontroll, et muid kohti pole).

- [ ] **Step 4: Build + testid**

Run: `npm run build && npx vitest run`
Expected: build õnnestub, kõik testid PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/searchService.ts
git commit -m "feat: aastafilter vahemike kattuvusena (year_start/year_end)"
```

---

### Task 7: Kuvamine + placeholderid + PersonDetailPage sort

**Files:**
- Modify: `src/components/WorkCard.tsx:322`
- Modify: `src/pages/search/SearchResults.tsx:404`
- Modify: `src/components/TextEditor.tsx:669`
- Modify: `src/components/mobile/WorkspaceMobileView.tsx:357`
- Modify: `src/components/editor/AnnotationsTab.tsx:296`
- Modify: `src/prosopography/pages/PersonDetailPage.tsx:380-386, 670`
- Modify: `src/locales/et/workspace.json:127`, `src/locales/en/workspace.json:127`

Kõik komponendid juba laevad `common` namespace'i (kontrollitud) — `t('common:year.century')` töötab.

- [ ] **Step 1: WorkCard**

`src/components/WorkCard.tsx` — lisa impordile `formatYearDisplay` (failis on juba `parseYearDisplayRange` import samast utilist). Rida 322:

```tsx
            <span>{formatYearDisplay(work.year_display, work.year, t)}</span>
```

- [ ] **Step 2: SearchResults**

`src/pages/search/SearchResults.tsx` — lisa `formatYearDisplay` import (failis on juba `parseYearDisplayRange`). Rida 404:

```tsx
                                                        <span className="hover:underline">{formatYearDisplay((firstHit as any).year_display, firstHit.year ?? (firstHit as any).aasta, t) || '...'}</span>
```

- [ ] **Step 3: TextEditor, WorkspaceMobileView, AnnotationsTab**

Igas failis lisa import `import { formatYearDisplay } from '../utils/yearDisplayUtils';` (AnnotationsTab/WorkspaceMobileView puhul `../../utils/...`) ja asenda:

`src/components/TextEditor.tsx:669`:
```tsx
            <span className="text-gray-400">{formatYearDisplay(work.year_display, work.year, t)}</span>
```

`src/components/mobile/WorkspaceMobileView.tsx:357`:
```tsx
                        <p className="text-gray-900">{formatYearDisplay(work.year_display, work.year, t)}</p>
```

`src/components/editor/AnnotationsTab.tsx:296`:
```tsx
                <p className="text-gray-900">{formatYearDisplay(work.year_display, work.year, t)}</p>
```

- [ ] **Step 4: PersonDetailPage — kuvamine ja sort**

Lisa import: `import { formatYearDisplay, parseYearDisplayRange } from '../../utils/yearDisplayUtils';`

Rida ~670:
```tsx
                const yearLabel = formatYearDisplay(meta?.year_display, meta?.year, t);
```

Read ~380–386 (sort kasutab nüüd vahemiku keskpaika; aastata teosed jäävad lõppu nagu enne):
```tsx
  // Sorteerimisaasta: number-väli, muidu year_display vahemiku keskpaik (nt "ca. 1750", "19. saj")
  const sortYear = (workId: string): number => {
    const meta = workTitles[workId];
    if (meta?.year) return meta.year;
    const range = parseYearDisplayRange(null, meta?.year_display);
    return range ? Math.floor((range.start + range.end) / 2) : 9999;
  };
```

- [ ] **Step 5: Placeholderid**

`src/locales/et/workspace.json:127`:
```json
    "yearDisplayPlaceholder": "nt ca. 1680, 1670–1690 või 19. saj",
```

`src/locales/en/workspace.json:127`:
```json
    "yearDisplayPlaceholder": "e.g. ca. 1680, 1670–1690 or 19. saj",
```

(Sisestusformaat on alati "19. saj" — parser tunneb ainult selle mustri; en-placeholder näitab sama formaati.)

- [ ] **Step 6: Build + testid**

Run: `npm run build && npx vitest run`
Expected: build õnnestub, kõik testid PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/WorkCard.tsx src/pages/search/SearchResults.tsx src/components/TextEditor.tsx src/components/mobile/WorkspaceMobileView.tsx src/components/editor/AnnotationsTab.tsx src/prosopography/pages/PersonDetailPage.tsx src/locales/et/workspace.json src/locales/en/workspace.json
git commit -m "feat: sajandi tõlgitud kuvamine kõigis aastaväljades"
```

---

### Task 8: Lõppkontroll + deploy (serveris, käsitsi)

- [ ] **Step 1: Täielik testikomplekt lokaalselt**

Run: `.venv/bin/python -m pytest tests/ -v && npx vitest run && npm run build`
Expected: kõik PASS, build õnnestub.

- [ ] **Step 2: Deploy — JÄRJEKORD ON OLULINE**

Frontend filtreerib `year_start`/`year_end` järgi, mida vanas indeksis POLE — kui frontend deploy'da enne reindeksit, läheb aastafilter katki. Seega:

```bash
# 1. Backend + reindeks ENNE frontendi
ssh vutt
cd ~/VUTT
./scripts/server_update.sh        # git pull + docker rebuild + restart
./scripts/server_seed_data.sh     # täisreindeks (loob year_start/year_end väljad)

# 2. Alles seejärel frontend (lokaalsest masinast)
npm run build
rsync -avz dist/ vutt:~/VUTT/dist/
```

- [ ] **Step 3: Verifitseerimine serveris**

1. Ava mõni teos, pane `year_display` väärtuseks "19. saj" (Metaandmed → Kuvatav aasta), salvesta.
2. Dashboard: kaart näitab "19. saj" (et) / "19th century" (en, keelevahetusega).
3. Aastafilter 1880–1890 leiab selle teose; filter 1700–1750 EI leia.
4. Kaardil aastale klikkimine eeltäidab filtri 1801–1900.
5. Regressioonid: "ca. 1750" teos leitav filtriga 1741–1745 (varem EI leitud — nüüd peab leidma); täpse aastaga teosed filtreeruvad nagu enne.
6. Pärast kontrolli taasta testteose algne `year_display`.
