# Prerender Full-Text SEO + AI-Bot Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose each work's full cleaned transcription in the bot-facing prerender so search engines index the corpus by its actual words, add a sitemap freshness signal for edits, and set an AI-bot robots.txt policy + traffic-monitoring plan.

**Architecture:** A new neutral module `server/text_reading.py` reads page text (reusing the indexer's enumeration, extracted from `meili_doc.py`) and computes a max-mtime key. `build_meta_html` injects per-page cleaned text (main + marginalia) with a size guardrail; `build_sitemap_xml` uses the max-mtime for `lastmod`; the `/meta/work/{id}` endpoint caches HTML keyed on that mtime. `public/robots.txt` gains AI-training-bot blocks. Part D is host-config + docs (nginx image logging, logrotate, GoAccess).

**Tech Stack:** Python 3.9 (FastAPI backend, in Docker), pytest, nginx (host), robots.txt.

## Global Constraints

- **Python 3.9 compatibility:** use `Optional[X]` / `Tuple[...]` from `typing`, never `X | None`.
- **Code comments in Estonian** (project convention); UI strings Estonian + English.
- **Run tests with** `.venv/bin/python -m pytest <path> -v` from repo root.
- **`metadata_handler.py` must NOT import `meilisearch_ops.py`** (heavy: ThreadPoolExecutor, git_ops). It may import `meili_doc.py` and `text_reading.py` — both pure (stdlib + `server.utils` + `server.marginalia_normalize`).
- **Do NOT rename Meilisearch field names** (legacy `y`-orthography); this plan does not touch the index schema.
- **Reuse existing helpers**, do not duplicate: `clean_text_for_search`, `split_marginalia`, `_clean_search_text` (`server/meili_doc.py`); `_escape`, `SITE_URL`, `find_directory_by_id`, `_sitemap_lastmod` (`server/metadata_handler.py`).
- **Escape all injected text** with the existing `_escape`.

---

## File Structure

- **Create** `server/text_reading.py` — page-text reader + max-mtime helper; re-exports cleaners. Neutral import surface for `metadata_handler.py`.
- **Modify** `server/meili_doc.py` — extract inline page-image enumeration into `enumerate_page_images(doc_path)`; `build_document` calls it (behaviour unchanged, guarded by snapshot tests).
- **Modify** `server/metadata_handler.py` — `build_meta_html`: inject per-page text + size guardrail; add `cached_work_meta_html`; `build_sitemap_xml`: `lastmod` from max-mtime; add module `logger`.
- **Modify** `server/cache_invalidation.py` — add `_work_meta_cache` + clear it in `invalidate_all_caches`.
- **Modify** `server/routers/public.py` — `/meta/work/{id}` uses `cached_work_meta_html` on the public branch.
- **Modify** `public/robots.txt` — AI-training-bot blocks; keep search/referral bots allowed.
- **Create** `docs/monitoring-bot-traffic.md` — Part D host-config (image logging, logrotate, GoAccess, privacy, review cadence).
- **Tests:** create `tests/test_text_reading.py`, `tests/test_robots_txt.py`; extend `tests/test_metadata_handler.py`.

---

### Task 1: Extract `enumerate_page_images` in meili_doc.py

Extract the inline page-image enumeration (currently inside `build_document`, `server/meili_doc.py:567-582`) into a reusable module-level function, so the prerender reader and the indexer share one ordering and cannot drift.

**Files:**
- Modify: `server/meili_doc.py` (add function near other text helpers; replace lines 567-582 usage)
- Test: `tests/test_text_reading.py` (new — also used by Task 2)

**Interfaces:**
- Produces: `enumerate_page_images(doc_path: str) -> list[str]` — image filenames ordered by `(sequence, filename)`, excluding `_thumb_*`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_text_reading.py`:

```python
# tests/test_text_reading.py
import json
import os


def _make_work(tmp_path):
    d = tmp_path / "w"
    d.mkdir()
    return d


def test_enumerate_orders_by_sequence(tmp_path):
    from server.meili_doc import enumerate_page_images
    d = _make_work(tmp_path)
    # Kaks pilti, sequence tagurpidi failinime suhtes
    (d / "b.jpg").write_bytes(b"x")
    (d / "b.json").write_text(json.dumps({"sequence": 1}), encoding="utf-8")
    (d / "a.jpg").write_bytes(b"x")
    (d / "a.json").write_text(json.dumps({"sequence": 2}), encoding="utf-8")
    (d / "_thumb_a.jpg").write_bytes(b"x")  # peab välja jääma
    result = enumerate_page_images(str(d))
    assert result == ["b.jpg", "a.jpg"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_text_reading.py::test_enumerate_orders_by_sequence -v`
Expected: FAIL with `ImportError: cannot import name 'enumerate_page_images'`.

- [ ] **Step 3: Add the function to `server/meili_doc.py`**

Add near the other pure helpers (e.g. after `_clean_search_text`):

```python
def enumerate_page_images(doc_path):
    """Loeb teose pildifailid järjekorras (sequence, siis failinimi).

    Jätab välja `_thumb_` failid. ÜHINE loogika indekseerijale (build_document)
    ja bot-prerenderi teksti-lugejale (text_reading.read_work_page_texts) —
    nii ei saa lehe-järjekord kahe tee vahel lahku minna.
    """
    def _seq(img_name):
        jp = os.path.join(doc_path, os.path.splitext(img_name)[0] + '.json')
        if os.path.exists(jp):
            try:
                with open(jp, 'r', encoding='utf-8') as fj:
                    d = json.load(fj)
                    s = d.get('sequence') or d.get('meta_content', {}).get('sequence')
                    if s is not None:
                        return int(s)
            except Exception:
                pass
        return float('inf')

    all_imgs = [f for f in os.listdir(doc_path)
                if f.lower().endswith(('.jpg', '.jpeg', '.png')) and not f.startswith('_thumb_')]
    return sorted(all_imgs, key=lambda f: (_seq(f), f))
```

Then replace the inline block in `build_document` (lines 567-582, the local `def _seq`, `all_imgs`, `jpg_files = sorted(...)`) with:

```python
    jpg_files = enumerate_page_images(doc_path)
    if not jpg_files:
        return teose_id, []
```

- [ ] **Step 4: Run tests to verify they pass (incl. indexer snapshot guards)**

Run: `.venv/bin/python -m pytest tests/test_text_reading.py tests/test_meilisearch_sync_snapshot.py tests/test_meili_seed_live_parity.py -v`
Expected: PASS (snapshot/parity tests confirm the indexer behaviour is unchanged).

- [ ] **Step 5: Commit**

```bash
git add server/meili_doc.py tests/test_text_reading.py
git commit -m "refactor: extract enumerate_page_images for shared page ordering"
```

---

### Task 2: `text_reading.py` — page reader + mtime helper

**Files:**
- Create: `server/text_reading.py`
- Test: `tests/test_text_reading.py` (extend)

**Interfaces:**
- Consumes: `enumerate_page_images` (Task 1), `clean_text_for_search`, `_clean_search_text` (`meili_doc.py`).
- Produces:
  - `read_work_page_texts(work_path: str) -> list` of `(page_num: int, raw_text: str)`, in page order; `.txt` authoritative, page `.json` `text_content` fallback.
  - `work_latest_mtime(work_path: str) -> float` — max mtime over `_metadata.json` + page `.txt`/`.json` files (0.0 if none).
  - Re-exports `clean_text_for_search`, `_clean_search_text` for a neutral import surface.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_text_reading.py`:

```python
def test_read_work_page_texts_txt_authoritative(tmp_path):
    from server.text_reading import read_work_page_texts
    d = _make_work(tmp_path)
    (d / "a.jpg").write_bytes(b"x")
    (d / "a.json").write_text(json.dumps({"sequence": 1, "text_content": "JSON"}), encoding="utf-8")
    (d / "a.txt").write_text("TXT tekst", encoding="utf-8")
    (d / "b.jpg").write_bytes(b"x")
    (d / "b.json").write_text(json.dumps({"sequence": 2, "text_content": "ainult JSON"}), encoding="utf-8")
    pages = read_work_page_texts(str(d))
    assert pages == [(1, "TXT tekst"), (2, "ainult JSON")]


def test_work_latest_mtime_tracks_page_edit(tmp_path):
    from server.text_reading import work_latest_mtime
    d = _make_work(tmp_path)
    (d / "_metadata.json").write_text("{}", encoding="utf-8")
    (d / "a.jpg").write_bytes(b"x")
    txt = d / "a.txt"
    txt.write_text("v1", encoding="utf-8")
    k1 = work_latest_mtime(str(d))
    os.utime(str(txt), (k1 + 10, k1 + 10))  # simuleeri hilisemat muudatust
    k2 = work_latest_mtime(str(d))
    assert k2 > k1
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_text_reading.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'server.text_reading'`.

- [ ] **Step 3: Create `server/text_reading.py`**

```python
"""Neutraalne teksti-lugemise moodul bot-prerenderi ja sitemapi jaoks.

Sõltub AINULT stdlibist + server.meili_doc puhtast osast (enumerate_page_images,
clean_text_for_search, _clean_search_text). metadata_handler impordib SIIT, MITTE
meilisearch_ops-ist (raske: ThreadPoolExecutor, git_ops).
"""
import os
import json

from .meili_doc import (
    enumerate_page_images,
    clean_text_for_search,   # re-export
    _clean_search_text,      # re-export
)

__all__ = [
    "read_work_page_texts",
    "work_latest_mtime",
    "clean_text_for_search",
    "_clean_search_text",
]


def read_work_page_texts(work_path):
    """Loeb teose lehtede toore teksti järjekorras.

    Tagastab [(page_num, raw_text)]. `.txt` on autoriteet, lehe `.json`
    `text_content` on fallback (sama reegel nagu indekseerijal, meili_doc.py:646-678).
    """
    pages = []
    for idx, img_name in enumerate(enumerate_page_images(work_path)):
        page_num = idx + 1
        base = os.path.splitext(img_name)[0]
        raw = ""
        txt_path = os.path.join(work_path, base + '.txt')
        if os.path.exists(txt_path):
            try:
                with open(txt_path, 'r', encoding='utf-8') as f:
                    raw = f.read()
            except Exception:
                pass
        if not raw:
            jp = os.path.join(work_path, base + '.json')
            if os.path.exists(jp):
                try:
                    with open(jp, 'r', encoding='utf-8') as jf:
                        d = json.load(jf)
                        raw = d.get('text_content', '') or ''
                except Exception:
                    pass
        pages.append((page_num, raw))
    return pages


def work_latest_mtime(work_path):
    """max mtime üle `_metadata.json` + lehtede `.txt`/`.json` failide.

    Kasutatakse NII sitemap `lastmod` (Part B) KUI bot-HTML cache-võtme (Part A)
    jaoks — nii et teksti- VÕI bibliograafiamuudatus värskendab mõlemat.
    """
    latest = 0.0
    meta = os.path.join(work_path, '_metadata.json')
    if os.path.exists(meta):
        try:
            latest = os.path.getmtime(meta)
        except OSError:
            pass
    try:
        for name in os.listdir(work_path):
            if name.startswith('_'):
                continue
            if name.endswith('.txt') or name.endswith('.json'):
                try:
                    latest = max(latest, os.path.getmtime(os.path.join(work_path, name)))
                except OSError:
                    pass
    except OSError:
        pass
    return latest
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_text_reading.py -v`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add server/text_reading.py tests/test_text_reading.py
git commit -m "feat: text_reading module (page reader + max-mtime helper)"
```

---

### Task 3: Inject per-page text into `build_meta_html`

**Files:**
- Modify: `server/metadata_handler.py` (`build_meta_html`; add `logger`)
- Test: `tests/test_metadata_handler.py` (extend)

**Interfaces:**
- Consumes: `read_work_page_texts`, `_clean_search_text` (Task 2); `_escape`, `work_url` (existing).
- Produces: `build_meta_html` body now contains `<section data-page="N">` blocks with cleaned main text and (when present) a marginalia `<p class="marginalia">`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_metadata_handler.py` a helper that also writes page files, and tests. Put near the top (after `_write_meta`):

```python
def _write_page(work_dir_path, base, seq, txt):
    """Lisab teosele lehe: {base}.jpg + {base}.json (sequence) + {base}.txt."""
    import json as _json
    from pathlib import Path
    p = Path(work_dir_path)
    (p / f"{base}.jpg").write_bytes(b"x")
    (p / f"{base}.json").write_text(_json.dumps({"sequence": seq}), encoding="utf-8")
    (p / f"{base}.txt").write_text(txt, encoding="utf-8")
```

```python
def test_body_includes_page_text(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    path = _write_meta(tmp_path, FULL_META)
    registry["work001"] = path
    _write_page(path, "p1", 1, "Suecorum gloria in aeternum")
    _write_page(path, "p2", 2, "Pars altera <m>nota marginalis</m> textus")
    html = build_meta_html("work001")
    assert 'data-page="1"' in html
    assert "Suecorum gloria in aeternum" in html
    assert 'data-page="2"' in html
    # Marginaalia eraldi lõiguna
    assert 'class="marginalia"' in html
    assert "nota marginalis" in html
    # Põhitekstist on marginaalia välja lõigatud
    assert "Pars altera textus" in html
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_metadata_handler.py::test_body_includes_page_text -v`
Expected: FAIL (no `data-page` in output).

- [ ] **Step 3: Add a module logger (if absent) and the text block**

At the top of `server/metadata_handler.py`, ensure a logger exists (add if not present):

```python
import logging
logger = logging.getLogger(__name__)
```

Add the import near the other imports:

```python
from .text_reading import read_work_page_texts, _clean_search_text, work_latest_mtime
```

In `build_meta_html`, after the bibliographic `body_lines` are built and **before** the permalink line (`body_lines.append(f'<p><a href="{work_url}">...')`), insert:

```python
    # Täistekst botidele (sama avalik transkriptsioon, mida kasutaja SPA-s näeb —
    # EI ole SEO-only peidetud teksti → ei ole cloaking). Lehekülgede kaupa.
    if found_path:
        _append_work_text(body_lines, found_path, work_url, work_id)
```

Add the helper function (module level, above `build_meta_html`):

```python
# Googlebot indekseerib esimesed ~2MB HTML-i (Search Central, veebr 2026).
# Hoiame teksti alla selle; sum ületamisel lõikame ja lisame "täistekst rakenduses".
PRERENDER_TEXT_MAX_BYTES = 1_600_000
PRERENDER_TEXT_WARN_BYTES = 1_500_000


def _append_work_text(body_lines, found_path, work_url, work_id):
    """Lisab lehekülgede kaupa puhastatud põhiteksti + marginaalia body_lines-i.

    Suuruse-kaitse: lõpetab lehtede lisamise, kui HTML ületaks piiri (Task 4 katab).
    """
    parts = []
    total = 0
    truncated = False
    for page_num, raw in read_work_page_texts(found_path):
        main_clean, marg_clean = _clean_search_text(raw)
        if not main_clean and not marg_clean:
            continue
        seg = f'<section data-page="{page_num}">'
        if main_clean:
            seg += f'<p>{_escape(main_clean)}</p>'
        if marg_clean:
            seg += f'<p class="marginalia"><em>Ääremärkused:</em> {_escape(marg_clean)}</p>'
        seg += '</section>'
        seg_bytes = len(seg.encode('utf-8'))
        if total + seg_bytes > PRERENDER_TEXT_MAX_BYTES:
            truncated = True
            break
        parts.append(seg)
        total += seg_bytes
    if parts:
        body_lines.append('<div class="work-text">')
        body_lines.extend(parts)
        if truncated:
            body_lines.append(f'<p><a href="{work_url}">Täistekst rakenduses</a></p>')
        body_lines.append('</div>')
    if total >= PRERENDER_TEXT_WARN_BYTES:
        logger.warning(
            "Prerender HTML suur: work_id=%s text_bytes=%s truncated=%s",
            work_id, total, truncated,
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_metadata_handler.py -v`
Expected: PASS (new test + all existing metadata_handler tests).

- [ ] **Step 5: Commit**

```bash
git add server/metadata_handler.py tests/test_metadata_handler.py
git commit -m "feat: inject per-page transcription text into work prerender"
```

---

### Task 4: Size guardrail — truncate oversized works

Verify the truncation path added in Task 3 behaves: oversized works are capped and get a visible "full text in app" note; the head tags (canonical/OG) stay intact.

**Files:**
- Modify: `server/metadata_handler.py` (only if a fix is needed — logic added in Task 3)
- Test: `tests/test_metadata_handler.py` (extend)

**Interfaces:**
- Consumes: `PRERENDER_TEXT_MAX_BYTES`, `_append_work_text` (Task 3).

- [ ] **Step 1: Write the failing test**

Add to `tests/test_metadata_handler.py`:

```python
def test_oversized_work_truncated_with_note(patch_find, monkeypatch):
    import server.metadata_handler as mh
    registry, tmp_path = patch_find
    path = _write_meta(tmp_path, FULL_META)
    registry["work001"] = path
    # Väike piir, et test ei vaja megabaite
    monkeypatch.setattr(mh, "PRERENDER_TEXT_MAX_BYTES", 200)
    _write_page(path, "p1", 1, "A" * 300)
    _write_page(path, "p2", 2, "B" * 300)
    html = mh.build_meta_html("work001")
    assert "Täistekst rakenduses" in html          # kärbe-märge olemas
    assert "BBB" not in html                        # teine leht jäi välja
    assert 'rel="canonical"' in html                # head-tagid alles (2MB sees)
```

- [ ] **Step 2: Run to verify it passes or fails**

Run: `.venv/bin/python -m pytest tests/test_metadata_handler.py::test_oversized_work_truncated_with_note -v`
Expected: PASS if Task 3 logic is correct. If FAIL, fix `_append_work_text` truncation logic until green (the truncation branch must `break` before appending the oversized segment and set `truncated = True`).

- [ ] **Step 3: (Only if needed) fix `_append_work_text`**

No change expected; if the test failed, correct the byte-accounting so the first over-limit segment is excluded and the note is appended.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_metadata_handler.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/test_metadata_handler.py server/metadata_handler.py
git commit -m "test: verify oversized-work prerender truncation guardrail"
```

---

### Task 5: Sitemap `lastmod` reflects text edits

**Files:**
- Modify: `server/metadata_handler.py` (`build_sitemap_xml`)
- Test: `tests/test_metadata_handler.py` (extend)

**Interfaces:**
- Consumes: `work_latest_mtime` (Task 2), `_sitemap_lastmod` (existing).

- [ ] **Step 1: Write the failing test**

Add to `tests/test_metadata_handler.py`:

```python
def test_sitemap_lastmod_uses_page_mtime(tmp_path):
    import os, json as _json, datetime
    from server.metadata_handler import build_sitemap_xml
    # Loo päris kaust, kus lehe .txt on UUEM kui _metadata.json mtime
    d = tmp_path / "slug"
    d.mkdir()
    (d / "_metadata.json").write_text(_json.dumps({"id": "w1", "collections": []}), encoding="utf-8")
    txt = d / "a.txt"
    txt.write_text("tekst", encoding="utf-8")
    new_ts = 1_800_000_000.0  # kaugel tulevikus, kindlasti > _metadata mtime
    os.utime(str(txt), (new_ts, new_ts))

    cache = {"w1": (str(d), os.path.getmtime(str(d / "_metadata.json")))}
    xml = build_sitemap_xml(cache, lambda m: True, lambda wid: {"id": "w1", "collections": []})
    expected = datetime.datetime.fromtimestamp(new_ts, datetime.timezone.utc).strftime("%Y-%m-%d")
    assert expected in xml
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_metadata_handler.py::test_sitemap_lastmod_uses_page_mtime -v`
Expected: FAIL (lastmod still from `_metadata.json` mtime, not the future page mtime).

- [ ] **Step 3: Update `build_sitemap_xml`**

Import at top of `metadata_handler.py` is already added (Task 3: `work_latest_mtime`). In `build_sitemap_xml`, replace:

```python
        lastmod = _sitemap_lastmod(mtime)
```

with:

```python
        # lastmod = max(_metadata.json, lehtede .txt/.json) → tekstimuudatus värskendab
        latest = work_latest_mtime(path) or mtime
        lastmod = _sitemap_lastmod(latest)
```

(`path` is already in scope in that loop.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_metadata_handler.py -v`
Expected: PASS (new test + existing sitemap tests, which pass real `_metadata.json`-less tuple paths — note those use `/data/...` strings that don't exist on disk, so `work_latest_mtime` returns 0.0 and falls back to `mtime`, keeping them green).

- [ ] **Step 5: Commit**

```bash
git add server/metadata_handler.py tests/test_metadata_handler.py
git commit -m "feat: sitemap lastmod reflects page-text edits"
```

---

### Task 6: Cache work prerender HTML keyed on max-mtime

**Files:**
- Modify: `server/cache_invalidation.py` (add `_work_meta_cache`)
- Modify: `server/metadata_handler.py` (add `cached_work_meta_html`)
- Modify: `server/routers/public.py` (`work_meta` uses it on the public branch)
- Test: `tests/test_metadata_handler.py` (extend)

**Interfaces:**
- Produces: `cached_work_meta_html(work_id: str, work_path: str, build_fn) -> str` — returns cached HTML when `work_latest_mtime(work_path)` is unchanged, else calls `build_fn()` and caches.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_metadata_handler.py`:

```python
def test_cached_work_meta_html_rebuilds_on_mtime_change(tmp_path):
    import os
    from server.metadata_handler import cached_work_meta_html
    from server.cache_invalidation import _work_meta_cache
    _work_meta_cache.clear()
    d = tmp_path / "slug"
    d.mkdir()
    (d / "_metadata.json").write_text("{}", encoding="utf-8")
    txt = d / "a.txt"
    txt.write_text("v1", encoding="utf-8")

    calls = {"n": 0}
    def build():
        calls["n"] += 1
        return f"<html>{calls['n']}</html>"

    h1 = cached_work_meta_html("w1", str(d), build)
    h2 = cached_work_meta_html("w1", str(d), build)  # cache hit
    assert h1 == h2
    assert calls["n"] == 1

    os.utime(str(txt), (2_000_000_000.0, 2_000_000_000.0))  # muudatus
    h3 = cached_work_meta_html("w1", str(d), build)         # rebuild
    assert calls["n"] == 2
    assert h3 != h1
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_metadata_handler.py::test_cached_work_meta_html_rebuilds_on_mtime_change -v`
Expected: FAIL (`_work_meta_cache` / `cached_work_meta_html` do not exist).

- [ ] **Step 3: Add cache dict + helper**

In `server/cache_invalidation.py`, add the dict and clear it:

```python
_sitemap_cache: dict = {"xml": None, "expires": 0.0}
_home_cache: dict = {"html": None, "expires": 0.0}
_work_meta_cache: dict = {}   # work_id -> (mtime_key: float, html: str)
```

In `invalidate_all_caches`, add:

```python
    _work_meta_cache.clear()
```

In `server/metadata_handler.py`, add:

```python
def cached_work_meta_html(work_id, work_path, build_fn):
    """Tagastab bot-HTML-i cache'ist, kui teose max-mtime pole muutunud;
    muidu kutsub build_fn() ja cache'ib. Võti = work_latest_mtime (Task 2):
    max(_metadata.json, lehtede .txt/.json) → nii tekst- kui bibliograafiamuudatus
    värskendab. Vt [[project_seo_bot_prerender]]."""
    from .cache_invalidation import _work_meta_cache
    key = work_latest_mtime(work_path)
    cached = _work_meta_cache.get(work_id)
    if cached is not None and cached[0] == key:
        return cached[1]
    html = build_fn()
    _work_meta_cache[work_id] = (key, html)
    return html
```

- [ ] **Step 4: Wire into the endpoint**

In `server/routers/public.py`, add imports near the top:

```python
from ..metadata_handler import find_directory_by_id, cached_work_meta_html
```

In `work_meta` (currently `server/routers/public.py:270-283`), replace the final build lines:

```python
    # Loojate isikukaardid ristviidete jaoks (linkgraaf teos↔isik)
    creator_persons = get_persons_for_work(work_id)
    return HTMLResponse(content=build_meta_html(work_id, creator_persons=creator_persons))
```

with:

```python
    found_path = find_directory_by_id(work_id)
    if found_path and meta is not None:
        # Avalik/lubatud teos → cache mtime-võtmega
        html = cached_work_meta_html(
            work_id,
            found_path,
            lambda: build_meta_html(work_id, creator_persons=get_persons_for_work(work_id)),
        )
        return HTMLResponse(content=html)
    # Tundmatu teos → fallback HTML (odav, ei cache'i)
    return HTMLResponse(content=build_meta_html(work_id, creator_persons=get_persons_for_work(work_id)))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_metadata_handler.py tests/test_bot_link_graph.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/cache_invalidation.py server/metadata_handler.py server/routers/public.py tests/test_metadata_handler.py
git commit -m "feat: cache work prerender HTML keyed on max page/metadata mtime"
```

---

### Task 7: robots.txt AI-bot policy

**Files:**
- Modify: `public/robots.txt`
- Test: `tests/test_robots_txt.py` (new)

**Interfaces:** none (static file + content assertions).

- [ ] **Step 1: Write the failing test**

Create `tests/test_robots_txt.py`:

```python
# tests/test_robots_txt.py
import os

ROBOTS = os.path.join(os.path.dirname(__file__), "..", "public", "robots.txt")


def _read():
    with open(ROBOTS, encoding="utf-8") as f:
        return f.read()


def test_blocks_training_bots():
    txt = _read()
    for ua in ["GPTBot", "Google-Extended", "CCBot", "ClaudeBot", "anthropic-ai", "Bytespider"]:
        assert f"User-agent: {ua}" in txt, ua


def test_does_not_block_search_referral_bots():
    txt = _read()
    # Need EI TOHI olla eraldi Disallow-grupis
    for ua in ["OAI-SearchBot", "PerplexityBot", "Perplexity-User", "FirecrawlAgent"]:
        assert f"User-agent: {ua}" not in txt, ua


def test_keeps_sitemap_and_wildcard_group():
    txt = _read()
    assert "Sitemap: https://vutt.utlib.ut.ee/sitemap.xml" in txt
    assert "User-agent: *" in txt
    # Googlebot/Bingbot ei tohi olla üheski Disallow: / grupis
    assert "\nUser-agent: Googlebot\nDisallow: /" not in txt
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_robots_txt.py -v`
Expected: FAIL (`test_blocks_training_bots` — no GPTBot group yet).

- [ ] **Step 3: Edit `public/robots.txt`**

Insert the AI-training block **before** the `Sitemap:` line, keeping the existing `User-agent: *` group intact. Comments on their own lines:

```
# --- AI training / ingestion opt-out (review quarterly) ---

# OpenAI model-training crawler
User-agent: GPTBot
Disallow: /

# Google product token for Gemini training/grounding opt-out.
# Does not affect Google Search crawling or ranking.
User-agent: Google-Extended
Disallow: /

# Common Crawl
User-agent: CCBot
Disallow: /

# Anthropic
User-agent: ClaudeBot
Disallow: /
User-agent: anthropic-ai
Disallow: /

# ByteDance
User-agent: Bytespider
Disallow: /

# AI search / referral / agent-fetch bots are intentionally NOT blocked (allowed):
# OAI-SearchBot, PerplexityBot, Perplexity-User, FirecrawlAgent.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_robots_txt.py -v`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add public/robots.txt tests/test_robots_txt.py
git commit -m "feat: robots.txt blocks AI training bots, allows search/referral"
```

---

### Task 8: Part D — monitoring docs + host-config snippets

Host config (nginx, logrotate, GoAccess) lives on the server, not in git. This task produces a documented, repeatable setup and the exact server commands. No unit tests; verification is manual on the server.

**Files:**
- Create: `docs/monitoring-bot-traffic.md`

- [ ] **Step 1: Write `docs/monitoring-bot-traffic.md`**

```markdown
# Bot/scraper liikluse jälgimine (Part D)

Eesmärk: teha "luba esialgu, jälgi, klassifitseeri ümber" poliitika reaalseks.
Praegu logib nginx HTML-lehed UA-ga (`vutt_access.log`), AGA `/api/images/` on
`access_log off` → pildikraapimine on nähtamatu. Umami näeb ainult brausereid.
Zabbix teeb uptime-kontrolli ja on tuleviku push-alertingu koht (D4, sügis 2026).

## D1 — Logi pildipäringud (eraldi fail)

`/etc/nginx/sites-available/vutt`, `location /api/images/` blokis ASENDA
`access_log off;` reaga:

    access_log /var/log/nginx/vutt_images.log;

Rakenda:

    sudo nginx -t && sudo systemctl reload nginx

## D2 — Piira logi kasvu (KOHUSTUSLIK)

Pildipäringuid on palju → ilma rotatsioonita täidab ketta.
Loo `/etc/logrotate.d/vutt-images`:

    /var/log/nginx/vutt_images.log {
        daily
        rotate 7
        size 100M
        compress
        missingok
        notifempty
        create 0640 www-data adm
        sharedscripts
        postrotate
            [ -f /var/run/nginx.pid ] && kill -USR1 `cat /var/run/nginx.pid`
        endscript
    }

Testi: `sudo logrotate -d /etc/logrotate.d/vutt-images` (dry-run).

## Privaatsus / säilitus

Pildi- ja lehelogid sisaldavad IP + User-Agent. Hoia säilitus LÜHIKE (7 rotatsiooni
ülal), ligipääs ADMIN-only, kasutus PIIRATUD väärkasutuse/koormuse jälgimisega —
mitte analüütika ega profileerimine.

## D3 — GoAccess raport + ülevaatuse rütm

Paigalda: `sudo apt-get install goaccess`

Genereeri staatiline HTML-raport (cron, nt iga öö):

    goaccess /var/log/nginx/vutt_access.log /var/log/nginx/vutt_images.log \
      --log-format=COMBINED -o /root/vutt-goaccess/report.html

RAPORT EI TOHI LEKKIDA (sisaldab IP/UA): hoia väljaspool web-rooti, `chmod 600`,
vaata AINULT SSH-tunneli või nginx basic-auth kaudu — MITTE avalik URL.

Cron (`sudo crontab -e`):

    15 3 * * * goaccess /var/log/nginx/vutt_access.log /var/log/nginx/vutt_images.log --log-format=COMBINED -o /root/vutt-goaccess/report.html 2>/dev/null

Ülevaatuse rütm: kord nädalas vaata top UA-d/IP-d. Tegutse, kui üks UA/IP domineerib
pildimahtu või kogub palju 429-sid → see on trigger Firecrawl / PerplexityBot /
OAI-SearchBot ümberklassifitseerimiseks (vt robots.txt Task 7).

## D4 — Zabbix alerting (EDASI LÜKATUD → sügis 2026)

Ülikooli Zabbix juba pingib saiti. Ideaal: push-alertid request-rate / bandwidth /
429 piikidele. Ootab IT-d (suvepuhkused). Vahepeal katab GoAccess + logid.

## Verifitseerimine (pärast D1)

    # Botina päring lehele (peab endiselt töötama)
    curl -s -A "Googlebot" https://vutt.utlib.ut.ee/work/<id> | grep -c data-page
    # Pildipäring peab nüüd logisse ilmuma
    curl -s -A "TestBot" https://vutt.utlib.ut.ee/api/images/<id>/_thumb -o /dev/null
    sudo tail -n 5 /var/log/nginx/vutt_images.log
```

- [ ] **Step 2: Commit**

```bash
git add docs/monitoring-bot-traffic.md
git commit -m "docs: Part D bot-traffic monitoring (image log, logrotate, GoAccess)"
```

- [ ] **Step 3 (server, manual — during rollout, not in this session):**

Apply D1 + D2 on the server per the doc, `sudo nginx -t && sudo systemctl reload nginx`, then run the verification block. Install GoAccess + cron (D3). Zabbix (D4) deferred.

---

## Rollout (after all tasks pass locally)

1. **Full test sweep:** `.venv/bin/python -m pytest tests/ -q` — expect all pass.
2. **Backend (Tasks 1-6):** on server — `git pull && docker compose build --no-cache backend && docker compose up -d backend`.
3. **robots.txt (Task 7):** `npm run build` locally + `rsync -avz dist/ vutt:~/VUTT/dist/` (build copies `public/robots.txt` → `dist/`).
4. **Monitoring (Task 8):** apply `docs/monitoring-bot-traffic.md` D1+D2+D3 on the server; D4 deferred to autumn.
5. **Verify on server:** `curl -s -A "Googlebot" https://vutt.utlib.ut.ee/work/<public-id> | grep -c data-page` (>0); confirm a restricted work still returns 403; `curl https://vutt.utlib.ut.ee/robots.txt | grep GPTBot`.
6. **Search Console:** request re-indexing for a sample of affected `/work/{id}` URLs. Monitor "Crawled – currently not indexed" and impressions over subsequent weeks (not guaranteed, discretionary).

---

## Self-Review notes (coverage)

- Spec Part A (full text, main+marginalia, per-page, cache incl. `_metadata.json` mtime, size guardrail, no-cloaking, neutral module, access gating) → Tasks 2,3,4,6 (gating unchanged: endpoint still 403s restricted works before caching).
- Spec Part B (sitemap lastmod = max mtime; 1h TTL already bounds staleness) → Task 5 (TTL unchanged, already 3600s).
- Spec Part C (robots.txt block training, allow search/referral incl. Firecrawl/Perplexity-User; separate comment lines; group non-inheritance) → Task 7.
- Spec Part D (image logging, size-bounded rotation, GoAccess private report, privacy/retention, review cadence, Zabbix deferred) → Task 8.
```
