# AA Duplikaatide Sobitaja — Implementatsiooniplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interaktiivne skript `scripts/match_aa_duplicates.py` mis sobitab ~125 sulunimega prosopo isikut AA-koodiga duplikaatidega ja teeb merge + AA rikastuse automaatselt pärast kasutaja kinnitust.

**Architecture:** Skript impordib serverimooduleid otse (`sys.path`) ja kasutab täpselt samu funktsioone mis UI: `merge_person()`, `fetch_and_diff()`, `update_person()`. Puhas loogika (`extract_name_variants`, `apply_aa_to_person`) on TDD-ga kaetud. Interaktiivne tsükkel elab `main()`-is.

**Tech Stack:** Python 3.9, stdlib only. `server.prosopography.ops`, `server.prosopography.enrichment`, `server.config`. Käivitatakse serveril `cd ~/VUTT && python3 scripts/match_aa_duplicates.py`.

---

## Failid

| Fail | Otstarve |
|---|---|
| `scripts/match_aa_duplicates.py` | Peaskript: `extract_name_variants`, `apply_aa_to_person`, `find_aa_candidates`, `main` |
| `tests/test_match_aa_duplicates.py` | Ühiktestid puhaste funktsioonide jaoks |

---

## Task 1: `extract_name_variants` — TDD

**Files:**
- Create: `tests/test_match_aa_duplicates.py`
- Create: `scripts/match_aa_duplicates.py` (ainult see funktsioon)

- [ ] **Samm 1: Kirjuta testid**

```python
# tests/test_match_aa_duplicates.py
"""Testid: extract_name_variants ja apply_aa_to_person."""
import sys
from pathlib import Path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.match_aa_duplicates import extract_name_variants


def test_full_word_in_parens():
    # (Limasius) on täissõna variant
    result = extract_name_variants("Limacius (Limasius), Andreas")
    tokens = set(result)
    assert "limacius" in tokens
    assert "limasius" in tokens
    assert "andreas" in tokens


def test_embedded_letter():
    # Wag(e)ner → wagner (ilma) ja wagener (koos)
    result = extract_name_variants("Wag(e)ner, Heinrich Christian")
    tokens = set(result)
    assert "wagner" in tokens
    assert "wagener" in tokens
    assert "heinrich" in tokens
    assert "christian" in tokens


def test_multiple_embedded():
    # Bus(sch)man(nus) → busman (ilma), busschmannus (koos)
    result = extract_name_variants("Bus(sch)man(nus)")
    tokens = set(result)
    assert "busman" in tokens
    assert "busschmannus" in tokens


def test_complex_combined():
    # Mahlsted(h) (Mahlstede) — sisestus + täissõna
    result = extract_name_variants("Mahlsted(h) (Mahlstede), Arnoldus")
    tokens = set(result)
    assert "mahlsted" in tokens
    assert "mahlstedh" in tokens
    assert "mahlstede" in tokens
    assert "arnoldus" in tokens


def test_short_tokens_excluded():
    # Üksikud tähed suludes (e, h) ei leki iseseisva tokenina
    result = extract_name_variants("Wag(e)ner")
    tokens = set(result)
    assert "e" not in tokens


def test_no_parens():
    result = extract_name_variants("Johannes Limasius")
    tokens = set(result)
    assert "johannes" in tokens
    assert "limasius" in tokens
```

- [ ] **Samm 2: Käivita testid — veendu, et kukuvad**

```bash
cd ~/LLM/VUTT && python3 -m pytest tests/test_match_aa_duplicates.py -v
```

Oodatav: `ModuleNotFoundError` (skript ei eksisteeri veel)

- [ ] **Samm 3: Loo skript, implementeeri `extract_name_variants`**

