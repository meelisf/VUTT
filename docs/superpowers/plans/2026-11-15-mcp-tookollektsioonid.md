# MCP töökollektsioonid — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCP-agent saab töökollektsioonid loetleda ja piirata `search_works` / `search_pages` ühe kogu liikmetega.

**Architecture:** Server annab otsinguvõtmega kaitstud read-only teed `/mcp/work-sets…`, mis kasutavad olemasolevaid predikaate admini rolliga. MCP küsib liikmete ID-d ja lisab Meili filtrisse `work_id IN [...]` teiste filtrite kõrvale (ADR 0042 muster).

**Tech Stack:** FastAPI, pytest (`.venv/bin/pytest`), MCP SDK (`vutt_mcp`), httpx.

**Spec:** `docs/superpowers/specs/2026-11-15-mcp-tookollektsioonid-design.md`

## Global Constraints

- Päis `X-Vutt-Search-Key`; võrdlus `hmac.compare_digest`; puuduv/vale → 401, serveris võti seadmata → 503.
- Sünteetiline kasutaja `{"username": "mcp", "role": "admin"}`; uut õigusloogikat ei kirjutata.
- Vastuses EI OLE `access`-i, `created_by`, `updated_at`.
- `server/cache.py` ei kasutata; liikmesus ei lähe Meilisse.
- Tühi liikmete loend → null tulemust, Meili-päringut ei tehta.
- MCP ei impordi `server`-it runtime'is; iga tööriist `@mcp.tool(structured_output=False)`.
- Koodikommentaarid eesti keeles. Väravad järjest, mitte paralleelselt.

## Review Focus

- Vale võtme päring ei tohi saada 200 ega lekitada kogu nimesid → test Task 1-s.
- Kogu, mille kõik liikmed on kustutatud, annab tühja loendi → MCP peab vastama „0 tulemust", mitte otsima kogu korpusest → test Task 2-s.
- `work_set` + `collection` koos: mõlemad klauslid filtris (AND) → test Task 2-s.
- `search_pages` `work_set`-iga ei kasuta teosesisest kärpimata režiimi (kapp jääb) → test Task 2-s.
- Tundmatu kogu id → juhis `list_work_sets` → test Task 2-s.

---

### Task 1: Serveri read-only teed

**Files:**
- Create: `server/routers/mcp_read.py`
- Modify: `server/main.py` (import + `app.include_router(mcp_read_router)`)
- Test: `tests/test_mcp_read_work_sets.py`

**Interfaces:**
- Produces: `GET /mcp/work-sets` → `{"status": "success", "work_sets": [{id, name, description, status, visibility, count}]}` (ka arhiveeritud); `GET /mcp/work-sets/{set_id}/works` → `{"status": "success", "work_ids": [...], "count": N}`; puuduv → 404.

- [ ] **Step 1: Kirjuta testid** (fixture'id `work_sets`, `ws_id` mustri järgi `tests/test_work_sets_api.py`-st; `monkeypatch.setattr(server.config, "MEILI_SEARCH_KEY", "voti")`; `search_visible_work_ids` liikmed monkeypatch'iga `server.work_sets_access.load_work_metadata_by_id`):
  - `test_ilma_votmeta_401` — mõlemad teed ilma päiseta → 401, kehas ei ole kogu nime.
  - `test_vale_votmega_401`
  - `test_votme_puudumisel_serveris_503` — `MEILI_SEARCH_KEY = ""` → 503.
  - `test_loend_naitab_members_kogu_ja_arhiveeritut` — `visibility="members"` kogu ja `status="archived"` kogu on mõlemad loendis; `"access" not in` ühegi kirje võtmetes; `count` vastab liikmetele.
  - `test_liikmed_tagastab_idd` — `work_ids == ["w1", "w2"]`, kustutatud liige (metadata `None`) jäetakse välja.
  - `test_tundmatu_kogu_404`
  - `test_bearer_token_ei_asenda_votit` — sisselogitud admini `Authorization` päisega, ilma võtmeta → 401.

- [ ] **Step 2:** `.venv/bin/pytest tests/test_mcp_read_work_sets.py -v` → FAIL (404 teed puuduvad).

