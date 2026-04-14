# Archive Refs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lisa teostele `archive_refs` metaandmeväli — arhiiviviited massiivina, kus iga kirje sisaldab etteantud arhiivi (dropdown `archives.json`-st) + vabatekstiline viide + valikuline URL.

**Architecture:** Uus `data/config/archives.json` konfiguratsioonifail (käsitsi hallatav) + backend cache + endpoint. Frontend: `ArchiveRef[]` tüüp, `MetadataModal` editor UI, `AnnotationsTab` kuvamine. Meilisearch: `archive_refs_text` denormaliseeritud otsingutekst (sama muster nagu `location_search`).

**Tech Stack:** FastAPI (Python 3.9), React 19 + TypeScript, Tailwind, Vitest (TS testid), Meilisearch

---

## Fail-struktuur

| Fail | Muutus |
|------|--------|
| `data/config/archives.json` | **Uus** — arhiivide register |
| `server/config.py` | Lisa `ARCHIVES_FILE` konstant |
| `server/cache.py` | Lisa `get_cached_archives()` |
| `server/main.py` | Lisa `GET /config/archives` endpoint |
| `server/metadata_ops.py` | Lisa `archive_refs` → `ALLOWED_METADATA_FIELDS` |
| `server/meilisearch_ops.py` | Lisa `archive_refs_text` dokumendi kokkupanek |
| `scripts/2-1_upload_to_meili.py` | Lisa `archive_refs_text` → `searchableAttributes` |
| `src/types.ts` | Lisa `ArchiveRef` interface, `archive_refs` → `Work` |
| `src/services/meiliService.ts` | Lisa `archive_refs` → `attributesToRetrieve` + `normalizeWork` |
| `src/services/workService.ts` | Lisa `archive_refs` → `attributesToRetrieve` + normaliseerimine |
| `src/utils/buildMetadataPayload.ts` | Lisa `archive_refs` → `MetadataFormData` + payload |
| `src/utils/__tests__/buildMetadataPayload.test.ts` | Lisa testid `archive_refs` kohta |
| `src/components/MetadataModal.tsx` | Lisa editor UI + laadi archives |
| `src/components/editor/AnnotationsTab.tsx` | Lisa kuvamine |
| `src/locales/et/workspace.json` | Lisa tõlked |
| `src/locales/en/workspace.json` | Lisa tõlked |

---

## Task 1: Config fail + backend infra

**Files:**
- Create: `data/config/archives.json`
- Modify: `server/config.py`
- Modify: `server/cache.py`
- Modify: `server/main.py`
- Modify: `server/metadata_ops.py`

- [ ] **Samm 1: Loo `data/config/archives.json`**

```json
{
  "EAA": {
    "name": "Eesti Ajalooarhiiv",
    "url": "https://ais.ra.ee"
  },
  "RA": {
    "name": "Rahvusarhiiv",
    "url": "https://ais.ra.ee"
  },
  "LVVA": {
    "name": "Latvijas Valsts vēstures arhīvs"
  },
  "LNB": {
    "name": "Latvijas Nacionālā bibliotēka"
  },
  "TÜR": {
    "name": "Tartu Ülikooli Raamatukogu"
  },
  "RR": {
    "name": "Rahvusraamatukogu"
  },
  "BSB": {
    "name": "Bayerische Staatsbibliothek",
    "url": "https://www.bsb-muenchen.de"
  },
  "HAB": {
    "name": "Herzog August Bibliothek",
    "url": "https://www.hab.de"
  }
}
```

- [ ] **Samm 2: Lisa `ARCHIVES_FILE` → `server/config.py`**

Lisa rea `WORKS_CREATORS_INDEX_FILE` järele:

```python
ARCHIVES_FILE = os.path.join(_DATA_CONFIG_DIR, "archives.json")
```

- [ ] **Samm 3: Lisa `get_cached_archives()` → `server/cache.py`**

Lisa impordi reale `COLLECTIONS_FILE, VOCABULARIES_FILE` järele `ARCHIVES_FILE`:

```python
from .config import BASE_DIR, COLLECTIONS_FILE, VOCABULARIES_FILE, ARCHIVES_FILE, MEILI_URL, MEILI_KEY, INDEX_NAME
```

Lisa `_load_cache_internal()` funktsiooni lõppu (pärast `_vocabularies_cache = vocabularies` rida) uus cache muutuja ja laadimine. Tegelikult lihtsam teha eraldi lihtsa funktsiooni päris faili lõppu, kus ei ole TTL jagatud:

```python
# =========================================================
# CACHE: Archives
# =========================================================
_archives_cache = None
_archives_cache_at = None
ARCHIVES_CACHE_TTL = 300

def get_cached_archives():
    global _archives_cache, _archives_cache_at
    with _cache_lock:
        if _archives_cache is None or _archives_cache_at is None or \
           (datetime.now() - _archives_cache_at).total_seconds() > ARCHIVES_CACHE_TTL:
            _archives_cache = {}
            if os.path.exists(ARCHIVES_FILE):
                try:
                    with open(ARCHIVES_FILE, 'r', encoding='utf-8') as f:
                        _archives_cache = json.load(f)
                except Exception as e:
                    print(f"Archives cache laadimine ebaõnnestus: {e}")
            _archives_cache_at = datetime.now()
        return _archives_cache
```

Lisa ka `invalidate_cache()` funktsiooni:
```python
global _archives_cache, _archives_cache_at
# ... olemasolevad read ...
_archives_cache = None
_archives_cache_at = None
```

- [ ] **Samm 4: Lisa `GET /config/archives` endpoint → `server/main.py`**

Lisa importi `get_cached_archives`:
```python
from .cache import (
    get_cached_collections, get_cached_vocabularies, get_cached_people_aliases,
    get_cached_people_register, get_cached_suggestions, invalidate_cache,
    get_cached_archives,
)
```

Lisa endpoint `/collections` endpoint-i lähedusse (umbes rida 1022):
```python
@app.get("/config/archives")
async def get_archives():
    return {"status": "success", "archives": get_cached_archives()}
```

- [ ] **Samm 5: Lisa `archive_refs` → `ALLOWED_METADATA_FIELDS` (`server/metadata_ops.py`)**

```python
ALLOWED_METADATA_FIELDS = {
    "title", "year", "year_display", "location", "publisher", "creators", "tags",
    "collections", "type", "genre", "languages", "ester_id", "external_url",
    "series", "relations", "archive_refs",
}
```

- [ ] **Samm 6: Commit**

```bash
cd /home/mf/LLM/VUTT
git add data/config/archives.json server/config.py server/cache.py server/main.py server/metadata_ops.py
git commit -m "feat: archive_refs — config fail, backend cache ja endpoint"
```

---

## Task 2: Meilisearch indekseerimise lisamine

**Files:**
- Modify: `server/meilisearch_ops.py`
- Modify: `scripts/2-1_upload_to_meili.py`

- [ ] **Samm 1: Lisa `archive_refs_text` → `server/meilisearch_ops.py`**

Leia rida kus `ester_id = metadata.get('ester_id')` (umbes rida 333). Lisa selle lähedusse:

```python
archive_refs = metadata.get('archive_refs') or []
```

Leia rida kus `if ester_id:` (umbes rida 525). Lisa `archive_refs` dokumendi kokkupanekule:

```python
if archive_refs:
    doc['archive_refs'] = archive_refs
    # Denormaliseeritud otsingutekst (arhiivi kood + viide)
    parts = []
    for ref in archive_refs:
        if isinstance(ref, dict):
            if ref.get('archive_id'):
                parts.append(ref['archive_id'])
            if ref.get('reference'):
                parts.append(ref['reference'])
    if parts:
        doc['archive_refs_text'] = ' '.join(parts)
```

- [ ] **Samm 2: Lisa `archive_refs_text` → `searchableAttributes` (`scripts/2-1_upload_to_meili.py`)**

Lisa `'comments.text'` järele `searchableAttributes` massiivi:
```python
'archive_refs_text',
```

NB: `scripts/2-1_upload_to_meili.py` on serveril manuaalselt käitatav skript — seda ei pea deployma, aga peab commitima et muutus oleks kirjas.

- [ ] **Samm 3: Commit**

```bash
git add server/meilisearch_ops.py scripts/2-1_upload_to_meili.py
git commit -m "feat: archive_refs — Meilisearch indekseerimise lisamine"
```

---

## Task 3: TypeScript tüübid + teenused + buildMetadataPayload (TDD)

**Files:**
- Modify: `src/types.ts`
- Modify: `src/services/meiliService.ts`
- Modify: `src/services/workService.ts`
- Modify: `src/utils/buildMetadataPayload.ts`
- Modify: `src/utils/__tests__/buildMetadataPayload.test.ts`

- [ ] **Samm 1: Kirjuta läbikukkuvad testid (`src/utils/__tests__/buildMetadataPayload.test.ts`)**

Lisa faili lõppu uus describe blokk (enne viimast rida):

