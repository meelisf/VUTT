# Prosopograafia ühte asukohta — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kogu prosopograafia (kaardid + pildid) elab ainult `data/config/prosopography/` all; `state/prosopography/` ja `data/prosopography/` kaovad ning ükski koodirida ei osuta enam neile.

**Architecture:** Üks konstant `PROSOPOGRAPHY_DIR` on ainus juur, `PROSOPOGRAPHY_IMAGES_DIR` tuletatakse sellest. Serverikoodis muutub üks rida — kõik tarbijad käivad juba konstandi kaudu ja `image_url` on API-marsruut, mitte failitee. Ülejäänu on skriptide koristus, dokumentatsioon ja ühekordne failide teisaldus tootmises.

**Tech Stack:** Python 3.9 (Docker), pytest, bash/ssh serverihaldus. Frontendi see töö ei puuduta.

**Spekk:** `docs/superpowers/specs/2026-08-08-prosopograafia-uks-asukoht-design.md`
**Issue:** #221 · **Haru:** `chore/prosopo-uks-asukoht`

## Global Constraints

- **Python 3.9 ühilduvus:** `Optional[dict]`, mitte `dict | None`.
- **Koodikommentaarid eesti keeles.**
- **Teed tulevad ALATI `server/config.py`-st** — mitte `os.path.join(os.path.dirname(__file__), "../state")`.
- **`PROSOPOGRAPHY_IMAGES_DIR` tuletatakse `PROSOPOGRAPHY_DIR`-ist**, mitte `DATA_CONFIG_DIR`-ist literaali `"prosopography"` korrates. Kaks sõltumatut liitmist on lahknemisviis, mille pärast see töö käib.
- **Väravad enne igat commitit:** `.venv/bin/pytest tests/ -q` peab olema roheline. Frontendi väravaid see töö ei vaja (TS-i ei puudutata).
- **Tootmisandmeid ei kustutata enne suitsutesti** (Task 6 samm 7).

---

### Task 1: Üks prosopograafia juur konfiguratsioonis

**Files:**
- Modify: `server/config.py:104-106`
- Test: `tests/test_prosopography_paths.py` (uus)

**Interfaces:**
- Consumes: `server.config.DATA_CONFIG_DIR`, `server.config.PROSOPOGRAPHY_DIR`
- Produces: `PROSOPOGRAPHY_IMAGES_DIR` osutab `PROSOPOGRAPHY_DIR/images` peale. Tarbijad (`server/prosopography/person_crud.py`, `state.py`, `ops.py`, `_compat.py`) ei muutu — nad impordivad sama nime.

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_prosopography_paths.py`:

```python
"""Prosopograafia asukoha invariant: ÜKS juur, mitte kolm.

Taust (#221): kaardid migreeriti 2026-05-25 data/config/prosopography/ alla,
aga pildid jäid state/-i ja kaks vana koopiat kogusid enda ümber kasutajaid.
Need testid on selle vastu, et asukohad vaikselt uuesti lahku läheksid.
"""
import os

from server import config


def test_pildid_on_prosopograafia_juure_all():
    """PROSOPOGRAPHY_IMAGES_DIR peab olema PROSOPOGRAPHY_DIR alamkaust."""
    root = os.path.realpath(config.PROSOPOGRAPHY_DIR)
    images = os.path.realpath(config.PROSOPOGRAPHY_IMAGES_DIR)
    assert os.path.commonpath([root, images]) == root
    assert os.path.basename(images) == "images"


def test_prosopograafia_juur_on_data_config_all():
    """Juur ise peab elama data/config/-is, mitte state/-is."""
    data_config = os.path.realpath(config.DATA_CONFIG_DIR)
    root = os.path.realpath(config.PROSOPOGRAPHY_DIR)
    assert os.path.commonpath([data_config, root]) == data_config


