"""
Lisab soome ajaloolised maakonnagrupid ja määrab olemasolevatele
soome kohtadele grupi vastavalt kaasaegsele maakonnajaotusele.

NB: 'karjala' grupp on juba olemas (Karelien, Wiborg, Lääne-Karjala jne) —
seda EI MUUDETA. Uued grupid: ahvenanmaa, hame, lappi, pohjanmaa,
satakunta, savo, uusimaa, varsinais-suomi.

Praegused soome kohad places.json-is (2026-04-20):
  Finnland   → jääb soome (riik, mitte provints)
  Nyland     → uusimaa
  Åbo        → varsinais-suomi
  Brahelinna → pohjanmaa (tõenäoliselt Kajaani kants)
"""
import json, sys, os

DATA_DIR = os.getenv("VUTT_DATA_DIR", "/data") + "/config"
PLACES_FILE = os.path.join(DATA_DIR, "places.json")
GROUPS_FILE = os.path.join(DATA_DIR, "origin_groups.json")

# Otsekaardistus: koha nimi → ajalooline grupp
PROVINCE_GROUPS = {
    # Olemasolevad soome kohad
    "Nyland":       "uusimaa",
    "Åbo":          "varsinais-suomi",
    "Brahelinna":   "pohjanmaa",

    # Tulevased lisandused — kaasaegsed maakonnad
    "Ahvenanmaa":           "ahvenanmaa",
    "Åland":                "ahvenanmaa",
    "Kanta-Häme":           "hame",
    "Päijät-Häme":          "hame",
    "Keski-Suomi":          "hame",
    "Kainuu":               "pohjanmaa",
    "Keski-Pohjanmaa":      "pohjanmaa",
    "Pohjois-Pohjanmaa":    "pohjanmaa",
    "Pohjanmaa":            "pohjanmaa",
    "Etelä-Pohjanmaa":      "pohjanmaa",
    "Lappi":                "lappi",
    "Satakunta":            "satakunta",
    "Pirkanmaa":            "satakunta",
    "Etelä-Savo":           "savo",
    "Pohjois-Savo":         "savo",
    "Uusimaa":              "uusimaa",
    "Varsinais-Suomi":      "varsinais-suomi",
    # Etelä-Karjala, Pohjois-Karjala, Kymenlaakso → olemasolev 'karjala' grupp

    # Rootsikeelsed nimed (17. saj tekstides)
    "Tavastland":           "hame",
    "Österbotten":          "pohjanmaa",
    "Lappland":             "lappi",
    "Satakunda":            "satakunta",
    "Savolax":              "savo",
    "Egentliga Finland":    "varsinais-suomi",
    # "Karelen" / "Karelien" → olemasolev 'karjala'
}

with open(PLACES_FILE, encoding="utf-8") as f:
    places = json.load(f)
with open(GROUPS_FILE, encoding="utf-8") as f:
    groups = json.load(f)

# 1) Lisa uued grupid (karjala jäetakse puutumata)
new_groups = {
    "ahvenanmaa": {
        "labels": {"et": "Ahvenanmaa", "en": "Åland", "fi": "Ahvenanmaa", "sv": "Åland"},
        "sort_order": 20
    },
    "hame": {
        "labels": {"et": "Häme", "en": "Tavastland", "fi": "Häme", "sv": "Tavastland"},
        "sort_order": 21
    },
    "lappi": {
        "labels": {"et": "Lapimaa", "en": "Lapland", "fi": "Lappi", "sv": "Lappland"},
        "sort_order": 22
    },
    "pohjanmaa": {
        "labels": {"et": "Pohjanmaa", "en": "Ostrobothnia", "fi": "Pohjanmaa", "sv": "Österbotten"},
        "sort_order": 23
    },
    "satakunta": {
        "labels": {"et": "Satakunta", "en": "Satakunta", "fi": "Satakunta", "sv": "Satakunda"},
        "sort_order": 24
    },
    "savo": {
        "labels": {"et": "Savo", "en": "Savonia", "fi": "Savo", "sv": "Savolax"},
        "sort_order": 25
    },
    "uusimaa": {
        "labels": {"et": "Uusimaa", "en": "Uusimaa", "fi": "Uusimaa", "sv": "Nyland"},
        "sort_order": 26
    },
    "varsinais-suomi": {
        "labels": {"et": "Varsinais-Soome", "en": "Finland Proper", "fi": "Varsinais-Suomi", "sv": "Egentliga Finland"},
        "sort_order": 27
    },
}

print("=== GRUPID ===")
for key, val in new_groups.items():
    if key not in groups:
        groups[key] = val
        print(f"  Lisa: {key}")
    else:
        print(f"  Juba olemas: {key}")

# 2) Uuenda kohad
print("\n=== KOHAD ===")
changed = []
for key, entry in places.items():
    new_group = None
    if key in PROVINCE_GROUPS:
        new_group = PROVINCE_GROUPS[key]
    else:
        parent = entry.get("parent_key")
        if parent and parent in PROVINCE_GROUPS:
            new_group = PROVINCE_GROUPS[parent]

    if new_group and new_group in new_groups:
        if entry.get("group") != new_group:
            old = entry.get("group") or "-"
            entry["group"] = new_group
            changed.append(f"  {key}: {old!r} → {new_group!r}")

if changed:
    for c in changed:
        print(c)
else:
    print("  Muudatusi pole")

# 3) Salvesta
with open(PLACES_FILE, "w", encoding="utf-8") as f:
    json.dump(places, f, ensure_ascii=False, indent=2)
with open(GROUPS_FILE, "w", encoding="utf-8") as f:
    json.dump(groups, f, ensure_ascii=False, indent=2)

print(f"\nSalvestatud. Muudetud {len(changed)} koha kirjet.")
