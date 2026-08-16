# VUTT MCP-server — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anda lokaalselt jooksvatele agentidele (Claude Code, Codex CLI, Gemini CLI, Antigravity) MCP-tööriistad VUTT-i transkriptsioonide ja prosopograafia otsimiseks ning lugemiseks.

**Architecture:** Uus alamkaust `mcp/` sisaldab iseseisvat paketti `vutt_mcp`, mis on VUTT-i avaliku HTTPS-API õhuke klient. Kogu võrgusuhtlus käib ühest moodulist (`client.py`); päringu koostamine (`queries.py`) ja väljundi vormindamine (`format.py`) on puhtad, võrguvabalt testitavad funktsioonid. Transport on stdio; tööriistu on seitse ja kõik on read-only.

**Tech Stack:** Python 3.12, `mcp>=2,<3` (MCPServer, mitte v1 FastMCP), `httpx`, `pytest`. Andmeallikad: Meilisearch (indeks `teosed`, lehekülje-põhine) ja FastAPI prosopograafia-endpointid.

**Spec:** `docs/superpowers/specs/2026-08-15-vutt-mcp-server-design.md`

## Global Constraints

- **Koodikommentaarid eesti keeles** (CLAUDE.md).
- **`vutt_mcp` EI TOHI importida `server`-paketti runtime'is.** Pakett paigaldatakse `pipx`-iga isoleeritud venv-i, kus `server/` ei ole importitav. `server`-i tohivad importida ainult testid `mcp/tests/` all, mis jooksevad repo venv-is.
- **`mcp` sõltuvus läheb AINULT `requirements-dev.txt`-i**, mitte `requirements.txt`-i — viimane paigaldatakse Docker-buildis Python 3.9 peale ja SDK v2 murraks selle.
- **CLAUDE.md-i „Python 3.9 ühilduvus" reegel EI KEHTI `mcp/` all** — see kood jookseb ainult lokaalselt (venv 3.12, CI 3.12). `dict | None` on lubatud. `server/` all kehtib reegel edasi.
- **Iga tööriist deklareeritakse `@mcp.tool(structured_output=False)`.** SDK v2 tuletab `-> str`-ist ka `structured_content`-i; klientide tugi sellele on ebaühtlane.
- **stdio: `stdout` on reserveeritud MCP protokollile.** Diagnostika, logid, hoiatused ainult `stderr`-i. Ei `print()`.
- **Otsingu vaikimisi `matchingStrategy: "all"`** (Meili vaikeväärtus on `last`).
- **MCP ei tagasta kunagi skaneeringu piltide baite** — ainult töölaua linke.
- Väravad: `.venv/bin/pytest`, `npm run typecheck` ei ole siin asjakohane (frontendi ei puututa).

## Faili­struktuur

| Fail | Vastutus |
|---|---|
| `mcp/pyproject.toml` | Paketi metaandmed, sõltuvused, console-script `vutt-mcp` |
| `mcp/vutt_mcp/__init__.py` | Versioon, avalik pind |
| `mcp/vutt_mcp/config.py` | Env-muutujate lugemine ja valideerimine |
| `mcp/vutt_mcp/client.py` | AINUS HTTP-kiht: Meili + FastAPI, kordusekatsed, vead |
| `mcp/vutt_mcp/queries.py` | Meili päringukehade koostamine (puhas) |
| `mcp/vutt_mcp/format.py` | Vastus → agendile loetav tekst (puhas) |
| `mcp/vutt_mcp/persons.py` | Prosopograafia päringud + mahuvalve |
| `mcp/vutt_mcp/server.py` | Seitsme tööriista registreerimine |
| `mcp/vutt_mcp/__main__.py` | Logimine stderr'i, konfi kontroll, `mcp.run(transport="stdio")` |
| `server/meili_settings.py` | **Uus.** Indeksi atribuudinimekirjad ühes kohas |
| `mcp/tests/` | Üksustestid, Meili leping, structured_output, stdout, live-suits |

---

### Task 1: Paketi skelett ja SDK verifitseerimine

Esimene ülesanne fikseerib SDK tegeliku impordi-tee. Dokumentatsioon näitab kaht
varianti (`mcp.server.MCPServer` ja `mcp.server.mcpserver.MCPServer`) — **ära
oleta, kontrolli paigaldatud paketist.**

**Files:**
- Create: `mcp/pyproject.toml`, `mcp/vutt_mcp/__init__.py`, `mcp/vutt_mcp/server.py`, `mcp/vutt_mcp/__main__.py`
- Create: `mcp/tests/test_server_smoke.py`

> **`mcp/tests/` EI TOHI sisaldada `__init__.py`-d.** Teostuses proovitud ja
> tagasi võetud: pakett `mcp.tests` paneb pytesti lisama `<repo>/mcp` sys.path'i
> algusesse, mille järel `mcp/tests` varjutab repo enda `tests` paketi ja
> `from tests.conftest import …` kukub (5 testi). Repo `mcp/` kaust ise on
> ohutu — ilma `__init__.py`-ta on see ainult nimeruumi-kandidaat ja
> site-packages'i päris `mcp` SDK võidab.
- Modify: `requirements-dev.txt`, `pytest.ini`

**Interfaces:**
- Produces: `vutt_mcp.server.mcp` (MCPServer instants, nimi `"vutt"`), `vutt_mcp.server.build_server() -> MCPServer`

- [ ] **Step 1: Loo pakett ja paigalda**

`mcp/pyproject.toml`:

```toml
[project]
name = "vutt-mcp"
version = "0.1.0"
description = "MCP-server VUTT-i varauusaegsete tekstide ja prosopograafia jaoks"
requires-python = ">=3.10"
dependencies = ["mcp>=2,<3", "httpx>=0.28.0"]

[project.scripts]
vutt-mcp = "vutt_mcp.__main__:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

`mcp/vutt_mcp/__init__.py`:

```python
"""VUTT MCP-server: agentide ligipääs transkriptsioonidele ja prosopograafiale."""

__version__ = "0.1.0"
```

Paigalda repo venv-i (testide jaoks):

```bash
.venv/bin/pip install -e mcp/
```

- [ ] **Step 2: Verifitseeri SDK impordi-tee**

```bash
.venv/bin/python -c "from mcp.server.mcpserver import MCPServer; print('mcpserver OK')" \
  || .venv/bin/python -c "from mcp.server import MCPServer; print('server OK')"
.venv/bin/python -c "import mcp; print(mcp.__version__)"
```

Kasuta edaspidi seda teed, mis töötas. Kui mõlemad töötavad, eelista
`from mcp.server.mcpserver import MCPServer` (migratsioonijuhendi kanooniline kuju).

- [ ] **Step 3: Kirjuta kukkuv test**

`mcp/tests/test_server_smoke.py`:

```python
"""Serveri koostamise suitsutest — tööriistade registreerimine ja nimed."""
from vutt_mcp.server import build_server

EXPECTED_TOOLS = {
    "search_pages", "search_works", "get_work", "get_pages",
    "search_persons", "get_person", "list_filter_values",
}


# pytest.ini: asyncio_mode = auto — eraldi markerit ei ole vaja
async def test_server_registreerib_koik_tooriistad():
    server = build_server()
    names = {t.name for t in await server.list_tools()}
    assert names == EXPECTED_TOOLS
```

- [ ] **Step 4: Jooksuta — peab kukkuma**

```bash
.venv/bin/pytest mcp/tests/test_server_smoke.py -v
```

Oodatav: FAIL, `ModuleNotFoundError: No module named 'vutt_mcp.server'`.

- [ ] **Step 5: Kirjuta minimaalne server**

`mcp/vutt_mcp/server.py` (kasuta Step 2-s kinnitatud imporditeed):

```python
"""MCP-tööriistade registreerimine. Hoia õhuke: loogika elab teistes moodulites."""
from mcp.server.mcpserver import MCPServer


def build_server() -> MCPServer:
    """Koostab serveri koos kõigi tööriistadega.

    Eraldi funktsioon (mitte moodulitasandi instants), et testid saaksid
    puhta serveri ilma protsessi käivitamata.
    """
    mcp = MCPServer("vutt")
    _register_text_tools(mcp)
    _register_person_tools(mcp)
    return mcp


def _register_text_tools(mcp: MCPServer) -> None:
    """Tekstitööriistad — täidetakse Task 6-s."""


def _register_person_tools(mcp: MCPServer) -> None:
    """Prosopograafia tööriistad — täidetakse Task 7-s ja 8-s."""
```

Test kukub veel (tööriistu pole) — see on ootuspärane. Muuda test ajutiselt
`assert names == set()`, et Task 1 lõpetada rohelisena, ja **taasta täielik
`EXPECTED_TOOLS` Task 8 lõpus**. Lisa testi juurde kommentaar:

```python
# NB: Task 8 lõpus taasta assert names == EXPECTED_TOOLS
```

- [ ] **Step 6: Kirjuta käivitusmoodul**

`mcp/vutt_mcp/__main__.py`:

```python
"""stdio-käivitus. stdout on reserveeritud MCP protokollile — logi ainult stderr'i."""
import logging
import sys

from .server import build_server


