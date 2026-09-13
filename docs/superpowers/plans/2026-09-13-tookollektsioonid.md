# Töökollektsioonid — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin saab luua kureeritud teoste valiku („Fischeri konverents 2027"), anda sellele vaatajaid ja haldureid ning kasutada seda päisest valitava töökontekstina kogu töölaual.

**Architecture:** Töökollektsioon on eraldi objekt (`data/config/work_sets/<id>.json`), mitte kollektsioon. Liikmesust **ei indekseerita Meilisearchi** — server tagastab kutsujale otsingus-nähtavad `work_id`-d ja klient filtreerib `work_id IN [...]` olemasoleva ligipääsufiltri kõrval. Teoste `collections`, `is_public` ja `shareable` jäävad puutumata.

**Tech Stack:** FastAPI (Python 3.9), GitPython (`save_config_with_git`), React 19 + TypeScript, Meilisearch (tenant-tokenid), vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-09-13-tookollektsioonid-design.md` (rev 3)
**Issue:** #354

## Global Constraints

- **Python 3.9** — `Optional[dict]`, mitte `dict | None`.
- **Blokeeriv I/O `async def` sees on keelatud** (ADR 0002): kas sync `def` route (FastAPI viib threadpooli) või `run_in_threadpool`.
- **Endpointid elavad routerites**, mitte `main.py`-s.
- **Rollikontroll ALATI `is_at_least` / `isAtLeast`**, mitte `role == "admin"`.
- **i18n:** `fallbackLng` on VÄLJAS (ADR 0011) — iga uus võti läheb **korraga** `src/locales/et/*.json` ja `src/locales/en/*.json` sisse, muidu kukub build.
- **Autoriteetne konfiguratsioon commititakse** `save_config_with_git`-iga (ADR 0040).
- **`server/cache.py` on selle töö jaoks keelatud** — sealsed vahemälud on globaalsed moodulitasandi muutujad; kasutajapõhise vastuse hoidmine seal on risti-kasutaja leke.
- **Liikmesus ei jõua Meilisearchi mitte kusagil.** Ei uut välja, ei liitmist `collections` / `collections_hierarchy` sisse.
- **Testid:** `.venv/bin/pytest tests/` (projekti venv, süsteemi `python3`-l puuduvad sõltuvused), `npm test`, `npm run typecheck`.
- **Lagi:** `WORK_SET_MAX_MEMBERS = 1000` unikaalset liiget kogu kohta (Task 1 võib seda langetada).

## File Structure

| Fail | Vastutus |
|---|---|
| `server/config.py` (muuda) | `WORK_SETS_DIR`, `WORK_SET_MAX_MEMBERS` |
| `server/work_sets_ops.py` (uus) | Faili paigutus, lukk, `revision`, laadimine/salvestamine, liikmete muutmine |
| `server/work_sets_access.py` (uus) | `can_view_set`, `can_manage_set`, `search_visible_work_ids` |
| `server/routers/work_sets.py` (uus) | 9 endpointi, õiguste väravad, veavastused |
| `server/main.py` (muuda) | routeri ühendamine |
| `src/services/workSetService.ts` (uus) | API-klient + aktiivse valiku ID-loendi hoidmine |
| `src/services/selectionFilter.ts` (uus) | `CollectionSelection` → Meili filtriklausel (puhas, testitav) |
| `src/contexts/collectionSync.ts` (muuda) | ainus suunaotsustaja, laieneb valiku-tokenile |
| `src/contexts/CollectionContext.tsx` (muuda) | `selection` + tagasiühilduv `selectedCollection` |
| `src/components/CollectionPicker.tsx` (muuda) | kaks jaotist |
| `src/pages/admin/WorkSets.tsx` (uus) | kogude haldus |
| `tests/test_work_sets_*.py`, `src/services/__tests__/*.test.ts` | valvurid |

---

### Task 1: Jõudluskatse — kogu ahel, mitte ainult Meili päring

**Files:**
- Create: `scripts/measure_work_set_filter.py` (**visatakse pärast ära** — tulemus läheb issue'sse #354)

**Interfaces:**
- Consumes: —
- Produces: otsus `WORK_SET_MAX_MEMBERS` kohta (Task 2 kasutab seda arvu)

Ainus ülesanne, millel ei ole testi: see on mõõtmine, mille tulemus otsustab lae. Ilma selleta on 1000 arvamus.

- [ ] **Step 1: Kirjuta mõõteskript**

```python
"""Mõõdab töökollektsiooni päringuahela maksumuse (#354, Task 1).

Kolm mõõdetavat: (1) puhas Meili tekstiotsing suure work_id IN filtriga,
(2) sama + serveripoolne ID-loendi koostamine õiguskontrollidega,
(3) päise arvud N kogu korral. Visatakse pärast ära.
"""
import json, random, statistics, time, urllib.request

MEILI = "http://localhost:7700"
INDEX = "teosed"
KEY = __import__("os").environ["MEILI_MASTER_KEY"]


def meili_search(body):
    req = urllib.request.Request(
        f"{MEILI}/indexes/{INDEX}/search",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"},
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req) as r:
        payload = json.load(r)
    return (time.perf_counter() - t0) * 1000, payload


def sample_work_ids(n):
    _, res = meili_search({"q": "", "limit": 0, "facets": ["work_id"]})
    ids = list(res["facetDistribution"]["work_id"].keys())
    random.shuffle(ids)
    return ids[:n]


for n in (100, 500, 1000):
    ids = sample_work_ids(n)
    flt = "work_id IN [%s]" % ", ".join(f'"{i}"' for i in ids)
    for q in ("", "orati", "de"):
        kestused = []
        for _ in range(5):
            ms, res = meili_search({
                "q": q, "limit": 10, "page": 1, "hitsPerPage": 12,
                "filter": [flt, "is_public = true"],
            })
            kestused.append(ms)
        print("n=%-5d q=%-6r mediaan=%6.1f ms  totalHits=%s"
              % (n, q, statistics.median(kestused), res.get("totalHits")))
```

- [ ] **Step 2: Jooksuta serveris**

```bash
scp scripts/measure_work_set_filter.py vutt:/tmp/
ssh vutt 'cd ~/VUTT && set -a && . .env && set +a && .venv/bin/python3 /tmp/measure_work_set_filter.py'
```

Oodatav: iga rida annab mediaani millisekundites. Võrdlusalus on sama päring ilma `work_id IN` filtrita.

- [ ] **Step 3: Mõõda serveripoolne ID-loendi kulu**

Ajasta `search_visible_work_ids` prototüüp 1000 teose peal (loeb `_metadata.json`-e). Kui see ületab ~200 ms, tuleb Task 3-s loend ette arvutada kogu salvestamisel, mitte iga päringu peal koostada.

- [ ] **Step 4: Kirjuta tulemus issue'sse ja otsusta lagi**

```bash
gh issue comment 354 --body "Jõudluskatse (Task 1), tootmine: <tabel>. Otsus: WORK_SET_MAX_MEMBERS = <arv>."
```

- [ ] **Step 5: Kustuta skript**

```bash
rm scripts/measure_work_set_filter.py
```

Kood ei jää alles — tulemus jääb.

---

### Task 2: Salvestuskiht (`work_sets_ops.py`)

**Files:**
- Create: `server/work_sets_ops.py`
- Modify: `server/config.py` (lisa `WORK_SETS_DIR`, `WORK_SET_MAX_MEMBERS`)
- Test: `tests/test_work_sets_ops.py`

**Interfaces:**
- Consumes: `save_config_with_git(filepath, data, username, message)` (`server/git_ops.py:488`), `generate_nanoid()` (`server/utils.py:66`)
- Produces:
  - `load_work_set(set_id) -> Optional[dict]`
  - `list_work_sets() -> list` (kõik kogud, filtreerimata)
  - `create_work_set(name, description, username) -> dict`
  - `update_work_set(set_id, changes, username, expected_revision) -> dict`
  - `mutate_members(set_id, add, remove, username, expected_revision) -> dict`
  - erandid `WorkSetConflict` (409), `WorkSetLimit` (409), `WorkSetNotFound` (404)

- [ ] **Step 1: Lisa konfiguratsioon**

`server/config.py`, `_DATA_CONFIG_DIR` määratluse järele:

```python
WORK_SETS_DIR = os.path.join(_DATA_CONFIG_DIR, "work_sets")
WORK_SET_MAX_MEMBERS = 1000  # Task 1 mõõtmise tulemus; kaitseb ühe filtripäringu suurust
```

- [ ] **Step 2: Kirjuta kukkuvad testid**

`tests/test_work_sets_ops.py`:

```python
"""Töökollektsiooni salvestuskiht (#354).

Liikmesus on autoriteetne fail, mitte tuletatud read-model: iga muudatus
commititakse (ADR 0040) ja `revision` kaitseb samaaegse ülekirjutamise eest.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.work_sets_ops as ops


@pytest.fixture
def kaust(tmp_path, monkeypatch):
    monkeypatch.setattr(ops, "WORK_SETS_DIR", str(tmp_path / "work_sets"))
    monkeypatch.setattr(ops, "WORK_SET_MAX_MEMBERS", 3)
    kirjutised = []
    monkeypatch.setattr(ops, "save_config_with_git",
                        lambda p, d, u, message=None: kirjutised.append((p, d, u)) or {"success": True})
    return {"tmp": tmp_path, "kirjutised": kirjutised}


def test_loomine_annab_id_ja_teeb_loojast_halduri(kaust):
    ws = ops.create_work_set({"et": "Fischer", "en": ""}, {"et": "", "en": ""}, "mari")
    assert ws["id"].startswith("ws_")
    assert ws["access"]["mari"] == "manager"
    assert ws["revision"] == 1
    assert ws["visibility"] == "members" and ws["status"] == "active"
    assert ws["works"] == []


def test_vananenud_revision_ei_kirjuta_ule(kaust):
    ws = ops.create_work_set({"et": "Fischer", "en": ""}, {}, "mari")
    ops.mutate_members(ws["id"], ["a"], [], "mari", expected_revision=1)
    with pytest.raises(ops.WorkSetConflict):
        ops.mutate_members(ws["id"], ["b"], [], "mari", expected_revision=1)


def test_lisamine_on_idempotentne_ja_revision_kasvab(kaust):
    ws = ops.create_work_set({"et": "F", "en": ""}, {}, "mari")
    r1 = ops.mutate_members(ws["id"], ["a", "a"], [], "mari", expected_revision=1)
    assert r1["works"] == ["a"] and r1["revision"] == 2
    r2 = ops.mutate_members(ws["id"], ["a"], [], "mari", expected_revision=2)
    assert r2["works"] == ["a"] and r2["revision"] == 2, "muutusteta toiming on no-op"


def test_lae_uletamine_ei_lisa_osaliselt(kaust):
    ws = ops.create_work_set({"et": "F", "en": ""}, {}, "mari")
    ops.mutate_members(ws["id"], ["a", "b"], [], "mari", expected_revision=1)
    with pytest.raises(ops.WorkSetLimit):
        ops.mutate_members(ws["id"], ["c", "d"], [], "mari", expected_revision=2)
    assert ops.load_work_set(ws["id"])["works"] == ["a", "b"]


def test_tundmatu_liikme_eemaldamine_on_noop_mitte_viga(kaust):
    ws = ops.create_work_set({"et": "F", "en": ""}, {}, "mari")
    ops.mutate_members(ws["id"], ["a"], [], "mari", expected_revision=1)
    r = ops.mutate_members(ws["id"], [], ["kustutatud-teos"], "mari", expected_revision=2)
    assert r["works"] == ["a"]
```

- [ ] **Step 3: Jooksuta, veendu et kukub**

Run: `.venv/bin/pytest tests/test_work_sets_ops.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.work_sets_ops'`

- [ ] **Step 4: Kirjuta moodul**

`server/work_sets_ops.py`:

```python
"""Töökollektsioonide salvestuskiht (#354).

Liikmesus EI OLE tuletatud read-model: see on kuraatori otsus, millel on autor ja
taastepunkt → `save_config_with_git` (ADR 0040). Liikmesust ei indekseerita
Meilisearchi; otsing filtreerib `work_id IN [...]` serverilt saadud loendiga.
"""
import json
import os
import threading
from datetime import datetime, timezone
from typing import Optional

from .config import WORK_SETS_DIR, WORK_SET_MAX_MEMBERS, get_logger
from .git_ops import save_config_with_git
from .utils import generate_nanoid

logger = get_logger(__name__)

# Loe-muuda-salvesta peab olema jagamatu: kaks haldurit kirjutaksid muidu
# teineteise muudatuse üle. PIIRANG: protsessi-lokaalne — mitme workeriga
# gunicorni juures vajab protsessideülest lukku (sama hoiatus nagu RENDER_SEMAPHORE).
_work_sets_lock = threading.RLock()


class WorkSetNotFound(Exception):
    pass


class WorkSetConflict(Exception):
    """Oodatud `revision` ei vasta failis olevale."""
    def __init__(self, current_revision):
        super().__init__(f"revision {current_revision}")
        self.current_revision = current_revision


class WorkSetLimit(Exception):
    """Lisamine viiks liikmete arvu üle lae. Kannab ARVE — router otsustab,
    kas need kutsujale näidatakse (varjatud liikmete arv on admin-info)."""
    def __init__(self, current, adding, limit):
        super().__init__("limit")
        self.current, self.adding, self.limit = current, adding, limit


def _path(set_id: str) -> str:
    return os.path.join(WORK_SETS_DIR, f"{set_id}.json")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def load_work_set(set_id: str) -> Optional[dict]:
    """Katkine JSON EI ole tühi kogu: viskab, et kutsuja ei kirjutaks teda üle."""
    path = _path(set_id)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def list_work_sets() -> list:
    if not os.path.isdir(WORK_SETS_DIR):
        return []
    out = []
    for name in sorted(os.listdir(WORK_SETS_DIR)):
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(WORK_SETS_DIR, name), "r", encoding="utf-8") as f:
                out.append(json.load(f))
        except Exception as e:
            logger.error(f"Katkine töökollektsioon {name}: {e}")
    return out


def _save(ws: dict, username: str, message: str) -> dict:
    os.makedirs(WORK_SETS_DIR, exist_ok=True)
    ws["updated_at"] = _now()
    ws["updated_by"] = username
    save_config_with_git(_path(ws["id"]), ws, username, message)
    return ws


def create_work_set(name: dict, description: Optional[dict], username: str) -> dict:
    with _work_sets_lock:
        set_id = f"ws_{generate_nanoid()}"
        ws = {
            "id": set_id,
            "name": name,
            "description": description or {"et": "", "en": ""},
            "visibility": "members",
            "status": "active",
            "ever_published": False,
            "access": {username: "manager"},
            "works": [],
            "revision": 1,
            "created_by": username,
            "created_at": _now(),
        }
        return _save(ws, username, f"Töökollektsioon: loo {set_id}")


def _check_revision(ws: dict, expected_revision: Optional[int]):
    if expected_revision is not None and ws.get("revision") != expected_revision:
        raise WorkSetConflict(ws.get("revision"))


def update_work_set(set_id: str, changes: dict, username: str,
                    expected_revision: Optional[int] = None) -> dict:
    with _work_sets_lock:
        ws = load_work_set(set_id)
        if ws is None:
            raise WorkSetNotFound(set_id)
        _check_revision(ws, expected_revision)
        muutus = False
        for key in ("name", "description", "status", "visibility", "access"):
            if key in changes and changes[key] != ws.get(key):
                ws[key] = changes[key]
                muutus = True
        if changes.get("visibility") == "public":
            ws["ever_published"] = True
        if not muutus:
            return ws  # muutusteta salvestus on no-op (ADR 0012 joon)
        ws["revision"] = ws.get("revision", 1) + 1
        return _save(ws, username, f"Töökollektsioon: muuda {set_id}")


def mutate_members(set_id: str, add, remove, username: str,
                   expected_revision: Optional[int] = None) -> dict:
    """Lisamine ja eemaldamine EI ole sümmeetrilised (#354 arvustus).

    Lisatavate ID-de olemasolu ja loetavuse kontrollib router (tal on kutsuja).
    Siin: unikaalsus, lagi ja järjekorra säilimine. Eemaldamine ei nõua, et
    teos veel eksisteeriks — just nii koristatakse kustutatud teoste viiteid.
    """
    with _work_sets_lock:
        ws = load_work_set(set_id)
        if ws is None:
            raise WorkSetNotFound(set_id)
        _check_revision(ws, expected_revision)
        praegu = list(ws.get("works", []))
        olemas = set(praegu)
        lisatavad = [w for w in dict.fromkeys(add or []) if w not in olemas]
        if lisatavad and len(olemas) + len(lisatavad) > WORK_SET_MAX_MEMBERS:
            raise WorkSetLimit(len(olemas), len(lisatavad), WORK_SET_MAX_MEMBERS)
        eemaldatavad = set(remove or [])
        uus = [w for w in praegu if w not in eemaldatavad] + lisatavad
        if uus == praegu:
            return ws
        ws["works"] = uus
        ws["revision"] = ws.get("revision", 1) + 1
        return _save(ws, username, f"Töökollektsioon: liikmed {set_id}")
```

- [ ] **Step 5: Jooksuta testid**

Run: `.venv/bin/pytest tests/test_work_sets_ops.py -v`
Expected: PASS (5 testi)

- [ ] **Step 6: Commit**

```bash
git add server/work_sets_ops.py server/config.py tests/test_work_sets_ops.py
git commit -m "feat(work-sets): salvestuskiht lukustuse ja revisjonikontrolliga (#354)"
```

---

### Task 3: Õiguste kiht (`work_sets_access.py`)

**Files:**
- Create: `server/work_sets_access.py`
- Test: `tests/test_work_sets_access.py`

**Interfaces:**
- Consumes: `can_read_work`, `is_work_public` (`server/access_ops.py`), `is_at_least` (`server/auth.py`), `load_work_set` (Task 2)
- Produces:
  - `can_view_set(ws, user) -> bool`
  - `can_manage_set(ws, user) -> bool`
  - `is_search_visible(work_metadata, user) -> bool`
  - `search_visible_work_ids(ws, user) -> list`

- [ ] **Step 1: Kirjuta kukkuvad testid**

`tests/test_work_sets_access.py`:

```python
"""Töökollektsiooni õigused (#354).

Kaks lugemispredikaati EI OLE samad: `can_read_work` lubab `shareable`-teost
(lingiga avatav), tenant-tokeni filter (`meilisearch_ops.py:586`) mitte.
Otsingufiltrisse minev ID-loend peab kasutama OTSINGUS-NÄHTAVUSE predikaati,
muidu näitab kogu arv teost, mille sirvimine jääb tühjaks.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.work_sets_access as acc

AVALIK = {"id": "w1", "collections": ["academia-gustaviana"]}
PIIRATUD = {"id": "w2", "collections": ["vennastekoguduse-materjalid"]}
JAGATAV = {"id": "w3", "collections": ["vennastekoguduse-materjalid"], "shareable": True}

WS = {"id": "ws_1", "visibility": "members", "status": "active",
      "access": {"mari": "manager", "juri": "viewer"}, "works": ["w1", "w2", "w3"]}


def test_jagatav_piiratud_teos_ei_lahe_otsingunimekirja(monkeypatch):
    monkeypatch.setattr(acc, "load_work_metadata_by_id",
                        lambda wid: {"w1": AVALIK, "w2": PIIRATUD, "w3": JAGATAV}[wid])
    kasutaja = {"username": "juri", "role": "contributor", "allowed_collections": []}
    assert acc.search_visible_work_ids(WS, kasutaja) == ["w1"]


def test_lubatud_kogu_teos_on_nahtav(monkeypatch):
    monkeypatch.setattr(acc, "load_work_metadata_by_id",
                        lambda wid: {"w1": AVALIK, "w2": PIIRATUD, "w3": JAGATAV}[wid])
    kasutaja = {"username": "juri", "role": "contributor",
                "allowed_collections": ["vennastekoguduse-materjalid"]}
    assert acc.search_visible_work_ids(WS, kasutaja) == ["w1", "w2", "w3"]


def test_vaataja_ei_halda_haldur_haldab():
    assert acc.can_view_set(WS, {"username": "juri", "role": "contributor"})
    assert not acc.can_manage_set(WS, {"username": "juri", "role": "contributor"})
    assert acc.can_manage_set(WS, {"username": "mari", "role": "contributor"})


def test_admin_naeb_ja_haldab_koiki():
    admin = {"username": "x", "role": "admin"}
    assert acc.can_view_set(WS, admin) and acc.can_manage_set(WS, admin)


def test_avalikku_kogu_naeb_autentimata():
    avalik = dict(WS, visibility="public")
    assert acc.can_view_set(avalik, None)
    assert not acc.can_view_set(WS, None)
```

- [ ] **Step 2: Jooksuta, veendu et kukub**

Run: `.venv/bin/pytest tests/test_work_sets_access.py -v`
Expected: FAIL — moodulit ei ole

- [ ] **Step 3: Kirjuta moodul**

`server/work_sets_access.py`:

```python
"""Töökollektsiooni õiguste predikaadid (#354).

Töökollektsioon EI OLE uus teoste ligipääsu allikas: ta ainult piiritleb hulka
teostest, mida kasutaja niikuinii näeb. Seepärast ei tohi ükski siinne funktsioon
ligipääsu LAIENDADA.
"""
from typing import Optional

from .access_ops import is_work_public
from .auth import is_at_least
from .utils import find_directory_by_id


def load_work_metadata_by_id(work_id: str) -> Optional[dict]:
    """Eraldi funktsioon, et testid saaksid ta asendada ilma failisüsteemita."""
    import json
    import os
    directory = find_directory_by_id(work_id)
    if not directory:
        return None
    path = os.path.join(directory, "_metadata.json")
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def can_view_set(ws: dict, user: Optional[dict]) -> bool:
    if ws.get("visibility") == "public":
        return True
    if user is None:
        return False
    if is_at_least(user.get("role") or "contributor", "admin"):
        return True
    return user.get("username") in (ws.get("access") or {})


def can_manage_set(ws: dict, user: Optional[dict]) -> bool:
    if user is None:
        return False
    if is_at_least(user.get("role") or "contributor", "admin"):
        return True
    return (ws.get("access") or {}).get(user.get("username")) == "manager"


def is_search_visible(work_metadata: dict, user: Optional[dict]) -> bool:
    """Kordab tenant-tokeni filtrit: `is_public = true OR collections_hierarchy IN [allowed]`.

    `shareable` siin TEADLIKULT ei osale: jagatav teos on lingiga avatav, mitte
    otsitav. Kui ta loendisse lubada, näitaks kogu arv teost, mida sirvimine ei näita.
    """
    if is_work_public(work_metadata):
        return True
    if user is None:
        return False
    if is_at_least(user.get("role") or "contributor", "admin"):
        return True
    allowed = set(user.get("allowed_collections") or [])
    return bool(allowed & set(work_metadata.get("collections") or []))


def search_visible_work_ids(ws: dict, user: Optional[dict]) -> list:
    """Kogu liikmed, mis on sellele kutsujale OTSINGUS nähtavad, algses järjekorras."""
    out = []
    for work_id in ws.get("works") or []:
        meta = load_work_metadata_by_id(work_id)
        if meta is None:
            continue  # kustutatud teos: jäetakse vahele, koristatakse eemaldamisel
        if is_search_visible(meta, user):
            out.append(work_id)
    return out
```

- [ ] **Step 4: Jooksuta testid**

Run: `.venv/bin/pytest tests/test_work_sets_access.py -v`
Expected: PASS (5 testi)

- [ ] **Step 5: Commit**

```bash
git add server/work_sets_access.py tests/test_work_sets_access.py
git commit -m "feat(work-sets): õiguste predikaadid; otsingunimekiri ei kanna shareable-teoseid (#354)"
```

---

### Task 4: Router — kogude CRUD

**Files:**
- Create: `server/routers/work_sets.py`
- Modify: `server/main.py` (routeri ühendamine)
- Test: `tests/test_work_sets_api.py`

**Interfaces:**
- Consumes: Task 2 ja Task 3 funktsioonid, `require_role("admin")`, `get_user`, `optional_user` (`server/deps.py`)
- Produces: `GET /work-sets`, `POST /work-sets`, `GET /work-sets/{id}`, `PATCH /work-sets/{id}`, `PUT /work-sets/{id}/access`, `DELETE /work-sets/{id}`

- [ ] **Step 1: Kirjuta kukkuv test**

`tests/test_work_sets_api.py` (kasuta olemasolevat `tests/conftest.py` klienti; kui seal TestClient fixture't ei ole, loo see failis):

```python
def test_loomine_nouab_admini(client, contributor_token):
    r = client.post("/work-sets", json={"name": {"et": "F"}},
                    headers={"Authorization": f"Bearer {contributor_token}"})
    assert r.status_code == 403


def test_vaataja_naeb_kogu_aga_ei_muuda(client, admin_token, viewer_token, ws_id):
    assert client.get(f"/work-sets/{ws_id}",
                      headers={"Authorization": f"Bearer {viewer_token}"}).status_code == 200
    r = client.patch(f"/work-sets/{ws_id}", json={"name": {"et": "X"}, "revision": 1},
                     headers={"Authorization": f"Bearer {viewer_token}"})
    assert r.status_code == 403


def test_tundmatu_kogu_ei_avalda_nime(client, viewer_token):
    r = client.get("/work-sets/ws_puudub",
                   headers={"Authorization": f"Bearer {viewer_token}"})
    assert r.status_code == 404
    assert "nimi" not in r.text.lower()
```

- [ ] **Step 2: Jooksuta, veendu et kukub**

Run: `.venv/bin/pytest tests/test_work_sets_api.py -v`
Expected: FAIL — 404 kõigil teedel (routerit ei ole)

- [ ] **Step 3: Kirjuta router**

`server/routers/work_sets.py`:

```python
"""Töökollektsioonide API (#354).

KÕIK teed autoriseerivad iga päringu: kogu ligipääs ja teoste lugemisõigus
muutuvad kogu `revision`-ist sõltumatult, seega `revision` EI OLE kehtivuse tõend.
`server/cache.py` on siin keelatud — sealsed vahemälud on globaalsed.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from ..auth import is_at_least
from ..deps import get_json_data, get_user, optional_user, require_role
from ..work_sets_access import can_manage_set, can_view_set, search_visible_work_ids
from ..work_sets_ops import (
    WorkSetConflict, WorkSetLimit, WorkSetNotFound,
    create_work_set, list_work_sets, load_work_set, mutate_members, update_work_set,
)

router = APIRouter()


def _load_or_404(set_id: str) -> dict:
    ws = load_work_set(set_id)
    if ws is None:
        raise HTTPException(status_code=404, detail="Töökollektsiooni ei leitud")
    return ws


def _public_view(ws: dict, user) -> dict:
    """Avalik kuju: ilma õiguste loendi ja auditiväljadeta, kui kutsuja ei halda."""
    base = {
        "id": ws["id"], "name": ws.get("name"), "description": ws.get("description"),
        "visibility": ws.get("visibility"), "status": ws.get("status"),
        "revision": ws.get("revision"),
        "can_manage": can_manage_set(ws, user),
    }
    if base["can_manage"]:
        base["access"] = ws.get("access", {})
        base["created_by"] = ws.get("created_by")
        base["updated_at"] = ws.get("updated_at")
    return base


@router.get("/work-sets")
def get_work_sets(request: Request, include_archived: bool = False, user=Depends(optional_user)):
    sets = [ws for ws in list_work_sets() if can_view_set(ws, user)]
    if not include_archived:
        sets = [ws for ws in sets if ws.get("status", "active") == "active"]
    return {"status": "success", "work_sets": [_public_view(ws, user) for ws in sets]}


@router.post("/work-sets")
async def post_work_set(request: Request, user=Depends(require_role("admin"))):
    body = await get_json_data(request)
    name = body.get("name") or {}
    if not (name.get("et") or name.get("en")):
        raise HTTPException(status_code=400, detail="Nimi on kohustuslik")
    ws = await run_in_threadpool(create_work_set, name, body.get("description"), user["username"])
    return {"status": "success", "work_set": _public_view(ws, user)}


@router.get("/work-sets/{set_id}")
def get_work_set(set_id: str, request: Request, user=Depends(optional_user)):
    ws = _load_or_404(set_id)
    if not can_view_set(ws, user):
        # Sama vastus nagu puuduva kogu korral: tundmatu link ei avalda nime.
        raise HTTPException(status_code=404, detail="Töökollektsiooni ei leitud")
    return {"status": "success", "work_set": _public_view(ws, user)}


@router.patch("/work-sets/{set_id}")
async def patch_work_set(set_id: str, request: Request, user=Depends(get_user)):
    ws = _load_or_404(set_id)
    if not can_manage_set(ws, user):
        raise HTTPException(status_code=403, detail="Puudub haldusõigus")
    body = await get_json_data(request)
    changes = {k: body[k] for k in ("name", "description", "status") if k in body}
    if "visibility" in body:
        if not is_at_least(user.get("role") or "contributor", "admin"):
            raise HTTPException(status_code=403, detail="Nähtavust muudab admin")
        changes["visibility"] = body["visibility"]
    try:
        ws = await run_in_threadpool(update_work_set, set_id, changes, user["username"],
                                     body.get("revision"))
    except WorkSetConflict as e:
        raise HTTPException(status_code=409, detail={"revision": e.current_revision})
    return {"status": "success", "work_set": _public_view(ws, user)}


@router.put("/work-sets/{set_id}/access")
async def put_access(set_id: str, request: Request, user=Depends(require_role("admin"))):
    _load_or_404(set_id)
    body = await get_json_data(request)
    access = body.get("access") or {}
    if any(v not in ("viewer", "manager") for v in access.values()):
        raise HTTPException(status_code=400, detail="Roll peab olema viewer või manager")
    try:
        ws = await run_in_threadpool(update_work_set, set_id, {"access": access},
                                     user["username"], body.get("revision"))
    except WorkSetConflict as e:
        raise HTTPException(status_code=409, detail={"revision": e.current_revision})
    return {"status": "success", "work_set": _public_view(ws, user)}


@router.delete("/work-sets/{set_id}")
def delete_work_set(set_id: str, user=Depends(require_role("admin"))):
    import os
    from ..config import WORK_SETS_DIR
    ws = _load_or_404(set_id)
    if ws.get("ever_published"):
        raise HTTPException(status_code=409,
                            detail="Avaldatud kogu arhiveeritakse, mitte ei kustutata")
    os.remove(os.path.join(WORK_SETS_DIR, f"{set_id}.json"))
    return {"status": "success"}
```

`server/main.py`, teiste routerite kõrvale:

```python
from .routers import work_sets
app.include_router(work_sets.router)
```

- [ ] **Step 4: Jooksuta testid**

Run: `.venv/bin/pytest tests/test_work_sets_api.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/routers/work_sets.py server/main.py tests/test_work_sets_api.py
git commit -m "feat(work-sets): kogude CRUD-router (#354)"
```

---

### Task 5: Router — liikmed ja ID-loend

**Files:**
- Modify: `server/routers/work_sets.py`
- Test: `tests/test_work_sets_members.py`

**Interfaces:**
- Produces: `GET /work-sets/{id}/works`, `POST /work-sets/{id}/works`, `DELETE /work-sets/{id}/works`

- [ ] **Step 1: Kirjuta kukkuvad testid**

```python
def test_loend_tagastab_ainult_kutsujale_nahtavad(client, viewer_token, ws_id):
    r = client.get(f"/work-sets/{ws_id}/works",
                   headers={"Authorization": f"Bearer {viewer_token}"})
    assert r.status_code == 200
    assert r.json()["work_ids"] == ["avalik-teos"]  # piiratud liige puudub


def test_mahupiiri_viga_ei_avalda_mitteadminile_arvu(client, manager_token, taisws_id):
    r = client.post(f"/work-sets/{taisws_id}/works",
                    json={"work_ids": ["uus"], "revision": 2},
                    headers={"Authorization": f"Bearer {manager_token}"})
    assert r.status_code == 409
    assert "1000" not in r.text and "current" not in r.text.lower()


def test_kustutatud_teose_viite_saab_eemaldada(client, manager_token, ws_id):
    r = client.request("DELETE", f"/work-sets/{ws_id}/works",
                       json={"work_ids": ["kustutatud"], "revision": 2},
                       headers={"Authorization": f"Bearer {manager_token}"})
    assert r.status_code == 200


def test_loetamatu_teose_lisamine_lukatakse_tervikuna_tagasi(client, manager_token, ws_id):
    r = client.post(f"/work-sets/{ws_id}/works",
                    json={"work_ids": ["avalik-teos-2", "piiratud-teos"], "revision": 2},
                    headers={"Authorization": f"Bearer {manager_token}"})
    assert r.status_code == 403
    r2 = client.get(f"/work-sets/{ws_id}/works",
                    headers={"Authorization": f"Bearer {manager_token}"})
    assert "avalik-teos-2" not in r2.json()["work_ids"], "osalist lisamist ei tohi olla"
```

- [ ] **Step 2: Jooksuta, veendu et kukub**

Run: `.venv/bin/pytest tests/test_work_sets_members.py -v`
Expected: FAIL — 404 (endpointe ei ole)

- [ ] **Step 3: Lisa endpointid**

`server/routers/work_sets.py` lõppu:

```python
@router.get("/work-sets/{set_id}/works")
def get_work_set_works(set_id: str, request: Request, user=Depends(optional_user)):
    """Otsingufiltri sisend. Autoriseerib IGA päringu — vt mooduli docstring."""
    ws = _load_or_404(set_id)
    if not can_view_set(ws, user):
        raise HTTPException(status_code=404, detail="Töökollektsiooni ei leitud")
    ids = search_visible_work_ids(ws, user)
    return {"status": "success", "work_ids": ids, "count": len(ids),
            "revision": ws.get("revision")}


async def _mutate(set_id: str, request: Request, user, *, adding: bool):
    ws = _load_or_404(set_id)
    if not can_manage_set(ws, user):
        raise HTTPException(status_code=403, detail="Puudub haldusõigus")
    body = await get_json_data(request)
    work_ids = body.get("work_ids") or []
    if not isinstance(work_ids, list):
        raise HTTPException(status_code=400, detail="work_ids peab olema loend")

    if adding:
        # Lisamine ja eemaldamine EI ole sümmeetrilised: lisatav teos peab
        # eksisteerima ja olema kutsujale loetav; eemaldatav ei pea (kustutatud
        # teose viide peab olema koristatav).
        from ..access_ops import can_read_work
        from ..work_sets_access import load_work_metadata_by_id
        for work_id in work_ids:
            meta = await run_in_threadpool(load_work_metadata_by_id, work_id)
            if meta is None:
                raise HTTPException(status_code=400, detail=f"Tundmatu teos: {work_id}")
            if not can_read_work(meta, user):
                raise HTTPException(status_code=403, detail="Teos ei ole kutsujale loetav")

    try:
        ws = await run_in_threadpool(
            mutate_members, set_id,
            work_ids if adding else [], [] if adding else work_ids,
            user["username"], body.get("revision"))
    except WorkSetConflict as e:
        raise HTTPException(status_code=409, detail={"revision": e.current_revision})
    except WorkSetLimit as e:
        # Kogu tegelik liikmete arv on admin-info: haldur, kes osa liikmeid ei näe,
        # tuletaks arvust nende hulga.
        if is_at_least(user.get("role") or "contributor", "admin"):
            raise HTTPException(status_code=409, detail={
                "error": "limit", "current": e.current, "adding": e.adding, "limit": e.limit})
        raise HTTPException(status_code=409, detail={"error": "limit"})
    ids = search_visible_work_ids(ws, user)
    return {"status": "success", "work_ids": ids, "count": len(ids),
            "revision": ws.get("revision")}


@router.post("/work-sets/{set_id}/works")
async def post_work_set_works(set_id: str, request: Request, user=Depends(get_user)):
    return await _mutate(set_id, request, user, adding=True)


@router.delete("/work-sets/{set_id}/works")
async def delete_work_set_works(set_id: str, request: Request, user=Depends(get_user)):
    return await _mutate(set_id, request, user, adding=False)
```

- [ ] **Step 4: Jooksuta testid**

Run: `.venv/bin/pytest tests/test_work_sets_members.py tests/test_work_sets_api.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/routers/work_sets.py tests/test_work_sets_members.py
git commit -m "feat(work-sets): liikmete haldus ja otsingufiltri ID-loend (#354)"
```

---

### Task 6: Valiku filtri koostaja (frontend, puhas funktsioon)

**Files:**
- Create: `src/services/selectionFilter.ts`
- Test: `src/services/__tests__/selectionFilter.test.ts`

**Interfaces:**
- Produces:
  - `type CollectionSelection = { kind: 'all' } | { kind: 'collection'; id: string } | { kind: 'work_set'; id: string }`
  - `selectionFilterClause(selection: CollectionSelection, workIds: string[] | null): string[]`

- [ ] **Step 1: Kirjuta kukkuv test**

```ts
import { describe, it, expect } from 'vitest';
import { selectionFilterClause } from '../selectionFilter';

describe('selectionFilterClause', () => {
  it('kõik teosed ei lisa filtrit', () => {
    expect(selectionFilterClause({ kind: 'all' }, null)).toEqual([]);
  });

  it('püsikogu filtreerib hierarhia järgi', () => {
    expect(selectionFilterClause({ kind: 'collection', id: 'academia-gustaviana' }, null))
      .toEqual(['collections_hierarchy = "academia-gustaviana"']);
  });

  it('töökollektsioon filtreerib work_id järgi', () => {
    expect(selectionFilterClause({ kind: 'work_set', id: 'ws_1' }, ['a', 'b']))
      .toEqual(['work_id IN ["a", "b"]']);
  });

  it('TÜHI loend annab null tulemust, mitte filtri ärajätmist', () => {
    expect(selectionFilterClause({ kind: 'work_set', id: 'ws_1' }, []))
      .toEqual(['work_id IN []']);
  });

  it('laadimata loend (null) ei tohi anda piiramata korpust', () => {
    expect(() => selectionFilterClause({ kind: 'work_set', id: 'ws_1' }, null)).toThrow();
  });
});
```

- [ ] **Step 2: Jooksuta, veendu et kukub**

Run: `npx vitest run src/services/__tests__/selectionFilter.test.ts`
Expected: FAIL — moodulit ei ole

- [ ] **Step 3: Kirjuta moodul**

```ts
/**
 * Valiku → Meili filtriklausel (#354).
 *
 * Kaks reeglit, mille rikkumine on vaikne ja ohtlik:
 * 1. TÜHI ID-loend tähendab NULL TULEMUST, mitte filtri ärajätmist. Tühi kogu,
 *    ligipääsu tõttu tühjaks filtreeritud kogu ja „kõik teosed" on kolm eri olekut.
 * 2. Laadimata loend (null) VISKAB. Kutsuja peab ootama loendi ära; vaikne
 *    tagasilangus piiramata korpusele näitaks kasutajale teoseid väljaspool valikut.
 */
