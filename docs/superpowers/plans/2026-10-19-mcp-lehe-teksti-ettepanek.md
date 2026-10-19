# MCP lehe teksti ettepanek: teostusplaan (#641)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent esitab lehe teksti muudatused ootel ettepanekuna. Superadmin vaatab need Workspace'is pildi kõrval diffina üle ja kinnitab kas lehe kaupa (Ctrl+S) või terve paki korraga taustatööna.

**Architecture:** Uus serverimoodul `server/page_text_proposals.py` (SQLite `state/`-is, ADR 0058 muster). See talletab iga lehe kohta toore `base_text` ja normaliseeritud `proposed_text`. Ülevaatus ja paki kinnitus liidavad ettepaneku ketta praeguse tekstiga (`merge_text`) ja kontrollivad märgendust uuesti. Lehe kinnitus käib olemasoleva `/save` kaudu (uus valikuline `proposal`-väli), paki kinnitus taustatööna (`page_ops_jobs` muster) ühe commit'iga. Frontendis laeb uus hook ettepaneku redaktorisse salvestamata muudatusena ja tõstab diffi esile mark-dekoratsioonidega.

**Tech Stack:** Python 3.12, FastAPI, sqlite3, native git CLI; React 19 + TypeScript, CodeMirror 6, i18next; MCP Python SDK (`mcp/vutt_mcp`).

**Spec:** `docs/superpowers/specs/2026-10-19-mcp-lehe-teksti-ettepanek-design.md`. Loe enne igat ülesannet kogu spekk läbi. Plaan ei korda põhjendusi.

## Global Constraints

