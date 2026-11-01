# Agendi eksemplari-ettepanekud (#703 etapp 1) — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent esitab MCP kaudu agendikoodiga ootel eksemplari-ettepaneku (uus eksemplar / olemasoleva muudatus, konvoluut kaasa, ESTERi allikas igal real); superadmin kinnitab või lükkab read tagasi teose halduse vahekaardil „Eksemplarid".

**Architecture:** Uus hoidla `server/exemplar_proposals.py` (`work_part_proposals.py` muster: SQLite `state/`-is, `agent_handoff` `ATTACH` + `consume` ühes tehingus). Kinnitus käib uue `work_exemplars.apply_proposal_ops` kaudu — sama `_write` (work_lock → metadata_lock → `bulk_update_works`) mis käsitsi muutmisel, mitu rida = üks commit. MCP saab kaks tööriista, frontend uue vahekaardi ja `/review` liigi.

**Tech Stack:** FastAPI + sqlite3 (backend), `vutt_mcp` (MCP SDK), React 19 + TS + Tailwind, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-11-01-eksemplari-ettepanekud-design.md`

## Global Constraints

- Kõik ülevaatuse otspunktid `require_role("superadmin")`; submit on autentimata, ainult kehtiva koodiga.
- WAL-i ei lülitata ühelegi SQLite-failile (ADR 0058 täiendus 2026-10-29).
- Lubatud väljad = `work_exemplars.EDITABLE_FIELDS`; `text_witness`, `pages`, `needs_review`, `id`, `source` väljade hulgas → `invalid_field`.
- `source.kind == "ester"`, `source.ref` vastab `^b\d{7,8}$`, `source.quote` 1–500 märki; üks rida = üks allikas.
- `note` ≤ 1000 märki (valikuline). Ridu ettepanekus 1–30; keha ≤ 64 000 baiti; agendikoodi lagi `exemplars` liigile 20 esitust.
- Kinnitatud kirje `source = {kind: "ester", ref, at: <tänane ISO kuupäev>}` nii uuel kui muudetud eksemplaril; uus eksemplar saab `needs_review: true`; muudatusrida `needs_review`-d ei puutu.
- Ülevaatus = Kinnita / Lükka tagasi; parandust ettepanekus ei ole.
- Koodikommentaarid eesti keeles. Uued i18n võtmed MÕLEMASSE keelde korraga (ADR 0011).
- MCP: iga tööriist `@mcp.tool(structured_output=False)`, vead `VuttError`; `server`-it ei impordita runtime'is.
- Väravad enne PR-i: `npm run typecheck`, `npm test`, `npm run lint:ci` (≤ 41), `.venv/bin/pytest tests/ mcp/tests/`.

## Review Focus

- **Topelt-eksemplar** (migratsioonist juba olemas, agent pakub `create`) → rida `duplicate`, ei kinnitu ka partiis. Test Task 2-s.
- **Kaks järjestikust partiid samale eksemplarile** (esimene muutis välja, teine rida kannab vana `base`-i) → teine rida `stale`, esimese tulemus jääb. Test Task 1-s ja 2-s.
- **Hoidja lisatakse registrisse pärast esitust** → `blocked_holder` muutub `pending`-uks ilma uue esituseta (olek arvutatakse loetelul). Test Task 2-s.
- **Ettepanek aegub, aga osa ridu on otsustatud** → otsustatud read ja „töödeldud" märge jäävad; ootel read näitavad `expired`, ei ole kinnitatavad. Test Task 2-s.
- **Agent kordab esitust võrguvea järel** → teine esitus on eraldi ettepanek; tabel näitab mõlemat, topeltloomine blokeerub `duplicate`-ga pärast esimese kinnitust. Test Task 2-s.

---

### Task 1: Kinnitustee eksemplaridesse (`apply_proposal_ops`)

**Files:**
- Modify: `server/work_exemplars.py` (lisa pärast `update_exemplar`)
- Test: `tests/test_work_exemplars.py`

**Interfaces:**
- Produces:
  - `shelfmark_key(holder: str, shelfmark: str) -> str` — `casefold`, tühikud ühtlustatud, tühikud `.`/`-` ümbert ära; topelt-tuvastuse võti.
  - `apply_proposal_ops(work_dir: str, ops: list[dict], username: str, message: str, background_tasks=None) -> list[str]` — üks `_write`; tagastab iga opi eksemplari id samas järjekorras. Op: `{"op": "create", "fields": dict, "source_ref": str}` või `{"op": "update", "exemplar_id": str, "fields": dict, "base": dict, "source_ref": str}`. Viskab `ExemplarError(f"stale:{i}", 409)` (alus ei klapi / eksemplar puudub), `ExemplarError(f"duplicate:{i}", 409)` (create-rea `shelfmark_key` kattub olemasoleva või sama partii varasema reaga), `ExemplarError` tundmatu hoidja korral (`_check_holder`). Atomaarne: viga → midagi ei kirjutata.

- [ ] **Step 1: Kirjuta testid**

```python
def test_ettepaneku_partii_uks_commit_ja_allikas(work):        # work = olemasolev fixture failis
    # olemas: eksemplar "a" (TÜR, R Est.B-954, source migration, needs_review True)
    ids = we.apply_proposal_ops(work, [
        {"op": "update", "exemplar_id": "a", "fields": {"convolute": {"reference": "R Est.B-954", "position": 0, "total": 2}},
         "base": {"convolute": None}, "source_ref": "b2648642"},
        {"op": "create", "fields": {"holder": "TÜR", "shelfmark": "R Est.B-954 (I)", "condition": "defektne"},
         "source_ref": "b2648642"},
    ], "ed", "Eksemplar: agendi ettepanek (ESTER b2648642)")
    meta = _meta(work)
    a, new = meta["exemplars"][0], meta["exemplars"][1]
    assert ids == ["a", new["id"]]
    assert a["source"] == {"kind": "ester", "ref": "b2648642", "at": date.today().isoformat()}
    assert a["needs_review"] is True                     # muudatus ei puutu lippu
    assert new["needs_review"] is True and new["source"]["kind"] == "ester"
    assert COMMITS == 1

