# CLAUDE.md

Estonian early modern text transcription workbench (React/TypeScript SPA). UI: Estonian + English. Code comments: Estonian.

## Commands

```bash
npm install && npm run dev    # Frontend dev (localhost:5173)
npm run build                 # Production build to dist/
./start_services.sh           # Start all backend services

# Individual services
docker compose up meilisearch       # Port 7700
python3 server/file_server.py       # Port 8002
python3 server/image_server.py      # Port 8001

# Data sync
python3 scripts/sync_meilisearch.py --apply  # Sync filesystem with Meilisearch
```

## Architecture

```
Frontend (Vite + React 19 + TypeScript + Tailwind)
├── Meilisearch (7700) - Search & metadata (index: teosed)
├── Image Server (8001) - Scanned .jpg images
└── File Server (8002) - Edits, auth, backups
    ↓
Filesystem: data/{work-folder}/{page}.txt + .jpg + .json + _metadata.json
```

**Key IDs:**
- `work_id` (nanoid) - used everywhere: routing, filters, API
- `slug` (folder name) - only in filesystem

## Data Layers

```
_metadata.json (V2 English)     →  Meilisearch (Estonian fields)  →  Frontend (V2)
title, year, creators[]            pealkiri, aasta, autor            title, year
```

Meilisearch uses Estonian field names (legacy). Frontend maps them. Don't change Meilisearch schema without full reindex.

## Key Files

| Location | Purpose |
|----------|---------|
| `src/pages/` | Dashboard, Workspace, SearchPage, Statistics, Review, Admin |
| `src/services/meiliService.ts` | All Meilisearch operations |
| `src/services/collectionService.ts` | Collection helpers, color classes |
| `src/contexts/CollectionContext.tsx` | Collection state (React Context) |
| `src/components/EntityPicker.tsx` | Wikidata linked data picker |
| `server/file_server.py` | Main HTTP server, all endpoints |
| `server/git_ops.py` | Git version control |
| `server/meilisearch_ops.py` | Meilisearch sync, watcher |
| `state/` | users.json, collections.json, vocabularies.json |
| `scripts/reconcile_authors.py` | WIP: Author → Wikidata/VIAF linking |

## Linked Data (Wikidata)

All metadata fields support LinkedEntity objects:
```json
{ "label": "Tartu", "id": "Q3258", "labels": {"et": "Tartu", "en": "Tartu"}, "source": "wikidata" }
```

Supported: `genre`, `type`, `location`, `publisher`, `tags`, `creators[]`

Links: Wikidata (`Q12345`), VIAF (`viaf:12345`), Album Academicum (`AA:123` - no public URL)

## Collections

Hierarchical collections with configurable colors. State managed via `CollectionContext`.

**Config:** `state/collections.json` (not in git, copy manually via scp)

```json
{
  "academia-gustaviana": {
    "name": { "et": "Academia Gustaviana", "en": "Academia Gustaviana" },
    "parent": "universitas-dorpatensis-1",
    "color": "amber"
  }
}
```

**Colors:** Tailwind color names (`red`, `amber`, `teal`, `violet`, etc.). Default: `indigo`.

**Usage:**
```tsx
import { getCollectionColorClasses } from '../services/collectionService';
const { bg, text, border, hoverBg } = getCollectionColorClasses(collection);
// Returns: { bg: 'bg-amber-50', text: 'text-amber-700', ... }
```

Collection displayed in: Dashboard cards, Workspace info panel, SearchPage results, Header indicator.

## Person Aliases & People Register

To handle historical name variants (e.g., *Lorenz Luden* vs *Laurentius Ludenius*), the system uses a central register.

**File:** `state/people.json` (not in git, persistent storage)

**Workflow:**
1. Admin saves metadata with a Wikidata/GND ID.
2. Server (`people_ops.py`) automatically fetches aliases in background (only for `et`, `en`, `de`, `la`).
3. Aliases are saved to `state/people.json` under all associated IDs (cross-referencing).
4. Meilisearch indexer (`meilisearch_ops.py`) reads this file and adds aliases to `authors_text` field.

