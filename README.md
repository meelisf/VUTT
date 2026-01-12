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

## Uuendused (Detsember 2025) - Tekstitoimeti Arhitektuur

### Line-by-Line Strict Renderer
Tekstitoimeti "Loe" vaade (`MarkdownPreview.tsx`) kirjutati täielikult ümber, et tagada **1:1 joondus** reanumbritega.
-   **Printsiip**: Sisu tükeldatakse rangelt reavahetuste (`\n`) järgi.
-   **Teostus**: Iga rida renderdatakse fikseeritud kõrgusega (`1.7em`) konteinerisse.
-   **Eesmärk**: Tagada, et transkriptsiooni read püsiksid alati sünkroonis vasakpoolse reanumbrite tulbaga, sõltumata sisust.

### Stateful Style Parser
Multi-line stiilide (nt kaldkiri, mis ulatub üle mitme rea) toetamiseks on kasutusel **Stateful Parser**.
-   Parser peab meeles aktiivseid stiile (bold, italic, marginalia) ridade vahel.
-   Kui stiil algab real 1 ja lõppeb real 5, on kõik vahepealsed read korrektselt vormindatud, säilitades samal ajal range reastruktuuri.
-   **Marginalia**: `[[m: ...]]` kuvatakse nüüd teksti sees kollase taustaga (`inline`), mitte peidetud hüpikaknana.

### Töölaua tööriistad
-   **Ühtne disain**: Töölaua staatuse värvid (Toores/Töös/Valmis) on ühtlustatud Dashboardiga.
-   **Õigused**: Sisselogimata kasutajatel on muutmine (sh staatuse muutmine) keelatud.

## Arhitektuur

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React SPA)                     │
│                    - Vite + React 19                        │
│                    - TypeScript                             │
│                    - Tailwind CSS                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │      Nginx Reverse Proxy      │
              │      (port 80 / 443)          │
              └───────────────┬───────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Meilisearch   │  │  Image Server   │  │  File Server    │
│   (sisemine)    │  │  (sisemine)     │  │  (sisemine)     │
│                 │  │                 │  │                 │
│ - Otsing        │  │ - JPG failid    │  │ - Salvestamine  │
│ - Metaandmed    │  │ - CORS          │  │ - Autentimine   │
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

## Paigaldamine ja Kasutamine

### Kiirkäivitus (Docker) - Soovituslik

See on lihtsaim viis VUTT-i käivitamiseks serveris või oma arvutis.

1. **Eeldused:** Docker ja Docker Compose.
2. **Käivitamine:**
   ```bash
   docker compose up -d
   ```
3. **Kasutamine:** Ava brauseris `http://localhost`.

Täpsemat infot uude serverisse paigaldamise, andmete kolimise ja HTTPS-i seadistamise kohta loe failist **[deployment_guide.md](deployment_guide.md)**.

### Arendus (Manuaalne paigaldus)

Kui soovid arendada frontend'i või jooksutada skripte eraldi:

#### 1. Sõltuvused
```bash
npm install
```

#### 2. Käivitamine
```bash
# Kõik teenused korraga (vajab tmux/terminaatorit või taustaprotsesse)
./start_services.sh

# Või eraldi terminalides:
docker compose up meilisearch  # Ainult andmebaas
python3 file_server.py         # Backend
python3 image_server.py        # Pildid
npm run dev                    # Frontend
```

#### 3. Konfiguratsioon
Arenduses (`npm run dev`) loeb rakendus sätteid failist `config.ts`, kasutades `DEV_IP` muutujat. Produktsioonis (Docker/Nginx) kasutatakse suhtelisi radu (`/api/...`).

### Andmete ettevalmistamine

#### Andmete struktuur

```
data/
├── jaanson.tsv                          # Metaandmete fail (TSV)
└── 04_sorditud_dokumendid/              # Skaneeritud dokumendid
    ├── 1692-6-Suvaline-Nimi/            # Algab ID-ga (1692-6)
   │   ├── scan_001.jpg                 # Skaneeritud pilt
   ### Märkus žanrite kohta

   Järgmised žanrid loetakse samaks ja normaliseeritakse väärtuseks **disputatsioon**:

   - dissertatsioon
   - disputatsioon
   - exercitatio
   - teesid

   Seega kõik need märksõnad (ka automaatselt tuvastatud või _metadata.json-is_) salvestatakse ja filtreeritakse kui `disputatsioon`.
    │   ├── scan_001.txt                 # OCR tekst (SAMA NIMI!)
    │   ├── scan_001.json                # Metaandmed (automaatne)
    │   ├── scan_002.jpg
    │   ├── scan_002.txt
    │   └── ...
    └── 1693-12-Teine-Kataloog/
        └── ...
```

