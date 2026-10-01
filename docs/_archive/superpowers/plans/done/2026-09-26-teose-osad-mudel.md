# Teose osad — mudel ja kirjutustee (PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `_metadata.json` väli `parts` koos valideerimise, eraldi osade otspunktide ja
lehetoimingute sünkroniseerimisega. Selles PR-is ei ole kasutajaliidest ega
indekseid/seoseid; need tulevad PR 2 ja PR 3-s.

**Architecture:**
- `server/work_parts.py` sisaldab kolme asja: puhast valideerimist, osa-toiminguid ja
  `sync_work_parts`-i. Toimingud kirjutavad `bulk_update_works`-iga, mis teeb
  lugemise-muutmise-kirjutamise `metadata_lock`-i all ja ühe git-commit'iga.
- Ruuter `server/routers/work_parts.py` annab osade otspunktid.
- `refresh_work_mentions` kutsub `sync_work_parts`-i, seega katavad kõik
  lehetoimingud osad automaatselt. Poolitus annab kaasa ümbernimetuste kaardi.

**Tech Stack:** Python 3.12, FastAPI, pytest (`.venv/bin/pytest`).

**Spec:** `docs/superpowers/specs/2026-09-26-teose-osad-design.md` (§1–3)

## Global Constraints

- Koodikommentaarid eesti keeles. Testid käivitatakse ainult `.venv/bin/pytest`-iga.
- Blokeeriv I/O ei tohi olla `async def` sees (ADR 0002): route'id on sync `def` või
  kasutavad `run_in_threadpool`-i.
- `_metadata.json` kirjutatakse ainult `metadata_ops` kaudu (CLAUDE.md, ADR 0031/0012).
- Õigused: kirjutamiseks `can_write_work(meta, user)` (ADR 0031), lugemiseks
  `can_read_work` (ADR 0031).
- Liigid: `letter | poem | speech | session | attachment`.
  Rollid: `auctor | addressee | praeses | participant | subject`.
- Üldine metaandmete salvestus (`/update-work-metadata`) lükkab välja `parts` tagasi
  (400). Osad muutuvad ainult osade otspunktidega.
- `refresh_work_mentions` ei tohi visata: lehetoiming on juba kettal. `sync_work_parts`
  vead logitakse.
- Impordiring: `server/prosopography/relations.py` impordib `work_parts`-i funktsiooni
  sees. `work_parts` impordib `metadata_ops`-i funktsiooni sees. Lehtede järjekorra
  jaoks kasutab `work_parts` `meili_doc.enumerate_page_images`-it, **mitte**
  `admin_page_ops`-i.

## Review Focus

1. **Osa, mille kõik lehed kustutati:** ta jääb alles kujul `pages: []` ja
   `needs_review: true`. Järgmine ruudustiku toiming (lehe lisamine) eemaldab
   `needs_review`-i. Test Task 3-s.
2. **Samaaegne kahe osa loomine samasse teosesse:** kumbki säilib (lukk). Test Task 2-s.
3. **`attached_to` viitab kustutatavale osale:** kustutus annab 409 ja osa jääb alles.
   Test Task 2-s.
4. **Poolitus `apply_page_ops`-is mitme lehega ühes tsüklis:** kõigi poolitatud lehtede
   tüved asendatakse. Kaardi võti on iga algne tüvi. Test Task 3-s.
5. **Kliendi saadetud `id` või `needs_review` loomisel:** server kirjutab need üle.
   Kasutaja ei saa `needs_review`-i otse seada. Test Task 1-s.

---

## Failide kaart

| Fail | Vastutus |
|---|---|
| `server/work_parts.py` (uus) | `KINDS`, `ROLES`, `PartError`, `validate_parts`, `create_part`, `update_part`, `delete_part`, `change_part_pages`, `remap_parts`, `sync_work_parts` |
| `server/routers/work_parts.py` (uus) | 4 otspunkti |
| `server/main.py` | ruuteri registreerimine |
| `server/metadata_ops.py` | `"parts"` → `ALLOWED_METADATA_FIELDS` |
| `server/routers/editing.py` | `/update-work-metadata`: `parts` → 400 |
| `server/prosopography/relations.py` | `refresh_work_mentions(..., renamed=None)` → `sync_work_parts` |
| `server/admin_page_ops.py` | poolitus (`split_page`, `apply_page_ops`) annab `renamed`-i |
| `tests/test_work_parts.py` (uus) | testid |
| `docs/decisions/0057-teose-osad.md`, `docs/decisions/README.md`, `CLAUDE.md` | ADR + invariant |

---

### Task 1: Valideerimine (puhas)

**Files:** Create `server/work_parts.py` (algus), `tests/test_work_parts.py`.

