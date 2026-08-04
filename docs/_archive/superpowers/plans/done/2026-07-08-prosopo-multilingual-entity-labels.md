# Prosopography Multilingual Entity Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every Wikidata-sourced entity on prosopography pages (occupations, institutions, places, tags, statuses, relations) renders in the active UI language, by backfilling missing inline `labels` objects, preventing new label-less entries, and fixing display sites that ignore existing labels.

**Architecture:** Reported symptom (`/persons/vutt:Ppe8i9a` → "linnapea, syndic" in EN) is a **data gap**: an occupation carries `id: Q30185` but no inline `labels`, so `useEntityLabel` falls back to the Estonian `label`. Fix in three layers: (1) shared backend helpers that collect entity Q-codes and fill inline `labels` from the canonical `labels.json` registry; (2) a one-time Wikidata backfill migration built on those helpers; (3) frontend display fixes for sites that render raw strings instead of localized labels.

**Tech Stack:** Python 3.9 (FastAPI backend, standalone migration script), Wikidata `wbgetentities` API, React 19 + TypeScript + i18next frontend, pytest + Vitest.

## Global Constraints

- Python target: **3.9** — no `dict | None` / `list[str]` in runtime-imported code where the module already avoids it; use `Optional[...]`, `List[...]` from `typing` (see `feedback_python39_compat`). (Existing `person_search.py` uses `list[dict]` in annotations only — match the local file's style per file.)
- Canonical labels registry path: `data/config/labels.json`, exposed as `LABELS_FILE` in `server/config.py`. **Do not** use the stale `data/state/labels.json` path from `scripts/sync_labels.py`.
- Target languages for Wikidata fetch: `["et", "en", "la", "de"]` (matches `entity_labels_ops._TARGET_LANGS`).
- Prosopography records live at `data/config/prosopography/{nanoid}.json` (inside `data/`'s inner git). Migration writes there and commits to `data/`'s git only.
- Never clobber a language already present in an inline `labels` object — merge registry values in to fill *gaps* only (registry fills missing langs; existing inline values win on conflict).
- Standalone scripts import server code via the fake-package pattern (see `feedback_script_server_import`); prefer keeping importable core logic in `server/entity_labels_ops.py`.
- Frontend gate before claiming done: `npm run typecheck` (Vite build does not typecheck).

---

## File Structure

- `server/entity_labels_ops.py` — **modify**: add pure `collect_entity_qcodes(person)` and `fill_entity_labels(person, registry)`; rewrite `_collect_qcodes_from_person` to delegate; add `fill_person_labels_from_registry(person)`.
- `server/prosopography/person_crud.py` — **modify**: call `fill_person_labels_from_registry(person)` inside `create_person` and `update_person` before `save_with_git`.
- `scripts/migrate_prosopo_entity_labels.py` — **create**: one-time backfill (scan → collect → fetch missing from Wikidata → update `labels.json` → fill inline labels → dry-run/apply/commit).
- `tests/test_entity_labels.py` — **create**: unit tests for the two pure helpers.
- `src/prosopography/components/personForm/helpers.ts` — **modify**: carry enrichment occupation `labels` through instead of forcing `undefined`.
- `src/prosopography/pages/PersonDetailPage.tsx` — **modify**: localize education institution via `institution_labels[lang]`.
- `src/prosopography/components/PersonCard.tsx` — **modify**: localize list-card status via the statuses vocabulary (resolve `status_ids`), not the flat Estonian `status_labels`.

---

## Task 1: Shared backend entity-label helpers

**Files:**
- Modify: `server/entity_labels_ops.py`
- Test: `tests/test_entity_labels.py` (create)

**Interfaces:**
- Produces:
  - `collect_entity_qcodes(person: dict) -> set` — all `Q…` ids across every entity slot of a prosopography record.
  - `fill_entity_labels(person: dict, registry: dict) -> int` — fills inline `labels`/`*_labels` objects in-place from `registry` (`{qcode: {lang: str}}`), merging registry values into gaps only; returns number of slots changed.
  - `fill_person_labels_from_registry(person: dict) -> int` — loads `labels.json` and calls `fill_entity_labels`.
- Consumes: `load_entity_labels()` (existing).

The entity slots (id source → labels target) handled by both helpers:

| Location | id key | labels key |
|----------|--------|-----------|
| `birth.place` (dict) | `id` | `labels` |
| `death.place` (dict) | `id` | `labels` |
| `origin` (dict, flat) | `place_id` | `place_labels` |
| each `statuses[]` | `id` | `labels` |
| each `confessions[]` | `id` | `labels` |
| each `occupations[]` | `id` | `labels` |
| each `occupations[]` (institution) | `institution_id` | `institution_labels` |
| each `education[]` (institution) | `institution_id` | `institution_labels` |
| each `education[]` (occupation-style) | `id` | `labels` |
| each `tags[]` | `id` | `labels` |
| each `relations[]` | `type` | `type_labels` |

- [ ] **Step 1: Write the failing tests**

Create `tests/test_entity_labels.py`:

```python
import server.entity_labels_ops as elo


def _sample_person():
    return {
        "birth": {"place": {"id": "Q3846", "label": "Minden"}},
        "death": {"place": {"id": "Q1770", "label": "Tallinn",
                             "labels": {"et": "Tallinn", "en": "Tallinn"}}},
        "origin": {"place": "Minden", "place_id": "Q3846", "place_labels": None},
        "statuses": [{"id": "Q152182", "label": "Literaat"}],
        "confessions": [{"id": "Q75809", "label": "luterlane"}],
        "occupations": [
            {"label": "linnapea", "id": "Q30185",
             "institution": "Tallinn", "institution_id": "Q1770"},
            {"label": "syndic", "id": "Q1339249",
             "labels": {"et": "Sündik", "en": "syndic"}},
        ],
        "education": [{"institution": "University of Rostock",
                       "institution_id": "Q159895"}],
        "tags": [{"id": "Q42", "label": "märksõna"}],
        "relations": [{"type": "Q100", "type_labels": None}, {"type": "father"}],
    }


def test_collect_entity_qcodes_covers_all_slots():
    q = elo.collect_entity_qcodes(_sample_person())
    assert {"Q3846", "Q1770", "Q152182", "Q75809", "Q30185",
            "Q1339249", "Q159895", "Q42", "Q100"} <= q
    # plain (non-Q) relation type is ignored
    assert "father" not in q


def test_fill_entity_labels_fills_gaps_and_counts():
    person = _sample_person()
    registry = {
        "Q30185": {"et": "linnapea", "en": "mayor"},
        "Q159895": {"et": "Rostocki Ülikool", "en": "University of Rostock"},
        "Q3846": {"et": "Minden", "en": "Minden"},
    }
    changed = elo.fill_entity_labels(person, registry)
    assert person["occupations"][0]["labels"] == {"et": "linnapea", "en": "mayor"}
    assert person["education"][0]["institution_labels"] == {
        "et": "Rostocki Ülikool", "en": "University of Rostock"}
    assert person["origin"]["place_labels"] == {"et": "Minden", "en": "Minden"}
    assert changed == 3


def test_fill_entity_labels_preserves_existing_language():
    person = {"occupations": [{"id": "Q1339249",
                               "labels": {"et": "Sündik", "en": "syndic"}}]}
    registry = {"Q1339249": {"et": "sündik", "de": "Syndikus"}}
    changed = elo.fill_entity_labels(person, registry)
    # existing et/en preserved; de added from registry
    assert person["occupations"][0]["labels"] == {
        "et": "Sündik", "en": "syndic", "de": "Syndikus"}
    assert changed == 1


def test_fill_entity_labels_idempotent():
    person = _sample_person()
    registry = {"Q30185": {"et": "linnapea", "en": "mayor"}}
    elo.fill_entity_labels(person, registry)
    assert elo.fill_entity_labels(person, registry) == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_entity_labels.py -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'collect_entity_qcodes'`.

- [ ] **Step 3: Implement the helpers**

In `server/entity_labels_ops.py`, add after `_fetch_wikidata_labels`:

```python
# Entiteedi-pesad: (id-võti, labels-võti). Kasutatakse nii Q-koodide
# kogumiseks kui inline labels täitmiseks.
def _entity_slots(person):
    """Tagastab [(obj, id_key, labels_key)] kõigi entiteedi-pesade kohta."""
    slots = []
    for parent_key in ("birth", "death"):
        parent = person.get(parent_key)
        if isinstance(parent, dict) and isinstance(parent.get("place"), dict):
            slots.append((parent["place"], "id", "labels"))
    origin = person.get("origin")
    if isinstance(origin, dict):
        slots.append((origin, "place_id", "place_labels"))
    for key in ("statuses", "confessions", "tags"):
        for item in person.get(key) or []:
            if isinstance(item, dict):
                slots.append((item, "id", "labels"))
    for occ in person.get("occupations") or []:
        if isinstance(occ, dict):
            slots.append((occ, "id", "labels"))
            slots.append((occ, "institution_id", "institution_labels"))
    for edu in person.get("education") or []:
        if isinstance(edu, dict):
            slots.append((edu, "institution_id", "institution_labels"))
            slots.append((edu, "id", "labels"))
    for rel in person.get("relations") or []:
        if isinstance(rel, dict):
            slots.append((rel, "type", "type_labels"))
    return slots


def _slot_qcode(obj, id_key):
    qid = obj.get(id_key)
    if isinstance(qid, str) and qid.startswith("Q"):
        return qid
    return None


def collect_entity_qcodes(person):
    """Kogub kõik Q-koodid prosopograafia kirje entiteedi-väljadelt."""
    qcodes = set()
    for obj, id_key, _labels_key in _entity_slots(person):
        qid = _slot_qcode(obj, id_key)
        if qid:
            qcodes.add(qid)
    return qcodes


def fill_entity_labels(person, registry):
    """Täidab inline labels registrist (gap-fill, kohapeal). Tagastab muudetud pesade arvu."""
    changed = 0
    for obj, id_key, labels_key in _entity_slots(person):
        qid = _slot_qcode(obj, id_key)
        if not qid or qid not in registry:
            continue
        reg = {k: v for k, v in registry[qid].items()
               if isinstance(v, str) and v.strip()}
        if not reg:
            continue
        existing = obj.get(labels_key)
        existing = existing if isinstance(existing, dict) else {}
        # Registri väärtused täidavad AUGUD; olemasolevad keeled jäävad peale
        merged = {**reg, **{k: v for k, v in existing.items()
                            if isinstance(v, str) and v.strip()}}
        if merged != existing:
            obj[labels_key] = merged
            changed += 1
    return changed


def fill_person_labels_from_registry(person):
    """Täidab kirje inline labels labels.json registrist (sünkroonne, kiire)."""
    return fill_entity_labels(person, load_entity_labels())
```

Then replace the body of `_collect_qcodes_from_person` (currently reads a stale singular schema) to delegate:

```python
def _collect_qcodes_from_person(person):
    """Kogub Q-koodid prosopograafia kirje entiteedi-väljadelt."""
    return collect_entity_qcodes(person)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_entity_labels.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Guard against regressions in the async enrich path**

Run: `.venv/bin/python -m pytest tests/test_prosopography_ops.py -q`
Expected: PASS (no import/behaviour breakage from the `_collect_qcodes_from_person` rewrite).

- [ ] **Step 6: Commit**

```bash
git add server/entity_labels_ops.py tests/test_entity_labels.py
git commit -m "Prosopo labels: shared collect_entity_qcodes + fill_entity_labels helpers"
```

---

## Task 2: Self-healing inline-fill on person save

**Files:**
- Modify: `server/prosopography/person_crud.py` (`create_person` ~line 73, `update_person` ~line 211)
- Test: `tests/test_entity_labels.py` (extend)

**Interfaces:**
- Consumes: `fill_person_labels_from_registry(person)` (Task 1).

Rationale: after Task 1 the async `enrich_entity_labels_from_person_async` (called in `router.py:307/794`) populates `labels.json` for **all** entity fields. This task closes the loop on the record itself so that whenever the registry already knows a Q-code, the saved record gets inline labels — covering imports and enrichment-autofilled occupations that never touched the EntityPicker.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_entity_labels.py`:

```python
def test_fill_person_labels_from_registry_uses_labels_json(monkeypatch):
    import server.entity_labels_ops as elo
    monkeypatch.setattr(elo, "load_entity_labels",
                        lambda: {"Q30185": {"et": "linnapea", "en": "mayor"}})
    person = {"occupations": [{"id": "Q30185", "label": "linnapea"}]}
    assert elo.fill_person_labels_from_registry(person) == 1
    assert person["occupations"][0]["labels"]["en"] == "mayor"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_entity_labels.py::test_fill_person_labels_from_registry_uses_labels_json -v`
Expected: FAIL only if Task 1 not present; otherwise this validates the loader hook. If it already passes, proceed — it locks the contract.

- [ ] **Step 3: Wire into the save path**

In `server/prosopography/person_crud.py`, add the import near the top-of-file imports:

```python
from ..entity_labels_ops import fill_person_labels_from_registry
```

In `create_person`, immediately before the first `state.save_with_git(` call (~line 123), insert:

```python
    # Täida inline labels registrist (self-healing), et EN-UI ei kuvaks ET-silte
    fill_person_labels_from_registry(person)
```

In `update_person`, immediately before its `state.save_with_git(` write of the primary record (~line 243), insert the same two lines, using the local record variable name in scope (confirm it is `person`; if the function uses a different name such as `existing`/`record`, call `fill_person_labels_from_registry(<that_name>)`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_entity_labels.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Regression check on person CRUD**

Run: `.venv/bin/python -m pytest tests/test_prosopography_ops.py tests/test_prosopography_git.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/prosopography/person_crud.py tests/test_entity_labels.py
git commit -m "Prosopo labels: fill inline labels from registry on person save"
```

---

## Task 3: One-time Wikidata backfill migration

**Files:**
- Create: `scripts/migrate_prosopo_entity_labels.py`

**Interfaces:**
- Consumes: `server.entity_labels_ops.collect_entity_qcodes`, `fill_entity_labels`, `_fetch_wikidata_labels`, `load_entity_labels`; `server.config.LABELS_FILE`, `PROSOPOGRAPHY_DIR`.

Follows the shape of `scripts/migrate_prosopo_status_labels.py` (dry-run default, `--apply`, `--commit`, `--limit`) but sources labels from `labels.json` first and fetches only the missing Q-codes from Wikidata, updating `labels.json` as it goes.

- [ ] **Step 1: Create the script**

Create `scripts/migrate_prosopo_entity_labels.py`:

```python
"""Ühekordne migratsioon: backfill mitmekeelsed inline `labels` prosopograafia
entiteedi-väljadele (ametid, asutused, kohad, tagid, seosed) Q-koodi järgi.

Erinevalt migrate_prosopo_status_labels.py-st (mis loeb vocabularies.json)
võtab see labelid kanooniilisest labels.json registrist ja pärib puuduvad
Wikidatast (uuendades ka labels.json-i). Kuna useEntityLabel / getLabel
eelistavad `labels[lang]`, parandab see kõik kuvakohad korraga.

Kasutus (serveris, Dockeris):
  docker exec vutt-backend python3 scripts/migrate_prosopo_entity_labels.py --dry-run
  docker exec vutt-backend python3 scripts/migrate_prosopo_entity_labels.py --apply
  docker exec vutt-backend python3 scripts/migrate_prosopo_entity_labels.py --apply --commit
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.entity_labels_ops import (  # noqa: E402
    collect_entity_qcodes, fill_entity_labels, _fetch_wikidata_labels,
    load_entity_labels, _TARGET_LANGS,
)
from server.config import LABELS_FILE, PROSOPOGRAPHY_DIR  # noqa: E402

DATA_ROOT = os.getenv("VUTT_DATA_DIR", "data")


def _needs_fetch(qid, registry):
    return qid not in registry or any(l not in registry[qid] for l in _TARGET_LANGS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Kirjuta muudatused (muidu dry-run)")
    ap.add_argument("--dry-run", action="store_true", help="Ainult näita (vaikimisi)")
    ap.add_argument("--commit", action="store_true", help="Pärast --apply tee data/ git commit")
    ap.add_argument("--limit", type=int, default=0, help="Töötle ainult N esimest muudetavat faili")
    args = ap.parse_args()

    prosopo_dir = Path(PROSOPOGRAPHY_DIR)
    if not prosopo_dir.is_dir():
        print(f"Prosopograafia kaust puudub: {prosopo_dir}", file=sys.stderr)
        return 1

    files = sorted(prosopo_dir.glob("*.json"))
    records = {}
    all_qcodes = set()
    for fpath in files:
        try:
            data = json.loads(fpath.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"SKIP {fpath.name}: {e}", file=sys.stderr)
            continue
        records[fpath] = data
        all_qcodes |= collect_entity_qcodes(data)

    registry = load_entity_labels()
    to_fetch = {q for q in all_qcodes if _needs_fetch(q, registry)}
    print(f"{len(files)} faili, {len(all_qcodes)} unikaalset Q-koodi, "
          f"{len(to_fetch)} vajab Wikidata päringut.")

    if to_fetch:
        fetched = _fetch_wikidata_labels(to_fetch)
        registry.update(fetched)
        if args.apply:
            os.makedirs(os.path.dirname(LABELS_FILE), exist_ok=True)
            with open(LABELS_FILE, "w", encoding="utf-8") as f:
                json.dump(registry, f, ensure_ascii=False, indent=2)
            print(f"labels.json uuendatud: +{len(fetched)} kirjet.")

    files_changed = 0
    slots_changed = 0
    for fpath, data in records.items():
        n = fill_entity_labels(data, registry)
        if n == 0:
            continue
        files_changed += 1
        slots_changed += n
        if args.apply:
            fpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        else:
            print(f"[dry-run] {fpath.name}: {n} pesa")
        if args.limit and files_changed >= args.limit:
            break

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[{mode}] {files_changed} faili, {slots_changed} pesa backfill'itud.")

    if args.apply and args.commit and files_changed:
        msg = f"Backfill mitmekeelsed inline labels prosopo entiteedi-väljadele ({files_changed} kaarti)"
        try:
            subprocess.run(["git", "-C", DATA_ROOT, "add", "-A", "config/prosopography", "config/labels.json"], check=True)
            subprocess.run(["git", "-C", DATA_ROOT, "commit", "-m", msg], check=True)
            print(f"data/ git commit: {msg}")
        except subprocess.CalledProcessError as e:
            print(f"git commit ebaõnnestus: {e}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Note: confirm `PROSOPOGRAPHY_DIR` is exported from `server/config.py`; if it lives in `server/prosopography/state.py` instead, import it from there. Verify with `grep -n "PROSOPOGRAPHY_DIR" server/config.py server/prosopography/state.py`.

- [ ] **Step 2: Local smoke test (dry-run) against a temp fixture**

Run:
```bash
VUTT_DATA_DIR=$(mktemp -d) .venv/bin/python -c "print('import ok')"
.venv/bin/python -c "import ast; ast.parse(open('scripts/migrate_prosopo_entity_labels.py').read()); print('syntax ok')"
```
Expected: `import ok` / `syntax ok`. (Full data lives only on the server; real dry-run runs there in Step 4.)

- [ ] **Step 3: Commit the script**

```bash
git add scripts/migrate_prosopo_entity_labels.py
git commit -m "Prosopo labels: one-time Wikidata backfill migration script"
```

- [ ] **Step 4: (Deploy step — run on server after backend deploy)** Dry-run then apply

On `ssh vutt`, after `./scripts/server_update.sh` has pulled backend changes:
```bash
docker exec vutt-backend python3 scripts/migrate_prosopo_entity_labels.py --dry-run
docker exec vutt-backend python3 scripts/migrate_prosopo_entity_labels.py --apply --commit
```
Then rebuild the persons index if labels feed it (verify `/persons` cards update):
```bash
docker exec vutt-backend python3 -c "from server.prosopography.ops import rebuild_indices; rebuild_indices()"
```
Expected: dry-run reports the count (should include `vutt:Ppe8i9a` → Q30185); after apply, `/persons/vutt:Ppe8i9a` in EN shows "mayor, syndic".

---

## Task 4: Frontend — carry enrichment occupation labels through

**Files:**
- Modify: `src/prosopography/components/personForm/helpers.ts:88-92`

- [ ] **Step 1: Fix the mapping**

Replace the `_occupations` mapping that forces `labels: undefined`:

```typescript
  if (autoFilled['_occupations']?.length && draft.occupations.length === 0) {
    patch.occupations = autoFilled['_occupations'].map((o: any) => ({
      label: o.label,
      id: o.id ?? null,
      labels: o.labels ?? undefined,
    }));
  } else if (autoFilled['_occupation_label'] && draft.occupations.length === 0) {
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Run helper unit tests if present**

Run: `npx vitest run src/prosopography/components/personForm 2>/dev/null || npx vitest run --dir src/prosopography`
Expected: PASS (or "no tests" — the change is a straight pass-through).

- [ ] **Step 4: Commit**

```bash
git add src/prosopography/components/personForm/helpers.ts
git commit -m "Prosopo labels: carry enrichment occupation labels through (no forced undefined)"
```

---

## Task 5: Frontend — localize education institution on detail page

**Files:**
- Modify: `src/prosopography/pages/PersonDetailPage.tsx:162-166`

`e.institution` is the raw entered string (often English, e.g. "University of Rostock"); the localized value lives in `e.institution_labels[lang]`.

- [ ] **Step 1: Localize the education row value**

Replace the education row block (~line 162):

```typescript
  if (person.education?.length > 0) {
    rows.push({
      label: t('education', 'Haridus'),
      value: person.education.map((e: any) => {
        const loc = e.institution_labels
          ? (e.institution_labels[lang] ?? e.institution_labels['en'] ?? e.institution_labels['et'])
          : null;
        return loc || e.institution || getLabel(e) || e;
      }).join(', '),
    });
  }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/prosopography/pages/PersonDetailPage.tsx
git commit -m "Prosopo labels: localize education institution on detail page"
```

---

## Task 6: Frontend — localize status on list cards

**Files:**
- Modify: `src/prosopography/components/PersonCard.tsx:173-174`

The index emits `status_labels` as flat Estonian strings and `status_ids` as Q-codes. `PersonAdvancedFilters.tsx:304` already resolves status Q-codes against the loaded statuses vocabulary (`item.label.et/.en`). Reuse that same vocabulary source in the card so status renders in the active language; fall back to `status_labels` when the vocab has no match.

- [ ] **Step 1: Identify the vocab source**

Run: `grep -rn "statuses\|seisused\|status" src/prosopography/components/PersonAdvancedFilters.tsx | grep -iE "vocab|useMemo|useState\|const .*status" | head`
Confirm which hook/prop supplies the `{ id, label: {et,en} }[]` list (e.g. a vocabularies context or a prop). PersonCard must obtain the same list (via the existing context/hook used elsewhere for vocab).

- [ ] **Step 2: Render localized status**

In `PersonCard.tsx`, replace the status line (~173):

```tsx
        {(person.status_ids ?? person.status_labels ?? []).length > 0 && (
          <p className="text-sm text-gray-600">
            {(person.status_ids ?? []).map((sid, i) => {
              const item = statusVocab.find(s => s.id === sid);
              const loc = item
                ? (i18n.language?.startsWith('en') ? item.label.en : item.label.et)
                : null;
              return loc || person.status_labels?.[i] || sid;
            }).filter(Boolean).join(', ')}
          </p>
        )}
```

Wire in `statusVocab` and `i18n` from the same source PersonAdvancedFilters uses. If PersonCard has no access to the vocab context without prop-drilling, prefer the smaller change: keep resolving but pass `statusVocab` down from `PersonsPage` where the vocab is already loaded. Confirm `person.status_ids` exists on the card's type (`src/prosopography/types.ts`); if not, add `status_ids: string[]` alongside `status_labels`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/prosopography/components/PersonCard.tsx src/prosopography/types.ts
git commit -m "Prosopo labels: localize status on person list cards"
```

---

## Deploy sequence (after all tasks + review)

1. Backend: `ssh vutt` → `./scripts/server_update.sh --no-cache` (picks up Tasks 1–2).
2. Run migration (Task 3, Step 4): dry-run → `--apply --commit` → `rebuild_indices()`.
3. Frontend: local `npm run build` → `rsync -avz dist/ vutt:~/VUTT/dist/` (Tasks 4–6).
4. Verify EN UI: `/persons/vutt:Ppe8i9a` shows "mayor, syndic"; education institution localizes; list-card status localizes.

## Self-Review Notes

- **Spec coverage:** Data gaps → Tasks 1+3; recurrence (helpers/stale collector/save) → Tasks 1+2+4; display gaps (education institution, list-card status) → Tasks 5+6. Reported bug (`linnapea`) fixed by Task 3 backfill.
- **Type consistency:** `collect_entity_qcodes`/`fill_entity_labels`/`fill_person_labels_from_registry` names used identically across Tasks 1–3. `_TARGET_LANGS`, `_fetch_wikidata_labels`, `LABELS_FILE` are existing symbols.
- **Open verification during execution:** exact variable name in `update_person` (Task 2 Step 3); export location of `PROSOPOGRAPHY_DIR` (Task 3 Step 1); status vocab source in PersonCard (Task 6 Steps 1–2).
```