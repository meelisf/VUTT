# Sekundaarkirjanduse kogu MCP-s — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anda agendile lokaalne, Zotero-põhine sekundaarkirjanduse kogu, mis on
täistekstis otsitav ja **täpselt tsiteeritav** (trükise leheküljenumbriga), ilma
et materjal läheks VUTT-i korpusesse või läbi OCR-i.

**Architecture:** Uus alampakett `mcp/vutt_mcp/library/`. Konsoolikäsk
`vutt-library index` loeb Zotero Local API kaudu ühe kollektsiooni (koos
alamkollektsioonidega), ekstraheerib PDF-idest teksti `pdftotext`-iga lehekülg
kaupa ja kirjutab SQLite+FTS5 indeksi. MCP-pool registreerib kolm read-only
tööriista **ainult siis, kui indeksifail on olemas**.

**Tech Stack:** Python ≥3.10, stdlib `sqlite3` (FTS5) + `urllib` (Zotero
Local API), `pypdf` (ainult `/PageLabels` lugemiseks), poppler `pdftotext`,
MCP SDK v2, pytest.

**Spec:** `docs/superpowers/specs/2026-08-19-kirjanduse-kogu-mcp-design.md`

## Kust jätkata (seis 2026-08-19)

Plaan on kirjutatud ja kinnitatud, **koodi ei ole veel kirjutatud**. Task 1 on
esimene samm. Haru: `feat/kirjanduse-kogu-mcp`.

**Enne esimest päris indekseerimist tee Zoteros ära:**

1. Loo kollektsioon **„VUTT kirjandus"** (praegu seda ei ole — kontrollitud,
   106 kollektsiooni, seda nime nende seas pole).
2. Lohista sinna teatmeteosed, **mille OCR on kvaliteetne** — indekseerija ei
   hinda tekstikvaliteeti ja lagunenud OCR jääb otsingust vaikselt välja.
3. Local API on juba lubatud (Settings → Advanced, sisse lülitatud 2026-08-19).
   **Zotero peab indekseerimise ajal jooksma.**

**Teostusviis on valimata.** Kaks võimalust: subagent-driven (värske subagent
ülesande kohta, ülevaatus vahepeal — soovitatud) või inline selles seansis.

**Mõõdetud faktid, mida ei pea uuesti välja kaevama** (kõik plaani sees):
Zotero `storage/` = 1319 PDF-manust, `linkMode` jaotus 820/473/25/1, lingitud
failidest 7 on juba katki, kollektsioone 113 (80 alamkollektsiooni), kolm
duplikaat-nime. PDF-fixture'i generaator ja Local API kuju on jooksutatud, mitte
oletatud.

## Global Constraints

- **Koodikommentaarid ja veateated eesti keeles** (CLAUDE.md).
- `mcp/tests/` **ei tohi sisaldada `__init__.py`-d** — pakett `mcp.tests`
  varjutaks repo `tests` paketi.
- **`server`-it ei tohi importida** `vutt_mcp` runtime-koodis (pipx-venv on
  isoleeritud). Testid tohivad.
- Iga MCP-tööriist **`@mcp.tool(structured_output=False)`**.
- Python **≥3.10** (`mcp/pyproject.toml`); `str | None` on lubatud.
- **Ükski test ei tohi sõltuda omaniku päris Zoterost** ega autoriõigusega
  failidest — kõik fixture'id sünteetilised.
- **Vaikne vale on halvem kui katkine jooks**: tuvastamata seis annab vea või
  väljajäetud välja, mitte oletuse.
- Zotero metaandmed tulevad **Local API-st** (`http://127.0.0.1:23119`), mitte
  `zotero.sqlite`-st: jooksev Zotero hoiab baasi lukus. Indekseerimise ajal peab
  **Zotero jooksma** ja Local API olema lubatud.
- `EXTRACTOR_VERSION` ja `INDEXER_SCHEMA_VERSION` algavad **1**-st.
- Testid jooksevad `.venv/bin/python -m pytest mcp/tests/ -v` (projekti venv).

## Failistruktuur

| Fail | Vastutus |
|---|---|
| `mcp/vutt_mcp/library/__init__.py` | Avalik pind: `register_library_tools`, `load_library_settings` |
| `mcp/vutt_mcp/library/config.py` | Teed, env, versiooninumbrid, aktiveerimise värav |
| `mcp/vutt_mcp/library/zotero.py` | Local API klient: pagineerimine, kollektsioon, manused, bibliokirjed |
| `mcp/vutt_mcp/library/schema.py` | `library.db` DDL ja ühenduse avamine |
| `mcp/vutt_mcp/library/extract.py` | `pdftotext` lehekülgedeks, otsingunormaliseerimine |
| `mcp/vutt_mcp/library/pages.py` | Leheküljekaardistus: PageLabels → tuvastus → sidecar |
| `mcp/vutt_mcp/library/indexer.py` | Sõrmejälg, elutsükkel, aatomilisus, lukk, aruanne |
| `mcp/vutt_mcp/library/query.py` | FTS-parser, otsing, lehevahemiku lahendamine |
| `mcp/vutt_mcp/library/format.py` | Viide, „lk 217 (PDF 223)", tööriistade tekstiväljund |
| `mcp/vutt_mcp/library/tools.py` | MCP-tööriistade registreerimine |
| `mcp/vutt_mcp/library/cli.py` | `vutt-library index` / `status` |
| `mcp/tests/library_fixtures.py` | Sünteetiline Zotero-baas ja PDF-generaator |
| `mcp/tests/test_library_*.py` | Testid mooduli kaupa |

---

### Task 1: Paketi skelett, konfiguratsioon ja aktiveerimise värav

**Files:**
- Create: `mcp/vutt_mcp/library/__init__.py`
- Create: `mcp/vutt_mcp/library/config.py`
- Test: `mcp/tests/test_library_config.py`

**Interfaces:**
- Consumes: midagi (esimene ülesanne).
- Produces:
  - `LibrarySettings` dataclass: `db_path: Path`, `collection: str`, `zotero_dir: Path`
  - `load_library_settings(env: Mapping[str, str] | None = None) -> LibrarySettings`
  - `library_available(settings: LibrarySettings) -> bool`
  - `EXTRACTOR_VERSION: int`, `INDEXER_SCHEMA_VERSION: int`, `ZOTERO_API_BASE: str`

- [ ] **Step 1: Write the failing test**

```python
# mcp/tests/test_library_config.py
from pathlib import Path

from vutt_mcp.library.config import (
    library_available,
    load_library_settings,
)


def test_vaikimisi_teed():
    s = load_library_settings({"HOME": "/home/keegi"})
    assert s.db_path == Path("/home/keegi/.local/share/vutt-library/library.db")
    assert s.collection == "VUTT kirjandus"
    assert s.zotero_dir == Path("/home/keegi/.zotero/Zotero")
    assert s.api_base == "http://127.0.0.1:23119/api/users/0"


def test_env_kirjutab_ule():
    s = load_library_settings(
        {
            "HOME": "/home/keegi",
            "VUTT_LIBRARY_DB": "/mujal/l.db",
            "VUTT_LIBRARY_COLLECTION": "Muu kogu",
            "VUTT_LIBRARY_ZOTERO_DIR": "/mujal/Zotero",
            "VUTT_LIBRARY_ZOTERO_API": "http://127.0.0.1:9999/api/users/0",
        }
    )
    assert s.db_path == Path("/mujal/l.db")
    assert s.collection == "Muu kogu"
    assert s.zotero_dir == Path("/mujal/Zotero")
    assert s.api_base == "http://127.0.0.1:9999/api/users/0"


def test_aktiveerimine_soltub_indeksifailist(tmp_path):
    db = tmp_path / "library.db"
    s = load_library_settings({"HOME": str(tmp_path), "VUTT_LIBRARY_DB": str(db)})
    assert library_available(s) is False
    db.write_bytes(b"")
    assert library_available(s) is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'vutt_mcp.library'`

- [ ] **Step 3: Write minimal implementation**

```python
# mcp/vutt_mcp/library/config.py
"""Kirjanduskogu konfiguratsioon ja aktiveerimise värav.

Tööriistad registreeruvad AINULT siis, kui indeksifail on olemas — nii ei teki
neid kellelgi, kes vutt-mcp paigaldab ilma oma koguta.
"""
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

# Tõstmine sunnib teksti ümbertöötluse (ekstraktsioon/normaliseerimine muutus).
EXTRACTOR_VERSION = 1
# Tõstmine sunnib indeksi ümberehituse (skeem muutus).
INDEXER_SCHEMA_VERSION = 1
# Zotero Local API (Settings → Advanced → luba suhtlus).
ZOTERO_API_BASE = "http://127.0.0.1:23119/api/users/0"

DEFAULT_COLLECTION = "VUTT kirjandus"


@dataclass(frozen=True)
class LibrarySettings:
    db_path: Path
    collection: str
    zotero_dir: Path      # storage/ asukoht; metaandmed tulevad API-st
    api_base: str = ZOTERO_API_BASE


def load_library_settings(env: Mapping[str, str] | None = None) -> LibrarySettings:
    env = os.environ if env is None else env
    home = Path(env.get("HOME", "~")).expanduser()
    db = env.get("VUTT_LIBRARY_DB")
    zot = env.get("VUTT_LIBRARY_ZOTERO_DIR")
    return LibrarySettings(
        db_path=Path(db) if db else home / ".local/share/vutt-library/library.db",
        collection=env.get("VUTT_LIBRARY_COLLECTION", DEFAULT_COLLECTION),
        zotero_dir=Path(zot) if zot else home / ".zotero/Zotero",
        api_base=env.get("VUTT_LIBRARY_ZOTERO_API", ZOTERO_API_BASE),
    )


def library_available(settings: LibrarySettings) -> bool:
    """Värav: kogu on olemas siis ja ainult siis, kui indeksifail eksisteerib."""
    return settings.db_path.exists()
```

```python
# mcp/vutt_mcp/library/__init__.py
"""Lokaalne sekundaarkirjanduse kogu (valikuline moodul).

Erand `vutt_mcp` senisest invariandist „õhuke klient avaliku API otsas, oma
olekut ei hoia" — vt ADR ja spekk 2026-08-19-kirjanduse-kogu-mcp-design.md.
"""
from .config import LibrarySettings, library_available, load_library_settings

__all__ = ["LibrarySettings", "library_available", "load_library_settings"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_config.py -v`
Expected: PASS (3 testi)

- [ ] **Step 5: Commit**

```bash
git add mcp/vutt_mcp/library/ mcp/tests/test_library_config.py
git commit -m "feat(library): konfiguratsioon ja aktiveerimise värav"
```

---

### Task 2: Zotero Local API klient

**Files:**
- Create: `mcp/vutt_mcp/library/zotero.py`
- Create: `mcp/tests/library_fixtures.py`
- Test: `mcp/tests/test_library_api.py`

**Interfaces:**
- Consumes: `config.ZOTERO_API_BASE`
- Produces:
  - `class ZoteroError(Exception)`
  - `fetch_all(base_url: str, path: str, params: dict | None = None) -> list[dict]`
    — järgib `Total-Results` / `start` pagineerimist
  - `check_api(base_url: str) -> None` — kukub selge juhisega, kui Zotero ei
    tööta või Local API on välja lülitatud
  - fixture: `FakeZoteroAPI(collections=…, subcollections=…, items=…, enabled=True)`
    — kontekstihaldur, mis tagastab `base_url`

- [ ] **Step 1: Write the fixture**

```python
# mcp/tests/library_fixtures.py
"""Sünteetilised fixture'id. EI TOHI kunagi puutuda omaniku päris Zoterot."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PREFIKS = "/api/users/0"


class FakeZoteroAPI:
    """Jäljendab Zotero Local API-t: pagineerimine, alamkollektsioonid, prügikast.

    collections:    [{"key": "K1", "data": {"name": "Kogu", "parentCollection": False}}]
    subcollections: {"K1": ["K2"]}
    items:          {"K1": [{"key": "I1", "data": {...}}]}
    """

    def __init__(self, collections=(), subcollections=None, items=None,
                 enabled=True):
        self.collections = list(collections)
        self.subcollections = subcollections or {}
        self.items = items or {}
        self.enabled = enabled
        self.server = None

    def __enter__(self):
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                if not fake.enabled:
                    keha = b"Local API is not enabled"
                    self.send_response(200)
                    self.send_header("Content-Type", "text/plain")
                    self.send_header("Content-Length", str(len(keha)))
                    self.end_headers()
                    self.wfile.write(keha)
                    return
                url = urlparse(self.path)
                paring = parse_qs(url.query)
                tee = url.path[len(PREFIKS):] if url.path.startswith(PREFIKS) else url.path
                andmed = fake._route(tee)
                if andmed is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                algus = int(paring.get("start", ["0"])[0])
                limiit = int(paring.get("limit", ["50"])[0])
                tykk = andmed[algus:algus + limiit]
                keha = json.dumps(tykk).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Total-Results", str(len(andmed)))
                self.send_header("Content-Length", str(len(keha)))
                self.end_headers()
                self.wfile.write(keha)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        port = self.server.server_address[1]
        return f"http://127.0.0.1:{port}{PREFIKS}"

    def _route(self, tee):
        if tee == "/collections":
            return self.collections
        if tee.endswith("/collections") and tee.startswith("/collections/"):
            key = tee.split("/")[2]
            alamad = self.subcollections.get(key, [])
            return [c for c in self.collections if c["key"] in alamad]
        if tee.endswith("/items") and tee.startswith("/collections/"):
            return self.items.get(tee.split("/")[2], [])
        if tee == "/items/trash":
            return []
        return None

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()
        return False


def kollektsioon(key, nimi, parent=False):
    return {"key": key, "data": {"key": key, "name": nimi,
                                 "parentCollection": parent}}


def kirje(key, **data):
    data.setdefault("itemType", "book")
    return {"key": key, "data": {"key": key, **data}}


def manus(key, parent, *, link_mode="imported_file", filename=None, path=None,
          content_type="application/pdf", deleted=False):
    d = {"key": key, "itemType": "attachment", "parentItem": parent,
         "linkMode": link_mode, "contentType": content_type,
         "filename": filename, "path": path}
    if deleted:
        d["deleted"] = 1
    return {"key": key, "data": d}
```