```python
# scripts/match_aa_duplicates.py
"""
Interaktiivne skript sulunimega prosopo isikute sobitamiseks AA-koodiga duplikaatidega.

Käivitus (serveril):
    cd ~/VUTT && python3 scripts/match_aa_duplicates.py
    python3 scripts/match_aa_duplicates.py --dry-run   # merge ei toimu

Progress salvestatakse: state/match_aa_progress.json
"""
import json
import os
import re
import sys
from typing import Optional

# Projekti juur sys.path-i — serverimoodulite importimiseks
_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BASE_DIR not in sys.path:
    sys.path.insert(0, _BASE_DIR)


def extract_name_variants(label: str) -> list:
    """
    Ekstraheerib kõik nimevariandid sulgunimest.

    "Limacius (Limasius), Andreas" → ["limacius", "limasius", "andreas"]
    "Wag(e)ner, Heinrich"          → ["wagner", "wagener", "heinrich"]
    "Bus(sch)man(nus)"             → ["busman", "busschmannus"]
    """
    tokens = set()

    # 1. Täissõna variandid suludes (≥4 tähemärki)
    for v in re.findall(r'\(([A-Za-zÀ-ÿ]{4,})\)', label):
        tokens.add(v.lower())

    # 2. Stripitud versioon — sulud eemaldatud: Wag(e)ner → wagner
    stripped = re.sub(r'\([^)]*\)', '', label)
    for w in re.split(r'[,\s]+', stripped):
        if len(w) >= 3:
            tokens.add(w.lower())

    # 3. Kaasav versioon — sulu sisu lisatakse: Wag(e)ner → wagener
    included = re.sub(r'\(([^)]*)\)', r'\1', label)
    for w in re.split(r'[,\s]+', included):
        if len(w) >= 3:
            tokens.add(w.lower())

    return list(tokens)
```

- [ ] **Samm 4: Käivita testid — veendu, et läbivad**

```bash
python3 -m pytest tests/test_match_aa_duplicates.py::test_full_word_in_parens tests/test_match_aa_duplicates.py::test_embedded_letter tests/test_match_aa_duplicates.py::test_multiple_embedded tests/test_match_aa_duplicates.py::test_complex_combined tests/test_match_aa_duplicates.py::test_short_tokens_excluded tests/test_match_aa_duplicates.py::test_no_parens -v
```

Oodatav: kõik 6 PASS

- [ ] **Samm 5: Commit**

```bash
git add scripts/match_aa_duplicates.py tests/test_match_aa_duplicates.py
git commit -m "feat: extract_name_variants sulunimede jaoks + testid"
```

---

## Task 2: `apply_aa_to_person` — TDD

Funktsioon replitseerib `applyEnrichmentToDraft` + `draftToPayload` (helpers.ts) loogika Pythonis. **EI kasuta** `apply_enrichment()` serverifunktsiooni — see salvestaks `_aa_education` raw väljana ega mergi education massiivi.

**Files:**
- Modify: `tests/test_match_aa_duplicates.py` — lisa testid
- Modify: `scripts/match_aa_duplicates.py` — lisa funktsioon

- [ ] **Samm 1: Lisa testid faili `tests/test_match_aa_duplicates.py`**

Lisa importi:
```python
from scripts.match_aa_duplicates import extract_name_variants, apply_aa_to_person
```

