# Confessions[] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Asenda `confession: {...} | null` väli `confessions: [...][]` massiiviga — sama muster nagu `statuses[]`.

**Architecture:** Migratsiooniskript konverteerib olemasolevad isikukaardid, backend indeks läheb üle `confession_ids[]`-le, frontend vorm asendab EntityPickeri checkbox-reaga vocabulary põhjal.

**Tech Stack:** Python 3.9+, FastAPI, React 19, TypeScript, Tailwind, i18next

---

## Failikaart

| Fail | Muudatus |
|------|----------|
| `data/config/vocabularies.json` (serveril) | Lisa `konfessioonid` sektsioon |
| `scripts/migrate_confession_to_confessions.py` | Uus — migratsiooniskript |
| `tests/test_prosopography_ops.py` | Lisa confession migratsioon ja confession_ids testid |
| `server/prosopography/ops.py` | `_index_entry_from_person` — confession_ids |
| `src/prosopography/types.ts` | `ProsopoRecord.confessions[]`, `ProsopoIndexEntry.confession_ids[]` |
| `src/services/collectionService.ts` | `Vocabularies.konfessioonid?: VocabularySeisusItem[]` |
| `src/prosopography/components/personForm/types.ts` | `FormDraft.confessions: string[]` |
| `src/prosopography/components/personForm/helpers.ts` | `recordToDraft`, `draftToPayload`, `applyEnrichmentToDraft` |
| `src/prosopography/pages/PersonEditPage.tsx` | Asenda EntityPicker checkbox-reaga |
| `src/prosopography/pages/PersonDetailPage.tsx` | `confessions[]` kuvamine (2 kohta) |

---

## Task 1: vocabularies.json — lisa `konfessioonid` sektsioon

**Files:**
- Modify: `data/config/vocabularies.json` (serveril)

> **NB:** vocabularies.json elab ainult serveril. Muuda seda serveris (`ssh vutt`) või scp-ga.

- [ ] **Step 1: Logi serverisse ja ava vocabularies.json**

```bash
ssh vutt
cd ~/VUTT
nano data/config/vocabularies.json
```

Lisa olemasoleva JSON-i lõppu (enne viimast `}`) uus sektsioon:

```json
  "konfessioonid": [
    { "id": "Q1841",  "label": { "et": "Katoliiklane", "en": "Catholic" } },
    { "id": "Q75809", "label": { "et": "Luterlane",    "en": "Lutheran" } },
    { "id": "Q101849","label": { "et": "Reformeeritud", "en": "Reformed" } },
    { "id": "Q60995", "label": { "et": "Õigeusklik",   "en": "Orthodox" } }
  ]
```

Kontrolli JSON-i kehtivust:
```bash
python3 -c "import json; json.load(open('data/config/vocabularies.json'))" && echo "OK"
```

- [ ] **Step 2: Commit serveris**

```bash
cd ~/VUTT/data
git add config/vocabularies.json
git commit -m "feat: lisa konfessioonid vocabulary"
```

---

## Task 2: Backend migratsiooniskript + testid

**Files:**
- Create: `scripts/migrate_confession_to_confessions.py`
- Modify: `tests/test_prosopography_ops.py`

- [ ] **Step 1: Kirjuta testid confession migratsioonile (TDD)**

Lisa `tests/test_prosopography_ops.py` faili lõppu (peale olemasolevaid teste):

