"""
Impordib Album Academicum kirjed VUTT prosopograafiasse.
- Olemasolevad kaardid (AA number tuvastatud): uuendab puuduvad väljad
- Uued kirjed: loob kaardi koos kõigi AA andmetega

Käivita: python3 scripts/import_aa_persons.py [--dry-run] [--update-only] [--new-only]
"""
import glob, json, os, re, sys
from datetime import datetime, timezone

DATA_ROOT = os.getenv("VUTT_DATA_DIR", "data")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
STATE_DIR = os.path.join(REPO_ROOT, "state")
PROSOPO_DIR = os.path.join(STATE_DIR, "prosopography")
PLACES_FILE = os.path.join(DATA_ROOT, "config", "places.json")
AA_FILE = os.path.join(REPO_ROOT, "reference_data", "album_academicum.json")

DRY_RUN = "--dry-run" in sys.argv
UPDATE_ONLY = "--update-only" in sys.argv
NEW_ONLY = "--new-only" in sys.argv


# ---------------------------------------------------------------------------
# Abifunktsioonid
# ---------------------------------------------------------------------------

def parse_name_part(s: str):
    """
    Parsib AA nimekuju sulgedega:
      "Lot(t)ichius" → canonical="Lotichius", variants=["Lottichius"]
      "Johan(nes)"   → canonical="Johan",     variants=["Johannes"]
    Tagastab (canonical, [variants])
    """
    if not s or "(" not in s:
        return (s or "").strip(), []
    canonical = re.sub(r"\([^)]*\)", "", s).strip()
    with_content = re.sub(r"\(([^)]*)\)", r"\1", s).strip()
    variants = [with_content] if with_content != canonical else []
    return canonical, variants


def build_place_lookup(places: dict) -> dict:
    """Ehitab kõik nimevariandid → kanooniline võti."""
    lookup = {}
    for key, entry in places.items():
        lookup[key.lower()] = key
        for hn in (entry.get("historical_names") or []):
            lookup[hn.lower()] = key
        for lbl in (entry.get("labels") or {}).values():
            if lbl:
                lookup[lbl.lower()] = key
    return lookup


def resolve_place(origin: dict, lookup: dict):
    """Tagastab places.json võtme või None."""
    for candidate in [
        origin.get("standardized_region"),
        origin.get("city"),
    ]:
        if candidate and candidate.strip().lower() in lookup:
            return lookup[candidate.strip().lower()]
    return None


def year_from_date(date_str) -> str | None:
    """'1696-01-21' → '1696', '1683' → '1683', None → None"""
    if not date_str:
        return None
    return str(date_str).split("-")[0]


def make_education_entry(institution: str, type_: str, date_str, notes=None) -> dict:
    return {
        "institution": institution,
        "institution_id": None,
        "type": type_,
        "date_start": date_str or None,
        "date_end": None,
        "degree": None,
        "subject": None,
        "notes": notes,
        "source": "album_academicum",
    }


def aa_education_entries(aa_entry: dict) -> list:
    """Koostab education kirjed: imm. + teised ülikoolid."""
    entries = []
    # Immatrikuleerimiskuupäev Academia Gustavianas
    entry_date = aa_entry.get("entry_date")
    if entry_date:
        entries.append(make_education_entry("Academia Gustaviana", "imm.", entry_date))
    # Õpingud teistes ülikoolides
    for s in (aa_entry.get("studies") or []):
        inst = s.get("institution")
        if not inst:
            continue
        entries.append(make_education_entry(
            inst,
            s.get("type") or "Stud.",
            year_from_date(s.get("date")),
            s.get("notes"),
        ))
    return entries


def edu_key(e: dict) -> tuple:
    """Unikaalne võti duplikaatide kontrollimiseks."""
    return (e.get("institution", "").lower(), e.get("date_start"), (e.get("type") or "").lower())


def gen_vutt_id(existing_ids: set) -> str:
    import random, string
    chars = string.ascii_lowercase + string.digits
    while True:
        uid = "vutt:P" + "".join(random.choices(chars, k=7))
        if uid not in existing_ids:
            return uid


# ---------------------------------------------------------------------------
# Peamine loogika
# ---------------------------------------------------------------------------

