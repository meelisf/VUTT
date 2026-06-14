# Places Group Hierarchy Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** Add `parent` field to `origin_groups.json` so groups can be nested two levels deep (e.g. Götaland under Rootsi), plus a group admin UI and auto-migration.

**Architecture:** Add `parent: string | null` to group schema. `buildPlacesTree` gains `subGroups: PlaceTreeGroup[]`. Backend gets group CRUD + auto-assign endpoint. Places admin gets a group panel.

**Tech Stack:** FastAPI (Python), React 19 + TypeScript + Tailwind, Vite, i18next

---

## Auto-parent mapping (hardcoded for migration)

```python
AUTO_PARENT_MAP = {
    # Sweden sub-regions
    "gootaland": "rootsi",
    "svealand": "rootsi",
    "norrland": "rootsi",
    # Finland sub-regions
    "ahvenanmaa": "soome",
    "hame": "soome",
    "lappi": "soome",
    "pohjanmaa": "soome",
    "satakunta": "soome",
    "savo": "soome",
    "uusimaa": "soome",
    "varsinais-suomi": "soome",
}
```

karjala, ingerimaa, eesti, liivimaa, pohja-saksamaa, kesk-saksamaa, muu → top-level (no parent).

---

## Task 1: Backend — group CRUD + auto-assign

**Files:**
- Modify: `server/prosopography/places_ops.py`
- Modify: `server/prosopography/router.py`
- Test: `tests/test_places_ops.py`

### Step 1: Add group functions to `places_ops.py`

After the existing `get_places_meta()` function (line ~280), add:

```python
def put_group(key: str, data: dict) -> dict:
    """
    Lisab või uuendab gruppi origin_groups.json-s.
    data võtmed: labels (dict), sort_order (int), parent (str|None)
    Tagastab {"key": key, "entry": updated_entry}.
    Kaitseb: parent peab eksisteerima kui on antud.
    """
    if not key or not key.strip():
        raise ValueError("Grupi võti on kohustuslik")
    groups = _load_origin_groups(force_reload=True)
    parent = data.get("parent") or None
    if parent and parent not in groups:
        raise ValueError(f"Parent grupp ei leitud: {parent!r}")
    if parent == key:
        raise ValueError("Grupp ei saa olla oma parent")
    entry = dict(groups.get(key, {}))
    if "labels" in data:
        entry["labels"] = data["labels"]
    if "sort_order" in data:
        entry["sort_order"] = int(data["sort_order"])
    entry["parent"] = parent
    groups[key] = entry
    atomic_write_json(ORIGIN_GROUPS_FILE, groups)
    _load_origin_groups(force_reload=True)
    return {"key": key, "entry": entry}


def delete_group(key: str) -> None:
    """
    Kustutab grupi origin_groups.json-st.
    Blokeerib kui: mõni koht kasutab seda gruppi VÕI mõni teine grupp kasutab seda parentina.
    """
    groups = _load_origin_groups(force_reload=True)
    if key not in groups:
        raise ValueError(f"Grupp ei leitud: {key!r}")
    places = _load_places_cache(force_reload=True)
    used_by_places = [k for k, e in places.items() if e.get("group") == key]
    if used_by_places:
        raise ValueError(
            f"Ei saa kustutada: gruppi kasutab {len(used_by_places)} koht(a): "
            + ", ".join(used_by_places[:5])
        )
    child_groups = [k for k, e in groups.items() if e.get("parent") == key]
    if child_groups:
        raise ValueError(
            f"Ei saa kustutada: grupil on alamgrupid: {', '.join(child_groups)}"
        )
    del groups[key]
    atomic_write_json(ORIGIN_GROUPS_FILE, groups)
    _load_origin_groups(force_reload=True)


AUTO_PARENT_MAP = {
    "gootaland": "rootsi",
    "svealand": "rootsi",
    "norrland": "rootsi",
    "ahvenanmaa": "soome",
    "hame": "soome",
    "lappi": "soome",
    "pohjanmaa": "soome",
    "satakunta": "soome",
    "savo": "soome",
    "uusimaa": "soome",
    "varsinais-suomi": "soome",
}


def auto_assign_group_parents() -> dict:
    """
    Rakendab AUTO_PARENT_MAP: seab teadaolevatele alamgruppidele parent välja.
    Prindib mitu gruppi uuendati.
    Tagastab {"assigned": N, "skipped": [list of missing keys]}.
    """
    groups = _load_origin_groups(force_reload=True)
    assigned = 0
    skipped = []
    for child_key, parent_key in AUTO_PARENT_MAP.items():
        if child_key not in groups:
            skipped.append(child_key)
            continue
        if parent_key not in groups:
            skipped.append(f"{child_key}->{parent_key}(missing)")
            continue
        groups[child_key]["parent"] = parent_key
        assigned += 1
    atomic_write_json(ORIGIN_GROUPS_FILE, groups)
    _load_origin_groups(force_reload=True)
    logger.info("auto_assign_group_parents: %d uuendatud, %d vahele jäetud", assigned, len(skipped))
    return {"assigned": assigned, "skipped": skipped}
```