```typescript
// ---------------------------------------------------------------------------
// archive_refs buildMetadataPayload-is
// ---------------------------------------------------------------------------
describe('buildMetadataPayload — archive_refs', () => {
  it('tühi archive_refs massiiv → null payload-is', () => {
    const form = { ...baseForm(), archive_refs: [] };
    expect(buildMetadataPayload(form, 'x').metadata.archive_refs).toBeNull();
  });

  it('archive_refs kirjetega → säilitatakse', () => {
    const refs = [{ archive_id: 'EAA', reference: '1.2.3, l. 4', url: 'https://example.com' }];
    const form = { ...baseForm(), archive_refs: refs };
    expect(buildMetadataPayload(form, 'x').metadata.archive_refs).toEqual(refs);
  });

  it('kirje ilma url-ita → säilitatakse (url puudub)', () => {
    const refs = [{ archive_id: 'TÜR', reference: 'Ms. 123' }];
    const form = { ...baseForm(), archive_refs: refs };
    const result = buildMetadataPayload(form, 'x').metadata.archive_refs;
    expect(result).toEqual([{ archive_id: 'TÜR', reference: 'Ms. 123' }]);
  });

  it('filtreerib välja kirjed millel pole archive_id ega reference', () => {
    const refs = [
      { archive_id: '', reference: '' },
      { archive_id: 'EAA', reference: '1.2.3' },
    ];
    const form = { ...baseForm(), archive_refs: refs };
    const result = buildMetadataPayload(form, 'x').metadata.archive_refs;
    expect(result).toEqual([{ archive_id: 'EAA', reference: '1.2.3' }]);
  });
});
```

- [ ] **Samm 2: Käivita testid — veendu et kukuvad läbi**

```bash
cd /home/mf/LLM/VUTT
npm test -- --run src/utils/__tests__/buildMetadataPayload.test.ts
```

Oodatav: FAIL — `archive_refs` pole `baseForm`-is ega `buildMetadataPayload`-is

- [ ] **Samm 3: Lisa `ArchiveRef` tüüp → `src/types.ts`**

Lisa pärast `Relation` interface'i (umbes rida 64):

```typescript
// Arhiiviviide
export interface ArchiveRef {
  archive_id: string;
  reference: string;
  url?: string;
}
```

Lisa `Work` interface'i `external_url` järele:

```typescript
// Arhiiviviited
archive_refs?: ArchiveRef[] | null;
```

- [ ] **Samm 4: Lisa `archive_refs` → `src/utils/buildMetadataPayload.ts`**

Lisa `MetadataFormData` interface'ile (pärast `external_url: string;` rida):
```typescript
archive_refs: ArchiveRef[];
```

Lisa import faili tippu:
```typescript
import type { ArchiveRef } from '../types';
```

Lisa `baseForm()` analoogiks (MetadataFormData tüübi kasutajatele) — `baseForm` on testis, mitte siin.

Lisa `buildMetadataPayload` funktsiooni payload objekti `external_url` järele:

```typescript
archive_refs: cleanArchiveRefs(form.archive_refs),
```

Lisa uus helper funktsioon (ekspordi, et saaks testida):

```typescript
export function cleanArchiveRefs(refs: ArchiveRef[]): ArchiveRef[] | null {
  const clean = refs.filter(r => r.archive_id.trim() || r.reference.trim()).map(r => {
    const out: ArchiveRef = { archive_id: r.archive_id.trim(), reference: r.reference.trim() };
    if (r.url?.trim()) out.url = r.url.trim();
    return out;
  });
  return clean.length > 0 ? clean : null;
}
```

Uuenda testi importi:
```typescript
import { cleanEsterId, cleanTags, cleanCreators, buildMetadataPayload, cleanArchiveRefs } from '../buildMetadataPayload';
import type { MetadataFormData, ArchiveRef } from '../buildMetadataPayload';
```

Lisa `baseForm()` tagastusesse `archive_refs: [],`.

- [ ] **Samm 5: Käivita testid — veendu et läbivad**

```bash
npm test -- --run src/utils/__tests__/buildMetadataPayload.test.ts
```

Oodatav: PASS kõik

- [ ] **Samm 6: Lisa `archive_refs` → `src/services/meiliService.ts`**

Leia `attributesToRetrieve` massiiv (rida ~53). Lisa `'external_url'` järele:
```typescript
'archive_refs',
```

Leia `normalizeWork` / `normalizePage` funktsioon (rida ~97-100). Lisa `external_url` järele:
```typescript
archive_refs: hit.archive_refs || null,
```

- [ ] **Samm 7: Lisa `archive_refs` → `src/services/workService.ts`**

