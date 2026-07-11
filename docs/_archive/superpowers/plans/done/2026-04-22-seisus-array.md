# Seisus Array (statuses[]) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Asenda `status: {...} | null` väli `statuses: [...][]` massiiviga ning lisa kõik kontrollitud sõnavara väärtused filtritesse ja vormi.

**Architecture:** Migratsiooniskript konverteerib olemasolevad isikukaardid, backend indeks läheb üle `status_ids[]`-le, frontend vorm asendab EntityPickeri checkbox-reaga vocabulary põhjal, PersonAdvancedFilters kuvab kõik seisused vocabulary-st.

**Tech Stack:** Python 3.9+, FastAPI, React 19, TypeScript, Tailwind, i18next

---

## Failikaart

| Fail | Muudatus |
|------|----------|
| `data/config/vocabularies.json` (serveril) | Lisa `seisused` sektsioon |
| `scripts/migrate_status_to_statuses.py` | Uus — migratsiooniskript |
| `server/prosopography/ops.py` | `_index_entry_from_person` + `list_persons` |
| `src/services/collectionService.ts` | `Vocabularies` interface + `seisused` väli |
| `src/prosopography/types.ts` | `ProsopoRecord.statuses[]`, `ProsopoIndexEntry.status_ids[]` + `status_labels[]` |
| `src/prosopography/components/personForm/types.ts` | `FormDraft.statuses: string[]` |
| `src/prosopography/components/personForm/helpers.ts` | `recordToDraft`, `draftToPayload`, `applyEnrichmentToDraft` |
| `src/prosopography/pages/PersonEditPage.tsx` | Asenda EntityPicker checkbox-reaga |
| `src/prosopography/components/PersonCard.tsx` | `status_ids` + `status_labels` |
| `src/prosopography/components/PersonAdvancedFilters.tsx` | Kõik seisused vocabulary-st |
| `src/prosopography/pages/PersonDetailPage.tsx` | `statuses[]` kuvamine |
| `src/locales/et/prosopography.json` | Tõlkevõtmed |
| `src/locales/en/prosopography.json` | Tõlkevõtmed |
| `tests/test_prosopography_ops.py` | Uus testifail |

---

## Task 1: vocabularies.json — lisa `seisused` sektsioon

**Files:**
- Modify: `data/config/vocabularies.json` (serveril)

> **NB:** vocabularies.json elab ainult serveril. Muuda seda serveris (`ssh vutt`, `nano ~/VUTT/data/config/vocabularies.json`) või scp-ga. Lokaalsel arendusmasinal ei ole seda faili.

- [ ] **Step 1: Logi serverisse sisse ja ava vocabularies.json**

```bash
ssh vutt
nano ~/VUTT/data/config/vocabularies.json
```

Lisa olemasoleva JSON-i lõppu (enne viimast `}`) uus sektsioon:

```json
  "seisused": [
    { "id": "Q134737", "label": { "et": "Aadel", "en": "Nobility" } },
    { "id": "Q2259532", "label": { "et": "Vaimulik", "en": "Clergy" } },
    { "id": "Q1020994", "label": { "et": "Kodanik", "en": "Burgher" } },
    { "id": "Q152182", "label": { "et": "Literaat", "en": "Literatus" } },
    { "id": "Q47064", "label": { "et": "Sõjaväelane", "en": "Military personnel" } },
    { "id": "Q39631", "label": { "et": "Arst", "en": "Physician" } },
    { "id": "Q838811", "label": { "et": "Talupoeg", "en": "Peasant" } }
  ]
```

Pärast muutmist kontrolli JSON-i kehtivust:
```bash
python3 -c "import json; json.load(open('data/config/vocabularies.json'))" && echo "OK"
```

- [ ] **Step 2: Commit serveris**

```bash
cd ~/VUTT/data
git add config/vocabularies.json
git commit -m "feat: lisa seisused vocabulary"
```

---

## Task 2: Backend migratsiooniskript

**Files:**
- Create: `scripts/migrate_status_to_statuses.py`
- Create: `tests/test_prosopography_ops.py`

