# Lehekülje kommentaaride markdown + git-taaste — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anda lehekülje kommentaaridele (ja vastustele) markdown-tugi (pariteet prosopoga) ning ehitada kommentaari-versioonide taastamine git-ajaloost (kustutatud + ülekirjutatud põhitekst).

**Architecture:** Markdown taaskasutab olemasolevaid `MarkdownEditor`/`MarkdownView` komponente; `MarkdownView` saab valikulise `softBreaks` prop'i (single newline → `<br>`). Taaste loeb tõe git-ajaloost on-demand: uus puhas moodul `server/comment_history_ops.py` arvutab versioonid/kustutatud, kaks õhukest endpointi `server/routers/editing.py`-s pakuvad neid, UI elab `AnnotationsTab.tsx`-is (inline kella-ikoon + "Kustutatud kommentaarid" kaart).

**Tech Stack:** React 19 + TypeScript + Tailwind (frontend), FastAPI + GitPython (backend), vitest (FE pure-logic), pytest (BE).

## Global Constraints

- **Markdown-only, XSS-kindel:** `MarkdownView` EI tohi tuua sisse `rehype-raw`-i. `softBreaks` lisab AINULT `remark-breaks` plugina.
- **Andmemudel muutmatu:** `comment.text` / `reply.text` jäävad markdown-stringideks lehe `.json`-is; backend-skeem, Meilisearch-skeem ega migratsioon ei muutu.
- **Õigus:** taaste-endpointid ja taaste-UI nõuavad `editor`+ (`require_role("editor")` / `isAtLeast`).
- **Git on ainus tõeallikas:** eraldi ajaloo-indeksit EI looda.
- **`text_annotations` jäävad puutumata** (ei markdown, ei taaste).
- **Path/catalog tuletamine:** kasuta sama mustrit mis `/save` ja `/git-restore` (`os.path.basename(original_path)` + `BASE_DIR`). Ära dubleeri.
- **Frontend gate:** `npm run typecheck` peab läbima (Vite ei typecheck'i build'is).
- **Backend testid:** `.venv/bin/python -m pytest` (host venv).
- **Commit-keel:** eesti, lõpeta `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Haru:** `feat/page-comments-markdown-git-restore` (juba loodud).

---

## Failistruktuur

| Fail | Vastutus | Tegevus |
|------|----------|---------|
| `src/components/MarkdownView.tsx` | Markdown-renderdus | Modify: lisa `softBreaks?` prop |
| `package.json` | Sõltuvused | Modify: lisa `remark-breaks` |
| `src/components/editor/AnnotationsTab.tsx` | Kommentaaride UI | Modify: markdown sisestus/kuva + taaste-UI |
| `src/index.css` | Stiilid | Modify: kommentaari-markdown URL-wrap klass |
| `server/comment_history_ops.py` | Git-ajaloo arvutus (puhas) | Create |
| `tests/test_comment_history_ops.py` | Ops-testid | Create |
| `server/routers/editing.py` | Kaks uut endpointi | Modify |
| `tests/test_page_comments_endpoints.py` | Endpoint-testid | Create |
| `src/services/commentHistoryService.ts` | FE API-kõned | Create |
| `src/locales/{et,en}/workspace.json` | i18n | Modify |

---

## Task 1: `MarkdownView` `softBreaks` prop + `remark-breaks` sõltuvus

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `src/components/MarkdownView.tsx`

**Interfaces:**
- Produces: `MarkdownView` prop `softBreaks?: boolean` — kui `true`, single newline renderdub `<br>`-na (`remark-breaks`). Vaikimisi `false` (prosopo käitumine muutmatu).

- [ ] **Step 1: Installi `remark-breaks`**

Run:
```bash
npm install remark-breaks
```
Expected: `package.json` dependencies saab `"remark-breaks": "^4.x.x"`, `package-lock.json` uueneb.

- [ ] **Step 2: Lisa `softBreaks` prop `MarkdownView`-sse**

Modify `src/components/MarkdownView.tsx` — lisa import ja prop, ehita `remarkPlugins` tingimuslikult:

```tsx
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

// Piiratud, turvaline markdown-renderdus (märkmed, elulugu, kommentaarid).
// Ainult markdown — toores HTML escape'itud (ei kasuta rehype-raw'd).
// Renderduv DOM on allow-listitud; keelatud elementide tekst säilib (unwrapDisallowed).
const ALLOWED_ELEMENTS = [
  'p', 'strong', 'em', 'del', 'a',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3',
  'blockquote', 'code', 'br',
];

interface MarkdownViewProps {
  content: string;
  className?: string;
  // softBreaks: single newline → <br> (remark-breaks). Vajalik vanade plain-text
  // kommentaaride reavahetuste säilitamiseks. Prosopo ei kasuta (vaikimisi false).
  softBreaks?: boolean;
}

