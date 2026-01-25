#!/usr/bin/env python3
"""
Kohade ja trükkalite normaliseerimine.
Muudab string-kujul olevad andmed (nt "Dorpat") lingitud objektideks (Q-koodiga).

Käivitamine:
    python3 scripts/normalize_places_printers.py

Ohutus:
    - Skript küsib enne muudatuste tegemist kinnitust.
    - Soovitatav on enne käivitamist teha varukoopia.
"""

import os
import json
import sys

# Määra andmete asukoht
# Sinu süsteemis tundub olevat see:
BASE_DIR = os.getenv("VUTT_DATA_DIR", "data/")

# Normaliseerimise reeglid
# Vorming: "Otsitav sõna (lowercase)": {"label": "Õige silt", "id": "Q-kood", "labels": {"et": "..."}}

PLACES_MAPPING = {
    "tartu": {"label": "Tartu", "id": "Q13972", "labels": {"et": "Tartu", "la": "Tarbatum", "de": "Dorpat"}},
    "dorpat": {"label": "Tartu", "id": "Q13972", "labels": {"et": "Tartu", "la": "Tarbatum", "de": "Dorpat"}},
    "tarbatum": {"label": "Tartu", "id": "Q13972", "labels": {"et": "Tartu", "la": "Tarbatum", "de": "Dorpat"}},
    "pärnu": {"label": "Pärnu", "id": "Q164673", "labels": {"et": "Pärnu", "la": "Pernavia", "de": "Pernau"}},
    "pernavia": {"label": "Pärnu", "id": "Q164673", "labels": {"et": "Pärnu", "la": "Pernavia", "de": "Pernau"}},
    "pernau": {"label": "Pärnu", "id": "Q164673", "labels": {"et": "Pärnu", "la": "Pernavia", "de": "Pernau"}},
    "riia": {"label": "Riia", "id": "Q1773", "labels": {"et": "Riia", "la": "Riga", "de": "Riga"}},
    "riga": {"label": "Riia", "id": "Q1773", "labels": {"et": "Riia", "la": "Riga", "de": "Riga"}},
    "tallinn": {"label": "Tallinn", "id": "Q1770", "labels": {"et": "Tallinn", "la": "Revalia", "de": "Reval"}},
    "reval": {"label": "Tallinn", "id": "Q1770", "labels": {"et": "Tallinn", "la": "Revalia", "de": "Reval"}},
}

PRINTERS_MAPPING = {
    # Jacob Becker
    "jacob becker": {"label": "Jacob Becker", "id": "Q110825272", "labels": {"et": "Jacob Becker"}},
    "jacob becker (pistorius)": {"label": "Jacob Becker", "id": "Q110825272", "labels": {"et": "Jacob Becker"}},
    "becker": {"label": "Jacob Becker", "id": "Q110825272", "labels": {"et": "Jacob Becker"}},
    "pistorius": {"label": "Jacob Becker", "id": "Q110825272", "labels": {"et": "Jacob Becker"}},
    
    # Johann Vogel
    "johann vogel": {"label": "Johann Vogel", "id": "Q123498765", "labels": {"et": "Johann Vogel"}}, # NB: Kontrolli ID-d
    "johann vogel (vogelius)": {"label": "Johann Vogel", "id": "Q123498765", "labels": {"et": "Johann Vogel"}},
    "vogel": {"label": "Johann Vogel", "id": "Q123498765", "labels": {"et": "Johann Vogel"}},
    "vogelius": {"label": "Johann Vogel", "id": "Q123498765", "labels": {"et": "Johann Vogel"}},
    
    # Johann Brendeken
    "johann brendeken": {"label": "Johann Brendeken", "id": "Q56063529", "labels": {"et": "Johann Brendeken"}},
    "brendeken": {"label": "Johann Brendeken", "id": "Q56063529", "labels": {"et": "Johann Brendeken"}},
    
    # Typis Academicis
    "typis academicis": {"label": "Typis Academicis", "id": None, "labels": {"et": "Akadeemia trükikoda", "la": "Typis Academicis"}},
}