- [ ] **Step 1: Kirjuta testid (TDD)**

Loo fail `tests/test_prosopography_ops.py`:

```python
"""Testid prosopography ops.py funktsioonidele — status → statuses migratsioon ja indeks."""
import json
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# ---- migratsiooniskripti testid ----

def _run_migrate(tmp_path, persons: list[dict]) -> list[dict]:
    """Kirjuta ajutised failid, käivita migratsioon, loe tulemused."""
    prosopo_dir = tmp_path / "prosopography"
    prosopo_dir.mkdir()
    for p in persons:
        (prosopo_dir / f"{p['id']}.json").write_text(
            json.dumps(p, ensure_ascii=False), encoding="utf-8"
        )
    # Import skript (seab STATE_DIR ajutiseks)
    import importlib, types as _types
    spec = importlib.util.spec_from_file_location(
        "migrate_script",
        PROJECT_ROOT / "scripts" / "migrate_status_to_statuses.py",
    )
    mod = importlib.util.module_from_spec(spec)
    # Monkey-patch STATE_DIR enne laadimist
    mod.__dict__["_PROSOPO_DIR_OVERRIDE"] = str(prosopo_dir)
    spec.loader.exec_module(mod)
    mod.migrate(str(prosopo_dir))
    results = []
    for p in persons:
        data = json.loads((prosopo_dir / f"{p['id']}.json").read_text(encoding="utf-8"))
        results.append(data)
    return results


def test_migrate_single_status(tmp_path):
    """status: {id, label} → statuses: [{id, label}]"""
    person = {"id": "p1", "status": {"id": "Q134737", "label": "Aadel"}}
    results = _run_migrate(tmp_path, [person])
    assert results[0].get("statuses") == [{"id": "Q134737", "label": "Aadel"}]
    assert "status" not in results[0]


def test_migrate_null_status(tmp_path):
    """status: null → statuses: []"""
    person = {"id": "p2", "status": None}
    results = _run_migrate(tmp_path, [person])
    assert results[0].get("statuses") == []
    assert "status" not in results[0]


def test_migrate_already_has_statuses(tmp_path):
    """Kui statuses juba olemas, jäta puutumata."""
    person = {"id": "p3", "statuses": [{"id": "Q134737", "label": "Aadel"}]}
    results = _run_migrate(tmp_path, [person])
    assert results[0].get("statuses") == [{"id": "Q134737", "label": "Aadel"}]
    assert "status" not in results[0]


def test_migrate_missing_status_key(tmp_path):
    """Kui status väli puudub täielikult, lisa statuses: []."""
    person = {"id": "p4", "name": {"label": "Test"}}
    results = _run_migrate(tmp_path, [person])
    assert results[0].get("statuses") == []


# ---- indeksi ehitamise testid ----

def _build_entry(person: dict) -> dict:
    """Kutsub _index_entry_from_person minimaalse patch-iga."""
    import importlib
    ops = importlib.import_module("server.prosopography.ops")
    # Minimaalse patch — asenda file I/O funktsioonid
    import unittest.mock as mock
    with mock.patch.object(ops, "_resolve_origin_group", return_value=None), \
         mock.patch.object(ops, "_get_parent_place", return_value=None), \
         mock.patch.object(ops, "_get_place_labels", return_value=None), \
         mock.patch.object(ops, "_load_origin_groups", return_value={}):
        return ops._index_entry_from_person(person)


def test_index_entry_statuses_to_status_ids():
    """statuses massiiv → status_ids + status_labels indeksis."""
    person = {
        "id": "p5",
        "name": {"label": "Test Person"},
        "statuses": [
            {"id": "Q134737", "label": "Aadel"},
            {"id": "Q2259532", "label": "Vaimulik"},
        ],
    }
    entry = _build_entry(person)
    assert entry["status_ids"] == ["Q134737", "Q2259532"]
    assert entry.get("status_id") is None  # vana väli eemaldatud


def test_index_entry_empty_statuses():
    """statuses: [] → status_ids: []"""
    person = {"id": "p6", "name": {"label": "Empty"}, "statuses": []}
    entry = _build_entry(person)
    assert entry["status_ids"] == []


def test_index_entry_missing_statuses_fallback():
    """Kui statuses puudub (vana formaat), kasuta legacy status välja."""
    person = {
        "id": "p7",
        "name": {"label": "Legacy"},
        "status": {"id": "Q134737", "label": "Aadel"},
    }
    entry = _build_entry(person)
    assert entry["status_ids"] == ["Q134737"]
```