Lisa testid (kopeerita olemasoleva testide alla):
```python
# ── apply_aa_to_person testid ─────────────────────────────────────────────

def test_apply_biography_only_if_empty():
    person = {"id": "vutt:Pt1", "name": {"label": "Test"}, "biography": ""}
    result = apply_aa_to_person(person, {"biography": "Sündis 1610..."})
    assert result["biography"] == "Sündis 1610..."


def test_apply_biography_not_overwritten():
    person = {"id": "vutt:Pt1", "name": {"label": "Test"}, "biography": "Olemasolev bio"}
    result = apply_aa_to_person(person, {"biography": "Uus bio"})
    assert result["biography"] == "Olemasolev bio"


def test_apply_birth_date():
    person = {"id": "vutt:Pt1", "name": {"label": "Test"}}
    result = apply_aa_to_person(person, {"birth.date": "1610-03-15", "birth.precision": "day"})
    assert result["birth"]["date"] == "1610-03-15"
    assert result["birth"]["precision"] == "day"
    assert result["birth"]["is_circa"] is False


def test_apply_birth_year_precision():
    person = {"id": "vutt:Pt1", "name": {"label": "Test"}}
    result = apply_aa_to_person(person, {"birth.date": "1610", "birth.precision": "year"})
    assert result["birth"]["date"] == "1610-01-01"
    assert result["birth"]["precision"] == "year"


def test_apply_education_dedup():
    person = {
        "id": "vutt:Pt1",
        "name": {"label": "Test"},
        "education": [
            {"institution": "Academia Gustaviana", "type": "imm.",
             "date_from": {"date": "1632-05-10", "precision": "day"}}
        ],
    }
    auto_filled = {
        "_aa_education": [
            {"institution": "Academia Gustaviana", "edu_type": "imm.",
             "date_from": {"date": "1632-05-10", "precision": "day"}, "source": "album_academicum"},
            {"institution": "Universität Rostock", "edu_type": "imm.",
             "date_from": {"date": "1628-01-01", "precision": "year"}, "source": "album_academicum"},
        ]
    }
    result = apply_aa_to_person(person, auto_filled)
    insts = [e["institution"] for e in result["education"]]
    assert len(insts) == 2
    assert "Academia Gustaviana" in insts
    assert "Universität Rostock" in insts


def test_apply_education_type_key():
    # Salvestatav hariduskirje kasutab "type" (mitte "edu_type") — nagu draftToPayload
    person = {"id": "vutt:Pt1", "name": {"label": "Test"}, "education": []}
    auto_filled = {
        "_aa_education": [
            {"institution": "Academia Gustaviana", "edu_type": "imm.",
             "date_from": {"date": "1632-05-10", "precision": "day"}, "source": "album_academicum"}
        ]
    }
    result = apply_aa_to_person(person, auto_filled)
    edu = result["education"][0]
    assert edu.get("type") == "imm."
    assert "edu_type" not in edu


def test_apply_origin_only_if_empty():
    person = {"id": "vutt:Pt1", "name": {"label": "Test"}, "origin": {"place": None}}
    result = apply_aa_to_person(person, {"_aa_origin": "Liivimaa"})
    assert result["origin"]["place"] == "Liivimaa"


def test_apply_origin_not_overwritten():
    person = {"id": "vutt:Pt1", "name": {"label": "Test"}, "origin": {"place": "Eestimaa"}}
    result = apply_aa_to_person(person, {"_aa_origin": "Liivimaa"})
    assert result["origin"]["place"] == "Eestimaa"


def test_apply_name_aliases():
    person = {"id": "vutt:Pt1", "name": {"label": "Andreas Limasius", "aliases": []}}
    result = apply_aa_to_person(person, {"name.aliases": ["Limacius", "Limazius"]})
    assert result["name"]["aliases"] == ["Limacius", "Limazius"]


def test_apply_does_not_mutate_input():
    person = {"id": "vutt:Pt1", "name": {"label": "Test"}, "biography": ""}
    apply_aa_to_person(person, {"biography": "Uus bio"})
    assert person["biography"] == ""  # originaal muutumata
```

- [ ] **Samm 2: Käivita testid — veendu, et kukuvad**

```bash
python3 -m pytest tests/test_match_aa_duplicates.py -k "apply" -v
```

Oodatav: `ImportError: cannot import name 'apply_aa_to_person'`

- [ ] **Samm 3: Implementeeri `apply_aa_to_person` ja `_build_historical_date`**

Lisa skriptile `scripts/match_aa_duplicates.py` otse `extract_name_variants` järele:

```python
def _build_historical_date(date_str: str, precision: str, existing: Optional[dict] = None) -> dict:
    """Ehitab HistoricalDate objekti. Säilitab olemasoleva koha kui on."""
    y = date_str[:4]
    m = date_str[5:7] if precision != "year" and len(date_str) >= 7 else "01"
    d = date_str[8:10] if precision == "day" and len(date_str) >= 10 else "01"
    result = {
        "original_text": None,
        "date": f"{y}-{m}-{d}",
        "date_to": None,
        "bound": None,
        "precision": precision,
        "calendar": None,
        "is_circa": False,
        "place": None,
        "notes": None,
    }
    if existing:
        for field in ("place", "is_circa", "calendar", "bound", "original_text"):
            if existing.get(field):
                result[field] = existing[field]
    return result


def apply_aa_to_person(person: dict, auto_filled: dict) -> dict:
    """
    Rakendab AA rikastuse isiku dictile.
    Replitseerib applyEnrichmentToDraft + draftToPayload (helpers.ts) loogika.
    EI kasuta apply_enrichment() — see salvestaks _aa_education raw väljana.
    """
    import copy
    p = copy.deepcopy(person)

    # Nimi
    name = p.setdefault("name", {})
    if auto_filled.get("name.label") and not (name.get("label") or "").strip():
        name["label"] = auto_filled["name.label"]
    if auto_filled.get("name.aliases"):
        name["aliases"] = auto_filled["name.aliases"]

    # Sünnikuupäev
    if auto_filled.get("birth.date"):
        p["birth"] = _build_historical_date(
            auto_filled["birth.date"],
            auto_filled.get("birth.precision", "day"),
            existing=p.get("birth"),
        )
    # Sünnikoht — ainult kui tühi
    if auto_filled.get("birth.place") and not (p.get("birth") or {}).get("place"):
        birth = p.setdefault("birth", {})
        bp = auto_filled["birth.place"]
        birth["place"] = {"id": bp.get("id"), "label": bp["label"]}

    # Surmakuupäev
    if auto_filled.get("death.date"):
        p["death"] = _build_historical_date(
            auto_filled["death.date"],
            auto_filled.get("death.precision", "day"),
            existing=p.get("death"),
        )
    # Surmakoht — ainult kui tühi
    if auto_filled.get("death.place") and not (p.get("death") or {}).get("place"):
        death = p.setdefault("death", {})
        dp = auto_filled["death.place"]
        death["place"] = {"id": dp.get("id"), "label": dp["label"]}

    # Biograafia — ainult kui tühi
    if auto_filled.get("biography") and not (p.get("biography") or "").strip():
        p["biography"] = auto_filled["biography"]

    # Päritolukoht — ainult kui tühi
    if auto_filled.get("_aa_origin"):
        origin = p.setdefault("origin", {})
        if not origin.get("place"):
            origin["place"] = auto_filled["_aa_origin"]

    # Haridustee — dedup institution nime järgi (case-insensitive)
    if auto_filled.get("_aa_education"):
        existing_edu = p.get("education") or []
        existing_inst = {(e.get("institution") or "").lower() for e in existing_edu}
        new_entries = []
        for e in auto_filled["_aa_education"]:
            inst_raw = e.get("institution") or ""
            if not inst_raw or inst_raw.lower() in existing_inst:
                continue
            entry: dict = {"institution": inst_raw}
            if e.get("edu_type"):
                entry["type"] = e["edu_type"]  # "type" mitte "edu_type" — nagu draftToPayload
            if e.get("source"):
                entry["source"] = e["source"]
            if e.get("date_from") and e["date_from"].get("date"):
                entry["date_from"] = _build_historical_date(
                    e["date_from"]["date"],
                    e["date_from"].get("precision", "day"),
                )
            new_entries.append(entry)
            existing_inst.add(inst_raw.lower())
        if new_entries:
            p["education"] = existing_edu + new_entries

    return p
```

- [ ] **Samm 4: Käivita testid — veendu, et läbivad**

```bash
python3 -m pytest tests/test_match_aa_duplicates.py -v
```

Oodatav: kõik testid PASS

- [ ] **Samm 5: Commit**

```bash
git add scripts/match_aa_duplicates.py tests/test_match_aa_duplicates.py
git commit -m "feat: apply_aa_to_person rikastuse rakendamine + testid"
```

---

