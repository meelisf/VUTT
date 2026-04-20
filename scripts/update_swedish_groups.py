"""
Asendab louna-rootsi/pohja-rootsi kolme ajaloolise Rootsi maaga:
  gootaland (Götaland), svealand (Svealand), norrland (Norrland)
"""
import json, sys, os

DATA_DIR = os.getenv("VUTT_DATA_DIR", "/data") + "/config"
PLACES_FILE = os.path.join(DATA_DIR, "places.json")
GROUPS_FILE = os.path.join(DATA_DIR, "origin_groups.json")

# Provintsid → uus grupp
PROVINCE_GROUPS = {
    # Götaland
    "Småland":         "gootaland",
    "Västergötland":   "gootaland",
    "Östergötland":    "gootaland",
    "Lund":            "gootaland",   # Scania
    # Svealand
    "Södermanland":    "svealand",
    "Uppland":         "svealand",
    "Västmanland":     "svealand",
    "Närke":           "svealand",
    "Värmland":        "svealand",
    "Dalarna maakond": "svealand",
    "Stockholm":       "svealand",
    # Norrland
    "Hälsingland":     "norrland",
    "Jämtland":        "norrland",
    "Västerbotten":    "norrland",
    "Gästrikland":     "norrland",
}

# Linnad/külad ilma parent_key'ta — määra grupp otse
STANDALONE_GROUPS = {
    "Stockholmi kuningaloss": "svealand",
    "Värmlandi lään":         "svealand",
    "Kopparberg":             "svealand",   # Dalarna
    "Vika":                   "svealand",   # Dalarna
    "Östergötlandi maakond":  "gootaland",
    "Kuddby":                 "gootaland",  # Östergötland
}

with open(PLACES_FILE, encoding="utf-8") as f:
    places = json.load(f)
with open(GROUPS_FILE, encoding="utf-8") as f:
    groups = json.load(f)

# 1) Origin groups: eemalda vanad, lisa uued
for old in ("louna-rootsi", "pohja-rootsi"):
    groups.pop(old, None)

groups["gootaland"] = {
    "labels": {"et": "Götaland", "en": "Götaland", "sv": "Götaland"},
    "sort_order": 10
}
groups["svealand"] = {
    "labels": {"et": "Svealand", "en": "Svealand", "sv": "Svealand"},
    "sort_order": 11
}
groups["norrland"] = {
    "labels": {"et": "Norrland", "en": "Norrland", "sv": "Norrland"},
    "sort_order": 12
}

# 2) Uuenda provintsid
changed = []
for key, entry in places.items():
    new_group = None
    if key in PROVINCE_GROUPS:
        new_group = PROVINCE_GROUPS[key]
    elif key in STANDALONE_GROUPS:
        new_group = STANDALONE_GROUPS[key]
    elif entry.get("group") in ("louna-rootsi", "pohja-rootsi"):
        # Linnad kellel on parent_key — tuletame provintsist
        parent = entry.get("parent_key")
        if parent and parent in PROVINCE_GROUPS:
            new_group = PROVINCE_GROUPS[parent]
        else:
            print(f"  HOIATUS: {key!r} group={entry['group']!r} parent={parent!r} — ei suutnud automaatselt määrata")

    if new_group and entry.get("group") != new_group:
        old = entry.get("group") or "-"
        entry["group"] = new_group
        changed.append(f"  {key}: {old} → {new_group}")

print(f"Muudetud {len(changed)} kirjet:")
for c in changed:
    print(c)

# 3) Salvesta
with open(PLACES_FILE, "w", encoding="utf-8") as f:
    json.dump(places, f, ensure_ascii=False, indent=2)
with open(GROUPS_FILE, "w", encoding="utf-8") as f:
    json.dump(groups, f, ensure_ascii=False, indent=2)

print("\nSalvestatud.")