- [ ] **Step 2: Jooksuta testid — peavad EBAÕNNESTUMA**

```bash
cd /home/mf/LLM/VUTT
python -m pytest tests/test_prosopography_ops.py -v 2>&1 | head -40
```

Oodatav tulemus: kõik testid FAIL (migrate skript ja uued väljad puuduvad)

- [ ] **Step 3: Kirjuta migratsiooniskript**

Loo fail `scripts/migrate_status_to_statuses.py`:

```python
"""Ühekordselt jooksev skript: konverteerib status→statuses kõigis prosopograafia kaartides."""
import json
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

_DEFAULT_STATE_DIR = os.path.join(
    os.getenv("VUTT_STATE_DIR", str(PROJECT_ROOT / "state")),
    "prosopography",
)


def migrate(prosopo_dir: str | None = None) -> int:
    """Konverteerib failid; tagastab muudetud failide arvu."""
    target = Path(prosopo_dir or _DEFAULT_STATE_DIR)
    if not target.exists():
        print(f"Kaust puudub: {target}", file=sys.stderr)
        return 0

    changed = 0
    for fpath in target.glob("*.json"):
        try:
            data = json.loads(fpath.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"SKIP {fpath.name}: {e}", file=sys.stderr)
            continue

        if "statuses" in data:
            # Eemalda vana status väli kui see on jäänud
            if "status" in data:
                del data["status"]
                fpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                changed += 1
            continue

        # Konverteeri
        old = data.pop("status", None)
        if old and isinstance(old, dict) and old.get("id"):
            data["statuses"] = [{"id": old["id"], "label": old.get("label", "")}]
        else:
            data["statuses"] = []

        fpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        changed += 1

    print(f"Migreerisin {changed} faili.")
    return changed


if __name__ == "__main__":
    migrate()
```

- [ ] **Step 4: Uuenda `_index_entry_from_person` backendis**

Ava `server/prosopography/ops.py`. Leia read 97 ja 199–200:

```python
# VANA (read ~97-98):
status_obj = person.get("status") or {}
# ...
# VANA (read ~199-200):
"status_id": status_obj.get("id"),
"status_label": status_obj.get("label"),
```

Asenda **täielikult** nende kahe osa uuega — muuda funktsiooni algust (rea ~97 juures):

```python
# Uus — toetab nii statuses[] kui legacy status {}
_statuses_list = person.get("statuses")
if _statuses_list is None:
    # legacy fallback
    _legacy = person.get("status") or {}
    _statuses_list = [{"id": _legacy["id"], "label": _legacy.get("label", "")}] if _legacy.get("id") else []
```

Ja asenda return-blokis (read ~199-200):

```python
"status_ids": [s["id"] for s in _statuses_list if s.get("id")],
```

(Eemalda `"status_id": ...` ja `"status_label": ...` read täielikult)

- [ ] **Step 5: Uuenda `list_persons` filtrit**

Leia `server/prosopography/ops.py` read ~599-600:

```python
# VANA:
if status_id:
    results = [e for e in results if e.get("status_id") == status_id]
```

Asenda:

```python
if status_id:
    results = [e for e in results if status_id in (e.get("status_ids") or [])]
```

- [ ] **Step 6: Jooksuta testid — peavad LÄBIMA**

```bash
python -m pytest tests/test_prosopography_ops.py -v
```