**Interfaces — Produces:**
```python
KINDS: frozenset[str]; ROLES: frozenset[str]
class PartError(ValueError): status: int  # 400 | 404 | 409
def validate_parts(parts: list[dict], page_stems: set[str]) -> list[dict]  # normaliseeritud; viskab PartError(400)
def new_part(data: dict, existing_ids: set[str]) -> dict  # uus id, needs_review=False, kliendi id/needs_review ignoreeritakse
```

- [ ] **Step 1: Failivad testid**

```python
# tests/test_work_parts.py
"""Teose osad (#464): valideerimine, toimingud, lehetoimingute sünk."""
import pytest

from server import work_parts as wp

STEMS = {"t-001", "t-002", "t-003", "t-004"}


def _p(**kw):
    base = {"id": "p1", "kind": "letter", "pages": ["t-001"], "creators": []}
    base.update(kw)
    return base


def test_kehtiv_osa_labib_ja_normaliseeritakse():
    out = wp.validate_parts([_p(title=" Kiri ", pages=["t-002", "t-001"])], STEMS)
    assert out[0]["title"] == "Kiri"
    assert out[0]["needs_review"] is False


@pytest.mark.parametrize("bad", [
    _p(kind="romaan"),
    _p(pages=["t-999"]),
    _p(pages=[]),                                         # tühi ainult needs_review'ga
    _p(creators=[{"id": "vutt:Pa", "name": "A", "role": "mentioned"}]),
    _p(kind="poem", place_to={"id": "Q1", "label": "X"}),  # place_to ainult kirjal
    _p(dating={"start": "1684-13-40"}),
])
def test_vigane_osa_400(bad):
    with pytest.raises(wp.PartError) as e:
        wp.validate_parts([bad], STEMS)
    assert e.value.status == 400


def test_tuhi_osa_lubatud_needs_reviewga():
    assert wp.validate_parts([_p(pages=[], needs_review=True)], STEMS)[0]["pages"] == []


def test_katkendlik_ja_jagatud_leht_lubatud():
    parts = [_p(id="a", pages=["t-001", "t-003"]), _p(id="b", pages=["t-003", "t-004"])]
    assert len(wp.validate_parts(parts, STEMS)) == 2


def test_id_unikaalne_ja_attached_to_reeglid():
    with pytest.raises(wp.PartError):
        wp.validate_parts([_p(id="a"), _p(id="a")], STEMS)
    with pytest.raises(wp.PartError):                     # viide olematule
        wp.validate_parts([_p(id="a", kind="attachment", attached_to="zz")], STEMS)
    with pytest.raises(wp.PartError):                     # lisa lisale
        wp.validate_parts([_p(id="a", kind="attachment", attached_to="b"),
                           _p(id="b", kind="attachment", attached_to=None)], STEMS)
    with pytest.raises(wp.PartError):                     # iseendale
        wp.validate_parts([_p(id="a", kind="attachment", attached_to="a")], STEMS)
    ok = wp.validate_parts([_p(id="a", kind="letter"), _p(id="b", kind="attachment", attached_to="a")], STEMS)
    assert ok[1]["attached_to"] == "a"


def test_new_part_ignoreerib_kliendi_id_ja_needs_review():
    p = wp.new_part({"id": "hack", "needs_review": True, "kind": "letter", "pages": ["t-001"]}, {"p1"})
    assert p["id"] not in ("hack", "p1") and p["needs_review"] is False
```

- [ ] **Step 2:** `.venv/bin/pytest tests/test_work_parts.py -q` → FAIL (moodul puudub)

- [ ] **Step 3: Implementeeri**

