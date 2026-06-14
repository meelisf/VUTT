# Arhiivide register — admin haldus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin saab arhiive lisada/muuta/kustutada Maintenance lehelt; MetadataModalis asendab `<select>` otsitav ArchiveSelect komponent "+" nupuga (admin lisab inline, editor saadab teavituse adminidele).

**Architecture:** Uued `POST/PUT/DELETE /config/archives` endpointid (admin only) + `recipient_mode: "admins"` teavituste endpointis (editor flow). Frontend: uus `ArchiveSelect` komponent (combobox + "+" nupp), kasutab MetadataModalis ja UploadMetaFormis. Maintenance lehele uus "Arhiivide register" sektsioon.

**Tech Stack:** Python 3.9 FastAPI (server/main.py), React 19 + TypeScript, Tailwind, pytest

---

## Fail-struktuur

| Fail | Muutus |
|------|--------|
| `server/main.py` | Lisa `ARCHIVES_FILE` import, `_find_works_with_archive()` helper, POST/PUT/DELETE endpointid, `recipient_mode: "admins"` teavitustes |
| `tests/conftest.py` | Lisa `archives_file` fixture + monkeypatch |
| `tests/test_backend_smoke.py` | Lisa arhiivi CRUD testid |
| `src/components/ArchiveSelect.tsx` | **Uus** — combobox + admin inline form + editor notify modal |
| `src/components/MetadataModal.tsx` | Asenda `<select>` → `<ArchiveSelect>` (koos `onArchiveAdded`) |
| `src/components/UploadMetaForm.tsx` | Asenda `<select>` → `<ArchiveSelect>` (koos `onArchiveAdded`) |
| `src/pages/admin/Maintenance.tsx` | Lisa "Arhiivide register" sektsioon |
| `src/locales/et/admin.json` | Lisa `archives` võtmed |
| `src/locales/en/admin.json` | Lisa `archives` võtmed |

---

## Task 1: Backend CRUD endpointid + testide infrastruktuur

**Files:**
- Modify: `server/main.py`
- Modify: `tests/conftest.py`
- Modify: `tests/test_backend_smoke.py`

- [ ] **Samm 1: Lisa `ARCHIVES_FILE` import + `_find_works_with_archive` → `server/main.py`**

Rida 14 (olemasolev import):
```python
# ENNE:
from .config import PORT, ALLOWED_ORIGINS, BASE_DIR, UPLOAD_ENABLED, UPLOADS_DIR, COLLECTIONS_FILE, USER_SETTINGS_DIR, NOTIFICATIONS_DIR, get_logger
# PÄRAST:
from .config import PORT, ALLOWED_ORIGINS, BASE_DIR, UPLOAD_ENABLED, UPLOADS_DIR, COLLECTIONS_FILE, USER_SETTINGS_DIR, NOTIFICATIONS_DIR, get_logger, ARCHIVES_FILE
```

Lisa `_find_works_with_collection` funktsiooni järele (rida ~1598) uus helper:

```python
def _find_works_with_archive(archive_id: str):
    """Leiab kõik teoste _metadata.json failid mis sisaldavad antud arhiivi ID-d."""
    results = []
    if not os.path.isdir(BASE_DIR):
        return results
    for folder in os.listdir(BASE_DIR):
        meta_path = os.path.join(BASE_DIR, folder, '_metadata.json')
        if not os.path.exists(meta_path):
            continue
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
            refs = meta.get('archive_refs') or []
            if any(isinstance(ref, dict) and ref.get('archive_id') == archive_id for ref in refs):
                results.append((meta_path, meta))
        except Exception:
            continue
    return results
```

- [ ] **Samm 2: Lisa `POST/PUT/DELETE /config/archives` endpointid → `server/main.py`**

Lisa `GET /config/archives` endpointi (rida ~1427) järele:

