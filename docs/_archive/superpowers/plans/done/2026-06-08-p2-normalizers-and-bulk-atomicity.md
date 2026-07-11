# P2: Frontend Normalizers + Bulk Atomicity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate divergence between Meilisearch hit normalizers and inline field-mapping in services, and fix the TOCTOU window in bulk metadata write operations.

**Architecture:** Two independent subsystems. Part A (Tasks 1–4): extend `normalizePage` and `normalizeWork` in `meiliService.ts` to be the canonical normalizers, then replace manual object construction in `pageService.ts` and `workService.ts` with calls to them. Part B (Tasks 5–6): add a `bulk_update_field()` helper to `metadata_ops.py` that reads, transforms, and writes inside a single lock acquisition, then swap the three bulk endpoints to use it.

**Tech Stack:** TypeScript 5.8 + Vitest 4 (frontend); Python 3.9 + pytest (backend)

**Context:** This plan addresses `docs/codebase_duplication_fallback_review_2026-06-07.md` P2 items. Key discovery: `normalizePage` is defined in `meiliService.ts` but **never imported anywhere** — it exists but wasn't wired up. `normalizeWork` is used in `searchService.ts:417` only.

---

## Part A: Frontend Normalizers

### Files changed

| Action | File | Why |
|--------|------|-----|
| Modify | `src/services/meiliService.ts` | Extend `normalizePage` and `normalizeWork` |
| Modify | `src/services/pageService.ts` | Replace `getPage` inline mapping with `normalizePage` |
| Modify | `src/services/workService.ts` | Replace `getWorkMetadata` inline mapping with `normalizeWork` |
| Create | `src/services/__tests__/normalizers.test.ts` | Tests for both normalizers |

---

### Task 1: Tests for `normalizePage`

**Files:**
- Create: `src/services/__tests__/normalizers.test.ts`

- [ ] **Step 1: Write failing tests for `normalizePage`**

```typescript
// src/services/__tests__/normalizers.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config', () => ({
  MEILI_HOST: 'http://localhost:7700',
  IMAGE_BASE_URL: 'http://localhost:8001',
  FILE_API_URL: 'http://localhost:8002',
}));

vi.mock('../workImageService', () => ({
  getFullImageUrl: (path: string) => `http://localhost:8001/${path}`,
  getThumbUrl: (id: string) => `http://localhost:8001/thumbs/${id}.jpg`,
}));

// checkMixedContent kasutab window.location — ei tööta node keskkonnas.
// Mockime selle no-op'iks, aga jätame normalizePage/normalizeWork päriseks.
vi.mock('../meiliService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../meiliService')>();
  return { ...actual, checkMixedContent: vi.fn() };
});

import { normalizePage, normalizeWork } from '../meiliService';
import { PageStatus } from '../../types';

const basePageHit = {
  id: 'abc123-1',
  work_id: 'abc123',
  lehekylje_number: '3',
  lehekylje_tekst: 'Cleaned text',
  text_content: 'Raw text with <i>markup</i>',
  lehekylje_pilt: 'img001.jpg',
  status: 'Töös',
  comments: [],
  text_annotations: [],
  history: [],
  title: 'Test Work',
  year: 1680,
  collections: ['coll-1'],
};

