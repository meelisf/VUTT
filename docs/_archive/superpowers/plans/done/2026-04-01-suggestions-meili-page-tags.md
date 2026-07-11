# page_tags Suggestions Meilisearchist — Implementatsiooniplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Asendada `_build_suggestions()` leheküljefailide skannimine (~20 000 faili) ühe Meilisearchi facets-päringuga.

**Architecture:** `server/cache.py` funktsioonis `_build_suggestions()` eemaldatakse sisemine `os.scandir(entry.path)` tsükkel (page .json failide lugemine). Selle asemele tehakse üks `urllib` POST päring Meilisearchi `/search` endpointile `limit: 0, facets: ["page_tags_suggest_et"]` (või `_en`). Vastuse `facetDistribution` parsitakse `"label|||id"` formaadist `{label, id}` objektideks ja lisatakse `tags` hulka. Meilisearchi vea korral logitakse hoiatus, page_tags jäävad lihtsalt tühjaks — metadata-taseme tägid jäävad alles.

**Tech Stack:** Python 3, `urllib.request` (juba kasutusel samas koodibaasis), pytest, FastAPI TestClient

---

### Task 1: Kirjuta katkev test

**Files:**
- Modify: `tests/test_backend_smoke.py`

- [ ] **Samm 1: Lisa test faili lõppu**

```python
import importlib
import json
import sys
import unittest.mock
from pathlib import Path


def test_build_suggestions_uses_meili_for_page_tags(tmp_path, monkeypatch):
    """
    _build_suggestions() peab page_tags võtma Meilisearchist,
    mitte lehekülje .json failidest.
    """
    # Seadista ajutine data kaust ühe teosega
    work_dir = tmp_path / "teos1"
    work_dir.mkdir()
    (work_dir / "_metadata.json").write_text(
        json.dumps({
            "id": "abc123",
            "title": "Testeos",
            "tags": [{"label": "Jutlus", "id": "Q861911", "labels": {"et": "Jutlus"}}],
            "creators": [],
            "genre": None,
            "type": None,
            "location": None,
            "publisher": None,
        }),
        encoding="utf-8",
    )
    # Lehekülg millel on page_tag — EI tohi suggestions-i jõuda (failid ei loeta enam)
    (work_dir / "leht1.json").write_text(
        json.dumps({"page_tags": [{"label": "Vanatestament", "id": "Q1", "labels": {"et": "Vanatestament"}}]}),
        encoding="utf-8",
    )

    # Meilisearchi vastus: ainult "Teoloogia" page_tag
    fake_meili_response = json.dumps({
        "facetDistribution": {
            "page_tags_suggest_et": {
                "Teoloogia|||Q34178": 3,
            }
        }
    }).encode()

    cache_mod = importlib.import_module("server.cache")
    config_mod = importlib.import_module("server.config")

    monkeypatch.setattr(config_mod, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(cache_mod, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(cache_mod, "MEILI_URL", "http://localhost:7700")
    monkeypatch.setattr(cache_mod, "MEILI_KEY", "testkey")
    monkeypatch.setattr(cache_mod, "INDEX_NAME", "teosed")

    mock_resp = unittest.mock.MagicMock()
    mock_resp.read.return_value = fake_meili_response
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = unittest.mock.MagicMock(return_value=False)

    with unittest.mock.patch("urllib.request.urlopen", return_value=mock_resp):
        result = cache_mod._build_suggestions("et")

    tag_labels = [t["label"] for t in result["tags"]]

    # page_tags Meilisearchist peavad olema
    assert "Teoloogia" in tag_labels, f"Teoloogia peaks olema tags-is, sain: {tag_labels}"
    # Metadata-taseme tägid peavad olema
    assert "Jutlus" in tag_labels, f"Jutlus peaks olema tags-is, sain: {tag_labels}"
    # Lehekülje .json faili tag EI tohi olla (faili ei loeta enam)
    assert "Vanatestament" not in tag_labels, f"Vanatestament ei tohi olla tags-is (failid ei loeta), sain: {tag_labels}"
```

- [ ] **Samm 2: Käivita test — veendu et kukub**

```bash
cd /home/mf/LLM/VUTT
source .venv/bin/activate
pytest tests/test_backend_smoke.py::test_build_suggestions_uses_meili_for_page_tags -v
```

Oodatav: **FAIL** — kas `AttributeError` (MEILI_URL pole cache_mod-is) või `AssertionError` (`Vanatestament` on tags-is, sest failid loetakse veel).

---

### Task 2: Implementeeri muutus `server/cache.py`-s

**Files:**
- Modify: `server/cache.py`

- [ ] **Samm 3: Uuenda impordiread faili alguses**

Leia:
```python
import json
import os
import threading
from datetime import datetime

from .config import BASE_DIR, COLLECTIONS_FILE, VOCABULARIES_FILE
```

Asenda:
```python
import json
import os
import threading
import urllib.request
from datetime import datetime

from .config import BASE_DIR, COLLECTIONS_FILE, VOCABULARIES_FILE, MEILI_URL, MEILI_KEY, INDEX_NAME
```

- [ ] **Samm 4: Asenda leheküljefailide skannimine `_build_suggestions()`-s**

Leia kogu sisemine leheküljefailide tsükkel (read 197–206 `server/cache.py`-s):
```python
            try:
                for page_file in os.scandir(entry.path):
                    if page_file.name.endswith('.json') and page_file.name != '_metadata.json':
                        try:
                            with open(page_file.path, 'r', encoding='utf-8') as f:
                                page_data = json.load(f)
                                source = page_data.get('meta_content', page_data)
                                for pt in source.get('page_tags', source.get('tags', [])): add_item(tags, pt, 'tags')
                        except Exception: pass
            except Exception: pass
```