- [ ] **Step 3: Implementeeri** `server/routers/mcp_read.py`: sõltuvus `require_search_key(request) -> dict` tagastab sünteetilise kasutaja; võtit loe kutse ajal `from .. import config; config.MEILI_SEARCH_KEY` (mitte moodulitasandi import — monkeypatch). Teed on sync `def` (ADR 0002). `list_work_sets`, `load_work_set`, `search_visible_work_ids` impordi nagu `routers/work_sets.py`. Mooduli docstring: miks võti = admin (spec „Mitte-eesmärk") ja et `cache.py` on keelatud.

- [ ] **Step 4:** test → PASS; lisaks `.venv/bin/pytest tests/test_work_sets_api.py -q` → PASS.

- [ ] **Step 5: Commit** `feat(mcp): otsinguvõtmega read-only töökollektsioonide teed`

### Task 2: MCP tööriistad

**Files:**
- Modify: `mcp/vutt_mcp/client.py` (uus `mcp_get`)
- Modify: `mcp/vutt_mcp/queries.py` (`build_search_body(..., work_ids: list[str] | None = None)`)
- Modify: `mcp/vutt_mcp/server.py` (`list_work_sets`; `work_set` param `search_works`/`search_pages`)
- Modify: `mcp/vutt_mcp/instructions.py`, `mcp/vutt_mcp/format.py` (kogude loendi vormindus)
- Test: `mcp/tests/test_work_sets.py`, `mcp/tests/test_queries.py`, `mcp/tests/test_client.py`

**Interfaces:**
- Consumes: Task 1 teed (`/api/files/mcp/work-sets…`).
- Produces: `VuttClient.mcp_get(path: str) -> dict | list` (saadab `X-Vutt-Search-Key: settings.meili_key`); `build_search_body(..., work_ids=None)` lisab klausli `work_id IN ["a", "b"]` (iga id `_quote`-iga).

- [ ] **Step 1: Kirjuta testid**
  - `test_client.py::test_mcp_get_saadab_votme_paises` — httpx MockTransport: päis `X-Vutt-Search-Key == key`, URL `…/api/files/mcp/work-sets`, `Authorization` päist ei ole.
  - `test_queries.py::test_work_ids_filter` — `build_search_body("x", work_ids=["a","b"], collection="c")["filter"]` sisaldab `work_id IN ["a", "b"]` JA `collections_hierarchy = "c"`.
  - `test_work_sets.py` (FakeClient `mcp_get`-iga, muster `test_text_tools.py`):
    - `test_list_work_sets_naitab_id_nime_arvu_ja_arhiivi` — väljund sisaldab id-d, et-nime, arvu ja arhiveeritu märget.
    - `test_search_works_work_setiga_lisab_filtri` — Meili kehas `work_id IN`.
    - `test_search_pages_work_setiga_lisab_filtri_ja_laotab` — keha filtris `work_id IN`; tulemus käib `spread_search` kaudu (kapp jääb).
    - `test_tyhi_kogu_ei_tee_meili_paringut` — `work_ids: []` → `client.bodies == []`, väljund ütleb 0 tulemust.
    - `test_tundmatu_kogu_soovitab_list_work_sets` — `mcp_get` viskab `VuttNotFound` → `ToolError`, tekstis `list_work_sets`.
  - `test_instructions.py`: juhis mainib `list_work_sets` ja `work_set`.

- [ ] **Step 2:** `.venv/bin/pytest mcp/tests/test_work_sets.py mcp/tests/test_queries.py mcp/tests/test_client.py mcp/tests/test_instructions.py -v` → FAIL.

- [ ] **Step 3: Implementeeri.** Server.py-s üks abifunktsioon `_work_set_ids(client, work_set) -> list[str]` (404 → `VuttError` juhisega „Tundmatu töökollektsioon; vaata list_work_sets"). Tühja loendi korral tagasta `fmt.format_search_hits([], 0, ...)` ilma Meilita. Docstringidesse: `work_set` = id `list_work_sets`-ist, kombineerub teiste filtritega AND-iga. Kontrolli, et `test_protocol_hygiene.py` (structured_output) jääb roheliseks.

- [ ] **Step 4:** sama käsk → PASS; seejärel `.venv/bin/pytest mcp/tests -q` → PASS.

- [ ] **Step 5: Commit** `feat(mcp): list_work_sets ja work_set filter otsingutööriistadele`

### Task 3: Dokumendid

**Files:**
- Modify: `docs/decisions/0042-tookollektsiooni-liikmesust-ei-indekseerita.md` (täiendus 2026-11-15)
- Modify: `mcp/README.md` (teise kasutaja jaotis + tööriistade loend)

- [ ] **Step 1:** ADR 0042 lõppu jaotis „Täiendus 2026-11-15: MCP" — MCP loeb liikmed `/mcp/work-sets/{id}/works`-ist otsinguvõtmega admini õigustes, sama `search_visible_work_ids`; indeksit ei muudeta; kasutajapõhisus alles koos kasutajapõhise võtmega.
- [ ] **Step 2:** README: „Võti annab ligipääsu ka piiratud kogudele **ja kõigile töökollektsioonidele**"; `list_work_sets` tööriistade loendisse.
- [ ] **Step 3: Commit** `docs: MCP töökollektsioonid (ADR 0042 täiendus, README)`

### Lõpp

- [ ] `.venv/bin/pytest tests/ -q` ja `.venv/bin/pytest mcp/tests -q` järjest → PASS.
- [ ] Deploy märkus PR-i: backend `server_update.sh --no-cache`; kasutajad `pipx reinstall vutt-mcp`.