Also: `ORIGIN_GROUPS_FILE` must be importable from config. Check `server/config.py` for the constant — it may be named differently. Use whatever constant the existing `_load_origin_groups` function already uses.

### Step 2: Add router endpoints to `router.py`

Import the new functions:
```python
from .places_ops import ..., put_group, delete_group, auto_assign_group_parents
```

Add after the existing `GET /places/meta` endpoint (around line 468):

```python
@router.put("/admin/groups/{key}")
async def groups_put(key: str, request: Request, user=Depends(_require_role("admin"))):
    """Lisab või uuendab gruppi (admin). Body: {labels, sort_order, parent}"""
    data = await _get_json(request)
    try:
        return put_group(key, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/admin/groups/{key}")
async def groups_delete(key: str, user=Depends(_require_role("admin"))):
    """Kustutab grupi (admin). Blokeerib kui kasutusel."""
    try:
        delete_group(key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"deleted": key}


@router.post("/admin/groups/auto-assign")
async def groups_auto_assign(user=Depends(_require_role("admin"))):
    """Rakendab automaatse parent seadmise teadaolevatele alamgruppidele."""
    return auto_assign_group_parents()
```

### Step 3: Write tests in `tests/test_places_ops.py`

Add 5 tests after existing places tests:

```python
def test_put_group_creates_new(tmp_path, monkeypatch):
    groups = {"soome": {"labels": {"et": "Soome"}, "sort_order": 1}}
    gfile = tmp_path / "origin_groups.json"
    gfile.write_text(json.dumps(groups))
    monkeypatch.setattr("server.prosopography.places_ops.ORIGIN_GROUPS_FILE", str(gfile))
    # Also patch places file
    pfile = tmp_path / "places.json"
    pfile.write_text("{}")
    monkeypatch.setattr("server.prosopography.places_ops.PLACES_FILE", str(pfile))
    result = put_group("gootaland", {"labels": {"et": "Götaland"}, "sort_order": 10, "parent": "soome"})
    assert result["key"] == "gootaland"
    saved = json.loads(gfile.read_text())
    assert saved["gootaland"]["parent"] == "soome"

def test_put_group_rejects_missing_parent(tmp_path, monkeypatch):
    groups = {"soome": {"labels": {"et": "Soome"}, "sort_order": 1}}
    gfile = tmp_path / "origin_groups.json"
    gfile.write_text(json.dumps(groups))
    monkeypatch.setattr("server.prosopography.places_ops.ORIGIN_GROUPS_FILE", str(gfile))
    pfile = tmp_path / "places.json"
    pfile.write_text("{}")
    monkeypatch.setattr("server.prosopography.places_ops.PLACES_FILE", str(pfile))
    import pytest
    with pytest.raises(ValueError, match="Parent grupp ei leitud"):
        put_group("gootaland", {"labels": {"et": "Götaland"}, "parent": "nonexistent"})

def test_delete_group_blocked_by_places(tmp_path, monkeypatch):
    groups = {"soome": {"labels": {"et": "Soome"}, "sort_order": 1}}
    gfile = tmp_path / "origin_groups.json"
    gfile.write_text(json.dumps(groups))
    monkeypatch.setattr("server.prosopography.places_ops.ORIGIN_GROUPS_FILE", str(gfile))
    places = {"helsinki": {"labels": {"et": "Helsinki"}, "group": "soome"}}
    pfile = tmp_path / "places.json"
    pfile.write_text(json.dumps(places))
    monkeypatch.setattr("server.prosopography.places_ops.PLACES_FILE", str(pfile))
    import pytest
    with pytest.raises(ValueError, match="kasutab"):
        delete_group("soome")

def test_delete_group_blocked_by_child_groups(tmp_path, monkeypatch):
    groups = {
        "rootsi": {"labels": {"et": "Rootsi"}, "sort_order": 2},
        "gootaland": {"labels": {"et": "Götaland"}, "sort_order": 10, "parent": "rootsi"},
    }
    gfile = tmp_path / "origin_groups.json"
    gfile.write_text(json.dumps(groups))
    monkeypatch.setattr("server.prosopography.places_ops.ORIGIN_GROUPS_FILE", str(gfile))
    pfile = tmp_path / "places.json"
    pfile.write_text("{}")
    monkeypatch.setattr("server.prosopography.places_ops.PLACES_FILE", str(pfile))
    import pytest
    with pytest.raises(ValueError, match="alamgrupid"):
        delete_group("rootsi")

def test_auto_assign_group_parents(tmp_path, monkeypatch):
    groups = {
        "rootsi": {"labels": {"et": "Rootsi"}, "sort_order": 2},
        "gootaland": {"labels": {"et": "Götaland"}, "sort_order": 10},
        "svealand": {"labels": {"et": "Svealand"}, "sort_order": 11},
        "soome": {"labels": {"et": "Soome"}, "sort_order": 1},
        "ahvenanmaa": {"labels": {"et": "Ahvenanmaa"}, "sort_order": 20},
    }
    gfile = tmp_path / "origin_groups.json"
    gfile.write_text(json.dumps(groups))
    monkeypatch.setattr("server.prosopography.places_ops.ORIGIN_GROUPS_FILE", str(gfile))
    pfile = tmp_path / "places.json"
    pfile.write_text("{}")
    monkeypatch.setattr("server.prosopography.places_ops.PLACES_FILE", str(pfile))
    result = auto_assign_group_parents()
    assert result["assigned"] >= 2
    saved = json.loads(gfile.read_text())
    assert saved["gootaland"]["parent"] == "rootsi"
    assert saved["svealand"]["parent"] == "rootsi"
    assert saved["ahvenanmaa"]["parent"] == "soome"
```

