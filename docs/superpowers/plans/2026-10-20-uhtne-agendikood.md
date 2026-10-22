# Ühtne agendikood + ettepanekute nimekiri `/review`-l — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Üks agendikood kehtib kõigile kolmele ettepanekuhoidlale (tekst, osad, isik) ja `/review` näitab kõiki ootel ettepanekuid ühes nimekirjas, mille iga rida viib otsustusvaatesse.

**Architecture:** Hoidlad jäävad eraldi SQLite-failideks; iga hoidla saab väikese primitiivi (ette antud kood, koodi tühistus räsi järgi, sihtmärgita kokkuvõtte loend). Uus moodul `server/agent_proposals.py` koondab need: registreerib koodi kolmes hoidlas (kompensatsiooniga) ja ehitab ühtse loendi koos serveri koostatud `target_url`-iga. Frontend: `AgentProposalsSection` kirjutatakse ümber, vanad koodinupud kaovad, sihtvaated saavad URL-parameetri (`?proposal=`, `?tab=parts`, `?agent=1`).

**Tech Stack:** FastAPI + SQLite (Python 3.12), React 19 + TypeScript, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-10-20-uhtne-agendikood-design.md`

## Global Constraints

- Kõik uued otspunktid: `require_role("superadmin")` (ADR 0058, 2026-09-29). Rolli ei langetata.
- TTL 8 h kõigis hoidlates; lagi hoidla kaupa: tekst `ptp.MAX_USES` (20), osad `wpp.MAX_USES` (20), isikud `enrichment_proposals.ANY_MAX_USES` (200).
- Hoidlate skeem EI muutu — vanad koodid kehtivad oma 8 h lõpuni (ulatuse kontrollid `submit`/`check_code` teedes jäävad alles).
- Osaliselt registreeritud koodi kasutajale ei näidata: ebaõnnestumisel tühistatakse sama räsi juba registreeritud hoidlatest.
- `GET /agent-proposals` rea kuju: `{kind: "text"|"parts"|"person", proposal_id, target_id, target_label, target_url, pending, stale, created_at}`; `target_url` koostab server.
- Nähtavus: tekst — kõik superadminid näevad kõiki; osad ja isikud — ainult `username`-i omad.
- MCP tööriistade signatuure ei muudeta; muutub ainult kirjelduste tekst (koodi asukoht → `/review`).
- Blokeeriv I/O `async def` sees keelatud (ADR 0002): sync `def` route või `run_in_threadpool`.
- i18n: iga uus võti mõlemasse keelde (`et` + `en`) korraga (ADR 0011).
- Koodikommentaarid eesti keeles. ESLint hoiatuste arv ei tõuse (`--max-warnings 42`).
- Testid: `.venv/bin/pytest`; komponenditestid `/** @vitest-environment jsdom */` päisega.

## Review Focus

1. **Kustutatud teos/isik ootel ettepanekuga** — rida jääb loendisse (ettepanek on ootel), silt langeb ID-le, link ei kuku (tekst: `lk` = 1). Test: Task 2 `test_kadunud_teos_ja_isik`.
2. **Teksti paki kõik lehed teosest kadunud** — `lk` = 1 ja redaktor näitab sama pakki teatega „paki lehed on teosest kadunud". Testid: Task 2 `test_tekst_lk_kadunud_lehtedega`, Task 5 `eelistatud paki lehed kadunud`.
3. **Sama tüvi kahes pakis** — `?proposal=` pakk võidab ka siis, kui teine pakk sisaldab sama lehte, ja eelistus püsib lehepöördel sama teose sees. Test: Task 5 `eelistab proposal-parameetri pakki` + `eelistus püsib lehevahetusel`.
4. **Kolmas hoidla viskab registreerimisel** — kood ei kehti üheski hoidlas. Test: Task 2 `test_handoff_kompenseerib`.
5. **Teise superadmini osade/isiku ettepanek** — ei ilmu minu loendisse (klikk viiks tühja vaatesse); teksti pakk ilmub. Test: Task 2 `test_nahtavus_kasutaja_kaupa`.

---

### Task 1: Hoidlate primitiivid

**Files:**
- Modify: `server/work_part_proposals.py` (`issue_handoff`, uus `revoke_code`, uus `list_pending_summary`)
- Modify: `server/page_text_proposals.py` (uus `revoke_code`)
- Modify: `server/prosopography/enrichment_proposals.py` (`issue_handoff` + `code`, uus `revoke_code`, uus `list_pending_summary`)
- Test: `tests/test_work_part_proposals.py`, `tests/test_page_text_proposals.py` (või olemasolev mooduli testifail), `tests/test_prosopo_enrichment_proposals.py`

**Interfaces:**
- Produces:
  - `wpp.issue_handoff(username: str, code: str | None = None, work_id: str | None = None) -> dict` — `work_id=None` → ulatus `ALL_WORKS`. Tagastab AINULT `{"code", "expires_at", "max_uses"}` (ei `work_dir`-i, ei `pages_version`-it, ei `scope`-i).
  - `ep.issue_handoff(person_id, username, session_fingerprint, updated_at="", code: str | None = None) -> dict` — ette antud `code` kasutatakse, muidu genereeritakse.
  - `wpp.revoke_code(code: str) -> None`, `ptp.revoke_code(code: str) -> None`, `ep.revoke_code(code: str) -> None` — kustutab `handoff` rea räsi järgi; puuduv DB-fail → no-op (ära loo faili, nagu `revoke_handoffs`).
  - `wpp.list_pending_summary(username: str) -> list[dict]` — `{"proposal_id", "work_id", "created_at", "pages_version", "pending": int}`; ainult ettepanekud, kus ≥1 item `status == "pending"`; `pending` = selliste itemite arv. Ei loe teose kausta.
  - `ep.list_pending_summary(username: str) -> list[dict]` — `{"proposal_id", "person_id", "created_at", "pending": int}`; `applied_at IS NULL`, `pending` = `len(payload)` (otsustatud read eemaldab `_close_rows`). Ei loe isikukaarti.
  - Mõlemad kokkuvõtted kutsuvad `_clean`-i (aegunud välja) ja filtreerivad `username`-i järgi.

- [ ] **Step 1: Kirjuta failivad testid**

```python
# tests/test_work_part_proposals.py
def test_yldkood_ilma_teoseta(work):
    h = wpp.issue_handoff("ed")
    assert set(h) == {"code", "expires_at", "max_uses"} and h["max_uses"] == wpp.MAX_USES
    assert wpp.submit(h["code"], "w1", work, wpp.pages_version(work), [LETTER])["status"] == "pending"

