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

Work status is recalculated on every page save and propagated to all pages of that work.

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