#### Nõuded andmetele

1. **`jaanson.tsv`** - metaandmete fail:
   - Peab sisaldama veergu `fields_r_acad_code` kujul `R Acad. Dorp. 1692:6`
   - See teisendatakse katalooginime prefiksiks: `1692:6` → `1692-6`
   - Muud veerud: `pealkiri`, `autor`, `respondens`, `aasta`

2. **Kataloogide nimetamine**:
   - Toetatud on kaks formaati:
     1. **Range ID:** `AAAA-N` (nt `1692-6` või `1692-6-Pealkiri`) - seostub `jaanson.tsv` andmetega.
     2. **Lihtne:** `AAAA-Pealkiri` (nt `1635-virginius-manipulus`) - töötab ilma eelneva metaandmete failita.
   - Süsteem tuvastab automaatselt aastaarvu (4 esimest numbrit) ja pealkirja.
   - Failid kausta sees peavad siiski olema paaris (`.jpg` + `.txt`).

3. **Failide paarid** (OLULINE!):
   - Iga lehekülje kohta peab olema **sama nimega** pildi (`.jpg`, `.jpeg`, `.png`) ja `.txt` fail
   - Näide: `scan_001.jpg` + `scan_001.txt` või `pilt_001.png` + `pilt_001.txt` ✅
   - Näide: `pilt_001.jpg` + `tekst_001.txt` ❌ (ei tööta!)
   - Failinimed ei pea sisaldama kataloogi nime
   - Kui pilt puudub, lehekülge ei kuvata
   - Kui tekst puudub, lehekülge ei indekseerita

#### Piltide vahetamine

Skännide uuendamiseks (nt parema kvaliteediga):
1. Asenda `.jpg` failid uutega (**sama failinimi!**)
2. `.txt` ja `.json` failid jäävad samaks
3. Meilisearchi uuesti indekseerima ei pea (pildid serveeritakse otse)
4. Brauseris võib olla vaja cache tühjendada (Ctrl+Shift+R)

#### Automaatne taustal indekseerimine (UUS)

`file_server.py` sisaldab taustal töötavat jälgijat, mis kontrollib andmekaustas (`BASE_DIR`) uusi katalooge:
1. Kui leitakse uus kataloog, kus on pilte aga puudub `_metadata.json`:
2. Genereeritakse automaatselt `_metadata.json` kataloogi nime põhjal.
3. Teos indekseeritakse automaatselt Meilisearchis (koos kõigi piltidega).
4. See tähendab, et uute andmete lisamiseks piisab vaid kataloogi kopeerimisest serverisse.

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

### Serveri seadistamine

Serveri seadistamise (sh Nginx, HTTPS ja andmete varundamine) kohta vaata **[deployment_guide.md](deployment_guide.md)**.


### Kontroll-loend uue serveri jaoks (Docker)

- [ ] `users.json` on olemas ja kopeeritud serverisse
- [ ] `data` kaust on olemas ja sisaldab faile
- [ ] `docker-compose.yml` volumes seadistus on õige
- [ ] **Ainult** port 80 (ja 443) on tulemüüris avatud (Nginx tegeleb suunamisega)
- [ ] Frontend on builditud (`npm run build`) ja `dist/` kaust serveris olemas
- [ ] `docker compose up -d` käivitatud ja teenused töötavad (`docker compose ps`)

## Turvalisus

- ✅ Serveripoolne autentimine API endpointidel
- ✅ Tõendipõhine sessioon (24h kehtivus, automaatne aegumine)
- ✅ Rollipõhine ligipääsukontroll
- ✅ Path traversal kaitse (`os.path.basename()`)
- ✅ UUID tokenid (krüptograafiliselt juhuslikud)
- ⚠️ HTTP (mitte HTTPS) - sobib sisevõrku
- ⚠️ SHA-256 ilma salt'ita - põhiline kaitse
- ⚠️ CORS avatud (`*`) - piirata pärast domeeni saamist

**NB:** `users.json` fail on kohustuslik - ilma selleta ei saa keegi sisse logida.

**Soovitus tootmises:** Kasutada HTTPS-i (vt [deployment_guide.md](deployment_guide.md)).

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