```python
# server/work_parts.py
"""Teose osad (#464, ADR 0057): kirjad, luuletused, kõned, istungid ja lisad.

Osa on teose sees olev iseseisev üksus. Lehed on lehefailide tüvede HULK (võib olla
katkendlik; leht võib kuuluda mitmesse osasse). Salvestus: `_metadata.json` väli
`parts`, muudetakse AINULT selle mooduli toimingutega (mitte üldise metaandmete
salvestusega), et samaaegsed toimetajad ei kirjutaks teineteise osi üle.
"""
from __future__ import annotations

from typing import Optional

from .config import get_logger
from .utils import generate_nanoid
from .work_dating import clean_dating

logger = get_logger(__name__)

KINDS = frozenset({"letter", "poem", "speech", "session", "attachment"})
ROLES = frozenset({"auctor", "addressee", "praeses", "participant", "subject"})
_TEXT_FIELDS = ("title", "incipit", "notes")


class PartError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _place(value) -> Optional[dict]:
    if value in (None, ""):
        return None
    if not isinstance(value, dict) or not (value.get("id") or value.get("label")):
        raise PartError("Vigane koht")
    return {"id": value.get("id") or None, "label": (value.get("label") or "").strip()}


def _creators(value) -> list:
    out = []
    for c in value or []:
        if not isinstance(c, dict) or c.get("role") not in ROLES:
            raise PartError(f"Lubamatu roll: {c.get('role') if isinstance(c, dict) else c!r}")
        if not (c.get("id") or c.get("name")):
            raise PartError("Isikul peab olema id või nimi")
        out.append({k: c[k] for k in ("id", "name", "role", "source") if c.get(k) not in (None, "")})
    return out


def _normalize(p: dict, page_stems: set[str]) -> dict:
    if not isinstance(p, dict):
        raise PartError("Osa peab olema objekt")
    kind = p.get("kind")
    if kind not in KINDS:
        raise PartError(f"Tundmatu liik: {kind!r}")
    pages = p.get("pages") or []
    if not isinstance(pages, list) or any(not isinstance(s, str) for s in pages):
        raise PartError("Vigane lehtede loend")
    missing = [s for s in pages if s not in page_stems]
    if missing:
        raise PartError(f"Lehti pole teoses: {', '.join(missing[:5])}")
    needs_review = bool(p.get("needs_review"))
    if not pages and not needs_review:
        raise PartError("Osal peab olema vähemalt üks leht")
    place_to = _place(p.get("place_to"))
    if place_to and kind != "letter":
        raise PartError("Sihtkoht on lubatud ainult kirjal")
    try:
        dating = clean_dating(p.get("dating")) if p.get("dating") else None
    except ValueError as e:
        raise PartError(f"Vigane dateering: {e}")
    out = {
        "id": p.get("id"),
        "kind": kind,
        "pages": list(dict.fromkeys(pages)),
        "creators": _creators(p.get("creators")),
        "attached_to": p.get("attached_to") or None,
        "needs_review": needs_review,
    }
    for f in _TEXT_FIELDS:
        v = p.get(f)
        if isinstance(v, str) and v.strip():
            out[f] = v.strip()
    if dating:
        out["dating"] = dating
    if _place(p.get("place")):
        out["place"] = _place(p.get("place"))
    if place_to:
        out["place_to"] = place_to
    langs = p.get("languages")
    if isinstance(langs, list) and langs:
        out["languages"] = [l for l in langs if isinstance(l, str)]
    return out


def validate_parts(parts: list, page_stems: set[str]) -> list[dict]:
    out = [_normalize(p, page_stems) for p in parts or []]
    ids = [p["id"] for p in out]
    if any(not i for i in ids) or len(ids) != len(set(ids)):
        raise PartError("Osa id puudub või kordub")
    by_id = {p["id"]: p for p in out}
    for p in out:
        a = p["attached_to"]
        if a is None:
            continue
        if p["kind"] != "attachment":
            raise PartError("attached_to on lubatud ainult lisal")
        if a == p["id"] or a not in by_id or by_id[a]["kind"] == "attachment":
            raise PartError("Lisa peab viitama olemasolevale osale, mis ise ei ole lisa")
    return out


def new_part(data: dict, existing_ids: set[str]) -> dict:
    """Uus osa: server annab id; kliendi id ja needs_review ignoreeritakse."""
    pid = generate_nanoid(6)
    while pid in existing_ids:
        pid = generate_nanoid(6)
    return {**{k: v for k, v in (data or {}).items() if k not in ("id", "needs_review")},
            "id": pid, "needs_review": False}
```

Kontrolli `generate_nanoid` signatuuri (`server/utils.py:66`, võtab `length`) ja
`clean_dating` käitumist `None` korral (tagastab `None`).

- [ ] **Step 4:** testid → PASS
- [ ] **Step 5: Commit** `feat(works): teose osade valideerimine (#464)`

---

### Task 2: Osa-toimingud luku all

**Files:** Modify `server/work_parts.py`; test `tests/test_work_parts.py`.

**Interfaces — Produces:**
```python
def page_stems(work_dir: str) -> list[str]           # teose järjekorras (enumerate_page_images)
def create_part(work_dir: str, data: dict, username: str) -> dict
def update_part(work_dir: str, part_id: str, data: dict, username: str) -> dict
def delete_part(work_dir: str, part_id: str, username: str) -> None     # 409, kui teised viitavad
def change_part_pages(work_dir: str, part_id: str, add: list[str], remove: list[str], username: str) -> dict
```
Kõik viskavad `PartError`-i (400/404/409). Kirjutus käib läbi
`metadata_ops.bulk_update_works([(meta_path, transform)], username, message)`. Transform
arvutab uue `parts`-i luku all ja jätab vea sulgurmuutujasse (`bulk_update_works` neelab
transformi erindi). Pärast kutset visatakse salvestatud viga.

- [ ] **Step 1: Failivad testid** (lisa)