**Search:**
- Users can search for any variant (e.g., "Ludenius").
- Search result shows the canonical name from `_metadata.json` (e.g., "Lorenz Luden").
- Author filter sidebar shows only the canonical names to avoid duplicates.

## Authentication

- Roles: `editor` < `admin`
- Token-based (UUID, 24h expiry)
- localStorage: `vutt_user`, `vutt_token`

## Git Version Control

- Every save commits both `.txt` and `.json` to git
- `_metadata.json` changes also tracked
- First commit = original OCR (always restorable)
- Admin can restore via "Ajalugu" tab in Workspace

## i18n

```tsx
const { t } = useTranslation(['workspace', 'common']);
t('tabs.edit')  // From workspace namespace
t('common:status.Valmis')  // From common namespace
```

Files: `src/locales/{et,en}/*.json`

## Common Patterns

**Adding new field:**
1. `types.ts` - add to interface
2. `meiliService.ts` - add to attributesToRetrieve
3. `1-1_consolidate_data.py` - if from filesystem
4. Component - display it

**Adding translations:**
1. Add to both `locales/et/` and `locales/en/`
2. Use `t('key')` in component

## Security Notes

- HTTPS + HSTS enabled
- Rate limiting on auth endpoints
- Meilisearch: frontend uses search-only API key
- Backend ports (7700, 8001, 8002) not exposed

## Performance Optimizations

Server on optimeeritud ~300 samaaegse kasutaja jaoks. Tehtud optimeeringud:

**Async Meilisearch sync** (`file_server.py`)
- `/save` ei blokeeru enam Meilisearch indekseerimist oodates
- `ThreadPoolExecutor` (max 10 töötajat) piirab samaagseid päringuid
- Kasutaja saab vastuse kohe pärast Git commit'i (~100-500ms vs varem kuni 30s)

**Cache'imine**
- `users.json` - laetakse stardil, uuendatakse ainult muudatuste korral (`auth.py`)
- `collections.json`, `vocabularies.json` - cache TTL 5 min (`file_server.py`)
- `people.json` - loetakse üks kord sync'i alguses, mitte iga lehe kohta (`meilisearch_ops.py`)

**Automaatne puhastus (daemon threads)**
- Aegunud sessioonid - iga 5 min (`auth.py`)
- Tühjad rate limit IP kirjed - iga 10 min (`rate_limit.py`)

**Konfigureeritavad konstandid:**
```python
# file_server.py
MEILISEARCH_POOL_SIZE = 10      # Max samaagseid Meilisearch päringuid
CACHE_TTL_SECONDS = 300          # Collections/vocabularies cache TTL

# auth.py
SESSION_CLEANUP_INTERVAL = 300   # Sessioonide puhastuse intervall

# rate_limit.py
RATE_LIMIT_CLEANUP_INTERVAL = 600  # Rate limit puhastuse intervall
```

## TODO

| Task | Priority |
|------|----------|
| Automatic backup system | High (waiting for IT) |
| JSON cleanup (page_number removal) | Low |
| Code fallback removal | Low |

### Skaleerimise TODO (kui koormus kasvab)

| Task | Millal vaja |
|------|-------------|
| Vaheta `http.server` → FastAPI/Flask + gunicorn | Kui Python GIL hakkab piirama (>500 kasutajat) |
| Lisa Redis sessioonide ja cache jaoks | Kui vaja mitut serveri instantsi (horisontaalne skaleerimine) |
| Lisa metrics endpoint (Prometheus) | Kui vaja jälgida mälukasutust ja jõudlust tootmises |

## Implemented ✅

- Wikidata integration (all fields including creators)
- VIAF links
- Collections (hierarchical, with colors)
- Collection display in WorkCard, AnnotationsTab, SearchPage
- JSON files in git (txt + json same commit, _metadata.json tracked)
- Metadata changes in Review page (yellow badge)
- Search filters: type multi-select, facets preserve all options
- File permissions fix (chmod 644 after writes)
- Server performance optimizations (async Meilisearch, caching, cleanup threads)