## Task 3: Kandidaatide laadimine ja vasteteotsing

**Files:**
- Modify: `scripts/match_aa_duplicates.py` — lisa `find_aa_candidates`, `load_index_and_split`, `_format_candidate_display`

- [ ] **Samm 1: Lisa funktsioonid skripti**

Lisa `apply_aa_to_person` järele:

```python
def load_index_and_split(index_path: str) -> tuple:
    """
    Laeb prosopography_index.json, jagab kaheks:
      candidates — sulunimega, has_aa=False, record_status!=tombstone
      aa_persons  — has_aa=True, record_status!=tombstone
    """
    with open(index_path, encoding="utf-8") as f:
        index = json.load(f)
    entries = [e for e in index.get("entries", []) if e.get("record_status") != "tombstone"]
    candidates = [
        e for e in entries
        if not e.get("has_aa") and re.search(r'\([^)]+\)', e.get("label", ""))
    ]
    aa_persons = [e for e in entries if e.get("has_aa")]
    return candidates, aa_persons


def find_aa_candidates(candidate: dict, aa_persons: list) -> list:
    """
    Otsib AA-koodiga vasteid candidate nimevariantide põhjal.
    Nõuab vähemalt ühe ≥5-tähemärgise tokeni esinemist label või sort_name väljal.
    Tagastab vastelisti, järjestatud imm_year ASC (None viimasena).
    """
    tokens = extract_name_variants(candidate.get("label", ""))
    long_tokens = [t for t in tokens if len(t) >= 5]
    if not long_tokens:
        return []

    matches = []
    for aa in aa_persons:
        search_text = (
            (aa.get("label") or "").lower() + " " +
            (aa.get("sort_name") or "").lower()
        )
        if any(tok in search_text for tok in long_tokens):
            matches.append(aa)

    # Järjesta imm_year ASC, None viimasena
    matches.sort(key=lambda x: (x.get("imm_year") is None, x.get("imm_year") or 9999))
    return matches


def _format_candidate_display(c: dict) -> str:
    """Kuvab AA vastet: 'Andreas Limasius — AA:1390, imm. 1632'"""
    parts = [c.get("label", c.get("id", "?"))]
    aa_num = c.get("aa_number")
    if aa_num:
        parts.append(f"AA:{aa_num}")
    imm = c.get("imm_year")
    if imm:
        parts.append(f"imm. {imm}")
    wc = c.get("work_count") or 0
    if wc:
        parts.append(f"{wc} teos")
    return "  —  ".join(parts)
```

- [ ] **Samm 2: Kiirtest käsurealt**

```bash
cd ~/LLM/VUTT && python3 -c "
from scripts.match_aa_duplicates import extract_name_variants, find_aa_candidates
print(extract_name_variants('Limacius (Limasius), Andreas'))
"
```

Oodatav: nimevariandid prinditud, viga pole

- [ ] **Samm 3: Commit**

```bash
git add scripts/match_aa_duplicates.py
git commit -m "feat: load_index_and_split + find_aa_candidates"
```

---

## Task 4: Interaktiivne põhitsükkel ja merge+rikastuse voog

**Files:**
- Modify: `scripts/match_aa_duplicates.py` — lisa `_do_merge_and_enrich`, `load_progress`, `save_progress`, `main`

- [ ] **Samm 1: Lisa merge+rikastuse loogika**

Lisa skripti lõppu (enne `if __name__ == "__main__":` blokki):

