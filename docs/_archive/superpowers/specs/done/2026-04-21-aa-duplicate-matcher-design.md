# AA duplikaatide sobitaja — disainidokument

**Kuupäev:** 2026-04-21  
**Staatus:** Kinnitatud

## Eesmärk

Automatiseerida ~125 sulunimega isiku (nt `Limacius (Limasius), Andreas`) sobitamine AA-koodiga duplikaatidega. Skript käib isikud interaktiivselt läbi, kasutaja kinnitab iga paari, skript teeb merge + AA rikastuse automaatselt.

## Käivitamine

```bash
ssh vutt
cd ~/VUTT && python3 scripts/match_aa_duplicates.py
```

Python 3.9, ainult stdlib + olemasolevad serveri moodulid. Ei nõua autentimist.

## Kandidaatide tuvastamine

Laeb `data/config/prosopography_index.json`, filtreerib:
- `label` sisaldab `(...)` mustrit (`re.search(r'\([^)]+\)', label)`)
- `has_aa == False`
- `record_status != tombstone`

## Nimevariantide ekstraheerimine

Kolmeastmeline ekstraheerimine katab peamised mustrid:

```python
def extract_name_variants(label: str) -> list[str]:
    tokens = set()
    # 1. Täissõna variandid suludes (≥4 tähemärki): (Limasius) → "limasius"
    for v in re.findall(r'\(([A-Za-zÀ-ÿ]{4,})\)', label):
        tokens.add(v.lower())
    # 2. Stripitud: Wag(e)ner → "wagner"
    stripped = re.sub(r'\([^)]*\)', '', label)
    for w in re.split(r'[,\s]+', stripped):
        if len(w) >= 3: tokens.add(w.lower())
    # 3. Kaasav: Wag(e)ner → "wagener"
    included = re.sub(r'\(([^)]*)\)', r'\1', label)
    for w in re.split(r'[,\s]+', included):
        if len(w) >= 3: tokens.add(w.lower())
    return list(tokens)
```

Teadaolev piirang: osalised kombinatsioonid (nt `Bus(sch)man(nus)` → `Busschman`) ei teki. Sellised jäävad "0 vastet" alla käsitsi lahendada.

## Vasteteotsing

AA-koodiga isikute hulgas (`has_aa == True`, `record_status != tombstone`):
- Kontrollib tokeneid `label.lower()` ja `sort_name.lower()` vastu (`in`-test)
- Nõuab vähemalt ühe ≥5-tähemärgise tokeni vastet (vähendab eesnime-müra)
- Järjestab vasteteks: kõigepealt madalama `imm_year`-iga (kasutaja näeb ise, kas sobib)

## Interaktsioon

```
[7/125] Limacius (Limasius), Andreas  (1 teos, ~1632)
  Vasted:
    1) Andreas Limasius  — AA:1390, imm. 1632  ✓ sobib
    2) Johannes Limasius — AA:2104, imm. 1647

  Vali [1/2/s(ki)/q(uit)]:
  → Kinnitad: merge + AA rikastus? [y/n]:
  ✓ Liidetud. AA andmed rakendatud. Salvestatud.
```

Käsud: `1..n` vastet valida, `s` vahele jätta, `q` lõpetada (progress salvestatakse).

## Merge + rikastuse voog (pärast kinnitust)

Kasutab täpselt samu serverifunktsioone mis UI:

```python
# 1. Merge
merge_person(source_id, target_id, username="script")

# 2. AA rikastuse diff
person = get_person(target_id)
aa_id = next(i["id"] for i in person["identifiers"] if i["scheme"] == "album_academicum")
diff = fetch_and_diff("album_academicum", aa_id, person)

# 3. Rakenda auto_filled isiku dictile (apply_aa_to_person)
updated = apply_aa_to_person(person, diff["auto_filled"])

# 4. Salvesta (sama mis UI "Salvesta" nupp)
update_person(target_id, updated, username="script")
```

## `apply_aa_to_person()` — UI loogika Pythonis

Replitseerib `applyEnrichmentToDraft` + `draftToPayload` (helpers.ts) loogika.  
**EI kasuta** `apply_enrichment()` serverifunktsiooni — see salvestaks `_aa_education` raw väljana.

| `auto_filled` väli | Tegevus |
|---|---|
| `name.label` | `person["name"]["label"]` — ainult kui tühi |
| `name.aliases` | `person["name"]["aliases"] = [...]` |
| `birth.date` + `birth.precision` | Ehitab HistoricalDate obj, kirjutab `person["birth"]` |
| `death.date` + `death.precision` | Sama, `person["death"]` |
| `biography` | `person["biography"]` — ainult kui tühi |
| `_aa_origin` | `person["origin"]["place"]` — ainult kui tühi |
| `_aa_education` | Liidab `person["education"]` listi, dedup institution nime järgi (case-insensitive) |

HistoricalDate formaat (`buildDatePayload` ekvivalent):
```python
def build_historical_date(date_str: str, precision: str) -> dict:
    y = date_str[:4]
    m = date_str[5:7] if precision != "year" and len(date_str) >= 7 else "01"
    d = date_str[8:10] if precision == "day" and len(date_str) >= 10 else "01"
    return {
        "original_text": None, "date": f"{y}-{m}-{d}", "date_to": None,
        "bound": None, "precision": precision, "calendar": None,
        "is_circa": False, "place": None, "notes": None,
    }
```

## Progress ja taaskäivitamine

Skript salvestab tehtud otsused `scripts/match_aa_progress.json`-i:
```json
{"done": ["vutt:Pabc123", ...], "skipped": ["vutt:Pdef456", ...]}
```
Taaskäivitamisel jätab juba käsitletud isikud vahele.

## Failid

| Fail | Otstarve |
|---|---|
| `scripts/match_aa_duplicates.py` | Peaskript |
| `scripts/match_aa_progress.json` | Progress (gitignore'd) |

## Piirangud

- Osalised nimekombinatsiooonid (`Busschman` jne) ei pruugi tuvastuda — käsitsi lahendada
- `imm_year` puudumisel sorteeritakse ajaliselt sobivuse kontroll ära
- Ainult admin-õigustega kasutaja (`username="script"`) — logidesse jääb kirje
