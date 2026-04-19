"""
Migreerib isikufailide origin.city/region → origin.place.
Käivita PÄRAST dry-run analüüsi ja places.json täiendamist.
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

def migrate_person(person: dict, places: dict, dry_run: bool) -> tuple:
    """Tagastab (changed, log_msg)."""
    origin = person.get("origin") or {}
    city = origin.get("city")
    region = origin.get("region")

    # Kui origin.place on juba olemas, ei muuda
    if origin.get("place") is not None:
        return False, "place juba olemas, vahele jäetud"

    new_place = None
    if city:
        if city in places:
            new_place = city
        else:
            return False, f"UNMAPPED city={city!r} — vahele jäetud"
    elif region:
        if region in places:
            new_place = region
        else:
            return False, f"UNMAPPED region={region!r} — vahele jäetud"

    if new_place is None:
        return False, "pole city ega region — vahele jäetud"

    # Ehita uus origin
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
        print("DRY-RUN režiim — faile ei kirjutata")

    places = load_places()
    updated = 0
    skipped = 0
    errors = 0

    for fpath in sorted(glob.glob(os.path.join(PROSOPO_DIR, "*.json"))):
        try:
            with open(fpath) as f:
                person = json.load(f)
        except Exception as e:
            print(f"VIGA lugemisel {fpath}: {e}")
            errors += 1
            continue

        if person.get("record_status") == "tombstone":
            continue

        changed, msg = migrate_person(person, places, dry_run)
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