```python
def load_progress(progress_path: str) -> dict:
    if os.path.exists(progress_path):
        try:
            with open(progress_path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"done": [], "skipped": []}


def save_progress(progress_path: str, progress: dict) -> None:
    tmp = progress_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(progress, f, ensure_ascii=False, indent=2)
    os.replace(tmp, progress_path)


def _do_merge_and_enrich(source_id: str, target_id: str, dry_run: bool = False) -> bool:
    """
    Merge source → target, seejärel rakenda AA rikastus target'ile.
    Tagastab True edukal läbiviimisel.
    """
    from server.prosopography.ops import merge_person, get_person, update_person
    from server.prosopography.enrichment import fetch_and_diff

    if dry_run:
        print(f"  [DRY RUN] merge_person({source_id!r}, {target_id!r})")
        print(f"  [DRY RUN] AA rikastus + update_person({target_id!r})")
        return True

    # 1. Merge
    try:
        merge_person(source_id, target_id, username="match_aa_script")
        print("  ✓ Liidetud")
    except Exception as e:
        print(f"  ! Merge viga: {e}")
        return False

    # 2. AA rikastus
    try:
        person = get_person(target_id)
        aa_id = next(
            (i["id"] for i in (person.get("identifiers") or [])
             if i.get("scheme") == "album_academicum"),
            None,
        )
        if not aa_id:
            print("  ! Target'il puudub AA identifikaator pärast merge'i")
            return True  # Merge õnnestus, rikastus ebaõnnestus — jätka

        diff = fetch_and_diff("album_academicum", aa_id, person)
        auto_filled = diff.get("auto_filled", {})
        if not auto_filled:
            print("  ✓ AA rikastus: uusi välju pole")
            return True

        updated = apply_aa_to_person(person, auto_filled)
        update_person(target_id, updated, username="match_aa_script")
        filled_fields = list(auto_filled.keys())
        print(f"  ✓ AA rikastus rakendatud ({len(filled_fields)} välja: {', '.join(filled_fields[:5])}{'...' if len(filled_fields) > 5 else ''})")
    except Exception as e:
        print(f"  ! AA rikastuse viga: {e}")
        # Merge juba toimus — ei blokeeri

    return True


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="AA duplikaatide sobitaja")
    parser.add_argument("--dry-run", action="store_true", help="Ära kirjuta — kuva ainult soovitused")
    args = parser.parse_args()

    # Teed
    project_root = _BASE_DIR
    index_path = os.path.join(project_root, "data", "config", "prosopography_index.json")
    progress_path = os.path.join(project_root, "state", "match_aa_progress.json")

    if not os.path.exists(index_path):
        print(f"! Indeksit ei leitud: {index_path}")
        print("  Käivita serveril: cd ~/VUTT && python3 scripts/match_aa_duplicates.py")
        sys.exit(1)

    print("Laen indeksit...")
    candidates, aa_persons = load_index_and_split(index_path)
    progress = load_progress(progress_path)
    done_ids = set(progress.get("done", []))
    skipped_ids = set(progress.get("skipped", []))

    remaining = [c for c in candidates if c["id"] not in done_ids and c["id"] not in skipped_ids]
    total = len(candidates)
    done_count = len(done_ids)

    print(f"Kandidaate: {total}  |  Tehtud: {done_count}  |  Järel: {len(remaining)}")
    if args.dry_run:
        print("[DRY RUN režiim — midagi ei kirjutata]\n")

    for i, candidate in enumerate(remaining, start=done_count + 1):
        cid = candidate["id"]
        label = candidate.get("label", cid)
        wc = candidate.get("work_count") or 0

        print(f"\n[{i}/{total}] {label}  ({wc} teos{'t' if wc != 1 else ''})")

        matches = find_aa_candidates(candidate, aa_persons)

        if not matches:
            print("  (0 vastet — jätan vahele)")
            skipped_ids.add(cid)
            progress["skipped"] = list(skipped_ids)
            save_progress(progress_path, progress)
            continue

        for j, m in enumerate(matches[:5], 1):
            print(f"    {j}) {_format_candidate_display(m)}")

        choices = [str(j) for j in range(1, len(matches[:5]) + 1)]
        prompt = f"  Vali [{'/'.join(choices)}/s(ki)/q(uit)]: "

        try:
            choice = input(prompt).strip().lower()
        except (KeyboardInterrupt, EOFError):
            print("\nKatkestatud.")
            break

        if choice == "q":
            print("Lõpetan.")
            break

        if choice in ("s", "skip", ""):
            skipped_ids.add(cid)
            progress["skipped"] = list(skipped_ids)
            save_progress(progress_path, progress)
            print("  Vahele jäetud.")
            continue

        if choice not in choices:
            print(f"  Tundmatu valik '{choice}' — jätan vahele.")
            skipped_ids.add(cid)
            progress["skipped"] = list(skipped_ids)
            save_progress(progress_path, progress)
            continue

        selected = matches[int(choice) - 1]
        source_id = cid         # sulunimega isik → tombstone
        target_id = selected["id"]  # AA-koodiga isik → säilib

        print(f"\n  Source (tombstone): {source_id}  ({label})")
        print(f"  Target (säilib):    {target_id}  ({selected.get('label')})")

        try:
            confirm = input("  Merge + AA rikastus? [y/n]: ").strip().lower()
        except (KeyboardInterrupt, EOFError):
            print("\nKatkestatud.")
            break

        if confirm not in ("y", "yes", "j", "jah"):
            print("  Tühistatud.")
            skipped_ids.add(cid)
            progress["skipped"] = list(skipped_ids)
            save_progress(progress_path, progress)
            continue

        success = _do_merge_and_enrich(source_id, target_id, dry_run=args.dry_run)
        if success:
            done_ids.add(cid)
            progress["done"] = list(done_ids)
            # Eemalda skipped-st kui oli seal
            skipped_ids.discard(cid)
            progress["skipped"] = list(skipped_ids)
            save_progress(progress_path, progress)

    remaining_after = len(candidates) - len(done_ids) - len(skipped_ids)
    print(f"\nValmis. Tehtud: {len(done_ids)}  |  Vahele jäetud: {len(skipped_ids)}  |  Järel: {remaining_after}")


if __name__ == "__main__":
    main()
```

