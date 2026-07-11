# Lehekülje isikuviited prosopograafias — implementatsiooniplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Võimaldada editoritel märkida lehekülje tägidesse kohalikke `vutt:P` isikuid ja kajastada need prosopograafias rolliga "mentioned".

**Architecture:** Kolm backend muutust (`server/cache.py`, `server/prosopography/ops.py`, `server/main.py`) ja kaks frontend muutust (`AnnotationsTab.tsx`, tõlkefailid). Backend: uus funktsioon `update_page_person_mentions()` kutsutakse `/save` taustal ja `rebuild_indices()` on laiendatud lehekülje isikute kogumisel. `_build_suggestions()` filtreerib `vutt:P` ID-d soovituste alt välja. Frontend: `EntityPicker` saab isiku-toggle ja `vutt:P` tägid renderitakse lingina prosopograafia lehele.

**Tech Stack:** Python 3, FastAPI BackgroundTasks, pytest, React 19, TypeScript

---

## Muudetavad failid

| Fail | Muutus |
|------|--------|
| `server/cache.py` | `_build_suggestions()`: filtreeri vutt:P Meilisearchi facets tulemustest välja |
| `server/prosopography/ops.py` | Lisa `update_page_person_mentions()`, laienda `rebuild_indices()` |
| `server/main.py` | `/save`: lisa background task `update_page_person_mentions` |
| `src/components/editor/AnnotationsTab.tsx` | EntityPicker `showPersonToggle` + `token`; vutt:P page_tags → Link |
| `src/locales/et/workspace.json` | Lisa `"mentioned": "Mainitud"` |
| `src/locales/en/workspace.json` | Lisa `"mentioned": "Mentioned"` |
| `tests/test_backend_smoke.py` | Uuenda olemasolev test, lisa 2 uut testi |

---

### Task 1: `_build_suggestions()` — vutt:P filter

**Files:**
- Modify: `server/cache.py:210-214`
- Modify: `tests/test_backend_smoke.py`

Kontekst: `page_tags_suggest_et/en` Meilisearchi väljad sisaldavad KÕIKI page_tags kirjeid, sh `vutt:P` isikuid (formaadis `"Michael Dau|||vutt:Ptbc4f4"`). Need ei tohi ilmuda teema-soovituste autocompletion-is.

- [ ] **Samm 1: Uuenda olemasolev test — lisa vutt:P kirje fake Meili vastusesse**

Leia `tests/test_backend_smoke.py`-st `fake_meili_response` ja uuenda:

```python
    fake_meili_response = json.dumps({
        "facetDistribution": {
            "page_tags_suggest_et": {
                "Teoloogia|||Q34178": 3,
                "Michael Dau|||vutt:Ptbc4f4": 2,  # ← lisa
            }
        }
    }).encode()
```

Lisa testile uus assert viimase rea järele:

```python
    # vutt:P isikud EI tohi soovitustes olla
    assert "Michael Dau" not in tag_labels, f"Michael Dau ei tohi olla tags-is (vutt:P filter), sain: {tag_labels}"
```

- [ ] **Samm 2: Käivita test — veendu et kukub**

```bash
cd /home/mf/LLM/VUTT && source .venv/bin/activate
pytest tests/test_backend_smoke.py::test_build_suggestions_uses_meili_for_page_tags -v
```

Oodatav: **FAIL** — `AssertionError: Michael Dau ei tohi olla tags-is`

- [ ] **Samm 3: Lisa vutt:P filter `server/cache.py`-s**

Leia rida 213 (`if label:`):

```python
        for entry_str in facet_dist:
            label, _, id_code = entry_str.partition('|||')
            label = label.strip()
            if label:
                add_item(tags, {'label': label, 'id': id_code or None}, 'tags')
```

Asenda:

```python
        for entry_str in facet_dist:
            label, _, id_code = entry_str.partition('|||')
            label = label.strip()
            if label and not id_code.startswith('vutt:P'):
                add_item(tags, {'label': label, 'id': id_code or None}, 'tags')
```

