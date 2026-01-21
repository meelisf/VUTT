# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VUTT (Varauusaegsete Tekstide Töölaud) is an Estonian early modern text transcription workbench. It's a React/TypeScript SPA for viewing scanned historical documents and editing their OCR-transcribed text. **The UI supports Estonian and English; code comments are in Estonian.**

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
docker compose up meilisearch       # Meilisearch on port 7700
python3 server/file_server.py       # File server on port 8002
python3 server/image_server.py      # Image server on port 8001

# Data management
python3 scripts/sync_meilisearch.py          # Compare Meilisearch with filesystem (dry-run)
python3 scripts/sync_meilisearch.py --apply  # Apply sync changes

# Full re-indexing (if needed)
python3 scripts/1-1_consolidate_data.py  # Generate JSONL from filesystem
python3 scripts/2-1_upload_to_meili.py   # Upload to Meilisearch

# Generate password hash for state/users.json
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

### teose_id Handling
**Single source of truth:** `_metadata.json` contains the canonical `teose_id`.

The `teose_id` is the sanitized version of the folder name (diacritics removed, special chars → underscore).
All components read `teose_id` from `_metadata.json`, NOT from folder names directly.

**Migration script:** `scripts/migrate_teose_id.py` adds `teose_id` to existing `_metadata.json` files.
```bash
python3 scripts/migrate_teose_id.py           # Dry-run
python3 scripts/migrate_teose_id.py --apply   # Apply changes
```

**Why:** Folder names can contain special characters, but Meilisearch IDs and URLs need sanitized versions.
Previously, `git_ops.py` used raw folder names while Meilisearch used sanitized IDs → mismatch in URLs.

### Metadata Modal (Admin)
Admin users can edit work metadata via the pencil icon in Workspace:

**Creators (v2 format):**
- Dynamic list of creators with roles (praeses, respondens, auctor, gratulator, etc.)
- Role dropdown populated from `state/vocabularies.json`
- Auto-suggested names from existing data

**Bibliographic fields:**
- Title (pealkiri), Year (aasta)
- Location (koht), Publisher (trükkal)
  - Auto-suggested: Tartu/Pärnu for places; historical printers

**Classification:**
- Type: impressum / manuscriptum (from vocabularies)
- Genre: disputatio, oratio, carmen, etc. (from vocabularies)
- Languages: multi-select checkboxes (lat, deu, est, grc, etc.)
- Tags: free-form comma-separated keywords
- Collection: dropdown from `state/collections.json`

**External links:**
- ESTER ID, External URL

The modal saves in v2 format to `_metadata.json` and syncs to Meilisearch.

### _metadata.json Formaadid (v1 vs v2)

**MIGRATSIOON TEHTUD:** Kõik `_metadata.json` failid on nüüd v2 formaadis. Koodis on veel v1 fallback-tugi turvavõrguna, kuid seda ei peaks praktikas vaja minema.

#### Formaadid

- **v1 (eestikeelne):** ~~Vana formaat~~ - enam ei kasutata
- **v2 (ingliskeelne):** **Aktiivne formaat.** Kasutab ingliskeelseid nimesid (`title`, `year`, `tags`) ja struktureeritud `creators` massiivi

#### Migratsiooniskript

`scripts/migrate_metadata_v2.py` - konverteerib v1 → v2 (juba käivitatud)

#### Väljade võrdlustabel

| Väli | v1 (eestikeelne) | v2 (ingliskeelne) | Meilisearch väli |
|------|------------------|-------------------|------------------|
| Püsiv ID | - | `id` (nanoid) | `work_id` |
| Slug | `teose_id` | `slug` / `teose_id` | `teose_id` |
| Pealkiri | `pealkiri` | `title` | `pealkiri` |
| Aasta | `aasta` | `year` | `aasta` |
| Autor | `autor` | `creators[role=praeses].name` | `autor` |
| Respondens | `respondens` | `creators[role=respondens].name` | `respondens` |
| Trükikoht | `koht` | `location` | `koht` |
| Trükkal | `trükkal` | `publisher` | `trükkal` |
| Žanr | - | `genre` | `genre` |
| Märksõnad | `teose_tags` | `tags` | `teose_tags` |
| Kollektsioon | `collection` | `collection` | `collection` |
| ESTER | `ester_id` | `ester_id` | `ester_id` |