```python
# ---- confession → confessions migratsioon ----

def _run_migrate_confession(tmp_path, persons: list) -> list:
    prosopo_dir = tmp_path / "prosopography_conf"
    prosopo_dir.mkdir()
    for p in persons:
        (prosopo_dir / f"{p['id']}.json").write_text(
            json.dumps(p, ensure_ascii=False), encoding="utf-8"
        )
    spec = importlib.util.spec_from_file_location(
        "migrate_confession_script",
        PROJECT_ROOT / "scripts" / "migrate_confession_to_confessions.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.migrate(str(prosopo_dir))
    return [
        json.loads((prosopo_dir / f"{p['id']}.json").read_text(encoding="utf-8"))
        for p in persons
    ]


def test_migrate_confession_single(tmp_path):
    person = {"id": "c1", "confession": {"id": "Q75809", "label": "Luterlane"}}
    results = _run_migrate_confession(tmp_path, [person])
    assert results[0].get("confessions") == [{"id": "Q75809", "label": "Luterlane"}]
    assert "confession" not in results[0]


def test_migrate_confession_null(tmp_path):
    person = {"id": "c2", "confession": None}
    results = _run_migrate_confession(tmp_path, [person])
    assert results[0].get("confessions") == []
    assert "confession" not in results[0]


def test_migrate_confession_already_has_confessions(tmp_path):
    person = {"id": "c3", "confessions": [{"id": "Q75809", "label": "Luterlane"}]}
    results = _run_migrate_confession(tmp_path, [person])
    assert results[0].get("confessions") == [{"id": "Q75809", "label": "Luterlane"}]
    assert "confession" not in results[0]


def test_migrate_confession_missing_key(tmp_path):
    person = {"id": "c4", "name": {"label": "Test"}}
    results = _run_migrate_confession(tmp_path, [person])
    assert results[0].get("confessions") == []


def test_migrate_confession_idempotent(tmp_path):
    person = {"id": "c5", "confession": {"id": "Q1841", "label": "Katoliiklane"}}
    prosopo_dir = tmp_path / "prosopography_idem"
    prosopo_dir.mkdir()
    (prosopo_dir / "c5.json").write_text(json.dumps(person, ensure_ascii=False), encoding="utf-8")
    spec = importlib.util.spec_from_file_location(
        "migrate_conf_idem",
        PROJECT_ROOT / "scripts" / "migrate_confession_to_confessions.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    first = mod.migrate(str(prosopo_dir))
    second = mod.migrate(str(prosopo_dir))
    assert first == 1
    assert second == 0


# ---- confession_ids + tag_ids indeksi testid ----

def test_index_entry_confession_ids():
    person = {
        "id": "ci1",
        "name": {"label": "Test"},
        "confessions": [
            {"id": "Q75809", "label": "Luterlane"},
            {"id": "Q1841", "label": "Katoliiklane"},
        ],
    }
    entry = _build_entry(person)
    assert entry["confession_ids"] == ["Q75809", "Q1841"]
    assert "confession_id" not in entry


def test_index_entry_empty_confessions():
    person = {"id": "ci2", "name": {"label": "Empty"}, "confessions": []}
    entry = _build_entry(person)
    assert entry["confession_ids"] == []


def test_index_entry_confession_legacy_fallback():
    """Kui confessions puudub (vana formaat), kasuta legacy confession välja."""
    person = {
        "id": "ci3",
        "name": {"label": "Legacy"},
        "confession": {"id": "Q75809", "label": "Luterlane"},
    }
    entry = _build_entry(person)
    assert entry["confession_ids"] == ["Q75809"]


```

- [ ] **Step 2: Jooksuta testid — peavad EBAÕNNESTUMA**

```bash
cd /home/mf/LLM/VUTT
python -m pytest tests/test_prosopography_ops.py::test_migrate_confession_single tests/test_prosopography_ops.py::test_index_entry_confession_ids -v 2>&1 | head -40
```

Oodatav: FAIL (skript puudub, uued väljad puuduvad)

- [ ] **Step 3: Kirjuta migratsiooniskript**

Loo fail `scripts/migrate_confession_to_confessions.py`:

```python
"""Ühekordselt jooksev skript: konverteerib confession→confessions kõigis prosopograafia kaartides."""
import json
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

_DEFAULT_PROSOPO_DIR = os.path.join(
    os.getenv("VUTT_STATE_DIR", str(PROJECT_ROOT / "state")),
    "prosopography",
)


def migrate(prosopo_dir: str | None = None) -> int:
    """Konverteerib failid; tagastab muudetud failide arvu."""
    target = Path(prosopo_dir or _DEFAULT_PROSOPO_DIR)
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

        if "confessions" in data:
            # Eemalda vana confession väli kui see on jäänud
            if "confession" in data:
                del data["confession"]
                fpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                changed += 1
            continue

        # Konverteeri
        old = data.pop("confession", None)
        if old and isinstance(old, dict) and old.get("id"):
            data["confessions"] = [{"id": old["id"], "label": old.get("label", "")}]
        else:
            data["confessions"] = []

        fpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        changed += 1

    print(f"Migreerisin {changed} faili.")
    return changed


if __name__ == "__main__":
    migrate()
```