def load_existing_prosopo() -> tuple[dict, dict, set]:
    """
    Tagastab:
      aa_num_to_path  — AA number (int) → failitee
      aa_num_to_data  — AA number (int) → isikukaart
      existing_ids    — kõik vutt:P... ID-d
    """
    aa_num_to_path = {}
    aa_num_to_data = {}
    existing_ids = set()
    for fpath in glob.glob(os.path.join(PROSOPO_DIR, "*.json")):
        try:
            p = json.load(open(fpath))
        except Exception:
            continue
        pid = p.get("id", "")
        existing_ids.add(pid)
        for ident in (p.get("identifiers") or []):
            if ident.get("scheme") == "album_academicum":
                aa_id = ident.get("id", "")
                if aa_id.startswith("AA:"):
                    try:
                        num = int(aa_id[3:])
                        aa_num_to_path[num] = fpath
                        aa_num_to_data[num] = p
                    except ValueError:
                        pass
    return aa_num_to_path, aa_num_to_data, existing_ids


def update_existing(person: dict, aa_entry: dict, place_key, places: dict) -> list[str]:
    """
    Uuendab olemasolevat kaarti puuduvate väljadega.
    Tagastab loendi muudatustest.
    """
    changes = []
    aa_person = aa_entry["person"]

    # Sünniaasta
    aa_birth = year_from_date((aa_person.get("birth") or {}).get("date"))
    if aa_birth and not (person.get("birth") or {}).get("date"):
        person.setdefault("birth", {})["date"] = aa_birth
        person["birth"]["precision"] = "year"
        changes.append(f"birth.date={aa_birth}")

    # Surmaaasta
    aa_death = year_from_date((aa_person.get("death") or {}).get("date"))
    if aa_death and not (person.get("death") or {}).get("date"):
        person.setdefault("death", {})["date"] = aa_death
        person["death"]["precision"] = "year"
        changes.append(f"death.date={aa_death}")

    # Päritolu
    if place_key and not (person.get("origin") or {}).get("place"):
        entry = places[place_key]
        person["origin"] = {
            "place": place_key,
            "place_id": entry.get("id"),
            "place_labels": entry.get("labels"),
            "geonames_id": None,
            "coordinates": None,
        }
        changes.append(f"origin.place={place_key}")

    # Noble status
    noble = (aa_person.get("name") or {}).get("noble_status")
    if noble and not (person.get("name") or {}).get("noble_status"):
        person.setdefault("name", {})["noble_status"] = noble
        changes.append(f"noble_status={noble}")

    # Education kirjed
    existing_edu = person.get("education") or []
    existing_keys = {edu_key(e) for e in existing_edu}
    new_entries = aa_education_entries(aa_entry)
    added = []
    for e in new_entries:
        if edu_key(e) not in existing_keys:
            existing_edu.append(e)
            added.append(e.get("institution", "?"))
    if added:
        person["education"] = existing_edu
        changes.append(f"education+=[{', '.join(added)}]")

    return changes