- [ ] **Step 2: Write the failing test**

```python
# mcp/tests/test_library_api.py
import pytest
from library_fixtures import FakeZoteroAPI, kollektsioon

from vutt_mcp.library.zotero import ZoteroError, check_api, fetch_all


def test_fetch_all_jargib_pagineerimist():
    kogud = [kollektsioon(f"K{i:04d}", f"Kogu {i}") for i in range(120)]
    with FakeZoteroAPI(collections=kogud) as base:
        koik = fetch_all(base, "/collections", {"limit": 50})
    assert len(koik) == 120
    assert koik[0]["key"] == "K0000"
    assert koik[-1]["key"] == "K0119"


def test_valja_lulitatud_api_annab_juhise():
    with FakeZoteroAPI(collections=[], enabled=False) as base:
        with pytest.raises(ZoteroError, match="Local API"):
            check_api(base)


def test_kattesaamatu_zotero_annab_juhise():
    with pytest.raises(ZoteroError, match="ei vasta"):
        check_api("http://127.0.0.1:1/api/users/0")


def test_toimiv_api_labib():
    with FakeZoteroAPI(collections=[kollektsioon("K1", "Kogu")]) as base:
        check_api(base)  # ei tohi visata
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_api.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'vutt_mcp.library.zotero'`

- [ ] **Step 4: Write minimal implementation**

```python
# mcp/vutt_mcp/library/zotero.py
"""Zotero Local API klient.

Miks API, mitte zotero.sqlite: jooksev Zotero hoiab baasi lukus nii, et isegi
mode=ro ühendus kukub. API annab värske seisu töötava Zotero kõrvalt, ei sõltu
sisemisest skeemiversioonist ja jätab prügikasti ise välja.

Hind: indekseerimise ajal peab Zotero jooksma ja Local API olema lubatud
(Settings → Advanced).
"""
import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

AJALIMIIT = 30
LEHE_SUURUS = 100


class ZoteroError(Exception):
    """Zoterost ei saa andmeid."""


def _get(base_url: str, path: str, params: dict) -> tuple:
    url = f"{base_url}{path}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=AJALIMIIT) as vastus:
            toores = vastus.read()
            paised = dict(vastus.headers)
    except urllib.error.URLError as e:
        raise ZoteroError(
            f"Zotero Local API ei vasta aadressil {base_url} ({e.reason}). "
            "Kas Zotero on avatud?"
        ) from e
    try:
        return json.loads(toores), paised
    except json.JSONDecodeError as e:
        # Väljalülitatud API vastab 200-ga, kehas „Local API is not enabled".
        raise ZoteroError(
            "Zotero Local API on välja lülitatud. Lülita sisse: "
            "Zotero → Settings → Advanced → luba teistel rakendustel "
            f"selles arvutis Zoteroga suhelda. (Vastus: {toores[:80]!r})"
        ) from e


def fetch_all(base_url: str, path: str, params: dict | None = None) -> list:
    """Kogub kõik lehed. Zotero annab Total-Results päise ja võtab `start`-i."""
    params = dict(params or {})
    params.setdefault("limit", LEHE_SUURUS)
    kogutud, algus = [], 0
    while True:
        params["start"] = algus
        tykk, paised = _get(base_url, path, params)
        kogutud.extend(tykk)
        kokku = int(paised.get("Total-Results", len(kogutud)))
        algus += len(tykk)
        if not tykk or algus >= kokku:
            return kogutud


def check_api(base_url: str) -> None:
    """Kukub selge juhisega, kui API ei ole kättesaadav või on välja lülitatud."""
    _get(base_url, "/collections", {"limit": 1})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_api.py -v`
Expected: PASS (4 testi)

- [ ] **Step 6: Commit**

```bash
git add mcp/vutt_mcp/library/zotero.py mcp/tests/library_fixtures.py \
        mcp/tests/test_library_api.py
git commit -m "feat(library): Zotero Local API klient pagineerimisega"
```

---

### Task 3: Kollektsiooni lahendamine ja alamkollektsioonid

**Files:**
- Modify: `mcp/vutt_mcp/library/zotero.py`
- Test: `mcp/tests/test_library_collection.py`

**Interfaces:**
- Consumes: `fetch_all`
- Produces:
  - `resolve_collection(base_url: str, wanted: str) -> tuple[str, str]` — `(key, nimi)`
  - `collection_tree(base_url: str, root_key: str) -> list[tuple[str, str]]` —
    `[(key, tee_nimena)]`, juur kaasa arvatud

- [ ] **Step 1: Write the failing test**

```python
# mcp/tests/test_library_collection.py
import pytest
from library_fixtures import FakeZoteroAPI, kollektsioon

from vutt_mcp.library.zotero import ZoteroError, collection_tree, resolve_collection

PUU = [
    kollektsioon("KEY00001", "VUTT kirjandus"),
    kollektsioon("KEY00002", "Teatmeteosed", parent="KEY00001"),
    kollektsioon("KEY00003", "Matriklid", parent="KEY00002"),
    kollektsioon("KEY00004", "Muu kogu"),
]
ALAMAD = {"KEY00001": ["KEY00002"], "KEY00002": ["KEY00003"]}


def test_nimi_lahendatakse_keyks():
    with FakeZoteroAPI(collections=PUU, subcollections=ALAMAD) as base:
        assert resolve_collection(base, "VUTT kirjandus") == ("KEY00001",
                                                             "VUTT kirjandus")


def test_key_toimib_otse():
    with FakeZoteroAPI(collections=PUU, subcollections=ALAMAD) as base:
        assert resolve_collection(base, "KEY00003") == ("KEY00003", "Matriklid")


def test_puuduv_kollektsioon_kukub():
    with FakeZoteroAPI(collections=PUU) as base:
        with pytest.raises(ZoteroError, match="ei leidnud kollektsiooni"):
            resolve_collection(base, "Olematu")


def test_duplikaat_nimi_kukub_ja_loetleb():
    kogud = [
        kollektsioon("KEY00001", "17. saj"),
        kollektsioon("KEY00002", "Alam"),
        kollektsioon("KEY00003", "17. saj", parent="KEY00002"),
    ]
    with FakeZoteroAPI(collections=kogud) as base:
        with pytest.raises(ZoteroError) as exc:
            resolve_collection(base, "17. saj")
    sonum = str(exc.value)
    assert "KEY00001" in sonum and "KEY00003" in sonum


def test_alamkollektsioonid_rekursiivselt():
    with FakeZoteroAPI(collections=PUU, subcollections=ALAMAD) as base:
        puu = collection_tree(base, "KEY00001")
    assert [k for k, _ in puu] == ["KEY00001", "KEY00002", "KEY00003"]
    assert puu[2][1] == "Matriklid"


def test_lehtkollektsioonil_ainult_ta_ise():
    with FakeZoteroAPI(collections=PUU, subcollections=ALAMAD) as base:
        assert collection_tree(base, "KEY00004") == [("KEY00004", "Muu kogu")]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_collection.py -v`
Expected: FAIL — `ImportError: cannot import name 'resolve_collection'`

- [ ] **Step 3: Write minimal implementation**

Lisa `zotero.py` lõppu:

```python
def resolve_collection(base_url: str, wanted: str) -> tuple:
    """Nimi VÕI key → (key, nimi).

    Nimi ei ole püsiv identifikaator — omaniku raamatukogus on mõõdetult mitu
    duplikaat-nime. 0 või >1 vaste korral kukume, et vaikselt vale kogu ei
    indekseeriks.
    """
    kogud = fetch_all(base_url, "/collections")
    otse = [c for c in kogud if c["key"] == wanted]
    if otse:
        return otse[0]["key"], otse[0]["data"]["name"]

    nime_jargi = [c for c in kogud if c["data"]["name"] == wanted]
    if not nime_jargi:
        raise ZoteroError(
            f"ei leidnud kollektsiooni {wanted!r} "
            f"({len(kogud)} kollektsiooni raamatukogus)"
        )
    if len(nime_jargi) > 1:
        kandidaadid = "\n".join(
            f"  {c['key']}  (ülem: {c['data'].get('parentCollection') or '-'})"
            for c in nime_jargi
        )
        raise ZoteroError(
            f"kollektsiooni nimi {wanted!r} ei ole üheselt määratud "
            f"({len(nime_jargi)} vastet). Kirjuta konfiguratsiooni nime asemel "
            f"key:\n{kandidaadid}"
        )
    return nime_jargi[0]["key"], nime_jargi[0]["data"]["name"]


def collection_tree(base_url: str, root_key: str) -> list:
    """Juur + kõik alamkollektsioonid rekursiivselt, [(key, nimi)].

    Kaasamine on tahtlik: kasvav kureeritud kogu saab alamkaustu ja nende
    vaikne väljajätmine tähendaks otsingust puuduvat materjali.
    """
    kogud = {c["key"]: c["data"]["name"] for c in fetch_all(base_url, "/collections")}
    tulem, jarjekord, nahtud = [], [root_key], set()
    while jarjekord:
        key = jarjekord.pop(0)
        if key in nahtud:
            continue
        nahtud.add(key)
        tulem.append((key, kogud.get(key, key)))
        alamad = fetch_all(base_url, f"/collections/{key}/collections")
        jarjekord.extend(a["key"] for a in alamad)
    return tulem
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_collection.py -v`
Expected: PASS (6 testi)

- [ ] **Step 5: Commit**

```bash
git add mcp/vutt_mcp/library/zotero.py mcp/tests/test_library_collection.py
git commit -m "feat(library): kollektsiooni lahendamine key-ks + alamkollektsioonid"
```

---

### Task 4: Manuste ja bibliokirjete lugemine

**Files:**
- Modify: `mcp/vutt_mcp/library/zotero.py`
- Test: `mcp/tests/test_library_documents.py`

**Interfaces:**
- Consumes: `fetch_all`, `collection_tree`
- Produces:
  - `@dataclass Bib`: `creators: list`, `title: str`, `year`, `place`,
    `publisher`, `publication`, `volume`, `issue`, `pages`, `series`,
    `edition`, `isbn`, `doi` — kõik peale `creators`/`title` on `str | None`
  - `@dataclass ZoteroDoc`: `doc_id: str`, `parent_key: str`, `path: Path | None`,
    `link_mode: str`, `file_missing: bool`, `bib: Bib`
  - `iter_documents(base_url: str, storage_dir: Path, collection_keys: list) -> list`

- [ ] **Step 1: Write the failing test**

```python
# mcp/tests/test_library_documents.py
import pytest
from library_fixtures import FakeZoteroAPI, kirje, kollektsioon, manus

from vutt_mcp.library.zotero import ZoteroError, iter_documents

KOGUD = [kollektsioon("K1", "VUTT kirjandus")]
VANEM = kirje("ITEM0001", title="Album academicum", date="1984-05",
              place="Tartu", publisher="Eesti Raamat",
              creators=[{"creatorType": "editor", "firstName": "Arvo",
                         "lastName": "Tering"}])


def _tee_fail(tmp_path, att_key, nimi="f.pdf"):
    kaust = tmp_path / "storage" / att_key
    kaust.mkdir(parents=True, exist_ok=True)
    (kaust / nimi).write_bytes(b"%PDF-1.4")
    return tmp_path / "storage"


def test_imporditud_fail_leitakse_storagest(tmp_path):
    storage = _tee_fail(tmp_path, "ATT00001")
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        docs = iter_documents(base, storage, ["K1"])
    assert len(docs) == 1
    d = docs[0]
    assert d.doc_id == "ATT00001"
    assert d.parent_key == "ITEM0001"
    assert d.file_missing is False
    assert d.bib.title == "Album academicum"
    assert d.bib.year == "1984"
    assert d.bib.creators == [["Arvo Tering", "editor"]]
    assert d.bib.publisher == "Eesti Raamat"


def test_lingitud_absoluutne_tee(tmp_path):
    fail = tmp_path / "kettal.pdf"
    fail.write_bytes(b"%PDF-1.4")
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001",
                                 link_mode="linked_file", path=str(fail))]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        docs = iter_documents(base, tmp_path / "storage", ["K1"])
    assert docs[0].path == fail and docs[0].file_missing is False


def test_katkine_link_margitakse_puuduvaks(tmp_path):
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001",
                                 link_mode="linked_file", path="/pole/olemas.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        docs = iter_documents(base, tmp_path / "storage", ["K1"])
    assert docs[0].file_missing is True


def test_attachments_prefiks_kukub(tmp_path):
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", link_mode="linked_file",
                                 path="attachments:alam/f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        with pytest.raises(ZoteroError, match="baasikataloogi"):
            iter_documents(base, tmp_path / "storage", ["K1"])


def test_linked_url_ja_mitte_pdf_jaetakse_vahele(tmp_path):
    items = {"K1": [
        VANEM,
        manus("ATT00001", "ITEM0001", link_mode="linked_url", path="http://x"),
        manus("ATT00002", "ITEM0001", content_type="text/html", filename="a.html"),
    ]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        assert iter_documents(base, tmp_path / "storage", ["K1"]) == []


def test_prugikasti_margitud_jaetakse_valja(tmp_path):
    storage = _tee_fail(tmp_path, "ATT00001")
    _tee_fail(tmp_path, "ATT00002")
    items = {"K1": [
        VANEM,
        manus("ATT00001", "ITEM0001", filename="f.pdf"),
        manus("ATT00002", "ITEM0001", filename="f.pdf", deleted=True),
    ]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        docs = iter_documents(base, storage, ["K1"])
    assert [d.doc_id for d in docs] == ["ATT00001"]


def test_uks_vanem_kaks_manust(tmp_path):
    storage = _tee_fail(tmp_path, "ATT00001")
    _tee_fail(tmp_path, "ATT00002")
    items = {"K1": [VANEM,
                    manus("ATT00001", "ITEM0001", filename="f.pdf"),
                    manus("ATT00002", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        docs = iter_documents(base, storage, ["K1"])
    assert sorted(d.doc_id for d in docs) == ["ATT00001", "ATT00002"]
    assert {d.bib.title for d in docs} == {"Album academicum"}


def test_duplikaat_kahes_kollektsioonis_loetakse_uks_kord(tmp_path):
    storage = _tee_fail(tmp_path, "ATT00001")
    m = manus("ATT00001", "ITEM0001", filename="f.pdf")
    items = {"K1": [VANEM, m], "K2": [VANEM, m]}
    kogud = KOGUD + [kollektsioon("K2", "Alam")]
    with FakeZoteroAPI(collections=kogud, items=items) as base:
        assert len(iter_documents(base, storage, ["K1", "K2"])) == 1


def test_uhe_nimega_looja(tmp_path):
    """Zotero lubab asutust ühe väljana: {"name": "Tartu Ülikool"}."""
    storage = _tee_fail(tmp_path, "ATT00001")
    vanem = kirje("ITEM0002", title="Aruanne", date="1932",
                  creators=[{"creatorType": "author", "name": "Tartu Ülikool"}])
    items = {"K1": [vanem, manus("ATT00001", "ITEM0002", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        docs = iter_documents(base, storage, ["K1"])
    assert docs[0].bib.creators == [["Tartu Ülikool", "author"]]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_documents.py -v`