const MarkdownView: React.FC<MarkdownViewProps> = ({ content, className, softBreaks }) => {
  if (!content || !content.trim()) return null;
  const remarkPlugins = softBreaks ? [remarkGfm, remarkBreaks] : [remarkGfm];
  return (
    <div className={['vutt-md', className].filter(Boolean).join(' ')}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        allowedElements={ALLOWED_ELEMENTS}
        unwrapDisallowed
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownView;
```

- [ ] **Step 3: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: 0 viga.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/components/MarkdownView.tsx
git commit -m "feat: MarkdownView softBreaks prop (remark-breaks)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Markdown sisestus + kuva kommentaarides (`AnnotationsTab`)

**Files:**
- Modify: `src/components/editor/AnnotationsTab.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `MarkdownEditor` (`{ value, onChange, placeholder?, minRows?, disabled? }`), `MarkdownView` (`{ content, className?, softBreaks? }`).
- Produces: kommentaari/vastuse vabatekst on markdown; kuva läbi `MarkdownView softBreaks` + URL-wrap klassi.

- [ ] **Step 1: Lisa CSS URL-wrap klass**

Modify `src/index.css` — lisa (nt `.vutt-md` reeglite lähedusse):

```css
/* Kommentaaride markdown: pikad URL-id ei tohi layout'i lõhkuda */
.vutt-md-comment {
  overflow-wrap: anywhere;
  word-break: break-word;
}
```

- [ ] **Step 2: Impordi markdown-komponendid `AnnotationsTab`-i**

Modify `src/components/editor/AnnotationsTab.tsx` — lisa importide juurde (rida ~16 lähedusse):

```tsx
import MarkdownEditor from '../MarkdownEditor';
import MarkdownView from '../MarkdownView';
```

- [ ] **Step 3: Asenda uue kommentaari `<textarea>` `MarkdownEditor`-iga**

Leia uue kommentaari sisestus (`newComment` state, allpool kommentaaride loendit — `addComment` nupp). Asenda `<textarea value={newComment} onChange=... >` järgmisega:

```tsx
<MarkdownEditor
  value={newComment}
  onChange={setNewComment}
  placeholder={t('info.addAnnotationPlaceholder')}
  minRows={3}
/>
```
(Säilita ümbritsev konteiner ja "Lisa" nupp muutmata; eemalda ainult `<textarea>`.)

- [ ] **Step 4: Asenda kommentaari muutmise `<textarea>` `MarkdownEditor`-iga**

`AnnotationsTab.tsx:849-858` (`editingCommentId === comment.id` haru) — asenda `<textarea value={editingText} ...>` järgmisega:

```tsx
<MarkdownEditor
  value={editingText}
  onChange={setEditingText}
  minRows={6}
/>
```

- [ ] **Step 5: Asenda kommentaari `text`-kuva `MarkdownView`-ga**

`AnnotationsTab.tsx:879` — asenda
`<p className="text-gray-800 text-sm mb-2 leading-relaxed pr-5 whitespace-pre-wrap">{comment.text}</p>`
järgmisega (NB: `<div>`, mitte `<p>` — markdown tekitab ise plokk-elemente):

```tsx
<div className="text-gray-800 text-sm mb-2 leading-relaxed pr-5 vutt-md-comment">
  <MarkdownView content={comment.text} softBreaks />
</div>
```

- [ ] **Step 6: Asenda vastuse `text`-kuva `MarkdownView`-ga**

`AnnotationsTab.tsx:888` — asenda
`<p className="text-gray-800 text-sm mb-1 leading-relaxed whitespace-pre-wrap">{reply.text}</p>`
järgmisega:

```tsx
<div className="text-gray-800 text-sm mb-1 leading-relaxed vutt-md-comment">
  <MarkdownView content={reply.text} softBreaks />
</div>
```

- [ ] **Step 7: Asenda vastuse sisestuse `<textarea>` `MarkdownEditor`-iga**

`AnnotationsTab.tsx:899-913` (`replyingToCommentId === comment.id`) — asenda `<textarea value={replyText} ...>` järgmisega:

```tsx
<MarkdownEditor
  value={replyText}
  onChange={setReplyText}
  placeholder={t('info.replyPlaceholder')}
  minRows={3}
/>
```
(Escape-käsitlus oli `<textarea onKeyDown>`-is; `MarkdownEditor`-il seda ei ole — Tühista-nupp jääb alles, see katab tühistamise.)

- [ ] **Step 8: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: 0 viga.

- [ ] **Step 9: Manuaalne smoke (build + visuaalne)**

Run:
```bash
npm run build
```
Expected: build õnnestub. Visuaalne kontroll dev-serveris (`npm run dev`): vana plain-text kommentaar reavahetustega renderdub reavahetustega (softBreaks); `**paks**` → paks; pikk palja URL ei lõhu kasti laiust; vastus renderdub markdown'ina.

- [ ] **Step 10: Commit**

```bash
git add src/components/editor/AnnotationsTab.tsx src/index.css
git commit -m "feat: markdown kommentaarides ja vastustes (AnnotationsTab)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `comment_history_ops.py` — git-ajaloo arvutus (puhas, TDD)

**Files:**
- Create: `server/comment_history_ops.py`
- Test: `tests/test_comment_history_ops.py`

**Interfaces:**
- Consumes: `server.git_ops.get_file_git_history(paths, max_count)` → list[dict] (`full_hash`, `hash`, `author`, `date`, ...), uusimast vanimani; `server.git_ops.get_file_at_commit(relative_path, commit_hash)` → str|None.
- Produces:
  - `build_comment_history(json_relpath: str, current_comments: list, max_count: int = 100) -> dict` → `{ "versions": {comment_id: [{commit_hash, timestamp, author, text}]}, "deleted": [{id, text, author, created_at, replies, last_seen_commit}], "truncated": bool }`
  - `find_comment_in_content(file_content: str, comment_id: str) -> dict | None`
  - `apply_comment_restore(current_comments: list, restored_comment: dict, mode: str) -> tuple[list | None, tuple[int, str] | None]` → `(new_comments, None)` õnnestumisel, `(None, (status_code, detail))` vea korral.

- [ ] **Step 1: Kirjuta langevad testid (fixture + ops)**

Create `tests/test_comment_history_ops.py`:

```python
"""Testid kommentaaride git-ajaloo arvutusele (päris ajutine git-repo)."""
import json
import os
import sys
from pathlib import Path

import pytest
from git import Repo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.git_ops as git_ops
import server.comment_history_ops as cho


def _page_json(comments):
    return json.dumps({"comments": comments}, ensure_ascii=False, indent=2)


def _c(cid, text, author="u", created="2026-01-01T00:00:00", replies=None):
    return {"id": cid, "text": text, "author": author,
            "created_at": created, "replies": replies or []}


@pytest.fixture
def repo(tmp_path, monkeypatch):
    """Git-repo, kus pg1.json comments muutub mitme commiti jooksul."""
    r = Repo.init(str(tmp_path))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")
    folder = tmp_path / "1690-w1"
    folder.mkdir()
    jp = folder / "pg1.json"
    rel = os.path.relpath(str(jp), str(tmp_path))

    def commit(comments, msg):
        jp.write_text(_page_json(comments), encoding="utf-8")
        r.index.add([rel])
        r.index.commit(msg)

    # c1: tekst muutub A → B → C; c2 kustutatakse; c3 lisandub hiljem
    commit([_c("c1", "A"), _c("c2", "X", replies=[{"id": "r1", "text": "vastus"}])], "v1")
    commit([_c("c1", "B"), _c("c2", "X2", replies=[{"id": "r1", "text": "vastus"}])], "v2")
    commit([_c("c1", "C")], "v3 (c2 kustutatud)")          # c2 kadus, viimane seis "X2"
    commit([_c("c1", "C"), _c("c3", "uus")], "v4")          # c3 lisandus

    monkeypatch.setattr(git_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    return {"repo": r, "rel": rel, "folder": folder}


def test_versions_only_historical_differing(repo):
    current = [_c("c1", "C"), _c("c3", "uus")]
    res = cho.build_comment_history(repo["rel"], current)
    texts = [v["text"] for v in res["versions"].get("c1", [])]
    # praegune "C" ei kuulu; ajaloolised erinevad: B, A (uusimast vanimani)
    assert texts == ["B", "A"]
    assert "c3" not in res["versions"]  # c3-l pole ajaloolisi erinevaid versioone


def test_deleted_keeps_last_state_before_deletion(repo):
    current = [_c("c1", "C"), _c("c3", "uus")]
    res = cho.build_comment_history(repo["rel"], current)
    deleted_ids = {d["id"]: d for d in res["deleted"]}
    assert "c2" in deleted_ids
    # viimane seis enne kustutamist oli "X2", mitte esimene "X"
    assert deleted_ids["c2"]["text"] == "X2"
    assert deleted_ids["c2"]["replies"] == [{"id": "r1", "text": "vastus"}]


def test_dedup_consecutive_identical(repo, monkeypatch):
    # current = A → versions peaks olema [C, B] (ei dubleeri)
    current = [_c("c1", "A")]
    res = cho.build_comment_history(repo["rel"], current)
    texts = [v["text"] for v in res["versions"].get("c1", [])]
    assert texts == ["C", "B"]


def test_truncated_flag(repo):
    res = cho.build_comment_history(repo["rel"], [_c("c1", "C")], max_count=2)
    assert res["truncated"] is True
    res2 = cho.build_comment_history(repo["rel"], [_c("c1", "C")], max_count=100)
    assert res2["truncated"] is False


def test_malformed_json_commit_does_not_crash(repo, monkeypatch):
    # Üks commit tagastab vigast JSON-i → see commit skipitakse, ülejäänu töötab
    real = cho.get_file_at_commit
    calls = {"n": 0}
    def flaky(rel, h):
        calls["n"] += 1
        if calls["n"] == 1:       # uusim commit → katki
            return "{ broken json"
        return real(rel, h)
    monkeypatch.setattr(cho, "get_file_at_commit", flaky)
    res = cho.build_comment_history(repo["rel"], [_c("c1", "C")])
    # ei viska; vanematest commititest leitakse endiselt c1 ajaloolised versioonid
    assert isinstance(res["versions"], dict)
    assert any(v["text"] in ("B", "A") for v in res["versions"].get("c1", []))


def test_extract_comments_meta_content_wrapper():
    content = json.dumps({"meta_content": {"comments": [_c("c1", "Z")]}})
    assert cho.find_comment_in_content(content, "c1")["text"] == "Z"


def test_extract_comments_invalid_json_returns_none():
    assert cho.find_comment_in_content("{ not json", "c1") is None


def test_apply_restore_version_overwrites_text_keeps_replies():
    current = [_c("c1", "uus", replies=[{"id": "r9", "text": "praegune vastus"}])]
    new, err = cho.apply_comment_restore(current, _c("c1", "vana"), "version")
    assert err is None
    assert new[0]["text"] == "vana"
    assert new[0]["replies"] == [{"id": "r9", "text": "praegune vastus"}]


def test_apply_restore_version_missing_id_errors():
    new, err = cho.apply_comment_restore([_c("c1", "x")], _c("cX", "y"), "version")
    assert new is None and err[0] == 404


def test_apply_restore_deleted_appends():
    new, err = cho.apply_comment_restore([_c("c1", "x")], _c("c2", "tagasi"), "deleted")
    assert err is None
    assert [c["id"] for c in new] == ["c1", "c2"]


def test_apply_restore_deleted_conflict():
    new, err = cho.apply_comment_restore([_c("c1", "x")], _c("c1", "y"), "deleted")
    assert new is None and err[0] == 409
```

- [ ] **Step 2: Käivita testid — peavad langema**

Run:
```bash
.venv/bin/python -m pytest tests/test_comment_history_ops.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'server.comment_history_ops'`.

- [ ] **Step 3: Kirjuta `comment_history_ops.py`**

Create `server/comment_history_ops.py`:

```python
"""Kommentaaride versiooniajaloo arvutus git-logist (on-demand, puhas loogika).

Git on ainus tõeallikas — eraldi indeksit ei hoita. Vt
docs/superpowers/specs/2026-06-30-page-comments-markdown-git-restore-design.md
"""
import json

from .git_ops import get_file_at_commit, get_file_git_history


def _extract_comments(file_content):
    """Parsib lehe .json sisu → comments-massiiv.

    Toetab nii juur-`comments` kui `meta_content.comments` struktuuri.
    Vigane JSON / puuduv comments → [].
    """
    try:
        data = json.loads(file_content)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(data, dict):
        return []
    source = data.get("meta_content", data)
    if not isinstance(source, dict):
        return []
    comments = source.get("comments", [])
    return comments if isinstance(comments, list) else []


def find_comment_in_content(file_content, comment_id):
    """Leiab kommentaari-objekti faili sisust id järgi; None kui puudub."""
    for c in _extract_comments(file_content):
        if isinstance(c, dict) and c.get("id") == comment_id:
            return c
    return None


def build_comment_history(json_relpath, current_comments, max_count=100):
    """Arvutab kommentaaride versiooniajaloo git-logist.

    versions: { id: [{commit_hash, timestamp, author, text}] } — AINULT ajaloolised
              text-versioonid, mis erinevad praegusest; uusimast vanimani;
              järjestikused identsed kokku tõmmatud.
    deleted:  [{id, text, author, created_at, replies, last_seen_commit}] — id-d,
              mis ajaloos esinevad aga current_comments-ist puuduvad; säilitatud
              uusim esinemine (= viimane seis enne kustutamist).
    truncated: kas ajalugu jõudis max_count-ini.
    """
    history = get_file_git_history(json_relpath, max_count=max_count)
    truncated = len(history) >= max_count

    current_by_id = {c.get("id"): c for c in current_comments if isinstance(c, dict)}
    current_text = {cid: c.get("text", "") for cid, c in current_by_id.items()}

    versions = {}
    last_added = {}   # id -> viimati lisatud text (dedup)
    deleted = {}      # id -> deleted-kirje (esimene kohatud = uusim)

    for commit in history:  # uusimast vanimani
        content = get_file_at_commit(json_relpath, commit["full_hash"])
        if content is None:
            continue
        for c in _extract_comments(content):
            if not isinstance(c, dict):
                continue
            cid = c.get("id")
            if cid is None:
                continue
            text = c.get("text", "")
            if cid in current_by_id:
                if text != current_text.get(cid) and last_added.get(cid) != text:
                    versions.setdefault(cid, []).append({
                        "commit_hash": commit["full_hash"],
                        "timestamp": commit["date"],
                        "author": commit["author"],
                        "text": text,
                    })
                    last_added[cid] = text
            elif cid not in deleted:
                deleted[cid] = {
                    "id": cid,
                    "text": text,
                    "author": c.get("author", ""),
                    "created_at": c.get("created_at", ""),
                    "replies": c.get("replies", []),
                    "last_seen_commit": commit["full_hash"],
                }

    return {
        "versions": versions,
        "deleted": list(deleted.values()),
        "truncated": truncated,
    }


def apply_comment_restore(current_comments, restored_comment, mode):
    """Rakendab taaste praegusele comments-massiivile.

    mode "version": olemasoleva kommentaari text üle (replies jäävad).
    mode "deleted": lisab terve kommentaari tagasi.
    Returns (new_comments, None) | (None, (status_code, detail)).
    """
    by_id = {c.get("id"): c for c in current_comments if isinstance(c, dict)}
    cid = restored_comment.get("id")
    if mode == "version":
        if cid not in by_id:
            return None, (404, "Kommentaari ei leitud praegusest seisust")
        new = [
            {**c, "text": restored_comment.get("text", "")} if c.get("id") == cid else c
            for c in current_comments
        ]
        return new, None
    if mode == "deleted":
        if cid in by_id:
            return None, (409, "Kommentaar selle id-ga on juba olemas")
        return list(current_comments) + [restored_comment], None
    return None, (400, "Tundmatu mode")
```

- [ ] **Step 4: Käivita testid — peavad läbima**

Run:
```bash
.venv/bin/python -m pytest tests/test_comment_history_ops.py -v
```
Expected: PASS (kõik). Kui `test_dedup_consecutive_identical` või `test_malformed_json_commit_does_not_crash` käitub ootamatult, kontrolli iteratsiooni järjekorda (`history` peab olema uusimast vanimani — `get_file_git_history` annab selle).

- [ ] **Step 5: Commit**

```bash
git add server/comment_history_ops.py tests/test_comment_history_ops.py
git commit -m "feat: comment_history_ops — kommentaaride git-versioonide arvutus

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `/page-comments/history` endpoint

**Files:**
- Modify: `server/routers/editing.py`
- Test: `tests/test_page_comments_endpoints.py`

**Interfaces:**
- Consumes: `build_comment_history` (Task 3), `BASE_DIR`, `require_role`, `get_json_data`, `run_in_threadpool`.
- Produces: `POST /page-comments/history` → `{ status, versions, deleted, truncated }`. Body: `{ original_path, file_name }`.

- [ ] **Step 1: Kirjuta langev test (basename + role)**

Create `tests/test_page_comments_endpoints.py`:

```python
"""Endpoint-testid: /page-comments/history ja /page-comments/restore."""


def test_history_rejects_non_basename_filename(client, login, backend_env):
    token = login("editor", "editorpass")
    r = client.post(
        "/page-comments/history",
        json={"original_path": "1690-w1", "file_name": "../escape.txt"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400, r.text


def test_history_requires_editor(client, login, backend_env):
    # Anonüümne (ilma tokenita) → 401
    r = client.post(
        "/page-comments/history",
        json={"original_path": "1690-w1", "file_name": "pg1.txt"},
    )
    assert r.status_code == 401
```

- [ ] **Step 2: Käivita — peab langema**

Run:
```bash
.venv/bin/python -m pytest tests/test_page_comments_endpoints.py -v
```
Expected: FAIL — 404 (endpoint puudub) `test_history_rejects...`-is.

- [ ] **Step 3: Lisa import + endpoint `editing.py`-sse**

Modify `server/routers/editing.py` — lisa importide juurde (olemasoleva `git_ops` impordi lähedusse):

```python
from ..comment_history_ops import (
    apply_comment_restore,
    build_comment_history,
    find_comment_in_content,
)
```

Lisa "GIT AJALUGU JA BULK" sektsiooni (nt pärast `/git-restore`):

```python
def _validate_page_paths(data):
    """Tuletab + valideerib catalog/filename/json-teed (ühine history+restore).

    Returns (catalog, filename, json_relpath, json_path, txt_path) või tõstab 400.
    """
    raw_file = data.get('file_name', '')
    if not raw_file or os.path.basename(raw_file) != raw_file:
        raise HTTPException(status_code=400, detail="Vigane failinimi")
    catalog = os.path.basename(data.get('original_path', ''))
    if not catalog:
        raise HTTPException(status_code=400, detail="Vigane tee")
    json_filename = os.path.splitext(raw_file)[0] + ".json"
    json_relpath = os.path.join(catalog, json_filename)
    json_path = os.path.join(BASE_DIR, catalog, json_filename)
    txt_path = os.path.join(BASE_DIR, catalog, raw_file)
    # Path traversal kaitse: tulemus peab jääma BASE_DIR-i
    base_real = os.path.realpath(BASE_DIR)
    if not os.path.realpath(json_path).startswith(base_real + os.sep):
        raise HTTPException(status_code=400, detail="Tee väljaspool lubatud kataloogi")
    return catalog, raw_file, json_relpath, json_path, txt_path


def _read_current_comments(json_path):
    """Loeb praeguse comments-massiivi kettalt (toetab meta_content wrapperit)."""
    if not os.path.exists(json_path):
        return []
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    source = data.get('meta_content', data) if isinstance(data, dict) else {}
    comments = source.get('comments', []) if isinstance(source, dict) else []
    return comments or []


@router.post("/page-comments/history")
async def page_comments_history(request: Request, user=Depends(require_role("editor"))):
    data = await get_json_data(request)
    _catalog, _filename, json_relpath, json_path, _txt = _validate_page_paths(data)
    current = _read_current_comments(json_path)
    result = await run_in_threadpool(build_comment_history, json_relpath, current)
    return {"status": "success", **result}
```

- [ ] **Step 4: Käivita testid — peavad läbima**

Run:
```bash
.venv/bin/python -m pytest tests/test_page_comments_endpoints.py -v
```
Expected: PASS (mõlemad). NB: `test_history_requires_editor` eeldab, et `require_role("editor")` ilma tokenita → 401 (vt olemasolevat mustrit `deps.get_user`).

- [ ] **Step 5: Commit**

```bash
git add server/routers/editing.py tests/test_page_comments_endpoints.py
git commit -m "feat: /page-comments/history endpoint + valideerimishelperid

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `/page-comments/restore` endpoint

**Files:**
- Modify: `server/routers/editing.py`
- Test: `tests/test_page_comments_endpoints.py` (laienda)

**Interfaces:**
- Consumes: `_validate_page_paths`, `_read_current_comments` (Task 4), `apply_comment_restore`, `find_comment_in_content`, `get_file_git_history`, `get_file_at_commit`, `save_with_git`, `sync_work_to_meilisearch_async`.
- Produces: `POST /page-comments/restore` → `{ status, comments }`. Body: `{ original_path, file_name, mode, comment_id, commit_hash }`.

- [ ] **Step 1: Kirjuta langevad testid (git-repo fixture + happy path + servajuhud)**

Laienda `tests/test_page_comments_endpoints.py` — lisa fixture, mis seab BASE_DIR + git-repo nii `git_ops` kui `editing`-routeri jaoks, ja kommentaariga lehe:

```python
import json
import os

import pytest
from git import Repo


@pytest.fixture
def page_repo(backend_env, tmp_path, monkeypatch):
    """Git-repo lehe pg1.json-iga: c1 muudeti, c2 kustutati."""
    import server.git_ops as git_ops
    import server.routers.editing as editing

    data_dir = tmp_path / "data"
    folder = data_dir / "1690-w1"
    folder.mkdir(parents=True)
    r = Repo.init(str(data_dir))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")

    txt = folder / "pg1.txt"
    jp = folder / "pg1.json"
    txt.write_text("lehe tekst", encoding="utf-8")

    def commit(comments, msg):
        jp.write_text(json.dumps({"comments": comments}, ensure_ascii=False, indent=2),
                      encoding="utf-8")
        r.index.add([os.path.relpath(str(txt), str(data_dir)),
                     os.path.relpath(str(jp), str(data_dir))])
        r.index.commit(msg)

    c1 = {"id": "c1", "text": "vana", "author": "u", "created_at": "2026-01-01T00:00:00", "replies": []}
    c2 = {"id": "c2", "text": "kustutatav", "author": "u", "created_at": "2026-01-01T00:00:00", "replies": []}
    commit([c1, c2], "v1")
    commit([{**c1, "text": "uus"}], "v2 (c2 kustutatud, c1 muudetud)")

    monkeypatch.setattr(git_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    monkeypatch.setattr(editing, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(editing, "sync_work_to_meilisearch_async", lambda *a, **k: None)

    # full hash v1 (vanim) — c2 ja c1 "vana" seis
    v1_hash = list(r.iter_commits())[-1].hexsha
    return {"repo": r, "folder": folder, "v1_hash": v1_hash, "jp": jp}


def test_restore_version_overwrites_text(client, login, page_repo):
    token = login("editor", "editorpass")
    r = client.post(
        "/page-comments/restore",
        json={"original_path": "1690-w1", "file_name": "pg1.txt",
              "mode": "version", "comment_id": "c1", "commit_hash": page_repo["v1_hash"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    comments = r.json()["comments"]
    assert next(c for c in comments if c["id"] == "c1")["text"] == "vana"
    # kettal ka uuendatud
    on_disk = json.loads(page_repo["jp"].read_text(encoding="utf-8"))["comments"]
    assert next(c for c in on_disk if c["id"] == "c1")["text"] == "vana"


def test_restore_deleted_appends(client, login, page_repo):
    token = login("editor", "editorpass")
    r = client.post(
        "/page-comments/restore",
        json={"original_path": "1690-w1", "file_name": "pg1.txt",
              "mode": "deleted", "comment_id": "c2", "commit_hash": page_repo["v1_hash"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    assert any(c["id"] == "c2" for c in r.json()["comments"])


def test_restore_rejects_commit_outside_history(client, login, page_repo):
    token = login("editor", "editorpass")
    r = client.post(
        "/page-comments/restore",
        json={"original_path": "1690-w1", "file_name": "pg1.txt",
              "mode": "version", "comment_id": "c1", "commit_hash": "0" * 40},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400, r.text


def test_restore_version_missing_comment_in_commit(client, login, page_repo):
    token = login("editor", "editorpass")
    # c2 puudub v2-st; aga küsime version c2 v2-hash'iga → leia v2 hash
    v2_hash = list(page_repo["repo"].iter_commits())[0].hexsha
    r = client.post(
        "/page-comments/restore",
        json={"original_path": "1690-w1", "file_name": "pg1.txt",
              "mode": "version", "comment_id": "c2", "commit_hash": v2_hash},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404, r.text


def test_restore_deleted_conflict_when_id_exists(client, login, page_repo):
    token = login("editor", "editorpass")
    # c1 on praegu olemas → deleted c1 → 409
    r = client.post(
        "/page-comments/restore",
        json={"original_path": "1690-w1", "file_name": "pg1.txt",
              "mode": "deleted", "comment_id": "c1", "commit_hash": page_repo["v1_hash"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 409, r.text
```

- [ ] **Step 2: Käivita — peavad langema**

Run:
```bash
.venv/bin/python -m pytest tests/test_page_comments_endpoints.py -v
```
Expected: FAIL — restore-endpoint puudub (404).

- [ ] **Step 3: Lisa `/page-comments/restore` endpoint**

Modify `server/routers/editing.py` — lisa pärast `/page-comments/history`:

```python
@router.post("/page-comments/restore")
async def page_comments_restore(
    request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("editor"))
):
    data = await get_json_data(request)
    mode = data.get('mode')
    comment_id = data.get('comment_id')
    commit_hash = data.get('commit_hash')
    if mode not in ("version", "deleted") or not comment_id or not commit_hash:
        raise HTTPException(status_code=400, detail="Vigased parameetrid")

    catalog, filename, json_relpath, json_path, txt_path = _validate_page_paths(data)

    # commit_hash peab kuuluma SELLE faili ajalukku (mitte suvaline git-objekt)
    history = get_file_git_history(json_relpath, max_count=500)
    valid = {h['full_hash'] for h in history} | {h['hash'] for h in history}
    if commit_hash not in valid:
        raise HTTPException(status_code=400, detail="Commit ei kuulu selle faili ajalukku")

    content = get_file_at_commit(json_relpath, commit_hash)
    if content is None:
        raise HTTPException(status_code=400, detail="Commitist ei leitud faili")
    restored = find_comment_in_content(content, comment_id)
    if restored is None:
        raise HTTPException(status_code=404, detail="Kommentaari ei leitud sellest commitist")

    if not os.path.exists(json_path):
        raise HTTPException(status_code=404, detail="Lehe metaandmeid ei leitud")
    with open(json_path, 'r', encoding='utf-8') as f:
        cur_data = json.load(f)
    source = cur_data['meta_content'] if (
        isinstance(cur_data, dict) and isinstance(cur_data.get('meta_content'), dict)
    ) else cur_data
    current = source.get('comments', []) or []

    new_comments, error = apply_comment_restore(current, restored, mode)
    if error is not None:
        raise HTTPException(status_code=error[0], detail=error[1])
    source['comments'] = new_comments

    # .txt jääb muutmata (taastame ainult kommentaari)
    with open(txt_path, 'r', encoding='utf-8') as f:
        txt = f.read()

    save_with_git(
        txt_path, txt, user['username'],
        message=f"Restore comment {comment_id}: {commit_hash[:8]}",
        additional_files=[(json_path, json.dumps(cur_data, indent=2, ensure_ascii=False))],
    )
    background_tasks.add_task(sync_work_to_meilisearch_async, catalog)
    return {"status": "success", "comments": new_comments}
```

- [ ] **Step 4: Käivita kõik backend-testid — peavad läbima**

Run:
```bash
.venv/bin/python -m pytest tests/test_page_comments_endpoints.py tests/test_comment_history_ops.py -v
```
Expected: PASS (kõik).

- [ ] **Step 5: Regressiooni-kontroll (kogu backend-svit)**

Run:
```bash
.venv/bin/python -m pytest -q
```
Expected: olemasolevad testid ei katke.

- [ ] **Step 6: Commit**

```bash
git add server/routers/editing.py tests/test_page_comments_endpoints.py
git commit -m "feat: /page-comments/restore endpoint (version + deleted)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Frontend — service + taaste-UI (`AnnotationsTab`)

**Files:**
- Create: `src/services/commentHistoryService.ts`
- Modify: `src/components/editor/AnnotationsTab.tsx`
- Modify: `src/locales/et/workspace.json`, `src/locales/en/workspace.json`

**Interfaces:**
- Consumes: `FILE_API_URL`, `getAuthHeaders`, `fetchWithTimeout` (kõik juba `AnnotationsTab`-is imporditud), `Annotation` tüüp, `MarkdownView`.
- Produces:
  - `fetchCommentHistory(page, authToken) -> Promise<CommentHistory>` kus `CommentHistory = { versions: Record<string, CommentVersion[]>; deleted: DeletedComment[]; truncated: boolean }`
  - `restoreComment(page, params, authToken) -> Promise<Annotation[]>` kus `params = { mode: 'version'|'deleted'; comment_id: string; commit_hash: string }`

- [ ] **Step 1: Loo service**

Create `src/services/commentHistoryService.ts`:

```typescript
import { Page, Annotation } from '../types';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';

export interface CommentVersion {
  commit_hash: string;
  timestamp: string;
  author: string;
  text: string;
}

export interface DeletedComment {
  id: string;
  text: string;
  author: string;
  created_at: string;
  replies: Annotation['replies'];
  last_seen_commit: string;
}

export interface CommentHistory {
  versions: Record<string, CommentVersion[]>;
  deleted: DeletedComment[];
  truncated: boolean;
}

function pageFileNames(page: Page): { original_path: string; file_name: string } {
  const imageFilename = page.image_url.split('/').pop() || '';
  const file_name = imageFilename.replace(/\.[^/.]+$/, '') + '.txt';
  return {
    original_path: page.original_path || page.originaal_kataloog || '',
    file_name,
  };
}

export async function fetchCommentHistory(
  page: Page,
  authToken?: string,
): Promise<CommentHistory> {
  const response = await fetchWithTimeout(`${FILE_API_URL}/page-comments/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
    body: JSON.stringify(pageFileNames(page)),
    timeout: 30000,
  });
  if (!response.ok) {
    const e = await response.json().catch(() => ({}));
    throw new Error(e.detail || `History failed: ${response.status}`);
  }
  const data = await response.json();
  return {
    versions: data.versions || {},
    deleted: data.deleted || [],
    truncated: !!data.truncated,
  };
}

export async function restoreComment(
  page: Page,
  params: { mode: 'version' | 'deleted'; comment_id: string; commit_hash: string },
  authToken?: string,
): Promise<Annotation[]> {
  const response = await fetchWithTimeout(`${FILE_API_URL}/page-comments/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
    body: JSON.stringify({ ...pageFileNames(page), ...params }),
    timeout: 30000,
  });
  if (!response.ok) {
    const e = await response.json().catch(() => ({}));
    throw new Error(e.detail || `Restore failed: ${response.status}`);
  }
  const data = await response.json();
  return data.comments || [];
}
```

- [ ] **Step 2: Lisa i18n võtmed (et)**

Modify `src/locales/et/workspace.json` — lisa `info` objekti sisse:

```json
"commentHistory": "Ajalugu",
"restoreText": "Taasta see tekst",
"restoreComment": "Taasta kommentaar",
"deletedComments": "Kustutatud kommentaarid",
"noDeletedComments": "Kustutatud kommentaare ei leitud",
"noOlderVersions": "Varasemaid versioone ei ole",
"historyTruncated": "Näidatakse viimase 100 commiti ajalugu.",
"restoreError": "Taastamine ebaõnnestus"
```

- [ ] **Step 3: Lisa i18n võtmed (en)**

Modify `src/locales/en/workspace.json` — lisa `info` objekti sisse:

```json
"commentHistory": "History",
"restoreText": "Restore this text",
"restoreComment": "Restore comment",
"deletedComments": "Deleted comments",
"noDeletedComments": "No deleted comments found",
"noOlderVersions": "No earlier versions",
"historyTruncated": "Showing history of the last 100 commits.",
"restoreError": "Restore failed"
```

- [ ] **Step 4: Lisa state + laadija `AnnotationsTab`-i**

Modify `src/components/editor/AnnotationsTab.tsx`. Lisa import (Task 2 lisas juba MarkdownView):

```tsx
import { History as HistoryIcon } from 'lucide-react';
import { fetchCommentHistory, restoreComment, CommentHistory } from '../../services/commentHistoryService';
```

Lisa state (teiste `useState`-de juurde, ~rida 75):

```tsx
const [commentHistory, setCommentHistory] = useState<CommentHistory | null>(null);
const [historyLoading, setHistoryLoading] = useState(false);
const [historyError, setHistoryError] = useState<string | null>(null);
const [openHistoryId, setOpenHistoryId] = useState<string | null>(null);
const [deletedCardOpen, setDeletedCardOpen] = useState(false);
const canRestore = isAtLeast(user?.role, 'editor');
```

Lisa laadija + taaste-funktsioonid (komponendi sees, teiste handlerite juurde). `_page` on prop (vt rida 45 alias):

```tsx
const ensureHistory = async () => {
  if (commentHistory || historyLoading) return;
  setHistoryLoading(true);
  setHistoryError(null);
  try {
    setCommentHistory(await fetchCommentHistory(_page, authToken || undefined));
  } catch (e) {
    setHistoryError(e instanceof Error ? e.message : String(e));
  } finally {
    setHistoryLoading(false);
  }
};

const doRestore = async (
  mode: 'version' | 'deleted', commentId: string, commitHash: string,
) => {
  try {
    const updated = await restoreComment(
      _page, { mode, comment_id: commentId, commit_hash: commitHash }, authToken || undefined,
    );
    setComments(updated);
    if (onSaveAnnotations) await onSaveAnnotations(updated);
    setCommentHistory(null);        // sunni värske laadimine järgmisel avamisel
    setOpenHistoryId(null);
  } catch (e) {
    setHistoryError(e instanceof Error ? e.message : t('info.restoreError'));
  }
};
```

- [ ] **Step 5: Lisa inline "Ajalugu" nupp + versioonide panel**

Modify `AnnotationsTab.tsx` — kommentaari toimingute reas (`!readOnly && <div className="absolute top-2 right-2 ...">`, ~rida 934) lisa Reply/Edit/Delete nuppude kõrvale (ainult `canRestore`):

```tsx
{canRestore && (
  <button
    onClick={async () => {
      await ensureHistory();
      setOpenHistoryId(openHistoryId === comment.id ? null : comment.id);
    }}
    className="text-gray-400 hover:text-primary-600 transition-colors"
    title={t('info.commentHistory')}
  >
    <HistoryIcon size={14} />
  </button>
)}
```

Lisa kommentaari kasti lõppu (pärast replies/reply-plokki, enne kommentaari `</div>` sulgemist) versioonide panel:

```tsx
{openHistoryId === comment.id && (
  <div className="mt-3 border-t border-gray-200 pt-2 space-y-2">
    {historyLoading && <p className="text-xs text-gray-400">…</p>}
    {historyError && <p className="text-xs text-red-600">{historyError}</p>}
    {!historyLoading && (commentHistory?.versions[comment.id]?.length ? (
      commentHistory.versions[comment.id].map(v => (
        <div key={v.commit_hash} className="bg-white border border-gray-100 rounded px-2 py-1.5">
          <div className="vutt-md-comment text-sm text-gray-700">
            <MarkdownView content={v.text} softBreaks />
          </div>
          <div className="flex justify-between items-center text-xs text-gray-400 mt-1">
            <span>{v.author} · {new Date(v.timestamp).toLocaleString('et-EE')}</span>
            <button
              onClick={() => doRestore('version', comment.id, v.commit_hash)}
              className="text-primary-600 hover:text-primary-800 font-medium"
            >
              {t('info.restoreText')}
            </button>
          </div>
        </div>
      ))
    ) : (
      <p className="text-xs text-gray-400 italic">{t('info.noOlderVersions')}</p>
    ))}
  </div>
)}
```

- [ ] **Step 6: Lisa "Kustutatud kommentaarid" kaart**

Modify `AnnotationsTab.tsx` — kommentaaride kasti (`{/* Comments */}` plokk) lõppu, pärast kommentaaride loendi konteinerit, lisa (ainult `canRestore`):

```tsx
{canRestore && (
  <div className="mt-3 border-t border-gray-100 pt-3">
    <button
      onClick={async () => {
        await ensureHistory();
        setDeletedCardOpen(o => !o);
      }}
      className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
    >
      <Trash2 size={13} />
      {t('info.deletedComments')}
      {commentHistory && ` (${commentHistory.deleted.length})`}
    </button>
    {deletedCardOpen && (
      <div className="mt-2 space-y-2">
        {historyLoading && <p className="text-xs text-gray-400">…</p>}
        {historyError && <p className="text-xs text-red-600">{historyError}</p>}
        {!historyLoading && commentHistory && (
          commentHistory.deleted.length === 0 ? (
            <p className="text-xs text-gray-400 italic">{t('info.noDeletedComments')}</p>
          ) : (
            <>
              {commentHistory.deleted.map(d => (
                <div key={d.id} className="bg-gray-50 border border-gray-100 rounded px-2 py-1.5">
                  <div className="vutt-md-comment text-sm text-gray-700">
                    <MarkdownView content={d.text} softBreaks />
                  </div>
                  <div className="flex justify-between items-center text-xs text-gray-400 mt-1">
                    <span>{d.author} · {new Date(d.created_at).toLocaleString('et-EE')}</span>
                    <button
                      onClick={() => doRestore('deleted', d.id, d.last_seen_commit)}
                      className="text-primary-600 hover:text-primary-800 font-medium"
                    >
                      {t('info.restoreComment')}
                    </button>
                  </div>
                </div>
              ))}
              {commentHistory.truncated && (
                <p className="text-xs text-gray-400 italic">{t('info.historyTruncated')}</p>
              )}
            </>
          )
        )}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 7: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: 0 viga. (Kui `_page.original_path`/`originaal_kataloog` tüübiviga — kontrolli `Page` tüüpi `src/types.ts`-is; service kasutab `page.original_path || page.originaal_kataloog`.)

- [ ] **Step 8: Build + manuaalne smoke**

Run:
```bash
npm run build
```
Expected: õnnestub. Dev-serveris (`npm run dev`) editorina: kella-ikoon avab muudetud kommentaari varasemad versioonid + "Taasta see tekst" toob teksti tagasi; "Kustutatud kommentaarid" kaart laeb esimesel avamisel, näitab kustutatud kommentaari + "Taasta kommentaar"; tühja korral "Kustutatud kommentaare ei leitud".

- [ ] **Step 9: Commit**

```bash
git add src/services/commentHistoryService.ts src/components/editor/AnnotationsTab.tsx \
  src/locales/et/workspace.json src/locales/en/workspace.json
git commit -m "feat: kommentaaride versiooniajaloo taaste-UI (AnnotationsTab)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Markdown comment + reply → Task 1 (softBreaks) + Task 2 (sisestus/kuva). ✅
- `text_annotations` puutumata → Task 2 ei muuda neid. ✅
- Reavahetuste säilitus (risk 1) → Task 1 `softBreaks` + Task 2 kasutus. ✅
- Pikad URL-id (risk 2) → Task 2 `.vutt-md-comment` CSS. ✅
- `/page-comments/history` (versions ainult ajaloolised+erinevad, deleted viimane seis, truncated) → Task 3 (loogika) + Task 4 (endpoint). ✅
- `/page-comments/restore` (version/deleted, replies säilib, 404/409) → Task 3 + Task 5. ✅
- Turvalisus (basename, traversal, commit ajaloos) → Task 4 `_validate_page_paths` + Task 5 commit-kontroll. ✅
- Catalog jagatud helperist → Task 4/5 `_validate_page_paths`. ✅
- UI: inline kella + "Kustutatud kommentaarid" kaart, laisk laadimine, nuppude sõnastus, truncated-tekst → Task 6. ✅
- Õigus editor+ → endpointid `require_role("editor")`, UI `canRestore`. ✅
- Testid (dedup, mitu muudatust+kustutus, vahepealne puudumine, vigane JSON, 404/409, commit väljaspool ajalugu, basename) → Task 3 + Task 5 testid. ✅

**Placeholder scan:** kõik sammud sisaldavad tegelikku koodi/käske. ✅

**Type consistency:** `CommentHistory`/`CommentVersion`/`DeletedComment` (service) ühtivad endpointi väljundiga (`versions`, `deleted`, `truncated`); `restoreComment` params (`mode`, `comment_id`, `commit_hash`) ühtivad endpointi sisendiga; `_validate_page_paths` tagastus (5 väärtust) ühtib mõlema endpoint-kutsega. ✅

**Märkus reaalsuse kohta:** real-numbrid (`AnnotationsTab.tsx:849`, `:879`, `:888`, `:934`) on snapshot — kontrolli konteksti enne asendamist (otsi tsiteeritud `className`-stringe).