- [ ] **Samm 4: Käivita test — veendu et läbib**

```bash
pytest tests/test_backend_smoke.py::test_build_suggestions_uses_meili_for_page_tags -v
```

Oodatav: **PASS**

- [ ] **Samm 5: Käivita kõik testid**

```bash
pytest tests/ -v
```

Oodatav: kõik **PASS**

- [ ] **Samm 6: Commit**

```bash
git add server/cache.py tests/test_backend_smoke.py
git commit -m "fix: filtreeri vutt:P isikud välja _build_suggestions() soovitustest"
```

---

### Task 2: `update_page_person_mentions()` — uus funktsioon

**Files:**
- Modify: `server/prosopography/ops.py` (pärast `update_person_to_works` funktsiooni, ca rida 823)
- Modify: `tests/test_backend_smoke.py`

Funktsioon loeb antud teose kõik `.json` leheküljefailid, kogub `page_tags` kus `id.startswith("vutt:P")`, ja uuendab ainult `"mentioned"` rolle `person_to_works`-is — ei puutu teiste rollide kirjeid.

- [ ] **Samm 1: Kirjuta test**

Lisa `tests/test_backend_smoke.py` lõppu:

```python
def test_update_page_person_mentions(tmp_path, monkeypatch):
    """
    update_page_person_mentions() loeb teose leheküljefailidest vutt:P tägid
    ja uuendab person_to_works.json 'mentioned' rolliga.
    Olemasolevad 'subject'/'creator' rollid jäävad puutumata.
    """
    import server.prosopography.ops as prosopo_ops

    work_id = "work123"
    work_dir = tmp_path / "teos1"
    work_dir.mkdir()

    # Leht 1: kaks isikut
    (work_dir / "leht1.json").write_text(json.dumps({
        "page_tags": [
            {"id": "vutt:Paaa", "label": "Isik A", "entity_type": "person"},
            {"id": "Q99999", "label": "Mitte-isik", "entity_type": "topic"},
        ]
    }), encoding="utf-8")

    # Leht 2: teine isik
    (work_dir / "leht2.json").write_text(json.dumps({
        "meta_content": {
            "page_tags": [
                {"id": "vutt:Pbbb", "label": "Isik B", "entity_type": "person"},
            ]
        }
    }), encoding="utf-8")

    # _metadata.json peab eksisteerima aga ei loe siin
    (work_dir / "_metadata.json").write_text(json.dumps({"id": work_id}), encoding="utf-8")

    # Eelnevad kirjed: Isik A on juba 'subject' rollis — see peab säilima
    ptw_file = tmp_path / "person_to_works.json"
    ptw_file.write_text(json.dumps({
        "vutt:Paaa": [{"work_id": work_id, "role": "subject"}],
        "vutt:Pccc": [{"work_id": "other_work", "role": "mentioned"}],
    }), encoding="utf-8")

    monkeypatch.setattr(prosopo_ops, "PERSON_TO_WORKS_FILE", str(ptw_file))

    prosopo_ops.update_page_person_mentions(work_id, str(work_dir))

    data = json.loads(ptw_file.read_text(encoding="utf-8"))

    # Isik A: peab olema nii 'subject' (vana) kui 'mentioned' (uus)
    roles_a = {e["role"] for e in data["vutt:Paaa"]}
    assert "subject" in roles_a, f"subject peab säilima: {data['vutt:Paaa']}"
    assert "mentioned" in roles_a, f"mentioned peab lisanduma: {data['vutt:Paaa']}"

    # Isik B: ainult 'mentioned'
    assert "vutt:Pbbb" in data
    assert data["vutt:Pbbb"] == [{"work_id": work_id, "role": "mentioned"}]

    # Q-kood ei tohi olla lisatud
    assert "Q99999" not in data

    # Teise teose kirje peab säilima
    assert data["vutt:Pccc"] == [{"work_id": "other_work", "role": "mentioned"}]
```

- [ ] **Samm 2: Käivita test — veendu et kukub**

