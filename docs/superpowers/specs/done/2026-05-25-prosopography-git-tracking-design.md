# Prosopograafia git-versioonihaldus

**Kuupäev:** 2026-05-25  
**Staatus:** Kinnitatud

## Taust

Doktorant hakkab toimetama rootsi päritolu üliõpilaste isikukaarte. Praegu salvestatakse isikukaardid `state/prosopography/{nanoid}.json` — väljaspool giti, ilma muudatuste ajaloota. Kui admin (sh doktorant) teeb vea, pole tagasipööramine võimalik ja Review lehel pole isikumuudatused nähtavad.

## Eesmärk

- Kõik isikukaardi muudatused lähevad gitti
- Review lehel on isiku-commitid nähtavad koos teiste muudatustega
- PersonDetailPage-l saab näha muudatuste ajalugu ja varasema versiooni taastada

---

## Sektsioon 1: Andmete asukoht

### Muutus

| | Praegu | Edaspidi |
|--|--------|----------|
| Isikukaardid | `state/prosopography/*.json` (`/app/state/prosopography/`) | `data/config/prosopography/*.json` (`/data/config/prosopography/`) |
| Pildid | `state/prosopography/images/` | **Jääb samaks** — binaarfailid gitis on probleemne |

### Config (`server/config.py`)

```python
PROSOPOGRAPHY_DIR = os.path.join(_DATA_CONFIG_DIR, "prosopography")        # oli: _STATE_DIR
PROSOPOGRAPHY_IMAGES_DIR = os.path.join(_STATE_DIR, "prosopography", "images")  # uus eraldi konstant
```

### Docker

Mõlemad mount-id on juba olemas — muutust pole vaja:
- `./data:/data` — katab `data/config/prosopography/`
- `./state:/app/state` — katab pildid

### Migratsioon

Ühekordselt käivitatav skript `scripts/migrate_prosopography_to_git.py`:
1. Loob `data/config/prosopography/` kausta
2. Kopeerib `state/prosopography/*.json` → `data/config/prosopography/`
3. Teeb git-initsiaalse commit-i kõigi ~2218 failiga sõnumiga `Prosopo migratsioon: {N} isikut`
4. (Pildid jäävad `state/prosopography/images/` — ei kopeerita)

---

## Sektsioon 2: Git commit integratsioon

### Muudetavad funktsioonid `server/prosopography/ops.py`-s

| Funktsioon | Muudatus | Commit-sõnum |
|------------|----------|--------------|
| `create_person()` | `atomic_write_json` → `save_with_git()` | `Prosopo loomine: {nimi} [{person_id}]` |
| `update_person()` | `atomic_write_json` → `save_with_git()` | `Prosopo muudatus: {nimi} [{person_id}]` |
| `delete_person()` | `os.remove` → git-tracked deletion | `Prosopo kustutamine: {nimi} [{person_id}]` |
| `merge_person()` | Lisada git-commit source + target failile | `Prosopo liitmine: {source_nimi} → {target_nimi}` |

### Merge täpsustus

`merge_person()` commitab ühe tehinguna (primary + additional_files):
- **Primary:** target isikufail (uuendatud)
- **Additional:** source isikufail (tombstone `record_status: "tombstone"`)

Relatsioonipointerite muudatused teistes isikukaartides (`source_id → target_id`) **ei lähe gitti** — need on lihtsalt viitauuendused.

Märkus: `delete_page_from_git()` on mõeldud teoste struktuurile (`folder_name/base_name`). Isiku kustutamisel on vaja kas `delete_page_from_git("config/prosopography", nanoid)` kohandamist või uut `delete_file_from_git(path)` funktsiooni — implementatsiooni detail.

### Muutmata jäävad

- `_propagate_name_to_works()` — commitab teoste faile, mitte isikukaarte; jääb puutumata
- Piltide üles- ja kustutamine — ei lähe gitti

---

## Sektsioon 3: Review leht

### Commit-tüüpide tuvastamine

Frontend tuvastab isiku-commitid commit-sõnumi prefixi järgi:

| Prefix | Badge | Värv |
|--------|-------|------|
| `Prosopo loomine:` | Isiku ikoon | Roheline |
| `Prosopo muudatus:` | Isiku ikoon | Hall (tavaline) |
| `Prosopo kustutamine:` | Isiku ikoon | Punane |
| `Prosopo liitmine:` | Isiku ikoon | Lilla |
| `Prosopo nime uuendus:` | Isiku ikoon | Hall |
| `Prosopo taastamine:` | Isiku ikoon | Sinine |

### Link isiku kaardile

Praegu näitab commit-kaart linki teosele. Isiku-commitide puhul parsitakse `person_id` commit-sõnumist (`[{person_id}]` lõpus, v.a liitmine) ja näidatakse link PersonDetailPage-le.

Liitmisel (`Prosopo liitmine: A → B`) linki ei kuvata — source on tombstone, target on leitav nimest.

---

## Sektsioon 4: Ajalugu ja taastamine

### Uued backend endpointid (`server/prosopography/router.py`)

```
GET  /prosopography/{person_id}/history
     → [{commit_hash, timestamp, username, message}]
     Kasutab olemasolevat get_file_git_history()

GET  /prosopography/{person_id}/diff?commit={hash}
     → [{field, old_value, new_value}]
     Backendis: loe faili commit-s ja praegu, võrdle JSON-i välju

POST /prosopography/{person_id}/restore
     Body: {commit_hash: str}
     Taastab faili antud commit seisule, teeb uue commit-i
     Commit-sõnum: "Prosopo taastamine: {nimi} [{person_id}]"
     Nõuab admin-rolli
```

### Diff loogika backendis

`get_file_at_commit()` tagastab faili sisu antud commit-is. Backend võrdleb praeguse versiooniga ja tagastab muutunud väljad tasasena (nested väljad punktnotatsiooniga, nt `origin.place`, `imm_year`). Massiivide puhul näidatakse lisatud/eemaldatud elemente.

### PersonDetailPage "Ajalugu" tab

Uus tab (analoogselt Workspace "Ajalugu" tab-iga):
- Commitide nimekiri: kuupäev, kasutajanimi, commit-sõnum
- "Vaata muudatusi" → laiendatav paneel muutunud väljadega (nt `imm_year: 1640 → 1642`)
- "Taasta" nupp (ainult admin) → kinnitusdialoog → `POST /restore`

---

## Mõjutatud failid

**Backend:**
- `server/config.py` — `PROSOPOGRAPHY_DIR`, uus `PROSOPOGRAPHY_IMAGES_DIR`
- `server/prosopography/ops.py` — `create_person`, `update_person`, `delete_person`, `merge_person`
- `server/prosopography/router.py` — uued endpointid `/history`, `/diff`, `/restore`

**Frontend:**
- `src/pages/Review.tsx` — isiku-commitide tuvastamine ja kuvamine
- `src/pages/PersonDetailPage.tsx` — uus "Ajalugu" tab

**Skriptid:**
- `scripts/migrate_prosopography_to_git.py` — ühekordne migratsioon
