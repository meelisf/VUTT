# SEO Dynamic Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Muuta VUTT teoste lehed Google'is leitavaks — Googlebot saab rikkalik server-renderdatud HTML koos COinS/DC/OG metaandmetega; sitemap.xml loetleb kõik avalikud teosed.

**Architecture:** Dynamic rendering — nginx tuvastab Googlebot User-Agent ja suunab `/work/{id}` päringud FastAPI endpointile, mis tagastab staatilise HTML-i `_metadata.json` põhjal. Tavalised kasutajad saavad jätkuvalt React SPA-d. Infrastruktuur (bot-tuvastus, rewrite reegel) on juba olemas — lisatakse rikkalikum HTML, sitemap endpoint ja nginx proxy sitemap jaoks.

**Tech Stack:** Python 3.9, FastAPI, `html` stdlib, `urllib.parse.urlencode`, nginx (serveril), Vite `public/` staatiline fail

---

## Failid

| Fail | Muudatus |
|------|----------|
| `server/metadata_handler.py` | `build_meta_html()` laiendus + uus `build_sitemap_xml()` |
| `server/main.py` | Uus `GET /sitemap.xml` endpoint + in-memory cache |
| `tests/test_metadata_handler.py` | Uus — testid `build_meta_html()` ja `build_sitemap_xml()` jaoks |
| `public/robots.txt` | Lisa `Sitemap:` viide |
| serveril `/etc/nginx/sites-available/vutt` | Lisa `location = /sitemap.xml` plokk (deploy samm) |

---

## Task 1: Testi `build_meta_html()` — canonical, DC, COinS, body

**Files:**
- Create: `tests/test_metadata_handler.py`

Praegu `build_meta_html()` genereerib ainult OG tagid sotsiaalmeedia jaoks. Testid defineerivad, mida Google-sõbralik HTML peab sisaldama.

- [ ] **Samm 1: Loo testifail**

```python
# tests/test_metadata_handler.py
import os
import json
import pytest
from pathlib import Path


def _write_meta(tmp_path, meta: dict) -> str:
    """Kirjutab _metadata.json faili tmp kausta, tagastab work_id."""
    work_id = meta["id"]
    work_dir = tmp_path / "data" / "test-slug"
    work_dir.mkdir(parents=True)
    (work_dir / "_metadata.json").write_text(
        json.dumps(meta, ensure_ascii=False), encoding="utf-8"
    )
    return str(work_dir)


@pytest.fixture()
def patch_find(monkeypatch, tmp_path):
    """Monkeypatchi find_directory_by_id et tagastaks tmp_path kausta."""
    import server.metadata_handler as mh
    _registry = {}

    def fake_find(work_id):
        return _registry.get(work_id)

    monkeypatch.setattr(mh, "find_directory_by_id", fake_find)
    return _registry, tmp_path


FULL_META = {
    "id": "work001",
    "title": "Disputatio de pace",
    "year": 1654,
    "year_display": "1654",
    "creators": [
        {"name": "Johannes Gezelius", "role": "praeses"},
        {"name": "Petrus Schomerus", "role": "respondens"},
    ],
    "location": {"label": "Tartu", "id": "Q3258"},
    "publisher": {"label": "Johannes Vogel", "id": "Q999"},
    "languages": ["la", "de"],
    "external_url": "https://digar.nlib.ee/show/nlib-digar:123",
    "collections": [],
    "archive_refs": None,
}

MANUSCRIPT_META = {
    "id": "work002",
    "title": "Kiri consistoriumile",
    "year": 1680,
    "year_display": "1680",
    "creators": [{"name": "Adam Lode", "role": "auctor"}],
    "location": None,
    "publisher": None,
    "languages": ["de"],
    "external_url": None,
    "collections": [],
    "archive_refs": [
        {"archive_id": "EAA", "reference": "1.2.3, l. 45"},
    ],
}
```

- [ ] **Samm 2: Lisa testid canonical ja OG jaoks**

```python
def test_canonical_url_present(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)

    html = build_meta_html("work001")

    assert 'rel="canonical"' in html
    assert 'href="https://vutt.utlib.ut.ee/work/work001"' in html


def test_og_title_present(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)

    html = build_meta_html("work001")

    assert 'property="og:title"' in html
    assert "Disputatio de pace" in html


def test_meta_refresh_still_present(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)

    html = build_meta_html("work001")

    assert 'http-equiv="refresh"' in html
```