Expected: FAIL — `ImportError: cannot import name 'iter_documents'`

- [ ] **Step 3: Write minimal implementation**

Lisa `zotero.py` lõppu (ja faili algusse `import re`):

```python
# Zotero API väljanimi → meie Bib väli.
BIB_VALJAD = {
    "title": "title", "date": "year", "place": "place", "publisher": "publisher",
    "publicationTitle": "publication", "volume": "volume", "issue": "issue",
    "pages": "pages", "series": "series", "edition": "edition",
    "ISBN": "isbn", "DOI": "doi",
}


@dataclass(frozen=True)
class Bib:
    creators: list
    title: str
    year: str | None = None
    place: str | None = None
    publisher: str | None = None
    publication: str | None = None
    volume: str | None = None
    issue: str | None = None
    pages: str | None = None
    series: str | None = None
    edition: str | None = None
    isbn: str | None = None
    doi: str | None = None


@dataclass(frozen=True)
class ZoteroDoc:
    doc_id: str
    parent_key: str
    path: Path | None
    link_mode: str
    file_missing: bool
    bib: Bib


def _bib_kirjest(data: dict) -> Bib:
    vaartused = {
        meie: data[zotero]
        for zotero, meie in BIB_VALJAD.items()
        if data.get(zotero)
    }
    # Zotero `date` on vabatekst („1984-05", „u. 1984") — võtame aastaarvu.
    if "year" in vaartused:
        leid = re.search(r"\b(1[0-9]{3}|20[0-9]{2})\b", str(vaartused["year"]))
        if leid:
            vaartused["year"] = leid.group(1)

    loojad = []
    for c in data.get("creators", []):
        nimi = c.get("name") or " ".join(
            x for x in (c.get("firstName"), c.get("lastName")) if x)
        if nimi:
            loojad.append([nimi, c.get("creatorType", "author")])
    return Bib(creators=loojad, title=vaartused.pop("title", "(pealkirjata)"),
               **vaartused)


def _lahenda_tee(data: dict, storage_dir: Path) -> Path | None:
    link_mode = data.get("linkMode")
    if link_mode == "linked_url":
        return None
    if link_mode == "linked_file":
        tee = data.get("path") or ""
        if tee.startswith("attachments:"):
            raise ZoteroError(
                f"manus {data['key']} kasutab Zotero baasikataloogi teed "
                f"({tee!r}). Baasikataloogi tugi on tahtlikult ehitamata "
                "(mõõdetult 0 kasutust) — sea absoluutne tee või ehita tugi."
            )
        return Path(tee) if tee else None
    failinimi = data.get("filename")
    if not failinimi:
        return None
    return Path(storage_dir) / data["key"] / failinimi


def iter_documents(base_url: str, storage_dir: Path,
                   collection_keys: list) -> list:
    """PDF-manused antud kollektsioonides.

    Prügikast: API kollektsioonivaade ei tohiks kustutatuid anda, aga me
    filtreerime `data.deleted` peale ka ise — lepingut ei usalda pimesi.
    """
    dokumendid, nahtud, vanemad = [], set(), {}
    manused = []
    for key in collection_keys:
        for kirje_ in fetch_all(base_url, f"/collections/{key}/items"):
            data = kirje_["data"]
            if data.get("deleted"):
                continue
            if data.get("itemType") == "attachment":
                manused.append(data)
            else:
                vanemad[kirje_["key"]] = data

    for data in manused:
        if data.get("contentType") != "application/pdf":
            continue
        if data["key"] in nahtud:
            continue
        nahtud.add(data["key"])
        tee = _lahenda_tee(data, storage_dir)
        if tee is None:
            continue
        vanem_key = data.get("parentItem")
        vanem = vanemad.get(vanem_key)
        if vanem is None:
            continue  # orb manus ilma kirjeta — ei ole tsiteeritav
        dokumendid.append(ZoteroDoc(
            doc_id=data["key"], parent_key=vanem_key, path=tee,
            link_mode=data.get("linkMode", ""), file_missing=not tee.exists(),
            bib=_bib_kirjest(vanem),
        ))
    return dokumendid
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_documents.py -v`
Expected: PASS (9 testi)

- [ ] **Step 5: Commit**

```bash
git add mcp/vutt_mcp/library/zotero.py mcp/tests/test_library_documents.py
git commit -m "feat(library): manuste ja bibliokirjete lugemine Local API kaudu"
```

---

### Task 5: `library.db` skeem

**Files:**
- Create: `mcp/vutt_mcp/library/schema.py`
- Test: `mcp/tests/test_library_schema.py`

**Interfaces:**
- Consumes: midagi
- Produces:
  - `connect(path: Path, *, read_only: bool = False) -> sqlite3.Connection`
  - `create_schema(conn) -> None`
  - Tabelid: `documents`, `pages`, `pages_fts`, `meta`

**NB — kõrvalekalle spekist:** `search_text` elab **ainult** `pages_fts`-is,
mitte `pages`-i veeruna. Põhjus: tavaline (mitte-external-content) FTS5 tabel
lubab `DELETE ... WHERE doc_id = ?`, mis hoiab dokumendi kaupa ümberehituse
lihtsana; eraldi veerg dubleeriks teksti kolmandat korda.

- [ ] **Step 1: Write the failing test**

```python
# mcp/tests/test_library_schema.py
import sqlite3

import pytest

from vutt_mcp.library.schema import connect, create_schema


def test_skeem_luuakse(tmp_path):
    conn = connect(tmp_path / "l.db")
    create_schema(conn)
    tabelid = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view')")}
    assert {"documents", "pages", "pages_fts", "meta"} <= tabelid


def test_fts_otsib_ja_kustutab(tmp_path):
    conn = connect(tmp_path / "l.db")
    create_schema(conn)
    conn.execute("INSERT INTO pages_fts (doc_id, pdf_page, search_text) "
                 "VALUES ('A', 1, 'Ludenius disputatio')")
    conn.execute("INSERT INTO pages_fts (doc_id, pdf_page, search_text) "
                 "VALUES ('B', 1, 'muu tekst')")
    leid = conn.execute(
        "SELECT doc_id FROM pages_fts WHERE pages_fts MATCH 'Ludenius'").fetchall()
    assert [r[0] for r in leid] == ["A"]
    conn.execute("DELETE FROM pages_fts WHERE doc_id = 'A'")
    assert conn.execute(
        "SELECT COUNT(*) FROM pages_fts WHERE pages_fts MATCH 'Ludenius'"
    ).fetchone()[0] == 0


def test_read_only_ei_luba_kirjutada(tmp_path):
    db = tmp_path / "l.db"
    create_schema(connect(db))
    ro = connect(db, read_only=True)
    with pytest.raises(sqlite3.OperationalError):
        ro.execute("INSERT INTO meta (voti, vaartus) VALUES ('x','y')")


def test_printed_page_on_tekst(tmp_path):
    conn = connect(tmp_path / "l.db")
    create_schema(conn)
    conn.execute("INSERT INTO documents (doc_id, parent_key, title) "
                 "VALUES ('A','P','T')")
    conn.execute("INSERT INTO pages (doc_id, pdf_page, printed_page, text) "
                 "VALUES ('A', 3, 'xviii', 'tekst')")
    assert conn.execute(
        "SELECT printed_page FROM pages WHERE doc_id='A'").fetchone()[0] == "xviii"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_schema.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'vutt_mcp.library.schema'`

- [ ] **Step 3: Write minimal implementation**

```python
# mcp/vutt_mcp/library/schema.py
"""library.db skeem. Tuletatud read-model — nullist taastatav."""
import sqlite3
from pathlib import Path

DDL = """
CREATE TABLE IF NOT EXISTS meta (voti TEXT PRIMARY KEY, vaartus TEXT);

CREATE TABLE IF NOT EXISTS documents (
  doc_id            TEXT PRIMARY KEY,   -- Zotero MANUSE key (üks fail = üks dok)
  parent_key        TEXT NOT NULL,      -- Zotero kirje key (viite identiteet)
  collection_key    TEXT,
  title             TEXT NOT NULL,
  creators_json     TEXT,               -- [[nimi, roll], ...]
  year              TEXT,
  place             TEXT,
  publisher         TEXT,
  publication       TEXT,
  volume            TEXT,
  issue             TEXT,
  pages             TEXT,
  series            TEXT,
  edition           TEXT,
  isbn              TEXT,
  doi               TEXT,
  file_path         TEXT,
  link_mode         INTEGER,
  file_missing      INTEGER NOT NULL DEFAULT 0,
  page_count        INTEGER NOT NULL DEFAULT 0,
  page_mapping_source     TEXT,         -- pagelabels | detected | sidecar | none
  page_mapping_confidence REAL,
  page_mapping_summary    TEXT,
  fingerprint       TEXT NOT NULL DEFAULT '',
  indexed_at        TEXT
);

CREATE TABLE IF NOT EXISTS pages (
  doc_id       TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  pdf_page     INTEGER NOT NULL,        -- AINUKE järjestusvõti
  printed_page TEXT,                    -- TEXT: xviii, A3, 225a; NULL = teadmata
  text         TEXT NOT NULL,           -- toores pdftotext väljund, AINUS tagastatav
  PRIMARY KEY (doc_id, pdf_page)
);
CREATE INDEX IF NOT EXISTS pages_printed ON pages(doc_id, printed_page);

-- search_text elab AINULT siin: normaliseeritud, ei ole kunagi tagastatav.
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  doc_id UNINDEXED, pdf_page UNINDEXED, search_text
);
"""


def connect(path: Path, *, read_only: bool = False) -> sqlite3.Connection:
    """Ühendus. MCP-pool avab read-only ja TÖÖRIISTAKUTSE KOHTA — pikaajaline
    ühendus hoiaks pärast ümberehituse rename'i vana inode'i elus."""
    path = Path(path)
    if read_only:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path)
        conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(DDL)
    conn.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_schema.py -v`
Expected: PASS (4 testi)

- [ ] **Step 5: Commit**

```bash
git add mcp/vutt_mcp/library/schema.py mcp/tests/test_library_schema.py
git commit -m "feat(library): library.db skeem (documents/pages/pages_fts)"
```

---

### Task 6: Teksti ekstraktsioon ja otsingunormaliseerimine

**Files:**
- Create: `mcp/vutt_mcp/library/extract.py`
- Modify: `mcp/tests/library_fixtures.py` (lisa `make_pdf`)
- Test: `mcp/tests/test_library_extract.py`

**Interfaces:**
- Consumes: midagi
- Produces:
  - `class ExtractError(Exception)`
  - `extract_pages(pdf_path: Path) -> list[str]`
  - `normalize_for_search(text: str) -> str`
  - fixture: `make_pdf(path, pages: list[str], labels=None) -> Path`

- [ ] **Step 1: Add the PDF fixture generator**

Lisa `mcp/tests/library_fixtures.py` lõppu. **See kood on jooksutatud ja
kontrollitud** — `pdftotext` loeb selle väljundi, `pypdf.page_labels` tagastab
`['i', 'ii', '1']` allpool oleva `labels` näite puhul.

```python
def make_pdf(path, pages, labels=None):
    """Minimaalne PDF ilma väliste sõltuvusteta.

    pages: list[str] — iga lehe tekst (reavahetus = uus rida lehel).
    labels: [(lehe_indeks, stiil, algus)] — stiil 'r' (rooma väike),
            'D' (araabia), 'A' (suur täht). Nt [(0,'r',None), (12,'D',1)].
    """
    objs, n = {}, len(pages)
    kids = " ".join(f"{4 + 2 * i} 0 R" for i in range(n))
    pl = ""
    if labels:
        nums = " ".join(
            f"{idx} << /S /{style}" + (f" /St {start}" if start else "") + " >>"
            for idx, style, start in labels
        )
        pl = f" /PageLabels << /Nums [ {nums} ] >>"
    objs[1] = f"<< /Type /Catalog /Pages 2 0 R{pl} >>"
    objs[2] = f"<< /Type /Pages /Kids [ {kids} ] /Count {n} >>"
    objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    for i, text in enumerate(pages):
        lines = "".join(
            f"BT /F1 12 Tf 50 {700 - 15 * j} Td ({_esc(ln)}) Tj ET\n"
            for j, ln in enumerate(text.split("\n"))
        )
        objs[4 + 2 * i] = (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {5 + 2 * i} 0 R >>"
        )
        objs[5 + 2 * i] = ("STREAM", lines)

    out, offsets = bytearray(b"%PDF-1.4\n"), {}
    for num in sorted(objs):
        offsets[num] = len(out)
        body = objs[num]
        if isinstance(body, tuple):
            data = body[1].encode("latin-1")
            out += f"{num} 0 obj\n<< /Length {len(data)} >>\nstream\n".encode()
            out += data + b"\nendstream\nendobj\n"
        else:
            out += f"{num} 0 obj\n{body}\nendobj\n".encode("latin-1")
    xref = len(out)
    top = max(objs) + 1
    out += f"xref\n0 {top}\n0000000000 65535 f \n".encode()
    for num in range(1, top):
        out += (f"{offsets[num]:010d} 00000 n \n".encode() if num in offsets
                else b"0000000000 65535 f \n")
    out += f"trailer\n<< /Size {top} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    Path(path).write_bytes(bytes(out))
    return Path(path)


def _esc(s):
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
```