def test_uhtegi_prosopograafia_teed_ei_ehitata_state_alt():
    """state/ ei tohi esineda ÜHESKI prosopograafia teekonstandis."""
    state = os.path.realpath(config.STATE_DIR)
    for name in ("PROSOPOGRAPHY_DIR", "PROSOPOGRAPHY_IMAGES_DIR",
                 "PROSOPOGRAPHY_INDEX_FILE", "PERSON_ALIASES_FILE"):
        path = os.path.realpath(getattr(config, name))
        assert os.path.commonpath([state, path]) != state, (
            "{} osutab veel state/-i: {}".format(name, path)
        )
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_prosopography_paths.py -v`
Expected: `test_pildid_on_prosopograafia_juure_all` ja `test_uhtegi_prosopograafia_teed_ei_ehitata_state_alt` FAIL (pildikonstant osutab `state/prosopography/images`); `test_prosopograafia_juur_on_data_config_all` PASS juba praegu.

- [ ] **Step 3: Muuda konfiguratsiooni**

`server/config.py` read 104-106 — ENNE:

```python
# Prosopograafia isikukaardid (JSON failid — gitis, pildid — state-is)
PROSOPOGRAPHY_DIR = os.path.join(_DATA_CONFIG_DIR, "prosopography")
PROSOPOGRAPHY_IMAGES_DIR = os.path.join(_STATE_DIR, "prosopography", "images")
```

PÄRAST:

```python
# Prosopograafia: ÜKS juur, selle all varatüübid (#221).
# Kaardid on gitis, pildid mitte (data/.gitignore → *.jpg), aga MÕLEMAD elavad
# siin — pildid olid varem state/-is ja see lahknemine tekitas kolm koopiat.
# Pildi-tee tuletatakse juurest: kaks sõltumatut liitmist lahkneksid uuesti.
PROSOPOGRAPHY_DIR = os.path.join(_DATA_CONFIG_DIR, "prosopography")
PROSOPOGRAPHY_IMAGES_DIR = os.path.join(PROSOPOGRAPHY_DIR, "images")
```

- [ ] **Step 4: Käivita testid**

Run: `.venv/bin/pytest tests/test_prosopography_paths.py -v`
Expected: 3 passed

Run: `.venv/bin/pytest tests/ -q`
Expected: kõik roheline. Kui `test_prosopography_git.py`, `test_prosopography_side_writes.py` või `test_security_fixes.py` kukuvad, siis nad kodeerisid vana asukohta — paranda test, mitte konstant.

- [ ] **Step 5: Commit**

```bash
git add server/config.py tests/test_prosopography_paths.py
git commit -m "fix(prosopo): pildid prosopograafia juure alla (#221)

PROSOPOGRAPHY_IMAGES_DIR ehitati _STATE_DIR-ist, kuigi kaardid kolisid
2026-05-25 data/config/-i. Nüüd tuletatakse pildi-tee PROSOPOGRAPHY_DIR-ist,
nii et konfiguratsioon ise väljendab invarianti: üks juur, selle all varad.

Failide tegelik teisaldus tootmises on eraldi samm."
```

---

### Task 2: Kulunud ühekordsed skriptid kustutatud

**Files:**
- Delete: `scripts/import_aa_persons.py`, `scripts/enrich_aa_persons.py`, `scripts/fix_aa_person_names.py`, `scripts/import_persons_from_aliases.py`, `scripts/bulk_fill_gender_status.py`

**Interfaces:**
- Consumes: midagi
- Produces: midagi. Ükski teine skript ega server ei impordi neid — Step 1 tõestab selle.

- [ ] **Step 1: Tõesta, et keegi neid ei impordi**

```bash
for f in import_aa_persons enrich_aa_persons fix_aa_person_names \
         import_persons_from_aliases bulk_fill_gender_status; do
  echo "--- $f"
  grep -rn "$f" --include="*.py" --include="*.sh" --include="*.yml" \
    server/ scripts/ tests/ .github/ | grep -v "scripts/$f.py:"
done
```

Expected: iga skripti all tühi tulemus. Kui midagi leidub, PEATU ja teata — see skript ei ole kulunud ühekordne.

- [ ] **Step 2: Kustuta**

```bash
git rm scripts/import_aa_persons.py scripts/enrich_aa_persons.py \
       scripts/fix_aa_person_names.py scripts/import_persons_from_aliases.py \
       scripts/bulk_fill_gender_status.py