Leia `attributesToRetrieve` massiiv (rida ~56). Lisa `'external_url'` järele:
```typescript
'archive_refs',
```

Leia normaliseerimine (rida ~98-99). Lisa `external_url` järele:
```typescript
archive_refs: hit.archive_refs || null,
```

- [ ] **Samm 8: Commit**

```bash
git add src/types.ts src/services/meiliService.ts src/services/workService.ts \
        src/utils/buildMetadataPayload.ts src/utils/__tests__/buildMetadataPayload.test.ts
git commit -m "feat: archive_refs — TypeScript tüübid, teenused, buildMetadataPayload"
```

---

## Task 4: MetadataModal editor UI

**Files:**
- Modify: `src/components/MetadataModal.tsx`

- [ ] **Samm 1: Lisa archives laadimine MetadataModal-i**

Leia suggestions `useState` deklaratsioon (umbes rida 167). Lisa kõrvale:

```typescript
const [archives, setArchives] = useState<Record<string, { name: string; url?: string }>>({});
```

Leia `useEffect` mis laeb suggestions. Lisa selle sisse (või eraldi `useEffect`-ina) archives laadimine:

```typescript
useEffect(() => {
  fetch('/api/config/archives')
    .then(r => r.json())
    .then(d => { if (d.archives) setArchives(d.archives); })
    .catch(() => {});
}, []);
```

NB: `/api/` prefix — vaata kuidas teised teenused API-t kutsuvad. Kui kasutavad `FILE_SERVER_URL` muutujat, kasuta sama mustrit. Tõenäoliselt on see `import { FILE_SERVER_URL } from '../../config'` vms — vaata teisi fetch kutseid samas failis.

- [ ] **Samm 2: Lisa `archive_refs` → metaForm state**

Leia `metaForm` algväärtustamine (umbes rida 159-166). Lisa `external_url: ''` järele:
```typescript
archive_refs: [] as ArchiveRef[],
```

Leia koht kus `metaForm` tüüp on defineeritud (MetadataFormData interface). See on `buildMetadataPayload.ts`-st — TypeScript peaks nõudma automaatselt.

Leia kohad kus `metaForm` reset toimub work/page andmete laadimiselt (kaks-kolm kohta, otsi `ester_id: work?.ester_id`). Lisa igasse:
```typescript
archive_refs: work?.archive_refs || [],
```

- [ ] **Samm 3: Lisa UI grupp — "Arhiiviviited"**

Leia "Välised lingid" grupp (rida ~705-728). Lisa selle **ette** uus grupp:

```tsx
{/* Grupp: Arhiiviviited */}
<div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-gray-50/50">
  <h4 className="text-xs font-bold text-gray-600 uppercase -mt-1">{t('metadata.archiveRefs', 'Arhiiviviited')}</h4>
  <div className="space-y-2">
    {metaForm.archive_refs.map((ref, idx) => (
      <div key={idx} className="flex gap-2 items-start">
        <select
          className="border border-gray-300 rounded px-2 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white w-32 shrink-0"
          value={ref.archive_id}
          onChange={e => {
            const updated = metaForm.archive_refs.map((r, i) => i === idx ? { ...r, archive_id: e.target.value } : r);
            setMetaForm({ ...metaForm, archive_refs: updated });
          }}
        >
          <option value="">— Arhiiv —</option>
          {Object.entries(archives).map(([id, info]) => (
            <option key={id} value={id}>{id} — {info.name}</option>
          ))}
        </select>
        <div className="flex-1 space-y-1">
          <textarea
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white resize-none"
            rows={2}
            placeholder={t('metadata.archiveRefPlaceholder', 'Viide (nt fond, nimistu, säilik, lehed)')}
            value={ref.reference}
            onChange={e => {
              const updated = metaForm.archive_refs.map((r, i) => i === idx ? { ...r, reference: e.target.value } : r);
              setMetaForm({ ...metaForm, archive_refs: updated });
            }}
          />
          <input
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
            placeholder={t('metadata.archiveRefUrl', 'URL (valikuline)')}
            value={ref.url || ''}
            onChange={e => {
              const updated = metaForm.archive_refs.map((r, i) => i === idx ? { ...r, url: e.target.value } : r);
              setMetaForm({ ...metaForm, archive_refs: updated });
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => setMetaForm({ ...metaForm, archive_refs: metaForm.archive_refs.filter((_, i) => i !== idx) })}
          className="text-gray-400 hover:text-red-500 mt-1 shrink-0"
          title={t('common:buttons.remove', 'Eemalda')}
        >
          ×
        </button>
      </div>
    ))}
    <button
      type="button"
      onClick={() => setMetaForm({ ...metaForm, archive_refs: [...metaForm.archive_refs, { archive_id: '', reference: '', url: '' }] })}
      className="text-xs text-primary-600 hover:text-primary-800 hover:underline"
    >
      + {t('metadata.addArchiveRef', 'Lisa arhiiviviide')}
    </button>
  </div>
</div>
```