```python
# ── Toimingud ────────────────────────────────────────────────────────────────
import json
import threading


@pytest.fixture
def work(tmp_path, monkeypatch):
    from server import metadata_ops
    d = tmp_path / "slug-w1"
    d.mkdir()
    for i in range(1, 5):
        (d / f"t-00{i}.jpg").write_bytes(b"x")
    (d / "_metadata.json").write_text(json.dumps({"id": "w1", "title": "T"}), encoding="utf-8")
    monkeypatch.setattr(metadata_ops, "save_with_git", lambda *a, **k: {"success": True})
    monkeypatch.setattr(metadata_ops, "sync_work_to_meilisearch", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "update_person_to_works", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "update_work_collections", lambda *a, **k: None)
    monkeypatch.setattr(metadata_ops, "update_work_facts", lambda *a, **k: None)
    return str(d)


def _meta(work):
    return json.load(open(f"{work}/_metadata.json"))


def test_loo_muuda_kustuta(work):
    p = wp.create_part(work, {"kind": "letter", "pages": ["t-002"], "title": "A"}, "ed")
    assert _meta(work)["parts"][0]["id"] == p["id"]
    wp.update_part(work, p["id"], {**p, "title": "B"}, "ed")
    assert _meta(work)["parts"][0]["title"] == "B"
    wp.delete_part(work, p["id"], "ed")
    assert _meta(work)["parts"] == []


def test_tundmatu_osa_404(work):
    with pytest.raises(wp.PartError) as e:
        wp.update_part(work, "nope", {"kind": "letter", "pages": ["t-001"]}, "ed")
    assert e.value.status == 404


def test_viidatud_osa_kustutus_409(work):
    a = wp.create_part(work, {"kind": "session", "pages": ["t-001"]}, "ed")
    wp.create_part(work, {"kind": "attachment", "pages": ["t-002"], "attached_to": a["id"]}, "ed")
    with pytest.raises(wp.PartError) as e:
        wp.delete_part(work, a["id"], "ed")
    assert e.value.status == 409
    assert len(_meta(work)["parts"]) == 2


def test_lehtede_lisamine_eemaldamine_ja_needs_review(work):
    p = wp.create_part(work, {"kind": "letter", "pages": ["t-001"]}, "ed")
    wp.change_part_pages(work, p["id"], add=["t-003", "t-002"], remove=["t-001"], username="ed")
    assert _meta(work)["parts"][0]["pages"] == ["t-002", "t-003"]   # teose järjekorras
    with pytest.raises(wp.PartError):                                 # viimast ei saa eemaldada
        wp.change_part_pages(work, p["id"], add=[], remove=["t-002", "t-003"], username="ed")


def test_samaaegne_loomine_ei_kaota_osa(work):
    errs = []

    def mk(i):
        try:
            wp.create_part(work, {"kind": "poem", "pages": [f"t-00{i}"]}, "ed")
        except Exception as e:                                       # pragma: no cover
            errs.append(e)
    ts = [threading.Thread(target=mk, args=(i,)) for i in (1, 2, 3, 4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert not errs and len(_meta(work)["parts"]) == 4
```

- [ ] **Step 2:** FAIL (`create_part` puudub)
- [ ] **Step 3: Implementeeri** (lisa `work_parts.py`-sse)

```python
import os


def page_stems(work_dir: str) -> list[str]:
    """Teose lehtede tüved teose järjekorras (sama järjekord mis /work/{id}/{nr})."""
    from .meili_doc import enumerate_page_images
    return [os.path.splitext(n)[0] for n in enumerate_page_images(work_dir)]


def _ordered(pages: list[str], order: list[str]) -> list[str]:
    pos = {s: i for i, s in enumerate(order)}
    return sorted(dict.fromkeys(pages), key=lambda s: pos.get(s, len(pos)))


def _write(work_dir: str, username: str, message: str, mutate) -> object:
    """Loe–muuda–kirjuta metadata_lock'i all. `mutate(parts, stems)` tagastab
    (uued_osad, tulemus) või viskab PartError'i."""
    from .metadata_ops import bulk_update_works
    stems = page_stems(work_dir)
    box: dict = {}

    def transform(meta: dict) -> dict:
        try:
            parts, result = mutate(list(meta.get("parts") or []), stems)
            parts = validate_parts(parts, set(stems))
            for p in parts:
                p["pages"] = _ordered(p["pages"], stems)
            box["result"] = result
            return {"parts": parts}
        except PartError as e:
            box["error"] = e
            raise

    res = bulk_update_works([(os.path.join(work_dir, "_metadata.json"), transform)], username, message)
    if "error" in box:
        raise box["error"]
    if res.get("failed"):
        raise PartError("Teose metaandmeid ei saanud kirjutada", 500)
    return box.get("result")


def _find(parts: list, part_id: str) -> int:
    for i, p in enumerate(parts):
        if p.get("id") == part_id:
            return i
    raise PartError(f"Osa puudub: {part_id}", 404)


def create_part(work_dir: str, data: dict, username: str) -> dict:
    def mutate(parts, _stems):
        part = new_part(data, {p.get("id") for p in parts})
        return parts + [part], part["id"]
    pid = _write(work_dir, username, f"Osa: lisa ({(data or {}).get('kind')})", mutate)
    return _read_part(work_dir, pid)


def update_part(work_dir: str, part_id: str, data: dict, username: str) -> dict:
    def mutate(parts, _stems):
        i = _find(parts, part_id)
        keep = {"id": part_id, "needs_review": parts[i].get("needs_review", False)}
        parts[i] = {**{k: v for k, v in (data or {}).items() if k not in ("id", "needs_review")}, **keep}
        return parts, part_id
    _write(work_dir, username, f"Osa: muuda [{part_id}]", mutate)
    return _read_part(work_dir, part_id)


def delete_part(work_dir: str, part_id: str, username: str) -> None:
    def mutate(parts, _stems):
        _find(parts, part_id)
        if any(p.get("attached_to") == part_id for p in parts):
            raise PartError("Osale viitavad lisad; kustuta või sea need enne ümber", 409)
        return [p for p in parts if p.get("id") != part_id], None
    _write(work_dir, username, f"Osa: kustuta [{part_id}]", mutate)


def change_part_pages(work_dir: str, part_id: str, add: list[str], remove: list[str], username: str) -> dict:
    def mutate(parts, _stems):
        i = _find(parts, part_id)
        pages = [s for s in parts[i].get("pages") or [] if s not in set(remove or [])] + list(add or [])
        if not pages:
            raise PartError("Osal peab jääma vähemalt üks leht; kustuta osa", 400)
        parts[i] = {**parts[i], "pages": pages, "needs_review": False}
        return parts, part_id
    _write(work_dir, username, f"Osa: lehed [{part_id}]", mutate)
    return _read_part(work_dir, part_id)


def _read_part(work_dir: str, part_id: str) -> dict:
    import json
    with open(os.path.join(work_dir, "_metadata.json"), "r", encoding="utf-8") as f:
        parts = (json.load(f) or {}).get("parts") or []
    return parts[_find(parts, part_id)]
```