```

- [ ] **Step 3: Käivita testid**

Run: `.venv/bin/pytest tests/ -q`
Expected: kõik roheline (ükski test ei impordi neid skripte).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(prosopo): kustuta viis kulunud AA-migratsiooniskripti (#221)

Kõik viis lugesid state/prosopography/ alt, mis on külmunud 2026-05-25 seisus.
Nad on oma töö teinud; alleshoidmine ei anna midagi peale riski, et keegi
jooksutab neid surnud andmete peal. Sisu jääb git-ajalukku:
git log --diff-filter=D --stat -- scripts/"
```

---

### Task 3: `mass_enrich_prosopography.py` osutab elavatele andmetele

**Files:**
- Modify: `scripts/mass_enrich_prosopography.py:20-38`

**Interfaces:**
- Consumes: `server.config.PROSOPOGRAPHY_DIR`, `PROSOPOGRAPHY_INDEX_FILE`, `PERSON_ALIASES_FILE`
- Produces: skript, mis loeb ja kirjutab elavaid kaarte.

**NB:** see skript on katki KOLMES kohas, mitte ühes — `PROSOPO_DIR`, `INDEX_FILE` ja `ALIASES_FILE` osutavad kõik `state/`-i, kuigi kõik kolm elavad `data/config/`-is. Lisaks on `BASE_DIR` kõvakodeeritud `/home/meelisf/VUTT` peale, mis ei tööta Dockeris.

- [ ] **Step 1: Käivita kuivkäivitus ja vaata, et see osutab valesse kohta**

```bash
.venv/bin/python3 scripts/mass_enrich_prosopography.py --dry-run --limit 1
```

Expected: skript kas kukub (`/home/meelisf/VUTT` puudub sinu masinas) või raporteerib kaardid külmunud kataloogist. Kirjuta üles, mida ta ütles — Step 4 võrdleb.

- [ ] **Step 2: Asenda teekonstandid**

`scripts/mass_enrich_prosopography.py` read 20-25 — ENNE:

```python
import json, glob, os, sys, argparse, time
from datetime import datetime, timezone

BASE_DIR = '/home/meelisf/VUTT'
PROSOPO_DIR = os.path.join(BASE_DIR, 'state', 'prosopography')
INDEX_FILE = os.path.join(BASE_DIR, 'state', 'prosopography_index.json')
ALIASES_FILE = os.path.join(BASE_DIR, 'state', 'person_aliases.json')
```

PÄRAST:

```python
import json, glob, os, sys, argparse, time, types
from datetime import datetime, timezone

# Teed tulevad server/config.py-st — ainuõige allikas (#221). Varem olid nad
# siin käsitsi kokku pandud ja osutasid state/-i, kus andmed on külmunud
# 2026-05-25 seisus: skript oleks rikastanud kaarte, mida keegi ei loe.
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if "server" not in sys.modules:
    _server_pkg = types.ModuleType("server")
    _server_pkg.__path__ = [os.path.join(BASE_DIR, "server")]
    _server_pkg.__package__ = "server"
    sys.modules.setdefault("server", _server_pkg)
sys.path.insert(0, BASE_DIR)

from server.config import (
    PERSON_ALIASES_FILE as ALIASES_FILE,
    PROSOPOGRAPHY_DIR as PROSOPO_DIR,
    PROSOPOGRAPHY_INDEX_FILE as INDEX_FILE,
)
```

Rida 27 (`sys.path.insert(0, BASE_DIR)`) on nüüd ülal — kustuta vana kordus.

- [ ] **Step 3: Kontrolli, et enrichment-mooduli laadimine töötab endiselt**

Skript laeb `server/prosopography/enrichment.py` `importlib`-iga, et vältida `server/__init__.py`-d. `BASE_DIR` tähendus ei muutunud (projekti juur), seega rida

```python
enrichment = _load_module('enrichment', os.path.join(BASE_DIR, 'server/prosopography/enrichment.py'))
```

jääb tööle. Ära muuda seda.