Oodatav tulemus: kõik testid PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/migrate_status_to_statuses.py tests/test_prosopography_ops.py server/prosopography/ops.py
git commit -m "feat: status→statuses migratsioon + indeksi üleminek status_ids[]"
```

---

## Task 3: Frontend tüübid ja helpers

**Files:**
- Modify: `src/prosopography/types.ts`
- Modify: `src/prosopography/components/personForm/types.ts`
- Modify: `src/prosopography/components/personForm/helpers.ts`
- Modify: `src/services/collectionService.ts`

- [ ] **Step 1: Uuenda `ProsopoIndexEntry` — `src/prosopography/types.ts`**

Leia read 27-28:
```typescript
  status_id: string | null;
  status_label: string | null;
```
Asenda:
```typescript
  status_ids: string[];
  status_labels: string[];
```

Leia rida 101:
```typescript
  status: { id: string; label: string } | null;
```
Asenda:
```typescript
  statuses: { id: string; label: string }[];
```

- [ ] **Step 2: Uuenda `FormDraft` — `src/prosopography/components/personForm/types.ts`**

Leia rida 49:
```typescript
  status: LinkedEntity | null;
```
Asenda:
```typescript
  statuses: string[];  // Q-koodide massiiv (nt ["Q134737", "Q2259532"])
```

Leia `emptyDraft()` funktsiooni sees rida:
```typescript
  status: null,
```
Asenda:
```typescript
  statuses: [],
```

- [ ] **Step 3: Lisa `seisused` `Vocabularies` interface'ile — `src/services/collectionService.ts`**

Leia:
```typescript
export interface Vocabularies {
  types: { [id: string]: VocabularyItem };
  genres: { [id: string]: VocabularyItem };
  roles: { [id: string]: VocabularyItem };
  languages: { [id: string]: VocabularyItem };
  relation_types: { [id: string]: VocabularyItem };
}
```
Asenda:
```typescript
export interface VocabularySeisusItem {
  id: string;
  label: { et: string; en: string };
}

export interface Vocabularies {
  types: { [id: string]: VocabularyItem };
  genres: { [id: string]: VocabularyItem };
  roles: { [id: string]: VocabularyItem };
  languages: { [id: string]: VocabularyItem };
  relation_types: { [id: string]: VocabularyItem };
  seisused?: VocabularySeisusItem[];
}
```

- [ ] **Step 4: Uuenda `helpers.ts` — `recordToDraft`**

Leia rida ~170:
```typescript
    status: p.status ? { label: p.status.label, id: p.status.id, labels: (p.status as any).labels ?? null, source: 'wikidata' } : null,
```
Asenda:
```typescript
    statuses: (p.statuses ?? []).map(s => s.id).filter(Boolean),
```

- [ ] **Step 5: Uuenda `helpers.ts` — `draftToPayload`**

Leia read ~271-273:
```typescript
    status: draft.status
      ? { id: draft.status.id || draft.status.label, label: draft.status.label, ...(draft.status.labels ? { labels: draft.status.labels } : {}) }
      : null,
```
Asenda (vocabularyItems tuleb edastada `buildPayload`-sse — see lahendatakse PersonEditPage-s; siin ainult Q-koodid):
```typescript
    statuses: draft.statuses.map(qId => ({ id: qId, label: qId })),
```

> **NB:** `label` täidetakse PersonEditPage-s enne `draftToPayload` kutsumist (Task 4 Step 2). Siin on fallback — backendis labeli kuvamine tuleneb vocabulary-st, mitte salvestatud labelit.

- [ ] **Step 6: Uuenda `helpers.ts` — `applyEnrichmentToDraft`**

Leia read ~82-85:
```typescript
  // Seisus
  if (autoFilled['status'] && !draft.status) {
    const s = autoFilled['status'];
    patch.status = { label: s.label, id: s.id ?? null, labels: null, source: 'wikidata' };
  }
```
Asenda:
```typescript
  // Seisus — lisa auto-täidetud Q-kood massiivi kui veel puudub
  if (autoFilled['status']?.id && !draft.statuses.includes(autoFilled['status'].id)) {
    patch.statuses = [...draft.statuses, autoFilled['status'].id];
  }
