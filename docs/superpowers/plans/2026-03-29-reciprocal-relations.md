# Vastastikused Seosed — Implementatsiooni Plaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isiku salvestamisel uuendatakse automaatselt ka teiste osapoolte kaardid — lisatakse või eemaldatakse vastastikune seos.

**Architecture:** Uus moodul `server/prosopography/reciprocal_ops.py` sisaldab kogu sünkroniseerimisloogika. Olemasolev PUT endpoint `router.py`-s loeb vana seisu enne salvestust, salvestab uue, seejärel kutsub `sync_reciprocals()` server-side diffiga. Frontend saab ainult visuaalse `↔` markeri.

**Tech Stack:** Python 3.12, FastAPI, pytest, React 19 + TypeScript, Tailwind, lucide-react

---

## Failide kaart

| Fail | Muudatus |
|------|----------|
| `server/prosopography/reciprocal_ops.py` | **Uus** — kogu sünkroniseerimisloogika |
| `tests/test_reciprocal_ops.py` | **Uus** — kõik käitumisreeglid testitud |
| `server/prosopography/router.py` | **Muudatus** — import + PUT endpoint laiendus (~8 rida) |
| `src/prosopography/components/personForm/types.ts` | **Muudatus** — `reciprocal_auto?: boolean` lisamine `RelationDraft`-i |
| `src/prosopography/pages/PersonEditPage.tsx` | **Muudatus** — `↔` marker relations renderItem-is |

---

## Task 1: Kirjuta katkised testid ja stub-moodul

**Files:**
- Create: `tests/test_reciprocal_ops.py`
- Create: `server/prosopography/reciprocal_ops.py` (stub)

- [ ] **Samm 1: Loo stub-moodul minimaalse signatuuriga**

```python
# server/prosopography/reciprocal_ops.py
"""
Vastastikuste seoste sünkroniseerimine.
Kutsutakse router.py PUT endpointist pärast isiku salvestamist.
Kasutab atomic_write_json otse — EI kasuta update_person() — vältimaks lõputut tsüklit.
"""
import json
import os
from datetime import datetime, timezone

from ..config import PROSOPOGRAPHY_DIR, get_logger
from ..utils import atomic_write_json

logger = get_logger(__name__)


def _id_to_path(person_id: str) -> str:
    """vutt:Pabc123 → state/prosopography/abc123.json"""
    nanoid = person_id.removeprefix("vutt:P")
    return os.path.join(PROSOPOGRAPHY_DIR, f"{nanoid}.json")


def _load_person(person_id: str) -> dict | None:
    path = _id_to_path(person_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        logger.exception("Ei suutnud lugeda prosopograafia faili isiku %s jaoks", person_id)
        return None


def sync_reciprocals(
    person_id: str,
    old_relations: list,
    new_relations: list,
    a_label: str,
    username: str,
) -> list[str]:
    raise NotImplementedError
```

- [ ] **Samm 2: Kirjuta testifail käitumisreeglite ja peamiste servajuhtude jaoks**