- [ ] **Step 4: Käivita kuivkäivitus uuesti**

```bash
.venv/bin/python3 scripts/mass_enrich_prosopography.py --dry-run --limit 1
```

Expected: skript loeb nüüd `data/config/prosopography/` alt ega kirjuta midagi (`--dry-run`). Võrdle Step 1 tulemusega — kaartide arv peab tulema elavast komplektist.

- [ ] **Step 5: Commit**

```bash
git add scripts/mass_enrich_prosopography.py
git commit -m "fix(prosopo): mass_enrich osutab elavatele kaartidele (#221)

PROSOPO_DIR, INDEX_FILE ja ALIASES_FILE olid kõik state/ all, kus andmed on
külmunud 2026-05-25 seisus — rikastamine oleks kirjutanud kaarte, mida keegi
ei loe. Teed tulevad nüüd server/config.py-st ja BASE_DIR arvutatakse faili
asukohast (kõvakodeeritud /home/meelisf/VUTT ei töötanud Dockeris)."
```

---

### Task 4: `cleanup_place_duplicates.py` osutab elavatele andmetele

**Files:**
- Modify: `scripts/cleanup_place_duplicates.py:8-14`

**Interfaces:**
- Consumes: `server.config.PROSOPOGRAPHY_DIR`, `server.config.PLACES_FILE` (olemas, `server/config.py:93`)
- Produces: skript, mis puhastab elavaid kaarte.

- [ ] **Step 1: Asenda teekonstandid**

`scripts/cleanup_place_duplicates.py` read 8-14 — ENNE:

```python
import glob, json, os, sys
from datetime import datetime, timezone

DATA_ROOT = os.getenv("VUTT_DATA_DIR", "data")
STATE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "state")
PROSOPO_DIR = os.path.join(STATE_DIR, "prosopography")
PLACES_FILE = os.path.join(DATA_ROOT, "config", "places.json")
```

PÄRAST:

```python
import glob, json, os, sys, types
from datetime import datetime, timezone

# Teed tulevad server/config.py-st (#221). PROSOPO_DIR osutas varem state/-i,
# kus kaardid on külmunud 2026-05-25 seisus — puhastus oleks parandanud
# kohanimesid kaartidel, mida keegi ei loe.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if "server" not in sys.modules:
    _server_pkg = types.ModuleType("server")
    _server_pkg.__path__ = [os.path.join(_PROJECT_ROOT, "server")]
    _server_pkg.__package__ = "server"
    sys.modules.setdefault("server", _server_pkg)
sys.path.insert(0, _PROJECT_ROOT)

from server.config import PLACES_FILE, PROSOPOGRAPHY_DIR as PROSOPO_DIR
```

`DATA_ROOT` kaob — seda kasutati ainult `PLACES_FILE` ehitamiseks. Kontrolli
`grep -n DATA_ROOT scripts/cleanup_place_duplicates.py`, et mujal viiteid ei jää.

- [ ] **Step 2: Käivita kuivkäivitus**

```bash
.venv/bin/python3 scripts/cleanup_place_duplicates.py --dry-run
```

Expected: skript loeb `data/config/places.json` ja `data/config/prosopography/*.json`, raporteerib duplikaadid ega kirjuta midagi.

- [ ] **Step 3: Commit**

```bash
git add scripts/cleanup_place_duplicates.py
git commit -m "fix(prosopo): cleanup_place_duplicates osutab elavatele kaartidele (#221)

PROSOPO_DIR ehitati käsitsi state/-i alla, kus kaardid on külmunud."
```

---

### Task 5: Dokumentatsioon ja vastuvõtukriteerium 1

**Files:**
- Modify: `CLAUDE.md:92`, `CLAUDE.md:96`
- Modify: `docs/vutt-backup.md:210-238`

**Interfaces:**
- Consumes: Task 1-4 tulemused
- Produces: dokumentatsioon, mis kirjeldab ühte asukohta; repo-ülene otsing on puhas.

- [ ] **Step 1: Uuenda CLAUDE.md**

Rida 92 — ENNE:

```
| `~/VUTT/state/` | `/app/state` | Runtime: `users.json`, sessioonid, tokenid, `reocr_log.json`, `user_settings/`, `notifications/`, `prosopography/images/` | ei |
```

PÄRAST:

```
| `~/VUTT/state/` | `/app/state` | Runtime: `users.json`, sessioonid, tokenid, `reocr_log.json`, `user_settings/`, `notifications/` | ei |
```

Rida 96 — ENNE:

```
(~2200 isikukaarti; **kaardid ise on siin, ainult pildid on `state/`-is**) ning tuletatud indeksid
```

PÄRAST:

```
(~2350 isikukaarti; **kaardid JA pildid (`prosopography/images/`) on siin** — pildid ei ole gitis, `*.jpg` on ignoreeritud) ning tuletatud indeksid
```

- [ ] **Step 2: Uuenda docs/vutt-backup.md**

Asenda 2026-08-08 lisatud HOIATUS-plokk ja `data/prosopography/` lõik (read ~229-238) järgmisega:

```markdown
> **2026-08-08 seisuga on prosopograafia ühes kohas.** `state/prosopography/`
> ja `data/prosopography/` on kustutatud; kaardid ja pildid elavad
> `data/config/prosopography/` all (`images/` alamkaustas). Pildid ei ole gitis
> — `data/.gitignore` ignoreerib `*.jpg` —, aga `vutt_backup.py` katab nad,
> sest rsync ei vaata git'i. Vt issue #221.
```

Ülejäänud sektsioon (`backup_prosopography.sh` ajalugu) jääb alles — see on
ajaloo kirjeldus, mida vastuvõtukriteerium 1 lubab.

- [ ] **Step 3: Vastuvõtukriteerium 1 — repo-ülene otsing**

```bash
grep -rn "state/prosopography\|data/prosopography" \
  --include="*.py" --include="*.ts" --include="*.tsx" --include="*.sh" \
  server/ scripts/ src/ tests/ .github/
```

Expected: **null tabamust.** Kui midagi leidub, on see runtime-viide, mis pidi kaduma — paranda enne edasiminekut.

```bash
grep -rn "state/prosopography\|data/prosopography" docs/ CLAUDE.md | grep -v "_archive/"
```

Expected: ainult `docs/vutt-backup.md` (ajalugu), `docs/superpowers/specs/2026-08-08-*` ja `docs/superpowers/plans/2026-08-08-*` (see plaan). Kõik muu peab olema puhas.

- [ ] **Step 4: Käivita testid ja commit**

Run: `.venv/bin/pytest tests/ -q`
Expected: kõik roheline.

```bash
git add CLAUDE.md docs/vutt-backup.md
git commit -m "docs(prosopo): üks asukoht, mitte üks ametlik ja kaks aegunud (#221)"
```

---

### Task 6: Tootmisandmete migratsioon (serveris)

**Files:** ei muuda repo faile. See on runbook — iga samm on käsk koos oodatava väljundiga.

**Interfaces:**
- Consumes: Task 1-5 (merge'itud main'i ja serveris `git pull`-itud)
- Produces: server, kus prosopograafial on üks juur.

**Eeltingimus:** Task 1-5 on main'is ja serveris tõmmatud. Tootmiskoodi EI tohi migreerida enne, kui uus `PROSOPOGRAPHY_IMAGES_DIR` on serveri koodis olemas — muidu otsib backend pilte kohast, kuhu neid pole veel viidud.

- [ ] **Step 1: Kontrolli külmunud koopiaid teadaoleva ajaloolise seisu vastu**

Ei piisa sellest, et kaks koopiat on omavahel identsed — küsimus on, kas pärast 2026-05-25 on tekkinud muudatus, mida ei tohi maha visata.

```bash
ssh vutt 'cd ~/VUTT/data && git diff --stat 3ea574c9b -- prosopography/ | tail -3'
```

Expected: tühi väljund (töökataloogi `data/prosopography/` vastab commitile).