**Staatus:** `genre` ja `tags` on eraldi väljad. Workspace metadata modaal toetab mõlemat (2026-01-21). Dashboard ja Search filtrid vajavad veel uuendamist.

#### Näide: v1 _metadata.json
```json
{
  "teose_id": "1635-virginus-manipulus",
  "pealkiri": "Manipulus Florum...",
  "aasta": 1635,
  "autor": "Virginius, Georg",
  "respondens": "Schomerus, Johannes",
  "koht": "Tartu",
  "trükkal": "Jacob Becker",
  "teose_tags": ["disputatsioon"],
  "ester_id": "b12345678"
}
```

#### Näide: v2 _metadata.json
```json
{
  "id": "x9r4mk2p",
  "teose_id": "1635-virginus-manipulus",
  "title": "Manipulus Florum...",
  "year": 1635,
  "location": "Tartu",
  "publisher": "Jacob Becker",
  "creators": [
    {"name": "Virginius, Georg", "role": "praeses"},
    {"name": "Schomerus, Johannes", "role": "respondens"}
  ],
  "tags": ["disputatsioon"],
  "collection": "academia-gustaviana",
  "ester_id": "b12345678"
}
```

#### Lugemisloogika (v2 esmalt, v1 fallback)

**UUENDATUD 2026-01-20:** Kõik `_metadata.json` failid on nüüd v2 formaadis. Kood kasutab v2-esmalt lähenemist, v1 fallback on turvavõrk.

**Python (server/):**
```python
# V2 esmalt, v1 fallback
title = meta.get('title') or meta.get('pealkiri', '')
year = meta.get('year') or meta.get('aasta', 0)
location = meta.get('location') or meta.get('koht')
publisher = meta.get('publisher') or meta.get('trükkal')
tags = meta.get('tags') or meta.get('teose_tags', [])

# Autor/respondens: v2 creators esmalt
creators = meta.get('creators', [])
autor = ''
respondens = ''
if creators:
    praeses = next((c for c in creators if c.get('role') == 'praeses'), None)
    resp = next((c for c in creators if c.get('role') == 'respondens'), None)
    if praeses: autor = praeses.get('name', '')
    if resp: respondens = resp.get('name', '')
# v1 fallback
if not autor: autor = meta.get('autor', '')
if not respondens: respondens = meta.get('respondens', '')
```

**TypeScript (src/):**
```typescript
// V2 esmalt, v1 fallback
const title = m.title ?? m.pealkiri ?? '';
const year = m.year ?? m.aasta ?? 0;
const location = m.location ?? m.koht ?? '';
const publisher = m.publisher ?? m.trükkal ?? '';
const tags = m.tags ?? m.teose_tags ?? [];

// Autor/respondens: v2 creators esmalt
let autor = '';
let respondens = '';
if (Array.isArray(m.creators) && m.creators.length > 0) {
  const praeses = m.creators.find((c: any) => c.role === 'praeses');
  const resp = m.creators.find((c: any) => c.role === 'respondens');
  if (praeses) autor = praeses.name;
  if (resp) respondens = resp.name;
}
// v1 fallback
if (!autor) autor = m.autor ?? '';
if (!respondens) respondens = m.respondens ?? '';
```

#### Server normaliseerib salvestamisel

`/update-work-metadata` endpoint eemaldab v1 väljad kui v2 on olemas:
- `title` olemas → `pealkiri` eemaldatakse
- `year` olemas → `aasta` eemaldatakse
- `creators` olemas → `autor`, `respondens` eemaldatakse
- jne

#### Failid, kus v2 tugi on implementeeritud

| Fail | Funktsioon | Staatus | Märkused |
|------|------------|---------|----------|
| `server/meilisearch_ops.py` | `sync_work_to_meilisearch()` | ✅ | v2-first lugemine |
| `server/file_server.py` | `/update-work-metadata` | ✅ | v1→v2 normaliseerimine |
| `scripts/1-1_consolidate_data.py` | `get_work_metadata()` | ✅ | v2-first lugemine |
| `src/pages/Workspace.tsx` | `handleSaveMetadata()` | ✅ | Saadab v2 formaadis |

#### Uue koodi kirjutamisel

1. **Kirjuta ainult v2 formaadis** (`title`, `year`, `tags`, `creators[]` jne)
2. **Lugemiseks** kasuta v2-first loogika (v1 fallback turvavõrguna)
3. **Meilisearch** kasutab v1 väljanimesid (`pealkiri`, `aasta`, `teose_tags`) - see on indeksi sisemine skeem
2. Uuenda see dokumentatsioon