def test_ette_antud_kood_ja_tuhistus(work):
    wpp.issue_handoff("ed", code="sama-kood")
    wpp.revoke_code("sama-kood")
    with pytest.raises(wpp.ProposalError, match="invalid_or_expired_handoff"):
        _submit(work, [LETTER], code="sama-kood")

def test_kokkuvote_kasutaja_kaupa(work):
    _submit(work, [LETTER, POEM])
    wpp.submit(wpp.issue_handoff("teine")["code"], "w1", work, wpp.pages_version(work), [LETTER])
    (row,) = wpp.list_pending_summary("ed")
    assert row["work_id"] == "w1" and row["pending"] == 2 and row["pages_version"] == wpp.pages_version(work)
    wpp.decide(row["proposal_id"], "w1", work, "ed", 0, "reject")
    assert wpp.list_pending_summary("ed")[0]["pending"] == 1
```

```python
# tests/test_prosopo_enrichment_proposals.py (mooduli tasand, olemasolevate abiliste peal)
def test_ette_antud_kood_tuhistus_ja_kokkuvote(...):
    h = ep.issue_handoff(None, "superadmin", "fp", code="yks-kood")
    assert h["code"] == "yks-kood" and h["max_uses"] == ep.ANY_MAX_USES
    # submit kahe reaga isikule vutt:Pabc → list_pending_summary("superadmin") == [{"person_id": "vutt:Pabc", "pending": 2, ...}]
    # list_pending_summary("keegi") == []
    # ep.revoke_code("yks-kood") → järgmine submit: ProposalError("invalid_or_expired_handoff")