`update_person_to_works` jt monkeypatch'itakse testis, sest `bulk_update_works` kutsub
neid muutunud teose kohta. Kontrolli `bulk_update_works` sees nimesid (`metadata_ops.py:
164–185`) ja kohanda fikstuuri, kui need erinevad.

- [ ] **Step 4:** testid → PASS
- [ ] **Step 5: Commit** `feat(works): teose osade toimingud metadata_lock'i all (#464)`

---

### Task 3: Lehetoimingute sünk (`sync_work_parts`)

**Files:** Modify `server/work_parts.py`, `server/prosopography/relations.py:139-152`,
`server/admin_page_ops.py` (`split_page` ~l. 478–483, `apply_page_ops` ~l. 696–711);
test `tests/test_work_parts.py`.

**Interfaces — Produces:**
```python
def remap_parts(parts: list[dict], stems: list[str], renamed: dict[str, list[str]] | None) -> tuple[list[dict], bool]  # puhas
def sync_work_parts(work_dir: str, work_id: str | None = None, renamed: dict[str, list[str]] | None = None) -> None
```
`refresh_work_mentions(work_dir, work_id=None, renamed=None)` kutsub **esimesena**
`sync_work_parts`-i (vead logitakse) ja seejärel mainimiste uuenduse.

- [ ] **Step 1: Failivad testid** (lisa)

```python
# ── Lehetoimingute sünk ───────────────────────────────────────────────────────

def test_remap_poolitus_asendab_molema_poolega():
    parts = [_p(id="a", pages=["t-001", "t-002"])]
    out, changed = wp.remap_parts(parts, ["t-001", "L", "R"], {"t-002": ["L", "R"]})
    assert changed and out[0]["pages"] == ["t-001", "L", "R"]


def test_remap_kustutus_eemaldab_ja_tuhi_needs_review():
    parts = [_p(id="a", pages=["t-001"]), _p(id="b", pages=["t-001", "t-002"])]
    out, changed = wp.remap_parts(parts, ["t-002"], None)
    assert changed
    assert out[0] == {**parts[0], "pages": [], "needs_review": True}
    assert out[1]["pages"] == ["t-002"] and not out[1].get("needs_review")


def test_remap_muutuseta():
    parts = [_p(id="a", pages=["t-001"])]
    out, changed = wp.remap_parts(parts, ["t-001", "t-002"], None)
    assert not changed


def test_refresh_work_mentions_kutsub_sync_work_parts(monkeypatch, tmp_path):
    from server.prosopography import relations
    calls = []
    monkeypatch.setattr(wp, "sync_work_parts", lambda d, w=None, renamed=None: calls.append((d, w, renamed)))
    monkeypatch.setattr(relations, "update_page_person_mentions", lambda *a: None)
    relations.refresh_work_mentions(str(tmp_path), "w1", renamed={"a": ["b", "c"]})
    assert calls == [(str(tmp_path), "w1", {"a": ["b", "c"]})]


def test_sync_viga_ei_takista_mainimiste_uuendust(monkeypatch, tmp_path):
    from server.prosopography import relations
    seen = []
    def boom(*a, **k): raise RuntimeError("x")
    monkeypatch.setattr(wp, "sync_work_parts", boom)
    monkeypatch.setattr(relations, "update_page_person_mentions", lambda *a: seen.append(a))
    relations.refresh_work_mentions(str(tmp_path), "w1")
    assert seen


def test_sync_work_parts_kirjutab_ainult_muutusel(work, monkeypatch):
    p = wp.create_part(work, {"kind": "letter", "pages": ["t-001", "t-002"]}, "ed")
    os.remove(f"{work}/t-002.jpg")
    wp.sync_work_parts(work, "w1")
    assert _meta(work)["parts"][0]["pages"] == ["t-001"]


def test_poolitus_apply_page_ops_annab_renamed(monkeypatch):
    """apply_page_ops kogub iga poolitatud lehe {algne: [vasak, parem]} ja annab edasi."""
    from server import admin_page_ops as apo
    import inspect
    src = inspect.getsource(apo.apply_page_ops)
    assert "renamed" in src and "refresh_work_mentions(path, work_id, renamed=" in src
    assert "refresh_work_mentions(path, work_id, renamed=" in inspect.getsource(apo.split_page)
```

