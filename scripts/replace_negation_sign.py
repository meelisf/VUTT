#!/usr/bin/env python3
"""
Asendab ¬ (negation, U+00AC) märgi sidekriipsuga (-) kõigis .txt failides.

Põhjus: Meilisearch käsitleb ¬ märki eraldajana, mistõttu poolitatud sõnu
(nt "con¬\ncrediti") ei leia otsinguga "concrediti". Sidekriips (-) ja
two-em dash (⸗) töötavad korrektselt.

Käivita serveris:
    python3 replace_negation_sign.py

Enne käivitamist kontrolli BASE_DIR väärtust!
"""

import os
import glob

# =========================================================
# MUUDA VASTAVALT SERVERI KONFIGURATSIOONILE
BASE_DIR = "data/"
# =========================================================

DRY_RUN = True  # True = ainult näita, mida teeks; False = tee päriselt

def replace_negation_signs():
    """Asendab ¬ märgi sidekriipsuga kõigis .txt failides."""
    
    stats = {
        'files_checked': 0,
        'files_modified': 0,
        'total_replacements': 0,
        'errors': 0
    }
    
    print(f"BASE_DIR: {BASE_DIR}")
    print(f"DRY_RUN: {DRY_RUN}")
    print(f"Asendus: ¬ (U+00AC) → - (U+002D)")
    print("-" * 60)
    
    # Käime läbi kõik alamkataloogid
    for catalog_name in sorted(os.listdir(BASE_DIR)):
        catalog_path = os.path.join(BASE_DIR, catalog_name)
        
        if not os.path.isdir(catalog_path):
            continue
        
        # Leiame kõik .txt failid (v.a .backup.* failid)
        txt_files = glob.glob(os.path.join(catalog_path, "*.txt"))
        txt_files = [f for f in txt_files if '.backup.' not in f]
        
        for txt_path in sorted(txt_files):
            stats['files_checked'] += 1
            txt_filename = os.path.basename(txt_path)
            
            try:
                with open(txt_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Loendame ¬ märkide arvu
                count = content.count('¬')
                
                if count > 0:
                    stats['files_modified'] += 1
                    stats['total_replacements'] += count
                    
                    if DRY_RUN:
                        print(f"[DRY] {catalog_name}/{txt_filename}: {count} asendust")
                    else:
                        # Asendame ¬ → -
                        new_content = content.replace('¬', '-')
                        with open(txt_path, 'w', encoding='utf-8') as f:
                            f.write(new_content)
                        print(f"[OK] {catalog_name}/{txt_filename}: {count} asendust")
                        
            except Exception as e:
                print(f"[ERROR] {catalog_name}/{txt_filename}: {e}")
                stats['errors'] += 1
    
    # Kokkuvõte
    print("-" * 60)
    print("KOKKUVÕTE:")
    print(f"  Faile kontrollitud:     {stats['files_checked']}")
    print(f"  Faile muudetud:         {stats['files_modified']}")
    print(f"  Asendusi kokku:         {stats['total_replacements']}")
    print(f"  Vigu:                   {stats['errors']}")
    
    if DRY_RUN:
        print("\n⚠️  DRY_RUN režiim - midagi ei muudetud!")
        print("    Muuda DRY_RUN = False ja käivita uuesti.")
    else:
        print("\n✅ Asendused tehtud!")
        print("    Järgmised sammud:")
        print("    1. python3 1-1_consolidate_data.py")
        print("    2. python3 2-1_upload_to_meili.py")

if __name__ == "__main__":
    replace_negation_signs()