Lisa import faili tippu:
```typescript
import type { ArchiveRef } from '../types';
```

- [ ] **Samm 4: Veendu et TypeScript kompileerub**

```bash
npm run build 2>&1 | head -30
```

Oodatav: ei mingeid TS vigu

- [ ] **Samm 5: Commit**

```bash
git add src/components/MetadataModal.tsx
git commit -m "feat: archive_refs — MetadataModal editor UI"
```

---

## Task 5: AnnotationsTab kuvamine + tõlked

**Files:**
- Modify: `src/components/editor/AnnotationsTab.tsx`
- Modify: `src/locales/et/workspace.json`
- Modify: `src/locales/en/workspace.json`

- [ ] **Samm 1: Lisa tõlked**

`src/locales/et/workspace.json` — lisa `metadata` sektsiooni:
```json
"archiveRefs": "Arhiiviviited",
"archiveRefPlaceholder": "Viide (nt fond, nimistu, säilik, lehed)",
"archiveRefUrl": "URL (valikuline)",
"addArchiveRef": "Lisa arhiiviviide"
```

`src/locales/en/workspace.json` — lisa `metadata` sektsiooni:
```json
"archiveRefs": "Archival references",
"archiveRefPlaceholder": "Reference (e.g. fond, inventory, file, folios)",
"archiveRefUrl": "URL (optional)",
"addArchiveRef": "Add archival reference"
```

Lisa mõlemasse ka `info` sektsiooni:
```json
"archiveRefs": "Arhiiviviited"   // et
"archiveRefs": "Archival references"  // en
```

- [ ] **Samm 2: Lisa kuvamine → `src/components/editor/AnnotationsTab.tsx`**

Leia "Links and Actions" blokk (umbes rida 427). Lisa selle **ette** uus blokk — arhiiviviited:

```tsx
{/* Arhiiviviited */}
{work.archive_refs && work.archive_refs.length > 0 && (
  <div className="mt-3 pt-3 border-t border-gray-100">
    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{t('info.archiveRefs', 'Arhiiviviited')}</p>
    <div className="space-y-2">
      {work.archive_refs.map((ref, idx) => (
        <div key={idx} className="text-sm text-gray-700">
          <span className="font-medium text-gray-800">{ref.archive_id}</span>
          {ref.reference && <span className="ml-1">{ref.reference}</span>}
          {ref.url && (
            <a
              href={ref.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 text-primary-600 hover:text-primary-800"
              title={ref.url}
            >
              ↗
            </a>
          )}
        </div>
      ))}
    </div>
  </div>
)}
```

Lisa import faili tippu (kui `ArchiveRef` tüüp on vajalik — tõenäoliselt piisab `work.archive_refs` kaudu):
```typescript
import type { ArchiveRef } from '../../types';
```

- [ ] **Samm 3: Veendu et TypeScript kompileerub**

```bash
npm run build 2>&1 | head -30
```

- [ ] **Samm 4: Käivita kõik testid**

```bash
npm test -- --run
```

Oodatav: kõik testid PASS

- [ ] **Samm 5: Commit**

```bash
git add src/components/editor/AnnotationsTab.tsx \
        src/locales/et/workspace.json src/locales/en/workspace.json
git commit -m "feat: archive_refs — kuvamine AnnotationsTab-is + tõlked"
```

---

## Deploy märkused

Pärast implementatsiooni:

1. **Backend deploy** (Python muutused):
   ```bash
   ssh vutt
   cd ~/VUTT && git pull
   docker compose build --no-cache backend && docker compose up -d backend
   ```

2. **Frontend deploy** (lokaalses masinas):
   ```bash
   npm run build
   rsync -avz dist/ vutt:~/VUTT/dist/
   ```

3. **Meilisearch searchableAttributes** ei vaja kohe uuendamist — `archive_refs_text` indekseeritakse uutele/uuendatud teostele automaatselt. Täis reindeks (`scripts/2-1_upload_to_meili.py`) ainult siis kui soovitakse vanadele teostele ka otsingut.

4. **`data/config/archives.json`** on gitis ja läheb pullimisega serverile kaasa.