(Viimane test on struktuurivalvur. Poolituse täielik integratsioon vajab pilte ja PIL-i;
`test_admin_page_ops*`-is on selleks olemas muster. Kui seal on poolituse
integratsioonitest, lisa sinna kontroll, et osa `pages` sisaldab pärast poolitust
mõlemat uut tüve, ja eemalda see struktuurivalvur.)

`import os` peab testfaili päises olemas olema.

- [ ] **Step 2:** FAIL
- [ ] **Step 3: Implementeeri** `work_parts.py`-s

```python
def remap_parts(parts: list[dict], stems: list[str], renamed: Optional[dict] = None) -> tuple[list[dict], bool]:
    """Lehetoimingu järel: poolitatud tüvi → mõlemad pooled; puuduv tüvi välja;
    tühjaks jäänud osa → needs_review (ei kustutata). Järjekord teose järgi."""
    live = set(stems)
    changed = False
    out = []
    for p in parts:
        pages: list[str] = []
        for s in p.get("pages") or []:
            pages.extend((renamed or {}).get(s, [s]))
        pages = _ordered([s for s in pages if s in live], stems)
        np = {**p, "pages": pages}
        if not pages and p.get("pages"):
            np["needs_review"] = True
        if np != p:
            changed = True
        out.append(np)
    return out, changed


def sync_work_parts(work_dir: str, work_id: Optional[str] = None, renamed: Optional[dict] = None) -> None:
    """Kutsutakse refresh_work_mentions'i seest — kõik lehetoimingud katavad osad."""
    import json
    meta_path = os.path.join(work_dir, "_metadata.json")
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            if not (json.load(f) or {}).get("parts"):
                return
    except FileNotFoundError:
        return
    from .metadata_ops import bulk_update_works
    stems = page_stems(work_dir)

    def transform(meta: dict) -> dict:
        parts, changed = remap_parts(list(meta.get("parts") or []), stems, renamed)
        return {"parts": parts} if changed else {}

    bulk_update_works([(meta_path, transform)], "Automaatne", "Osad: lehetoimingu järel ühtlustatud")
```

