# VUTT – Workbench for Early Modern Texts

A web application for viewing and editing transcriptions of early modern academic texts from the University of Tartu collections. Displays scanned page images alongside OCR text; transcriptions can be corrected, annotated, and searched.

<img alt="VUTT screenshot" src="docs/screenshot.png" />

**Live instance:** [vutt.utlib.ut.ee](https://vutt.utlib.ut.ee)

> [Eestikeelne README](README.et.md)

## Features

- Browse works by collection, status, and combined filters (author, year, genre, tags, location)
- Full-text search across all transcriptions (Meilisearch)
- Side-by-side OCR editing with the original scan (CodeMirror 6, VUTT markup)
- Structured metadata as linked data (Wikidata, VIAF, Album Academicum)
- Persons register (prosopography) with name variant resolution and cross-reference sync
- Git-based version history — original OCR always restorable
- Role-based access: editors can transcribe, admins manage users and data
- Admin tools: upload wizard (PDF/JPG → OCR server → import), user management, statistics

## Architecture

```
Frontend (React 19 + Vite + TypeScript + Tailwind CSS)
    ↓ Nginx (host, /etc/nginx/sites-available/vutt)
├── Meilisearch (127.0.0.1:7700) – search and metadata
├── Image Server   (127.0.0.1:8001) – scanned .jpg images
└── File Server / FastAPI (127.0.0.1:8002) – saving, auth, Git, uploads
    ↓
Filesystem: data/{work-folder}/{page}.txt + .jpg + .json + _metadata.json
```

Backend and Meilisearch run in Docker (`docker-compose.yml`). Nginx runs on the host and proxies all three ports.

## Installation

### Prerequisites

- Node.js 20+, npm
- Python 3.9+
- Docker + Docker Compose
- Git
- Nginx (host)

### 1. Clone and configure

```bash
git clone <repo> VUTT && cd VUTT
cp state/users.json.example state/users.json
```

Copy or create `state/collections.json` (not tracked in git — see structure below).

### 2. Backend (.env)

Create a `.env` file in the project root:

```env
MEILI_MASTER_KEY=change_this
UPLOAD_ENABLED=false          # true if OCR server is configured
OCR_SERVER_HOST=              # OCR server IP (if UPLOAD_ENABLED=true)
OCR_SERVER_USER=
OCR_SERVER_PATH=
UMAMI_DB_PASSWORD=change_this
UMAMI_APP_SECRET=change_this
```

Start services:

```bash
docker compose up -d
```

### 3. Index data

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/1-1_consolidate_data.py   # Reads data/ → JSON
.venv/bin/python scripts/2-1_upload_to_meili.py    # Uploads to Meilisearch
```

### 4. Frontend

```bash
npm install
npm run build             # Production build
# or for development:
npm run dev               # http://localhost:5173
```

### 5. Nginx

Configure Nginx to proxy the three ports and serve `dist/` as static files. All `/api/*` requests → `127.0.0.1:8002`, `/images/*` → `8001`, Meilisearch search → `7700` (read-only API key only).

### 6. First user

Register at `/register` — the first account automatically receives admin role (or add manually to `state/users.json`).

## Local development (frontend only)

```bash
npm install && npm run dev
```

The frontend can connect to a production API server if `VITE_API_URL` is set. For a local backend, run `docker compose up -d` and configure `.env.local`.

## Tests

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest -q
```

## Data structure

```
data/
└── 1692-6-disputatio-de-aliquo/
    ├── _metadata.json      # Work metadata (id, title, year, authors, genre, etc.)
    ├── scan_001.jpg
    ├── scan_001.txt        # VUTT markup transcription
    ├── scan_001.json       # Page metadata and sequence
    └── ...
```

Linked data fields use the LinkedEntity format:
```json
{ "label": "Tartu", "id": "Q3258", "source": "wikidata", "labels": {"et": "Tartu", "en": "Tartu"} }
```

Supported fields: `genre`, `type`, `location`, `publisher`, `tags`, `creators[]`

## Collections (`state/collections.json`)

```json
{
  "academia-gustaviana": {
    "name": { "et": "Academia Gustaviana", "en": "Academia Gustaviana" },
    "parent": "universitas-dorpatensis-1",
    "color": "amber"
  }
}
```

Colors: Tailwind color names (`red`, `amber`, `teal`, `violet`, etc.). File is not tracked in git — copy manually.

## Deploy (production server)

```bash
# Backend
ssh vutt
cd ~/VUTT && git pull
docker compose build --no-cache backend && docker compose up -d backend

# Frontend
npm run build                        # on local machine
rsync -avz dist/ vutt:~/VUTT/dist/

# Re-index data (if data/ changed)
./scripts/server_seed_data.sh
```

## Roles

| Role | Permissions |
|------|-------------|
| `editor` | Edit transcriptions, change status |
| `admin` | User management, version restore, upload wizard |

## Tech stack

React 19 · TypeScript · Vite · Tailwind CSS · CodeMirror 6 · Meilisearch · FastAPI · Python 3.9 · Git · Recharts · react-i18next (et/en)

## License

MIT