TYPES_MAPPING = {
    "trükis": {"label": "trükis", "id": "Q1261026", "labels": {"et": "trükis", "en": "printed matter", "de": "Druckerzeugnis"}},
    "printed matter": {"label": "trükis", "id": "Q1261026", "labels": {"et": "trükis", "en": "printed matter", "de": "Druckerzeugnis"}},
}

def normalize_value(value, mapping):
    """
    Kontrollib, kas väärtus vajab normaliseerimist.
    Tagastab (uus_väärtus, kas_muudeti).
    """
    if not value:
        return value, False

    # Kui on juba objekt ja ID on olemas, siis ära puutu
    if isinstance(value, dict) and value.get('id'):
        return value, False

    # Hangi tekstiline kuju võrdluseks
    text_val = ""
    if isinstance(value, str):
        text_val = value.strip()
    elif isinstance(value, dict):
        text_val = value.get('label') or value.get('labels', {}).get('et') or ""
        text_val = text_val.strip()

    if not text_val:
        return value, False

    key = text_val.lower()
    
    if key in mapping:
        target = mapping[key]
        # Loo LinkedEntity objekt
        new_val = {
            "id": target["id"],
            "label": target["label"],
            "source": "wikidata" if target["id"] else "manual",
            "labels": target["labels"]
        }
        return new_val, True

    return value, False

def process_files():
    print(f"Alustan skaneerimist kaustas: {BASE_DIR}")
    
    files_to_change = []
    
    for root, dirs, files in os.walk(BASE_DIR):
        if '_metadata.json' in files:
            path = os.path.join(root, '_metadata.json')
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                changed = False
                
                # 1. Koha (location) normaliseerimine
                loc_val = data.get('location') or data.get('koht')
                new_loc, loc_changed = normalize_value(loc_val, PLACES_MAPPING)
                
                if loc_changed:
                    data['location'] = new_loc
                    if 'koht' in data: del data['koht']
                    changed = True

                # 2. Trükkali (publisher) normaliseerimine
                pub_val = data.get('publisher') or data.get('trükkal')
                new_pub, pub_changed = normalize_value(pub_val, PRINTERS_MAPPING)
                
                if pub_changed:
                    data['publisher'] = new_pub
                    if 'trükkal' in data: del data['trükkal']
                    changed = True

                # 3. Tüübi (type) normaliseerimine
                type_val = data.get('type')
                new_type, type_changed = normalize_value(type_val, TYPES_MAPPING)
                
                if type_changed:
                    data['type'] = new_type
                    changed = True

                if changed:
                    files_to_change.append({
                        "path": path,
                        "data": data,
                        "changes": [] + (["Koht"] if loc_changed else []) + (["Trükkal"] if pub_changed else []) + (["Tüüp"] if type_changed else [])
                    })

            except Exception as e:
                print(f"Viga faili lugemisel {path}: {e}")

    if not files_to_change:
        print("Ühtegi faili ei leitud, mis vajaks normaliseerimist.")
        return

    print(f"\nLeiti {len(files_to_change)} faili, mida muuta:")
    for item in files_to_change[:10]:
        print(f"  - {os.path.basename(os.path.dirname(item['path']))}: {', '.join(item['changes'])}")
    if len(files_to_change) > 10:
        print(f"  ... ja {len(files_to_change) - 10} veel.")

    print("\nNB! See skript muudab failid ja asendab tekstid LinkedEntity objektidega.")
    print("Enne jätkamist veendu, et sul on varukoopia.")
    
    confirm = input("Kas soovid muudatused salvestada? [y/N]: ")
    if confirm.lower() != 'y':
        print("Katkestatud.")
        return

    # Salvestamine
    count = 0
    for item in files_to_change:
        try:
            with open(item['path'], 'w', encoding='utf-8') as f:
                json.dump(item['data'], f, ensure_ascii=False, indent=2)
            count += 1
        except Exception as e:
            print(f"Viga salvestamisel {item['path']}: {e}")

    print(f"\nEdukas! Muudeti {count} faili.")

if __name__ == '__main__':
    process_files()
