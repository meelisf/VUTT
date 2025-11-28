# VUTT - Varauusaegsete Tekstide Töölaud

Veebirakendus ajalooliste (varauusaegsete) dokumentide transkriptsioonide vaatamiseks ja toimetamiseks. Rakendus kuvab skaneeritud dokumendi pilti ja OCR-iga tuvastatud teksti kõrvuti, võimaldades teksti parandada ja annoteerida.

<img width="1882" height="607" alt="VUTT screenshot" src="https://github.com/user-attachments/assets/a4456258-a02f-4d2b-a12f-1d9f2d8767ec" />

## Funktsionaalsus

- 📖 **Dokumentide sirvimine** - Teoste loend koos otsingu ja filtreerimisega
- 🔍 **Täistekstotsing** - Otsing läbi kõigi transkriptsioonide
- ✏️ **Teksti redigeerimine** - OCR-teksti parandamine koos originaalpildi vaatega
- 🏷️ **Annoteerimine** - Märksõnade ja kommentaaride lisamine
- 📊 **Staatuse jälgimine** - Töövoog: Toores → Töös → Valmis
- 👥 **Kasutajahaldus** - Rollipõhine ligipääs (viewer/editor/admin)
- 💾 **Versioonihaldus** - Automaatsed varukoopiad, originaali kaitse

## Arhitektuur

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React SPA)                      │
│                    - Vite + React 19                         │
│                    - TypeScript                              │
│                    - Tailwind CSS                            │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Meilisearch   │  │  Image Server   │  │  File Server    │
│   (port 7700)   │  │  (port 8001)    │  │  (port 8002)    │
│                 │  │                 │  │                 │
│ - Otsing        │  │ - JPG failid    │  │ - Salvestamine  │
│ - Metaandmed    │  │ - CORS enabled  │  │ - Autentimine   │
│ - Indekseerimine│  │                 │  │ - Varukoopiad   │
└─────────────────┘  └─────────────────┘  └─────────────────┘
          │                   │                   │
          └───────────────────┴───────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │      Failisüsteem (NAS/SSD)   │
              │                               │
              │  /data/                       │
              │    ├── kataloog1/             │
              │    │   ├── lk1.jpg            │
              │    │   ├── lk1.txt            │
              │    │   └── lk1.json           │
              │    └── kataloog2/             │
              │        └── ...                │
              └───────────────────────────────┘
```

## Tehnoloogiad

| Komponent | Tehnoloogia | Versioon |
|-----------|-------------|----------|
| Frontend | React + TypeScript | 19.x |
| Bundler | Vite | 6.x |
| CSS | Tailwind CSS | 3.x |
| Otsimootor | Meilisearch | 1.x |
| Backend | Python http.server | 3.8+ |
| Ikoonid | Lucide React | - |

## Ressursivajadus

| Ressurss | Minimaalne | Soovituslik |
|----------|------------|-------------|
| RAM | 4 GB | 8 GB |
| Kettaruum | 100 GB | 200 GB |
| CPU | 1 tuum | 2+ tuuma |
| OS | Ubuntu 20.04+ | Ubuntu 22.04 |

**Märkus:** Praegune andmemaht on ~25 GB (pildid + tekstid). Varukoopiad võivad lisada kuni 10x txt failide mahtu.

## Paigaldamine

### Eeldused
- Node.js 18+
- Python 3.8+
- Meilisearch 1.x

### 1. Sõltuvused
```bash
npm install
```

### 2. Konfiguratsioon
Muuda `config.ts` failis serverite aadressid:
```typescript
export const MEILI_HOST = 'http://SERVER_IP:7700';
export const IMAGE_BASE_URL = 'http://SERVER_IP:8001';
export const FILE_API_URL = 'http://SERVER_IP:8002';
```

### 3. Andmete ettevalmistamine
```bash
# Genereeri Meilisearchi andmed failisüsteemist
python3 1-1_consolidate_data.py

# Laadi andmed Meilisearchi
python3 2-1_upload_to_meili.py
```

### 4. Käivitamine
```bash
# Kõik teenused korraga
./start_services.sh

# Või eraldi:
# Terminal 1: Meilisearch
./meilisearch --master-key="SINU_VÕTI"

# Terminal 2: Pildiserver
python3 image_server.py

# Terminal 3: Failiserver
python3 file_server.py

# Terminal 4: Frontend (arenduseks)
npm run dev

# Või tootmiseks:
npm run build  # → dist/ kaust
```

## Kasutajahaldus

Kasutajad on defineeritud `users.json` failis (sama kataloog kus `file_server.py`):
```json
{
  "kasutajanimi": {
    "password_hash": "<SHA-256 hash>",
    "name": "Kuvatav Nimi",
    "role": "admin|editor|viewer"
  }
}
```

**Rollid:**
- `viewer` - Ainult vaatamine
- `editor` - Dokumentide redigeerimine
- `admin` - + versioonide taastamine

**Parooli hash:**
```bash
echo -n "parool" | sha256sum
```

## Serveri seadistamine (uus masin)

### Vajalikud failid serveris

```
/path/to/vutt-server/
├── file_server.py       # Failiserver (port 8002)
├── image_server.py      # Pildiserver (port 8001)
├── users.json           # Kasutajate andmebaas (KOHUSTUSLIK!)
├── meilisearch          # Meilisearch binary
└── start_services.sh    # Teenuste käivitamine