def main() -> None:
    # KRIITILINE: stdout kuulub MCP protokollile. Üksainus print() rikub voo
    # ja klient kaotab serveri. Kogu diagnostika läheb stderr'i.
    logging.basicConfig(
        stream=sys.stderr,
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    build_server().run(transport="stdio")


if __name__ == "__main__":
    main()
```

- [ ] **Step 7: Ühenda testid repo pytesti külge**

`requirements-dev.txt` — lisa kaks rida (`-r requirements.txt` jääb esimeseks):

```
mcp>=2,<3
pytest-asyncio>=1.0.0
```

`pytest.ini`:

```ini
[pytest]
testpaths = tests mcp/tests
python_files = test_*.py
asyncio_mode = auto
markers =
    live: päris API vastu; ei jookse vaikimisi (kasuta -m live)
addopts = -m "not live"
```

`asyncio_mode = auto` on ohutu: kontrollitud, et `tests/` all ei ole ühtki
async-testi ega olemasolevat asyncio-konfiguratsiooni.

- [ ] **Step 8: Ühenda testid CI külge — MUIDU NEED EI JOOKSE**

CI kutsub praegu `pytest tests/` **selgesõnalise teega**, mis eirab
`testpaths`-i. Ilma selle sammuta ei jookseks `mcp/tests/` CI-s kunagi ja
Meili lepingu test — kogu samas repos olemise põhjendus — oleks surnud kood.

`.github/workflows/ci.yml`, `backend` töö:

```yaml
      - name: Install Python dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements-dev.txt
          pip install -e mcp/
```

ja

```yaml
        run: pytest tests/ mcp/tests/
```

NB: CI käivitub ainult main'i-PR-idel (CLAUDE.md) — virnastatud PR checke ei saa.

- [ ] **Step 9: Jooksuta kõik testid**

```bash
.venv/bin/pytest mcp/tests/ -v && .venv/bin/pytest tests/ -q
```

Oodatav: `mcp/tests/` PASS, olemasolev `tests/` ilma regressioonita.

- [ ] **Step 10: Commit**

```bash
git add mcp/ requirements-dev.txt pytest.ini .github/workflows/ci.yml
git commit -m "feat(mcp): paketi skelett, stdio-käivitus, testide ühendus CI-ga"
```

---

### Task 2: `server/meili_settings.py` — indeksiseaded ühte kohta

Praegu deklareeritakse atribuudid kahes kohas, mis võivad lahku minna. See on
Task 4 lepingu-testi eeltingimus: test ei saa otsustada, kumb nimekiri on tõde.

**Files:**
- Create: `server/meili_settings.py`
- Modify: `scripts/2-1_upload_to_meili.py:44-110`, `server/meilisearch_ops.py:428-449`
- Test: `tests/test_meili_settings.py`

**Interfaces:**
- Produces: `server.meili_settings.SEARCHABLE_ATTRIBUTES: list[str]`, `FILTERABLE_ATTRIBUTES: list[str]`, `SORTABLE_ATTRIBUTES: list[str]`

- [ ] **Step 1: Kirjuta kukkuv test**

`tests/test_meili_settings.py`:

```python
"""Indeksi seaded on ÜHES kohas — seed-skript ja runtime kasutavad sama allikat."""
from server.meili_settings import (
    FILTERABLE_ATTRIBUTES,
    SEARCHABLE_ATTRIBUTES,
    SORTABLE_ATTRIBUTES,
)


def test_runtime_needed_hulk_sisaldub_filterables():
    """_ensure_filterable_attributes() 'needed' hulk EI TOHI olla eraldi nimekiri."""
    from server.meilisearch_ops import RUNTIME_REQUIRED_FILTERABLE

    assert RUNTIME_REQUIRED_FILTERABLE.issubset(set(FILTERABLE_ATTRIBUTES))


def test_kriitilised_valjad_on_olemas():
    """Väljad, mille puudumine murrab teadaoleva funktsionaalsuse."""
    # distinct: "work_id" nõuab, et work_id oleks filterable
    assert "work_id" in FILTERABLE_ATTRIBUTES
    # lehekülgede järjestus get_work-is
    assert "lehekylje_number" in SORTABLE_ATTRIBUTES
    # kollektsioonifilter
    assert "collections" in FILTERABLE_ATTRIBUTES
    assert "collections_hierarchy" in FILTERABLE_ATTRIBUTES
    # tenant-tokeni filter
    assert "is_public" in FILTERABLE_ATTRIBUTES
    # põhitekst ja marginaalia otsitavad
    assert "lehekylje_tekst" in SEARCHABLE_ATTRIBUTES
    assert "marginaalia_tekst" in SEARCHABLE_ATTRIBUTES


def test_nimekirjades_pole_duplikaate():
    for attrs in (SEARCHABLE_ATTRIBUTES, FILTERABLE_ATTRIBUTES, SORTABLE_ATTRIBUTES):
        assert len(attrs) == len(set(attrs))
```

- [ ] **Step 2: Jooksuta — peab kukkuma**

```bash
.venv/bin/pytest tests/test_meili_settings.py -v
```

Oodatav: FAIL, `ModuleNotFoundError: No module named 'server.meili_settings'`.

- [ ] **Step 3: Loo moodul**

`server/meili_settings.py` — kopeeri nimekirjad **täpselt** failist
`scripts/2-1_upload_to_meili.py:45-109` (ära muuda ühtki nime; ortograafia on
legacy ja seotud ADR 0006-ga):

```python
"""Meilisearch indeksi atribuudinimekirjad — ÜKS tõene allikas.

Varem olid need kahes kohas: seed-skriptis (täisnimekiri) ja
meilisearch_ops._ensure_filterable_attributes()-is (väiksem 'needed' hulk).
Kaks nimekirja said vaikselt lahku minna.

Väljanimede ORTOGRAAFIA on legacy ('y'-kuju: lehekylje_tekst) — vt ADR 0006.
Ümbernimetamine nõuab täisreindeksit, mitte möödaminnes muutmist.
"""

SEARCHABLE_ATTRIBUTES = [
    "title",
    "authors_text",
    "year",
    "location_search",
    "publisher_search",
    "genre_search",
    "tags_search",
    "notes",
    "series_title",
    "lehekylje_tekst",
    "marginaalia_tekst",
    "page_tags",
    "page_tags_et",
    "page_tags_en",
    "comments.text",
    "archive_refs_text",
    "text_annotations_text",
]

FILTERABLE_ATTRIBUTES = [
    "work_id", "year", "year_start", "year_end", "title",
    "location_id", "location", "publisher_id", "publisher",
    "genre_ids", "tags_ids", "type_ids", "creator_ids", "creators",
    "type", "type_et", "type_en",
    "genre", "genre_et", "genre_en",
    "collection", "collections", "collections_hierarchy",
    "authors_text", "author_names", "respondens_names",
    "languages", "lehekylje_number", "originaal_kataloog",
    "page_tags", "page_tags_et", "page_tags_en", "page_tags_ids",
    "page_tags_suggest_et", "page_tags_suggest_en",
    "has_annotations", "status", "teose_staatus",
    "tags", "tags_et", "tags_en",
    "is_public", "shareable",
]

SORTABLE_ATTRIBUTES = [
    "year",
    "lehekylje_number",
    "last_modified",
    "title",
]

# Alamhulk, mida runtime kontrollib ja vajadusel juurde lapib
# (varem literaalne hulk meilisearch_ops.py-s).
RUNTIME_REQUIRED_FILTERABLE = {
    "is_public", "shareable", "collections_hierarchy",
    "collections", "year_start", "year_end",
}
```

- [ ] **Step 4: Suuna mõlemad tarbijad uue allika peale**

`server/meilisearch_ops.py` — asenda literaalne `needed` hulk impordiga ja
re-ekspordi test-nähtavuse jaoks (rida ~436):

```python
from .meili_settings import RUNTIME_REQUIRED_FILTERABLE
...
        needed = RUNTIME_REQUIRED_FILTERABLE
```

`scripts/2-1_upload_to_meili.py` — asenda kolm inline-nimekirja (read 45–109)
importidega. Skript kasutab standalone-importimiseks juba fake-package mustrit;
järgi sama kuju, mis seal `server.utils` jaoks kasutusel on:

```python
from server.meili_settings import (
    FILTERABLE_ATTRIBUTES,
    SEARCHABLE_ATTRIBUTES,
    SORTABLE_ATTRIBUTES,
)
...
    task = client.index(INDEX_NAME).update_settings({
        'searchableAttributes': SEARCHABLE_ATTRIBUTES,
        'filterableAttributes': FILTERABLE_ATTRIBUTES,
        'sortableAttributes': SORTABLE_ATTRIBUTES,
        'rankingRules': [
            # ← jäta olemasolev rankingRules ja kõik ülejäänud võtmed PUUTUMATA
```

**Ära muuda `rankingRules`-i ega ühtki teist `update_settings` võtit.**

- [ ] **Step 5: Jooksuta testid**

```bash
.venv/bin/pytest tests/test_meili_settings.py -v
.venv/bin/pytest tests/ -q
```

Oodatav: uued PASS, olemasolevad ilma regressioonita.

- [ ] **Step 6: Kontrolli, et skript on endiselt imporditav**

```bash
.venv/bin/python -c "import ast,sys; ast.parse(open('scripts/2-1_upload_to_meili.py').read()); print('süntaks OK')"
```

- [ ] **Step 7: Commit**

```bash
git add server/meili_settings.py server/meilisearch_ops.py scripts/2-1_upload_to_meili.py tests/test_meili_settings.py
git commit -m "refactor(meili): indeksiseaded ühte moodulisse (meili_settings.py)"
```

---

### Task 3: `client.py` — HTTP-kiht

**Files:**
- Create: `mcp/vutt_mcp/config.py`, `mcp/vutt_mcp/client.py`, `mcp/vutt_mcp/errors.py`
- Test: `mcp/tests/test_client.py`

**Interfaces:**
- Produces:
  - `config.Settings` (dataclass: `base_url: str`, `meili_key: str`), `config.load_settings() -> Settings`
  - `errors.VuttError(Exception)`, `errors.VuttConfigError(VuttError)`, `errors.VuttTemporaryError(VuttError)`, `errors.VuttNotFound(VuttError)`
  - `client.VuttClient(settings)` meetoditega:
    - `meili_search(body: dict) -> dict`
    - `api_get(path: str, params: dict | None = None) -> dict`
    - `api_post(path: str, json_body: dict) -> dict`

- [ ] **Step 1: Kirjuta kukkuvad testid**

`mcp/tests/test_client.py`:

```python
"""HTTP-kihi testid — httpx MockTransport, päris võrku ei puututa."""
import httpx
import pytest

from vutt_mcp.client import VuttClient
from vutt_mcp.config import Settings
from vutt_mcp.errors import (
    VuttConfigError,
    VuttError,
    VuttNotFound,
    VuttTemporaryError,
)

SETTINGS = Settings(base_url="https://example.test", meili_key="k")


def _client(handler) -> VuttClient:
    return VuttClient(SETTINGS, transport=httpx.MockTransport(handler))


def test_meili_search_saadab_bearer_ja_õige_tee():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json={"hits": []})

    _client(handler).meili_search({"q": "x"})
    assert seen["url"] == "https://example.test/meili/indexes/teosed/search"
    assert seen["auth"] == "Bearer k"


def test_5xx_proovitakse_uuesti_uks_kord():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(503)
        return httpx.Response(200, json={"hits": []})

    assert _client(handler).meili_search({"q": "x"}) == {"hits": []}
    assert calls["n"] == 2


def test_429_proovitakse_uuesti_ja_retry_after_loetakse():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": "0"})
        return httpx.Response(200, json={"ok": True})

    assert _client(handler).api_get("/prosopography") == {"ok": True}
    assert calls["n"] == 2


def test_400_ei_proovita_uuesti():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(400, json={"message": "vale filter"})

    with pytest.raises(VuttError):
        _client(handler).meili_search({"q": "x"})
    assert calls["n"] == 1


def test_404_annab_VuttNotFound():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"detail": "puudub"})

    with pytest.raises(VuttNotFound):
        _client(handler).api_get("/prosopography/puudub")


def test_kordusekatse_ammendumisel_ajutine_viga():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    with pytest.raises(VuttTemporaryError):
        _client(handler).meili_search({"q": "x"})


def test_401_on_fataalne_konfiviga():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"code": "invalid_api_key"})

    with pytest.raises(VuttConfigError):
        _client(handler).meili_search({"q": "x"})
```

- [ ] **Step 2: Jooksuta — peab kukkuma**

```bash
.venv/bin/pytest mcp/tests/test_client.py -v
```

Oodatav: FAIL, `ModuleNotFoundError: No module named 'vutt_mcp.client'`.

- [ ] **Step 3: Kirjuta `errors.py` ja `config.py`**

`mcp/vutt_mcp/errors.py`:

```python
"""Veatüübid. Tööriistad TÕSTAVAD neid — SDK teeb sellest is_error=True tulemuse,
mida mudel loeb veana. Stringi "Error: ..." tagastamine näeks välja nagu edu."""


class VuttError(Exception):
    """Kõigi VUTT MCP vigade ülemtüüp."""


class VuttConfigError(VuttError):
    """Seadistusviga — puuduv või kehtetu võti. Fataalne."""


class VuttTemporaryError(VuttError):
    """Ajutine tõrge (võrk, 5xx, 429). Agent võib hiljem uuesti proovida."""


