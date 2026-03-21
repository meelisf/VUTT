# VUTT – Varauusaegsete Tekstide Töölaud

Veebirakendus TÜ varauusaegsete akadeemiliste tekstide transkriptsioonide vaatamiseks ja toimetamiseks. Kuvab skaneeritud dokumendi pilti ja OCR-teksti kõrvuti, võimaldades teksti parandada, annoteerida ja otsida.

<img width="1882" alt="VUTT screenshot" src="https://github.com/user-attachments/assets/a4456258-a02f-4d2b-a12f-1d9f2d8767ec" />

**Kasutusel:** [vutt.utlib.ut.ee](https://vutt.utlib.ut.ee)

## Mida VUTT teeb

- 📖 **Sirvimine** – teoste loend koos otsingu, filtrite ja staatusega
- 🔍 **Täistekstotsing** – otsing läbi kõigi transkriptsioonide ja annotatsioonide
- ✏️ **Toimetamine** – OCR-teksti parandamine originaalpildi kõrval
- 🏷️ **Annoteerimine** – märksõnade ja kommentaaride lisamine
- 📊 **Töövoog** – staatused Toores → Töös → Valmis
- 👥 **Kasutajad** – rollipõhine ligipääs (toimetaja → admin)
- 💾 **Versioonid** – Git-põhine ajalugu, originaal-OCR alati taastatav

## Kiirkäivitus

### Arendus

```bash
npm install
./start_services.sh   # Käivitab Meilisearch + Python serverid
npm run dev           # Frontend: http://localhost:5173
```

Backend smoke-testid:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest -q
```

### Tootmine

Serveris (`~/VUTT`):
```bash
./scripts/server_update.sh  # Tõmbab koodi, uuendab Dockerit
```

## Arhitektuur

```
Frontend (React + Vite + Tailwind)
    ↓ Nginx
├── Meilisearch (7700) – otsing ja metaandmed
├── Image Server (8001) – skaneeritud pildid
└── File Server (8002) – salvestamine, autentimine, Git
    ↓
Failisüsteem: data/{teos}/{leht}.txt + .jpg + .json
```

## Kasutajad ja rollid

| Roll | Õigused |
|------|---------|
| toimetaja (editor) | teksti redigeerimine, annotatsioonid |
| admin | + kasutajahaldus, registreerimiste kinnitamine, versioonide taastamine |

**Registreerumine:** `/register` → admin kinnitab → kasutaja seab parooli

## Andmete struktuur

```
data/
└── 1692-6-Disputatio-De-Aliquo/
    ├── _metadata.json      # Teose metaandmed
    ├── scan_001.jpg        # Skaneeritud pilt
    ├── scan_001.txt        # OCR tekst (sama nimi!)
    ├── scan_001.json       # Lehekülje annotatsioonid
    └── ...
```

**Uue teose lisamine:** kopeeri kaust → server tuvastab automaatselt ja indekseerib.

## Tehnoloogiad

React 19 · TypeScript · Vite · Tailwind CSS · Meilisearch · Python · Git

## Litsents

MIT
