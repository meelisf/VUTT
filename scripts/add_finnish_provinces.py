"""
Lisab soome ajaloolised provintsid places.json-i ülempiirkondadena.
Nyland (Uusimaa) on juba olemas — lisatakse 7 puuduvat.
"""
import json, os

DATA_DIR = os.getenv("VUTT_DATA_DIR", "/data") + "/config"
PLACES_FILE = os.path.join(DATA_DIR, "places.json")

with open(PLACES_FILE, encoding="utf-8") as f:
    places = json.load(f)

NEW_PROVINCES = {
    "Ahvenanmaa": {
        "id": "Q5689",
        "labels": {"et": "Ahvenanmaa", "en": "Åland", "sv": "Åland", "fi": "Ahvenanmaa", "la": "Alandia"},
        "historical_names": ["Åland", "Alandia", "Ahvenanmaa"],
        "type": "province",
        "parent_key": "Finnland",
        "group": "ahvenanmaa",
    },
    "Häme": {
        "id": "Q179673",
        "labels": {"et": "Häme", "en": "Tavastland", "sv": "Tavastland", "fi": "Häme", "la": "Tavastia", "de": "Tavastland"},
        "historical_names": ["Tavastland", "Tavastia", "Häme"],
        "type": "province",
        "parent_key": "Finnland",
        "group": "hame",
    },
    "Lappi": {
        "id": "Q208465",
        "labels": {"et": "Lapimaa", "en": "Lapland", "sv": "Lappland", "fi": "Lappi", "la": "Lapponia"},
        "historical_names": ["Lappland", "Lapponia", "Lappi"],
        "type": "province",
        "parent_key": "Finnland",
        "group": "lappi",
    },
    "Pohjanmaa": {
        "id": "Q219782",
        "labels": {"et": "Pohjanmaa", "en": "Ostrobothnia", "sv": "Österbotten", "fi": "Pohjanmaa", "la": "Ostrobothnia"},
        "historical_names": ["Österbotten", "Ostrobothnia", "Pohjanmaa"],
        "type": "province",
        "parent_key": "Finnland",
        "group": "pohjanmaa",
    },
    "Satakunta": {
        "id": "Q188966",
        "labels": {"et": "Satakunta", "en": "Satakunta", "sv": "Satakunda", "fi": "Satakunta", "la": "Satacundia"},
        "historical_names": ["Satakunda", "Satacundia", "Satakunta"],
        "type": "province",
        "parent_key": "Finnland",
        "group": "satakunta",
    },
    "Savo": {
        "id": "Q179689",
        "labels": {"et": "Savo", "en": "Savonia", "sv": "Savolax", "fi": "Savo", "la": "Savonia"},
        "historical_names": ["Savolax", "Savonia", "Savo"],
        "type": "province",
        "parent_key": "Finnland",
        "group": "savo",
    },
    "Varsinais-Suomi": {
        "id": "Q219780",
        "labels": {"et": "Varsinais-Soome", "en": "Finland Proper", "sv": "Egentliga Finland", "fi": "Varsinais-Suomi", "la": "Finlandia Propria"},
        "historical_names": ["Egentliga Finland", "Finlandia Propria", "Varsinais-Suomi"],
        "type": "province",
        "parent_key": "Finnland",
        "group": "varsinais-suomi",
    },
}

added, skipped = [], []
for key, entry in NEW_PROVINCES.items():
    if key in places:
        skipped.append(key)
    else:
        places[key] = entry
        added.append(key)

print(f"Lisatud ({len(added)}): {', '.join(added)}")
if skipped:
    print(f"Juba olemas, jäetud ({len(skipped)}): {', '.join(skipped)}")

with open(PLACES_FILE, "w", encoding="utf-8") as f:
    json.dump(places, f, ensure_ascii=False, indent=2)

print("Salvestatud.")