```python
# tests/test_reciprocal_ops.py
"""
Testid: sync_reciprocals vastab spec käitumisreeglitele.
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography.reciprocal_ops import sync_reciprocals

A_ID = "vutt:Paaaaa"
B_ID = "vutt:Pbbbbb"
C_ID = "vutt:Pccccc"
A_LABEL = "Andreas Berg"


def _write_person(prosopo_dir: Path, person_id: str, relations: list, label: str = "Test Isik") -> Path:
    nanoid = person_id.removeprefix("vutt:P")
    path = prosopo_dir / f"{nanoid}.json"
    data = {
        "id": person_id,
        "name": {"label": label},
        "relations": relations,
        "updated_at": "2026-01-01T00:00:00+00:00",
        "updated_by": "setup",
    }
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


def _read_person(prosopo_dir: Path, person_id: str) -> dict:
    nanoid = person_id.removeprefix("vutt:P")
    return json.loads((prosopo_dir / f"{nanoid}.json").read_text(encoding="utf-8"))


def _run(prosopo_dir: Path, old_relations: list, new_relations: list) -> list[str]:
    with patch("server.prosopography.reciprocal_ops.PROSOPOGRAPHY_DIR", str(prosopo_dir)):
        return sync_reciprocals(A_ID, old_relations, new_relations, A_LABEL, "testuser")


# ── Reegel 1+2: ainult target_id-ga seosed, hulga-põhine diff ──────────────

def test_linked_relation_adds_reciprocal(tmp_path):
    """Uue target_id lisamisel lisatakse B-le vastasseos; updated_by uuendatakse."""
    _write_person(tmp_path, B_ID, [])
    synced = _run(tmp_path, old_relations=[], new_relations=[{"name": "B", "type": "õpetaja", "target_id": B_ID}])
    b = _read_person(tmp_path, B_ID)
    assert len(b["relations"]) == 1
    assert b["relations"][0]["target_id"] == A_ID
    assert b["relations"][0]["reciprocal_auto"] is True
    assert b["relations"][0]["type"] == ""
    assert b["relations"][0]["name"] == A_LABEL
    assert B_ID in synced
    assert b["updated_by"] == "testuser"
    assert b["updated_at"] != "2026-01-01T00:00:00+00:00"  # timestamp uuendati


def test_unlinked_relation_ignored(tmp_path):
    """Ilma target_id-ta seos ei käivita sync'i."""
    _write_person(tmp_path, B_ID, [])
    synced = _run(tmp_path, old_relations=[], new_relations=[{"name": "Keegi", "type": "", "target_id": None}])
    b = _read_person(tmp_path, B_ID)
    assert b["relations"] == []
    assert synced == []


# ── Reegel 3: idempotentsus ────────────────────────────────────────────────

def test_existing_relation_not_duplicated(tmp_path):
    """Kui B-l on juba seos A-ga, ei lisata duplikaati."""
    _write_person(tmp_path, B_ID, [{"name": A_LABEL, "type": "", "target_id": A_ID, "reciprocal_auto": True}])
    _run(tmp_path, old_relations=[], new_relations=[{"name": "B", "type": "kolleeg", "target_id": B_ID}])
    b = _read_person(tmp_path, B_ID)
    assert len(b["relations"]) == 1  # ei lisatu duplikaati


def test_manual_relation_to_a_blocks_auto_add(tmp_path):
    """Kui B-l on käsitsi seos A-ga (target_id olemas), ei lisata auto-seost."""
    _write_person(tmp_path, B_ID, [{"name": A_LABEL, "type": "sõber", "target_id": A_ID}])
    _run(tmp_path, old_relations=[], new_relations=[{"name": "B", "type": "kolleeg", "target_id": B_ID}])
    b = _read_person(tmp_path, B_ID)
    assert len(b["relations"]) == 1
    assert b["relations"][0]["type"] == "sõber"  # käsitsi seos puutumata


# ── Reegel 4: eemaldamine ainult reciprocal_auto read ─────────────────────

def test_removal_removes_reciprocal_auto_row(tmp_path):
    """Seose eemaldamisel eemaldatakse B-lt reciprocal_auto rida."""
    _write_person(tmp_path, B_ID, [{"name": A_LABEL, "type": "", "target_id": A_ID, "reciprocal_auto": True}])
    synced = _run(tmp_path, old_relations=[{"name": "B", "type": "", "target_id": B_ID}], new_relations=[])
    b = _read_person(tmp_path, B_ID)
    assert b["relations"] == []
    assert B_ID in synced


def test_removal_keeps_manual_row(tmp_path):
    """Seose eemaldamisel jääb B-le käsitsi lisatud seos A-ga puutumata."""
    _write_person(tmp_path, B_ID, [{"name": A_LABEL, "type": "mentor", "target_id": A_ID}])
    _run(tmp_path, old_relations=[{"name": "B", "type": "", "target_id": B_ID}], new_relations=[])
    b = _read_person(tmp_path, B_ID)
    assert len(b["relations"]) == 1
    assert b["relations"][0]["type"] == "mentor"  # käsitsi seos puutumata


# ── Reegel 2: hulga-diff — mitu seost sama B-ga ───────────────────────────

def test_multi_edge_partial_removal_keeps_reciprocal(tmp_path):
    """A-l on B-ga kaks seost. Ühe eemaldamisel jääb B vastasseos alles."""
    _write_person(tmp_path, B_ID, [{"name": A_LABEL, "type": "", "target_id": A_ID, "reciprocal_auto": True}])
    old_rels = [
        {"name": "B", "type": "õpetaja", "target_id": B_ID},
        {"name": "B", "type": "kolleeg", "target_id": B_ID},
    ]
    new_rels = [{"name": "B", "type": "õpetaja", "target_id": B_ID}]  # "kolleeg" eemaldati
    _run(tmp_path, old_relations=old_rels, new_relations=new_rels)
    b = _read_person(tmp_path, B_ID)
    assert len(b["relations"]) == 1  # vastasseos jääb alles


# ── Reegel 4 kombinatsioon: auto + käsitsi rida samal ajal ───────────────

def test_removal_with_both_auto_and_manual_rows(tmp_path):
    """B-l on korraga auto-rida JA käsitsi rida A-ga. A eemaldab seose.
    Auto-rida kustutatakse, käsitsi rida jääb alles."""
    _write_person(tmp_path, B_ID, [
        {"name": A_LABEL, "type": "", "target_id": A_ID, "reciprocal_auto": True},
        {"name": A_LABEL, "type": "sõber", "target_id": A_ID},  # käsitsi, ilma reciprocal_auto
    ])
    _run(tmp_path, old_relations=[{"name": "B", "type": "", "target_id": B_ID}], new_relations=[])
    b = _read_person(tmp_path, B_ID)
    assert len(b["relations"]) == 1
    assert b["relations"][0]["type"] == "sõber"
    assert "reciprocal_auto" not in b["relations"][0]


# ── Servajuhud ─────────────────────────────────────────────────────────────

def test_b_not_found_skipped_gracefully(tmp_path):
    """B faili puudumisel ei krahhita."""
    # B faili ei looda — peaks sujuvalt vahele jätma
    synced = _run(tmp_path, old_relations=[], new_relations=[{"name": "B", "type": "", "target_id": B_ID}])
    assert synced == []


def test_returns_synced_ids(tmp_path):
    """Tagastab edukalt uuendatud B ID-de nimekirja."""
    _write_person(tmp_path, B_ID, [])
    _write_person(tmp_path, C_ID, [])
    synced = _run(
        tmp_path,
        old_relations=[],
        new_relations=[
            {"name": "B", "type": "", "target_id": B_ID},
            {"name": "C", "type": "", "target_id": C_ID},
        ],
    )
    assert set(synced) == {B_ID, C_ID}
```

