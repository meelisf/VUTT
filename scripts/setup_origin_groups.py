"""
Lisab places.json kirjetele group välja (AA andmete + manuaalse kaardistuse järgi)
ja loob origin_groups.json faili.

Käivita: python3 scripts/setup_origin_groups.py [--dry-run]
"""
import json, os, sys
from collections import defaultdict, Counter

DATA_ROOT = os.getenv("VUTT_DATA_DIR", "data")
PLACES_FILE = os.path.join(DATA_ROOT, "config", "places.json")
GROUPS_FILE = os.path.join(DATA_ROOT, "config", "origin_groups.json")

AA_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "reference_data", "album_academicum.json"
)

ORIGIN_GROUPS = {
    "louna-rootsi":   {"labels": {"et": "Lõuna-Rootsi",            "en": "Southern Sweden"}},
    "pohja-rootsi":   {"labels": {"et": "Põhja-Rootsi",            "en": "Northern Sweden"}},
    "soome":          {"labels": {"et": "Soome",                   "en": "Finland"}},
    "karjala":        {"labels": {"et": "Karjala ja Ingerimaa",    "en": "Karelia and Ingria"}},
    "ingerimaa":      {"labels": {"et": "Karjala ja Ingerimaa",    "en": "Karelia and Ingria"}},
    "eesti":          {"labels": {"et": "Eestimaa",                "en": "Estonia"}},
    "liivimaa":       {"labels": {"et": "Liivimaa ja Kuramaa",     "en": "Livonia and Courland"}},
    "pohja-saksamaa": {"labels": {"et": "Põhja-Saksamaa",         "en": "Northern Germany"}},
    "kesk-saksamaa":  {"labels": {"et": "Kesk- ja Lõuna-Saksamaa","en": "Central and Southern Germany"}},
    "muu":            {"labels": {"et": "Muud piirkonnad",         "en": "Other regions"}},
}

# AA region → grupi võti
AA_GROUP_MAP = {
    "Lõuna-Rootsi":          "louna-rootsi",
    "Põhja-Rootsi":          "pohja-rootsi",
    "Soome":                 "soome",
    "Karjala":               "karjala",
    "Ingerimaa":             "ingerimaa",
    "Eesti":                 "eesti",
    "Liivimaa":              "liivimaa",
    "Põhja-Saksamaa":        "pohja-saksamaa",
    "Kesk- ja Lõuna-Saksamaa": "kesk-saksamaa",
    "Muud piirkonnad":       "muu",
}