### Step 4: Run tests

```bash
/home/mf/LLM/VUTT/.venv/bin/python -m pytest tests/test_places_ops.py -v
```

Expected: all tests pass (was 34 + now 5 = 39 total).

### Step 5: Commit backend

```bash
git add server/prosopography/places_ops.py server/prosopography/router.py tests/test_places_ops.py
git commit -m "feat: add group CRUD and auto-assign-parents endpoint"
```

---

## Task 2: Frontend tree utility — nested groups

**Files:**
- Modify: `src/pages/admin/placesTreeUtils.ts`
- Modify: `src/pages/admin/__tests__/placesTreeUtils.test.ts`

Working directory for this task: `/home/mf/LLM/VUTT/.worktrees/places-admin`

### Step 1: Update `PlaceTreeGroup` interface

```typescript
export interface PlaceTreeGroup {
  groupKey: string | null;
  groupLabels: Record<string, string> | null;
  sortOrder: number;
  nodes: PlaceTreeNode[];       // direct places in this group
  subGroups: PlaceTreeGroup[];  // child groups (only populated at top level)
}
```

### Step 2: Update `buildPlacesTree` to support parent groups

The `groups` parameter now has entries that may have a `parent` field:
```typescript
groups: Record<string, { labels?: Record<string, string>; sort_order?: number; parent?: string | null }>
```

Algorithm:
1. Build a flat map of all group entries (same as before)
2. Build place-group mapping (same as before, unchanged)
3. For each place, resolve group using existing `resolveGroupKey`
4. Build per-group nodes (same subtree logic)
5. Separate groups into top-level (no parent) and sub-groups (has parent in groups)
6. Assemble result: top-level groups get `subGroups` populated from matching child groups