```

```python
# teksti mooduli test
def test_revoke_code(...):
    ptp.issue_handoff(None, "su", code="k")
    ptp.revoke_code("k")
    with pytest.raises(ptp.ProposalError): ptp.check_code("k", "w1")
```

- [ ] **Step 2: Käivita — peavad kukkuma**

Run: `.venv/bin/pytest tests/test_work_part_proposals.py tests/test_prosopo_enrichment_proposals.py -k "yldkood or ette_antud or kokkuvote or revoke" -v`
Expected: FAIL (`TypeError` / `AttributeError`).

- [ ] **Step 3: Teosta primitiivid** nagu Interfaces ütleb. `wpp.issue_handoff` uue signatuuriga: uuenda kõik mooduli testide kutsed `wpp.issue_handoff("w1", work, "ed")` → `wpp.issue_handoff("ed", work_id="w1")` (töö-ulatuse testid jäävad — need katavad vanu koode). Router `parts_handoff` kutse murdub — see otspunkt kustutatakse Task 3-s; kuni selleni kohanda kutse uue signatuuriga, et testikomplekt oleks roheline.

- [ ] **Step 4: Käivita kogu hoidlate testikomplekt**

Run: `.venv/bin/pytest tests/test_work_part_proposals.py tests/test_prosopo_enrichment_proposals.py tests/test_page_text_proposals*.py -q`
Expected: kõik PASS.

- [ ] **Step 5: Commit** — `feat(agent): hoidlate primitiivid ühtse koodi jaoks (ADR 0058)`

---

### Task 2: `POST /agent-handoff` ja `GET /agent-proposals`

**Files:**
- Create: `server/agent_proposals.py` — koondloogika (ilma FastAPI-ta)
- Create: `server/routers/agent_proposals.py` — kaks otspunkti
- Modify: `server/main.py` (`include_router`), `server/config.py` (rate-limit võti `'/agent-handoff': (30, 3600)`)
- Test: `tests/test_agent_proposals.py`

**Interfaces:**
- Consumes: Task 1 primitiivid; `ptp.issue_handoff(None, username, code=…)`, `ptp.list_pending()`; `wp.page_stems(work_dir)`; `wpp.pages_version(work_dir)`; `find_directory_by_id`; `load_work_metadata_by_id` (`server/work_sets_access.py`); `person_crud.get_person`.
- Produces:
  - `issue_agent_handoff(username: str, session_fingerprint: str) -> dict` → `{"code", "expires_at", "max_uses": {"text": int, "parts": int, "persons": int}}`. Järjekord: tekst → osad → isikud, kõik sama `secrets.token_urlsafe(32)` koodiga. Erind ükskõik millises → `revoke_code` kõigis juba õnnestunutes, siis erind edasi (`AgentHandoffError`).
  - `list_agent_proposals(username: str) -> list[dict]` — Global Constraints kujul, sorteeritud `created_at` kahanevalt.
  - `POST /agent-handoff` (sync `def`, `Request` → `request.state.session_fingerprint`, rate-limit kasutaja kaupa, 429 + `Retry-After`; `AgentHandoffError` → 503 `agent_handoff_failed`).
  - `GET /agent-proposals` (sync `def`) → `list_agent_proposals(user["username"])`.

Rea väljad liigiti:

| kind | target_id | target_label | target_url | pending | stale |
|---|---|---|---|---|---|
| text | work_id | `meta["title"]`, puudumisel work_id | `/work/{work_id}/{lk}?proposal={proposal_id}` | `counts.pending` | `counts.stale` |
| parts | work_id | sama | `/work/{work_id}/manage?tab=parts` | `pending` | `pending` kui `pages_version != wpp.pages_version(work_dir)`, muidu 0; kadunud teos → 0 |
| person | person_id | `person["name"]["label"]`, puudumisel/tombstone'il person_id | `/persons/{person_id}/edit?agent=1` | `pending` | `None` |

`lk` (tekst): paki `pages` (juba `page_no` järgi) seast esimene `state in ("pending","stale")`, mille tüvi on `wp.page_stems(work_dir)`-is → tema 1-põhine positsioon seal; muidu (või teos kadunud) 1. Teose lehtede loend ja metaandmed loe ühe korra teose kohta (mitu pakki samal teosel).

- [ ] **Step 1: Kirjuta failivad testid** — fixture: monkeypatch kolme mooduli `DB_PATH` `tmp_path`-i; `agent_proposals.find_directory_by_id` / `load_work_metadata_by_id` / `get_person` võltsitud; FastAPI app ainult selle routeriga ja `deps.get_user` võltsinguga nagu `tests/test_work_part_proposals.py:214-238`; `request.state.session_fingerprint` sea middleware'iga või võltsi.

```python
def test_handoff_registreerib_kolmes(client, work):
    h = client.post("/agent-handoff").json()
    assert h["max_uses"] == {"text": ptp.MAX_USES, "parts": wpp.MAX_USES, "persons": ep.ANY_MAX_USES}
    ptp.check_code(h["code"], "w1")                                   # ei viska
    assert wpp.submit(h["code"], "w1", work, wpp.pages_version(work), [LETTER])["status"] == "pending"
    # + ep.submit(h["code"], "vutt:Pabc", …) õnnestub