```

- [ ] **Step 7: Kontrolli TypeScript kompileerimine**

```bash
npm run build 2>&1 | grep -E "error TS|Error" | head -20
```

Paranda kõik TypeScript vead enne jätkamist.

- [ ] **Step 8: Commit**

```bash
git add src/prosopography/types.ts src/prosopography/components/personForm/types.ts src/prosopography/components/personForm/helpers.ts src/services/collectionService.ts
git commit -m "feat: tüübid ja helpers üle statuses[] skeemile"
```

---

## Task 4: PersonEditPage — checkbox-rida

**Files:**
- Modify: `src/prosopography/pages/PersonEditPage.tsx`

- [ ] **Step 1: Lisa vocabulary laadimine PersonEditPage-sse**

Failis `src/prosopography/pages/PersonEditPage.tsx` leia olemasolev vocabularies laadimise koht (otsi `vocabularies` state'i). Kui see puudub, lisa state ja useEffect:

Leia imports-i osa ülaosas. Kontrolli, kas `getVocabularies` on juba imporditud:
```typescript
import { getVocabularies } from '../../services/collectionService';
```
Kui puudub, lisa. Kontrolli ka, kas `VocabularySeisusItem` on imporditud:
```typescript
import type { VocabularySeisusItem } from '../../services/collectionService';
```

Leia komponendi alguses state deklaratsioonid, lisa:
```typescript
const [seisused, setSeisused] = useState<VocabularySeisusItem[]>([]);
```

Leia olemasolev vocabulary laadimine (useEffect) või lisa uus:
```typescript
useEffect(() => {
  getVocabularies().then(v => { if (v.seisused) setSeisused(v.seisused); }).catch(() => {});
}, []);
```

- [ ] **Step 2: Uuenda `draftToPayload` kutsumine labels-iga**

PersonEditPage-s leitav koht, kus `draftToPayload(draft, original)` kutsutakse (enne salvestamist). Enne seda kutset ehita seisuste labels:

```typescript
// Enne draftToPayload kutset:
const draftWithLabels = {
  ...draft,
  statuses: draft.statuses.map(qId => {
    const vocabItem = seisused.find(s => s.id === qId);
    const label = vocabItem?.label?.et ?? qId;
    return { id: qId, label };
  }),
};
// Seejärel kasuta draftWithLabels asemel payload ehitamiseks:
```

**NB:** `draftToPayload` võtab `FormDraft`, mis sisaldab `statuses: string[]`. Payload ehitamine (Task 3, Step 5) teisendab need `{id, label}` objektideks. Seega label lisamine toimub PersonEditPage tasandil enne `draftToPayload` kutset — aga kuna `draftToPayload` kasutab `draft.statuses` (mitte `draftWithLabels`), tuleb üheaegselt uuendada ka `draftToPayload` allkirja.

Lihtsam lahendus: Uuenda `draftToPayload` (`helpers.ts`) nii, et ta võtab lisaparameetrina `seisusedVocab`:

```typescript
// helpers.ts — draftToPayload signatuur muutub:
export function draftToPayload(
  draft: FormDraft,
  original?: ProsopoRecord,
  seisusedVocab: { id: string; label: { et: string; en: string } }[] = [],
): Partial<ProsopoRecord> {
  // ...
  statuses: draft.statuses.map(qId => {
    const vocabItem = seisusedVocab.find(s => s.id === qId);
    return { id: qId, label: vocabItem?.label?.et ?? qId };
  }),
  // ...
}
```

Ja PersonEditPage-s:
```typescript
const payload = draftToPayload(draft, original, seisused);
```

- [ ] **Step 3: Asenda EntityPicker checkbox-reaga**

Leia read ~460-470 (EntityPicker seisuse jaoks):
```typescript
<EntityPicker
  label={t('status', 'Seisus')}
  placeholder="aadlik, vaimulik…"
  type="topic"
  value={draft.status}
  onChange={v => set({ status: v })}
  lang={lang}
  localSuggestions={entityLabels}