- [ ] **Samm 3: Lisa testid Dublin Core jaoks**

```python
def test_dublin_core_title(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)

    html = build_meta_html("work001")

    assert 'name="DC.title"' in html
    assert "Disputatio de pace" in html


def test_dublin_core_creators(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)

    html = build_meta_html("work001")

    assert 'name="DC.creator"' in html
    assert "Johannes Gezelius" in html
    assert "Petrus Schomerus" in html


def test_dublin_core_date(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)

    html = build_meta_html("work001")

    assert 'name="DC.date"' in html
    assert "1654" in html


def test_dublin_core_publisher(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)

    html = build_meta_html("work001")

    assert 'name="DC.publisher"' in html
    assert "Johannes Vogel" in html


def test_dublin_core_language(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)

    html = build_meta_html("work001")

    assert 'name="DC.language"' in html
    assert "la" in html
```

- [ ] **Samm 4: Lisa testid COinS jaoks**

```python
def test_coins_span_present(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)

    html = build_meta_html("work001")

    assert 'class="Z3988"' in html
    assert "ctx_ver=Z39.88-2004" in html


def test_coins_contains_title(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)

    html = build_meta_html("work001")

    assert "rft.btitle" in html
    assert "Disputatio+de+pace" in html or "Disputatio%20de%20pace" in html


def test_coins_contains_author(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)

    html = build_meta_html("work001")

    assert "rft.au" in html
    assert "Johannes" in html


def test_coins_contains_respondens(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)

    html = build_meta_html("work001")

    assert "rft.contributor" in html
    assert "Schomerus" in html


def test_coins_contains_external_url(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)

    html = build_meta_html("work001")

    assert "rft_id" in html
    assert "digar" in html
```

- [ ] **Samm 5: Lisa testid body sisu jaoks**

```python
def test_body_has_h1_title(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)

    html = build_meta_html("work001")

    assert "<h1>" in html
    assert "Disputatio de pace" in html


def test_body_has_creators(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)

    html = build_meta_html("work001")

    assert "Johannes Gezelius" in html
    assert "Petrus Schomerus" in html


def test_body_has_publisher_for_print(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)

    html = build_meta_html("work001")

    assert "Johannes Vogel" in html
    assert "Tartu" in html


def test_body_has_archive_ref_for_manuscript(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work002"] = _write_meta(tmp_path, MANUSCRIPT_META)

    html = build_meta_html("work002")

    assert "EAA" in html
    assert "1.2.3" in html


def test_body_has_permalink(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    registry["work001"] = _write_meta(tmp_path, FULL_META)

    html = build_meta_html("work001")

    assert "https://vutt.utlib.ut.ee/work/work001" in html


def test_html_escaping(patch_find):
    from server.metadata_handler import build_meta_html
    registry, tmp_path = patch_find
    meta = {**FULL_META, "id": "work003", "title": 'Teos <script>alert("xss")</script>'}
    registry["work003"] = _write_meta(tmp_path, meta)

    html = build_meta_html("work003")

    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_unknown_work_returns_fallback(patch_find):
    from server.metadata_handler import build_meta_html
    # patch_find registry on tühi — work_id ei leita
    html = build_meta_html("nonexistent")

    assert "VUTT" in html
    assert "<html>" in html
```

- [ ] **Samm 6: Käivita testid — veendu, et kõik FAIL**

```bash
.venv/bin/python -m pytest tests/test_metadata_handler.py -v 2>&1 | head -60
```

Oodatav: kõik testid FAIL (funktsioonid ei sisalda veel canonical/DC/COinS/body).

---

## Task 2: Implementeeri `build_meta_html()` uuendus

**Files:**
- Modify: `server/metadata_handler.py`

- [ ] **Samm 1: Asenda `build_meta_html()` täieliku implementatsiooniga**