`relations.py`:
```python
def refresh_work_mentions(work_dir: str, work_id: Optional[str] = None, renamed: Optional[dict] = None) -> None:
    """…(senine dokstring)… Enne mainimisi ühtlustatakse teose osad (#464): osade lehed
    ja mainimiste osa-viited sõltuvad samast lehehulgast."""
    try:
        from .. import work_parts
        work_parts.sync_work_parts(work_dir, work_id, renamed=renamed)
    except Exception:
        logger.exception(f"Osade ühtlustus ebaõnnestus ({work_id or work_dir})")
    try:
        ...  # senine keha muutmata
```
Testides patch'itakse `wp.sync_work_parts`-i, seega viita moodulile (`work_parts.sync_work_parts`),
mitte funktsioonile (`from ..work_parts import sync_work_parts` ei näeks patch'i).

`admin_page_ops.py`:
- `split_page`: `left, right = _split_page_locked(...)`; `orig = os.path.splitext(images[page_num-1])[0]`
  **enne** poolitust; `refresh_work_mentions(path, work_id, renamed={orig: [os.path.splitext(left)[0], os.path.splitext(right)[0]]})`.
- `apply_page_ops`: enne tsüklit `renamed: dict = {}`; poolitusel
  `l, r = _split_page_locked(...)`; `renamed[os.path.splitext(fn)[0]] = [os.path.splitext(l)[0], os.path.splitext(r)[0]]`;
  `finally`-s `refresh_work_mentions(path, work_id, renamed=renamed)`.

- [ ] **Step 4:** `.venv/bin/pytest tests/test_work_parts.py tests/ -q -k "work_parts or page_ops or mentions"` → PASS
- [ ] **Step 5: Commit** `feat(works): osad ühtlustuvad iga lehetoimingu järel (#464)`

---

### Task 4: Otspunktid ja üldise salvestuse kaitse

**Files:** Create `server/routers/work_parts.py`; Modify `server/main.py`,
`server/metadata_ops.py:26-30`, `server/routers/editing.py:240-245`;
test `tests/test_work_parts.py`.

**Interfaces — Produces:**
- `GET /works/{work_id}/parts` → `{"parts": [...]}` (lugemisõigus)
- `POST /works/{work_id}/parts` → 201 `{part}`
- `PUT /works/{work_id}/parts/{part_id}` → `{part}`
- `DELETE /works/{work_id}/parts/{part_id}` → 204
- `POST /works/{work_id}/parts/{part_id}/pages` keha `{add, remove}` → `{part}`

- [ ] **Step 1: Failivad testid** (lisa)

```python
# ── Otspunktid ───────────────────────────────────────────────────────────────
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def client(work, monkeypatch):
    from server.routers import work_parts as r
    from server.deps import get_user
    monkeypatch.setattr(r, "find_directory_by_id", lambda wid: work if wid == "w1" else None)
    app = FastAPI()
    app.include_router(r.router)
    state = {"user": {"username": "ed", "role": "editor"}, "write": True}
    app.dependency_overrides[get_user] = lambda: state["user"]
    monkeypatch.setattr(r, "can_write_work", lambda meta, user: state["write"])
    monkeypatch.setattr(r, "can_read_work", lambda meta, user: True)
    c = TestClient(app)
    c.state = state
    return c


def test_endpointide_voog(client):
    r = client.post("/works/w1/parts", json={"kind": "letter", "pages": ["t-001"]})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert client.put(f"/works/w1/parts/{pid}", json={"kind": "letter", "pages": ["t-001"], "title": "X"}).json()["title"] == "X"
    assert client.post(f"/works/w1/parts/{pid}/pages", json={"add": ["t-002"], "remove": []}).json()["pages"] == ["t-001", "t-002"]
    assert client.get("/works/w1/parts").json()["parts"][0]["id"] == pid
    assert client.delete(f"/works/w1/parts/{pid}").status_code == 204


def test_endpointide_vead(client):
    assert client.post("/works/w1/parts", json={"kind": "x", "pages": ["t-001"]}).status_code == 400
    assert client.put("/works/w1/parts/nope", json={"kind": "letter", "pages": ["t-001"]}).status_code == 404
    assert client.post("/works/zz/parts", json={"kind": "letter", "pages": ["t-001"]}).status_code == 404
    client.state["write"] = False
    assert client.post("/works/w1/parts", json={"kind": "letter", "pages": ["t-001"]}).status_code == 403


def test_endpointid_on_sync():
    import asyncio
    from server.routers import work_parts as r
    for fn in (r.list_parts, r.create, r.update, r.delete, r.change_pages):
        assert not asyncio.iscoroutinefunction(fn)


def test_uldine_metaandmete_salvestus_lukkab_parts_tagasi():
    """/update-work-metadata ei tohi osi üle kirjutada (samaaegsed toimetajad)."""
    import inspect
    from server.routers import editing
    src = inspect.getsource(editing.update_work_metadata)
    assert "'parts'" in src or '"parts"' in src
    from server.metadata_ops import ALLOWED_METADATA_FIELDS
    assert "parts" in ALLOWED_METADATA_FIELDS
```

(Viimane on struktuurivalvur, sest `update_work_metadata` on admin-route tugeva
seadistusega. Kui `tests/`-is on selle route'i TestClient muster, näiteks
`test_async_endpoint_offload.py`, kasuta seda ja kontrolli käitumist: keha
`{"metadata": {"parts": []}}` annab 400.)

Kontrolli, kas `server.deps.get_user` on õige sõltuvus, mida `require_role` kasutab. Kui
ruuter kasutab `require_role("editor")`, override'i selle sisemist `get_user`-it või kasuta
`optional_user` + selget 401-t. Vaata mustrit `routers/public.py` `toggle_shareable`-ist.

- [ ] **Step 2:** FAIL
- [ ] **Step 3: Implementeeri** ruuter

```python
# server/routers/work_parts.py
"""Teose osade otspunktid (#464). Osad muutuvad AINULT siin — üldine
/update-work-metadata lükkab `parts` välja tagasi, et samaaegsed toimetajad ei
kirjutaks teineteise osi üle."""
import os

from fastapi import APIRouter, Body, Depends, HTTPException, Response

from ..access_ops import can_read_work, can_write_work
from ..deps import optional_user, require_role
from ..utils import find_directory_by_id
from ..work_sets_access import load_work_metadata_by_id
from .. import work_parts as wp

router = APIRouter()


def _dir_and_meta(work_id: str):
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    meta = load_work_metadata_by_id(work_id)
    if meta is None:
        raise HTTPException(status_code=503, detail="Teose metaandmeid ei saa praegu lugeda")
    return path, meta


def _call(fn, *args):
    try:
        return fn(*args)
    except wp.PartError as e:
        raise HTTPException(status_code=e.status, detail=str(e))


def _writable(work_id: str, user: dict) -> str:
    path, meta = _dir_and_meta(work_id)
    if not can_write_work(meta, user):
        raise HTTPException(status_code=403, detail="Puudub õigus selle teose osi muuta")
    return path


@router.get("/works/{work_id}/parts")
def list_parts(work_id: str, user=Depends(optional_user)):
    path, meta = _dir_and_meta(work_id)
    if not can_read_work(meta, user):
        raise HTTPException(status_code=403, detail="Puudub ligipääs")
    return {"parts": meta.get("parts") or []}


@router.post("/works/{work_id}/parts", status_code=201)
def create(work_id: str, body: dict = Body(...), user=Depends(require_role("editor"))):
    return _call(wp.create_part, _writable(work_id, user), body, user["username"])


@router.put("/works/{work_id}/parts/{part_id}")
def update(work_id: str, part_id: str, body: dict = Body(...), user=Depends(require_role("editor"))):
    return _call(wp.update_part, _writable(work_id, user), part_id, body, user["username"])


@router.delete("/works/{work_id}/parts/{part_id}", status_code=204)
def delete(work_id: str, part_id: str, user=Depends(require_role("editor"))):
    _call(wp.delete_part, _writable(work_id, user), part_id, user["username"])
    return Response(status_code=204)


@router.post("/works/{work_id}/parts/{part_id}/pages")
def change_pages(work_id: str, part_id: str, body: dict = Body(...), user=Depends(require_role("editor"))):
    return _call(wp.change_part_pages, _writable(work_id, user), part_id,
                 body.get("add") or [], body.get("remove") or [], user["username"])
```

Õigused: kas osade muutmine peaks lubama ka `contributor`-it (`can_write_work` arvestab
ulatust, ADR 0031)? Ruling: `require_role("editor")` + `can_write_work`. Osad on
metaandmed ja teose metaandmeid muudab ka praegu editor või admin. Contributor'i
lubamine on eraldi otsus.

`load_work_metadata_by_id` (`server/work_sets_access.py:17`) tagastab `None`, kui teost
pole. `_dir_and_meta` kontrollib enne kataloogi.

`main.py`: `from .routers.work_parts import router as work_parts_router` ja
`app.include_router(work_parts_router)` teiste ruuterite kõrval.

`metadata_ops.py`: lisa `"parts"` `ALLOWED_METADATA_FIELDS`-i.

`editing.py` `update_work_metadata`, kohe pärast `data = await get_json_data(request)`:
```python
    # Osad muutuvad AINULT /works/{id}/parts otspunktidega (#464): üldine salvestus
    # saadab terve objekti ja kirjutaks samaaegse toimetaja osad üle.
    if 'parts' in (data.get('metadata') or {}):
        raise HTTPException(status_code=400, detail="Osi muudetakse /works/{id}/parts kaudu")
```

- [ ] **Step 4:** `.venv/bin/pytest tests/test_work_parts.py tests/test_async_endpoint_offload.py -q` → PASS
- [ ] **Step 5: Commit** `feat(works): teose osade otspunktid (#464)`

---

### Task 5: ADR, invariant, täiskomplekt

- [ ] **ADR** `docs/decisions/0057-teose-osad.md` (vorm nagu 0056), sisu:
  - osa = lehetüvede hulk (katkendlik, jagatud leht lubatud), salvestatud
    `_metadata.json` väljal `parts`;
  - muutmine AINULT `/works/{id}/parts` otspunktidega (`metadata_lock` +
    `bulk_update_works`), üldine salvestus annab 400;
  - `refresh_work_mentions` kutsub `sync_work_parts`-i: kõik lehetoimingud ühtlustavad
    osad; poolitus annab `renamed`-i; tühjaks jäänud osa → `needs_review`;
  - liigid ja rollid (spekk §1).

  Lisa register `docs/decisions/README.md` tabelisse.
- [ ] **CLAUDE.md „Invariandid"** (pärast ADR 0056 lõiku):

```markdown
**Teose osad (ADR 0057)** — `_metadata.json` `parts[]`: lehed on lehetüvede HULK
(katkendlik, leht võib olla mitmes osas). Muudetakse AINULT `/works/{id}/parts`
otspunktidega (`server/work_parts.py`, `metadata_lock`); `/update-work-metadata`
lükkab `parts` tagasi. `refresh_work_mentions` kutsub `sync_work_parts`-i — uus
lehenumbreid/faile muutev tee saab osade sünkroni tasuta, kui ta kutsub
`refresh_work_mentions`-it (ADR 0055); poolitus annab `renamed`-i.
```

- [ ] `.venv/bin/pytest tests/ -q` → kõik läbivad
- [ ] **Commit** `docs(adr): 0057 teose osad (#464)`