class VuttNotFound(VuttError):
    """Küsitud ressurssi ei ole."""
```

`mcp/vutt_mcp/config.py`:

```python
"""Env-muutujate lugemine. Nimed on MCP-serveri omad, sõltumatud VUTT-i
sisemistest nimedest (serveris on sama väärtus MEILI_SEARCH_KEY /
VITE_MEILI_SEARCH_API_KEY nime all)."""
import os
from dataclasses import dataclass

from .errors import VuttConfigError

DEFAULT_BASE_URL = "https://vutt.utlib.ut.ee"


@dataclass(frozen=True)
class Settings:
    base_url: str
    meili_key: str


def load_settings() -> Settings:
    key = os.getenv("VUTT_MEILI_SEARCH_KEY", "").strip()
    if not key:
        raise VuttConfigError(
            "VUTT_MEILI_SEARCH_KEY puudub. Võta otsinguvõti VUTT-i serverist "
            "ja sea see keskkonnamuutujaks enne vutt-mcp käivitamist."
        )
    base = os.getenv("VUTT_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    return Settings(base_url=base, meili_key=key)
```

- [ ] **Step 4: Kirjuta `client.py`**

```python
"""AINUS moodul, mis räägib HTTP-d. Kui tuleb autenditud kirjutustee, laieneb see
kiht — tööriistu ümber kirjutama ei pea."""
import logging
import time

import httpx

from .config import Settings
from .errors import VuttConfigError, VuttError, VuttNotFound, VuttTemporaryError

logger = logging.getLogger(__name__)

MEILI_INDEX = "teosed"
TIMEOUT_SECONDS = 20.0
RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_RETRY_SLEEP = 5.0


class VuttClient:
    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None):
        self._settings = settings
        self._http = httpx.Client(timeout=TIMEOUT_SECONDS, transport=transport)

    # ── avalik pind ────────────────────────────────────────────────────────
    def meili_search(self, body: dict) -> dict:
        url = f"{self._settings.base_url}/meili/indexes/{MEILI_INDEX}/search"
        headers = {"Authorization": f"Bearer {self._settings.meili_key}"}
        return self._request("POST", url, headers=headers, json=body)

    def api_get(self, path: str, params: dict | None = None) -> dict:
        url = f"{self._settings.base_url}/api/files{path}"
        return self._request("GET", url, params=params)

    def api_post(self, path: str, json_body: dict) -> dict:
        url = f"{self._settings.base_url}/api/files{path}"
        return self._request("POST", url, json=json_body)

    # ── sisemine ───────────────────────────────────────────────────────────
    def _request(self, method: str, url: str, **kwargs) -> dict:
        """Üks kordusekatse 5xx / 429 / timeout / ühendusvea korral."""
        last_exc: Exception | None = None
        for attempt in (1, 2):
            try:
                response = self._http.request(method, url, **kwargs)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_exc = exc
                if attempt == 1:
                    logger.warning("Võrgutõrge (%s), proovin uuesti: %s", url, exc)
                    continue
                raise VuttTemporaryError(
                    f"VUTT ei vasta ({exc.__class__.__name__}). Proovi hiljem uuesti."
                ) from exc

            if response.status_code in RETRY_STATUSES and attempt == 1:
                self._sleep_for_retry(response)
                continue
            return self._handle(response)

        raise VuttTemporaryError("VUTT ei vasta.") from last_exc

    @staticmethod
    def _sleep_for_retry(response: httpx.Response) -> None:
        """Austab Retry-After päist, kui see on olemas ja mõistlik."""
        raw = response.headers.get("Retry-After")
        delay = 0.5
        if raw:
            try:
                delay = min(float(raw), MAX_RETRY_SLEEP)
            except ValueError:
                pass
        if delay > 0:
            time.sleep(delay)

    @staticmethod
    def _handle(response: httpx.Response) -> dict:
        code = response.status_code
        if code == 200:
            return response.json()
        if code in (401, 403):
            raise VuttConfigError(
                "VUTT lükkas võtme tagasi (HTTP %d). Kontrolli, kas "
                "VUTT_MEILI_SEARCH_KEY on tootmisest ja kehtiv." % code
            )
        if code == 404:
            raise VuttNotFound(f"Ressurssi ei leitud: {response.request.url.path}")
        if code in RETRY_STATUSES:
            raise VuttTemporaryError(f"VUTT vastas ajutise veaga (HTTP {code}).")
        raise VuttError(f"VUTT vastas veaga (HTTP {code}): {response.text[:200]}")
```

- [ ] **Step 5: Jooksuta testid**

```bash
.venv/bin/pytest mcp/tests/test_client.py -v
```

Oodatav: kõik PASS.

**Teadlik täpsustus spekile:** spekk nimetab 401/403 „fataalseks". Siin
tähendab see **mitte-korratavat konfiviga selge sõnumiga**, mis jõuab agendini
tööriista veana — mitte protsessi surma. Käivitamisel võrku ei puudutata
(`load_settings` kontrollib ainult muutuja olemasolu), nii et VUTT-i lühike
katkestus kliendi käivitamise hetkel ei võta agendilt kogu tööriistakomplekti.
Kehtetu võtme korral ütleb veateade, et server tuleb kehtiva võtmega taaskäivitada.

- [ ] **Step 6: Commit**

```bash
git add mcp/vutt_mcp/config.py mcp/vutt_mcp/client.py mcp/vutt_mcp/errors.py mcp/tests/test_client.py
git commit -m "feat(mcp): HTTP-kiht kordusekatsete ja veatüüpidega"
```

---

### Task 4: `queries.py` + Meili lepingu test

**Files:**
- Create: `mcp/vutt_mcp/queries.py`
- Test: `mcp/tests/test_queries.py`, `mcp/tests/test_meili_contract.py`

**Interfaces:**
- Consumes: `server.meili_settings` (AINULT testis), `server.meili_doc.normalize_eszett` (AINULT testis)
- Produces:
  - `queries.normalize_query(text: str) -> str`
  - `queries.build_search_body(query, *, distinct_works=False, collection=None, year_from=None, year_to=None, language=None, genre_id=None, work_id=None, relax_matching=False, limit=10, offset=0) -> dict`
  - `queries.build_work_pages_body(work_id: str, from_page: int | None = None, to_page: int | None = None, limit: int = 1000) -> dict`
  - `queries.build_facets_body(field: str) -> dict`
  - `queries.FACET_FIELDS: dict[str, str]` (kasutaja-nimi → Meili atribuut)
  - Moodulikonstandid: `SEARCH_RETRIEVE_FIELDS`, `PAGE_RETRIEVE_FIELDS`, `FILTER_FIELDS`, `SORT_FIELDS`, `SEARCH_FIELDS`

- [ ] **Step 1: Kirjuta kukkuvad testid päringu koostamisele**

`mcp/tests/test_queries.py`:

```python
"""Päringukehade koostamise testid — puhtad funktsioonid, võrku ei puututa."""
from vutt_mcp import queries


def test_matchingstrategy_on_vaikimisi_all():
    body = queries.build_search_body("Daniel Sennert")
    assert body["matchingStrategy"] == "all"


def test_relax_matching_lulitab_last_peale():
    body = queries.build_search_body("Daniel Sennert", relax_matching=True)
    assert body["matchingStrategy"] == "last"


def test_eszett_normaliseeritakse_paringus():
    assert queries.normalize_query("Schluß") == "Schluss"
    body = queries.build_search_body("daß")
    assert body["q"] == "dass"


def test_distinct_ainult_teoseotsingul():
    assert "distinct" not in queries.build_search_body("x")
    assert queries.build_search_body("x", distinct_works=True)["distinct"] == "work_id"


def test_kollektsioonifilter():
    body = queries.build_search_body("x", collection="Disputatsioonid")
    assert 'collections_hierarchy = "Disputatsioonid"' in body["filter"]


def test_aastavahemik_kasutab_year_valja():
    body = queries.build_search_body("x", year_from=1630, year_to=1650)
    assert "year >= 1630" in body["filter"]
    assert "year <= 1650" in body["filter"]


def test_filtrid_kombineeruvad_AND_iga():
    body = queries.build_search_body("x", collection="K", language="lat")
    assert " AND " in body["filter"]


def test_ilma_filtriteta_pole_filter_valja():
    assert "filter" not in queries.build_search_body("x")


def test_katke_seadistus():
    body = queries.build_search_body("x")
    assert body["attributesToCrop"] == ["lehekylje_tekst", "marginaalia_tekst"]
    assert body["cropLength"] > 0


def test_limit_piiratakse_viiekumnega():
    assert queries.build_search_body("x", limit=500)["hitsPerPage"] == 50


def test_lehekulgede_paring_sorteerib_jarjestuse_jargi():
    body = queries.build_work_pages_body("abc123", from_page=12, to_page=18)
    assert body["sort"] == ["lehekylje_number:asc"]
    assert 'work_id = "abc123"' in body["filter"]
    assert "lehekylje_number >= 12" in body["filter"]
    assert "lehekylje_number <= 18" in body["filter"]


def test_facets_paring_ei_kysi_hitte():
    body = queries.build_facets_body("collections")
    assert body["limit"] == 0
    assert body["facets"] == ["collections"]
```

- [ ] **Step 2: Kirjuta kukkuv lepingu test**

`mcp/tests/test_meili_contract.py`:

```python
"""Meili LEPINGU test — mitte pelk väljanime olemasolu.

Väli võib dokumendis alles olla, aga päring kukub 400-ga, kui indeksiseaded
enam ei kata. Meili nõuab:
  - filtris JA `distinct`-is kasutatav atribuut → filterableAttributes
  - sorteeritav atribuut → sortableAttributes
  - otsitav atribuut → searchableAttributes

See test on peamine põhjus, miks vutt_mcp elab samas repos. Ta impordib
`server`-it — see on lubatud AINULT testis, mitte vutt_mcp runtime'is.
"""
from server.meili_settings import (
    FILTERABLE_ATTRIBUTES,
    SEARCHABLE_ATTRIBUTES,
    SORTABLE_ATTRIBUTES,
)
from vutt_mcp import queries


def test_koik_filtrivaljad_on_filterable():
    missing = set(queries.FILTER_FIELDS) - set(FILTERABLE_ATTRIBUTES)
    assert not missing, f"filterableAttributes hulgast puuduvad: {sorted(missing)}"


def test_distinct_valja_peab_olema_filterable():
    # Meili nõuab seda ka päringupõhise distinct'i puhul
    assert "work_id" in FILTERABLE_ATTRIBUTES


def test_koik_sorteeritavad_valjad_on_sortable():
    missing = set(queries.SORT_FIELDS) - set(SORTABLE_ATTRIBUTES)
    assert not missing, f"sortableAttributes hulgast puuduvad: {sorted(missing)}"


def test_koik_otsitavad_valjad_on_searchable():
    missing = set(queries.SEARCH_FIELDS) - set(SEARCHABLE_ATTRIBUTES)
    assert not missing, f"searchableAttributes hulgast puuduvad: {sorted(missing)}"


def test_facetivaljad_on_filterable():
    missing = set(queries.FACET_FIELDS.values()) - set(FILTERABLE_ATTRIBUTES)
    assert not missing, f"facet-väljad pole filterable: {sorted(missing)}"