```bash
pytest tests/test_backend_smoke.py::test_update_page_person_mentions -v
```

Oodatav: **FAIL** — `AttributeError: module has no attribute 'update_page_person_mentions'`

- [ ] **Samm 3: Implementeeri `update_page_person_mentions` `server/prosopography/ops.py`-s**

Lisa pärast `update_person_to_works` funktsiooni (pärast rida 822, `atomic_write_json(PERSON_TO_WORKS_FILE, data)`):

```python
def update_page_person_mentions(work_id: str, work_dir: str):
    """Uuendab person_to_works 'mentioned' rolle antud teose lehekülje page_tags põhjal."""
    if not work_id:
        return

    person_ids: set[str] = set()
    try:
        for fname in os.listdir(work_dir):
            if not fname.endswith('.json') or fname == '_metadata.json':
                continue
            fpath = os.path.join(work_dir, fname)
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    page = json.load(f)
                source = page.get('meta_content', page)
                for tag in source.get('page_tags', []):
                    if isinstance(tag, dict):
                        pid = tag.get('id') or ''
                        if pid.startswith('vutt:P'):
                            person_ids.add(pid)
            except Exception:
                pass
    except Exception as e:
        print(f"update_page_person_mentions viga: {e}")
        return

    with _works_lock:
        data = _load_person_to_works()
        # Eemalda ainult 'mentioned' viited sellele teosele
        for pid_entries in data.values():
            pid_entries[:] = [
                e for e in pid_entries
                if not (e.get('work_id') == work_id and e.get('role') == 'mentioned')
            ]
        # Lisa uued
        for pid in person_ids:
            if pid not in data:
                data[pid] = []
            data[pid].append({'work_id': work_id, 'role': 'mentioned'})
        atomic_write_json(PERSON_TO_WORKS_FILE, data)
```

- [ ] **Samm 4: Käivita test — veendu et läbib**

```bash
pytest tests/test_backend_smoke.py::test_update_page_person_mentions -v
```

Oodatav: **PASS**

- [ ] **Samm 5: Käivita kõik testid**

```bash
pytest tests/ -v
```

Oodatav: kõik **PASS**

- [ ] **Samm 6: Commit**

```bash
git add server/prosopography/ops.py tests/test_backend_smoke.py
git commit -m "feat: lisa update_page_person_mentions() prosopograafia ops-i"
```

---

### Task 3: `rebuild_indices()` — lehekülje isikute kogumine

**Files:**
- Modify: `server/prosopography/ops.py:856-886` (ptw kogumine töö loop-is)
- Modify: `tests/test_backend_smoke.py`

`rebuild_indices()` loob `ptw` (person_to_works) ainult `_metadata.json` põhjal. Lisame leheküljefailide skänni igale teoste kataloogile, et koondada ka `"mentioned"` rollid.

- [ ] **Samm 1: Kirjuta test**

Lisa `tests/test_backend_smoke.py` lõppu:

```python
def test_rebuild_indices_includes_page_person_mentions(tmp_path, monkeypatch):
    """
    rebuild_indices() peab page_tags vutt:P isikuid lisama person_to_works
    rolliga 'mentioned'.
    """
    import server.prosopography.ops as prosopo_ops

    # Teoste kataloog
    data_dir = tmp_path / "data"
    data_dir.mkdir()

    # Teos1: leht kus on isik vutt:Pxxx
    teos1 = data_dir / "teos1"
    teos1.mkdir()
    (teos1 / "_metadata.json").write_text(json.dumps({
        "id": "workAAA",
        "creators": [],
        "tags": [],
        "publisher": None,
    }), encoding="utf-8")
    (teos1 / "leht1.json").write_text(json.dumps({
        "page_tags": [
            {"id": "vutt:Pxxx", "label": "Test Isik", "entity_type": "person"},
        ]
    }), encoding="utf-8")

    # Prosopograafia kaust (tühi — testis pole isikukaarte vaja)
    prosopo_dir = tmp_path / "prosopography"
    prosopo_dir.mkdir()

    ptw_file = tmp_path / "person_to_works.json"
    index_file = tmp_path / "prosopography_index.json"
    aliases_file = tmp_path / "person_aliases.json"

    monkeypatch.setattr(prosopo_ops, "PERSON_TO_WORKS_FILE", str(ptw_file))
    monkeypatch.setattr(prosopo_ops, "PROSOPOGRAPHY_INDEX_FILE", str(index_file))
    monkeypatch.setattr(prosopo_ops, "PERSON_ALIASES_FILE", str(aliases_file))
    monkeypatch.setattr(prosopo_ops, "PROSOPOGRAPHY_DIR", str(prosopo_dir))

    # BASE_DIR on kõige keerulisem — rebuild_indices loeb selle config-ist
    import server.prosopography.ops as ops_module
    # rebuild_indices kasutab `from ..config import BASE_DIR` funktsiooni sees
    import server.config as config_mod
    monkeypatch.setattr(config_mod, "BASE_DIR", str(data_dir))

    prosopo_ops.rebuild_indices()

    data = json.loads(ptw_file.read_text(encoding="utf-8"))

    assert "vutt:Pxxx" in data, f"vutt:Pxxx peaks olema ptw-s, sain: {list(data.keys())}"
    roles = {e["role"] for e in data["vutt:Pxxx"]}
    assert "mentioned" in roles, f"'mentioned' roll peaks olema: {data['vutt:Pxxx']}"
    assert data["vutt:Pxxx"][0]["work_id"] == "workAAA"
```

- [ ] **Samm 2: Käivita test — veendu et kukub**

```bash
pytest tests/test_backend_smoke.py::test_rebuild_indices_includes_page_person_mentions -v
```

Oodatav: **FAIL** — `AssertionError: vutt:Pxxx peaks olema ptw-s`

- [ ] **Samm 3: Laienda `rebuild_indices()` `server/prosopography/ops.py`-s**

Leia `rebuild_indices()` sees ptw kogumine (rida ~856-886). Pärast publisher töötlemist (rida ~886, `ptw.setdefault(pid, []).append({"work_id": work_id, "role": "publisher"})`), aga enne `# Kirjuta person_to_works` kommentaari, lisa:

```python
            # page_tags isikud ('mentioned' roll)
            try:
                for page_fname in os.listdir(entry.path):
                    if not page_fname.endswith('.json') or page_fname == '_metadata.json':
                        continue
                    page_fpath = os.path.join(entry.path, page_fname)
                    try:
                        with open(page_fpath, 'r', encoding='utf-8') as pf:
                            page_data = json.load(pf)
                        source = page_data.get('meta_content', page_data)
                        for tag in source.get('page_tags', []):
                            if isinstance(tag, dict):
                                pid = tag.get('id') or ''
                                if pid.startswith('vutt:P'):
                                    ptw.setdefault(pid, []).append({'work_id': work_id, 'role': 'mentioned'})
                    except Exception:
                        pass
            except Exception:
                pass
```

Täpselt kus lisada (kontekst ümber):

```python
            pub = meta.get("publisher")
            if pub and isinstance(pub, dict):
                pid = pub.get("id") or ""
                if pid.startswith("vutt:P"):
                    ptw.setdefault(pid, []).append({"work_id": work_id, "role": "publisher"})

            # page_tags isikud ('mentioned' roll)   ← LISA SIIA
            try:
                for page_fname in os.listdir(entry.path):
                    ...

    # Kirjuta person_to_works
    with _works_lock:
        atomic_write_json(PERSON_TO_WORKS_FILE, ptw)
```

- [ ] **Samm 4: Käivita test — veendu et läbib**

```bash
pytest tests/test_backend_smoke.py::test_rebuild_indices_includes_page_person_mentions -v
```

Oodatav: **PASS**

- [ ] **Samm 5: Käivita kõik testid**

```bash
pytest tests/ -v
```

Oodatav: kõik **PASS**

- [ ] **Samm 6: Commit**