```python
@app.post("/config/archives")
async def create_archive(request: Request, user=Depends(require_role("admin"))):
    body = await get_json_data(request)
    archive_id = str(body.get("id") or "").strip()
    name = str(body.get("name") or "").strip()
    url = str(body.get("url") or "").strip()
    if not archive_id or not name:
        raise HTTPException(status_code=400, detail="Lühend ja nimi on kohustuslikud")
    archives = {}
    if os.path.exists(ARCHIVES_FILE):
        with open(ARCHIVES_FILE, 'r', encoding='utf-8') as f:
            archives = json.load(f)
    if archive_id in archives:
        raise HTTPException(status_code=409, detail=f"Arhiiv tähisega '{archive_id}' on juba olemas")
    entry: dict = {"name": name}
    if url:
        entry["url"] = url
    archives[archive_id] = entry
    atomic_write_json(ARCHIVES_FILE, archives)
    invalidate_cache()
    return {"status": "success", "id": archive_id, "archive": entry}

@app.put("/config/archives/{archive_id}")
async def update_archive(archive_id: str, request: Request, user=Depends(require_role("admin"))):
    body = await get_json_data(request)
    name = str(body.get("name") or "").strip()
    url = str(body.get("url") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nimi on kohustuslik")
    archives = {}
    if os.path.exists(ARCHIVES_FILE):
        with open(ARCHIVES_FILE, 'r', encoding='utf-8') as f:
            archives = json.load(f)
    if archive_id not in archives:
        raise HTTPException(status_code=404, detail=f"Arhiivi '{archive_id}' ei leitud")
    entry: dict = {"name": name}
    if url:
        entry["url"] = url
    archives[archive_id] = entry
    atomic_write_json(ARCHIVES_FILE, archives)
    invalidate_cache()
    return {"status": "success", "id": archive_id, "archive": entry}

@app.delete("/config/archives/{archive_id}")
async def delete_archive(archive_id: str, force: bool = False, user=Depends(require_role("admin"))):
    archives = {}
    if os.path.exists(ARCHIVES_FILE):
        with open(ARCHIVES_FILE, 'r', encoding='utf-8') as f:
            archives = json.load(f)
    if archive_id not in archives:
        raise HTTPException(status_code=404, detail=f"Arhiivi '{archive_id}' ei leitud")
    if not force:
        in_use = _find_works_with_archive(archive_id)
        if in_use:
            work_titles = [meta.get('title', 'Pealkirjata') for _, meta in in_use[:3]]
            extra = f" ja {len(in_use) - 3} rohkem" if len(in_use) > 3 else ""
            raise HTTPException(
                status_code=409,
                detail=f"Arhiiv '{archive_id}' on kasutusel {len(in_use)} teoses: {', '.join(work_titles)}{extra}",
            )
    del archives[archive_id]
    atomic_write_json(ARCHIVES_FILE, archives)
    invalidate_cache()
    return {"status": "success"}
```

- [ ] **Samm 3: Lisa `recipient_mode: "admins"` → `server/main.py` `send_notification`**

Leia `elif recipient_mode == "multiple":` plokk (rida ~962). Lisa selle ette:

```python
elif recipient_mode == "admins":
    recipients = sorted([
        account.get("username")
        for account in get_all_users()
        if account.get("role") == "admin" and account.get("username")
    ])
    notification_type = "review_request"
```

- [ ] **Samm 4: Kirjuta katkevad testid → `tests/test_backend_smoke.py`**

Lisa faili lõppu:

```python
# ---------------------------------------------------------------------------
# Arhiivide register CRUD
# ---------------------------------------------------------------------------

def test_create_archive_writes_file(client, login, backend_env):
    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.post(
        "/config/archives",
        headers=headers,
        json={"id": "EKM", "name": "Eesti Kirjandusmuuseum", "url": "https://www.kirmus.ee"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["id"] == "EKM"
    archives = json.loads(backend_env["archives_file"].read_text(encoding="utf-8"))
    assert archives["EKM"]["name"] == "Eesti Kirjandusmuuseum"
    assert archives["EKM"]["url"] == "https://www.kirmus.ee"


def test_create_archive_duplicate_returns_409(client, login, backend_env):
    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.post(
        "/config/archives",
        headers=headers,
        json={"id": "RA", "name": "Teine RA"},
    )

    assert response.status_code == 409
    assert "RA" in response.json()["detail"]


def test_update_archive_writes_file(client, login, backend_env):
    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.put(
        "/config/archives/RA",
        headers=headers,
        json={"name": "Uus nimi", "url": "https://uus.ee"},
    )

    assert response.status_code == 200
    archives = json.loads(backend_env["archives_file"].read_text(encoding="utf-8"))
    assert archives["RA"]["name"] == "Uus nimi"
    assert archives["RA"]["url"] == "https://uus.ee"


def test_update_archive_not_found_returns_404(client, login, backend_env):
    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.put(
        "/config/archives/NOTEXIST",
        headers=headers,
        json={"name": "Test"},
    )

    assert response.status_code == 404


def test_delete_archive_removes_from_file(client, login, backend_env, monkeypatch):
    import server.main as main_mod
    monkeypatch.setattr(main_mod, "_find_works_with_archive", lambda _: [])
    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.delete("/config/archives/RA", headers=headers)

    assert response.status_code == 200
    archives = json.loads(backend_env["archives_file"].read_text(encoding="utf-8"))
    assert "RA" not in archives


def test_delete_archive_in_use_returns_409(client, login, backend_env, monkeypatch):
    import server.main as main_mod
    monkeypatch.setattr(
        main_mod, "_find_works_with_archive",
        lambda _: [("/data/teos1/_metadata.json", {"title": "Teos 1"})]
    )
    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.delete("/config/archives/RA", headers=headers)

    assert response.status_code == 409
    assert "Teos 1" in response.json()["detail"]


def test_delete_archive_force_removes_despite_usage(client, login, backend_env, monkeypatch):
    import server.main as main_mod
    monkeypatch.setattr(
        main_mod, "_find_works_with_archive",
        lambda _: [("/data/teos1/_metadata.json", {"title": "Teos 1"})]
    )
    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.delete("/config/archives/RA?force=true", headers=headers)

    assert response.status_code == 200
    archives = json.loads(backend_env["archives_file"].read_text(encoding="utf-8"))
    assert "RA" not in archives


def test_delete_archive_requires_admin(client, login, backend_env):
    token = login("editor", "editorpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.delete("/config/archives/RA", headers=headers)

    assert response.status_code == 403
```

- [ ] **Samm 5: Käivita testid — veendu et kukuvad läbi**

```bash
cd /home/mf/LLM/VUTT
.venv/bin/python -m pytest tests/test_backend_smoke.py -k "archive" -v 2>&1 | tail -20
```

Oodatav: FAIL — `ARCHIVES_FILE` pole `main`-is, endpointid puuduvad, `archives_file` pole conftest-is

- [ ] **Samm 6: Lisa `archives_file` → `tests/conftest.py`**

Leia `collections_file.write_text(...)` plokk (rida ~59-71). Lisa selle järele:

```python
    archives_file = state_dir / "archives.json"
    archives_file.write_text(
        json.dumps({"RA": {"name": "Rahvusarhiiv", "url": "https://ais.ra.ee"}}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
```

Leia `monkeypatch.setattr(main, "COLLECTIONS_FILE", str(collections_file))` (rida ~86). Lisa selle järele:

```python
    monkeypatch.setattr(main, "ARCHIVES_FILE", str(archives_file))
```

Leia `yield {` plokki (rida ~104). Lisa `"collections_file": collections_file,` järele:

```python
            "archives_file": archives_file,
```

- [ ] **Samm 7: Käivita testid uuesti — veendu et läbivad**

```bash
.venv/bin/python -m pytest tests/test_backend_smoke.py -k "archive" -v 2>&1 | tail -20
```

Oodatav: kõik `test_*archive*` testid PASS

- [ ] **Samm 8: Käivita kõik testid — veendu et ei ole regressioone**

```bash
.venv/bin/python -m pytest tests/ -v 2>&1 | tail -20
```

Oodatav: kõik eelnevad testid jäävad PASS

- [ ] **Samm 9: Commit**

```bash
git add server/main.py tests/conftest.py tests/test_backend_smoke.py
git commit -m "feat: arhiivide register — CRUD endpointid + testid"
```

---

## Task 2: `ArchiveSelect` komponent + MetadataModal + UploadMetaForm

**Files:**
- Create: `src/components/ArchiveSelect.tsx`
- Modify: `src/components/MetadataModal.tsx`
- Modify: `src/components/UploadMetaForm.tsx`
- Modify: `src/locales/et/admin.json`
- Modify: `src/locales/en/admin.json`

- [ ] **Samm 1: Lisa tõlkevõtmed → `src/locales/et/admin.json`**

Lisa faili lõppu, enne viimast `}`:

```json
  "archives": {
    "title": "Arhiivide register",
    "addArchive": "Lisa arhiiv",
    "id": "Lühend",
    "idPlaceholder": "Lühend (nt \"EKM\")",
    "name": "Nimi",
    "url": "URL (valikuline)",
    "selectPlaceholder": "Arhiiv",
    "idNameRequired": "Lühend ja nimi on kohustuslikud",
    "duplicateId": "Lühend '{{id}}' on juba kasutusel",
    "deleteConfirm": "Kustuta arhiiv '{{id}}'?",
    "deleteInUseWarning": "See arhiiv on kasutusel teoses. Kustutamine ei eemalda viiteid teostest.",
    "requestTitle": "Taotle arhiivi lisamist",
    "requestBody": "Soovin lisada arhiivi registrisse: {{id}}, {{name}}",
    "requestSent": "Teavitus adminidele saadetud.",
    "send": "Saada"
  }
```

- [ ] **Samm 2: Lisa tõlkevõtmed → `src/locales/en/admin.json`**

Lisa faili lõppu, enne viimast `}`:

```json
  "archives": {
    "title": "Archive registry",
    "addArchive": "Add archive",
    "id": "ID",
    "idPlaceholder": "ID (e.g. \"BL\")",
    "name": "Name",
    "url": "URL (optional)",
    "selectPlaceholder": "Archive",
    "idNameRequired": "ID and name are required",
    "duplicateId": "ID '{{id}}' is already in use",
    "deleteConfirm": "Delete archive '{{id}}'?",
    "deleteInUseWarning": "This archive is in use in a work. Deleting will not remove references from works.",
    "requestTitle": "Request archive addition",
    "requestBody": "I'd like to add an archive to the registry: {{id}}, {{name}}",
    "requestSent": "Notification sent to admins.",
    "send": "Send"
  }
```

- [ ] **Samm 3: Loo `src/components/ArchiveSelect.tsx`**

