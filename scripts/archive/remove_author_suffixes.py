import os
import json
import re

# Konfiguratsioon - sama mis file_server.py-s
BASE_DIR = "/home/mf/Dokumendid/LLM/tartu-acad/data/04_sorditud_dokumendid/"

def clean_name(name):
    """Eemaldab nimest [P] ja [R] tähised (koos võimaliku eesoleva tühikuga)."""
    if not name:
        return name
    
    # Eemalda [P] või [R] (tõstutundetu, koos võimaliku tühikuga ees)
    # Mustrid: "Nimi [P]", "Nimi[P]", "Nimi [R]", "Nimi[R]"
    cleaned = re.sub(r'\s*\[[PR]\]', '', name, flags=re.IGNORECASE)
    return cleaned.strip()

def process_metadata_files():
    if not os.path.exists(BASE_DIR):
        print(f"VIGA: Andmekataloogi ei leitud: {BASE_DIR}")
        print("Palun kontrolli, et skriptil on ligipääs andmetele.")
        return

    print(f"Alustan metadata puhastamist kaustas: {BASE_DIR}")
    count_processed = 0
    count_modified = 0
    
    # Käime läbi kõik alamkaustad
    for root, dirs, files in os.walk(BASE_DIR):
        if '_metadata.json' in files:
            count_processed += 1
            meta_path = os.path.join(root, '_metadata.json')
            
            try:
                with open(meta_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                modified = False
                original_autor = data.get('autor', '')
                original_respondens = data.get('respondens', '')
                
                # Puhasta autor
                if original_autor:
                    new_autor = clean_name(original_autor)
                    if new_autor != original_autor:
                        data['autor'] = new_autor
                        print(f"  Muudan autorit: '{original_autor}' -> '{new_autor}' ({os.path.basename(root)})")
                        modified = True
                
                # Puhasta respondens (igaks juhuks, kuigi kasutaja ütles, et need on eraldi väljadel)
                if original_respondens:
                    new_respondens = clean_name(original_respondens)
                    if new_respondens != original_respondens:
                        data['respondens'] = new_respondens
                        print(f"  Muudan respondensi: '{original_respondens}' -> '{new_respondens}' ({os.path.basename(root)})")
                        modified = True
                
                if modified:
                    with open(meta_path, 'w', encoding='utf-8') as f:
                        json.dump(data, f, ensure_ascii=False, indent=2)
                    count_modified += 1
                    
            except Exception as e:
                print(f"VIGA faili töötlemisel {meta_path}: {e}")

    print(f"\nValmis! Töödeldud faili: {count_processed}")
    print(f"Muudetud faile: {count_modified}")

if __name__ == "__main__":
    process_metadata_files()