- [ ] **Samm 3: Käivita testid — kinnita et kõik kukuvad**

```bash
cd /home/mf/LLM/VUTT && python -m pytest tests/test_reciprocal_ops.py -v 2>&1 | head -40
```

Oodatav tulemus: `NotImplementedError` kõigis testides.

- [ ] **Samm 4: Commit**

```bash
git add server/prosopography/reciprocal_ops.py tests/test_reciprocal_ops.py
git commit -m "test: lisa sync_reciprocals testid (TDD — kõik punased)"
```

---

## Task 2: Implementeeri sync_reciprocals

**Files:**
- Modify: `server/prosopography/reciprocal_ops.py`

- [ ] **Samm 1: Asenda stub täieliku implementatsiooniga**

```python
# server/prosopography/reciprocal_ops.py
"""
Vastastikuste seoste sünkroniseerimine.
Kutsutakse router.py PUT endpointist pärast isiku salvestamist.
Kasutab atomic_write_json otse — EI kasuta update_person() — vältimaks lõputut tsüklit.
"""
import json
import os
from datetime import datetime, timezone

from ..config import PROSOPOGRAPHY_DIR, get_logger
from ..utils import atomic_write_json

logger = get_logger(__name__)


def _id_to_path(person_id: str) -> str:
    """vutt:Pabc123 → state/prosopography/abc123.json"""
    nanoid = person_id.removeprefix("vutt:P")
    return os.path.join(PROSOPOGRAPHY_DIR, f"{nanoid}.json")


def _load_person(person_id: str) -> dict | None:
    path = _id_to_path(person_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        logger.exception("Ei suutnud lugeda prosopograafia faili isiku %s jaoks", person_id)
        return None


def sync_reciprocals(
    person_id: str,
    old_relations: list,
    new_relations: list,
    a_label: str,
    username: str,
) -> list[str]:
    """
    Võrdleb A vana ja uut relations-nimekirja (mõlemad server-side).
    Lisab/eemaldab vastastikuseid seoseid puudutatud B kaartidel.
    Tagastab uuendatud isikute ID-d.

    Käitumisreeglid:
    1. Arvestab ainult target_id-ga seoseid.
    2. Diff võrdleb target_id hulkasid, mitte üksikuid ridu.
    3. B-le lisatakse auto-seos ainult kui B-l puudub igasugune seos A-ga.
    4. B-lt eemaldatakse ainult read kus target_id==A.id ja reciprocal_auto==True.
    5. Olemasolevaid ridu ei muudeta osaliselt.
    6. Ei kasuta update_person() — väldib rekursiivset sync'i.
    """
    old_ids = {r["target_id"] for r in old_relations if r.get("target_id")}
    new_ids = {r["target_id"] for r in new_relations if r.get("target_id")}

    added = new_ids - old_ids    # B-dele, kellele lisati seos
    removed = old_ids - new_ids  # B-dele, kellelt eemaldati viimane seos

    synced: list[str] = []
    # Üks timestamp kogu sync-jooksu jaoks — kõik uuendatud B kaardid saavad sama ajamärgi
    now = datetime.now(timezone.utc).isoformat()

    for b_id in added:
        b = _load_person(b_id)
        if b is None:
            logger.warning("sync_reciprocals: isikut %s ei leitud, jätan vahele", b_id)
            continue
        # Reegel 3: idempotentsus — ära lisa kui B-l on juba seos A-ga
        if any(r.get("target_id") == person_id for r in b.get("relations", [])):
            continue
        b.setdefault("relations", []).append({
            "name": a_label,
            "type": "",
            "target_id": person_id,
            "reciprocal_auto": True,
        })
        b["updated_at"] = now
        b["updated_by"] = username
        atomic_write_json(_id_to_path(b_id), b)
        synced.append(b_id)

    for b_id in removed:
        b = _load_person(b_id)
        if b is None:
            logger.warning("sync_reciprocals: isikut %s ei leitud, jätan vahele", b_id)
            continue
        before = b.get("relations", [])
        # Reegel 4: eemalda ainult reciprocal_auto read.
        # MVP kompromiss: eemaldatakse isegi kui kasutaja on type täitnud.
        # Tulevikus kaaluda: kui type pole tühi → konverteeri käsitsi seoseks.
        after = [
            r for r in before
            if not (r.get("target_id") == person_id and r.get("reciprocal_auto"))
        ]
        if len(after) == len(before):
            continue  # midagi ei muutunud
        b["relations"] = after
        b["updated_at"] = now
        b["updated_by"] = username
        atomic_write_json(_id_to_path(b_id), b)
        synced.append(b_id)

    return synced
```