- [ ] **Step 2: Write the failing test**

```python
# mcp/tests/test_library_extract.py
import pytest
from library_fixtures import make_pdf

from vutt_mcp.library.extract import ExtractError, extract_pages, normalize_for_search


def test_ekstraheerib_lehekulgede_kaupa(tmp_path):
    pdf = make_pdf(tmp_path / "a.pdf", ["Esimene lehekulg.", "Teine lehekulg."])
    lehed = extract_pages(pdf)
    assert len(lehed) == 2
    assert "Esimene" in lehed[0]
    assert "Teine" in lehed[1]


def test_puuduv_fail_kukub(tmp_path):
    with pytest.raises(ExtractError):
        extract_pages(tmp_path / "pole.pdf")


def test_normaliseerimine_liidab_poolitatud_sona():
    toores = "disputa-\ntio de anima"
    assert "disputatio" in normalize_for_search(toores)


def test_normaliseerimine_uhtlustab_tyhikud():
    assert normalize_for_search("a   b\n\n c") == "a b c"


def test_normaliseerimine_ei_liida_paris_sidekriipsu():
    # Rea SEES olev sidekriips ei ole poolitus.
    assert "Gustavo-Carolina" in normalize_for_search("Academia Gustavo-Carolina")
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_extract.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'vutt_mcp.library.extract'`

- [ ] **Step 4: Write minimal implementation**

```python
# mcp/vutt_mcp/library/extract.py
"""PDF → lehekülgede tekst + otsingunormaliseerimine.

Kaks tekstikuju, sama muster mis VUTT-is (ADR 0006): toores `text` on ainus
tagastatav, normaliseeritud kuju elab ainult otsinguindeksis.
"""
import re
import subprocess
import unicodedata
from pathlib import Path

LEHEERALDAJA = "\f"


class ExtractError(Exception):
    """PDF-ist ei saanud teksti."""


def extract_pages(pdf_path: Path) -> list[str]:
    """pdftotext -layout, lehekülg kaupa. Pikslit ei renderdata, OCR-i ei puutu."""
    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        raise ExtractError(f"faili ei ole: {pdf_path}")
    try:
        tulem = subprocess.run(
            ["pdftotext", "-layout", str(pdf_path), "-"],
            capture_output=True, text=True, check=True,
        )
    except FileNotFoundError as e:
        raise ExtractError("pdftotext puudub (paigalda poppler-utils)") from e
    except subprocess.CalledProcessError as e:
        raise ExtractError(f"pdftotext kukkus: {e.stderr[:200]}") from e

    lehed = tulem.stdout.split(LEHEERALDAJA)
    if lehed and not lehed[-1].strip():
        lehed.pop()  # pdftotext lisab lõppu tühja saba
    return lehed


def normalize_for_search(text: str) -> str:
    """Konservatiivne: reavahetuse poolitused kokku, tühikud ühtlaseks, NFC.

    Rea SEES olevat sidekriipsu (Gustavo-Carolina) EI puutu.
    """
    text = unicodedata.normalize("NFC", text)
    text = re.sub(r"(\w)[-­]\s*\n\s*(\w)", r"\1\2", text)
    return re.sub(r"\s+", " ", text).strip()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_extract.py -v`
Expected: PASS (5 testi)

- [ ] **Step 6: Commit**

```bash
git add mcp/vutt_mcp/library/extract.py mcp/tests/library_fixtures.py \
        mcp/tests/test_library_extract.py
git commit -m "feat(library): pdftotext-ekstraktsioon + otsingunormaliseerimine"
```

---

### Task 7: Leheküljekaardistus (PageLabels → tuvastus → sidecar)

**Files:**
- Create: `mcp/vutt_mcp/library/pages.py`
- Modify: `mcp/pyproject.toml` (lisa `pypdf` sõltuvus)
- Test: `mcp/tests/test_library_pages.py`

**Interfaces:**
- Consumes: midagi
- Produces:
  - `@dataclass PageMapping: labels: list[str | None]`, `source: str`,
    `confidence: float`, `summary: str`
  - `from_pdf_labels(pdf_path: Path, page_count: int) -> PageMapping | None`
  - `detect_from_text(pages: list[str]) -> PageMapping | None`
  - `from_sidecar(sidecar_path: Path, page_count: int) -> PageMapping | None`
  - `resolve_mapping(pdf_path, pages, sidecar_path) -> PageMapping`

- [ ] **Step 1: Write the failing test**

```python
# mcp/tests/test_library_pages.py
import json

from library_fixtures import make_pdf

from vutt_mcp.library.pages import (
    detect_from_text,
    from_pdf_labels,
    from_sidecar,
    resolve_mapping,
)


def test_pagelabels_rooma_ja_araabia(tmp_path):
    pdf = make_pdf(tmp_path / "a.pdf", ["a", "b", "c"],
                   labels=[(0, "r", None), (2, "D", 1)])
    m = from_pdf_labels(pdf, 3)
    assert m.labels == ["i", "ii", "1"]
    assert m.source == "pagelabels"


def test_pagelabelsita_pdf_annab_none(tmp_path):
    pdf = make_pdf(tmp_path / "a.pdf", ["a", "b"])
    assert from_pdf_labels(pdf, 2) is None


def test_tuvastus_leiab_pusiva_nihke():
    # PDF-lehed 0..7; trükitud number jaluses, nihe +3 (PDF 4 → lk 1).
    lehed = ["tiitel", "tyhi", "sisukord", "eessona"] + [
        f"sisu sisu sisu\n\n{n}" for n in range(1, 5)
    ]
    m = detect_from_text(lehed)
    assert m is not None
    assert m.labels[4:] == ["1", "2", "3", "4"]
    assert m.labels[:4] == [None, None, None, None]
    assert m.source == "detected"
    assert 0 < m.confidence <= 1


def test_tuvastus_ei_leia_midagi():
    assert detect_from_text(["ainult teksti", "ilma numbriteta"]) is None


def test_sidecar_vahemikega(tmp_path):
    sc = tmp_path / "A.override.json"
    sc.write_text(json.dumps({"ranges": [
        {"pdf_from": 1, "pdf_to": 2, "style": "roman", "printed_from": "i"},
        {"pdf_from": 3, "pdf_to": 3, "printed": None},
        {"pdf_from": 4, "pdf_to": 5, "style": "arabic", "printed_from": "225"},
    ]}))
    m = from_sidecar(sc, 5)
    assert m.labels == ["i", "ii", None, "225", "226"]
    assert m.source == "sidecar"


def test_sidecar_voidab_pagelabelsi(tmp_path):
    pdf = make_pdf(tmp_path / "a.pdf", ["a", "b"], labels=[(0, "D", 1)])
    sc = tmp_path / "A.override.json"
    sc.write_text(json.dumps({"ranges": [
        {"pdf_from": 1, "pdf_to": 2, "style": "arabic", "printed_from": "50"},
    ]}))
    m = resolve_mapping(pdf, ["a", "b"], sc)
    assert m.labels == ["50", "51"]
    assert m.source == "sidecar"


def test_tuvastamata_annab_none_allika(tmp_path):
    pdf = make_pdf(tmp_path / "a.pdf", ["ilma numbriteta", "samuti"])
    m = resolve_mapping(pdf, ["ilma numbriteta", "samuti"], None)
    assert m.source == "none"
    assert m.labels == [None, None]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_pages.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'vutt_mcp.library.pages'`

- [ ] **Step 3: Add pypdf dependency**

`mcp/pyproject.toml`, rida 6:

```toml
dependencies = ["mcp>=2,<3", "httpx>=0.28.0", "pypdf>=5.0.0"]
```

Paigalda: `.venv/bin/pip install -e mcp/`

- [ ] **Step 4: Write minimal implementation**

```python
# mcp/vutt_mcp/library/pages.py
"""Leheküljekaardistus: PDF-i lehe indeks → trükise leheküljenumber.

Tõeallikas on IGA LEHE silt, mitte globaalne nihe: köide algab rooma
eessõnaga, vahel on nummerdamata tahvel, ja seos katkeb. Silt on TEKST
(xviii, A3, 225a) või None. None tähendab „teadmata" — ja teadmata numbrit
EI OLETATA.
"""
import json
import re
from dataclasses import dataclass
from pathlib import Path

MIN_JADA = 5  # nii mitu järjestikust lehte peab nihe kehtima, et teda uskuda
ROOMA = [(1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"),
         (90, "xc"), (50, "l"), (40, "xl"), (10, "x"), (9, "ix"),
         (5, "v"), (4, "iv"), (1, "i")]


@dataclass(frozen=True)
class PageMapping:
    labels: list          # list[str | None], pikkus == lehtede arv
    source: str           # pagelabels | detected | sidecar | none
    confidence: float
    summary: str


def _rooma(n: int) -> str:
    tulem = []
    for vaartus, tähis in ROOMA:
        while n >= vaartus:
            tulem.append(tähis)
            n -= vaartus
    return "".join(tulem)


def _taht(n: int) -> str:
    return chr(ord("A") + (n - 1) % 26) * (1 + (n - 1) // 26)


def _kokkuvote(labels: list) -> str:
    """Inimloetav kokkuvõte, nt 'i–ii, siis 1–4; 1 nummerdamata'."""
    tükid, teadmata = [], sum(1 for x in labels if x is None)
    algus = None
    for i, silt in enumerate(labels + [None]):
        if silt is not None and algus is None:
            algus = i
        elif silt is None and algus is not None:
            tükid.append(f"{labels[algus]}–{labels[i - 1]}"
                         if i - 1 > algus else f"{labels[algus]}")
            algus = None
    osad = [", ".join(tükid)] if tükid else []
    if teadmata:
        osad.append(f"{teadmata} lk nummerdamata")
    return "; ".join(osad) or "numeratsioon teadmata"


def from_pdf_labels(pdf_path: Path, page_count: int) -> PageMapping | None:
    """PDF-i enda /PageLabels — kui olemas, autoritatiivne."""
    try:
        from pypdf import PdfReader

        lugeja = PdfReader(str(pdf_path))
        if "/PageLabels" not in lugeja.trailer["/Root"]:
            return None
        sildid = [str(x) for x in lugeja.page_labels][:page_count]
    except Exception:
        return None
    if not sildid:
        return None
    return PageMapping(sildid, "pagelabels", 1.0, _kokkuvote(sildid))


def detect_from_text(pages: list) -> PageMapping | None:
    """Otsib pea- ja jalusridadelt numbrit ning püsivat seost trükitud = pdf + k.

    Nihet usutakse ainult MIN_JADA järjestikuse lehe korral — üksik juhuslik
    number lehe servas ei tohi tervet köidet valesti nummerdada.
    """
    kandidaadid = {}
    for idx, tekst in enumerate(pages):
        read = [r.strip() for r in tekst.splitlines() if r.strip()]
        for rida in read[:2] + read[-2:]:
            leid = re.fullmatch(r"(\d{1,4})", rida)
            if leid:
                kandidaadid[idx] = int(leid.group(1))
                break

    jadad, praegu = [], []
    for idx in sorted(kandidaadid):
        nihe = kandidaadid[idx] - idx
        if praegu and praegu[-1][1] == nihe and idx == praegu[-1][0] + 1:
            praegu.append((idx, nihe))
        else:
            if len(praegu) >= MIN_JADA:
                jadad.append(praegu)
            praegu = [(idx, nihe)]
    if len(praegu) >= MIN_JADA:
        jadad.append(praegu)
    if not jadad:
        return None

    sildid = [None] * len(pages)
    kaetud = 0
    for jada in jadad:
        nihe = jada[0][1]
        for idx, _ in jada:
            sildid[idx] = str(idx + nihe)
            kaetud += 1
    return PageMapping(sildid, "detected", kaetud / len(pages), _kokkuvote(sildid))


def from_sidecar(sidecar_path: Path, page_count: int) -> PageMapping | None:
    """Käsitsi ülekirjutus. Kirjeldab VAHEMIKKE, mitte üht nihet."""
    sidecar_path = Path(sidecar_path)
    if not sidecar_path.exists():
        return None
    andmed = json.loads(sidecar_path.read_text(encoding="utf-8"))
    sildid = [None] * page_count
    for vahemik in andmed.get("ranges", []):
        algus, lopp = int(vahemik["pdf_from"]), int(vahemik["pdf_to"])
        if "printed" in vahemik and vahemik["printed"] is None:
            continue  # nummerdamata
        stiil = vahemik.get("style", "arabic")
        esimene = str(vahemik["printed_from"])
        n = _rooma_arvuks(esimene) if stiil == "roman" else int(esimene)
        for offset, pdf in enumerate(range(algus, lopp + 1)):
            if 1 <= pdf <= page_count:
                vaartus = n + offset
                sildid[pdf - 1] = (
                    _rooma(vaartus) if stiil == "roman"
                    else _taht(vaartus) if stiil == "letter"
                    else str(vaartus)
                )
    return PageMapping(sildid, "sidecar", 1.0, _kokkuvote(sildid))


def _rooma_arvuks(s: str) -> int:
    vaartused = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100, "d": 500, "m": 1000}
    s, tulem, eelmine = s.lower(), 0, 0
    for täht in reversed(s):
        v = vaartused[täht]
        tulem += -v if v < eelmine else v
        eelmine = max(eelmine, v)
    return tulem


def resolve_mapping(pdf_path: Path, pages: list,
                    sidecar_path: Path | None) -> PageMapping:
    """Prioriteet: sidecar > PageLabels > tuvastus > teadmata."""
    n = len(pages)
    if sidecar_path is not None:
        m = from_sidecar(sidecar_path, n)
        if m is not None:
            return m
    m = from_pdf_labels(pdf_path, n)
    if m is not None:
        return m
    m = detect_from_text(pages)
    if m is not None:
        return m
    return PageMapping([None] * n, "none", 0.0, "numeratsioon teadmata")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_pages.py -v`