```typescript
export function buildPlacesTree(
  places: Record<string, PlaceEntry>,
  groups: Record<string, { labels?: Record<string, string>; sort_order?: number; parent?: string | null }>,
): PlaceTreeGroup[] {
  // [existing placeGroupMap logic unchanged]
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

  // Build per-group PlaceTreeGroup (flat, without subGroups yet)
  const groupMap = new Map<string, PlaceTreeGroup>();

  const sortedGroups = Object.entries(groups).sort(
    ([, a], [, b]) => (a.sort_order ?? 50) - (b.sort_order ?? 50),
  );

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

  // Ungrouped places
  const ungroupedRoots = groupRoots.get(null) ?? [];
  const ungroupedGroup: PlaceTreeGroup | null = ungroupedRoots.length > 0
    ? { groupKey: null, groupLabels: null, sortOrder: 999, nodes: ungroupedRoots.map(k => buildSubtree(k, places, null, placeGroupMap)), subGroups: [] }
    : null;

  // Assemble: top-level groups (no parent or parent not in groups) get subGroups
  const result: PlaceTreeGroup[] = [];

  for (const [groupKey, groupMeta] of sortedGroups) {
    const parent = groupMeta.parent;
    if (parent && groupMap.has(parent)) continue; // is a sub-group, skip for now
    const group = groupMap.get(groupKey)!;
    // Attach child groups sorted by sort_order
    const children = sortedGroups
      .filter(([, m]) => m.parent === groupKey)
      .map(([k]) => groupMap.get(k)!)
      .filter(Boolean);
    if (group.nodes.length === 0 && children.length === 0) continue;
    result.push({ ...group, subGroups: children });
  }

  if (ungroupedGroup) result.push(ungroupedGroup);

  return result;
}
```

### Step 3: Add tests to `placesTreeUtils.test.ts`

Add 3 new tests:

```typescript
test('sub-group appears under parent group', () => {
  const places = {
    'smaland': { labels: { et: 'Småland' }, group: 'gootaland' } as PlaceEntry,
    'rootsi-country': { labels: { et: 'Rootsi' }, group: 'rootsi' } as PlaceEntry,
  };
  const groups = {
    rootsi: { labels: { et: 'Rootsi' }, sort_order: 2 },
    gootaland: { labels: { et: 'Götaland' }, sort_order: 10, parent: 'rootsi' },
  };
  const result = buildPlacesTree(places, groups);
  expect(result).toHaveLength(1);
  expect(result[0].groupKey).toBe('rootsi');
  expect(result[0].subGroups).toHaveLength(1);
  expect(result[0].subGroups[0].groupKey).toBe('gootaland');
  expect(result[0].subGroups[0].nodes[0].key).toBe('smaland');
});

test('top-level group with no parent stays top-level', () => {
  const places = {
    'livland': { labels: { et: 'Livland' }, group: 'liivimaa' } as PlaceEntry,
  };
  const groups = {
    liivimaa: { labels: { et: 'Liivimaa' }, sort_order: 6 },
  };
  const result = buildPlacesTree(places, groups);
  expect(result).toHaveLength(1);
  expect(result[0].groupKey).toBe('liivimaa');
  expect(result[0].subGroups).toHaveLength(0);
});

test('group with only sub-groups and no direct places still renders', () => {
  const places = {
    'smaland': { labels: { et: 'Småland' }, group: 'gootaland' } as PlaceEntry,
  };
  const groups = {
    rootsi: { labels: { et: 'Rootsi' }, sort_order: 2 },
    gootaland: { labels: { et: 'Götaland' }, sort_order: 10, parent: 'rootsi' },
  };
  const result = buildPlacesTree(places, groups);
  // rootsi has 0 direct places but 1 sub-group → must appear
  expect(result).toHaveLength(1);
  expect(result[0].groupKey).toBe('rootsi');
  expect(result[0].nodes).toHaveLength(0);
  expect(result[0].subGroups).toHaveLength(1);
});
```

### Step 4: Run tests

```bash
npx vitest run src/pages/admin/__tests__/placesTreeUtils.test.ts
```

Expected: all 9 tests pass.

### Step 5: Commit

```bash
git add src/pages/admin/placesTreeUtils.ts src/pages/admin/__tests__/placesTreeUtils.test.ts
git commit -m "feat: support nested group hierarchy in buildPlacesTree"
```

---

## Task 3: Frontend — nested tree rendering + group admin panel

**Files:**
- Modify: `src/pages/admin/PlacesTree.tsx`
- Modify: `src/pages/admin/Places.tsx`
- Create: `src/pages/admin/PlacesGroupPanel.tsx`
- Modify: `src/prosopography/services/prosopographyService.ts`
- Modify: `src/locales/et/admin.json`
- Modify: `src/locales/en/admin.json`

Working directory: `/home/mf/LLM/VUTT/.worktrees/places-admin`

### Step 1: Add service functions to `prosopographyService.ts`

After `deletePlace`:

```typescript
export async function putGroup(
  key: string,
  data: { labels: Record<string, string>; sort_order: number; parent?: string | null },
  token: string,
): Promise<{ key: string; entry: Record<string, any> }> {
  const resp = await fetchWithTimeout(
    `${BASE}/admin/groups/${encodeURIComponent(key)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
      body: JSON.stringify(data),
      timeout: 10000,
    },
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).detail ?? `putGroup: ${resp.status}`);
  }
  return resp.json();
}