```python
import os
import json
import html
from urllib.parse import urlencode
from .config import BASE_DIR
from .utils import find_directory_by_id

SITE_URL = "https://vutt.utlib.ut.ee"

_ROLE_LABELS = {
    "praeses": "Praeses",
    "auctor": "Autor",
    "respondens": "Respondens",
    "dedicatee": "Pühendatu",
    "translator": "Tõlkija",
}


def _escape(text):
    return html.escape(str(text), quote=True)


def _label(entity) -> str:
    """Eraldab LinkedEntity label või tagastab stringi sellisena."""
    if isinstance(entity, dict):
        return entity.get("label") or ""
    return str(entity) if entity else ""


def _build_coins(meta: dict) -> str:
    """Genereerib COinS (Z39.88-2004) query-stringi _metadata.json põhjal."""
    params = [
        ("ctx_ver", "Z39.88-2004"),
        ("rft_val_fmt", "info:ofi/fmt:kev:mtx:book"),
        ("rft.genre", "book"),
    ]
    title = meta.get("title", "")
    if title:
        params.append(("rft.btitle", title))

    creators = meta.get("creators") or []
    for c in creators:
        role = c.get("role", "")
        name = c.get("name", "")
        if not name:
            continue
        if role in ("praeses", "auctor"):
            params.append(("rft.au", name))
        elif role == "respondens":
            params.append(("rft.contributor", name))

    year = meta.get("year")
    if year:
        params.append(("rft.date", str(year)))

    place = _label(meta.get("location"))
    if place:
        params.append(("rft.place", place))

    publisher = _label(meta.get("publisher"))
    if publisher:
        params.append(("rft.pub", publisher))

    languages = meta.get("languages") or []
    if languages:
        params.append(("rft.language", ", ".join(languages)))

    ext_url = meta.get("external_url") or ""
    if ext_url.startswith("https://") or ext_url.startswith("http://"):
        params.append(("rft_id", ext_url))

    return urlencode(params)


def build_meta_html(work_id: str) -> str:
    """Genereerib Google'ile ja sotsiaalmeedia robotitele HTML-i koos metaandmetega."""
    found_path = find_directory_by_id(work_id)

    title = "VUTT - Varauusaegsete tekstide töölaud"
    description = "Vaata ja toimeta Tartu Ülikooli varauusaegseid akadeemilisi tekste."
    image_url = f"{SITE_URL}/vutt-og.png"
    meta = {}

    if found_path:
        metadata_path = os.path.join(found_path, "_metadata.json")
        if os.path.exists(metadata_path):
            try:
                with open(metadata_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                title = meta.get("title", title)
                creators = meta.get("creators") or []
                creator_names = ", ".join(c.get("name", "") for c in creators if c.get("name"))
                year = meta.get("year", "")
                if creator_names:
                    description = f"{creator_names}. {year}" if year else creator_names
            except Exception:
                pass
        image_url = f"{SITE_URL}/api/images/{work_id}/_thumb"

    work_url = f"{SITE_URL}/work/{work_id}"
    safe_title = _escape(title)
    safe_desc = _escape(description)
    coins_str = _escape(_build_coins(meta)) if meta else ""

    # Dublin Core meta tagid
    dc_tags = f'    <meta name="DC.title" content="{safe_title}">\n'
    creators = meta.get("creators") or []
    for c in creators:
        name = c.get("name", "")
        if name:
            dc_tags += f'    <meta name="DC.creator" content="{_escape(name)}">\n'
    year = meta.get("year")
    if year:
        dc_tags += f'    <meta name="DC.date" content="{_escape(str(year))}">\n'
    publisher = _label(meta.get("publisher"))
    if publisher:
        dc_tags += f'    <meta name="DC.publisher" content="{_escape(publisher)}">\n'
    languages = meta.get("languages") or []
    for lang in languages:
        dc_tags += f'    <meta name="DC.language" content="{_escape(lang)}">\n'

    # Body sisu
    body_lines = [f"<h1>{_escape(title)}</h1>"]

    if creators:
        body_lines.append("<dl>")
        for c in creators:
            role_label = _ROLE_LABELS.get(c.get("role", ""), c.get("role", ""))
            name = c.get("name", "")
            if name:
                body_lines.append(f"  <dt>{_escape(role_label)}</dt><dd>{_escape(name)}</dd>")
        body_lines.append("</dl>")

    if year:
        body_lines.append(f"<p>{_escape(str(year))}</p>")

    place = _label(meta.get("location"))
    publisher_name = _label(meta.get("publisher"))
    if place or publisher_name:
        body_lines.append(f"<p>{_escape(place)}{': ' + _escape(publisher_name) if publisher_name else ''}</p>")

    archive_refs = meta.get("archive_refs") or []
    for ref in archive_refs:
        archive_id = ref.get("archive_id", "")
        reference = ref.get("reference", "")
        body_lines.append(f"<p>{_escape(archive_id)}{' ' + _escape(reference) if reference else ''}</p>")

    body_lines.append(f'<p><a href="{work_url}">{work_url}</a></p>')
    body_content = "\n".join(body_lines)

    return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>{safe_title}</title>
    <link rel="canonical" href="{work_url}">
    <meta name="description" content="{safe_desc}">

    {dc_tags}
    <meta property="og:type" content="website">
    <meta property="og:url" content="{work_url}">
    <meta property="og:title" content="{safe_title}">
    <meta property="og:description" content="{safe_desc}">
    <meta property="og:image" content="{image_url}">
    <meta property="og:image:type" content="image/jpeg">
    <meta property="og:image:width" content="400">
    <meta property="og:image:height" content="600">

    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="{safe_title}">
    <meta name="twitter:description" content="{safe_desc}">
    <meta name="twitter:image" content="{image_url}">

    <meta http-equiv="refresh" content="0; url={work_url}">
</head>
<body>
    {body_content}
    {f'<span class="Z3988" title="{coins_str}"></span>' if coins_str else ''}
</body>
</html>"""
```