Expected: PASS (7 testi)

- [ ] **Step 6: Commit**

```bash
git add mcp/vutt_mcp/library/pages.py mcp/pyproject.toml \
        mcp/tests/test_library_pages.py
git commit -m "feat(library): leheküljekaardistus (PageLabels/tuvastus/sidecar)"
```

---

### Task 8: Indekseerija — sõrmejälg, elutsükkel, aatomilisus, lukk

**Files:**
- Create: `mcp/vutt_mcp/library/indexer.py`
- Test: `mcp/tests/test_library_indexer.py`

**Interfaces:**
- Consumes: `zotero.*`, `schema.*`, `extract.*`, `pages.*`, `config.*`
- Produces:
  - `fingerprint(doc: ZoteroDoc, sidecar_hash: str | None) -> str`
  - `@dataclass IndexReport`: `added`, `updated`, `skipped`, `removed` (int),
    `broken_links: list`, `no_mapping: list`, `no_text: list`,
    `subcollections: list`, `source: str`
  - `run_index(settings: LibrarySettings, *, full: bool = False) -> IndexReport`
  - `class IndexLocked(Exception)`, `class IndexLock`

- [ ] **Step 1: Write the failing test**

```python
# mcp/tests/test_library_indexer.py
import json

import pytest
from library_fixtures import FakeZoteroAPI, kirje, kollektsioon, make_pdf, manus

from vutt_mcp.library.config import LibrarySettings
from vutt_mcp.library.indexer import IndexLock, IndexLocked, run_index
from vutt_mcp.library.schema import connect

KOGUD = [kollektsioon("K1", "VUTT kirjandus")]
VANEM = kirje("ITEM0001", title="Teos", date="1984",
              creators=[{"creatorType": "editor", "firstName": "Arvo",
                         "lastName": "Tering"}])


def _pdf(tmp_path, att_key, lehed, labels=None):
    kaust = tmp_path / "storage" / att_key
    kaust.mkdir(parents=True, exist_ok=True)
    make_pdf(kaust / "f.pdf", lehed, labels=labels)


def _settings(tmp_path, base):
    return LibrarySettings(db_path=tmp_path / "library.db",
                           collection="VUTT kirjandus", zotero_dir=tmp_path,
                           api_base=base)


def test_esimene_jooks_indekseerib(tmp_path):
    _pdf(tmp_path, "ATT00001", ["Ludenius", "teine"])
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        aruanne = run_index(_settings(tmp_path, base))
    assert aruanne.added == 1
    conn = connect(tmp_path / "library.db", read_only=True)
    assert conn.execute("SELECT COUNT(*) FROM pages").fetchone()[0] == 2
    assert conn.execute("SELECT title FROM documents").fetchone()[0] == "Teos"


def test_muutumatu_jaab_vahele(tmp_path):
    _pdf(tmp_path, "ATT00001", ["a", "b"])
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        s = _settings(tmp_path, base)
        run_index(s)
        teine = run_index(s)
    assert teine.skipped == 1 and teine.added == 0 and teine.updated == 0


def test_bibliokirje_muutus_uuendab_ilma_pdf_muutuseta(tmp_path):
    _pdf(tmp_path, "ATT00001", ["a", "b"])
    m = manus("ATT00001", "ITEM0001", filename="f.pdf")
    with FakeZoteroAPI(collections=KOGUD, items={"K1": [VANEM, m]}) as base:
        run_index(_settings(tmp_path, base))
    parandatud = kirje("ITEM0001", title="Parandatud", date="1984", creators=[])
    with FakeZoteroAPI(collections=KOGUD, items={"K1": [parandatud, m]}) as base:
        aruanne = run_index(_settings(tmp_path, base))
    assert aruanne.updated == 1
    conn = connect(tmp_path / "library.db", read_only=True)
    assert conn.execute("SELECT title FROM documents").fetchone()[0] == "Parandatud"


def test_sidecar_muutus_uuendab_numeratsiooni(tmp_path):
    _pdf(tmp_path, "ATT00001", ["a", "b"])
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        s = _settings(tmp_path, base)
        run_index(s)
        sc = s.db_path.parent / "sidecar" / "ATT00001.override.json"
        sc.parent.mkdir(parents=True, exist_ok=True)
        sc.write_text(json.dumps({"ranges": [
            {"pdf_from": 1, "pdf_to": 2, "style": "arabic",
             "printed_from": "100"}]}))
        aruanne = run_index(s)
    assert aruanne.updated == 1
    conn = connect(tmp_path / "library.db", read_only=True)
    sildid = [r[0] for r in conn.execute(
        "SELECT printed_page FROM pages ORDER BY pdf_page")]
    assert sildid == ["100", "101"]


def test_kollektsioonist_eemaldamine_kustutab_indeksist(tmp_path):
    _pdf(tmp_path, "ATT00001", ["a"])
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        run_index(_settings(tmp_path, base))
    with FakeZoteroAPI(collections=KOGUD, items={"K1": []}) as base:
        aruanne = run_index(_settings(tmp_path, base))
    assert aruanne.removed == 1
    conn = connect(tmp_path / "library.db", read_only=True)
    assert conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM pages_fts").fetchone()[0] == 0


def test_kadunud_fail_sailitab_teksti(tmp_path):
    _pdf(tmp_path, "ATT00001", ["Ludenius"])
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        s = _settings(tmp_path, base)
        run_index(s)
        (tmp_path / "storage" / "ATT00001" / "f.pdf").unlink()
        aruanne = run_index(s)
    assert "ATT00001" in aruanne.broken_links
    conn = connect(tmp_path / "library.db", read_only=True)
    assert conn.execute("SELECT COUNT(*) FROM pages").fetchone()[0] == 1
    assert conn.execute("SELECT file_missing FROM documents").fetchone()[0] == 1


def test_alamkollektsioonid_indekseeritakse(tmp_path):
    _pdf(tmp_path, "ATT00001", ["ylem"])
    _pdf(tmp_path, "ATT00002", ["alam"])
    kogud = KOGUD + [kollektsioon("K2", "Alam", parent="K1")]
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")],
             "K2": [VANEM, manus("ATT00002", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=kogud, subcollections={"K1": ["K2"]},
                       items=items) as base:
        aruanne = run_index(_settings(tmp_path, base))
    assert aruanne.added == 2
    assert "Alam" in " ".join(aruanne.subcollections)


def test_lukk_valistab_teise_jooksu(tmp_path):
    with FakeZoteroAPI(collections=KOGUD, items={"K1": []}) as base:
        s = _settings(tmp_path, base)
        with IndexLock(s.db_path):
            with pytest.raises(IndexLocked):
                run_index(s)


def test_katkestatud_jooks_jatab_eelmise_indeksi_terveks(tmp_path, monkeypatch):
    _pdf(tmp_path, "ATT00001", ["esimene"])
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        s = _settings(tmp_path, base)
        run_index(s)

        import vutt_mcp.library.indexer as idx

        def kukub(*a, **kw):
            raise RuntimeError("katkestus")

        monkeypatch.setattr(idx, "extract_pages", kukub)
        (tmp_path / "storage" / "ATT00001" / "f.pdf").write_bytes(b"%PDF-1.4 uus")
        with pytest.raises(RuntimeError):
            run_index(s)
    conn = connect(tmp_path / "library.db", read_only=True)
    assert conn.execute("SELECT COUNT(*) FROM pages").fetchone()[0] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_indexer.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'vutt_mcp.library.indexer'`

- [ ] **Step 3: Write minimal implementation**

```python
# mcp/vutt_mcp/library/indexer.py
"""Indekseerija: Zotero Local API → library.db.

Sõrmejälg katab VIIS osa — fail, bibliokirje, sidecar, ekstraktori ja skeemi
versioon. Ainult faili jälgimine jätaks Zoteros parandatud autori või muudetud
sidecar'i vaikselt vanaks.
"""
import hashlib
import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .config import EXTRACTOR_VERSION, INDEXER_SCHEMA_VERSION, LibrarySettings
from .extract import ExtractError, extract_pages, normalize_for_search
from .pages import resolve_mapping
from .schema import connect, create_schema
from .zotero import (
    ZoteroDoc,
    check_api,
    collection_tree,
    iter_documents,
    resolve_collection,
)


class IndexLocked(Exception):
    """Teine vutt-library index juba jookseb."""


class IndexLock:
    """Failipõhine lukk — kaks indekseerijat ei tohi korraga kirjutada."""

    def __init__(self, db_path: Path):
        self.tee = Path(str(db_path) + ".lock")

    def __enter__(self):
        self.tee.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.fd = os.open(self.tee, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError as e:
            raise IndexLocked(
                f"indekseerimine juba käib (lukk: {self.tee}). "
                "Kui see on jäänuk, kustuta fail käsitsi."
            ) from e
        os.write(self.fd, str(os.getpid()).encode())
        return self

    def __exit__(self, *exc):
        os.close(self.fd)
        self.tee.unlink(missing_ok=True)
        return False


@dataclass
class IndexReport:
    added: int = 0
    updated: int = 0
    skipped: int = 0
    removed: int = 0
    broken_links: list = field(default_factory=list)
    no_mapping: list = field(default_factory=list)
    no_text: list = field(default_factory=list)
    subcollections: list = field(default_factory=list)
    source: str = ""


def _sidecar_tee(settings: LibrarySettings, doc_id: str) -> Path:
    return settings.db_path.parent / "sidecar" / f"{doc_id}.override.json"


def _hash(*osad: str) -> str:
    h = hashlib.sha256()
    for osa in osad:
        h.update(osa.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()


def fingerprint(doc: ZoteroDoc, sidecar_hash: str | None) -> str:
    """Viis osa: fail + bibliokirje + sidecar + ekstraktor + skeem."""
    if doc.path is not None and doc.path.exists():
        st = doc.path.stat()
        faili_osa = f"{doc.path}|{st.st_mtime_ns}|{st.st_size}"
    else:
        faili_osa = f"{doc.path}|PUUDUB"
    bib_osa = json.dumps(
        {
            "creators": doc.bib.creators, "title": doc.bib.title,
            "year": doc.bib.year, "place": doc.bib.place,
            "publisher": doc.bib.publisher, "publication": doc.bib.publication,
            "volume": doc.bib.volume, "issue": doc.bib.issue,
            "pages": doc.bib.pages, "series": doc.bib.series,
            "edition": doc.bib.edition, "isbn": doc.bib.isbn, "doi": doc.bib.doi,
        },
        sort_keys=True, ensure_ascii=False,
    )
    return _hash(faili_osa, bib_osa, sidecar_hash or "-",
                 str(EXTRACTOR_VERSION), str(INDEXER_SCHEMA_VERSION))


def _kirjuta_dokument(conn, doc: ZoteroDoc, coll_key: str, mapping, lehed,
                      fp: str) -> None:
    """Dokument + leheküljed ÜHE transaktsiooni sees (kutsuja hoiab tehingut)."""
    conn.execute("DELETE FROM pages WHERE doc_id = ?", (doc.doc_id,))
    conn.execute("DELETE FROM pages_fts WHERE doc_id = ?", (doc.doc_id,))
    conn.execute("DELETE FROM documents WHERE doc_id = ?", (doc.doc_id,))
    conn.execute(
        """INSERT INTO documents (doc_id, parent_key, collection_key, title,
             creators_json, year, place, publisher, publication, volume, issue,
             pages, series, edition, isbn, doi, file_path, link_mode,
             file_missing, page_count, page_mapping_source,
             page_mapping_confidence, page_mapping_summary, fingerprint, indexed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (doc.doc_id, doc.parent_key, coll_key, doc.bib.title,
         json.dumps(doc.bib.creators, ensure_ascii=False), doc.bib.year,
         doc.bib.place, doc.bib.publisher, doc.bib.publication, doc.bib.volume,
         doc.bib.issue, doc.bib.pages, doc.bib.series, doc.bib.edition,
         doc.bib.isbn, doc.bib.doi, str(doc.path), doc.link_mode,
         int(doc.file_missing), len(lehed), mapping.source, mapping.confidence,
         mapping.summary, fp, datetime.now(timezone.utc).isoformat()),
    )
    for nr, tekst in enumerate(lehed, start=1):
        conn.execute(
            "INSERT INTO pages (doc_id, pdf_page, printed_page, text) "
            "VALUES (?,?,?,?)",
            (doc.doc_id, nr, mapping.labels[nr - 1], tekst),
        )
        conn.execute(
            "INSERT INTO pages_fts (doc_id, pdf_page, search_text) VALUES (?,?,?)",
            (doc.doc_id, nr, normalize_for_search(tekst)),
        )


def run_index(settings: LibrarySettings, *, full: bool = False) -> IndexReport:
    aruanne = IndexReport(source=settings.api_base)
    with IndexLock(settings.db_path):
        check_api(settings.api_base)
        coll_key, _ = resolve_collection(settings.api_base, settings.collection)
        puu = collection_tree(settings.api_base, coll_key)
        aruanne.subcollections = [nimi for _, nimi in puu]
        dokumendid = iter_documents(
            settings.api_base, settings.zotero_dir / "storage",
            [key for key, _ in puu])

        conn = connect(settings.db_path)
        create_schema(conn)
        if full:
            conn.executescript(
                "DELETE FROM pages; DELETE FROM pages_fts; DELETE FROM documents;")
            conn.commit()

        olemas = {
            r["doc_id"]: r["fingerprint"]
            for r in conn.execute("SELECT doc_id, fingerprint FROM documents")
        }

        for doc in dokumendid:
            sc = _sidecar_tee(settings, doc.doc_id)
            sc_hash = (
                hashlib.sha256(sc.read_bytes()).hexdigest() if sc.exists() else None
            )
            fp = fingerprint(doc, sc_hash)
            if doc.doc_id in olemas and olemas[doc.doc_id] == fp:
                aruanne.skipped += 1
                continue

            if doc.file_missing:
                aruanne.broken_links.append(doc.doc_id)
                if doc.doc_id in olemas:
                    # Fail kadus, kirje jääb kogusse: tekst SÄILIB.
                    conn.execute(
                        "UPDATE documents SET file_missing = 1 WHERE doc_id = ?",
                        (doc.doc_id,))
                    conn.commit()
                    aruanne.updated += 1
                continue

            try:
                lehed = extract_pages(doc.path)
            except ExtractError:
                aruanne.no_text.append(doc.doc_id)
                continue
            if not any(l.strip() for l in lehed):
                aruanne.no_text.append(doc.doc_id)
                continue

            mapping = resolve_mapping(doc.path, lehed, sc if sc.exists() else None)
            if mapping.source == "none":
                aruanne.no_mapping.append(doc.doc_id)

            # ÜKS transaktsioon dokumendi kohta: MCP ei näe poolikut seisu.
            with conn:
                _kirjuta_dokument(conn, doc, coll_key, mapping, lehed, fp)
            if doc.doc_id in olemas:
                aruanne.updated += 1
            else:
                aruanne.added += 1

        # Kogust eemaldatud või prügikasti läinud → indeksist välja.
        praegused = {d.doc_id for d in dokumendid}
        for doc_id in olemas:
            if doc_id not in praegused:
                with conn:
                    conn.execute("DELETE FROM pages WHERE doc_id = ?", (doc_id,))
                    conn.execute("DELETE FROM pages_fts WHERE doc_id = ?", (doc_id,))
                    conn.execute("DELETE FROM documents WHERE doc_id = ?", (doc_id,))
                aruanne.removed += 1
        conn.close()
    return aruanne
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_indexer.py -v`
Expected: PASS (9 testi)

