# Lehekülgede hulgivalik (liigutamine + kustutamine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lisada `/work/{id}/manage` "Leheküljed" tabi võimalus valida mitu lehekülge ja need ühe teose sees ümber liigutada ("lehe N järele" semantika) või korraga kustutada.

**Architecture:** Liigutamine sõidab täielikult olemasoleva `draftPositions` + `/reorder-pages` voo peal — uut backend-loogikat ei vaja; uus on ainult puhas TS-util `computeBlockMoveOrder`, mis arvutab uue failijärjekorra nähtava (effective) järjekorra põhjal. Kustutamine saab uue batch-endpointi `POST /admin/work/{id}/delete-pages`, mis kustutab kõik valitud lehed ühe git-commiti + ühe Meilisearch-sünkiga (kõik-või-mitte-midagi).

**Tech Stack:** Frontend: React 19 + TypeScript + Vitest (`src/utils/__tests__/`). Backend: FastAPI + GitPython + pytest (`tests/`).

**Spec:** `docs/superpowers/specs/2026-06-20-bulk-page-select-move-delete-design.md`

## Global Constraints

- Roll: kõik endpointid `require_role("admin")`.
- Kood-kommentaarid eesti keeles (CLAUDE.md).
- Backend pythoni versioonis EI kasuta `list[str]` / `X | None` annotatsioone uue koodi avalikes signatuurides, kui ümbritsev fail kasutab `typing` importe — järgi faili olemasolevat stiili (`server/admin_page_ops.py:149` kasutab `list[str]`, seega seal on `list[...]` OK).
- Frontend testid: `vitest`, fail `src/utils/__tests__/<nimi>.test.ts`, käivitus `npx vitest run <path>`.
- Backend testid: `pytest`, fail `tests/test_<nimi>.py`, käivitus `.venv/bin/python -m pytest tests/test_<nimi>.py -v`.
- Liigutamine EI tee uut backend-kutset peale olemasoleva `/reorder-pages`.
- Kustutamine: **kõik-või-mitte-midagi**. Osa puudu → 409, midagi ei kustutata. Ükski ei sobi → 404. Vigane sisend (path-eraldajad / `..`) → 400.
- Semantika: sihtnumber `N` viitab **nähtavale** numbrile (`visiblePageNum`) effective järjekorras. `N≤0`/tühi → algusesse; `N>pageCount` → lõppu; muidu lehe N järele; anchor valikus → kehtetu.

---

### Task 1: Puhas util `computeBlockMoveOrder` (+ tüübid)

Ploki-liigutamise loogika ühte testitavasse utiliiti. Sama loogika toidab eelvaadet, nupu-keelamist JA järjekorra-arvutust, et UI ja submit ei lahkneks.

**Files:**
- Create: `src/utils/blockReorder.ts`
- Test: `src/utils/__tests__/blockReorder.test.ts`

**Interfaces:**
- Produces:
  - `interface VisiblePage { filename: string; visiblePageNum: number; }`
  - `type MovePreview = { kind: 'start' } | { kind: 'end' } | { kind: 'between'; before: number; after: number }`
  - `type BlockMoveResult = { ok: true; order: string[]; preview: MovePreview } | { ok: false; reason: 'emptySelection' | 'anchorInSelection' | 'invalidTarget' }`
  - `function computeBlockMoveOrder(visiblePages: VisiblePage[], selectedFilenames: Set<string>, targetRaw: string): BlockMoveResult`

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/__tests__/blockReorder.test.ts
import { describe, it, expect } from 'vitest';
import { computeBlockMoveOrder, VisiblePage } from '../blockReorder';

// Abifunktsioon: tee n lehte nähtavate numbritega 1..n, failinimi "f{num}"
const mk = (n: number): VisiblePage[] =>
  Array.from({ length: n }, (_, i) => ({ filename: `f${i + 1}`, visiblePageNum: i + 1 }));

const names = (r: { order: string[] }) => r.order;