- [ ] **Samm 2: Käivita kõik testid — veendu, et ei läinud katki**

```bash
python3 -m pytest tests/test_match_aa_duplicates.py -v
```

Oodatav: kõik testid PASS

- [ ] **Samm 3: Kontrolli `--help`**

```bash
cd ~/LLM/VUTT && python3 scripts/match_aa_duplicates.py --help
```

Oodatav: argparse help tekst, veaga ei lõppe

- [ ] **Samm 4: Commit**

```bash
git add scripts/match_aa_duplicates.py
git commit -m "feat: match_aa_duplicates interaktiivne põhitsükkel + merge/enrich voog"
```

---

## Task 5: Serveril testimine dry-run režiimis

See samm tehakse **serveril**, mitte lokaalses masinas.

**Files:** (muudatused puuduvad — ainult testimine)

- [ ] **Samm 1: Lükka muudatused serverile**

Lokaalses masinas:
```bash
git push
```

Serveril:
```bash
ssh vutt
cd ~/VUTT && git pull
```

- [ ] **Samm 2: Käivita dry-run**

```bash
cd ~/VUTT && python3 scripts/match_aa_duplicates.py --dry-run
```

Oodatav väljund (ligikaudu):
```
Laen indeksit...
Kandidaate: 125  |  Tehtud: 0  |  Järel: 125
[DRY RUN režiim — midagi ei kirjutata]

[1/125] Limacius (Limasius), Andreas  (1 teoset)
    1) Andreas Limasius  —  AA:1390  —  imm. 1632
    ...
  Vali [1/s(ki)/q(uit)]: 
```

Kui näed kandidaate ja vasteteid — skript töötab. Trüki `q` ja lõpeta.

- [ ] **Samm 3: Kui dry-run toimib, proovi ühe reaalse merge'iga**

Vali üks selge match, sisesta `1`, kinnita `y`. Kontrolli serveris:
```bash
# Vaata, et target isiku kaardil on AA andmed
grep -r "Academia Gustaviana" state/prosopography/ | head -3
```

- [ ] **Samm 4: Lõplik commit kui kõik ok**

```bash
git add scripts/match_aa_duplicates.py tests/test_match_aa_duplicates.py
git commit -m "chore: match_aa_duplicates serveril testitud"
```