```bash
git add server/prosopography/ops.py tests/test_backend_smoke.py
git commit -m "feat: rebuild_indices kogub page_tags isikud 'mentioned' rolliga"
```

---

### Task 4: `/save` endpoint — background task

**Files:**
- Modify: `server/main.py:1` (import) ja `server/main.py:642-644` (/save handler)
- Modify: `tests/test_backend_smoke.py`

`/save` peab pärast lehekülje kirjutamist käivitama `update_page_person_mentions` taustal. `work_id` saadakse `meta_content.work_id` väljalt, `work_dir` = `os.path.join(BASE_DIR, catalog)`.

- [ ] **Samm 1: Kirjuta test**

Lisa `tests/test_backend_smoke.py` lõppu:

```python
def test_save_triggers_page_person_mentions_update(client, login, monkeypatch, tmp_path):
    """
    POST /save peab käivitama update_page_person_mentions background task-i
    kui meta_content sisaldab work_id välja.
    """
    import server.main as main_mod

    # Mock sõltuvused mis vajavad git/filesystem/meilisearch
    monkeypatch.setattr(main_mod, "save_with_git", lambda *a, **kw: {"commit_hash": "abc12345"})
    monkeypatch.setattr(main_mod, "sync_work_to_meilisearch_async", lambda *a: None)
    monkeypatch.setattr(main_mod, "BASE_DIR", str(tmp_path))

    calls = []
    # update_page_person_mentions imporditakse main.py-sse Task 4 implementatsioonis
    monkeypatch.setattr(main_mod, "update_page_person_mentions", lambda wid, wdir: calls.append((wid, wdir)))

    token = login("editor", "editorpass")
    response = client.post("/save", headers={"Authorization": f"Bearer {token}"}, json={
        "original_path": "teos1",
        "file_name": "leht1.txt",
        "text_content": "uus tekst",
        "meta_content": {"work_id": "workAAA", "page_tags": []},
    })

    assert response.status_code == 200
    assert len(calls) == 1, f"update_page_person_mentions peaks olema kutsutud 1 kord, sain: {calls}"
    assert calls[0][0] == "workAAA"
    assert "teos1" in calls[0][1]
```

- [ ] **Samm 3: Käivita test — veendu et kukub**

```bash
cd /home/mf/LLM/VUTT && source .venv/bin/activate
pytest tests/test_backend_smoke.py::test_save_triggers_page_person_mentions_update -v
```

Oodatav: **FAIL** — `AttributeError: module 'server.main' has no attribute 'update_page_person_mentions'`

- [ ] **Samm 4: Lisa import `server/main.py`-s**

Leia rida 46 kus prosopography router imporditakse:

```python
from .prosopography.router import router as prosopography_router
```

Selle järele lisa:

```python
from .prosopography.ops import update_page_person_mentions
```

- [ ] **Samm 5: Lisa background task `/save` endpointis**

Leia `/save` handler (rida ~642-644):

```python
    git_result = save_with_git(txt_path, text, user['username'], additional_files=additional if additional else None)
    background_tasks.add_task(sync_work_to_meilisearch_async, catalog)
    return {"status": "success", "commit_hash": git_result.get("commit_hash", "")[:8]}
```

Asenda:

```python
    git_result = save_with_git(txt_path, text, user['username'], additional_files=additional if additional else None)
    background_tasks.add_task(sync_work_to_meilisearch_async, catalog)
    work_id = (data.get('meta_content') or {}).get('work_id')
    if work_id:
        work_dir = os.path.join(BASE_DIR, catalog)
        background_tasks.add_task(update_page_person_mentions, work_id, work_dir)
    return {"status": "success", "commit_hash": git_result.get("commit_hash", "")[:8]}
```

- [ ] **Samm 6: Käivita test — veendu et läbib**

```bash
pytest tests/test_backend_smoke.py::test_save_triggers_page_person_mentions_update -v
```

Oodatav: **PASS**

- [ ] **Samm 7: Käivita kõik testid**

```bash
pytest tests/ -v
```

Oodatav: kõik **PASS**