Kustuta see plokk täielikult. Selle asemele lisa Meilisearchi päring **pärast** välimise `for entry in os.scandir(BASE_DIR)` tsükli lõppu (st pärast rida `except Exception: pass` mis sulgeb `_metadata.json` lugemist) ja **enne** Tartu/Pärnu vaikeväärtuste lisamist.

Tulemuseks peaks `_build_suggestions` lõpp välja nägema nii:

```python
    for entry in os.scandir(BASE_DIR):
        if entry.is_dir():
            meta_path = os.path.join(entry.path, '_metadata.json')
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, 'r', encoding='utf-8') as f:
                        meta = json.load(f)
                        for creator in meta.get('creators', []): add_item(authors, {'label': creator.get('name'), 'id': creator.get('id')}, 'authors')
                        for t in meta.get('tags', []): add_item(tags, t, 'tags')
                        add_item(places, meta.get('location'), 'places')
                        add_item(printers, meta.get('publisher'), 'printers')
                        add_item(types, meta.get('type'), 'types')
                        g = meta.get('genre')
                        if g:
                            if isinstance(g, list):
                                for item in g: add_item(genres, item, 'genres')
                            else: add_item(genres, g, 'genres')
                except Exception: pass

    # page_tags Meilisearchist (asendab leheküljefailide skänni)
    try:
        facet_field = f"page_tags_suggest_{preferred_lang}"
        url = f"{MEILI_URL}/indexes/{INDEX_NAME}/search"
        body = json.dumps({"q": "", "limit": 0, "facets": [facet_field]}).encode('utf-8')
        req = urllib.request.Request(url, data=body, method='POST')
        req.add_header('Content-Type', 'application/json')
        req.add_header('Authorization', f'Bearer {MEILI_KEY}')
        with urllib.request.urlopen(req, timeout=5) as resp:
            result = json.loads(resp.read())
        facet_dist = result.get('facetDistribution', {}).get(facet_field, {})
        for entry_str in facet_dist:
            label, _, id_code = entry_str.partition('|||')
            label = label.strip()
            if label:
                add_item(tags, {'label': label, 'id': id_code or None}, 'tags')
    except Exception as e:
        print(f"SUGGESTIONS: page_tags Meilisearchist ebaõnnestus: {e}")

    for p in ['Tartu', 'Pärnu']:
        if p.lower() not in places: places[p.lower()] = {'label': p, 'id': None}

    def to_sorted_list(store): return sorted(list(store.values()), key=lambda x: x['label'])
    return {"authors": to_sorted_list(authors), "tags": to_sorted_list(tags), "places": to_sorted_list(places), "printers": to_sorted_list(printers), "types": to_sorted_list(types), "genres": to_sorted_list(genres)}
```

- [ ] **Samm 5: Käivita test — veendu et läbib**

```bash
pytest tests/test_backend_smoke.py::test_build_suggestions_uses_meili_for_page_tags -v
```

Oodatav: **PASS**

- [ ] **Samm 6: Käivita kõik testid**

```bash
pytest tests/ -v
```

Oodatav: kõik testid **PASS**

- [ ] **Samm 7: Commit**

```bash
git add server/cache.py tests/test_backend_smoke.py
git commit -m "perf: asenda page_tags failiskannimine Meilisearchi facets-päringuga

_build_suggestions() eemaldab ~20 000 leheküljefaili lugemise,
asendades selle ühe Meilisearchi facets-päringuga (page_tags_suggest_et/en).
Metadata-taseme _metadata.json skannimine jääb muutmata.
"
```

---

### Task 3: Verifitseeri serveril

- [ ] **Samm 8: Deploy serverisse**

```bash
git push
ssh vutt
cd ~/VUTT
git pull
docker compose build --no-cache backend && docker compose up -d backend
```

- [ ] **Samm 9: Kontrolli logid**

```bash
docker logs vutt-backend --tail=50
```

Oodatav: startup logid ilma veadeta, `Work ID cache built: N entries.`

- [ ] **Samm 10: Testi endpoint**

```bash
# Logi sisse ja hangi token (editor roll piisab)
TOKEN=$(curl -s -X POST http://localhost:8002/login \
  -H "Content-Type: application/json" \
  -d '{"username":"<editor-kasutajanimi>","password":"<parool>"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s -X POST http://localhost:8002/get-metadata-suggestions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"lang":"et"}' | python3 -m json.tool | head -40
```

Oodatav: `{"status": "success", "authors": [...], "tags": [...], ...}` — `tags` sisaldab nii metadata- kui page-taseme tage.

- [ ] **Samm 11: Uuenda architecture review**

`docs/architecture_review_2026-03-31.md` punktis 3 asenda:

```
3. Vähendada täisskänne kohtades, kus neid tehakse sageli. **ANALÜÜSITUD (2026-04-01)**
```

→

```
3. Vähendada täisskänne kohtades, kus neid tehakse sageli. **TEHTUD (2026-04-01)**

   page_tags suggestions asendati Meilisearchi facets-päringuga — ~20 000 failiskannimine
   asendati ühe HTTP päringuga (server/cache.py). Metadata-taseme skannimine (1300 faili)
   jääb alles.
```

```bash
git add docs/architecture_review_2026-03-31.md
git commit -m "docs: märgi suggestions optimeerimine tehtuks architecture review-s"
```