- [ ] **Samm 2: Käivita testid — kinnita et kõik lähevad roheliseks**

```bash
cd /home/mf/LLM/VUTT && python -m pytest tests/test_reciprocal_ops.py -v
```

Oodatav tulemus: kõik 10 testi `PASSED`.

- [ ] **Samm 3: Commit**

```bash
git add server/prosopography/reciprocal_ops.py
git commit -m "feat: lisa sync_reciprocals — vastastikuste seoste sünkroniseerimine"
```

---

## Task 3: Integreeri router.py PUT endpointiga

**Files:**
- Modify: `server/prosopography/router.py`

- [ ] **Samm 1: Lisa impordid router.py algusesse**

Faili `server/prosopography/router.py` alguses, olemasolevate `.ops` importide juurde:

```python
from ..config import get_logger
from .reciprocal_ops import sync_reciprocals

logger = get_logger(__name__)
```

- [ ] **Samm 2: Muuda PUT endpoint**

Leia `@router.put("/{person_id:path}")` endpoint (praegu ~rida 356). Asenda:

```python
@router.put("/{person_id:path}")
async def prosopography_update(
    person_id: str,
    request: Request,
    user=Depends(_require_role("editor")),
):
    """
    Uuendab isiku kirjet.
    Nõuab updated_at välja — kui ei klapi → 409 Conflict.
    Pärast salvestust sünkroniseerib vastastikused seosed (best-effort).
    """
    data = await _get_json(request)
    # Loe vana seis ENNE salvestust — server-side diff vastastikuste seoste jaoks
    old_person = get_person(person_id)
    old_relations = (old_person or {}).get("relations", [])
    try:
        person = update_person(person_id, data, username=user["username"])
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Isikut ei leitud: {person_id}")
    except ValueError as e:
        msg = str(e)
        if msg.startswith("conflict:"):
            current_updated_at = msg.split(":", 1)[1]
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "conflict",
                    "message": "Kirjet on vahepeal muudetud.",
                    "current_updated_at": current_updated_at,
                },
            )
        raise HTTPException(status_code=400, detail=msg)
    # Sünkroniseeri vastastikused seosed (best-effort — viga ei blokeeri 200 vastust)
    try:
        a_label = (person.get("name") or {}).get("label", "")
        sync_reciprocals(
            person_id,
            old_relations,
            person.get("relations", []),
            a_label,
            username=user["username"],
        )
    except Exception:
        logger.exception("sync_reciprocals ebaõnnestus isiku %s jaoks", person_id)
    enrich_entity_labels_from_person_async(person)
    return person
```

- [ ] **Samm 3: Käivita olemasolevad testid — kontrolli et midagi ei katke**

