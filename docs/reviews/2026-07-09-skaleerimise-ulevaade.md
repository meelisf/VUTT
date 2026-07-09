# Skaleerimise ja evolutsioonivõime ülevaade — 2026-07-09

**Küsimus:** kas arhitektuur peab vastu, kui teoste arv kasvab 2x või 5x
(praegu ~1400 teost, ~22 000 lehekülge, ~2100 isikut)? Kas arhitektuur saab
hilisemate muudatuste takistuseks?

**Vastus lühidalt:** 2x kasv ei nõua midagi. 5x juures on **üks tegelik
murdumiskoht** (Dashboard `limit: 5000`, → issue #156) ja mõned sujuvalt
kasvavad kulud. Arhitektuuri vahetamist ei nõua ükski leid.

---

## 1. Murdumiskohad ja kasvavad kulud

### 1.1 Dashboard `limit: 5000` — AINUS tegelik murdumine → **issue #156**

`searchService.ts` `searchWorks` laeb kõik teosed korraga, klient-poolne
pagineerimine. >5000 teose juures lõikab Meilisearch vastuse vaikselt —
teosed kaovad Dashboardilt ilma veata. Payload kasvab lineaarselt
(praegu ~3–8 MB filtrimuudatuse kohta, 5x juures 15–40 MB).

Analüüs näitas, et kardetud takistus („server-side pagineerimine lõhub
filtriloogika") ei pea paika — filtrid, facetid ja sort on juba serveri
poolel. Tegelikud sõlmkohad (relevance-dedup, klient-poolne ümbersort,
`totalPages` arvutus) ja plaan on issue #156-s.

**Millal:** enne ~4000 teose piiri.

### 1.2 `save_with_git` esimese commiti kontroll — kasvav per-save kulu

`server/git_ops.py:322`:

```python
list(repo.iter_commits(paths=relative_path, max_count=1))
```

Igal salvestusel kõnnitakse commit-ajalugu HEAD-ist tagasi, kuni leitakse
faili puudutav commit. Harva muudetud lehe puhul on see import-commit, mis
vajub ajalooga järjest sügavamale — 50k+ commiti juures potentsiaalselt
sekundeid iga salvestuse kohta.

**Odav fix:** kontrolli faili olemasolu HEAD-i puus
(`relative_path in repo.head.commit.tree`) — O(puu-otsing), mitte
ajaloo-kõnd. Semantika on sama: „kas fail on juba repos".

**Millal:** madal kiireloomulisus, aga fix on nii odav, et tasub teha
järgmise git_ops puutumise käigus.

### 1.3 `rebuild_indices()` stardi-skaneering — kasvab, aga talutav

`server/prosopography/indices.py:233` loeb stardil läbi **kõik** lehekülje
JSON-id (page_tags → `person_to_works` „mentioned" seosed). 22k → 110k faili
tähendab taustalõimes hinnanguliselt 1–3 min. Vana indeks jääb vahepeal
kasutusse, seega mitte-blokeeriv — lihtsalt teadmiseks, et serveri start
„soojeneb" aeglasemalt.

**Kui kunagi vaja:** inkrementaalne uuendus (ainult muutunud teosed) või
page_tags koondamine `_metadata.json`-i tasemele.

### 1.4 Prosopograafia read-modelid — OK 5x, piir ~50k kirje juures

- `prosopography_index.json` kirjutatakse iga isiku-salvestuse peale
  tervikuna üle (`indices.py:139` `_update_index_entry`).
- `/persons` filtreerib kogu indeksit mälus (`person_search.py:200`
  `list_persons`), pagineerimine on serveri poolel ✅.

10k isiku juures (~10–20 MB fail) töötab. ~50k kirje juures muutuks
täisfaili-ülekirjutus ja mälus-filtreerimine probleemiks → SQLite.
Issue #132 (OCR job-state → SQLite) rajab sellele mustrile teed.

### 1.5 Meilisearch — OK kuni ~100x

~23k dokumenti → ~115k on Meilile tühine (skaleerub miljoniteni).
Täisreindeks (`1-1_consolidate_data.py` + seed) kasvab lineaarselt, jääb
5x juures kümnete minutite piiresse. **See on oluline evolutsioonivõime
garant:** „reindeksi kõik nullist" päästeluuk jääb kasutatavaks, mis teeb
Meili-skeemi muudatused (sh legacy-väljanimede kaotamise) ka edaspidi
võimalikuks.

### 1.6 Git repo `data/`-s — sujuv, mitte järsk aeglustumine

- Failide arv indeksis (45k → ~220k) on gitile normaalne.
- Ajaloopäringud (`get_file_git_history`, path-filtriga) aeglustuvad
  ajaloo kasvades sujuvalt; on-demand, mitte kuumal teel (v.a 1.2).

### 1.7 Kettamaht ja varundus — serveri-, mitte arhitektuuriküsimus

Pildid on ainuke päris maht (5x juures hinnanguliselt 50–100+ GB).
→ **issue #131** (varundus tervikuna) on õigustatult avatud ja kõrge
prioriteediga; maht tuleb varundusplaani sisse arvestada.

### 1.8 Kasutajate arv — eraldi telg

Uvicorn single-worker + GIL (CLAUDE.md TODO: gunicorn >500 kasutaja juures)
ei sõltu teoste arvust. Teoste kasv seda ei mõjuta.

---

## 2. Evolutsioonivõime — kas arhitektuur takistab muudatusi?

**Pigem vastupidi.** Teadlikud otsused, mis muudatusi hõlbustavad:

| Muster | Miks aitab |
|--------|-----------|
| Read-model indeksid nullist taastatavad (`rebuild_indices`) | Skeemimuudatus = muuda ehitusloogikat + rebuild, migratsiooniriskita |
| Fail-per-entiteet JSON + git | Iga migratsioon diffitav ja tagasipööratav; migratsiooniskriptide kultuur olemas |
| Ühine `meili_doc.py` (issue #23) | Kaks indekseerimisteed ei saa vaikselt lahkneda |
| Backend modulariseeritud (#36, #65, #66, #68, #89), CI-gate (#64) | Muudatuste turvavõrk olemas |

**Tegelikud evolutsiooniriskid** (mitte koodis, vaid selle ümber):

1. **Bus-factor = 1** — teadmus elab CLAUDE.md-s ja Claude'i mälufailides
   → **issue #137** (ADR-otsuste logi); alustatud: `docs/decisions/`
2. **Andmete lukustumine oma formaati** → **issue #134** (TEI / dokumenteeritud
   eksport) — tagab, et korpus pole kinni ühe rakenduse JSON-kujus
3. **Legacy-fallback'ide kuhjumine** (`tags`-fallback ~35 lehel,
   `crossLangTypeMap` jne) — iga uus väli peab neid arvestama; puhastada
   enne kui korpus kasvab, migratsioonid ei odavne kunagi ajas

---

## 3. Soovituslik järjekord

| # | Tegevus | Issue | Millal |
|---|---------|-------|--------|
| 1 | Dashboardi server-side pagineerimine | #156 | enne ~4000 teost |
| 2 | `save_with_git` HEAD-puu kontroll | — (väike, 1.2) | järgmise git_ops muudatuse käigus |
| 3 | Varundus tervikuna | #131 | plaanis (avalikustamise eeldus) |
| 4 | Eksport standardformaati | #134 | enne suurt kasvu |
| 5 | OCR job-state → SQLite (mustri proovikivi) | #132 | plaanis |
| 6 | ADR-logi jätkamine | #137 | jooksvalt |

---

*Analüüsi allikad: gh issues (kõik, sh suletud), `server/git_ops.py`,
`server/prosopography/{indices,person_search}.py`, `server/meili_doc.py`,
`src/services/searchService.ts`, `src/pages/Dashboard.tsx`.*