def test_handoff_kompenseerib(client, monkeypatch):
    monkeypatch.setattr(ep, "issue_handoff", Mock(side_effect=RuntimeError("ketas")))
    r = client.post("/agent-handoff")
    assert r.status_code == 503 and "code" not in r.json()
    # kood, mille tekst+osad said: kumbki hoidla ei sisalda ühtegi handoff-rida
    assert _handoff_rows(ptp) == 0 and _handoff_rows(wpp) == 0

def test_ainult_superadmin(client):      # admin → 403 mõlemal otspunktil

def test_loend_kolm_liiki(client, work):
    # tekst: pakk lehtedega t-005 (stale), t-002 (pending) → lk = t-002 praegune positsioon
    # osad: ettepanek 2 osaga → pending 2, stale 0; pärast lehe lisamist kausta → stale 2
    # isik: 2 rida → pending 2, stale None, target_url "/persons/vutt:Pabc/edit?agent=1"
    # target_label == "Epistolae" tekstil ja osadel

def test_tekst_lk_praegusest_jarjekorrast(client, work):
    # pakk esitatud lehele 3 (t-003); seejärel lisa kausta t-000.jpg → target_url lõpeb "/4?proposal=…"

def test_tekst_lk_kadunud_lehtedega(client, work):
    # paki ainsa lehe .jpg/.txt kustutatud → target_url == f"/work/w1/1?proposal={pid}"

def test_kadunud_teos_ja_isik(client):
    # find_directory_by_id → None, get_person → None: read alles, target_label == target_id, lk 1, stale 0

def test_nahtavus_kasutaja_kaupa(client, work):
    # "teine" kasutaja osade + isiku ettepanek ja teksti pakk: "ed" näeb ainult teksti pakki
```

- [ ] **Step 2: Käivita — kukub** (`ModuleNotFoundError`).

Run: `.venv/bin/pytest tests/test_agent_proposals.py -v`

- [ ] **Step 3: Teosta** `server/agent_proposals.py` + router + `main.py` + `config.py` võti.

- [ ] **Step 4: Käivita** `tests/test_agent_proposals.py` + `tests/test_rate_limit*.py` (kui seal on võtmete loend) — PASS.

- [ ] **Step 5: Commit** — `feat(agent): ühtne agendikood ja ettepanekute loend (/agent-handoff, /agent-proposals)`

---

### Task 3: Vanad koodiotspunktid maha

**Files:**
- Modify: `server/routers/work_parts.py` (kustuta `parts_handoff`; `ptp` import kui üleliigne)
- Modify: `server/prosopography/router.py` (kustuta mõlemad `/enrichment-handoff` otspunktid; uuenda „viis otspunkti" kommentaar)
- Modify: `server/config.py` (kustuta `'/works/parts-handoff'`, `'/prosopography/enrichment-handoff'`)
- Modify: `server/page_text_proposals.py` (`issue_handoff` docstring: kood tuleb `/agent-handoff`-ist)
- Test: `tests/test_work_part_proposals.py`, `tests/test_prosopo_enrichment_proposals.py`, `tests/test_prosopo_mcp_workflow.py`, `tests/test_page_text_proposals_router.py`

**Interfaces:**
- Consumes: Task 2 `/agent-handoff`.

- [ ] **Step 1: Kirjuta failivad testid**

```python
def test_vanad_koodiotspunktid_kadunud(client):            # test_work_part_proposals.py
    assert client.post("/works/w1/parts/handoff").status_code in (404, 405)