### COinS (Zotero Integration)
Workspace includes hidden COinS metadata for Zotero browser connector:
- `rft.au` = author (praeses)
- `rft.contributor` = respondens
- `rft.place` = printing place (koht)
- `rft.pub` = printer (trükkal)

## File Structure

### Frontend (`src/`)
- `src/pages/` - Route components: Dashboard, Workspace, SearchPage, Statistics
- `src/components/` - UI: Header, ImageViewer, TextEditor, MarkdownPreview, LoginModal, WorkCard, MetadataModal, CollectionPicker
- `src/components/Header.tsx` - Unified header for all pages (except Workspace/SetPassword)
- `src/services/meiliService.ts` - All Meilisearch operations
- `src/contexts/UserContext.tsx` - Authentication state
- `src/config.ts` - Server URLs with `DEPLOYMENT_MODE`: 'nginx' (HTTPS) or 'direct' (HTTP internal)
- `src/locales/{et,en}/` - Translation files

### Backend (`server/`)
- `server/file_server.py` - Main HTTP server with RequestHandler (endpoints)
- `server/image_server.py` - Image serving with CORS
- `server/config.py` - Configuration (paths, ports, rate limits, CORS origins)
- `server/auth.py` - Sessions, user verification, `require_token()`
- `server/cors.py` - CORS header functions
- `server/rate_limit.py` - IP-based rate limiting
- `server/registration.py` - User registration + invite tokens
- `server/pending_edits.py` - Contributor pending edits management
- `server/git_ops.py` - Git version control operations
- `server/meilisearch_ops.py` - Meilisearch sync, metadata watcher
- `server/utils.py` - Helper functions (sanitize_id, find_directory_by_id)

### State (`state/`)
- `state/users.json` - User credentials (not in git!)
- `state/invite_tokens.json` - Active invite links
- `state/pending_registrations.json` - Registration requests awaiting approval
- `state/pending_edits.json` - Reserved for future contributor review system

### Scripts (`scripts/`)
- Migration and utility scripts
- `scripts/sync_meilisearch.py` - Sync filesystem with Meilisearch
- `scripts/1-1_consolidate_data.py` - Generate JSONL from filesystem
- `scripts/2-1_upload_to_meili.py` - Upload to Meilisearch

### Docs (`docs/`)
- `docs/deployment_guide.md` - Production deployment instructions
- `docs/PLAAN_kasutajahaldus.md` - User management implementation plan

### Root
- `index.html` - Vite entry point
- `package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js` - Build config
- `docker-compose.yml`, `Dockerfile`, `nginx.conf` - Deployment
- `start_services.sh` - Local service launcher
- `public/` - Static assets (transcription_guide.html, special_characters.json)

## Key Patterns

### Authentication
- Token-based (UUID session tokens, 24h expiry)
- Roles: `editor` < `admin`
  - `editor` (toimetaja): direct edits, annotations
  - `admin`: all rights + user management + version restore
- localStorage: `vutt_user` + `vutt_token`
- Write endpoints require `auth_token` in request body

### MarkdownPreview (Line-by-Line Strict Renderer)
The text viewer uses a stateful parser for 1:1 line alignment with line numbers:
- Each line rendered in fixed-height container (1.7em)
- Multi-line styles (bold, italic) tracked across line boundaries
- Marginalia `[[m: ...]]` displayed inline with yellow background

### Version Control (Git)
- On save: creates Git commit with username as author
- First commit per file = original OCR (always restorable)
- Git repo located in `data/04_sorditud_dokumendid/.git`
- Admin restores via "Ajalugu" tab (loads into editor, must save to persist)
- Endpoints: `/git-history`, `/git-restore`, `/git-diff`, `/recent-edits`

### Recent Changes Page (`/review`)
Git-based activity log accessible from user menu:
- **Regular users**: see only their own changes, useful for "where did I leave off"
- **Admin**: sees all users' changes, can filter to own changes
- Each entry links directly to the page for quick continuation
- Endpoint: `GET /recent-edits?token=...&user=...&limit=50`

### Moving Files Between Folders
When reorganizing files (e.g., moving a page to different work):
```bash
cd data/04_sorditud_dokumendid
mv old_folder/page5.txt new_folder/
mv old_folder/page5.jpg new_folder/
git add -A
git commit -m "Move page5 to new_folder"
python3 scripts/sync_meilisearch.py --apply
```
Git detects moves automatically if content is unchanged. History is preserved.