- Koodikommentaarid eesti keeles. UI-võtmed korraga `et` ja `en` (ADR 0011), muidu kukub `localeParity.test.ts`.
- Kõik ülevaatuse ja otsuse otspunktid: `require_role("superadmin")`. Koodiga otspunktid (`source`, `submit`) on autentimata, kood on õigus.
- Koodi TTL 8 h, 20 kasutuskorda (lugemine ei kuluta). Ettepanek aegub 14 päevaga. Pakis kuni 200 lehte, lehel kuni 100 edit'i, keha ≤ 2 MB.
- `text_hash` = `sha256(toortekst.encode("utf-8")).hexdigest()` täpselt tagastatud toortekstist.
- Lukkude järjekord KÕIKJAL: ettepanekulukud id järjekorras → `page_lock` tüve järjekorras → `_git_write_lock` (`save_with_git` sees). `page_lock` ei ole reentrant.
- Lehe seisundit, kommentaare, annotatsioone ega muid JSON-välju ettepaneku kinnitus ei muuda. Paki töö kirjutab ainult `.txt`.
- Lehe olekud: `pending | accepted | rejected | stale | superseded`. Ülevaatust vajavad `pending` ja `stale`.
- SQLite-fail luuakse 0644 õigustega (`work_part_proposals._db` muster, #619).
- Python-testid: `.venv/bin/pytest`. Frontend: `npm run typecheck`, `npm test`, `npm run lint:ci` (hoiatuste arv ei tohi kasvada).
- MCP ei impordi runtime'is `server`-it. Iga tööriist `@mcp.tool(structured_output=False)`, vead `VuttError`-ina.
- Uus otspunkt mitte `main.py`-sse, vaid routerisse. Sisemine info `/admin/` alla, sest `/api/files/` proksib kõik avalikult.

## Review Focus

1. **Lehel on vana vigane märgendus või literaalne `<`** („a < b“, orb `</i>` kettal). Ühe tähe parandus peab läbi minema, sest uusi vigu ei teki. → Task 1 `test_vana_viga_ei_blokeeri`, Task 3 `test_submit_vana_vigane_leht_lubatud`.
2. **Agent esitab samale lehele uue paki, kui vana on poolenisti üle vaadatud.** Vana leht → `superseded`, juba `accepted` lehti ei puudutata, pakk kaob loendist alles siis, kui tal pole `pending`/`stale` lehti. → Task 3 `test_supersede_ainult_ootel`.
3. **Toimetaja avab ettepanekuga lehe, toimetab seda ja vajutab siis „Kinnita kogu pakk“.** Enne salvestatakse aktiivne leht toimetaja versioonis. Salvestusvea või tühistamise korral pakki ei käivitata. → Task 12 `kinnitaPakk_salvestab_enne_ja_peatub_veal`.
4. **Ettepanek muudab ainult reavahetust või tühikut lehe lõpus** (`text.endswith("\n")`). Räsi, taaste ja `git show` peavad säilitama lõpu-reavahetuse. → Task 6 `test_taaste_sailitab_lopu_reavahetuse` (`git_ops.get_file_at_commit` kasutab GitPythoni, mis lõikab lõpu; kasuta toorbaitidega varianti).
5. **Lehe fail on vahepeal kustutatud või ümber nimetatud** (lehe kustutus või poolitus teose halduses). Ülevaatus ja pakk annavad sellele lehele `stale`, mitte 500. → Task 4 `test_kustutatud_leht_stale`, Task 6 `test_pakk_kustutatud_leht`.

---

## Failide kaart

| Fail | Vastutus |
|---|---|
| `server/vutt_tags.py` (muuda) | `markup_errors`, `ann_tokens`, `has_ann_token`: puhas märgenduse kontroll |
| `server/page_text.py` (uus) | `normalize_page_text` (tõstetud `editing._normalize_page_text`-ist), `text_hash` |
| `server/routers/editing.py` (muuda) | kasutab `page_text`-i; `_merge_with_base` normaliseerib ka ketta poole; `/save` `proposal`-väli |
| `server/git_ops.py` (muuda) | `committed_state(paths) -> dict[str, bool] \| None`, `head_bytes(rel) -> bytes \| None` |
| `server/page_text_proposals.py` (uus) | SQLite, kood, source, esitus, ümberbaseerimine, loetelu, otsused, lukud |
| `server/page_text_proposal_jobs.py` (uus) | paki kinnituse taustatöö (olek mälus) |
| `server/routers/page_text_proposals.py` (uus) | otspunktid + `GET /markup/tags` |
| `server/main.py`, `server/auth.py` (muuda) | routeri ühendus, `revoke_handoffs` |
| `mcp/vutt_mcp/page_text.py` (uus), `mcp/vutt_mcp/server.py` (muuda) | MCP tööriistad |
| `src/services/textProposalService.ts` (uus), `src/services/pageService.ts` (muuda) | API kliendid, `savePage` `proposal` |
| `src/utils/textDiff.ts` (uus) | sõnataseme diff (jagatud #577-ga) |
| `src/components/editor/proposalDiffExtension.ts` (uus) | CodeMirror mark-dekoratsioonid |
| `src/components/editor/useTextProposal.ts`, `TextProposalPanel.tsx` (uus); `TextEditor.tsx`, `Workspace.tsx` (muuda) | Workspace'i ülevaatus |
| `src/pages/Review.tsx` (muuda), `src/pages/review/AgentProposalsSection.tsx` (uus) | pakkide loend + kood |
| `docs/decisions/0058-…md`, `CLAUDE.md` (muuda) | ADR täiendus, invariandirida |

---

### Task 1: Märgenduse kontroll registris

**Files:**
- Modify: `server/vutt_tags.py`
- Modify: `src/markup/vuttTags.ts` ainult siis, kui pariteeditest (`tests/test_vutt_tags_parity.py`) nõuab uute nimede peegeldust. Muidu pole frontendis kontrolli vaja.
- Test: `tests/test_vutt_tags.py`

**Interfaces:**
- Produces:
  - `markup_errors(text: str) -> collections.Counter[tuple[str, str]]`: võti `(liik, täg)`, liik ∈ `"unknown" | "unclosed" | "unopened" | "crossing" | "m_newline"`.
  - `ann_tokens(text: str) -> list[str]`: kõik `<annN>`/`</annN>` tokenid järjekorras, sõnasõnaliselt.
  - `has_ann_token(s: str) -> bool`.
  - `new_markup_errors(base: str, proposed: str) -> list[tuple[str, str]]` = `markup_errors(proposed) - markup_errors(base)` (Counter lahutus, sorteeritud).

- [ ] **Step 1: Kirjuta testid**

```python
from server.vutt_tags import markup_errors, new_markup_errors, ann_tokens, has_ann_token

def test_tundmatu_ja_paarita():
    e = markup_errors("<x>a</x> <i>b")
    assert e[("unknown", "x")] == 2 and e[("unclosed", "i")] == 1

def test_ristuvad_paarid():
    assert new_markup_errors("<i>x</i>", "</i>x<i>")       # arvud samad, struktuur katki
    assert ("crossing", "b") in markup_errors("<i>a<b>b</i>c</b>") or ("crossing", "i") in markup_errors("<i>a<b>b</i>c</b>")

def test_m_reavahetusega():
    assert ("m_newline", "m") in markup_errors("<m>a\nb</m>")

def test_vana_viga_ei_blokeeri():
    base = "a < b </i> vana"
    assert new_markup_errors(base, base.replace("vana", "uus")) == []

def test_pb_ja_annN():
    assert markup_errors("a<pb/>b <ann3>c</ann3>") == {}
    assert ann_tokens("x<ann1>a</ann1> <ann12>b</ann12>") == ["<ann1>", "</ann1>", "<ann12>", "</ann12>"]
    assert has_ann_token("üks</ann1> kaks") and not has_ann_token("annab")
```

- [ ] **Step 2:** `.venv/bin/pytest tests/test_vutt_tags.py -v`. Oodatud tulemus: FAIL (ImportError).
- [ ] **Step 3: Teosta.** Tokeniseerija: `_ANY_TAG_RE` (juba failis) + `<pb/>`. Literaalne `<`, mis ei sobi tägi mustriga, ei ole täg. Pinu: sulgev täg, mis ei vasta pinu tipule, aga on pinus sügavamal → `crossing`; pinus puudub → `unopened`; lõpuks pinusse jäänud → `unclosed`. Registrinimi `ann` sobib `annN`-iga (`tag_pattern`). `m_newline`: kehtiva `<m>…</m>` paari sisus on `\n`.
- [ ] **Step 4:** `.venv/bin/pytest tests/test_vutt_tags.py tests/test_vutt_tags_parity.py -v`. Oodatud tulemus: PASS.
- [ ] **Step 5:** commit `feat(vutt_tags): märgenduse struktuurikontroll ettepanekutele (#641)`.

### Task 2: Ühine normaliseerimine ja `/save` ketta poole parandus

**Files:**
- Create: `server/page_text.py`
- Modify: `server/routers/editing.py:93-139` (`_normalize_page_text` → import; `_merge_with_base` `theirs`)
- Test: `tests/test_save_liitmine.py` (lisa juurde)

**Interfaces:**
- Produces:
  - `server.page_text.normalize_page_text(text: str | None) -> str` (sama mis praegune `_normalize_page_text`);
  - `server.page_text.text_hash(raw: str) -> str` (sha256 hex UTF-8 baitidest).

- [ ] **Step 1: Kirjuta regressioonitest.** Ketta `.txt` = `unicodedata.normalize("NFD", "Café vana\n")`. Klient saadab `base.text_content` = sama NFD-tekst ja `text_content` = `"Café uus\n"`. `/save` (või otse `_save_page_locked` koos `base`-iga) → konflikti ei ole, kettal on `normalize_page_text("Café uus\n")`.
- [ ] **Step 2:** testi käivitus. Oodatud tulemus: FAIL (`_PageConflict`).
- [ ] **Step 3: Teosta.** `page_text.py` (stdlib + `marginalia_normalize`). `editing.py` impordib selle, `_normalize_page_text = normalize_page_text` jääb aliaseks, kui teised moodulid seda impordivad (kontrolli `grep -rn _normalize_page_text server`). `_merge_with_base`-is: `theirs["text_content"] = normalize_page_text(theirs["text_content"])` enne `merge_page`-i.
- [ ] **Step 4:** `.venv/bin/pytest tests/test_save_liitmine.py tests/test_page_merge.py tests/test_save_noop.py -v`. Oodatud tulemus: PASS.
- [ ] **Step 5:** commit `fix(save): liitmine võrdleb ketast normaliseeritult (#641)`.

### Task 3: Ettepanekute moodul: kood, source, esitus

**Files:**
- Create: `server/page_text_proposals.py`
- Test: `tests/test_page_text_proposals.py`

**Interfaces:**
- Consumes: `normalize_page_text`, `text_hash` (Task 2); `new_markup_errors`, `ann_tokens`, `has_ann_token` (Task 1); `work_parts.page_stems(work_dir)`; `page_locks.page_lock`; `page_merge.read_page_view`.
- Produces:
  - `DB_PATH = os.path.join(STATE_DIR, "page_text_proposals.sqlite3")`, `CODE_TTL = 8*3600`, `MAX_USES = 20`, `PROPOSAL_TTL = 14*24*3600`, `MAX_PAGES = 200`, `MAX_EDITS = 100`, `MAX_BODY_BYTES = 2_000_000`.
  - `class ProposalError(ValueError)`: sõnum = masinloetav kood (`invalid_or_expired_handoff`, `handoff_used_up`, `unknown_page`, `stale_page:<stem>`, `old_not_found:<stem>:<i>`, `old_ambiguous:<stem>:<i>`, `anchor_touched:<stem>:<i>`, `invalid_markup:<stem>:<liik>:<täg>`, `no_changes`, `too_many_pages`, `too_many_edits:<stem>`).
  - `issue_handoff(work_id: str | None, username: str) -> dict` (`{code, expires_at, max_uses, work_id}`; `None` = kõik teosed).
  - `revoke_handoffs(username: str) -> int`.
  - `check_code(code: str, work_id: str) -> sqlite3.Row`: ainult lugemine, ei kuluta.
  - `read_source(code: str, work_id: str, work_dir: str, page: int) -> dict`: `{work_id, page, stem, text, text_hash, status}`.
  - `proposal_lock(proposal_id: str)`: contextmanager, protsessi lukk id järgi (`page_locks` nõrga viite muster).
  - `submit(code: str, work_id: str, work_dir: str, pages: list[dict], note: str) -> dict`: `{proposal_id, pages, superseded, expires_at}`.
- Skeem: `handoff(code_hash PK, work_id NULL, username, expires_at, max_uses, uses)`, `proposal(id PK, work_id, username, note, created_at, expires_at)`, `proposal_page(proposal_id, stem, page_no, base_text, proposed_text, note, state, decided_by, decided_at, PRIMARY KEY(proposal_id, stem))`.

- [ ] **Step 1: Kirjuta testid.** Fixture nagu `tests/test_work_part_proposals.py`: `tmp_path` teos, `t-001.jpg`…, `.txt` failid, `DB_PATH` monkeypatch. Testid:
  - `test_source_nouab_koodi`: vale kood → `invalid_or_expired_handoff`. Õige kood → `text` on toorbaitidega identne, `text_hash == sha256(...)`, `uses` ei kasva.
  - `test_kood_koigile_teostele`: `issue_handoff(None, u)` → sobib igale `work_id`-le.
  - `test_submit_rakendab_toortekstile_ja_normaliseerib`: NFD-ketas, edit `vana→uus`. `base_text` = toorbaidid, `proposed_text == normalize_page_text(...)`.
  - `test_submit_rasi_ei_klapi`: ketas muutus pärast `read_source`-i → `stale_page:t-001`.
  - `test_old_puudub_ja_mitmekordne` → vastavad koodid, DB-sse ei talletata midagi.
  - `test_anchor_touched`: `<ann1>üks</ann1> kaks` → edit `old="</ann1> kaks"`, `new="kaks</ann1>"` → `anchor_touched:t-001:0`. Dubleerimine (`new` sisaldab `<ann1>`) → sama viga.
  - `test_invalid_markup`: `<i>x</i>` → `</i>x<i>` → `invalid_markup:…:crossing:i`. `<table>` → `unknown`.
  - `test_submit_vana_vigane_leht_lubatud`: kettal üksik `</i>`, parandus mujal → OK.
  - `test_muutuseta_leht_valja_tuhi_pakk`: kõik lehed muutuseta → `no_changes`.
  - `test_supersede_ainult_ootel`: pakk A lehed 1, 2. Leht 1 `accepted` (otse DB-s). Pakk B leht 1 ja 2 → A leht 2 `superseded`, A leht 1 jääb `accepted`. `superseded` loendis = `[(A, "t-002")]`.
  - `test_piiratud_teos_lubatud`: `_metadata.json` `restricted`/privaatne kogu → `read_source` ja `submit` toimivad.
  - `test_kasutuskord_kulub_ainult_esitusel` ja `test_laed` (201 lehte → `too_many_pages`).
- [ ] **Step 2:** `.venv/bin/pytest tests/test_page_text_proposals.py -v`. Oodatud tulemus: FAIL.
- [ ] **Step 3: Teosta.** Järjekord `submit`-is nagu `work_part_proposals.submit`: koodi lugemine → laed → lehtede töötlus → üks transaktsioon (kood kulub CAS-iga, INSERT, supersede). Lehtede töötlus:
  1. Kogu puudutatud varasemate ootel pakkide id-d (SQL `state IN ('pending','stale') AND stem IN …`).
  2. Võta nende `proposal_lock`-id id järjekorras.
  3. Võta lehtede `page_lock`-id tüve järjekorras.
  4. Loe toorbaidid, kontrolli räsi, rakenda edit'id (`str.count(old) == 1`, `has_ann_token(old or new)` → viga), normaliseeri, kontrolli `new_markup_errors` ja `ann_tokens(base) == ann_tokens(proposed)`.
  5. Kirjuta DB.
  6. Vabasta lukud.

  `page_no` talletatakse ainult kuvamiseks.
- [ ] **Step 4:** testid PASS.
- [ ] **Step 5:** commit `feat(proposals): lehe teksti ettepanek, kood ja esitus (#641)`.

### Task 4: Ümberbaseerimine, loetelu, tagasilükkamine, taaste

**Files:**
- Modify: `server/page_text_proposals.py`, `server/git_ops.py`
- Test: `tests/test_page_text_proposals.py`, `tests/test_save_with_git_cli.py` (git-abilistele)

**Interfaces:**
- Consumes: Task 1–3; `page_merge.merge_text`, `page_merge._seose_vead` (impordi; kui see on privaatne, tee avalik alias `annotation_link_errors`).
- Produces:
  - `git_ops.committed_state(paths: list[str]) -> dict[str, bool] | None`: `True` = kettal sama mis HEAD-is; `None` = git-viga (EI tõlgendata commit'ituna).
  - `git_ops.head_bytes(relative_path: str) -> bytes | None`: `subprocess.run(["git","show",f"HEAD:{rel}"], capture_output=True)` toorbaidid (mitte GitPython, mis lõikab lõpu-reavahetuse).
  - `rebase(base_text: str, proposed_text: str, disk_text: str, annotations: list) -> str | None`: liidetud ja normaliseeritud tekst, `None` = kokkupõrge (merge-konflikt, uus märgendusviga ketta vastu, `ann_tokens` ≠ ketta oma või `_seose_vead` kasvas).
  - `review_page(proposal_id: str, stem: str, work_dir: str) -> dict`: `{state, page: <read_page_view>, proposed_now: str | None, base_text, proposed_text, note, pack_note}`. Kõik ühe `page_lock`-i all.
  - `list_pending(work_id: str | None = None) -> list[dict]`: pakid, milles on `pending`/`stale` lehti: `{proposal_id, work_id, note, username, created_at, counts: {pending, stale, accepted, rejected}, pages: [{stem, page_no, state}]}`.
  - `reject_page(proposal_id, stem, username) -> None`, `reject_pack(proposal_id, username) -> int`: CAS `state IN ('pending','stale')`, `proposal_lock` all.
  - `mark_accepted(proposal_id, stems: list[str], username) -> int`: CAS, `proposal_lock` all (kutsuja hoiab lukku).

- [ ] **Step 1: Kirjuta testid.**
  - `test_rebase_puhas`: ketas == base → `proposed_now == proposed_text`.
  - `test_rebase_mujalt_muudetud`: inimene muutis teist rida → liidetud.
  - `test_rebase_uksik_sulgev_tag_stale`: base `<i>a\nx\ny</i>\nz\nw`, ettepanek eemaldab paari, ketas nihutab `</i>` lõppu. `merge_text` annab `a\nx\ny\nz\nw</i>` → `rebase` tagastab `None`, `review_page` märgib `stale`.
  - `test_review_page_uks_hetktommis`: tagastatud `page.text_content` on see, mille vastu `proposed_now` liideti (monkeypatch `merge_text` kontrollib, et lukk on võetud, `page_lock_acquire_nowait` → False).
  - `test_taaste_commititud`: ketas == proposed, `committed_state` → `{path: True}` → `state == "accepted"`, kirjutust pole.
  - `test_taaste_commitimata_ei_kirjuta`: `committed_state` → `False` → leht jääb `pending`, `proposed_now` arvutatakse ketta vastu, faili ei muudeta.
  - `test_taaste_git_viga`: `committed_state` → `None` → leht jääb `pending`.
  - `test_kustutatud_leht_stale`: `.txt` kustutatud → `stale`, mitte erind.
  - `test_list_pending_stale_hoiab_paki_loendis`; `test_reject_cas` (teine reject → 0).
  - `test_committed_state_ja_head_bytes` (tmp git repo): lõpu `\n` säilib.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Teosta.** Taastereegel spekist: commit'itud + `proposed_now == disk != base` → `accepted`. Lugemistee ei kirjuta kunagi faili.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(proposals): ümberbaseerimine ja taaste git'i järgi (#641)`.

### Task 5: `/save` ettepaneku viitega

**Files:**
- Modify: `server/routers/editing.py:155-259`
- Test: `tests/test_page_text_proposals_save.py`

**Interfaces:**
- Consumes: `proposal_lock`, `mark_accepted`, `reject_page` (Task 4).
- Produces: `/save` keha valikuline `proposal: {"id": str, "stem": str}`. Vastus lisab `"proposal_state": "accepted" | "rejected"`.

- [ ] **Step 1: Kirjuta testid.**
  - `test_save_viitega_kinnitab`: commit-sõnumis on `MCP-ettepanek <id>`, leht `accepted`.
  - `test_save_viitega_muutusteta_rejected`.
  - `test_save_409_jatab_ootele`.
  - `test_save_viide_mitte_superadmin_403` (admin → 403, ketas puutumata).
  - `test_save_viide_vale_stem_400`: stem ≠ `file_name` tüvi.
  - `test_lukujarjekord`: `proposal_lock` võetakse enne `page_lock`-i (monkeypatch salvestab järjekorra).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Teosta.** `save()`:
  - kui `proposal` on antud, nõua `is_at_least(user["role"], "superadmin")`;
  - kontrolli, et `stem == splitext(file_name)[0]` ja et leht on `pending`/`stale`;
  - kutsu `_save_page_locked` `proposal_lock`-i sees, `run_in_threadpool`-iga ühe funktsioonina.

  `_save_page_locked` saab valikulise `message`-i ja annab selle `save_with_git`-ile. Pärast edukat tulemust kutsu `mark_accepted`, `None` tulemuse (muutusteta) korral `reject_page`. Erind (409) → olekut ei muudeta.
- [ ] **Step 4:** PASS + `.venv/bin/pytest tests/test_save_*.py -v`.
- [ ] **Step 5:** commit `feat(save): ettepaneku kinnitus /save kaudu (#641)`.

### Task 6: Paki kinnitus taustatööna

**Files:**
- Create: `server/page_text_proposal_jobs.py`
- Modify: `server/page_text_proposals.py` (lisa `apply_pack`)
- Test: `tests/test_page_text_proposal_jobs.py`

**Interfaces:**
- Consumes: Task 4 (`rebase`, `committed_state`, `head_bytes`, `mark_accepted`, `proposal_lock`); `git_ops.save_with_git(filepath, content, username, message=..., additional_files=[(path, content), ...])`; `meilisearch_ops.sync_work_to_meilisearch_async(catalog)`.
- Produces:
  - `apply_pack(proposal_id: str, work_dir: str, username: str, progress: Callable[[int, int], None]) -> dict` = `{accepted: [stem], stale: [stem], skipped: [stem]}`. Viskab `RuntimeError("git_failed")` pärast ketta taastet.
  - `page_text_proposal_jobs.start(proposal_id: str, work_id: str, work_dir: str, username: str) -> bool` (False = selle teose töö juba käib); `get_status(work_id: str) -> dict` (`page_ops_jobs` kuju: `state, done, total, result | error`).

- [ ] **Step 1: Kirjuta testid** (git ja Meili monkeypatchitud nagu `test_work_part_proposals.py` `fake_save`-is):
  - `test_pakk_uks_commit_uks_sunk`: 3 lehte → 1 commit, 1 Meili sünk, JSON-failid baithaaval samad.
  - `test_pakk_konflikt_stale_ketas_puutumata`.
  - `test_pakk_jatab_otsustatud_vahele`.
  - `test_pakk_git_viga_taastab_ketta`: `save_with_git` kirjutab ja tagastab `success: False` → kõik `.txt` toimingueelses seisus, lehed `pending`, `RuntimeError`.
  - `test_pakk_commitimata_poolik_taastatakse_headist`: ketas ≠ HEAD ja == proposed → enne liitmist taastatakse `head_bytes`-ist, siis rakendatakse uuesti.
  - `test_taaste_sailitab_lopu_reavahetuse`.
  - `test_pakk_kustutatud_leht` → `stale`.
  - `test_samaaegne_save_ootab`: lõim hoiab paki töös lehelukke (monkeypatch `save_with_git` blokeerib `Event`-iga), teine lõim kutsub `_save_page_locked` → see ootab ja kirjutab pärast. Lõpuks on tema tekst kettal ja ajaloos.
  - `test_start_409_kui_kaib`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Teosta** `apply_pack`:
  1. `proposal_lock(proposal_id)`.
  2. Loe `pending` lehed.
  3. `page_lock`-id tüve järjekorras (`contextlib.ExitStack`).
  4. Iga lehe kohta loe toorbaidid. Kui `committed_state` ütleb „commit'imata“, taasta `head_bytes`-ist ja jätka.
  5. `rebase`.
  6. Kogu kirjutatavad `(path, uus, vana_toor)`.
  7. Üks `save_with_git` (esimene fail + `additional_files`), `message=f"MCP-ettepanek {proposal_id}: {n} lehte"`.
  8. `success is False` või erind → kirjuta `vana_toor` tagasi kõigile, lukke vabastamata. Seejärel `RuntimeError`.
  9. `mark_accepted`, `stale` märkimine.
  10. Vabasta lukud.
  11. Meili sünk üks kord.

  `page_text_proposal_jobs` = `page_ops_jobs.py` koopia, mis kutsub `apply_pack`-i.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(proposals): paki kinnitus ühe commit'iga, taaste vea korral (#641)`.

### Task 7: Router, tägide loend, revoke, ADR

**Files:**
- Create: `server/routers/page_text_proposals.py`
- Modify: `server/main.py` (include_router), `server/auth.py:450-461` (`_revoke_agent_handoffs` moodulite loend), `docs/decisions/0058-mcp-esitab-ainult-ootel-prosopo-ettepaneku.md` (täiendus 2026-10-19), `CLAUDE.md` (MCP ettepanekute invariandi lõik: üks lause lehe teksti kohta + viide ADR-ile)
- Test: `tests/test_page_text_proposals_router.py`

**Interfaces:**
- Consumes: Task 3–6.
- Produces (kõik `/api/files` all):
  - `GET /markup/tags` (avalik) → `[{name, paired, tei}]` `VUTT_TAG_REGISTRY`-st.
  - `POST /works/text-proposals/source` `{code, work_id, page}` → `read_source` (rate-limit IP järgi, nagu `parts_proposal_submit`).
  - `POST /works/text-proposals/submit` `{code, work_id, pages, note}` → `submit`. Keha voogloetakse ja lõigatakse `MAX_BODY_BYTES` juures (413). Lubatud võtmed range hulk.
  - superadmin: `POST /text-proposals/handoff` `{work_id?}`; `GET /text-proposals` (kõik pakid); `GET /works/{work_id}/text-proposals`; `GET /works/{work_id}/text-proposals/{id}/pages/{stem}` → `review_page`; `POST …/{id}/pages/{stem}/reject`; `POST …/{id}/reject`; `POST …/{id}/accept` → `start` (409 käib); `GET /works/{work_id}/text-proposals/job` → `get_status`.
  - `ProposalError` → 409 (`stale_page`, `handoff_used_up`) või 400 (muud), `detail` = kood.

- [ ] **Step 1: Kirjuta testid** (FastAPI TestClient nagu olemasolevates router-testides):
  - `test_source_ilma_koodita_401_voi_400_ei_lekita`: vastuses pole teksti.
  - `test_superadmin_otspunktid_admin_403`.
  - `test_submit_413`.
  - `test_submit_tundmatu_voti_400`.
  - `test_markup_tags`.
  - `test_revoke_kutsutakse_rollimuutusel`: `_revoke_agent_handoffs` kutsub uut moodulit.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Teosta. Sünkroonsed `def` routed (blokeeriv I/O, ADR 0002), v.a voogloetav `submit` (`async` + `run_in_threadpool`). Kirjuta ADR 0058 täiendus spekist („ADR“ lõik) ja CLAUDE.md rida.
- [ ] **Step 4:** `.venv/bin/pytest tests/ -q`. Oodatud tulemus: kõik PASS.
- [ ] **Step 5:** commit `feat(proposals): otspunktid, tägide loend, ADR 0058 täiendus (#641)`.

### Task 8: MCP tööriistad

**Files:**
- Create: `mcp/vutt_mcp/page_text.py`
- Modify: `mcp/vutt_mcp/server.py` (registreerimine, `submit_work_parts_proposal` kõrval), `mcp/vutt_mcp/instructions.py` (üks rida töökäigus), `mcp/README.md`
- Test: `mcp/tests/test_page_text.py`

**Interfaces:**
- Consumes: Task 7 otspunktid; `client.api_post`, `client.api_post_once`, `client.api_get`.
- Produces:
  - `get_page_source(handoff_code: str, work_id: str, page: int) -> str`: JSON `{work_id, page, stem, text_hash, status, text}` + `tags` (vahemällu protsessi kohta, `GET /markup/tags`).
  - `submit_page_text_proposal(handoff_code: str, work_id: str, pages: list[dict], note: str) -> str`.

- [ ] **Step 1: Kirjuta testid** (mock-klient nagu `test_client.py`):
  - `test_source_tagastab_toore_teksti`: reavahetused ja tägid on alles.
  - `test_submit_kasutab_post_once`.
  - `test_kliendipoolne_valideerimine`: `stem`/`text_hash` puudub, `edits` tühi, üle 200 lehe → `VuttError` enne võrku.
  - `test_serveri_viga_jouab_agendini`: 400 `old_not_found:t-001:0` → `VuttError`, mille sõnumis on kood ja juhis „loe leht uuesti get_page_source'iga“.
- [ ] **Step 2:** `cd mcp && PYTHONPATH=$PWD/.. ../.venv/bin/pytest tests/test_page_text.py -v`. Oodatud tulemus: FAIL.
- [ ] **Step 3: Teosta.** Docstring (eesti keeles, `submit_work_parts_proposal` stiilis) peab ütlema:
  - `get_pages` EI kõlba aluseks, sest see on otsingutekst;
  - `old` peab olema tekstis täpselt üks kord, vajadusel pikem kontekst;
  - `ann`-tokeneid ei tohi `old`/`new`-is olla;
  - lubatud tägid on `tags` loendis, uusi ei leiutata;
  - kood tuleb superadminilt (Review → „Agendi ettepanekud“ või Workspace'i paneel);
  - kontrolli muudatus pildi järgi (`get_page_image`) ja kirjuta see `note`-i.
- [ ] **Step 4:** PASS + `mcp/tests` kõik.
- [ ] **Step 5:** commit `feat(mcp): get_page_source ja submit_page_text_proposal (#641)`.

### Task 9: Frontendi teenused ja diff-util

**Files:**
- Create: `src/services/textProposalService.ts`, `src/utils/textDiff.ts`
- Modify: `src/services/pageService.ts` (`savePage` valikuline `proposal` argument → payload `proposal`), `src/types.ts` (tüübid)
- Test: `src/utils/__tests__/textDiff.test.ts`, `src/services/__tests__/textProposalService.test.ts`

**Interfaces:**
- Produces:
  - `type ProposalPageState = 'pending' | 'accepted' | 'rejected' | 'stale' | 'superseded'`.
  - `interface TextProposalPack { proposal_id: string; work_id: string; note: string; username: string; created_at: number; counts: Record<'pending'|'stale'|'accepted'|'rejected', number>; pages: { stem: string; page_no: number; state: ProposalPageState }[] }`.
  - `interface ProposalPageReview { state: ProposalPageState; page: PageFields; proposed_now: string | null; base_text: string; proposed_text: string; note: string; pack_note: string }`.
  - `listPacks(token, workId?) → Promise<TextProposalPack[]>`, `getReviewPage(token, workId, id, stem)`, `rejectPage`, `rejectPack`, `acceptPack(token, workId, id) → Promise<void>` (409 → `Error('job_running')`), `getJobStatus(token, workId)`, `issueHandoff(token, workId?)`.
  - `savePage(..., base, proposal?: { id: string; stem: string })`.
  - `diffWords(a: string, b: string): { op: 'eq' | 'del' | 'ins'; text: string }[]`: tokenid = `/\s+|<[^>]+>|[^\s<]+/g`, LCS. Üle 4000 tokeni → rea tasemel LCS (jõudluse kaitse).

- [ ] **Step 1: Kirjuta testid.**
  - `diffWords("a <i>b</i> c", "a b c")` sisaldab `del` `<i>` ja `</i>`.
  - Identne → ainult `eq`.
  - `ins`/`del` järjestus säilitab `b`: `eq`+`ins` tükkide liit == `b` ja `eq`+`del` liit == `a`.
  - Teenuse test: `acceptPack` 409 → `job_running`.
- [ ] **Step 2:** `npm test -- textDiff textProposalService`. Oodatud tulemus: FAIL.
- [ ] **Step 3:** Teosta. `fetchWithTimeout` + `getAuthHeaders`, `FILE_API_URL` nagu `pageService.ts`.
- [ ] **Step 4:** PASS + `npm run typecheck`.
- [ ] **Step 5:** commit `feat(ui): ettepanekute teenus ja sõnadiff (#641)`.

### Task 10: Diffi esiletõstmine redaktoris

**Files:**
- Create: `src/components/editor/proposalDiffExtension.ts`
- Modify: `src/components/editor/VuttTheme.ts` (klassid `vutt-prop-ins`, `vutt-prop-del`)
- Test: `src/components/editor/__tests__/proposalDiffExtension.test.ts`

**Interfaces:**
- Consumes: `diffWords` (Task 9).
- Produces:
  - `setProposalBase: StateEffectType<string | null>` (base tekst või `null` = välja);
  - `proposalDiffExtension(): Extension`: `StateField` hoiab base'i. Dekoratsioonid arvutatakse dokumendi ja base'i vahel (debounce ei ole vaja, sest leht on väike). `ins` = `Decoration.mark({class: 'vutt-prop-ins'})`, `del` = `Decoration.widget` (läbikriipsutatud kustutatud tekst, `side: -1`), mis on lugemiseks ega ole redigeeritav.
- Kitsendused: mark, mitte replace (CLAUDE.md `VuttMarkupExtension` reeglid). `RangeSetBuilder` sorteeritult `from ASC`, sama `from` korral `to ASC`. Widget ei tohi kattuda `<pb/>`/`<fn>` replace-dekoratsioonidega. Kui kattuks, jäta `del`-widget sellel kohal ära (`ins`/`eq` jäävad).

- [ ] **Step 1: Kirjuta testid** (`node`-keskkond, EditorState ilma vaateta):
  - base `"a vana b"`, dokument `"a uus b"` → üks `ins` `uus` peal ja üks `del`-widget `vana`-ga;
  - `setProposalBase.of(null)` → dekoratsioone pole;
  - dokumendi muutmine pärast laadimist arvutab diffi uuesti.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Teosta.
- [ ] **Step 4:** PASS + `npm run typecheck`.
- [ ] **Step 5:** commit `feat(editor): ettepaneku diffi esiletõstmine (#641)`.

### Task 11: Workspace'i ülevaatus (lehe kaupa)

**Files:**
- Create: `src/components/editor/useTextProposal.ts`, `src/components/editor/TextProposalPanel.tsx`
- Modify: `src/components/TextEditor.tsx` (hook + paneel `ReocrPanel` banner'i kõrval; `proposalDiffExtension` CodeMirrori laienduste hulka), `src/components/editor/useEditorSave.ts` (`runSave` saab valikulise `proposal`-i ja edastab selle `onSave`-ile), `src/pages/Workspace.tsx` (`handleSave` edastab `proposal`-i `savePage`-ile; navigeerimine lehele tüve järgi), `src/locales/{et,en}/workspace.json` (`proposal.*` võtmed)
- Test: `src/components/editor/__tests__/useTextProposal.test.tsx` (`/** @vitest-environment jsdom */`)

**Interfaces:**
- Consumes: Task 9 teenused, Task 10 laiendus; `useEditorState` (`hasUnsavedChanges`, `setSavedState`, `setIsDirty`, `setStatus`, `setComments`, `setTextAnnotations`, `setPageTags`); `pageLoadKey`.
- Produces:
  - `useTextProposal({ page, viewRef, enabled: boolean /* superadmin */, editorState, workId, token }) → { review: ProposalPageReview | null, pack: TextProposalPack | null, loadIntoEditor(): Promise<void>, pendingNotLoaded: boolean, rejectPage(), next(): string | null, prev(): string | null, activeRef: { id, stem } | null }`.
  - `TextProposalPanel` propsid: `review, pack, pendingNotLoaded, onLoad, onReject, onRejectPack, onAcceptPack, onSaveAndNext, onPrev, onNext, job: {state, done, total} | null`.

Käitumine:
- Leht avaneb ja tal on `pending` ettepanek → `getReviewPage`. Vastus rakendub **ainult siis**, kui `pageLoadKey` on sama ja `!hasUnsavedChanges`. Muul juhul `pendingNotLoaded = true` ja paneel näitab nuppu „Lae ettepanek“, mis käib läbi `useUnsavedChangesGuard`-i.
- Rakendamine: `setSavedState(review.page)` + JSON-väljade setterid samast vastusest. Seejärel `view.dispatch({changes: kogu dok → proposed_now, effects: setProposalBase.of(review.page.text_content)})` ilma `userEvent`-ita (nagu `applyReOcr`) ja `setIsDirty(true)`.
- `stale` → redaktorisse ei laadita midagi. Paneel näitab `diffWords(base_text, proposed_text)` lugemiseks. Salvestus sel lehel kannab samuti `activeRef`-i.
- Lehepööre tühjendab `setProposalBase.of(null)` ja hook'i oleku. Tokeni/sessiooni muutus ei laadi uuesti (ADR 0060: efekti dep on ainult `pageLoadKey`).

- [ ] **Step 1: Kirjuta testid.**
  - `rakendub_ainult_puhtale_lehele`: `hasUnsavedChanges = true` → dokument ei muutu, `pendingNotLoaded`.
  - `hilinenud_vastus_teisel_lehel_ignoreeritakse`.
  - `savedState_ja_tekst_samast_vastusest`: `savedState.text === review.page.text_content`, dok == `proposed_now`.
  - `stale_ei_laadi`.
  - `salvestus_kannab_proposal_viidet`: `onSave` mock saab `{id, stem}`.
  - `sanitiseerija_ei_muuda`: laaditud tekst == `proposed_now` ka pärast ühte tsüklit (`vuttAutoSanitizer` ei käivitu, sest userEvent'i pole).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Teosta.
- [ ] **Step 4:** PASS + `npm run typecheck && npm test && npm run lint:ci`.
- [ ] **Step 5:** commit `feat(workspace): ettepaneku ülevaatus redaktoris (#641)`.

### Task 12: Navigeerimine ja paki kinnitus Workspace'is

**Files:**
- Modify: `src/components/editor/useTextProposal.ts`, `TextProposalPanel.tsx`, `src/pages/Workspace.tsx`, `src/locales/{et,en}/workspace.json`
- Test: `src/components/editor/__tests__/useTextProposal.test.tsx`

**Interfaces:**
- Consumes: Task 11; `acceptPack`, `getJobStatus`, `rejectPack`; `UnsavedChangesDialog` / `useUnsavedChangesGuard`; olemasolev `handleSaveWithDrafts` (tagastab `Promise<boolean>`).
- Produces: hook'i lisad `acceptPack(): Promise<void>`, `saveAndNext(): Promise<void>`, `job`.

Käitumine:
- `next`/`prev`: paki `pending` ∪ `stale` lehed teose järjekorras, navigeerimine `page_no` kaudu (Workspace'i olemasolev lehevahetus).
- „Salvesta ja järgmine“: `await handleSaveWithDrafts()`. Kui `true` → `next()`.
- „Kinnita kogu pakk“:
  - kui `hasUnsavedChanges`, avab dialoogi. „Salvesta“ → `await handleSaveWithDrafts()`, edasi ainult `true` korral. „Loobu“ → muudatused visatakse, edasi. Tühista → stopp.
  - Siis `acceptPack` → pollib `getJobStatus` iga 1,5 s kuni `done | error`. Seejärel laeb paki uuesti ja näitab kokkuvõtet `{accepted, stale, skipped}`.
  - Aktiivne leht laaditakse uuesti tavalise lehelaadimisega (`pageLoadKey` sama, seega sunnitud värskendus, nagu pärast taastet).

- [ ] **Step 1: Kirjuta testid.**
  - `kinnitaPakk_salvestab_enne_ja_peatub_veal`: `handleSaveWithDrafts` → `false` → `acceptPack` teenust ei kutsuta.
  - `kinnitaPakk_tuhistus_ei_kaivita`.
  - `kinnitaPakk_puhas_leht_kohe`.
  - `next_hupab_ule_otsustatud_lehtede`.
  - `job_running_409_naitab_teadet`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Teosta.
- [ ] **Step 4:** PASS + väravad.
- [ ] **Step 5:** commit `feat(workspace): paki kinnitus ja ettepanekute vahel liikumine (#641)`.

### Task 13: Review lehe jaotis ja koodi andmine

**Files:**
- Create: `src/pages/review/AgentProposalsSection.tsx`
- Modify: `src/pages/Review.tsx` (jaotis ainult `isAtLeast(role, 'superadmin')`), `src/components/editor/TextProposalPanel.tsx` (koodi nupp teosele), `src/locales/{et,en}/review.json`, `workspace.json`
- Test: `src/pages/review/__tests__/AgentProposalsSection.test.tsx` (jsdom)

**Interfaces:**
- Consumes: `listPacks`, `issueHandoff` (Task 9).
- Produces: komponent `AgentProposalsSection({ token })`.

Käitumine:
- Loend `listPacks()`: teos (pealkiri `work_id` järgi Meilist või vastusest), märkus, `counts`, vanus.
- Klikk → `/work/{work_id}/{esimese ootel/aegunud lehe page_no}`.
- Nupp „Kood agendile (kõik teosed)“ → `issueHandoff()` → kood kopeerimiseks + aegumisaeg (`PartsTab` muster).
- Workspace'i paneelis on nupp „Kood agendile (see teos)“ ka siis, kui ettepanekut pole (superadmin).

- [ ] **Step 1: Kirjuta testid.**
  - Mitte-superadmin → jaotist ei renderdata.
  - Loendi rida viib õigele lehele.
  - Koodi nupp näitab koodi.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Teosta.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run lint:ci && npm run build`.
- [ ] **Step 5:** commit `feat(review): agendi ettepanekute loend ja kood (#641)`.

### Task 14: Lõppkontroll tootmisandmetega (käsitsi, kasutajaga)

Ei ole kood. Tehakse pärast merge'i ja deploy'd kasutaja loal (CLAUDE.md: deploy-luba iga PR-i kohta).

- [ ] Backend: `ssh vutt && cd ~/VUTT && ./scripts/server_update.sh --no-cache`. Frontend: `npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/`.
- [ ] `pipx install -e --force mcp/` lokaalselt (MCP mälust: mitte `reinstall`).
- [ ] Testteose ühel lehel:
  - kood → `get_page_source` → üks parandus;
  - Workspace'is diff nähtav, pilt kõrval, Ctrl+S → `git log` näitab `MCP-ettepanek <id>`;
  - teine pakk 3 lehega → „Kinnita kogu pakk“ → üks commit.

---

## Eneseülevaatus (tehtud)

- **Speki kate:**
  - toorlugemine + räsi (T3, T8);
  - asendused + ankrud + märgendus (T1, T3);
  - normaliseerimine esitusel ja `/save` parandus (T2, T3);
  - ümberbaseerimine ühe hetktõmmisena + kontroll pärast liitmist (T4);
  - taaste git'i järgi (T4, T6);
  - lukujärjekord (T3, T5, T6);
  - `/save` viide (T5);
  - pakk ühe commit'iga + ketta taaste (T6);
  - superadmin, kõik näevad kõiki (T7);
  - piiratud teos lubatud, kood nõutud (T3, T7);
  - Workspace laadimine, `hasUnsavedChanges`, hilinenud vastus (T11);
  - pakk + mustand (T12);
  - Review loend (T13);
  - ADR (T7);
  - #577 ühine diff (`textDiff.ts`, `proposalDiffExtension` võtab base'i parameetrina).
- **Speki „ehitaja otsustada“, siin otsustatud:**
  - tägide loend serveri otspunktist (`GET /markup/tags`);
  - diff oma utiliidiga, ilma uue sõltuvuseta (`@codemirror/merge` jäi välja: bundle'i kasv ja mark/replace reeglid);
  - laed spekist.