- [ ] **Step 5: Commit**

```bash
git add mcp/vutt_mcp/library/indexer.py mcp/tests/test_library_indexer.py
git commit -m "feat(library): indekseerija — sõrmejälg, elutsükkel, lukk"
```

---

### Task 9: Päringukiht — FTS-parser ja otsing

**Files:**
- Create: `mcp/vutt_mcp/library/query.py`
- Test: `mcp/tests/test_library_query.py`

**Interfaces:**
- Consumes: `schema.connect`
- Produces:
  - `build_match(query: str, relax: bool) -> str`
  - `@dataclass DocRow`: `doc_id`, `title`, `creators`, `year`, `page_count`,
    `page_mapping_source`, `file_missing`
  - `@dataclass Hit`: `doc_id`, `pdf_page`, `printed_page`, `excerpt`, `doc: DocRow`
  - `list_documents(conn) -> list[DocRow]`
  - `search(conn, query, *, doc_id=None, relax=False, limit=10) -> list[Hit]`
  - `make_excerpt(text: str, tokens: list[str], width: int = 240) -> str`

- [ ] **Step 1: Write the failing test**

```python
# mcp/tests/test_library_query.py
import pytest

from vutt_mcp.library.query import build_match, make_excerpt, search
from vutt_mcp.library.schema import connect, create_schema


@pytest.fixture()
def conn(tmp_path):
    c = connect(tmp_path / "l.db")
    create_schema(c)
    c.execute("INSERT INTO documents (doc_id, parent_key, title, year, page_count) "
              "VALUES ('A','P1','Album academicum','1984',3)")
    lehed = [
        (1, "1", "Laurentius Ludenius oli professor."),
        (2, "2", "Teine lehekulg ilma otsitavata."),
        (3, "3", "Ludenius ja disputa-\ntio samal lehel."),
    ]
    for nr, silt, tekst in lehed:
        c.execute("INSERT INTO pages (doc_id, pdf_page, printed_page, text) "
                  "VALUES ('A',?,?,?)", (nr, silt, tekst))
        from vutt_mcp.library.extract import normalize_for_search
        c.execute("INSERT INTO pages_fts (doc_id, pdf_page, search_text) "
                  "VALUES ('A',?,?)", (nr, normalize_for_search(tekst)))
    c.commit()
    return c


def test_range_sobitamine_nouab_koiki_sonu(conn):
    assert len(search(conn, "Ludenius professor")) == 1
    assert search(conn, "Ludenius puudub") == []


def test_lodvendatud_sobitamine_leiab_rohkem(conn):
    assert len(search(conn, "Ludenius puudub", relax=True)) == 2


def test_fts_erimargid_ei_tekita_syntaksiviga(conn):
    for pahur in ['"Ludenius', "Ludenius-", "Ludenius:", "(Ludenius)", "Luden*"]:
        search(conn, pahur)  # ei tohi visata


def test_poolitatud_sona_leitakse_aga_tagastatakse_algsel_kujul(conn):
    hits = search(conn, "disputatio")
    assert len(hits) == 1
    assert "disputa-" in hits[0].excerpt  # katke tuleb TOORESEST tekstist


def test_katke_umbritseb_leitud_sona():
    tekst = "a" * 300 + " Ludenius " + "b" * 300
    katke = make_excerpt(tekst, ["Ludenius"], width=60)
    assert "Ludenius" in katke
    assert len(katke) < 120


def test_build_match_tsiteerib_tokenid():
    assert build_match("Ludenius professor", relax=False) == '"Ludenius" AND "professor"'
    assert build_match("Ludenius professor", relax=True) == '"Ludenius" OR "professor"'
    assert build_match('"tema oli"', relax=False) == '"tema oli"'


def test_doc_id_piirab(conn):
    conn.execute("INSERT INTO documents (doc_id, parent_key, title) "
                 "VALUES ('B','P2','Teine')")
    conn.execute("INSERT INTO pages_fts (doc_id, pdf_page, search_text) "
                 "VALUES ('B',1,'Ludenius mujal')")
    conn.commit()
    assert len(search(conn, "Ludenius")) == 3
    assert len(search(conn, "Ludenius", doc_id="A")) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_query.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'vutt_mcp.library.query'`

- [ ] **Step 3: Write minimal implementation**

```python
# mcp/vutt_mcp/library/query.py
"""Päringud library.db vastu.

Kaks reeglit, mis on kergesti valesti tehtavad:
1. Kasutaja päring EI LÄHE kunagi toorelt FTS5 MATCH-i — jutumärgid, sulud,
   koolonid ja * on FTS-süntaks.
2. Katke ehitatakse TOORESEST `pages.text`-ist, mitte normaliseeritud
   otsingutekstist — kasutaja peab nägema seda, mis raamatus tegelikult on.
"""
import json
import re
import sqlite3
from dataclasses import dataclass

FRAAS = re.compile(r'"([^"]+)"')
TOKEN = re.compile(r"[\wÀ-ɏ]+", re.UNICODE)


@dataclass(frozen=True)
class DocRow:
    doc_id: str
    title: str
    creators: list
    year: str | None
    page_count: int
    page_mapping_source: str | None
    file_missing: bool


@dataclass(frozen=True)
class Hit:
    doc_id: str
    pdf_page: int
    printed_page: str | None
    excerpt: str
    doc: DocRow


def tokenize(query: str) -> list[str]:
    """Fraasid jutumärkides jäävad terveks, ülejäänu tükeldatakse sõnadeks."""
    tokenid, jaak = [], query
    for fraas in FRAAS.findall(query):
        if fraas.strip():
            tokenid.append(fraas.strip())
        jaak = jaak.replace(f'"{fraas}"', " ")
    tokenid.extend(TOKEN.findall(jaak))
    return [t for t in tokenid if t]


def build_match(query: str, relax: bool) -> str:
    """Kontrollitud FTS5-avaldis. Iga token tsiteeritakse — nii ei saa kasutaja
    sisend kunagi süntaksiks muutuda."""
    tokenid = tokenize(query)
    if not tokenid:
        raise ValueError("päring on tühi")
    tsiteeritud = ['"' + t.replace('"', '""') + '"' for t in tokenid]
    return (" OR " if relax else " AND ").join(tsiteeritud)


def _doc_row(rida: sqlite3.Row) -> DocRow:
    return DocRow(
        doc_id=rida["doc_id"], title=rida["title"],
        creators=json.loads(rida["creators_json"] or "[]"),
        year=rida["year"], page_count=rida["page_count"] or 0,
        page_mapping_source=rida["page_mapping_source"],
        file_missing=bool(rida["file_missing"]),
    )


def list_documents(conn: sqlite3.Connection) -> list:
    return [_doc_row(r) for r in conn.execute(
        "SELECT * FROM documents ORDER BY year, title")]


def make_excerpt(text: str, tokens: list, width: int = 240) -> str:
    """Katke toorest tekstist. Otsib tokenit tolerantselt, et reavahetusega
    poolitatud sõna („disputa-\\ntio") ka originaalist üles leitaks."""
    for token in tokens:
        muster = r"[-­]?\s*".join(re.escape(t) for t in token)
        leid = re.search(muster, text, re.IGNORECASE)
        if leid:
            algus = max(0, leid.start() - width // 2)
            lopp = min(len(text), leid.end() + width // 2)
            katke = text[algus:lopp].strip()
            return ("…" if algus > 0 else "") + katke + ("…" if lopp < len(text) else "")
    return text[:width].strip() + ("…" if len(text) > width else "")


def search(conn: sqlite3.Connection, query: str, *, doc_id: str | None = None,
           relax: bool = False, limit: int = 10) -> list:
    match = build_match(query, relax)
    tokenid = tokenize(query)
    parameetrid = [match]
    filter_sql = ""
    if doc_id:
        filter_sql = " AND f.doc_id = ?"
        parameetrid.append(doc_id)
    parameetrid.append(limit)

    read = conn.execute(
        f"""SELECT f.doc_id, f.pdf_page, p.printed_page, p.text, d.*
              FROM pages_fts f
              JOIN pages p ON p.doc_id = f.doc_id AND p.pdf_page = f.pdf_page
              JOIN documents d ON d.doc_id = f.doc_id
             WHERE pages_fts MATCH ?{filter_sql}
             ORDER BY bm25(pages_fts)
             LIMIT ?""",
        parameetrid,
    ).fetchall()

    return [
        Hit(doc_id=r["doc_id"], pdf_page=r["pdf_page"],
            printed_page=r["printed_page"],
            excerpt=make_excerpt(r["text"], tokenid), doc=_doc_row(r))
        for r in read
    ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_query.py -v`
Expected: PASS (7 testi)

- [ ] **Step 5: Commit**

```bash
git add mcp/vutt_mcp/library/query.py mcp/tests/test_library_query.py
git commit -m "feat(library): FTS-parser ja otsing katketega toorest tekstist"
```

---

### Task 10: Lehevahemiku lahendamine ja lugemine

**Files:**
- Modify: `mcp/vutt_mcp/library/query.py`
- Test: `mcp/tests/test_library_range.py`

**Interfaces:**
- Consumes: `query.DocRow`
- Produces:
  - `class PageRefError(Exception)`
  - `resolve_page_range(conn, doc_id, from_page, to_page, page_ref) -> tuple[int, int]`
  - `@dataclass PageRow`: `pdf_page: int`, `printed_page: str | None`, `text: str`
  - `fetch_pages(conn, doc_id, pdf_from, pdf_to, *, max_pages=20, max_chars=60000)
     -> tuple[list[PageRow], bool]` — `bool` = kas kärbiti

- [ ] **Step 1: Write the failing test**

```python
# mcp/tests/test_library_range.py
import pytest

from vutt_mcp.library.query import PageRefError, fetch_pages, resolve_page_range
from vutt_mcp.library.schema import connect, create_schema


@pytest.fixture()
def conn(tmp_path):
    c = connect(tmp_path / "l.db")
    create_schema(c)
    c.execute("INSERT INTO documents (doc_id, parent_key, title, page_count) "
              "VALUES ('A','P','Teos',6)")
    # PDF 1-2 = rooma i-ii, PDF 3 = nummerdamata, PDF 4-6 = trükitud 1-3
    sildid = ["i", "ii", None, "1", "2", "3"]
    for nr, silt in enumerate(sildid, start=1):
        c.execute("INSERT INTO pages (doc_id, pdf_page, printed_page, text) "
                  "VALUES ('A',?,?,?)", (nr, silt, f"tekst {nr} " * 50))
    c.commit()
    return c


def test_pdf_numeratsioon(conn):
    assert resolve_page_range(conn, "A", "2", "4", "pdf") == (2, 4)


def test_trukitud_numeratsioon(conn):
    assert resolve_page_range(conn, "A", "1", "3", "printed") == (4, 6)


def test_trukitud_rooma(conn):
    assert resolve_page_range(conn, "A", "i", "ii", "printed") == (1, 2)


def test_tundmatu_silt_kukub_ja_loetleb_labimad(conn):
    with pytest.raises(PageRefError) as exc:
        resolve_page_range(conn, "A", "99", "100", "printed")
    assert "99" in str(exc.value)
    assert "i" in str(exc.value) or "1" in str(exc.value)  # naabersildid näidatakse


def test_pdf_vahemik_valjaspool_kukub(conn):
    with pytest.raises(PageRefError):
        resolve_page_range(conn, "A", "1", "99", "pdf")


def test_fetch_austab_lehepiiri(conn):
    read, karbitud = fetch_pages(conn, "A", 1, 6, max_pages=2)
    assert len(read) == 2
    assert karbitud is True


def test_fetch_austab_margipiiri(conn):
    read, karbitud = fetch_pages(conn, "A", 1, 6, max_pages=20, max_chars=500)
    assert karbitud is True
    assert sum(len(r.text) for r in read) <= 500 + 500  # vähemalt üks leht mahub


def test_fetch_ilma_karpimiseta(conn):
    read, karbitud = fetch_pages(conn, "A", 1, 3, max_pages=20, max_chars=10**6)
    assert len(read) == 3 and karbitud is False
    assert read[0].printed_page == "i"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_range.py -v`