# Manuaalne kaardistus mis AA-st ei tule
MANUAL_GROUPS = {
    "Reval": "eesti", "Narva": "eesti", "Kadrina": "eesti", "Kullamaa": "eesti",
    "Viru-Nigula": "eesti", "Laiuse": "eesti", "Saaremaa": "eesti",
    "Haldeni vald": "eesti",
    "Riga": "liivimaa", "Dorpat": "liivimaa", "Pernau": "liivimaa",
    "Wenden": "liivimaa", "Goldingen": "liivimaa", "Jelgava": "liivimaa",
    "Bauska": "liivimaa", "Tērvete": "liivimaa", "Iecava": "liivimaa",
    "Åbo": "soome", "Brahelinna": "soome", "Savolax and Karelia County": "karjala",
    "Lääne-Karjala": "karjala", "Wiborg": "karjala", "Nöteborg": "ingerimaa",
    "Jämtland": "pohja-rootsi", "Filipstad": "pohja-rootsi", "Kil": "pohja-rootsi",
    "Dalarna maakond": "pohja-rootsi", "Värmlandi lään": "pohja-rootsi",
    "Vendel": "pohja-rootsi", "Vika": "pohja-rootsi", "Kopparberg": "pohja-rootsi",
    "Kuddby": "pohja-rootsi", "Savolax and Karelia County": "karjala",
    "Östergötlandi maakond": "louna-rootsi", "Norrvidinge": "louna-rootsi",
    "Dimbo": "louna-rootsi", "Osby": "louna-rootsi", "Lund": "louna-rootsi",
    "Vadsbo": "louna-rootsi", "Svedvi": "louna-rootsi", "Hjälmaryd": "louna-rootsi",
    "Romfartuna": "louna-rootsi", "Undenäs": "louna-rootsi",
    "Goslar": "pohja-saksamaa", "Herzberg": "pohja-saksamaa",
    "Herzberg (Elster)": "pohja-saksamaa", "Barth": "pohja-saksamaa",
    "Eckernförde": "pohja-saksamaa", "Grevesmühlen": "pohja-saksamaa",
    "Rathenow": "pohja-saksamaa", "Strelitz-Alt": "pohja-saksamaa",
    "Malbork": "pohja-saksamaa", "Świeszyno": "pohja-saksamaa",
    "Dobra": "pohja-saksamaa", "Berlin": "pohja-saksamaa", "Wolin": "pohja-saksamaa",
    "Eisleben": "kesk-saksamaa", "Merseburg": "kesk-saksamaa",
    "Lützen": "kesk-saksamaa", "Wettin": "kesk-saksamaa",
    "Bad Lauchstädt": "kesk-saksamaa", "Bad Windsheim": "kesk-saksamaa",
    "Rappoltsweiler": "kesk-saksamaa",
    "Moșna": "muu", "Uherský Brod": "muu", "Peterburi": "muu", "Moskva": "muu",
    "Stockholm": "louna-rootsi", "Stockholmi kuningaloss": "louna-rootsi",
}


def build_aa_maps():
    if not os.path.exists(AA_FILE):
        return {}, {}
    aa = json.load(open(AA_FILE))
    region_to_group = {}
    city_groups = defaultdict(Counter)
    for entry in aa:
        o = entry.get("person", {}).get("origin", {})
        city = o.get("city")
        sr = o.get("standardized_region")
        g = o.get("region_group")
        if sr and g and g in AA_GROUP_MAP:
            region_to_group[sr] = AA_GROUP_MAP[g]
        if city and g and g in AA_GROUP_MAP:
            city_groups[city][AA_GROUP_MAP[g]] += 1
    city_to_group = {c: cnt.most_common(1)[0][0] for c, cnt in city_groups.items()}
    return region_to_group, city_to_group


def resolve_group(key, region_to_group, city_to_group):
    if key in region_to_group:
        return region_to_group[key]
    if key in city_to_group:
        return city_to_group[key]
    if key in MANUAL_GROUPS:
        return MANUAL_GROUPS[key]
    return None


def main():
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        print("DRY-RUN — faile ei kirjutata\n")

    places = json.load(open(PLACES_FILE))
    region_to_group, city_to_group = build_aa_maps()

    missing = []
    updated = 0
    for key in sorted(places.keys()):
        entry = places[key]
        if entry.get("group"):
            continue  # juba olemas
        g = resolve_group(key, region_to_group, city_to_group)
        if g:
            print(f"  {key!r} → {g!r}")
            updated += 1
            if not dry_run:
                places[key]["group"] = g
        else:
            missing.append(key)

    if missing:
        print(f"\nLahendamata ({len(missing)}):")
        for k in missing:
            print(f"  {k!r}")

    print(f"\nGrupp lisatud: {updated}, lahendamata: {len(missing)}")

    if not dry_run:
        tmp = PLACES_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(places, f, ensure_ascii=False, indent=2)
        os.replace(tmp, PLACES_FILE)

        with open(GROUPS_FILE, "w") as f:
            json.dump(ORIGIN_GROUPS, f, ensure_ascii=False, indent=2)
        print(f"\nKirjutatud: {PLACES_FILE}")
        print(f"Kirjutatud: {GROUPS_FILE}")
        print("\nJärgmised sammud:")
        print("  1. ./scripts/server_update.sh   (backend restart)")
        print("  2. POST /prosopography/admin/rebuild-indices")


if __name__ == "__main__":
    main()