def create_new(aa_entry: dict, place_key, places: dict, existing_ids: set) -> dict:
    """Loob uue isikukaardi AA kirjest."""
    aa_person = aa_entry["person"]
    name = aa_person.get("name") or {}
    origin = aa_person.get("origin") or {}

    fam_canonical, fam_variants = parse_name_part(name.get("family_name") or "")
    first_canonical, first_variants = parse_name_part(name.get("first_name") or "")

    # Kogu variandid: parsitud + AA väljad
    all_fam_variants = sorted(set(
        fam_variants + [v for v in (name.get("family_name_variants") or []) if v]
    ))
    all_first_variants = sorted(set(
        first_variants + [v for v in (name.get("first_name_variants") or []) if v]
    ))

    label_parts = [p for p in [first_canonical, fam_canonical] if p]
    label = " ".join(label_parts)

    birth_year = year_from_date((aa_person.get("birth") or {}).get("date"))
    death_year = year_from_date((aa_person.get("death") or {}).get("date"))

    place_entry = places.get(place_key, {}) if place_key else {}
    origin_block = {
        "place": place_key,
        "place_id": place_entry.get("id") if place_key else None,
        "place_labels": place_entry.get("labels") if place_key else None,
        "geonames_id": str(origin.get("geonames_id")) if origin.get("geonames_id") else None,
        "coordinates": None,
    }

    now = datetime.now(timezone.utc).isoformat()
    uid = gen_vutt_id(existing_ids)
    existing_ids.add(uid)

    return {
        "id": uid,
        "identifiers": [{"scheme": "album_academicum", "id": f"AA:{aa_entry['entry_number']}", "checked_at": None}],
        "merged_into": None,
        "import_batch_ids": ["aa-import-2026"],
        "schema_version": 1,
        "record_status": "draft",
        "verification_level": "draft",
        "created_at": now,
        "updated_at": now,
        "created_by": "aa_import_script",
        "updated_by": "aa_import_script",
        "name": {
            "label": label,
            "family_name": fam_canonical,
            "first_name": first_canonical,
            "qualifier": None,
            "qualifier_type": None,
            "noble_status": name.get("noble_status"),
            "maiden_name": None,
            "aliases": [],
            "family_name_variants": all_fam_variants,
            "first_name_variants": all_first_variants,
        },
        "gender": None,
        "birth": {
            "original_text": None,
            "date": birth_year,
            "date_to": None,
            "bound": None,
            "precision": "year" if birth_year else None,
            "calendar": None,
            "is_circa": False,
            "place": None,
            "notes": None,
        },
        "death": {
            "original_text": None,
            "date": death_year,
            "date_to": None,
            "bound": None,
            "precision": "year" if death_year else None,
            "calendar": None,
            "is_circa": False,
            "place": None,
            "notes": None,
        },
        "floruit": None,
        "origin": origin_block,
        "status": None,
        "confession": None,
        "occupations": [],
        "education": aa_education_entries(aa_entry),
        "relations": [],
        "tags": [],
        "sources": [],
        "notes": None,
        "biography": None,
        "profile_photo": None,
    }


def save_person(person: dict, fpath: str = None):
    if fpath is None:
        fpath = os.path.join(PROSOPO_DIR, person["id"].removeprefix("vutt:P") + ".json")
    tmp = fpath + ".tmp"
    with open(tmp, "w") as f:
        json.dump(person, f, ensure_ascii=False, indent=2)
    os.replace(tmp, fpath)


def main():
    if DRY_RUN:
        print("DRY-RUN — faile ei kirjutata\n")

    aa_data = json.load(open(AA_FILE))
    places = json.load(open(PLACES_FILE))
    place_lookup = build_place_lookup(places)
    aa_num_to_path, aa_num_to_data, existing_ids = load_existing_prosopo()

    updated = 0
    created = 0
    skipped = 0

    for aa_entry in aa_data:
        num = aa_entry.get("entry_number")
        if not num:
            continue

        origin = (aa_entry.get("person") or {}).get("origin") or {}
        place_key = resolve_place(origin, place_lookup)

        if num in aa_num_to_data and not NEW_ONLY:
            # Uuenda olemasolevat
            person = aa_num_to_data[num]
            fpath = aa_num_to_path[num]
            changes = update_existing(person, aa_entry, place_key, places)
            if changes:
                updated += 1
                print(f"  UPDATE AA:{num} ({person['name']['label']}): {', '.join(changes)}")
                if not DRY_RUN:
                    person["updated_at"] = datetime.now(timezone.utc).isoformat()
                    person["updated_by"] = "aa_import_script"
                    if "aa-import-2026" not in (person.get("import_batch_ids") or []):
                        person.setdefault("import_batch_ids", []).append("aa-import-2026")
                    save_person(person, fpath)
            else:
                skipped += 1

        elif num not in aa_num_to_data and not UPDATE_ONLY:
            # Loo uus
            person = create_new(aa_entry, place_key, places, existing_ids)
            created += 1
            print(f"  CREATE AA:{num} → {person['id']} ({person['name']['label']})"
                  + (f" [origin: {place_key}]" if place_key else " [origin: ?]"))
            if not DRY_RUN:
                save_person(person)

        else:
            skipped += 1

    print(f"\nKokku: uuendatud={updated}, loodud={created}, vahele jäetud={skipped}")
    if not DRY_RUN and (updated + created) > 0:
        print("\nKäivita rebuild_indices:")
        print("  ./scripts/rebuild_prosopo_indices.sh")


if __name__ == "__main__":
    main()