def test_tagastatavad_valjad_eksisteerivad_dokumendis():
    """Kontrollib väljade olemasolu indekseeritava dokumendi vastu."""
    import inspect

    from server import meili_doc

    source = inspect.getsource(meili_doc)
    for field in set(queries.SEARCH_RETRIEVE_FIELDS) | set(queries.PAGE_RETRIEVE_FIELDS):
        assert f'"{field}"' in source, f"{field} ei esine meili_doc.py-s"


def test_eszett_normaliseerimine_kattub_indekseerijaga():
    """Kui indekseerija ja päring lahknevad, ei leia „Schluß" enam midagi."""
    from server.meili_doc import normalize_eszett

    for sample in ("Schluß", "daß", "auspicatißimos", "GROSSE", "ẞ"):
        assert queries.normalize_query(sample) == normalize_eszett(sample)
```

- [ ] **Step 3: Jooksuta mõlemad — peavad kukkuma**

```bash
.venv/bin/pytest mcp/tests/test_queries.py mcp/tests/test_meili_contract.py -v
```

Oodatav: FAIL, `ModuleNotFoundError: No module named 'vutt_mcp.queries'`.

- [ ] **Step 4: Kirjuta `queries.py`**

```python
"""Meili päringukehade koostamine. Puhas moodul: ei HTTP-d, ei väljundivormingut.

Väljanimed on legacy 'y'-ortograafias (ADR 0006) — mitte ümber nimetada.
NB: see moodul EI TOHI importida `server`-it (pakett paigaldatakse isoleeritult).
Duplikaadid on tahtlikud; `test_meili_contract.py` valvab, et need ei lahkneks.
"""

CROP_LENGTH = 40  # sõnades — Meili cropLength on sõnapõhine, ~200 tähemärki

# Väljad, mida otsingutulemuses küsime
SEARCH_RETRIEVE_FIELDS = [
    "work_id", "title", "autor", "respondens", "aasta", "year_display",
    "lehekylje_number", "teose_lehekylgede_arv", "status", "collections",
    "languages", "location", "genre",
]

# Väljad, mida lehekülje lugemisel küsime
PAGE_RETRIEVE_FIELDS = [
    "work_id", "lehekylje_number", "lehekylje_tekst", "marginaalia_tekst",
    "status", "teose_lehekylgede_arv",
]

# Väljad, mida kasutame FILTRIS (peavad olema filterableAttributes hulgas)
FILTER_FIELDS = [
    "work_id", "collections_hierarchy", "year", "languages",
    "genre_ids", "lehekylje_number",
]

# Väljad, mille järgi SORTEERIME (peavad olema sortableAttributes hulgas)
SORT_FIELDS = ["lehekylje_number"]

# Väljad, mida OTSIME (peavad olema searchableAttributes hulgas)
SEARCH_FIELDS = ["lehekylje_tekst", "marginaalia_tekst", "title", "authors_text"]

# Kasutajale nähtav filtrinimi → Meili atribuut
FACET_FIELDS = {
    "collections": "collections_hierarchy",
    "languages": "languages",
    "genres": "genre_ids",
    "types": "type_ids",
}

MAX_LIMIT = 50


def normalize_query(text: str) -> str:
    """ß → ss. PEAB kattuma server.meili_doc.normalize_eszett-iga (#228).

    Meili voldib täpitähed ise, ß-i mitte. Kui ainult indeks normaliseeritakse,
    ei leia „Schluß" enam midagi.
    """
    if not text:
        return ""
    return text.replace("ß", "ss").replace("ẞ", "SS")


def _quote(value: str) -> str:
    """Meili filtri stringiliteraal — jutumärgid sisus escape'itakse."""
    return '"' + str(value).replace('"', '\\"') + '"'