### Internationalization (i18n)
Uses `react-i18next` with translations bundled directly (no HTTP backend).

**Files:**
- `i18n.ts` - Configuration, imports all translation JSONs
- `src/components/LanguageSwitcher.tsx` - Toggle button (Lucide Languages icon + language name)
- `src/locales/{et,en}/*.json` - Translation files by namespace

**Namespaces:** `common`, `auth`, `dashboard`, `workspace`, `search`, `statistics`, `admin`, `register`, `review`

**Usage pattern:**
```tsx
const { t } = useTranslation(['workspace', 'common']);
// Use: t('tabs.edit'), t('common:status.Valmis')
```

**Key details:**
- Default language: Estonian (`et`)
- Language stored in `localStorage` key `vutt_language`
- Status enum values stay in Estonian (DB keys), translated at display: `t('common:status.${status}')`
- LanguageSwitcher placed consistently in top-right corner of all pages
### Unified Header Component
`src/components/Header.tsx` provides a consistent header across all pages (except Workspace and SetPassword which have custom layouts):

**Props:**
- `showSearchButton?: boolean` - Show full-text search button (default: true)
- `pageTitle?: string` - Optional page title displayed after logo
- `pageTitleIcon?: ReactNode` - Optional icon before page title
- `children?: ReactNode` - Content rendered below header (e.g., search form)

**Usage examples:**
```tsx
<Header />                                        // Dashboard: logo + search button + user menu
<Header showSearchButton={false} pageTitle="..." /> // Statistics: logo + title + user menu
<Header showSearchButton={false}>                 // SearchPage: with search form as children
  <div className="...">search form here</div>
</Header>
```

**Includes:** Logo, app name/subtitle, search button, user menu (avatar, Review/Admin links, logout), LanguageSwitcher, LoginModal.
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
**Option 1: Self-registration (recommended)**
1. User registers at `/register`
2. Admin approves at `/admin`
3. User sets password via invite link

**Option 2: Manual (admin creates directly)**
Edit `state/users.json` with SHA-256 hashed password:
```json
{
  "username": {
    "password_hash": "<sha256>",
    "name": "Display Name",
    "email": "user@example.com",
    "role": "editor|admin"
  }
}
```
Hash: `echo -n "password" | sha256sum`

### Adding translations
1. Add keys to both `locales/et/{namespace}.json` and `locales/en/{namespace}.json`
2. Use `t('key')` or `t('namespace:key')` in component
3. For interpolation: `t('greeting', { name: 'John' })` with `"greeting": "Hello {{name}}"`

### Hyphenation in search
- `-` and `⸗` work for cross-line search
- `¬` does NOT work (Meilisearch treats as word separator)
- Use `scripts/replace_negation_sign.py` to convert

## Security

### Current Implementation
- **Session tokens**: UUID-based, 24h expiry (checked in `require_token()`)
- **Password hashing**: SHA-256 (no salt) - adequate for internal use
- **Password requirements**: min 12 chars, min 4 unique chars, no simple patterns
- **Role hierarchy**: contributor (0) < editor (1) < admin (2)
- **Path traversal protection**: `os.path.basename()` on all file paths
- **No default users**: `users.json` must exist, no auto-creation

### User Management Security (added 2026-01-16)
**Implemented:**
- ✅ Registration requires admin approval (no auto-registration)
- ✅ Invite tokens expire in 48h and can only be used once
- ✅ Duplicate email check on registration
- ✅ Email normalization (lowercase)
- ✅ Minimum password length (12 chars) with complexity check
- ✅ All admin endpoints require `min_role='admin'`
- ✅ Editor endpoints require `min_role='editor'`
- ✅ Contributors can only edit text, not change status
- ✅ Rate limiting on `/login`, `/register`, `/invite/set-password` (added 2026-01-17)
- ✅ CORS restricted to allowed origins only (added 2026-01-17)

**Acceptable limitations (internal use):**
- SHA-256 without salt (rainbow table attack requires `users.json` access)
- Sessions stored in memory (server restart logs everyone out)
- JSON files for storage (race conditions unlikely with few users)

