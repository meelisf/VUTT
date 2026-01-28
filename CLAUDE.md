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

## TODO

| Task | Priority |
|------|----------|
| Automatic backup system | High (waiting for IT) |
| JSON cleanup (page_number removal) | Low |
| Code fallback removal | Low |

## Implemented ✅

- Wikidata integration (all fields including creators)
- VIAF links
- Collections (hierarchical)
- JSON files in git (txt + json same commit, _metadata.json tracked)
- Metadata changes in Review page (yellow badge)
- Search filters: type multi-select, facets preserve all options