describe('normalizePage', () => {
  describe('page_number', () => {
    it('parses string lehekylje_number', () => {
      expect(normalizePage({ ...basePageHit, lehekylje_number: '7' }).page_number).toBe(7);
    });
    it('returns 0 when lehekylje_number is null', () => {
      expect(normalizePage({ ...basePageHit, lehekylje_number: null }).page_number).toBe(0);
    });
    it('returns 0 when lehekylje_number is undefined', () => {
      const { lehekylje_number, ...hit } = basePageHit as any;
      expect(normalizePage(hit).page_number).toBe(0);
    });
  });

  describe('text_content', () => {
    it('prefers text_content over lehekylje_tekst', () => {
      expect(normalizePage(basePageHit).text_content).toBe('Raw text with <i>markup</i>');
    });
    it('falls back to lehekylje_tekst when text_content absent', () => {
      const { text_content, ...hit } = basePageHit as any;
      expect(normalizePage(hit).text_content).toBe('Cleaned text');
    });
    it('returns empty string when both absent', () => {
      const { text_content, lehekylje_tekst, ...hit } = basePageHit as any;
      expect(normalizePage(hit).text_content).toBe('');
    });
  });

  describe('page_tags', () => {
    it('uses page_tags_object when present', () => {
      const tags = [{ id: 'Q1', label: 'Test' }];
      expect(normalizePage({ ...basePageHit, page_tags_object: tags }).page_tags).toEqual(tags);
    });
    it('falls back to page_tags strings lowercased', () => {
      expect(normalizePage({ ...basePageHit, page_tags: ['Foo', 'BAR'] }).page_tags)
        .toEqual(['foo', 'bar']);
    });
    it('falls back to hit.tags when page_tags absent', () => {
      const { page_tags, ...hit } = basePageHit as any;
      expect(normalizePage({ ...hit, tags: ['Alpha'] }).page_tags).toEqual(['alpha']);
    });
    it('deduplicates string tags', () => {
      expect(normalizePage({ ...basePageHit, page_tags: ['foo', 'foo', 'bar'] }).page_tags)
        .toEqual(['foo', 'bar']);
    });
    it('returns empty array when no tags', () => {
      const { page_tags, ...hit } = basePageHit as any;
      expect(normalizePage(hit).page_tags).toEqual([]);
    });
  });

  describe('languages', () => {
    it('returns languages array as-is', () => {
      expect(normalizePage({ ...basePageHit, languages: ['lat', 'deu'] }).languages)
        .toEqual(['lat', 'deu']);
    });
    it('returns empty array when languages absent (no lat hardcode)', () => {
      const { languages, ...hit } = basePageHit as any;
      expect(normalizePage(hit).languages).toEqual([]);
    });
  });

  describe('collections_hierarchy', () => {
    it('falls back to empty array', () => {
      const { collections_hierarchy, ...hit } = basePageHit as any;
      expect(normalizePage(hit).collections_hierarchy).toEqual([]);
    });
  });

  describe('creators and authors_text', () => {
    it('defaults to empty arrays', () => {
      const page = normalizePage(basePageHit);
      expect(page.creators).toEqual([]);
      expect(page.authors_text).toEqual([]);
    });
  });

  describe('work_id derivation', () => {
    it('derives work_id from id when work_id absent', () => {
      const { work_id, ...hit } = basePageHit as any;
      expect(normalizePage(hit).work_id).toBe('abc123');
    });
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run src/services/__tests__/normalizers.test.ts 2>&1 | tail -20
```

Expected: tests fail because `normalizePage` currently has wrong behaviour for `text_content`, `page_number`, `page_tags`, `languages`, `collections_hierarchy`.

---

### Task 2: Fix `normalizePage` in `meiliService.ts`

**Files:**
- Modify: `src/services/meiliService.ts:107-141`

- [ ] **Step 1: Replace `normalizePage` body**

Replace the entire `normalizePage` function (lines 107–141) with:

```typescript
export const normalizePage = (hit: any): Page => {
  let workId = hit.work_id;
  if (!workId && hit.id) {
    const lastDashIndex = hit.id.lastIndexOf('-');
    workId = lastDashIndex !== -1 ? hit.id.substring(0, lastDashIndex) : hit.id;
  }

  return {
    id: hit.id,
    work_id: workId,
    page_number: hit.lehekylje_number != null ? parseInt(hit.lehekylje_number) : 0,
    text_content: hit.text_content || hit.lehekylje_tekst || '',
    image_url: getFullImageUrl(hit.lehekylje_pilt || ''),
    status: (hit.status as PageStatus) || PageStatus.RAW,
    comments: hit.comments || [],
    text_annotations: hit.text_annotations || [],
    page_tags: hit.page_tags_object ||
      Array.from(new Set((hit.page_tags || hit.tags || []).map((t: any) =>
        typeof t === 'string' ? t.toLowerCase() : t
      ))),
    history: hit.history || [],
    title: hit.title,
    year: hit.year ?? hit.aasta ?? null,
    year_display: hit.year_display || null,
    location: hit.location_object ?? null,
    publisher: hit.publisher_object ?? null,
    type: hit.type_object ?? null,
    genre: hit.genre_object ?? null,
    collections: hit.collections || [],
    collections_hierarchy: hit.collections_hierarchy || [],
    creators: hit.creators || [],
    authors_text: hit.authors_text || [],
    tags: hit.tags_object ?? [],
    languages: hit.languages || [],
    series: hit.series,
    series_title: hit.series_title,
    ester_id: hit.ester_id,
    external_url: hit.external_url,
    archive_refs: hit.archive_refs || null,
    // @deprecated väljad — töölaua tagasiühilduvus
    original_path: hit.originaal_kataloog,
    originaal_kataloog: hit.originaal_kataloog,
    autor: hit.autor,
    respondens: hit.respondens,
    aasta: hit.aasta ?? hit.year,
  };
};
```

- [ ] **Step 2: Run tests — expect pass**

```bash
npx vitest run src/services/__tests__/normalizers.test.ts 2>&1 | tail -20
```

Expected: all `normalizePage` tests pass.

- [ ] **Step 3: Run full frontend test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: no regressions.

- [ ] **Step 4: Commit**

```bash
git add src/services/meiliService.ts src/services/__tests__/normalizers.test.ts
git commit -m "fix: extend normalizePage to canonical form with tests"
```

---

### Task 3: Wire `normalizePage` into `pageService.ts:getPage`

**Files:**
- Modify: `src/services/pageService.ts:88-143`

- [ ] **Step 1: Add failing test for `getPage` using `normalizePage` behaviour**

Append to `src/services/__tests__/normalizers.test.ts`:

```typescript
// pageService integration — valideeri et getPage käitub nagu normalizePage
// Seda testime meilisearch-mock kaudu, nagu getGenreLabelMap.test.ts
```

> Note: `getPage` calls `index.search()` via a Meilisearch `Index` object. The simplest way to test the normalization contract is to check that `getPage` returns a `Page` where `page_number` is numeric, `languages` defaults to `[]`, and `page_tags_object` is preferred. Use the pattern from `getGenreLabelMap.test.ts`: pass a mock index whose `search` returns a known hit.

Add these tests to the `normalizers.test.ts` file, after the `normalizePage` block:

```typescript
describe('getPage wires normalizePage', () => {
  it('returns page_number as integer from string hit', async () => {
    const { getPage } = await import('../pageService');
    const mockIndex = {
      search: vi.fn().mockResolvedValue({
        hits: [{ ...basePageHit, lehekylje_number: '5', work_id: 'abc123' }],
      }),
    } as any;
    const page = await getPage(mockIndex, 'abc123', 5);
    expect(page?.page_number).toBe(5);
  });

  it('returns empty languages array when hit has none (no lat hardcode)', async () => {
    const { getPage } = await import('../pageService');
    const { languages, ...hitWithoutLang } = basePageHit as any;
    const mockIndex = {
      search: vi.fn().mockResolvedValue({ hits: [hitWithoutLang] }),
    } as any;
    const page = await getPage(mockIndex, 'abc123', 3);
    expect(page?.languages).toEqual([]);
  });

  it('prefers page_tags_object over string page_tags', async () => {
    const { getPage } = await import('../pageService');
    const tags = [{ id: 'Q1', label: 'Test' }];
    const mockIndex = {
      search: vi.fn().mockResolvedValue({
        hits: [{ ...basePageHit, page_tags_object: tags, page_tags: ['foo'] }],
      }),
    } as any;
    const page = await getPage(mockIndex, 'abc123', 3);
    expect(page?.page_tags).toEqual(tags);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run src/services/__tests__/normalizers.test.ts 2>&1 | tail -30
```

Expected: the `getPage wires normalizePage` tests fail because `getPage` still has its own inline mapping with `|| ['lat']` etc.

- [ ] **Step 3: Replace `getPage` inline mapping**

In `src/services/pageService.ts`, add `normalizePage` to the import at the top:

```typescript
import { checkMixedContent, normalizePage } from './meiliService';
```

Replace the `return { ... }` block inside `getPage` (lines 101–138) with:

```typescript
    return normalizePage(hit);
```

The full `getPage` function after the change:

```typescript
export const getPage = async (index: Index, workId: string, pageNum: number): Promise<Page | null> => {
  checkMixedContent();
  try {
    const response = await index.search('', {
      filter: [`work_id = "${workId}"`, `lehekylje_number = ${pageNum}`],
      limit: 1
    });

    if (response.hits.length === 0) return null;
    const hit: any = response.hits[0];
    return normalizePage(hit);
  } catch (error) {
    console.error("Get Page Error:", error);
    throw error;
  }
};
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run src/services/__tests__/normalizers.test.ts 2>&1 | tail -30
npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/pageService.ts src/services/__tests__/normalizers.test.ts
git commit -m "refactor: wire normalizePage into getPage, remove duplicate inline mapping"
```

---

### Task 4: Tests for `normalizeWork`

**Files:**
- Modify: `src/services/__tests__/normalizers.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/services/__tests__/normalizers.test.ts`:

```typescript
const baseWorkHit = {
  id: 'abc123-1',
  work_id: 'abc123',
  title: 'Test Work',
  year: 1680,
  collections: ['coll-1'],
  creators: [],
};

describe('normalizeWork', () => {
  describe('collections_hierarchy', () => {
    it('defaults to empty array when absent', () => {
      expect(normalizeWork(baseWorkHit).collections_hierarchy).toEqual([]);
    });
    it('passes through existing hierarchy', () => {
      expect(normalizeWork({ ...baseWorkHit, collections_hierarchy: ['a', 'b'] }).collections_hierarchy)
        .toEqual(['a', 'b']);
    });
  });

  describe('languages', () => {
    it('returns empty array when absent (no lat hardcode)', () => {
      expect(normalizeWork(baseWorkHit).languages).toEqual([]);
    });
    it('passes through existing languages', () => {
      expect(normalizeWork({ ...baseWorkHit, languages: ['lat'] }).languages).toEqual(['lat']);
    });
  });

  describe('year fallback', () => {
    it('uses year field', () => {
      expect(normalizeWork({ ...baseWorkHit, year: 1650 }).year).toBe(1650);
    });
    it('falls back to aasta when year absent', () => {
      const { year, ...hit } = baseWorkHit as any;
      expect(normalizeWork({ ...hit, aasta: 1660 }).year).toBe(1660);
    });
    it('returns 0 when both absent', () => {
      const { year, ...hit } = baseWorkHit as any;
      expect(normalizeWork(hit).year).toBe(0);
    });
  });

  describe('work_id derivation', () => {
    it('derives work_id from id when work_id absent', () => {
      const { work_id, ...hit } = baseWorkHit as any;
      expect(normalizeWork(hit).work_id).toBe('abc123');
    });
  });
});
```

- [ ] **Step 2: Run — expect failures for collections_hierarchy and year fallback**

```bash
npx vitest run src/services/__tests__/normalizers.test.ts 2>&1 | tail -20
```

Expected: `collections_hierarchy` test fails (no `|| []` fallback), `year fallback` test for `aasta` fails.

---

### Task 5: Fix `normalizeWork` and wire into `getWorkMetadata`

**Files:**
- Modify: `src/services/meiliService.ts:64-102`
- Modify: `src/services/workService.ts:47-117`

- [ ] **Step 1: Fix `normalizeWork`**

Two targeted changes in `src/services/meiliService.ts`:

Change line 85 (`collections_hierarchy`):
```typescript
// old:
collections_hierarchy: hit.collections_hierarchy,
// new:
collections_hierarchy: hit.collections_hierarchy || [],
```

Change line 77 (`year`):
```typescript
// old:
year: hit.year ?? 0,
// new:
year: hit.year ?? hit.aasta ?? 0,
```

- [ ] **Step 2: Run normalizeWork tests — expect pass**

```bash
npx vitest run src/services/__tests__/normalizers.test.ts 2>&1 | tail -20
```

Expected: all `normalizeWork` tests pass.

- [ ] **Step 3: Add test for `getWorkMetadata` wires `normalizeWork`**

Append to `src/services/__tests__/normalizers.test.ts`:

```typescript
describe('getWorkMetadata wires normalizeWork', () => {
  it('returns empty collections_hierarchy when absent in hit', async () => {
    const { getWorkMetadata } = await import('../workService');
    const mockIndex = {
      search: vi.fn().mockResolvedValue({
        hits: [{ ...baseWorkHit }],
      }),
    } as any;
    const work = await getWorkMetadata(mockIndex, 'abc123');
    expect(work?.collections_hierarchy).toEqual([]);
  });

  it('returns empty languages array when hit has none (no lat hardcode)', async () => {
    const { getWorkMetadata } = await import('../workService');
    const mockIndex = {
      search: vi.fn().mockResolvedValue({ hits: [{ ...baseWorkHit }] }),
    } as any;
    const work = await getWorkMetadata(mockIndex, 'abc123');
    expect(work?.languages).toEqual([]);
  });
});
```

- [ ] **Step 4: Run — expect failure (getWorkMetadata still has `|| ['lat']`)**

```bash
npx vitest run src/services/__tests__/normalizers.test.ts 2>&1 | tail -20
```

- [ ] **Step 5: Replace `getWorkMetadata` inline mapping**

In `src/services/workService.ts`, add `normalizeWork` to the import:

```typescript
import { calculateWorkStatus, checkMixedContent, normalizeWork } from './meiliService';
```

Replace the `return { ... }` block inside `getWorkMetadata` (lines 68–112) with:

```typescript
    const base = normalizeWork(hit);
    return {
      ...base,
      // Legacy deprecated fields — workspace tagasiühilduvus
      catalog_name: hit.originaal_kataloog,
      author: hit.autor || (hit.creators?.[0]?.name) || '',
      respondens: hit.respondens || (hit.creators?.find((c: any) => c.role === 'respondens')?.name),
      aasta: hit.aasta ?? hit.year,
    } as Work;
```

- [ ] **Step 6: Run all tests**

```bash
npx vitest run src/services/__tests__/normalizers.test.ts 2>&1 | tail -30
npm test 2>&1 | tail -10
npx tsc --noEmit 2>&1 | head -20
```

Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/services/meiliService.ts src/services/workService.ts src/services/__tests__/normalizers.test.ts
git commit -m "refactor: fix normalizeWork, wire into getWorkMetadata, remove duplicate inline mapping"
```

---

## Part B: Bulk Operations Atomicity

### Files changed

| Action | File | Why |
|--------|------|-----|
| Modify | `server/metadata_ops.py` | Add `bulk_update_field()` helper |
| Modify | `server/main.py` | Swap bulk endpoints to use helper |
| Create | `tests/test_bulk_atomicity.py` | Tests for the new helper |

---

### Task 6: Add `bulk_update_field` helper

**Files:**
- Modify: `server/metadata_ops.py`
- Create: `tests/test_bulk_atomicity.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_bulk_atomicity.py
import json
import os
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


@pytest.fixture
def meta_file(tmp_path):
    path = tmp_path / "_metadata.json"
    path.write_text(json.dumps({
        "title": "Test",
        "collections": ["col-a"],
        "tags": [{"id": "Q1", "label": "foo"}],
        "genre": [],
    }), encoding="utf-8")
    return str(path)


def test_bulk_update_field_applies_transform(meta_file):
    """bulk_update_field loeb, transformeerib ja kirjutab ühe lukutsüklina."""
    from server.metadata_ops import bulk_update_field

    def add_collection(meta):
        current = meta.get("collections", [])
        return {"collections": current + ["col-b"]}

    with patch("server.metadata_ops.save_with_git") as mock_git:
        bulk_update_field(meta_file, add_collection, "testuser", "bulk test")
        assert mock_git.called
        saved_content = mock_git.call_args[0][1]
        saved = json.loads(saved_content)
        assert saved["collections"] == ["col-a", "col-b"]


def test_bulk_update_field_transform_sees_current_state(meta_file):
    """transform näeb _metadata.json praegust seisu — ei kasuta vananenud väärtust."""
    from server.metadata_ops import bulk_update_field

    seen_collections = []

    def inspect_and_remove(meta):
        seen_collections.extend(meta.get("collections", []))
        return {"collections": []}

    with patch("server.metadata_ops.save_with_git"):
        bulk_update_field(meta_file, inspect_and_remove, "testuser", "bulk test")

    assert "col-a" in seen_collections


def test_bulk_update_field_skips_disallowed_keys(meta_file):
    """transform ei saa lisada väljakesi, mida ALLOWED_METADATA_FIELDS ei luba."""
    from server.metadata_ops import bulk_update_field

    def add_evil(meta):
        return {"collections": ["ok"], "__evil__": "injected"}

    with patch("server.metadata_ops.save_with_git") as mock_git:
        bulk_update_field(meta_file, add_evil, "testuser", "bulk test")
        saved = json.loads(mock_git.call_args[0][1])
        assert "__evil__" not in saved
        assert saved["collections"] == ["ok"]


def test_bulk_update_field_missing_file_is_noop(tmp_path):
    """Puuduva faili korral ei kutsuta save_with_git."""
    from server.metadata_ops import bulk_update_field

    missing = str(tmp_path / "nonexistent.json")
    with patch("server.metadata_ops.save_with_git") as mock_git:
        bulk_update_field(missing, lambda m: {"collections": []}, "user", "msg")
        mock_git.assert_not_called()
```

- [ ] **Step 2: Run — expect ImportError (function doesn't exist yet)**

```bash
.venv/bin/python -m pytest tests/test_bulk_atomicity.py -v 2>&1 | tail -20
```

Expected: `ImportError: cannot import name 'bulk_update_field'`

- [ ] **Step 3: Add `from typing import Callable` import to `metadata_ops.py`**

The file already has `import json` and `import os`. Add after `import os`:

```python
from typing import Callable
```

- [ ] **Step 4: Implement `bulk_update_field` in `metadata_ops.py`**

Add after the `_V1_FIELDS` list (after line `_V1_FIELDS = [...]`) and before `save_work_metadata`. Note: `update_person_to_works`, `sync_work_to_meilisearch`, `sync_work_to_meilisearch_async` are already imported at module level — no local re-import needed.

```python
def bulk_update_field(
    meta_path: str,
    transform: Callable[[dict], dict],
    username: str,
    git_message: str,
    *,
    background_tasks=None,
    sync_meili: bool = False,
    call_ptw: bool = False,
) -> None:
    """
    Atomaarne bulk-uuendus: loeb, transformeerib ja kirjutab ühe metadata_lock tsükliga.
    Väldib TOCTOU akent, mis tekib eraldi loe+kirjuta kutsete vahel.

    transform(current_meta) → dict of field updates to apply.
    """
    if not os.path.exists(meta_path):
        return

    with metadata_lock:
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)

        updates = transform(meta)
        clean = {k: v for k, v in updates.items() if k in ALLOWED_METADATA_FIELDS}
        meta.update(clean)
        for field in _V1_FIELDS:
            meta.pop(field, None)

        save_with_git(
            meta_path,
            json.dumps(meta, indent=2, ensure_ascii=False),
            username,
            message=git_message,
        )

    slug = os.path.basename(os.path.dirname(meta_path))

    if call_ptw:
        ptw_args = (
            meta.get("id"),
            meta.get("creators", []),
            meta.get("tags") or [],
            meta.get("publisher"),
            meta.get("title") or "",
            meta.get("year"),
        )
        if background_tasks is not None:
            background_tasks.add_task(update_person_to_works, *ptw_args)
        else:
            update_person_to_works(*ptw_args)

    if sync_meili:
        if background_tasks is not None:
            background_tasks.add_task(sync_work_to_meilisearch_async, slug)
        else:
            sync_work_to_meilisearch(slug)
```

- [ ] **Step 4: Run tests — expect pass**

```bash
.venv/bin/python -m pytest tests/test_bulk_atomicity.py -v 2>&1 | tail -20
```

Expected: all 4 tests pass.

- [ ] **Step 5: Run full Python test suite**

```bash
.venv/bin/python -m pytest tests/ -v 2>&1 | tail -30
```

Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add server/metadata_ops.py tests/test_bulk_atomicity.py
git commit -m "feat: add bulk_update_field atomic helper to metadata_ops"
```

---

### Task 7: Refactor bulk endpoints in `main.py`

**Files:**
- Modify: `server/main.py:1134-1260`

- [ ] **Step 1: Add import to `main.py`**

Find the existing import from `metadata_ops` in `main.py`:
```python
from .metadata_ops import save_work_metadata
```

Change to:
```python
from .metadata_ops import save_work_metadata, bulk_update_field
```

- [ ] **Step 2: Replace `bulk_collection`**

Replace the `bulk_collection` endpoint body (the `for work_id in ...` loop through `invalidate_cache()`) with:

```python
    for work_id in data.get('work_ids', []):
        path = find_directory_by_id(work_id)
        if not (path and os.path.exists(os.path.join(path, '_metadata.json'))): continue

        def make_transform(coll_id=collection_id, m=mode):
            def transform(meta):
                current = meta.get('collections', [])
                if m == 'add':
                    if coll_id and coll_id not in current:
                        return {'collections': current + [coll_id]}
                    return {'collections': current}
                elif m == 'remove':
                    return {'collections': [c for c in current if c != coll_id]}
                else:  # set
                    return {'collections': [coll_id] if coll_id else []}
            return transform

        bulk_update_field(
            os.path.join(path, '_metadata.json'),
            make_transform(),
            user['username'],
            f"Bulk collection: {work_id}",
            background_tasks=background_tasks,
        )
    invalidate_cache()
    return {"status": "success"}
```

- [ ] **Step 3: Replace `bulk_tags`**

Replace the `bulk_tags` endpoint body loop:

```python
    tags_to_update = data.get('tags', [])
    tag_mode = data.get('mode', 'set')

    for work_id in data.get('work_ids', []):
        path = find_directory_by_id(work_id)
        if not (path and os.path.exists(os.path.join(path, '_metadata.json'))): continue

        def make_transform(mode=tag_mode, new_tags=tags_to_update):
            def transform(meta):
                cur = list(meta.get('tags', []))
                if mode == 'add':
                    for t in new_tags:
                        if t not in cur:
                            cur.append(t)
                elif mode == 'remove':
                    remove_ids = {t['id'] for t in new_tags if t.get('id')}
                    remove_labels = {t.get('label', '').lower() for t in new_tags if not t.get('id')}
                    cur = [t for t in cur if not (
                        (t.get('id') and t['id'] in remove_ids) or
                        (not t.get('id') and t.get('label', '').lower() in remove_labels)
                    )]
                else:
                    cur = list(new_tags)
                return {'tags': cur}
            return transform

        bulk_update_field(
            os.path.join(path, '_metadata.json'),
            make_transform(),
            user['username'],
            f"Bulk tags: {work_id}",
            background_tasks=background_tasks,
            call_ptw=True,
        )
    invalidate_cache()
    return {"status": "success"}
```

- [ ] **Step 4: Replace `bulk_genre`**

Replace the `bulk_genre` endpoint body loop (after `data = await get_json_data(request)` through `return {"status": "success"}`):

```python
    genre = data.get('genre')
    mode = data.get('mode', 'add')

    for work_id in data.get('work_ids', []):
        path = find_directory_by_id(work_id)
        if not (path and os.path.exists(os.path.join(path, '_metadata.json'))): continue

        def make_transform(g=genre, m=mode):
            def transform(meta):
                current = meta.get('genre', [])
                if not isinstance(current, list):
                    current = [current] if current else []
                if m == 'add':
                    if g and g not in current:
                        current = current + [g]
                elif m == 'remove':
                    current = [x for x in current if x != g]
                else:  # set
                    current = [g] if g else []
                return {'genre': current}
            return transform

        bulk_update_field(
            os.path.join(path, '_metadata.json'),
            make_transform(),
            user['username'],
            f"Bulk genre: {work_id}",
            background_tasks=background_tasks,
        )
    invalidate_cache()
    return {"status": "success"}
```

- [ ] **Step 5: Remove TOCTOU comments from the three endpoints**

Each of `bulk_collection`, `bulk_tags`, `bulk_genre` had a comment block like:
```python
    # NB: Bulk operatsioonid ei ole mõeldud samaaegseks kasutamiseks.
    # Kaks samaaegselt käivat bulk-operatsiooni võivad teineteise muudatusi üle kirjutada
    # (TOCTOU). Praeguses kasutuskontekstis (üks admin korraga) on see aktsepteeritav.
```

Delete these three comment blocks — the issue is now fixed.

- [ ] **Step 6: Run Python tests**

```bash
.venv/bin/python -m pytest tests/ -v 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/main.py
git commit -m "refactor: use bulk_update_field in bulk endpoints, eliminate TOCTOU window"
```

---

## Verification

After all tasks:

```bash
# Frontend
npm test 2>&1 | tail -10
npx tsc --noEmit 2>&1 | head -10

# Backend
.venv/bin/python -m pytest tests/ -v 2>&1 | tail -10
```

Expected: zero failures, zero type errors.

---

## What this does NOT change

- `normalizeContentSearchHit` — used only for search highlights, different contract
- `getWorkStatuses` — aggregate query, not a hit normalizer
- `getWorkPageImages` — thumbnail grid, no normalization needed
- P3 legacy fallbacks in `prosopography/ops.py` and `places_ops.py` — separate plan