def test_vanad_isiku_koodiotspunktid_kadunud(client):      # test_prosopo_enrichment_proposals.py
    token = login("superadmin", "superpass")
    assert client.post("/prosopography/enrichment-handoff", headers=_headers(token)).status_code in (404, 405)
    assert client.post("/prosopography/enrichment-handoff/vutt:Pabc", headers=_headers(token)).status_code in (404, 405)
```

- [ ] **Step 2: Käivita — kukuvad** (praegu 200).

- [ ] **Step 3: Kustuta otspunktid ja võtmed; vii testid ümber.** Reegel: HTTP-voo testid saavad koodi `POST /agent-handoff`-ist (kui test-app sisaldab seda routerit) või mooduli `issue_handoff`-ist; ulatuse testid (isiku-/teosekood vale sihtmärgiga) jäävad mooduli tasandile. Ühtegi assert'i ei kustutata ilma mooduli-tasandi vasteta. `grep -rn "parts/handoff\|enrichment-handoff" server tests mcp` → tühi.

- [ ] **Step 4: Käivita** `.venv/bin/pytest tests/ -q` — PASS.

- [ ] **Step 5: Commit** — `refactor(agent): vanad koodiotspunktid eemaldatud (kood on /review-l)`

---

### Task 4: `/review` jaotis „Agendi ettepanekud"

**Files:**
- Create: `src/services/agentProposalsService.ts`
- Modify (ümberkirjutus): `src/pages/review/AgentProposalsSection.tsx`
- Modify: `src/locales/et/review.json`, `src/locales/en/review.json` (`proposals.*`)
- Test: `src/pages/review/__tests__/AgentProposalsSection.test.tsx` (ümberkirjutus)

**Interfaces:**
- Consumes: Task 2 otspunktid.
- Produces:
  - `type AgentProposalKind = 'text' | 'parts' | 'person'`
  - `interface AgentProposal { kind; proposal_id: string; target_id: string; target_label: string; target_url: string; pending: number; stale: number | null; created_at: number }`
  - `interface AgentHandoff { code: string; expires_at: number; max_uses: { text: number; parts: number; persons: number } }`
  - `listAgentProposals(token: string): Promise<AgentProposal[]>`, `createAgentHandoff(token: string): Promise<AgentHandoff>` — sama `fetchWithTimeout` + `getAuthHeaders` muster nagu `textProposalService.ts`.

Komponent (`{ token }` prop jääb, `Review.tsx` ei muutu): jaotis renderdub ALATI (superadmini kontroll on `Review.tsx`-is); päis + nupp „Loo agendikood"; koodi kast = `CopyButton` + aegumisaeg + lagi liigiti (sama muster nagu praegu `PartProposals.tsx:114-124`); loend ainult kui ridu > 0. Rida = nupp → `navigate(row.target_url)`; sisu: liigi märk (`proposals.kind.text|parts|person`), `target_label`, `proposals.pending` arv, vananemine ainult kui `stale !== null`: tekstil `proposals.stale` arvuga, osadel (`stale > 0`) märk `proposals.pagesChanged`; kuupäev.

- [ ] **Step 1: Kirjuta failivad testid** (mock `agentProposalsService`)

```tsx
it('rida viib serveri antud target_url-ile', …)        // klikk → route '/work/:id/:page' renderdab 'LEHT'; kontrolli ka ?proposal= otsingus
it('isiku real ei ole vananemist', …)                   // stale: null → 'proposals.stale' teksti ei ole
it('osade vananemine on märk, mitte arv', …)            // kind parts, stale 2 → 'proposals.pagesChanged' on
it('tühja loendi korral on koodinupp näha, loendit ei ole', …)
it('koodi loomine näitab koodi ja lage', …)             // createAgentHandoff → kood ekraanil, max_uses tekstis
```

- [ ] **Step 2: Käivita — kukub.** `npx vitest run src/pages/review`
- [ ] **Step 3: Teosta** teenus, komponent, i18n mõlemas keeles.
- [ ] **Step 4: Käivita** `npx vitest run src/pages/review src/locales` + `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** — `feat(review): agendi ettepanekud ühes loendis + ühtne kood`