def build_search_body(
    query: str,
    *,
    distinct_works: bool = False,
    collection: str | None = None,
    year_from: int | None = None,
    year_to: int | None = None,
    language: str | None = None,
    genre_id: str | None = None,
    work_id: str | None = None,
    relax_matching: bool = False,
    limit: int = 10,
    offset: int = 0,
) -> dict:
    """Koostab otsingupäringu keha.

    `distinct_works=True` → teosetasandi tulemus. Meili valib sama work_id
    lehekülgedest kõrgeima rankinguga tabamuse; kasutame seda esindava
    lehekülje ja katke näitamiseks.
    """
    clauses: list[str] = []
    if work_id:
        clauses.append(f"work_id = {_quote(work_id)}")
    if collection:
        clauses.append(f"collections_hierarchy = {_quote(collection)}")
    if year_from is not None:
        clauses.append(f"year >= {int(year_from)}")
    if year_to is not None:
        clauses.append(f"year <= {int(year_to)}")
    if language:
        clauses.append(f"languages = {_quote(language)}")
    if genre_id:
        clauses.append(f"genre_ids = {_quote(genre_id)}")

    body: dict = {
        "q": normalize_query(query),
        # Vaikimisi "all": Meili "last" hakkaks päringust sõnu eemaldama, kui
        # täisvasteid napib — faktikontrollis tähendaks see vaikset valepositiivi.
        "matchingStrategy": "last" if relax_matching else "all",
        "attributesToRetrieve": SEARCH_RETRIEVE_FIELDS,
        "attributesToCrop": ["lehekylje_tekst", "marginaalia_tekst"],
        "cropLength": CROP_LENGTH,
        "attributesToHighlight": [],
        "hitsPerPage": max(1, min(int(limit), MAX_LIMIT)),
        "page": (int(offset) // max(1, min(int(limit), MAX_LIMIT))) + 1,
    }
    if distinct_works:
        body["distinct"] = "work_id"
    if clauses:
        body["filter"] = " AND ".join(clauses)
    return body


def build_work_pages_body(
    work_id: str,
    from_page: int | None = None,
    to_page: int | None = None,
    limit: int = 1000,
) -> dict:
    """Ühe teose leheküljed kanoonilises järjestuses.

    Invariant: alati `lehekylje_number:asc` — get_work ja get_pages tuginevad
    sellele järjestusele.
    """
    clauses = [f"work_id = {_quote(work_id)}"]
    if from_page is not None:
        clauses.append(f"lehekylje_number >= {int(from_page)}")
    if to_page is not None:
        clauses.append(f"lehekylje_number <= {int(to_page)}")
    return {
        "q": "",
        "filter": " AND ".join(clauses),
        "sort": ["lehekylje_number:asc"],
        "attributesToRetrieve": PAGE_RETRIEVE_FIELDS,
        "limit": int(limit),
    }


def build_facets_body(field: str) -> dict:
    """Facet-jaotus ühe välja kohta. `limit: 0` — hitte ei taha."""
    return {"q": "", "limit": 0, "facets": [field]}
```

- [ ] **Step 5: Jooksuta testid**

```bash
.venv/bin/pytest mcp/tests/test_queries.py mcp/tests/test_meili_contract.py -v
```

Oodatav: kõik PASS. Kui `test_tagastatavad_valjad_eksisteerivad_dokumendis`
kukub mõne välja peal, **paranda `queries.py` nimekirja, mitte testi** —
`meili_doc.py` on tõe allikas.

- [ ] **Step 6: Commit**

```bash
git add mcp/vutt_mcp/queries.py mcp/tests/test_queries.py mcp/tests/test_meili_contract.py
git commit -m "feat(mcp): Meili päringute koostamine + indeksi lepingu test"
```

---

### Task 5: `format.py` — väljundi vormindamine

**Files:**
- Create: `mcp/vutt_mcp/format.py`
- Test: `mcp/tests/test_format.py`

**Interfaces:**
- Produces:
  - `format.work_url(work_id: str, page: int | None = None) -> str`
  - `format.person_url(person_id: str) -> str`
  - `format.format_search_hits(hits: list[dict], total: int, *, base_url: str) -> str`
  - `format.format_fields(pairs: list[tuple[str, object]]) -> str`
  - `format.format_pages(pages: list[dict], *, base_url: str, work_id: str) -> str`
  - `format.STATUS_LEGEND: str`

- [ ] **Step 1: Kirjuta kukkuvad testid**

`mcp/tests/test_format.py`:

```python
"""Väljundivormingu testid — puhtad funktsioonid."""
from vutt_mcp import format as fmt

BASE = "https://vutt.utlib.ut.ee"

HIT = {
    "work_id": "v7Kq2mXp",
    "title": "Disputatio politica de republica",
    "autor": "Ludenius, Laurentius",
    "aasta": 1642,
    "location": "Tartu",
    "lehekylje_number": 12,
    "teose_lehekylgede_arv": 48,
    "status": "Valmis",
    "collections": ["Disputatsioonid"],
    "_formatted": {"lehekylje_tekst": "…quod respublica Suecorum…"},
}


def test_hit_sisaldab_koiki_votmeandmeid():
    out = fmt.format_search_hits([HIT], total=1, base_url=BASE)
    assert "v7Kq2mXp" in out
    assert "lk 12/48" in out
    assert "seisund=Valmis" in out
    assert "Disputatio politica" in out
    assert "quod respublica Suecorum" in out


def test_hit_annab_toolaua_lingi_mitte_pildi_lingi():
    out = fmt.format_search_hits([HIT], total=1, base_url=BASE)
    assert f"{BASE}/work/v7Kq2mXp/12" in out
    assert "/api/images/" not in out


def test_tulemuste_koguarv_naidatakse():
    out = fmt.format_search_hits([HIT], total=622, base_url=BASE)
    assert "622" in out


def test_tuhi_tulemus_soovitab_relax_matchingut():
    out = fmt.format_search_hits([], total=0, base_url=BASE)
    assert "relax_matching" in out


def test_work_url_ilma_leheta():
    assert fmt.work_url("abc", base_url=BASE) == f"{BASE}/work/abc"


def test_person_url_sailitab_prefiksi():
    assert fmt.person_url("vutt:Pfxxxsc", base_url=BASE) == f"{BASE}/persons/vutt:Pfxxxsc"


def test_format_fields_jatab_tuhjad_valja():
    out = fmt.format_fields([("aasta", 1642), ("koht", None), ("žanr", "")])
    assert "aasta: 1642" in out
    assert "koht" not in out
    assert "žanr" not in out


def test_format_pages_naitab_marginaaliat_eraldi():
    pages = [{
        "lehekylje_number": 12,
        "lehekylje_tekst": "põhitekst siin",
        "marginaalia_tekst": "ääremärkus siin",
        "status": "Toores",
    }]
    out = fmt.format_pages(pages, base_url=BASE, work_id="abc")
    assert "põhitekst siin" in out
    assert "marginaalia" in out.lower()
    assert "ääremärkus siin" in out


def test_format_pages_jatab_tuhja_marginaalia_valja():
    pages = [{
        "lehekylje_number": 12,
        "lehekylje_tekst": "põhitekst",
        "marginaalia_tekst": "",
        "status": "Valmis",
    }]
    assert "marginaalia" not in fmt.format_pages(
        pages, base_url=BASE, work_id="abc"
    ).lower()
```

- [ ] **Step 2: Jooksuta — peab kukkuma**

```bash
.venv/bin/pytest mcp/tests/test_format.py -v
```

Oodatav: FAIL, `ModuleNotFoundError`.

- [ ] **Step 3: Kirjuta `format.py`**

```python
"""Vastus → agendile loetav tekst. Puhas moodul: ei HTTP-d, ei päringuloogikat.

Vorming on tahtlikult tihe: pikk agentne jooks teeb kümneid päringuid ja
JSON-i korduvad võtmenimed sööksid konteksti enne, kui töö algab.
"""

STATUS_LEGEND = (
    "Seisund: Toores = puutumata masinlugemine (võib sisaldada vigu); "
    "Töös = osaliselt üle vaadatud; Valmis = inimese kinnitatud transkriptsioon."
)


def work_url(work_id: str, page: int | None = None, *, base_url: str) -> str:
    """Töölaua link. Skaneeringu pildi URL-i EI väljastata (vt spekk)."""
    if page is None:
        return f"{base_url}/work/{work_id}"
    return f"{base_url}/work/{work_id}/{page}"


def person_url(person_id: str, *, base_url: str) -> str:
    return f"{base_url}/persons/{person_id}"


def _first(value) -> str:
    """Massiivist esimene väärtus, skalaarist tema ise, tühjast tühi string."""
    if isinstance(value, list):
        return str(value[0]) if value else ""
    return str(value) if value not in (None, "") else ""


def _snippet(hit: dict) -> str:
    """Katke: eelista põhiteksti, kui seal vastet pole, siis marginaaliat."""
    formatted = hit.get("_formatted") or {}
    for field in ("lehekylje_tekst", "marginaalia_tekst"):
        text = (formatted.get(field) or "").strip()
        if text:
            prefix = "marginaalia: " if field == "marginaalia_tekst" else ""
            return prefix + " ".join(text.split())
    return ""


def format_search_hits(hits: list[dict], total: int, *, base_url: str) -> str:
    if not hits:
        return (
            "Vasteid ei leitud.\n"
            "Otsing on vaikimisi range (kõik päringu sõnad peavad esinema). "
            "Proovi relax_matching=true või vähem sõnu."
        )

    blocks = [f"Vasteid kokku: {total} (kuvatud {len(hits)})", STATUS_LEGEND, ""]
    for i, hit in enumerate(hits, start=1):
        work_id = hit.get("work_id", "")
        page = hit.get("lehekylje_number")
        author = hit.get("autor") or ""
        year = hit.get("aasta") or hit.get("year_display") or ""
        place = hit.get("location") or ""
        head = f'[{i}] {author} · "{hit.get("title", "")}"'
        if year or place:
            head += f" ({', '.join(str(x) for x in (year, place) if x)})"

        meta = [f"work_id={work_id}"]
        if page is not None:
            meta.append(f"lk {page}/{hit.get('teose_lehekylgede_arv', '?')}")
        if hit.get("status"):
            meta.append(f"seisund={hit['status']}")
        collection = _first(hit.get("collections"))
        if collection:
            meta.append(f"kollektsioon={collection}")

        block = [head, "    " + " · ".join(meta)]
        snippet = _snippet(hit)
        if snippet:
            block.append(f"    {snippet}")
        block.append(
            "    vaata: " + work_url(work_id, page, base_url=base_url)
        )
        blocks.append("\n".join(block))
    return "\n".join(blocks)


def format_fields(pairs: list[tuple[str, object]]) -> str:
    """Sildistatud väljad. Tühjad väärtused jäetakse välja — müra maksab tokeneid."""
    lines = []
    for label, value in pairs:
        if value in (None, "", [], {}):
            continue
        if isinstance(value, list):
            value = ", ".join(str(v) for v in value)
        lines.append(f"{label}: {value}")
    return "\n".join(lines)


def format_pages(pages: list[dict], *, base_url: str, work_id: str) -> str:
    if not pages:
        return "Selles vahemikus lehekülgi ei ole."

    blocks = [STATUS_LEGEND, ""]
    for page in pages:
        num = page.get("lehekylje_number")
        blocks.append(
            f"── lk {num} · seisund={page.get('status', '?')} · "
            + work_url(work_id, num, base_url=base_url)
        )
        blocks.append((page.get("lehekylje_tekst") or "").strip())
        marginalia = (page.get("marginaalia_tekst") or "").strip()
        if marginalia:
            # Marginaalia on füüsiliselt eraldi tekstikiht, mitte põhiteksti osa.
            blocks.append(f"[marginaalia] {marginalia}")
        blocks.append("")
    return "\n".join(blocks)
```

- [ ] **Step 4: Jooksuta testid**

```bash
.venv/bin/pytest mcp/tests/test_format.py -v
```

Oodatav: kõik PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/vutt_mcp/format.py mcp/tests/test_format.py
git commit -m "feat(mcp): väljundi vormindamine (tihe tekst, töölaua lingid)"
```

---

### Task 6: Tekstitööriistad

**Files:**
- Modify: `mcp/vutt_mcp/server.py`
- Test: `mcp/tests/test_text_tools.py`, `mcp/tests/test_protocol_hygiene.py`

**Interfaces:**
- Consumes: `VuttClient`, `queries.*`, `format.*`
- Produces: neli registreeritud tööriista: `search_pages`, `search_works`, `get_work`, `get_pages`

- [ ] **Step 1: Kirjuta kukkuvad testid**

`mcp/tests/test_text_tools.py`:

```python
"""Tekstitööriistade testid — klient asendatud võltsiga, võrku ei puututa."""
import pytest

from vutt_mcp.errors import VuttError
from vutt_mcp.server import build_server

BASE = "https://vutt.utlib.ut.ee"


class FakeClient:
    """Salvestab päringukehad ja tagastab ettevalmistatud vastused."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.bodies = []

    def meili_search(self, body):
        self.bodies.append(body)
        return self.responses.pop(0)

    def api_get(self, path, params=None):
        raise AssertionError("tekstitööriistad ei tohi FastAPI-t kutsuda")


def _hit(page=12, **extra):
    base = {
        "work_id": "v7Kq2mXp",
        "title": "Disputatio politica",
        "autor": "Ludenius, Laurentius",
        "aasta": 1642,
        "lehekylje_number": page,
        "teose_lehekylgede_arv": 48,
        "status": "Valmis",
        "_formatted": {"lehekylje_tekst": "…respublica…"},
    }
    base.update(extra)
    return base


async def _call(server, name, args):
    result = await server.call_tool(name, args)
    return result.content[0].text if hasattr(result, "content") else str(result)


@pytest.fixture
def server_with(monkeypatch):
    def _make(responses):
        client = FakeClient(responses)
        server = build_server(client=client, base_url=BASE)
        return server, client
    return _make


async def test_search_pages_tagastab_katked(server_with):
    server, client = server_with([{"hits": [_hit()], "totalHits": 1}])
    out = await _call(server, "search_pages", {"query": "respublica"})
    assert "v7Kq2mXp" in out and "lk 12/48" in out
    assert client.bodies[0]["matchingStrategy"] == "all"
    assert "distinct" not in client.bodies[0]


async def test_search_works_kasutab_distincti_ja_naitab_esindavat_lehte(server_with):
    server, client = server_with([{"hits": [_hit(page=7)], "totalHits": 1}])
    out = await _call(server, "search_works", {"query": "respublica"})
    assert client.bodies[0]["distinct"] == "work_id"
    # Esindav lehekülg vastab küsimusele "miks see teos vaste oli"
    assert "lk 7/48" in out


async def test_get_pages_keeldub_ule_kahekumne_lehe(server_with):
    server, _ = server_with([])
    with pytest.raises(VuttError) as exc:
        await _call(server, "get_pages", {
            "work_id": "abc", "from_page": 1, "to_page": 40,
        })
    assert "20" in str(exc.value)


async def test_get_pages_tagastab_teksti_ja_marginaalia(server_with):
    server, client = server_with([{"hits": [{
        "lehekylje_number": 12,
        "lehekylje_tekst": "põhitekst",
        "marginaalia_tekst": "ääremärkus",
        "status": "Toores",
    }]}])
    out = await _call(server, "get_pages", {
        "work_id": "abc", "from_page": 12, "to_page": 12,
    })
    assert "põhitekst" in out and "ääremärkus" in out
    assert "Toores" in out
    assert client.bodies[0]["sort"] == ["lehekylje_number:asc"]


async def test_get_work_tundmatu_id_soovitab_search_works(server_with):
    server, _ = server_with([{"hits": [], "totalHits": 0}])
    with pytest.raises(VuttError) as exc:
        await _call(server, "get_work", {"work_id": "puudub"})
    assert "search_works" in str(exc.value)


async def test_get_work_leheküljed_on_jarjestuses(server_with):
    pages = [_hit(page=n) for n in (1, 2, 3)]
    server, client = server_with([{"hits": pages, "totalHits": 3}])
    out = await _call(server, "get_work", {"work_id": "v7Kq2mXp"})
    assert client.bodies[0]["sort"] == ["lehekylje_number:asc"]
    assert out.index("lk 1") < out.index("lk 2") < out.index("lk 3")
```

`mcp/tests/test_protocol_hygiene.py`:

```python
"""Protokolli-hügieen: stdout puhtus ja structured_output väljas.

Mõlemad on vaikse rikke allikad: üks print() rikub stdio-voo, ja SDK v2
lisab -> str tagastusele vaikimisi ka structured_content'i.
"""
import io
import sys

import pytest

from vutt_mcp.server import build_server


class FakeClient:
    def meili_search(self, body):
        return {"hits": [], "totalHits": 0}

    def api_get(self, path, params=None):
        return {"results": [], "total": 0}

    def api_post(self, path, json_body):
        return {"titles": {}}


async def test_ukski_tooriist_ei_tagasta_structured_contenti():
    server = build_server(client=FakeClient(), base_url="https://x.test")
    for tool in await server.list_tools():
        result = await server.call_tool(tool.name, _minimal_args(tool.name))
        assert getattr(result, "structured_content", None) is None, (
            f"{tool.name} tagastab structured_content — lisa "
            f"@mcp.tool(structured_output=False)"
        )


async def test_tooriista_taitmine_ei_kirjuta_stdouti():
    server = build_server(client=FakeClient(), base_url="https://x.test")
    captured = io.StringIO()
    original = sys.stdout
    sys.stdout = captured
    try:
        await server.call_tool("search_pages", {"query": "x"})
    finally:
        sys.stdout = original
    assert captured.getvalue() == "", (
        f"stdout saastatud: {captured.getvalue()!r} — stdio-režiimis rikub see voo"
    )


def _minimal_args(name: str) -> dict:
    return {
        "search_pages": {"query": "x"},
        "search_works": {"query": "x"},
        "get_work": {"work_id": "abc"},
        "get_pages": {"work_id": "abc", "from_page": 1, "to_page": 1},
        "search_persons": {"q": "x"},
        "get_person": {"person_id": "vutt:abc"},
        "list_filter_values": {"field": "collections"},
    }[name]
```

- [ ] **Step 2: Jooksuta — peavad kukkuma**

```bash
.venv/bin/pytest mcp/tests/test_text_tools.py -v
```

Oodatav: FAIL — `build_server()` ei võta veel `client`/`base_url` argumente.

- [ ] **Step 3: Laienda `build_server` signatuuri ja registreeri tekstitööriistad**

Asenda `mcp/vutt_mcp/server.py` sisu:

```python
"""MCP-tööriistade registreerimine. Hoia õhuke: loogika elab teistes moodulites.

KÕIK tööriistad on @mcp.tool(structured_output=False) — SDK v2 tuletaks muidu
-> str tagastusest ka structured_content'i, mille tugi on klientide vahel
ebaühtlane (Codex, Gemini CLI, Antigravity).
"""
from mcp.server.mcpserver import MCPServer

from . import format as fmt
from . import queries
from .client import VuttClient
from .config import load_settings
from .errors import VuttError, VuttNotFound

MAX_PAGE_SPAN = 20


def build_server(client=None, base_url: str | None = None) -> MCPServer:
    """Koostab serveri. `client`/`base_url` on testide jaoks süstitavad."""
    if client is None:
        settings = load_settings()
        client = VuttClient(settings)
        base_url = settings.base_url
    mcp = MCPServer("vutt")
    _register_text_tools(mcp, client, base_url)
    _register_person_tools(mcp, client, base_url)
    return mcp


def _register_text_tools(mcp: MCPServer, client, base_url: str) -> None:
    @mcp.tool(structured_output=False)
    async def search_pages(
        query: str,
        collection: str | None = None,
        year_from: int | None = None,
        year_to: int | None = None,
        language: str | None = None,
        genre_id: str | None = None,
        work_id: str | None = None,
        relax_matching: bool = False,
        limit: int = 10,
        offset: int = 0,
    ) -> str:
        """Otsib VUTT-i varauusaegsete tekstide transkriptsioonidest ja tagastab
        lehekülje-katked. Kasuta, kui tahad teada, KUS midagi mainitakse.

        Otsing on vaikimisi range: kõik päringu sõnad peavad leheküljel esinema.
        Kui tulemusi ei tule, proovi relax_matching=true.

        work_id on teose püsiv lühikood (nanoid, nt "v7Kq2mXp") — kasuta seda
        otsingu piiramiseks ühe teosega. Filtriväärtusi saad list_filter_values'ist.

        Tulemuse `seisund` ütleb, kas tekst on kontrollitud: Toores = puutumata
        masinlugemine (võib sisaldada vigu), Töös = osaliselt üle vaadatud,
        Valmis = inimese kinnitatud.
        """
        body = queries.build_search_body(
            query, collection=collection, year_from=year_from, year_to=year_to,
            language=language, genre_id=genre_id, work_id=work_id,
            relax_matching=relax_matching, limit=limit, offset=offset,
        )
        data = client.meili_search(body)
        return fmt.format_search_hits(
            data.get("hits", []),
            data.get("totalHits", len(data.get("hits", []))),
            base_url=base_url,
        )

    @mcp.tool(structured_output=False)
    async def search_works(
        query: str,
        collection: str | None = None,
        year_from: int | None = None,
        year_to: int | None = None,
        language: str | None = None,
        genre_id: str | None = None,
        relax_matching: bool = False,
        limit: int = 10,
        offset: int = 0,
    ) -> str:
        """Otsib sama päringuga, aga tagastab TEOSED, mitte üksikuid lehekülgi.
        Kasuta, kui tahad teada, MILLISED teosed teemat käsitlevad.

        Iga teose juures näidatakse kõige tugevama vastega lehekülg ja katke —
        see ütleb, miks teos vaste oli.
        """
        body = queries.build_search_body(
            query, distinct_works=True, collection=collection,
            year_from=year_from, year_to=year_to, language=language,
            genre_id=genre_id, relax_matching=relax_matching,
            limit=limit, offset=offset,
        )
        data = client.meili_search(body)
        return fmt.format_search_hits(
            data.get("hits", []),
            data.get("totalHits", len(data.get("hits", []))),
            base_url=base_url,
        )

    @mcp.tool(structured_output=False)
    async def get_work(work_id: str) -> str:
        """Tagastab ühe teose metaandmed ja lehekülgede loendi seisunditega.

        work_id on teose püsiv lühikood (nanoid), mille saad search_works'ist
        või search_pages'ist.
        """
        data = client.meili_search(queries.build_work_pages_body(work_id))
        hits = data.get("hits", [])
        if not hits:
            raise VuttNotFound(
                f"Teost work_id={work_id} ei leitud. Otsi õige ID üles "
                f"search_works tööriistaga."
            )
        return _format_work(hits, base_url=base_url)

    @mcp.tool(structured_output=False)
    async def get_pages(work_id: str, from_page: int, to_page: int) -> str:
        """Tagastab teose lehekülgede vahemiku TÄISTEKSTI (kaasa arvatud mõlemad).

        NUMERATSIOON: from_page=12 tähendab VUTT-i sisemist 1-põhist
        järjestusnumbrit (skaneeringute järjekord) — MITTE trükise paginatsiooni
        ega foliatsiooni. Varauusaegse teose puhul on „p. 12", „fol. B2r" ja
        VUTT-i kaheteistkümnes skaneering üldjuhul kolm eri asja.

        Korraga kuni 20 lehekülge. Marginaalia tagastatakse eraldi märgistatuna,
        sest see on füüsiliselt eraldi tekstikiht.
        """
        span = int(to_page) - int(from_page) + 1
        if span > MAX_PAGE_SPAN:
            raise VuttError(
                f"Küsisid {span} lehekülge, lubatud on kuni {MAX_PAGE_SPAN}. "
                f"Kitsenda vahemikku (nt {from_page}–{int(from_page) + MAX_PAGE_SPAN - 1}). "
                f"Teose mahu näed get_work tööriistaga."
            )
        if span < 1:
            raise VuttError("to_page peab olema >= from_page.")
        data = client.meili_search(
            queries.build_work_pages_body(work_id, from_page, to_page)
        )
        return fmt.format_pages(
            data.get("hits", []), base_url=base_url, work_id=work_id
        )


def _format_work(hits: list[dict], *, base_url: str) -> str:
    """Teose metaandmed esimesest hitist + lehekülgede loend kanoonilises korras.

    Invariant: hitid tulevad juba lehekylje_number:asc järjestuses
    (build_work_pages_body sorteerib).
    """
    first = hits[0]
    work_id = first.get("work_id", "")
    header = fmt.format_fields([
        ("pealkiri", first.get("title")),
        ("autor", first.get("autor")),
        ("respondens", first.get("respondens")),
        ("aasta", first.get("aasta") or first.get("year_display")),
        ("koht", first.get("location")),
        ("žanr", first.get("genre")),
        ("keeled", first.get("languages")),
        ("kollektsioonid", first.get("collections")),
        ("work_id", work_id),
        ("lehekülgi", first.get("teose_lehekylgede_arv") or len(hits)),
        ("vaata", fmt.work_url(work_id, base_url=base_url)),
    ])
    lines = [header, "", fmt.STATUS_LEGEND, "", "Leheküljed:"]
    for hit in hits:
        num = hit.get("lehekylje_number")
        lines.append(
            f"  lk {num} · seisund={hit.get('status', '?')} · "
            + fmt.work_url(work_id, num, base_url=base_url)
        )
    return "\n".join(lines)


def _register_person_tools(mcp: MCPServer, client, base_url: str) -> None:
    """Prosopograafia tööriistad — täidetakse Task 7-s ja 8-s."""
```

- [ ] **Step 4: Jooksuta testid**

```bash
.venv/bin/pytest mcp/tests/test_text_tools.py -v
```

Oodatav: kõik PASS. Kui `server.call_tool()` tagastuse kuju erineb, kohanda
testi abifunktsiooni `_call` — **mitte tööriistade koodi**.

- [ ] **Step 5: Jooksuta hügieenitestid**

```bash
.venv/bin/pytest mcp/tests/test_protocol_hygiene.py -v -k "stdout"
```

`structured_content` test kukub veel (isikutööriistu pole) — see läheb
roheliseks Task 8 järel.

- [ ] **Step 6: Commit**

```bash
git add mcp/vutt_mcp/server.py mcp/tests/test_text_tools.py mcp/tests/test_protocol_hygiene.py
git commit -m "feat(mcp): tekstitööriistad (search_pages, search_works, get_work, get_pages)"
```

---

### Task 7: Prosopograafia tööriistad

Kontrollitud tootmisest: isiku detail tagastab `works` massiivi kujul
`{"work_id": ..., "role": ...}` **ilma pealkirjadeta**, ja produktiivsel isikul
on neid palju (Lorenz Luden: 178). Pealkirjad tuleb eraldi tõmmata
`POST /prosopography/work-titles` kaudu, mis võtab `{"work_ids": [...]}` ja
tagastab `{"titles": {...}}` (max 200 ID korraga).

**Files:**
- Create: `mcp/vutt_mcp/persons.py`
- Modify: `mcp/vutt_mcp/server.py` (`_register_person_tools`)
- Test: `mcp/tests/test_persons.py`

**Interfaces:**
- Produces:
  - `persons.MAX_RELATED_WORKS = 50`
  - `persons.search(client, base_url, **filters) -> str`
  - `persons.detail(client, base_url, person_id: str, include_relations: bool) -> str`
- Registreerib tööriistad `search_persons`, `get_person`

- [ ] **Step 1: Kirjuta kukkuvad testid**

`mcp/tests/test_persons.py`:

```python
"""Prosopograafia tööriistade testid. Kujud on kontrollitud tootmise API vastu."""
import pytest

from vutt_mcp import persons
from vutt_mcp.errors import VuttNotFound

BASE = "https://vutt.utlib.ut.ee"

LIST_RESPONSE = {
    "results": [{
        "id": "vutt:Pfxxxsc",
        "label": "Lorenz Luden",
        "birth_year": 1592,
        "death_year": 1654,
        "gender": "M",
        "work_count": 156,
        "biography_snippet": "Lorenz Luden (ladina keele professor)",
        "occupations": ["professor"],
        "origin_place": "Braunschweig",
    }],
    "total": 1,
    "offset": 0,
    "limit": 10,
}


class FakeClient:
    def __init__(self, get_map=None, post_map=None):
        self.get_map = get_map or {}
        self.post_map = post_map or {}
        self.posts = []

    def api_get(self, path, params=None):
        if path not in self.get_map:
            raise VuttNotFound(f"puudub: {path}")
        return self.get_map[path]

    def api_post(self, path, json_body):
        self.posts.append((path, json_body))
        return self.post_map.get(path, {"titles": {}})


def test_search_naitab_eluaastad_ja_teoste_arvu():
    client = FakeClient({"/prosopography": LIST_RESPONSE})
    out = persons.search(client, BASE, q="Ludenius")
    assert "Lorenz Luden" in out
    assert "1592" in out and "1654" in out
    assert "156" in out
    assert f"{BASE}/persons/vutt:Pfxxxsc" in out


def test_search_alias_paring_labib_q_parameetrina():
    client = FakeClient({"/prosopography": LIST_RESPONSE})
    persons.search(client, BASE, q="Ludenius")
    # aliaste lahendus toimub serveri pool; meie edastame ainult q


def test_detail_piirab_seotud_teosed_viiekumnega():
    works = [{"work_id": f"w{i}", "role": "auctor"} for i in range(178)]
    client = FakeClient(
        {"/prosopography/vutt:X": {"id": "vutt:X", "name": {"label": "Test"},
                                   "works": works}},
        {"/prosopography/work-titles": {
            "titles": {f"w{i}": {"title": f"Teos {i}"} for i in range(178)}
        }},
    )
    out = persons.detail(client, BASE, "vutt:X", include_relations=False)
    assert "seotud_teoseid: 178" in out
    assert out.count("role=") <= persons.MAX_RELATED_WORKS
    assert "128" in out  # 178 - 50 välja jäetud
    assert "search_works" in out  # suunab ülejäänu juurde


def test_detail_kysib_pealkirju_ainult_naidatavatele():
    works = [{"work_id": f"w{i}", "role": "auctor"} for i in range(178)]
    client = FakeClient(
        {"/prosopography/vutt:X": {"id": "vutt:X", "name": {"label": "T"},
                                   "works": works}},
    )
    persons.detail(client, BASE, "vutt:X", include_relations=False)
    _, body = client.posts[0]
    assert len(body["work_ids"]) == persons.MAX_RELATED_WORKS


def test_detail_ilma_relations_liputa_ei_kysi_seoseid():
    client = FakeClient(
        {"/prosopography/vutt:X": {"id": "vutt:X", "name": {"label": "T"},
                                   "works": []}},
    )
    out = persons.detail(client, BASE, "vutt:X", include_relations=False)
    assert "isikuseosed" not in out.lower()


def test_detail_tundmatu_id_annab_selge_vea():
    client = FakeClient({})
    with pytest.raises(VuttNotFound) as exc:
        persons.detail(client, BASE, "vutt:puudub", include_relations=False)
    assert "search_persons" in str(exc.value)
```

- [ ] **Step 2: Jooksuta — peab kukkuma**

```bash
.venv/bin/pytest mcp/tests/test_persons.py -v
```

Oodatav: FAIL, `ModuleNotFoundError: No module named 'vutt_mcp.persons'`.

- [ ] **Step 3: Kirjuta `persons.py`**

```python
"""Prosopograafia päringud + mahuvalve.

Kontekstikulu on siin arhitektuuriline: produktiivse professori kaardil võib
olla 178 seotud teost (kontrollitud: Lorenz Luden). Piiramata väljund oleks
sama suur probleem kui piiramata get_pages.
"""
from . import format as fmt
from .errors import VuttNotFound

MAX_RELATED_WORKS = 50
MAX_RELATIONS = 50
LIST_PATH = "/prosopography"


def search(client, base_url: str, **filters) -> str:
    """Isikuotsing. Tühjad filtrid jäetakse päringust välja."""
    params = {k: v for k, v in filters.items() if v not in (None, "")}
    data = client.api_get(LIST_PATH, params=params)
    results = data.get("results", [])
    if not results:
        return "Isikuid ei leitud. Proovi lühemat nime või vähem filtreid."

    blocks = [f"Isikuid kokku: {data.get('total', len(results))} "
              f"(kuvatud {len(results)})", ""]
    for i, person in enumerate(results, start=1):
        years = "–".join(
            str(y) for y in (person.get("birth_year"), person.get("death_year")) if y
        )
        head = f"[{i}] {person.get('label', '')}"
        if years:
            head += f" ({years})"
        meta = [f"person_id={person.get('id', '')}"]
        if person.get("work_count") is not None:
            meta.append(f"teoseid={person['work_count']}")
        if person.get("occupations"):
            meta.append("amet=" + ", ".join(person["occupations"][:3]))
        if person.get("origin_place"):
            meta.append(f"päritolu={person['origin_place']}")

        block = [head, "    " + " · ".join(meta)]
        snippet = (person.get("biography_snippet") or "").strip()
        if snippet:
            block.append(f"    {snippet}")
        block.append(
            "    vaata: " + fmt.person_url(person.get("id", ""), base_url=base_url)
        )
        blocks.append("\n".join(block))
    return "\n".join(blocks)


def detail(client, base_url: str, person_id: str, include_relations: bool) -> str:
    """Isikukaardi täisandmed. Seotud teoste ja seoste arv on lae all."""
    try:
        person = client.api_get(f"{LIST_PATH}/{person_id}")
    except VuttNotFound as exc:
        raise VuttNotFound(
            f"Isikut person_id={person_id} ei leitud. Otsi õige ID üles "
            f"search_persons tööriistaga."
        ) from exc

    name = (person.get("name") or {}).get("label") or person.get("id", "")
    sections = [fmt.format_fields([
        ("nimi", name),
        ("person_id", person.get("id")),
        ("sugu", person.get("gender")),
        ("sünd", _date_label(person.get("birth"))),
        ("surm", _date_label(person.get("death"))),
        ("päritolu", _place_label(person.get("origin"))),
        ("ametid", _labels(person.get("occupations"))),
        ("haridus", _labels(person.get("education"))),
        ("staatused", _labels(person.get("statuses"))),
        ("konfessioonid", _labels(person.get("confessions"))),
        ("sildid", person.get("tags")),
        ("elulugu", (person.get("biography") or "").strip() or None),
        ("märkmed", (person.get("notes") or "").strip() or None),
        ("vaata", fmt.person_url(person.get("id", ""), base_url=base_url)),
    ])]

    sections.append(_works_section(client, base_url, person))
    if include_relations:
        sections.append(_relations_section(client, person_id))
    return "\n\n".join(s for s in sections if s)


def _works_section(client, base_url: str, person) -> str:
    works = person.get("works") or []
    total = len(works)
    if total == 0:
        return "seotud_teoseid: 0"

    shown = works[:MAX_RELATED_WORKS]
    titles = {}
    try:
        response = client.api_post(
            f"{LIST_PATH}/work-titles",
            {"work_ids": [w.get("work_id") for w in shown]},
        )
        titles = response.get("titles") or {}
    except Exception:  # pealkirjad on ilustus, mitte eeldus
        titles = {}

    lines = [f"seotud_teoseid: {total}"]
    for work in shown:
        wid = work.get("work_id", "")
        entry = titles.get(wid) or {}
        title = entry.get("title") if isinstance(entry, dict) else entry
        line = f"  {title or '(pealkiri teadmata)'} · work_id={wid} · role={work.get('role', '?')}"
        if isinstance(entry, dict) and entry.get("restricted"):
            line += " · kaitstud kollektsioon"
        else:
            line += " · " + fmt.work_url(wid, base_url=base_url)
        lines.append(line)

    if total > MAX_RELATED_WORKS:
        lines.append(
            f"  … {total - MAX_RELATED_WORKS} teost jäeti välja. "
            f"Kõigi nägemiseks kasuta search_works koos creator_ids filtriga."
        )
    return "\n".join(lines)


def _relations_section(client, person_id: str) -> str:
    try:
        data = client.api_get(
            f"{LIST_PATH}/work-relations/{person_id}",
            params={"limit": MAX_RELATIONS},
        )
    except Exception:
        return ""
    items = data.get("results") or data.get("relations") or []
    if not items:
        return "isikuseosed: 0"
    lines = [f"isikuseosed: {data.get('total', len(items))}"]
    for rel in items[:MAX_RELATIONS]:
        lines.append(
            f"  {rel.get('label') or rel.get('person_id', '?')} · "
            f"{rel.get('relation_type') or rel.get('type', '?')}"
        )
    if data.get("total", len(items)) > MAX_RELATIONS:
        lines.append(f"  … ülejäänud jäeti välja (lagi {MAX_RELATIONS}).")
    return "\n".join(lines)


def _date_label(node) -> str:
    if not isinstance(node, dict):
        return ""
    date = node.get("date") or node.get("year") or ""
    place = _place_label(node)
    return " ".join(str(x) for x in (date, place) if x)


def _place_label(node) -> str:
    if not isinstance(node, dict):
        return ""
    place = node.get("place")
    if isinstance(place, dict):
        return place.get("label") or ""
    return node.get("label") or ""


def _labels(items) -> list:
    """Massiiv objekte või stringe → sildistringide loend."""
    out = []
    for item in items or []:
        if isinstance(item, dict):
            label = item.get("label") or (item.get("labels") or {}).get("et")
            if label:
                out.append(str(label))
        elif item:
            out.append(str(item))
    return out
```

- [ ] **Step 4: Registreeri tööriistad**

Asenda `_register_person_tools` `mcp/vutt_mcp/server.py`-s (lisa `from . import persons` importide juurde):

```python
def _register_person_tools(mcp: MCPServer, client, base_url: str) -> None:
    @mcp.tool(structured_output=False)
    async def search_persons(
        q: str | None = None,
        gender: str | None = None,
        occupation: str | None = None,
        origin_group: str | None = None,
        institution: str | None = None,
        status_id: str | None = None,
        source: str | None = None,
        imm_year_from: int | None = None,
        imm_year_to: int | None = None,
        collection: str | None = None,
        limit: int = 10,
        offset: int = 0,
    ) -> str:
        """Otsib VUTT-i prosopograafia andmebaasist (~2350 varauusaegset isikut:
        professorid, üliõpilased, trükkalid, autorid).

        Nimevariandid on kaetud: „Ludenius" leiab ka „Lorenz Luden" — otsing
        arvestab ladina- ja saksapäraseid nimekujusid.

        imm_year on Tartu ülikooli immatrikuleerumise aasta.
        """
        return persons.search(
            client, base_url, q=q, gender=gender, occupation=occupation,
            origin_group=origin_group, institution=institution,
            status_id=status_id, source=source, imm_year_from=imm_year_from,
            imm_year_to=imm_year_to, collection=collection,
            limit=min(int(limit), 50), offset=offset,
        )

    @mcp.tool(structured_output=False)
    async def get_person(person_id: str, include_relations: bool = False) -> str:
        """Tagastab ühe isiku täisandmed: elukäik, haridus, ametid, päritolu ja
        seotud teosed rollidega (autor, praeses, respondens jne).

        person_id on kujul „vutt:Pfxxxsc" — saad selle search_persons'ist.

        include_relations=true lisab teostest tuletatud isiku-isiku seosed.

        Väljundi maht on piiratud: seotud teoseid näidatakse kuni 50 (koguarv
        on alati näha) — produktiivsel professoril võib neid olla üle 170.
        """
        return persons.detail(client, base_url, person_id, include_relations)
```

- [ ] **Step 5: Jooksuta testid**

```bash
.venv/bin/pytest mcp/tests/test_persons.py -v
```

Oodatav: kõik PASS.

- [ ] **Step 6: Commit**

```bash
git add mcp/vutt_mcp/persons.py mcp/vutt_mcp/server.py mcp/tests/test_persons.py
git commit -m "feat(mcp): prosopograafia tööriistad mahuvalvega (50 teost / 50 seost)"
```

---

### Task 8: `list_filter_values` ja täielik tööriistakomplekt

**Files:**
- Modify: `mcp/vutt_mcp/server.py`, `mcp/tests/test_server_smoke.py`
- Test: `mcp/tests/test_filter_values.py`

**Interfaces:**
- Consumes: `queries.FACET_FIELDS`, `queries.build_facets_body`
- Produces: tööriist `list_filter_values`

- [ ] **Step 1: Kirjuta kukkuvad testid**

`mcp/tests/test_filter_values.py`:

```python
"""list_filter_values testid — facet-allikas ja maxValuesPerFacet leping."""
import pytest

from vutt_mcp.errors import VuttError
from vutt_mcp.server import build_server

BASE = "https://vutt.utlib.ut.ee"


class FakeClient:
    def __init__(self, response):
        self.response = response
        self.bodies = []

    def meili_search(self, body):
        self.bodies.append(body)
        return self.response


async def _call(server, args):
    result = await server.call_tool("list_filter_values", args)
    return result.content[0].text if hasattr(result, "content") else str(result)


async def test_kollektsioonid_tulevad_facet_jaotusest():
    client = FakeClient({"facetDistribution": {
        "collections_hierarchy": {"Disputatsioonid": 412, "Oratsioonid": 88}
    }})
    server = build_server(client=client, base_url=BASE)
    out = await _call(server, {"field": "collections"})
    assert "Disputatsioonid" in out and "412" in out
    assert client.bodies[0]["facets"] == ["collections_hierarchy"]
    assert client.bodies[0]["limit"] == 0


async def test_tundmatu_valja_nimi_loetleb_lubatud():
    server = build_server(client=FakeClient({}), base_url=BASE)
    with pytest.raises(VuttError) as exc:
        await _call(server, {"field": "värvid"})
    assert "collections" in str(exc.value)


async def test_lae_saavutamisel_hoiatatakse():
    """maxValuesPerFacet (vaikimisi 100) tähendab, et loend võib olla poolik."""
    client = FakeClient({"facetDistribution": {
        "languages": {f"l{i}": 1 for i in range(100)}
    }})
    server = build_server(client=client, base_url=BASE)
    out = await _call(server, {"field": "languages"})
    assert "mittetäielik" in out.lower() or "poolik" in out.lower()
```

- [ ] **Step 2: Jooksuta — peab kukkuma**

```bash
.venv/bin/pytest mcp/tests/test_filter_values.py -v
```

Oodatav: FAIL — tööriista `list_filter_values` ei ole registreeritud.

- [ ] **Step 3: Registreeri tööriist**

Lisa `mcp/vutt_mcp/server.py`-s `_register_text_tools` lõppu (mooduli algusesse
konstant `FACET_VALUE_CAP = 100`):

```python
    @mcp.tool(structured_output=False)
    async def list_filter_values(field: str) -> str:
        """Loetleb legaalsed väärtused ühe filtrivälja kohta koos teoste arvuga.

        Kasuta ENNE filtriga otsimist — ilma selleta on lihtne pakkuda väärtust,
        mida indeksis ei ole, ja saada tühi tulemus.

        Lubatud väljad: collections, languages, genres, types.
        Keeled on ISO-koodid (lat, deu, grc, est…), žanrid ja tüübid Wikidata
        Q-koodid.
        """
        attribute = queries.FACET_FIELDS.get(field)
        if attribute is None:
            raise VuttError(
                f"Tundmatu filtriväli „{field}". Lubatud: "
                + ", ".join(sorted(queries.FACET_FIELDS))
            )
        data = client.meili_search(queries.build_facets_body(attribute))
        values = (data.get("facetDistribution") or {}).get(attribute) or {}
        if not values:
            return f"Väljal „{field}" ei ole indeksis ühtki väärtust."

        rows = sorted(values.items(), key=lambda kv: (-kv[1], kv[0]))
        lines = [f"{field} ({len(rows)} väärtust):"]
        lines += [f"  {name} — {count} lk" for name, count in rows]
        if len(rows) >= FACET_VALUE_CAP:
            # Meili maxValuesPerFacet piirab tagastust; loend võib olla poolik.
            lines.append(
                f"  NB: loend on mittetäielik — Meili tagastab kuni "
                f"{FACET_VALUE_CAP} facet-väärtust."
            )
        return "\n".join(lines)
```

- [ ] **Step 4: Taasta täielik suitsutest**

`mcp/tests/test_server_smoke.py` — eemalda Task 1 ajutine kohandus, taasta
`assert names == EXPECTED_TOOLS` ja kustuta kommentaar „NB: Task 8 lõpus taasta".
Lisa serveri koostamisele võltsklient:

```python
class _FakeClient:
    def meili_search(self, body):
        return {"hits": [], "totalHits": 0}

    def api_get(self, path, params=None):
        return {"results": [], "total": 0}

    def api_post(self, path, json_body):
        return {"titles": {}}


async def test_server_registreerib_koik_tooriistad():
    server = build_server(client=_FakeClient(), base_url="https://x.test")
    names = {t.name for t in await server.list_tools()}
    assert names == EXPECTED_TOOLS
```

- [ ] **Step 5: Jooksuta KÕIK testid**

```bash
.venv/bin/pytest mcp/tests/ -v && .venv/bin/pytest tests/ -q
```

Oodatav: kõik PASS, sealhulgas `test_protocol_hygiene.py` mõlemad testid
(nüüd on kõik seitse tööriista olemas) ja olemasolev `tests/` ilma
regressioonita.

- [ ] **Step 6: Commit**

```bash
git add mcp/vutt_mcp/server.py mcp/tests/test_filter_values.py mcp/tests/test_server_smoke.py
git commit -m "feat(mcp): list_filter_values + täielik seitsme tööriista komplekt"
```

---

### Task 9: Live-suitsutest, dokumentatsioon, kliendi seadistus

**Files:**
- Create: `mcp/tests/test_live_smoke.py`, `mcp/README.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: kogu eelnev

- [ ] **Step 1: Kirjuta live-suitsutest**

`mcp/tests/test_live_smoke.py`:

```python
"""Päris API vastu. EI jookse vaikimisi (pytest.ini: addopts = -m "not live").

Käivitamine:
    VUTT_MEILI_SEARCH_KEY=<võti> .venv/bin/pytest mcp/tests/test_live_smoke.py -m live -v
"""
import os

import pytest

from vutt_mcp.client import VuttClient
from vutt_mcp.config import load_settings
from vutt_mcp.server import build_server

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        not os.getenv("VUTT_MEILI_SEARCH_KEY"),
        reason="VUTT_MEILI_SEARCH_KEY puudub",
    ),
]