### Production Checklist (see `deployment_guide.md`)
- [ ] HTTPS enabled (domain: `vutt.utlib.ut.ee`)
- [x] Backend ports (7700, 8001, 8002) closed from outside
- [x] CORS restricted to specific domains in `server/config.py`
- [ ] Strong passwords in `users.json`
- [ ] Meilisearch master key in `.env`
- [x] Rate limiting enabled (IP-based, in `server/rate_limit.py`)

### Security TODO (for public deployment)

**1. CORS restriction** - ✅ Implemented (2026-01-17)
- Configured in `ALLOWED_ORIGINS` list in `server/config.py`
- Production: `https://vutt.utlib.ut.ee`, `http://vutt.utlib.ut.ee`
- Development: `localhost:5173`, `localhost:3000`, `127.0.0.1:*`
- Uses `send_cors_headers(handler)` from `server/cors.py`
- Only returns `Access-Control-Allow-Origin` if Origin is in allowed list

**2. Rate limiting** - ✅ Implemented (2026-01-17)
- IP-based rate limiting in `server/rate_limit.py`
- Configuration in `RATE_LIMITS` dict (`server/config.py`):
  - `/login`: 5 attempts/minute (brute force protection)
  - `/register`: 3 requests/hour (spam protection)
  - `/invite/set-password`: 5 attempts/5 minutes
- Returns HTTP 429 with `Retry-After` header when limit exceeded
- Respects `X-Real-IP` and `X-Forwarded-For` headers from Nginx

**3. HTTPS enforcement**
- Nginx should redirect all HTTP to HTTPS
- Consider adding HSTS header

**4. Password hashing upgrade** (optional, for high-security)
- Replace SHA-256 with bcrypt/argon2
- Would require migration script for existing passwords

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
- `state/users.json` - User credentials (not in git!)
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

## Implemented Features

### User Management System ✅ (Completed 2026-01-19)
Three-tier role system with registration and pending edits workflow.

**Roles:**
- `editor` (toimetaja): direct edits, annotations
- `admin`: all rights + user management + registration approval + version restore

**Pages:**
- `/register` - Public registration form
- `/set-password?token=UUID` - Password setup with invite token
- `/admin` - User management, registration approval
- `/review` - Pending edits approval (editor+), recent changes

**State files (in `state/` folder):**
- `users.json` - User credentials (loo käsitsi!)
- `pending_registrations.json` - Registration requests
- `invite_tokens.json` - Invite links (48h expiry, single-use)
- `pending_edits.json` - Contributor edits awaiting review

**Flow:**
1. User submits registration at `/register`
2. Admin approves at `/admin` → generates invite link
3. User sets password at `/set-password`
4. Contributor edits → pending review → editor approves at `/review`

See `docs/PLAAN_kasutajahaldus.md` for implementation details.

## Future Ideas

### Genre vs Tags eraldamine frontendis

Praegu on `_metadata.json` v2 formaadis kaks eraldi välja:
- `genre` - teose žanr (disputatio, oratio, carmen jne) - üks väärtus
- `tags` - lisatags/märksõnad - massiiv

**Probleem:** Frontend (Dashboard, Workspace, Search) kasutab ainult `teose_tags` Meilisearchist, mis sisaldab `tags` massiivi. `genre` väli on Meilisearchis olemas, aga seda ei kuvata ega filtreerita.

**Lahendus:**
1. Lisa `genre` väli Meilisearchi filterable/sortable attributes
2. Dashboard: lisa žanri filter (eraldi tags filtrist)
3. Search: lisa žanri facet sidebar'i
4. Workspace admin modal: kuva žanr eraldi väljana
5. WorkCard: kuva žanr badge'ina (nt pildi peal)

### Collections (kollektsioonid)
See `docs/PLAAN_kollektsioonid.md` for detailed planning document.

Brief summary: Hierarchical organization of works by provenance/institution (not topic - use tags for that). One collection per work, with parent collections inherited for filtering. Global context selector in Header, bulk assignment in Dashboard.

### ESTER Integration
Currently `ester_id` is manually added. Planned improvement:
- Add "Search ESTER" button in admin metadata modal
- Query ESTER API (SRU?) by year + title keywords
- Show candidates, admin picks correct match
- Save `ester_id` to `_metadata.json`

**NB:** ESTER data doesn't map 1:1 to VUTT:
- Names spelled differently (Menius vs Mein)
- ESTER lists respondens as author (not praeses)
- Consider these differences when displaying ESTER links