export type CollectionSelection =
  | { kind: 'all' }
  | { kind: 'collection'; id: string }
  | { kind: 'work_set'; id: string };

export function selectionFilterClause(
  selection: CollectionSelection,
  workIds: string[] | null,
): string[] {
  if (selection.kind === 'all') return [];
  if (selection.kind === 'collection') {
    return [`collections_hierarchy = "${selection.id}"`];
  }
  if (workIds === null) {
    throw new Error(`Töökollektsiooni ${selection.id} ID-loend ei ole veel laetud`);
  }
  return [`work_id IN [${workIds.map(id => `"${id}"`).join(', ')}]`];
}
```

- [ ] **Step 4: Jooksuta test**

Run: `npx vitest run src/services/__tests__/selectionFilter.test.ts`
Expected: PASS (5 testi)

- [ ] **Step 5: Commit**

```bash
git add src/services/selectionFilter.ts src/services/__tests__/selectionFilter.test.ts
git commit -m "feat(work-sets): valiku filtri koostaja; tühi loend = null tulemust (#354)"
```

---

### Task 7: API-klient ja ID-loendi hoidmine

**Files:**
- Create: `src/services/workSetService.ts`
- Test: `src/services/__tests__/workSetService.test.ts`

**Interfaces:**
- Consumes: `CollectionSelection` (Task 6)
- Produces: `listWorkSets()`, `getWorkSet(id)`, `createWorkSet(...)`, `patchWorkSet(...)`, `getWorkSetWorkIds(id)`, `addWorks(id, ids, revision)`, `removeWorks(id, ids, revision)`, `invalidateWorkSetIds(id)`

- [ ] **Step 1: Kirjuta kukkuv test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getWorkSetWorkIds, invalidateWorkSetIds } from '../workSetService';

describe('getWorkSetWorkIds', () => {
  beforeEach(() => { invalidateWorkSetIds('ws_1'); vi.restoreAllMocks(); });

  it('hoiab aktiivse valiku loendit, ei küsi kaks korda', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ work_ids: ['a'], revision: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await getWorkSetWorkIds('ws_1');
    await getWorkSetWorkIds('ws_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('liikmesuse muutus tühjendab loendi', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ work_ids: ['a'], revision: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await getWorkSetWorkIds('ws_1');
    invalidateWorkSetIds('ws_1');
    await getWorkSetWorkIds('ws_1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('403 ei tagasta tühja loendit, vaid viskab', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(getWorkSetWorkIds('ws_1')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Jooksuta, veendu et kukub**

Run: `npx vitest run src/services/__tests__/workSetService.test.ts`
Expected: FAIL

- [ ] **Step 3: Kirjuta teenus**

```ts
/**
 * Töökollektsioonide API-klient (#354).
 *
 * ID-loendit hoitakse AINULT aktiivse valiku jaoks ja see EI OLE TTL-vahemälu:
 * vastus sõltub kutsujast ja teoste lugemisõigusest, mis muutuvad kogu
 * `revision`-ist sõltumatult. Loend visatakse ära valiku vahetusel, liikmesuse
 * muutmisel ja autentimisoleku muutumisel.
 *
 * Aegunud loend EI ava ühtki dokumenti, mida tenant-token ei lubaks — ta laseb
 * ainult jätkata samade ID-de filtreerimist kuni järgmise päringuni.
 */