- [ ] **Step 4: Uuenda `_index_entry_from_person` backendis**

Ava `server/prosopography/ops.py`. Leia read ~100-102:

```python
    confession_obj = person.get("confession") or {}
```

Asenda:

```python
    _confessions_list = person.get("confessions")
    if _confessions_list is None:
        # legacy fallback
        _conf_legacy = person.get("confession") or {}
        _confessions_list = [{"id": _conf_legacy["id"], "label": _conf_legacy.get("label", "")}] if _conf_legacy.get("id") else []
```

Leia rida ~205:
```python
        "confession_id": confession_obj.get("id"),
```

Asenda:
```python
        "confession_ids": [c["id"] for c in _confessions_list if c.get("id")],
```

- [ ] **Step 5: Jooksuta testid — peavad LÄBIMA**

```bash
python -m pytest tests/test_prosopography_ops.py -v
```

Oodatav: kõik testid PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate_confession_to_confessions.py tests/test_prosopography_ops.py server/prosopography/ops.py
git commit -m "feat: confession→confessions migratsioon + confession_ids + tag_ids indeksis"
```

---

## Task 3: Frontend tüübid, collectionService ja helpers

**Files:**
- Modify: `src/prosopography/types.ts`
- Modify: `src/services/collectionService.ts`
- Modify: `src/prosopography/components/personForm/types.ts`
- Modify: `src/prosopography/components/personForm/helpers.ts`

- [ ] **Step 1: Uuenda `ProsopoIndexEntry` — `src/prosopography/types.ts`**

Leia rida 29:
```typescript
  confession_id: string | null;
```
Asenda:
```typescript
  confession_ids: string[];
```

Leia `ProsopoRecord` rida 103:
```typescript
  confession: { id: string; label: string } | null;
```
Asenda:
```typescript
  confessions: { id: string; label: string }[];
```

- [ ] **Step 2: Lisa `konfessioonid` `Vocabularies` interface'ile — `src/services/collectionService.ts`**

Leia rida 82:
```typescript
  seisused?: VocabularySeisusItem[];
```
Asenda:
```typescript
  seisused?: VocabularySeisusItem[];
  konfessioonid?: VocabularySeisusItem[];
```

- [ ] **Step 3: Uuenda `FormDraft` — `src/prosopography/components/personForm/types.ts`**

Leia rida 50:
```typescript
  confession: LinkedEntity | null;
```
Asenda:
```typescript
  confessions: string[];  // Q-koodide massiiv
```

Leia `emptyDraft()` sees rida:
```typescript
  confession: null,
```
Asenda:
```typescript
  confessions: [],