def test_ettepaneku_alus_aegunud(work):          # base ei klapi → stale:0, midagi ei kirjutata
def test_ettepaneku_topelt_loomine(work):        # create "TÜR"/"r est.b-954" (tähesuurus/tühikud) → duplicate:0
def test_ettepaneku_topelt_samas_partiis(work):  # kaks sama create'i → duplicate:1
def test_ettepaneku_tundmatu_hoidja(work):       # holder "XYZ" → ExemplarError, faili ei muudeta
def test_ettepaneku_ops_ei_maara_tunnistajat(work):  # fields {"text_witness": True} → ExemplarError("invalid_field")
```

Kasuta faili olemasolevat fixture'i ja `_x(...)` abilist; kui commit-loendurit ei ole, lisa `save_with_git` monkeypatch nagu `tests/test_work_part_proposals.py` `work` fixture'is.

- [ ] **Step 2:** `.venv/bin/pytest tests/test_work_exemplars.py -k ettepaneku -v` → FAIL (`apply_proposal_ops` puudub).
- [ ] **Step 3:** Implementeeri `shelfmark_key` ja `apply_proposal_ops`. Mutate'i sees: iga update-op jaoks `_find` (puudub → `stale:i`), võrdle `base` igat võtit elava väärtusega (`None` = võti puudub) → `stale:i`; `_apply_fields(x, fields)`, siis `x["source"] = {"kind": "ester", "ref": source_ref, "at": date.today().isoformat()}`. Create: `_check_holder`, topelt-kontroll `shelfmark_key` järgi kõigi senise loendi kirjete vastu, uus id `_new_id`, `needs_review = True`. `fields`-is lubatud ainult `EDITABLE_FIELDS`.
- [ ] **Step 4:** Sama käsk → PASS; ka `tests/test_work_exemplars.py` tervikuna.
- [ ] **Step 5:** Commit `feat(exemplars): apply_proposal_ops — ettepaneku read ühe kirjutusega (#703)`.

---

### Task 2: Ettepanekute hoidla (`server/exemplar_proposals.py`) + koodiliik

**Files:**
- Create: `server/exemplar_proposals.py`
- Modify: `server/agent_handoff.py:26` (`KINDS` + `"exemplars"`)
- Test: `tests/test_exemplar_proposals.py`

**Interfaces:**
- Consumes: Task 1 `apply_proposal_ops`, `shelfmark_key`; `agent_handoff.check/consume/attach/issue`.
- Produces:
  - `DB_PATH = os.path.join(STATE_DIR, "exemplar_proposals.sqlite3")`, `MAX_USES = 20`, `MAX_ROWS = 30`, `MAX_BODY_BYTES = 64_000`, `PROPOSAL_TTL = 14 * 24 * 60 * 60`.
  - `class ProposalError(ValueError)`.
  - `issue_handoff(username: str, code: str | None = None, work_id: str | None = None) -> dict` (testidele, nagu `wpp.issue_handoff`).
  - `submit(code: str, work_id: str, work_dir: str, rows: list, note: str | None = None) -> dict` → `{"proposal_id", "work_id", "status": "pending", "rows": n, "expires_at"}`.
  - `list_for_work(work_id: str, work_dir: str, username: str) -> list[dict]` → ettepanekud uuemad ees: `{"proposal_id", "created_at", "expires_at", "note", "rows": [{"index", "op", "exemplar_id"?, "fields", "base"?, "source": {"kind","ref","quote"}, "status", "review_state", "current": dict | None, "created_exemplar_id"?}]}`. `review_state ∈ {"pending","stale","blocked_holder","duplicate","expired","accepted","rejected"}`.
  - `list_pending_summary(username: str) -> list[dict]` → `{"proposal_id","work_id","created_at","pending","stale"}` ainult kui `pending > 0` (stale = mitte-kinnitatavad ootel read).
  - `decide(work_id: str, work_dir: str, username: str, picks: list[tuple[str, int]], action: str, background_tasks=None) -> dict` → `{"accepted": [...ids], "rejected": n}`.

- [ ] **Step 1: Kirjuta testid** (fixture: `work` kaust `_metadata.json`-iga, millel eksemplar `a` = TÜR R Est.B-954; `archives.json` tmp-is `{"TÜR": {...}}`, `config.ARCHIVES_FILE` monkeypatch; `DB_PATH` ja `agent_handoff.DB_PATH` tmp-i; `save_with_git`/Meili monkeypatch nagu `test_work_part_proposals.py`).

```python
UPD = {"op": "update", "exemplar_id": "a", "fields": {"convolute": {"reference": "R Est.B-954", "position": 0, "total": 2}},
       "base": {"convolute": None}, "source": {"kind": "ester", "ref": "b2648642", "quote": "konvoluut, koos 1 trükisega"}}
NEW = {"op": "create", "fields": {"holder": "TÜR", "shelfmark": "R Est.B-954 (I)", "condition": "defektne"},
       "source": {"kind": "ester", "ref": "b2648642", "quote": "R Est.B-954 (I): defektne"}}

def test_esitus_ei_muuda_teost(work)                        # _metadata.json baidiliselt sama; list_for_work → 2 rida pending
@pytest.mark.parametrize("bad", [
    {**NEW, "fields": {**NEW["fields"], "text_witness": True}},      # invalid_field
    {**NEW, "fields": {**NEW["fields"], "pages": ["t-001"]}},
    {**NEW, "source": {**NEW["source"], "kind": "web"}},             # invalid_source
    {**NEW, "source": {**NEW["source"], "ref": "12345"}},
    {**NEW, "source": {**NEW["source"], "quote": "x" * 501}},
    {**UPD, "base": {}},                                             # base peab katma fields võtmed
    {**UPD, "exemplar_id": "puudub"},                                # unknown_exemplar
    {**UPD, "base": {"convolute": {"reference": "muu"}}},            # stale_base (agent nägi vana seisu)
    {**NEW, "fields": {**NEW["fields"], "convolute": {"reference": "R", "position": 5, "total": 2}}},  # clean_convolute
])
def test_vigane_rida_lukatakse_tagasi_ja_kood_ei_kulu(work, bad)  # ProposalError; viga nimetab rows[0]; check() näitab uses == 0
def test_ridade_lagi(work)                                   # 31 rida → invalid_rows; 0 rida → invalid_rows
def test_kood_ilma_exemplars_liigita_ei_kehti(work)          # wpp.issue_handoff kood → invalid_or_expired_handoff
def test_partii_kinnitus_uks_commit(work)                    # decide([(p,0),(p,1)], "accept") → COMMITS == 1; read accepted
def test_tagasilukkamine_ei_muuda_teost(work)
def test_topelt_create_on_duplicate(work)                    # NEW shelfmark "R Est.B-954" → review_state duplicate; accept → ProposalError, teos muutmata
def test_hoidja_lisamine_vabastab_rea(work)                  # holder "RR" registris puudu → blocked_holder; lisa archives.json-i → pending
def test_teine_partii_vana_alusega_on_stale(work)            # kaks ettepanekut sama UPD-ga; kinnita esimene → teise rida stale, accept → ProposalError
def test_aegunud_ettepanek_jatab_otsustatud_read(work, monkeypatch)  # otsusta rida 0, keri aega üle TTL → rida 1 expired, rida 0 accepted, ettepanek alles; täiesti otsustamata aegunud ettepanek kaob
def test_teine_kasutaja_ei_nae_ega_otsusta(work)
def test_hoidla_ei_kasuta_wal(work)                          # PRAGMA journal_mode != "wal" mõlemas failis
```

- [ ] **Step 2:** `.venv/bin/pytest tests/test_exemplar_proposals.py -v` → FAIL (moodul puudub).
- [ ] **Step 3:** Implementeeri. Skeem nagu `work_part_proposals._db` (0644 fail, `agent_handoff.attach`, tabel `proposal(id, work_id, username, created_at, expires_at, note, payload)`). `_clean(db, now)`: kustuta aegunud ettepanekud, mille ükski rida pole `accepted`/`rejected`. `submit`: `agent_handoff.check(code, "exemplars", work_id, ProposalError, need_use=True)` ENNE teose lugemist; rea puhastus (lubatud võtmed `{"op","exemplar_id","fields","base","source"}`; väljade puhastus `work_exemplars.normalize_exemplar({"id": "x", "holder": ..., **fields})` kaudu, `ExemplarError` → `ProposalError(f"rows[{i}]: {e}")`); seejärel tehingus `consume` + INSERT. `review_state` arvutus (järjekord): `status != pending` → status; aegunud → `expired`; update: eksemplar puudub või base ≠ elav → `stale`; create: hoidja puudub `archives.json`-ist → `blocked_holder`; `shelfmark_key` kattub elava kirjega → `duplicate`; muidu `pending`. `decide`: `_DECIDE_LOCK` (RLock nagu wpp), valitud read peavad olema `review_state == "pending"` (muidu `ProposalError("not_decidable")`); accept → üks `apply_proposal_ops` kõigi valitud ridadega, sõnum `f"Eksemplar: {n} agendi ettepanekut vastu võetud (ESTER {refid-d})"`; `ExemplarError` `stale:`/`duplicate:` → `ProposalError` sama koodiga; pärast edu uuenda payload (`status`, `created_exemplar_id`, `decided_by`, `decided_at`). Reject → ainult payload. `agent_handoff.KINDS` = `("text", "parts", "person", "exemplars")`.
- [ ] **Step 4:** Sama käsk → PASS; `.venv/bin/pytest tests/test_agent_handoff.py tests/test_work_part_proposals.py -q` → PASS.
- [ ] **Step 5:** Commit `feat(exemplars): agendi eksemplari-ettepanekute hoidla (#703)`.

---

### Task 3: HTTP otspunktid + agendikood + `/review` loend

**Files:**
- Modify: `server/routers/work_exemplars.py` (uued teed faili lõppu)
- Modify: `server/agent_proposals.py` (`issue_agent_handoff` limiidid, `list_agent_proposals` haru)
- Test: `tests/test_exemplar_proposals.py` (otspunktide voog), `tests/test_agent_proposals.py`

**Interfaces:**
- Consumes: Task 2 funktsioonid.
- Produces (HTTP):
  - `POST /works/exemplar-proposals/submit` keha `{code, work_id, rows, note?}` (muud võtmed → 400). Rate-limit IP järgi võtmega `"/works/exemplar-proposals-submit"`, keha voogedastusega ≤ `MAX_BODY_BYTES` (413) — kopeeri `parts_proposal_submit` kuju. Puuduv teos → 400 `invalid_or_expired_handoff`.
  - `GET /works/{work_id}/exemplar-proposals` → `list_for_work` (superadmin, `_writable`).
  - `POST /works/{work_id}/exemplar-proposals/decide` keha `{items: [{proposal_id, index}], action: "accept" | "reject"}` → `decide`.
  - `ProposalError` → 409, kui sõnum algab `stale`/`duplicate`/`stale_base`, muidu 400.
  - `issue_agent_handoff` → `max_uses` saab võtme `"exemplars": epp.MAX_USES`.
  - `list_agent_proposals` → rida `{"kind": "exemplars", "proposal_id", "target_id": work_id, "target_label": <pealkiri>, "target_url": f"/work/{work_id}/manage?tab=exemplars", "pending", "stale", "created_at"}`; nähtavus = koodi loonud kasutaja.

- [ ] **Step 1: Testid**

```python
def test_otspunktide_voog(client, work)      # submit (koodiga) → GET näitab 2 rida → decide accept [0] → 200, eksemplaril source ester; teine kasutaja (editor) → 403
def test_submit_vigane_kuju(client)          # lisavõti "x" → 400; puuduv teos → 400 invalid_or_expired_handoff
# tests/test_agent_proposals.py:
#   fixture'i moodulite loendisse (ptp, wpp, ep) lisa (epp, "epp")
#   test_koodi_valjastus: assert h["max_uses"] == {"text": ..., "parts": ..., "persons": ..., "exemplars": epp.MAX_USES}
def test_loend_naitab_eksemplari_ettepanekut(work)  # kind "exemplars", target_url "/work/w1/manage?tab=exemplars", pending 2
```

- [ ] **Step 2:** `.venv/bin/pytest tests/test_exemplar_proposals.py tests/test_agent_proposals.py -v` → uued testid FAIL.
- [ ] **Step 3:** Implementeeri teed ja `agent_proposals` muudatused.
- [ ] **Step 4:** Sama käsk → PASS; `.venv/bin/pytest tests/ -q` → PASS.
- [ ] **Step 5:** Commit `feat(exemplars): eksemplari-ettepanekute otspunktid ja /review liik (#703)`.

---

### Task 4: MCP tööriistad

**Files:**
- Create: `mcp/vutt_mcp/exemplars.py`
- Modify: `mcp/vutt_mcp/server.py` (registreerimine `get_work_parts` kõrval), `mcp/vutt_mcp/instructions.py`
- Test: `mcp/tests/test_exemplars.py`, `mcp/tests/test_server_smoke.py` (`EXPECTED_TOOLS` + `"get_work_exemplars"`, `"submit_exemplar_proposal"`)

**Interfaces:**
- Consumes: HTTP Task 3; avalik `GET /works/{id}/exemplars`, `GET /config/archives`.
- Produces:
  - `work_exemplars(client, work_id: str) -> str` — JSON: `{"work_id", "exemplars": [{id, holder, shelfmark, url, condition, binding, provenance, notes, convolute, text_witness}], "holders": {võti: nimi}}`. 403/404 → `VuttNotFound("Teost … ei leitud või pole avalik (piiratud teose eksemplare ei saa praegu pakkuda).")`.
  - `submit_exemplars(client, handoff_code: str, work_id: str, rows: list, note: str | None = None) -> str` — kontrollib `work_id` kuju ja 1–30 rida, `client.api_post_once("/works/exemplar-proposals/submit", body)`; vastus: „Ettepanek talletatud … N rida, proposal_id=…; toimetaja vaatab üle teose halduse „Eksemplarid" vahekaardil; teost ei muudetud."
  - Tööriistad `get_work_exemplars(work_id)` ja `submit_exemplar_proposal(handoff_code, work_id, rows, note=None)`, mõlemad `structured_output=False`.

- [ ] **Step 1: Testid** (`FakeClient` nagu `mcp/tests/test_parts.py`): `test_eksemplarid_ja_hoidjad` (väljund sisaldab `id` ja hoidjate nimesid), `test_piiratud_teos_annab_juhise`, `test_esitus_saadab_keha_ja_ei_korda` (`api_post_once` kutsutud üks kord, keha `{code, work_id, rows}`), `test_ridade_lagi` (0 ja 31 → `VuttError`), smoke-testi `EXPECTED_TOOLS`.
- [ ] **Step 2:** `.venv/bin/pytest mcp/tests/test_exemplars.py mcp/tests/test_server_smoke.py -v` → FAIL.
- [ ] **Step 3:** Implementeeri. `submit_exemplar_proposal` docstring (agendi juhis, eesti keeles): kood `/review` → „Loo agendikood"; loe enne `get_work_exemplars`; ESTERi kirje loe oma veebivahendiga, `source = {kind: "ester", ref: "b…", quote: <sõnasõnaline lõik ESTERist>}`; üks rida = üks allikaolukord; kui eksemplar on `get_work_exemplars`-is juba olemas (sama hoidja + kohaviit), esita `op: "update"` koos `exemplar_id` ja `base`-iga (muudetavate väljade praegune väärtus, puuduv = null), mitte `create`; hoidja AINULT `holders` võtmete seast (puuduv hoidja: kirjuta lähim võti ja maini `note`-is); konvoluut: `{reference, position (0 = põhiteos, N = N. kaasköide), total, contents}`, viide nagu allikas; ÄRA paku `text_witness`, `pages`, `needs_review`, seoseid, poolitust ega `ester_id`; võrguvea järel ära saada pimesi uuesti. `instructions.py`-sse üks lõik töövoost.
- [ ] **Step 4:** Sama käsk → PASS; `.venv/bin/pytest mcp/tests -q` → PASS.
- [ ] **Step 5:** Commit `feat(mcp): get_work_exemplars ja submit_exemplar_proposal (#703)`.

---

### Task 5: Frontend teenus ja `/review` liik

**Files:**
- Create: `src/services/exemplarProposalsApi.ts`
- Modify: `src/services/agentProposalsService.ts` (`AgentProposalKind` + `'exemplars'`, `max_uses.exemplars: number`), `src/pages/review/AgentProposalsSection.tsx` (`kindLabel.exemplars`), `src/locales/{et,en}/review.json` (`proposals.kind.exemplars` = „Eksemplarid" / "Copies"; `codeHelp` lisab „eksemplarid (kuni {{exemplars}})" / "copies (up to {{exemplars}})")
- Test: olemasolev `src/pages/review/__tests__/` AgentProposalsSection test — lisa juhtum `kind: 'exemplars'` → silt `proposals.kind.exemplars`

**Interfaces:**
- Produces (`exemplarProposalsApi.ts`):
  - `type ExemplarReviewState = 'pending' | 'stale' | 'blocked_holder' | 'duplicate' | 'expired' | 'accepted' | 'rejected'`
  - `interface ExemplarProposalRow { index: number; op: 'create' | 'update'; exemplar_id?: string; fields: Partial<Exemplar>; base?: Partial<Exemplar>; source: { kind: 'ester'; ref: string; quote: string }; status: 'pending' | 'accepted' | 'rejected'; review_state: ExemplarReviewState; current: Exemplar | null; created_exemplar_id?: string }`
  - `interface ExemplarProposal { proposal_id: string; created_at: number; expires_at: number; note?: string | null; rows: ExemplarProposalRow[] }`
  - `listExemplarProposals(workId: string, token: string): Promise<ExemplarProposal[]>`
  - `decideExemplarProposals(workId: string, items: { proposal_id: string; index: number }[], action: 'accept' | 'reject', token: string): Promise<{ accepted: string[]; rejected: number }>`
  - `esterRecordUrl(ref: string): string` → `` `https://www.ester.ee/record=${ref}*est` ``

- [ ] **Step 1:** Lisa test AgentProposalsSection-i ja `esterRecordUrl` test (`src/services/__tests__/exemplarProposalsApi.test.ts`: `esterRecordUrl('b2648642') === 'https://www.ester.ee/record=b2648642*est'`).
- [ ] **Step 2:** `npx vitest run src/pages/review src/services/__tests__/exemplarProposalsApi.test.ts` → FAIL.
- [ ] **Step 3:** Implementeeri (apiGet/apiPost `FILE_API_URL`-iga nagu `workPartsApi.ts`).
- [ ] **Step 4:** Sama käsk + `npm run typecheck` → PASS (ka `localeParity`).
- [ ] **Step 5:** Commit `feat(review): eksemplari-ettepanekute liik ja teenus (#703)`.

---

### Task 6: Teose halduse vahekaart „Eksemplarid"

**Files:**
- Create: `src/pages/manage/exemplars/ExemplarProposalsTab.tsx`
- Modify: `src/pages/manage/partsModel.ts:136-143` (`ManageTab` + `'exemplars'`; `initialManageTab` tagastab `'exemplars'`, kui `tab === 'exemplars' && focus === null`), `src/pages/WorkManage.tsx` (vahekaardi nupp + sisu), `src/locales/{et,en}/workspace.json` (`manage.exemplarProposals.*`)
- Test: `src/pages/manage/exemplars/__tests__/ExemplarProposalsTab.test.tsx` (`/** @vitest-environment jsdom */`), `src/pages/manage/__tests__/` partsModel test (`initialManageTab(null, 'exemplars') === 'exemplars'`)

**Interfaces:**
- Consumes: Task 5 API.
- Produces: `ExemplarProposalsTab: React.FC<{ workId: string; token: string | null; onChanged?: () => void }>`.

Käitumine: tabel kõigist ettepanekutest (uuemad ees), rida = linnuke · liik (`create` → „uus", `update` → „muudatus: {holder} {shelfmark}") · praegu (`current`, ainult `fields` võtmed; konvoluut loetavalt nagu `ExemplarsSection` kokkuvõttes) · ettepanek (muutunud väljad paksult) · allikas (ESTERi link `esterRecordUrl` + tsitaat) · Kinnita / Lükka tagasi. Linnuke ja Kinnita ainult `review_state === 'pending'` real; muudel olekumärk (`stale` „eksemplar on vahepeal muutunud", `blocked_holder` „hoidja puudub registris", `duplicate` „eksemplar on juba olemas", `expired`, `accepted`, `rejected`). Ülal „Kinnita valitud (N)" ja ettepaneku `note`. Pärast otsust laeb nimekirja uuesti ja kutsub `onChanged`. Teated `useNotify()`; kinnitusdialoogi ei ole (kinnitus on otsene tegevus). WorkManage: superadminil (`isAtLeast(user.role, 'superadmin')`) laetakse `listExemplarProposals` korra; nupp „Eksemplarid" näidatakse, kui vastuses on ridu või `activeTab === 'exemplars'`; nupul ootel ridade arv.

- [ ] **Step 1: Testid** (mock `exemplarProposalsApi`, `useNotify`, i18n nagu `ExemplarsSection.test.tsx`):
  - `näitab uut ja muudatusrida, allika lingi ja tsitaadi` — link `href` = `https://www.ester.ee/record=b2648642*est`.
  - `aegunud ja topelt read ei ole valitavad` — `stale`/`duplicate` real linnukest ega Kinnita nuppu ei ole, olekutekst on.
  - `kinnita valitud saadab valitud read ühe päringuga` — vali 2 rida → `decideExemplarProposals('w1', [{proposal_id:'p1',index:0},{...index:1}], 'accept', 'tok')` üks kord; seejärel uus laadimine.
  - `tagasilükkamine ühe rea kaupa` — `decide…([...index:0], 'reject')`.
- [ ] **Step 2:** `npx vitest run src/pages/manage` → FAIL.
- [ ] **Step 3:** Implementeeri komponent ja WorkManage muudatused.
- [ ] **Step 4:** `npx vitest run src/pages/manage` + `npm run typecheck` + `npm run lint:ci` → PASS.
- [ ] **Step 5:** Commit `feat(manage): vahekaart „Eksemplarid" agendi ettepanekutele (#703)`.

---

### Task 7: ADR-id, CLAUDE.md, väravad, PR

**Files:**
- Modify: `docs/decisions/0058-mcp-esitab-ainult-ootel-prosopo-ettepaneku.md` (uus „## Täiendus 2026-11-01 (#703): eksemplari ettepanek"), `docs/decisions/0076-eksemplari-kiht.md` §7 (täpsustus: `base` kohustuslik, `duplicate`/`blocked_holder`, allikas asendub ESTERiga, otsustatud read säilivad aegumisel), `CLAUDE.md` (state-tabelisse `exemplar_proposals.sqlite3`; „MCP ettepanekud" lõiku liik `exemplars`)

ADR 0058 täienduse sisu (spekist): tõendi liik `ester` lubatud AINULT eksemplari-ettepanekul, põhjendus (püsiv, numbriga kontrollitav kataloog; server kontrollib kuju, klient koostab lingi); muu veebiallika peale agent endiselt ettepanekut ei tee; uus liik `exemplars` (lagi 20), hoidla, `target_url = /work/{id}/manage?tab=exemplars`; viide spekile.

- [ ] **Step 1:** Kirjuta ADR-ide ja CLAUDE.md muudatused.
- [ ] **Step 2:** Väravad: `npm run typecheck && npm test && npm run lint:ci && .venv/bin/pytest tests/ mcp/tests/ -q` → kõik rohelised.
- [ ] **Step 3:** Commit `docs(adr): 0058 täiendus — eksemplari ettepanek ESTERi allikaga (#703)`; push haru `feat/703-eksemplari-ettepanekud`; PR main'i vastu, kirjelduses: deploy vajab `server_update.sh --no-cache` + frontendi rsync, reindeksit ei ole; MCP vajab agendi masinas `pipx` uuendust.