```bash
ssh vutt 'cd ~/VUTT && (cd state/prosopography && md5sum *.json | sort) > /tmp/s.md5 && \
  (cd data/prosopography && md5sum *.json | sort) > /tmp/d.md5 && \
  diff /tmp/s.md5 /tmp/d.md5 && echo "IDENTSED"'
```

Expected: `IDENTSED`.

**Lahknevuse korral PEATU** ja vaata erinevused üle enne kustutamist — see tähendaks, et keegi on külmunud koopiat pärast 2026-05-25 muutnud.

- [ ] **Step 2: Seiska backend**

```bash
ssh vutt 'cd ~/VUTT && docker compose stop backend && docker compose ps backend'
```

Expected: `vutt-backend` staatus `exited`.

- [ ] **Step 3: Teisalda pildid**

```bash
ssh vutt 'cd ~/VUTT && ls state/prosopography/images | wc -l && \
  mv state/prosopography/images data/config/prosopography/images && \
  ls data/config/prosopography/images | wc -l'
```

Expected: mõlemad arvud `21`. Kataloogi `mv` on samas failisüsteemis aatomiline `rename`.

- [ ] **Step 4: Kontrolli teisaldust**

```bash
ssh vutt 'cd ~/VUTT && \
  (cd data/config/prosopography/images && md5sum * | sort) > /tmp/new.md5 && \
  (cd data/prosopography/images && md5sum * | sort) > /tmp/mirror.md5 && \
  diff /tmp/new.md5 /tmp/mirror.md5 && echo "SISU SAMA"'
```

Expected: `SISU SAMA` (võrdlus `data/prosopography/images/` peegeldusega, mis on veel alles).

```bash
ssh vutt 'cd ~/VUTT/data && git status --short config/prosopography/ | head'
```

Expected: tühi — pildid on `*.jpg` reegli tõttu ignoreeritud ega ilmu jälgitavana.

- [ ] **Step 5: Deploy ja käivita**

```bash
ssh vutt 'cd ~/VUTT && ./scripts/server_update.sh --no-cache 2>&1 | tail -8'
```

Expected: `✅ Uuendamine valmis!`, `vutt-backend` `Up`.

- [ ] **Step 6: Kontrolli logi**

```bash
ssh vutt 'docker logs vutt-backend --since 2m 2>&1 | grep -iE "error|traceback" | head'
```

Expected: tühi.

- [ ] **Step 7: Suitsutest — pilt laeb**

Ava brauseris isikukaart, millel on pilt (leia üks: `ls ~/VUTT/data/config/prosopography/images | head -1` → nanoid on failinimi), aadressil `https://vutt.utlib.ut.ee/persons/{nanoid}`.

Expected: pilt kuvatakse. Kontrolli ka võrgupäringut: `/api/files/prosopography/{nanoid}/image` annab 200, mitte 404.

**Kui pilt EI lae, PEATU.** Rollback on `mv data/config/prosopography/images state/prosopography/images` + eelmise commiti deploy; vana kataloog on veel alles, sest Step 8 pole tehtud.

- [ ] **Step 8: Alles nüüd kustuta vanad asukohad**

```bash
ssh vutt 'cd ~/VUTT && rm -rf state/prosopography && ls state/ | grep -c prosopography'
```

Expected: `0`.

```bash
ssh vutt 'cd ~/VUTT/data && git rm -r --quiet prosopography && \
  git status --short | head -5'
```

Expected: kustutatud failid staged'ina. **Kontrolli, et `labels.json`, `person_aliases.json` ja `person_to_works.json` muudatused EI OLE staged** — need on sõltumatu runtime-müra ja ei tohi kaasa minna.

```bash
ssh vutt 'cd ~/VUTT/data && git commit -q -m "Eemalda aegunud prosopography/ koopia (VUTT #221)

Kaardid elavad config/prosopography/ all alates 2026-05-25; see koopia oli
külmunud samas seisus ja selle images/ alamkaust dubleeris elavaid pilte.
Sisu on ajaloos commitis 3ea574c9b." -- prosopography && git log --oneline -1'
```

Expected: uus commit, mis puudutab ainult `prosopography/` teed.

