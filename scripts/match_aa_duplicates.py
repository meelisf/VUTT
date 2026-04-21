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

    # Päritolukoht — ainult kui tühi (_aa_origin on string, mitte {id,label} dict)
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
                entry["type"] = e["edu_type"]  # "type" not "edu_type" — matches draftToPayload
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
        matching = [tok for tok in long_tokens if tok in search_text]
        if matching:
            # Spetsiifilisus: pikim kattuvate tokenite maksimaalne pikkus
            max_len = max(len(t) for t in matching)
            matches.append((aa, max_len))

    # Järjesta: pikim kattuvus esmalt (spetsiifilisem), siis imm_year ASC
    matches.sort(key=lambda x: (-x[1], x[0].get("imm_year") is None, x[0].get("imm_year") or 9999))
    return [aa for aa, _ in matches]


def _format_candidate_display(c: dict) -> str:
    """Kuvab AA vastet ühel real: 'Andreas Limasius  —  AA:1390  —  imm. 1632'"""
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


def load_progress(progress_path: str) -> dict:
    if os.path.exists(progress_path):
        try:
            with open(progress_path, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data.get("done"), list) and isinstance(data.get("skipped"), list):
                return data
            raise ValueError("vale skeem")
        except Exception as exc:
            bak = progress_path + ".bak"
            print(f"! Progressifail on rikutud ({exc}), alustan nullist. Varukoopia: {bak}", file=sys.stderr)
            try:
                os.rename(progress_path, bak)
            except OSError:
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
    if dry_run:
        print(f"  [DRY RUN] merge_person({source_id!r}, {target_id!r})")
        print(f"  [DRY RUN] AA rikastus + update_person({target_id!r})")
        return True

    from server.prosopography.ops import merge_person, get_person, update_person
    from server.prosopography.enrichment import fetch_and_diff

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
            # Merge õnnestus — isik on done; rikastust ei saa teha
            return True

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
        # Merge juba toimus — isik on done; rikastus vajab käsitsi kontrolli

    return True


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="AA duplikaatide sobitaja")
    parser.add_argument("--dry-run", action="store_true", help="Ära kirjuta — kuva ainult soovitused")
    args = parser.parse_args()

    project_root = _BASE_DIR
    index_path = os.path.join(project_root, "data", "config", "prosopography_index.json")
    progress_path = os.path.join(project_root, "state", "match_aa_progress.json")

    if not os.path.exists(index_path):
        print(f"! Indeksit ei leitud: {index_path}")
        print("  Käivita serveril: cd ~/VUTT && .venv/bin/python3 scripts/match_aa_duplicates.py")
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
        top_matches = matches[:5]

        if not matches:
            print("  (0 vastet — jätan vahele)")
            skipped_ids.add(cid)
            progress["skipped"] = sorted(skipped_ids)
            if not args.dry_run:
                save_progress(progress_path, progress)
            continue

        for j, m in enumerate(top_matches, 1):
            print(f"    {j}) {_format_candidate_display(m)}")

        choices = [str(j) for j in range(1, len(top_matches) + 1)]
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
            progress["skipped"] = sorted(skipped_ids)
            if not args.dry_run:
                save_progress(progress_path, progress)
            print("  Vahele jäetud.")
            continue

        if choice not in choices:
            print(f"  Tundmatu valik '{choice}' — jätan vahele.")
            skipped_ids.add(cid)
            progress["skipped"] = sorted(skipped_ids)
            if not args.dry_run:
                save_progress(progress_path, progress)
            continue

        selected = top_matches[int(choice) - 1]
        source_id = cid
        target_id = selected["id"]

        print(f"\n  Source (tombstone): {source_id}  ({label})")
        print(f"  Target (säilib):    {target_id}  ({selected.get('label')})")

        try:
            confirm = input("  Merge + AA rikastus? [Y/n]: ").strip().lower()
        except (KeyboardInterrupt, EOFError):
            print("\nKatkestatud.")
            break

        if confirm not in ("y", "yes", "j", "jah", ""):
            print("  Tühistatud.")
            skipped_ids.add(cid)
            progress["skipped"] = sorted(skipped_ids)
            if not args.dry_run:
                save_progress(progress_path, progress)
            continue

        success = _do_merge_and_enrich(source_id, target_id, dry_run=args.dry_run)
        if success:
            done_ids.add(cid)
            progress["done"] = sorted(done_ids)
            skipped_ids.discard(cid)
            progress["skipped"] = sorted(skipped_ids)
            if not args.dry_run:
                save_progress(progress_path, progress)

    remaining_after = len(candidates) - len(done_ids) - len(skipped_ids)
    print(f"\nValmis. Tehtud: {len(done_ids)}  |  Vahele jäetud: {len(skipped_ids)}  |  Järel: {remaining_after}")


if __name__ == "__main__":
    main()