- [ ] **Samm 2: Käivita testid — veendu, et kõik PASS**

```bash
.venv/bin/python -m pytest tests/test_metadata_handler.py -v 2>&1 | tail -30
```

Oodatav: kõik testid PASS.

- [ ] **Samm 3: Commit**

```bash
git add server/metadata_handler.py tests/test_metadata_handler.py
git commit -m "feat: laienda build_meta_html canonical/DC/COinS/body lisamisega"
```

---

## Task 3: Testi `build_sitemap_xml()`

**Files:**
- Modify: `tests/test_metadata_handler.py` (lisa lõppu)

- [ ] **Samm 1: Lisa sitemapi testid**

```python
# tests/test_metadata_handler.py lõppu

def _make_sitemap_cache(entries: dict) -> dict:
    """entries: {work_id: (meta_dict, mtime_float)}"""
    return entries


def test_sitemap_includes_public_work():
    from server.metadata_handler import build_sitemap_xml

    cache = {"work001": ("/data/test-slug", 1700000000.0)}
    meta_store = {
        "work001": {"id": "work001", "title": "Teos", "collections": []},
    }

    def load_meta(work_id):
        return meta_store.get(work_id)

    def is_public(meta):
        return True

    xml = build_sitemap_xml(cache, is_public, load_meta)

    assert "work001" in xml
    assert "<loc>" in xml
    assert "vutt.utlib.ut.ee" in xml


def test_sitemap_excludes_restricted_work():
    from server.metadata_handler import build_sitemap_xml

    cache = {"work999": ("/data/restricted", 1700000000.0)}
    meta_store = {
        "work999": {"id": "work999", "title": "Piiratud", "collections": ["restricted-col"]},
    }

    def load_meta(work_id):
        return meta_store.get(work_id)

    def is_public(meta):
        return False

    xml = build_sitemap_xml(cache, is_public, load_meta)

    assert "work999" not in xml


def test_sitemap_excludes_work_with_none_meta():
    from server.metadata_handler import build_sitemap_xml

    cache = {"workX": ("/data/missing", 1700000000.0)}

    def load_meta(work_id):
        return None

    def is_public(meta):
        return True

    xml = build_sitemap_xml(cache, is_public, load_meta)

    assert "workX" not in xml


def test_sitemap_has_lastmod():
    from server.metadata_handler import build_sitemap_xml
    import datetime

    cache = {"work001": ("/data/test-slug", 1700000000.0)}
    meta_store = {"work001": {"id": "work001", "title": "Teos", "collections": []}}

    def load_meta(work_id):
        return meta_store.get(work_id)

    def is_public(meta):
        return True

    xml = build_sitemap_xml(cache, is_public, load_meta)

    assert "<lastmod>" in xml
    expected_date = datetime.datetime.utcfromtimestamp(1700000000.0).strftime("%Y-%m-%d")
    assert expected_date in xml


def test_sitemap_valid_xml_structure():
    from server.metadata_handler import build_sitemap_xml

    cache = {}

    xml = build_sitemap_xml(cache, lambda m: True, lambda wid: None)

    assert xml.startswith("<?xml")
    assert "<urlset" in xml
    assert "</urlset>" in xml


def test_sitemap_multiple_works():
    from server.metadata_handler import build_sitemap_xml

    cache = {
        "w1": ("/data/w1", 1700000000.0),
        "w2": ("/data/w2", 1700001000.0),
        "w3": ("/data/w3", 1700002000.0),
    }
    metas = {
        "w1": {"id": "w1", "collections": []},
        "w2": {"id": "w2", "collections": []},
        "w3": {"id": "w3", "collections": []},
    }

    xml = build_sitemap_xml(cache, lambda m: True, lambda wid: metas.get(wid))

    assert xml.count("<url>") == 3
```

