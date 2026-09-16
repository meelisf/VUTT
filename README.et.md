# VUTT — Varauusaegsete Tekstide Töölaud

**VUTT** on veebirakendus ajalooliste akadeemiliste tekstide transkriptsioonide lugemiseks,
parandamiseks ja annoteerimiseks. Igal leheküljel on digiteeritud originaal tuvastatud teksti
kõrval, nii et transkriptsiooni saab allikaga ühe pilguga võrrelda.

Korpus on üles ehitatud varauusaegse Liivi- ja Eestimaaga seotud materjali ümber — disputatsioonid,
oratsioonid ja juhutrükised, olenemata trükikohast — ning sisaldab ka 19. sajandi keiserliku
ülikooli materjali, sealhulgas käsikirjalisi tekste. VUTT on koht, kus seda materjali
transkribeeritakse, parandatakse, kirjeldatakse ja otsitavaks tehakse.

**Kasutusel:** [vutt.utlib.ut.ee](https://vutt.utlib.ut.ee) ·
**Projektist lähemalt:** [vutt.utlib.ut.ee/about.html](https://vutt.utlib.ut.ee/about.html) ·
**Transkribeerimisjuhend:** [vutt.utlib.ut.ee/transcription_guide.html](https://vutt.utlib.ut.ee/transcription_guide.html) ·
[In English](README.md)

![Teoste sirvimine ja otsing VUTT-is](docs/screenshot.png)

## Korpus

Materjal on jaotatud kollektsioonidesse, nende hulgas:

- **Rootsi aja ülikool (1632–1710)** — Academia Gustaviana (1632–1665) ja Academia
  Gustavo-Carolina (1690–1710)
- **Matusetrükised** — temaatiline kogu matusetrükistest
- **Pedagoogilis-filoloogiline seminar**
- **Vennastekoguduse materjalid**

Käesoleval hetkel on töölaual üle **1200 teose ja 20 000 lehekülje** ladina, saksa,
rootsi, kreeka ja heebrea keeles ning umbes **2100 isikut** hõlmav isikute register.

Enamik lehepilte pärineb [TÜ raamatukogu](https://utlib.ut.ee) digiteeritud kogudest ja järgib
suuresti neid trükisekoopiaid, mis koguti Ene-Lille Jaanson, koost., *Tartu Ülikooli trükikoda
1632–1710: Ajalugu ja trükiste bibliograafia* (Tartu Ülikooli Raamatukogu, 2000) jaoks.

## Mida saab teha

### Otsida ja sirvida

- Teoste filtreerimine kollektsiooni, aasta, žanri, autori, trükkali, koha, märksõna ja
  transkriptsiooni staatuse järgi
- Täistekstotsing läbi kõigi transkriptsioonide
- Isikute otsimine nime järgi, sealhulgas nimevariantide kaupa

### Transkribeerida ja annoteerida

- Tuvastatud teksti parandamine lehepildi kõrval
- Lihtne märgendus kursiivi, marginaalia, joonealuste märkuste, annotatsioonide ja lehepöörde jaoks
- Kommentaarid, lehe märksõnad ja lehe staatus (toores / töös / parandatud / valmis)
- Kogu teose transkriptsiooni allalaadimine

![Lehepilt ja transkriptsioon kõrvuti](docs/screenshot-workspace.jpg)

### Kirjeldada ja seostada

- Struktureeritud metaandmed lingitud andmetena (Wikidata, VIAF, Album Academicum)
- Isikute register (prosopograafia) elulooandmete, nimevariantide, seoste, kaardivaate ja isikuga
  seotud teostega
- Kollektsioonid ja töökollektsioonid — teoste valik kursuse, näituse või väljaande jaoks

![Isikute register](docs/screenshot-persons.png)

### Muudatustel silma peal hoida

- Git-põhine versiooniajalugu; algne tuvastustulemus on alati taastatav
- Viimaste muudatuste ülevaatuse leht, lehe ajalugu ja teavitused
- Korpuse statistika (staatus, žanr, ajatelg)

Kasutajaliides on eesti ja inglise keeles.

## Tuvastusmudelid

Korpus sisaldab nii trükiseid kui käsikirju, seetõttu on lehekülgede tuvastamiseks kaks
leheküljepõhist mudelit: üks trükiste ja teine käsikirjade jaoks. Trükimudel põhineb Qwen3.5-8B-l
ja on peenhäälestatud kahes ringis — esmalt umbes 1500 leheküljel eri allikatest pärineval
transkribeeritud trükitekstil, seejärel VUTT-is valmis toimetatud lehtedel, et mudel õpiks VUTT-i
märgendust. Käsikirjamudel on treenitud ligikaudu 16 600 leheküljel avalikel andmestikel, peamiselt
XIV–XIX sajandi saksa ja rootsi kantselei- ja Kurrent-kirjal. Mudelite täpsem kirjeldus, andmestike
loend ja autorid on [projektilehel](https://vutt.utlib.ut.ee/about.html).

VUTT valmistab lehepildid ette ja avaldab need tuvastusserverile; OCR-teenus ise on eraldi
süsteem. Üleslaaditud PDF-id ja JPEG-id poolitatakse enne tuvastust VUTT-is lehtedeks.

## Alustamine

### Eeltingimused

- Node.js 20+ ja npm
- Python 3.9+
- Docker ja Docker Compose
- Git

### Seadistamine

```bash
git clone https://github.com/meelisf/VUTT.git
cd VUTT
cp .env.example .env                          # täida väärtused; vt kommentaare failis
cp state/users.json.example state/users.json
docker compose up -d
```

`.env.example` kirjeldab kõiki seadeid. Lokaalses arenduses võivad võtmed olla suvalised;
`VUTT_ENV=production` keeldub seevastu arendusvaikeväärtustega käivitumast.

Ehita otsinguindeks `data/` failide põhjal:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/1-1_consolidate_data.py
.venv/bin/python scripts/2-1_upload_to_meili.py
```

Käivita frontend:

```bash
npm install
npm run dev            # http://localhost:3000
npm run build          # toodangu build → dist/
```

Arendusserver proxib `/api/*` ja `/meili` failis `vite.config.ts` määratud backendile
(`DEV_BACKEND`); suuna see oma instantsile.

Juurdepääs on taotluse alusel. Vorm `/register` esitab taotluse, mille administraator vaatab üle;
konto võib lisada ka otse faili `state/users.json`.

### Testid ja kontrollid

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest -q

npm test               # vitest
npm run typecheck
npm run lint:ci
```

### Andmed ja konfiguratsioon

- `data/` on korpus: teoste metaandmed, lehepildid, transkriptsioonid ja lehtede JSON. See on oma
  Git-repositsioon ja tõe allikas. **See ei kuulu käesolevasse reposse** — värske kloon sisaldab
  ainult rakendust.
- `data/config/` sisaldab kollektsioone, sõnastikke, kohti, arhiive, töökollektsioone ja isikute
  registrit.
- `state/` sisaldab jooksva oleku faile (kasutajad, sessioonid, tokenid, logid) ja ei ole jälgitud.

Failisüsteemi formaati ja Meilisearchi kaardistust kirjeldab
[docs/DATA_ARCHITECTURE.md](docs/DATA_ARCHITECTURE.md).

## Arhitektuur

```
React (Vite, TypeScript, Tailwind CSS, CodeMirror)
        │
      nginx (hostis)
        ├── Meilisearch      – otsing ja fassett
        ├── pildiserver      – lehepildid
        └── FastAPI backend  – toimetamine, autentimine, Git, upload, prosopograafia
                │
            data/ + state/
```

Backend ja Meilisearch jooksevad Dockeris, nginx jookseb hostis. Lehepildid ja transkriptsioonid
elavad failisüsteemis. Iga salvestus on Git-commit ja otsinguindeks ehitatakse metaandmetest
uuesti.

### Koodi paigutus

```
src/        Reacti frontend (pages/, components/, prosopography/, services/, locales/)
server/     FastAPI backend (routers/, prosopography/, upload/, meili_*.py)
mcp/        ainult lugemisõigusega MCP-server kohalikele AI-assistentidele
scripts/    indeksi ehitamine, migratsioonid, hooldus
docs/       arhitektuuriotsused (ADR), andmete arhitektuur, paigaldusjuhend
```

## Rollid

| Roll | Mida saab |
|------|-----------|
| `contributor` | lugeda ja toimetada neis kollektsioonides, mis talle on antud |
| `editor` | toimetada kõiki teoseid, mida ta näeb; hallata jagamist ja sisu |
| `admin` | hallata kasutajaid ja kollektsioone, taastada versioone, käitada upload-viisardit |
| `superadmin` | kõik, sealhulgas OCR-pakkuja seaded ja hooldustööd |

## Deploy

Igapäevane deploy ja serveri nullist püstipanek on kirjeldatud failis
[docs/deployment_guide.md](docs/deployment_guide.md). Lühidalt:

```bash
# serveris
cd ~/VUTT && ./scripts/server_update.sh --no-cache

# lokaalses masinas (frontend)
npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/
```

Indeks ehita uuesti, kui metaandmed või indeksi seaded on muutunud:

```bash
./scripts/server_seed_data.sh
```

## MCP-server

`mcp/` sisaldab ainult lugemisõigusega [MCP](https://modelcontextprotocol.io) serverit, mis annab
kohalikele AI-assistentidele (Claude Code, Codex CLI, Gemini CLI) otsingu ligipääsu korpusele ja
isikute registrile avaliku API kaudu. Vt [mcp/README.md](mcp/README.md).

## Autorid

VUTT-i arendatakse [TÜ raamatukogus](https://utlib.ut.ee). Logo soovitas Rahel Toomik ja see
pärineb jutluse *Een kort och enfaldigh Lijkpredikan* (Dorpt, J. Vogel, 1642) tiitellehe
ehisraamist.

Transkriptsiooni autorid ja retsensendid tähestiku järjekorras: Ove Averin, Meelis Friedenthal,
Jaana Jurtšenkova, Kristiina Kase, Vallo Kask, Kristin Klaus, Hant Mikit Kolk, Pärtel Piirimäe,
Agne Pilvisto, Anni Polding, Janika Päll, Kaarina Rein, Rahel Toomik.

Küsimused ja ettepanekud: [meelis.friedenthal@ut.ee](mailto:meelis.friedenthal@ut.ee)

## Litsents

Tarkvara on välja antud MIT-litsentsi alusel (vt [LICENSE](LICENSE)). Tekstid ja pildid on
kasutusel TÜ raamatukogu kasutustingimuste järgi.