```tsx
import React, { useState, useRef, useEffect } from 'react';
import { Plus, X, Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';

interface ArchiveInfo {
  name: string;
  url?: string;
}

interface ArchiveSelectProps {
  archives: Record<string, ArchiveInfo>;
  value: string;
  onChange: (archiveId: string) => void;
  onArchiveAdded: (id: string, info: ArchiveInfo) => void;
  userRole: string;
  authToken: string | null;
  className?: string;
}

const ArchiveSelect: React.FC<ArchiveSelectProps> = ({
  archives, value, onChange, onArchiveAdded, userRole, authToken, className = '',
}) => {
  const { t } = useTranslation(['admin', 'common']);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notifyText, setNotifyText] = useState('');
  const [notifySent, setNotifySent] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const entries = Object.entries(archives);
  const showFilter = entries.length > 8;
  const filtered = filter
    ? entries.filter(([id, info]) =>
        id.toLowerCase().includes(filter.toLowerCase()) ||
        info.name.toLowerCase().includes(filter.toLowerCase())
      )
    : entries;

  const selectedLabel = value && archives[value]
    ? `${value} — ${archives[value].name}`
    : `— ${t('admin:archives.selectPlaceholder')} —`;

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowAddForm(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const handleAddAdmin = async () => {
    const trimId = newId.trim();
    const trimName = newName.trim();
    const trimUrl = newUrl.trim();
    if (!trimId || !trimName) {
      setAddError(t('admin:archives.idNameRequired'));
      return;
    }
    if (archives[trimId]) {
      setAddError(t('admin:archives.duplicateId', { id: trimId }));
      return;
    }
    setSaving(true);
    setAddError('');
    try {
      const resp = await fetchWithTimeout(`${FILE_API_URL}/config/archives`, {
        method: 'POST',
        headers: { ...getAuthHeaders(authToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: trimId, name: trimName, ...(trimUrl ? { url: trimUrl } : {}) }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        setAddError(err.detail || t('common:error.unknown'));
        return;
      }
      const info: ArchiveInfo = { name: trimName, ...(trimUrl ? { url: trimUrl } : {}) };
      onArchiveAdded(trimId, info);
      onChange(trimId);
      setNewId(''); setNewName(''); setNewUrl('');
      setShowAddForm(false);
      setOpen(false);
    } catch {
      setAddError(t('common:error.unknown'));
    } finally {
      setSaving(false);
    }
  };

  const handleNotifySubmit = async () => {
    if (!notifyText.trim() || !authToken) return;
    setSaving(true);
    try {
      await fetchWithTimeout(`${FILE_API_URL}/notifications/send`, {
        method: 'POST',
        headers: { ...getAuthHeaders(authToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_mode: 'admins',
          title: t('admin:archives.requestTitle'),
          body: notifyText,
        }),
      });
      setNotifySent(true);
    } catch {
      // ignore send errors
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <div className="flex gap-1 items-center">
        <button
          type="button"
          onClick={() => { setOpen(o => !o); setFilter(''); }}
          className="flex items-center gap-1 border border-gray-300 rounded px-2 py-2 text-sm bg-white w-28 shrink-0 hover:border-gray-400 text-left"
        >
          <span className="flex-1 truncate text-xs text-gray-700">{selectedLabel}</span>
          <ChevronDown size={12} className="shrink-0 text-gray-400" />
        </button>

        {userRole !== 'contributor' && (
          <button
            type="button"
            onClick={() => {
              if (userRole === 'admin') {
                setShowAddForm(f => !f);
                setShowNotifyModal(false);
              } else {
                setNotifyText(t('admin:archives.requestBody', { id: '', name: '' }));
                setNotifySent(false);
                setShowNotifyModal(true);
              }
            }}
            className="p-1 text-gray-400 hover:text-primary-600 border border-gray-300 rounded bg-white hover:border-primary-400"
            title={t('admin:archives.addArchive')}
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-56 bg-white border border-gray-200 rounded shadow-lg left-0 top-full">
          {showFilter && (
            <div className="p-1.5 border-b border-gray-100">
              <input
                autoFocus
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary-400"
                placeholder={t('common:buttons.search')}
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
            </div>
          )}
          <ul className="max-h-48 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-50"
                onClick={() => { onChange(''); setOpen(false); }}
              >
                — {t('admin:archives.selectPlaceholder')} —
              </button>
            </li>
            {filtered.map(([id, info]) => (
              <li key={id}>
                <button
                  type="button"
                  className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between hover:bg-gray-50 ${value === id ? 'font-medium text-primary-700' : 'text-gray-700'}`}
                  onClick={() => { onChange(id); setOpen(false); setFilter(''); }}
                >
                  <span><span className="font-medium">{id}</span> — {info.name}</span>
                  {value === id && <Check size={12} />}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-gray-400">{t('common:persons.noResults', 'Tulemusi ei leitud')}</li>
            )}
          </ul>
        </div>
      )}

      {showAddForm && (
        <div className="absolute z-50 mt-1 left-0 w-64 bg-white border border-gray-200 rounded shadow-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-600">{t('admin:archives.addArchive')}</p>
          <input
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-primary-400 outline-none"
            placeholder={t('admin:archives.idPlaceholder')}
            value={newId}
            onChange={e => { setNewId(e.target.value); setAddError(''); }}
          />
          <input
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-primary-400 outline-none"
            placeholder={t('admin:archives.name')}
            value={newName}
            onChange={e => { setNewName(e.target.value); setAddError(''); }}
          />
          <input
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-primary-400 outline-none"
            placeholder={t('admin:archives.url')}
            value={newUrl}
            onChange={e => setNewUrl(e.target.value)}
          />
          {addError && <p className="text-xs text-red-600">{addError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAddAdmin}
              disabled={saving}
              className="flex-1 text-xs bg-primary-600 text-white rounded px-2 py-1.5 hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? '...' : t('common:buttons.save')}
            </button>
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setAddError(''); setNewId(''); setNewName(''); setNewUrl(''); }}
              className="text-xs text-gray-500 hover:text-gray-700 px-2"
            >
              {t('common:buttons.cancel')}
            </button>
          </div>
        </div>
      )}

      {showNotifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-xl p-4 w-80 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{t('admin:archives.requestTitle')}</p>
              <button type="button" onClick={() => setShowNotifyModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            {notifySent ? (
              <p className="text-sm text-green-700">{t('admin:archives.requestSent')}</p>
            ) : (
              <>
                <textarea
                  className="w-full border border-gray-300 rounded px-2 py-2 text-sm resize-none focus:ring-1 focus:ring-primary-400 outline-none"
                  rows={4}
                  value={notifyText}
                  onChange={e => setNotifyText(e.target.value)}
                />
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setShowNotifyModal(false)} className="text-sm text-gray-500 px-3 py-1.5">
                    {t('common:buttons.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={handleNotifySubmit}
                    disabled={saving || !notifyText.trim()}
                    className="text-sm bg-primary-600 text-white rounded px-3 py-1.5 hover:bg-primary-700 disabled:opacity-50"
                  >
                    {saving ? '...' : t('admin:archives.send')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ArchiveSelect;
```

- [ ] **Samm 4: Asenda `<select>` → `<ArchiveSelect>` → `src/components/MetadataModal.tsx`**

Lisa faili tippu import:
```typescript
import ArchiveSelect from './ArchiveSelect';
```

Leia rida (umbes 759):
```tsx
                  <select
                    className="border border-gray-300 rounded px-2 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white w-28 shrink-0"
                    value={ref.archive_id}
                    onChange={e => setMetaForm({ ...metaForm, archive_refs: metaForm.archive_refs.map((r, i) => i === idx ? { ...r, archive_id: e.target.value } : r) })}
                  >
                    <option value="">— Arhiiv —</option>
                    {Object.entries(archives).map(([id, info]) => (
                      <option key={id} value={id}>{id} — {info.name}</option>
                    ))}
                  </select>
```

Asenda:
```tsx
                  <ArchiveSelect
                    archives={archives}
                    value={ref.archive_id}
                    onChange={archiveId => setMetaForm({ ...metaForm, archive_refs: metaForm.archive_refs.map((r, i) => i === idx ? { ...r, archive_id: archiveId } : r) })}
                    onArchiveAdded={(id, info) => setArchives(prev => ({ ...prev, [id]: info }))}
                    userRole={user?.role || ''}
                    authToken={authToken}
                  />
```

- [ ] **Samm 5: Asenda `<select>` → `<ArchiveSelect>` → `src/components/UploadMetaForm.tsx`**

Leia `UploadMetaForm` props interface. Lisa sinna (kui pole juba):
```typescript
  userRole?: string;
  authToken?: string | null;
```

NB: vaata kuidas `UploadMetaForm`-i kutsutakse (Upload.tsx), et teada kas `userRole` ja `authToken` on juba saadaval.

Lisa import:
```typescript
import ArchiveSelect from './ArchiveSelect';
```

Leia `<select>` arhiivi jaoks (umbes rida 639-648):
```tsx
              <select
                className="..."
                value={ref.archive_id}
                onChange={e => setForm({ ...form, archive_refs: form.archive_refs.map((r, i) => i === idx ? { ...r, archive_id: e.target.value } : r) })}
              >
                <option value="">— Arhiiv —</option>
                {Object.entries(archives).map(([id, info]) => (
                  <option key={id} value={id}>{id} — {info.name}</option>
                ))}
              </select>
```

Asenda:
```tsx
              <ArchiveSelect
                archives={archives}
                value={ref.archive_id}
                onChange={archiveId => setForm({ ...form, archive_refs: form.archive_refs.map((r, i) => i === idx ? { ...r, archive_id: archiveId } : r) })}
                onArchiveAdded={(id, info) => setArchives(prev => ({ ...prev, [id]: info }))}
                userRole={userRole || 'contributor'}
                authToken={authToken ?? null}
              />
```

- [ ] **Samm 6: Vaata kuidas UploadMetaForm-i kutsutakse — lisa props kui vaja**

```bash
grep -n "UploadMetaForm" /home/mf/LLM/VUTT/src/components/Upload.tsx | head -10
grep -n "user\|authToken\|role" /home/mf/LLM/VUTT/src/components/Upload.tsx | head -10
```

Kui `Upload.tsx` kasutab `useUser()` hookit, lisa `userRole={user?.role || 'contributor'}` ja `authToken={authToken}` propidena `<UploadMetaForm>` kutsesse.

- [ ] **Samm 7: TypeScript kompileerumine**

```bash
cd /home/mf/LLM/VUTT
npm run build 2>&1 | head -30
```

Oodatav: 0 TS vigu. Kui vigu on, paranda need enne jätkamist.

- [ ] **Samm 8: Commit**

```bash
git add src/components/ArchiveSelect.tsx src/components/MetadataModal.tsx \
        src/components/UploadMetaForm.tsx \
        src/locales/et/admin.json src/locales/en/admin.json
git commit -m "feat: ArchiveSelect komponent — combobox + admin inline form + editor teavitus"
```

---

## Task 3: Maintenance lehe "Arhiivide register" sektsioon

**Files:**
- Modify: `src/pages/admin/Maintenance.tsx`

- [ ] **Samm 1: Lisa arhiivide state + laadimisloogika → `src/pages/admin/Maintenance.tsx`**

Lisa olemasolevate `useState` deklaratsioonide järele (rida ~17):

```typescript
  const [archives, setArchives] = useState<Record<string, { name: string; url?: string }>>({});
  const [archivesLoaded, setArchivesLoaded] = useState(false);
  const [showAddArchive, setShowAddArchive] = useState(false);
  const [addId, setAddId] = useState('');
  const [addName, setAddName] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addError, setAddError] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [deleteForceConfirm, setDeleteForceConfirm] = useState<{ id: string; message: string } | null>(null);
```

Lisa `handleRefreshEntityLabels` funktsiooni järele:

```typescript
  React.useEffect(() => {
    if (!authToken) return;
    fetchWithTimeout(`${FILE_API_URL}/config/archives`, { headers: getAuthHeaders(authToken) })
      .then(r => r.json())
      .then(d => { if (d.archives) { setArchives(d.archives); setArchivesLoaded(true); } })
      .catch(() => {});
  }, [authToken]);

  const handleAddArchive = async () => {
    const trimId = addId.trim();
    const trimName = addName.trim();
    const trimUrl = addUrl.trim();
    if (!trimId || !trimName) { setAddError(t('admin:archives.idNameRequired')); return; }
    if (archives[trimId]) { setAddError(t('admin:archives.duplicateId', { id: trimId })); return; }
    setAddSaving(true); setAddError('');
    try {
      const resp = await fetchWithTimeout(`${FILE_API_URL}/config/archives`, {
        method: 'POST',
        headers: { ...getAuthHeaders(authToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: trimId, name: trimName, ...(trimUrl ? { url: trimUrl } : {}) }),
      });
      if (!resp.ok) { const e = await resp.json(); setAddError(e.detail || t('common:error.unknown')); return; }
      setArchives(prev => ({ ...prev, [trimId]: { name: trimName, ...(trimUrl ? { url: trimUrl } : {}) } }));
      setAddId(''); setAddName(''); setAddUrl('');
      setShowAddArchive(false);
    } catch { setAddError(t('common:error.unknown')); }
    finally { setAddSaving(false); }
  };

  const handleUpdateArchive = async (id: string) => {
    const trimName = editName.trim();
    const trimUrl = editUrl.trim();
    if (!trimName) { setEditError(t('admin:archives.name')); return; }
    setEditSaving(true); setEditError('');
    try {
      const resp = await fetchWithTimeout(`${FILE_API_URL}/config/archives/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(authToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimName, ...(trimUrl ? { url: trimUrl } : {}) }),
      });
      if (!resp.ok) { const e = await resp.json(); setEditError(e.detail || t('common:error.unknown')); return; }
      setArchives(prev => ({ ...prev, [id]: { name: trimName, ...(trimUrl ? { url: trimUrl } : {}) } }));
      setEditingId(null);
    } catch { setEditError(t('common:error.unknown')); }
    finally { setEditSaving(false); }
  };

  const handleDeleteArchive = async (id: string, force = false) => {
    try {
      const resp = await fetchWithTimeout(
        `${FILE_API_URL}/config/archives/${encodeURIComponent(id)}${force ? '?force=true' : ''}`,
        { method: 'DELETE', headers: getAuthHeaders(authToken) },
      );
      if (resp.status === 409) {
        const e = await resp.json();
        setDeleteForceConfirm({ id, message: e.detail });
        return;
      }
      if (!resp.ok) return;
      setArchives(prev => { const n = { ...prev }; delete n[id]; return n; });
      setDeleteForceConfirm(null);
    } catch { /* ignore */ }
  };
```

- [ ] **Samm 2: Lisa JSX sektsioon — "Arhiivide register"**

Leia `return (` plokki rida kus `<div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">` algab (rida ~104). Lisa selle **ette**:

```tsx
        {/* Arhiivide register */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">{t('admin:archives.title')}</h3>
            <button
              onClick={() => { setShowAddArchive(a => !a); setAddId(''); setAddName(''); setAddUrl(''); setAddError(''); }}
              className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 border border-primary-200 rounded px-2 py-1 hover:bg-primary-50"
            >
              + {t('admin:archives.addArchive')}
            </button>
          </div>

          {showAddArchive && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <input
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-primary-400 outline-none"
                  placeholder={t('admin:archives.idPlaceholder')}
                  value={addId}
                  onChange={e => { setAddId(e.target.value); setAddError(''); }}
                />
                <input
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-primary-400 outline-none"
                  placeholder={t('admin:archives.name')}
                  value={addName}
                  onChange={e => { setAddName(e.target.value); setAddError(''); }}
                />
                <input
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-primary-400 outline-none"
                  placeholder={t('admin:archives.url')}
                  value={addUrl}
                  onChange={e => setAddUrl(e.target.value)}
                />
              </div>
              {addError && <p className="text-xs text-red-600">{addError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleAddArchive}
                  disabled={addSaving}
                  className="text-xs bg-primary-600 text-white rounded px-3 py-1.5 hover:bg-primary-700 disabled:opacity-50"
                >
                  {addSaving ? '...' : t('common:buttons.save')}
                </button>
                <button
                  onClick={() => setShowAddArchive(false)}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  {t('common:buttons.cancel')}
                </button>
              </div>
            </div>
          )}

          {archivesLoaded && (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 font-medium">
                    <th className="text-left px-3 py-2 w-24">{t('admin:archives.id')}</th>
                    <th className="text-left px-3 py-2">{t('admin:archives.name')}</th>
                    <th className="text-left px-3 py-2 w-40">{t('admin:archives.url')}</th>
                    <th className="w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {Object.entries(archives).map(([id, info]) => (
                    <tr key={id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs font-medium text-gray-700">{id}</td>
                      {editingId === id ? (
                        <>
                          <td className="px-3 py-2">
                            <input
                              className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-primary-400 outline-none"
                              value={editName}
                              onChange={e => { setEditName(e.target.value); setEditError(''); }}
                            />
                            {editError && <p className="text-xs text-red-600 mt-0.5">{editError}</p>}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-primary-400 outline-none"
                              value={editUrl}
                              onChange={e => setEditUrl(e.target.value)}
                              placeholder="https://..."
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleUpdateArchive(id)}
                                disabled={editSaving}
                                className="text-xs text-primary-600 hover:text-primary-800 disabled:opacity-50"
                              >
                                {editSaving ? '...' : t('common:buttons.save')}
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="text-xs text-gray-400 hover:text-gray-600"
                              >
                                {t('common:buttons.cancel')}
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-gray-800">{info.name}</td>
                          <td className="px-3 py-2">
                            {info.url ? (
                              <a href={info.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-600 hover:underline truncate block max-w-[140px]">
                                {info.url.replace(/^https?:\/\//, '')} ↗
                              </a>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={() => { setEditingId(id); setEditName(info.name); setEditUrl(info.url || ''); setEditError(''); }}
                                className="text-xs text-gray-400 hover:text-gray-700"
                                title={t('common:buttons.edit')}
                              >
                                ✎
                              </button>
                              <button
                                onClick={() => handleDeleteArchive(id)}
                                className="text-xs text-gray-300 hover:text-red-500"
                                title={t('common:buttons.delete')}
                              >
                                ×
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
```

- [ ] **Samm 3: Lisa force-delete kinnitusdialoog**

Lisa `return (` JSX-i lõppu, enne viimast `</div>`:

```tsx
        {deleteForceConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <div className="bg-white rounded-lg shadow-xl p-5 w-80 space-y-3">
              <p className="text-sm font-semibold text-gray-800">{deleteForceConfirm.message}</p>
              <p className="text-xs text-gray-500">{t('admin:archives.deleteInUseWarning')}</p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setDeleteForceConfirm(null)}
                  className="text-sm text-gray-500 px-3 py-1.5"
                >
                  {t('common:buttons.cancel')}
                </button>
                <button
                  onClick={() => handleDeleteArchive(deleteForceConfirm.id, true)}
                  className="text-sm bg-red-600 text-white rounded px-3 py-1.5 hover:bg-red-700"
                >
                  {t('common:buttons.delete')}
                </button>
              </div>
            </div>
          </div>
        )}
```

- [ ] **Samm 4: TypeScript kompileerumine**

```bash
cd /home/mf/LLM/VUTT
npm run build 2>&1 | head -30
```

Oodatav: 0 vigu.

- [ ] **Samm 5: Commit**

```bash
git add src/pages/admin/Maintenance.tsx
git commit -m "feat: Maintenance leht — arhiivide register CRUD sektsioon"
```

---

## Deploy märkused

```bash
# Backend (serveris):
ssh vutt
cd ~/VUTT && git pull
docker compose build --no-cache backend && docker compose up -d backend

# Frontend (lokaalsel masinal pärast npm run build):
npm run build
rsync -avz dist/ vutt:~/VUTT/dist/
```