import { API_BASE } from '../config';

const idCache = new Map<string, { workIds: string[]; revision: number }>();

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('vutt_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function invalidateWorkSetIds(setId?: string): void {
  if (setId) idCache.delete(setId); else idCache.clear();
}

export async function getWorkSetWorkIds(setId: string): Promise<string[]> {
  const hit = idCache.get(setId);
  if (hit) return hit.workIds;
  const res = await fetch(`${API_BASE}/work-sets/${setId}/works`, { headers: authHeaders() });
  if (!res.ok) {
    // 403/404 EI tohi muutuda tühjaks loendiks: kutsuja peab eristama
    // „ligipääs kadus" ja „kogu on tühi".
    throw new Error(`Töökollektsiooni loend ebaõnnestus: ${res.status}`);
  }
  const data = await res.json();
  idCache.set(setId, { workIds: data.work_ids, revision: data.revision });
  return data.work_ids;
}

export async function listWorkSets(includeArchived = false) {
  const res = await fetch(
    `${API_BASE}/work-sets?include_archived=${includeArchived}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`work-sets: ${res.status}`);
  return (await res.json()).work_sets;
}

async function mutate(setId: string, path: string, method: string, body: unknown) {
  const res = await fetch(`${API_BASE}/work-sets/${setId}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw Object.assign(new Error(`work-sets: ${res.status}`), { status: res.status });
  invalidateWorkSetIds(setId);
  return res.json();
}

export const createWorkSet = (name: Record<string, string>, description: Record<string, string>) =>
  mutate('', '', 'POST', { name, description });
export const patchWorkSet = (setId: string, changes: object, revision: number) =>
  mutate(setId, '', 'PATCH', { ...changes, revision });
export const addWorks = (setId: string, workIds: string[], revision: number) =>
  mutate(setId, '/works', 'POST', { work_ids: workIds, revision });
export const removeWorks = (setId: string, workIds: string[], revision: number) =>
  mutate(setId, '/works', 'DELETE', { work_ids: workIds, revision });
```

- [ ] **Step 4: Jooksuta test**

Run: `npx vitest run src/services/__tests__/workSetService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/workSetService.ts src/services/__tests__/workSetService.test.ts
git commit -m "feat(work-sets): API-klient; ID-loend ei ole TTL-vahemälu (#354)"
```

---

### Task 8: Valik kontekstis ja URL-is (üks suunaotsustaja)

**Files:**
- Modify: `src/contexts/collectionSync.ts`, `src/contexts/CollectionContext.tsx`, `src/contexts/collectionUrl.ts`, `src/hooks/useCollectionUrlSync.ts`
- Test: `src/contexts/__tests__/collectionSync.test.ts` (olemasolev — laienda)

**Interfaces:**
- Consumes: `CollectionSelection` (Task 6), `decideCollectionSync` (olemasolev)
- Produces:
  - `serializeSelection(s: CollectionSelection): string` (`all` | `c:<id>` | `s:<id>`)
  - `parseSelection(token: string): CollectionSelection`
  - kontekstis: `selection`, `setSelection`, ning **tagasiühilduv** `selectedCollection` / `setSelectedCollection`

**Miks token, mitte teine efekt:** ADR 0038 ütleb, et suuna otsustab AINSANA `decideCollectionSync`. Kaks tingimusteta peeglit reageerivad teineteise EELMISELE väärtusele ja tekitavad lõputu URL-i vahetuse (#333). Seega ei lisa me teist sünkroonimist `?set=` jaoks, vaid serialiseerime valiku üheks tokeniks ja anname olemasolevale otsustajale.

- [ ] **Step 1: Kirjuta kukkuvad testid**

```ts
import { serializeSelection, parseSelection } from '../collectionUrl';
import { decideCollectionSync } from '../collectionSync';

it('serialiseerib ja parsib mõlemat liiki valiku', () => {
  expect(serializeSelection({ kind: 'work_set', id: 'ws_1' })).toBe('s:ws_1');
  expect(parseSelection('c:academia-gustaviana'))
    .toEqual({ kind: 'collection', id: 'academia-gustaviana' });
  expect(parseSelection('all')).toEqual({ kind: 'all' });
});

it('töökollektsiooni valik kirjutab URL-i ja lähtestab lehe', () => {
  const action = decideCollectionSync('all', 's:ws_1', 'all', true, {});
  expect(action).toEqual({ type: 'write-url', value: 's:ws_1', resetPage: true });
});

it('tundmatu töökollektsioon URL-is ei tühjenda vaadet vaikselt', () => {
  const action = decideCollectionSync('s:ws_puudub', null, 'all', true, {});
  expect(action.type).not.toBe('adopt-url');
});
```

- [ ] **Step 2: Jooksuta, veendu et kukub**

Run: `npx vitest run src/contexts/__tests__/collectionSync.test.ts`
Expected: FAIL — `serializeSelection` puudub

- [ ] **Step 3: Lisa serialiseerimine ja laienda otsustajat**

`src/contexts/collectionUrl.ts`:

```ts
import { CollectionSelection } from '../services/selectionFilter';

export function serializeSelection(s: CollectionSelection): string {
  if (s.kind === 'all') return ALL_COLLECTIONS;
  return s.kind === 'collection' ? `c:${s.id}` : `s:${s.id}`;
}

export function parseSelection(token: string): CollectionSelection {
  if (token.startsWith('c:')) return { kind: 'collection', id: token.slice(2) };
  if (token.startsWith('s:')) return { kind: 'work_set', id: token.slice(2) };
  return { kind: 'all' };
}
```

`src/contexts/collectionSync.ts` — `isAdoptable` laieneb, muu loogika EI muutu:

```ts
function isAdoptable(urlValue: string, collections: Collections, knownSets: Set<string>): boolean {
  if (urlValue === ALL_COLLECTIONS) return true;
  if (urlValue.startsWith('s:')) return knownSets.has(urlValue.slice(2));
  const id = urlValue.startsWith('c:') ? urlValue.slice(2) : urlValue;
  return !!collections[id];
}
```

`useCollectionUrlSync` kirjutab tokeni õigesse parameetrisse: `c:` → `?collection=`, `s:` → `?set=`, ja **eemaldab teise parameetri**. Kui välises URL-is on mõlemad, eelistatakse `set`-i.

- [ ] **Step 4: Jooksuta testid**

Run: `npx vitest run src/contexts/__tests__/ && npm run typecheck`
Expected: PASS; olemasolevad sünkroonimise testid jäävad roheliseks

- [ ] **Step 5: Commit**

```bash
git add src/contexts/ src/hooks/useCollectionUrlSync.ts
git commit -m "feat(work-sets): valik URL-is ühe suunaotsustaja kaudu (ADR 0038, #354)"
```

---

### Task 9: Päisevalija kaks jaotist

**Files:**
- Modify: `src/components/CollectionPicker.tsx`, `src/locales/et/common.json`, `src/locales/en/common.json`
- Test: `src/components/__tests__/CollectionPicker.test.tsx`

**Interfaces:**
- Consumes: `listWorkSets()` (Task 7), `selection` (Task 8)

- [ ] **Step 1: Lisa i18n võtmed MÕLEMASSE keelde**

`src/locales/et/common.json`: `"workSets": { "section": "Töökollektsioonid", "permanent": "Püsikogud", "create": "Loo töökollektsioon", "archived": "Arhiveeritud", "notFound": "Töökollektsiooni ei leitud või puudub ligipääs", "allWorks": "Kõik teosed" }`

`src/locales/en/common.json`: `"workSets": { "section": "Work collections", "permanent": "Permanent collections", "create": "Create work collection", "archived": "Archived", "notFound": "Work collection not found or access denied", "allWorks": "All works" }`

- [ ] **Step 2: Kirjuta kukkuv test**

```tsx
it('näitab mõlemat jaotist ja filtreerib otsinguga korraga', async () => {
  render(<CollectionPicker isOpen onClose={() => {}} />);
  expect(await screen.findByText('Püsikogud')).toBeInTheDocument();
  expect(screen.getByText('Töökollektsioonid')).toBeInTheDocument();
});

it('parandab z-indeksi: modaal on päise kohal', () => {
  const { container } = render(<CollectionPicker isOpen onClose={() => {}} />);
  expect(container.querySelector('.z-\\[1300\\]')).toBeTruthy();
});
```

- [ ] **Step 3: Jooksuta, veendu et kukub**

Run: `npx vitest run src/components/__tests__/CollectionPicker.test.tsx`
Expected: FAIL

- [ ] **Step 4: Lisa jaotised**

Muuda `CollectionPicker.tsx`: püsikogude puu jääb, alla lisandub `listWorkSets()`-ist laetud lame loend (aktiivsed, nime järgi, võrdse nime korral ID järgi). Ühine otsinguväli filtreerib mõlemat. `z-50` → `z-[1300]` (CLAUDE.md invariant: `Header` on `sticky z-[1200]`, `z-50` EI OLE piisav).

- [ ] **Step 5: Jooksuta testid ja väravad**

Run: `npx vitest run src/components/__tests__/CollectionPicker.test.tsx && npm run typecheck && npm test`
Expected: PASS; `localeParity.test.ts` ja `translationKeysResolve.test.ts` roheline

- [ ] **Step 6: Commit**

```bash
git add src/components/CollectionPicker.tsx src/locales/ src/components/__tests__/
git commit -m "feat(work-sets): päisevalija kaks jaotist; z-[1300] (#354)"
```

---

### Task 10: Sirvimine, tekstiotsing ja statistika

**Files:**
- Modify: `src/services/searchService.ts` (8 kohta, kus praegu `collections_hierarchy = "${collection}"`), `src/pages/Dashboard.tsx`, `src/pages/Statistics.tsx`
- Test: `src/services/__tests__/searchService.selection.test.ts`

**Interfaces:**
- Consumes: `selectionFilterClause` (Task 6), `getWorkSetWorkIds` (Task 7)

- [ ] **Step 1: Kirjuta kukkuv test**

```ts
it('töökollektsiooni otsing kasutab work_id filtrit, mitte kollektsioonifiltrit', async () => {
  const search = vi.fn().mockResolvedValue({ hits: [], totalHits: 0 });
  await searchContent({ search } as any, 'orati', 1,
    { selection: { kind: 'work_set', id: 'ws_1' }, workSetIds: ['a', 'b'] });
  const filter = search.mock.calls[0][1].filter;
  expect(filter).toContain('work_id IN ["a", "b"]');
  expect(filter.join(' ')).not.toContain('collections_hierarchy');
});

it('teoste koguarv tuleb totalHits-ist, mitte estimatedTotalHits-ist', async () => {
  const search = vi.fn().mockResolvedValue({ hits: [], totalHits: 7, estimatedTotalHits: 53 });
  const r = await searchWorks({ search } as any, '', 1,
    { selection: { kind: 'work_set', id: 'ws_1' }, workSetIds: ['a'] });
  expect(r.totalHits).toBe(7);
});
```

- [ ] **Step 2: Jooksuta, veendu et kukub**

Run: `npx vitest run src/services/__tests__/searchService.selection.test.ts`
Expected: FAIL

- [ ] **Step 3: Asenda kollektsioonifiltri kohad**

Iga koht, kus praegu on

```ts
if (options.collection && !options.workId) {
  filter.push(`collections_hierarchy = "${options.collection}"`);
}
```

asendub

```ts
if (options.selection && !options.workId) {
  filter.push(...selectionFilterClause(options.selection, options.workSetIds ?? null));
}
```

`options.selection` tuleb kutsujalt (Dashboard, SearchPage, Statistics), kes on ID-loendi eelnevalt `getWorkSetWorkIds`-iga laadinud. Loendi laadimise ajal ei tehta piiramata päringut.

- [ ] **Step 4: Jooksuta testid**

Run: `npx vitest run src/services/__tests__/ && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/searchService.ts src/pages/Dashboard.tsx src/pages/Statistics.tsx src/services/__tests__/
git commit -m "feat(work-sets): sirvimine, otsing ja statistika järgivad valikut (#354)"
```

---

### Task 11: Isikute vaade

**Files:**
- Modify: `src/prosopography/pages/PersonsPage.tsx`, `server/prosopography/router.py` (kogu-filtri parameeter)
- Test: `tests/test_persons_work_set_filter.py`

**Interfaces:**
- Consumes: `search_visible_work_ids` (Task 3)

**Uut liikmesusindeksit EI tehta** — kasutatakse sama ID-loendit ja olemasolevaid teose–isiku seoseid (`person_to_works.json`).

- [ ] **Step 1: Kirjuta kukkuv test**

```python
def test_isikute_filter_kasutab_kutsuja_nahtavat_loendit(client, viewer_token, ws_id):
    r = client.get(f"/persons?work_set={ws_id}",
                   headers={"Authorization": f"Bearer {viewer_token}"})
    assert r.status_code == 200
    # piiratud teosega seotud isik ei tohi vastuses olla
    assert "peidetud-isik" not in r.text


def test_ligipaasuta_tookollektsioon_annab_404_mitte_koik_isikud(client, voorasToken, ws_id):
    r = client.get(f"/persons?work_set={ws_id}",
                   headers={"Authorization": f"Bearer {voorasToken}"})
    assert r.status_code == 404
```

- [ ] **Step 2: Jooksuta, veendu et kukub**

Run: `.venv/bin/pytest tests/test_persons_work_set_filter.py -v`
Expected: FAIL — parameetrit ei tunta, vastuses on kõik isikud

- [ ] **Step 3: Lisa parameeter**

`/persons` võtab vastu `work_set`; server laeb kogu, kontrollib `can_view_set`-i (ligipääsu puudumine = 404, mitte filtri eiramine), koostab `search_visible_work_ids`-i ja piirab isikute hulga nende teostega `person_to_works.json` kaudu.

- [ ] **Step 4: Jooksuta testid**

Run: `.venv/bin/pytest tests/test_persons_work_set_filter.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/router.py src/prosopography/pages/PersonsPage.tsx tests/test_persons_work_set_filter.py
git commit -m "feat(work-sets): isikute vaade järgib töökollektsiooni (#354)"
```

---

### Task 12: Haldusvaated

**Files:**
- Create: `src/pages/admin/WorkSets.tsx`
- Modify: `src/pages/admin/Users.tsx` (kolmas õiguste plokk), `src/locales/{et,en}/admin.json`, marsruudid
- Test: `src/pages/admin/__tests__/WorkSets.test.tsx`

- [ ] **Step 1: Lisa i18n võtmed mõlemasse keelde**

`admin.json` (et): `"workSets": { "title": "Töökollektsioonid", "members": "Liikmeid", "viewer": "Vaataja", "manager": "Haldur", "archive": "Arhiveeri", "restore": "Taasaktiveeri", "publish": "Avalda", "limitReached": "Kogu on täis" }` — ja sama võtmestik `en`-i.

- [ ] **Step 2: Kirjuta kukkuv test**

```tsx
it('vaataja ei näe liikmete muutmise nuppe', () => {
  render(<WorkSets />, { wrapper: withUser({ role: 'contributor' }) });
  expect(screen.queryByText('Arhiveeri')).not.toBeInTheDocument();
});

it('kolm õiguste plokki on eraldi ega kirjuta teineteist üle', () => {
  render(<Users />, { wrapper: withUser({ role: 'admin' }) });
  expect(screen.getByText(/Lugemisõigus/)).toBeInTheDocument();
  expect(screen.getByText(/Toimetamisulatus/)).toBeInTheDocument();
  expect(screen.getByText(/Töökollektsioonid/)).toBeInTheDocument();
});
```

- [ ] **Step 3: Jooksuta, veendu et kukub**

Run: `npx vitest run src/pages/admin/__tests__/WorkSets.test.tsx`
Expected: FAIL

- [ ] **Step 4: Kirjuta vaated**

`WorkSets.tsx`: loend (nimi, liikmete arv, nähtavus, olek), valitud kogu paneel (nimi, kirjeldus, liikmed, `access`), arhiveerimine/taasaktiveerimine, avaldamine (admin). Kasutajahalduses kolmas plokk kogu kaupa „vaataja / haldur"; salvestus saadab **ainult muudetud määrangud** ega puutu `allowed_collections` ega `edit_collections` välju.

- [ ] **Step 5: Jooksuta kõik väravad**

Run: `npm run typecheck && npm test && npm run lint:ci && .venv/bin/pytest tests/`
Expected: kõik roheline

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/ src/locales/ 
git commit -m "feat(work-sets): haldusvaated ja kasutajahalduse kolmas õiguste plokk (#354)"
```

---

### Task 13: ADR 0042 ja dokumentatsioon

**Files:**
- Create: `docs/decisions/0042-tookollektsiooni-liikmesust-ei-indekseerita.md`
- Modify: `CLAUDE.md` (invariandid), `docs/decisions/README.md`

- [ ] **Step 1: Kirjuta ADR**

Sisu: otsus (liikmesust ei indekseerita), kontekst (tenant-tokeni filter `meilisearch_ops.py:586` kannab lugemisõigust `collections_hierarchy` kaudu), tagajärjed (ID-loend päringu ajal, lagi, ei mingit sünki), alternatiiv ja miks tagasi lükati (viide asendatud spekile).

- [ ] **Step 2: Lisa CLAUDE.md invariandid**

Kolm rida „Invariandid" sektsiooni: liikmesus ei jõua Meilisse; `server/cache.py` ei hoia kasutajapõhiseid vastuseid; tühi ID-loend = null tulemust.

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/ CLAUDE.md
git commit -m "docs: ADR 0042 — töökollektsiooni liikmesust ei indekseerita (#354)"
```

---

## Self-Review

**Spec coverage:** §1 töövoog → Task 9, 12. §2 õigused → Task 3, 4, 5, 12. §3 valija ja URL → Task 8, 9. §4 otsing, loendamine, vaated → Task 6, 10, 11. §5 andmed, lukk, lagi, vahemälu → Task 2, 7. §6 elutsükkel → Task 4, 12. §7 API → Task 4, 5. §8 järjekord → Task 1 on esimene. Katmata: MCP (spekis teadlikult v1-st väljas).

**Avatud sõltuvus:** Task 1 tulemus võib langetada `WORK_SET_MAX_MEMBERS`-i — Task 2 võtab arvu Task 1 kommentaarist issue'l #354.