/>
```

Asenda:
```tsx
<div>
  <label className="block text-sm font-medium text-gray-700 mb-1">
    {t('statuses', 'Seisus')}
  </label>
  <div className="flex flex-wrap gap-2">
    {seisused.map(item => {
      const label = i18n.language?.startsWith('en') ? item.label.en : item.label.et;
      const checked = draft.statuses.includes(item.id);
      return (
        <button
          key={item.id}
          type="button"
          onClick={() =>
            set({
              statuses: checked
                ? draft.statuses.filter(id => id !== item.id)
                : [...draft.statuses, item.id],
            })
          }
          className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
            checked
              ? 'bg-primary-600 text-white border-primary-600'
              : 'bg-white text-gray-700 border-gray-300 hover:border-primary-400'
          }`}
        >
          {label}
        </button>
      );
    })}
    {seisused.length === 0 && (
      <span className="text-xs text-gray-400 italic">{t('loadingVocab', 'Laadin…')}</span>
    )}
  </div>
</div>
```

> **NB:** Veendu, et `i18n` on scope'is (peaks PersonEditPage-s olema `const { t, i18n } = useTranslation([...])`).

- [ ] **Step 4: Kontrolli TypeScript kompileerimine**

```bash
npm run build 2>&1 | grep -E "error TS|Error" | head -20
```

- [ ] **Step 5: Commit**

```bash
git add src/prosopography/pages/PersonEditPage.tsx src/prosopography/components/personForm/helpers.ts
git commit -m "feat: PersonEditPage — seisuse checkbox-rida"
```

---

## Task 5: PersonCard — uuenda status_ids[]

**Files:**
- Modify: `src/prosopography/components/PersonCard.tsx`

- [ ] **Step 1: Uuenda ShieldPlus ikoon**

Leia rida ~99:
```typescript
      {person.status_id === 'Q134737' && (
```
Asenda:
```typescript
      {(person.status_ids ?? []).includes('Q134737') && (
```

- [ ] **Step 2: Uuenda seisuse tekst**

Leia read ~135-137:
```typescript
        {/* Seisus */}
        {person.status_label && (
          <p className="text-sm text-gray-600">{person.status_label}</p>
```
Asenda:
```typescript
        {/* Seisus */}
        {(person.status_labels ?? []).length > 0 && (
          <p className="text-sm text-gray-600">{(person.status_labels ?? []).join(', ')}</p>
```

- [ ] **Step 3: Kontrolli TypeScript**

```bash
npm run build 2>&1 | grep -E "error TS|Error" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/prosopography/components/PersonCard.tsx
git commit -m "feat: PersonCard — status_ids[] ja status_labels[]"
```

---

## Task 6: Backend — lisa `status_labels` indeksisse

**Files:**
- Modify: `server/prosopography/ops.py`

Spek nõuab `status_labels: string[]` indeksisse, et frontend saaks kuvada eestikeelseid silte ilma vocabulary-d laadimata.

- [ ] **Step 1: Lisa `status_labels` `_index_entry_from_person`**

Leia `ops.py` koht, kus lisasid `status_ids` (Task 2, Step 4). Otsi:
```python
"status_ids": [s["id"] for s in _statuses_list if s.get("id")],
```
Asenda:
```python
"status_ids": [s["id"] for s in _statuses_list if s.get("id")],
"status_labels": [s.get("label", "") for s in _statuses_list if s.get("id")],
```

- [ ] **Step 2: Lisa `status_labels` `ProsopoIndexEntry` testile**

Uuenda `tests/test_prosopography_ops.py` funktsiooni `test_index_entry_statuses_to_status_ids`:

```python
def test_index_entry_statuses_to_status_ids():
    person = {
        "id": "p5",
        "name": {"label": "Test Person"},
        "statuses": [
            {"id": "Q134737", "label": "Aadel"},
            {"id": "Q2259532", "label": "Vaimulik"},
        ],
    }
    entry = _build_entry(person)
    assert entry["status_ids"] == ["Q134737", "Q2259532"]
    assert entry["status_labels"] == ["Aadel", "Vaimulik"]
    assert entry.get("status_id") is None
```

- [ ] **Step 3: Jooksuta testid**

```bash
python -m pytest tests/test_prosopography_ops.py -v
```

Oodatav: kõik PASS.

- [ ] **Step 4: Commit**

```bash
git add server/prosopography/ops.py tests/test_prosopography_ops.py
git commit -m "feat: status_labels[] indeksis"
```

---

## Task 7: PersonAdvancedFilters — kõik seisused vocabulary-st

**Files:**
- Modify: `src/prosopography/components/PersonAdvancedFilters.tsx`
- Modify: `src/prosopography/pages/PersonsPage.tsx`

- [ ] **Step 1: Lisa `seisused` PersonAdvancedFilters propsidele**

Leia `PersonAdvancedFiltersProps` interface:
```typescript
interface PersonAdvancedFiltersProps {
  // ...
  statusId: string;
  // ...
  onStatusIdChange: (v: string) => void;
```
Lisa:
```typescript
  seisused: { id: string; label: { et: string; en: string } }[];
```

- [ ] **Step 2: Asenda hardcoded "Aadel" nupp kõigi seisuste nupuga**

Leia read ~234-249 (hardcoded Aadel nupp):
```typescript
          <div>
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Crown size={13} className="text-primary-600" />
              {t('filterStatus', 'Seisus')}
            </h4>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onStatusIdChange(statusId === 'Q134737' ? '' : 'Q134737')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  statusId === 'Q134737' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {t('filterAadel', 'Aadel')}
              </button>
            </div>
          </div>
```
Asenda:
```tsx
          <div>
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Crown size={13} className="text-primary-600" />
              {t('filterStatus', 'Seisus')}
            </h4>
            <div className="flex flex-wrap gap-2">
              {seisused.map(item => {
                const label = i18n.language?.startsWith('en') ? item.label.en : item.label.et;
                return (
                  <button
                    key={item.id}
                    onClick={() => onStatusIdChange(statusId === item.id ? '' : item.id)}
                    className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                      statusId === item.id ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
```

> **NB:** Veendu, et `i18n` on scope'is — lisa `const { t, i18n } = useTranslation(['prosopography'])` kui vaja. Vaata komponendi ülaosa.

- [ ] **Step 3: Uuenda aktiivsete filtrite "sildid" sektsioonis**

Leia read ~284-289 (hardcoded "Aadel" silt):
```typescript
                {statusId === 'Q134737' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200">
                    {t('filterAadel', 'Aadel')}
                    <button onClick={() => onStatusIdChange('')} className="hover:bg-primary-100 rounded-full p-0.5"><X size={11} /></button>
                  </span>
                )}
```
Asenda:
```tsx
                {statusId && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200">
                    {(() => {
                      const item = seisused.find(s => s.id === statusId);
                      return item ? (i18n.language?.startsWith('en') ? item.label.en : item.label.et) : statusId;
                    })()}
                    <button onClick={() => onStatusIdChange('')} className="hover:bg-primary-100 rounded-full p-0.5"><X size={11} /></button>
                  </span>
                )}
```

- [ ] **Step 4: Uuenda `activeCount` arvutus**

Leia rida ~115-116:
```typescript
  const hasActive = !!(originGroup || institution || source || gender || hasImmYear || statusId);
  const activeCount = [originGroup, institution, source, gender, hasImmYear ? '1' : '', statusId].filter(Boolean).length;
```
Jäta samaks — statusId on endiselt üks filter, loogika ei muutu.

- [ ] **Step 5: Laadi `seisused` PersonsPage-s ja anna edasi**

Ava `src/prosopography/pages/PersonsPage.tsx`. Leia state deklaratsioonid, lisa:
```typescript
const [seisused, setSeisused] = useState<{ id: string; label: { et: string; en: string } }[]>([]);
```

Lisa import:
```typescript
import { getVocabularies } from '../../services/collectionService';
```

Lisa useEffect:
```typescript
useEffect(() => {
  getVocabularies().then(v => { if (v.seisused) setSeisused(v.seisused); }).catch(() => {});
}, []);
```

Leia `<PersonAdvancedFilters` kasutuskoht (~rida 261) ja lisa prop:
```tsx
<PersonAdvancedFilters
  // ... olemasolevad props ...
  seisused={seisused}
  // ...
/>
```

- [ ] **Step 6: Kontrolli TypeScript**

```bash
npm run build 2>&1 | grep -E "error TS|Error" | head -20
```

- [ ] **Step 7: Commit**

```bash
git add src/prosopography/components/PersonAdvancedFilters.tsx src/prosopography/pages/PersonsPage.tsx
git commit -m "feat: PersonAdvancedFilters — kõik seisused vocabulary-st"
```

---

## Task 8: PersonDetailPage — statuses[] kuvamine

**Files:**
- Modify: `src/prosopography/pages/PersonDetailPage.tsx`

- [ ] **Step 1: Uuenda seisuse kuvamist**

Leia read ~417-426:
```typescript
            {(person.status || person.confession) && (
              <div className="grid grid-cols-2 gap-4">
                {person.status && (
                  <div>
                    <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">
                      {t('status', 'Seisus')}
                    </span>
                    <p className="text-gray-900">{getLabel(person.status)}</p>
                  </div>
                )}
```
Asenda:
```tsx
            {((person.statuses?.length ?? 0) > 0 || person.confession) && (
              <div className="grid grid-cols-2 gap-4">
                {(person.statuses?.length ?? 0) > 0 && (
                  <div>
                    <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">
                      {t('statuses', 'Seisus')}
                    </span>
                    <p className="text-gray-900">
                      {person.statuses!.map(s => getLabel(s)).filter(Boolean).join(', ')}
                    </p>
                  </div>
                )}
```

- [ ] **Step 2: Uuenda ka StructuredInfoCard-i kui seal on `status`**

Kontrolli kas `StructuredInfoCard` (~rida 99) kasutab samuti `person.status`:
```bash
grep -n "person.status\b" src/prosopography/pages/PersonDetailPage.tsx
```
Kui leitakse, uuenda sarnaselt.

- [ ] **Step 3: TypeScript kontroll**

```bash
npm run build 2>&1 | grep -E "error TS|Error" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/prosopography/pages/PersonDetailPage.tsx
git commit -m "feat: PersonDetailPage — statuses[] kuvamine"
```

---

## Task 9: Serverisse deploy ja migratsioon

- [ ] **Step 1: Ehita frontend ja rsync**

```bash
npm run build
rsync -avz dist/ vutt:~/VUTT/dist/
```

- [ ] **Step 2: Jooksuta migratsiooniskript serveris**

```bash
ssh vutt
cd ~/VUTT
.venv/bin/python3 scripts/migrate_status_to_statuses.py
```

Oodatav väljund: `Migreerisin N faili.` (kus N on tegelik isikukaartide arv, kelle juures oli `status` väli)

- [ ] **Step 3: Ehita ja käivita backend uuesti**

```bash
git pull
docker compose build --no-cache backend
docker compose up -d backend
docker logs vutt-backend --tail 20
```

Kontrolli, et server käivitub ilma vigadeta.

- [ ] **Step 4: Verifitseeri**

```bash
# Kontrolli, et indeks ehitatakse uue skeemiga
curl -s http://localhost:8002/prosopography?limit=1 | python3 -m json.tool | grep -E "status_ids|status_id"
```

Oodatav: vastus sisaldab `status_ids` massiivi, mitte `status_id`.

---

## Lahtised küsimused (spekist)

- **PersonDetailPage disain:** Praegune lahendus kuvab kõik seisused komaga eraldatult ühel real. Kui on vaja eraldi read, muuda Task 8 lahendust.
- **Aadeldamise aasta:** Läheb eluloo vabatekstiväljale (nagu kokku lepitud) — selles plaanis ei käsitleta.