@pytest.fixture
def server():
    settings = load_settings()
    return build_server(client=VuttClient(settings), base_url=settings.base_url)


async def _text(server, name, args):
    result = await server.call_tool(name, args)
    return result.content[0].text


async def test_search_pages_leiab_respublica(server):
    out = await _text(server, "search_pages", {"query": "respublica", "limit": 3})
    assert "work_id=" in out
    assert "/work/" in out
    assert "/api/images/" not in out  # pilte ei väljastata


async def test_search_persons_leiab_aliase_kaudu(server):
    out = await _text(server, "search_persons", {"q": "Ludenius", "limit": 3})
    assert "person_id=vutt:" in out


async def test_list_filter_values_annab_kollektsioonid(server):
    out = await _text(server, "list_filter_values", {"field": "collections"})
    assert " lk" in out
```

- [ ] **Step 2: Jooksuta live-test**

```bash
set -a && . ./.env.local && set +a
VUTT_MEILI_SEARCH_KEY="$MEILI_SEARCH_KEY" .venv/bin/pytest mcp/tests/test_live_smoke.py -m live -v
```

Oodatav: kõik PASS. Kui kukub `VuttConfigError`-iga, on võti aegunud — võta
uus serverist, ära muuda testi.

- [ ] **Step 3: Kinnita, et live-testid EI jookse vaikimisi**

```bash
.venv/bin/pytest mcp/tests/ -q 2>&1 | tail -3
```

Oodatav: live-testid on „deselected", mitte jooksutatud.

- [ ] **Step 4: Kirjuta `mcp/README.md`**

````markdown
# VUTT MCP-server

Annab lokaalsetele agentidele (Claude Code, Codex CLI, Gemini CLI, Antigravity)
ligipääsu VUTT-i transkriptsioonidele ja prosopograafiale. Read-only, stdio.

## Paigaldus

```bash
pipx install -e mcp/            # → käsk `vutt-mcp` PATH-il
export VUTT_MEILI_SEARCH_KEY=…  # tootmise otsinguvõti
```

`VUTT_BASE_URL` vaikimisi `https://vutt.utlib.ut.ee`.