- [ ] **Samm 2: Käivita testid — veendu, et FAIL**

```bash
.venv/bin/python -m pytest tests/test_metadata_handler.py::test_sitemap_includes_public_work -v
```

Oodatav: `ImportError` või `AttributeError` — funktsioon pole veel olemas.

---

## Task 4: Implementeeri `build_sitemap_xml()`

**Files:**
- Modify: `server/metadata_handler.py`

- [ ] **Samm 1: Lisa `build_sitemap_xml()` funktsioon faili lõppu**

```python
def build_sitemap_xml(
    work_id_cache: dict,
    is_work_public_fn,
    load_meta_fn,
) -> str:
    """
    Genereerib sitemap.xml kõigi avalike teoste jaoks.

    work_id_cache: {work_id: (path, mtime)} või {work_id: path} — aktsepteerib mõlemat
    is_work_public_fn: callable(meta) -> bool
    load_meta_fn: callable(work_id) -> dict | None
    """
    import datetime

    urls = []
    for work_id, value in work_id_cache.items():
        # Cache võib olla {work_id: path} (string) või {work_id: (path, mtime)}
        if isinstance(value, tuple):
            path, mtime = value
        else:
            path = value
            try:
                meta_path = os.path.join(path, "_metadata.json")
                mtime = os.path.getmtime(meta_path) if os.path.exists(meta_path) else 0.0
            except Exception:
                mtime = 0.0

        meta = load_meta_fn(work_id)
        if meta is None:
            continue
        if not is_work_public_fn(meta):
            continue

        lastmod = datetime.datetime.utcfromtimestamp(mtime).strftime("%Y-%m-%d")
        loc = f"{SITE_URL}/work/{html.escape(work_id)}"
        urls.append(f"  <url>\n    <loc>{loc}</loc>\n    <lastmod>{lastmod}</lastmod>\n  </url>")

    body = "\n".join(urls)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{body}\n"
        "</urlset>"
    )
```

- [ ] **Samm 2: Käivita kõik sitemapi testid**

```bash
.venv/bin/python -m pytest tests/test_metadata_handler.py -k "sitemap" -v
```

Oodatav: kõik PASS.

- [ ] **Samm 3: Käivita kõik testid**

```bash
.venv/bin/python -m pytest tests/test_metadata_handler.py -v
```

Oodatav: kõik PASS.

- [ ] **Samm 4: Commit**

```bash
git add server/metadata_handler.py tests/test_metadata_handler.py
git commit -m "feat: lisa build_sitemap_xml avalike teoste loetlemiseks"
```

---

## Task 5: Lisa `/sitemap.xml` endpoint `server/main.py`

**Files:**
- Modify: `server/main.py`

- [ ] **Samm 1: Lisa impordid faili päisesse**

Asenda `server/main.py`-s olemasolev `from .metadata_handler import build_meta_html` rida:

```python
from .metadata_handler import build_meta_html, build_sitemap_xml
```

Asenda `from .access_ops import can_read_work` rida:

```python
from .access_ops import can_read_work, is_work_public
```

- [ ] **Samm 2: Lisa sitemap cache ja endpoint**

Lisa `server/main.py`-sse, `/health` endpointi ette (rea `@app.get("/health")` ette):

```python
# Sitemap cache — uuendatakse TTL 1h tagant
_sitemap_cache: dict = {"xml": None, "expires": 0.0}


@app.get("/sitemap.xml")
async def sitemap_xml():
    import time
    from . import utils as utils_module
    now = time.time()
    if _sitemap_cache["xml"] is None or now > _sitemap_cache["expires"]:
        _sitemap_cache["xml"] = build_sitemap_xml(
            utils_module.WORK_ID_CACHE,
            is_work_public,
            _load_work_metadata,
        )
        _sitemap_cache["expires"] = now + 3600
    return Response(content=_sitemap_cache["xml"], media_type="application/xml")
```

