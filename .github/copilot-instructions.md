# VUTT - Varauusaegsete Tekstide Töölaud

## Project Overview

VUTT is an Estonian early modern text transcription workbench. It's a React/TypeScript SPA for viewing scanned historical documents and editing their OCR-transcribed text. The UI and comments are in **Estonian**.

## Architecture

```
Frontend (Vite + React 19)
    ↓
├── Meilisearch (port 7700) - Full-text search & document storage
├── Image Server (port 8001) - Serves scanned document images  
└── File Server (port 8002) - Persists edits to filesystem + user auth
```

### Data Storage
- **Source data**: `/home/mf/Dokumendid/LLM/tartu-acad/data/04_sorditud_dokumendid/` (server-side persistent)
- **Meilisearch binary**: `/home/mf/Dokumendid/LLM/tartu-acad/meilisearch`
- Each work is a folder containing `.txt` (OCR text), `.jpg` (scans), and `.json` (annotations/metadata)

### Key Data Flow
1. **Dashboard** (`pages/Dashboard.tsx`) - Lists works, uses `distinct: 'teose_id'` per-query (not global)
2. **Workspace** (`pages/Workspace.tsx`) - Split view: image left, text editor right
3. **Saving**: `meiliService.savePage()` → updates Meilisearch → calls `file_server.py` to persist `.txt` and `.json` files

### Meilisearch Configuration
- **No global `distinctAttribute`** - use `distinct: 'teose_id'` in individual queries where needed
- `getWorkStatuses()` requires querying all pages per work, so distinct must NOT be set globally

#### Dashboard First Page Fetching
The `searchWorks()` function uses a two-step approach:
1. **First query**: Find works with `distinct: 'teose_id'`, sorted by user preference (recent/year/az)
2. **Second query**: Fetch first page data (thumbnail, tags) for each work, sorted by `lehekylje_number:asc`

This is necessary because Meilisearch `distinct` returns whichever document matches the sort order first - if sorting by `last_modified:desc`, it returns the most recently edited page, not the first page. The second query ensures Dashboard always shows the first page's thumbnail and tags regardless of which page was last modified.

The second query is batched (100 work IDs per request) and executed in parallel for performance.

#### Full-Text Search (`pages/SearchPage.tsx`)
The `searchContent()` function supports two modes:

**Grouped mode** (default): Shows 10 works per page with accordions
- Two parallel queries: facets query (limit=0) + distinct query
- Each work shows first hit, accordion expands to show up to 10 more hits
- `hitCount` from facets shows total matches per work
- "Otsi kõik X vastet sellest teosest" link for works with >10 hits

**Work filter mode** (`workId` parameter): Shows all hits from one work
- Single query without `distinct`, 20 hits per page
- Detailed work info in status bar (title, author, year, ID)
- Same UI, just filtered to one work

**Sidebar filters**:
- Otsingu ulatus (scope): all / original text only / annotations only
- Ajavahemik (year range): start/end year inputs
- Teos (work): radio buttons with hit counts, sorted by relevance

**UX details**:
- Accordion toggle preserves scroll position (saves scrollTop before state change, restores after DOM update)
- "Tühjenda filtrid" button appears when any filter is active
- Work filter integrates with URL params (`?work=teose_id`)

### Meilisearch Schema (index: `teosed`)
Documents represent individual pages with fields:
- `id`, `teose_id` (work ID), `lehekylje_number` (page number), `teose_lehekylgede_arv` (total pages)
- `lehekylje_tekst` (page text), `lehekylje_pilt` (image path)
- `pealkiri`, `autor`, `respondens`, `aasta`, `originaal_kataloog` (metadata)
- `tags`, `comments`, `status`, `history`, `last_modified` (annotations)
- `teose_staatus` (denormalized work-level status: 'Toores' | 'Töös' | 'Valmis')

## Development

```bash
npm install
npm run dev        # Vite dev server (default: localhost:5173)
npm run build      # Production build to dist/
```

### Backend Services
Configure server IPs in `config.ts`. Start all services:
```bash
./start_services.sh  # Starts meilisearch + python servers (logs → ./logs/)
```

### Data Initialization
To rebuild Meilisearch index from source files:
```bash
# 1. Generate JSONL from filesystem (reads data/ folder structure)
python3 1-1_consolidate_data.py   # Output: output/meilisearch_data_per_page.jsonl

# 2. Upload to Meilisearch (requires .env with MEILISEARCH_URL, MEILISEARCH_MASTER_KEY)
python3 2-1_upload_to_meili.py    # Recreates 'teosed' index
```

## Conventions