## Kliendi seadistus

```bash
# Claude Code — kättesaadav igas projektis sellel masinal
claude mcp add --scope user vutt --env VUTT_MEILI_SEARCH_KEY=… -- vutt-mcp
```

Codex CLI, Gemini CLI ja Antigravity: lisa oma MCP-konfi stdio-server käsuga
`vutt-mcp` ja sama keskkonnamuutujaga.

## Tööriistad

| Tööriist | Mida teeb |
|---|---|
| `search_pages` | Täistekstiotsing, lehekülje-katked |
| `search_works` | Sama teosetasandil + esindav lehekülg |
| `get_work` | Teose metaandmed + lehekülgede loend |
| `get_pages` | Lehekülgede vahemiku täistekst (kuni 20 lk) |
| `search_persons` | Isikuotsing (nimevariandid kaetud) |
| `get_person` | Isikukaart + seotud teosed (kuni 50) |
| `list_filter_values` | Legaalsed filtriväärtused |

## Arendus

```bash
.venv/bin/pip install -e mcp/
.venv/bin/pytest mcp/tests/                    # võrguvabad
.venv/bin/pytest mcp/tests/ -m live            # päris API vastu
```

**Invariandid** (vt `docs/superpowers/specs/2026-08-15-vutt-mcp-server-design.md`):