/path/to/data/           # Dokumentide andmed (BASE_DIR)
├── kataloog1/
│   ├── dokument1.jpg
│   ├── dokument1.txt
│   └── dokument1.json   # Metaandmed (automaatne)
└── kataloog2/
    └── ...
```

### Konfiguratsioon

**1. `file_server.py`** - muuda BASE_DIR:
```python
BASE_DIR = "/path/to/data"  # Sinu andmete kaust
PORT = 8002
```

**2. `image_server.py`** - muuda BASE_DIR:
```python
BASE_DIR = "/path/to/data"  # Sama mis file_server.py
PORT = 8001
```

**3. `.env`** (andmete üleslaadimisel):
```bash
MEILISEARCH_URL=http://localhost:7700
MEILISEARCH_MASTER_KEY=sinu_võti
```

**4. `config.ts`** (frontend):
```typescript
export const MEILI_HOST = 'http://SERVER_IP:7700';
export const MEILI_API_KEY = 'sinu_võti';
export const IMAGE_BASE_URL = 'http://SERVER_IP:8001';
export const FILE_API_URL = 'http://SERVER_IP:8002';
```

### Käivitamine

```bash
# 1. Meilisearch (andmebaas)
./meilisearch --master-key="SINU_VÕTI" &

# 2. Pildiserver
python3 image_server.py &

# 3. Failiserver (autentimine, salvestamine)
python3 file_server.py &

# 4. Frontend serveeritakse nt nginx/Apache kaudu dist/ kaustast
```

### Automaatne käivitamine (systemd)

Näide `file_server.service`:
```ini
[Unit]
Description=VUTT File Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/vutt-server
ExecStart=/usr/bin/python3 /path/to/vutt-server/file_server.py
Restart=always

[Install]
WantedBy=multi-user.target
```

### Kontroll-loend uue serveri jaoks

- [ ] `users.json` on olemas ja õiges kohas
- [ ] BASE_DIR viitab õigele andmekaustale
- [ ] Meilisearch töötab ja on indekseeritud
- [ ] Pordid 7700, 8001, 8002 on avatud
- [ ] `config.ts` IP-aadressid on õiged
- [ ] Frontend on builditud (`npm run build`)

## Turvalisus

- ✅ Serveripoolne autentimine API endpointidel
- ✅ Tõendipõhine sessioon (24h kehtivus)
- ✅ Rollipõhine ligipääsukontroll
- ✅ Path traversal kaitse
- ⚠️ HTTP (mitte HTTPS) - sobib sisevõrku
- ⚠️ SHA-256 ilma salt'ita - põhiline kaitse

**Soovitus tootmises:** Kasutada reverse proxy't (nginx/Caddy) HTTPS-i jaoks.

## Varukoopiad ja versioonihaldus

### Automaatsed varukoopiad

Iga salvestamisega luuakse automaatne varukoopia:
```
dokument.txt                    # Praegune versioon
dokument.txt.backup.20241128_143052  # Varukoopia (kuupäev_kellaaeg)
dokument.txt.backup.20241127_091523  # Vanem varukoopia
```

### Varukoopiate poliitika

- **Max 10 varukoopiat** faili kohta
- **Originaal on kaitstud** - kõige esimest versiooni ei kustutata kunagi
- Kui faili pole veel muudetud, näidatakse algset `.txt` faili kui "Originaal (OCR)"
- Vanemad vaheversioonid kustutatakse automaatselt (v.a originaal)

### Taastamine

1. Admin logib sisse
2. Avab dokumendi → "Ajalugu" sakk
3. Vajutab "Värskenda" varukoopiate nägemiseks
4. Valib versiooni → "Taasta"
5. Tekst laetakse editorisse → **vajuta "Salvesta"** kinnitamiseks

## Failide struktuur

```
VUTT/
├── components/          # React komponendid
│   ├── ImageViewer.tsx  # Pildi vaataja (zoom, pan)
│   ├── TextEditor.tsx   # Teksti redaktor + ajalugu
│   └── ...
├── pages/               # Lehekülje komponendid
│   ├── Dashboard.tsx    # Teoste loend
│   ├── Workspace.tsx    # Töölaud (pilt + tekst)
│   └── SearchPage.tsx   # Täistekstotsing
├── services/
│   └── meiliService.ts  # Meilisearch API
├── contexts/
│   └── UserContext.tsx  # Kasutaja sessioon
├── file_server.py       # Failide salvestamine
├── image_server.py      # Piltide serveerimine
├── config.ts            # Serverite konfiguratsioon
└── users.json           # Kasutajate andmebaas
```

## Litsents

MIT