export async function deleteGroup(key: string, token: string): Promise<void> {
  const resp = await fetchWithTimeout(
    `${BASE}/admin/groups/${encodeURIComponent(key)}`,
    { method: 'DELETE', headers: getAuthHeaders(token), timeout: 10000 },
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).detail ?? `deleteGroup: ${resp.status}`);
  }
}

export async function autoAssignGroupParents(token: string): Promise<{ assigned: number; skipped: string[] }> {
  const resp = await fetchWithTimeout(
    `${BASE}/admin/groups/auto-assign`,
    { method: 'POST', headers: getAuthHeaders(token), timeout: 10000 },
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).detail ?? `autoAssignGroupParents: ${resp.status}`);
  }
  return resp.json();
}
```

### Step 2: Add translations

In `src/locales/et/admin.json`, inside the `"places"` object, after `"loadError"`:

```json
"groups": "Grupid",
"groupsManage": "Halda gruppe",
"groupsClose": "Sulge",
"autoAssign": "Automaatne grupeerida",
"autoAssigning": "Grupeerib…",
"autoAssignResult": "{{count}} gruppi seadistati",
"autoAssignError": "Automaatne grupeerida ebaõnnestus",
"addGroup": "Lisa grupp",
"groupKey": "Grupi võti",
"groupLabels": "Nimed",
"groupSortOrder": "Järjekord",
"groupParent": "Ülemgrupp",
"groupParentNone": "(kõrgem tase)",
"groupSave": "Salvesta",
"groupSaving": "Salvestan…",
"groupSaveError": "Salvestamine ebaõnnestus",
"groupDelete": "Kustuta",
"groupDeleting": "Kustutan…",
"groupDeleteError": "Kustutamine ebaõnnestus",
"groupDeleteConfirm": "Kustuta grupp \"{{name}}\"?",
"groupCancel": "Tühista",
"groupEdit": "Redigeeri"
```

In `src/locales/en/admin.json`, inside the `"places"` object, after `"loadError"`:

```json
"groups": "Groups",
"groupsManage": "Manage groups",
"groupsClose": "Close",
"autoAssign": "Auto-assign parents",
"autoAssigning": "Assigning…",
"autoAssignResult": "{{count}} groups updated",
"autoAssignError": "Auto-assign failed",
"addGroup": "Add group",
"groupKey": "Group key",
"groupLabels": "Names",
"groupSortOrder": "Sort order",
"groupParent": "Parent group",
"groupParentNone": "(top level)",
"groupSave": "Save",
"groupSaving": "Saving…",
"groupSaveError": "Save failed",
"groupDelete": "Delete",
"groupDeleting": "Deleting…",
"groupDeleteError": "Delete failed",
"groupDeleteConfirm": "Delete group \"{{name}}\"?",
"groupCancel": "Cancel",
"groupEdit": "Edit"
```

IMPORTANT: These must go INSIDE the existing `"places": { ... }` object, before its closing `}`. Do not add them as a separate top-level key.

### Step 3: Update `PlacesTree.tsx` to render sub-groups

The `PlacesTree` component currently renders `PlaceTreeGroup[]`. Update it to also render sub-groups nested inside a group.

Current render pattern per group:
```
[Group header label]
  [Place nodes recursively]
```

New render pattern:
```
[Group header label]
  [Direct place nodes]
  [Sub-group header (indented, smaller)]
    [Sub-group place nodes]
```

Full updated `PlacesTree.tsx`:

```tsx
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import type { PlaceTreeGroup, PlaceTreeNode } from './placesTreeUtils';

function resolveLabel(labels: Record<string, string> | null | undefined, lang: string): string {
  if (!labels) return '';
  return labels[lang] ?? labels.et ?? labels.en ?? Object.values(labels)[0] ?? '';
}

interface TreeNodeProps {
  node: PlaceTreeNode;
  depth: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  lang: string;
}

function TreeNode({ node, depth, selectedKey, onSelect, lang }: TreeNodeProps) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isSelected = node.key === selectedKey;
  const label = resolveLabel(node.entry.labels, lang) || node.key;
  const hasQCode = !!node.entry.id;

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1 rounded cursor-pointer text-sm select-none
          ${isSelected ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => onSelect(node.key)}
      >
        {hasChildren ? (
          <span
            className="shrink-0 text-gray-400"
            onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        <span className="truncate">{label}</span>
        {!hasQCode && (
          <AlertTriangle size={11} className="text-amber-400 shrink-0" title="Q-kood puudub" />
        )}
      </div>
      {open && hasChildren && node.children.map(child => (
        <TreeNode key={child.key} node={child} depth={depth + 1} selectedKey={selectedKey} onSelect={onSelect} lang={lang} />
      ))}
    </div>
  );
}