---

### Task 5: Redaktor eelistab `?proposal=` pakki

**Files:**
- Modify: `src/components/editor/useTextProposal.ts`
- Modify: `src/components/TextEditor.tsx` (anna `preferredProposalId: searchParams.get('proposal')`)
- Modify: `src/components/editor/TextProposalPanel.tsx` (+ prop `packPagesGone: boolean`, teade `proposal.packPagesGone`)
- Modify: `src/locales/{et,en}/workspace.json`
- Test: `src/components/editor/__tests__/useTextProposal.test.tsx`, `src/components/editor/__tests__/TextProposalPanel.test.ts`

**Interfaces:**
- Produces: `UseTextProposalParams.preferredProposalId?: string | null`; hook tagastab lisaks `packPagesGone: boolean`.

Loogika `load`-is: eelistus elab ref'is — seatakse, kui param ei ole `null`, lähtestub `workId` vahetusel (hook ei remount'u lehepöördel, ADR 0010; nii püsib eelistus ka siis, kui lehepööre `?proposal=` URL-ist kaotab). Kui eelistatud id on `packs` hulgas: `pack` = see pakk; `own` = see pakk ainult siis, kui tal on käesolev tüvi `REVIEW_STATES`-is, muidu `null` (teise paki lehte EI laadita — paki nupud ja redaktori sisu peavad kuuluma samale pakile). Kui eelistatud pakil käesolevat tüve ei ole: `getReviewPage(paki esimene REVIEW_STATES tüvi)`; `page === null` → `packPagesGone = true`. Eelistatud id puudub `packs`-ist → praegune käitumine (`find(...) ?? packs[0]`). `packPagesGone` lähtestub lehe-effectis koos teiste olekutega.

- [ ] **Step 1: Kirjuta failivad testid**

```tsx
it('eelistab proposal-parameetri pakki', …)       // kaks pakki sama tüvega; preferred = teine → getReviewPage kutsutud teise id-ga, pack.proposal_id === teine
it('eelistus püsib lehevahetusel', …)             // rerender uue page.id-ga ja preferredProposalId: null → endiselt teine pakk
it('eelistatud paki lehed kadunud', …)            // eelistatud pakk ei sisalda tüve, getReviewPage → { page: null } → packPagesGone true, review null
it('tundmatu eelistus → vana käitumine', …)
```

