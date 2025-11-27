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
1. **Dashboard** (`pages/Dashboard.tsx`) - Lists all works from Meilisearch using `distinct: 'teose_id'`
2. **Workspace** (`pages/Workspace.tsx`) - Split view: image left, text editor right
3. **Saving**: `meiliService.savePage()` → updates Meilisearch → calls `file_server.py` to persist `.txt` and `.json` files

### Meilisearch Schema (index: `teosed`)
Documents represent individual pages with fields:
- `id`, `teose_id` (work ID), `lehekylje_number` (page number), `teose_lehekylgede_arv` (total pages)
- `lehekylje_tekst` (page text), `lehekylje_pilt` (image path)
- `pealkiri`, `autor`, `respondens`, `aasta`, `originaal_kataloog` (metadata)
- `tags`, `comments`, `status`, `history`, `last_modified` (annotations)

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
- **Current model**: Anonymous users can view, logged-in users can edit (role enforcement planned)

### Page Status Workflow
```typescript
enum PageStatus {
  RAW = 'Toores',        // Unprocessed
  IN_PROGRESS = 'Töös', // Being edited
  CORRECTED = 'Parandatud',
  ANNOTATED = 'Annoteeritud',
  DONE = 'Valmis'       // Complete
}
```

## File Structure

- `/pages/` - Route-level components (Dashboard, Workspace, SearchPage, Statistics)
- `/components/` - Reusable UI (ImageViewer, TextEditor, WorkCard, LoginModal)
- `/services/` - API/data layer (meiliService.ts is the primary one)
- `/contexts/` - React Context providers
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
