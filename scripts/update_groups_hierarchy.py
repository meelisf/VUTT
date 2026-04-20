"""
Lisab origin_groups.json-i hierarhia:
- Parandab karjala/ingerimaa labelid (olid mõlemad "Karjala ja Ingerimaa")
- Lisab 'rootsi' ülemgrupi
- Seab parent: soome → 8 soome provintsi
- Seab parent: rootsi → gootaland/svealand/norrland
- Lisab sort_order kõikidele gruppidele
"""
import json, os

DATA_DIR = os.getenv("VUTT_DATA_DIR", "/data") + "/config"
GROUPS_FILE = os.path.join(DATA_DIR, "origin_groups.json")

with open(GROUPS_FILE, encoding="utf-8") as f:
    groups = json.load(f)

# 1) Ülemgrupid (sort_order + labelid korda)
top_level = {
    "soome":          {"labels": {"et": "Soome", "en": "Finland"}, "sort_order": 1},
    "rootsi":         {"labels": {"et": "Rootsi", "en": "Sweden", "sv": "Sverige"}, "sort_order": 2},
    "karjala":        {"labels": {"et": "Karjala", "en": "Karelia"}, "sort_order": 3},
    "ingerimaa":      {"labels": {"et": "Ingerimaa", "en": "Ingria"}, "sort_order": 4},
    "eesti":          {"labels": {"et": "Eestimaa", "en": "Estonia"}, "sort_order": 5},
    "liivimaa":       {"labels": {"et": "Liivimaa ja Kuramaa", "en": "Livonia and Courland"}, "sort_order": 6},
    "pohja-saksamaa": {"labels": {"et": "Põhja-Saksamaa", "en": "Northern Germany"}, "sort_order": 7},
    "kesk-saksamaa":  {"labels": {"et": "Kesk- ja Lõuna-Saksamaa", "en": "Central and Southern Germany"}, "sort_order": 8},
    "muu":            {"labels": {"et": "Muud piirkonnad", "en": "Other regions"}, "sort_order": 99},
}

for key, val in top_level.items():
    if key not in groups:
        groups[key] = val
        print(f"  Lisa: {key}")
    else:
        groups[key]["labels"] = val["labels"]
        groups[key]["sort_order"] = val["sort_order"]
        groups[key].pop("parent", None)  # ülemgrupil ei ole parent-i
        print(f"  Uuenda: {key}")

# 2) Rootsi provintsid
rootsi_children = {
    "gootaland": {"sort_order": 10},
    "svealand":  {"sort_order": 11},
    "norrland":  {"sort_order": 12},
}
for key, extra in rootsi_children.items():
    if key in groups:
        groups[key]["parent"] = "rootsi"
        groups[key]["sort_order"] = extra["sort_order"]
        print(f"  parent rootsi: {key}")

# 3) Soome provintsid
soome_children = {
    "ahvenanmaa":     {"sort_order": 20},
    "hame":           {"sort_order": 21},
    "lappi":          {"sort_order": 22},
    "pohjanmaa":      {"sort_order": 23},
    "satakunta":      {"sort_order": 24},
    "savo":           {"sort_order": 25},
    "uusimaa":        {"sort_order": 26},
    "varsinais-suomi":{"sort_order": 27},
}
for key, extra in soome_children.items():
    if key in groups:
        groups[key]["parent"] = "soome"
        groups[key]["sort_order"] = extra["sort_order"]
        print(f"  parent soome: {key}")

with open(GROUPS_FILE, "w", encoding="utf-8") as f:
    json.dump(groups, f, ensure_ascii=False, indent=2)

print("\nSalvestatud.")