`Response` on juba imporditud FastAPI kaudu — kontrolli et `from fastapi.responses import HTMLResponse` rea juures on ka `Response`, või lisa:

```python
from fastapi.responses import HTMLResponse, Response
```

- [ ] **Samm 3: Kontrolli import**

```bash
grep "from fastapi.responses" server/main.py
```

Kui `Response` pole seal, lisa see samasse impordi reale.

- [ ] **Samm 4: Käivita olemasolevad testid**

```bash
.venv/bin/python -m pytest tests/ -v --ignore=tests/test_consolidate_data.py -x 2>&1 | tail -20
```

Oodatav: kõik testid PASS (uut endpointi pole vaja eraldi testida — `build_sitemap_xml` on testitud Task 3-4-s).

- [ ] **Samm 5: Commit**

```bash
git add server/main.py
git commit -m "feat: lisa /sitemap.xml endpoint TTL cache-iga"
```

---

## Task 6: Uuenda `public/robots.txt`

**Files:**
- Modify: `public/robots.txt`

- [ ] **Samm 1: Lisa Sitemap rida**

`public/robots.txt` praegune sisu:

```
# VUTT - Varauusaegsete Tekstide Töölaud
# https://vutt.utlib.ut.ee

User-agent: *
Allow: /$
Allow: /work/
Disallow: /search
Disallow: /register
Disallow: /set-password
Disallow: /admin
Disallow: /review
Disallow: /statistics
Disallow: /api/
Disallow: /meili/
```

Lisa lõppu:

```
Sitemap: https://vutt.utlib.ut.ee/sitemap.xml
```

- [ ] **Samm 2: Commit**

```bash
git add public/robots.txt
git commit -m "feat: lisa robots.txt sitemap viide"
```

---

## Task 7: Deploy serverisse

- [ ] **Samm 1: Build ja rsync frontend**

```bash
npm run build
rsync -avz dist/ vutt:~/VUTT/dist/
```

- [ ] **Samm 2: Deploy backend**

```bash
ssh vutt
cd ~/VUTT
./scripts/server_update.sh
```

- [ ] **Samm 3: Uuenda nginx serveril**

Lisa `/work/` location ploki ette:

```nginx
location = /sitemap.xml {
    proxy_pass http://backend:8002/sitemap.xml;
}
```

```bash
sudo nano /etc/nginx/sites-available/vutt
# Lisa location = /sitemap.xml plokk enne "location /" plokki
sudo nginx -t
sudo systemctl reload nginx
```

- [ ] **Samm 4: Kontrolli sitemap**

```bash
curl -s https://vutt.utlib.ut.ee/sitemap.xml | head -20
```

Oodatav: XML koos `<urlset>` ja `<url>` kirjetega.

- [ ] **Samm 5: Kontrolli bot HTML**

```bash
curl -s -A "Googlebot/2.1" https://vutt.utlib.ut.ee/work/$(curl -s https://vutt.utlib.ut.ee/sitemap.xml | grep -o 'work/[^<]*' | head -1 | cut -d/ -f2) | grep -E "canonical|Z3988|DC.title" | head -10
```

Oodatav: canonical URL, Z3988 span ja DC.title meta tag on olemas.

- [ ] **Samm 6: Kontrolli robots.txt**

```bash
curl -s https://vutt.utlib.ut.ee/robots.txt
```

Oodatav: `Sitemap: https://vutt.utlib.ut.ee/sitemap.xml` on viimane rida.

---

## Task 8: Turvalisusülevaade (eraldi töö)

Enne Google indekseerimise efektiivseks muutumist (võtab aega), teha ülevaade:

- [ ] **Rate limiting** — kontrolli auth endpointide piirmäärasid (`server/rate_limit.py`)
- [ ] **Avalikud endpointid** — veendu, et `/meta/work/{id}` ei leki piiratud teoste andmeid (test: 403 piiratud teosel)
- [ ] **Sitemap leke** — veendu, et sitemap ei sisalda piiratud kollektsioonide teoseid (test: `is_work_public` filter)
- [ ] **Security headers** — OG/bot endpointil on korrektsed security headerid (pärib nginx kaudu)
- [ ] **Käivita `/code-review`** avalike endpointide koodil

Vt ka: `/security-review` skill täielikuma ülevaate jaoks.