interface SubGroupSectionProps {
  group: PlaceTreeGroup;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  lang: string;
}

function SubGroupSection({ group, selectedKey, onSelect, lang }: SubGroupSectionProps) {
  const [open, setOpen] = useState(true);
  const label = resolveLabel(group.groupLabels, lang) ?? group.groupKey ?? '—';

  return (
    <div className="mt-1">
      <div
        className="flex items-center gap-1 px-2 py-0.5 cursor-pointer select-none"
        style={{ paddingLeft: '24px' }}
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-gray-400">
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider truncate">
          {label}
        </span>
      </div>
      {open && group.nodes.map(node => (
        <TreeNode key={node.key} node={node} depth={2} selectedKey={selectedKey} onSelect={onSelect} lang={lang} />
      ))}
    </div>
  );
}

interface PlacesTreeProps {
  groups: PlaceTreeGroup[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  lang: string;
}

const PlacesTree: React.FC<PlacesTreeProps> = ({ groups, selectedKey, onSelect, lang }) => {
  return (
    <div>
      {groups.map(group => {
        const label = resolveLabel(group.groupLabels, lang) ?? group.groupKey ?? '—';
        return (
          <div key={group.groupKey ?? '__ungrouped'} className="mb-3">
            <div className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {label}
            </div>
            {group.nodes.map(node => (
              <TreeNode key={node.key} node={node} depth={0} selectedKey={selectedKey} onSelect={onSelect} lang={lang} />
            ))}
            {group.subGroups.map(sub => (
              <SubGroupSection key={sub.groupKey} group={sub} selectedKey={selectedKey} onSelect={onSelect} lang={lang} />
            ))}
          </div>
        );
      })}
    </div>
  );
};

export default PlacesTree;
```

### Step 4: Create `PlacesGroupPanel.tsx`

This is a slide-in panel rendered inside `Places.tsx` when user clicks "Halda gruppe". It shows all groups in a list, lets the user:
- See each group's label (et), parent, sort_order
- Click to edit inline (labels et/en, sort_order, parent dropdown)
- Delete a group (with error if blocked)
- Create a new group
- Click "Automaatne grupeerida" button

```tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Trash2, Edit2, X, ChevronDown } from 'lucide-react';
import { putGroup, deleteGroup, autoAssignGroupParents } from '../../prosopography/services/prosopographyService';

interface GroupEntry {
  labels?: Record<string, string>;
  sort_order?: number;
  parent?: string | null;
}

interface PlacesGroupPanelProps {
  groups: Record<string, GroupEntry>;
  token: string;
  lang: string;
  onGroupsChanged: (groups: Record<string, GroupEntry>) => void;
  onClose: () => void;
}

function resolveLabel(labels: Record<string, string> | undefined, lang: string): string {
  if (!labels) return '';
  return labels[lang] ?? labels.et ?? labels.en ?? Object.values(labels)[0] ?? '';
}

const LANGS = ['et', 'en'];