Expected: FAIL — `ImportError: cannot import name 'resolve_page_range'`

- [ ] **Step 3: Write minimal implementation**

Lisa `query.py` lõppu:

```python
class PageRefError(Exception):
    """Lehevahemikku ei saa üheselt lahendada."""


@dataclass(frozen=True)
class PageRow:
    pdf_page: int
    printed_page: str | None
    text: str


def _sildid(conn: sqlite3.Connection, doc_id: str) -> list:
    return [r["printed_page"] for r in conn.execute(
        "SELECT printed_page FROM pages WHERE doc_id = ? ORDER BY pdf_page",
        (doc_id,))]


def resolve_page_range(conn: sqlite3.Connection, doc_id: str, from_page: str,
                       to_page: str, page_ref: str) -> tuple:
    """Sisendvahemik → (pdf_from, pdf_to).

    `printed` on TEKST-silt, seega vahemikku EI SAA võtta võrdlusoperaatoriga:
    algusest võetakse väikseim ja lõpust suurim vastav pdf_page. Tundmatu silt
    KUKUB — lähimat lehte ei valita vaikselt.
    """
    if page_ref not in ("printed", "pdf"):
        raise PageRefError("page_ref peab olema 'printed' või 'pdf'")

    if page_ref == "pdf":
        try:
            algus, lopp = int(from_page), int(to_page)
        except ValueError as e:
            raise PageRefError("PDF-numeratsioonis peab sisend olema täisarv") from e
        olemas = conn.execute(
            "SELECT MIN(pdf_page), MAX(pdf_page) FROM pages WHERE doc_id = ?",
            (doc_id,)).fetchone()
        if olemas[0] is None:
            raise PageRefError(f"dokumendil {doc_id} ei ole indekseeritud lehti")
        if algus < olemas[0] or lopp > olemas[1]:
            raise PageRefError(
                f"PDF-vahemik {algus}–{lopp} on väljaspool dokumenti "
                f"(olemas {olemas[0]}–{olemas[1]})")
        return algus, lopp

    def leia(silt: str, funktsioon: str) -> int | None:
        rida = conn.execute(
            f"SELECT {funktsioon}(pdf_page) FROM pages "
            "WHERE doc_id = ? AND printed_page = ?", (doc_id, str(silt))).fetchone()
        return rida[0]

    algus, lopp = leia(from_page, "MIN"), leia(to_page, "MAX")
    puuduvad = [s for s, v in ((from_page, algus), (to_page, lopp)) if v is None]
    if puuduvad:
        koik = [s for s in _sildid(conn, doc_id) if s]
        naide = ", ".join(koik[:5] + (["…"] if len(koik) > 5 else []))
        raise PageRefError(
            f"trükitud lehekülge {', '.join(map(str, puuduvad))} ei ole "
            f"dokumendis {doc_id}. Olemasolevad sildid algavad: {naide or '(puuduvad)'}. "
            "Kasuta page_ref='pdf', kui trükitud numeratsioon on teadmata."
        )
    if algus > lopp:
        raise PageRefError(f"vahemiku algus {from_page} on lõpust {to_page} tagapool")
    return algus, lopp


def fetch_pages(conn: sqlite3.Connection, doc_id: str, pdf_from: int, pdf_to: int,
                *, max_pages: int = 20, max_chars: int = 60000) -> tuple:
    """Leheküljed vahemikus. Kaks lage: lehtede arv JA märgimaht."""
    read = conn.execute(
        "SELECT pdf_page, printed_page, text FROM pages "
        "WHERE doc_id = ? AND pdf_page BETWEEN ? AND ? ORDER BY pdf_page",
        (doc_id, pdf_from, pdf_to)).fetchall()

    tulem, margid, karbitud = [], 0, False
    for r in read:
        if len(tulem) >= max_pages:
            karbitud = True
            break
        if tulem and margid + len(r["text"]) > max_chars:
            karbitud = True
            break
        tulem.append(PageRow(r["pdf_page"], r["printed_page"], r["text"]))
        margid += len(r["text"])
    if len(read) > len(tulem):
        karbitud = True
    return tulem, karbitud
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_range.py -v`
Expected: PASS (8 testi)

- [ ] **Step 5: Commit**

```bash
git add mcp/vutt_mcp/library/query.py mcp/tests/test_library_range.py
git commit -m "feat(library): lehevahemiku lahendamine (printed/pdf) + kaks lage"
```

---

### Task 11: Vormindus ja MCP-tööriistad

**Files:**
- Create: `mcp/vutt_mcp/library/format.py`
- Create: `mcp/vutt_mcp/library/tools.py`
- Modify: `mcp/vutt_mcp/library/__init__.py`
- Modify: `mcp/vutt_mcp/server.py`
- Test: `mcp/tests/test_library_tools.py`

**Interfaces:**
- Consumes: `query.*`, `config.*`, `schema.connect`
- Produces:
  - `format_citation(doc: DocRow) -> str`
  - `format_page_ref(printed: str | None, pdf: int) -> str`
  - `format_hits(hits, parent_keys) -> str`, `format_pages(...)`, `format_list(...)`
  - `register_library_tools(mcp, settings) -> bool` — `False`, kui kogu puudub

- [ ] **Step 1: Write the failing test**

```python
# mcp/tests/test_library_tools.py
import pytest

from vutt_mcp.library.config import LibrarySettings
from vutt_mcp.library.format import format_citation, format_page_ref
from vutt_mcp.library.query import DocRow
from vutt_mcp.library.schema import connect, create_schema
from vutt_mcp.library.tools import register_library_tools

DOC = DocRow(doc_id="A", title="Album academicum", year="1984",
             creators=[["Arvo Tering", "editor"]], page_count=529,
             page_mapping_source="pagelabels", file_missing=False)


def test_viide_sisaldab_autorit_aastat_pealkirja():
    v = format_citation(DOC)
    assert "Tering" in v and "1984" in v and "Album academicum" in v


def test_lehe_viide_naitab_molemat():
    assert format_page_ref("217", 223) == "lk 217 (PDF 223)"


def test_teadmata_trukitud_number_ei_oleta():
    tulem = format_page_ref(None, 223)
    assert "PDF 223" in tulem
    assert "lk 217" not in tulem
    assert "teadmata" in tulem.lower()


class FakeMcp:
    def __init__(self):
        self.tools = []

    def tool(self, **kwargs):
        assert kwargs.get("structured_output") is False
        def deco(fn):
            self.tools.append(fn.__name__)
            return fn
        return deco


def test_tooriistu_ei_registreerita_ilma_indeksita(tmp_path):
    s = LibrarySettings(db_path=tmp_path / "pole.db", collection="X",
                        zotero_dir=tmp_path)
    mcp = FakeMcp()
    assert register_library_tools(mcp, s) is False
    assert mcp.tools == []


def test_tooriistad_registreeritakse_kui_indeks_olemas(tmp_path):
    db = tmp_path / "l.db"
    create_schema(connect(db))
    s = LibrarySettings(db_path=db, collection="X", zotero_dir=tmp_path)
    mcp = FakeMcp()
    assert register_library_tools(mcp, s) is True
    assert sorted(mcp.tools) == [
        "get_literature_pages", "list_literature", "search_literature"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_tools.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'vutt_mcp.library.format'`

- [ ] **Step 3: Write the formatter**

```python
# mcp/vutt_mcp/library/format.py
"""Tööriistade tekstiväljund.

Leheküljeviite reegel: kuvatakse ALATI mõlemad numbrid. Kui trükitud number on
teadmata, seda EI PAKUTA — vaikne oletus oleks halvem kui puuduv väli.
"""
from .query import DocRow, Hit, PageRow

ZOTERO_LINK = "zotero://select/library/items/{key}"


def _perenimi(nimi: str) -> str:
    return nimi.split()[-1] if nimi else ""


def format_citation(doc: DocRow) -> str:
    loojad = ", ".join(_perenimi(n) for n, _ in doc.creators) or "(autorita)"
    aasta = doc.year or "s.a."
    return f"{loojad} {aasta}, {doc.title}"


def format_page_ref(printed: str | None, pdf: int) -> str:
    if printed is None:
        return f"PDF {pdf} (trükitud lehekülg teadmata)"
    return f"lk {printed} (PDF {pdf})"


def format_list(docs: list) -> str:
    if not docs:
        return "Kogu on tühi. Lisa Zoteros kirjeid kollektsiooni ja jooksuta "\
               "`vutt-library index`."
    read = [f"Kogus on {len(docs)} teost.", ""]
    for d in docs:
        märkused = []
        if d.page_mapping_source in (None, "none"):
            märkused.append("trükitud numeratsioon teadmata")
        if d.file_missing:
            märkused.append("algfail puudub")
        saba = f"  [{'; '.join(märkused)}]" if märkused else ""
        read.append(f"- {d.doc_id}  {format_citation(d)}  ({d.page_count} lk){saba}")
    return "\n".join(read)


def format_hits(hits: list, parent_keys: dict) -> str:
    if not hits:
        return (
            "Ei leidnud ühtki vastet.\n\n"
            "NB: kogu tekst pärineb skaneeringute OCR-ist, mis on kohati "
            "lagunenud (nt „M atthias" " asemel „Matthias"). Tühi tulemus EI "
            "tõesta, et teemat pole käsitletud — proovi teist sõnastust või "
            "relax_matching=true."
        )
    read = [f"Leidsin {len(hits)} vastet.", ""]
    for h in hits:
        link = ZOTERO_LINK.format(key=parent_keys.get(h.doc_id, ""))
        read += [
            f"### {format_citation(h.doc)} — {format_page_ref(h.printed_page, h.pdf_page)}",
            f"doc_id: {h.doc_id}  |  {link}",
            "",
            h.excerpt,
            "",
        ]
    return "\n".join(read)


def format_pages(doc: DocRow, rows: list, truncated: bool, parent_key: str) -> str:
    if not rows:
        return "Selles vahemikus ei ole indekseeritud lehti."
    esimene, viimane = rows[0], rows[-1]
    pais = [
        format_citation(doc),
        ZOTERO_LINK.format(key=parent_key),
        f"Vahemik: {format_page_ref(esimene.printed_page, esimene.pdf_page)} – "
        f"{format_page_ref(viimane.printed_page, viimane.pdf_page)}",
    ]
    if doc.file_missing:
        pais.append("HOIATUS: algfaili ei leia enam kettalt; tekst tuleb indeksist.")
    if truncated:
        pais.append(
            f"KÄRBITUD: tagastati {len(rows)} lehekülge. Jätka alates "
            f"PDF {viimane.pdf_page + 1}.")
    osad = ["\n".join(pais), ""]
    for r in rows:
        osad += [f"--- {format_page_ref(r.printed_page, r.pdf_page)} ---", r.text, ""]
    return "\n".join(osad)
```

- [ ] **Step 4: Write the tools module**

```python
# mcp/vutt_mcp/library/tools.py
"""MCP-tööriistad. Registreeritakse AINULT siis, kui indeksifail on olemas."""
from . import format as fmt
from .config import LibrarySettings, library_available
from .query import (
    PageRefError,
    fetch_pages,
    list_documents,
    resolve_page_range,
    search,
)
from .schema import connect

MAX_PAGES = 20
MAX_CHARS = 60000


def _ava(settings: LibrarySettings):
    """Ühendus tööriistakutse kohta — pikaajaline hoiaks pärast indeksi
    ümberehitust vana inode'i elus ja serveeriks vaikselt aegunud andmeid."""
    return connect(settings.db_path, read_only=True)


def _parent_keys(conn, doc_ids):
    if not doc_ids:
        return {}
    kohatäited = ",".join("?" * len(doc_ids))
    return {
        r["doc_id"]: r["parent_key"]
        for r in conn.execute(
            f"SELECT doc_id, parent_key FROM documents WHERE doc_id IN ({kohatäited})",
            list(doc_ids))
    }


def register_library_tools(mcp, settings: LibrarySettings) -> bool:
    if not library_available(settings):
        return False

    @mcp.tool(structured_output=False)
    async def list_literature() -> str:
        """Loetleb lokaalse sekundaarkirjanduse kogu sisu: teatmeteosed,
        matriklid ja monograafiad 17. sajandi Tartu kohta. Kasuta SEDA ENNE
        otsingut, et teada, mida kogu üldse sisaldab — tühi otsingutulemus ei
        tähenda, et teemat pole käsitletud, kui õiget teost kogus polegi.
        Tagastab iga teose doc_id, viite ja lehekülgede arvu."""
        conn = _ava(settings)
        try:
            return fmt.format_list(list_documents(conn))
        finally:
            conn.close()

    @mcp.tool(structured_output=False)
    async def search_literature(
        query: str,
        doc_id: str | None = None,
        relax_matching: bool = False,
        limit: int = 10,
    ) -> str:
        """Otsib lokaalsest sekundaarkirjanduse kogust ja tagastab katked koos
        TSITEERITAVA viitega (autor, aasta, pealkiri, trükise leheküljenumber).

        Vaikimisi peavad KÕIK päringu sõnad esinema; relax_matching=true
        lõdvendab. `doc_id` piirab otsingu ühele teosele (vt list_literature).

        Tekst pärineb skaneeringute OCR-ist ja on kohati lagunenud — täpne
        fraasiotsing võib vahele jääda."""
        conn = _ava(settings)
        try:
            hits = search(conn, query, doc_id=doc_id, relax=relax_matching,
                          limit=limit)
            return fmt.format_hits(hits, _parent_keys(conn, {h.doc_id for h in hits}))
        except ValueError as e:
            return f"Vigane päring: {e}"
        finally:
            conn.close()

    @mcp.tool(structured_output=False)
    async def get_literature_pages(
        doc_id: str,
        from_page: str,
        to_page: str,
        page_ref: str,
    ) -> str:
        """Tagastab teose lehekülgede täisteksti.

        `page_ref` on KOHUSTUSLIK ja ütleb, kumba numeratsiooni from_page/to_page
        tähendavad:
          - "printed" — trükise leheküljenumber (võib olla rooma: 'xviii')
          - "pdf"     — PDF-faili lehe järjekorranumber

        Need kaks EI OLE samad: köite eessõna ja tahvlid nihutavad neid.
        Kui trükitud numeratsioon on teadmata (vt list_literature), kasuta "pdf".
        Korraga kuni 20 lehekülge ja piiratud märgimaht; kärpimisest teatatakse."""
        conn = _ava(settings)
        try:
            read = conn.execute(
                "SELECT * FROM documents WHERE doc_id = ?", (doc_id,)).fetchone()
            if read is None:
                return (f"Tundmatu doc_id {doc_id!r}. "
                        "Vaata list_literature väljundit.")
            from .query import _doc_row

            doc = _doc_row(read)
            pdf_from, pdf_to = resolve_page_range(
                conn, doc_id, from_page, to_page, page_ref)
            rows, truncated = fetch_pages(
                conn, doc_id, pdf_from, pdf_to,
                max_pages=MAX_PAGES, max_chars=MAX_CHARS)
            return fmt.format_pages(doc, rows, truncated, read["parent_key"])
        except PageRefError as e:
            return f"Lehevahemikku ei saa lahendada: {e}"
        finally:
            conn.close()

    return True
```

