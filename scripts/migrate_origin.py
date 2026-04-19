"""
Migreerib isikufailide origin.city/region → origin.place.
Lisab automaatselt places.json-i puuduvad kohad, kasutades
isikukaartidel olevaid city_id/city_labels Wikidata andmeid.
"""
import glob, json, os, sys
from datetime import datetime, timezone

DATA_ROOT = os.getenv("VUTT_DATA_DIR", "data")
STATE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "state")
PROSOPO_DIR = os.path.join(STATE_DIR, "prosopography")
PLACES_FILE = os.path.join(DATA_ROOT, "config", "places.json")


def load_places():
    with open(PLACES_FILE) as f:
        return json.load(f)


def save_places(places: dict, dry_run: bool):
    if dry_run:
        return
    tmp = PLACES_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(places, f, ensure_ascii=False, indent=2)
    os.replace(tmp, PLACES_FILE)


def _qcode_to_key(places: dict) -> dict:
    """Ehitab Q-kood → olemasolev võti kaardi duplikaatide tuvastamiseks."""
    return {v["id"]: k for k, v in places.items() if v.get("id")}


def collect_missing_places(person_files: list, places: dict) -> dict:
    """Kogub isikukaartidelt puuduvad city/region kohad koos Wikidata andmetega.
    Kui Q-kood on juba olemas teise võtme all, kasutab olemasolevat."""
    qcode_map = _qcode_to_key(places)
    missing = {}
    for fpath in person_files:
        try:
            with open(fpath) as f:
                person = json.load(f)
        except Exception:
            continue
        if person.get("record_status") == "tombstone":
            continue
        origin = person.get("origin") or {}
        if origin.get("place") is not None:
            continue
        for field, id_field, labels_field in [
            ("city", "city_id", "city_labels"),
            ("region", "region_id", "region_labels"),
        ]:
            name = origin.get(field)
            qid = origin.get(id_field)
            # Kui Q-kood on juba olemas teise võtmega, ära lisa duplikaati
            if name and qid and qid in qcode_map and name not in places:
                continue
            if name and name not in places and name not in missing:
                missing[name] = {
                    "id": origin.get(id_field),
                    "labels": origin.get(labels_field) or {field: name},
                }
    return missing


def migrate_person(person: dict, places: dict, qcode_map: dict = None) -> tuple:
    """Tagastab (changed, log_msg)."""
    origin = person.get("origin") or {}
    city = origin.get("city")
    region = origin.get("region")

    if origin.get("place") is not None:
        return False, "place juba olemas, vahele jäetud"

    if qcode_map is None:
        qcode_map = _qcode_to_key(places)

    def resolve_key(name, id_field):
        """Leiab kanooniline võti: eelistab Q-koodi järgi olemasolevat."""
        qid = origin.get(id_field)
        if qid and qid in qcode_map:
            return qcode_map[qid]
        if name in places:
            return name
        return None

    new_place = None
    if city:
        new_place = resolve_key(city, "city_id")
        if new_place is None:
            return False, f"UNMAPPED city={city!r} — vahele jäetud"
    elif region:
        new_place = resolve_key(region, "region_id")
        if new_place is None:
            return False, f"UNMAPPED region={region!r} — vahele jäetud"

    if new_place is None:
        return False, "pole city ega region — vahele jäetud"

    entry = places[new_place]
    new_origin = {
        "place": new_place,
        "place_id": entry.get("id"),
        "place_labels": entry.get("labels"),
        "geonames_id": origin.get("geonames_id"),
        "coordinates": origin.get("coordinates"),
    }
    person["origin"] = new_origin
    return True, f"city={city!r} region={region!r} → place={new_place!r}"


def main():
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        print("DRY-RUN režiim — faile ei kirjutata\n")

    places = load_places()
    person_files = sorted(glob.glob(os.path.join(PROSOPO_DIR, "*.json")))

    # 1. Lisa automaatselt puuduvad kohad places.json-i
    missing = collect_missing_places(person_files, places)
    if missing:
        print(f"Lisatakse {len(missing)} puuduvat kohta places.json-i:")
        for name, entry in sorted(missing.items()):
            qcode = entry.get("id") or "Q-kood puudub"
            print(f"  + {name!r} ({qcode})")
            if not dry_run:
                places[name] = entry
        if not dry_run:
            save_places(places, dry_run)
        print()
    else:
        print("Kõik kohad on juba places.json-is.\n")

    # 2. Migreerib isikukaardid
    updated = 0
    skipped = 0
    errors = 0
    qcode_map = _qcode_to_key(places)

    for fpath in person_files:
        try:
            with open(fpath) as f:
                person = json.load(f)
        except Exception as e:
            print(f"VIGA lugemisel {fpath}: {e}")
            errors += 1
            continue

        if person.get("record_status") == "tombstone":
            continue

        changed, msg = migrate_person(person, places, qcode_map)
        pid = person.get("id", os.path.basename(fpath))

        if changed:
            updated += 1
            print(f"  {pid}: {msg}")
            if not dry_run:
                person["updated_at"] = datetime.now(timezone.utc).isoformat()
                tmp = fpath + ".tmp"
                with open(tmp, "w") as f:
                    json.dump(person, f, ensure_ascii=False, indent=2)
                os.replace(tmp, fpath)
        else:
            skipped += 1

    print(f"\nKokku: uuendatud={updated}, vahele jäetud={skipped}, vigu={errors}")
    if not dry_run and updated > 0:
        print("\nPärast migratsiooni käivita serveril rebuild_indices:")
        print("  POST /prosopography/admin/rebuild-indices")


if __name__ == "__main__":
    main()
