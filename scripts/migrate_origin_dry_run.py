"""
Analüüsib olemasolevaid isikufaile ja prindib kõik origin.city/region väärtused
mis POLE places.json võtmed. Käivita enne migratsiooni!
"""
import glob, json, os, sys

DATA_ROOT = os.getenv("VUTT_DATA_DIR", "data")
STATE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "state")
PROSOPO_DIR = os.path.join(STATE_DIR, "prosopography")
PLACES_FILE = os.path.join(DATA_ROOT, "config", "places.json")

def load_places():
    try:
        with open(PLACES_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"VIGA: places.json ei leitud: {PLACES_FILE}")
        sys.exit(1)

def main():
    places = load_places()
    known_keys = set(places.keys())

    unmapped_city = set()
    unmapped_region = set()
    total = 0

    for fpath in glob.glob(os.path.join(PROSOPO_DIR, "*.json")):
        try:
            with open(fpath) as f:
                person = json.load(f)
        except Exception:
            continue
        if person.get("record_status") == "tombstone":
            continue
        total += 1
        origin = person.get("origin") or {}
        city = origin.get("city")
        region = origin.get("region")
        if city and city not in known_keys:
            unmapped_city.add(city)
        if region and region not in known_keys:
            unmapped_region.add(region)

    print(f"\nKokku isikuid: {total}")
    print(f"\norigin.city väärtused mis pole places.json võtmed ({len(unmapped_city)}):")
    for v in sorted(unmapped_city):
        print(f"  - {v!r}")
    print(f"\norigin.region väärtused mis pole places.json võtmed ({len(unmapped_region)}):")
    for v in sorted(unmapped_region):
        print(f"  - {v!r}")

    if not unmapped_city and not unmapped_region:
        print("\n✓ Kõik väärtused on places.json-s. Migratsiooni võib käivitada.")
    else:
        print("\n⚠ Lisa puuduvad kohad places.json-i enne migratsiooni käivitamist.")

if __name__ == "__main__":
    main()