- [ ] **Step 5: Wire into the server**

`mcp/vutt_mcp/server.py`, `build_server` lõpus enne `return mcp`:

```python
    # Valikuline kirjanduskogu: registreerub ainult siis, kui indeks on olemas.
    from .library.config import load_library_settings
    from .library.tools import register_library_tools

    register_library_tools(mcp, load_library_settings())
```

`mcp/vutt_mcp/library/__init__.py`:

```python
from .config import LibrarySettings, library_available, load_library_settings
from .tools import register_library_tools

__all__ = ["LibrarySettings", "library_available", "load_library_settings",
           "register_library_tools"]
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_tools.py mcp/tests/test_protocol_hygiene.py -v`
Expected: PASS — sh olemasolev protokolli-hügieeni test peab endiselt läbima

- [ ] **Step 7: Commit**

```bash
git add mcp/vutt_mcp/library/format.py mcp/vutt_mcp/library/tools.py \
        mcp/vutt_mcp/library/__init__.py mcp/vutt_mcp/server.py \
        mcp/tests/test_library_tools.py
git commit -m "feat(library): kolm MCP-tööriista + tsiteeritav vormindus"
```

---

### Task 12: CLI, dokumentatsioon ja ADR

**Files:**
- Create: `mcp/vutt_mcp/library/cli.py`
- Modify: `mcp/pyproject.toml` (`vutt-library` konsoolikäsk)
- Modify: `mcp/README.md`
- Create: `docs/decisions/0023-vutt-mcp-lokaalne-olek.md`
- Test: `mcp/tests/test_library_cli.py`

**Interfaces:**
- Consumes: `indexer.run_index`, `config.load_library_settings`
- Produces: `main(argv: list[str] | None = None) -> int`

- [ ] **Step 1: Write the failing test**

```python
# mcp/tests/test_library_cli.py
from library_fixtures import FakeZoteroAPI, kirje, kollektsioon, make_pdf, manus

from vutt_mcp.library.cli import main

KOGUD = [kollektsioon("K1", "VUTT kirjandus")]
VANEM = kirje("ITEM0001", title="Teos", date="1984",
              creators=[{"creatorType": "editor", "firstName": "Arvo",
                         "lastName": "Tering"}])


def _kogu(tmp_path, monkeypatch, base):
    kaust = tmp_path / "storage" / "ATT00001"
    kaust.mkdir(parents=True, exist_ok=True)
    make_pdf(kaust / "f.pdf", ["Ludenius", "teine"])
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("VUTT_LIBRARY_DB", str(tmp_path / "library.db"))
    monkeypatch.setenv("VUTT_LIBRARY_ZOTERO_DIR", str(tmp_path))
    monkeypatch.setenv("VUTT_LIBRARY_ZOTERO_API", base)


def test_index_kaib_ja_teatab(tmp_path, capsys, monkeypatch):
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        _kogu(tmp_path, monkeypatch, base)
        assert main(["index"]) == 0
    valjund = capsys.readouterr().out
    assert "1 uus" in valjund
    assert "VUTT kirjandus" in valjund
    assert (tmp_path / "library.db").exists()


def test_status_naitab_kogu(tmp_path, capsys, monkeypatch):
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        _kogu(tmp_path, monkeypatch, base)
        main(["index"])
        assert main(["status"]) == 0
    assert "1 teost" in capsys.readouterr().out


def test_status_ilma_indeksita(tmp_path, capsys, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("VUTT_LIBRARY_DB", str(tmp_path / "pole.db"))
    assert main(["status"]) == 1
    assert "ei ole" in capsys.readouterr().out


def test_kattesaamatu_zotero_annab_juhise(tmp_path, capsys, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("VUTT_LIBRARY_DB", str(tmp_path / "l.db"))
    monkeypatch.setenv("VUTT_LIBRARY_ZOTERO_API", "http://127.0.0.1:1/api/users/0")
    assert main(["index"]) == 1
    assert "Zotero" in capsys.readouterr().err
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_cli.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'vutt_mcp.library.cli'`

- [ ] **Step 3: Write minimal implementation**

```python
# mcp/vutt_mcp/library/cli.py
"""`vutt-library` — kirjanduskogu indekseerimine.

Indekseerimine on KIRJUTAV ja käib omaniku käsul; MCP-pool jääb read-only.
"""
import argparse
import sys

from .config import library_available, load_library_settings
from .indexer import IndexLocked, run_index
from .query import list_documents
from .schema import connect
from .zotero import ZoteroError


def _teata(aruanne) -> None:
    print(f"Allikas: Zotero Local API ({aruanne.source})")
    print(f"Kollektsioonid: {', '.join(aruanne.subcollections)}")
    print(f"Tulemus: {aruanne.added} uus, {aruanne.updated} uuendatud, "
          f"{aruanne.skipped} muutumatut, {aruanne.removed} eemaldatud")
    if aruanne.broken_links:
        print(f"\nKATKISED LINGID ({len(aruanne.broken_links)}) — "
              "fail puudub, indekseeritud tekst säilib:")
        for doc_id in aruanne.broken_links:
            print(f"  {doc_id}")
    if aruanne.no_text:
        print(f"\nTEKSTIKIHITA ({len(aruanne.no_text)}) — vaja OCR-i:")
        for doc_id in aruanne.no_text:
            print(f"  {doc_id}")
    if aruanne.no_mapping:
        print(f"\nTRÜKITUD NUMERATSIOON TUVASTAMATA ({len(aruanne.no_mapping)}) — "
              "lisa sidecar, kui tahad täpset viitamist:")
        for doc_id in aruanne.no_mapping:
            print(f"  {doc_id}")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="vutt-library")
    alam = parser.add_subparsers(dest="kask", required=True)
    alam.add_parser("index", help="indekseeri Zotero kollektsioon")
    alam.add_parser("status", help="näita kogu seisu")
    args = parser.parse_args(argv)

    settings = load_library_settings()

    if args.kask == "status":
        if not library_available(settings):
            print(f"Indeksit ei ole: {settings.db_path}\n"
                  "Jooksuta `vutt-library index`.")
            return 1
        conn = connect(settings.db_path, read_only=True)
        docs = list_documents(conn)
        print(f"Indeks: {settings.db_path}")
        print(f"Kollektsioon: {settings.collection}")
        print(f"Kogus {len(docs)} teost, "
              f"{sum(d.page_count for d in docs)} lehekülge")
        conn.close()
        return 0

    try:
        aruanne = run_index(settings)
    except (ZoteroError, IndexLocked) as e:
        print(str(e), file=sys.stderr)
        return 1
    _teata(aruanne)
    return 0
```

`mcp/pyproject.toml`:

```toml
[project.scripts]
vutt-mcp = "vutt_mcp.__main__:main"
vutt-library = "vutt_mcp.library.cli:main"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest mcp/tests/test_library_cli.py -v`
Expected: PASS (4 testi)

- [ ] **Step 5: Write the ADR**

`docs/decisions/0023-vutt-mcp-lokaalne-olek.md`:

```markdown
# 0023: vutt_mcp tohib hoida lokaalset olekut, kui see on valikuline

Kuupäev: 2026-08-19
Seis: kinnitatud

## Kontekst

`vutt_mcp` on seni olnud õhuke klient VUTT-i avaliku HTTPS-API otsas: oma
andmeid ei hoia, oma olekut ei oma (`mcp/README.md`). Sekundaarkirjanduse kogu
(spekk `2026-08-19-kirjanduse-kogu-mcp-design.md`) nõuab lokaalset SQLite
indeksit, mis seda invarianti rikub.

## Otsus

`vutt_mcp` tohib hoida lokaalset olekut järgmistel tingimustel:

1. Olek elab **eraldi alampaketis** (`vutt_mcp/library/`), mitte olemasolevate
   moodulite sees.
2. Tööriistad **registreeritakse ainult siis, kui andmefail on olemas**.
   Ilma failita ei eksisteeri neid ega vihjet nende olemasolule.
3. MCP-pool jääb **read-only**; kirjutamine käib eraldi konsoolikäsuga.
4. Lokaalne olek on **tuletatud read-model** — nullist taastatav (vrd ADR 0007).

## Tagajärjed

- `vutt-mcp` jääb avalikult jagatavaks: teisel paigaldajal ei teki
  kirjanduskogu tööriistu.
- MCP-server avab indeksi **ühenduse tööriistakutse kohta**, sest indeksi
  ümberehitus kasutab `rename`-i ja pikaajaline deskriptor hoiaks vana inode'i.
- Uus lokaalse olekuga moodul nõuab uut ADR-i — see otsus ei ole blankett.
```

- [ ] **Step 6: Update the README**

Lisa `mcp/README.md`-sse „Tööriistad" tabeli järele uus jaotis:

```markdown
## Kirjanduskogu (valikuline, lokaalne)

Lokaalne sekundaarkirjanduse kogu Zotero põhjal. **Tööriistad tekivad ainult
siis, kui indeksifail on olemas** — teisel paigaldajal neid ei ole.

```bash
vutt-library index     # loeb Zotero kollektsiooni „VUTT kirjandus", ehitab indeksi
vutt-library status    # mis kogus on
```

| Muutuja | Vaikimisi |
|---|---|
| `VUTT_LIBRARY_DB` | `~/.local/share/vutt-library/library.db` |
| `VUTT_LIBRARY_COLLECTION` | `VUTT kirjandus` (nimi või Zotero key) |
| `VUTT_LIBRARY_ZOTERO_DIR` | `~/.zotero/Zotero` (ainult `storage/` jaoks) |
| `VUTT_LIBRARY_ZOTERO_API` | `http://127.0.0.1:23119/api/users/0` |

| Tööriist | Mida teeb |
|---|---|
| `list_literature` | Kogu sisu: doc_id, viide, lehekülgede arv |
| `search_literature` | Täistekstiotsing → katked + tsiteeritav viide |
| `get_literature_pages` | Lehevahemiku täistekst (`page_ref` on kohustuslik) |

Kolm asja, mis üllatavad:

- **Zotero peab indekseerimise ajal jooksma** ja Local API olema lubatud
  (Settings → Advanced). Otse `zotero.sqlite` lugemine ei ole võimalik —
  jooksev Zotero hoiab baasi lukus nii, et isegi read-only ühendus kukub.
- **`page_ref` on kohustuslik.** Trükise lehekülg ja PDF-i leht ei ole samad;
  vaikimisi valik oleks vaikne viga.
- **Kogusse pane ainult kvaliteetse OCR-iga PDF-e.** Indekseerija ei hinda
  tekstikvaliteeti ja lagunenud OCR jääb otsingust vaikselt välja.
```

- [ ] **Step 7: Run the full suite**

Run: `.venv/bin/python -m pytest mcp/tests/ -v`
Expected: PASS — kõik olemasolevad + uued testid

- [ ] **Step 8: Commit**

```bash
git add mcp/vutt_mcp/library/cli.py mcp/pyproject.toml mcp/README.md \
        docs/decisions/0023-vutt-mcp-lokaalne-olek.md \
        mcp/tests/test_library_cli.py
git commit -m "feat(library): vutt-library CLI, README ja ADR 0023"
```

---

## Enesekontroll pärast teostust

- [ ] `.venv/bin/python -m pytest mcp/tests/ -v` — kõik roheline
- [ ] Loo Zoteros kollektsioon „VUTT kirjandus" ja lohista sinna paar
      kvaliteetse OCR-iga teatmeteost
- [ ] `pipx install -e mcp/ --force`, Zotero avatud, `vutt-library index`
- [ ] Sulge Zotero ja jooksuta `vutt-library index` → peab andma selge juhise,
      mitte segase vea
- [ ] `claude mcp list` näitab `vutt` serverit; uues seansis on kolm uut tööriista
- [ ] Kustuta `library.db` → tööriistad kaovad; taasta indeks → tulevad tagasi
- [ ] `vutt-library index` teine jooks: kõik `skipped`, midagi ei kirjutata