### TypeScript/React Patterns
- Functional components with hooks, no class components
- State management via React Context (`UserContext.tsx`)
- React Router with `BrowserRouter` - supports browser back/forward buttons
- Icons from `lucide-react`
- Styling: Tailwind CSS with custom `primary-*` color palette

### Service Layer (`services/meiliService.ts`)
- All Meilisearch operations go through this module
- Uses lazy settings initialization (`ensureSettings()`)
- Image URLs built with `getFullImageUrl()` helper
- Mixed content (HTTPS/HTTP) validation at runtime

### Authentication & Access Control
- SHA-256 password hashing (see `users.json` structure)
- Login handled by `file_server.py /login` endpoint
- **Token-based authentication**: Login returns a session token (UUID)
- User session stored in `localStorage`: `vutt_user` (user info) + `vutt_token` (auth token)
- Token verified on page load via `/verify-token` endpoint
- Sessions expire after 24 hours

#### Role Hierarchy
```
viewer < editor < admin
```
- `viewer` - Can view documents (read-only)
- `editor` - Can save/edit documents
- `admin` - Can restore backups, manage versions

#### API Authentication
All write endpoints require `auth_token` in request body:
- `/save` - requires `editor` role minimum
- `/backups` - requires `admin` role
- `/restore` - requires `admin` role
- `/verify-token` - validates token and returns user info

Token is stored in localStorage and persists across page refreshes.

### Backup & Version Control
- On each save, `file_server.py` creates `.backup.YYYYMMDD_HHMMSS` files
- **Original protection**: `.backup.ORIGINAL` preserves the first version (OCR output) forever
- Maximum 10 timestamped backups per file (ORIGINAL doesn't count toward limit)
- Admin can restore any backup via "Ajalugu" tab in TextEditor
- Restore loads text into editor; user must click "Salvesta" to persist
- Migration script: `scripts/create_original_backups.py` creates ORIGINAL backups for existing files

### Special Characters & Transcription Guide
- **`public/special_characters.json`** - configurable character palette for text editor
- **`public/transcription_guide.html`** - transcription rules (loaded dynamically, editable without code changes)
- TextEditor shows "Erimärgid | Transkribeerimise juhend" below the text area
- Clicking a character inserts it at cursor position

#### Hyphenation marks in Meilisearch
- `-` (hyphen) and `⸗` (two-em dash) work correctly for search across line breaks
- `¬` (negation sign) does NOT work - Meilisearch treats it as a word separator
- Use `scripts/replace_negation_sign.py` to convert `¬` → `-` in corpus

### Page Status Workflow
```typescript
enum PageStatus {
  RAW = 'Toores',        // Unprocessed
  IN_PROGRESS = 'Töös', // Being edited
  CORRECTED = 'Parandatud',
  ANNOTATED = 'Annoteeritud',
  DONE = 'Valmis'       // Complete
}

// Work-level status (computed from page statuses)
type WorkStatus = 'Toores' | 'Töös' | 'Valmis';
// Logic: All pages Valmis → Valmis, All pages Toores → Toores, otherwise → Töös
```

Work status is denormalized: `teose_staatus` is stored on every page document for fast filtering. When a page is saved, `savePage()` recalculates and updates `teose_staatus` on all pages of that work.

## File Structure

- `/pages/` - Route-level components (Dashboard, Workspace, SearchPage, Statistics)
- `/components/` - Reusable UI (ImageViewer, TextEditor, WorkCard, LoginModal)
- `/services/` - API/data layer (meiliService.ts is the primary one)
- `/contexts/` - React Context providers
- `/scripts/` - Migration and utility scripts
- `/public/` - Static assets (special_characters.json, transcription_guide.html)
- `*.py` - Backend servers (simple http.server based)
- `1-1_consolidate_data.py`, `2-1_upload_to_meili.py` - Data pipeline scripts

## Common Tasks

### Adding a new page field
1. Update `types.ts` interface (`Page` or `Work`)
2. Add to `meiliService.ts` attribute lists (searchable/filterable/retrievable)
3. Add to `1-1_consolidate_data.py` if field comes from filesystem
4. Update `TextEditor.tsx` or relevant component

### Modifying search behavior
- Dashboard search: `searchWorks()` - searches `pealkiri`, `autor`, `respondens`
- Full-text search: `searchContent()` - searches `lehekylje_tekst`, `tags`, `comments.text`

### Adding users
Edit `users.json`:
```json
{
  "username": {
    "password_hash": "<sha256-of-password>",
    "name": "Display Name",
    "role": "admin|editor|viewer"
  }
}
```
Generate hash: `echo -n "password" | sha256sum`
