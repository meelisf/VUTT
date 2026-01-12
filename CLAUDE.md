# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VUTT (Varauusaegsete Tekstide Töölaud) is an Estonian early modern text transcription workbench. It's a React/TypeScript SPA for viewing scanned historical documents and editing their OCR-transcribed text. **The UI and code comments are in Estonian.**

**Development workflow**: Development happens on a local laptop. For testing, code is manually copied to the server.

## Commands

```bash
# Frontend development
npm install           # Install dependencies
npm run dev           # Vite dev server (localhost:5173)
npm run build         # Production build to dist/

# Start all backend services
./start_services.sh   # Starts meilisearch + python servers

# Or start services individually:
docker compose up meilisearch   # Meilisearch on port 7700
python3 file_server.py          # File server on port 8002
python3 image_server.py         # Image server on port 8001

# Data management
python3 scripts/sync_meilisearch.py          # Compare Meilisearch with filesystem (dry-run)
python3 scripts/sync_meilisearch.py --apply  # Apply sync changes

# Full re-indexing (if needed)
python3 1-1_consolidate_data.py  # Generate JSONL from filesystem
python3 2-1_upload_to_meili.py   # Upload to Meilisearch

# Generate password hash for users.json
echo -n "password" | sha256sum
```

## Architecture

```
Frontend (Vite + React 19 + TypeScript + Tailwind CSS)
    ↓ Nginx (production) or direct (dev)
├── Meilisearch (7700) - Full-text search & document metadata
├── Image Server (8001) - Serves scanned .jpg images
└── File Server (8002) - Persists edits, auth, backups, auto-indexing
    ↓
Filesystem: data/{work-folder}/{page}.txt + {page}.jpg + {page}.json
```

### Key Data Flow

1. **Dashboard** → `meiliService.searchWorks()` → Meilisearch with `distinct: 'teose_id'`
2. **Workspace** → Split view: ImageViewer (left) + TextEditor (right)
3. **Saving** → `meiliService.savePage()` → Updates Meilisearch → `file_server.py` persists .txt/.json

### Meilisearch Configuration

- Index name: `teosed` (documents = individual pages, not works)
- **No global `distinctAttribute`** - use `distinct: 'teose_id'` per-query where needed
- Ranking rules: `exactness` first (not default) to prioritize exact matches
- Relevance sorting skips `distinct` and deduplicates in frontend to preserve ranking order

### Page vs Work

Each Meilisearch document is a **page** with fields:
- `teose_id` (work ID), `lehekylje_number` (page number)
- `lehekylje_tekst` (text), `lehekylje_pilt` (image path)
- `teose_staatus` (denormalized work status: 'Toores' | 'Töös' | 'Valmis')
- `teose_tags` (work-level genre tags: string[])
- `koht` (printing place: Tartu / Pärnu), `trükkal` (printer name)

Work status is recalculated on every page save and propagated to all pages of that work.

### Metadata Modal (Admin)
Admin users can edit work metadata via the pencil icon in Workspace:

**Bibliographic fields:**
- Pealkiri, Autor, Respondens, Aasta
- Koht (printing place), Trükkal (printer)
  - Auto-suggested: Tartu/Pärnu for places; historical printers by year

**Classification & links:**
- Žanrid/Tagid (genre tags, comma-separated)
- ESTER ID, External URL

The modal saves to `_metadata.json` and syncs to Meilisearch.

### COinS (Zotero Integration)
Workspace includes hidden COinS metadata for Zotero browser connector:
- `rft.au` = author (praeses)
- `rft.contributor` = respondens
- `rft.place` = printing place (koht)
- `rft.pub` = printer (trükkal)

## File Structure

- `/pages/` - Route components: Dashboard, Workspace, SearchPage, Statistics
- `/components/` - UI: ImageViewer, TextEditor, MarkdownPreview, LoginModal, WorkCard
- `/services/meiliService.ts` - All Meilisearch operations
- `/contexts/UserContext.tsx` - Authentication state
- `/scripts/` - Migration and utility scripts
- `file_server.py` - File persistence + auth + auto-indexing background thread
- `image_server.py` - Image serving with CORS
- `config.ts` - Server URLs with `DEPLOYMENT_MODE`: 'nginx' (HTTPS) or 'direct' (HTTP internal)

## Key Patterns

### Authentication
- Token-based (UUID session tokens, 24h expiry)
- Roles: `viewer` < `editor` < `admin`
- localStorage: `vutt_user` + `vutt_token`
- Write endpoints require `auth_token` in request body

### MarkdownPreview (Line-by-Line Strict Renderer)
The text viewer uses a stateful parser for 1:1 line alignment with line numbers:
- Each line rendered in fixed-height container (1.7em)
- Multi-line styles (bold, italic) tracked across line boundaries
- Marginalia `[[m: ...]]` displayed inline with yellow background