- [ ] **Samm 8: Commit**

```bash
git add server/main.py tests/test_backend_smoke.py
git commit -m "feat: /save käivitab update_page_person_mentions background task-ina"
```

---

### Task 5: Frontend — EntityPicker toggle + vutt:P page_tags kuvamine

**Files:**
- Modify: `src/components/editor/AnnotationsTab.tsx:533-592`

Kaks muutust samas failis:
1. `page_tags` kuvamisel: `vutt:P` ID-ga tägid → Link prosopograafia lehele (User ikoon, sinine pill)
2. `EntityPicker`-ile: `showPersonToggle={true}` ja `token={authToken}`

Frontend testid puuduvad — verifikatsioon käsitsi brauseris.

- [ ] **Samm 1: Uuenda `page_tags` kuvamist**

Leia `AnnotationsTab.tsx`-s rida ~533 kus `page_tags.map` algab:

```tsx
          {page_tags.map((tag, idx) => {
            const label = getLabel(tag, lang);
            const tagId = typeof tag !== 'string' ? (tag as any).id : null;

            return (
              <span key={idx} className="inline-flex items-center rounded-full bg-primary-50 border border-primary-100 text-sm text-primary-800 group overflow-hidden">
```

Asenda terve `{page_tags.map(...)}` blokk:

```tsx
          {page_tags.map((tag, idx) => {
            const label = getLabel(tag, lang);
            const tagId = typeof tag !== 'string' ? (tag as any).id : null;
            const isPersonTag = tagId?.startsWith('vutt:P');

            if (isPersonTag) {
              return (
                <span key={idx} className="inline-flex items-center rounded-full bg-primary-50 border border-primary-200 text-sm text-primary-700 overflow-hidden">
                  <Link
                    to={`/persons/${tagId}`}
                    className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 hover:text-primary-600 transition-colors"
                    title={t('workCard.viewPerson', 'Vaata isiku lehte')}
                  >
                    <User size={12} className="opacity-60" />
                    {label}
                  </Link>
                  {!readOnly && (
                    <button
                      onClick={() => removeTag(label)}
                      className="pr-2 pl-1 py-1 text-primary-400 hover:text-red-500 border-l border-primary-100"
                    >
                      <X size={14} />
                    </button>
                  )}
                </span>
              );
            }

            return (
              <span key={idx} className="inline-flex items-center rounded-full bg-primary-50 border border-primary-100 text-sm text-primary-800 group overflow-hidden">
                <button
                  onClick={() => tagId
                    ? navigate(`/search?pageTags=${encodeURIComponent(tagId)}`, { state: { pageTagsLabels: { [tagId]: label } } })
                    : navigate(`/search?q=${encodeURIComponent(label)}&scope=annotation`)}
                  className="pl-2.5 pr-1.5 py-1 hover:text-primary-600 flex items-center gap-1"
                  title="Otsi seda märksõna kogu korpusest"
                >
                  {label}
                  <Search size={12} className="opacity-0 group-hover:opacity-50" />
                </button>

                {getEntityUrl(tagId, typeof tag !== 'string' ? (tag as any).source : undefined) && (
                  <a
                    href={getEntityUrl(tagId, typeof tag !== 'string' ? (tag as any).source : undefined)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-1.5 py-1 text-primary-400 hover:text-blue-600 border-l border-primary-100 transition-colors"
                    title={tagId || ''}
                  >
                    <ExternalLink size={10} />
                  </a>
                )}

                {!readOnly && (
                  <button
                    onClick={() => removeTag(label)}
                    className={`pr-2 pl-1 py-1 text-primary-400 hover:text-red-500 ${tagId ? 'border-l border-primary-100' : ''}`}
                  >
                    <X size={14} />
                  </button>
                )}
              </span>
            );
          })}
```

- [ ] **Samm 2: Uuenda `EntityPicker` propsid**

Leia EntityPicker kasutus rida ~576:

```tsx
            <EntityPicker
              type="topic"
              value={null}
              onChange={(val) => {
```

Asenda:

```tsx
            <EntityPicker
              type="topic"
              showPersonToggle={true}
              token={authToken}
              value={null}
              onChange={(val) => {
```

- [ ] **Samm 3: Veendu et `User` ikoon on imporditud**

Leia faili algusest importide rida kus `User` on:

```bash
grep -n "User" /home/mf/LLM/VUTT/src/components/editor/AnnotationsTab.tsx | head -5
```

Kui `User` pole imporditud `lucide-react`-ist, lisa see impordilisti. Kui on juba olemas (töös-tasandi person tagide renderdamisel kasutatakse), pole vaja lisada.

- [ ] **Samm 4: Builda frontend**

```bash
cd /home/mf/LLM/VUTT && npm run build 2>&1 | tail -20
```

Oodatav: **build successful** ilma TypeScript vigadeta

- [ ] **Samm 5: Commit**

```bash
git add src/components/editor/AnnotationsTab.tsx
git commit -m "feat: page_tags vutt:P tägid lingina prosopograafiale, EntityPicker isiku-toggle"
```

---

### Task 6: Tõlked — "mentioned" roll

**Files:**
- Modify: `src/locales/et/workspace.json:144-154`
- Modify: `src/locales/en/workspace.json:144-154`

`PersonDetailPage` kasutab `t('workspace:metadata.roles.mentioned', { defaultValue: 'mentioned' })` — tõlge ilmub automaatselt rollide filtris ja teose kaartidel.

- [ ] **Samm 1: Lisa eesti tõlge**

Leia `src/locales/et/workspace.json`-s `"roles"` sektsioon:

```json
    "roles": {
      "praeses": "Eesistuja",
      ...
      "publisher": "Trükkal"
    },
```

Lisa `"publisher"` järele:

```json
    "roles": {
      "praeses": "Eesistuja",
      "respondens": "Respondens",
      "auctor": "Autor",
      "gratulator": "Õnnitleja",
      "dedicator": "Pühendaja",
      "editor": "Toimetaja",
      "aui": "Eessõna/järelsõna autor",
      "subject": "Tema kohta",
      "publisher": "Trükkal",
      "mentioned": "Mainitud"
    },
```

- [ ] **Samm 2: Lisa inglise tõlge**

Leia `src/locales/en/workspace.json`-s sama sektsioon ja lisa:

```json
    "roles": {
      "praeses": "Praeses",
      "respondens": "Respondent",
      "auctor": "Author",
      "gratulator": "Gratulator",
      "dedicator": "Dedicator",
      "editor": "Editor",
      "aui": "Author of preface/afterword",
      "subject": "Subject of",
      "publisher": "Publisher",
      "mentioned": "Mentioned"
    },
```

- [ ] **Samm 3: Builda frontend**

```bash
cd /home/mf/LLM/VUTT && npm run build 2>&1 | tail -10
```

Oodatav: **build successful**

- [ ] **Samm 4: Commit**

```bash
git add src/locales/et/workspace.json src/locales/en/workspace.json
git commit -m "feat: lisa 'mentioned' rolli tõlge (et: Mainitud)"
```

---

## Testimine pärast deployd

```bash
# Serveril:
ssh vutt
cd ~/VUTT && git pull
./scripts/server_update.sh

# Käsitsi kontroll:
# 1. Ava teos, mine Annotatsioonid tab-ile
# 2. Lisa leheküljele isiku tag (vutt:P isik) EntityPicker isiku-toggle kaudu
# 3. Salvesta
# 4. Kontrolli: cat ~/VUTT/data/state/person_to_works.json | python3 -m json.tool | grep -A5 "vutt:P<id>"
#    → peaks olema {"work_id": "...", "role": "mentioned"}
# 5. Ava PersonDetailPage → isiku juures peaks kuvatama teos rolliga "Mainitud"
# 6. Eemalda tag, salvesta → kontrolli et "mentioned" kirje eemaldub
# 7. Kontrolli et Michael Dau (vutt:P) ei ilmu topics soovituste autocompletion-is
```