- [ ] **Step 2: Käivita — kukub.** `npx vitest run src/components/editor`
- [ ] **Step 3: Teosta** hook, TextEditor, paneel, i18n.
- [ ] **Step 4: Käivita** `npx vitest run src/components/editor` + `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** — `feat(editor): ?proposal= valib paki (#641 järg)`

---

### Task 6: Vanad koodinupud maha + osade ja isiku sihtlink

**Files:**
- Modify: `src/pages/manage/parts/PartProposals.tsx` (koodinupud, `handoff` olek, kast; tühja teksti tingimus `!handoff` välja; lisa rida „Agendikood: ülevaatuse leht" `Link`-iga `/review`-le)
- Modify: `src/services/workPartsApi.ts` (kustuta `PartsHandoff`, `createPartsHandoff`)
- Modify: `src/prosopography/components/personForm/AgentEnrichmentPanel.tsx` (koodinupud + koodikast + `code*` olek välja; sama `/review` viiterida; „Värskenda" jääb; sektsioonile `id="agent-enrichment"`)
- Modify: `src/prosopography/services/prosopographyService.ts` (kustuta `createEnrichmentHandoff`)
- Modify: `src/pages/manage/partsModel.ts` (`initialManageTab(focus: number | null, tab: string | null): ManageTab` — `tab === 'parts'` ja `focus === null` → `'parts'`, muidu `'pages'`), `src/pages/WorkManage.tsx` (anna `searchParams.get('tab')`)
- Modify: `src/prosopography/pages/PersonEditPage.tsx` (`?agent=1` → `occupOpen` algväärtus `true`; pärast `original` laadimist `scrollIntoView` `#agent-enrichment`-ile, üks kord)
- Modify: `src/locales/{et,en}/workspace.json`, `src/locales/{et,en}/prosopography.json` (kustuta kasutuseta koodivõtmed MÕLEMAST keelest; lisa viiterea võti)
- Test: `src/pages/manage/__tests__/partsModel.test.ts` (või olemasolev), `src/prosopography/components/personForm/__tests__/AgentEnrichmentPanel.test.tsx`, PartProposals'i test kui olemas

- [ ] **Step 1: Kirjuta failivad testid**

```ts
expect(initialManageTab(null, 'parts')).toBe('parts');
expect(initialManageTab(3, 'parts')).toBe('pages');   // fookus vajab lehtede vahekaarti
expect(initialManageTab(null, null)).toBe('pages');
```
```tsx
it('paneelis ei ole koodinuppe, on viide /review-le', …)   // AgentEnrichmentPanel: 'agentEnrichment.createCode' puudub, link href '/review'
```

- [ ] **Step 2: Käivita — kukub.**
- [ ] **Step 3: Teosta.** `grep -rn "createPartsHandoff\|createEnrichmentHandoff\|PartsHandoff" src` → tühi.
- [ ] **Step 4: Käivita** `npm test` + `npm run typecheck` + `npm run lint:ci` — PASS, hoiatusi ≤ 42.
- [ ] **Step 5: Commit** — `refactor(ui): agendikood ainult /review-l; osade ja isiku sihtlingid`

---

### Task 7: MCP kirjeldused ja dokumentatsioon

**Files:**
- Modify: `mcp/vutt_mcp/server.py` (`submit_work_parts_proposal`, `get_page_source`, `submit_page_text_proposal`, `submit_person_enrichment_proposal` docstring'id: kood tuleb superadminilt VUTT-i ülevaatuse lehelt `/review`, üks kood kehtib kõigile kolmele)
- Modify: `mcp/README.md` (koodi asukoht)
- Modify: `docs/decisions/0058-mcp-esitab-ainult-ootel-prosopo-ettepaneku.md` (täiendus „2026-10-20: üks agendikood, ülevaade `/review`-l": kolm hoidlat, kompensatsioon, nähtavusreegel, `target_url` serveris, vanad otspunktid eemaldatud)
- Modify: `CLAUDE.md` („MCP ettepanekud" lõik: „Agendikood on ÜKS (`/review`, `POST /agent-handoff`); loend `GET /agent-proposals`")

- [ ] **Step 1:** `grep -rn "teose halduses\|isikuvormist\|Kood agendile\|kood agendile" mcp/ docs/decisions/0058* CLAUDE.md` — iga koodi asukoha viide uuendatud.
- [ ] **Step 2:** `PYTHONPATH=$PWD .venv/bin/pytest mcp/tests -q` — PASS (kirjelduse testid, kui olemas).
- [ ] **Step 3: Commit** — `docs: ühtne agendikood (ADR 0058 täiendus 2026-10-20)`

---

### Task 8: Väravad ja käsitsikontroll

- [ ] `npm run typecheck && npm test && npm run lint:ci && .venv/bin/pytest tests/ -q && PYTHONPATH=$PWD .venv/bin/pytest mcp/tests -q` — kõik roheline.
- [ ] Käsitsi (kasutaja loal, tunnel + `npm run dev`): `/review` → koodinupp, loend; tekstirida avab õige paki; osade rida avab „Osad" vahekaardi; isikurida avab vormi agendipaneeliga. NB: koodi loomine kirjutab tootmise `state/`-i — küsi enne luba.