### Backup System
- On save: creates `.backup.YYYYMMDD_HHMMSS` files
- `.backup.ORIGINAL` preserves first version forever
- Max 10 timestamped backups per file
- Admin restores via "Ajalugu" tab (loads into editor, must save to persist)

### Genre Tags (teose_tags)
Source: `_metadata.json` in each work folder (auto-created if missing, with tags derived from title).
Auto-detection: `Disputatio...` → `disputatsioon`, `Oratio...` → `oratsioon`, etc.

### Adding New Works
Simply copy the folder to the data directory. The `file_server.py` background watcher will:
1. Detect new folders without `_metadata.json`
2. Auto-generate `_metadata.json` from folder name
3. Index all pages into Meilisearch

For manual file reorganization (moving pages between works), run:
```bash
python3 scripts/sync_meilisearch.py --apply
```

### Dashboard Search
- Two-step fetch: first query finds works (distinct), second fetches first-page thumbnails
- Relevance sort bypasses `distinct` for accurate ranking

### Full-Text Search (SearchPage)
- Grouped mode: 10 works/page with accordions, facets query for hit counts
- Work filter mode: all hits from one work without distinct
- Sidebar: scope (all/text/annotations), year range, genre checkboxes, work filter

## Common Tasks

### Adding a new page field
1. Update `types.ts` interface (`Page` or `Work`)
2. Add to `meiliService.ts` attribute lists
3. Add to `1-1_consolidate_data.py` if field comes from filesystem
4. Update relevant component

### Adding users
Edit `users.json` with SHA-256 hashed password:
```json
{
  "username": {
    "password_hash": "<sha256>",
    "name": "Display Name",
    "role": "admin|editor|viewer"
  }
}
```

### Hyphenation in search
- `-` and `⸗` work for cross-line search
- `¬` does NOT work (Meilisearch treats as word separator)
- Use `scripts/replace_negation_sign.py` to convert

## Security

### Current Implementation
- **Session tokens**: UUID-based, 24h expiry (checked in `require_token()`)
- **Password hashing**: SHA-256 (no salt) - adequate for internal use
- **Role hierarchy**: viewer (0) < editor (1) < admin (2)
- **Path traversal protection**: `os.path.basename()` on all file paths
- **No default users**: `users.json` must exist, no auto-creation

### Production Checklist (see `deployment_guide.md`)
- [ ] HTTPS enabled (domain: `vutt.utlib.ut.ee`)
- [ ] Backend ports (7700, 8001, 8002) closed from outside
- [ ] CORS restricted to specific domain in `file_server.py`
- [ ] Strong passwords in `users.json`
- [ ] Meilisearch master key in `.env`

### CORS TODO
When domain is finalized, update `file_server.py` class `RequestHandler`:
```python
allowed_origins = ['https://vutt.utlib.ut.ee']
origin = self.headers.get('Origin')
if origin in allowed_origins:
    self.send_header('Access-Control-Allow-Origin', origin)
```

### Meilisearch Index Settings
If adding new filterable fields, update `meiliService.ts`:
1. Add to `filterableAttributes` in `fixIndexSettings()`
2. Add to `requiredFilter` array (triggers auto-update check)
3. After deploy: settings update on page load, or manually via curl:
```bash
curl -X PATCH 'http://HOST:7700/indexes/teosed/settings' \
  -H 'Content-Type: application/json' \
  --data '{"filterableAttributes": ["aasta","autor","respondens","trükkal",...]}'
```

## Deployment

### Target: vutt.utlib.ut.ee
- Production server managed by UT Library
- Docker Compose deployment (Nginx + Meilisearch + Python backends)
- Data folder: `./data/` mounted as `/data` in container

### Key Files for Deployment
- `docker-compose.yml` - Service definitions
- `nginx.conf` - Reverse proxy config
- `Dockerfile` - Python backend image
- `users.json` - User credentials (not in git!)
- `.env` - Meilisearch key (not in git!)
- `dist/` - Built frontend (run `npm run build` first)

### Backups
- Images (~25GB): One-time copy, rarely changes
- Text/JSON: Incremental rsync nightly
- Meilisearch: No backup needed - rebuilds from files
- App creates `.backup.*` files automatically (max 10 + original)

### Dashboard Filters
Supports URL parameters: `?author=`, `?respondens=`, `?printer=`, `?status=`, `?teoseTags=`
Clickable links in Workspace "Info ja annotatsioonid" tab navigate to filtered Dashboard.

## Future Ideas

### ESTER Integration (TODO)
Currently `ester_id` is manually added. Planned improvement:
- Add "Search ESTER" button in admin metadata modal
- Query ESTER API (SRU?) by year + title keywords
- Show candidates, admin picks correct match
- Save `ester_id` to `_metadata.json`

**NB:** ESTER data doesn't map 1:1 to VUTT:
- Names spelled differently (Menius vs Mein)
- ESTER lists respondens as author (not praeses)
- Consider these differences when displaying ESTER links