const PlacesGroupPanel: React.FC<PlacesGroupPanelProps> = ({
  groups, token, lang, onGroupsChanged, onClose,
}) => {
  const { t } = useTranslation('admin');
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editData, setEditData] = useState<{ labels: Record<string, string>; sort_order: number; parent: string }>({ labels: {}, sort_order: 50, parent: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [showNew, setShowNew] = useState(false);

  const sortedGroups = Object.entries(groups).sort(([, a], [, b]) => (a.sort_order ?? 50) - (b.sort_order ?? 50));
  const topLevelKeys = Object.keys(groups).filter(k => !groups[k]?.parent);

  function startEdit(key: string) {
    const entry = groups[key];
    setEditKey(key);
    setEditData({
      labels: { ...(entry.labels ?? {}) },
      sort_order: entry.sort_order ?? 50,
      parent: entry.parent ?? '',
    });
    setSaveError(null);
  }

  async function handleSave() {
    if (!editKey) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await putGroup(editKey, {
        labels: editData.labels,
        sort_order: editData.sort_order,
        parent: editData.parent || null,
      }, token);
      onGroupsChanged({ ...groups, [result.key]: result.entry });
      setEditKey(null);
    } catch (e: any) {
      setSaveError(e.message ?? t('places.groupSaveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleNew() {
    if (!newKey.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await putGroup(newKey.trim(), {
        labels: editData.labels,
        sort_order: editData.sort_order,
        parent: editData.parent || null,
      }, token);
      onGroupsChanged({ ...groups, [result.key]: result.entry });
      setShowNew(false);
      setNewKey('');
      setEditData({ labels: {}, sort_order: 50, parent: '' });
    } catch (e: any) {
      setSaveError(e.message ?? t('places.groupSaveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(key: string) {
    setDeletingKey(key);
    setDeleteError(null);
    try {
      await deleteGroup(key, token);
      const next = { ...groups };
      delete next[key];
      onGroupsChanged(next);
    } catch (e: any) {
      setDeleteError(e.message ?? t('places.groupDeleteError'));
    } finally {
      setDeletingKey(null);
    }
  }

  async function handleAutoAssign() {
    setAssigning(true);
    setAssignResult(null);
    try {
      const result = await autoAssignGroupParents(token);
      setAssignResult(t('places.autoAssignResult', { count: result.assigned }));
      // Reload groups from server via parent
      // We don't have fetchPlacesMeta here, so signal to parent to reload
      onGroupsChanged({ ...groups, __reload: true } as any);
    } catch (e: any) {
      setAssignResult(t('places.autoAssignError'));
    } finally {
      setAssigning(false);
    }
  }

  const editForm = (isNew: boolean) => (
    <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
      {isNew && (
        <div>
          <label className="text-xs font-medium text-gray-600">{t('places.groupKey')}</label>
          <input
            type="text"
            value={newKey}
            onChange={e => setNewKey(e.target.value)}
            className="mt-0.5 w-full border border-gray-300 rounded px-2 py-1 text-sm"
            placeholder="nt gootaland"
          />
        </div>
      )}
      <div>
        <label className="text-xs font-medium text-gray-600">{t('places.groupLabels')}</label>
        {LANGS.map(l => (
          <div key={l} className="flex items-center gap-1 mt-0.5">
            <span className="text-xs text-gray-400 w-5">{l}</span>
            <input
              type="text"
              value={editData.labels[l] ?? ''}
              onChange={e => setEditData(d => ({ ...d, labels: { ...d.labels, [l]: e.target.value } }))}
              className="flex-1 border border-gray-300 rounded px-2 py-0.5 text-sm"
            />
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-xs font-medium text-gray-600">{t('places.groupSortOrder')}</label>
          <input
            type="text"
            inputMode="numeric"
            value={editData.sort_order}
            onChange={e => setEditData(d => ({ ...d, sort_order: parseInt(e.target.value) || 50 }))}
            className="mt-0.5 w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </div>
        <div className="flex-1">
          <label className="text-xs font-medium text-gray-600">{t('places.groupParent')}</label>
          <select
            value={editData.parent}
            onChange={e => setEditData(d => ({ ...d, parent: e.target.value }))}
            className="mt-0.5 w-full border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="">{t('places.groupParentNone')}</option>
            {topLevelKeys
              .filter(k => k !== (isNew ? newKey : editKey))
              .map(k => (
                <option key={k} value={k}>{resolveLabel(groups[k].labels, lang) || k}</option>
              ))
            }
          </select>
        </div>
      </div>
      {saveError && <p className="text-xs text-red-600">{saveError}</p>}
      <div className="flex gap-2">
        <button
          onClick={isNew ? handleNew : handleSave}
          disabled={saving}
          className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          {saving ? t('places.groupSaving') : t('places.groupSave')}
        </button>
        <button
          onClick={() => { setEditKey(null); setShowNew(false); setSaveError(null); }}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
        >
          {t('places.groupCancel')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="border border-gray-200 rounded-lg bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-900">{t('places.groups')}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAutoAssign}
            disabled={assigning}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50"
          >
            {assigning && <Loader2 size={11} className="animate-spin" />}
            {assigning ? t('places.autoAssigning') : t('places.autoAssign')}
          </button>
          <button
            onClick={() => { setShowNew(true); setEditKey(null); setEditData({ labels: {}, sort_order: 50, parent: '' }); }}
            className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
          >
            + {t('places.addGroup')}
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>
      </div>

      {assignResult && (
        <div className="px-4 py-2 text-xs text-violet-700 bg-violet-50 border-b border-violet-100">
          {assignResult}
        </div>
      )}

      <div className="p-3 space-y-1 max-h-96 overflow-y-auto">
        {showNew && (
          <div className="mb-2">
            <div className="text-xs font-medium text-gray-700">+ {t('places.addGroup')}</div>
            {editForm(true)}
          </div>
        )}

        {sortedGroups.map(([key, entry]) => {
          const label = resolveLabel(entry.labels, lang) || key;
          const parentLabel = entry.parent ? (resolveLabel(groups[entry.parent]?.labels, lang) || entry.parent) : null;
          const isEditing = editKey === key;

          return (
            <div key={key} className="rounded border border-gray-100 p-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-800">{label}</span>
                  <span className="text-xs text-gray-400 ml-2">{key}</span>
                  {parentLabel && (
                    <span className="text-xs text-violet-600 ml-2">↳ {parentLabel}</span>
                  )}
                </div>
                <span className="text-xs text-gray-400">{entry.sort_order ?? '—'}</span>
                <button onClick={() => isEditing ? setEditKey(null) : startEdit(key)} className="text-gray-400 hover:text-primary-600">
                  <Edit2 size={13} />
                </button>
                <button
                  onClick={() => handleDelete(key)}
                  disabled={deletingKey === key}
                  className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                >
                  {deletingKey === key ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
              {deleteError && deletingKey === null && key === editKey && (
                <p className="text-xs text-red-600 mt-1">{deleteError}</p>
              )}
              {isEditing && editForm(false)}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PlacesGroupPanel;
```

**Note on delete error display:** The deleteError state is shared — show it below the group that failed. A simple approach: after `handleDelete` fails, set `editKey` to the key that failed so the error shows there. Actually, use a separate `deleteErrorKey` state to track which group showed the error.

Improved version: add `const [deleteErrorKey, setDeleteErrorKey] = useState<string | null>(null);` and in `handleDelete`:
```typescript
} catch (e: any) {
  setDeleteError(e.message ?? t('places.groupDeleteError'));
  setDeleteErrorKey(key);
```

And render: `{deleteError && deleteErrorKey === key && <p className="text-xs text-red-600 mt-1">{deleteError}</p>}`

### Step 5: Update `Places.tsx`

Add group panel toggle and reload logic.

Import:
```typescript
import PlacesGroupPanel from './PlacesGroupPanel';
```

Add state:
```typescript
const [showGroupPanel, setShowGroupPanel] = useState(false);
```

Add `handleGroupsChanged` callback:
```typescript
const handleGroupsChanged = useCallback((updated: Record<string, any>) => {
  if ('__reload' in updated) {
    // auto-assign was run → reload meta from server
    fetchPlacesMeta().then(m => setMeta(m)).catch(() => {});
    return;
  }
  setMeta(prev => prev ? { ...prev, groups: updated } : prev);
}, []);
```

In the JSX, add "Halda gruppe" button next to "Lisa koht" button (in the search bar area), and render the panel above the tree when `showGroupPanel`:

```tsx
{/* Grupihaldus */}
{showGroupPanel && meta && (
  <PlacesGroupPanel
    groups={meta.groups}
    token={authToken!}
    lang={lang}
    onGroupsChanged={handleGroupsChanged}
    onClose={() => setShowGroupPanel(false)}
  />
)}
```

The button near "Lisa koht":
```tsx
<button
  onClick={() => setShowGroupPanel(s => !s)}
  className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
>
  <Settings size={14} />
  {t('places.groups')}
</button>
```

Import `Settings` from lucide-react.

### Step 6: Build

```bash
npm run build
```

Expected: 0 TypeScript errors.

### Step 7: Commit

```bash
git add src/pages/admin/PlacesTree.tsx src/pages/admin/Places.tsx src/pages/admin/PlacesGroupPanel.tsx src/prosopography/services/prosopographyService.ts src/locales/et/admin.json src/locales/en/admin.json
git commit -m "feat: group admin panel with hierarchy, auto-assign, CRUD"
```

---

## Task 4: Push and deploy

- Push frontend branch: `git push origin feature/places-admin`
- Push backend (main): `git push origin main` from `/home/mf/LLM/VUTT`
- Deploy frontend: `npm run build && rsync -avz dist/ vutt:~/VUTT/dist/`
- Deploy backend: `ssh vutt "cd ~/VUTT && git pull && docker compose build --no-cache backend && docker compose up -d backend"`
- Trigger auto-assign on server (via admin UI button)