describe('computeBlockMoveOrder', () => {
  it('liigutab ploki keskele (kasutaja näide: 1–5 → lehe 9 järele)', () => {
    const res = computeBlockMoveOrder(mk(10), new Set(['f1', 'f2', 'f3', 'f4', 'f5']), '9');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(names(res)).toEqual(['f6', 'f7', 'f8', 'f9', 'f1', 'f2', 'f3', 'f4', 'f5', 'f10']);
    expect(res.preview).toEqual({ kind: 'between', before: 9, after: 10 });
  });

  it('N=0 / tühi / negatiivne → algusesse', () => {
    for (const t of ['0', '', '-3']) {
      const res = computeBlockMoveOrder(mk(5), new Set(['f4', 'f5']), t);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(names(res)).toEqual(['f4', 'f5', 'f1', 'f2', 'f3']);
      expect(res.preview).toEqual({ kind: 'start' });
    }
  });

  it('N > pageCount → lõppu', () => {
    const res = computeBlockMoveOrder(mk(5), new Set(['f1']), '6');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(names(res)).toEqual(['f2', 'f3', 'f4', 'f5', 'f1']);
    expect(res.preview).toEqual({ kind: 'end' });
  });

  it('N === last, viimane EI valitud → lõppu', () => {
    const res = computeBlockMoveOrder(mk(5), new Set(['f1']), '5');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(names(res)).toEqual(['f2', 'f3', 'f4', 'f5', 'f1']);
    expect(res.preview).toEqual({ kind: 'end' });
  });

  it('N === last, viimane ON valitud → anchorInSelection', () => {
    const res = computeBlockMoveOrder(mk(5), new Set(['f5']), '5');
    expect(res).toEqual({ ok: false, reason: 'anchorInSelection' });
  });

  it('mittejärjestikune valik liigub kompaktse plokina, suhteline järjekord säilib', () => {
    const res = computeBlockMoveOrder(mk(8), new Set(['f2', 'f5', 'f7']), '8');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(names(res)).toEqual(['f1', 'f3', 'f4', 'f6', 'f8', 'f2', 'f5', 'f7']);
  });

  it('NaN sihtnumber → invalidTarget', () => {
    expect(computeBlockMoveOrder(mk(5), new Set(['f1']), 'abc')).toEqual({ ok: false, reason: 'invalidTarget' });
  });

  it('kümnendmurd trunkeeritakse (9.7 → 9)', () => {
    const res = computeBlockMoveOrder(mk(10), new Set(['f1']), '9.7');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.preview).toEqual({ kind: 'between', before: 9, after: 10 });
  });

  it('valitud failinimi, mida pole → invalidTarget', () => {
    expect(computeBlockMoveOrder(mk(5), new Set(['fX']), '2')).toEqual({ ok: false, reason: 'invalidTarget' });
  });

  it('tühi valik → emptySelection', () => {
    expect(computeBlockMoveOrder(mk(5), new Set(), '2')).toEqual({ ok: false, reason: 'emptySelection' });
  });

  it('kõik valitud + N=0 → ok, sama järjekord (no-op)', () => {
    const res = computeBlockMoveOrder(mk(3), new Set(['f1', 'f2', 'f3']), '0');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(names(res)).toEqual(['f1', 'f2', 'f3']);
  });

  it('kõik valitud + N keskel → anchorInSelection', () => {
    const res = computeBlockMoveOrder(mk(3), new Set(['f1', 'f2', 'f3']), '2');
    expect(res).toEqual({ ok: false, reason: 'anchorInSelection' });
  });

  it('effective järjekord: kui visiblePages on juba draft-järjekorras, N viitab nähtavale numbrile', () => {
    // Nähtav järjekord: f3(1), f1(2), f2(3); liiguta f3 lehe 3 järele
    const vp: VisiblePage[] = [
      { filename: 'f3', visiblePageNum: 1 },
      { filename: 'f1', visiblePageNum: 2 },
      { filename: 'f2', visiblePageNum: 3 },
    ];
    const res = computeBlockMoveOrder(vp, new Set(['f3']), '3');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.order).toEqual(['f1', 'f2', 'f3']);
    expect(res.preview).toEqual({ kind: 'end' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/blockReorder.test.ts`
Expected: FAIL — `Cannot find module '../blockReorder'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/blockReorder.ts
// Ploki-liigutamise puhas loogika. Sama funktsiooni kasutab eelvaade,
// "Liiguta" nupu keelamine JA draftPositions-i arvutus — nii ei lahkne UI ja submit.

export interface VisiblePage {
  filename: string;
  visiblePageNum: number; // 1-põhine positsioon nähtavas (effective) järjekorras
}

export type MovePreview =
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'between'; before: number; after: number };

export type BlockMoveResult =
  | { ok: true; order: string[]; preview: MovePreview }
  | { ok: false; reason: 'emptySelection' | 'anchorInSelection' | 'invalidTarget' };

export function computeBlockMoveOrder(
  visiblePages: VisiblePage[],
  selectedFilenames: Set<string>,
  targetRaw: string,
): BlockMoveResult {
  if (selectedFilenames.size === 0) return { ok: false, reason: 'emptySelection' };

  // Kõik valitud nimed peavad eksisteerima
  const known = new Set(visiblePages.map((p) => p.filename));
  for (const f of selectedFilenames) {
    if (!known.has(f)) return { ok: false, reason: 'invalidTarget' };
  }

  const pageCount = visiblePages.length;
  const block = visiblePages.filter((p) => selectedFilenames.has(p.filename));
  const rest = visiblePages.filter((p) => !selectedFilenames.has(p.filename));

  // Parsi sihtnumber: tühi → 0 (algusesse); NaN → kehtetu; kümnend trunkeeritakse
  const trimmed = targetRaw.trim();
  let target: number;
  if (trimmed === '') {
    target = 0;
  } else {
    const parsed = parseInt(trimmed, 10);
    if (Number.isNaN(parsed)) return { ok: false, reason: 'invalidTarget' };
    target = parsed;
  }

  let insertAt: number; // mitu rest-lehte jääb ploki ETTE
  let preview: MovePreview;

  if (target <= 0) {
    insertAt = 0;
    preview = { kind: 'start' };
  } else if (target > pageCount) {
    insertAt = rest.length;
    preview = { kind: 'end' };
  } else {
    const anchor = visiblePages.find((p) => p.visiblePageNum === target)!;
    if (selectedFilenames.has(anchor.filename)) {
      return { ok: false, reason: 'anchorInSelection' };
    }
    const anchorRestIdx = rest.findIndex((p) => p.filename === anchor.filename);
    insertAt = anchorRestIdx + 1;
    if (insertAt >= rest.length) {
      preview = { kind: 'end' };
    } else {
      preview = { kind: 'between', before: anchor.visiblePageNum, after: rest[insertAt].visiblePageNum };
    }
  }

  const orderPages = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
  return { ok: true, order: orderPages.map((p) => p.filename), preview };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/blockReorder.test.ts`
Expected: PASS (13 testi).

- [ ] **Step 5: Commit**

```bash
git add src/utils/blockReorder.ts src/utils/__tests__/blockReorder.test.ts
git commit -m "feat(manage): computeBlockMoveOrder util ploki-liigutamiseks + testid"
```

---

### Task 2: Backend `delete_pages_from_git` (batch git-kustutus + scoped rollback)

Mitme lehe `.txt`/`.json` kustutamine **ühe commitiga**; commiti ebaõnnestumisel staging skoobitult tagasi.

**Files:**
- Modify: `server/git_ops.py` (lisa funktsioon `delete_page_from_git` järele, ~rida 660)
- Test: `tests/test_delete_pages_git.py`

**Interfaces:**
- Consumes: `get_or_init_repo`, `BASE_DIR`, `Actor` (juba importitud `git_ops.py`-s).
- Produces: `delete_pages_from_git(folder_name: str, base_names: list, commit_msg: str, username: str = "VUTT Server") -> list` — tagastab eemaldatud relatiivsete teede listi; commiti ebaõnnestumisel viskab erindi (pärast staging-rollbacki).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_delete_pages_git.py
"""Testid delete_pages_from_git batch-kustutusele (päris ajutine git-repo)."""
import os
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.git_ops as git_ops
from git import Repo


@pytest.fixture
def repo(tmp_path, monkeypatch):
    r = Repo.init(str(tmp_path))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")
    folder = tmp_path / "1690-w1"
    folder.mkdir()
    rel = []
    for i in (1, 2, 3):
        for ext in (".txt", ".json"):
            p = folder / f"pg{i}{ext}"
            p.write_text("x", encoding="utf-8")
            rel.append(os.path.relpath(str(p), str(tmp_path)))
    r.index.add(rel)
    r.index.commit("init")
    monkeypatch.setattr(git_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    return {"repo": r, "folder": folder, "tmp": tmp_path}


def test_delete_multiple_pages_one_commit(repo):
    before = len(list(repo["repo"].iter_commits()))
    removed = git_ops.delete_pages_from_git("1690-w1", ["pg1", "pg2"], "kustuta", "admin")
    after = len(list(repo["repo"].iter_commits()))
    assert after == before + 1  # ÜKS commit
    assert not (repo["folder"] / "pg1.txt").exists()
    assert not (repo["folder"] / "pg2.json").exists()
    assert (repo["folder"] / "pg3.txt").exists()
    assert set(removed) == {
        os.path.join("1690-w1", n) for n in ("pg1.txt", "pg1.json", "pg2.txt", "pg2.json")
    }


def test_commit_failure_rolls_back_staging(repo, monkeypatch):
    # Pane commit viskama → staging peab jääma puhtaks (skoobitud reset)
    def boom(*a, **kw):
        raise RuntimeError("commit fail")
    monkeypatch.setattr(repo["repo"].index, "commit", boom)
    with pytest.raises(RuntimeError):
        git_ops.delete_pages_from_git("1690-w1", ["pg1"], "kustuta", "admin")
    # Staging puhas: HEAD-i ja indeksi vahel pole "deleted" kirjeid pg* failidele
    staged = [d.a_path for d in repo["repo"].index.diff("HEAD")]
    assert all("pg1" not in s for s in staged)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_delete_pages_git.py -v`
Expected: FAIL — `AttributeError: module 'server.git_ops' has no attribute 'delete_pages_from_git'`.

- [ ] **Step 3: Write minimal implementation**

Lisa `server/git_ops.py`-sse (näiteks `delete_page_from_git` funktsiooni järele):

```python
def delete_pages_from_git(folder_name, base_names, commit_msg, username="VUTT Server"):
    """Stage'ib mitme lehe .txt ja .json kustutamise ja teeb ÜHE commiti.

    .jpg-d peavad olema ENNE liigutatud prügikasti (ei ole git-tracked).
    Commiti ebaõnnestumisel lähtestab staging'u SKOOBITULT (ainult need teed),
    et repo ei jääks poolikusse seisu, ja viskab erindi edasi.

    Returns: eemaldatud relatiivsete teede list.
    """
    repo = get_or_init_repo()
    removed = []
    for base in base_names:
        for ext in ('.txt', '.json'):
            rel_path = os.path.join(folder_name, base + ext)
            abs_path = os.path.join(BASE_DIR, rel_path)
            if os.path.exists(abs_path):
                try:
                    repo.index.remove([rel_path])
                    os.remove(abs_path)
                    removed.append(rel_path)
                except Exception:
                    repo.git.rm('--cached', rel_path)
                    os.remove(abs_path)
                    removed.append(rel_path)

    if not removed:
        return []

    try:
        actor = Actor(username, f"{username}@vutt.local")
        repo.index.commit(commit_msg, author=actor, committer=actor)
    except Exception:
        # Skoobitud rollback: un-stage ainult need teed ja taasta tööpuu failid HEAD-ist.
        try:
            repo.git.reset('--', *removed)
            repo.git.checkout('HEAD', '--', *removed)
        except Exception as re:
            logger.error(f"GIT: batch-kustutuse rollback ebaõnnestus: {re}")
        raise

    logger.info(f"GIT: batch-kustutatud {len(removed)} faili kaustast {folder_name}")
    return removed
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_delete_pages_git.py -v`
Expected: PASS (2 testi).

- [ ] **Step 5: Commit**

```bash
git add server/git_ops.py tests/test_delete_pages_git.py
git commit -m "feat(git): delete_pages_from_git batch-kustutus ühe commitiga + scoped rollback"
```

---

### Task 3: Backend `delete_pages` op (resolutsioon + trash + sünk + rollback)

Op-funktsioon: lahenda valitud `base_names`, kõik-või-mitte-midagi, liiguta pildid prügikasti, kutsu batch git-kustutus, üks Meilisearch-sünk.

**Files:**
- Modify: `server/admin_page_ops.py` (lisa funktsioon faili lõppu; importi `delete_pages_from_git`)
- Test: `tests/test_delete_pages.py`

**Interfaces:**
- Consumes: `delete_pages_from_git` (Task 2), `get_sorted_images`, `work_lock`, `find_directory_by_id`, `BASE_DIR`, `sync_work_to_meilisearch`.
- Produces: `delete_pages(work_id: str, base_names: list, username: str) -> dict`. Tagastusvariandid:
  - `{"status": "not_found", "missing": [...]}` — ükski ei sobinud;
  - `{"status": "conflict", "missing": [...]}` — osa ei sobinud, midagi ei kustutatud;
  - `{"status": "success", "deleted": [...], "new_page_count": int}`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_delete_pages.py
"""Testid delete_pages op-loogikale (git-helper ja meili mock'itud)."""
import io
import json
import os
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image
import server.admin_page_ops as aps
from server.admin_page_ops import delete_pages, get_sorted_images


@pytest.fixture
def work(tmp_path, monkeypatch):
    wid = "w1"
    folder = tmp_path / "1690-test-w1"
    folder.mkdir()
    bases = []
    for i, seq in enumerate([100, 200, 300], start=1):
        base = f"pg{i:03d}"
        bases.append(base)
        Image.new("RGB", (8, 8), (i, i, i)).save(str(folder / (base + ".jpg")), "JPEG")
        (folder / (base + ".txt")).write_text("", encoding="utf-8")
        (folder / (base + ".json")).write_text(json.dumps({"sequence": seq}), encoding="utf-8")
    (folder / "_metadata.json").write_text(json.dumps({"id": wid}), encoding="utf-8")

    monkeypatch.setattr(aps, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(aps, "find_directory_by_id",
                        lambda w: str(folder) if w == wid else None)
    monkeypatch.setattr(aps, "sync_work_to_meilisearch", lambda *a: None)
    return {"folder": folder, "work_id": wid, "tmp": tmp_path, "bases": bases}


def test_delete_two_pages_success(work, monkeypatch):
    calls = {"sync": 0}
    monkeypatch.setattr(aps, "sync_work_to_meilisearch", lambda *a: calls.__setitem__("sync", calls["sync"] + 1))
    # Mock git-helper: kustuta tegelikud txt/json failid, et new_page_count toimiks
    def fake_git(folder_name, base_names, msg, username):
        removed = []
        for b in base_names:
            for ext in (".txt", ".json"):
                p = work["folder"] / (b + ext)
                if p.exists():
                    p.unlink()
                    removed.append(os.path.join(folder_name, b + ext))
        return removed
    monkeypatch.setattr(aps, "delete_pages_from_git", fake_git)

    res = delete_pages(work["work_id"], ["pg001", "pg002"], "admin")
    assert res["status"] == "success"
    assert res["new_page_count"] == 1
    assert calls["sync"] == 1  # ÜKS reindeks
    # Pildid prügikastis, mitte kaustas
    assert not (work["folder"] / "pg001.jpg").exists()
    trash = work["tmp"] / "._trash" / "w1" / "pages"
    assert (trash / "pg001.jpg").exists()


def test_none_match_returns_not_found(work, monkeypatch):
    monkeypatch.setattr(aps, "delete_pages_from_git", lambda *a, **k: pytest.fail("ei tohi kutsuda"))
    before = set(os.listdir(work["folder"]))
    res = delete_pages(work["work_id"], ["zzz", "yyy"], "admin")
    assert res["status"] == "not_found"
    assert set(res["missing"]) == {"zzz", "yyy"}
    assert set(os.listdir(work["folder"])) == before  # midagi ei muutunud


def test_partial_match_returns_conflict_deletes_nothing(work, monkeypatch):
    monkeypatch.setattr(aps, "delete_pages_from_git", lambda *a, **k: pytest.fail("ei tohi kutsuda"))
    before = set(os.listdir(work["folder"]))
    res = delete_pages(work["work_id"], ["pg001", "zzz"], "admin")
    assert res["status"] == "conflict"
    assert res["missing"] == ["zzz"]
    assert set(os.listdir(work["folder"])) == before  # kõik-või-mitte-midagi


def test_git_failure_restores_jpgs(work, monkeypatch):
    def boom(*a, **kw):
        raise RuntimeError("git fail")
    monkeypatch.setattr(aps, "delete_pages_from_git", boom)
    with pytest.raises(RuntimeError):
        delete_pages(work["work_id"], ["pg001"], "admin")
    # Pilt taastatud kausta, prügikast tühi
    assert (work["folder"] / "pg001.jpg").exists()
    trash = work["tmp"] / "._trash" / "w1" / "pages"
    assert not (trash / "pg001.jpg").exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_delete_pages.py -v`
Expected: FAIL — `ImportError: cannot import name 'delete_pages'`.

- [ ] **Step 3: Write minimal implementation**

Lisa `server/admin_page_ops.py` importidesse `delete_pages_from_git`:

```python
from .git_ops import get_or_init_repo, save_with_git, delete_page_from_git, delete_pages_from_git
```

Lisa funktsioon faili lõppu:

```python
def delete_pages(work_id, base_names, username):
    """Kustutab mitu lehekülge korraga (kõik-või-mitte-midagi).

    Lahendab base_names'id praeguste failide vastu; kui osa puudub → conflict,
    midagi ei kustutata. Liigutab pildid prügikasti, kutsub batch git-kustutuse
    ühe commitiga ja ühe Meilisearch-sünki. Git-tõrkel taastab pildid (rollback).
    """
    path = find_directory_by_id(work_id)
    if not path:
        return {"status": "not_found", "missing": list(base_names)}
    folder_name = os.path.basename(path)

    with work_lock(folder_name, path):
        images = get_sorted_images(path)
        # base_name → tegelik pildifaili nimi (säilitab laiendi)
        by_base = {os.path.splitext(img)[0]: img for img in images}

        missing = [b for b in base_names if b not in by_base]
        if len(missing) == len(base_names):
            return {"status": "not_found", "missing": missing}
        if missing:
            return {"status": "conflict", "missing": missing}

        trash_dir = os.path.join(BASE_DIR, '._trash', work_id, 'pages')
        os.makedirs(trash_dir, exist_ok=True)

        # Logi enne mutatsiooni (käsitsi taastamiseks kui protsess krahhib)
        logger.info(f"delete_pages: {folder_name} kustutab {base_names}")

        moved = []  # (orig_path, trash_path) rollbackiks
        for base in base_names:
            img_name = by_base[base]
            src = os.path.join(path, img_name)
            dst = os.path.join(trash_dir, img_name)
            if os.path.exists(src):
                shutil.move(src, dst)
                moved.append((src, dst))

        try:
            commit_msg = f"Kustuta {len(base_names)} lehte: {folder_name} [{work_id}]"
            delete_pages_from_git(folder_name, base_names, commit_msg, username=username)
        except Exception:
            # Rollback: pildid prügikastist tagasi
            for src, dst in moved:
                if os.path.exists(dst):
                    shutil.move(dst, src)
            raise

        sync_work_to_meilisearch(folder_name)
        new_page_count = len(get_sorted_images(path))
        return {"status": "success", "deleted": list(base_names), "new_page_count": new_page_count}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_delete_pages.py -v`
Expected: PASS (4 testi).

- [ ] **Step 5: Commit**

```bash
git add server/admin_page_ops.py tests/test_delete_pages.py
git commit -m "feat(manage): delete_pages op — kõik-või-mitte-midagi + trash + rollback"
```

---

### Task 4: Backend endpoint `POST /admin/work/{id}/delete-pages`

HTTP-kiht: sisendvalidatsioon (400), op-kutse, staatuste mapping (404/409/200).

**Files:**
- Modify: `server/main.py` (lisa endpoint `admin_delete_page` järele, ~rida 482; importi `delete_pages`)
- Test: `tests/test_delete_pages_endpoint.py`

**Interfaces:**
- Consumes: `delete_pages` (Task 3), `require_role`, FastAPI `Request`/`HTTPException`.
- Produces: endpoint `POST /admin/work/{work_id}/delete-pages`, body `{"base_names": [...]}`.
  - 400 vigane sisend; 404 ükski ei sobi; 409 osa ei sobi (`{"detail": {"missing": [...]}}`); 200 `{"status":"success","deleted":[...],"new_page_count":n}`.

**Test-harness:** `tests/conftest.py` pakub `backend_env` / `client` / `login` fixtureid (päris
TestClient + sisselogimine). Admin-token: `login("admin", "adminpass")`. Header:
`Authorization: Bearer {token}`. Sama muster kui `tests/test_transform_page.py`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_delete_pages_endpoint.py
"""Testid POST /admin/work/{id}/delete-pages valideerimisele ja staatuse-mappingule."""
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


# --- Puhas valideerimisfunktsioon (ilma autentimiseta) ---
def test_validate_base_names_rejects_traversal():
    from server.main import _validate_base_names
    with pytest.raises(ValueError):
        _validate_base_names(["../../etc/passwd"])
    with pytest.raises(ValueError):
        _validate_base_names(["a/b"])


def test_validate_base_names_dedupes():
    from server.main import _validate_base_names
    assert _validate_base_names(["pg1", "pg1", "pg2"]) == ["pg1", "pg2"]


def test_validate_base_names_empty_raises():
    from server.main import _validate_base_names
    with pytest.raises(ValueError):
        _validate_base_names([])


# --- Endpoint staatuse-mapping (autenditud, delete_pages mock'itud) ---
def test_endpoint_success_200(backend_env, client, login, monkeypatch):
    main = backend_env["main"]
    monkeypatch.setattr(main, "delete_pages",
                        lambda wid, bn, username: {"status": "success", "deleted": bn, "new_page_count": 0})
    token = login("admin", "adminpass")
    r = client.post("/admin/work/w1/delete-pages", json={"base_names": ["pg1"]},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["deleted"] == ["pg1"]


def test_endpoint_conflict_409(backend_env, client, login, monkeypatch):
    main = backend_env["main"]
    monkeypatch.setattr(main, "delete_pages", lambda *a, **k: {"status": "conflict", "missing": ["x"]})
    token = login("admin", "adminpass")
    r = client.post("/admin/work/w1/delete-pages", json={"base_names": ["pg1"]},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 409


def test_endpoint_not_found_404(backend_env, client, login, monkeypatch):
    main = backend_env["main"]
    monkeypatch.setattr(main, "delete_pages", lambda *a, **k: {"status": "not_found", "missing": ["x"]})
    token = login("admin", "adminpass")
    r = client.post("/admin/work/w1/delete-pages", json={"base_names": ["pg1"]},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 404


def test_endpoint_bad_input_400(backend_env, client, login):
    token = login("admin", "adminpass")
    r = client.post("/admin/work/w1/delete-pages", json={"base_names": ["../x"]},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 400


def test_endpoint_requires_auth_401(backend_env, client):
    r = client.post("/admin/work/w1/delete-pages", json={"base_names": ["pg1"]})
    assert r.status_code == 401
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_delete_pages_endpoint.py::test_validate_base_names_dedupes -v`
Expected: FAIL — `ImportError: cannot import name '_validate_base_names'`.

- [ ] **Step 3: Write minimal implementation**

Lisa `delete_pages` `server/main.py` grupeeritud importi (rida ~48):

```python
from .admin_page_ops import (
    clear_original_backup, get_page_sequence, get_sorted_images,
    rebalance_sequences, reorder_pages, split_page, transform_page_image,
    detect_and_convert_image, write_new_page, add_pages, work_lock,
    delete_pages,
)
```

Lisa valideerimis-helper ja endpoint (`admin_delete_page` järele, ~rida 482):

```python
def _validate_base_names(base_names):
    """Valideerib ja de-dupe'b base_names'id. Viskab ValueError vigase sisendi korral.

    Path-traversal kaitse: keela tee-eraldajad, '..' ja null-byte. TÕELINE kaitse on
    op-tasemel täpne kuuluvus get_sorted_images() hulgas — see on vaid esimene filter.
    """
    if not base_names or not isinstance(base_names, list):
        raise ValueError("base_names puudub või pole list")
    seen = set()
    out = []
    for b in base_names:
        if not isinstance(b, str) or not b:
            raise ValueError("vigane base_name")
        if '/' in b or '\\' in b or '..' in b or '\x00' in b:
            raise ValueError("lubamatu märk base_name'is")
        if b not in seen:
            seen.add(b)
            out.append(b)
    return out


@app.post("/admin/work/{work_id}/delete-pages")
async def admin_delete_pages(work_id: str, request: Request, user=Depends(require_role("admin"))):
    """Kustutab mitu lehekülge korraga (kõik-või-mitte-midagi)."""
    try:
        body = await request.json()
        base_names = _validate_base_names(body.get("base_names"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        raise HTTPException(status_code=400, detail="Vigane päring")

    result = delete_pages(work_id, base_names, username=user['username'])
    if result["status"] == "not_found":
        raise HTTPException(status_code=404, detail={"missing": result["missing"]})
    if result["status"] == "conflict":
        raise HTTPException(status_code=409, detail={"missing": result["missing"]})
    return result
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_delete_pages_endpoint.py -v`
Expected: PASS (3 valideerimis- + 5 endpoint-testi = 8).

- [ ] **Step 5: Commit**

```bash
git add server/main.py tests/test_delete_pages_endpoint.py
git commit -m "feat(manage): POST /delete-pages endpoint + base_names valideerimine"
```

---

### Task 5: Frontend i18n võtmed

Uued tõlkevõtmed mõlemas keeles, et komponendi-task'id saaksid neile viidata.

**Files:**
- Modify: `src/locales/et/workspace.json` (`manage` objektis)
- Modify: `src/locales/en/workspace.json` (`manage` objektis)

**Interfaces:**
- Produces (võtmed `manage.` all): `select.all`, `select.clear`, `select.count`, `move.label`, `move.button`, `move.previewBetween`, `move.previewStart`, `move.previewEnd`, `move.anchorInSelection`, `move.invalidTarget`, `move.notSavedHint`, `reorder.discard`, `reorder.discardConfirm`, `reorder.changedSummary`, `bulkDelete.button`, `bulkDelete.confirm`, `bulkDelete.conflict`, `bulkDelete.draftBlocked`.

- [ ] **Step 1: Lisa võtmed et-faili**

`src/locales/et/workspace.json` — leia `"manage": {` plokk ja lisa sinna:

```json
"select": {
  "all": "Vali kõik",
  "clear": "Tühista valik",
  "count": "Valitud: {{count}}"
},
"move": {
  "label": "lehe järele:",
  "button": "Liiguta",
  "previewBetween": "→ lehtede {{before}} ja {{after}} vahele",
  "previewStart": "→ algusesse",
  "previewEnd": "→ lõppu",
  "anchorInSelection": "Sihtleht on valikus; ploki lõppu viimiseks kasuta {{end}}.",
  "invalidTarget": "Vigane sihtnumber.",
  "notSavedHint": "Järjekord on eelvaates. Kinnitamiseks vajuta Salvesta järjekord."
},
"reorder": {
  "discard": "Tühista muudatused",
  "discardConfirm": "Tühistada kõik salvestamata järjekorra muudatused?",
  "changedSummary": "{{count}} lehe asukoht erineb salvestatud järjekorrast"
},
"bulkDelete": {
  "button": "Kustuta valitud",
  "confirm": "Kustutada {{count}} lehekülge? Need liiguvad prügikasti ja on taastatavad.",
  "conflict": "Lehekülgede nimekiri oli aegunud — midagi ei kustutatud. Nimekiri värskendati, proovi uuesti.",
  "draftBlocked": "Enne kustutamist salvesta või tühista järjekorra muudatused."
}
```

> Kui mõni neist alamvõtmetest (nt `select`) juba eksisteerib, liida väljad olemasolevasse, ära tekita duplikaat-võtit.

- [ ] **Step 2: Lisa SAMAD võtmed en-faili**

`src/locales/en/workspace.json` — `"manage"` plokki:

```json
"select": {
  "all": "Select all",
  "clear": "Clear selection",
  "count": "Selected: {{count}}"
},
"move": {
  "label": "after page:",
  "button": "Move",
  "previewBetween": "→ between pages {{before}} and {{after}}",
  "previewStart": "→ to the beginning",
  "previewEnd": "→ to the end",
  "anchorInSelection": "Target page is in the selection; use {{end}} to move the block to the end.",
  "invalidTarget": "Invalid target number.",
  "notSavedHint": "Order is previewed. Press Save order to confirm."
},
"reorder": {
  "discard": "Discard changes",
  "discardConfirm": "Discard all unsaved order changes?",
  "changedSummary": "{{count}} page(s) differ from the saved order"
},
"bulkDelete": {
  "button": "Delete selected",
  "confirm": "Delete {{count}} page(s)? They move to trash and can be restored.",
  "conflict": "The page list was stale — nothing deleted. The list was refreshed, try again.",
  "draftBlocked": "Save or discard order changes before deleting."
}
```

- [ ] **Step 3: Valideeri JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/locales/et/workspace.json','utf8')); JSON.parse(require('fs').readFileSync('src/locales/en/workspace.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add src/locales/et/workspace.json src/locales/en/workspace.json
git commit -m "i18n(manage): hulgivaliku, liigutamise ja kustutamise võtmed"
```

---

### Task 6: Frontend — memoiseeritud `PageCard` komponent

Ekstrakti pisipilt-kaart `React.memo` komponendiks primitiivsete propsidega, et valiku/draft'i muutus ei renderdaks kogu 500-lehte ruudustikku. Selles task'is **säilita olemasolev käitumine** (kustuta-nupp, redaktor, üles/alla nooled), aga lisa valiku-märkeruut ja `onToggle`.

**Files:**
- Create: `src/pages/manage/PageCard.tsx`
- Modify: `src/pages/WorkManage.tsx` (impordi PageCard; asenda `pages.map(...)` JSX kaardirenderdus PageCard-iga — Task 7)

**Interfaces:**
- Consumes: `PageThumb` (eksisteerib `WorkManage.tsx`-s — liiguta see samuti `PageCard.tsx`-i VÕI ekspordi). Lihtsuse mõttes **liiguta `PageThumb` `src/pages/manage/PageThumb.tsx`-i** ja impordi mõlemas.
- Produces: `PageCard` props:
  ```ts
  interface PageCardProps {
    workId: string;
    filename: string;        // page.lehekylje_pilt failinimi (pildi nimi)
    imageName: string;       // pildi failinimi thumbnaili jaoks
    visiblePageNum: number;  // nähtav number (1..n)
    status: string;
    isSelected: boolean;
    isChanged: boolean;
    thumbCacheBust: number;
    onToggle: (filename: string, shiftKey: boolean) => void;
    onNudge: (filename: string, dir: -1 | 1) => void;
    onDelete: (visiblePageNum: number) => void;
    onEdit: (visiblePageNum: number) => void;
    canNudgeUp: boolean;
    canNudgeDown: boolean;
  }
  ```

- [ ] **Step 1: Liiguta `PageThumb` eraldi faili**

Loo `src/pages/manage/PageThumb.tsx` — **kopeeri `WorkManage.tsx:52-94` `PageThumb` komponent** muutmata, lisa `export`. Eemalda algne definitsioon `WorkManage.tsx`-st ja impordi: `import PageThumb from './manage/PageThumb';`.

- [ ] **Step 2: Loo `PageCard.tsx`**

```tsx
// src/pages/manage/PageCard.tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, Loader2, Scissors, ChevronUp, ChevronDown, Check } from 'lucide-react';
import PageThumb from './PageThumb';
import { IMAGE_BASE_URL } from '../../config';

interface PageCardProps {
  workId: string;
  filename: string;
  imageName: string;
  visiblePageNum: number;
  status: string;
  isSelected: boolean;
  isChanged: boolean;
  thumbCacheBust: number;
  deleting: boolean;
  onToggle: (filename: string, shiftKey: boolean) => void;
  onNudge: (filename: string, dir: -1 | 1) => void;
  onDelete: (visiblePageNum: number) => void;
  onEdit: (visiblePageNum: number) => void;
  canNudgeUp: boolean;
  canNudgeDown: boolean;
}

const statusColor = (status: string) => {
  switch (status) {
    case 'Valmis': return 'bg-green-100 text-green-700';
    case 'Kontrollitud': return 'bg-blue-100 text-blue-700';
    default: return 'bg-gray-100 text-gray-600';
  }
};

const PageCard: React.FC<PageCardProps> = (p) => {
  const { t } = useTranslation(['workspace', 'common']);
  return (
    <div
      className={`relative flex flex-col rounded-lg border overflow-hidden bg-white ${
        p.isSelected ? 'border-primary-500 ring-2 ring-primary-400'
          : p.isChanged ? 'border-amber-400 ring-1 ring-amber-300' : 'border-gray-200'
      }`}
    >
      <div className="relative aspect-[3/4] bg-gray-100 overflow-hidden">
        {/* Valiku-märkeruut — vasakus ülanurgas */}
        <button
          onClick={(e) => p.onToggle(p.filename, e.shiftKey)}
          className={`absolute top-1 left-1 z-10 w-5 h-5 flex items-center justify-center rounded border shadow-sm ${
            p.isSelected ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white/80 border-gray-300 text-transparent'
          }`}
          title={t('manage.select.all')}
          aria-pressed={p.isSelected}
        >
          <Check size={13} />
        </button>
        <PageThumb
          workId={p.workId}
          src={`${IMAGE_BASE_URL}/${p.workId}/_thumbs/_thumb_${p.imageName}?v=${p.thumbCacheBust}`}
          className="w-full h-full object-cover"
        />
        {/* Kustuta — paremas ülanurgas */}
        <button
          onClick={() => p.onDelete(p.visiblePageNum)}
          disabled={p.deleting}
          className="absolute top-1 right-1 p-1 bg-white/80 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded shadow-sm transition-colors disabled:opacity-50"
          title={t('manage.deletePage')}
        >
          {p.deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
        </button>
        {/* Nähtav number — all vasakul */}
        <span className={`absolute bottom-1 left-1 text-xs px-1 py-0.5 rounded leading-tight shadow-sm ${statusColor(p.status)}`}>
          {p.visiblePageNum}
        </span>
        {/* Redaktor — all paremal */}
        <button
          onClick={() => p.onEdit(p.visiblePageNum)}
          className="absolute bottom-1 right-1 p-1 bg-white/80 hover:bg-gray-100 text-gray-500 hover:text-gray-700 rounded shadow-sm transition-colors"
          title={t('manage.editor.title')}
        >
          <Scissors size={14} />
        </button>
      </div>
      {/* Üles/alla nooled (üksammuline nügimine nähtaval järjekorral) */}
      <div className="px-1.5 py-1 flex items-center justify-center gap-3">
        <button onClick={() => p.onNudge(p.filename, -1)} disabled={!p.canNudgeUp}
          className="text-gray-400 hover:text-gray-700 disabled:opacity-20"><ChevronUp size={16} /></button>
        <button onClick={() => p.onNudge(p.filename, 1)} disabled={!p.canNudgeDown}
          className="text-gray-400 hover:text-gray-700 disabled:opacity-20"><ChevronDown size={16} /></button>
      </div>
    </div>
  );
};

export default React.memo(PageCard);
```

- [ ] **Step 3: Tüübikontroll**

Run: `npx tsc --noEmit`
Expected: PASS (pole vigu PageCard/PageThumb failides). NB: `WorkManage.tsx` võib veel viidata vanale PageThumb-ile kuni Task 7 — kui tsc kurdab kasutamata impordi üle, jätka Task 7-ga, kus integreerimine lõpetatakse. Kui viga on AINULT "PageCard pole kasutatud", on OK.

- [ ] **Step 4: Commit**

```bash
git add src/pages/manage/PageCard.tsx src/pages/manage/PageThumb.tsx src/pages/WorkManage.tsx
git commit -m "refactor(manage): ekstrakti PageThumb + memoiseeritud PageCard (valiku-märkeruut)"
```

---

### Task 7: Frontend — valik, effective järjekord, liigutamine, tühista

Lisa `WorkManage.tsx`-i valikuolek, nähtav (effective) järjekord, valiku-riba liigutamisega (kasutab `computeBlockMoveOrder`), summary + "Tühista muudatused". Renderda ruudustik `visiblePages` järjekorras PageCard-idega.

**Files:**
- Modify: `src/pages/WorkManage.tsx`

**Interfaces:**
- Consumes: `computeBlockMoveOrder`, `VisiblePage`, `MovePreview` (Task 1); `PageCard` (Task 6); olemasolevad `pages`, `draftPositions`, `hasReorderChanges`, `handleReorderSave`, `applyInsert`.
- Produces: olek `selectedFiles: Set<string>`, `moveTarget: string`; helperid `visiblePages`, `handleToggle`, `handleMove`, `handleDiscardReorder`.

- [ ] **Step 1: Lisa import ja olek**

`WorkManage.tsx` importidesse:

```tsx
import { computeBlockMoveOrder, VisiblePage } from '../utils/blockReorder';
import PageCard from './manage/PageCard';
```

Lisa komponendi olekusse (teiste useState'ide juurde):

```tsx
const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
const [moveTarget, setMoveTarget] = useState('');
const lastSelectedIndexRef = useRef<number | null>(null);
```

- [ ] **Step 2: Tuleta nähtav (effective) järjekord ja diff-summary**

Lisa pärast `hasReorderChanges` rida:

```tsx
// Nähtav (effective) järjekord: draft kui olemas, muidu serveri page_num.
// Iga lehe nähtav number on tema indeks selles järjestuses + 1.
const visibleSorted = [...pages].sort(
  (a, b) => (draftPositions[a.filename] ?? a.page_num) - (draftPositions[b.filename] ?? b.page_num)
);
const visiblePages: VisiblePage[] = visibleSorted.map((p, i) => ({ filename: p.filename, visiblePageNum: i + 1 }));
const visibleNumByFile: Record<string, number> = {};
visiblePages.forEach((vp) => { visibleNumByFile[vp.filename] = vp.visiblePageNum; });

// Mitme lehe asukoht erineb salvestatud (serveri) järjekorrast
const changedCount = pages.filter((p) => (draftPositions[p.filename] ?? p.page_num) !== p.page_num).length;

// Liigutamise eelvaade/valideerimine (sama util mis submit)
const moveResult = selectedFiles.size > 0
  ? computeBlockMoveOrder(visiblePages, selectedFiles, moveTarget)
  : null;
```

- [ ] **Step 3: Lisa handlerid**

```tsx
// Vali/tühista; shift = vahemik viimasest ankrust nähtaval järjekorral
const handleToggle = (filename: string, shiftKey: boolean) => {
  const idx = visiblePages.findIndex((vp) => vp.filename === filename);
  setSelectedFiles((prev) => {
    const next = new Set(prev);
    if (shiftKey && lastSelectedIndexRef.current !== null) {
      const [lo, hi] = [lastSelectedIndexRef.current, idx].sort((a, b) => a - b);
      for (let i = lo; i <= hi; i++) next.add(visiblePages[i].filename);
    } else {
      if (next.has(filename)) next.delete(filename); else next.add(filename);
    }
    return next;
  });
  lastSelectedIndexRef.current = idx;
};

const handleSelectAll = () => setSelectedFiles(new Set(pages.map((p) => p.filename)));
const handleClearSelection = () => { setSelectedFiles(new Set()); lastSelectedIndexRef.current = null; };

// Liiguta plokk: kirjuta uus order draftPositions-i (ei salvesta veel serverisse)
const handleMove = () => {
  if (!moveResult || !moveResult.ok) return;
  const next: Record<string, number> = {};
  moveResult.order.forEach((fn, i) => { next[fn] = i + 1; });
  setDraftPositions(next);
  setMoveTarget('');
  // valik jääb alles (samad failid, uues asukohas)
};

// Tühista kõik salvestamata järjekorra muudatused
const handleDiscardReorder = () => {
  if (changedCount > 2 && !window.confirm(t('manage.reorder.discardConfirm'))) return;
  const init: Record<string, number> = {};
  pages.forEach((p) => { init[p.filename] = p.page_num; });
  setDraftPositions(init);
  setInputValues({});
};

// Üksiku lehe nügimine nähtaval järjekorral (nool)
const handleNudge = (filename: string, dir: -1 | 1) => {
  const cur = visibleNumByFile[filename];
  applyInsert(filename, Math.max(1, Math.min(pages.length, cur + dir)));
};
```

- [ ] **Step 4: Asenda ruudustiku JSX**

Asenda olemasolev `<div className="grid ...">{pages.map(...)}</div>` plokk (`WorkManage.tsx:610-715`) järgnevaga (renderdab `visibleSorted` järjekorras PageCard-idega):

```tsx
<div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 p-4">
  {visibleSorted.map((page) => {
    const vNum = visibleNumByFile[page.filename];
    return (
      <PageCard
        key={page.filename}
        workId={workId!}
        filename={page.filename}
        imageName={page.lehekylje_pilt.split('/').pop() ?? ''}
        visiblePageNum={vNum}
        status={page.status}
        isSelected={selectedFiles.has(page.filename)}
        isChanged={(draftPositions[page.filename] ?? page.page_num) !== page.page_num}
        thumbCacheBust={thumbCacheBust}
        deleting={deletingPage === page.page_num}
        onToggle={handleToggle}
        onNudge={handleNudge}
        onDelete={handleDeletePage}
        onEdit={(n) => setEditorTarget({ index: n - 1, tab: 'edit' })}
        canNudgeUp={vNum > 1}
        canNudgeDown={vNum < pages.length}
      />
    );
  })}
</div>
```

- [ ] **Step 5: Lisa valiku-riba ja reorder-juhtnupud**

Asenda olemasolev reorder-päise plokk (`WorkManage.tsx:582-594`, kus on "Salvesta järjekord" nupp) järgnevaga, mis lisab summary + "Tühista muudatused", ning lisa ruudustiku KOHALE valiku-riba. Pane valiku-riba vahetult `<div className="grid ...">` ette:

```tsx
{/* Valiku-riba */}
{selectedFiles.size > 0 && (
  <div className="mx-4 mt-3 mb-1 p-3 bg-primary-50 border border-primary-200 rounded-lg flex flex-wrap items-center gap-3">
    <span className="text-sm font-medium text-primary-800">{t('manage.select.count', { count: selectedFiles.size })}</span>
    <button onClick={handleClearSelection} className="text-xs text-primary-700 hover:underline">{t('manage.select.clear')}</button>
    <div className="flex items-center gap-1.5">
      <label className="text-sm text-gray-600">{t('manage.move.label')}</label>
      <input
        type="text" inputMode="numeric" value={moveTarget}
        onChange={(e) => setMoveTarget(e.target.value)}
        className="w-16 text-sm text-center border border-gray-300 rounded px-1 py-0.5"
      />
      <button
        onClick={handleMove}
        disabled={hasReorderChanges ? false : !(moveResult && moveResult.ok)}
        className="px-3 py-1 text-sm bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white rounded"
      >{t('manage.move.button')}</button>
    </div>
    {/* Elav eelvaade / vihje */}
    {moveResult && (moveResult.ok ? (
      <span className="text-sm text-gray-600">
        {moveResult.preview.kind === 'between'
          ? t('manage.move.previewBetween', { before: moveResult.preview.before, after: moveResult.preview.after })
          : moveResult.preview.kind === 'start' ? t('manage.move.previewStart') : t('manage.move.previewEnd')}
      </span>
    ) : (
      <span className="text-sm text-amber-700">
        {moveResult.reason === 'anchorInSelection'
          ? t('manage.move.anchorInSelection', { end: pages.length + 1 })
          : moveResult.reason === 'invalidTarget' ? t('manage.move.invalidTarget') : ''}
      </span>
    ))}
    <button
      onClick={() => setBulkDeleteConfirm(true)}
      disabled={hasReorderChanges}
      title={hasReorderChanges ? t('manage.bulkDelete.draftBlocked') : ''}
      className="ml-auto px-3 py-1 text-sm border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-40"
    >{t('manage.bulkDelete.button')}</button>
  </div>
)}
```

Ja reorder-päise plokis (kus oli `{hasReorderChanges && (<button onClick={handleReorderSave}...>)}`) asenda:

```tsx
{hasReorderChanges && (
  <div className="flex items-center gap-2">
    <span className="text-xs text-amber-700">{t('manage.reorder.changedSummary', { count: changedCount })}</span>
    <button onClick={handleDiscardReorder}
      className="px-2 py-1 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50">
      {t('manage.reorder.discard')}
    </button>
    <button onClick={handleReorderSave} disabled={reorderSaving}
      className="flex items-center gap-1.5 px-3 py-1 text-sm bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded">
      {reorderSaving ? <Loader2 size={13} className="animate-spin" /> : <ArrowUpDown size={13} />}
      {t('manage.reorderSave')}
    </button>
  </div>
)}
```

> **NB:** `setBulkDeleteConfirm` defineeritakse Task 8-s. Selle step'i lõpus võib tsc kurta
> defineerimata `setBulkDeleteConfirm` üle — see on ootuspärane, lahendatakse Task 8-s.
> Kui soovid vahepealset rohelist tsc-d, lisa ajutiselt `const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);` juba siin.

- [ ] **Step 6: Koristus — eemalda orvuks jäänud number-välja kood**

Number-välja eemaldamisega jäävad mõned olemasolevad asjad kasutuseta. Eemalda `WorkManage.tsx`-st:
- funktsioon `commitReorderInput` (kui seda enam ei kutsuta);
- `inputValues` state ja `setInputValues` AINULT siis, kui neid mujal ei kasutata — **NB:** `handleDiscardReorder` (Step 3) kutsub `setInputValues({})`; kui jätad `inputValues` alles, on OK. Lihtsaim: jäta `inputValues`/`setInputValues` alles (kahjutu), eemalda ainult `commitReorderInput`, kui see jääb kasutamata;
- kasutamata lucide-ikoonide impordid (nt `CornerDownLeft`, vajadusel `ChevronUp`/`ChevronDown` kui need kolisid PageCard-i).

Kontrolli, mis tegelikult kasutuseta jääb (tsc ütleb), ja eemalda just need.

- [ ] **Step 7: Tüübikontroll + build**

Lisa Task 8 olekuriba (allpool) VÕI ajutine `bulkDeleteConfirm` olek, siis:
Run: `npx tsc --noEmit && npm run build`
Expected: build õnnestub.

- [ ] **Step 8: Commit**

```bash
git add src/pages/WorkManage.tsx
git commit -m "feat(manage): hulgivalik + effective-order liigutamine + tühista (WYSIWYG)"
```

---

### Task 8: Frontend — bulk-kustutuse juhtmestik (kinnitus + 409)

Lisa kinnitusdialoog ja `POST /delete-pages` kutse 409/404-käsitlusega.

**Files:**
- Modify: `src/pages/WorkManage.tsx`

**Interfaces:**
- Consumes: `selectedFiles`, `loadPages`, `loadTrashPages`, `trashLoaded`, `fetchWithTimeout`, `getAuthHeaders`, `FILE_API_URL`.
- Produces: olek `bulkDeleteConfirm`, `bulkDeleting`, `bulkDeleteError`; handler `handleBulkDelete`.

- [ ] **Step 1: Lisa olek ja handler**

```tsx
const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
const [bulkDeleting, setBulkDeleting] = useState(false);
const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);

const handleBulkDelete = async () => {
  if (!workId || !authToken || selectedFiles.size === 0) return;
  // base_name = pildifaili nimi ilma laiendita
  const baseNames = Array.from(selectedFiles).map((fn) => {
    const img = pages.find((p) => p.filename === fn)?.lehekylje_pilt.split('/').pop() ?? fn;
    return img.replace(/\.[^.]+$/, '');
  });
  setBulkDeleting(true);
  setBulkDeleteError(null);
  try {
    const res = await fetchWithTimeout(`${FILE_API_URL}/admin/work/${workId}/delete-pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
      body: JSON.stringify({ base_names: baseNames }),
      timeout: 30000,
    });
    if (res.status === 409) {
      setBulkDeleteError(t('manage.bulkDelete.conflict'));
      await loadPages();
      setSelectedFiles(new Set());
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadPages();
    if (trashLoaded) loadTrashPages();
    setSelectedFiles(new Set());
    setBulkDeleteConfirm(false);
  } catch (e: any) {
    setBulkDeleteError(e.message || t('manage.deletePageError'));
  } finally {
    setBulkDeleting(false);
  }
};
```

- [ ] **Step 2: Lisa kinnitusdialoog JSX**

Lisa valiku-riba sisse (või vahetult selle järele) `bulkDeleteConfirm` modaal/plokk:

```tsx
{bulkDeleteConfirm && (
  <div className="mx-4 mb-2 p-3 bg-red-50 border border-red-200 rounded-lg flex flex-wrap items-center gap-3">
    <span className="text-sm text-red-800">{t('manage.bulkDelete.confirm', { count: selectedFiles.size })}</span>
    <button onClick={handleBulkDelete} disabled={bulkDeleting}
      className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded">
      {bulkDeleting ? <Loader2 size={13} className="animate-spin inline" /> : t('manage.bulkDelete.button')}
    </button>
    <button onClick={() => setBulkDeleteConfirm(false)}
      className="px-3 py-1 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50">
      {t('common:buttons.cancel', 'Tühista')}
    </button>
  </div>
)}
{bulkDeleteError && (
  <div className="mx-4 mb-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{bulkDeleteError}</div>
)}
```

- [ ] **Step 3: Tüübikontroll + build**

Run: `npx tsc --noEmit && npm run build`
Expected: build õnnestub, vigu pole.

- [ ] **Step 4: Commit**

```bash
git add src/pages/WorkManage.tsx
git commit -m "feat(manage): bulk-kustutuse kinnitus + 409-käsitlus"
```

---

### Task 9: Käsitsi-verifitseerimine (lokaalne dev + server)

Pole automaattest — käivita rakendus ja kontrolli päriskäitumist. (Backend jookseb serveris Dockeris; lokaalselt saab kontrollida frontend-loogikat dev-serveriga, kui backend on kättesaadav.)

**Files:** (puudub — verifitseerimine)

- [ ] **Step 1: Käivita kõik automaattestid**

Run:
```bash
npx vitest run src/utils/__tests__/blockReorder.test.ts
.venv/bin/python -m pytest tests/test_delete_pages_git.py tests/test_delete_pages.py tests/test_delete_pages_endpoint.py -v
```
Expected: kõik PASS.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: õnnestub.

- [ ] **Step 3: Käsitsi-kontroll (kontrollnimekiri)**

Dev-serveris (`npm run dev`, admin sisse logitud, ava `/work/{id}/manage`):
- [ ] Vali shift-klõpsuga vahemik → valitakse nähtava järjekorra järgi.
- [ ] Trüki sihtnumber → eelvaade kuvab "lehtede X ja Y vahele" / "algusesse" / "lõppu".
- [ ] "Liiguta" → ruudustik järjestub ümber (WYSIWYG), amber + summary ilmuvad, ei salvestu.
- [ ] Sihtnumber = valitud lehe number → "Liiguta" keelatud, vihje näitab `pageCount+1`.
- [ ] "Tühista muudatused" (suure diff'i puhul küsib confirm) → ruudustik tagasi algsesse.
- [ ] "Salvesta järjekord" → POST `/reorder-pages`, püsib pärast reload'i.
- [ ] Kustuta-nupp on keelatud kui on salvestamata reorder; vihje kuvatakse.
- [ ] Vali mitu + "Kustuta valitud" + kinnita → lehed prügikastis, taastatav.

- [ ] **Step 4: Deploy (kui kasutaja kinnitab)**

Backend (serveris):
```bash
ssh vutt 'cd ~/VUTT && git pull && docker compose build --no-cache backend && docker compose up -d backend'
```
Frontend (lokaalselt):
```bash
npm run build && rsync -avz dist/ vutt:~/VUTT/dist/
```

---

## Plan Self-Review

**Spec coverage:**
- Effective/visible-order semantika → Task 1 (util) + Task 7 (visiblePages derivatsioon). ✅
- "lehe N järele" range loogika (0/end/anchor) → Task 1. ✅
- Lenientne parsimine (tühi/NaN/kümnend) → Task 1. ✅
- Result-union (preview + keelamine + order üks util) → Task 1 + Task 7 kasutus. ✅
- Shift-vahemik nähtaval järjekorral → Task 7 `handleToggle`. ✅
- WYSIWYG ruudustik + amber + summary → Task 7. ✅
- "Tühista muudatused" + confirm → Task 7 `handleDiscardReorder`. ✅
- Kustutus keelatud draft'i ajal → Task 7 (nupp `disabled={hasReorderChanges}`). ✅
- Bulk-delete kõik-või-mitte-midagi (404/409/400) → Task 3 + Task 4. ✅
- Üks commit + üks reindeks → Task 2 + Task 3 (test kontrollib sync=1). ✅
- Rollback (FS + scoped git index) → Task 2 (git) + Task 3 (jpg). ✅
- base_name path-traversal + täpne kuuluvus → Task 4 (`_validate_base_names`) + Task 3 (`by_base`). ✅
- Tegelik failinimi/laiend (mitte hardcoded .jpg) → Task 3 (`by_base[base]`). ✅
- Prügikasti tee sama kui üksik-delete → Task 3 (sama `_trash/{work_id}/pages`). ✅
- Memo-kaart jõudlus → Task 6. ✅
- i18n et/en → Task 5. ✅
- "Vali kõik" praegu kõik lehed → Task 7 `handleSelectAll`. ✅

**Sync-tõrke käitumine:** spec ütleb "järgib olemasolevat üksik-kustutuse käitumist". Task 3 kutsub `sync_work_to_meilisearch(folder_name)` sünkroonselt pärast commiti (sama kui `admin_delete_page`); kui see viskab, levib erind — see EI vasta täpselt "ei katkesta vastust" mustrile, KUI olemasolev üksik-delete neelab vea. **Kontrolli implementeerimisel** `admin_delete_page` täpset käitumist ja peegelda seda (kui üksik-delete ei püüa viga, ära püüa ka batch-is; kui püüab, lisa sama try/except sünki ümber). Märgitud Task 3 implementeerijale.

**Type consistency:** `computeBlockMoveOrder` signatuur (Task 1) = kasutus Task 7-s (`visiblePages`, `selectedFiles`, `moveTarget`). `delete_pages` tagastus (Task 3) = endpoint mapping (Task 4). PageCard props (Task 6) = kasutus Task 7-s. ✅

**Autentimine endpoint-testis:** lahendatud — `tests/conftest.py` `backend_env`/`client`/`login` fixtureid kasutusel (sama muster kui `tests/test_transform_page.py`); admin-token `login("admin", "adminpass")`.