- [ ] **Step 8b: Kahe ümbersuunatud skripti kuivkäivitus elavate andmete peal**

Lokaalselt ei saanud neid lõpuni kontrollida — arendusmasina `data/` ei peegelda
tootmist (`places.json` puudub). Siin on päris andmed olemas.

```bash
ssh vutt 'cd ~/VUTT && .venv/bin/python3 scripts/cleanup_place_duplicates.py --dry-run 2>&1 | tail -8'
```

Expected: loeb `data/config/places.json` ja elavaid kaarte, raporteerib
duplikaadid, lõpetab „midagi ei kirjutatud" tüüpi teatega.

```bash
ssh vutt 'cd ~/VUTT && .venv/bin/python3 scripts/mass_enrich_prosopography.py --dry-run --limit 1 2>&1 | tail -8'
```

Expected: „Prosopograafia kirjeid: 2355" (mitte 0 ja mitte 2243) ja
`[DRY RUN] Midagi ei kirjutatud.`

- [ ] **Step 9: Vastuvõtukriteerium 3 — täpselt üks juur**

```bash
ssh vutt 'cd ~/VUTT && echo "state:  $(ls -d state/prosopography 2>&1)"; \
  echo "data:   $(ls -d data/prosopography 2>&1)"; \
  echo "elav:   $(ls data/config/prosopography/*.json | wc -l) kaarti, \
$(ls data/config/prosopography/images | wc -l) pilti"'
```

Expected: kaks esimest rida „No such file or directory", kolmas rida ~2355 kaarti ja 21 pilti.

- [ ] **Step 10: Sulge issue**

```bash
gh issue close 221 --comment "Tehtud. Prosopograafia elab ainult data/config/prosopography/ all (kaardid + images/). state/prosopography/ ja data/prosopography/ on kustutatud, viis kulunud skripti eemaldatud, kaks ümber suunatud. Vastuvõtukriteeriumid kaetud: repo-ülene otsing puhas, PROSOPOGRAPHY_IMAGES_DIR tuletatakse juurest (test), server kontrollitud, isikupilt laeb."
```

---

## Self-Review

**Spec coverage:**

| Spekk | Task |
|---|---|
| Üks juur konfiguratsioonis, pildid tuletatakse | Task 1 |
| Viis kulunud skripti kustutatud | Task 2 |
| Kaks skripti ümber suunatud | Task 3, 4 |
| CLAUDE.md + vutt-backup.md | Task 5 |
| Vastuvõtukriteerium 1 (repo-ülene otsing) | Task 5 Step 3 |
| Vastuvõtukriteerium 2 (konstandi test) | Task 1 Step 1 |
| Vastuvõtukriteerium 3 (üks juur serveris) | Task 6 Step 9 |
| Vastuvõtukriteerium 4 (pilt laeb) | Task 6 Step 7 |
| Plokk A samm 5 (`data/` repo koopia) | Task 6 Step 8 — **teadlik nihe:** spekk pani selle ploki A alla, aga kustutamine peab toimuma serveris pärast suitsutesti, sest `data/prosopography/images/` on ainus järelejäänud koopia piltidest kuni Step 7-ni |
| Ajalooline kontroll `3ea574c9b` vastu | Task 6 Step 1 |
| Suitsutest enne kustutamist | Task 6 Step 7 → 8 |

**Placeholder-kontroll:** kõik sammud sisaldavad päris koodi või päris käsku koos oodatava väljundiga. Ainus tingimuslik koht on Task 4 Step 1 (`PLACES_FILE` olemasolu) — sellel on mõlema haru jaoks selge juhis.

**Tüübi-järjepidevus:** `PROSOPO_DIR`, `INDEX_FILE`, `ALIASES_FILE` on skriptides import-aliased täpselt nendele nimedele, mida ülejäänud skript juba kasutab (Task 3 Step 2, Task 4 Step 2), seega ülejäänud kood ei muutu. `PROSOPOGRAPHY_DIR` / `PROSOPOGRAPHY_IMAGES_DIR` nimed on samad, mida `server/prosopography/state.py:13-14` juba impordib.