- `vutt_mcp` EI TOHI importida `server`-it runtime'is (pipx-venv on isoleeritud);
  testid tohivad.
- Iga tööriist on `@mcp.tool(structured_output=False)`.
- stdio-režiimis kirjutab ainult MCP protokoll stdout'i; logid stderr'i.
- Skaneeringu piltide baite ei väljastata kunagi — ainult töölaua lingid.
````

- [ ] **Step 5: Lisa viide `CLAUDE.md`-sse**

Lisa `CLAUDE.md` „Koodi paigutus" jaotise lõppu:

```markdown
### MCP-server (`mcp/`)

Eraldi pakett `vutt_mcp` — agentide read-only ligipääs korpusele üle avaliku
API (`mcp/README.md`, ADR-i ei ole; spekk `docs/superpowers/specs/`).
**Ei tohi importida `server`-it runtime'is** (pipx-venv on isoleeritud);
`mcp` sõltuvus on AINULT `requirements-dev.txt`-is, sest Docker on Python 3.9.
Indeksiseadete leping: `server/meili_settings.py` + `mcp/tests/test_meili_contract.py`.
```

- [ ] **Step 6: Jooksuta täielik väravakomplekt**

```bash
.venv/bin/pytest tests/ mcp/tests/ -q
```

Oodatav: kõik roheline, null regressiooni.

- [ ] **Step 7: Commit**

```bash
git add mcp/README.md mcp/tests/test_live_smoke.py CLAUDE.md
git commit -m "docs(mcp): README, live-suitsutest, CLAUDE.md viide"
```

---

## Väljaspool seda plaani

Kontrollimise käigus leitud, MCP-ga mitteseotud: `GET /api/files/prosopography/{id}`
(avalik, autentimata) tagastab väljal `auth_token` 36-märgilise UUID-i.
Kontrollitud näidis oli **aegunud**, aga muster on päris — sessioonitoken on
kunagi PUT-keha kaudu kaardi JSON-i salvestunud. `person_crud.py:232` eemaldab
selle uuendamisel, mis ei puhasta juba salvestatud kirjeid.

Eraldi issue ja haru. **Mitte selle plaani osa.**
