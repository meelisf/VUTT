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
- React Router with `MemoryRouter` (not BrowserRouter)
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
- User session stored in `localStorage` key `vutt_user`
- **Auth credentials** stored in memory via `UserContext.authCredentials` (not in localStorage for security)

#### Role Hierarchy
```
viewer < editor < admin
```
- `viewer` - Can view documents (read-only)
- `editor` - Can save/edit documents
- `admin` - Can restore backups, manage versions

#### API Authentication
All write endpoints require `auth_user` + `auth_pass` in request body:
- `/save` - requires `editor` role minimum
- `/backups` - requires `admin` role
- `/restore` - requires `admin` role

**Important**: After page refresh, user must re-login for API calls to work (credentials are kept in memory only).

### Backup & Version Control
- On each save, `file_server.py` creates `.backup.YYYYMMDD_HHMMSS` files
- Maximum 10 backups per file: 1 original (oldest, protected) + 9 recent
- Original version is never deleted (protection against data loss)
- Admin can restore any backup via "Ajalugu" tab in TextEditor
- Restore loads text into editor; user must click "Salvesta" to persist

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