```bash
cd /home/mf/LLM/VUTT && python -m pytest tests/ -v
```

Oodatav tulemus: kõik testid `PASSED`.

- [ ] **Samm 4: Commit**

```bash
git add server/prosopography/router.py
git commit -m "feat: integreeri sync_reciprocals PUT endpointiga (server-side diff)"
```

---

## Task 4: Frontend — RelationDraft tüüp ja UI marker

**Files:**
- Modify: `src/prosopography/components/personForm/types.ts`
- Modify: `src/prosopography/pages/PersonEditPage.tsx`

- [ ] **Samm 1: Lisa `reciprocal_auto` väli RelationDraft tüüpi**

Failis `src/prosopography/components/personForm/types.ts`, rida 25:

```typescript
// Enne:
export interface RelationDraft { name: string; type: string; target_id?: string | null }

// Pärast:
export interface RelationDraft {
  name: string;
  type: string;
  target_id?: string | null;
  reciprocal_auto?: boolean;
}
```

- [ ] **Samm 2: Lisa `ArrowLeftRight` import PersonEditPage-sse**

Failis `src/prosopography/pages/PersonEditPage.tsx`, rida 4, lisa `ArrowLeftRight` olemasolevasse lucide-react importi:

```typescript
import {
  ArrowLeft, Save, X, Loader2,
  ImagePlus, Trash2, ExternalLink,
  ArrowLeftRight,
} from 'lucide-react';
```

- [ ] **Samm 3: Lisa `↔` marker relations renderItem-isse**

Failis `src/prosopography/pages/PersonEditPage.tsx`, leia relations `renderItem` (praegu ~rida 642). Asenda:

```tsx
renderItem={(item, onChange, onRemove) => (
  <div className="flex items-center gap-2">
    <ProsopoPersonPicker value={item} onChange={onChange} token={token} currentId={id} />
    <input
      type="text"
      value={item.type}
      onChange={e => onChange({ ...item, type: e.target.value })}
      placeholder={t('form.relationPlaceholder')}
      className={`w-36 ${inputCls} shrink-0`}
    />
    {item.target_id && (
      <span
        title={
          item.reciprocal_auto
            ? t('form.reciprocalAutoTooltip')
            : t('form.reciprocalTooltip')
        }
        className="shrink-0 text-gray-400"
      >
        <ArrowLeftRight size={13} />
      </span>
    )}
    <button onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0">
      <X size={14} />
    </button>
  </div>
)}
```

- [ ] **Samm 4: Lisa tõlkevõtmed**

Failis `src/locales/et/prosopography.json`, lisa `form` objekti:
```json
"reciprocalTooltip": "Vastasseos uuendatakse automaatselt salvestamisel.",
"reciprocalAutoTooltip": "Automaatne vastasseos; täpsusta tüüp vajadusel käsitsi."
```

Failis `src/locales/en/prosopography.json`, lisa `form` objekti:
```json
"reciprocalTooltip": "Reciprocal relation will be updated automatically on save.",
"reciprocalAutoTooltip": "Auto-generated reciprocal relation; fill in the type manually if needed."
```

- [ ] **Samm 5: Käivita TypeScript kontroll**

```bash
cd /home/mf/LLM/VUTT && npm run build 2>&1 | tail -20
```

Oodatav tulemus: `✓ built in` — no TypeScript errors.

- [ ] **Samm 6: Commit**

```bash
git add src/prosopography/components/personForm/types.ts \
        src/prosopography/pages/PersonEditPage.tsx \
        src/locales/et/prosopography.json \
        src/locales/en/prosopography.json
git commit -m "feat: lisa vastastikuse seose UI marker PersonEditPage-l"
```

---

## Lõplik kontroll

- [ ] Käivita kõik testid: `python -m pytest tests/ -v`
- [ ] Käivita build: `npm run build`
- [ ] **Lisamine:** ava isiku A edit leht, lisa seos isikule B, salvesta → ava B kaart → vastasseos peab olema lisandunud `reciprocal_auto: true` märkusega; `↔` ikoon peab olema nähtav A edit lehel B rea kõrval
- [ ] **Eemaldamine:** ava A edit leht, eemalda seos B-le, salvesta → ava B kaart → auto-seos peab kadunud olema
- [ ] **Käsitsi seose säilimine:** lisa B kaardile käsitsi seos A-le (täida `type`), seejärel ava A edit leht ja eemalda A-poolne seos B-le, salvesta → ava B kaart → käsitsi seos A-le peab jääma alles