```

- [ ] **Step 4: Uuenda `helpers.ts` — `draftToPayload` signatuur**

Leia `draftToPayload` funktsioon algus (otsi `export function draftToPayload`). Lisa `konfessioonidVocab` parameeter:

```typescript
export function draftToPayload(
  draft: FormDraft,
  original?: ProsopoRecord,
  seisusedVocab: { id: string; label: { et: string; en: string } }[] = [],
  konfessioonidVocab: { id: string; label: { et: string; en: string } }[] = [],
): Partial<ProsopoRecord> {
```

- [ ] **Step 5: Uuenda `helpers.ts` — `draftToPayload` keha**

Leia read ~279-281:
```typescript
    confession: draft.confession
      ? { id: draft.confession.id || draft.confession.label, label: draft.confession.label, ...(draft.confession.labels ? { labels: draft.confession.labels } : {}) }
      : null,
```
Asenda:
```typescript
    confessions: (draft.confessions ?? []).map(qId => {
      const vocabItem = konfessioonidVocab.find(k => k.id === qId);
      return { id: qId, label: vocabItem?.label?.et ?? qId };
    }),
```

- [ ] **Step 6: Uuenda `helpers.ts` — `recordToDraft`**

Leia rida ~171:
```typescript
    confession: p.confession ? { label: p.confession.label, id: p.confession.id, labels: (p.confession as any).labels ?? null, source: 'wikidata' } : null,
```
Asenda:
```typescript
    confessions: (p.confessions ?? []).map(c => c.id).filter(Boolean) as string[],
```

- [ ] **Step 7: Uuenda `helpers.ts` — `applyEnrichmentToDraft`**

Leia read ~76-80:
```typescript
  // Konfessioon
  if (autoFilled['confession'] && !draft.confession) {
    const c = autoFilled['confession'];
    patch.confession = { label: c.label, id: c.id ?? null, labels: null, source: 'wikidata' };
  }
```
Asenda:
```typescript
  // Konfessioon — lisa auto-täidetud Q-kood massiivi kui veel puudub
  if (autoFilled['confession']?.id && !(draft.confessions ?? []).includes(autoFilled['confession'].id)) {
    patch.confessions = [...(draft.confessions ?? []), autoFilled['confession'].id];
  }
```

- [ ] **Step 8: Kontrolli TypeScript kompileerimine**

```bash
npm run build 2>&1 | grep -E "error TS|Error" | head -30
```

Paranda kõik TypeScript vead enne jätkamist. Tüüpilised vead on `confession` → `confessions` nimetuse muutusest tingitud — otsi `draft.confession` ja `person.confession` üle kogu projekti:

```bash
grep -rn "draft\.confession\b\|person\.confession\b" src/
```

- [ ] **Step 9: Commit**

```bash
git add src/prosopography/types.ts src/services/collectionService.ts src/prosopography/components/personForm/types.ts src/prosopography/components/personForm/helpers.ts
git commit -m "feat: tüübid ja helpers üle confessions[] skeemile"
```

---

## Task 4: PersonEditPage — checkbox-rida

**Files:**
- Modify: `src/prosopography/pages/PersonEditPage.tsx`

- [ ] **Step 1: Lisa `konfessioonid` vocabulary laadimine**

Leia komponendi alguses `seisused` state deklaratsioon (~rida 50-60). Lisa selle järele:

```typescript
const [konfessioonid, setKonfessioonid] = useState<VocabularySeisusItem[]>([]);
```

Leia olemasolev vocabulary laadimine useEffect (otsi `setSeisused`). Uuenda see:

```typescript
useEffect(() => {
  getVocabularies().then(v => {
    if (v.seisused) setSeisused(v.seisused);
    if (v.konfessioonid) setKonfessioonid(v.konfessioonid);
  }).catch(() => {});
}, []);
```

- [ ] **Step 2: Uuenda `draftToPayload` kutsumine**

Leia PersonEditPage-s koht, kus `draftToPayload(draft, original, seisused)` kutsutakse (otsi `draftToPayload`). Uuenda:

```typescript
const payload = draftToPayload(draft, original, seisused, konfessioonid);
```

- [ ] **Step 3: Asenda EntityPicker checkbox-reaga**

Leia read ~504-512 (EntityPicker konfessiooni jaoks):

```typescript
            <EntityPicker
              label={t('confession', 'Konfessioon')}
              placeholder="luterlik, katoliiklik…"
              type="topic"
              value={draft.confession}
              onChange={v => set({ confession: v })}
              lang={lang}
              localSuggestions={entityLabels}
            />
```

Asenda:

```tsx
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('confession', 'Konfessioon')}
              </label>
              <div className="flex flex-wrap gap-2">
                {konfessioonid.map(item => {
                  const label = i18n.language?.startsWith('en') ? item.label.en : item.label.et;
                  const checked = (draft.confessions ?? []).includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        set({
                          confessions: checked
                            ? (draft.confessions ?? []).filter(id => id !== item.id)
                            : [...(draft.confessions ?? []), item.id],
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
                {konfessioonid.length === 0 && (
                  <span className="text-xs text-gray-400 italic">{t('loadingVocab', 'Laadin…')}</span>
                )}
              </div>
            </div>
```

- [ ] **Step 4: Kontrolli TypeScript**

```bash
npm run build 2>&1 | grep -E "error TS|Error" | head -20
```

- [ ] **Step 5: Commit**

```bash
git add src/prosopography/pages/PersonEditPage.tsx
git commit -m "feat: PersonEditPage — konfessiooni checkbox-rida"
```

---

## Task 5: PersonDetailPage — confessions[] kuvamine

**Files:**
- Modify: `src/prosopography/pages/PersonDetailPage.tsx`

PersonDetailPage-s on `confession` kahes kohas: StructuredInfoCard rows (~rida 134) ja visuaalne grid (~rida 440).

- [ ] **Step 1: Uuenda StructuredInfoCard rows**

Leia rida ~134:
```typescript
  if (person.confession) {
    rows.push({ label: t('confession', 'Konfessioon'), value: getLabel(person.confession) });
  }
```
Asenda:
```typescript
  if ((person.confessions?.length ?? 0) > 0) {
    rows.push({
      label: t('confession', 'Konfessioon'),
      value: (person.confessions ?? []).map(c => getLabel(c) || c.label).filter(Boolean).join(', '),
    });
  }
```

- [ ] **Step 2: Uuenda visuaalne grid**

Leia rida ~428:
```typescript
            {((person.statuses?.length ?? 0) > 0 || person.confession) && (
```
Asenda:
```typescript
            {((person.statuses?.length ?? 0) > 0 || (person.confessions?.length ?? 0) > 0) && (
```

Leia read ~440-447:
```typescript
                {person.confession && (
                  <div>
                    <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">
                      {t('confession', 'Konfessioon')}
                    </span>
                    <p className="text-gray-900">{getLabel(person.confession)}</p>
                  </div>
                )}
```
Asenda:
```typescript
                {(person.confessions?.length ?? 0) > 0 && (
                  <div>
                    <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">
                      {t('confession', 'Konfessioon')}
                    </span>
                    <p className="text-gray-900">
                      {(person.confessions ?? []).map(c => getLabel(c) || c.label).filter(Boolean).join(', ')}
                    </p>
                  </div>
                )}
```

- [ ] **Step 3: Kontrolli TypeScript**

```bash
npm run build 2>&1 | grep -E "error TS|Error" | head -20
```

Kontrolli ka, et ühtegi `person.confession` viidet pole enam järel:
```bash
grep -n "person\.confession\b" src/prosopography/pages/PersonDetailPage.tsx
```

Väljund peaks olema tühi.

- [ ] **Step 4: Commit**

```bash
git add src/prosopography/pages/PersonDetailPage.tsx
git commit -m "feat: PersonDetailPage — confessions[] kuvamine"
```

---

## Task 6: Deploy + migratsioon serveris

- [ ] **Step 1: Ehita frontend ja rsync**

```bash
npm run build
rsync -avz dist/ vutt:~/VUTT/dist/
```

- [ ] **Step 2: Lükka kood serverisse ja jooksuta migratsioon**

```bash
ssh vutt
cd ~/VUTT
git pull
.venv/bin/python3 scripts/migrate_confession_to_confessions.py
```

Oodatav väljund: `Migreerisin N faili.` (kus N on isikukaardid kellel oli `confession` väli)

- [ ] **Step 3: Ehita ja käivita backend uuesti**

```bash
docker compose build --no-cache backend
docker compose up -d backend
docker logs vutt-backend --tail 20
```

Kontrolli, et server käivitub ilma vigadeta (otsib `rebuild_indices` käivitumist logides).

- [ ] **Step 4: Verifitseeri**

```bash
curl -s http://localhost:8002/prosopography?limit=2 | python3 -m json.tool | grep -E "confession_id|confession_ids|tag_ids"
```

Oodatav: vastus sisaldab `confession_ids` massiivi (mitte `confession_id`), ning `tag_ids`.

---

## Lahtised küsimused (spekist)

- **Konfessiooni kuupäev** — läheb eluloo vabatekstiväljale, struktureeritud salvestamine pole vajalik.
- **Tags PersonCard-l** — ainult detailvaates (PersonDetailPage), mitte kaardil — kaart on juba tihe.
- **Tags filtreerimine PersonsPage-s** — tuleviku töö, praegu piisab `tag_ids`/`tag_labels` indeksist.
